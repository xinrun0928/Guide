# Kafka 面试高频问题汇总

Kafka 是面试中的高频考点。

从架构到原理，从配置到实战，每一环都可能问到。

这份面试指南，帮你系统梳理 Kafka 的核心知识点。

## 一、基础概念

### Q1：Kafka 是什么？有什么特点？

**问题分析**：这道题考察对 Kafka 的基本认知，属于入门级问题。

**参考答案**：

Kafka 是一个分布式消息队列系统，具有以下特点：

| 特点 | 说明 |
|------|------|
| 高吞吐 | 单机可达百万级 QPS |
| 持久化 | 消息存储到磁盘，持久化保存 |
| 高可用 | 副本机制保证数据不丢失 |
| 分布式 | 支持集群部署，水平扩展 |
| 顺序写 | 利用顺序 I/O 保证高性能 |

**核心应用场景**：

```
1. 消息队列：异步解耦
2. 日志收集：ELK 架构
3. 实时流处理：Flink、Kafka Streams
4. 事件溯源：CQRS 架构
```

---

### Q2：Kafka 的核心概念有哪些？

**问题分析**：考察对 Kafka 基本概念的掌握程度。

**参考答案**：

| 概念 | 说明 |
|------|------|
| Broker | Kafka 服务节点 |
| Topic | 消息主题，逻辑分类 |
| Partition | 分区，并行单位，分区内有序 |
| Replica | 副本，数据冗余保证高可用 |
| Producer | 生产者，发送消息 |
| Consumer | 消费者，拉取消息 |
| Consumer Group | 消费者组，实现负载均衡 |
| Offset | 消息偏移量，消费进度标识 |

**概念关系**：

```
Topic ──→ 多个 Partition ──→ 每个 Partition 有多个 Replica
                        │
                        └── 每个 Partition 被 Consumer Group 消费
                                └── 每个 Partition 只被 Group 内一个 Consumer 消费
```

---

## 二、架构原理

### Q3：Kafka 为什么这么快？

**问题分析**：这道题几乎是 Kafka 面试必问，考察对性能优化的理解。

**参考答案**：

Kafka 高性能的核心是四个优化：

| 优化 | 原理 | 效果 |
|------|------|------|
| 顺序写 | 追加写入，磁头一次寻址 | 磁盘吞吐量接近内存 |
| Page Cache | 写内存、读缓存、异步刷盘 | 热点数据不落盘 |
| 零拷贝 | sendfile + DMA Scatter-Gather | 减少 CPU 拷贝 |
| 分区并行 | 分区隔离，独立消费 | 水平扩展吞吐 |

**详细解释**：

```
1. 顺序写：
   - 消息追加到日志文件末尾
   - 磁盘顺序写速度：500MB/s（机械盘）
   - 磁盘随机写速度：几百 IOPS

2. Page Cache：
   - 写入：先到 Page Cache，OS 异步刷盘
   - 读取：优先从 Page Cache 获取

3. 零拷贝：
   - 传统 I/O：4 次拷贝（磁盘→内核→用户→Socket→网卡）
   - Kafka：0 次 CPU 拷贝（DMA 直接传输）

4. 分区并行：
   - 分区之间独立，互不影响
   - 增加分区 = 增加并行度
```

---

### Q4：Kafka 的副本机制是怎样的？

**问题分析**：考察对高可用机制的理解。

**参考答案**：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Kafka 副本机制                                 │
│                                                                  │
│  Partition 的副本：                                              │
│  ├── Leader：主副本，所有读写经过 Leader                         │
│  ├── Follower：从副本，从 Leader 同步数据                       │
│  └── ISR：同步副本集，与 Leader 保持同步的副本                   │
│                                                                  │
│  数据同步流程：                                                  │
│  Producer ──→ Leader ──→ Follower 拉取同步                     │
│                   │                                              │
│                   └── ISR = [Leader, Follower1, Follower2]       │
│                                                                  │
│  故障转移：                                                      │
│  Leader 宕机 ──→ Controller ──→ 从 ISR 选举新 Leader           │
└─────────────────────────────────────────────────────────────────┘
```

**关键配置**：

```java
// 副本因子
replication.factor = 3

