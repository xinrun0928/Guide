# RabbitMQ 消费端确认：ACK 与 NACK

消息终于到达消费者了。

但这只是开始——**消息被消费者收到，不代表业务逻辑执行成功了**。

如果消费者处理到一半突然宕机了怎么办？如果业务逻辑抛出了异常怎么办？这条消息是应该重新投递，还是直接丢弃？

ACK（确认）和 NACK（拒绝）机制，就是来解决这个问题的。

## 一、为什么需要手动确认？

RabbitMQ 有两种确认模式：

| 模式 | 说明 | 风险 |
|------|------|------|
| 自动确认（autoAck=true） | 消息投递给消费者后立即删除 | 消费者宕机，消息永久丢失 |
| 手动确认（autoAck=false） | 消费者处理完成后手动告知 Broker | 处理失败可以重试 |

```
场景：消费者收到消息后开始处理，处理到一半宕机了

自动确认：
  消息已投递给消费者 ───▶ Broker 删除消息 ───▶ 宕机 ───▶ 消息丢失 ❌

手动确认：
  消息已投递给消费者 ───▶ 处理中 ───▶ 宕机 ───▶ 未确认 ───▶ 消息重新投递 ✓
```

对于关键业务消息，**永远使用手动确认**：

```java
// 错误：自动确认，消息可能丢失
channel.basicConsume("order.queue", true, callback);

// 正确：手动确认，确保处理成功后再确认
channel.basicConsume("order.queue", false, callback);
```

## 二、ACK 的三种类型

RabbitMQ 提供了三种确认方式：

| 类型 | 方法 | 效果 |
|------|------|------|
| ACK | basicAck | 确认消息已成功处理 |
| NACK | basicNack | 拒绝消息，可选择是否重新入队 |
| REJECT | basicReject | 拒绝消息，效果同 NACK |

```java
// 获取投递信息
DeliverCallback deliverCallback = (consumerTag, delivery) -> {
    String message = new String(delivery.getBody());
    long deliveryTag = delivery.getEnvelope().getDeliveryTag();

    try {
        // 业务逻辑处理
        processOrder(message);

        // 成功：发送 ACK
        channel.basicAck(deliveryTag, false);
        System.out.println("消息处理成功: " + message);

    } catch (Exception e) {
        // 失败：根据情况选择处理方式
        handleFailure(deliveryTag, delivery, e);
    }
};

private void handleFailure(long deliveryTag, Envelope envelope, Exception e) {
    // NACK 的三个参数：deliveryTag, multiple, requeue
    // multiple: 是否批量确认（true = 确认所有小于等于 deliveryTag 的消息）
    // requeue: 是否重新入队

    // 方式 1：重新入队，让其他消费者处理
    // channel.basicNack(deliveryTag, false, true);

    // 方式 2：拒绝并丢弃（或者进入死信队列）
    // channel.basicNack(deliveryTag, false, false);

    // 方式 3：使用 reject（只能拒绝，不能重新入队）
    // channel.basicReject(deliveryTag, false);

    // 实际场景：最多重试 3 次，超过次数后进入死信队列
    int retryCount = getRetryCount(envelope);
    if (retryCount < 3) {
        // 增加重试次数，重新入队
        incrementRetryCount(envelope);
        channel.basicNack(deliveryTag, false, true);
    } else {
        // 超过重试次数，拒绝并发送死信队列
        channel.basicNack(deliveryTag, false, false);
    }
}
```

## 三、NACK vs REJECT

两者的区别很小：

| 方法 | requeue 参数 | 多次拒绝 |
|------|-------------|---------|
| basicReject | 支持 | 不能多次拒绝同一消息 |
| basicNack | 支持 | 可以批量拒绝（multiple=true） |

```java
// basicReject：单条拒绝
channel.basicReject(deliveryTag, true);  // true = 重新入队

// basicNack：可以批量拒绝
channel.basicNack(deliveryTag, true, false);
// 第二个参数 true = multiple：拒绝所有 deliveryTag 之前未确认的消息
// 第三个参数 false = requeue：不再重新入队
```

## 四、消费端限流：Prefetch

如果消费者处理速度不一致，可能会出现：

- 快的消费者一下拿走了所有消息，忙死
- 慢的消费者空转等待，闲死

Prefetch（预取）机制就是来解决这个问题的。

```
未设置 Prefetch：
┌──────────────────────────────────────────────────────────────┐
│  Queue                                                        │
│  [msg1][msg2][msg3][msg4][msg5][msg6][msg7][msg8][msg9][msg10]│
│                                                               │
│  Consumer A ─────────────────────────▶ 拿走了 10 条          │
│  Consumer B ─────────────────────────▶ 只能排队等下一批       │
└──────────────────────────────────────────────────────────────┘

设置 Prefetch = 2：
┌──────────────────────────────────────────────────────────────┐
│  Queue                                                        │
│  [msg1][msg2][msg3][msg4][msg5][msg6][msg7][msg8][msg9][msg10]│
│                                                               │
│  Consumer A ───────────────▶ 拿 2 条，处理完再拿             │
│  Consumer B ───────────────▶ 拿 2 条，处理完再拿             │
└──────────────────────────────────────────────────────────────┘
```

