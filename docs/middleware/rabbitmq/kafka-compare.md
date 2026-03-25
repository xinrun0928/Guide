# RabbitMQ 与 Kafka 对比与选型

面试官问你：「你们项目里用的是 RabbitMQ，为什么不用 Kafka？」

你怎么回答？

很多人在这个问题上翻过车。要么只说得出「Kafka 吞吐量大」，要么根本分不清两者的核心区别。

今天我们就来好好聊聊这两个消息队列的差异，以及什么场景该选哪个。

## 一、先说结论

| 维度 | RabbitMQ | Kafka |
|------|----------|-------|
| 定位 | 消息代理（Message Broker） | 分布式流平台（Streaming Platform） |
| 核心能力 | 灵活路由、事务消息、死信队列 | 高吞吐、日志存储、事件溯源 |
| 吞吐量 | ~10万/秒 | ~100万/秒 |
| 消息延迟 | 低（微秒级） | 毫秒级 |
| 消息顺序 | 单队列内有序 | 分区内有序 |
| 消息持久化 | 队列存储 | 日志追加（更高效） |
| 消息回溯 | 不支持 | 支持（从 offset 回溯） |
| 消费模式 | 拉取（Pull） | 拉取（Pull） |
| 集群模式 | 镜像队列/仲裁队列 | 分区副本机制 |
| 死信队列 | 原生支持 | 需要自己实现 |

**一句话总结**：

- RabbitMQ 是**「智能路由中心」**——擅长灵活的路由、复杂的队列结构和精细的消息控制
- Kafka 是**「高速日志总线」**——擅长高吞吐、日志收集、事件流处理

## 二、架构差异

### RabbitMQ 的队列架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        RabbitMQ                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Producer                                                       │
│      │                                                          │
│      ▼                                                          │
│   Exchange ──── Binding ────▶ Queue ──── Consumer                 │
│                                                                  │
│   特点：                                                          │
│   - Exchange 负责路由                                            │
│   - Queue 存储消息                                               │
│   - Consumer 主动拉取                                            │
│                                                                  │
│   消息流程：Producer ─▶ Exchange ─▶ Queue ─▶ Consumer           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Kafka 的分区架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         Kafka                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Producer                                                       │
│      │                                                          │
│      ▼                                                          │
│   Topic ──── Partition 0 ──── Replica 1, 2, 3                   │
│      │    ──── Partition 1 ──── Replica 1, 2, 3               │
│      │    ──── Partition 2 ──── Replica 1, 2, 3               │
│                                                                  │
│   特点：                                                          │
│   - Topic 存储在 Partition                                       │
│   - 每个 Partition 是有序的日志文件                              │
│   - Consumer 通过 Offset消费                                     │
│   - 消息持久化到日志文件                                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 三、核心差异对比

### 1. 消息模型

**RabbitMQ**：Exchange + Queue 模型

```java
// RabbitMQ：灵活的路由
channel.exchangeDeclare("order.exchange", "topic", true);
channel.queueBind("email.queue", "order.exchange", "order.*");
channel.queueBind("sms.queue", "order.exchange", "order.paid");

// 同一个消息可以被多个队列接收
channel.basicPublish("order.exchange", "order.created", ...);
```

**Kafka**：基于 Topic + Partition 的发布订阅模型

```java
// Kafka：消息只会被一个分区接收
producer.send(new ProducerRecord&lt;String, String&gt;(
    "order-events",    // Topic
    orderId,           // Key（决定分区）
    "order created"    // Value
));

// Consumer 按 offset 消费
consumer.subscribe(Collections.singletonList("order-events"));
ConsumerRecords&lt;String, String&gt; records = consumer.poll(Duration.ofMillis(100));
for (ConsumerRecord&lt;String, String&gt; record : records) {
    System.out.println("offset=" + record.offset() + ", value=" + record.value());
}
```

### 2. 消费模式

**RabbitMQ**：支持两种消费模式

```java
// 推送（Push）：RabbitMQ 主动推送
channel.basicConsume("queue", false, callback);

// 拉取（Pull）：Consumer 主动拉取
GetResponse response = channel.basicGet("queue", false);
```

**Kafka**：只支持拉取（Pull）

```java
// Consumer 主动拉取，可以控制消费速率
while (true) {
    ConsumerRecords&lt;String, String&gt; records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord&lt;String, String&gt; record : records) {
        process(record);
    }
    consumer.commitSync();
}
```

### 3. 消息持久化

**RabbitMQ**：基于队列存储

```
Queue 是临时的、动态的数据结构
消息被消费后即删除（除非配置持久化）
```

