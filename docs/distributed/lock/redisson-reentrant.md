# Redisson 可重入锁原理

先问一个问题：以下代码会死锁吗？

```java
public class Service {
    private final RLock lock = redisson.getLock("orderLock");

    public void methodA() {
        lock.lock();
        try {
            System.out.println("methodA 执行中...");
            methodB();  // 在持有锁的情况下调用 methodB
        } finally {
            lock.unlock();
        }
    }

    public void methodB() {
        lock.lock();
        try {
            System.out.println("methodB 执行中...");
        } finally {
            lock.unlock();
        }
    }
}
```

如果你回答「会死锁」，说明你还没理解可重入。

正确答案是：**不会死锁，因为 Redisson 的锁是可重入的**。

## 什么是可重入

可重入（Reentrant）意味着：**同一个线程，在持有锁的情况下，可以再次获取同一把锁**。

这在线程调用自身方法或调用同一个类的其他加锁方法时非常常见。

单机 JVM 中的 `ReentrantLock` 就是可重入的：

```java
ReentrantLock lock = new ReentrantLock();

lock.lock();          // 第1次获取
lock.lock();          // 第2次获取（同一线程，不阻塞）
System.out.println(lock.getHoldCount());  // 输出 2
lock.unlock();        // 计数 -1，锁未被释放
lock.unlock();        // 计数 -1，锁被释放
```

为什么叫「可重入」？因为锁允许**重新进入**。线程 A 进入了锁保护的代码块，还可以再次进入同一个代码块。

## 不可重入会怎样

假设锁不可重入：

```
线程A: 获取锁 methodA()  ✓
线程A: 调用 methodB()
线程A: 尝试获取锁 methodB()  ✗ 被自己持有的锁阻塞
线程A: 永远等待...
```

这就是死锁。递归调用、tryLock 的重试逻辑，都依赖可重入特性。

## Redis 如何存储可重入信息

Redisson 使用 **Hash 结构**存储锁信息：

```
锁 Key: myLock
锁 Type: Hash

Hash 内容:
┌─────────────────────────────────────┬───────┐
│ Field (线程标识)                     │ Value │
├─────────────────────────────────────┼───────┤
│ 8c3e6b2a-1234-5678-9abc-def012345678:1 │   3   │
└─────────────────────────────────────┴───────┘
```

- **Field**: 线程标识，格式为 `{UUID}:{ThreadId}`
- **Value**: 重入计数

为什么用 UUID + ThreadId？

因为同一个 JVM 中，ThreadId 可能重复（线程销毁后，新线程可能复用 ID）。UUID 确保全局唯一性。

## 获取锁的可重入逻辑

```java
public boolean tryLockInnerAsync(long waitTime, long leaseTime, TimeUnit unit, long threadId) {
    // KEYS[1] = 锁名称
    // ARGV[1] = 线程标识 (uuid:threadId)
    // ARGV[2] = TTL (毫秒)
    
    String luaScript = 
        "if redis.call('exists', KEYS[1]) == 0 then " +
        "    redis.call('hset', KEYS[1], ARGV[1], 1) " +
        "    redis.call('pexpire', KEYS[1], ARGV[2]) " +
        "    return 1 " +                    // 锁不存在，直接获取
        "end; " +
        
        "if redis.call('hexists', KEYS[1], ARGV[1]) == 1 then " +
        "    redis.call('hincrby', KEYS[1], ARGV[1], 1) " +  // 重入计数 +1
        "    redis.call('pexpire', KEYS[1], ARGV[2]) " +
        "    return 2 " +                    // 锁存在，同一持有者，重入成功
        "end; " +
        
        "return 0";                          // 锁存在，但不是同一持有者
        
    return commandExecutor.evalReadAsync(
        luaScript,
        RedisCommands.EVAL_LONG,
        Collections.singletonList(getName()),
        getLockName(threadId),
        leaseTime
    );
}
```

流程图：

```
┌─────────────────────────┐
│  尝试获取锁             │
└───────────┬─────────────┘
            │
            ▼
    ┌───────────────────┐
    │ 锁是否存在？      │
    └───────┬───────────┘
            │
      No    │    Yes
      ┌─────┴─────┐
      ▼          ▼
┌─────────┐  ┌───────────────────────┐
│ 直接获取 │  │ 是否是同一持有者？    │
│ 计数=1   │  └───────────┬───────────┘
└─────────┘         Yes   │   No
                  ┌───────┴───────┐
                  ▼               ▼
            ┌──────────┐      ┌────────┐
            │ 计数+1   │      │ 获取   │
            │ 续期TTL  │      │ 失败   │
            └──────────┘      └────────┘
```

## 释放锁的可重入逻辑

