# Kafka 如何保证消息不丢失：生产者、Broker、消费者

用户付款成功了，但订单状态没更新。

这条消息，丢在哪了？

Kafka 的消息链路有三个环节：**生产者 → Broker → 消费者**。任何一环出问题，消息都可能丢失。

## 一、消息丢失的三个场景

```
┌─────────────────────────────────────────────────────────────────┐
│                    消息丢失的三个场景                              │
│                                                                  │
│  ┌─────────┐      ┌─────────┐      ┌─────────┐                  │
│  │ Producer │ ──→ │ Broker  │ ──→ │ Consumer │                  │
│  │ 生产者   │      │ 中间件   │      │ 消费者   │                  │
│  └─────────┘      └─────────┘      └─────────┘                  │
│       │                │                │                        │
│       ↓                ↓                ↓                        │
│  发送失败           存储丢失          消费丢失                     │
│  未持久化           未同步           未确认                       │
└─────────────────────────────────────────────────────────────────┘
```

| 环节 | 丢失原因 | 解决方案 |
|------|----------|----------|
| Producer | 网络抖动、Broker 故障 | ACK 确认 + 重试 |
| Broker | 磁盘故障、Leader 切换 | 副本机制 + 持久化 |
| Consumer | 自动提交 offset、业务异常 | 手动提交 offset |

## 二、生产者端保证

### 2.1 配置 ACK 级别

```java
// 生产者可靠性配置
public class ProducerReliabilityConfig {
    
    // 1. acks=0：发送即返回，最快但最不安全
    props.put("acks", "0");
    // 适用：日志采集，允许少量丢失
    
    // 2. acks=1：Leader 写入即返回
    props.put("acks", "1");
    // 风险：Leader 宕机，Follower 未同步
    
    // 3. acks=all（推荐）：ISR 所有副本确认
    props.put("acks", "all");
    // 最安全，配合副本机制使用
}
```

### 2.2 配合副本配置

```java
// 副本配置
public class ReplicaConfig {
    
    // Topic 级别：副本因子
    // 副本因子 = 3：每条消息有 3 份拷贝
    kafka-topics.sh --create \
        --topic order-topic \
        --replication-factor 3 \
        --partitions 6
    
    // min.insync.replicas：最小同步副本数
    // 配合 acks=all 使用
    props.put("min.insync.replicas", "2");
    // 含义：写入必须被至少 2 个副本确认
}
```

### 2.3 完整可靠性配置

```java
// 高可靠生产者配置
public class HighReliabilityProducer {
    
    public KafkaProducer&lt;String, String&gt; createProducer() {
        Properties props = new Properties();
        
        // 连接
        props.put("bootstrap.servers", "localhost:9092,localhost:9093,localhost:9094");
        
        // 序列化
        props.put("key.serializer", "StringSerializer");
        props.put("value.serializer", "StringSerializer");
        
        // 可靠性核心配置
        props.put("acks", "all");                    // 全部副本确认
        props.put("retries", "Integer.MAX_VALUE");   // 无限重试
        props.put("enable.idempotence", true);       // 开启幂等性
        
        // 重试间隔
        props.put("retry.backoff.ms", 1000);         // 1 秒
        
        // 批次配置
        props.put("batch.size", 65536);              // 64KB
        props.put("linger.ms", 20);                  // 等待 20ms
        
        return new KafkaProducer&lt;&gt;(props);
    }
}
```

### 2.4 发送回调处理

```java
// 发送回调：捕获发送失败
public class SendCallback {
    
    private final KafkaProducer&lt;String, String&gt; producer;
    
    public void sendWithRetry(String topic, String key, String value) {
        ProducerRecord&lt;String, String&gt; record = 
            new ProducerRecord&lt;&gt;(topic, key, value);
        
        producer.send(record, (metadata, e) -> {
            if (e != null) {
                // 发送失败
                log.error("发送失败: topic={}, key={}, error={}", 
                    topic, key, e.getMessage());
                
                // 记录失败消息，用于后续补偿
                saveFailedRecord(record, e);
                
                // 可选：触发告警
                alertService.alert("Kafka 消息发送失败");
            } else {
                // 发送成功
                log.info("发送成功: topic={}, partition={}, offset={}", 
                    metadata.topic(), metadata.partition(), metadata.offset());
            }
        });
    }
}
```

