# Kafka：百万级吞吐量的秘密

你的系统每天产生 10 亿条日志，需要实时分析。

运营要看即时报表，风控要秒级告警，数据团队要全量采集。

MySQL 扛不住，Redis 存不下，普通的消息队列吞吐不够。

Kafka 说：我来。

**10 亿条/天 ≈ 1.2 万条/秒。Kafka 轻松吃下。**

但它是怎么做到的？

---

## Kafka 是什么？

Kafka 是 Apache 基金会旗下的开源分布式事件流平台，最初由 LinkedIn 开发，用于处理海量日志。后来贡献给 Apache 成为顶级项目，被广泛应用于大数据实时处理领域。

简单来说，Kafka 是一个**高性能、高可靠、可持久化**的消息队列，同时也是一个**分布式日志系统**。

它的核心设计理念是：

> **把消息队列当成日志来设计**——消息追加写入磁盘，顺序读写，利用磁盘顺序 I/O 的特性实现高性能。

---

## 核心概念

### Broker、Topic、Partition

```
┌─────────────────────────────────────────────────────┐
│                   Kafka 集群                         │
│                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  Broker 1   │  │  Broker 2   │  │  Broker 3   │  │
│  │  Leader     │  │  Follower   │  │  Follower   │  │
│  │  P0, P3    │  │  P1, P4    │  │  P2, P5    │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
│                                                      │
│  Topic: order-events (6 partitions)                   │
└─────────────────────────────────────────────────────┘
```

- **Broker**：Kafka 集群中的服务节点，一个 Broker 就是一个 Kafka 实例
- **Topic**：消息主题，逻辑上对消息进行分类
- **Partition**：分区，Topic 的物理实现，每个 Partition 都是一个有序的日志文件

### Replica：数据高可用

Kafka 通过副本机制保证数据可靠性：

- **Leader**：主副本，所有读写都经过 Leader
- **Follower**：从副本，从 Leader 同步数据
- **ISR**：同步副本集，与 Leader 保持同步的副本集合

### Consumer Group：消费组

同一个消费组内的 Consumer 共同消费一个 Topic 的消息，**每条消息只会被组内一个 Consumer 处理**。不同消费组相互独立，同一条消息可以被多个组消费。

---

## Kafka 为什么这么快？

这是 Kafka 最常被问到的问题。

### 1. 顺序写磁盘

磁盘的顺序 I/O 性能可以接近内存。Kafka 的消息追加写入磁盘，利用顺序写的特性，实现了极高的写入性能。

### 2. 零拷贝

使用 Linux 的 `sendfile` 系统调用，数据直接从磁盘拷贝到网卡，省去了「磁盘→内核→用户→内核→网卡」的多次拷贝。

### 3. 批量处理

消息批量发送、批量消费，减少网络 IO 次数。

### 4. 页缓存

利用操作系统的 Page Cache，热点数据在内存中，无需每次都读磁盘。

---

## 适用场景

```
✓ 日志收集与聚合（Kafka 的本职）
✓ 大数据实时流处理（Spark、Flink 生态）
✓ 消息管道（ETL）
✓ 活动追踪（用户行为分析）
✓ 监控系统（Metrics 收集）

✗ 复杂路由的业务系统（选 RabbitMQ）
✗ 需要事务消息的场景（选 RocketMQ）
✗ 延迟极度敏感 < 5ms（选 RabbitMQ）
```

---

## 内容导航

### 核心基础

- [Kafka 架构](/middleware/kafka/architecture)：Broker、Topic、Partition、Replica 详解
- [消费组机制](/middleware/kafka/consumer-group)：Consumer Group 的工作原理
- [分区策略](/middleware/kafka/partition-strategy)：如何合理规划分区

### 可靠性与高性能

- [消息存储](/middleware/kafka/message-storage)：日志存储机制与索引设计
- [副本同步](/middleware/kafka/replica-sync)：Follower 如何同步 Leader 数据
- [高性能设计](/middleware/kafka/high-performance)：顺序写、零拷贝、批量处理的秘密
- [高可用保障](/middleware/kafka/replica)：ISR 与故障恢复机制

### 生产实践

- [Producer 发送原理](/middleware/kafka/producer-send)：消息发送的全流程
- [Producer 配置](/middleware/kafka/producer)：核心配置参数详解
- [分区再均衡](/middleware/kafka/rebalance)：Rebalance 的触发条件与优化
- [Controller 选举](/middleware/kafka/controller)：集群 Controller 的作用
- [日志清理](/middleware/kafka/log-cleanup)：日志保留策略与清理机制

### 可靠性保证

- [消息不丢](/middleware/kafka/no-data-loss)：从生产到消费的全链路可靠性
- [幂等性](/middleware/kafka/idempotency)：Kafka 的幂等生产者实现

### 面试与实践

- [面试高频问题](/middleware/kafka/interview-summary)：Kafka 面试要点汇总

---

## 下一步

想深入理解 Kafka 的某个方面？

- 想了解**高性能原理**？从 [Kafka 高性能设计](/middleware/kafka/high-performance) 开始
- 想搞懂**副本机制**？从 [Kafka 副本同步](/middleware/kafka/replica-sync) 开始
- 想掌握**生产配置**？从 [Producer 发送原理](/middleware/kafka/producer-send) 开始
