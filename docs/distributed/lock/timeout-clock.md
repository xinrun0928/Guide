# 分布式锁超时与时钟漂移问题

一个真实的线上事故：

```
凌晨 3:00，秒杀活动开始
时刻 T1: 任务 A 获取锁，TTL = 10 秒
时刻 T2: 任务 A 开始执行（预估 5 秒）
时刻 T3: 任务 A 还没执行完，锁过期了
时刻 T4: 任务 B 获取了同一把锁
时刻 T5: 任务 A 和 B 同时执行
时刻 T6: 库存变成 -50，超卖 50 单
```

你可能觉得：「我设置的 TTL 是 30 秒，不可能超时。」

但你有没有想过：**任务的执行时间是你预估的，预估就可能出错。**

这就是分布式锁最容易被忽视的问题：**锁超时**。

## 锁超时的本质问题

锁超时的根源是：**任务执行时间和锁 TTL 是两个独立的东西**。

你设置 TTL = 30 秒，是因为你觉得「这个任务 30 秒内肯定能完成」。

但这个判断本身就不靠谱：
- 数据库慢查询（正常情况下 10ms，突然变成 2s）
- 网络抖动（Redis 响应变慢）
- GC 停顿（JVM STW 导致任务卡住）
- 代码 bug（死循环、无限递归）

任何一种情况都可能导致任务执行时间超过预估。

## 解决方案一：合理评估 TTL + 看门狗

这是 Redisson 的做法（参考 [/distributed/lock/redisson](/distributed/lock/redisson)）。

核心思路：**不固定 TTL，让锁的生命周期跟随任务的执行**。

```
任务开始 -> 启动看门狗 -> 每 10 秒续期一次 -> 任务完成 -> 释放锁 -> 停止看门狗
```

好处是：**任务执行多久，锁就持续多久**。

坏处是：**如果持有锁的客户端崩溃了，锁要等 TTL 过期才会释放**。

## 解决方案二：任务设计为可中断的

这个思路是：**把长任务拆成多个短任务，每个任务都需要重新获取锁**。

```
原始设计:
  获取锁 -> 执行整个任务（可能很长） -> 释放锁

改进设计:
  获取锁 -> 执行任务的第一阶段 -> 检查是否超时 -> 
  如果没超时，继续执行下一阶段 -> ... -> 任务完成 -> 释放锁
```

```java
public void executeTask() {
    long startTime = System.currentTimeMillis();
    long maxExecutionTime = 25 * 1000;  // TTL = 30 秒，留 5 秒 buffer
    
    // 第一阶段：获取初始数据
    if (!executePhase1()) {
        return;  // 失败就退出
    }
    
    // 检查是否超时
    if (System.currentTimeMillis() - startTime > maxExecutionTime) {
        // 任务超时，释放锁让其他任务执行
        return;
    }
    
    // 第二阶段：处理数据
    if (!executePhase2()) {
        return;
    }
    
    // 再次检查
    if (System.currentTimeMillis() - startTime > maxExecutionTime) {
        return;
    }
    
    // 第三阶段：保存结果
    executePhase3();
}
```

## 解决方案三：锁值携带预期完成时间

