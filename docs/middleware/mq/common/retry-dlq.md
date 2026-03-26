# 消息重试机制与死信队列

你的消息处理失败了。

数据库连接超时、外部 API 不可用、代码 Bug……这些临时性错误，可能下一秒就好了。

**重试机制**就是给系统「再试一次」的机会。

但重试也不是万能的——有些错误，重试一万次也不会成功。**死信队列**就是处理这些「不可救药」的消息。

---

## 为什么需要重试机制？

### 临时性错误的普遍性

```
临时性错误（应该重试）：
• 网络抖动
• 数据库连接池耗尽
• 第三方服务暂时不可用
• 远程调用超时
• 资源暂时不足

永久性错误（不应该重试）：
• 参数校验失败
• 业务逻辑错误
• 数据不存在
• 权限不足
```

### 同步调用 vs 消息队列的错误处理

```
同步调用：
调用失败 → 抛异常 → 上游感知 → 重试
     │
     └──► 上游可能同步重试多次

消息队列：
消费失败 → 重试队列 → 延迟后再试
     │
     └──► 消息队列帮你管理重试
```

---

## 重试机制的核心要素

### 要素一：重试次数

```
重试 0 次：消息失败就放弃
重试 1 次：再给一次机会
重试 3 次：给足够的机会
重试 N 次：超过 N 次进入死信队列
```

### 要素二：退避策略

退避策略决定**重试间隔**怎么安排：

| 策略 | 间隔计算 | 特点 |
|-----|---------|-----|
| **立即重试** | 0ms | 适合瞬间恢复的错误 |
| **固定间隔** | 每次都是 T ms | 简单，但可能浪费资源 |
| **线性退避** | T, 2T, 3T, ... | 递增 |
| **指数退避** | T, 2T, 4T, 8T, ... | 指数增长，避免风暴 |
| **抖动** | 指数退避 + 随机抖动 | 防止多消息同时重试 |

```
固定间隔（间隔 = 1s）：
●────●────●────●────●────●────●
0s   1s   2s   3s   4s   5s   6s

指数退避（间隔 = 1s, 2s, 4s, 8s...）：
●─────●──────●────────●──────────●────
0s   1s    3s    7s      15s       31s

指数退避 + 抖动（防止雷群效应）：
●─────●─●───●──●───●────●─
0s   1s  2s  4s  5s  8s  12s
```

### 要素三：重试条件

不是所有错误都值得重试：

```java
public boolean shouldRetry(Exception e, int retryCount) {
    // 可重试错误：网络、临时故障
    if (e instanceof SocketTimeoutException) return true;
    if (e instanceof ServiceUnavailableException) return true;
    if (e instanceof ResourceBusyException) return true;

    // 不可重试错误：业务错误
    if (e instanceof ValidationException) return false;
    if (e instanceof UnauthorizedException) return false;
    if (e instanceof BusinessException) return false;

    // 超过最大重试次数
    if (retryCount >= MAX_RETRY_COUNT) return false;

    return false;
}
```

---

## Kafka 原生重试

Kafka 本身不提供重试机制，需要**自己实现**。

### 方案一：本地重试队列

```java
@KafkaListener(topics = "order-topic")
public class RetryableOrderConsumer {

    private final KafkaTemplate&lt;String, OrderMessage&gt; kafkaTemplate;
    private static final int MAX_RETRY = 3;

    public void consumeOrder(ConsumerRecord&lt;String, OrderMessage&gt; record) {
        OrderMessage message = record.value();
        int retryCount = getRetryCount(record);

        try {
            processOrder(message);
        } catch (RetryableException e) {
            if (retryCount &lt; MAX_RETRY) {
                // 发送到重试 Topic
                kafkaTemplate.send("order-topic-retry", message.getOrderId(), message,
                    new Callback() {
                        @Override
                        public void onCompletion(RecordMetadata metadata, Exception ex) {
                            // 在 Header 中记录重试次数
                            record.headers().add("retry-count",
                                String.valueOf(retryCount + 1).getBytes());
                        }
                    });
            } else {
                // 超过最大重试次数，发送到死信队列
                kafkaTemplate.send("order-topic-dlq", message.getOrderId(), message);
            }
        }
    }

    private int getRetryCount(ConsumerRecord&lt;?, ?&gt; record) {
        Header header = record.headers().lastHeader("retry-count");
        if (header != null) {
            return Integer.parseInt(new String(header.value()));
        }
        return 0;
    }
}
```

