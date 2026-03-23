# 设计分布式锁服务

你有没有想过：

- 秒杀时库存只有 100 件，如何保证不超卖？
- 定时任务在多台机器上运行时，如何保证只执行一次？
- 分布式环境下，如何实现跨机器的互斥访问？

这些问题，都需要**分布式锁**来解决。

今天，我们来深入探讨分布式锁的设计与实现。


## 一、为什么需要分布式锁？

### 1.1 单机锁的局限性

```java
/**
 * 单机锁 vs 分布式锁
 */
public class LockComparison {
    
    /**
     * 单机锁（Java synchronized / ReentrantLock）
     * 
     * 只能保证同一 JVM 进程内的互斥
     * 
     * 场景：
     * - 单机部署：足够
     * - 集群部署：不够
     */
    public static class SingleMachineLock {
        private final ReentrantLock lock = new ReentrantLock();
        
        public void doSomething() {
            lock.lock();
            try {
                // 临界区代码
            } finally {
                lock.unlock();
            }
        }
    }
    
    /**
     * 分布式锁
     * 
     * 可以保证多台机器之间的互斥
     * 
     * 场景：
     * - 集群部署：必须
     * - 跨机房访问：必须
     */
    public static class DistributedLock {
        // 分布式锁实现
    }
}
```

### 1.2 分布式锁的要求

```
┌─────────────────────────────────────────────────────────┐
│                 分布式锁的五大要求                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. 互斥性                                            │
│     在任意时刻，只有一个客户端持有锁                      │
│                                                         │
│  2. 不会死锁                                          │
│     即使客户端崩溃，锁也会被释放（TTL）                  │
│                                                         │
│  3. 可重入                                            │
│     同一个客户端可以多次获取同一把锁                    │
│                                                         │
│  4. 公平性（可选）                                     │
│     锁按请求顺序分配（FIFO）                           │
│                                                         │
│  5. 高性能                                            │
│     获取/释放锁的操作必须快                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```


## 二、Redis 分布式锁

### 2.1 最简单的实现

```java
/**
 * 基于 Redis SETNX 的分布式锁
 */
public class SimpleRedisLock {
    
    private RedisTemplate<String, String> redis;
    
    /**
     * 获取锁
     * 
     * 使用 SET key value NX EX seconds
     * - NX：只有 key 不存在时才设置
     * - EX：设置过期时间
     */
    public boolean lock(String lockKey, String lockValue, long expireSeconds) {
        // SET lock_key lock_value NX EX 10
        Boolean success = redis.opsForValue().setIfAbsent(
            lockKey, lockValue, Duration.ofSeconds(expireSeconds));
        
        return Boolean.TRUE.equals(success);
    }
    
    /**
     * 释放锁
     * 
     * 使用 Lua 脚本保证原子性
     */
    public boolean unlock(String lockKey, String lockValue) {
        // Lua 脚本：只有锁的持有者才能释放
        String luaScript = """
            if redis.call('GET', KEYS[1]) == ARGV[1] then
                return redis.call('DEL', KEYS[1])
            else
                return 0
            end
            """;
        
        Long result = redis.execute(
            new DefaultRedisScript<>(luaScript, Long.class),
            Collections.singletonList(lockKey),
            lockValue
        );
        
        return result != null && result > 0;
    }
}
```

### 2.2 可重入锁

