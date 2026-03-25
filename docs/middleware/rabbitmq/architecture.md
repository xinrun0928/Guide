# RabbitMQ 架构：Producer → Exchange → Binding → Queue → Consumer

凌晨 3 点，你被电话吵醒：订单系统的消息处理延迟了 10 分钟。

你登录服务器，发现 RabbitMQ 的队列堆积了上万条消息。消费者明明在运行，为什么消息没有被消费？

这就是今天要聊的问题：RabbitMQ 的完整消息流转是什么样的？每一步可能出现什么问题？

## 一、消息的完整生命周期

一条消息从诞生到被消费，要经历六个阶段：

```
Producer ──①──▶ Exchange ──②──▶ Binding ──③──▶ Queue ──④──▶ Consumer
                                                      │
                                                      ▼
                                                 ⑤ ACK/NACK
                                                      │
                                                      ▼
                                                 ⑥ 消息删除/重入
```

| 阶段 | 组件 | 说明 |
|------|------|------|
| ① | Producer | 生产者发送消息到 Exchange |
| ② | Exchange | 交换机根据类型和路由键决定消息去哪个队列 |
| ③ | Binding | 绑定关系，决定 Exchange 和 Queue 的连接规则 |
| ④ | Queue | 消息存储，等待消费者拉取 |
| ⑤ | Consumer | 消费者从队列拉取消息并处理 |
| ⑥ | ACK/NACK | 消费者确认消息处理结果 |

## 二、生产者端：消息发送的"前半程"

### Connection 和 Channel

在 RabbitMQ 中，连接（Connection）和通道（Channel）是两个核心概念：

```
                    ┌──────────────────┐
                    │     Client       │
                    └────────┬─────────┘
                             │ Connection (TCP 连接)
                             │  通常只需要建立一次
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
    ┌─────────┐         ┌─────────┐         ┌─────────┐
    │Channel 1│         │Channel 2│         │Channel 3│
    └─────────┘         └─────────┘         └─────────┘
      生产消息            消费消息           声明队列
```

- **Connection**：TCP 连接，与 RabbitMQ Broker 建立长连接。建立连接的成本较高。
- **Channel**：逻辑通道，建立在一个 Connection 之上。AMQP 协议规定，多个 Channel 共享一个 Connection。

为什么要这么设计？因为 TCP 连接建立的成本很高，但建立 Channel 几乎零成本。通过复用 Connection，创建多个 Channel，可以大大提高并发能力。

```java
// 创建一个 Connection
Connection connection = factory.newConnection();

// 创建多个 Channel（通道）
Channel channel1 = connection.createChannel();  // 用于发送
Channel channel2 = connection.createChannel();  // 用于消费
Channel channel3 = connection.createChannel();  // 用于声明队列
```

### 消息发送流程

```java
public void sendOrderMessage(String orderId) throws Exception {
    // 1. 确保交换机存在
    channel.exchangeDeclare("order.exchange", "direct", true);

    // 2. 发送消息
    // mandatory = true: 如果消息无法路由，触发 ReturnListener
    channel.basicPublish(
        "order.exchange",      // 交换机名称
        "order.created",       // 路由键
        MessageProperties.PERSISTENT_TEXT_PLAIN,  // 持久化配置
        orderId.getBytes()     // 消息体
    );
}
```

## 三、Broker 端：消息的"分拣中心"

### Exchange 的路由决策

交换机收到消息后，根据自己的类型和绑定规则，决定把消息送到哪些队列：

```
                    ┌──────────────────┐
                    │  order.exchange  │
                    │     (direct)     │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
         routingKey      routingKey      routingKey
         "order.created"  "order.created"  "order.created"
              │              │              │
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ email    │  │ sms      │  │ callback │
        │ .queue   │  │ .queue   │  │ .queue   │
        └──────────┘  └──────────┘  └──────────┘

Direct 交换机：精确匹配路由键，所有匹配的队列都收到消息
```

### Queue 的消息存储

消息到达队列后，不是立即发送给消费者，而是等待消费者来拉取。

RabbitMQ 使用「轮询分发」（Round-robin dispatch）策略：

```java
// 消费者代码
channel.basicConsume("order.queue", false, deliverCallback, cancelCallback);

@Bean
public SimpleRabbitListenerContainerFactory rabbitListenerContainerFactory() {
    SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
    factory.setConnectionFactory(connectionFactory);
    factory.setConcurrentConsumers(3);  // 最小消费者数
    factory.setMaxConcurrentConsumers(10);  // 最大消费者数
    // prefetch 用于限流：每次预取多少条消息
    factory.setPrefetchCount(10);
    return factory;
}
```

关键参数：

| 参数 | 说明 |
|------|------|
| concurrentConsumers | 同时运行的消费者数量 |
| maxConcurrentConsumers | 最大消费者数量 |
| prefetchCount | 每次预取的消息数量，控制消费者负载 |

## 四、消费者端：消息的"终点"

### 两种消费模式

RabbitMQ 支持两种消费模式：

**1. 推（Push）模式**：RabbitMQ 主动将消息推送给消费者

```java
// 推模式：设置回调，消息到达自动推送
channel.basicConsume(
    "order.queue",
    false,  // autoAck: false 表示手动确认
    (consumerTag, delivery) -> {
        String message = new String(delivery.getBody());
        try {
            processOrder(message);
            channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
        } catch (Exception e) {
            // 处理失败，拒绝消息
            channel.basicNack(delivery.getEnvelope().getDeliveryTag(), false, true);
        }
    },
    consumerTag -> {}
);
```