### 方案二：使用 Spring Retry

```java
@Configuration
@EnableRetry
public class RetryConfig {

    // 最大重试次数
    public static final int MAX_ATTEMPTS = 3;

    // 重试间隔（毫秒）
    public static final long RETRY_INTERVAL = 1000L;

    // 指数乘数
    public static final int MULTIPLIER = 2;

    // 最大间隔
    public static final long MAX_INTERVAL = 10000L;
}

@Service
@Slf4j
public class SpringRetryConsumer {

    @Retryable(
        value = RetryableException.class,           // 重试什么异常
        maxAttempts = 3,                             // 最大重试次数
        backoff = @Backoff(
            delay = 1000,                            // 初始间隔 1s
            multiplier = 2,                           // 指数退避
            maxDelay = 10000                         // 最大间隔 10s
        ),
        recover = "recoverMethod"                   // 重试失败后的兜底方法
    )
    @KafkaListener(topics = "order-topic")
    public void consumeOrder(OrderMessage message) {
        log.info("处理订单: {}", message.getOrderId());
        orderService.processOrder(message);
    }

    /**
     * 超过最大重试次数后的兜底处理
     * 进入死信队列
     */
    public void recoverMethod(OrderMessage message, Exception e) {
        log.error("订单处理失败，进入死信队列: orderId={}, error={}",
            message.getOrderId(), e.getMessage());

        // 发送到死信队列
        kafkaTemplate.send("order-topic-dlq", message.getOrderId(), message);
    }
}
```

---

## RocketMQ 原生重试

RocketMQ **内置了重试队列**，使用更简单。

### 消息处理与自动重试

```java
@RocketMQMessageListener(
    topic = "order-topic",
    consumerGroup = "order-consumer-group",
    consumeThreadMin = 10,
    consumeThreadMax = 20
)
public class RocketMQOrderConsumer implements RocketMQListener&lt;OrderMessage&gt; {

    @Override
    public void onMessage(OrderMessage message) {
        try {
            // 业务处理
            orderService.processOrder(message);
        } catch (Exception e) {
            // 抛出异常，RocketMQ 会自动重试
            // 最大重试次数由配置决定（默认 16 次）
            throw e;
        }
    }
}
```

### RocketMQ 重试配置

```yaml
# application.yml
rocketmq:
  consumer:
    # 最大重试次数（默认 16）
    max-retry-times: 3
    # 重试间隔（默认 1000ms）
    retry-interval-time: 1000
    # 重试队列数（默认 1）
    retry-queue-nums: 1
```

### RocketMQ 延迟等级

RocketMQ 的重试是**按延迟等级**进行的：

| 等级 | 延迟时间 |
|-----|---------|
| 1 | 1 秒 |
| 2 | 5 秒 |
| 3 | 10 秒 |
| 4 | 30 秒 |
| 5 | 1 分钟 |
| 6 | 2 分钟 |
| 7 | 3 分钟 |
| 8 | 4 分钟 |
| 9 | 5 分钟 |
| 10 | 6 分钟 |
| 11 | 7 分钟 |
| 12 | 8 分钟 |
| 13 | 9 分钟 |
| 14 | 10 分钟 |
| 15 | 20 分钟 |
| 16 | 30 分钟 |
| 17 | 1 小时 |
| 18 | 2 小时 |

```
消息发送失败后的重试路径：
msg → 重试队列 1 (1s) → 重试队列 2 (5s) → ... → 重试队列 16 (30m)
                                                             │
                                                    超过 16 次
                                                             │
                                                             ▼
                                                    死信队列（DLQ）
```

---

## RabbitMQ 的重试机制

RabbitMQ 通过**死信交换机（DLX）**实现重试。

### 重试流程

```
Consumer 处理失败
        │
        ▼
    消息返回（reject/nack）
        │
        ├──► requeue = false → 进入死信队列
        │
        └──► 死信队列配置了 TTL → 等待 TTL 后重新投递给原队列
```

### 配置死信交换机实现重试

