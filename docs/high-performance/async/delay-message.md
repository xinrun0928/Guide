# 延迟消息实现：RocketMQ 延迟等级 vs RabbitMQ 插件

用户下单后 30 分钟未付款，自动取消订单。

订单发货后 7 天自动确认收货。

这些场景，都需要「延迟消息」。

## 延迟消息的应用场景

```
┌────────────────────────────────────────────────────────────┐
│                    延迟消息典型场景                          │
│                                                             │
│  1. 订单超时取消                                              │
│     下单 ──[30分钟]──→ 检查支付状态 ──[未支付]──→ 取消订单    │
│                                                             │
│  2. 消息重试                                                 │
│     处理失败 ──[5秒]──→ 重新处理 ──[再失败]──→ [1分钟]──→ 重试│
│                                                             │
│  3. 定时任务                                                 │
│     创建任务 ──[指定时间]──→ 执行任务                        │
│                                                             │
│  4. 分布式锁延迟释放                                          │
│     加锁 ──[TTL]──→ 延迟释放（防止处理超时）                  │
│                                                             │
│  5. 异步通知                                                 │
│     订单创建 ──[10秒]──→ 发送短信 ──[30秒]──→ 发送push       │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

## RocketMQ 延迟消息

### 延迟等级原理

RocketMQ 原生支持延迟消息，但**只支持固定的 18 个延迟等级**：

| 等级 | 延迟时间 | 等级 | 延迟时间 |
|------|---------|------|---------|
| 1 | 1 秒 | 10 | 9 分钟 |
| 2 | 5 秒 | 11 | 10 分钟 |
| 3 | 10 秒 | 12 | 20 分钟 |
| 4 | 30 秒 | 13 | 30 分钟 |
| 5 | 1 分钟 | 14 | 1 小时 |
| 6 | 2 分钟 | 15 | 2 小时 |
| 7 | 3 分钟 | 16 | 3 小时 |
| 8 | 4 分钟 | 17 | 4 小时 |
| 9 | 5 分钟 | 18 | 5 小时 |

```java
// RocketMQ 延迟消息发送
public class RocketMQDelayProducer {
    
    public void sendDelayMessage(Order order, int delayLevel) {
        Message msg = new Message(
            "order-topic",
            "order-cancel",
            order.getOrderId(),
            JSON.toJSONString(order).getBytes()
        );
        
        // 设置延迟等级（1~18）
        msg.setDelayTimeLevel(delayLevel);
        
        // 发送
        producer.send(msg);
    }
    
    // 发送 30 分钟延迟的消息
    public void sendCancelOrderMessage(Order order) {
        sendDelayMessage(order, 13);  // 30 分钟
    }
}
```

### 自定义延迟时间

RocketMQ 原生不支持精确延迟，需要变通实现：

**方案一：定时扫描数据库**

```java
// 将延迟消息存入数据库，定时扫描执行
@Entity
public class DelayedTask {
    @Id
    private String taskId;
    private String bizType;  // order_cancel, reminder 等
    private String bizId;    // 订单 ID
    private String payload;  // 消息内容
    private LocalDateTime executeTime;  // 执行时间
    private int status;  // PENDING, EXECUTING, COMPLETED, FAILED
    private int retryCount;
}

// 定时任务扫描
@Service
public class DelayedTaskExecutor {
    
    @Autowired
    private DelayedTaskRepository repository;
    
    @Scheduled(fixedRate = 1000)  // 每秒扫描
    public void executeTasks() {
        List&lt;DelayedTask&gt; tasks = repository.findExecutableTasks(
            LocalDateTime.now(),
            100  // 每次最多取 100 条
        );
        
        for (DelayedTask task : tasks) {
            try {
                executeTask(task);
            } catch (Exception e) {
                handleFailure(task, e);
            }
        }
    }
    
