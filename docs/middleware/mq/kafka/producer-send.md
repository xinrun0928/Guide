# Kafka 消息发送模式：同步、异步、异步回调

你真的会用 `producer.send()` 吗？

同一个方法，三种用法，性能和可靠性天差地别。

## 一、发送模式总览

```
┌─────────────────────────────────────────────────────────────────┐
│                    Kafka 三种发送模式                             │
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐        │
│  │   同步发送   │   │   异步发送   │   │  异步回调    │        │
│  │  send().get()│   │   send()     │   │  send(cb)    │        │
│  └──────────────┘   └──────────────┘   └──────────────┘        │
│        │                  │                  │                    │
│        ↓                  ↓                  ↓                    │
│   等待返回            立即返回            立即返回                  │
│   阻塞等待           返回 Future        回调通知                   │
│                                                                  │
│   性能：低              中                高                       │
│   可靠性：高            中                高（配合重试）            │
│   适用：关键消息        普通消息          高吞吐场景                │
└─────────────────────────────────────────────────────────────────┘
```

## 二、同步发送

### 2.1 基础用法

```java
// 同步发送：等待消息发送成功
public class SyncProducer {
    
    public void sendSync() {
        KafkaProducer&lt;String, String&gt; producer = new KafkaProducer&lt;&gt;(props);
        
        ProducerRecord&lt;String, String&gt; record = new ProducerRecord&lt;&gt;(
            "order-topic",
            "order-123",
            "order data"
        );
        
        try {
            // send() 返回 Future，调用 get() 阻塞等待结果
            RecordMetadata metadata = producer.send(record).get();
            
            System.out.println("发送成功！");
            System.out.println("Topic: " + metadata.topic());
            System.out.println("Partition: " + metadata.partition());
            System.out.println("Offset: " + metadata.offset());
            
        } catch (ExecutionException e) {
            // 发送失败
            System.out.println("发送失败: " + e.getCause());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
```

### 2.2 同步发送的时序

```
┌─────────────────────────────────────────────────────────────────┐
│                    同步发送时序                                  │
│                                                                  │
│  Producer Thread                                                │
│  │                                                              │
│  │  1. send(record).get()                                       │
│  │ ───────────────────────────────────────────────────────────── │
│  │                                                              │
│  │  2. 等待...（阻塞）                                          │
│  │     │                                                        │
│  │     ├── 选择分区                                             │
│  │     ├── 序列化                                               │
│  │     ├── 追加到缓冲区                                         │
│  │     ├── Sender 线程发送                                       │
│  │     └── 等待 ACK                                             │
│  │                                                              │
│  │  3. 返回结果                                                 │
│  │ ←────────────────────────────────────────────────────────────│
│  │                                                              │
│  │  4. 继续下一条                                               │
│  │                                                              │
│  时间：每条消息约 5-20ms（取决于网络和 Broker）                   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 同步发送的适用场景

```java
// 场景 1：订单创建
// 订单创建后必须确保消息发送成功
public class OrderCreation {
    
    public void createOrder(Order order) {
        // 1. 创建订单
        orderRepository.save(order);
        
        // 2. 发送订单消息（必须成功）
        try {
            producer.send(new ProducerRecord&lt;&gt;("order-topic", 
                order.getId(), order)).get();
        } catch (Exception e) {
            // 发送失败，订单创建也要回滚
            throw new RuntimeException("订单创建失败", e);
        }
        
        // 3. 返回成功
        return order;
    }
}

// 场景 2：支付通知
// 支付完成后必须通知下游
public class PaymentNotification {
    
    public void notifyPayment(Payment payment) {
        // 发送失败不能算支付成功
        RecordMetadata metadata = producer.send(
            new ProducerRecord&lt;&gt;("payment-topic", 
                payment.getId(), payment)
        ).get();
        
        log.info("支付通知已发送: {}", metadata.offset());
    }
}
```

## 三、异步发送

### 3.1 基础用法

```java
// 异步发送：不等待发送结果
public class AsyncProducer {
    