```java
public void unlockInnerAsync(long threadId) {
    // KEYS[1] = 锁名称
    // ARGV[1] = 线程标识 (uuid:threadId)
    
    String luaScript = 
        "if redis.call('hexists', KEYS[1], ARGV[1]) == 0 then " +
        "    return nil " +                      // 当前线程不持有锁
        "end; " +
        
        "local counter = redis.call('hincrby', KEYS[1], ARGV[1], -1); " +
        "if counter > 0 then " +
        "    redis.call('pexpire', KEYS[1], ARGV[2]); " +  // 还有重入，续期
        "    return 0; " +
        "else " +
        "    redis.call('del', KEYS[1]); " +      // 计数归零，释放锁
        "    return 1; " +
        "end; ";
        
    return commandExecutor.evalWriteAsync(
        luaScript,
        RedisCommands.EVAL_LONG,
        Collections.singletonList(getName()),
        getLockName(threadId)
    );
}
```

流程：

```
┌─────────────────────────┐
│  尝试释放锁             │
└───────────┬─────────────┘
            │
            ▼
    ┌───────────────────┐
    │ 计数 -1           │
    └───────┬───────────┘
            │
      ┌─────┴─────┐
      ▼           ▼
   计数>0     计数=0
      │           │
      ▼           ▼
   续期TTL    删除锁
   返回0      返回1
```

## 简化版可重入锁实现

为了加深理解，这里提供一个简化版的可重入锁实现：

```java
public class SimpleReentrantLock {
    
    private final JedisPool jedisPool;
    private final String lockKey;
    private final String uuid;
    private final int ttlSeconds;
    
    public SimpleReentrantLock(JedisPool jedisPool, String lockKey) {
        this.jedisPool = jedisPool;
        this.lockKey = lockKey;
        this.uuid = UUID.randomUUID().toString();
        this.ttlSeconds = 30;
    }
    
    /**
     * 获取锁（可重入）
     */
    public boolean lock() {
        try (Jedis jedis = jedisPool.getResource()) {
            String currentValue = jedis.hget(lockKey, uuid);
            
            if (currentValue != null) {
                // 锁存在且是同一持有者，重入计数 +1
                jedis.hincrBy(lockKey, uuid, 1);
                jedis.expire(lockKey, ttlSeconds);
                return true;
            } else {
                // 锁不存在，尝试获取
                Long result = jedis.hsetnx(lockKey, uuid, "1");
                if (result == 1) {
                    jedis.expire(lockKey, ttlSeconds);
                    return true;
                }
                return false;
            }
        }
    }
    
    /**
     * 释放锁（可重入）
     */
    public void unlock() {
        try (Jedis jedis = jedisPool.getResource()) {
            String currentValue = jedis.hget(lockKey, uuid);
            
            if (currentValue == null) {
                return;  // 当前线程不持有锁
            }
            
            long count = Long.parseLong(currentValue);
            if (count > 1) {
                // 还有重入，计数 -1
                jedis.hincrBy(lockKey, uuid, -1);
                jedis.expire(lockKey, ttlSeconds);
            } else {
                // 计数归零，释放锁
                jedis.hdel(lockKey, uuid);
            }
        }
    }
    
    /**
     * 获取重入计数
     */
    public int getHoldCount() {
        try (Jedis jedis = jedisPool.getResource()) {
            String value = jedis.hget(lockKey, uuid);
            return value == null ? 0 : Integer.parseInt(value);
        }
    }
}
```

注意：这个简化实现没有保证检查和更新的原子性，实际使用应该用 Lua 脚本。

## 可重入的场景举例

### 场景一：递归调用

```java
public int factorial(int n) {
    lock.lock();
    try {
        if (n <= 1) {
            return 1;
        }
        return n * factorial(n - 1);  // 递归调用同一方法
    } finally {
        lock.unlock();
    }
}
```

### 场景二：互相调用

```java
public void methodA() {
    lock.lock();
    try {
        methodB();  // 调用另一个加锁方法
        doSomethingA();
    } finally {
        lock.unlock();
    }
}

public void methodB() {
    lock.lock();
    try {
        doSomethingB();
    } finally {
        lock.unlock();
    }
}
```

### 场景三：tryLock 重试

```java
public boolean tryLockWithRetry(String resourceId, int maxRetries) {
    for (int i = 0; i < maxRetries; i++) {
        if (lock.tryLock()) {
            return true;
        }
        try {
            Thread.sleep(100);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }
    return false;
}
```

## 面试追问方向

- 可重入锁在单机 JVM 和 Redis 中的实现有什么区别？
- 为什么用 UUID + ThreadId 作为线程标识，而不是只用 ThreadId？
- Hash 结构存可重入信息，field 和 value 分别存什么？
- 如果计数归零后不删除锁，会怎样？
- 可重入计数会溢出吗？

## 总结

可重入是分布式锁的重要特性，Redisson 通过 Hash 结构实现：

- **field**: 线程唯一标识（UUID:ThreadId）
- **value**: 重入计数

获取锁时检查是否已有自己的标识，有则计数+1，无则创建并设置计数为1。

释放锁时计数-1，计数归零才真正删除锁。

这个设计让分布式锁拥有了与 JVM 锁相同的语义，大大简化了业务代码的编写。
