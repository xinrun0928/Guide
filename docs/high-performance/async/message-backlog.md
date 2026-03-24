# 消息积压处理：消费者扩容 + 消息迁移 + 优先级队列

「消息积压了 100 万条，系统快崩了！」

凌晨 2 点，监控报警刺破寂静。Kafka 消费 lag 疯狂飙升，用户收不到通知，订单状态不更新。

这不是演练，是真实的生产事故。

怎么办？

## 消息积压的原因分析

### 常见原因

```
消息积压的根本原因：生产速度 > 消费速度

├─ 消费者问题
│  ├─ 消费者挂了
│  ├─ 消费者处理太慢
│  ├─ 消费者代码 Bug（死循环）
│  └─ 消费者线程池配置不当
│
├─ 消费者资源问题
│  ├─ CPU 打满
│  ├─ 内存不足（Full GC）
│  ├─ 数据库连接池耗尽
│  └─ 网络带宽瓶颈
│
├─ 分区/队列问题
│  ├─ 分区数太少（Kafka）
│  ├─ 消费者数少于分区数
│  └─ 消息顺序导致热点分区
│
└─ 业务问题
   ├─ 大促/活动流量突增
   └─ 上游服务异常重试风暴
```

### 快速诊断

```bash
# Kafka：检查消费 lag
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
    --group my-consumer-group \
    --describe

# 输出：
# GROUP           TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG     CONSUMER
# my-consumer     my-topic        0          50000            150000          100000  consumer-1
# my-consumer     my-topic        1          45000            145000          100000  consumer-2
# my-consumer     my-topic        2          48000            148000          100000  consumer-3
# ↑
# lag = 100000，说明积压了 10 万条

# RabbitMQ：检查队列深度
rabbitmqctl list_queues name messages messages_ready messages_unacked

# 输出：
# name           messages  messages_ready  messages_unacked
# orders.queue   150000    150000          0
# ↑
# 积压了 15 万条消息
```

## 解决方案一：消费者扩容

### Kafka 消费者扩容

```bash
# 扩容前：3 个分区，3 个消费者
# 扩容后：3 个分区，6 个消费者 → 3 个空闲

# 正确做法：先增加分区数
kafka-topics.sh --alter --topic my-topic \
    --partitions 10 \
    --bootstrap-server localhost:9092

# 然后再启动消费者
```

```java
// 启动多个消费者实例（不同 Consumer Group）
// 实例 1
KafkaConsumer&lt;String, String&gt; consumer1 = new KafkaConsumer&lt;&gt;(props);
consumer1.subscribe(Arrays.asList("my-topic"));

// 实例 2（另一进程或另一机器）
KafkaConsumer&lt;String, String&gt; consumer2 = new KafkaConsumer&lt;&gt;(props);
consumer2.subscribe(Arrays.asList("my-topic"));

// Kafka 自动 Rebalance，重新分配分区
```

### RabbitMQ 消费者扩容

```java
// 增加消费线程数
@Bean
public SimpleRabbitListenerContainerFactory rabbitListenerContainerFactory() {
    SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
    factory.setConnectionFactory(connectionFactory);
    
    // 增加并发数
    factory.setConcurrent(5);      // 最少 5 个线程
    factory.setMaxConcurrentConsumers(20);  // 最多 20 个线程
    
    // prefetch：预取数量，控制内存
    factory.setPrefetchCount(10);  // 每个消费者预取 10 条
    
    return factory;
}
```

### 消费者扩容注意事项

| 问题 | 影响 | 解决方案 |
|------|------|---------|
| 分区数 < 消费者数 | 多余消费者空闲 | 先增加分区数 |
| 数据库连接池不够 | 连接耗尽 | 扩大连接池 |
| 顺序消费要求 | 扩容后顺序可能被打破 | 改用单分区顺序消费 |
| Rebalance 风暴 | 扩容触发 Rebalance，重复消费 | 降低扩容频率 |