    private void executeTask(DelayedTask task) {
        switch (task.getBizType()) {
            case "order_cancel":
                orderService.cancelOrder(task.getBizId());
                break;
            case "order_reminder":
                notificationService.sendReminder(task.getBizId());
                break;
        }
        
        task.setStatus(DelayedTaskStatus.COMPLETED);
        repository.save(task);
    }
}
```

**方案二：时间轮算法**

```java
// 时间轮实现精确延迟
public class TimingWheel {
    
    private final int tickMs;      // 每格时间（毫秒）
    private final int wheelSize;   // 轮子大小
    private final long startMs;    // 开始时间
    
    private final TimerTaskList[] wheel;
    private final Map&lt;String, TimerTask&gt; taskMap;
    
    public TimingWheel(int tickMs, int wheelSize) {
        this.tickMs = tickMs;
        this.wheelSize = wheelSize;
        this.wheel = new TimerTaskList[wheelSize];
        this.taskMap = new ConcurrentHashMap&lt;&gt;();
        
        for (int i = 0; i &lt; wheelSize; i++) {
            wheel[i] = new TimerTaskList();
        }
    }
    
    // 添加延迟任务
    public void addTask(TimerTask task, long delayMs) {
        long expiration = System.currentTimeMillis() + delayMs;
        task.setExpiration(expiration);
        
        // 计算任务应该放在哪个槽
        long virtualId = expiration - startMs;
        int slot = (int) ((virtualId / tickMs) % wheelSize);
        
        TimerTaskList bucket = wheel[slot];
        bucket.addTask(task);
        taskMap.put(task.getTaskId(), task);
    }
    
    // 推进时间轮
    public void advanceClock(long timeoutMs) {
        // 推进逻辑...
    }
}
```

## RabbitMQ 延迟消息

### 方式一：TTL + 死信队列

RabbitMQ 通过消息 TTL 和死信队列实现延迟消息：

```
┌─────────────────────────────────────────────────────────────────┐
│              RabbitMQ 延迟消息原理                               │
│                                                                  │
│  ┌─────────────┐     TTL      ┌─────────────┐     DLX      ┌────────┐
│  │ delay-queue │ ──────────&gt; │ 消息过期     │ ──────────&gt; │  real- │ │
│  │ (暂时存储)  │             │             │             │ queue  │ │
│  └─────────────┘             └─────────────┘             └────────┘
│                                                                  │
│  延迟时间 = 消息 TTL                                               │
│  消息过期后，通过死信交换机（DLX）路由到真正的消费者               │
└─────────────────────────────────────────────────────────────────┘
```

```java
@Configuration
public class RabbitMQDelayConfig {
    
    // 1. 创建延迟交换机（死信交换机）
    @Bean
    public DirectExchange delayExchange() {
        return new DirectExchange("delay.exchange");
    }
    
    // 2. 创建延迟队列（设置 TTL 和 DLX）
    @Bean
    public Queue delayQueue() {
        Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
        
        // 死信交换机
        args.put("x-dead-letter-exchange", "delay.exchange");
        args.put("x-dead-letter-routing-key", "delay.done");
        
        // 消息 TTL：30 分钟（毫秒）
        args.put("x-message-ttl", 30 * 60 * 1000);
        
        return new Queue("delay.queue", true, false, false, args);
    }
    
    // 3. 绑定延迟队列
    @Bean
    public Binding delayBinding() {
        return BindingBuilder.bind(delayQueue())
            .to(delayExchange())
            .with("delay.pending");
    }
    
    // 4. 创建真实队列（消费者）
    @Bean
    public Queue realQueue() {
        return new Queue("real.queue", true);
    }
    
    @Bean
    public Binding realBinding() {
        return BindingBuilder.bind(realQueue())
            .to(delayExchange())
            .with("delay.done");
    }
}

@Service
public class DelayMessageProducer {
    
    @Autowired
    private RabbitTemplate rabbitTemplate;
    
    // 发送延迟消息
    public void sendDelayMessage(Order order) {
        rabbitTemplate.convertAndSend(
            "delay.exchange",
            "delay.pending",
            order,
            message -&gt; {
                // 可以覆盖队列的 TTL，设置单个消息的延迟
                // message.getMessageProperties().setExpiration("1800000");
                return message;
            }
        );
    }
}

