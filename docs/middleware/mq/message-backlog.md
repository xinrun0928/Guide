# 消息积压处理方案

凌晨 3 点，你的手机响了。

告警显示：消息队列积压了 50 万条消息，消费延迟 2 小时。老板打电话来：「系统怎么了？」

你揉揉眼睛，打开监控面板，发现问题：

```
消费速率：1000 条/秒
生产速率：10000 条/秒
积压数量：每分钟 +54000 条
预计恢复时间：never（除非你做点什么）
```

这就是**消息积压**——消费者的处理速度跟不上生产者的发送速度。

---

## 消息积压是怎么发生的？

### 原因一：消费者故障

```
正常情况：
Producer ──10000/s──► Broker ──10000/s──► Consumer ──处理──► 完成

消费者挂了：
Producer ──10000/s──► Broker ──0/s──► Consumer（挂了）
                                    ↑
                              积压开始！
```

### 原因二：消费端代码问题

```java
// 消费端代码 Bug 导致处理极慢
@KafkaListener(topics = "order-topic")
public void consumeOrder(OrderMessage message) {
    // 问题：每次消费都查数据库
    // 数据库连接池只有 10 个
    // 大量时间浪费在等待连接
    Connection conn = dataSource.getConnection();  // 等待...
    // 500ms 才能处理一条消息
    // 而生产速率是 10000/s
    processOrder(message);
}
```

### 原因三：业务量突增

```
预期流量：
          ★ 平时流量
实际流量：
          ★★★ 双十一
                    ★★★★★★★ 秒杀活动

消费者能力是固定的，但流量是突发的
```

### 原因四：消费者被限流

```java
// 限流配置过严
@RateLimiter(name = "orderConsumer", fallbackMethod = "fallback")
public void consumeOrder(OrderMessage message) {
    // 每秒只能处理 100 条
    // 实际流量 10000 条/s
    processOrder(message);
}
```

---

## 处理策略总览

| 策略 | 适用场景 | 见效速度 | 风险 |
|-----|---------|---------|-----|
| **消费者扩容** | 消费者不足 | 快 | 增加资源成本 |
| **消费者优化** | 代码性能问题 | 快 | 需要分析根因 |
| **消息丢弃** | 可容忍丢失 | 最快 | 数据丢失 |
| **消息迁移** | 长期积压 | 慢 | 需要扩容临时消费者 |
| **限流保护** | 防止雪崩 | 快 | 可能丢失消息 |
| **分区扩容** | 分区数不足 | 中 | 需要 Rebalance |

---

## 策略一：消费者快速扩容

这是**最直接**的方案。消费者处理不过来？加机器！

### Kafka 扩容消费者

```bash
# 查看当前消费者组状态
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --group order-processor --describe

# 输出示例：
# GROUP                TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
# order-processor      order-topic     0          100000           500000          400000
# order-processor      order-topic     1          95000            490000          395000
# order-processor      order-topic     2          98000            510000          412000

# 注意：LAG 列表示积压数量
# 如果 LAG 持续增长，说明消费速度跟不上生产速度
```

### 扩容步骤

```bash
# 1. 增加消费者实例（假设原来是 3 个，现在是 6 个）
# Kubernetes 环境：修改 Deployment 的 replicas

# 2. 验证消费者重新分配分区
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --group order-processor --describe

# 期望输出：每个消费者消费不同分区
# GROUP                TOPIC           PARTITION  CONSUMER
# order-processor      order-topic     0          consumer-1
# order-processor      order-topic     1          consumer-2
# order-processor      order-topic     2          consumer-3
# order-processor      order-topic     3          consumer-4
# order-processor      order-topic     4          consumer-5
# order-processor      order-topic     5          consumer-6
```

### 注意事项

```
消费者数量 <= 分区数量

如果分区数是 6，消费者最多 6 个

超过 6 个会怎样？
→ 多余的消费者空闲（不消费任何分区）

所以扩容前，先检查分区数！
```

```bash
# 查看 Topic 的分区数
kafka-topics.sh --describe --topic order-topic --bootstrap-server localhost:9092

# 如果分区数不够，需要增加分区
kafka-topics.sh --alter --topic order-topic \
  --partitions 12 --bootstrap-server localhost:9092
```