**2. 拉（Pull）模式**：消费者主动从队列拉取消息

```java
// 拉模式：手动控制拉取节奏
GetResponse response = channel.basicGet("order.queue", false);
if (response != null) {
    String message = new String(response.getBody());
    try {
        processOrder(message);
        channel.basicAck(response.getEnvelope().getDeliveryTag(), false);
    } catch (Exception e) {
        // 处理失败，重新入队
        channel.basicNack(response.getEnvelope().getDeliveryTag(), false, true);
    }
}
```

### 手动确认 vs 自动确认

| 模式 | 说明 | 风险 |
|------|------|------|
| autoAck = true | 消息投递给消费者后立即删除 | 消费者处理失败，消息永久丢失 |
| autoAck = false | 消费者处理完成后手动确认 | 处理失败可以重试，但占用内存 |

```java
// 错误示例：autoAck = true，消息可能丢失
channel.basicConsume("queue", true, callback);

// 正确示例：手动确认，确保消息处理成功后再删除
channel.basicConsume("queue", false, callback);
```

## 五、消息流转异常处理

### 消息无法路由

当交换机找不到匹配的队列时：

```
channel.basicPublish() 的 mandatory 参数：
- false：消息直接丢弃
- true：触发 ReturnListener 回调
```

```java
// 设置 ReturnListener 捕获无法路由的消息
channel.addReturnListener((replyCode, replyText, exchange,
                            routingKey, properties, body) -> {
    // 记录日志或发送到死信队列
    log.warn("消息无法路由到队列: exchange={}, routingKey={}",
             exchange, routingKey);
});
```

### 消费者处理失败

消费者处理失败时，有两个选择：

```java
// NACK 的第三个参数 requeue：
// - true：消息重新入队，消费者会再次收到
// - false：消息发送到死信队列或直接丢弃

// 重试 3 次后再失败才进入死信队列
channel.basicNack(deliveryTag, false, false);
```

### 死信队列

当消息被拒绝、队列达到 TTL、或者消息超过最大长度时，会进入死信队列（DLX）：

```java
// 声明带死信队列的队列
Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
args.put("x-dead-letter-exchange", "dlx.exchange");  // 死信交换机
args.put("x-dead-letter-routing-key", "dlx.order"); // 死信路由键
channel.queueDeclare("order.queue", true, false, false, args);

// 声明死信队列
channel.queueDeclare("dead.order.queue", true, false, false, null);
channel.queueBind("dead.order.queue", "dlx.exchange", "dlx.order");
```

完整的消息生命周期（含死信）：

```
                    ┌──────────────────┐
                    │     Exchange      │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │      Queue       │
                    │                  │
                    │  消息处理失败 ────▶│ NACK + requeue
                    │        │         │
                    │        ▼         │
                    │  消息过期/被拒绝   │
                    │        │         │
                    │        ▼         │
                    │  Dead Letter Exchange
                    │        │         │
                    │        ▼         │
                    │   Dead Letter Queue
                    └──────────────────┘
```

## 六、完整架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              RabbitMQ Broker                             │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                        Virtual Host                             │    │
│  │                                                                   │    │
│  │   ┌─────────────┐         ┌─────────────────────────────────┐   │    │
│  │   │  Exchange    │────────▶│            Queue                 │   │    │
│  │   │              │         │                                 │   │    │
│  │   │  - name      │  Binding │  - name                         │   │    │
│  │   │  - type      │  (key)   │  - durable                      │   │    │
│  │   │  - durable   │         │  - exclusive                     │   │    │
│  │   │              │         │  - autoDelete                    │   │    │
│  │   └─────────────┘         │  - arguments                     │   │    │
│  │                            └─────────────────────────────────┘   │    │
│  │                                       │                          │    │
│  │                                       │                          │    │
│  │                                       ▼                          │    │
│  │                              ┌─────────────┐                      │    │
│  │                              │  Consumer   │                      │    │
│  │                              │  (Channel)  │                      │    │
│  │                              └─────────────┘                      │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
         ▲                                    │
         │                                    │
    ┌────┴────┐                          ┌───┴─────┐
    │Producer │                          │Consumer │
    └─────────┘                          └─────────┘
```

## 七、性能影响因素

消息流转过程中，哪些环节可能成为瓶颈？

| 环节 | 瓶颈因素 | 优化方向 |
|------|---------|---------|
| 生产者 | 网络延迟、Exchange 路由 | 批量发送、异步发送 |
| Queue | 磁盘 I/O（持久化时）、内存 | 内存队列、合理持久化策略 |
| 消费者 | 处理速度、预取数量 | 增加消费者、优化业务逻辑 |
| Connection | 连接数限制 | 复用连接、使用 Channel Pool |

---

下一个问题留给你：

现在你知道了消息的完整流转过程。但如果生产者在发送消息后，不确定消息是否真的被 RabbitMQ 接收了怎么办？

比如消息在半路丢了，Broker 根本没收到，但生产者以为发送成功了。

这种「发送方确认」的问题，RabbitMQ 是怎么解决的？答案在下一节——[消息确认机制](/middleware/rabbitmq/confirm-return)。