这个思路来自 [Martin Kleppmann 的论文](https://martin.kleppmann.com/papers/redlock-pdfsvc-attack.pdf)。

锁值中存储任务预期完成的时间戳：

```
锁值: {
    "owner": "client-123",
    "expectedEndTime": 1699999999000  // 任务预期在什么时候完成
}
```

其他客户端获取锁时，检查预期完成时间：

```lua
-- 检查锁
local lockValue = redis.call('get', KEYS[1])

if lockValue then
    local expectedEndTime = cjson.decode(lockValue).expectedEndTime
    
    -- 如果锁已过期，或者预期完成时间已过，允许抢占
    if redis.call('ttl', KEYS[1]) == -1 then
        -- 锁没有 TTL，这是旧锁，可能持有者已崩溃
        return 0  -- 允许抢占
    end
end

-- 正常获取锁
return 1
```

这个方案的问题是需要修改锁值的格式，实现复杂度较高。

## 时钟漂移问题

时钟漂移是指：**不同机器的本地时钟存在差异**。

```
Redis 实例 A 的时钟: 1699999999000
Redis 实例 B 的时钟: 1699999999500  // 快了 500ms
Redis 实例 C 的时钟: 1699999998700  // 慢了 300ms
```

在分布式系统中，时钟漂移是普遍现象。

### 时钟漂移导致的问题

考虑 RedLock 的场景：

```
时刻 T1: 客户端向 Redis-A 请求锁，使用本地时间计算 TTL
时刻 T2: Redis-B 的时钟比客户端快 100ms
时刻 T3: 客户端释放锁时，Redis-B 认为锁还有效 100ms
时刻 T4: 客户端再次请求 Redis-B 的锁，可能成功（锁还没完全过期）
```

这就是 RedLock 被批评的核心问题：**用本地时钟测量锁的生命周期是不可靠的**。

### Redisson 如何处理时钟漂移

Redisson 的解决方案是：**使用 Redis 节点的时间，而不是本地时间**。

```java
// Redisson 内部实现
public long getLockWaitTime(long waitTime, long leaseTime, TimeUnit unit) {
    long currentTime = System.currentTimeMillis();
    
    if (leaseTime > 0) {
        // 如果有 leaseTime，用 leaseTime
        return unit.toMillis(waitTime);
    } else {
        // 如果没有 leaseTime，使用默认配置
        return unit.toMillis(waitTime);
    }
}

// 实际上 Redisson 的 TTL 是用 Redis 的 PEXPIRE 管理的
// Redis 的 PEXPIRE 使用 Redis 服务端时间，不受客户端时钟影响
```

关键点：**Redis 的过期机制使用的是 Redis 服务端时间，而不是客户端时间**。

所以只要你用的是 Redis 的 TTL 功能（`EXPIRE`、`PEXPIRE`），时钟漂移的影响就很小。

### 时钟回拨问题

时钟回拨（Clock Backward）是指：**系统时钟突然变慢或被校准，导致时间倒流**。

```
时刻 T1: 当前时间 1000
时刻 T2: NTP 同步完成，当前时间被校准为 900
时刻 T3: 锁的过期时间是 1000
时刻 T4: 实际时间已经是 1000，但系统认为还是 950
时刻 T5: 锁还没过期
```

时钟回拨的常见场景：
- NTP 时间同步
- 虚拟机休眠后恢复
- 容器迁移
- 系统管理员手动调整时间

### 雪花算法（Snowflake）的时钟回拨处理

雪花算法依赖时间戳，如果发生时钟回拨，历史时间戳可能失效。

```java
public class SnowflakeIdWorker {
    
    private final long twepoch = 1609459200000L;  // 2021-01-01
    private long lastTimestamp = -1L;
    private final long timestampBits = 41;
    private final long workerIdBits = 10;
    
    public synchronized long nextId() {
        long timestamp = timeGen();
        
        // 时钟回拨检测
        if (timestamp < lastTimestamp) {
            // 方案一：抛出异常
            throw new RuntimeException("Clock moved backwards!");
            
            // 方案二：等待回拨的时间过去
            // while (timestamp < lastTimestamp) {
            //     timestamp = timeGen();
            // }
            
            // 方案三：使用兜底时间（lastTimestamp + 1）
            // timestamp = lastTimestamp + 1;
        }
        
        lastTimestamp = timestamp;
        // 生成 ID...
        return id;
    }
}
```

### Redisson 的时钟回拨保护

Redisson 通过以下方式减少时钟回拨的影响：

1. **使用 Redis 服务端时间**：TTL 基于 Redis 的 `PEXPIRE`，不受客户端时钟影响
2. **看门狗续期**：如果时钟回拨导致锁提前失效，看门狗会在下次续期时恢复
3. **合理设置 TTL**：不要设置过短的 TTL，给时钟漂移留出 buffer

## 实际建议

### TTL 设置原则

1. **不要设置过短**：至少是任务预估时间的 2-3 倍
2. **结合看门狗**：使用 Redisson 的 `lock()` 方法，不设置 leaseTime
3. **监控告警**：当锁获取失败率突然上升时，检查是否有超时问题

### 时钟同步原则

1. **NTP 同步要谨慎**：避免大跨度的时间调整
2. **优先使用逻辑时钟**：如 Lamport 时间戳或向量时钟
3. **Redis 节点时钟要同步**：使用 NTP 同步 Redis 服务器时钟

### 代码层面

```java
public class SafeDistributedLock {
    
    private final RLock lock;
    
    public void executeWithLock(Runnable task) {
        // 使用看门狗，不设置 leaseTime
        lock.lock();
        
        try {
            // 任务执行前检查一次超时
            // 如果预计会超时，主动释放锁
            if (isLikelyToTimeout()) {
                return;
            }
            
            task.run();
            
        } finally {
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
    
    private boolean isLikelyToTimeout() {
        // 业务逻辑判断
        return false;
    }
}
```

## 面试追问方向

- 锁超时和时钟漂移是两个什么问题？
- Redisson 的看门狗机制能解决锁超时问题吗？
- 什么是时钟回拨？有什么影响？
- 雪花算法怎么处理时钟回拨？
- 如果你设计一个分布式锁，怎么处理 TTL 和任务执行时间不匹配的问题？

## 总结

锁超时和时钟漂移是分布式锁的两个隐藏陷阱：

- **锁超时**：任务执行时间可能超过 TTL，导致锁提前释放。解决方案是看门狗自动续期，或将长任务拆成短任务。
- **时钟漂移**：不同机器的时钟不同步，影响锁的生命周期。解决方案是使用 Redis 服务端时间，并确保 Redis 节点时钟同步。

这两个问题虽然不常见，但一旦发生就是严重事故，需要在设计阶段就考虑清楚。
