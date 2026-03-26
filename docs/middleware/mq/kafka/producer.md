# Kafka 生产者（Producer）原理：分区、ACK、幂等性、事务

消息是怎么发到 Kafka 的？

你以为只是调个 `send()` 方法，背后藏着一整套复杂机制：

- 消息该发到哪个分区？
- 发送成功了吗？怎么确认？
- 发送失败了怎么办？
- 重试会不会导致重复？

今天，我们深入 Producer 的核心原理。

## 一、Producer 架构

### 1.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Kafka Producer 架构                           │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      Producer                            │   │
│  │                                                         │   │
│  │  ┌────────────┐     ┌────────────┐     ┌────────────┐  │   │
│  │  │  Producer   │ ──→ │  Record    │ ──→ │  Sender    │  │   │
│  │  │   Record    │     │  Accumulator│     │   Thread   │  │   │
│  │  └────────────┘     └─────┬──────┘     └──────┬─────┘  │   │
│  │                           │                     │        │   │
│  │                           ↓                     ↓        │   │
│  │                   ┌────────────┐          ┌─────────┐   │   │
│  │                   │  Batch     │          │  Kafka  │   │   │
│  │                   │  Buffer    │          │ Cluster │   │   │
│  │                   └────────────┘          └─────────┘   │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

核心组件：

- **ProducerRecord**：用户创建的消息
- **RecordAccumulator**：消息缓冲区，批量发送
- **Sender Thread**：后台线程，负责实际发送

### 1.2 发送流程

```java
// Producer 发送流程
public class ProducerFlow {
    
    // 1. 用户调用 send()
    producer.send(record);
    
    // 2. 分区选择
    //    - 有 Key：哈希分区
    //    - 无 Key：轮询分区
    int partition = partitioner.partition(record);
    
    // 3. 序列化
    byte[] keyBytes = serializer.serialize(record.key());
    byte[] valueBytes = serializer.serialize(record.value());
    
    // 4. 追加到缓冲区
    accumulator.append(partition, keyBytes, valueBytes, callback);
    
    // 5. Sender 线程异步发送
    //    - 打包批次
    //    - 发送到 Broker
    //    - 处理响应
}
```

## 二、分区策略

### 2.1 分区选择流程

```java
// 分区选择流程
public class PartitionSelection {
    
    public int partition(ProducerRecord&lt;String, String&gt; record, Cluster cluster) {
        // 1. 已有分区直接使用
        if (record.partition() != null) {
            return record.partition();
        }
        
        // 2. 有 Key，按 Key 哈希
        if (record.key() != null) {
            return partitionForKey(record.key(), cluster);
        }
        
        // 3. 无 Key，轮询选择
        return nextPartition(cluster);
    }
}
```

### 2.2 内置分区器

```java
// DefaultPartitioner（默认分区器）
public class DefaultPartitioner {
    
    private int index = 0;
    
    // 有 Key 的分区逻辑
    public int partitionForKey(String key, int numPartitions) {
        // 使用 murmur2 哈希算法
        return Math.abs(Utils.murmur2(key.getBytes())) % numPartitions;
    }
    
    // 无 Key 的分区逻辑
    public int nextPartition(String topic, int numPartitions) {
        // 轮询选择
        int partition = index % numPartitions;
        index++;
        return partition;
    }
}
```

### 2.3 自定义分区器

```java
// 自定义分区器：按用户 ID 分区
public class UserIdPartitioner implements Partitioner {
    
    private final ConcurrentMap&lt;String, AtomicInteger&gt; topicCounters = new ConcurrentHashMap&lt;&gt;();
    
    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                        Object value, byte[] valueBytes, Cluster cluster) {
        
        if (key == null) {
            // 无 Key，轮询
            return new Random().nextInt(cluster.partitionCountForTopic(topic));
        }
        
        // 有 Key，按 Key 哈希
        return Math.abs(key.hashCode()) % cluster.partitionCountForTopic(topic);
    }
}

// 配置使用自定义分区器
props.put("partitioner.class", "com.example.UserIdPartitioner");
```

## 三、ACK 确认机制

### 3.1 三种 ACK 级别

