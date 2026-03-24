# Kafka 分区数与消费者线程数设置

「Kafka 分区数是不是越多越好？」

「消费者线程数应该怎么设置？」

「分区数 10 个，消费者 20 个会怎样？」

这些问题，面试里常问，生产里常踩坑。

## 分区的本质

分区（Partition）是 Kafka 并行处理的核心单位。

```
┌─────────────────────────────────────────────────────────┐
│                         Topic                           │
│                                                         │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐│
│  │ Partiton 0│ │ Partiton 1│ │ Partiton 2│ │ Partiton N││
│  │           │ │           │ │           │ │           ││
│  │ [msg1]    │ │ [msg2]    │ │ [msg3]    │ │ [msg4]    ││
│  │ [msg5]    │ │ [msg6]    │ │ [msg7]    │ │ [msg8]    ││
│  │ [msg9]    │ │ [msg10]   │ │ [msg11]   │ │ [msg12]   ││
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘│
│       ↑            ↑            ↑            ↑            │
│       │            │            │            │            │
└───────┼────────────┼────────────┼────────────┼────────────┘
        │            │            │            │
        ↓            ↓            ↓            ↓
   Consumer1    Consumer2    Consumer3    Consumer4
   (线程1)      (线程2)      (线程3)      (线程4)
```

**分区的核心特性**：

1. **分区内有序**：同一分区内的消息是有序的
2. **分区间无序**：不同分区的消息不保证顺序
3. **并行消费**：一个分区只能被一个消费者组中的一个消费者消费
4. **分区固定**：分区数创建后不能减少，只能增加

## 分区数的计算公式

分区数由两个因素决定：**吞吐量需求** 和 **消费者数量**。

### 公式一：基于生产者吞吐量

```
分区数 = 生产者期望吞吐量 ÷ 单分区吞吐量

例如：
- 期望 Producer QPS：10 万/秒
- 单分区 Producer 吞吐量：5 万/秒（保守估计 2 万）
- 分区数 = 100000 / 20000 = 5
```

### 公式二：基于消费者吞吐量

```
分区数 = 消费者期望吞吐量 ÷ 单分区消费者吞吐量

例如：
- 期望 Consumer QPS：5 万/秒
- 单分区 Consumer 吞吐量：2 万/秒
- 分区数 = 50000 / 20000 = 3（但要考虑并发，最少 3）
```

### 公式三：基于并发需求

```
分区数 ≥ 消费者数量

原因：一个分区只能被一个消费者消费
分区数 < 消费者数量 → 多余的消费者空闲
```

### 综合公式

```java
// 实际计算
public int calculatePartitionCount(PartitionConfig config) {
    // 基于生产者的分区数
    int partitionsByProducer = config.getTargetProducerQps() / config.getSinglePartitionProducerQps();
    
    // 基于消费者的分区数
    int partitionsByConsumer = config.getTargetConsumerQps() / config.getSinglePartitionConsumerQps();
    
    // 基于消费者的分区数（考虑并发）
    int partitionsByConcurrency = config.getMaxConsumerThreads();
    
    // 取最大值，并确保满足并发需求
    int partitions = Math.max(
        Math.max(partitionsByProducer, partitionsByConsumer),
        partitionsByConcurrency
    );
    
    // 考虑容错：分区数 = 计算值 + 冗余分区（通常 20%~50%）
    return (int)(partitions * 1.3);
}
```

## 消费者线程数设置

### 一个消费者 vs 多线程消费者

Kafka Consumer 有两种消费模式：

