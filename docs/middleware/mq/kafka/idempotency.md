# Kafka 如何保证消息不重复消费（幂等性）

用户扣了两次钱。

一条消息被消费了两次，一次付账，一次也付账。

Kafka 能保证消息不丢失，但无法保证消息不重复。

**幂等性，是解决这个问题的关键。**

## 一、重复消费的场景

### 1.1 为什么会重复消费？

```
重复消费常见场景：

1. Producer 重试
   ├── 消息发送成功，ACK 丢失
   ├── Producer 重试发送
   └── 消息被写入两次

2. Consumer Rebalance
   ├── Consumer 处理消息后提交 offset 前崩溃
   ├── Rebalance 后新 Consumer 接管分区
   └── 同样的消息被重新消费

3. 手动 offset 提交失败
   ├── 消息处理成功
   ├── offset 提交失败
   └── 重启后重新消费
```

### 1.2 重复消费的代价

```
重复消费的后果：

1. 金融交易
   ├── 重复扣款
   ├── 重复放款
   └── 严重问题！

2. 库存扣减
   ├── 库存扣减两次
   ├── 超卖
   └── 用户投诉

3. 消息通知
   ├── 重复发送短信
   ├── 重复发送邮件
   └── 用户困惑
```

## 二、Producer 端幂等性

### 2.1 幂等性原理

Kafka 的幂等性是基于 **Producer ID + Sequence Number** 实现的。

```
┌─────────────────────────────────────────────────────────────────┐
│                    Kafka 幂等性原理                                │
│                                                                  │
│  Producer                                                        │
│  ├── PID (Producer ID)：Producer 唯一标识                         │
│  └── Sequence Number：每条消息的递增序号                          │
│                                                                  │
│  Broker                                                          │
│  ├── 维护：(PID, Partition) → LastSequenceNumber                 │
│  └── 收到消息时检查：                                             │
│       if (incomingSeq > lastSeq) {                               │
│           存储消息，更新 lastSeq                                  │
│       } else {                                                   │
│           丢弃重复消息                                            │
│       }                                                          │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 开启幂等性

```java
// 开启幂等性
public class IdempotentProducer {
    
    public KafkaProducer&lt;String, String&gt; createProducer() {
        Properties props = new Properties();
        props.put("bootstrap.servers", "localhost:9092");
        props.put("key.serializer", "StringSerializer");
        props.put("value.serializer", "StringSerializer");
        
        // 开启幂等性（推荐）
        props.put("enable.idempotence", true);
        
        return new KafkaProducer&lt;&gt;(props);
    }
}

// 幂等性开启后，Kafka 会自动配置：
// acks = all（隐含）
// retries = Integer.MAX_VALUE（隐含）
// max.in.flight.requests.per.connection = 5（隐含）
```

### 2.3 幂等性的局限

```java
// 幂等性的局限
public class IdempotenceLimits {
    
    // 1. 单 Producer 有效
    // 不同 ProducerID 产生的重复消息无法识别
    
    // 场景：
    // Producer A 发送消息，ACK 丢失
    // Producer A 重试
    // 结果：重复（能识别）
    
    // Producer A 发送消息，ACK 丢失
    // Producer A 重启，获得新的 ProducerID
    // 结果：重复（无法识别！）
    
    // 2. 单 Session 有效
    // Producer 重启后，之前的序列号丢失
    
    // 3. 分区级别
    // 不同分区的重复无法识别
    
    // 结论：幂等性只能防止「单 Producer 单分区」的重复
    // 消费端仍需实现幂等处理
}
```

## 三、消费端幂等性

### 3.1 为什么需要消费端幂等？

```
幂等性只能防止 Producer 端重复
消费端可能收到重复消息，原因：
1. Consumer 崩溃，Rebalance
2. offset 提交失败
3. 手动处理失败

消费端幂等是最后一道防线！
```

### 3.2 唯一键去重

```java
// 方案 1：唯一键去重（最常用）
public class UniqueKeyDeduplication {
    
