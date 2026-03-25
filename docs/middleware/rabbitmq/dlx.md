# RabbitMQ 死信队列（DLX）与延迟队列

订单超时未支付怎么办？

很多系统会这么做：消费者收到订单消息后，延迟 30 分钟再检查订单状态，如果还没支付，就关闭订单。

但问题是：消费者收到消息后立即处理，怎么实现延迟？

难道要在内存里等 30 分钟？消费者重启了怎么办？

这就是今天要聊的问题：RabbitMQ 的死信队列（DLX）和延迟队列。

## 一、死信队列（DLX）：消息的"后备站"

### 什么是死信？

当消息在队列中遇到以下情况时，就会变成"死信"（Dead Letter）：

| 触发条件 | 说明 |
|---------|------|
| 消息被消费者拒绝 | 使用 `basicReject` 或 `basicNack` 且 `requeue=false` |
| 消息过期 | 超过队列或消息的 TTL |
| 队列达到最大长度 | 队列已满，新消息被丢弃 |
| 消息被拒绝且超过重试次数 | 常见于业务处理失败场景 |

变成死信的消息，会被发送到**死信交换机（Dead Letter Exchange）**，然后路由到**死信队列（Dead Letter Queue）**。

### DLX 工作原理

```
                         ┌──────────────────────────────────┐
                         │          普通队列                 │
                         │                                  │
                         │  消息 1 ──▶ 消息 2 ──▶ 消息 3    │
                         │                                  │
                         │  处理失败 ──▶ basicNack ──▶ ✗    │
                         └──────────────┬───────────────────┘
                                        │
                              x-dead-letter-exchange
                                        │
                                        ▼
                         ┌──────────────────────────────────┐
                         │        死信交换机                 │
                         │                                  │
                         │        (dlx.exchange)            │
                         └──────────────┬───────────────────┘
                                        │
                              x-dead-letter-routing-key
                                        │
                                        ▼
                         ┌──────────────────────────────────┐
                         │        死信队列                   │
                         │                                  │
                         │  死信消息 1 ──▶ 死信消息 2        │
                         └──────────────────────────────────┘
```

### 配置死信队列

```java
// 1. 声明死信交换机
channel.exchangeDeclare("dlx.exchange", "direct", true);

// 2. 声明死信队列
channel.queueDeclare("dlx.order.queue", true, false, false, null);

// 3. 绑定死信队列到死信交换机
channel.queueBind("dlx.order.queue", "dlx.exchange", "dlx.order");

// 4. 在普通队列上配置死信交换机
Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
args.put("x-dead-letter-exchange", "dlx.exchange");
args.put("x-dead-letter-routing-key", "dlx.order");

channel.queueDeclare("order.queue", true, false, false, args);
```

### Spring Boot 配置死信队列

```yaml
spring:
  rabbitmq:
    listener:
      simple:
        retry:
          enabled: true
          initial-interval: 1000
          max-attempts: 3
          max-interval: 10000
          multiplier: 2.0
```

```java
@Configuration
public class DeadLetterConfig {

    @Bean
    public DirectExchange dlxExchange() {
        return new DirectExchange("dlx.exchange", true, false);
    }

    @Bean
    public Queue dlxQueue() {
        return QueueBuilder.durable("dlx.order.queue").build();
    }

    @Bean
    public Binding dlxBinding() {
        return BindingBuilder
            .bind(dlxQueue())
            .to(dlxExchange())
            .with("dlx.order");
    }

    @Bean
    public Queue orderQueue() {
        return QueueBuilder.durable("order.queue")
            .deadLetterExchange("dlx.exchange")
            .deadLetterRoutingKey("dlx.order")
            .build();
    }
}
```

## 二、延迟队列：消息的"定时器"

### 延迟队列的应用场景

延迟队列在实际业务中非常有用：

| 场景 | 说明 |
|------|------|
| 订单超时关闭 | 下单后 30 分钟未支付，自动关闭订单 |
| 消息重试 | 处理失败后延迟重试 |
| 定时任务 | 定时发送通知、提醒 |
| 限流控制 | 控制请求速率，防止突发流量 |

### 实现方案一：消息 TTL + 死信队列

这是 RabbitMQ 原生支持的延迟队列实现方式：