```java
// ACK 配置
public class AckLevels {
    
    // acks=0：发送即返回，不等待确认
    // 风险：可能丢失消息
    // 适用：日志采集，允许少量丢失
    props.put("acks", "0");
    
    // acks=1：Leader 写入即返回
    // 风险：Leader 宕机可能丢失
    // 适用：一般场景
    props.put("acks", "1");
    
    // acks=all / -1：ISR 所有副本确认
    // 风险：低，但延迟高
    // 适用：金融级场景
    props.put("acks", "all");
}
```

### 3.2 ACK 流程对比

```
┌─────────────────────────────────────────────────────────────────┐
│                    acks=0                                        │
│                                                                  │
│  Producer ──→ Leader ──→ 返回成功                               │
│                      │                                           │
│                      └── 数据可能在内存，没同步到磁盘              │
│                      └── Follower 可能没同步到                   │
│                                                                  │
│  时间：~1ms                                                      │
│  可靠性：低                                                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    acks=1                                        │
│                                                                  │
│  Producer ──→ Leader ──→ 写入磁盘 ──→ 返回成功                    │
│                      │                                           │
│                      └── Leader 已持久化                          │
│                      └── Follower 异步 同步                       │
│                                                                  │
│  时间：~5ms                                                      │
│  可靠性：中                                                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    acks=all                                     │
│                                                                  │
│  Producer ──→ Leader ──→ Follower1 ──→ Follower2 ──→ 返回成功   │
│                      │         │          │                      │
│                      └── 等待所有 ISR 副本确认 ────→              │
│                                                                  │
│  时间：~20ms                                                     │
│  可靠性：高                                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 min.insync.replicas

```java
// 配合 acks=all 使用
// 确保写入被多个副本确认
props.put("min.insync.replicas", "2");

// 场景：副本因子 = 3
// min.insync.replicas = 2

// 写入成功条件：
// - ISR 至少有 2 个副本
// - Leader + 至少 1 个 Follower 确认

// 如果只有 1 个 ISR 副本（Leader 本身）：
// - 写入失败，抛出 NotEnoughReplicasException
// - Producer 收到错误，可以重试
```

## 四、幂等性

### 4.1 幂等性的价值

幂等性解决的是**重复发送**的问题：

```
问题场景：

1. Producer 发送消息到 Broker
2. Broker 写入成功，返回 ACK
3. ACK 在网络中丢失

结果：
- Producer 认为发送失败
- 重试发送同样的消息
- Broker 收到两条相同消息！

幂等性解决：
- Broker 识别重复消息
- 只存储一条
```

### 4.2 幂等性原理

```java
// Kafka 幂等性实现
public class IdempotentProducer {
    
    // 幂等性开启后，Producer 会：
    // 1. 绑定到一个 Session
    // 2. 每条消息带一个递增的 sequence number
    
    // Broker 端维护：
    // (ProducerID, Partition) → LastSequenceNumber
    
    // 处理逻辑：
    // if (incomingSeq > lastSeq) {
    //     // 新消息，存储
    //     lastSeq = incomingSeq;
    // } else if (incomingSeq <= lastSeq) {
    //     // 重复消息，丢弃
    // }
}

// 开启幂等性
props.put("enable.idempotence", true);

// 自动配置：
// - acks=all（隐含）
// - retries=Integer.MAX_VALUE（隐含）
// - max.inflight.requests.per.connection=5（隐含，防止乱序）
```

### 4.3 幂等性的边界

```java
// 幂等性的局限
public class IdempotenceLimits {
    
    // 1. 单 Producer 有效
    //    不同 ProducerID 产生的重复消息无法识别
    //    重启 Producer 后，会生成新的 ProducerID
    
    // 2. 单 Session 有效
    //    Producer 重启后，之前的序列号丢失
    //    可能产生重复消息
    
    // 3. 分区级别
    //    按 (ProducerID, Partition) 追踪
    //    不同分区的重复无法识别
}
```

## 五、事务

### 5.1 为什么需要事务？

幂等性只能防止**单 Producer** 的**单分区**重复，无法保证**多分区**的原子性。

```
问题场景：

订单场景：
1. 订单消息发到 order-topic
2. 库存扣减消息发到 inventory-topic

问题：
- 订单消息发送成功
- 库存消息发送失败
- 数据不一致！

