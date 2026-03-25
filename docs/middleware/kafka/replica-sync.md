# Kafka 副本同步原理与故障转移

Leader 挂了，系统还能继续服务吗？

这是分布式系统的灵魂拷问。

Kafka 的副本同步机制，就是为了回答这个问题：让系统在 Broker 故障时依然可用，让数据不丢失。

## 一、副本同步原理

### 1.1 同步模型：拉取而非推送

Kafka 的 Follower 是**主动拉取**数据，而不是 Leader 主动推送。

```
┌─────────────────────────────────────────────────────────────────┐
│                    Follower 拉取模型                              │
│                                                                  │
│  Leader                    Follower                             │
│  ┌─────────┐              ┌─────────┐                          │
│  │  消息   │              │  拉取   │                          │
│  │  存储   │ ←─────────── │  请求   │                          │
│  │         │              │         │                          │
│  │  LEO=10 │              │  LEO=5  │                          │
│  │  HW=5   │              │         │                          │
│  └─────────┘              └─────────┘                          │
│       ↑                                                         │
│       │                                                         │
│  Follower 定期发送 FetchRequest                                  │
│  Leader 返回从上次拉取位置开始的所有消息                           │
└─────────────────────────────────────────────────────────────────┘
```

为什么用拉取而非推送？

| 对比 | 推送模式 | 拉取模式 |
|------|----------|----------|
| 实时性 | 高 | 中（依赖轮询间隔） |
| 消费速率控制 | 难 | 易（Consumer 自己控制） |
| 失败处理 | 复杂 | 简单（重试拉取即可） |
| 背压处理 | 难 | 易（Consumer 慢，Leader 等着） |

### 1.2 拉取请求详解

```java
// Follower 拉取请求
public class FetchRequest {
    
    private final long fetchOffset;      // 从哪个 offset 开始拉取
    private final int maxBytes;           // 最多拉取多少字节
    private final long maxWaitMs;         // 最大等待时间
    private final String topic;
    private final int partition;
    
    // Follower 定期发送 FetchRequest
    // 请求间隔由 replica.fetch.wait.max.ms 控制（默认 500ms）
}

// Leader 响应
public class FetchResponse {
    
    private final List&lt;PartitionData&gt; partitionData;
    
    public static class PartitionData {
        private final long hw;           // 返回的 HW
        private final List&lt;Record&gt; records;  // 消息列表
    }
}
```

### 1.3 同步完整流程

```java
// Follower 同步完整流程
public class ReplicaFetcherThread extends AbstractFetcherThread {
    
    @Override
    protected def doWork(): Unit = {
        // 1. 等待可读事件或定时触发
        awaitIdle()
        
        // 2. 构建 Fetch 请求
        val fetchRequest = buildFetchRequest()
        
        // 3. 发送到 Leader
        val response = leader.fetch(fetchRequest)
        
        // 4. 处理响应
        for (partitionData <- response.partitionData) {
            // 4.1 解析消息
            val records = partitionData.records
            
            // 4.2 追加到本地日志（顺序写）
            for (record <- records) {
                partition.appendRecords(record)
            }
            
            // 4.3 更新 LEO
            partition.logEndOffset = partitionData.records.lastOffset + 1
            
            // 4.4 尝试更新 HW
            maybeUpdateHighWatermark(partition)
        }
    }
}
```

### 1.4 分区同步状态机

```
┌─────────────────────────────────────────────────────────────────┐
│                    分区同步状态机                                 │
│                                                                  │
│                    ┌────────────────┐                            │
│                    │  Online/Isr    │                            │
│                    │  正常，在 ISR 中 │                           │
│                    └───────┬────────┘                            │
│                            │                                     │
│            ┌───────────────┼───────────────┐                    │
│            ↓               ↓               ↓                      │
│    ┌───────────┐   ┌───────────┐   ┌───────────┐                │
│    │ Offline   │   │  IsrShrinking│  │ IsrGrowth │                │
│    │  下线中   │   │ ISR 收缩中   │  │ ISR 扩张中 │                │
│    └───────────┘   └─────┬─────┘   └─────┬─────┘                │
│                          │               │                       │
│                          └───────┬───────┘                       │
│                                  ↓                                │
│                    ┌────────────────┐                            │
│                    │  Online/Isr     │                            │
│                    │  或 Online/NonIsr│                           │
│                    └────────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

## 二、故障转移

### 2.1 故障检测

Kafka 使用 **ZK/Watch** 机制检测 Broker 故障：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Broker 故障检测机制                            │
│                                                                  │
│  Zookeeper                                                    │
│  ├── /brokers/ids/0 → Broker 元数据                            │
│  ├── /brokers/ids/1 → Broker 元数据                            │
│  └── /brokers/ids/2 → Broker 元数据                            │
│                                                                  │
│  Broker 正常时：                                                 │
│  └── ZK 节点存在，Watch 触发正常                                │
│                                                                  │
│  Broker 宕机时：                                                 │
│  └── ZK 节点消失 → Watch 触发 → Controller 收到通知              │
│                                                                  │
│  检测时间：                                                      │
│  └── zookeeper.session.timeout.ms（默认 30 秒）                  │
└─────────────────────────────────────────────────────────────────┘
```