```java
/**
 * 可重入分布式锁
 */
public class ReentrantRedisLock {
    
    private RedisTemplate<String, String> redis;
    
    /**
     * 获取锁（可重入）
     * 
     * 存储结构：
     * lockKey -> {count: N, holder: clientId}
     */
    public boolean lock(String lockKey, String lockValue, long expireSeconds) {
        String hashKey = "lock:count:" + lockKey;
        String holderKey = "lock:holder:" + lockKey;
        
        // 1. 检查是否是自己持有的锁
        String currentHolder = redis.opsForValue().get(holderKey);
        
        if (lockValue.equals(currentHolder)) {
            // 自己的锁，增加计数
            redis.opsForHash().increment(hashKey, lockValue, 1);
            // 续期
            redis.expire(lockKey, Duration.ofSeconds(expireSeconds));
            return true;
        }
        
        // 2. 尝试获取锁
        Boolean success = redis.opsForValue().setIfAbsent(
            lockKey, lockValue, Duration.ofSeconds(expireSeconds));
        
        if (Boolean.TRUE.equals(success)) {
            // 初始化计数
            redis.opsForHash().put(hashKey, lockValue, "1");
            redis.opsForValue().set(holderKey, lockValue);
            return true;
        }
        
        return false;
    }
    
    /**
     * 释放锁（可重入）
     */
    public boolean unlock(String lockKey, String lockValue) {
        String hashKey = "lock:count:" + lockKey;
        
        // 检查是否是自己的锁
        String currentHolder = redis.opsForValue().get("lock:holder:" + lockKey);
        if (!lockValue.equals(currentHolder)) {
            return false;
        }
        
        // 减少计数
        Long count = redis.opsForHash().increment(hashKey, lockValue, -1);
        
        // 计数归零，释放锁
        if (count == 0) {
            redis.delete(lockKey);
            redis.delete(hashKey);
            redis.delete("lock:holder:" + lockKey);
        }
        
        return true;
    }
}
```

### 2.3 锁续期（Watch Dog）

```java
/**
 * 锁续期机制（Watch Dog）
 */
public class RedisLockWithWatchdog {
    
    private RedisTemplate<String, String> redis;
    
    /**
     * 自动续期锁
     * 
     * 如果业务执行时间超过锁的 TTL，
     * 自动续期，防止锁提前释放
     */
    public void lockWithWatchdog(String lockKey, String lockValue, long expireSeconds) {
        // 1. 尝试获取锁
        boolean acquired = tryAcquire(lockKey, lockValue, expireSeconds);
        
        if (!acquired) {
            throw new LockException("获取锁失败");
        }
        
        // 2. 启动续期任务
        scheduleRenewal(lockKey, lockValue, expireSeconds);
    }
    
    /**
     * 续期任务
     * 
     * 每隔 expireSeconds / 3 秒续期一次
     * 停止条件：
     * - 锁被释放
     * - 持有者变更
     */
    private void scheduleRenewal(String lockKey, String lockValue, long expireSeconds) {
        ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
        
        // 每隔 expireSeconds / 3 秒执行一次
        long period = expireSeconds * 1000 / 3;
        
        scheduler.scheduleAtFixedRate(() -> {
            // 检查是否还是锁的持有者
            String currentHolder = redis.opsForValue().get(lockKey);
            
            if (lockValue.equals(currentHolder)) {
                // 续期
                redis.expire(lockKey, Duration.ofSeconds(expireSeconds));
            } else {
                // 不是持有者，停止续期
                scheduler.shutdown();
            }
        }, period, period, TimeUnit.MILLISECONDS);
    }
    
    /**
     * 释放锁（同时停止续期）
     */
    public void unlock(String lockKey, String lockValue) {
        // 停止续期任务
        stopRenewal(lockKey);
        
        // 释放锁
        releaseLock(lockKey, lockValue);
    }
}
```


## 三、ZooKeeper 分布式锁

### 3.1 ZooKeeper 锁原理

```
ZooKeeper 锁的核心是临时顺序节点：

1. 创建一个临时顺序节点：/locks/lock-000001
2. 获取 /locks 目录下所有子节点
3. 按节点编号排序，判断自己是否是最小的
   - 如果是：获取锁
   - 如果不是：等待比自己小的最大节点删除通知
4. 获取锁后执行任务
5. 任务完成后删除自己的节点
```

### 3.2 实现

