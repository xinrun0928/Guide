# Kafka 消费者组（Consumer Group）与 Rebalance

10 个消费者，能不能同时消费 1 个 Topic？

能。但不是 10 个消费者抢消息，而是每个消费者消费一部分分区。

这就是 Consumer Group 的核心思想。

## 一、Consumer Group 的本质

Consumer Group 是 Kafka 实现**消息并行消费**和**负载均衡**的机制。

### 1.1 为什么需要 Consumer Group？

```
没有 Consumer Group：
Producer ──→ Topic ──→ Consumer（所有消息都给我）

问题：
1. 单个 Consumer 能力有限
2. 消费不过来了
3. 想要多消费者并行处理
```

```
有 Consumer Group：
Producer ──→ Topic ──→ Consumer Group
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
    Consumer A             Consumer B           Consumer C
     (Partition 0)         (Partition 1)       (Partition 2)
        │                     │                     │
        └── 每个 Consumer 独立消费不同分区 ─────────┘

效果：
1. 10 个消费者可以并行消费
2. 吞吐量线性提升
3. 一个挂了，其他不受影响
```

### 1.2 Group 的概念

```
┌─────────────────────────────────────────────────────────────────┐
│                        Consumer Group 概念                       │
│                                                                  │
│  Consumer Group A (Group ID: "group-A")                         │
│  ├── Consumer 1 ──→ P0, P1                                     │
│  ├── Consumer 2 ──→ P2, P3                                     │
│  └── Consumer 3 ──→ P4, P5                                     │
│                                                                  │
│  Consumer Group B (Group ID: "group-B")                         │
│  ├── Consumer 4 ──→ P0, P1, P2, P3, P4, P5（独立消费所有分区）   │
│  └── Consumer 5 ──→ 无分区可分（消费不了）                        │
│                                                                  │
│  重要规则：                                                      │
│  ├── 一个分区只能被同一 Group 的一个 Consumer 消费                │
│  ├── 不同 Group 可以消费同一个分区（广播）                        │
│  └── Group 内竞争，Group 间独立                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 Consumer Group 的特点

```java
// Consumer Group 核心特性
public class ConsumerGroupProperties {
    
    // 1. 消息顺序
    //    同一分区内消息有序
    //    同一 Group 内不同 Consumer 消费不同分区，无顺序保证
    
    // 2. 消费位置
    //    每个 Group 独立维护自己的消费 offset
    //    不同 Group 互不影响
    
    // 3. 负载均衡
    //    分区数决定最大并行度
    //    Consumer 数 <= 分区数（或整数倍）
    
    // 4. 容错性
    //    Consumer 挂了，它的分区会重新分配给其他 Consumer
    //    不会丢失消息
}
```

## 二、订阅与分区分配

### 2.1 订阅 Topic

```java
// Consumer 订阅 Topic
public class KafkaConsumerDemo {
    
    public void subscribe() {
        KafkaConsumer&lt;String, String&gt; consumer = new KafkaConsumer&lt;&gt;(props);
        
        // 方式 1：订阅多个 Topic（支持正则）
        consumer.subscribe(Pattern.compile("order-.*"));
        
        // 方式 2：订阅指定 Topic 列表
        consumer.subscribe(Arrays.asList("order-topic", "payment-topic"));
        
        // 方式 3：手动分配分区（不使用 Group）
        consumer.assign(Arrays.asList(
            new TopicPartition("order-topic", 0)
        ));
    }
}
```

### 2.2 分区分配策略

```java
// Kafka 提供的分区分配策略
public class PartitionAssignmentStrategies {
    
    // 1. RangeAssignor（默认）
    //    按 Topic 分配，每个 Consumer 拿连续的分区
    //    问题：可能导致负载不均
    
    // 2. RoundRobinAssignor
    //    所有 Topic 分区混合后轮询分配
    //    问题：可能打乱同 Topic 的关联
    
    // 3. StickyAssignor（推荐）
    //    尽量保持原有分配，减少 Rebalance 影响
    //    优点：减少重复消费
    
    // 4. CooperativeStickyAssignor（Kafka 2.4+）
    //    协作式 Sticky，减少 Rebalance 停顿
    
    // 配置方式
    properties.put("partition.assignment.strategy", 
        "org.apache.kafka.clients.consumer.StickyAssignor");
}
```

### 2.3 分区分配示例

```java
// 分配策略对比示例
public class AssignmentComparison {
    
    // 场景：
    // Topic A: P0, P1, P2, P3
    // Topic B: P0, P1, P2
    // Consumer: C1, C2, C3
    
    // RangeAssignor 分配：
    // C1: A-P0, A-P1, B-P0, B-P1
    // C2: A-P2, A-P3, B-P2
    // C3: 无
    
    // RoundRobinAssignor 分配：
    // C1: A-P0, A-P3, B-P0
    // C2: A-P1, B-P1, B-P2
    // C3: A-P2
    