    public void sendAsync() {
        KafkaProducer&lt;String, String&gt; producer = new KafkaProducer&lt;&gt;(props);
        
        ProducerRecord&lt;String, String&gt; record = new ProducerRecord&lt;&gt;(
            "log-topic",
            "log-data"
        );
        
        // send() 立即返回 Future，不阻塞
        Future&lt;RecordMetadata&gt; future = producer.send(record);
        
        // 可以继续处理其他业务
        doOtherWork();
        
        // 如果需要结果，可以稍后获取
        try {
            RecordMetadata metadata = future.get(5, TimeUnit.SECONDS);
            log.info("发送成功: offset={}", metadata.offset());
        } catch (Exception e) {
            log.error("发送失败", e);
        }
    }
}
```

### 3.2 异步发送的时序

```
┌─────────────────────────────────────────────────────────────────┐
│                    异步发送时序                                  │
│                                                                  │
│  Producer Thread                    Sender Thread                │
│  │                                 │                            │
│  │  1. send(record)                │                            │
│  │  2. 立即返回 Future             │                            │
│  │ ──────────────────────────────────                           │
│  │                                                              │
│  │  3. 继续下一条                   │ 4. 后台发送                 │
│  │  4. 继续下一条                   │ 5. 处理 ACK                │
│  │  5. 继续下一条                   │                            │
│  │                                 │                            │
│  │  6. future.get()（如果需要）     │                            │
│  │ ←─────────────────────────────────                           │
│  │                                                              │
│  时间：几乎为 0ms                                               │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 异步发送的问题

```java
// 异步发送的问题：不知道发送结果
public class AsyncProducerProblem {
    
    public void problem() {
        for (int i = 0; i < 1000; i++) {
            // 发送时不等待结果
            producer.send(new ProducerRecord&lt;&gt;("topic", "msg" + i));
        }
        
        // 问题：循环结束后，不知道哪些消息发送成功了
        // 可能消息还在缓冲区，还没发送出去
    }
    
    // 解决：循环结束后等待缓冲区清空
    public void flush() {
        // 发送所有消息
        for (int i = 0; i < 1000; i++) {
            producer.send(new ProducerRecord&lt;&gt;("topic", "msg" + i));
        }
        
        // 等待所有消息发送完成
        producer.flush();
        
        // 此时所有消息要么发送成功，要么还在重试
    }
}
```

## 四、异步回调

### 4.1 基础用法

```java
// 异步回调：发送完成后自动通知
public class CallbackProducer {
    
    public void sendWithCallback() {
        KafkaProducer&lt;String, String&gt; producer = new KafkaProducer&lt;&gt;(props);
        
        ProducerRecord&lt;String, String&gt; record = new ProducerRecord&lt;&gt;(
            "order-topic",
            "order-123",
            "order data"
        );
        
        // 发送时传入回调
        producer.send(record, new Callback() {
            @Override
            public void onCompletion(RecordMetadata metadata, Exception e) {
                if (e == null) {
                    // 发送成功
                    System.out.println("发送成功！");
                    System.out.println("Topic: " + metadata.topic());
                    System.out.println("Partition: " + metadata.partition());
                    System.out.println("Offset: " + metadata.offset());
                } else {
                    // 发送失败
                    System.err.println("发送失败: " + e.getMessage());
                    // 这里可以重试或记录
                }
            }
        });
        
        // 继续处理其他业务
        doOtherWork();
    }
}
```

### 4.2 Lambda 简化写法