// 最小同步副本
min.insync.replicas = 2

// 写入确认
acks = all
```

---

### Q5：ISR 是什么？如何动态调整？

**问题分析**：考察对副本同步机制的理解。

**参考答案**：

ISR（In-Sync Replicas）是与 Leader 保持同步的副本集合。

**进入 ISR 的条件**：

```
1. Follower 与 Leader 的 offset 差距 < replica.lag.max.messages
2. Follower 在 replica.lag.time.max.ms 时间内有 fetch 请求
```

**动态调整**：

```
ISR 收缩：
- Follower 同步延迟超过阈值
- Controller 将其踢出 ISR

ISR 扩张：
- Follower 追上了 Leader 的进度
- Controller 将其重新加入 ISR
```

---

## 三、生产者与消费者

### Q6：Producer 如何保证消息不丢失？

**问题分析**：考察对消息可靠性的理解，属于高频问题。

**参考答案**：

消息不丢失需要三端配合：

| 环节 | 配置 | 说明 |
|------|------|------|
| Producer | acks=all + retries | 发送成功即持久化 |
| Broker | replication.factor=3 | 多副本冗余 |
| Consumer | 手动提交 offset | 业务处理成功后提交 |

**Producer 端配置**：

```java
props.put("acks", "all");                    // 全部副本确认
props.put("retries", Integer.MAX_VALUE);     // 无限重试
props.put("enable.idempotence", true);       // 开启幂等性
props.put("min.insync.replicas", "2");       // 最小同步副本
```

---

### Q7：Consumer Group 是什么？如何 Rebalance？

**问题分析**：考察对消费模型的掌握。

**参考答案**：

Consumer Group 是 Kafka 实现并行消费和负载均衡的机制。

**核心规则**：

```
1. 一个分区只能被同一 Group 的一个 Consumer 消费
2. 不同 Group 可以独立消费同一个分区（广播）
3. Consumer 数量 ≤ 分区数（否则多余 Consumer 空闲）
```

**Rebalance 触发条件**：

| 条件 | 说明 |
|------|------|
| Consumer 加入/离开 | 组员变化 |
| 分区增加 | Topic 分区数增加 |
| Broker 上线/下线 | 集群变化 |

**分配策略**：

| 策略 | 特点 |
|------|------|
| Range | 按 Topic 分配，可能不均 |
| RoundRobin | 混合分配，较均匀 |
| Sticky | 尽量保持原有分配 |
| CooperativeSticky | 协作式，增量迁移 |

---

### Q8：如何保证消息顺序？

**问题分析**：考察对消息顺序性的理解。

**参考答案**：

**Kafka 顺序性保证的范围**：

```
分区内有序：同一分区内消息按写入顺序存储和消费
分区间无序：不同分区之间不保证顺序
```

**保证顺序的方法**：

```java
// 方法：使用相同 Key 发到同一分区
ProducerRecord&lt;String, String&gt; record = new ProducerRecord&lt;&gt;(
    "order-topic",
    order.getUserId(),  // Key = userId
    order
);

// 效果：
// userId=1001 的所有订单 → 同一分区 → 有序
```

**注意事项**：

```
1. 单分区内有序，但吞吐量有限
2. 多分区并发处理，无法保证全局顺序
3. 顺序与可靠性可能冲突（阻塞 vs 重试）
```

---

## 四、存储机制

### Q9：Kafka 的消息存储结构是怎样的？

**问题分析**：考察对存储原理的理解。

**参考答案**：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Kafka 消息存储结构                              │
│                                                                  │
│  /data/kafka/                                                   │
│  └── topic-name-0/  ← Partition 目录                            │
│      ├── 00000000000000000000.log     ← 消息日志               │
│      ├── 00000000000000000000.index    ← 偏移量索引             │
│      ├── 00000000000000000000.timeindex ← 时间索引             │
│      ├── 00000000000000001000000.log  ← 第二个 Segment         │
│      └── leader-epoch-checkpoint      ← Leader Epoch           │
└─────────────────────────────────────────────────────────────────┘
```