## 三、Broker 端保证

### 3.1 副本机制

```
Broker 端数据复制流程：

Producer ──→ Leader ──→ Follower 1 ──→ Follower 2
                  │         │              │
                  │         │              │
            acks=all      同步            同步

只要 ISR 中有 ≥ min.insync.replicas 个副本，消息就不丢
```

### 3.2 刷盘策略

```java
// Kafka 刷盘机制
public class FlushConfig {
    
    // Kafka 不依赖 JVM 刷盘，依赖操作系统
    // 配置项：log.flush.interval.messages（消息数）
    // 配置项：log.flush.interval.ms（时间间隔）
    
    // 建议：不配置，使用操作系统默认
    // 原因：频繁刷盘会影响性能
    
    // 操作系统会自动定期将 Page Cache 刷到磁盘
}
```

### 3.3 Broker 配置检查

```bash
# 检查 Broker 配置
# server.properties

# 副本因子
default.replication.factor=3

# 最小同步副本
min.insync.replicas=2

# 复制线程数
num.replica.fetchers=8

# Leader 复制缓存
replica.socket.timeout.ms=30000

# 副本读取超时
replica.fetch.timeout.ms=30000
```

### 3.4 ISR 监控

```bash
# 查看 ISR 状态
kafka-topics.sh --describe \
    --topic order-topic \
    --bootstrap-server localhost:9092

# 输出示例：
# Topic: order-topic    Partition: 0    Leader: 1    Replicas: 1,2,3    Isr: 1,2

# 注意 Isr 部分：
# Isr: 1,2 ← 只有 2 个副本同步
# Replicas: 1,2,3 ← 有 3 个副本

# 如果 Isr < min.insync.replicas，写入会失败
```

## 四、消费者端保证

### 4.1 手动提交 offset

```java
// 消费者端：不自动提交，手动控制
public class ManualOffsetConsumer {
    
    public void consume() {
        KafkaConsumer&lt;String, String&gt; consumer = new KafkaConsumer&lt;&gt;(props);
        
        // 关闭自动提交
        props.put("enable.auto.commit", false);
        
        consumer.subscribe(Arrays.asList("order-topic"));
        
        while (true) {
            ConsumerRecords&lt;String, String&gt; records = 
                consumer.poll(Duration.ofMillis(100));
            
            for (ConsumerRecord&lt;String, String&gt; record : records) {
                try {
                    // 业务处理
                    processOrder(record);
                    
                    // 业务处理成功后，手动提交 offset
                    consumer.commitSync(
                        Collections.singletonMap(
                            new TopicPartition(record.topic(), record.partition()),
                            new OffsetAndMetadata(record.offset() + 1)
                        )
                    );
                    
                } catch (Exception e) {
                    // 业务处理失败，不提交 offset
                    // 下次 poll 会重新拿到这条消息
                    log.error("处理消息失败", e);
                }
            }
        }
    }
}
```

### 4.2 异步提交优化

```java
// 异步提交 offset（提高性能）
public class AsyncCommitConsumer {
    
    public void consume() {
        KafkaConsumer&lt;String, String&gt; consumer = new KafkaConsumer&lt;&gt;(props);
        props.put("enable.auto.commit", false);
        
        consumer.subscribe(Arrays.asList("order-topic"));
        
        while (true) {
            ConsumerRecords&lt;String, String&gt; records = 
                consumer.poll(Duration.ofMillis(100));
            
            // 处理消息
            for (ConsumerRecord&lt;String, String&gt; record : records) {
                processOrder(record);
            }
            
            // 异步提交（不阻塞）
            consumer.commitAsync((offsets, e) -> {
                if (e != null) {
                    log.error("提交 offset 失败", e);
                    // 可以在这里重试
                }
            });
        }
    }
}
```

### 4.3 组合提交策略