```java
// 使用 Lambda 简化回调
public class LambdaCallback {
    
    public void sendWithLambda() {
        KafkaProducer&lt;String, String&gt; producer = new KafkaProducer&lt;&gt;(props);
        
        ProducerRecord&lt;String, String&gt; record = new ProducerRecord&lt;&gt;(
            "order-topic",
            order.getId(),
            JSON.toJSONString(order)
        );
        
        // Lambda 回调
        producer.send(record, (metadata, e) -> {
            if (e != null) {
                log.error("发送订单消息失败: orderId={}, error={}", 
                    order.getId(), e.getMessage());
                // 失败处理：重试、告警、记录
            } else {
                log.info("发送订单消息成功: orderId={}, offset={}", 
                    order.getId(), metadata.offset());
            }
        });
    }
}
```

### 4.3 回调的时序

```
┌─────────────────────────────────────────────────────────────────┐
│                    异步回调时序                                  │
│                                                                  │
│  Producer Thread                    Sender Thread                │
│  │                                 │                            │
│  │  1. send(record, callback)      │                            │
│  │  2. 立即返回                     │                            │
│  │ ──────────────────────────────────                           │
│  │                                                              │
│  │  3. 继续处理业务                   │ 4. 后台发送              │
│  │                                   │ 5. 收到 ACK              │
│  │                                   │ 6. 执行回调               │
│  │                                   │ ──────────────────────────│
│  │                                                              │
│  │                                   │ 回调在 Sender 线程执行    │
│  │                                   │ 注意线程安全问题！         │
└─────────────────────────────────────────────────────────────────┘
```

### 4.4 回调的线程安全

```java
// 回调的线程安全问题
public class CallbackThreadSafety {
    
    public void threadSafety() {
        KafkaProducer&lt;String, String&gt; producer = new KafkaProducer&lt;&gt;(props);
        
        // 回调在 Sender 线程执行，不在 Producer 主线程
        producer.send(record, (metadata, e) -> {
            // 这里的代码可能和主线程并发执行
            // 不要访问主线程的非线程安全对象
            
            // 错误写法：
            // sharedMap.put(key, value);  // 如果 sharedMap 不是线程安全的
            
            // 正确写法：
            // 使用线程安全的方式处理
            log.info("offset={}", metadata.offset());
        });
    }
    
    // 如果需要访问主线程状态，使用线程安全的方式
    public void safeCallback() {
        ConcurrentHashMap&lt;String, Order&gt; pendingOrders = new ConcurrentHashMap&lt;&gt;();
        
        producer.send(record, (metadata, e) -> {
            if (e == null) {
                // 从线程安全的 Map 中移除
                pendingOrders.remove(record.key());
                log.info("发送成功: {}", metadata.offset());
            } else {
                // 失败处理
                pendingOrders.get(record.key()); // 安全访问
            }
        });
    }
}
```

## 五、发送模式对比

| 模式 | 代码 | 阻塞 | 性能 | 可靠性 | 适用场景 |
|------|------|------|------|--------|----------|
| 同步 | `send().get()` | 完全阻塞 | 低 | 高 | 关键消息 |
| 异步 | `Future.get()` | 按需阻塞 | 中 | 中 | 需要结果的普通消息 |
| 回调 | `send(Callback)` | 不阻塞 | 高 | 高（配合重试） | 高吞吐场景 |

## 六、实战：发送 100 万条消息

### 6.1 低效写法

```java
// 低效写法：逐条同步发送
public class BadProducer {
    
    public void sendBad() {
        long start = System.currentTimeMillis();
        
        for (int i = 0; i < 1000000; i++) {
            try {
                producer.send(new ProducerRecord&lt;&gt;("topic", 
                    "key-" + i, "value-" + i)).get();
            } catch (Exception e) {
                log.error("发送失败", e);
            }
        }
        
        long cost = System.currentTimeMillis() - start;
        log.info("发送 100 万条消息，耗时: {} ms", cost);
        // 结果：可能需要几十分钟
    }
}
```

### 6.2 异步批量发送