---

## 策略二：消费者代码优化

扩容是加法，**优化是乘法**。有时候，优化代码比加机器更有效。

### 问题诊断

```java
// 在消费端添加耗时监控
@KafkaListener(topics = "order-topic")
public void consumeOrder(ConsumerRecord&lt;String, OrderMessage&gt; record) {
    long start = System.currentTimeMillis();

    // 记录每个环节的耗时
    try {
        validateMessage(record.value());     // Step 1
        log.info("Step1 耗时: {}ms", System.currentTimeMillis() - start);

        processOrder(record.value());         // Step 2
        log.info("Step2 耗时: {}ms", System.currentTimeMillis() - start);

        saveToDatabase(record.value());       // Step 3
        log.info("Step3 耗时: {}ms", System.currentTimeMillis() - start);

        sendNotification(record.value());     // Step 4
        log.info("Step4 耗时: {}ms", System.currentTimeMillis() - start);

    } finally {
        long total = System.currentTimeMillis() - start;
        if (total > 100) {
            log.warn("消费耗时过长: {}ms, message={}", total, record.value());
        }
    }
}
```

### 常见优化点

| 问题 | 优化方案 | 预期提升 |
|-----|---------|---------|
| 数据库 IO 阻塞 | 连接池调优、批量操作 | 10x |
| 同步阻塞调用 | 异步化、并行处理 | 5x |
| 复杂计算 | 预计算、缓存结果 | 3x |
| 单线程处理 | 多线程消费 | Nx（N=线程数） |

### 代码优化示例

```java
// 优化前：同步串行处理
@KafkaListener(topics = "order-topic")
public void consumeOrder(OrderMessage message) {
    // 每条消息都执行这些同步操作
    validate(message);           // 10ms
    saveOrder(message);          // 50ms
    deductInventory(message);    // 30ms
    sendNotification(message);   // 100ms
    // 总计：约 200ms/条 = 5 条/秒
}

// 优化后：异步并行 + 批量处理
@KafkaListener(topics = "order-topic", concurrency = "3")
public class OptimizedOrderConsumer {

    private final ExecutorService executor = Executors.newFixedThreadPool(10);
    private final BulkOrderProcessor bulkProcessor;

    // concurrentcus = 3，每个实例 3 个线程，共 9 个线程并行消费
    public void consumeOrder(OrderMessage message) {
        // 1. 快速校验
        if (!validate(message)) {
            return;
        }

        // 2. 异步批量处理
        CompletableFuture.allOf(
            CompletableFuture.runAsync(() -> saveOrder(message), executor),
            CompletableFuture.runAsync(() -> deductInventory(message), executor),
            CompletableFuture.runAsync(() -> sendNotification(message), executor)
        ).join();
    }
}
```

---

## 策略三：消息分级丢弃

有些消息**不能丢**，有些消息**丢了也无所谓**。分级处理可以保护核心业务。

### 消息优先级设计

```java
// 定义消息优先级
public enum MessagePriority {
    HIGH(1),    // 核心业务：订单、支付（不能丢）
    MEDIUM(2),  // 普通业务：日志、分析
    LOW(3);     // 可选业务：营销推送
}

public class OrderMessage {
    private String orderId;
    private OrderAction action;
    private MessagePriority priority = MessagePriority.MEDIUM;
    private long timestamp;
}
```

### 多 Consumer Group 实现分级消费

```
Topic: order-topic（多个分区）

Consumer Group: high-priority-group（优先级高）
└── 3 个消费者，专门处理 HIGH 优先级的消息

Consumer Group: normal-group（普通消费）
└── 6 个消费者，处理 MEDIUM 和 LOW 优先级

Consumer Group: batch-group（批量消费）
└── 2 个消费者，专门处理 LOW 优先级的消息（可以延迟）
```

### 丢弃策略配置

