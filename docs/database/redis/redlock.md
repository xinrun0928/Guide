# RedLock 算法与分布式锁安全性

单节点的 Redis 分布式锁，在主从切换时会丢失。

这是因为主从复制是**异步**的。

**RedLock** 就是来解决这个问题的。

## 为什么单节点锁不安全？

```
时间线：
T1 ──────────────────────────────────────────────────────────▶

线程 A 在主节点获取锁
T1: Master ──SET lock NX EX 30──▶ OK

主节点还没同步到从节点就宕机了
T2: Master 宕机
T3: Slave 晋升为新主

线程 B 在新主节点获取同一把锁
T4: New Master ──SET lock NX EX 30──▶ OK  ← 成功！

结果：线程 A 和线程 B 同时持有同一把锁！
```

这就是**主从复制导致的分布式锁失效问题**。

## RedLock 算法原理

RedLock 的核心思想是：**在多个独立的 Redis 节点上获取锁，只有超过半数节点成功，才算获取锁成功**。

```
假设有 5 个 Redis 节点（N = 5）

┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
│ Redis 1 │  │ Redis 2 │  │ Redis 3 │  │ Redis 4 │  │ Redis 5 │
│  (主)   │  │  (主)   │  │  (主)   │  │  (主)   │  │  (主)   │
└────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘
     │             │             │             │             │
     ▼             ▼             ▼             ▼             ▼
   获取锁        获取锁        获取锁        获取锁        获取锁
     │             │             │             │             │
     ◀─────────────┼─────────────┼─────────────┼─────────────┘
                   │             │
              5 个中 3 个成功 → 锁获取成功！
```

### RedLock 算法步骤

```java
/**
 * RedLock 算法实现
 */
public class RedLockDemo {
    
    private List&lt;Jedis&gt; redisNodes;
    private int N;  // 节点数量
    private int quorum;  // 法定数量 = N/2 + 1
    
    /**
     * 获取 RedLock
     */
    public String tryLock(String resourceName, String value, 
                          long ttlMillis, long timeoutMillis) {
        // 1. 计算法定数量
        quorum = N / 2 + 1;
        
        // 2. 获取当前时间（毫秒）
        long startTime = System.currentTimeMillis();
        
        // 3. 在 N 个节点上尝试获取锁
        List&lt;Future&lt;Boolean&gt;&gt; futures = new ArrayList&lt;&gt;();
        for (Jedis node : redisNodes) {
            futures.add(executeOnNode(node, resourceName, value, ttlMillis));
        }
        
        // 4. 等待所有结果
        int successCount = 0;
        long deadline = startTime + timeoutMillis;
        
        for (int i = 0; i < N && System.currentTimeMillis() < deadline; i++) {
            try {
                if (futures.get(i).get()) {
                    successCount++;
                }
            } catch (Exception e) {
                // 节点失败，继续
            }
        }
        
        // 5. 检查是否获得多数节点的锁
        if (successCount >= quorum) {
            // 计算锁的实际有效期
            long elapsed = System.currentTimeMillis() - startTime;
            long lockValidityTime = ttlMillis - elapsed;
            
            if (lockValidityTime > 0) {
                return value;
            }
        } else {
            // 获取锁失败，释放所有节点
            release(resourceName, value);
        }
        
        return null;
    }
    
    /**
     * 在单个节点上执行获取锁操作
     */
    private Future&lt;Boolean&gt; executeOnNode(Jedis node, String resourceName, 
                                            String value, long ttlMillis) {
        return CompletableFuture.supplyAsync(() -> {
            try {
                // SET key value NX PX milliseconds
                return "OK".equals(
                    node.set(resourceName, value, 
                        SetParams.setNX().px(ttlMillis))
                );
            } catch (Exception e) {
                return false;
            }
        });
    }
    
    /**
     * 释放锁
     */
    public void release(String resourceName, String value) {
        for (Jedis node : redisNodes) {
            try {
                // Lua 脚本：检查并删除
                String script = 
                    "if redis.call('get', KEYS[1]) == ARGV[1] then " +
                    "    return redis.call('del', KEYS[1]) " +
                    "else " +
                    "    return 0 " +
                    "end";
                node.eval(script, 1, resourceName, value);
            } catch (Exception e) {
                // 忽略节点失败
            }
        }
    }
}
```

## RedLock 的安全性分析

### 为什么 RedLock 是安全的？

假设有 5 个节点：

| 场景 | 分析 |
|-----|------|
| **1 个节点宕机** | 4 个节点工作，3 个成功 = 仍可获取锁 ✓ |
| **2 个节点宕机** | 3 个节点工作，2 个成功 = 仍可获取锁 ✓ |
| **3 个节点宕机** | 2 个节点工作，2 个成功 = 无法获取锁 ✓（正确拒绝）|

**关键点**：只有获取到多数节点的锁，才算成功。

### RedLock 的假设

RedLock 基于以下假设：