@Service
public class DelayMessageConsumer {
    
    @RabbitListener(queues = "real.queue")
    public void handleRealMessage(Order order) {
        // 处理真实消息
        processOrder(order);
    }
}
```

### 方式二：延迟插件（推荐）

RabbitMQ 3.8+ 支持 `rabbitmq_delayed_message_exchange` 插件，支持精确延迟：

```bash
# 安装插件
rabbitmq-plugins enable rabbitmq_delayed_message_exchange

# 配置延迟交换机
rabbitmqctl set_policy delayed "^delay\." \
    '{"插件类型":"x-delayed-message","类型":"direct"}' \
    --priority 1 \
    --apply-to exchanges
```

```java
@Configuration
public class DelayedExchangeConfig {
    
    @Bean
    public CustomExchange delayedExchange() {
        Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
        args.put("x-delayed-type", "direct");
        return new CustomExchange("delayed.exchange", "x-delayed-message", true, false, args);
    }
    
    @Bean
    public Queue delayedQueue() {
        return new Queue("delayed.queue", true);
    }
    
    @Bean
    public Binding delayedBinding() {
        return BindingBuilder.bind(delayedQueue())
            .to(delayedExchange())
            .with("delayed.key")
            .noargs();
    }
}

@Service
public class DelayedMessageProducer {
    
    @Autowired
    private RabbitTemplate rabbitTemplate;
    
    // 发送精确延迟消息
    public void sendDelayedMessage(Order order, int delayMs) {
        rabbitTemplate.convertAndSend(
            "delayed.exchange",
            "delayed.key",
            order,
            message -&gt; {
                // 设置延迟时间（毫秒）
                message.getMessageProperties().setHeader("x-delay", delayMs);
                return message;
            }
        );
    }
    
    // 发送 30 分钟延迟的消息
    public void sendCancelOrderMessage(Order order) {
        sendDelayedMessage(order, 30 * 60 * 1000);
    }
    
    // 发送不同延迟的消息
    public void sendMultiDelayMessages(Order order) {
        // 10 分钟后检查支付
        sendDelayedMessage(order, 10 * 60 * 1000);
        
        // 30 分钟后取消
        sendDelayedMessage(order, 30 * 60 * 1000);
        
        // 2 小时后发送收货提醒
        sendDelayedMessage(order, 2 * 60 * 60 * 1000);
    }
}
```

### 方式三：Redis 延迟队列

```java
// 基于 Redis ZSet 实现延迟队列
@Service
public class RedisDelayQueue {
    
    @Autowired
    private StringRedisTemplate redisTemplate;
    
    private static final String DELAY_QUEUE_KEY = "delay:queue:";
    
    // 添加延迟任务
    public void addDelayTask(String bizType, String bizId, Object payload, long delayMs) {
        String key = DELAY_QUEUE_KEY + bizType;
        long executeTime = System.currentTimeMillis() + delayMs;
        
        // ZSet：score = 执行时间
        redisTemplate.opsForZSet().add(
            key,
            JSON.toJSONString(new DelayTask(bizId, payload)),
            executeTime
        );
    }
    
    // 消费延迟任务
    @Scheduled(fixedRate = 1000)  // 每秒检查
    public void pollDelayTasks() {
        String[] keys = redisTemplate.keys(DELAY_QUEUE_KEY + "*");
        if (keys == null) return;
        
        long now = System.currentTimeMillis();
        
        for (String key : keys) {
            String bizType = key.substring(DELAY_QUEUE_KEY.length());
            
            // 获取所有到期的任务
            Set&lt;String&gt; tasks = redisTemplate.opsForZSet()
                .rangeByScore(key, 0, now);
            
            for (String taskJson : tasks) {
                // 删除任务
                Long removed = redisTemplate.opsForZSet().remove(key, taskJson);
                if (removed == null) continue;  // 已被其他消费者处理
                
                DelayTask task = JSON.parseObject(taskJson, DelayTask.class);
                
                try {
                    executeTask(bizType, task);
                } catch (Exception e) {
                    handleFailure(bizType, task, e);
                }
            }
        }
    }
    