## 解决方案二：消息迁移

### Kafka 消息迁移

```bash
# 使用 kafka-reassign-partitions.sh 迁移分区
# 1. 先生成迁移计划
cat &gt; reassign.json &lt;&lt;EOF
{
  "topics": [
    {
      "topic": "my-topic",
      "partitions": [
        {"partition": 0, "replicas": [1,2,3]},
        {"partition": 1, "replicas": [2,3,1]},
        {"partition": 2, "replicas": [3,1,2]}
      ]
    }
  ]
}
EOF

# 2. 执行迁移
kafka-reassign-partitions.sh --bootstrap-server localhost:9092 \
    --generate --topics-to-move-json-file reassign.json \
    --broker-list "1,2,3,4,5" \
    --execute
```

### 热点分区处理

```java
// 如果某些分区是热点（处理慢），可以考虑：
// 1. 优化分区内消息的 Key 设计
// 2. 将热点消息拆分到多个 Topic

// 原来：所有订单都发到一个 Topic
producer.send(new ProducerRecord&lt;&gt;("orders", orderId, order));

// 优化：根据订单类型选择 Topic
String topic = order.getType().equals("flash") ? "orders-flash" : "orders-normal";
producer.send(new ProducerRecord&lt;&gt;(topic, orderId, order));

// 消费者分别处理
consumerFlash.subscribe(Arrays.asList("orders-flash"));
consumerNormal.subscribe(Arrays.asList("orders-normal"));
```

### 死信队列隔离

```java
// 配置死信队列处理积压消息
@Bean
public DirectExchange deadLetterExchange() {
    return new DirectExchange("dlx.exchange");
}

@Bean
public Queue deadLetterQueue() {
    return new Queue("dlq.queue", true);
}

@Bean
public Binding deadLetterBinding() {
    return BindingBuilder.bind(deadLetterQueue())
        .to(deadLetterExchange())
        .with("dead");
}

// 原队列配置死信
@Bean
public Queue ordersQueue() {
    Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
    args.put("x-dead-letter-exchange", "dlx.exchange");
    args.put("x-dead-letter-routing-key", "dead");
    // 处理失败 3 次后进入死信队列
    args.put("x-max-retries", 3);
    return new Queue("orders.queue", true, false, false, args);
}
```

## 解决方案三：优先级队列

### RabbitMQ 优先级队列

```java
// 创建优先级队列
@Bean
public Queue priorityQueue() {
    Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
    // 最大优先级 10
    args.put("x-max-priority", 10);
    return new Queue("orders.priority", true, false, false, args);
}

// 发送高优先级消息
public void sendOrder(Order order) {
    int priority = order.isUrgent() ? 10 : 1;
    
    rabbitTemplate.convertAndSend(
        "orders.exchange",
        "orders.created",
        order,
        message -&gt; {
            message.getMessageProperties().setPriority(priority);
            return message;
        }
    );
}
```

### 消息分级处理

```
┌────────────────────────────────────────────────────┐
│                  消息分级处理                         │
│                                                     │
│  高优先级队列 ──→ 消费者线程池（8 线程）──→ VIP 用户  │
│                                                     │
│  普通优先级队列 ──→ 消费者线程池（4 线程）──→ 普通用户 │
│                                                     │
│  低优先级队列 ──→ 消费者线程池（2 线程）──→ 非实时处理 │
└────────────────────────────────────────────────────┘
```

## 应急处理流程

### 第一步：紧急止血（5 分钟内）

```bash
# 1. 立即扩容消费者
# Kafka：增加消费者实例

# RabbitMQ：增加并发数
rabbitmqctl set_parameter qos 50 --vhost /  # 调整 prefetch

# 2. 如果消息可以丢弃（可重复消费场景）
# Kafka：跳过积压消息，从最新开始消费
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
    --group my-group \
    --reset-offsets --to-latest \
    --topic my-topic

# 3. 如果不能丢弃消息
# 启动新的消费者消费积压，原消费者处理新消息
```

