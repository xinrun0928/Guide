# Redis 分布式锁：SETNX + Lua + Redisson

用户下单，需要锁定库存。

两个请求同时到达，库存只有 1 件。

两个请求都显示「下单成功」，超卖了！

**分布式锁**来解决这个问题。

## 什么是分布式锁？

分布式锁是**在分布式系统中，保证同一时刻只有一个进程能访问共享资源的机制**。

```
没有分布式锁：
请求 A ──▶ 库存检查 ──▶ 库存 = 1 ──▶ 下单成功
请求 B ──▶ 库存检查 ──▶ 库存 = 1 ──▶ 下单成功
                                          │
                                          └── 超卖！

有分布式锁：
请求 A ──▶ 获取锁 ──▶ 库存检查 ──▶ 库存 = 1 ──▶ 下单成功 ──▶ 释放锁
请求 B ──▶ 获取锁 ──▶ ✗ (等待)
```

## Redis 分布式锁实现

### 最简单的实现：SETNX

```java
/**
 * 最简单的分布式锁（有问题，不推荐）
 */
public class SimpleDistributedLock {
    
    private Jedis jedis;
    
    /**
     * 获取锁
     */
    public boolean lock(String key, String value, int expireSeconds) {
        // SETNX：key 不存在才设置
        return "OK".equals(jedis.setnx(key, value));
    }
    
    /**
     * 释放锁
     */
    public void unlock(String key, String value) {
        // 删除 key
        jedis.del(key);
    }
}
```

**问题**：如果获取锁后崩溃，锁永远不会释放！

### 改进版：设置过期时间

```java
/**
 * 带过期时间的分布式锁
 */
public class ExpireDistributedLock {
    
    private Jedis jedis;
    
    /**
     * 获取锁（SET + EXPIRE）
     */
    public boolean lock(String key, String value, int expireSeconds) {
        // 1. 设置值
        Long result = jedis.setnx(key, value);
        if (result == 1) {
            // 2. 设置过期时间
            jedis.expire(key, expireSeconds);
            return true;
        }
        return false;
    }
}
```

**问题**：如果过期时间到了，任务还没执行完，锁自动释放，其他线程获取锁，原线程执行完再释放锁——**释放了别人的锁**！

### 正确实现：判断 value 后删除

```java
/**
 * 正确的分布式锁（SETNX + Lua）
 */
public class CorrectDistributedLock {
    
    private Jedis jedis;
    
    private static final String UNLOCK_SCRIPT = 
        "if redis.call('get', KEYS[1]) == ARGV[1] then " +
        "    return redis.call('del', KEYS[1]) " +
        "else " +
        "    return 0 " +
        "end";
    
    /**
     * 获取锁
     */
    public boolean lock(String key, String value, int expireSeconds) {
        // SET key value NX EX seconds
        return "OK".equals(
            jedis.set(key, value, SetParams.setNX().ex(expireSeconds))
        );
    }
    
    /**
     * 释放锁（原子操作）
     */
    public boolean unlock(String key, String value) {
        // 使用 Lua 脚本保证原子性
        Long result = jedis.eval(
            UNLOCK_SCRIPT,
            1,
            key,
            value
        );
        return result == 1;
    }
}
```

**关键点**：
1. 使用 `SET key value NX EX seconds` 原子性设置锁
2. 释放锁时，用 Lua 脚本判断 value 是否匹配，匹配才删除

### 完整实现

```java
/**
 * Redis 分布式锁
 */
public class RedisDistributedLock {
    
    private Jedis jedis;
    
    /**
     * 尝试获取锁，最多等待
     */
    public String tryLock(String key, String value, int expireSeconds, 
                           int waitTimeoutMillis) {
        long startTime = System.currentTimeMillis();
        long deadline = startTime + waitTimeoutMillis;
        
        while (System.currentTimeMillis() < deadline) {
            // 尝试获取锁
            if ("OK".equals(jedis.set(key, value, 
                    SetParams.setNX().ex(expireSeconds)))) {
                return value;
            }
            
            // 等待后重试
            try {
                Thread.sleep(50);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return null;
            }
        }
        
        return null;
    }
    
    /**
     * 释放锁
     */
    public boolean unlock(String key, String value) {
        String script = 
            "if redis.call('get', KEYS[1]) == ARGV[1] then " +
            "    return redis.call('del', KEYS[1]) " +
            "else " +
            "    return 0 " +
            "end";
        
        Long result = jedis.eval(script, 1, key, value);
        return result != null && result == 1;
    }
    
    /**
     * 延长锁的过期时间
     */
    public boolean extend(String key, String value, int expireSeconds) {
        String script = 
            "if redis.call('get', KEYS[1]) == ARGV[1] then " +
            "    return redis.call('expire', KEYS[1], ARGV[2]) " +
            "else " +
            "    return 0 " +
            "end";
        
        Long result = jedis.eval(script, 1, key, value, String.valueOf(expireSeconds));
        return result != null && result == 1;
    }
}
```

## 使用示例

