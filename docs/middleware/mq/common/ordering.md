# 如何保证消息的顺序性？

你的系统遇到了这个问题：

用户下了两笔订单：先买 A 商品（orderId=1001），后买 B 商品（orderId=1002）。但库存系统先扣了 B 商品的库存，后扣了 A 商品的库存。结果库存扣减顺序和下单顺序不一致，可能导致库存为负。

这还只是小问题。想象一下金融交易、库存扣减这些场景——**乱序是灾难**。

---

## 为什么消息会乱序？

首先，我们要理解消息乱序是怎么发生的。

### 原因一：Producer 端并行发送

```java
// 两条消息同时发送
producer.send("topic", "orderId=1001", msg1);  // 发送请求 A
producer.send("topic", "orderId=1002", msg2);  // 发送请求 B

// 由于网络延迟不确定，B 可能先到达 Broker
// 原因：两条请求是并发的，TCP 传输不保证顺序
```

### 原因二：分区导致消息分散

```
Topic 有多个 Partition：
P0: [msg_1001, msg_1003, msg_1005]  ──► Consumer 1
P1: [msg_1002, msg_1004]            ──► Consumer 2

两个 Consumer 并行处理，谁先完成不一定
→ 1002 可能比 1001 先处理完成
```

### 原因三：Consumer 端并发消费

```java
@KafkaListener(topics = "order-topic")
public void consume(Message msg) {
    // 多个线程同时消费
    executor.submit(() -> process(msg));
}

// 同一个 Partition 的消息，被不同的线程并发处理
// Thread A 处理 msg_1001，Thread B 处理 msg_1002
// 如果 Thread B 运气好，先处理完了
```

### 原因四：重试机制打乱顺序

```
消息 1 处理失败，进入重试队列
消息 2 正常处理完成
消息 1 重试后到达消费者
→ 处理顺序变成了：2 -> 1
```

---

## 三个层次的顺序保证

顺序保证有三个层次，你需要明确你需要哪一层：

| 层次 | 定义 | 场景 |
|-----|-----|-----|
| **全局顺序** | 所有消息严格按发送顺序处理 | 金融交易（极少场景） |
| **分区顺序** | 同一分区内消息有序 | 订单处理（常见） |
| **消费者顺序** | 同一消费者内消息有序 | 任务队列 |

---

## 方案一：全局顺序——用单分区

全局顺序最简单，也最低效：**Topic 只有一个分区，所有消息都串行处理**。

```
Producer ──► Partition 0 ──► Consumer 1 ──► 顺序处理

所有消息排队，吞吐量 = 单消费者处理能力
```

### Kafka 实现

```java
// 创建 Topic 时指定 1 个分区
kafkaAdmin.createTopics(new NewTopic("order-topic", 1, (short) 1));

// 或者通过命令行
// kafka-topics.sh --create --topic order-topic --partitions 1 --replication-factor 3
```

### 代价

| 指标 | 单分区 | 多分区 |
|-----|-------|-------|
| 吞吐量 | 低（单消费者瓶颈） | 高（并行消费） |
| 扩展性 | 差（无法扩容） | 好 |
| 延迟 | 高（串行处理） | 低 |

> **全局顺序只适用于消息量极小的场景**，比如某些金融风控规则。绝大多数业务场景，我们追求的是「分区顺序」。

---

## 方案二：分区顺序——用消息 key路由

分区顺序的核心思想：**相同 key 的消息进入同一个分区，在分区内部有序**。

```
orderId=1001 ──hash("1001")──► Partition 0 ──► Consumer 1
orderId=1002 ──hash("1002")──► Partition 0 ──► Consumer 1
orderId=1003 ──hash("1003")──► Partition 1 ──► Consumer 2

同一订单的消息（相同 orderId）一定在同一个分区
```

### Kafka 实现

```java
public class OrderProducer {

    private final KafkaTemplate&lt;String, OrderMessage&gt; kafkaTemplate;

    /**
     * 发送订单消息
     * 关键：用订单 ID 作为 key，确保同一订单的消息进入同一分区
     */
    public void sendOrderMessage(Order order) {
        OrderMessage message = new OrderMessage();
        message.setOrderId(order.getId());
        message.setAction(order.getAction());  // "create", "pay", "cancel"
        message.setTimestamp(System.currentTimeMillis());

        // 关键：使用订单 ID 作为 key
        // Kafka 会根据 key 的 hash 值决定分区
        // 相同 key 一定进相同分区
        kafkaTemplate.send("order-topic", order.getId(), message);
    }
}
```

