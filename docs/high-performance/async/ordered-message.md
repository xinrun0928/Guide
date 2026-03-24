# 顺序消息实现：单队列 + 单消费者 vs 分区顺序 + 哈希路由

「用户下单后，先扣库存，再扣余额，最后发货。消息顺序乱了！」

「结果用户收到货了，但余额没扣！」

这是顺序消息的经典坑。

消息队列的顺序问题，表面上是技术问题，本质是对业务模型的抽象理解问题。

## 为什么消息会乱序

### Kafka 分区导致的消息乱序

```
正常顺序：
消息1（下单） → 消息2（扣库存） → 消息3（扣余额） → 消息4（发货）

乱序场景（2 个分区）：
分区 0：消息1（下单）、消息3（扣余额）
分区 1：消息2（扣库存）、消息4（发货）

消费者 A（消费分区 0）：先处理下单，再扣余额
消费者 B（消费分区 1）：先扣库存，后发货

结果：余额扣了，但库存还没扣！顺序乱了！
```

### 乱序的根本原因

```
┌─────────────────────────────────────────────────────┐
│ 乱序的本质：并发处理 + 网络延迟                       │
│                                                     │
│ 消息 A（先发） ──┐                                   │
│                 ├──→ Broker ──→ 消费者处理 ──→ 顺序不可控 │
│ 消息 B（后发） ──┘                                   │
│                                                     │
│ 时间线：                                             │
│ T=0: 发送消息 A                                       │
│ T=1: 发送消息 B                                       │
│ T=2: B 先到达 Broker                                  │
│ T=3: A 后到达 Broker                                  │
│ T=4: B 先被消费者拉取                                  │
│ T=5: A 后被消费者拉取                                  │
│ T=6: B 先处理完成                                     │
│ T=7: A 后处理完成                                     │
│                                                     │
│ 结果：B 先于 A 处理完成                                │
└─────────────────────────────────────────────────────┘
```

## 顺序消息的实现方案

### 方案一：单队列 + 单消费者（简单粗暴）

**原理**：所有消息进入一个队列，一个消费者串行处理。

```
┌──────────────────────────────────────┐
│         单一队列顺序方案               │
│                                      │
│  生产者                               │
│    │                                 │
│    ├─ 消息1 ──┐                       │
│    ├─ 消息2 ──┼──→ [队列] ──→ [消费者1] │
│    └─ 消息3 ──┘                       │
│                                      │
│  特点：                               │
│  ✓ 实现简单，顺序绝对可靠               │
│  ✗ 吞吐量低，无法并行                  │
│  ✗ 消费者挂了，整条队列停止             │
└──────────────────────────────────────┘
```

**Kafka 实现**：

```java
// Kafka 单队列顺序
public class KafkaSingleQueueProducer {
    
    private final KafkaTemplate&lt;String, String&gt; template;
    
    public void sendOrderMessage(OrderMessage message) {
        // 所有消息发送到同一分区
        // 注意：这里用固定的 Key 或不设置 Key
        // 不设置 Key 时，Kafka 会轮询发送到不同分区
        // 要保证顺序，必须设置相同的 Key，或者只用 1 个分区
        
        ProducerRecord&lt;String, String&gt; record = new ProducerRecord&lt;&gt;(
            "order-events",
            "order-queue",  // 固定的 Key，所有消息到同一分区
            JSON.toJSONString(message)
        );
        
        template.send(record);
    }
}

public class KafkaSingleQueueConsumer {
    
    private final KafkaConsumer&lt;String, String&gt; consumer;
    
    public void consume() {
        // 只订阅一个 Topic，不设置分区
        consumer.subscribe(Arrays.asList("order-events"));
        
        while (true) {
            ConsumerRecords&lt;String, String&gt; records = consumer.poll(Duration.ofMillis(100));
            
            // 单线程顺序处理
            for (ConsumerRecord&lt;String, String&gt; record : records) {
                processMessage(record);
            }
            
            // 每条消息处理完再提交
            consumer.commitSync();
        }
    }
}
```

**RabbitMQ 实现**：