**Kafka**：基于日志追加

```
Partition 是有序的、不可变的日志文件
消息被消费后不删除（可以配置保留时间）
支持从任意 offset 重新消费
```

### 4. 消息回溯

**RabbitMQ**：不支持消息回溯

```
消息被 ACK 后就删除了
如果 Consumer 需要重新处理历史消息，必须重新发送
```

**Kafka**：支持从任意 offset 消费

```java
// 从头开始消费
consumer.seekToBeginning(TopicPartition);

// 从指定 offset 消费
consumer.seek(new TopicPartition("order-events", 0), 100);

// 跳过已消费消息，从最新消息开始
consumer.seekToEnd(TopicPartition);
```

## 四、性能差异

### 吞吐量对比

| 指标 | RabbitMQ | Kafka |
|------|----------|-------|
| 单机吞吐量 | ~10万/秒 | ~100万/秒 |
| 消息延迟 | < 1ms | 2-5ms |
| 副本同步 | 主从同步 | ISR 机制 |
| 顺序消费 | 单队列内有序 | 单分区内有序 |

### Kafka 高性能的原因

1. **顺序写入**：Kafka 使用追加写磁盘，顺序 I/O 性能接近内存
2. **零拷贝**：使用 Linux 的 sendfile 系统调用，避免内核态和用户态切换
3. **批量处理**：消息批量发送、批量压缩
4. **分区并行**：通过分区实现水平扩展

```java
// Kafka 批量发送示例
producerProps.put("batch.size", 16384);      // 批量大小
producerProps.put("linger.ms", 10);          // 等待时间
producerProps.put("buffer.memory", 33554432); // 缓冲区大小

// 批量消费示例
consumerProps.put("fetch.min.bytes", 1024);      // 最小拉取字节
consumerProps.put("fetch.max.wait.ms", 500);     // 最大等待时间
```

## 五、适用场景对比

### RabbitMQ 适用场景

| 场景 | 原因 |
|------|------|
| 复杂路由 | Exchange + Binding 路由灵活 |
| 事务消息 | 支持本地事务和消息确认 |
| 死信队列 | 原生支持 DLX |
| 延迟队列 | 支持 TTL 和延迟插件 |
| 小规模消息 | 延迟敏感的应用 |
| 优先级队列 | 支持消息优先级 |

**典型业务场景**：

- 订单系统：订单创建 → 支付 → 发货 → 物流（多步骤、复杂路由）
- 异步任务：邮件发送、短信通知（需要重试、死信）
- RPC 通信：请求-响应模式

### Kafka 适用场景

| 场景 | 原因 |
|------|------|
| 日志收集 | 高吞吐、支持回溯 |
| 事件流 | 事件溯源、CDC |
| 大数据管道 | 与 Spark、Flink 生态集成 |
| 实时分析 | 流处理、聚合统计 |
| 消息审计 | 保留历史、不可变性 |

**典型业务场景**：

- 用户行为分析：点击、浏览、收藏、购买
- 日志聚合：系统日志、应用日志收集
- 订单事件流：订单全生命周期事件
- 数据同步：数据库 CDC 变更捕获

## 六、代码对比

### RabbitMQ 生产者

```java
// RabbitMQ 发送消息
public void sendOrderMessage(String orderId) throws Exception {
    // 开启 Confirm
    channel.confirmSelect();

    // 发送消息
    channel.basicPublish(
        "order.exchange",
        "order.created",
        MessageProperties.PERSISTENT_TEXT_PLAIN,
        orderId.getBytes()
    );

    // 等待确认
    channel.waitForConfirmsOrDie(5, TimeUnit.SECONDS);
}
```

### Kafka 生产者

```java
// Kafka 发送消息
public void sendOrderMessage(String orderId) throws Exception {
    // 发送消息（异步）
    producer.send(new ProducerRecord&lt;String, String&gt;(
        "order-events",
        orderId,
        "order created: " + orderId
    ), (metadata, exception) -> {
        if (exception != null) {
            // 发送失败处理
            handleFailure(orderId, exception);
        } else {
            // 发送成功
            System.out.println("Sent to partition " + metadata.partition());
        }
    });
}
```

### RabbitMQ 消费者

```java
// RabbitMQ 消费消息
@RabbitListener(queues = "order.queue")
public void processOrder(Message message, Channel channel) throws IOException {
    long deliveryTag = message.getMessageProperties().getDeliveryTag();

    try {
        String orderId = new String(message.getBody());
        doProcess(orderId);
        channel.basicAck(deliveryTag, false);
    } catch (Exception e) {
        // 失败重试 3 次
        if (shouldRetry(message)) {
            channel.basicNack(deliveryTag, false, true);
        } else {
            // 进入死信队列
            channel.basicNack(deliveryTag, false, false);
        }
    }
}
```

