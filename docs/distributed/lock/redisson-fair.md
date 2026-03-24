# Redisson 公平锁 vs 非公平锁

你开了一家网红奶茶店，每人限购一杯。

周一到周五，顾客零零散散来，谁先到谁先买，没问题。

周六一早，门口排起了长队。如果这帮人里有人插队，你觉得会发生什么？

**非公平锁**就是允许插队的机制。**公平锁**则是严格排队，先来后到。

## 什么是非公平锁

非公平锁（Non-Fair Lock）是 Redis 分布式锁的默认实现。

获取锁的逻辑极其简单：

```lua
if redis.call('exists', KEYS[1]) == 0 then
    redis.call('hset', KEYS[1], ARGV[1], 1)
    redis.call('pexpire', KEYS[1], ARGV[2])
    return 1
end
return 0
```

谁先执行 `SET NX`，谁拿到锁。跟排队没关系，跟运气和网速有关系。

非公平锁的执行时序：

```
时刻 T1: 客户端A 开始请求获取锁
时刻 T2: 客户端B 开始请求获取锁
时刻 T3: 锁释放
时刻 T4: 客户端A 的请求到达 Redis
时刻 T5: 客户端B 的请求到达 Redis
时刻 T6: 客户端A 获取锁 ✓
时刻 T7: 客户端B 获取锁失败，等待...
```

问题在哪？

客户端A 明明比 B 先释放锁，但 B 可能比 A 后请求。如果 A 持有锁的时间很短（比如 10ms），B 可能在 A 释放后才发起请求——B 反而先成功了。

这就是「谁抢到算谁的」。

## 非公平锁的问题：饥饿

在高并发场景下，非公平锁可能导致**线程饥饿（Starvation）**：

```
线程1: 获取锁 -> 释放 -> 获取锁 -> 释放 -> ...
线程2: 获取锁 -> 释放 -> 获取锁 -> 释放 -> ...
线程3: 获取锁 -> 释放 -> 获取锁 -> 释放 -> ...
...
线程100: 获取锁 -> 获取锁 -> 获取锁 -> ...（永远失败）
```

如果线程 1-99 的锁持有时间都很短、请求频率都很高，线程 100 可能永远抢不到。

## 什么是公平锁

公平锁（Fair Lock）严格按照请求顺序获取锁（FIFO）。

Redis 非公平锁实现：

```
锁释放 -> 谁先 SET NX 谁拿到
```

Redis 公平锁实现：

```
锁释放 -> 等待队列队首的线程拿到
```

核心区别是：**有没有等待队列**。

## Redisson 公平锁的实现

Redisson 的公平锁使用 **Hash + List** 的组合实现：

```
Hash: 存储锁持有者信息
  myFairLock: {
    "uuid:threadId1": 1,   // 当前持有者
  }

List: 等待队列
  myFairLock:queue: {
    0: "uuid:threadId2",
    1: "uuid:threadId3",
    2: "uuid:threadId4",
    ...
  }
```

### 获取公平锁的流程

```lua
-- KEYS[1] = 锁 Hash
-- KEYS[2] = 等待队列 List
-- ARGV[1] = 线程标识
-- ARGV[2] = TTL

-- 检查是否已经持有锁（可重入）
if redis.call('hexists', KEYS[1], ARGV[1]) == 1 then
    redis.call('hincrby', KEYS[1], ARGV[1], 1)
    redis.call('pexpire', KEYS[1], ARGV[2])
    return 1
end

-- 检查等待队列
local queueHead = redis.call('lindex', KEYS[2], 0)

-- 如果队列为空，或者队列头部是自己，则获取锁
if queueHead == false or queueHead == ARGV[1] then
    if queueHead == false then
        redis.call('rpush', KEYS[2], ARGV[1])
    end
    redis.call('hset', KEYS[1], ARGV[1], 1)
    redis.call('pexpire', KEYS[1], ARGV[2])
    return 1
end

return 0
```

### 释放公平锁的流程