    // StickyAssignor 分配：
    // 尽量保持原有分配，最小化移动
}
```

## 三、消费者启动流程

### 3.1 加入 Group 的完整流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    Consumer 加入 Group 流程                       │
│                                                                  │
│  Consumer                                           Coordinator │
│     │                                                   │       │
│     │  1. 发送 JoinGroup Request                        │       │
│     │ ─────────────────────────────────────────────────→ │       │
│     │                                                   │       │
│     │                        2. 等待所有 Consumer 加入   │       │
│     │                              （等待时间：max.poll.interval.ms）│
│     │                                                   │       │
│     │  3. 接收 JoinGroup Response                        │       │
│     │ ←───────────────────────────────────────────────── │       │
│     │     (包含 memberId 和 partition assignment)        │       │
│     │                                                   │       │
│     │  4. 发送 SyncGroup Request                        │       │
│     │ ─────────────────────────────────────────────────→ │       │
│     │                                                   │       │
│     │  5. 接收 SyncGroup Response                        │       │
│     │ ←───────────────────────────────────────────────── │       │
│     │     (包含分配给自己的分区)                          │       │
│     │                                                   │       │
│     │  6. 开始消费分配的分区                              │       │
│     │                                                   │       │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Coordinator 选举

```java
// Coordinator 选举算法
public class CoordinatorSelection {
    
    // Coordinator 所在 Broker = hash(groupId) % offsets.topic.num.partitions
    
    // 例如：
    // groupId = "order-consumer-group"
    // hash("order-consumer-group") % 50 = 23
    // offsets topic 有 50 个分区
    // Broker 管理 Partition 23 的是 Coordinator
    
    // offsets topic 默认 50 个分区
    // 每个分区可能有不同的 Coordinator
}
```

### 3.3 心跳与保活

```java
// Consumer 心跳配置
public class HeartbeatConfig {
    
    // 心跳间隔（默认 3 秒）
    // Consumer 每隔这么久发送一次心跳
    heartbeat.interval.ms = 3000
    
    // 最大心跳间隔（默认 45 秒）
    // 超过这个时间没心跳，Coordinator 认为 Consumer 挂了
    session.timeout.ms = 45000
    
    // 两次 poll 之间的最大间隔
    // 超过这个时间没 poll，Coordinator 认为 Consumer 挂了
    // 也用于 Rebalance 触发
    max.poll.interval.ms = 300000  // 5 分钟
    
    // 建议值：
    // session.timeout.ms = 45 秒
    // heartbeat.interval.ms = 15 秒
    // max.poll.interval.ms = 5 分钟
}
```

## 四、消费 offset 管理

### 4.1 offset 的存储

```
┌─────────────────────────────────────────────────────────────────┐
│                    offset 存储位置                               │
│                                                                  │
│  __consumer_offsets Topic                                       │
│  ├── Partition 0                                                │
│  ├── Partition 1                                                │
│  ├── Partition 2                                                │
│  └── ...                                                        │
│                                                                  │
│  消息格式：                                                      │
│  Key: groupId + topic + partition                               │
│  Value: offset + metadata + timestamp                           │
│                                                                  │
│  Consumer 提交 offset 后，保存在这里                              │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 offset 提交策略

```java
// 1. 自动提交（默认）
properties.put("enable.auto.commit", true);
properties.put("auto.commit.interval.ms", 5000);

// 特点：
// - 每隔 5 秒自动提交 offset
// - 可能重复消费（提交发生在 poll 之后）
// - 简单但不可控

// 2. 手动同步提交
properties.put("enable.auto.commit", false);

// 消费后手动提交
while (true) {
    ConsumerRecords&lt;String, String&gt; records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord&lt;String, String&gt; record : records) {
        process(record);
    }
    // 业务处理完成后提交
    consumer.commitSync();  // 阻塞
}

// 3. 手动异步提交
consumer.commitAsync();  // 不阻塞
```

### 4.3 精确一次消费

```java
// 手动提交 + 业务处理 = 至少一次
// 配合幂等性处理 = 精确一次

public void consumeWithManualCommit() {
    while (true) {
        ConsumerRecords&lt;String, String&gt; records = consumer.poll(Duration.ofMillis(100));
        
        for (ConsumerRecord&lt;String, String&gt; record : records) {
            try {
                // 业务处理
                processRecord(record);
                
                // 手动提交 offset（在业务成功后）
                Map&lt;TopicPartition, OffsetAndMetadata&gt; offsets = new HashMap&lt;&gt;();
                offsets.put(
                    new TopicPartition(record.topic(), record.partition()),
                    new OffsetAndMetadata(record.offset() + 1)
                );
                consumer.commitAsync(offsets, null);
                
            } catch (Exception e) {
                // 失败时不提交 offset
                // 下次 poll 会重新拿到这条消息
                log.error("处理失败", e);
            }
        }
    }
}
```

## 五、Rebalance 机制

### 5.1 什么是 Rebalance？

Rebalance 是 Consumer Group 内部分区重新分配的过程。

```
Rebalance 前：
Consumer A ──→ P0, P1
Consumer B ──→ P2, P3

Consumer B 挂了！

Rebalance 后：
Consumer A ──→ P0, P1, P2, P3
Consumer B ──→ 无（已被移除）

这就是 Rebalance
```

### 5.2 Rebalance 触发条件

