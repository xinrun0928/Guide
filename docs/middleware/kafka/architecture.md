# Kafka 架构：Broker、Topic、Partition、Replica

一万字讲清楚 Kafka 架构，不要急，慢慢看。

我们从一个场景开始：

你的系统每天产生 10 亿条日志，需要实时分析。用户想看实时大屏，运营要即时报表，风控要秒级告警。

MySQL 扛不住，Redis 存不下，普通的 Queue 吞吐不够。

Kafka 说：我来。

10 亿条/天，约等于 **1.2 万条/秒**。Kafka 轻松吃下。

但它是怎么做到的？

## 整体架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        Kafka 集群架构                             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                     Zookeeper 集群                         │ │
│  │                   （早期版本依赖ZK）                         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│         ┌────────────────────┼────────────────────┐             │
│         ↓                    ↓                    ↓             │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐   │
│  │  Broker 1   │      │  Broker 2   │      │  Broker 3   │   │
│  │  Leader      │      │  Follower   │      │  Follower   │   │
│  │  P0, P3     │      │  P1, P4     │      │  P2, P5     │   │
│  └─────────────┘      └─────────────┘      └─────────────┘   │
│                                                                  │
│         ↑ Producer                                  ↑ Consumer   │
│         │                                            │           │
│  ┌──────┴──────────────────────────────────────────────────┐    │
│  │                  Topic: order-events                     │    │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐          │    │
│  │  │ P0 (L) │ │ P1 (F) │ │ P2 (F) │ │ P3 (L) │          │    │
│  │  │ P4 (F) │ │ P5 (F) │ │        │ │        │          │    │
│  │  └────────┘ └────────┘ └────────┘ └────────┘          │    │
│  └──────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

核心组件：

- **Broker**：Kafka 集群中的服务节点，一个 Broker 就是一个 Kafka 实例
- **Topic**：消息主题，逻辑概念，用于分类消息
- **Partition**：分区，Topic 的物理实现，一个 Topic 分为多个 Partition
- **Replica**：副本，分区的副本，保证数据高可用

## 一、Broker：Kafka 的服务节点

Broker 是 Kafka 集群的基本单元。每个 Broker 就是一个独立的 Kafka 进程。

### 单 Broker 的职责

```
┌─────────────────────────────────────────────────────────────┐
│                      单个 Broker 内部                        │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                   Kafka Server Process                 │  │
│  │                                                        │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐     │  │
│  │  │  Listener  │  │   Log      │  │  Replica   │     │  │
│  │  │   监听器    │  │   Manager  │  │   Manager  │     │  │
│  │  │            │  │   日志管理  │  │   副本管理  │     │  │
│  │  └────────────┘  └────────────┘  └────────────┘     │  │
│  │         │                │                │          │  │
│  │         ↓                ↓                ↓          │  │
│  │  ┌─────────────────────────────────────────────┐    │  │
│  │  │              Socket Server                    │    │  │
│  │  │              网络连接管理                      │    │  │
│  │  └─────────────────────────────────────────────┘    │  │
│  │                          │                          │  │
│  │                          ↓                          │  │
│  │  ┌─────────────────────────────────────────────┐    │  │
│  │  │           磁盘文件（日志段）                    │    │  │
│  │  └─────────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

Broker 的核心职责：

1. **接收消息**：接收 Producer 发送的消息
2. **存储消息**：将消息持久化到磁盘
3. **提供消息**：响应 Consumer 的拉取请求
4. **管理副本**：Follower 从 Leader 同步数据

### Broker 配置

```java
# Broker 核心配置
bootstrap.servers=localhost:9092

# Broker ID（集群内唯一）
broker.id=0

# 日志存储目录
log.dirs=/var/kafka/logs

# 最大消息大小
message.max.bytes=1048576

# 网络线程数
num.network.threads=8

# 磁盘 I/O 线程数
num.io.threads=16

# 监听器配置
listeners=PLAINTEXT://localhost:9092

# 是否为控制器（Controller）
controller.quorum.voters=1@localhost:9092
```

### Broker 选举

集群中会选出一个 Broker 作为 **Controller**，负责管理整个集群：

```java
// Controller 职责
public class KafkaController {
    
    // 1. Topic 管理
    //    - 创建/删除 Topic
    //    - 分区重分配
    //    - 分区副本选举
    
    // 2. Broker 管理
    //    - Broker 上线/下线
    //    - Controller 选举
    