    private void executeTask(String bizType, DelayTask task) {
        switch (bizType) {
            case "order_cancel":
                orderService.cancelOrder(task.getBizId());
                break;
            case "payment_reminder":
                notificationService.sendReminder(task.getBizId());
                break;
        }
    }
}
```

## 三种延迟消息方案对比

| 特性 | RocketMQ 延迟等级 | RabbitMQ 插件 | Redis ZSet |
|------|------------------|--------------|-----------|
| 精确延迟 | 不支持 | 支持 | 支持 |
| 延迟精度 | 固定 18 个等级 | 毫秒级 | 秒级 |
| 延迟范围 | 1 秒 ~ 2 小时 | 任意时间 | 任意时间 |
| 消息堆积 | 无（到时投递） | 无 | 无 |
| 复杂度 | 低 | 中 | 中 |
| 性能 | 高 | 高 | 中 |
| 依赖 | RocketMQ | RabbitMQ + 插件 | Redis |

## 实战案例：订单超时取消

### 需求

```
1. 用户下单后 10 分钟内未支付：发送支付提醒
2. 用户下单后 30 分钟内未支付：自动取消订单
3. 订单取消后 24 小时：清理临时数据
```

### RocketMQ 实现

```java
// 订单创建时发送延迟消息
@Service
public class OrderService {
    
    @Autowired
    private RocketMQTemplate rocketMQTemplate;
    
    public void createOrder(Order order) {
        // 1. 创建订单
        orderRepository.save(order);
        
        // 2. 发送 10 分钟延迟消息（支付提醒）
        Message&lt;Order&gt; remindMsg = MessageBuilder
            .withPayload(order)
            .setHeader("type", "payment_remind")
            .build();
        rocketMQTemplate.asyncSend("order-delay-topic", remindMsg, new SendCallback() {
            @Override
            public void onSuccess(SendResult sendResult) {}
            
            @Override
            public void onException(Throwable e) {
                log.error("发送延迟消息失败", e);
            }
        }, 0, 4);  // delayLevel = 4（30 秒，用于测试）
        // 生产环境用 13（30 分钟）
        
        // 3. 发送 30 分钟延迟消息（取消订单）
        // 延迟等级 13 = 30 分钟
    }
}

@Service
public class OrderDelayConsumer {
    
    @RocketMQMessageListener(
        topic = "order-delay-topic",
        consumerGroup = "order-delay-consumer-group",
        selectorExpression = "*"
    )
    public void handleDelayMessage(ConsumeMessageContext context, Message msg) {
        Order order = JSON.parseObject(new String(msg.getBody()), Order.class);
        String type = msg.getHeaders().get("type", String.class);
        
        switch (type) {
            case "payment_remind":
                sendPaymentReminder(order);
                break;
            case "cancel":
                cancelUnpaidOrder(order);
                break;
        }
    }
}
```

### RabbitMQ 实现

```java
@Service
public class OrderService {
    
    @Autowired
    private RabbitTemplate rabbitTemplate;
    
    public void createOrder(Order order) {
        // 1. 创建订单
        orderRepository.save(order);
        
        // 2. 发送 10 分钟延迟消息（支付提醒）
        sendDelayMessage("payment_remind", order, 10 * 60 * 1000);
        
        // 3. 发送 30 分钟延迟消息（取消订单）
        sendDelayMessage("cancel_order", order, 30 * 60 * 1000);
    }
    
    private void sendDelayMessage(String type, Order order, int delayMs) {
        Map&lt;String, Object&gt; payload = new HashMap&lt;&gt;();
        payload.put("type", type);
        payload.put("orderId", order.getOrderId());
        payload.put("order", order);
        
        rabbitTemplate.convertAndSend(
            "delayed.exchange",
            "delay.key",
            payload,
            message -&gt; {
                message.getMessageProperties().setHeader("x-delay", delayMs);
                message.getMessageProperties().setCorrelationId(
                    type + ":" + order.getOrderId()
                );
                return message;
            }
        );
    }
}

