# RabbitMQ 消息确认机制：Confirm 与 Return

你有没有遇到过这种情况：

- 生产者发送了一条消息，代码显示"发送成功"
- 但消息实际上在半路丢了，RabbitMQ 根本没收到
- 消费者那边干等消息，就是等不到

这可能是 RabbitMQ 最让人头疼的问题之一——**消息发送出去了，但不知道有没有真的到达目的地**。

RabbitMQ 提供了两套机制来解决这个问题：**Confirm（确认）**和 **Return（返回）**。

## 一、Confirm 机制：确认消息已到达 Broker

Confirm 机制解决的是这个问题：**消息有没有成功到达 Exchange？**

### 工作原理

```
生产者                           RabbitMQ Broker
   │                                     │
   │ ───── basicPublish (持久化消息) ───▶│
   │                                     │
   │ ◀────────── ack ────────────────────│ 消息已写入磁盘
   │                                     │
   │         或                          │
   │                                     │
   │ ◀────────── nack ──────────────────│ 写入失败
   │                                     │
```

当消息到达 Exchange 后，Broker 会返回一个确认（ACK）或否定（NACK）给生产者。

### 开启 Confirm 模式

```java
// 在 Channel 上开启 Confirm 模式
channel.confirmSelect();

// 发送消息
channel.basicPublish(
    "order.exchange",
    "order.created",
    MessageProperties.PERSISTENT_TEXT_PLAIN,
    orderId.getBytes()
);

// 等待确认
try {
    boolean success = channel.waitForConfirmsOrDie(5, TimeUnit.SECONDS);
    System.out.println("消息已确认到达 Exchange");
} catch (TimeoutException e) {
    // 超时未收到确认，消息可能丢失
    handleMessageLost(orderId);
}
```

### 异步 Confirm：高性能场景首选

同步等待的方式会阻塞，高并发场景下性能很差。异步 Confirm 更适合生产环境：

```java
// 添加确认监听器
channel.addConfirmListener((deliveryTag, multiple) -> {
    // 消息确认到达
    System.out.println("消息确认: " + deliveryTag);
}, (deliveryTag, multiple) -> {
    // 消息丢失
    System.out.println("消息丢失: " + deliveryTag);
    handleMessageLost(deliveryTag);
});

// 批量发送 + 异步确认
for (int i = 0; i < 1000; i++) {
    channel.basicPublish("order.exchange", "order.created",
        MessageProperties.PERSISTENT_TEXT_PLAIN,
        ("order-" + i).getBytes());
}
```

### Confirm 的三种模式

| 模式 | 说明 | 可靠性 | 性能 |
|------|------|-------|------|
| 普通 Confirm | 每条消息同步等待确认 | 高 | 低 |
| 批量 Confirm | 发送 N 条后统一确认 | 中 | 中 |
| 异步 Confirm | 发送后异步回调 | 高 | 高 |

```java
// 批量 Confirm 示例
int batchSize = 100;
int outstandingConfirms = 0;

for (int i = 0; i < 10000; i++) {
    channel.basicPublish("order.exchange", "order.created",
        MessageProperties.PERSISTENT_TEXT_PLAIN,
        ("order-" + i).getBytes());

    outstandingConfirms++;
    if (outstandingConfirms == batchSize) {
        channel.waitForConfirmsOrDie(5, TimeUnit.SECONDS);
        outstandingConfirms = 0;
    }
}

// 最后一批
if (outstandingConfirms > 0) {
    channel.waitForConfirmsOrDie(5, TimeUnit.SECONDS);
}
```

## 二、Return 机制：确认消息已路由到队列

Confirm 机制只能确认消息到达了 Exchange，但**不能确认消息是否被路由到了队列**。

这正是 Return 机制解决的问题：**消息有没有成功从 Exchange 路由到 Queue？**

### 什么情况下消息无法路由？

- 交换机没有绑定任何队列
- 路由键匹配不到任何 Binding Key
- 队列已满（达到最大长度）
- 队列已删除

### Return 机制工作原理

```
生产者                    Exchange                   Queue
   │                         │                        │
   │ ── basicPublish ──────▶│                        │
   │                         │──路由──▶ 找到队列？───▶│ ✓ 成功
   │                         │                        │
   │                         │──路由──▶ 找到队列？───▶│ ✗ 失败
   │                         │                        │
   │ ◀── basicReturn ───────│ 触发 ReturnListener   │
```

### 使用 ReturnListener

```java
// 设置 ReturnListener，监听无法路由的消息
channel.addReturnListener((replyCode, replyText, exchange,
                            routingKey, properties, body) -> {
    String message = new String(body);
    System.out.println("消息无法路由到队列:");
    System.out.println("  replyCode: " + replyCode);
    System.out.println("  exchange: " + exchange);
    System.out.println("  routingKey: " + routingKey);
    System.out.println("  message: " + message);

    // 这里可以做补救：存入数据库、发送到备份系统等
    saveToDeadLetter(message);
});

// 发送消息时必须设置 mandatory = true
// 否则消息无法路由时会直接丢弃，不触发 ReturnListener
channel.basicPublish(
    "order.exchange",
    "no.match.key",  // 这个路由键没有匹配的队列
    true,             // mandatory = true 关键参数！
    MessageProperties.PERSISTENT_TEXT_PLAIN,
    "test message".getBytes()
);
```