    // 3. 副本管理
    //    - Leader 选举
    //    - ISR 维护
}
```

## 二、Topic：消息的分类容器

Topic 是 Kafka 中消息的逻辑分类单位。

生产者和消费者面向 Topic 编程，不需要关心消息存在哪、怎么存。

### Topic 的物理存储

```
┌─────────────────────────────────────────────────────────────────┐
│                    Topic 与 Partition 关系                      │
│                                                                  │
│  Topic: order-events                                            │
│  │                                                              │
│  ├── Partition 0  ──→  Broker 1  ──→  /data/kafka/order-events-0│
│  ├── Partition 1  ──→  Broker 2  ──→  /data/kafka/order-events-1│
│  ├── Partition 2  ──→  Broker 3  ──→  /data/kafka/order-events-2│
│  └── Partition 3  ──→  Broker 1  ──→  /data/kafka/order-events-3│
│                                                                  │
│  Topic 是逻辑概念，Partition 是物理存储                           │
└─────────────────────────────────────────────────────────────────┘
```

### Topic 命令行操作

```bash
# 创建 Topic
kafka-topics.sh --create \
    --topic order-events \
    --partitions 6 \
    --replication-factor 3 \
    --bootstrap-server localhost:9092

# 查看 Topic 列表
kafka-topics.sh --list --bootstrap-server localhost:9092

# 查看 Topic 详情
kafka-topics.sh --describe \
    --topic order-events \
    --bootstrap-server localhost:9092

# 输出示例：
# Topic: order-events    PartitionCount: 6    ReplicationFactor: 3
# Topic: order-events    Partition: 0    Leader: 1    Replicas: 1,2,3    ISR: 1,2,3
# Topic: order-events    Partition: 1    Leader: 2    Replicas: 2,3,1    ISR: 2,3,1
# Topic: order-events    Partition: 2    Leader: 3    Replicas: 3,1,2    ISR: 3,1,2
# ...

# 修改分区数（只能增加，不能减少）
kafka-topics.sh --alter \
    --topic order-events \
    --partitions 12 \
    --bootstrap-server localhost:9092

# 删除 Topic
kafka-topics.sh --delete \
    --topic order-events \
    --bootstrap-server localhost:9092
```

### Topic 配置参数

```java
// Topic 级别配置
public class TopicConfig {
    
    // 副本数
    // replication.factor=3
    
    // 分区数
    // num.partitions=6
    
    // 日志保留时间（毫秒）
    // retention.ms=604800000  // 7天
    
    // 日志保留大小
    // retention.bytes=-1     // -1 表示无限
    
    // 最小同步副本数
    // min.insync.replicas=2
    
    // 消息最大字节数
    // max.message.bytes=1048576
}
```

## 三、Partition：并行度的基石

Partition（分区）是 Kafka 并行化的核心。

每个 Partition 都是一个独立的日志文件，消息追加写入。

### Partition 的结构

```
┌─────────────────────────────────────────────────────────────────┐
│                      Partition 内部结构                          │
│                                                                  │
│  Partition 0                                                    │
│  │                                                              │
│  ├── Segment 0 (00000000000000000000.log)                      │
│  │   ├── 00000000000000000000.index    ← 偏移量索引              │
│  │   ├── 00000000000000000000.timeindex ← 时间索引               │
│  │   └── 00000000000000000000.log      ← 消息日志                 │
│  │                                                              │
│  ├── Segment 1 (00000000000001000000.log)                      │
│  │   ├── 00000000000001000000.index                           │
│  │   ├── 00000000000001000000.timeindex                        │
│  │   └── 00000000000001000000.log                              │
│  │                                                              │
│  └── Segment 2 (00000000000002000000.log)  ← 活跃段             │
│      ├── ...                                                    │
│      └── 00000000000002000000.log  ← 当前写入位置                │
│                                                              │
│  Offset:    0    1    2    3    4    5    ...                  │
│  Message: [msg1][msg2][msg3][msg4][msg5][msg6]                  │
│            ↑                                                   │
│            下一条消息从这里写入                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Partition 的特性

```java
// Partition 核心特性
public class PartitionProperties {
    
    // 1. 分区内有序
    //    同一分区内，消息按写入顺序存储
    //    消费时也按顺序获取
    
    // 2. 分区间无序
    //    不同分区之间不保证顺序
    
    // 3. 消息定位
    //    每条消息有唯一 offset（偏移量）
    //    格式：Topic-Partition-Offset
    
    // 4. 并行消费
    //    一个分区只能被同一 Consumer Group 的一个 Consumer 消费
    //    Consumer 数量 > 分区时，多余 Consumer 空闲
}
```