### 消费者处理

```java
@KafkaListener(topics = "order-topic", concurrency = "3")
public class OrderConsumer {

    /**
     * 消费订单消息
     * 注意：concurrency 必须 <= Partition 数量
     * 否则多出来的消费者会空闲
     */
    public void consumeOrder(ConsumerRecord&lt;String, OrderMessage&gt; record) {
        OrderMessage message = record.value();

        // 由于使用了相同的 orderId 作为 key
        // 同一订单的所有消息一定在同一个 Partition
        // 同一 Partition 内的消息是按写入顺序排列的
        // 所以这里的处理一定是顺序的

        switch (message.getAction()) {
            case "create":
                handleCreate(message);
                break;
            case "pay":
                handlePay(message);
                break;
            case "cancel":
                handleCancel(message);
                break;
        }
    }

    private void handleCreate(OrderMessage msg) {
        // 创建订单
    }

    private void handlePay(OrderMessage msg) {
        // 支付完成后处理
    }

    private void handleCancel(OrderMessage msg) {
        // 取消订单处理
    }
}
```

### 如何选择 key？

| 场景 | key 选择 | 说明 |
|-----|---------|-----|
| 订单处理 | orderId | 同一订单的消息必须有序 |
| 用户操作 | userId | 同一用户的操作有序 |
| 商品更新 | productId | 同一商品的消息有序 |
| 全局有序 | 固定值（如 "all"） | 所有消息进入同一分区 |

### 多分区顺序问题

分区数 > 消费者数 时：

```
Partitions: P0, P1, P2, P3
Consumers: C1, C2

分配关系：
P0, P1 ──► C1
P2, P3 ──► C2

如果同一订单的消息被错误分配到不同分区，就会乱序！

比如：
orderId=1001 的消息 hash 后进入 P1
orderId=1001 的另一条消息 hash 后进入 P2
→ 同一个订单的消息被不同消费者处理
→ 可能乱序
```

**解决：key 的选择必须确保相关的消息 hash 到同一个值**。

---

## 方案三：单 Consumer 处理单分区

即使消息在同一分区，消费者端并发处理也会打乱顺序。

```java
// 错误写法：多线程并发处理
@KafkaListener(topics = "order-topic")
public void consume(ConsumerRecord&lt;String, OrderMessage&gt; record) {
    // 多个线程同时处理同一个 Partition 的消息
    executor.submit(() -> process(record.value()));  // 乱序！
}
```

**正确做法：单线程顺序处理**

```java
// 正确写法：单线程处理
@Bean
public KafkaListenerContainerFactory&lt;ConcurrentMessageListenerContainer&lt;String, OrderMessage&gt;&gt;
        kafkaListenerContainerFactory() {
    ConcurrentKafkaListenerContainerFactory&lt;String, OrderMessage&gt; factory =
        new ConcurrentKafkaListenerContainerFactory&lt;&gt;();
    factory.setConcurrency(1);  // 关键：单线程处理
    factory.getContainerProperties().setAckMode(AckMode.MANUAL);
    return factory;
}

@KafkaListener(topics = "order-topic")
public void consumeOrder(ConsumerRecord&lt;String, OrderMessage&gt; record) {
    // 单线程处理，保证分区内的顺序
    processOrder(record.value());
    consumer.commitSync();
}
```

### 性能和顺序的权衡

| 配置 | 性能 | 顺序保证 |
|-----|-----|---------|
| 多分区 + 多线程 | 高 | 只保证分区顺序 |
| 单分区 + 多线程 | 中 | 仍可能乱序（并发处理） |
| 单分区 + 单线程 | 低 | 全局顺序 |

---

## 方案四：RocketMQ 的顺序消息

RocketMQ 原生支持顺序消息，提供了更方便的方式。

### 单分区顺序消息