```java
/**
 * 分布式锁使用示例
 */
public class OrderService {
    
    private RedisDistributedLock lock = new RedisDistributedLock();
    
    /**
     * 下单（扣库存）
     */
    public OrderResult placeOrder(String orderId, String productId, int quantity) {
        String lockKey = "lock:product:" + productId;
        String lockValue = UUID.randomUUID().toString();
        
        try {
            // 1. 尝试获取锁，最多等待 5 秒
            String value = lock.tryLock(lockKey, lockValue, 30, 5000);
            if (value == null) {
                return OrderResult.fail("系统繁忙，请稍后重试");
            }
            
            // 2. 执行业务逻辑
            Integer stock = Integer.parseInt(jedis.get("stock:" + productId));
            if (stock < quantity) {
                return OrderResult.fail("库存不足");
            }
            
            // 3. 扣减库存
            jedis.decrby("stock:" + productId, quantity);
            
            // 4. 创建订单
            Order order = createOrder(orderId, productId, quantity);
            
            return OrderResult.success(order);
            
        } finally {
            // 5. 释放锁
            lock.unlock(lockKey, lockValue);
        }
    }
}
```

## Redisson 实现

Redisson 提供了完善的分布式锁实现，开源项目可以直接使用。

### Maven 依赖

```xml
<dependency>
    <groupId>org.redisson</groupId>
    <artifactId>redisson</artifactId>
    <version>3.24.3</version>
</dependency>
```

### 基本使用

```java
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;

/**
 * Redisson 分布式锁
 */
public class RedissonLockDemo {
    
    private RedissonClient redissonClient;
    
    /**
     * 获取锁并执行业务
     */
    public void executeWithLock(String lockKey, Runnable task) {
        RLock lock = redissonClient.getLock(lockKey);
        
        try {
            // 尝试获取锁，最多等待 0 秒，锁自动释放时间 30 秒
            boolean locked = lock.tryLock(0, 30, TimeUnit.SECONDS);
            
            if (!locked) {
                throw new ServiceBusyException("获取锁失败");
            }
            
            // 执行任务
            task.run();
            
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ServiceException("操作被中断");
        } finally {
            // 释放锁（如果是当前线程持有的）
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
    
    /**
     * 可重入锁
     */
    public void nestedLock() {
        RLock lock = redissonClient.getLock("myLock");
        
        lock.lock();  // 第一次获取
        
        try {
            // ... 业务逻辑 ...
            
            lock.lock();  // 第二次获取（可重入）
            
            try {
                // ... 更深的业务逻辑 ...
            } finally {
                lock.unlock();  // 第二次释放
            }
            
        } finally {
            lock.unlock();  // 第一次释放
        }
    }
}
```

### Redisson 的高级特性

```java
/**
 * Redisson 高级特性
 */
public class RedissonAdvancedDemo {
    
    private RedissonClient redissonClient;
    
    /**
     * 公平锁（保证获取锁的顺序）
     */
    public void fairLock() {
        RLock fairLock = redissonClient.getFairLock("fairLock");
        fairLock.lock();
        try {
            // ...
        } finally {
            fairLock.unlock();
        }
    }
    
    /**
     * 读写锁
     */
    public void readWriteLock() {
        RReadWriteLock rwLock = redissonClient.getReadWriteLock("dataLock");
        
        // 读锁（可以多个线程同时持有）
        RLock readLock = rwLock.readLock();
        readLock.lock();
        try {
            String value = jedis.get("data");
            // ...
        } finally {
            readLock.unlock();
        }
        
        // 写锁（只能一个线程持有）
        RLock writeLock = rwLock.writeLock();
        writeLock.lock();
        try {
            jedis.set("data", "newValue");
            // ...
        } finally {
            writeLock.unlock();
        }
    }
    
    /**
     * 信号量
     */
    public void semaphore() {
        RSemaphore semaphore = redissonClient.getSemaphore("semaphore");
        semaphore.trySetPermits(3);  // 设置许可数
        
        // 获取许可（阻塞）
        semaphore.acquire();
        try {
            // 限流的业务逻辑
        } finally {
            semaphore.release();
        }
        
        // 或非阻塞获取
        if (semaphore.tryAcquire()) {
            try {
                // ...
            } finally {
                semaphore.release();
            }
        }
    }
    
    /**
     * 闭锁（CountDownLatch）
     */
    public void countDownLatch() {
        RCountDownLatch latch = redissonClient.getCountDownLatch("latch");
        latch.trySetCount(3);
        
        // 等待
        latch.await(10, TimeUnit.SECONDS);
        
        // 或倒计时
        latch.countDown();
    }
}
```

## 分布式锁的常见问题

### 问题一：锁自动过期，任务还没执行完

**解决**：看门狗（Watch Dog）机制

Redisson 自动续期：

```java
// 如果不指定 leaseTime，Redisson 使用看门狗机制
// 默认每 10 秒检查一次，如果锁仍被持有，续期
lock.lock();  // leaseTime = -1，看门狗自动续期
```

### 问题二：Redis 主从切换导致锁丢失

**场景**：主节点获取锁成功，但还没同步到从节点，主节点宕机，从节点晋升，新请求获取同一把锁成功。

**解决**：RedLock 算法（详见下一节）

### 问题三：锁被误释放

**场景**：任务执行时间超过锁过期时间，锁自动释放，新线程获取锁，旧线程执行完释放了锁（释放的是新线程的锁）。

**解决**：value 使用唯一标识（如 UUID），释放时校验

## 总结

分布式锁是分布式系统的基石：

- **核心**：SETNX + EXPIRE 原子性设置
- **安全**：Lua 脚本保证释放的原子性
- **实用**：使用 Redisson 等成熟库
- **注意**：锁过期、锁重入、主从切换

## 留给你的问题

分布式锁保证了同一时刻只有一个线程执行任务，但**执行时间是不可控的**。

**如果锁的过期时间设置得太短，任务还没执行完锁就自动释放了；设置得太长，节点宕机后其他节点要等很久才能获取锁。如何设计一个自适应的锁续期机制？**