**三层结构**：

| 层级 | 文件 | 作用 |
|------|------|------|
| 日志层 | .log | 消息存储，顺序追加 |
| 偏移量索引 | .index | 按 offset 快速定位 |
| 时间索引 | .timeindex | 按 timestamp 快速定位 |

**Segment 机制**：

```
- 每个 Partition 分为多个 Segment
- 每个 Segment 包含起始 offset 的消息
- 达到大小（1GB）或时间限制后创建新 Segment
- 旧 Segment 可以被清理
```

---

### Q10：Kafka 的索引机制是怎样的？

**问题分析**：考察对查询性能优化的理解。

**参考答案**：

Kafka 使用**稀疏索引**：

```
索引文件结构：
Position  Offset
0         0
500       100
1200      250
...

查找 offset=200：
1. 二分查找索引，找到最大的 index.offset <= 200
2. 从对应 Position 开始顺序扫描
3. 直到找到 offset=200 的消息
```

**为什么用稀疏索引**：

| 优点 | 说明 |
|------|------|
| 文件小 | 10MB 索引可索引 10GB 数据 |
| 查找快 | 二分定位 + 顺序扫描 |
| 空间效率 | 不是每个 offset 都有索引 |

---

## 五、高可用

### Q11：Controller 的职责是什么？

**问题分析**：考察对集群管理的理解。

**参考答案**：

Controller 是 Kafka 集群中的协调者：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Controller 职责                                │
│                                                                  │
│  1. Broker 管理                                                │
│     - Broker 上线/下线检测                                      │
│     - Broker 状态维护                                          │
│                                                                  │
│  2. 分区 Leader 选举                                           │
│     - Leader 宕机后选新 Leader                                 │
│     - 优先从 ISR 选举                                          │
│                                                                  │
│  3. 分区副本分配                                               │
│     - 新建 Topic 的副本分配                                    │
│     - Broker 故障时的副本重分配                                │
│                                                                  │
│  4. 集群元数据同步                                             │
│     - Topic 配置管理                                           │
│     - 元数据广播                                               │
└─────────────────────────────────────────────────────────────────┘
```

**Controller 选举**：

```
基于 ZK 临时节点：
1. Broker 尝试创建 /controller 节点
2. 第一个创建成功的成为 Controller
3. Controller 挂了，节点消失，其他 Broker 重新竞争
```

---

### Q12：Leader Epoch 是干什么的？

**问题分析**：考察对数据一致性的理解，属于进阶问题。

**参考答案**：

Leader Epoch 用于解决故障恢复时的数据一致性问题。

**问题场景**：

```
旧 Leader 写入 offset 0~1000 后宕机
新 Leader 继续写入 offset 0~500
旧 Leader 恢复，以 Follower 同步

问题：
- 新 Leader 的 offset 0~500 是新数据
- 旧 Leader 的 offset 0~500 是旧数据
- 如果直接截断，会丢失新数据！
```

**Leader Epoch 解决方案**：

```
Leader Epoch 数据结构：(Epoch, StartOffset)

Epoch 0: [0, 0]      → offset 0 开始
Epoch 1: [1, 1000]   → offset 1000 开始（Epoch 变更）
Epoch 2: [2, 1500]   → offset 1500 开始

Follower 恢复时：
1. 带上自己的 Epoch
2. Leader 返回新 Epoch 的起始 offset
3. Follower 截断到正确的位置
```

---

## 六、实战问题

### Q13：Kafka 如何实现 exactly-once？

**问题分析**：考察对消息语义的掌握，属于高级问题。

**参考答案**：

Kafka 的三种消息语义：

| 语义 | 说明 | 场景 |
|------|------|------|
| at-most-once | 最多一次，可能丢消息 | 日志 |
| at-least-once | 至少一次，可能重复 | 大多数场景 |
| exactly-once | 精确一次 | 金融交易 |

**实现 exactly-once 的方式**：

```java
// 1. Producer 幂等性
props.put("enable.idempotence", true);
// 防止 Producer 端重复