```
                                    ┌─────────────────────────────────┐
                                    │        延迟交换机 (x-delayed)   │
                                    └───────────────┬─────────────────┘
                                                    │
                                    ┌───────────────▼─────────────────┐
                                    │            延迟队列                 │
                                    │                                   │
                                    │  消息延迟 30 分钟 ──▶ 过期        │
                                    │  (x-message-ttl = 1800000)        │
                                    └───────────────┬─────────────────┘
                                                    │
                                          x-dead-letter-exchange
                                                    │
                                                    ▼
                                    ┌─────────────────────────────────┐
                                    │        业务交换机                 │
                                    └───────────────┬─────────────────┘
                                                    │
                                                    ▼
                                    ┌─────────────────────────────────┐
                                    │        业务队列                   │
                                    └─────────────────────────────────┘
```

```java
// 声明延迟队列（设置消息 TTL）
Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
// x-dead-letter-exchange 和 x-dead-letter-routing-key 必须配置
// 这样消息过期后才能被死信交换机路由到真正的业务队列
args.put("x-dead-letter-exchange", "order.exchange");
args.put("x-dead-letter-routing-key", "order.timeout");
args.put("x-message-ttl", 1800000);  // 30 分钟 = 1800000 毫秒

channel.queueDeclare("delay.order.queue", true, false, false, args);

// 绑定延迟队列
channel.queueBind("delay.order.queue", "delay.exchange", "order.delay");

// 发送延迟消息
channel.basicPublish("delay.exchange", "order.delay",
    MessageProperties.PERSISTENT_TEXT_PLAIN,
    orderId.getBytes());
```

### 实现方案二：延迟交换机插件（推荐）

RabbitMQ 提供了一个 `rabbitmq_delayed_message_exchange` 插件，可以直接实现延迟发送，不需要死信队列：

```bash
# 安装延迟消息交换机插件
rabbitmq-plugins enable rabbitmq_delayed_message_exchange
```

```java
// 声明延迟交换机（类型为 x-delayed-message）
Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
args.put("x-delayed-type", "direct");
channel.exchangeDeclare("order.delay.exchange", "x-delayed-message",
    true, false, args);

// 发送延迟消息（需要设置 x-delay 头）
AMQP.BasicProperties properties = new AMQP.BasicProperties.Builder()
    .headers(Map.of("x-delay", 30000))  // 延迟 30 秒
    .deliveryMode(2)
    .build();

channel.basicPublish("order.delay.exchange", "order.created",
    properties, message.getBytes());
```

```java
// Spring Boot 配置延迟交换机
@Bean
public CustomExchange delayExchange() {
    Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
    args.put("x-delayed-type", "direct");
    return new CustomExchange("order.delay.exchange", "x-delayed-message",
        true, false, args);
}

@Bean
public Queue delayQueue() {
    return QueueBuilder.durable("delay.order.queue").build();
}

@Bean
public Binding delayBinding() {
    return BindingBuilder.bind(delayQueue())
        .to(delayExchange())
        .with("order.created")
        .noargs();
}
```

### 两种延迟队列方案对比

| 特性 | TTL + DLX 方案 | 延迟交换机插件 |
|------|---------------|---------------|
| 延迟精度 | 秒级 | 毫秒级 |
| 延迟范围 | 受限于 TTL | 可精确控制 |
| 实现复杂度 | 中等 | 简单 |
| 消息堆积 | 延迟队列会堆积 | 不堆积 |
| 性能 | 一般 | 较好 |
| 插件依赖 | 无需插件 | 需要安装插件 |

## 三、实战：订单超时关闭

### 业务场景

用户下单后，系统延迟 30 分钟检查订单状态。如果仍未支付，自动关闭订单。

```
用户下单 ──▶ 发送延迟消息（30 分钟）──▶ 检查订单状态 ──▶ 未支付？──▶ 关闭订单
                                                   │
                                                   └── 已支付？──▶ 忽略
```

### 完整实现