```
模式一：单消费者多线程处理
┌────────────┐    一个 Consumer     ┌──────────────┐
│  Kafka    │ ──────────────────&gt; │   Process    │
│  Consumer │     拉取消息         │  Executor    │
└────────────┘                      │  (多线程池)   │
                                     └──────────────┘
优势：消息顺序由 Consumer 保证
劣势：分区顺序由线程池决定，不保证

模式二：多消费者线程消费
┌────────────┐    Part 0    ┌────────────┐
│  Kafka    │ ──────────────────&gt; │ Consumer   │
│  Consumer1│               │    Thread1  │
├────────────┤    Part 1    ├────────────┤
│  Kafka    │ ──────────────────&gt; │ Consumer   │
│  Consumer2│               │    Thread2  │
├────────────┤    Part 2    ├────────────┤
│  Kafka    │ ──────────────────&gt; │ Consumer   │
│  Consumer3│               │    Thread3  │
└────────────┘                  └────────────┘
优势：分区级并行
劣势：需要处理 Rebalance
```

### 线程数计算公式

```java
// 单进程 Consumer 线程数 = 分区数（每个线程消费一个分区）
// 但实际要考虑业务处理时间

public class KafkaConsumerConfig {
    
    // 基础配置
    private int partitionCount;  // Topic 分区数
    
    // 单条消息处理时间
    private long avgProcessTimeMs;  // 平均处理时间
    
    // 期望的端到端延迟
    private long targetLatencyMs;  // 期望最大延迟
    
    // 计算最大并发线程数
    public int calculateThreadCount() {
        // 并行度 = 单分区处理时间 / 期望延迟
        int parallelism = (int)(avgProcessTimeMs / targetLatencyMs) + 1;
        
        // 但不能超过分区数
        return Math.min(parallelism, partitionCount);
    }
}
```

### 多线程消费者实现

```java
public class KafkaConsumerService {
    
    private final KafkaConsumer&lt;String, String&gt; consumer;
    private final ExecutorService executor;
    private final Map&lt;TopicPartition, OffsetAndMetadata&gt; currentOffsets = new ConcurrentHashMap&lt;&gt;();
    
    public void consume() {
        // 1. 订阅 Topic
        consumer.subscribe(Arrays.asList("my-topic"), new ConsumerRebalanceListener() {
            @Override
            public void onPartitionsRevoked(Collection&lt;TopicPartition&gt; partitions) {
                // Rebalance 前提交 offset
                commitOffsets();
            }
            
            @Override
            public void onPartitionsAssigned(Collection&lt;TopicPartition&gt; partitions) {
                // 分区分配后，可以从上次位置继续
            }
        });
        
        // 2. 启动消费循环
        while (running) {
            ConsumerRecords&lt;String, String&gt; records = consumer.poll(Duration.ofMillis(100));
            
            // 3. 分配给线程池处理
            for (ConsumerRecord&lt;String, String&gt; record : records) {
                executor.submit(() -> processRecord(record));
            }
            
            // 4. 异步提交 offset
            commitOffsets();
        }
    }
    
    private void processRecord(ConsumerRecord&lt;String, String&gt; record) {
        try {
            // 业务处理
            doProcess(record);
            
            // 记录消费位置
            currentOffsets.put(
                new TopicPartition(record.topic(), record.partition()),
                new OffsetAndMetadata(record.offset() + 1)
            );
        } catch (Exception e) {
            log.error("处理消息失败", e);
            // 失败处理：重试、死信队列
        }
    }
    
    private void commitOffsets() {
        if (!currentOffsets.isEmpty()) {
            consumer.commitAsync(currentOffsets, (offsets, exception) -&gt; {
                if (exception != null) {
                    log.error("提交 offset 失败", exception);
                }
            });
        }
    }
}
```

## 分区数与消费者数的关系

### 黄金法则

```
分区数 = 消费者数 × N（N ≥ 1）

理想情况：每个消费者绑定固定数量的分区
分区数必须是消费者数的整数倍，以实现负载均衡
```

### 场景分析

| 场景 | 分区数 | 消费者数 | 结果 |
|------|--------|---------|------|
| 分区数 < 消费者数 | 3 | 6 | 3 个消费者空闲 |
| 分区数 = 消费者数 | 6 | 6 | 完美匹配 |
| 分区数 > 消费者数 | 12 | 6 | 每消费者 2 分区 |
| 分区数 ≠ 整数倍 | 10 | 3 | 分配不均：4+3+3 |

