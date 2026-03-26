# Kafka 副本机制：Leader Follower ISR

数据放在一台机器上，机器挂了怎么办？

Kafka 的答案是：副本。

但副本不是简单复制，「怎么同步」「谁来对外服务」「怎么选主」，每一个问题都有门道。

## 为什么需要副本？

先看一个没有副本的场景：

```
没有副本的情况：

Broker 1
├── Partition 0 (Leader)
└── Partition 1 (Leader)

消息写入 P0 ──→ 成功

Broker 1 宕机！

P0 的消息全部丢失 ← 不可接受
```

有了副本：

```
有副本的情况（副本因子=3）：

Broker 1              Broker 2              Broker 3
├── P0 (Leader)       ├── P0 (Follower)     ├── P0 (Follower)
└── P1 (Follower)    └── P1 (Leader)       └── P1 (Follower)

消息写入 P0 ──→ Leader ──→ Follower 同步

Broker 1 宕机！

Broker 2 上的 P0 晋升为新 Leader ← 继续服务
Broker 3 追同步后重新加入
```

**副本机制的核心价值**：

1. **数据冗余**：多副本存储，防止单机故障
2. **读写分离**：只读 Follower（Kafka 不支持，但概念上可扩展）
3. **高可用**：Leader 挂了，Follower 自动顶上

## 一、Leader 和 Follower

### 1.1 读写分离还是读写都走 Leader？

Kafka 的设计是：**所有读写都经过 Leader**。

```
┌─────────────────────────────────────────────────────────────────┐
│                    Kafka 副本读写模型                            │
│                                                                  │
│  Producer ──→ [写入] ──→ Leader ──→ [同步] ──→ Follower 1     │
│                        │                      │
│                        │                      └──→ Follower 2   │
│                        │                                             │
│ Consumer ──→ [读取] ──┘                                             │
│                        │                                             │
│                   Follower 不服务读写！                              │
│                   只负责从 Leader 同步数据                           │
└─────────────────────────────────────────────────────────────────┘
```

为什么 Kafka 不支持读取 Follower？

| 对比 | Kafka（读 Leader） | ES/MySQL（可读 Follower） |
|------|-------------------|---------------------------|
| 读延迟 | 稳定，无数据不一致 | 可能读到旧数据 |
| 复杂度 | 简单 | 需要处理一致性 |
| 适用场景 | 消息队列（可容忍短暂延迟） | 搜索引擎/数据库 |

**Kafka 的取舍**：消息队列追求的是「消息不丢」，而不是「最新消息立刻可读」。Leader 已经足够快。

### 1.2 Leader 的职责

```java
// Leader 的核心职责
public class LeaderReplicaManager {
    
    // 1. 接收写入
    //    - 接收 Producer 发送的消息
    //    - 写入本地日志
    //    - 返回 ACK
    
    // 2. 响应读取
    //    - 接收 Consumer 的 fetch 请求
    //    - 从本地日志读取消息
    //    - 返回消息
    
    // 3. 管理 Follower
    //    - 跟踪每个 Follower 的同步状态
    //    - 确定 ISR 集合
    //    - 参与 Leader 选举
}
```

## 二、ISR：同步副本集合

ISR（In-Sync Replicas）是 Kafka 副本机制的核心概念。

### 2.1 什么是 ISR？

ISR 是与 Leader 保持同步的副本集合。只有在 ISR 中的副本，才有资格成为新 Leader。

```
┌─────────────────────────────────────────────────────────────────┐
│                         ISR 示意图                               │
│                                                                  │
│  Partition 0 (副本因子=3)                                         │
│  │                                                              │
│  ├── Broker 1: Leader                                          │
│  │       │                                                     │
│  │       ├── Broker 2: Follower (ISR)                         │
│  │       │       │                                             │
│  │       │       └── Broker 3: Follower (ISR)                 │
│  │       │                                                     │
│  │       └── ISR = {Broker 1, Broker 2, Broker 3}              │
│  │                                                              │
│  └── 副本因子 = 3                                               │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 如何判断 Follower 是否同步？

```java
// Follower 同步条件
public class ReplicaManager {
    