```java
// 设置 prefetch = 1：消费者必须处理完当前消息才能拿到下一条
channel.basicQos(1);

// 设置 prefetch = 10：最多预取 10 条消息
channel.basicQos(10);

// prefetch = 0：不限制（可能造成消费者负载不均）
channel.basicQos(0);
```

### 合理的 Prefetch 设置

| 场景 | 建议值 | 原因 |
|------|-------|------|
| 消息处理耗时长 | 1 | 确保有足够资源处理每条消息 |
| 消息处理快 | 10-50 | 减少网络开销，提高吞吐量 |
| 批量处理 | 100+ | 适合攒批处理场景 |
| 无特殊要求 | 10-20 | 平衡吞吐量和响应时间 |

```java
// Spring Boot 配置
@Bean
public SimpleRabbitListenerContainerFactory rabbitListenerContainerFactory(
        ConnectionFactory connectionFactory) {
    SimpleRabbitListenerContainerFactory factory =
        new SimpleRabbitListenerContainerFactory();
    factory.setConnectionFactory(connectionFactory);
    factory.setConcurrentConsumers(3);
    factory.setMaxConcurrentConsumers(10);
    factory.setPrefetchCount(10);  // 关键参数
    return factory;
}
```

## 五、重试机制设计

消费失败后如何重试？这里有几种常见策略：

### 策略一：无限重试（不推荐）

```java
// 每次失败都重新入队
channel.basicNack(deliveryTag, false, true);  // requeue = true
```

问题：可能造成消息无限循环，消耗 Broker 资源。

### 策略二：有限次数重试 + 死信队列

```java
// 使用消息头记录重试次数
Map&lt;String, Object&gt; headers = delivery.getProperties().getHeaders();
int retryCount = headers.containsKey("x-retry-count")
    ? (int) headers.get("x-retry-count") : 0;

if (retryCount < 3) {
    // 增加重试次数，延迟后重新入队
    headers.put("x-retry-count", retryCount + 1);
    // 这里需要配合延迟队列实现延迟重试
    channel.basicNack(deliveryTag, false, true);
} else {
    // 超过重试次数，拒绝进入死信队列
    channel.basicNack(deliveryTag, false, false);
}
```

### 策略三：本地重试 + 死信队列

实际生产环境，推荐这种方案：

```java
@Service
public class OrderConsumer {

    private static final int MAX_RETRY = 3;

    @RabbitListener(queues = "order.queue")
    public void processOrder(Message message, Channel channel) throws IOException {
        long deliveryTag = message.getMessageProperties().getDeliveryTag();

        try {
            String orderId = new String(message.getBody());
            doProcess(orderId);
            channel.basicAck(deliveryTag, false);

        } catch (Exception e) {
            Integer retryCount = getRetryCount(message);

            if (retryCount < MAX_RETRY) {
                // 记录日志，本地重试
                log.warn("处理失败，将重试: retry={}", retryCount + 1);
                // 本地重试机制（定时任务）
                orderService.scheduleRetry(message, retryCount + 1);
                channel.basicAck(deliveryTag, false);  // 先 ACK，防止重复投递
            } else {
                // 超过重试次数，进入死信队列
                log.error("处理失败次数过多，发送到死信队列");
                channel.basicNack(deliveryTag, false, false);
            }
        }
    }

    private Integer getRetryCount(Message message) {
        Map&lt;String, Object&gt; headers = message.getMessageProperties().getHeaders();
        return headers.containsKey("x-retry-count")
            ? (Integer) headers.get("x-retry-count") : 0;
    }
}
```

## 六、幂等性处理

无论消息投递几次，消费者的结果都是一样的。这就是幂等性。

为什么要考虑幂等性？因为消息可能重复投递：

```
消息重复场景：

1. Consumer 处理成功，发送 ACK 时网络中断
   ──▶ Broker 未收到 ACK
   ──▶ Broker 重新投递消息
   ──▶ 消费者收到重复消息

2. RabbitMQ 集群故障转移
   ──▶ 消息被投递到另一个节点
   ──▶ 两个消费者同时收到相同消息
```

### 常见的幂等处理方式

**1. 数据库唯一索引**

```java
public void processOrder(String orderId) {
    try {
        // 使用订单 ID 作为唯一索引，防止重复插入
        orderMapper.insert(new Order(orderId, "已处理"));
    } catch (DuplicateKeyException e) {
        // 重复消息，忽略
        log.info("订单 {} 已处理，跳过", orderId);
    }
}
```