    @Service
    public class OrderService {
        
        @Autowired
        private OrderRepository orderRepository;
        
        public void processOrder(OrderMessage message) {
            // 检查订单是否已处理
            if (orderRepository.existsByOrderId(message.getOrderId())) {
                log.info("订单已处理，跳过: {}", message.getOrderId());
                return;
            }
            
            // 业务处理
            Order order = convertToOrder(message);
            orderRepository.save(order);
            
            log.info("订单处理成功: {}", message.getOrderId());
        }
    }
}

// 数据库唯一索引保证
// CREATE UNIQUE INDEX idx_order_id ON orders(order_id);
// 插入重复订单会抛异常
```

### 3.3 Redis 去重

```java
// 方案 2：Redis 去重
public class RedisDeduplication {
    
    @Service
    public class OrderService {
        
        @Autowired
        private RedisTemplate&lt;String, String&gt; redisTemplate;
        
        private static final String DEDUP_KEY_PREFIX = "order:processed:";
        
        public void processOrder(OrderMessage message) {
            String key = DEDUP_KEY_PREFIX + message.getOrderId();
            
            // 设置 key，过期时间 24 小时
            Boolean success = redisTemplate.opsForValue()
                .setIfAbsent(key, "1", 24, TimeUnit.HOURS);
            
            if (!success) {
                log.info("订单已处理，跳过: {}", message.getOrderId());
                return;
            }
            
            try {
                // 业务处理
                processOrderInternal(message);
            } catch (Exception e) {
                // 失败时删除 key，允许重试
                redisTemplate.delete(key);
                throw e;
            }
        }
    }
}
```

### 3.4 分布式锁

```java
// 方案 3：分布式锁
public class DistributedLockDeduplication {
    
    @Service
    public class OrderService {
        
        @Autowired
        private RedissonClient redisson;
        
        public void processOrder(OrderMessage message) {
            String lockKey = "order:lock:" + message.getOrderId();
            RLock lock = redisson.getLock(lockKey);
            
            try {
                // 尝试获取锁，最多等待 5 秒，锁自动过期 30 秒
                boolean acquired = lock.tryLock(5, 30, TimeUnit.SECONDS);
                
                if (!acquired) {
                    throw new RuntimeException("无法获取锁");
                }
                
                // 业务处理
                processOrderInternal(message);
                
            } finally {
                // 释放锁
                if (lock.isHeldByCurrentThread()) {
                    lock.unlock();
                }
            }
        }
    }
}
```

### 3.5 消息表方案

```java
// 方案 4：消息处理表
public class MessageTableDeduplication {
    
    @Entity
    @Table(name = "message_process_log")
    public class MessageProcessLog {
        @Id
        private String messageId;
        
        private String status;  // PROCESSING, COMPLETED, FAILED
        
        private LocalDateTime createTime;
        private LocalDateTime updateTime;
        private LocalDateTime completeTime;
        
        private int retryCount;
        private String errorMessage;
    }
    
    @Service
    public class OrderService {
        
        @Autowired
        private MessageProcessLogRepository logRepository;
        