    // 两个条件同时满足，才算"同步中"
    
    // 条件 1：延迟在可接受范围内
    // replica.lag <= replica.log.maxLag
    // Follower 滞后的消息数不能超过 maxLag（默认 1 万）
    
    // 条件 2：最近有同步请求
    // now - replica.lastFetchTime < replicaLagTimeMaxMs
    // 在一定时间内（默认 10 秒）有 fetch 请求
}
```

```
同步判断示例：

场景：消息 offset=1000 已写入 Leader

Follower A:
├── 最新 fetch offset: 1000
├── LEO (Last End Offset): 1000
├── lag: 0
└── 状态：同步中 ✓

Follower B:
├── 最新 fetch offset: 980
├── LEO (Last End Offset): 980
├── lag: 20
└── 状态：同步中 ✓（lag < maxLag）

Follower C:
├── 最新 fetch offset: 900
├── LEO (Last End Offset): 900
├── lag: 100
└── 状态：滞后 ⚠️（lag > maxLag，被踢出 ISR）
```

### 2.3 ISR 的动态变化

ISR 不是一成不变的，会动态调整：

```java
// ISR 动态调整机制
public class IsrManager {
    
    // Follower 被踢出 ISR
    // 条件：lag > maxLag 或 长时间没有 fetch
    
    // Follower 重新加入 ISR
    // 条件：追上了 Leader 的最新进度
    // 追上 = replica.logEndOffset >= leader.logEndOffset
}
```

```
ISR 动态变化示例：

时刻 T0：ISR = [B1, B2, B3]（全部同步）

时刻 T1：Broker 2 网络抖动
         B2 停止 fetch
         T1+10s：B2 被踢出 ISR
         ISR = [B1, B3]

时刻 T2：Broker 2 网络恢复
         B2 开始追数据
         T2+5s：B2 追上进度
         ISR = [B1, B2, B3]
```

### 2.4 关键配置参数

```java
// 副本相关配置
public class ReplicaConfig {
    
    // Follower 与 Leader 同步的最大延迟消息数
    // replica.lag.max.messages (旧版本)
    // replica.lag.max.messages (新版本拆分为两个参数)
    // 作用：超过这个值，Follower 被踢出 ISR
    replica.lag.max.messages = 40000
    replica.lag.time.max.ms = 10000
    
    // Leader 副本最小同步数量
    // 写入时，必须有至少 min.insync.replicas 个副本确认
    min.insync.replicas = 2
    
    // Broker 级别默认副本因子
    default.replication.factor = 3
}
```

## 三、副本写入流程

### 3.1 Producer 写入 Leader

```
Producer ──→ Leader

1. Producer 发送消息到 Leader
2. Leader 写入本地日志
3. Leader 返回 ACK 给 Producer
4. （异步）Follower 从 Leader 拉取同步

ACKS 配置影响：
├── acks=0：写入即返回，不等任何确认
├── acks=1：Leader 写入即返回
└── acks=all：ISR 所有副本写入才返回
```

### 3.2 Follower 同步流程

```java
// Follower 同步实现
public class ReplicaFetcherThread extends AbstractFetcherThread {
    
    private Map&lt;TopicPartition, Partition&gt; partitions;
    