```java
// RabbitMQ 单队列顺序
@Configuration
public class SingleQueueConfig {
    
    @Bean
    public Queue orderQueue() {
        // 单队列，不设置任何特殊参数
        return new Queue("order.queue", true);
    }
    
    @Bean
    public DirectExchange orderExchange() {
        return new DirectExchange("order.exchange");
    }
    
    @Bean
    public Binding orderBinding() {
        return BindingBuilder.bind(orderQueue())
            .to(orderExchange())
            .with("order.created");
    }
}

@Service
public class OrderConsumer {
    
    @RabbitListener(queues = "order.queue", concurrency = "1")
    public void handleOrder(Order order) {
        // concurrency = 1 表示只有 1 个消费者
        // 单线程处理，保证顺序
        processOrder(order);
    }
}
```

### 方案二：分区顺序 + 哈希路由（推荐）

**原理**：相同 Key 的消息发送到同一分区，每个分区由单个消费者处理。

```
┌─────────────────────────────────────────────────────────┐
│              分区顺序方案                                │
│                                                          │
│  生产者                                                   │
│  │                                                       │
│  ├─ 订单 A (userId=100) ──┐                              │
│  │                        ├──→ [分区 0] → 消费者 A      │
│  ├─ 订单 B (userId=200) ──┼──→ [分区 1] → 消费者 B      │
│  │                        │                              │
│  ├─ 订单 C (userId=100) ──┴──→ [分区 0] → 消费者 A      │
│                                                          │
│  结果：                                                   │
│  - 用户 100 的订单全在分区 0                              │
│  - 用户 200 的订单全在分区 1                              │
│  - 每个用户的订单顺序有保障                               │
└─────────────────────────────────────────────────────────┘
```

**Kafka 实现**：

```java
// 按用户 ID 哈希路由
public class KafkaHashRoutingProducer {
    
    public void sendUserMessages(Long userId, List&lt;OrderMessage&gt; messages) {
        for (OrderMessage message : messages) {
            ProducerRecord&lt;Long, String&gt; record = new ProducerRecord&lt;&gt;(
                "order-events",
                userId,  // 用 userId 作为 Key
                JSON.toJSONString(message)
            );
            template.send(record);
        }
    }
}

public class KafkaHashRoutingConsumer {
    
    public void consume() {
        consumer.subscribe(Arrays.asList("order-events"));
        
        while (true) {
            ConsumerRecords&lt;Long, String&gt; records = consumer.poll(Duration.ofMillis(100));
            
            // 按 Key 分组处理
            Map&lt;Long, List&lt;ConsumerRecord&lt;Long, String&gt;&gt;&gt; recordsByKey = 
                new HashMap&lt;&gt;();
            
            for (ConsumerRecord&lt;Long, String&gt; record : records) {
                recordsByKey.computeIfAbsent(record.key(), k -&gt; new ArrayList&lt;&gt;())
                    .add(record);
            }
            
            // 每个 Key 内部按 offset 顺序处理
            for (Map.Entry&lt;Long, List&lt;ConsumerRecord&lt;Long, String&gt;&gt;&gt; entry : recordsByKey.entrySet()) {
                List&lt;ConsumerRecord&lt;Long, String&gt;&gt; keyRecords = entry.getValue();
                // 按 offset 排序
                keyRecords.sort(Comparator.comparing(ConsumerRecord::offset));
                
                for (ConsumerRecord&lt;Long, String&gt; record : keyRecords) {
                    processMessage(record);
                }
            }
            
            consumer.commitSync();
        }
    }
}
```

**分区数与消费者数的关系**：

```java
// 分区数 = 用户数 / 单分区用户数
// 如果有 100 万用户，每个分区服务 10 万用户
// 则需要至少 10 个分区

// 消费者数 = 分区数（最佳情况）
// 10 个分区 → 10 个消费者
// 每个消费者绑定 1 个分区，顺序处理
```

### 方案三：消息类型 + 顺序窗口（高级）

**原理**：将消息分为不同类型，每个类型保证顺序，不同类型可以并行。