| 触发条件 | 说明 |
|----------|------|
| Consumer 加入 | 新 Consumer 加入，触发 Rebalance 重新分配 |
| Consumer 离开 | Consumer 主动离开或超时离开 |
| 分区增加 | Topic 分区数增加 |
| Broker 上线 | 新 Broker 加入集群 |

### 5.3 Rebalance 的代价

```
Rebalance 期间：
├── Consumer 停止消费
├── 所有 Consumer 重新加入 Group
├── 等待分区分配完成
└── 恢复消费

影响：
├── 消费停顿（可能 10-30 秒）
├── 消息重复消费（offset 未提交）
└── 系统抖动
```

## 六、多 Consumer 实例

### 6.1 同一 Group 多实例

```java
// 部署多个 Consumer 实例（同一 Group）
// 例如：启动 3 个进程，各运行 1 个 Consumer

public class ConsumerInstance {
    
    // 进程 1
    // Consumer ID: consumer-1
    // 分配分区: P0, P1
    
    // 进程 2
    // Consumer ID: consumer-2
    // 分配分区: P2, P3
    
    // 进程 3
    // Consumer ID: consumer-3
    // 分配分区: P4, P5
}

// 配置 Group ID 相同
properties.put("group.id", "order-consumer-group");

// Kafka 自动管理分区分配
// 某个实例挂了，它的分区会自动分配给其他实例
```

### 6.2 消费者线程模型

```java
// Kafka Consumer 是单线程的
// 多线程消费需要自行实现

public class MultiThreadConsumer {
    
    private final KafkaConsumer&lt;String, String&gt; consumer;
    private final ExecutorService executor;
    
    public void consume() {
        // 单线程拉取
        while (true) {
            ConsumerRecords&lt;String, String&gt; records = consumer.poll(Duration.ofMillis(100));
            
            // 分发到线程池处理
            for (ConsumerRecord&lt;String, String&gt; record : records) {
                executor.submit(() -> process(record));
            }
            
            // 异步提交 offset
            consumer.commitAsync();
        }
    }
}

// 注意：这是「单 Consumer 多线程」模式
// 与「多 Consumer 单线程」模式有区别
```

### 6.3 消费者数量与分区数的关系

```
黄金法则：Consumer 数量 ≤ Partition 数量

情况分析：

1. Consumer = Partition
   ├── 完美匹配，每个 Consumer 一个分区
   └── 最佳情况

2. Consumer < Partition
   ├── 某些 Consumer 消费多个分区
   └── 常见情况，可以接受

3. Consumer > Partition
   ├── 多余的 Consumer 空闲
   └── 浪费资源

4. Consumer 动态变化
   ├── 触发 Rebalance
   └── 需要考虑消费位点处理
```

## 七、消费者监控

### 7.1 查看消费状态

```bash
# 查看 Consumer Group 状态
kafka-consumer-groups.sh \
    --bootstrap-server localhost:9092 \
    --group order-consumer-group \
    --describe

# 输出：
# GROUP                    TOPIC           PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG     CONSUMER            HOST            CLIENT-ID
# order-consumer-group     order-topic     0          5000             6000             1000    consumer-1-a...    /192.168.1.1    consumer-1
# order-consumer-group     order-topic     1          4000             4000             0       consumer-2-a...    /192.168.1.2    consumer-2
# order-consumer-group     order-topic     2          3500             3500             0       consumer-3-a...    /192.168.1.3    consumer-3
```

### 7.2 关键指标

```java
// 关键监控指标
public class ConsumerMetrics {
    
    // lag：积压消息数
    // lag = LOG-END-OFFSET - CURRENT-OFFSET
    // lag 越大，积压越严重
    // 告警阈值：lag > 10000
    
    // consumer_lag：消费延迟
    // 关注：lag 是否持续增长
    
    // fetch-rate：拉取频率
    // 关注：是否正常拉取
    
    // commit-latency：提交延迟
    // 关注：offset 提交是否正常
}
```

## 总结

Consumer Group 核心要点：

| 概念 | 说明 |
|------|------|
| Group ID | 区分不同 Consumer Group |
| Coordinator | 管理 Group 成员和分区分配 |
| 分区分配 | Group 内分区均分 |
| Rebalance | 分区重新分配 |
| offset | Group 独立的消费位置 |

**理解 Consumer Group，是理解 Kafka 消费模型的关键。**

---

## 留给你的问题

1. **Consumer 数量超过分区数**：你创建了 3 个分区的 Topic，但运行了 5 个 Consumer 实例。会发生什么？多余的 Consumer 在做什么？

2. **Rebalance 期间的重复消费**：Consumer A 正在处理 offset=1000 的消息，还没提交 offset 就挂了。Rebalance 后，offset=1000 的消息会被重复消费吗？

3. **Session Timeout 与 Rebalance**：如果业务处理耗时很长（10 分钟），超过了 `max.poll.interval.ms`，会发生什么？

4. **不同 Group 消费同一 Topic**：两个不同的 Consumer Group 消费同一个 Topic，它们会抢消息吗？offset 是独立的吗？

思考这些问题，能帮你更好地设计消费者架构。
