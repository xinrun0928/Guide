# RocketMQ：双十一验证的高可靠消息队列

你在电商下单后，订单系统告诉库存系统「减一件商品」，库存系统告诉物流系统「准备发货」。

这套流程背后，消息在不停地流转。

但你有没有想过：**如果 NameServer 宕机了，消息还能发出去吗？Broker 挂了，Consumer 会丢消息吗？**

这些问题，在 Kafka 里可能需要复杂的配置才能解决。但 RocketMQ 的设计，让它们变得简单。

---

## RocketMQ 是什么？

RocketMQ 是阿里巴巴开源的分布式消息中间件，最初用于支撑双十一的海量交易。经过多年双十一的验证，它已经是国内最成熟的消息队列之一。

与 Kafka 相比，RocketMQ 最大的特点是**功能全面**：

> **原生支持事务消息、延迟消息、顺序消息**——这些电商核心场景必备的能力，Kafka 要么不支持，要么需要额外开发。

RocketMQ 的设计目标是：**高可靠、功能完整、适合业务系统**。

---

## 核心架构：四大金刚

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Producer   │────▶│  NameServer │◀────│   Broker    │
│  (生产者)    │     │  (协调中心)  │     │  (存储中心)  │
└─────────────┘     └─────────────┘     └─────────────┘
                                           │
                              ┌────────────┴────────────┐
                              │                         │
                         Master                    Slave
                       (主节点)                  (从节点)
```

### 1. NameServer：轻量级协调中心

NameServer 的职责是**服务发现**：

- Broker 启动时向所有 NameServer 注册自己的地址、端口、主题信息
- Producer/Consumer 需要发消息或消费消息时，向 NameServer 查询路由信息

**关键设计**：NameServer 集群是对等的，没有主从之分，各节点独立运行，无单点故障。

### 2. Broker：消息存储中枢

Broker 是真正存储消息的地方，它的核心组件是：

| 组件 | 作用 |
|-----|------|
| **CommitLog** | 消息本体，所有消息顺序写入这个文件 |
| **ConsumeQueue** | 消息目录，记录消息在 CommitLog 中的位置 |
| **IndexFile** | 消息索引，按 MessageKey 建索引 |

### 3. Producer：消息发源地

Producer 支持三种发送模式：

| 模式 | 可靠性 | 性能 | 适用场景 |
|-----|-------|-----|---------|
| **同步发送** | 高 | 低 | 重要消息，必须成功 |
| **异步发送** | 中 | 中 | 对可靠性有要求但追求性能 |
| **单向发送** | 低 | 高 | 日志、监控等不关键消息 |

### 4. Consumer：消息终点站

Consumer 支持两种消费模式：

- **集群消费**：消息被一个 Consumer 消费，各 Consumer 均摊（默认）
- **广播消费**：每个 Consumer 都收到全量消息

---

## RocketMQ 的杀手锏

### 1. 事务消息

这是 RocketMQ 区别于 Kafka 的核心能力。

场景：下单时，需要同时「扣库存」和「发消息」。如果扣了库存但消息没发出去，就会出现「超卖」。

RocketMQ 的事务消息通过「半消息 + 回查机制」解决：

```java
// 1. 发送半消息（对 Consumer 不可见）
Message message = new Message("order-topic", order.toJson().getBytes());
TransactionSendResult result = producer.sendMessageInTransaction(message, order);

// 2. 执行本地事务（扣库存）
inventoryService.deduct(order.getItems());

// 3. 提交或回滚
if (success) {
    transaction.commit();  // 消息对 Consumer 可见
} else {
    transaction.rollback(); // 消息被丢弃
}

// 4. 如果状态未知，Broker 会回查
// 实现 checkLocalTransaction 方法查询数据库确认状态
```

### 2. 延迟消息

订单超时未支付自动取消，这是电商的常见需求。

RocketMQ 原生支持 18 个延迟等级：1s、5s、10s、30s、1m、2m……

```java
// 发送延迟消息：10 秒后检查支付状态
Message message = new Message("order-delay-topic", order.toJson().getBytes());
message.setDelayTimeLevel(3);  // 延迟等级 3 = 10 秒
rocketMQTemplate.send("order-delay-topic", message);
```

### 3. 顺序消息

同一订单的消息需要按顺序处理：创建 → 支付 → 发货 → 完成。

RocketMQ 支持两种顺序模式：

- **分区顺序**：同一订单的消息进入同一分区，分区内有序
- **全局顺序**：整个 Topic 只有一条队列，严格有序（性能差）

---

## 适用场景

```
✓ 电商核心链路（订单、库存、支付）
✓ 需要事务消息（本地事务 + 消息原子性）
✓ 需要延迟消息（订单超时取消）
✓ 需要顺序消息（同一订单的处理）
✓ 金融级可靠消息

✗ 大数据场景（选 Kafka）
✗ 简单任务队列（选 RabbitMQ）
✗ 超高吞吐量日志（选 Kafka）
```

---

## 内容导航

### 核心基础

- [RocketMQ 架构](/middleware/rocketmq/architecture)：NameServer、Broker、Producer、Consumer 详解
- [消息类型](/middleware/rocketmq/message-type)：普通消息、顺序消息、事务消息、延迟消息

### 高可用

- [高可用方案](/middleware/rocketmq/ha)：主从同步、DLeger 自动切换

### 高级特性

- [事务消息](/middleware/rocketmq/transaction)：半消息机制与事务回查
- [延迟消息](/middleware/rocketmq/delay-message)：延迟等级的原理与应用
- [顺序消息](/middleware/rocketmq/ordered-message)：分区顺序与全局顺序

### 面试与实践

- [选型对比](/middleware/rocketmq/compare)：RocketMQ vs Kafka vs RabbitMQ

---

## 下一步

想深入理解 RocketMQ 的某个方面？

- 想搞懂**架构设计**？从 [RocketMQ 架构](/middleware/rocketmq/architecture) 开始
- 想用**事务消息**？从 [事务消息](/middleware/rocketmq/transaction) 开始
- 想了解**选型**？从 [三大 MQ 对比](/middleware/rocketmq/compare) 开始
