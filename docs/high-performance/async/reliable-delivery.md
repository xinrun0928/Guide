# 消息可靠投递：消息持久化 + 消费确认 + 补偿机制

用户付款成功了，但订单状态没更新。
用户没付款，但短信通知发出去了。

这两类问题，都是消息队列不可靠的典型症状。

消息可靠性是消息队列最核心的问题，也是最容易出错的环节。

## 消息可靠性的三个环节

一条消息从发送到消费，经历三个环节：

```
┌──────────────────────────────────────────────────────────────────┐
│                        消息可靠性三环节                             │
│                                                                   │
│   ┌─────────┐      ┌─────────┐      ┌─────────┐                  │
│   │ Producer │ ──&gt; │  Broker │ ──&gt; │ Consumer│                  │
│   │  生产者  │      │  中间件  │      │  消费者  │                  │
│   └─────────┘      └─────────┘      └─────────┘                  │
│        │                │                │                        │
│        ↓                ↓                ↓                        │
│   生产者确认         消息持久化         消费确认                     │
│   (Confirm)        (Persistence)        (Ack)                     │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

**任何一环出问题，消息都可能丢失**：

| 环节 | 可能丢失原因 | 解决方案 |
|------|-------------|---------|
| 生产者 → Broker | 网络抖动、Broker 挂了 | 生产者确认（Confirm） |
| Broker 存储 | 磁盘故障、刷盘失败 | 消息持久化 |
| Broker → Consumer | Consumer 挂了 | 消费确认（Ack） |

## 一、生产者确认（Confirm）

### Kafka Producer 配置

```java
// Kafka 生产者确认配置
properties.put("bootstrap.servers", "localhost:9092");
properties.put("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
properties.put("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");

// 关键配置：acks 确认级别
properties.put("acks", "all");  // 所有副本确认才返回成功

// 开启重试
properties.put("retries", 3);
properties.put("retry.backoff.ms", 100);

// 开启幂等性（防止重复发送）
properties.put("enable.idempotence", true);

KafkaProducer&lt;String, String&gt; producer = new KafkaProducer&lt;&gt;(properties);

// 发送消息
ProducerRecord&lt;String, String&gt; record = new ProducerRecord&lt;&gt;("orders", orderId, order);
producer.send(record, (metadata, exception) -&gt; {
    if (exception != null) {
        // 发送失败，记录日志，重试发送
        log.error("发送消息失败: {}", exception.getMessage());
        retrySend(record);
    } else {
        // 发送成功
        log.info("消息发送成功: topic={}, partition={}, offset={}",
            metadata.topic(), metadata.partition(), metadata.offset());
    }
});
```

### acks 配置详解

| acks 值 | 含义 | 可靠性 | 性能 | 适用场景 |
|---------|------|--------|------|---------|
| `0` | 不等待确认 | 低 | 最高 | 允许少量丢失的日志 |
| `1` | Leader 确认 | 中 | 高 | 一般场景 |
| `all` / `-1` | 所有 ISR 确认 | 高 | 低 | 金融级场景 |

```java
// acks = all 的详细配置
properties.put("min.insync.replicas", 2);  // 最少 2 个副本确认
properties.put("acks", "all");

// 场景分析：
// 3 个副本，min.insync.replicas = 2
// 只要 2 个副本写入成功，就算成功
// 如果只有 1 个副本存活，写入会失败
```

### RabbitMQ Publisher Confirm

```java
// RabbitMQ 开启确认
connectionFactory.setPublisherConfirmType(CachingConnectionFactory.ConfirmType.CORRELATED);
connectionFactory.setPublisherReturns(true);

@Bean
public RabbitTemplate rabbitTemplate() {
    RabbitTemplate template = new RabbitTemplate(connectionFactory);
    
    // 设置确认回调
    template.setConfirmCallback((correlationData, ack, cause) -&gt; {
        if (ack) {
            // Broker 确认收到
            log.info("消息发送成功: {}", correlationData);
        } else {
            // Broker 没确认
            log.error("消息发送失败: {}, cause: {}", correlationData, cause);
            // 重试发送
            retrySend(correlationData);
        }
    });
    
    // 设置返回回调（消息无法路由）
    template.setReturnsCallback(returned -&gt; {
        log.error("消息无法路由: exchange={}, routingKey={}, replyCode={}",
            returned.getExchange(), returned.getRoutingKey(), returned.getReplyCode());
    });
    
    return template;
}

// 发送消息
public void sendOrder(Order order) {
    CorrelationData correlationData = new CorrelationData(order.getId());
    
    rabbitTemplate.convertAndSend(
        "orders.exchange",
        "orders.created",
        order,
        correlationData
    );
}
```

## 二、消息持久化

### Kafka 消息持久化

```java
// Kafka 持久化配置
properties.put("bootstrap.servers", "localhost:9092");

// 消息持久化关键配置
properties.put("acks", "all");           // 所有副本确认
properties.put("retries", 3);            // 重试次数

// 刷盘策略：建议使用 log.flush.interval.messages
// 依赖操作系统刷盘（更快，更安全）
// 不要设置太频繁的强制刷盘，会影响性能

// 消息本身设置持久化
ProducerRecord&lt;String, String&gt; record = new ProducerRecord&lt;&gt;(
    "orders",
    order.getId(),
    JSON.toJSONString(order)
);
// 消息会持久化到磁盘
```

**Kafka 持久化原理**：

```
消息写入 → Page Cache（内存） → 异步刷盘 → 磁盘

操作系统会定期将 Page Cache 刷到磁盘
Kafka 也可根据配置强制刷盘

可靠性 vs 性能：
- 同步刷盘：慢，但最可靠
- 异步刷盘：快，可能丢失少量消息
```

### RabbitMQ 消息持久化

```java
// RabbitMQ 持久化三要素

// 1. 交换机持久化
@Bean
public DirectExchange ordersExchange() {
    // durable = true 表示持久化
    return new DirectExchange("orders.exchange", true, false);
}

// 2. 队列持久化
@Bean
public Queue ordersQueue() {
    // durable = true 表示持久化
    return new Queue("orders.queue", true);
}

// 3. 消息持久化
public void sendOrder(Order order) {
    rabbitTemplate.convertAndSend("orders.exchange", "orders.created", order, message -&gt; {
        // DeliveryMode.PERSISTENT 表示消息持久化
        message.getMessageProperties().setDeliveryMode(MessageDeliveryMode.PERSISTENT);
        return message;
    });
}
```

### 持久化 vs 性能权衡

| 配置 | 可靠性 | 性能 | 建议 |
|------|--------|------|------|
| 内存 + 异步刷盘 | 中 | 高 | 默认配置 |
| 同步刷盘 | 高 | 低 | 金融级场景 |
| 不持久化 | 低 | 最高 | 测试环境 |

## 三、消费确认（ Ack）

### Kafka 消费者 offset 提交

```java
// Kafka 消费确认方式

// 方式一：自动提交（默认，可能丢消息）
properties.put("enable.auto.commit", true);
properties.put("auto.commit.interval.ms", 5000);  // 每 5 秒提交一次

// 方式二：手动提交（推荐，不丢消息）
properties.put("enable.auto.commit", false);

KafkaConsumer&lt;String, String&gt; consumer = new KafkaConsumer&lt;&gt;(props);
consumer.subscribe(Arrays.asList("orders"));

while (true) {
    ConsumerRecords&lt;String, String&gt; records = consumer.poll(Duration.ofMillis(100));
    
    for (ConsumerRecord&lt;String, String&gt; record : records) {
        try {
            processOrder(record.value());
            
            // 手动提交 offset
            // 在业务处理成功后提交
            consumer.commitSync();  // 同步提交
            // 或
            consumer.commitAsync(); // 异步提交
            
        } catch (Exception e) {
            // 业务处理失败，不提交 offset
            // 下次重新消费这条消息
            log.error("处理消息失败", e);
        }
    }
}
```

### RabbitMQ 消费确认

```java
// RabbitMQ 手动确认
@Bean
public SimpleRabbitListenerContainerFactory rabbitListenerContainerFactory() {
    SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
    factory.setConnectionFactory(connectionFactory);
    
    // 手动确认模式
    factory.setAcknowledgeMode(AcknowledgeMode.MANUAL);
    
    // prefetch 控制预取数量
    factory.setPrefetchCount(10);
    
    return factory;
}

// 消费代码
@RabbitListener(queues = "orders.queue")
public void handleOrder(Order order, Channel channel, 
                        @Header(AmqpHeaders.DELIVERY_TAG) long tag) {
    try {
        // 1. 业务处理
        processOrder(order);
        
        // 2. 确认消息
        // multiple = false：只确认当前这条
        // multiple = true：确认所有小于等于 tag 的消息
        channel.basicAck(tag, false);
        
    } catch (Exception e) {
        log.error("处理消息失败", e);
        
        // 3. 处理失败，根据情况选择：
        
        // 方案一：重新入队（重新消费）
        // channel.basicNack(tag, false, true);
        
        // 方案二：拒绝消息（不重试，进入死信队列）
        channel.basicNack(tag, false, false);
        
        // 方案三：拒绝消息，稍后重试
        // channel.basicNack(tag, false, true);
        // 或
        // Thread.sleep(1000);
        // channel.basicAck(tag, false);
    }
}
```

### 消费幂等性设计

即使有了确认机制，网络抖动仍可能导致消息被重复消费。**消费端必须实现幂等性**。

```java
// 方案一：唯一键去重
@Service
public class OrderService {
    
    @Autowired
    private OrderRepository orderRepository;
    
    public void processOrder(Order order) {
        // 检查订单是否已处理
        if (orderRepository.existsByOrderId(order.getOrderId())) {
            log.info("订单已处理，跳过: {}", order.getOrderId());
            return;
        }
        
        // 业务处理
        // ...
        orderRepository.save(order);
    }
}

// 方案二：Redis 分布式锁
@Service
public class OrderService {
    
    @Autowired
    private RedisTemplate&lt;String, String&gt; redisTemplate;
    
    public void processOrder(Order order) {
        String lockKey = "order:lock:" + order.getOrderId();
        Boolean locked = redisTemplate.opsForValue().setIfAbsent(lockKey, "1", 10, TimeUnit.SECONDS);
        
        if (!locked) {
            throw new RuntimeException("订单正在处理中");
        }
        
        try {
            // 业务处理
            processOrderInternal(order);
        } finally {
            redisTemplate.delete(lockKey);
        }
    }
}

// 方案三：数据库唯一索引
// CREATE UNIQUE INDEX idx_order_id ON orders(order_id);
// 插入重复订单会抛异常
```

## 四、补偿机制

### 定时任务对账

```java
// 定时检查消息处理情况
@Service
public class MessageCompensationService {
    
    @Autowired
    private OrderRepository orderRepository;
    
    @Autowired
    private MessageLogRepository messageLogRepository;
    
    // 每分钟执行
    @Scheduled(fixedRate = 60000)
    public void checkPendingMessages() {
        // 1. 查找状态为"发送中"的消息，超过 5 分钟没变
        List&lt;MessageLog&gt; pendingMessages = messageLogRepository
            .findPendingMessages(LocalDateTime.now().minusMinutes(5));
        
        for (MessageLog msg : pendingMessages) {
            // 2. 检查业务表是否有对应记录
            boolean exists = orderRepository.existsByMessageId(msg.getMessageId());
            
            if (exists) {
                // 业务已处理，更新消息状态
                msg.setStatus("COMPLETED");
                messageLogRepository.save(msg);
            } else {
                // 业务未处理，尝试重新发送
                resendMessage(msg);
            }
        }
    }
}

// 消息发送记录表
@Entity
public class MessageLog {
    @Id
    private String messageId;
    private String status;  // PENDING, SENT, COMPLETED, FAILED
    private int retryCount;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
    private LocalDateTime nextRetryTime;
}
```

### 死信队列兜底

```java
// 配置死信队列处理无法消费的消息
@Configuration
public class DeadLetterConfig {
    
    @Bean
    public DirectExchange deadLetterExchange() {
        return new DirectExchange("dlx.exchange");
    }
    
    @Bean
    public Queue deadLetterQueue() {
        return new Queue("dlq.orders");
    }
    
    @Bean
    public Binding deadLetterBinding() {
        return BindingBuilder.bind(deadLetterQueue())
            .to(deadLetterExchange())
            .with("orders.dead");
    }
}

// 原队列配置死信
@Bean
public Queue ordersQueue() {
    Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
    args.put("x-dead-letter-exchange", "dlx.exchange");
    args.put("x-dead-letter-routing-key", "orders.dead");
    // 消息 TTL：7 天后自动删除
    args.put("x-message-ttl", 604800000);
    return new Queue("orders.queue", true, false, false, args);
}

// 死信队列消费者
@RabbitListener(queues = "dlq.orders")
public void handleDeadLetter(Order order, Channel channel, 
                             @Header(AmqpHeaders.DELIVERY_TAG) long tag) {
    log.error("死信消息: {}", order);
    
    // 人工处理或告警
    alertService.send("订单消息进入死信队列: " + order.getOrderId());
    
    // 确认消息（避免无限重试）
    channel.basicAck(tag, false);
}
```

## 五、完整可靠性方案

```
┌─────────────────────────────────────────────────────────────────┐
│                     消息可靠性完整方案                            │
│                                                                  │
│  Producer                                                         │
│    │                                                             │
│    ├─ 发送前：记录消息到数据库（状态=PENDING）                     │
│    │                                                             │
│    ├─ 发送时：Confirm 回调确认收到                                │
│    │   └─ 超时未确认：重试发送                                    │
│    │                                                             │
│    └─ 发送成功：更新消息状态=SENT                                 │
│                                                                  │
│  Broker                                                          │
│    │                                                             │
│    ├─ 持久化存储（磁盘）                                          │
│    │                                                             │
│    └─ 副本同步（多副本）                                          │
│                                                                  │
│  Consumer                                                        │
│    │                                                             │
│    ├─ 消费消息                                                    │
│    │                                                             │
│    ├─ 业务处理                                                    │
│    │   └─ 业务成功：更新消息状态=COMPLETED                        │
│    │   └─ 业务失败：记录失败原因                                  │
│    │                                                             │
│    └─ 手动 Ack（业务处理成功后）                                  │
│                                                                  │
│  补偿机制                                                         │
│    │                                                             │
│    ├─ 定时任务：检查 PENDING 消息，重试                           │
│    │                                                             │
│    ├─ 死信队列：无法消费的消息兜底                                │
│    │                                                             │
│    └─ 人工干预：告警 + 人工处理                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 总结

消息可靠投递三板斧：

| 环节 | 方案 | 配置 |
|------|------|------|
| 生产确认 | Confirm 机制 | `acks=all`, `retries=3` |
| 持久化 | 磁盘持久化 | `durable=true`, `deliveryMode=PERSISTENT` |
| 消费确认 | 手动 Ack | `acknowledgeMode=MANUAL` |
| 补偿 | 定时对账 + 死信队列 | 兜底保障 |

**记住**：没有任何方案能 100% 保证消息不丢，只能做到极高可靠。需要在可靠性、性能、成本之间做权衡。

---

## 留给你的问题

假设你的支付系统用消息队列通知下游商户：

1. 支付成功后需要通知 10 个下游商户，每个商户调用 API。如果某个商户 API 挂了，消息怎么处理？
2. 用户重复点击支付按钮，可能发送两条支付消息。如何保证只处理一次？
3. 支付消息发出去了，但下游商户 API 响应慢，导致超时。支付系统怎么知道下游到底处理了没有？
4. 如果 RabbitMQ 整个集群挂了，你的消息还在内存里没持久化到磁盘。你怎么尽可能减少损失？

思考这些问题，能帮助你设计更可靠的消息系统。