        public void processOrder(OrderMessage message) {
            // 查找处理记录
            MessageProcessLog log = logRepository
                .findByMessageId(message.getMessageId());
            
            if (log != null && "COMPLETED".equals(log.getStatus())) {
                log.info("消息已处理完成，跳过: {}", message.getMessageId());
                return;
            }
            
            if (log != null && "PROCESSING".equals(log.getStatus())) {
                // 处理中，可能是重复投递
                if (log.getRetryCount() > 10) {
                    // 处理超时，强制重试
                    log.setStatus("FAILED");
                    logRepository.save(log);
                } else {
                    log.info("消息正在处理中，跳过: {}", message.getMessageId());
                    return;
                }
            }
            
            // 首次处理或需要重试
            if (log == null) {
                log = new MessageProcessLog();
                log.setMessageId(message.getMessageId());
                log.setStatus("PROCESSING");
                log.setRetryCount(0);
            }
            
            log.setRetryCount(log.getRetryCount() + 1);
            log.setUpdateTime(LocalDateTime.now());
            logRepository.save(log);
            
            try {
                // 业务处理
                processOrderInternal(message);
                
                // 成功
                log.setStatus("COMPLETED");
                log.setCompleteTime(LocalDateTime.now());
                logRepository.save(log);
                
            } catch (Exception e) {
                log.setErrorMessage(e.getMessage());
                logRepository.save(log);
                throw e;
            }
        }
    }
}
```

## 四、幂等消费实战

### 4.1 通用幂等框架

```java
// 通用幂等框架
public class IdempotentProcessor {
    
    @FunctionalInterface
    public interface Processor&lt;T&gt; {
        void process(T data) throws Exception;
    }
    
    public &lt;T&gt; void processWithIdempotency(
            String key,
            T data,
            Processor&lt;T&gt; processor,
            Duration expireTime) {
        
        // 1. 检查是否已处理
        String processedKey = "idempotent:" + key;
        Boolean done = redisTemplate.hasKey(processedKey);
        
        if (Boolean.TRUE.equals(done)) {
            log.info("已处理过，跳过: {}", key);
            return;
        }
        
        // 2. 标记为处理中（防止并发处理）
        Boolean acquired = redisTemplate.opsForValue()
            .setIfAbsent(processedKey + ":processing", "1", 1, TimeUnit.MINUTES);
        
        if (!Boolean.TRUE.equals(acquired)) {
            throw new RuntimeException("正在处理中，请稍后重试");
        }
        
        try {
            // 3. 执行处理
            processor.process(data);
            
            // 4. 标记为已完成
            redisTemplate.opsForValue().set(processedKey, "1", expireTime);
            
        } catch (Exception e) {
            // 5. 失败时删除标记
            redisTemplate.delete(processedKey + ":processing");
            throw e;
        }
    }
}

// 使用
@Service
public class OrderService {
    
    @Autowired
    private IdempotentProcessor processor;
    
    public void processOrder(OrderMessage message) {
        processor.processWithIdempotency(
            "order:" + message.getOrderId(),
            message,
            msg -> doProcessOrder(msg),
            Duration.ofHours(24)
        );
    }
}
```

### 4.2 业务层面的幂等设计

```java
// 业务幂等设计：状态机
public class OrderStateMachine {
    
    // 订单状态
    public enum OrderStatus {
        CREATED,        // 已创建
        PAID,           // 已支付
        SHIPPED,        // 已发货
        COMPLETED,      // 已完成
        CANCELLED       // 已取消
    }
    
    public void processPayment(Order order, PaymentMessage message) {
        // 幂等检查：只有 CREATED 状态才能支付
        if (order.getStatus() != OrderStatus.CREATED) {
            log.info("订单状态不是已创建，跳过: orderId={}, status={}", 
                order.getId(), order.getStatus());
            return;
        }
        
        // 业务处理
        order.setStatus(OrderStatus.PAID);
        order.setPaymentTime(message.getPaymentTime());
        orderRepository.save(order);
        
        // 发送下游消息
        sendPaymentNotification(order);
    }
    
    // 消息重复发送也没关系
    // 因为只有 CREATED 状态才能转换
}

// 消息设计：携带业务状态
public class OrderMessage {
    private String orderId;
    private String orderStatus;  // 携带当前状态
    private long version;        // 版本号
}
```

## 五、幂等性方案对比

| 方案 | 适用场景 | 优点 | 缺点 |
|------|----------|------|------|
| 唯一键去重 | 有唯一业务 ID | 简单可靠 | 需要数据库支持 |
| Redis 去重 | 高并发场景 | 性能高 | 依赖 Redis |
| 分布式锁 | 需要强一致性 | 保证顺序 | 性能开销 |
| 消息表 | 需要详细日志 | 可追溯 | 增加存储 |
| 状态机 | 有明确状态流转 | 优雅 | 需要状态设计 |

## 六、最佳实践

### 6.1 消息 ID 生成

```java
// 消息 ID 生成方案
public class MessageIdGenerator {
    