### Partition 与 Consumer 的关系

```
┌─────────────────────────────────────────────────────────────────┐
│              Consumer Group 与 Partition 分配                    │
│                                                                  │
│  Topic: order-events (6 partitions)                             │
│  │                                                              │
│  ├── P0 ──→ Consumer A (Group 1)                               │
│  ├── P1 ──→ Consumer A (Group 1)                               │
│  ├── P2 ──→ Consumer B (Group 1)                               │
│  ├── P3 ──→ Consumer B (Group 1)                               │
│  ├── P4 ──→ Consumer C (Group 1)                               │
│  └── P5 ──→ Consumer C (Group 1)                               │
│                                                                  │
│  Consumer Group 1 (3 个 Consumer)                               │
│  └── 每个 Consumer 消费 2 个分区                                 │
│                                                                  │
│  Consumer Group 2 (独立消费)                                    │
│  └── 消费所有分区（3 个 Consumer 各 2 个）                       │
└─────────────────────────────────────────────────────────────────┘
```

**黄金法则**：

```
Consumer 数量 ≤ Partition 数量

理想情况：Consumer 数量 = Partition 数量（或整数倍）
```

### 分区分配策略

Kafka 提供了多种分区分配策略：

```java
// 1. RangeAssignor（默认）
//    按 Topic 逐个分配，每个 Consumer 分配连续的分区
//    Topic A: [0,1,2] → Consumer 1, [3,4,5] → Consumer 2
//    Topic B: [0,1] → Consumer 1, [2,3] → Consumer 2

// 2. RoundRobinAssignor
//    所有 Topic 的分区混合后轮询分配
//    P0(A), P0(B) → Consumer 1
//    P1(A), P1(B) → Consumer 2

// 3. StickyAssignor
//    尽量保持原有分配，Rebalance 时减少移动
//    优化：减少 Rebalance 时的消息重复消费
```

## 四、Replica：数据高可用的保障

Replica（副本）是 Partition 的拷贝，存在于多个 Broker 上，保证数据不丢失。

### 副本的种类

```
┌─────────────────────────────────────────────────────────────────┐
│                    Partition 副本类型                            │
│                                                                  │
│  Partition 0                                                   │
│  │                                                              │
│  ├── Broker 1: Leader (读写入口)                                │
│  │       │                                                     │
│  │       ├── Broker 2: Follower (同步中)                       │
│  │       │       │                                             │
│  │       │       └── Broker 3: Follower (同步中)                │
│  │       │                                                     │
│  │       └── ISR = [Broker 1, Broker 2, Broker 3]              │
│  │                                                              │
│  └── 副本因子 = 3                                               │
└─────────────────────────────────────────────────────────────────┘
```

- **Leader**：主副本，所有读写都经过 Leader
- **Follower**：从副本，从 Leader 同步数据
- **ISR**（In-Sync Replicas）：同步副本集，与 Leader 保持同步的副本集合

### 副本同步机制

```java
// Follower 同步流程
public class ReplicaFetcherManager {
    
    // Follower 定期从 Leader 拉取消息
    public void run() {
        while (running) {
            // 1. 获取 LEO（Last End Offset）
            long fetchOffset = replica.logEndOffset();
            
            // 2. 构造 fetch 请求
            FetchRequest request = new FetchRequest(fetchOffset);
            
            // 3. 发送请求到 Leader
            FetchResponse response = leader.fetch(request);
            
            // 4. 写入本地日志
            for (Record record : response.records()) {
                replica.append(record);
            }
        }
    }
}
```

### ISR 的动态变化

ISR 不是固定的，会动态调整：

```
正常情况：
ISR = [Broker 1, Broker 2, Broker 3]

Broker 2 挂了：
ISR = [Broker 1, Broker 3]
// Broker 2 被踢出 ISR

Broker 2 恢复，追上进度：
ISR = [Broker 1, Broker 2, Broker 3]
// Broker 2 重新加入 ISR
```

**副本同步的判断标准**：

```java
// 判断条件：replica.lag <= maxLag 和 在 replica.timeLagMs 时间内有请求
// 满足这两个条件，才算"同步中"
replica.lag <= replica.log.maxLag
&& now - replica.lastFetchTime < replica.log.replicaLagTimeMaxMs
```