```java
// 高效写法：异步 + 批量
public class GoodProducer {
    
    public void sendGood() {
        long start = System.currentTimeMillis();
        
        // 使用 CountDownLatch 等待完成
        CountDownLatch latch = new CountDownLatch(1000000);
        
        AtomicLong successCount = new AtomicLong(0);
        AtomicLong failCount = new AtomicLong(0);
        
        for (int i = 0; i < 1000000; i++) {
            final int index = i;
            producer.send(new ProducerRecord&lt;&gt;("topic", 
                "key-" + i, "value-" + i), (metadata, e) -> {
                
                if (e == null) {
                    successCount.incrementAndGet();
                } else {
                    failCount.incrementAndGet();
                }
                latch.countDown();
            });
        }
        
        // 等待所有消息发送完成
        latch.await(10, TimeUnit.MINUTES);
        
        long cost = System.currentTimeMillis() - start;
        log.info("发送 100 万条消息，耗时: {} ms", cost);
        log.info("成功: {}, 失败: {}", successCount.get(), failCount.get());
        // 结果：可能只需要几分钟
    }
}
```

### 6.3 最高效写法：批处理 + 压缩

```java
// 最高效写法：充分利用批处理和压缩
public class BestProducer {
    
    public void sendBest() {
        KafkaProducer&lt;String, String&gt; producer = new KafkaProducer&lt;&gt;(props);
        
        long start = System.currentTimeMillis();
        long count = 0;
        
        // 充分利用 batch.size 和 linger.ms
        // 消息会先在缓冲区积累，达到阈值后批量发送
        
        for (int i = 0; i < 1000000; i++) {
            producer.send(new ProducerRecord&lt;&gt;("topic", 
                "key-" + i, "value-" + i));
            count++;
            
            // 每 10 万条打印一次进度
            if (count % 100000 == 0) {
                producer.flush();
                log.info("已发送: {}", count);
            }
        }
        
        // 确保所有消息发送完成
        producer.flush();
        
        long cost = System.currentTimeMillis() - start;
        log.info("发送 {} 万条消息，耗时: {} ms", count / 10000, cost);
    }
}
```

## 七、发送配置优化

### 7.1 批处理配置

```java
// 批处理配置
public class BatchConfig {
    
    // 关键参数
    
    // batch.size：单个批次最大字节数
    // 太大：延迟增加
    // 太小：批次效果不明显
    // 推荐：16KB - 128KB
    props.put("batch.size", 32768);  // 32KB
    
    // linger.ms：等待凑够批次的时间
    // 为 0：无等待，有消息就发送
    // > 0：最多等待这么久，凑够批次
    // 推荐：5-20ms（根据延迟敏感度调整）
    props.put("linger.ms", 10);
    
    // buffer.memory：缓冲区总大小
    // 太小：发送过快时阻塞
    // 推荐：至少 batch.size × 并发数 × 2
    props.put("buffer.memory", 67108864);  // 64MB
}
```

### 7.2 压缩配置

```java
// 压缩配置
public class CompressionConfig {
    
    // compression.type
    // none：不压缩
    // gzip：压缩率高，CPU 开销大
    // snappy：压缩率中等，CPU 开销小
    // lz4：压缩率高，速度快（推荐）
    
    props.put("compression.type", "lz4");
    
    // 压缩位置：Producer 端压缩
    // 优点：减少网络传输
    // 缺点：Broker 存储压缩消息
}
```

### 7.3 推荐配置

```java
// 推荐的高吞吐配置
public class RecommendedConfig {
    
    Properties props = new Properties();
    
    // 连接
    props.put("bootstrap.servers", "localhost:9092,localhost:9093,localhost:9094");
    
    // 序列化
    props.put("key.serializer", "StringSerializer");
    props.put("value.serializer", "StringSerializer");
    
    // 批处理
    props.put("batch.size", 65536);       // 64KB
    props.put("linger.ms", 20);           // 等待 20ms
    props.put("buffer.memory", 134217728); // 128MB
    
    // 压缩
    props.put("compression.type", "lz4");
    
    // 重试
    props.put("retries", 3);
    props.put("retry.backoff.ms", 100);
    
    // 可靠性（可选）
    // props.put("acks", "all");
    // props.put("enable.idempotence", true);
}
```