```java
// 生产者：发送顺序消息
public class OrderProducer {

    private final RocketMQTemplate rocketMQTemplate;

    public void sendOrderMessage(Order order) {
        // 设置为顺序消息
        rocketMQTemplate.asyncSendOrderly(
            "order-topic",           // Topic
            order.getMessage(),      // 消息体
            order.getOrderId(),      // 顺序键（决定 Queue）
            new SendCallback() {
                @Override
                public void onSuccess(SendResult result) {
                    log.info("顺序消息发送成功");
                }

                @Override
                public void onException(Throwable e) {
                    log.error("顺序消息发送失败", e);
                }
            }
        );
    }
}

// 消费者：按顺序消费
@RocketMQMessageListener(
    topic = "order-topic",
    consumerGroup = "order-consumer-group",
    consumeMode = ConsumeMode.ORDERLY  // 关键：顺序消费模式
)
public class OrderConsumer implements RocketMQListener&lt;OrderMessage&gt; {

    @Override
    public void onMessage(OrderMessage message) {
        // RocketMQ 保证：同一 Queue 内的消息按顺序投递
        // 同一订单的消息被发送到同一个 Queue
        // 消费时，单线程顺序处理
        processOrder(message);
    }
}
```

### RocketMQ 的 Queue 分配

```
同一个 orderId 的消息 ──► 同一个 Queue（通过 hash(orderId) % queueNum）

同一 Queue 内的消息 ──► 单线程顺序处理

不同 Queue 之间 ──► 并行处理
```

---

## 实战：订单全流程顺序处理

下面是一个完整的订单场景，保证订单状态的流转顺序：

```
下单（create）──► 支付（pay）──► 发货（ship）──► 完成（complete）
                                    │
                              可能中断：取消（cancel）
```

```java
// 订单状态枚举
public enum OrderAction {
    CREATE,   // 创建订单
    PAY,      // 支付
    SHIP,     // 发货
    COMPLETE, // 完成
    CANCEL    // 取消
}

// 订单消息
public class OrderMessage {
    private String orderId;
    private OrderAction action;
    private Map&lt;String, Object&gt; data;
    private long timestamp;

    // 状态机校验：确保动作按顺序执行
    public boolean isValidNextAction(OrderAction nextAction) {
        return switch (this.action) {
            case CREATE -> nextAction == OrderAction.PAY || nextAction == OrderAction.CANCEL;
            case PAY -> nextAction == OrderAction.SHIP;
            case SHIP -> nextAction == OrderAction.COMPLETE;
            case COMPLETE, CANCEL -> false;  // 终态
        };
    }
}

// 消费者：严格的顺序处理 + 状态校验
@KafkaListener(
    topics = "order-topic",
    groupId = "order-processor",
    containerFactory = "singleThreadFactory"  // 单线程消费
)
public class OrderProcessor {

    private final Map&lt;String, OrderStatus&gt; orderStatusCache = new ConcurrentHashMap&lt;&gt;();

    public void processOrder(ConsumerRecord&lt;String, OrderMessage&gt; record) {
        OrderMessage message = record.value();
        String orderId = message.getOrderId();

        // 1. 获取当前状态
        OrderStatus current = orderStatusCache.get(orderId);

        // 2. 校验：确保动作合法
        if (current != null && !current.isValidNextAction(message.getAction())) {
            log.error("非法状态转换: orderId={}, current={}, next={}",
                orderId, current, message.getAction());
            throw new IllegalStateException("非法状态转换");
        }

        // 3. 执行业务逻辑
        switch (message.getAction()) {
            case CREATE -> handleCreate(orderId, message);
            case PAY -> handlePay(orderId, message);
            case SHIP -> handleShip(orderId, message);
            case COMPLETE -> handleComplete(orderId, message);
            case CANCEL -> handleCancel(orderId, message);
        }

        // 4. 更新状态
        orderStatusCache.put(orderId, OrderStatus.fromAction(message.getAction()));
    }
}
```

---

## 总结：顺序保证方案对比

| 方案 | 实现难度 | 吞吐量 | 适用场景 |
|-----|---------|-------|---------|
| 单分区 + 单消费者 | 简单 | 最低 | 金融交易（极少消息） |
| 多分区 + key 路由 | 中等 | 中等 | 业务消息（订单、用户操作） |
| 单分区 + 多消费者 | 不推荐 | 低 | 容易出错，不建议使用 |
| MQ 原生顺序消息 | 简单 | 中等 | RocketMQ 顺序消息 |

---

## 面试追问

**面试官可能会问：**

1. 「Kafka 的分区有序和全局有序有什么区别？」—— 分区有序只保证同分区有序，全局有序需要单分区
2. 「消费者端怎么保证顺序？」—— 单线程消费，或者使用 MQ 提供的顺序消费模式
3. 「重试导致的消息乱序怎么解决？」—— 使用消息版本号或状态机校验

顺序保证的本质是**在正确的地方、用正确的方式排队**。分区的选择是排队的第一步，消费者端的处理是排队的第二步。只有两步都做对，才能真正保证顺序。
