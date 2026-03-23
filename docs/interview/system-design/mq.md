# 消息队列在系统设计中的应用

你写了一个下单接口，用户下单后需要：
1. 扣减库存
2. 发送短信通知
3. 更新用户积分
4. 记录日志
5. 发货通知

如果你把这些操作串行执行，用户点击下单后可能要等 3 秒才能看到结果。

但如果用户只关心「下单成功」，为什么要等所有事情都做完？

**消息队列的核心价值：异步和解耦。**

## 为什么需要消息队列？

### 场景一：异步处理

```
同步模式：
用户下单 → 扣库存(50ms) → 发短信(200ms) → 更新积分(30ms) → 返回结果(280ms)

异步模式：
用户下单 → 写入消息队列 → 立即返回(5ms)
                    ↓
         后台消费者异步处理
                    ↓
         扣库存 + 发短信 + 更新积分
```

用户感知到的延迟从 280ms 降到了 5ms。

### 场景二：削峰填谷

```
无 MQ：
流量洪峰 → 直接打到数据库 → 数据库崩溃

有 MQ：
流量洪峰 → 写入 MQ → 消费者按固定速率消费 → 数据库稳定
```

MQ 像一个缓冲池，保护下游系统不被流量冲垮。

### 场景三：系统解耦

```
强耦合：
订单服务 → 直接调用库存服务
        → 直接调用短信服务
        → 直接调用积分服务

解耦后：
订单服务 → MQ → 库存服务
              → 短信服务
              → 积分服务

好处：任何一个服务挂了，不影响其他服务；新增服务只需要订阅 MQ
```

## 常见消息队列对比

| 特性 | RabbitMQ | Kafka | RocketMQ |
|-----|----------|-------|----------|
| 吞吐量 | 万级/秒 | 百万级/秒 | 十万级/秒 |
| 延迟 | 微秒级 | 毫秒级 | 毫秒级 |
| 事务 | 支持 | 事务接口 | 支持 |
| 顺序消息 | 支持 | 分区有序 | 支持 |
| 死信队列 | 支持 | 不支持 | 支持 |
| 适用场景 | 小规模、灵活 | 大数据、日志 | 电商、交易 |

## 消息队列的核心问题

### 问题一：消息丢失

消息从生产到消费经过三个环节，每个环节都可能丢消息：

```
生产者 → Broker → 消费者
```

**解决思路**：

```java
// 生产者：确认机制
public class ReliableProducer {
    private final RabbitTemplate template;

    public void send(String message) {
        // 1. 开启事务模式（性能差，不推荐）
        // template.setChannelTransacted(true);

        // 2. 开启确认模式（推荐）
        template.setConfirmCallback((correlationData, ack, cause) -> {
            if (!ack) {
                // 消息没到 Broker，重试发送
                // 为什么要重试？因为可能是网络抖动
                retrySend(message);
            }
        });

        // 3. 开启返回模式，确保消息路由到队列
        template.setReturnsCallback(returned -> {
            // 消息没有路由到任何队列，需要处理
            log.error("Message not routed: {}", returned.getMessage());
        });

        template.convertAndSend("exchange", "routingKey", message);
    }
}

// Broker：持久化
public class BrokerConfig {
    // 队列持久化：重启后队列还在
    @Bean
    public Queue queue() {
        return QueueBuilder.durable("order.queue")
            // 消息持久化：写入磁盘
            // 但会降低性能，所以用「异步刷盘」
            .build();
    }

    @Bean
    public DirectExchange exchange() {
        return ExchangeBuilder.directExchange("order.exchange")
            .durable(true)
            .build();
    }
}

// 消费者：手动确认
@RabbitListener(queues = "order.queue")
public class OrderConsumer {
    public void handleMessage(String message) {
        try {
            processOrder(message);
            // 手动确认：告诉 Broker 消息处理成功了
            // 这样即使重启，消息也不会重复投递
        } catch (Exception e) {
            // 处理失败：拒绝消息，让它重新入队或进入死信队列
            throw new AmqpRejectAndDontRequeueException(e);
        }
    }
}
```

### 问题二：消息重复消费

消息可能因为网络问题被重复投递。**幂等性是必须的**。

```java
// 方案1：数据库唯一约束
public class OrderService {
    public void createOrder(OrderMessage message) {
        // 消息中包含唯一 ID，在数据库建唯一索引
        // 重复插入会失败，天然幂等
        try {
            orderDao.insert(message);
        } catch (DuplicateKeyException e) {
            // 幂等：重复消息直接返回成功
            log.info("Duplicate order: {}", message.getOrderId());
        }
    }
}

// 方案2：Redis 去重
public class OrderServiceWithDedup {
    private final StringRedisTemplate redis;

    public void createOrder(OrderMessage message) {
        String key = "order:dedup:" + message.getOrderId();

        // setIfAbsent 返回 true 表示是新消息
        // 返回 false 表示已处理过
        if (Boolean.TRUE.equals(redis.setIfAbsent(key, "1", Duration.ofDays(7)))) {
            doCreateOrder(message);
        } else {
            log.info("Duplicate order, skip: {}", message.getOrderId());
        }
    }
}
```