**2. 分布式锁**

```java
public void processOrder(String orderId) {
    String lockKey = "order:process:" + orderId;
    try {
        // 获取分布式锁，确保同一订单不会被并发处理
        if (redisLock.tryLock(lockKey, 30, TimeUnit.SECONDS)) {
            // 处理订单逻辑
            doProcess(orderId);
        }
    } finally {
        redisLock.unlock(lockKey);
    }
}
```

**3. 消息幂等表**

```java
public void processOrder(String messageId, String orderId) {
    // 检查消息是否已处理
    if (idempotentMapper.exists(messageId)) {
        log.info("消息 {} 已处理，跳过", messageId);
        return;
    }

    // 业务处理
    doProcess(orderId);

    // 标记消息已处理
    idempotentMapper.insert(new IdempotentRecord(messageId));
}
```

## 七、手动确认完整示例

```java
public class OrderMessageConsumer {

    private final Channel channel;

    public OrderMessageConsumer(Channel channel) {
        this.channel = channel;
    }

    public void startConsuming() throws IOException {
        // 设置 prefetch，避免消费者负载不均
        channel.basicQos(10);

        // 消费消息，手动确认
        channel.basicConsume("order.queue", false, new DeliverCallback() {

            @Override
            public void handle(String consumerTag, Delivery delivery) throws IOException {
                String message = new String(delivery.getBody());
                long deliveryTag = delivery.getEnvelope().getDeliveryTag();

                try {
                    // 1. 解析消息
                    OrderMessage orderMessage = parseMessage(message);

                    // 2. 业务处理
                    processOrder(orderMessage);

                    // 3. 成功确认
                    channel.basicAck(deliveryTag, false);

                } catch (JsonParseException e) {
                    // JSON 解析失败，消息格式错误，无法重试，直接拒绝
                    log.error("消息格式错误，拒绝: {}", message);
                    channel.basicReject(deliveryTag, false);

                } catch (BusinessException e) {
                    // 业务异常，根据情况重试或拒绝
                    handleBusinessException(deliveryTag, message, e);

                } catch (Exception e) {
                    // 其他异常，尝试重试
                    handleUnexpectedException(deliveryTag, message, e);
                }
            }
        }, consumerTag -> {
            log.warn("消费者被取消: {}", consumerTag);
        });
    }

    private void handleBusinessException(long deliveryTag, String message,
                                         BusinessException e) throws IOException {
        if (e.isRetryable()) {
            // 业务异常可以重试，重新入队
            log.warn("业务异常，将重试: {}", e.getMessage());
            channel.basicNack(deliveryTag, false, true);
        } else {
            // 业务异常不可重试，拒绝进入死信队列
            log.error("业务异常，拒绝进入死信队列: {}", e.getMessage());
            channel.basicNack(deliveryTag, false, false);
        }
    }

    private void handleUnexpectedException(long deliveryTag, String message,
                                            Exception e) throws IOException {
        log.error("处理消息异常: {}", message, e);
        // 系统异常，重新入队尝试恢复
        channel.basicNack(deliveryTag, false, true);
    }
}
```

## 八、面试追问

### 如果消息处理成功了，但发送 ACK 时网络断开了怎么办？

这是个经典的边界问题：

1. **Consumer 发送 ACK 时网络断开**：
   - Broker 收不到 ACK
   - 消息会保持 unacked 状态
   - 当 Consumer 连接断开时，这些消息会被重新投递给其他 Consumer

2. **Consumer 成功处理消息后，连接意外断开**：
   - 如果是自动确认（autoAck=true），消息已被删除
   - 如果是手动确认，消息会重新投递

所以**手动确认模式下，消息最多被投递一次以上**，这就是为什么需要幂等性处理。

### 消息的 unacked 状态会一直保持吗？

不会。当 Consumer 连接断开时，所有 unacked 的消息会被重新投递。

这是 RabbitMQ 的保护机制：确保消息不会因为网络问题而丢失。

```
Consumer 进程崩溃：

消息 1 ──── ACK ────────────────────────▶ Broker 删除消息
消息 2 ──── 处理中... ──── 崩溃 ──── 未确认 ────▶ 重新投递
消息 3 ──── 处理中... ──── 崩溃 ──── 未确认 ────▶ 重新投递
```

---

下一个问题留给你：

现在我们知道了消息发送和消费两端的可靠性机制。但还有一个关键问题：**Broker 重启后，消息还在吗？**

如果服务器断电了，你的消息会丢失吗？

这取决于你是否正确配置了持久化。下一节——[消息持久化](/middleware/rabbitmq/persistence)会详细讲解。