### Kafka 消费者

```java
// Kafka 消费消息
@KafkaListener(topics = "order-events", groupId = "order-processor")
public void processOrder(ConsumerRecord&lt;String, String&gt; record) {
    try {
        String orderId = record.key();
        String event = record.value();
        doProcess(orderId, event);
    } catch (Exception e) {
        // Kafka 没有死信队列概念，需要自己实现
        handleFailure(record.topic(), record.partition(), record.offset(), e);
    }
}
```

## 七、选型决策树

```
                        ┌─────────────────────────┐
                        │      消息队列选型         │
                        └───────────┬─────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
              需要高吞吐？                    需要复杂路由？
                    │                               │
         ┌─────────┴─────────┐             ┌───────┴───────┐
         │                   │             │               │
        是                  否             是              否
         │                   │             │               │
         ▼                   ▼             ▼               ▼
    ┌─────────┐       ┌─────────┐     ┌─────────┐     ┌─────────┐
    │  Kafka  │       │需要事务？│     │ RabbitMQ│     │  Kafka  │
    └─────────┘       └────┬────┘     └─────────┘     └─────────┘
                           │                    │
                    ┌──────┴──────┐              ▼
                    │             │         ┌─────────┐
                  是              否         │需要延迟 │
                    │             │         │队列？   │
                    ▼             ▼         └────┬────┘
              ┌───────────┐  ┌─────────┐        │
              │ RabbitMQ  │  │  Kafka   │      是   否
              │(事务消息)  │  │          │        │    │
              └───────────┘  └─────────┘        ▼    ▼
                                             ┌───┐ ┌─────┐
                                             │RabbitMQ││Kafka│
                                             └───┘ └─────┘
```

## 八、常见误区

### 误区一：Kafka 比 RabbitMQ 更好

**错误**。两者定位不同，没有绝对的好坏：

- Kafka 适合**日志、大数据、流处理**
- RabbitMQ 适合**业务消息、复杂路由、微服务集成**

### 误区二：RabbitMQ 吞吐量低不能用

**错误**。RabbitMQ 的吞吐量对于大多数业务系统来说足够了：

- 日活 100 万的应用，消息量约 1000 万/天
- 平均 QPS 约 100，峰值可能 1000
- RabbitMQ 完全能处理

### 误区三：Kafka 不能保证消息不丢

**错误**。Kafka 可以配置到**Exactly Once**语义：

```java
// 配置幂等生产者
producerProps.put("enable.idempotence", true);
producerProps.put("acks", "all");           // 所有副本确认
producerProps.put("retries", Integer.MAX_VALUE);

// 事务消息
producer.initTransactions();
producer.beginTransaction();
producer.send(new ProducerRecord&lt;&gt;("topic", "key", "value"));
producer.commitTransaction();
```

## 九、面试加分回答

当被问到「RabbitMQ 和 Kafka 怎么选」时，可以这样回答：

> 两者定位不同：
>
> **RabbitMQ** 是一个智能的消息代理，核心优势是灵活的路由（Exchange + Binding）、丰富的高级特性（死信队列、延迟队列、事务消息）。适合业务消息场景，特别是有多步骤流程、复杂路由需求、对消息可靠性要求高的系统。
>
> **Kafka** 是一个高性能的分布式流平台，核心优势是超高吞吐、日志持久化、事件回溯。适合大数据场景（日志收集、实时分析）、需要处理海量数据的系统。
>
> 选型建议是：
>
> - 如果是**业务系统**（订单、支付、用户通知），优先选 RabbitMQ
> - 如果是**数据系统**（日志收集、行为分析、事件流），优先选 Kafka
> - 如果两者都有，可以同时使用，用 Kafka 做数据管道，RabbitMQ 做业务消息

---

另一个经典问题是：「RabbitMQ 怎么保证消息不丢？」

这个问题在之前的文档里已经详细讲过了。从生产者端（Confirm 机制）、Broker 端（持久化）、消费者端（手动 ACK）三个环节确保消息可靠性。

完整的 RabbitMQ 知识体系已经讲完了。如果你想系统复习，可以从[RabbitMQ 核心概念](/middleware/rabbitmq/core-concept)开始，一路学到高可用。

或者，如果你更关心面试高频问题，可以直接看下一节——[RabbitMQ 面试高频问题汇总](/middleware/rabbitmq/interview-summary)。