## 三、Confirm + Return：双重保障

生产环境通常同时开启两种机制，实现**端到端的消息可靠性**：

```java
public class ReliableProducer {

    private final Channel channel;

    public ReliableProducer(Channel channel) throws Exception {
        this.channel = channel;

        // 开启 Confirm 模式
        channel.confirmSelect();

        // 设置 Return 监听器
        channel.addReturnListener(this::handleReturn);

        // 设置 Confirm 监听器
        channel.addConfirmListener(this::handleConfirm, this::handleNack);
    }

    public void sendOrder(String orderId) throws Exception {
        AMQP.BasicProperties properties = new AMQP.BasicProperties.Builder()
            .deliveryMode(2)  // 持久化
            .contentType("application/json")
            .messageId(orderId)
            .timestamp(new Date())
            .build();

        channel.basicPublish(
            "order.exchange",
            "order.created",
            true,  // mandatory = true
            properties,
            orderId.getBytes()
        );
    }

    private void handleConfirm(long deliveryTag, boolean multiple) {
        System.out.println("消息已确认到达 Exchange: " + deliveryTag);
    }

    private void handleNack(long deliveryTag, boolean multiple) {
        System.out.println("消息未确认: " + deliveryTag);
        // 消息可能丢失，需要重试或记录
    }

    private void handleReturn(int replyCode, String replyText,
                              String exchange, String routingKey,
                              AMQP.BasicProperties properties, byte[] body) {
        System.out.println("消息无法路由到队列:");
        System.out.println("  exchange: " + exchange);
        System.out.println("  routingKey: " + routingKey);
        System.out.println("  replyText: " + replyText);

        // 保存到本地文件或数据库，等后续处理
        saveToLocalFile(properties.getMessageId(), body);
    }
}
```

## 四、Spring Boot 中的配置

在 Spring Boot 中，可以简洁地配置 Confirm 和 Return：

```yaml
spring:
  rabbitmq:
    publisher-confirm-type: correlated  # 开启 Confirm
    publisher-returns: true              # 开启 Return
    template:
      mandatory: true                     # 全局开启 mandatory
```

```java
@Component
public class RabbitTemplateConfig {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    @PostConstruct
    public void init() {
        // Confirm 回调
        rabbitTemplate.setConfirmCallback((correlationData, ack, cause) -> {
            if (ack) {
                System.out.println("消息到达 Exchange: " + correlationData.getId());
            } else {
                System.out.println("消息未到达 Exchange: " + cause);
            }
        });

        // Return 回调
        rabbitTemplate.setReturnsCallback(returned -> {
            System.out.println("消息无法路由到队列:");
            System.out.println("  routingKey: " + returned.getRoutingKey());
            System.out.println("  message: " + new String(returned.getMessage().getBody()));
        });
    }
}
```

## 五、消息可靠性保障全景图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         生产者消息发送全流程                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. 消息持久化                                                           │
│     channel.basicPublish() + PERSISTENT ─────────────────────────────▶  │
│                                                                          │
│  2. Confirm 确认                                                        │
│     ◀── ack ── Broker 确认消息已写入磁盘                               │
│     ◀── nack ── 写入失败，需要重试                                      │
│                                                                          │
│  3. Return 确认                                                         │
│     消息无法路由 ───▶ ReturnListener 回调                               │
│     消息成功路由 ───▶ 正常流程                                          │
│                                                                          │
│  4. 消息追踪                                                             │
│     开启 RabbitMQ Tracing 插件，记录所有消息轨迹                        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## 六、面试追问

### Confirm 和事务（Transaction）有什么区别？

这是个好问题，很多人会混淆：

| 特性 | Transaction | Confirm |
|------|-------------|---------|
| 机制 | 同步阻塞 | 异步非阻塞 |
| 范围 | 单次 RPC | 单次消息 |
| 性能 | 极差（~250 TPS） | 好（~50K TPS） |
| 用途 | 不推荐 | 生产环境首选 |

RabbitMQ 的事务机制是通过 AMQP 协议实现的，每发送一条消息就要等待 Broker 确认，性能损耗巨大。在生产环境中，几乎没有人用事务模式，都是用 Confirm 机制。

### 如果 Confirm 确认失败了怎么办？

Confirm 失败通常意味着消息根本没到达 Broker（比如网络中断）。处理策略：

1. **重试发送**：将消息存入本地队列，延迟后重试
2. **记录日志**：记录消息 ID 和内容，人工干预
3. **消息补偿**：定期扫描未确认的消息，主动补发

```java
// 失败时保存到数据库，后续补偿
public void handleNack(String orderId) {
    // 保存到重试表
    messageRetryService.save(new MessageRetry(orderId, new Date()));
    // 定时任务扫描并重试
}
```

---

下一个问题留给你：

消息从生产者到 Broker 的可靠性有了保障，但如果消费者拿到消息后，处理到一半突然宕机了怎么办？

消息已经被消费了，但业务逻辑没执行完。这条消息是应该重新投递，还是直接丢弃？

这就是下一节要讨论的——[消费端确认机制](/middleware/rabbitmq/consumer-ack)。