    // 方案 1：UUID（简单但无序）
    public static String generateUUID() {
        return UUID.randomUUID().toString();
    }
    
    // 方案 2：雪花算法（有序 + 无冲突）
    public static long generateSnowflakeId() {
        return SnowflakeIdWorker.getInstance().nextId();
    }
    
    // 方案 3：业务前缀 + 时间 + 序号
    public static String generateBusinessId(String prefix) {
        return prefix + "-" + 
               LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMddHHmmss")) + 
               "-" + 
               ThreadLocalRandom.current().nextInt(10000);
    }
}
```

### 6.2 消息发送幂等

```java
// 消息发送幂等：记录消息 ID
public class IdempotentSender {
    
    private final KafkaProducer&lt;String, String&gt; producer;
    private final RedisTemplate&lt;String, String&gt; redisTemplate;
    
    public void sendWithIdempotency(String topic, String key, String value) {
        String messageId = generateMessageId(key, value);
        
        // 检查是否已发送
        String sentKey = "sent:" + messageId;
        Boolean exists = redisTemplate.hasKey(sentKey);
        
        if (Boolean.TRUE.equals(exists)) {
            log.info("消息已发送过，跳过: {}", messageId);
            return;
        }
        
        // 发送消息
        ProducerRecord&lt;String, String&gt; record = new ProducerRecord&lt;&gt;(
            topic, key, value
        );
        
        producer.send(record, (metadata, e) -> {
            if (e != null) {
                log.error("发送失败，不标记: {}", messageId);
            } else {
                // 发送成功，标记
                redisTemplate.opsForValue().set(sentKey, 
                    metadata.offset() + "", 7, TimeUnit.DAYS);
            }
        });
    }
}
```

### 6.3 完整幂等方案

```java
// 完整幂等方案
@Configuration
public class IdempotencyConfig {
    
    // 1. Producer 端：开启幂等性
    @Bean
    public KafkaProducer&lt;String, String&gt; idempotentProducer() {
        Properties props = new Properties();
        props.put("enable.idempotence", true);
        // ... 其他配置
        return new KafkaProducer&lt;&gt;(props);
    }
    
    // 2. Consumer 端：实现幂等消费
    @Bean
    public ConsumerFactory&lt;String, String&gt; idempotentConsumerFactory() {
        // 关闭自动提交
        props.put("enable.auto.commit", false);
        return new DefaultKafkaConsumerFactory&lt;&gt;(props);
    }
    
    // 3. 消息表：记录处理日志
    @Bean
    public MessageProcessLogRepository messageLogRepository() {
        // JPA Repository
        return new MessageProcessLogRepository();
    }
}
```

## 总结

幂等消费三道防线：

| 防线 | 位置 | 方案 |
|------|------|------|
| 第一道 | Producer | 开启幂等性 |
| 第二道 | Consumer | 手动提交 offset |
| 第三道 | 业务 | 幂等处理 |

**幂等性不是单一技术，而是一套完整的解决方案。**

---

## 留给你的问题

1. **幂等性与性能**：Redis 去重每次都要访问 Redis，性能如何优化？有没有更轻量的方案？

2. **消息表方案的问题**：如果消息处理成功但记录日志时宕机了，会发生什么？怎么避免？

3. **跨消息的幂等**：如果一条扣款消息和一条退款消息同时到达，怎么保证幂等？

4. **幂等性的时间窗口**：Redis key 设置 24 小时过期，如果 24 小时后收到重复消息怎么办？

思考这些问题，能帮你设计更健壮的幂等方案。