```java
// 1. 创建死信交换机
@Bean
public DirectExchange deadLetterExchange() {
    return new DirectExchange("order-dlx");
}

// 2. 创建死信队列（带 TTL）
@Bean
public Queue deadLetterQueue() {
    Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
    args.put("x-dead-letter-exchange", "order-exchange");    // 死信转回原交换机
    args.put("x-dead-letter-routing-key", "order.normal");    // 死信的路由键
    args.put("x-message-ttl", 5000);                          // 5 秒后重试

    return new Queue("order-dlq", true, false, false, args);
}

// 3. 绑定死信队列到死信交换机
@Bean
public Binding deadLetterBinding() {
    return BindingBuilder.bind(deadLetterQueue())
        .to(deadLetterExchange())
        .with("order.dlq");
}

// 4. 在原队列上配置死信交换机
@Bean
public Queue orderQueue() {
    Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
    args.put("x-dead-letter-exchange", "order-dlx");  // 失败消息进入死信交换机

    return new Queue("order-queue", true, false, false, args);
}
```

### 完整的重试配置

```java
@Configuration
public class RabbitMQRetryConfig {

    public static final String RETRY_QUEUE_1 = "order-retry-1s";
    public static final String RETRY_QUEUE_2 = "order-retry-5s";
    public static final String RETRY_QUEUE_3 = "order-retry-30s";
    public static final String DEAD_LETTER_QUEUE = "order-dlq";

    @Bean
    public DirectExchange orderExchange() {
        return new DirectExchange("order-exchange");
    }

    // 创建多级重试队列
    @Bean
    public Queue retryQueue1() {
        return QueueBuilder.durable(RETRY_QUEUE_1)
            .ttl(1000)  // 1 秒
            .deadLetterExchange("order-exchange")
            .deadLetterRoutingKey("order.normal")
            .build();
    }

    @Bean
    public Queue retryQueue2() {
        return QueueBuilder.durable(RETRY_QUEUE_2)
            .ttl(5000)  // 5 秒
            .deadLetterExchange("order-exchange")
            .deadLetterRoutingKey("order.normal")
            .build();
    }

    @Bean
    public Queue retryQueue3() {
        return QueueBuilder.durable(RETRY_QUEUE_3)
            .ttl(30000)  // 30 秒
            .deadLetterExchange("order-dlx")  // 第三次失败进入真正的死信队列
            .deadLetterRoutingKey("order.dlq")
            .build();
    }

    // 最终死信队列
    @Bean
    public Queue deadLetterQueue() {
        return new Queue(DEAD_LETTER_QUEUE, true);
    }
}
```

---

## 死信队列（DLQ）

死信队列是**存放无法正常处理的消息**的地方。

### 什么消息会进入死信队列？

```
进入死信队列的条件：
1. 超过最大重试次数
2. 消息 TTL 过期
3. 队列满了被丢弃
4. 消息被拒绝且不重入队
```

### 死信队列的用途

```
死信队列的作用：
1. 人工排查：通过 DLQ 分析失败原因
2. 人工处理：重要消息需要人工介入处理
3. 补偿机制：定期从 DLQ 捞消息进行补偿处理
4. 监控告警：DLQ 有消息说明系统有问题
```

### 处理死信队列

```java
/**
 * 死信队列消费者
 * 从 DLQ 消费消息进行人工处理
 */
@RabbitListener(queues = "order-dlq")
public class DeadLetterConsumer {

    public void processDeadLetter(Message message, Channel channel) {
        long deliveryTag = message.getMessageProperties().getDeliveryTag();
        OrderMessage orderMessage = parseMessage(message);

        log.error("收到死信消息: orderId={}, error={}",
            orderMessage.getOrderId(),
            getOriginalError(message));

        try {
            // 人工处理：修复数据问题
            boolean handled = manualProcess(orderMessage);

            if (handled) {
                // 人工处理成功，确认消息
                channel.basicAck(deliveryTag, false);
                log.info("死信消息处理成功: orderId={}", orderMessage.getOrderId());
            } else {
                // 人工处理失败，拒绝对列（可以记录或再次入队）
                channel.basicNack(deliveryTag, false, true);
            }
        } catch (Exception e) {
            log.error("处理死信消息失败: orderId={}", orderMessage.getOrderId(), e);
            // 处理失败，记录但不删除，后续继续处理
            saveToFailedTable(orderMessage, e);
            channel.basicAck(deliveryTag, false);
        }
    }

    private String getOriginalError(Message message) {
        Map&lt;String, Object&gt; headers = message.getMessageProperties().getHeaders();
        Object error = headers.get("x-exception-message");
        return error != null ? error.toString() : "Unknown";
    }
}
```

### 死信队列监控