```lua
-- KEYS[1] = 锁 Hash
-- KEYS[2] = 等待队列 List
-- ARGV[1] = 线程标识

-- 检查持有者
if redis.call('hexists', KEYS[1], ARGV[1]) == 0 then
    return nil
end

-- 计数 -1
local counter = redis.call('hincrby', KEYS[1], ARGV[1], -1)

if counter == 0 then
    -- 从队列头部移除自己
    redis.call('lpop', KEYS[2])
    redis.call('del', KEYS[1])
    return 1
end

return 0
```

### Java 代码示例

```java
public class FairLockExample {
    
    private final RedissonClient redisson;
    
    public void processOrder(Long orderId) {
        // 获取公平锁
        RLock fairLock = redisson.getFairLock("order:fair:lock:" + orderId);
        
        try {
            // 公平锁的获取是严格排队的
            // 等待时间从你开始等待时计算，不是从开始请求时计算
            boolean acquired = fairLock.tryLock(30, 60, TimeUnit.SECONDS);
            
            if (!acquired) {
                throw new RuntimeException("等待超时，请稍后重试");
            }
            
            // 业务逻辑
            processPayment(orderId);
            confirmOrder(orderId);
            
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("订单处理被中断");
        } finally {
            if (fairLock.isHeldByCurrentThread()) {
                fairLock.unlock();
            }
        }
    }
}
```

## 公平锁 vs 非公平锁的性能差异

这是面试常问的问题：**公平锁和非公平锁的性能差多少？**

| 指标 | 非公平锁 | 公平锁 |
|------|----------|--------|
| 吞吐量 | 高 | 低（约 1/10） |
| 响应时间 | 低 | 高 |
| 等待队列 | 无 | 有（内存开销） |
| 饥饿问题 | 有 | 无 |

为什么公平锁慢这么多？

因为公平锁需要维护一个**有序队列**，每次锁释放后只有队列头部能获取锁。

```
非公平锁: 10000 次操作 / 秒
公平锁:   1000 次操作 / 秒
```

代价是 10 倍的性能，换来的是「先来后到」的公平性。

## 选型建议

### 选非公平锁的场景

- 追求高吞吐量
- 锁持有时间短（毫秒级）
- 竞争不激烈（几个线程同时抢）
- 允许个别线程偶尔抢不到

```java
RLock lock = redisson.getLock("resource");  // 默认非公平锁
```

### 选公平锁的场景

- 需要严格按顺序执行
- 锁持有时间长（秒级）
- 竞争激烈（几十上百个线程同时抢）
- 不允许线程饥饿

```java
RLock fairLock = redisson.getFairLock("resource");  // 公平锁
```

### 真实业务选型

**电商秒杀（不选公平锁）**：

```
10000 并发抢 100 个商品
非公平锁: 每秒处理 10000 次请求
公平锁: 每秒处理 1000 次请求，大部分用户会超时
```

**配置更新（可选公平锁）**：

```
10 个节点同时收到配置变更通知
只有一个人能更新配置，其他人可以等待或降级
公平锁保证更新顺序，避免并发冲突
```

## Redisson API 对比

```java
// 非公平锁（默认）
RLock lock = redisson.getLock("myLock");

// 公平锁
RLock fairLock = redisson.getFairLock("myFairLock");

// 读写锁（也可以指定公平性）
RReadWriteLock rwLock = redisson.getReadWriteLock("myRWLock");
```

## 面试追问方向

- 公平锁和非公平锁的性能差距有多大？为什么？
- 什么场景下必须用公平锁？
- Redisson 公平锁用的是什么数据结构？
- 非公平锁为什么会产生饥饿问题？
- 如果让你实现一个公平锁，你怎么设计等待队列？

## 总结

公平锁和非公平锁是**性能 vs 公平性**的权衡：

- **非公平锁**：吞吐量高，但可能产生饥饿
- **公平锁**：严格排队，无饥饿，但吞吐量约为非公平锁的 1/10

大多数场景选非公平锁，只有真正需要「先来后到」时才选公平锁。

一个简单的决策原则：**如果你的业务能接受「偶尔有人等很久」，就用非公平锁。**