```java
// 按消息类型分区
public class MessageTypeRouter {
    
    public void sendMessage(OrderEvent event) {
        String key;
        String topic;
        
        switch (event.getType()) {
            case "CREATE":
                topic = "order-create";
                key = event.getOrderId();  // 按订单 ID 路由
                break;
            case "PAY":
                topic = "order-pay";
                key = event.getOrderId();  // 同一个订单的支付
                break;
            case "SHIP":
                topic = "order-ship";
                key = event.getOrderId();  // 同一个订单的发货
                break;
            default:
                throw new IllegalArgumentException("Unknown type: " + event.getType());
        }
        
        ProducerRecord&lt;String, String&gt; record = new ProducerRecord&lt;&gt;(topic, key, JSON.toJSONString(event));
        template.send(record);
    }
}

// 消费者分别处理不同类型的消息
@RabbitListener(queues = "order-create-queue")
public void handleOrderCreate(Order order) {
    // 创建订单
}

@RabbitListener(queues = "order-pay-queue")
public void handleOrderPay(Payment payment) {
    // 支付扣款
}

@RabbitListener(queues = "order-ship-queue")
public void handleOrderShip(Shipment shipment) {
    // 发货
}
```

## 三种方案对比

| 特性 | 单队列单消费者 | 分区顺序路由 | 消息类型分组 |
|------|--------------|------------|-------------|
| 实现复杂度 | 低 | 中 | 高 |
| 吞吐量 | 低 | 中~高 | 高 |
| 顺序保证 | 绝对 | 相对（Key 内） | 相对（类型内） |
| 容错性 | 差（单点） | 好 | 好 |
| 适用场景 | 简单顺序场景 | 用户级别顺序 | 多业务并行 |
| 扩展性 | 差 | 好 | 好 |

## 顺序消息的注意事项

### 1. 消费失败的处理

```java
// 顺序消息消费失败，绝对不能跳过！
// 错误做法：
public void handleMessage(Message msg) {
    try {
        process(msg);
    } catch (Exception e) {
        // 跳过继续处理 → 顺序乱了！
        log.error("处理失败，跳过", e);
    }
}

// 正确做法：
public void handleMessage(Message msg) {
    try {
        process(msg);
    } catch (Exception e) {
        // 暂停当前消费者
        pauseConsumer();
        
        // 记录失败，触发告警
        alertService.send("顺序消息处理失败: " + msg);
        
        // 重试或人工处理
        retryLater(msg);
    }
}
```

### 2. 消费者异常恢复

```java
@Service
public class OrderConsumer {
    
    private volatile boolean paused = false;
    
    @RabbitListener(queues = "order.queue")
    public void handleOrder(Order order) {
        if (paused) {
            throw new RuntimeException("消费者已暂停");
        }
        
        try {
            processOrder(order);
        } catch (Exception e) {
            handleFailure(order, e);
        }
    }
    
    private void handleFailure(Order order, Exception e) {
        paused = true;
        
        // 1. 将当前消息重新入队（不是 ack）
        // 2. 等待处理完成后恢复
        // 3. 触发告警，人工介入
        
        alertService.send("订单处理失败，需要人工处理: " + order.getOrderId());
        
        // 延迟恢复
        schedule.reschedule(() -&gt; {
            paused = false;
        }, Duration.ofMinutes(5));
    }
}
```

### 3. 顺序与性能的平衡

```
性能优化建议：

1. 按业务拆分
   - 核心流程保证顺序：下单→支付→发货
   - 非核心流程可以乱序：日志、统计

2. 批量顺序处理
   - 不是一条一条处理
   - 而是批量拉取，按顺序处理
   - 失败时整批重试

3. 读写分离
   - 读操作可以乱序
   - 写操作保证顺序
```

## 实战案例：电商订单流程

### 业务场景

```
下单流程：
1. 创建订单（CREATE）
2. 锁定库存（LOCK_INVENTORY）
3. 扣减库存（扣库存）
4. 扣减余额（扣余额）
5. 创建物流（CREATE_SHIPMENT）

要求：
- 同一订单的操作必须按顺序执行
- 不同订单之间可以并行
```