```java
// 1. 配置类
@Configuration
public class OrderTimeoutConfig {

    @Bean
    public CustomExchange orderDelayExchange() {
        Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
        args.put("x-delayed-type", "direct");
        return new CustomExchange("order.delay.exchange",
            "x-delayed-message", true, false, args);
    }

    @Bean
    public Queue orderTimeoutQueue() {
        return QueueBuilder.durable("order.timeout.queue").build();
    }

    @Bean
    public Binding orderTimeoutBinding() {
        return BindingBuilder
            .bind(orderTimeoutQueue())
            .to(orderDelayExchange())
            .with("order.timeout")
            .noargs();
    }
}

// 2. 订单服务
@Service
public class OrderService {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    @Autowired
    private OrderMapper orderMapper;

    public void createOrder(Order order) {
        // 保存订单
        orderMapper.insert(order);

        // 发送延迟消息，30 分钟后检查订单状态
        rabbitTemplate.convertAndSend(
            "order.delay.exchange",
            "order.timeout",
            order.getId(),
            message -> {
                message.getMessageProperties().setHeader("x-delay", 1800000);
                return message;
            }
        );
    }

    // 3. 延迟消息消费者
    @RabbitListener(queues = "order.timeout.queue")
    public void handleOrderTimeout(String orderId) {
        Order order = orderMapper.findById(orderId);
        if (order == null) {
            return;
        }

        if ("UNPAID".equals(order.getStatus())) {
            // 仍未支付，关闭订单
            order.setStatus("CLOSED");
            orderMapper.update(order);
            log.info("订单 {} 已超时关闭", orderId);
        } else {
            // 已支付，忽略
            log.info("订单 {} 已支付，忽略超时检查", orderId);
        }
    }
}
```

## 四、死信队列的高级用法

### 1. 分类处理不同类型的死信

```java
// 不同类型的消息，使用不同的死信路由键
Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();

// 根据不同场景设置死信交换机
args.put("x-dead-letter-exchange", "dlx.exchange");

// 消息处理失败（业务异常）
args.put("x-dead-letter-routing-key", "dlx.order.business-error");

// 消息处理失败（系统异常）
// 通过消息头区分
```

### 2. 死信队列的幂等处理

死信队列的消费者也需要幂等处理：

```java
@RabbitListener(queues = "dlx.order.queue")
public void handleDeadLetter(String orderId, Channel channel,
                             @Header(AmqpHeaders.DELIVERY_TAG) long tag) {
    try {
        // 检查订单是否已经处理过
        if (deadLetterService.isProcessed(orderId)) {
            channel.basicAck(tag, false);
            return;
        }

        // 处理死信：记录日志、发送告警、人工处理等
        deadLetterService.process(orderId);

        channel.basicAck(tag, false);
    } catch (Exception e) {
        log.error("处理死信失败: {}", orderId, e);
        channel.basicNack(tag, false, false);  // 不要再重试，进入系统告警
    }
}
```

## 五、面试追问

### 死信队列和普通队列有什么区别？

从技术实现上看，死信队列和普通队列**没有任何区别**。

死信队列的本质是：

1. 普通队列配置了 `x-dead-letter-exchange` 参数
2. 消息变成死信后，被路由到这个参数指定的交换机
3. 交换机根据路由键，把消息投递到配置好的队列

所以死信队列只是一个**普通队列**，只不过它的用途是处理"失败"的消息。

### 消息 TTL 和队列 TTL 有什么区别？

| 类型 | 设置方式 | 生效时机 |
|------|---------|---------|
| 消息 TTL | `x-message-ttl` 在消息属性上 | 每条消息独立的过期时间 |
| 队列 TTL | `x-expires` 在队列参数上 | 队列本身的过期时间 |

```java
// 队列 TTL：队列本身 1 小时后过期
Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
args.put("x-expires", 3600000);  // 毫秒
channel.queueDeclare("temp.queue", false, false, false, args);

// 消息 TTL：每条消息 30 秒后过期
AMQP.BasicProperties properties = new AMQP.BasicProperties.Builder()
    .expiration("30000")  // 字符串格式，单位毫秒
    .build();
channel.basicPublish("exchange", "routingKey", properties, message.getBytes());
```

### 延迟队列的消息会堆积吗？

使用 TTL + DLX 方案时，延迟队列会堆积消息直到过期。如果短时间内大量延迟消息，可能造成内存压力。

使用延迟交换机插件时，消息会被延迟交换机持有，不会进入普通队列。插件内部使用 Erlang 的定时器实现延迟，效率更高。

---

下一个问题留给你：

现在我们已经了解了单节点 RabbitMQ 的工作原理。但如果消息量大了，单节点扛不住怎么办？

RabbitMQ 支持集群部署，但集群之间怎么保证消息不丢？怎么保证服务高可用？

下一节——[RabbitMQ 集群模式](/middleware/rabbitmq/cluster)会详细讲解。