@Service
public class OrderDelayConsumer {
    
    @RabbitListener(queues = "delayed.queue")
    public void handleDelayMessage(Map&lt;String, Object&gt; payload, Channel channel,
                                   @Header(AmqpHeaders.DELIVERY_TAG) long tag) {
        try {
            String type = (String) payload.get("type");
            String orderId = (String) payload.get("orderId");
            
            switch (type) {
                case "payment_remind":
                    sendPaymentReminder(orderId);
                    break;
                case "cancel_order":
                    cancelUnpaidOrder(orderId);
                    break;
            }
            
            channel.basicAck(tag, false);
        } catch (Exception e) {
            log.error("处理延迟消息失败", e);
            // 拒绝消息，不重试
            channel.basicNack(tag, false, false);
        }
    }
}
```

## 延迟消息的坑

### 坑 1：延迟消息堆积

```java
// TTL + 死信队列的坑：
// 如果消费者挂了，消息会一直在延迟队列里

// 解决方案：监控队列深度，设置告警
@Scheduled(fixedRate = 60000)
public void checkDelayQueueDepth() {
    int depth = getQueueMessageCount("delay.queue");
    
    if (depth > 10000) {
        alertService.send("延迟队列堆积告警: " + depth);
    }
}
```

### 坑 2：时钟不同步

```java
// 分布式环境下，各节点时钟可能不同步

// 解决方案：
// 1. 使用统一的时间服务器（NTP）
// 2. 延迟时间使用相对时间而非绝对时间
// 3. 在消息中携带发送时间，消费时检查

public class DelayTask {
    private String bizId;
    private long sendTime;  // 发送时间
    private long delayMs;    // 延迟毫秒数
    
    public boolean shouldExecute() {
        return System.currentTimeMillis() - sendTime &gt;= delayMs;
    }
}
```

### 坑 3：消息重复消费

```java
// 延迟消息可能重复投递

// 解决方案：消费端实现幂等性
@Service
public class OrderService {
    
    public void cancelUnpaidOrder(String orderId) {
        // 检查订单状态
        Order order = orderRepository.findById(orderId);
        
        if (order.getStatus() == OrderStatus.PAID) {
            // 已支付，跳过
            return;
        }
        
        if (order.getStatus() == OrderStatus.CANCELLED) {
            // 已取消，跳过（可能是重复消费）
            return;
        }
        
        // 执行取消
        order.setStatus(OrderStatus.CANCELLED);
        orderRepository.save(order);
    }
}
```

## 总结

延迟消息实现对比：

| 方案 | 延迟精度 | 实现复杂度 | 推荐场景 |
|------|---------|-----------|---------|
| RocketMQ 延迟等级 | 固定 18 等级 | 低 | 固定延迟场景 |
| RabbitMQ 插件 | 毫秒级 | 中 | 精确延迟需求 |
| RabbitMQ TTL+DLX | 毫秒级 | 中 | 简单延迟 |
| Redis ZSet | 秒级 | 中 | 小规模延迟 |
| 数据库扫描 | 任意 | 高 | 需要精确控制的场景 |

---

## 留给你的问题

假设你设计一个订单超时系统：

1. 用户下单后 30 分钟未支付自动取消。但 RocketMQ 只支持 18 个固定延迟等级，怎么实现 30 分钟延迟？
2. 如果延迟消息发送成功了，但消费者还没来得及处理，服务器重启了，消息会丢吗？怎么保证不丢？
3. 用户在下单后 29 分钟支付了，但 30 分钟的取消消息还在队列里。这时候取消消息来了，你怎么处理？
4. 如果你的系统每天有 1000 万订单，每个订单最多需要 3 个延迟消息（10 分钟提醒、30 分钟取消、7 天确认收货）。延迟消息系统能扛住吗？

思考这些问题，能帮助你设计更健壮的延迟消息系统。