事务解决：
- 两个操作要么都成功，要么都失败
- 原子性保证
```

### 5.2 事务配置

```java
// 开启事务
props.put("enable.idempotence", true);
props.put("transactional.id", "producer-1");  // 事务 ID，必须唯一

// 初始化事务
producer.initTransactions();

try {
    producer.beginTransaction();
    
    producer.send(record1);
    producer.send(record2);
    
    producer.commitTransaction();
} catch (Exception e) {
    producer.abortTransaction();
}
```

### 5.3 事务原理

```
┌─────────────────────────────────────────────────────────────────┐
│                    Kafka 事务原理                                │
│                                                                  │
│  1. Producer 初始化事务                                          │
│     ├── 生成 transactional.id                                   │
│     └── 从 Coordinator 获取 PID（Producer ID）                   │
│                                                                  │
│  2. 发送消息                                                    │
│     ├── 消息带 PID + sequence number                             │
│     └── 数据先写到隔离日志（transactional.id 为 key）             │
│                                                                  │
│  3. 提交事务                                                    │
│     ├── Producer 发送 CommitTransaction 请求                     │
│     ├── Coordinator 写入 Commit Marker                           │
│     └── 消费者可见消息                                           │
│                                                                  │
│  4. 中止事务                                                    │
│     ├── Producer 发送 AbortTransaction 请求                      │
│     ├── Coordinator 写入 Abort Marker                           │
│     └── 消费者不可见消息（被过滤掉）                              │
└─────────────────────────────────────────────────────────────────┘
```

### 5.4 事务隔离级别

```java
// Consumer 端隔离
public class TransactionalConsumer {
    
    // isolation.level 配置
    
    // read_uncommitted（默认）
    // - 读取所有消息，包括未提交事务的消息
    
    // read_committed
    // - 只读取已提交事务的消息
    // - 未提交事务的消息被过滤掉
    props.put("isolation.level", "read_committed");
}
```

### 5.5 事务 vs 幂等性

| 特性 | 幂等性 | 事务 |
|------|--------|------|
| 范围 | 单 Producer | 多 Producer |
| 保证 | 单分区不重复 | 多分区原子性 |
| 性能开销 | 低 | 高 |
| 使用场景 | 一般重复防护 | 强一致性场景 |

## 六、发送流程源码解析

### 6.1 RecordAccumulator

```java
// RecordAccumulator：消息缓冲区
public class RecordAccumulator {
    
    // 按分区缓冲
    private final ConcurrentMap&lt;TopicPartition, Deque&lt;ProducerBatch&gt;&gt; batches;
    
    // 追加消息
    public RecordAppendResult append(TopicPartition tp, long timestamp,
            byte[] key, byte[] value, Header[] headers, 
            Callback callback, long maxTimeToBlock) throws InterruptedException {
        
        // 1. 获取或创建批次
        Deque&lt;ProducerBatch&gt; dq = getOrCreateDeque(tp);
        
        synchronized (dq) {
            // 2. 尝试追加到现有批次
            RecordAppendResult result = dq.peekLast().tryAppend(...);
            if (result != null) {
                return result;
            }
        }
        
        // 3. 创建新批次
        ProducerBatch batch = new ProducerBatch(tp, ...)
        batch.append(...);
        
        // 4. 追加到队列
        dq.addLast(batch);
        
        return new RecordAppendResult(..., true, ...);
    }
}
```

### 6.2 Sender 线程

```java
// Sender 线程：负责实际发送
public class Sender implements Runnable {
    
    @Override
    public void run() {
        while (running) {
            runOnce();
        }
    }
    