### 代码模拟：Rebalance 分配

```java
// Kafka 默认分区分配策略：RangeAssignor
// 假设有 10 个分区，3 个消费者

// 分配结果：
// 消费者1：分区0,1,2,3
// 消费者2：分区4,5,6
// 消费者3：分区7,8,9

// 如果消费者3 挂了，触发 Rebalance：
// 消费者1：分区0,1,2,3,4,5
// 消费者2：分区6,7,8,9
// 分配变化导致重复消费！
```

## 常见问题与解决方案

### 问题 1：分区数太少，吞吐量上不去

```java
// 增加分区数
// 注意：只能增加，不能减少
./bin/kafka-topics.sh --alter --topic my-topic --partitions 20 --bootstrap-server localhost:9092
```

### 问题 2：消费者处理慢，消息积压

```java
// 方案1：增加消费者线程（如果有分区）
// 方案2：增加分区数 + 增加消费者
// 方案3：优化消费者处理逻辑

// 监控消费 lag
kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
    --group my-group --describe

// 输出：
// GROUP           TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
// my-group        my-topic        0          5000             8000            3000  ← 积压了 3000 条
```

### 问题 3：分区不均匀

```java
// 使用自定义分区器实现均匀分配
public class CustomPartitioner implements Partitioner {
    
    @Override
    public int partition(String topic, Object key, byte[] keyBytes, 
                         Object value, byte[] valueBytes, Cluster cluster) {
        List&lt;PartitionInfo&gt; partitions = cluster.partitionsForTopic(topic);
        int numPartitions = partitions.size();
        
        // 自定义分配逻辑：例如按 Key 哈希后均匀分配
        if (key == null) {
            return new Random().nextInt(numPartitions);
        }
        
        return Math.abs(key.hashCode()) % numPartitions;
    }
}
```

## 分区数规划建议

### 小型项目（QPS < 1 万）

| 配置项 | 建议值 | 说明 |
|--------|--------|------|
| 分区数 | 6~12 | 预留扩展空间 |
| 副本数 | 2 | 平衡可靠性和成本 |
| 消费者线程 | 6~12 | 与分区数 1:1 |

### 中型项目（QPS 1 万~10 万）

| 配置项 | 建议值 | 说明 |
|--------|--------|------|
| 分区数 | 20~50 | 根据吞吐需求计算 |
| 副本数 | 3 | 生产环境至少 3 副本 |
| 消费者线程 | 与分区数匹配 | 避免空闲线程 |

### 大型项目（QPS > 10 万）

| 配置项 | 建议值 | 说明 |
|--------|--------|------|
| 分区数 | 50~200 | 根据精确计算 |
| 副本数 | 3 | 金融级场景考虑 5 副本 |
| 消费者线程 | 与分区数匹配 | 可能需要多 Consumer 实例 |

## 总结

Kafka 分区和消费者配置的核心原则：

| 原则 | 说明 |
|------|------|
| 分区数决定并行度 | 分区数 = 最大并发消费数 |
| 消费者数 ≤ 分区数 | 多余消费者会空闲 |
| 预估未来增长 | 分区数只能增加不能减少 |
| 监控消费 lag | lag 持续增长说明消费跟不上了 |
| 合理设置线程数 | 单消费者多线程需注意顺序问题 |

---

## 留给你的问题

假设你设计一个订单消息处理系统：

1. 每天 500 万订单，高峰期 QPS 约 1000
2. 单条消息处理约 50ms
3. 期望端到端延迟 < 1 秒
4. 需要保证消息不丢失、不重复

请回答：

1. 分区数应该设为多少？如何计算？
2. 如果现在分区数是 10，想扩容到 20，消费者和分区对应关系会怎么变化？
3. 消息处理过程中，可能出现重复消费（Consumer 挂了重启），如何保证幂等性？
4. 如果订单处理有顺序要求（先下单后支付），分区策略应该怎么设计？

思考这些问题，能帮助你设计出合理的 Kafka 分区方案。