### Kafka 实现

```java
// 订单消息
public class OrderEvent {
    private String orderId;
    private String userId;
    private OrderEventType type;
    private Object payload;
    private long sequence;  // 消息序号
}

public class OrderEventProducer {
    
    public void sendOrderEvent(String orderId, String userId, 
                               OrderEventType type, Object payload, long sequence) {
        OrderEvent event = new OrderEvent(orderId, userId, type, payload, sequence);
        
        ProducerRecord&lt;String, String&gt; record = new ProducerRecord&lt;&gt;(
            "order-events",
            orderId,  // 按订单 ID 路由
            JSON.toJSONString(event)
        );
        
        template.send(record);
    }
}

public class OrderEventConsumer {
    
    private final Map&lt;String, Long&gt; processedSequence = new ConcurrentHashMap&lt;&gt;();
    
    public void consume() {
        consumer.subscribe(Arrays.asList("order-events"));
        
        while (true) {
            ConsumerRecords&lt;String, String&gt; records = consumer.poll(Duration.ofMillis(100));
            
            // 按订单 ID 分组
            Map&lt;String, List&lt;ConsumerRecord&lt;String, String&gt;&gt;&gt; orders = 
                records.records(new TopicPartition("order-events", 0))
                    .stream()
                    .collect(Collectors.groupingBy(ConsumerRecord::key));
            
            for (Map.Entry&lt;String, List&lt;ConsumerRecord&lt;String, String&gt;&gt;&gt; entry : orders.entrySet()) {
                String orderId = entry.getKey();
                List&lt;ConsumerRecord&lt;String, String&gt;&gt; orderRecords = entry.getValue();
                
                // 按 offset 排序
                orderRecords.sort(Comparator.comparing(ConsumerRecord::offset));
                
                for (ConsumerRecord&lt;String, String&gt; record : orderRecords) {
                    OrderEvent event = JSON.parseObject(record.value(), OrderEvent.class);
                    
                    // 检查序列号，防止重复消费
                    Long lastSeq = processedSequence.get(orderId);
                    if (lastSeq != null && event.getSequence() &lt;= lastSeq) {
                        continue;  // 跳过已处理的消息
                    }
                    
                    processEvent(event);
                    processedSequence.put(orderId, event.getSequence());
                }
            }
            
            consumer.commitSync();
        }
    }
    
    private void processEvent(OrderEvent event) {
        switch (event.getType()) {
            case CREATE:
                createOrder(event);
                break;
            case LOCK_INVENTORY:
                lockInventory(event);
                break;
            case DEDUCT_INVENTORY:
                deductInventory(event);
                break;
            case DEDUCT_BALANCE:
                deductBalance(event);
                break;
            case CREATE_SHIPMENT:
                createShipment(event);
                break;
        }
    }
}
```

## 总结

顺序消息实现要点：

| 方案 | 实现方式 | 适用场景 |
|------|---------|---------|
| 单队列 | 1 分区 + 1 消费者 | 简单顺序、低吞吐 |
| 分区路由 | 按 Key 哈希分区 | 用户级顺序、高吞吐 |
| 消息类型 | 按类型分 Topic | 多业务并行 |

**关键点**：
1. 顺序的关键是**相同 Key 到同一分区**
2. 消费端**按分区顺序处理**
3. 失败时**不能跳过**，必须暂停或重试
4. 在**顺序和性能**之间找平衡

---

## 留给你的问题

假设你的转账系统需要保证顺序：

1. 用户 A 转账给用户 B，流程是：扣款 → 记录流水 → 通知收款人。如果扣款成功但记录流水失败，消息怎么处理？重试会导致重复扣款吗？
2. 如果用户 A 短时间内发起多笔转账（每笔 100 元），消息顺序乱了会导致什么问题？如何解决？
3. 系统要支持 100 万用户并发转账，每个用户平均每秒 0.1 笔。如果用分区顺序方案，需要多少个分区？
4. 如果某个分区所在的 Broker 挂了，消息会怎样？如何保证顺序不被打乱？

思考这些问题，能帮助你设计更健壮的顺序消息系统。