```java
/**
 * 基于 ZooKeeper 的分布式锁
 */
public class ZkDistributedLock {
    
    private CuratorFramework zkClient;
    private static final String LOCK_PATH = "/locks";
    
    /**
     * 获取锁
     */
    public String acquireLock(String lockName) throws Exception {
        // 1. 创建临时顺序节点
        String lockNode = zkClient.create()
            .withMode(CreateMode.EPHEMERAL_SEQUENTIAL)
            .forPath(LOCK_PATH + "/" + lockName + "-");
        
        // 2. 获取锁
        String lockPath = tryAcquire(lockNode);
        
        return lockPath;
    }
    
    /**
     * 尝试获取锁
     */
    private String tryAcquire(String lockNode) throws Exception {
        // 获取所有子节点
        List<String> children = zkClient.getChildren().forPath(LOCK_PATH);
        
        // 按编号排序
        children.sort(String::compareTo);
        
        // 获取当前节点在排序后的位置
        int index = children.indexOf(getNodeName(lockNode));
        
        if (index == 0) {
            // 当前节点是最小的，获取锁成功
            return lockNode;
        } else {
            // 等待比自己小的节点删除
            String previousNode = LOCK_PATH + "/" + children.get(index - 1);
            
            // 使用 CountDownLatch 等待
            CountDownLatch latch = new CountDownLatch(1);
            
            // 注册 watcher，监听前一个节点的删除事件
            zkClient.getData().usingWatcher(event -> {
                if (event.getType() == EventType.NodeDeleted) {
                    latch.countDown();
                }
            }).forPath(previousNode);
            
            // 等待
            latch.await();
            
            // 重新尝试获取锁
            return tryAcquire(lockNode);
        }
    }
    
    /**
     * 释放锁
     */
    public void releaseLock(String lockPath) throws Exception {
        zkClient.delete().forPath(lockPath);
    }
}
```


## 四、分布式锁选型

### 4.1 Redis vs ZooKeeper

| 特性 | Redis | ZooKeeper |
|-----|-------|----------|
| 性能 | 高 | 中 |
| 可靠性 | 中（单实例有风险） | 高 |
| 功能完整性 | 需要自己实现续期 | 原生支持 |
| 公平锁 | 需要额外实现 | 原生支持 |
| 适用场景 | 简单场景、高性能 | 强一致场景 |

### 4.2 Redisson（推荐）

```java
/**
 * 使用 Redisson 实现分布式锁
 */
public class RedissonLockExample {
    
    private RedissonClient redisson;
    
    /**
     * 获取锁
     */
    public void doWithLock(String lockKey, Runnable task) {
        RLock lock = redisson.getLock(lockKey);
        
        try {
            // 尝试获取锁，最多等待 10 秒，锁自动释放 30 秒
            boolean acquired = lock.tryLock(10, 30, TimeUnit.SECONDS);
            
            if (acquired) {
                task.run();
            } else {
                throw new LockException("获取锁超时");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new LockException("获取锁被中断");
        } finally {
            // 释放锁
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
    
    /**
     * 公平锁
     */
    public void doWithFairLock(String lockKey, Runnable task) {
        RFairLock lock = redisson.getFairLock(lockKey);
        
        try {
            lock.lock();
            task.run();
        } finally {
            lock.unlock();
        }
    }
}
```


## 五、常见问题

### 5.1 锁超时问题

```java
/**
 * 锁超时问题
 */
public class LockTimeoutIssue {
    
    /**
     * 问题场景：
     * 
     * 1. 任务 A 获取锁，设置 TTL = 10 秒
     * 2. 任务 A 执行了 8 秒
     * 3. 任务 A 还没执行完，锁过期了
     * 4. 任务 B 获取了同一个锁
     * 5. 任务 A 执行完毕，释放了任务 B 的锁
     * 
     * 结果：任务 A 和任务 B 同时执行！
     */
    
    /**
     * 解决方案一：合理设置 TTL
     * 
     * - 设置足够长的 TTL，保证任务能执行完
     * - 配合锁续期机制
     */
    
    /**
     * 解决方案二：区分锁持有者
     * 
     * - 释放锁时检查是否为锁的持有者
     * - 使用唯一标识（如 UUID）作为锁值
     */
    
    /**
     * 解决方案三：任务设计
     * 
     * - 将长任务拆分为短任务
     * - 使用分段锁
     */
    
    /**
     * 解决方案四：异步执行 + 结果验证
     * 
     * - 获取锁后，异步执行任务
     * - 任务执行时，定期检查锁是否还持有
     */
}
```