1. **时钟基本同步**：各节点时钟漂移不会太大（通常 < 1 秒）
2. **节点独立故障**：各节点故障是独立的，不会同时发生
3. **网络分区时间有限**：大部分网络分区可以在 TTL 时间内恢复

### RedLock 的争议

Redis 作者 antirez 提出 RedLock 后，引发了广泛讨论。争议点包括：

| 争议点 | 说明 |
|-----|------|
| **时钟假设** | 如果一个节点时钟突然跳跃，可能导致锁提前过期 |
| **性能问题** | 需要操作多个节点，性能比单节点低 |
| **不可靠的节点** | 如果节点存在时钟跳跃或其他不可靠行为，RedLock 可能失效 |

Martin Kleppmann（DDIA 作者）提出了详细的批评：

```
Martin 的质疑：

RedLock 假设锁的 TTL 远大于时钟漂移，
但这个假设在实践中很难保证。

如果锁的 TTL 只有几秒，
时钟漂移可能导致严重问题。
```

## Redisson RedLock 实现

Redisson 提供了 RedLock 的实现：

```java
import org.redisson.Redisson;
import org.redisson.api.RedissonClient;
import org.redisson.api.RLock;
import org.redisson.redisson.RedissonRedLock;

/**
 * Redisson RedLock
 */
public class RedissonRedLockDemo {
    
    private RedissonClient redisson1;
    private RedissonClient redisson2;
    private RedissonClient redisson3;
    private RedissonClient redisson4;
    private RedissonClient redisson5;
    
    /**
     * 获取 RedLock
     */
    public void useRedLock(String lockKey) {
        // 1. 创建多个 RLock
        RLock lock1 = redisson1.getLock(lockKey);
        RLock lock2 = redisson2.getLock(lockKey);
        RLock lock3 = redisson3.getLock(lockKey);
        RLock lock4 = redisson4.getLock(lockKey);
        RLock lock5 = redisson5.getLock(lockKey);
        
        // 2. 创建 RedissonRedLock
        RedissonRedLock redLock = new RedissonRedLock(lock1, lock2, lock3, lock4, lock5);
        
        try {
            // 3. 尝试获取锁
            // 参数：等待时间 10 秒，锁自动释放时间 30 秒
            boolean locked = redLock.tryLock(10, 30, TimeUnit.SECONDS);
            
            if (locked) {
                // 执行业务逻辑
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            // 4. 释放锁
            redLock.unlock();
        }
    }
}
```

## RedLock vs 单节点锁

| 维度 | 单节点锁 | RedLock |
|-----|---------|---------|
| **可靠性** | 主从切换可能丢锁 | 多数节点保证，更可靠 |
| **性能** | 高 | 较低（需要多节点） |
| **复杂度** | 简单 | 复杂 |
| **适用场景** | 非关键业务 | 关键业务 |
| **部署** | 单节点或主从 | 需要多个独立节点 |

## RedLock 的实际部署

### 部署建议

```
┌─────────────────────────────────────────────────────────────────┐
│                        RedLock 部署                              │
│                                                                 │
│   数据中心 1                                                     │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐                         │
│   │ Redis 1 │  │ Redis 2 │  │ Redis 3 │                         │
│   │  (主)   │  │  (从)   │  │  (从)   │                         │
│   └─────────┘  └─────────┘  └─────────┘                         │
│                     │                                            │
│                     │ 复制                                       │
│                     ▼                                            │
│   数据中心 2                                                     │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐                         │
│   │ Redis 4 │  │ Redis 5 │  │         │                         │
│   │  (主)   │  │  (从)   │  │  (待添加) │                         │
│   └─────────┘  └─────────┘  └─────────┘                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 配置建议

```bash
# 建议：
# - 至少 5 个节点
# - 分布在不同的机器/机架/数据中心
# - 节点间网络延迟 < 10ms
# - 锁的 TTL > 节点间最大时钟漂移
```

## RedLock 的替代方案

如果 RedLock 太复杂，可以考虑：

### 方案一：ZooKeeper 分布式锁

```
ZooKeeper 节点：
/locks/order-123 (临时顺序节点)

特性：
- 有序性保证
- 临时节点自动删除
- 强一致性保证
```

### 方案二：Etcd 分布式锁

```bash
# Etcd 使用 Lease + Key 保证
etcdctl lease grant 30
etcdctl put /locks/order-123 "value" --lease=$lease_id
```

### 方案三：Consul 分布式锁

Consul 提供了原生的 Lock API。

## 总结

RedLock 是分布式锁的高可用方案：

- **原理**：多节点获取锁，多数成功才算成功
- **优点**：主从切换不丢失锁
- **缺点**：性能较低，部署复杂
- **适用**：关键业务，不能容忍锁丢失

## 留给你的问题

RedLock 需要多个 Redis 节点，增加了运维复杂度。

**如果你的业务只需要最终一致性（允许短暂的双重执行），单节点锁是否足够？什么场景下必须使用 RedLock？**