    private void runOnce() {
        // 1. 收集可以发送的批次
        Map&lt;Integer, List&lt;ProducerBatch&gt;&gt; batches = accumulator.drain(
            cluster, 
            producers.keySet(),
            Integer.MAX_VALUE,
            time.max.poll.interval.ms
        );
        
        // 2. 加上正在等待确认的批次
        addSends(batches);
        
        // 3. 发送所有准备好的批次
        for (ProducerBatch batch : readyNodes) {
            sendProduceRequest(batch, ...);
        }
        
        // 4. 处理响应
        client.poll(pollTimeout, now);
        
        // 5. 处理超时批次（重试）
        accumulator.abortExpiredBatches(...);
    }
}
```

### 6.3 完整发送时序

```
┌─────────────────────────────────────────────────────────────────┐
│                    Producer 完整发送时序                          │
│                                                                  │
│  用户线程                          Sender 线程                   │
│     │                                 │                          │
│     │  1. send(record)                │                          │
│     │ ──────────────────────────────→│                          │
│     │                                 │                          │
│     │  2. 分区选择                    │                          │
│     │  3. 序列化                      │                          │
│     │  4. 追加到缓冲区                │                          │
│     │ ──────────────────────────────→│                          │
│     │                                 │                          │
│     │                                 │  5. 打包批次               │
│     │                                 │  6. 发送到 Broker          │
│     │                                 │ ──────────────────────────→│
│     │                                 │                           │
│     │                                 │  7. 等待 ACK              │
│     │                                 │ ←──────────────────────────│
│     │                                 │                           │
│     │  8. 返回 Future                 │                          │
│     │ ←─────────────────────────────────                          │
│     │                                 │                           │
│     │  9. 调用回调（异步）             │                          │
│     │                                 │                          │
└─────────────────────────────────────────────────────────────────┘
```

## 七、生产者配置实战

### 7.1 基础配置

```java
// 基础 Producer 配置
public class BasicProducerConfig {
    
    Properties props = new Properties();
    
    // 连接配置
    props.put("bootstrap.servers", "localhost:9092,localhost:9093,localhost:9094");
    
    // 序列化
    props.put("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
    props.put("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");
    
    // 压缩
    props.put("compression.type", "lz4");
    
    // 重试
    props.put("retries", 3);
    props.put("retry.backoff.ms", 100);
    
    // 批处理
    props.put("batch.size", 16384);           // 16KB
    props.put("linger.ms", 10);                // 等待时间
    props.put("buffer.memory", 33554432);      // 32MB
}
```

### 7.2 高可靠配置

```java
// 高可靠 Producer 配置
public class ReliableProducerConfig {
    
    Properties props = new Properties();
    
    // 核心：acks=all
    props.put("acks", "all");
    
    // 配合 min.insync.replicas
    props.put("min.insync.replicas", "2");
    
    // 开启幂等性
    props.put("enable.idempotence", true);
    
    // 足够多的重试
    props.put("retries", "Integer.MAX_VALUE");
    
    // 重试间隔
    props.put("retry.backoff.ms", "1000");
    
    // 批次配置：延迟换吞吐
    props.put("batch.size", "131072");    // 128KB
    props.put("linger.ms", "20");         // 20ms
}
```

### 7.3 高吞吐配置

```java
// 高吞吐 Producer 配置
public class HighThroughputProducerConfig {
    
    Properties props = new Properties();
    
    // acks 适度（1 就够）
    props.put("acks", "1");
    
    // 压缩提高吞吐
    props.put("compression.type", "lz4");
    
    // 加大批次
    props.put("batch.size", "524288");    // 512KB
    props.put("linger.ms", "50");         // 50ms
    
    // 加大缓冲区
    props.put("buffer.memory", "1073741824");  // 1GB
    
    // 多连接
    props.put("max.in.flight.requests.per.connection", "5");
}
```

## 总结

Producer 核心要点：

| 概念 | 说明 |
|------|------|
| 分区选择 | Key 哈希 / 轮询 / 自定义 |
| ACK 确认 | 0/1/all 三种级别 |
| 幂等性 | 防止单 Producer 重复 |
| 事务 | 多分区原子性保证 |

**理解 Producer 原理，才能正确配置和排查问题。**

---

## 留给你的问题

1. **幂等性与重试的冲突**：开启幂等性后，`max.in.flight.requests.per.connection` 被限制为 5。这是为什么？如果设成更大的值会发生什么？

2. **事务的边界**：Kafka 事务和数据库事务有什么本质区别？Kafka 事务能回滚已经写入的消息吗？

3. **batch.size 与 linger.ms**：这两个参数都会影响批处理，什么时候该调大 batch.size，什么时候该调大 linger.ms？

4. **Producer 内存溢出**：如果 Producer 发送太快，缓冲区满了，会发生什么？`max.block.ms` 参数控制什么行为？

思考这些问题，能帮你深入理解 Producer 的行为。