    @Override
    public void doWork() {
        // 1. 构造 fetch 请求
        FetchRequest fetchRequest = buildFetchRequest();
        
        // 2. 发送到 Leader
        FetchResponse fetchResponse = leader.fetch(fetchRequest);
        
        // 3. 处理返回的消息
        for (PartitionData partitionData : fetchResponse.partitionData()) {
            // 追加到本地日志
            partition.appendRecords(partitionData.records);
            
            // 更新 HW（High Watermark）
            updateHighWatermark(partition);
        }
    }
}
```

### 3.3 同步与异步的权衡

```
┌─────────────────────────────────────────────────────────────────┐
│                  同步 vs 异步复制                                  │
│                                                                  │
│  同步复制（acks=all）：                                           │
│  ─────────────────────                                           │
│  Producer ──→ Leader ──→ F1 ──→ F2 ──→ ACK                      │
│                      │      │                                    │
│                      └──全部写入才返回                             │
│                                                                  │
│  优点：数据不丢失                                                 │
│  缺点：延迟高（等所有 Follower）                                   │
│                                                                  │
│  异步复制（acks=1）：                                             │
│  ─────────────────────                                           │
│  Producer ──→ Leader ──→ ACK                                     │
│                      │                                           │
│                      └──异步同步到 Follower                        │
│                                                                  │
│  优点：延迟低                                                     │
│  缺点：可能丢消息（Leader 挂了，Follower 没追上）                   │
└─────────────────────────────────────────────────────────────────┘
```

## 四、副本选举

### 4.1 什么时候需要选举？

- Leader 所在 Broker 宕机
- Broker 主动下线
- 分区重分配

### 4.2 选举策略

Kafka 使用 AR（Assigned Replicas）优先的选举策略：

```java
// AR 优先选举
public class LeaderElectionStrategy {
    
    // 选举顺序：
    // 1. 优先从 ISR 中选举
    // 2. ISR 为空，从 AR（Assigned Replicas）中选举第一个存活的
    
    // 为什么这样设计？
    // - ISR 中的副本数据最新，减少数据丢失
    // - 如果 ISR 全挂，只能从 AR 中选（可能丢消息）
}
```

```
选举示例：

Partition P0:
├── AR = [Broker 1, Broker 2, Broker 3]
├── ISR = [Broker 1, Broker 2]  // Broker 3 滞后
└── Leader = Broker 1

场景：Broker 1 宕机

选举过程：
1. Controller 检测到 Broker 1 宕机
2. 尝试从 ISR = [Broker 1, Broker 2] 选举
3. Broker 1 已宕机，选择 Broker 2 为新 Leader
4. Broker 3 追数据后重新加入 ISR

新状态：
├── Leader = Broker 2
└── ISR = [Broker 2, Broker 3]
```

### 4.3 选举中的边界情况

**情况一：ISR 为空怎么办？**

```
场景：所有 Follower 都与 Leader 失步

ISR = []  ← 空了！

选项 1：等待（默认）
        等待 ISR 中有副本恢复
        优点：数据安全
        缺点：可能长时间不可用

选项 2：强制选举
        使用 unclean.leader.election.enable=true
        从 AR 中选一个当 Leader
        优点：快速恢复可用
        缺点：可能丢消息

选项 3：停止写入
        生产者收到 NotEnoughReplicasException
```

```java
// 关键配置
public class UncleanElectionConfig {
    
    // 是否允许从非 ISR 中选举 Leader
    // 默认：false（数据安全优先）
    // 生产环境：false（除非你愿意丢消息）
    unclean.leader.election.enable = false
    
    // 副本同步最大等待时间
    // 超过这个时间，Follower 被认为失步
    replica.lag.time.max.ms = 30000
}
```

## 五、数据一致性与 HW/LEO

### 5.1 HW 和 LEO

理解 Kafka 一致性，必须理解两个概念：

```
┌─────────────────────────────────────────────────────────────────┐
│                         HW 与 LEO                               │
│                                                                  │
│  Partition 日志：                                                │
│  ────────────────                                               │
│  [msg0][msg1][msg2][msg3][msg4][msg5][msg6][msg7]...           │
│   0     1     2     3     4     5     6     7                   │
│                        ↑                                        │
│                        HW=4                                     │
│                        （消费者可见的最大 offset）                  │
│                                                                  │
│  Leader:                                                         │
│  ├── LEO = 8（下一条消息写入位置）                                │
│  └── HW = 4（已同步给所有 ISR 副本的最大 offset）                 │
│                                                                  │
│  Follower A:                                                     │
│  ├── LEO = 8（已同步到最新）                                     │
│  └── HW = 4                                                      │
│                                                                  │
│  Follower B:                                                     │
│  ├── LEO = 5（还在追）                                           │
│  └── HW = 4                                                      │
└─────────────────────────────────────────────────────────────────┘
```

- **LEO**（Log End Offset）：下一条消息写入的位置
- **HW**（High Watermark）：消费者能看到的最大 offset

### 5.2 为什么需要 HW？

**核心问题**：Follower 同步慢于消费速度时，消费者可能读到未同步的消息。

```
问题场景：