```java
@Configuration
public class PriorityConsumerConfig {

    @Bean
    public KafkaListenerContainerFactory&lt;ConcurrentMessageListenerContainer&lt;String, OrderMessage&gt;&gt;
            priorityConsumerFactory() {
        ConcurrentKafkaListenerContainerFactory&lt;String, OrderMessage&gt; factory =
            new ConcurrentKafkaListenerContainerFactory&lt;&gt;();

        // 设置并发数
        factory.setConcurrency(3);

        // 设置过滤器：只消费 HIGH 优先级
        factory.setRecordInterceptor(record -> {
            OrderMessage message = record.value();
            if (message.getPriority() == MessagePriority.HIGH) {
                return record;
            }
            // 非 HIGH 优先级，返回 null 表示跳过
            return null;
        });

        return factory;
    }
}
```

---

## 策略四：临时消费者快速消费积压

当积压量巨大时，可以**临时启动更多消费者**专门清空积压。

### 方案：创建临时消费组

```bash
# 1. 创建一个新的消费者组，专门消费积压消息
# 这个组有 10 个消费者（假设分区数足够）

# 2. 等积压清空后，停止这个临时消费组

# 3. 恢复正常消费组
```

### Java 实现

```java
/**
 * 积压清理服务
 * 适用于紧急情况下的快速消费
 */
@Service
@Slf4j
public class BacklogCleanupService {

    private final KafkaTemplate&lt;String, OrderMessage&gt; kafkaTemplate;
    private final String bootstrapServers;

    /**
     * 创建临时消费者快速消费积压
     */
    public void startEmergencyCleanup(String topic, int consumerCount) {
        ExecutorService executor = Executors.newFixedThreadPool(consumerCount);

        // 启动多个消费者
        for (int i = 0; i < consumerCount; i++) {
            final int consumerId = i;
            executor.submit(() -> {
                Properties props = new Properties();
                props.put("bootstrap.servers", bootstrapServers);
                props.put("group.id", "emergency-cleanup-" + consumerId);
                props.put("enable.auto.commit", "true");
                props.put("auto.offset.reset", "latest");  // 只消费新消息

                KafkaConsumer&lt;String, OrderMessage&gt; consumer =
                    new KafkaConsumer&lt;&gt;(props);
                consumer.subscribe(Collections.singletonList(topic));

                while (true) {
                    ConsumerRecords&lt;String, OrderMessage&gt; records =
                        consumer.poll(Duration.ofSeconds(1));

                    for (ConsumerRecord&lt;String, OrderMessage&gt; record : records) {
                        try {
                            // 快速处理：只做必要的校验
                            if (validateMessage(record.value())) {
                                processOrder(record.value());
                            }
                        } catch (Exception e) {
                            log.error("处理失败: {}", record.value(), e);
                            // 失败消息发送到死信队列
                            sendToDeadLetterQueue(record.value());
                        }
                    }
                }
            });
        }
    }

    /**
     * 停止清理并恢复原始消费组
     */
    public void stopCleanup() {
        // 关闭临时消费者
        // 原消费组会接管消费
        log.info("积压已清空，停止紧急清理");
    }
}
```

### 风险提示

```
⚠️ 紧急清理的风险：

1. 消息可能乱序
   → 临时消费者的 offset 可能跳着消费

2. 幂等性可能被破坏
   → 如果原始消费者也在消费同一 Topic

3. 数据一致性风险
   → 快速处理可能跳过某些验证

✅ 安全做法：
临时消费者消费不同的 Topic（如 order-topic-backup）
或者先暂停原始消费者
```

---

## 策略五：限流保护

有时候积压是因为**生产太快**，而不是消费太慢。这时候限流比扩容更有效。

### 生产端限流

```java
/**
 * 生产端限流：防止消息产生速度超过系统处理能力
 */
@Component
public class RateLimitedProducer {

    private final RateLimiter rateLimiter = RateLimiter.create(10000); // 每秒 10000 条
    private final KafkaTemplate&lt;String, OrderMessage&gt; kafkaTemplate;

    public CompletableFuture&lt;SendResult&gt; sendOrderMessage(OrderMessage message) {
        // 1. 获取令牌（阻塞等待）
        rateLimiter.acquire();

        // 2. 发送消息
        return kafkaTemplate.send("order-topic", message.getOrderId(), message);
    }
}
```

### 消费端限流