### 副本因子与可靠性

| 副本因子 | 容忍挂掉的 Broker | 存储开销 |
|----------|-------------------|----------|
| 1 | 0 | 1x |
| 2 | 1 | 2x |
| 3 | 2 | 3x |

**生产环境建议**：副本因子至少 2，推荐 3。

## 五、完整架构流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Kafka 消息全流程                                  │
│                                                                          │
│  1. Producer 发送消息                                                     │
│     │                                                                     │
│     ├── 选择分区（根据分区策略或 Key 哈希）                                 │
│     ├── 序列化消息                                                         │
│     ├── 追加到对应分区的日志文件（顺序写）                                  │
│     └── 等待 ACK（Leader 确认或 ISR 多数确认）                            │
│                                                                          │
│  2. Broker 存储消息                                                       │
│     │                                                                     │
│     ├── Leader 接收消息                                                   │
│     ├── 追加到本地日志                                                     │
│     ├── Follower 从 Leader 拉取同步                                       │
│     └── 异步刷盘到磁盘                                                     │
│                                                                          │
│  3. Consumer 消费消息                                                     │
│     │                                                                     │
│     ├── 拉取请求发送到 Leader                                              │
│     ├── 读取日志文件（零拷贝）                                             │
│     ├── 返回消息给 Consumer                                               │
│     └── Consumer 提交 offset                                             │
│                                                                          │
│  4. 故障恢复（Controller 协调）                                           │
│     │                                                                     │
│     ├── Broker 宕机检测                                                    │
│     ├── 分区 Leader 重新选举                                               │
│     ├── ISR 更新                                                         │
│     └── 选举完成后恢复读写                                                 │
└─────────────────────────────────────────────────────────────────────────┘
```

## 六、架构设计的关键思想

### 1. 日志即数据库

Kafka 的核心抽象是**日志**（Log），不是队列。

```
Queue（队列）的语义：消息被消费后消失
Log（日志）的语义：消息持久化，只读不删（直到过期）

Queue：peek → consume → delete
Log：  append → read (by offset) → expire (by time/size)
```

日志模型带来了两个关键能力：

- **消息回溯**：Consumer 可以重置 offset 重新消费
- **多 Consumer**：同一消息可以被多个 Consumer Group 独立消费

### 2. 顺序写 + 随机读

Producer 写入是顺序的，这是性能的关键。

Consumer 读取看似随机，但通过索引机制（后面会讲），可以快速定位。

### 3. 分区与副本的解耦

分区解决的是**并行度**问题：分区越多，并行消费能力越强。

副本解决的是**可用性**问题：副本越多，数据越安全。

两者独立配置，互不干扰。

### 4. 拉（Pull）而不是推（Push）

Kafka 是 Consumer 主动拉取消息，而不是 Broker 推送。

```
Push（RabbitMQ）：
Broker ──→ Consumer
优点：延迟低
缺点：Consumer 来不及处理会积压

Pull（Kafka）：
Consumer ──→ Broker
优点：Consumer 控制节奏，不会过载
缺点：可能有短暂延迟
```

## 总结

Kafka 架构核心概念：

| 概念 | 作用 | 关键特性 |
|------|------|----------|
| Broker | Kafka 服务节点 | 接收、存储、提供消息 |
| Topic | 消息分类 | 逻辑概念，多分区 |
| Partition | 并行单位 | 分区内有序，分区间并行 |
| Replica | 高可用保障 | Leader + Follower + ISR |

**理解了这四个概念，就理解了 Kafka 架构的 80%。**

---

## 留给你的问题

1. **分区数规划**：你的系统高峰 QPS 是 10 万，消息处理耗时约 50ms。你需要多少个分区？如果分区数设错了，会有什么后果？

2. **副本数选择**：你的系统对数据可靠性要求很高，允许最多容忍 1 台机器宕机而不丢数据。副本因子应该设为多少？min.insync.replicas 应该设多少？

3. **Topic 与 Partition 的关系**：如果你创建了一个 Topic，设了 100 个分区，但只有 1 个 Broker。这些分区会怎么分布？如果 Broker 挂了，会发生什么？

4. **ISR 的边界情况**：如果 ISR 只有 1 个副本（Leader 本身），这时候 acks=all 还能保证数据不丢吗？什么情况下会变成这样？

这些问题，能帮你理解架构设计的边界条件。