时刻 T0：
├── Leader HW = 5
├── Follower LEO = 3
└── 消费者读到 offset=4，但 Follower 还没同步

时刻 T1：Leader 挂了
├── Follower B 成为新 Leader
└── offset=4 的消息丢失！

解决方案：HW 机制
├── 消费者只能读 HW 之前的数据
├── HW 之前的消息，所有 ISR 都已同步
└── 新 Leader 一定包含 HW 之前的所有消息
```

### 5.3 HW 更新机制

```java
// HW 更新流程
public class ReplicaManager {
    
    // 每次写入或同步后，检查是否需要更新 HW
    
    public void maybeUpdateFollowerFetchOffset(Replica replica, long fetchOffset) {
        // 1. 更新 Follower 的 LEO
        replica.logEndOffset = fetchOffset;
        
        // 2. 计算新 HW
        // HW = min(Leader LEO, 所有 Follower LEO)
        long newHighWatermark = calculateHighWatermark();
        
        // 3. 更新 Leader HW
        if (newHighWatermark > highWatermark) {
            highWatermark = newHighWatermark;
        }
    }
}
```

## 六、副本配置实战

### 6.1 典型配置

```java
// 生产环境推荐配置
public class ProductionReplicaConfig {
    
    // Broker 级别
    default.replication.factor = 3          // 副本因子 3
    min.insync.replicas = 2                 // 至少 2 个同步副本
    
    // Topic 级别
    // 创建时指定
    // kafka-topics.sh --create --replication-factor 3 --partitions 6
    
    // 允许从非 ISR 选举
    unclean.leader.election.enable = false  // 不允许丢消息
    
    // 副本同步超时
    replica.lag.time.max.ms = 30000         // 30 秒内必须同步
}
```

### 6.2 可靠性 vs 性能

| 配置 | 可靠性 | 性能 | 适用场景 |
|------|--------|------|----------|
| acks=1, rf=1 | 低 | 高 | 测试环境 |
| acks=1, rf=2 | 中 | 中 | 一般生产环境 |
| acks=all, rf=3 | 高 | 低 | 金融级场景 |

```java
// 不同场景的配置
public class ConfigByScenario {
    
    // 测试环境：快即可
    properties.put("acks", "1");
    properties.put("retries", "0");
    
    // 一般生产：平衡
    properties.put("acks", "1");
    properties.put("retries", "3");
    properties.put("replication.factor", "3");
    
    // 金融级：安全优先
    properties.put("acks", "all");
    properties.put("retries", "Integer.MAX_VALUE");
    properties.put("min.insync.replicas", "2");
    properties.put("replication.factor", "3");
}
```

## 总结

Kafka 副本机制核心要点：

| 概念 | 说明 |
|------|------|
| Leader | 所有读写都经过 Leader |
| Follower | 只从 Leader 同步，不服务读写 |
| ISR | 与 Leader 同步的副本集合 |
| HW | 消费者可见的最大 offset |
| LEO | 下一条消息写入位置 |

**副本机制让 Kafka 实现了「高可用」与「高性能」的平衡。**

---

## 留给你的问题

1. **ISR 为空时的选择**：你的 Kafka 集群 3 个 Broker，副本因子 3，ISR 突然变成空了。这时候还能写入吗？应该怎么配置才能避免这种情况？

2. **Follower 假死**：一个 Follower 实际上在正常运行，但因为 Full GC（30 秒）暂停了。这时候它会被踢出 ISR 吗？GC 结束后能重新加入吗？

3. **unclean 选举的陷阱**：你设置了 `unclean.leader.election.enable=true`，Broker 挂了后从不 ISR 选举了新 Leader。这时候会有什么问题？

4. **HW 的局限性**：HW 机制保证了消息不丢失，但如果 Leader 挂了后 ISR 为空（所有 Follower 都没追上），新 Leader 上消息会变少吗？消费者能感知到吗？

这些问题，能帮你理解副本机制的边界条件和调优方向。