```java
// Controller 故障检测
public class KafkaController {
    
    // Broker 上下线监听
    def onBrokerLossy(brokerId: Int): Unit = {
        // 1. Controller 感知到 Broker 宕机
        // 2. 触发分区 Leader 选举
        // 3. 更新集群元数据
    }
}
```

### 2.2 分区 Leader 选举

当 Leader 所在 Broker 故障，Controller 会发起 Leader 选举：

```java
// Leader 选举流程
public class Controller {
    
    def electLeaderForPartition(topic: String, partition: Int): Unit = {
        val replicas = zkClient.getReplicasForPartition(topic, partition)
        val isr = zkClient.getInSyncReplicas(topic, partition)
        
        // 选举策略：ISR 优先
        val newLeader = if (isr.nonEmpty) {
            // 优先从 ISR 选
            isr.head
        } else if (configs.uncleanLeaderElectionEnabled) {
            // ISR 为空，从 AR 中选
            replicas.head
        } else {
            // 不允许脏选举，返回空
            null
        }
        
        // 更新 ZK
        if (newLeader != null) {
            zkClient.setLeaderForPartition(topic, partition, newLeader)
        }
    }
}
```

### 2.3 故障转移完整流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    分区故障转移完整流程                           │
│                                                                  │
│  时刻 T0：正常状态                                               │
│  ────────────────────                                           │
│  Broker 1 (P0 Leader)    Broker 2 (P0 Follower)    Broker 3 (P0 Follower)
│         │                         │                         │
│         └─────────────────────────┼─────────────────────────┘   │
│                                   │                              │
│                              定期拉取                             │
│                                                                  │
│  时刻 T1：Broker 1 宕机                                         │
│  ──────────────────────────────                                │
│  - ZK Watch 触发，Controller 收到通知                            │
│  - Controller 检查 ISR：[2, 3]                                  │
│  - 选择 Broker 2 为新 Leader                                    │
│  - 更新 ZK 元数据                                                │
│                                                                  │
│  时刻 T2：故障转移完成                                           │
│  ──────────────────────                                        │
│  Broker 2 (P0 Leader)    Broker 3 (P0 Follower)                 │
│         │                         │                              │
│         │ ←────────────────────────┘                              │
│         │                   继续拉取                               │
│                                                                  │
│  时刻 T3：Broker 1 恢复                                          │
│  ──────────────────────────                                     │
│  - Broker 1 以 Follower 身份重新加入                            │
│  - 找到新 Leader (Broker 2)                                    │
│  - 开始同步数据                                                  │
│  - 追上后重新加入 ISR                                           │
└─────────────────────────────────────────────────────────────────┘
```

### 2.4 故障转移时间

| 阶段 | 时间 | 说明 |
|------|------|------|
| 故障检测 | ~30s | zookeeper.session.timeout.ms |
| Controller 选举触发 | <1s | Watch 回调 |
| Leader 选举 | <1s | ZK 写入 |
| 客户端重连 | ~5-10s | 客户端感知新 Leader |

**总时间**：通常 30-60 秒内完成故障转移

## 三、HW 与故障恢复

### 3.1 故障期间的读写

```
场景：Leader 宕机，选举期间

Producer：
├── 写入请求失败
├── 重试（可配置 retries）
└── 最终可能收到 NotLeaderOrFollowerException

Consumer：
├── 继续从新 Leader 读取
├── 可能读到少量重复消息（因为 offset 可能略回退）
└── 消费进度不受影响
```

### 3.2 新 Leader 的数据恢复

新 Leader 选出后，可能与旧 Leader 数据不一致：

```
旧 Leader (Broker 1)：
├── LEO = 1000
└── 最后一条消息 offset = 999

Follower A (Broker 2)：
├── LEO = 950
└── 正在同步中

Follower B (Broker 3)：
├── LEO = 970
└── 同步进度更快

选举结果：Broker 2 成为新 Leader
└── LEO = 950

问题：
- Broker 3 之前有 offset 950-970 的消息
- Broker 2 上没有这些消息
- 需要处理数据不一致
```

### 3.3 Leader Epoch 机制

Kafka 0.11+ 引入了 Leader Epoch 解决数据一致性问题：

```java
// Leader Epoch 的数据结构
public class LeaderEpoch {
    // 格式：(epoch, startOffset)
    // epoch = Leader 的版本号，每次 Leader 变更递增
    // startOffset = 该 epoch 开始时的 log offset
    
