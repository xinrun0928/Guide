# 消息队列核心概念：消息、Producer、Consumer、Broker、Topic、Partition、Group

你一定遇到过这种情况：系统 A 调用系统 B，耗时 500ms，但你明明只需要 B 返回最终结果，前置处理却要等 B 完成后才能继续。

这就是同步调用的痛点——**你的系统，被别人的系统拖慢了**。

消息队列，就是来解决这个问题的。

---

## 消息：传递的数据单元

消息是消息队列中传递的基本单位，可以理解为一张明信片：

```
┌─────────────────────────────────┐
│  寄件人: 系统A                    │
│  收件人: 消息队列                 │
│  ─────────────────────────────  │
│  内容（Payload）:                 │
│  {                               │
│    "orderId": "12345",           │
│    "amount": 99.9,               │
│    "userId": "u_001"             │
│  }                               │
│  ─────────────────────────────  │
│  元数据:                         │
│  • messageId: 唯一标识           │
│  • timestamp: 发送时间           │
│  • headers: 额外属性             │
│  • key: 分区路由键（可选）        │
└─────────────────────────────────┘
```

消息包含两部分：

- **Body（消息体）**：实际传输的数据
- **Metadata（元数据）**：消息的描述信息，如消息 ID、发送时间、优先级、延迟时间等

### 消息的生死周期

```
Producer 发送消息 → Broker 存储 → Consumer 消费 → 确认提交

                          ↓
                    可能经历：
                    • 重试（失败后重新投递）
                    • 死信（超过最大重试次数）
                    • 定时/延迟（等待特定时间投递）
```

---

## Producer：消息的生产者

Producer 就是消息的发送方。在订单系统中，下单服务就是 Producer。

```java
public class OrderProducer {

    private final KafkaTemplate&lt;String, OrderMessage&gt; kafkaTemplate;

    /**
     * 发送订单消息
     * 关键点：消息 key 决定了写入哪个分区
     */
    public void sendOrder(Order order) {
        OrderMessage message = new OrderMessage();
        message.setOrderId(order.getId());
        message.setAmount(order.getAmount());
        message.setUserId(order.getUserId());
        message.setCreateTime(System.currentTimeMillis());

        // 使用订单 ID 作为 key，确保同一订单的消息进入同一分区
        // 为什么要这样做？保证顺序性
        kafkaTemplate.send("order-topic", order.getId(), message);
    }
}
```

Producer 的核心职责：

1. **构造消息**：将业务数据封装为消息格式
2. **选择分区**：根据消息 key 或负载策略决定消息发往哪个分区
3. **处理响应**：同步等待或异步回调，处理发送成功/失败

### Producer 的可靠性级别

| 配置 | 说明 |
|-----|-----|
| `acks=0` | 发送即成功，不等待 Broker 确认（最快，可能丢消息） |
| `acks=1` | Leader 副本确认即成功（默认，性能与可靠性平衡） |
| `acks=all` | 所有 ISR 副本确认才成功（最可靠，性能最差） |

---

## Consumer：消息的消费者

Consumer 是消息的接收方。库存系统、物流系统、通知系统……它们都是 Consumer。

```java
public class OrderConsumer {

    private final KafkaConsumer&lt;String, OrderMessage&gt; consumer;

    /**
     * 消费订单消息
     * 关键点：手动提交 offset 保证消息不丢失
     */
    @KafkaListener(topics = "order-topic", groupId = "order-processor")
    public void consumeOrder(ConsumerRecord&lt;String, OrderMessage&gt; record) {
        OrderMessage message = record.value();
        log.info("收到订单消息: orderId={}", message.getOrderId());

        try {
            // 1. 处理业务逻辑：更新库存、触发物流等
            processOrder(message);

            // 2. 手动提交 offset，确保消息被真正处理后才提交
            // 如果这里提交了但业务处理失败，消息就丢了
            consumer.commitSync();

        } catch (Exception e) {
            log.error("处理订单失败: orderId={}", message.getOrderId(), e);
            // 抛出异常，让消息进入重试机制
            throw e;
        }
    }
}
```

Consumer 的两种消费模式：

1. **Push 模式**（RabbitMQ）：Broker 主动推送，实时性高，但容易压垮消费者
2. **Pull 模式**（Kafka）：Consumer 主动拉取，批量拉取提高吞吐，消费者可控

---

## Broker：消息队列的服务节点

Broker 是消息队列的核心服务进程，负责接收消息、存储消息、转发消息。

```
┌──────────────────────────────────────────────────────────────┐
│                        Broker 集群                           │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│  │   Broker 1  │    │   Broker 2  │    │   Broker 3  │      │
│  │  Leader     │    │  Follower   │    │  Follower   │      │
│  │  (读写)      │◄──►│  (热备)      │◄──►│  (热备)      │      │
│  └─────────────┘    └─────────────┘    └─────────────┘      │
└──────────────────────────────────────────────────────────────┘
```