// 2. 事务
producer.initTransactions();
producer.beginTransaction();
producer.send(record1);
producer.send(record2);
producer.commitTransaction();
// 跨分区原子性

// 3. 消费端幂等
// - 数据库唯一键去重
// - Redis 去重
// - 状态机处理
```

---

### Q14：Kafka 分区数如何规划？

**问题分析**：考察系统设计能力。

**参考答案**：

分区数规划公式：

```
分区数 = max(
    生产吞吐量 / 单分区生产上限,
    消费吞吐量 / 单分区消费上限,
    期望并发消费者数
)
```

**规划建议**：

| 场景 | 分区数 | 副本因子 |
|------|--------|----------|
| 小规模（QPS < 1 万） | 6~12 | 2 |
| 中规模（QPS 1万~10万） | 20~50 | 3 |
| 大规模（QPS > 10万） | 50~200 | 3 |

**注意事项**：

```
1. 分区数只能增加，不能减少
2. 过多分区会增加 Controller 压力
3. Consumer 数 ≤ 分区数
```

---

### Q15：Kafka 与其他 MQ 的区别？

**问题分析**：考察对消息队列生态的了解。

**参考答案**：

| 特性 | Kafka | RabbitMQ | RocketMQ |
|------|-------|----------|-----------|
| 吞吐量 | 百万级 | 万级 | 十万级 |
| 延迟 | 毫秒级 | 微秒级 | 毫秒级 |
| 消息持久化 | 支持 | 支持 | 支持 |
| 顺序消息 | 分区内有序 | 队列有序 | 支持 |
| 事务消息 | 支持（弱） | 不支持 | 支持 |
| 延迟消息 | 不支持原生 | 支持 | 支持 |
| 协议 | 自定义 | AMQP | 自定义 |

**选型建议**：

```
1. 日志收集、大数据流处理 → Kafka
2. 复杂路由、灵活队列 → RabbitMQ
3. 金融级事务、订单处理 → RocketMQ
```

---

## 七、检查清单

写完 Kafka 面试准备后，对照这份清单检查：

| 检查项 | 说明 |
|--------|------|
| 理解 Kafka 高性能原理 | 顺序写 + Page Cache + 零拷贝 + 分区并行 |
| 掌握副本机制 | Leader + Follower + ISR |
| 理解 Consumer Group | 分区分配 + Rebalance |
| 掌握 Producer 配置 | acks + retries + 幂等性 |
| 理解存储结构 | Segment + Index |
| 理解 Controller | Broker 选举 + 故障转移 |
| 理解消息语义 | at-most-once / at-least-once / exactly-once |

---

## 延伸阅读

如果你对 Kafka 的某个方面感兴趣，可以深入阅读：

- [Kafka 高性能核心原理](/middleware/kafka/high-performance)
- [Kafka 副本机制](/middleware/kafka/replica)
- [Kafka 消费者组](/middleware/kafka/consumer-group)
- [Kafka 消息存储](/middleware/kafka/message-storage)
- [Kafka 控制器](/middleware/kafka/controller)

---

## 留给你的问题

1. **场景设计**：设计一个实时推荐系统，需要实时处理用户行为数据（点击、浏览、购买），产生推荐结果。Kafka 在架构中扮演什么角色？如何保证推荐结果的实时性？

2. **故障排查**：生产环境发现 Consumer 消费延迟越来越大，lag 持续增长。可能的原因有哪些？如何排查？

3. **性能优化**：Kafka 集群高峰期 QPS 下降，延迟增加。排查发现磁盘 IO 接近饱和。有什么优化思路？

4. **架构选型**：新项目需要选型，日志收集场景，是选 Kafka 还是 ELK 自带的消息队列？考虑哪些因素？

这些问题没有标准答案，但思考它们能帮你真正理解 Kafka 的原理和应用。