```java
// 组合策略：定期同步 + 异步补充
public class CombinedCommitConsumer {
    
    private long lastSyncCommitTime = 0;
    private static final long SYNC_COMMIT_INTERVAL_MS = 30000;  // 30 秒
    
    public void consume() {
        KafkaConsumer&lt;String, String&gt; consumer = new KafkaConsumer&lt;&gt;(props);
        props.put("enable.auto.commit", false);
        
        consumer.subscribe(Arrays.asList("order-topic"));
        
        while (true) {
            ConsumerRecords&lt;String, String&gt; records = 
                consumer.poll(Duration.ofMillis(100));
            
            for (ConsumerRecord&lt;String, String&gt; record : records) {
                processOrder(record);
            }
            
            // 定期同步提交
            long now = System.currentTimeMillis();
            if (now - lastSyncCommitTime > SYNC_COMMIT_INTERVAL_MS) {
                consumer.commitSync();
                lastSyncCommitTime = now;
            } else {
                // 其他时间异步提交
                consumer.commitAsync();
            }
        }
    }
}
```

## 五、端到端可靠性方案

### 5.1 完整方案架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    端到端消息可靠方案                              │
│                                                                  │
│  Producer                                                         │
│  ├── acks=all                                                   │
│  ├── retries=Integer.MAX_VALUE                                   │
│  ├── enable.idempotence=true                                     │
│  └── 回调处理失败消息                                             │
│                                                                  │
│  Broker                                                          │
│  ├── replication.factor=3                                        │
│  ├── min.insync.replicas=2                                      │
│  └── 监控 ISR                                                    │
│                                                                  │
│  Consumer                                                        │
│  ├── enable.auto.commit=false                                   │
│  ├── 手动提交 offset                                             │
│  └── 业务处理成功后提交                                           │
│                                                                  │
│  补偿机制                                                         │
│  ├── 定时任务检查未处理消息                                       │
│  ├── 死信队列兜底                                                │
│  └── 告警通知                                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 消息表记录

```java
// 消息发送记录表
@Entity
public class MessageLog {
    
    @Id
    private String messageId;
    
    private String topic;
    private String key;
    private String value;
    
    private String status;  // SENDING, SENT, PROCESSING, COMPLETED, FAILED
    
    private int sendAttempts;  // 发送尝试次数
    private String sendError;   // 发送错误信息
    
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
    private LocalDateTime nextRetryTime;
}

// 补偿服务
@Service
public class CompensationService {
    
    @Scheduled(fixedRate = 60000)  // 每分钟执行
    public void checkPendingMessages() {
        // 查找状态为 SENDING/SENT 超过 5 分钟的消息
        List&lt;MessageLog&gt; pending = messageLogRepository
            .findPendingMessages(LocalDateTime.now().minusMinutes(5));
        
        for (MessageLog msg : pending) {
            // 检查业务是否已处理
            boolean processed = checkBusinessProcessed(msg);
            
            if (processed) {
                // 已处理，更新状态
                msg.setStatus("COMPLETED");
            } else {
                // 未处理，重新发送
                resendMessage(msg);
            }
            
            messageLogRepository.save(msg);
        }
    }
}
```

### 5.3 死信队列

```java
// 配置死信 Topic
@Configuration
public class DeadLetterConfig {
    
    @Bean
    public NewTopic deadLetterTopic() {
        return TopicBuilder.name("order-topic-dlq")
            .partitions(3)
            .replicas(3)
            .build();
    }
}

// 发送失败消息到死信队列
public class DeadLetterHandler {
    
    public void sendToDeadLetter(ProducerRecord&lt;String, String&gt; original, 
                                  Exception e) {
        ProducerRecord&lt;String, String&gt; dlq = new ProducerRecord&lt;&gt;(
            "order-topic-dlq",
            original.key(),
            JSON.toJSONString(new DeadLetter(original, e))
        );
        
        producer.send(dlq, (metadata, sendError) -> {
            if (sendError != null) {
                log.error("死信消息发送失败", sendError);
                // 严重错误：原消息和死信都失败了
            }
        });
    }
}
```

## 六、可靠性配置清单

### 6.1 生产者配置