```yaml
# 告警规则
groups:
  - name: dead_letter_queue
    rules:
      # 死信队列有消息告警
      - alert: DeadLetterQueueHasMessages
        expr: rabbitmq_queue_messages{queue="order-dlq"} > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "死信队列有积压消息"
          description: "{{ $labels.queue }} 有 {{ $value }} 条消息"

      # 死信队列消息数异常告警
      - alert: DeadLetterQueueBacklog
        expr: rabbitmq_queue_messages{queue="order-dlq"} > 1000
        labels:
          severity: critical
```

---

## 最佳实践总结

### 重试策略设计

| 场景 | 重试次数 | 退避策略 | 说明 |
|-----|---------|---------|-----|
| 瞬时故障 | 1-3 次 | 立即或短延迟 | 网络抖动很快恢复 |
| 服务繁忙 | 3-5 次 | 指数退避 | 限流场景 |
| 外部依赖 | 5-10 次 | 长间隔指数退避 | 第三方 API |
| 核心业务 | 16+ 次 | 长达小时级 | 需要确保最终成功 |

### 代码示例：完整的重试 + 死信处理

```java
@Service
@Slf4j
public class ResilientOrderConsumer {

    private final OrderService orderService;
    private final KafkaTemplate&lt;String, OrderMessage&gt; kafkaTemplate;

    private static final int MAX_RETRY = 3;
    private static final String RETRY_TOPIC = "order-topic-retry";
    private static final String DLQ_TOPIC = "order-topic-dlq";

    @KafkaListener(topics = "order-topic", groupId = "order-consumer")
    public void consumeOrder(ConsumerRecord&lt;String, OrderMessage&gt; record) {
        OrderMessage message = record.value();
        int retryCount = getRetryCount(record);

        try {
            // 执行业务处理
            processWithRetry(message);
            log.info("订单处理成功: orderId={}", message.getOrderId());

        } catch (RetryableException e) {
            handleRetry(message, retryCount, e);
        } catch (Exception e) {
            // 不可重试的错误，直接进入死信队列
            handleDeadLetter(message, e);
        }
    }

    private void processWithRetry(OrderMessage message) {
        // 实际处理逻辑
        orderService.processOrder(message);
    }

    private void handleRetry(OrderMessage message, int retryCount, RetryableException e) {
        if (retryCount &lt; MAX_RETRY) {
            // 计算延迟（指数退避 + 抖动）
            long delay = calculateBackoff(retryCount);

            log.warn("消息处理失败，准备重试: orderId={}, retry={}, delay={}ms",
                message.getOrderId(), retryCount + 1, delay);

            // 延迟发送消息
            ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
            scheduler.schedule(() -> {
                kafkaTemplate.send(RETRY_TOPIC, message.getOrderId(), message);
            }, delay, TimeUnit.MILLISECONDS);
        } else {
            // 超过最大重试次数，进入死信队列
            handleDeadLetter(message, e);
        }
    }

    private void handleDeadLetter(OrderMessage message, Exception e) {
        log.error("消息处理失败，进入死信队列: orderId={}, error={}",
            message.getOrderId(), e.getMessage());

        // 添加错误信息到 Header
        Map&lt;String, String&gt; headers = new HashMap&lt;&gt;();
        headers.put("error-message", e.getMessage());
        headers.put("error-time", String.valueOf(System.currentTimeMillis()));

        kafkaTemplate.send(DLQ_TOPIC, message.getOrderId(), message);
    }

    private long calculateBackoff(int retryCount) {
        // 指数退避：1s, 2s, 4s
        long base = 1000;
        long delay = base * (long) Math.pow(2, retryCount);

        // 添加抖动（0-50%）
        long jitter = (long) (delay * 0.5 * Math.random());

        return delay + jitter;
    }

    private int getRetryCount(ConsumerRecord&lt;?, ?&gt; record) {
        Header header = record.headers().lastHeader("retry-count");
        if (header != null) {
            return Integer.parseInt(new String(header.value()));
        }
        return 0;
    }
}
```

---

## 面试追问

**面试官可能会问：**

1. 「重试次数设置多少合适？」—— 看场景，核心业务多几次，边缘业务少几次
2. 「如何避免重试风暴？」—— 使用指数退避 + 抖动，避免大量消息同时重试
3. 「死信队列里的消息怎么处理？」—— 人工排查、补偿处理、记录分析
4. 「RocketMQ 的延迟消息和重试消息有什么区别？」—— 延迟消息是主动设置的延迟，重试是消费失败后的自动行为

重试是**给系统第二次机会**，但不是无限机会。设置合理的重试策略和死信处理机制，才能既保证可靠性，又避免无效重试带来的资源浪费。
