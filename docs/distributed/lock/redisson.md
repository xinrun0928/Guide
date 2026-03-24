# Redisson 分布式锁实现：RLock 与看门狗机制

手写一个 Redis 分布式锁需要多少行代码？

我见过最精简的版本是 30 行。但这 30 行里藏着至少 5 个坑：

1. SETNX + EXPIRE 不是原子操作
2. 释放锁时误删别人的锁
3. 业务执行时间超过 TTL，锁提前释放
4. 锁续期问题
5. 不可重入

每踩一个坑，都是生产事故。

Redisson 就是在这样的背景下诞生的——**让分布式锁变得简单**。

## 为什么需要 Redisson

Redisson 是一个 Redis 客户端，提供了丰富的分布式数据结构和服务。其中最核心的功能就是**分布式锁**。

对比一下手写锁和 Redisson：

```java
// 手写分布式锁（需要处理各种边界情况）
public class ManualRedisLock {
    private JedisPool jedisPool;
    private String lockKey;
    private String uuid;
    private int expireSeconds = 30;
    
    public boolean tryLock() {
        Jedis jedis = jedisPool.getResource();
        // 坑1: 需要用 SET NX EX 而不是 SETNX + EXPIRE
        String result = jedis.set(lockKey, uuid, "NX", "EX", expireSeconds);
        return "OK".equals(result);
    }
    
    public void unlock() {
        // 坑2: 需要用 Lua 脚本检查 + 删除
        // 坑3: 需要处理各种异常情况
    }
}

// Redisson（开箱即用）
RLock lock = redisson.getLock("myLock");
lock.tryLock();    // 获取锁
lock.unlock();     // 释放锁
```

Redisson 把所有细节都封装好了，你只需要调用 API。

## Redisson 的核心 API：RLock

RLock 接口与 `java.util.concurrent.locks.Lock` 对齐，学习成本几乎为零：

```java
public interface RLock extends Lock, Expirable {
    
    /**
     * 阻塞获取锁，一直等待直到获取成功
     * 注意：不会响应中断
     */
    void lock();
    
    /**
     * 阻塞获取锁，带 LeaseTime
     * @param leaseTime 持有时间，到期自动释放
     * @param unit 时间单位
     */
    void lock(long leaseTime, TimeUnit unit);
    
    /**
     * 尝试获取锁
     * @param waitTime 最大等待时间
     * @param leaseTime 持有时间
     * @param unit 时间单位
     * @return 是否获取成功
     */
    boolean tryLock(long waitTime, long leaseTime, TimeUnit unit);
    
    /**
     * 非阻塞尝试获取锁
     * @return 是否获取成功
     */
    boolean tryLock();
    
    /**
     * 释放锁
     */
    void unlock();
    
    /**
     * 判断是否被当前线程持有
     */
    boolean isHeldByCurrentThread();
    
    /**
     * 获取当前锁的持有数量（可重入计数）
     */
    int getHoldCount();
}
```

获取 Redisson 客户端：

```java
Config config = new Config();
config.useSingleServer()
    .setAddress("redis://127.0.0.1:6379")
    .setPassword("password")
    .setConnectionPoolSize(64)
    .setConnectionMinimumIdleSize(10);

RedissonClient redisson = Redisson.create(config);
```

## 看门狗（Watch Dog）机制

这是 Redisson 最重要的特性，也是它优于手写锁的核心原因。

### 问题：业务执行时间超过 TTL

假设你设置锁的 TTL 为 30 秒，但某个慢查询导致业务执行了 45 秒：

```
时刻 T1: 客户端A 获取锁，TTL = 30秒
时刻 T2: 业务开始执行
时刻 T3: 业务还在执行，但锁已经过期了（第30秒）
时刻 T4: 客户端B 获取了同一把锁
时刻 T5: 客户端A 和 客户端B 同时在执行
```

这就是**锁提前释放导致的安全问题**。

### 解决方案：看门狗自动续期

Redisson 的解决方案是**看门狗机制**：

```
锁被获取后，启动一个后台调度任务
每隔 (TTL / 3) 时间，自动延长锁的 TTL
只要锁还被持有，就一直续期
直到锁被显式释放
```

默认配置：
- TTL = 30 秒
- 续期间隔 = TTL / 3 = 10 秒
- 续期持续进行，直到 unlock()

这就是为什么推荐**不设置 leaseTime** 的写法：

```java
// 推荐：不设置 leaseTime，启用看门狗自动续期
RLock lock = redisson.getLock("myLock");
lock.lock();  // 内部启用看门狗

try {
    // 业务逻辑，执行多久都没关系
    // Redisson 会自动续期
} finally {
    lock.unlock();
}
```

如果设置了 leaseTime：

```java
// 不推荐：设置了固定持有时间，不会自动续期
lock.lock(30, TimeUnit.SECONDS);  // 30秒后自动释放，即使业务还在执行
```

### 看门狗的工作流程

```
1. 客户端A 调用 lock()
2. Redisson 尝试 SET lockKey uniqueId NX EX 30
3. 获取成功，启动 WatchDog 任务
4. WatchDog 每 10 秒执行一次：EXPIRE lockKey 30
5. 客户端A 执行完业务，调用 unlock()
6. Redisson 删除 lockKey，取消 WatchDog 任务
```