### 第二步：分析原因（30 分钟内）

```java
// 添加监控，定位慢消息
@RabbitListener(queues = "orders.queue")
public void handleOrder(Order order) {
    long start = System.currentTimeMillis();
    
    try {
        processOrder(order);
    } finally {
        long cost = System.currentTimeMillis() - start;
        
        // 监控处理时间
        if (cost > 1000) {
            log.warn("慢消息处理: orderId={}, cost={}ms", order.getId(), cost);
        }
        
        // 上报监控
        metricsService.record("order.process.time", cost);
    }
}
```

### 第三步：彻底解决

```java
// 根据原因针对性解决
switch (reason) {
    case "consumer_slow":
        // 优化消费逻辑，增加并行度
        optimizeConsumer();
        break;
    case "db_slow":
        // 优化数据库，加索引
        optimizeDatabase();
        break;
    case "partition_unbalanced":
        // 重新设计 Key，预分配分区
        redesignPartition();
        break;
    case "upstream_retry":
        // 限流上游，添加重试间隔
        addRateLimit();
        break;
}
```

## 预防措施

### 1. 容量规划

```java
// 根据峰值 QPS 计算所需资源
public class CapacityPlanning {
    
    public int calculateConsumerCount(CapacityConfig config) {
        // 消费速度 = 单条处理时间 / 并行度
        int singleConsumerTps = 1000 / config.getAvgProcessTimeMs();
        
        // 所需消费者数 = 峰值 QPS / 单消费者 TPS
        int consumers = (int) Math.ceil(
            config.getPeakQps() / singleConsumerTps
        );
        
        // 加上冗余
        return (int) (consumers * 1.5);
    }
}
```

### 2. 监控告警

```java
// 关键指标监控
@Configuration
public class RabbitMQMonitorConfig {
    
    @Scheduled(fixedRate = 30000)
    public void checkQueueHealth() {
        // 监控队列深度
        int queueDepth = getQueueDepth("orders.queue");
        
        if (queueDepth > 10000) {
            alertService.send("队列积压告警: " + queueDepth);
        }
        
        // 监控消费延迟
        long consumeDelay = getConsumeDelay();
        if (consumeDelay > 60000) {  // 超过 1 分钟
            alertService.send("消费延迟告警: " + consumeDelay);
        }
    }
}
```

### 3. 限流保护

```java
// 生产者限流
@Bean
public Queue ordersQueue() {
    Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
    // 队列长度超过 10 万，拒绝新消息
    args.put("x-max-length", 100000);
    args.put("x-overflow", "reject-publish");
    return new Queue("orders.queue", true, false, false, args);
}
```

## 总结

消息积压处理要点：

| 阶段 | 操作 | 时间 |
|------|------|------|
| 止血 | 扩容消费者，跳过积压 | 5 分钟 |
| 分析 | 定位慢消息、根因 | 30 分钟 |
| 解决 | 优化代码、调整架构 | 按需 |
| 预防 | 监控告警、容量规划 | 常态化 |

**记住**：预防大于治疗。完善的监控和容量规划能让你在积压发生前就发现并处理。

---

## 留给你的问题

假设你的秒杀系统遇到消息积压：

1. 秒杀高峰期，1 秒内涌入 10 万订单消息，但消费者只能处理 1 万/秒，积压了 9 万条。你怎么快速止血？
2. 这些积压的订单已经超时了（10 分钟超时），消息还有必要处理吗？如果要处理，应该怎么处理？
3. 秒杀结束后，平时订单量只有 100/秒，用多少消费者合适？如何实现自动扩缩容？
4. 如果某个商家作弊，发送了大量消息导致积压，你怎么发现并处理？

思考这些问题，能帮助你设计更健壮的秒杀系统。