    // 例如：
    // (0, 0)      → epoch 0 从 offset 0 开始
    // (1, 500)    → epoch 1 从 offset 500 开始
    // (2, 800)    → epoch 2 从 offset 800 开始
}
```

```
Leader Epoch 解决数据不一致：

Broker 2 成为新 Leader：
├── 写入 LeaderEpoch(2, 950)
└── 之后的写入从 offset 950 开始

Broker 3 追数据时：
├── 发现 offset 950 之前的数据不可信
├── 因为那是 epoch 1 的数据
└── 只接受 epoch >= 2 的数据

效果：
├── 避免伪同步（虚假追上）
├── 保证数据线性一致
└── 解决了截断错误的数据问题
```

## 四、故障场景分析

### 4.1 单点故障

```
场景：3 Broker 集群，副本因子 3，1 个 Broker 宕机

结果：✓ 无影响
- 剩余 2 个 Broker 形成多数派
- 可选新 Leader
- 继续服务

消息不丢失条件：
- min.insync.replicas = 2
- acks = all
```

### 4.2 多数派故障

```
场景：3 Broker 集群，副本因子 3，2 个 Broker 同时宕机

结果：⚠️ 写入失败
- 只有 1 个 Broker 存活
- ISR 可能为空或只有 1 个
- min.insync.replicas = 2 时，写入会拒绝

恢复：
- 等宕机 Broker 恢复
- 数据从存活的 Broker 同步
```

### 4.3 网络分区

```
场景：Broker 2 与集群网络断开

内部视角：
├── Broker 2：我觉得我是 Leader
└── Broker 1, 3：Broker 2 挂了，选 Broker 1 为新 Leader

问题：
├── Broker 2 继续接收写入（但不会被 ISR 认可）
├── Broker 1 成为新 Leader
└── 数据可能分叉

解决：
├── ZK 过半机制保证只有一个 Leader
└── Broker 2 写入不会被 ISR 确认
```

## 五、生产环境最佳实践

### 5.1 副本分布策略

```java
// 确保副本均匀分布
// 机架感知配置
broker.rack=us-east-1a

// 副本分配策略：跨机架分布
// 确保每个副本在不同机架
replica.selector.class=org.apache.kafka.common.replica.RackAwareReplicaSelector
```

```bash
# 查看副本分布
kafka-topics.sh --describe --topic my-topic --bootstrap-server localhost:9092

# 输出示例：
# Topic: my-topic    Partition: 0    Leader: 1    Replicas: 1,2,3    Isr: 1,2
#                                                    ↑ ↑
#                                                 不同机架！
```

### 5.2 监控配置

```java
// 需要监控的关键指标
public class ReplicaMetrics {
    
    // 副本延迟
    // broker.replica.lag
    // broker.replica.lag.time.max.ms
    
    // ISR 大小
    // broker.replica.isr.expand.rate
    // broker.replica.isr.shrink.rate
    
    // Leader 选举次数
    // controller.zookeeper.metric.live.brokers
    // controller.channel.lastPollResult
}

// JMX 监控配置
jmxremote.port=9999
jmxremote.ssl=false
jmxremote.authenticate=false
```

### 5.3 故障恢复脚本

```bash
# 手动触发 Leader 选举（慎用！）
kafka-leader-election.sh --bootstrap-server localhost:9092 \
    --topic my-topic --partition 0 \
    --election-type PREFERRED \
    --json-paths /tmp/election.json

# 选举类型：
# PREFERRED：优先使用 AR 中的第一个副本
# CLEAN：等待所有副本同步后再选举
```

## 总结

副本同步与故障转移要点：

| 环节 | 关键点 |
|------|--------|
| 同步模型 | Follower 拉取，非推送 |
| 同步判断 | lag <= maxLag + time <= maxTime |
| 故障检测 | ZK Watch 机制 |
| Leader 选举 | ISR 优先，AR 兜底 |
| 数据一致性 | Leader Epoch 机制 |

**副本机制让 Kafka 在保证高性能的同时，实现了高可用。**

---

## 留给你的问题

1. **Follower 假死**：Follower 进程还在运行，但 JVM GC 暂停了 40 秒。这会导致它被踢出 ISR 吗？GC 结束后能自动恢复吗？

2. **Leader Epoch 的必要性**：没有 Leader Epoch 时，新 Leader 选举后可能包含一些旧 Leader 的脏数据。Leader Epoch 怎么解决这个问题？

3. **网络分区的边界**：如果 Broker 1 和 Broker 2 能互相通信，但都无法与 Broker 3 通信。这时候会发生什么？ZK 的过半机制能保护吗？

4. **故障恢复后的数据同步**：Broker 宕机 1 小时后恢复，此时 Leader 上有 100 万条新消息。这个 Follower 恢复同步需要多长时间？有什么优化手段？

思考这些问题，能帮你理解故障恢复的细节和调优点。