```java
// 生产者可靠性配置清单
public class ProducerChecklist {
    
    // 必须配置
    String acks = "all";                        // 所有副本确认
    String enableIdempotence = "true";          // 开启幂等性
    String retries = "Integer.MAX_VALUE";       // 无限重试
    String maxInFlightRequestsPerConnection = "5"; // 防止乱序
    
    // 建议配置
    String compressionType = "lz4";              // 压缩
    String batchSize = "65536";                  // 64KB
    String lingerMs = "20";                     // 等待 20ms
    String bufferMemory = "134217728";          // 128MB
    
    // 超时配置
    String requestTimeoutMs = "30000";         // 请求超时
    String deliveryTimeoutMs = "120000";        // 投递超时
}
```

### 6.2 Broker 配置

```java
// Broker 可靠性配置清单
public class BrokerChecklist {
    
    // 副本配置
    String defaultReplicationFactor = "3";      // 默认副本因子
    String minInsyncReplicas = "2";            // 最小同步副本
    
    // 复制配置
    String numReplicaFetchers = "8";            // 复制线程数
    String replicaSocketTimeoutMs = "30000";   // 副本 socket 超时
    String replicaFetchTimeoutMs = "30000";     // 副本获取超时
    String replicaLagTimeMaxMs = "30000";       // 副本滞后最大时间
}
```

### 6.3 消费者配置

```java
// 消费者可靠性配置清单
public class ConsumerChecklist {
    
    // offset 提交
    String enableAutoCommit = "false";         // 关闭自动提交
    // String autoCommitIntervalMs = "1000";    // 自动提交间隔（如果开启）
    
    // 心跳配置
    String heartbeatIntervalMs = "3000";       // 心跳间隔
    String sessionTimeoutMs = "45000";         // session 超时
    String maxPollIntervalMs = "300000";       // 最大 poll 间隔
    
    // 消费配置
    String maxPollRecords = "500";             // 每次 poll 数量
    String autoOffsetReset = "earliest";       // 最早消费
}
```

## 七、常见问题与解决方案

### 7.1 ISR 收缩导致写入失败

```
问题：min.insync.replicas=2，但 ISR 只有 1

原因：
- Follower 同步延迟
- Broker 宕机
- 网络抖动

解决：
1. 等待 Follower 恢复
2. 临时降低 min.insync.replicas（慎用）
3. 增加重试次数
```

### 7.2 消费者处理超时

```
问题：业务处理时间过长，触发 Rebalance

原因：
- max.poll.interval.ms 设置太小
- 业务处理太慢

解决：
1. 增加 max.poll.interval.ms
2. 减少 max.poll.records
3. 优化业务处理逻辑
4. 异步处理，不阻塞 poll
```

### 7.3 重复消费 vs 消息丢失

```
问题：可靠性配置太严格会影响性能

权衡：
- 金融场景：消息丢失 > 消息重复
- 日志场景：消息重复 > 消息丢失

最佳实践：
- 开启幂等性，接受消息重复
- 消费端实现幂等处理
```

## 总结

消息不丢失三板斧：

| 环节 | 配置 | 效果 |
|------|------|------|
| 生产者 | acks=all + retries | 发送成功即持久化 |
| Broker | 副本因子 3 + minISR 2 | 多副本冗余 |
| 消费者 | 手动提交 offset | 业务处理后才提交 |

**可靠性不是单一配置，而是一整套方案。**

---

## 留给你的问题

1. **ISR 为空怎么办**：如果所有 Follower 都与 Leader 失步，ISR 变成空的，这时候还能写入吗？怎么配置才能避免这种情况？

2. **幂等性不是银弹**：开启幂等性后，Producer 重启会丢失之前的序列号状态。这时候重试会重复吗？怎么处理？

3. **手动提交的陷阱**：消费消息后先处理业务，再提交 offset。如果处理成功但提交失败，消息会怎样？

4. **顺序与可靠性的矛盾**：要求消息有序时，可能会阻塞后续消息发送。这时候可靠性配置和性能怎么平衡？

思考这些问题，能帮你设计更完整的可靠性方案。