## 八、常见问题

### 8.1 消息丢失

```java
// 问题：异步发送后立即关闭 Producer
public class MessageLossProblem {
    
    public void problem() {
        for (int i = 0; i < 100; i++) {
            producer.send(new ProducerRecord&lt;&gt;("topic", "msg" + i));
        }
        
        // 问题：可能还有消息在缓冲区
        producer.close();  // 缓冲区中的消息可能丢失
    }
    
    // 解决：确保消息发送完成
    public void solution() {
        for (int i = 0; i < 100; i++) {
            producer.send(new ProducerRecord&lt;&gt;("topic", "msg" + i));
        }
        
        // flush() 等待所有消息发送完成
        producer.flush();
        
        // 然后再关闭
        producer.close();
    }
}
```

### 8.2 顺序问题

```java
// 问题：异步发送无法保证顺序
public class OrderingProblem {
    
    public void problem() {
        // 发送 3 条消息，希望按顺序处理
        producer.send(new ProducerRecord&lt;&gt;("topic", "1"));  // 发送
        producer.send(new ProducerRecord&lt;&gt;("topic", "2"));  // 发送
        producer.send(new ProducerRecord&lt;&gt;("topic", "3"));  // 发送
        
        // 由于是异步的，可能的到达顺序是：
        // 3, 1, 2（乱序）
    }
    
    // 解决：使用同步发送或带 Key
    public void solution() {
        // 方案 1：同步发送
        for (int i = 0; i < 3; i++) {
            producer.send(new ProducerRecord&lt;&gt;("topic", 
                String.valueOf(i), "msg" + i)).get();
        }
        
        // 方案 2：使用相同 Key（发到同一分区，保证有序）
        for (int i = 0; i < 3; i++) {
            producer.send(new ProducerRecord&lt;&gt;("topic", 
                "same-key", "msg" + i));  // 同一分区，有序
        }
    }
}
```

### 8.3 性能调优

```java
// 性能调优思路
public class PerformanceTuning {
    
    // 吞吐量低？
    // 1. 增加 batch.size
    // 2. 增加 linger.ms
    // 3. 增加 buffer.memory
    // 4. 开启压缩
    // 5. 增加网络线程数
    
    // 延迟高？
    // 1. 减少 batch.size
    // 2. 减少 linger.ms
    // 3. 减少 retries
    // 4. 检查网络
    
    // 内存溢出？
    // 1. 减少 buffer.memory
    // 2. 减少 batch.size
    // 3. 增加发送频率
}
```

## 总结

发送模式选择指南：

| 场景 | 推荐模式 | 原因 |
|------|----------|------|
| 订单/支付消息 | 同步 | 必须确保成功 |
| 日志/监控数据 | 异步回调 | 高吞吐，允许少量丢失 |
| 大批量导入 | 批处理 + flush | 追求极致吞吐 |
| 消息不重复关键 | 同步 + 幂等性 | 确保成功 + 防重复 |

**选择正确的发送模式，是保证系统可靠性和性能的关键。**

---

## 留给你的问题

1. **异步发送的丢失风险**：异步发送时，`producer.send()` 成功了但回调还没执行时应用挂了，消息会丢失吗？缓冲区里的消息呢？

2. **回调异常处理**：回调里抛出异常会怎样？Kafka 会重试吗？

3. **批处理的边界**：设置 `batch.size=64KB, linger.ms=20ms`，如果 1ms 内就凑够了 64KB，消息会等 20ms 再发送吗？

4. **多线程安全**：`KafkaProducer` 线程安全吗？多个线程共用一个 Producer 和各自用一个 Producer，哪个更好？

思考这些问题，能帮你更好地使用 Producer。