### 问题三：消息顺序

某些场景需要保证消息顺序，比如「先下单、再付款、再发货」。

```java
// Kafka 保证分区内的顺序
// 但不同分区之间不保证顺序
public class OrderProducer {
    public void sendOrderEvent(OrderEvent event) {
        // 关键：用订单 ID 作为分区 key
        // 同一个订单的所有事件会路由到同一个分区
        // 这样保证了同一订单的事件有序
        kafkaTemplate.send("order-events", event.getOrderId(), event);
    }
}

// RocketMQ 支持「顺序消息」特性
public class RocketOrderProducer {
    public void sendOrderEvent(OrderEvent event) {
        // 实现类内部会按消息顺序投递
        producer.sendOneway(event);
    }
}
```

### 问题四：消息积压

消费者挂了，或者消费速度跟不上生产速度，消息就会积压。

**解决方案**：

1. **增加消费者**：水平扩展，但要注意分区/队列数量限制
2. **批量消费**：一次拉取多条，减少网络开销
3. **跳过非关键消息**：先处理重要消息，非重要的后续再处理

```java
// 批量消费示例
@Bean
public SimpleRabbitListenerContainerFactory factory() {
    SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
    factory.setConnectionFactory(connectionFactory);

    // 每次拉取 10 条消息
    // prefetch 不能太大，否则会导致消息处理不均匀
    // 也不能太小，否则网络开销大
    factory.setPrefetchCount(10);

    // 并发消费：3 个线程同时处理
    factory.setConcurrentConsumers(3);
    factory.setMaxConcurrentConsumers(10);
    return factory;
}
```

## 事务消息：最难的问题

订单系统和 MQ 的事务一致性是个经典问题。

**场景**：下单成功后，消息发送失败，导致其他系统不知道这笔订单。

**解决**：RocketMQ 的事务消息

```java
// RocketMQ 事务消息
public class TransactionProducer {
    public void createOrder(Order order) {
        // 1. 先发送「半消息」，此时消费者看不到
        TransactionSendResult result = producer.sendMessageInTransaction(order, () -> {
            // 2. 执行本地事务（扣库存等）
            orderService.processOrder(order);

            // 3. 返回事务结果
            return LocalTransactionState.COMMIT_MESSAGE;
        });

        // 4. 根据结果决定后续操作
        if (result.getLocalTransactionState() == LocalTransactionState.ROLLBACK_MESSAGE) {
            // 本地事务失败，需要补偿
            orderService.compensate(order);
        }
    }
}

// Broker 会回调确认半消息状态
producer.setTransactionListener(new TransactionListener() {
    @Override
    public LocalTransactionState executeLocalTransaction(Message msg, Object arg) {
        // 本地事务执行，返回结果
        try {
            orderService.processOrder((Order) arg);
            return LocalTransactionState.COMMIT_MESSAGE;
        } catch (Exception e) {
            return LocalTransactionState.ROLLBACK_MESSAGE;
        }
    }

    @Override
    public LocalTransactionState checkLocalTransaction(MessageExt msg) {
        // Broker 不知道事务结果时，回调检查
        // 此时查数据库确认订单是否处理成功
        Order order = orderService.findOrderById(msg.getKeys());
        if (order != null && order.isProcessed()) {
            return LocalTransactionState.COMMIT_MESSAGE;
        }
        return LocalTransactionState.UNKNOW;
    }
});
```

## 面试中的加分回答

当面试官问「消息队列怎么保证不丢消息」时：

**初级回答**：
> 「开启消息持久化和消费者确认。」

**中级回答**：
> 「从生产者、Broker、消费者三个环节分析：
> 1. 生产者用确认机制
> 2. Broker 开启持久化和镜像队列
> 3. 消费者手动确认
> 4. 配合死信队列处理失败消息」

**高级回答**：
> 「除了三环节的保证，还要考虑：
> 1. 事务消息保证订单和消息的一致性
> 2. 消息幂等性设计
> 3. 监控告警，及时发现积压
> 4. 定期演练，验证消息可靠性
>
> 另外，不是所有场景都需要这么高可靠性，要根据业务权衡。」

## 总结

消息队列的核心价值：
1. **异步**：提升响应速度
2. **削峰**：保护下游系统
3. **解耦**：系统间松耦合

使用消息队列的代价：
1. **复杂度增加**：需要处理消息丢失、重复、顺序问题
2. **延迟增加**：异步意味着用户感知到结果的延迟
3. **运维成本**：MQ 本身需要监控和维护

**技术选型没有银弹，只有权衡。** 用 MQ 能解决你的问题吗？先想清楚这个问题。