Broker 的核心职责：

- **消息存储**：持久化消息到磁盘（或内存，取决于配置）
- **消息路由**：根据 Topic 和路由规则分发消息
- **副本同步**：多副本之间保持数据一致
- **分区管理**：管理分区的 Leader 选举、副本分配

---

## Topic：消息的分类主题

Topic（主题）是消息的逻辑分类容器。你可以理解为**食堂的窗口**——不同的菜（消息）放到不同的窗口（Topic）。

```
┌─────────────────────────────────────────────────────────────┐
│                      消息队列集群                            │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ order-topic │  │ user-topic  │  │ log-topic   │         │
│  │  订单消息    │  │  用户消息    │  │  日志消息    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

Producer 发送消息时指定 Topic，Consumer 订阅 Topic 来消费消息。

---

## Partition：Topic 的物理分区

Partition（分区）是 Topic 的物理分片。Kafka 中，一个 Topic 可以有多个 Partition，每个 Partition 都是一个有序的、不可变的消息序列。

```
order-topic (主题)
├── Partition 0  ─── [msg_001, msg_002, msg_005, ...]
├── Partition 1  ─── [msg_003, msg_004, msg_006, ...]
└── Partition 2  ─── [msg_007, msg_008, msg_009, ...]
```

### 分区的作用

1. **并行处理**：多个分区可以被不同的 Consumer 并行消费
2. **水平扩展**：增加分区数可以提升吞吐量
3. **分区有序**：同一分区内的消息是有序的

### 消息 key 与分区路由

```java
// Kafka 根据消息 key 的哈希值决定分区
// 相同 key 的消息一定会进入同一个分区
kafkaTemplate.send("order-topic", orderId, message);

// 如果不指定 key，消息会轮询发送到各个分区
kafkaTemplate.send("order-topic", message);  // key = null
```

---

## Consumer Group：消费组

Consumer Group（消费组）是一组 Consumer 的集合。同一个组内的 Consumer 共同消费一个 Topic 的消息，**每条消息只会被组内一个 Consumer 处理**。

```
┌─────────────────────────────────────────────────────────────┐
│                    order-topic                               │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │ Part 0  │  │ Part 1  │  │ Part 2  │  │ Part 3  │       │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘       │
└───────┼────────────┼────────────┼────────────┼─────────────┘
        │            │            │            │
        ▼            ▼            ▼            ▼
┌─────────────────────────────────────────────────────────────┐
│              Consumer Group A (订单处理组)                   │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐   │
│  │ Consumer 1    │  │ Consumer 2    │  │ Consumer 3    │   │
│  │ 消费 Part 0,1  │  │ 消费 Part 2   │  │ 消费 Part 3   │   │
│  └───────────────┘  └───────────────┘  └───────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 消费组的隔离性

不同消费组之间相互独立，同一条消息可以被多个组消费：

```
Topic: order-topic

Group A ────► 消费者 A1, A2 ────► 处理订单（业务逻辑）
Group B ────► 消费者 B1 ─────────► 发送通知（短信/邮件）
Group C ────► 消费者 C1 ─────────► 记录日志（审计追踪）
```

### 分区数与消费者数的关系

| 关系 | 结果 |
|-----|-----|
| 分区数 = 消费者数 | 每个消费者恰好消费一个分区（最佳状态） |
| 分区数 > 消费者数 | 部分消费者消费多个分区 |
| 分区数 < 消费者数 | 部分消费者处于空闲状态（浪费） |

> 所以，创建 Topic 时，**分区数决定了最大的并行消费能力**。

---

## 核心概念之间的关系

用一句话串联所有概念：

> **Producer 将消息发送到 Topic 的某个 Partition，Broker 负责存储，Consumer Group 中的 Consumer 负责消费，每条消息只会被同组的一个 Consumer 处理。**

```
Producer ──发送──► Topic ──路由到──► Partition
                    │
                    │存储
                    ▼
                  Broker（多副本）
                    │
                    │消费
                    ▼
              Consumer Group（负载均衡）
                    │
                    ▼
              Consumer（真正处理消息）
```

---

## 面试追问

**面试官可能会问：**

1. 如果一个 Consumer 挂了，同一个 Consumer Group 的其他 Consumer 是怎么接管分区的？
2. 消息 key 相同就一定能保证顺序吗？什么情况下会乱序？
3. 消费组内 Consumer 数量超过分区数会怎样？

这些问题的答案，都藏在消费组的 Rebalance 机制里。下一篇我们聊应用场景时，会再深入这个话题。