**注意**：只有调用 `lock()` 或 `tryLock()` 不带 leaseTime 时才会启用看门狗。

## Java 代码示例

### 基本用法

```java
public class OrderService {
    
    private final RedissonClient redisson;
    
    public void createOrder(Order order) {
        RLock lock = redisson.getLock("order:lock:" + order.getId());
        
        try {
            // 尝试获取锁，最多等待 10 秒，持有 30 秒后自动释放
            // 如果不设置 leaseTime，会启用看门狗
            boolean acquired = lock.tryLock(10, 30, TimeUnit.SECONDS);
            
            if (!acquired) {
                throw new RuntimeException("系统繁忙，请稍后重试");
            }
            
            // 执行业务逻辑
            checkInventory(order);
            saveOrder(order);
            deductInventory(order);
            
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("订单创建被中断");
        } finally {
            // 必须释放锁
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
}
```

### 使用 try-with-resources 简化

Redisson 支持 `try-with-resources` 语法（通过 AutoCloseable）：

```java
public void createOrder(Order order) {
    RLock lock = redisson.getLock("order:lock:" + order.getId());
    
    try (lock) {
        lock.lock(10, TimeUnit.SECONDS);  // 最多等待 10 秒
        
        checkInventory(order);
        saveOrder(order);
        deductInventory(order);
        
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new RuntimeException("订单创建被中断");
    }
    // 自动释放锁
}
```

### 批量获取锁

如果需要同时锁住多个资源：

```java
RLock lock1 = redisson.getLock("resource1");
RLock lock2 = redisson.getLock("resource2");
RLock lock3 = redisson.getLock("resource3");

// 所有锁一起获取
RedissonMultiLock multiLock = new RedissonMultiLock(lock1, lock2, lock3);

try {
    multiLock.lock(10, TimeUnit.SECONDS);
    // 所有锁都获取成功，执行业务
} finally {
    multiLock.unlock();
}
```

## Redisson 内部实现

Redisson 使用 Hash 结构存储锁信息：

```
Key: lockKey (如 "myLock")
Type: Hash

Hash 内容:
{
    "uuid:threadId1": 1,    // 持有者 + 重入计数
    "uuid:threadId2": 3    // 另一个持有者 + 重入计数
}
```

### 获取锁的 Lua 脚本

```lua
-- KEYS[1] = 锁名称
-- ARGV[1] = 线程标识 (uuid:threadId)
-- ARGV[2] = 锁过期时间 (TTL)

if redis.call('exists', KEYS[1]) == 0 then
    -- 锁不存在，直接获取，设置 Hash
    redis.call('hset', KEYS[1], ARGV[1], 1)
    redis.call('pexpire', KEYS[1], ARGV[2])
    return 1
end

if redis.call('hexists', KEYS[1], ARGV[1]) == 1 then
    -- 锁存在，且是同一个持有者，重入计数 +1
    redis.call('hincrby', KEYS[1], ARGV[1], 1)
    redis.call('pexpire', KEYS[1], ARGV[2])
    return 1
end

-- 锁存在，但被其他持有者持有，获取失败
return 0
```

### 释放锁的 Lua 脚本

```lua
-- KEYS[1] = 锁名称
-- ARGV[1] = 线程标识 (uuid:threadId)

if redis.call('hexists', KEYS[1], ARGV[1]) == 0 then
    -- 当前线程不持有锁，无法释放
    return nil
end

local count = redis.call('hincrby', KEYS[1], ARGV[1], -1)

if count == 0 then
    -- 计数归零，删除锁
    redis.call('del', KEYS[1])
    return 1
end

return 0
```

## Redisson vs 手写 Redis 锁

| 特性 | 手写锁 | Redisson |
|------|--------|----------|
| 原子性 | 需用 Lua 脚本 | 内置 |
| 超时释放 | 固定 TTL | 看门狗自动续期 |
| 可重入 | 需额外实现 | 内置 |
| 阻塞获取 | 需自己写循环 | 内置 |
| 多种锁类型 | 需自己实现 | 公平锁、读写锁、信号量等 |
| 异常处理 | 需自己处理 | 自动释放 |

Redisson 把分布式锁的复杂度封装了 90%，但你还是需要理解**看门狗机制**和**为什么不能设置太短的 leaseTime**。

## 面试追问方向

- Redisson 的看门狗机制是什么？默认多久续期一次？
- 如果不设置 leaseTime，锁会永远不释放吗？
- tryLock() 和 lock() 有什么区别？
- Redisson 底层用什么数据结构存储锁信息？
- Redisson 的可重入是怎么实现的？

## 总结

Redisson 是 Java 中最成熟的 Redis 分布式锁库，核心优势是：

1. **看门狗机制**：解决业务执行时间超过 TTL 的问题
2. **API 对齐 JUC**：学习成本低，语义清晰
3. **丰富的锁类型**：可重入锁、公平锁、读写锁、联锁等

记住一个原则：**尽量使用无参的 lock() 方法，让看门狗帮你处理续期问题。**

```java
// ✅ 推荐
lock.lock();

// ❌ 不推荐（除非你确定业务执行时间）
lock.lock(30, TimeUnit.SECONDS);
```