### 5.2 主从切换问题

```java
/**
 * 主从切换问题
 */
public class MasterFailoverIssue {
    
    /**
     * 问题场景：
     * 
     * 1. 客户端 A 从 Master 获取锁
     * 2. Master 崩溃，锁信息还没同步到 Slave
     * 3. Slave 晋升为 Master
     * 4. 客户端 B 从新 Master 获取同一个锁
     * 5. 两个客户端同时持有锁！
     * 
     * 这是 Redis 主从模式的固有问题
     */
    
    /**
     * 解决方案一：RedLock
     * 
     * 向 N 个独立的 Redis 实例获取锁
     * 只有超过 N/2+1 个实例成功，才认为获取锁成功
     * 
     * 缺点：
     * - 需要部署多个 Redis 实例
     * - 性能降低
     * - 仍不能完全避免
     */
    public static class RedLock {
        public boolean lock(String resource, long ttl) {
            // 向 5 个 Redis 实例获取锁
            // 超过 3 个成功，才认为获取锁成功
        }
    }
    
    /**
     * 解决方案二：使用 ZooKeeper/Etcd
     * 
     * ZooKeeper 使用 ZAB 协议，强一致性
     * 不存在主从数据不一致问题
     */
    
    /**
     * 解决方案三：接受最终一致
     * 
     * 分布式系统 CAP 理论
     * 在某些场景下，最终一致是可以接受的
     */
}
```


## 六、面试追问方向

### 问题一：「Redis 分布式锁如何实现可重入？」

**回答思路**：

```
使用 Redis Hash 存储：
- key：锁名称
- field：持有者 ID
- value：重入计数

获取锁时：
1. 检查是否是同一持有者
2. 如果是，增加计数
3. 如果否，尝试获取锁

释放锁时：
1. 检查是否是同一持有者
2. 减少计数
3. 计数为 0 时删除锁
```

### 问题二：「如何避免锁提前释放？」

**回答思路**：

```
方案一：合理设置 TTL
- 评估任务执行时间
- 设置 TTL = 任务时间 × 1.5

方案二：锁续期（Watch Dog）
- 后台线程定期续期
- Redisson 已实现

方案三：任务拆分
- 将长任务拆分为多个短任务
- 每个短任务独立获取锁
```

### 问题三：「如何实现公平锁？」

**回答思路**：

```
Redis：
- 使用 List 存储等待队列
- 获取锁时加入队列尾部
- 释放锁时通知队列头部

ZooKeeper：
- 使用临时顺序节点
- 只有最小的节点能获取锁
- 自然实现公平
```


## 七、总结

```
┌─────────────────────────────────────────────────────────┐
│                分布式锁设计要点                              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  实现方式                                              │
│  ├── Redis SETNX：高性能，推荐                       │
│  ├── ZooKeeper：强一致，可靠                         │
│  └── Etcd：Raft 协议，性能与一致兼得                 │
│                                                         │
│  核心问题                                              │
│  ├── 锁超时：合理 TTL + 续期                        │
│  ├── 主从切换：使用 RedLock 或 ZK                   │
│  └── 公平性：使用队列或顺序节点                     │
│                                                         │
│  工程实践                                              │
│  ├── 推荐使用 Redisson                               │
│  ├── 锁值使用唯一标识                               │
│  └── 释放锁使用 Lua 脚本                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

> "分布式锁的本质是：在分布式环境下，提供一个跨机器的互斥机制。它看似简单，实则暗藏玄机。"