```java
/**
 * 消费端限流：保护下游系统不被冲垮
 */
@Component
public class RateLimitedConsumer {

    private final RateLimiter rateLimiter = RateLimiter.create(1000); // 每秒处理 1000 条

    @KafkaListener(topics = "order-topic")
    public void consumeOrder(OrderMessage message) {
        // 1. 限流：每秒最多处理 1000 条
        // 如果超过，线程会等待
        rateLimiter.acquire();

        // 2. 业务处理
        processOrder(message);
    }
}
```

---

## 策略六：重新消费策略

对于已经积压的消息，有时候**重新消费**比**继续消费**更高效。

### 场景：历史消息可以跳过

```java
/**
 * 跳过期消息：只消费最近的消息
 */
@KafkaListener(topics = "order-topic")
public class SkipOldMessageConsumer {

    private static final long SKIP_BEFORE_TIMESTAMP =
        System.currentTimeMillis() - TimeUnit.HOURS.toMillis(1); // 只消费 1 小时内的

    public void consumeOrder(ConsumerRecord&lt;String, OrderMessage&gt; record) {
        OrderMessage message = record.value();

        // 如果是 1 小时前的消息，跳过
        if (message.getTimestamp() &lt; SKIP_BEFORE_TIMESTAMP) {
            log.info("跳过过期消息: timestamp={}", message.getTimestamp());
            return;
        }

        // 正常处理
        processOrder(message);
    }
}
```

### 场景：重新消费到新 Topic

```bash
# 将积压消息重新消费到新 Topic
kafka-mirror-maker.sh \
  --consumer.config consumer.properties \
  --producer.config producer.properties \
  --whitelist="order-topic" \
  --new.topic="order-topic-retry"
```

---

## 积压处理流程图

```
发现积压
    │
    ├──► 告警触发
    │         │
    │         ▼
    │    分析原因
    │         │
    │         ├──► 消费者挂了？
    │         │         │
    │         │         ▼
    │         │    重启消费者
    │         │
    │         ├──► 代码问题？
    │         │         │
    │         │         ▼
    │         │    紧急扩容 + 后续优化
    │         │
    │         ├──► 流量突增？
    │         │         │
    │         │         ▼
    │         │    限流 + 扩容 + 降级
    │         │
    │         └──► 分区不足？
    │                   │
    │                   ▼
    │              增加分区 + Rebalance
    │
    ├──► 紧急扩容
    │
    ├──► 限流保护
    │
    └──► 积压清理（极端情况）
              │
              ▼
         临时消费者
```

---

## 监控与预防

### 核心监控指标

```yaml
# Prometheus 告警规则
groups:
  - name: kafka_consumer_lag
    rules:
      # 消费延迟告警
      - alert: KafkaConsumerLagHigh
        expr: kafka_consumer_lag_seconds > 300
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Kafka 消费延迟过高"
          description: "消费者组 {{ $labels.consumergroup }} 在 Topic {{ $labels.topic }} 上延迟 {{ $value }} 秒"

      # 积压量告警
      - alert: KafkaConsumerBacklogHigh
        expr: kafka_consumer_lag_messages > 100000
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Kafka 消息积压严重"
          description: "积压 {{ $value }} 条消息"
```

### 预防措施

| 措施 | 说明 |
|-----|-----|
| 消费耗时监控 | 每条消息处理时间超过阈值告警 |
| 消费者健康检查 | 消费者心跳超时自动告警 |
| 限流保护 | 生产端和消费端双重限流 |
| 容量规划 | 根据峰值流量的 3 倍预留消费者 |
| 降级预案 | 什么情况下可以丢弃哪些消息 |

---

## 面试追问

**面试官可能会问：**

1. 「消息积压和消息丢失有什么区别？」—— 积压是消息还在，只是处理慢；丢失是消息没了
2. 「Kafka 的 LAG 是什么？怎么监控？」—— LAG = LOG-END-OFFSET - CURRENT-OFFSET，表示积压量
3. 「消费者扩容后还是不能提高消费速度？」—— 检查分区数，可能分区数就是瓶颈

消息积压是「慢性病」，平时不注意，爆发时就来不及。**预防比治疗更重要**——完善的监控和容量规划，才是根本。
