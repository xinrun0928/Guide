# Kafka 分区策略：轮询、哈希、时间轮

消息该发到哪个分区？

这是 Kafka 里一个看似简单、实则暗藏玄机的问题。

分区策略决定了消息的分布，影响着系统的负载均衡和消息顺序。

选错了分区策略，轻则负载不均，重则消息乱序。

## 为什么分区策略这么重要？

先看一个反面的例子：

```
错误做法：所有消息发到同一个分区

Producer ──[msg1]──→ Partition 0 ──→ Consumer 1（瓶颈！）
     └──[msg2]──→
     └──[msg3]──→
     └──[msg4]──→
     └──[msg5]──→

结果：Consumer 1 忙死，其他分区空闲
```

正确的做法：

```
正确做法：消息分散到多个分区

Producer ──[msg1]──→ Partition 0 ──→ Consumer 1
     └──[msg2]──→ Partition 1 ──→ Consumer 2
     └──[msg3]──→ Partition 2 ──→ Consumer 3
     └──[msg4]──→ Partition 0 ──→ Consumer 1
     └──[msg5]──→ Partition 1 ──→ Consumer 2

结果：负载均衡，充分利用并行能力
```

分区策略的核心目标就两个：**负载均衡** 和 **消息有序**。

## 一、三种核心分区策略

### 1. 轮询策略（RoundRobin）

最简单的策略，消息依次发到各个分区。

```java
// 轮询策略实现
public class RoundRobinPartitioner implements Partitioner {
    
    private int index = 0;
    private int partitionCount;
    
    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                        Object value, byte[] valueBytes, Cluster cluster) {
        List&lt;PartitionInfo&gt; partitions = cluster.partitionsForTopic(topic);
        partitionCount = partitions.size();
        
        // 轮询选择下一个分区
        int partition = index % partitionCount;
        index++;
        
        return partition;
    }
}
```

```
轮询示例（3 个分区）：

消息序列:   msg1  msg2  msg3  msg4  msg5  msg6  msg7  msg8
           ────  ────  ────  ────  ────  ────  ────  ────
           │     │     │     │     │     │     │     │
           ↓     ↓     ↓     ↓     ↓     ↓     ↓     ↓
分区分配:  P0    P1    P2    P0    P1    P2    P0    P1
```

**特点**：

| 优点 | 缺点 |
|------|------|
| 负载均匀 | 无法保证消息顺序 |
| 实现简单 | 同 key 消息可能分散 |
| 适合无状态场景 | 无法保证业务语义 |

### 2. 哈希策略（Key Hash）

根据消息 Key 的哈希值决定分区，同一 Key 的消息一定发到同一分区。

```java
// 哈希分区策略
public class DefaultPartitioner implements Partitioner {
    
    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                        Object value, byte[] valueBytes, Cluster cluster) {
        
        // 如果没有 Key，使用轮询
        if (keyBytes == null) {
            return randomPartition(topic, cluster);
        }
        
        // 有 Key，根据 Key 哈希选择分区
        // 保证了相同 Key 的消息一定发到同一分区
        return Math.abs(Utils.murmur2(keyBytes)) % partitionCount;
    }
}
```

```
哈希分区示例（Key = userId）：

消息:  {userId: 1001, msg: "下单"}
       {userId: 1002, msg: "付款"}
       {userId: 1001, msg: "取消"}
       {userId: 1003, msg: "退款"}

       userId=1001 ──→ P0 ──→ 同一分区，消息有序
       userId=1002 ──→ P1
       userId=1003 ──→ P2
```

**什么时候用哈希策略？**

```java
// 典型场景：保证同一用户的消息有序
public class OrderProducer {
    
    public void sendOrderEvent(String userId, OrderEvent event) {
        // 同一 userId 的订单事件保证有序
        // 下单 → 付款 → 发货 → 确认收货 → 完成
        // 这些事件会按顺序到达 Consumer
        ProducerRecord&lt;String, OrderEvent&gt; record = new ProducerRecord&lt;&gt;(
            "order-events",
            userId,      // Key = userId，保证同一用户消息有序
            event
        );
        producer.send(record);
    }
}
```

**哈希策略的坑：热点 Key**

```java
// 问题：大量消息使用同一个 Key
// 例如：10万条消息，9万条 Key="admin"

// 哈希后
// P0: 9万条消息 ← 热点分区！
// P1: 5000条
// P2: 5000条

// 解决方案：自定义分区器，加盐
public class HotKeyAwarePartitioner implements Partitioner {
    
    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                        Object value, byte[] valueBytes, Cluster cluster) {
        
        int partitionCount = cluster.partitionCountForTopic(topic);
        
        // 检测热点 Key
        if (isHotKey(key)) {
            // 热点 Key：使用时间戳+随机数分散
            long timestamp = System.currentTimeMillis();
            String saltedKey = key + "-" + timestamp + "-" + new Random().nextInt(100);
            return Math.abs(Utils.murmur2(saltedKey.getBytes())) % partitionCount;
        }
        
        // 正常 Key：直接哈希
        return Math.abs(Utils.murmur2(keyBytes)) % partitionCount;
    }
}
```

### 3. 自定义分区策略

根据业务需求实现特定的分区分发逻辑。

```java
// 自定义业务分区器
public class BusinessPartitioner implements Partitioner {
    
    // 分区命名约定：地区_code
    // order-cn-beijing, order-cn-shanghai, order-us-west
    private static final Map&lt;String, Integer&gt; REGION_PARTITION_MAP = new HashMap&lt;&gt;() {{
        put("cn-beijing", 0);
        put("cn-shanghai", 1);
        put("us-west", 2);
        put("eu-central", 3);
    }};
    
    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                        Object value, byte[] valueBytes, Cluster cluster) {
        
        if (value instanceof Order) {
            Order order = (Order) value;
            String region = order.getRegion();
            
            // 1. 优先按地区路由
            if (REGION_PARTITION_MAP.containsKey(region)) {
                return REGION_PARTITION_MAP.get(region);
            }
            
            // 2. 地区未知，按用户哈希（保证同用户有序）
            if (order.getUserId() != null) {
                return Math.abs(order.getUserId().hashCode()) % cluster.partitionCountForTopic(topic);
            }
        }
        
        // 3. 默认轮询
        return new Random().nextInt(cluster.partitionCountForTopic(topic));
    }
}
```

## 二、分区策略对比

| 策略 | 选择依据 | 顺序保证 | 负载均衡 | 适用场景 |
|------|----------|----------|----------|----------|
| 轮询 | 轮转选择 | 无 | 完美 | 无状态消息 |
| 哈希 | Key 哈希值 | 同 Key 有序 | 可能不均 | 有关联的消息 |
| 自定义 | 业务逻辑 | 可控制 | 可控制 | 复杂业务场景 |

## 三、分区数的动态调整

分区数只能增加，不能减少。这是 Kafka 的设计约束。

### 为什么要限制不能减少？

```
原因：减少分区可能导致消息丢失或乱序

假设：分区 0 原有消息 [A, B, C]
      分区 1 原有消息 [D, E, F]

减少到 1 个分区：
新分区 0 = 旧分区 0 + 旧分区 1 合并？
        = 需要重新分配和移动历史消息
        = 代价巨大且复杂
```

### 增加分区的时机

```java
// 分区数规划公式
分区数 = max(
    生产吞吐量 / 单分区生产上限,
    消费吞吐量 / 单分区消费上限,
    期望并发消费者数
)

// 示例：
// 单分区生产上限：10 MB/s
// 期望生产吞吐：100 MB/s
// → 至少需要 10 个分区

// 单分区消费上限：5 MB/s
// 期望消费吞吐：100 MB/s
// → 至少需要 20 个分区

// 期望并发：8 个消费者
// → 至少需要 8 个分区

// 综合：分区数 = max(10, 20, 8) = 20
```

### 分区增加的影响

```
分区增加前（10 分区）：
Consumer Group A: [Consumer1, Consumer2]
分配结果：
- Consumer1: P0, P1, P2, P3, P4
- Consumer2: P5, P6, P7, P8, P9

分区增加后（15 分区）：
触发 Rebalance！
分配结果：
- Consumer1: P0, P1, P2, P3, P4, P10, P11
- Consumer2: P5, P6, P7, P8, P9, P12, P13, P14

⚠️ Rebalance 期间可能重复消费！
```

## 四、分区分配算法详解

### RangeAssignor（默认）

按 Topic 分配，每个 Consumer 分配连续的范围。

```java
// RangeAssignor 分配示例
public class RangeAssignorDemo {
    
    // Topic: order-events
    // Partitions: 7
    // Consumers: 3
    
    // 分配结果：
    // 7 / 3 = 2，余数 1
    // Consumer1: 3 个分区 (0, 1, 2)
    // Consumer2: 2 个分区 (3, 4)
    // Consumer3: 2 个分区 (5, 6)
    
    // 计算公式：
    // n = partitions / consumers
    // m = partitions % consumers
    // 前 m 个 Consumer 各多拿 1 个分区
}
```

```
RangeAssignor 图示：

Topic A (4 分区) + Topic B (4 分区), 3 个 Consumer

分配步骤：
1. 按 Topic 排序：先处理 Topic A，再处理 Topic B

2. Topic A 分配：
   - Consumer1: P0, P1
   - Consumer2: P2, P3
   - Consumer3: 无

3. Topic B 分配：
   - Consumer1: P0, P1  ← 同一 Consumer 连续拿多个 Topic！
   - Consumer2: P2, P3
   - Consumer3: 无

问题：Consumer3 完全空闲！
```

### RoundRobinAssignor

所有 Topic 的分区混合后轮询分配。

```java
// RoundRobinAssignor 分配示例
public class RoundRobinAssignorDemo {
    
    // Topics: [TopicA-P0, TopicA-P1, TopicA-P2, TopicA-P3,
    //          TopicB-P0, TopicB-P1, TopicB-P2, TopicB-P3]
    // Consumers: 3
    
    // 分配步骤：
    // Consumer1: A-P0, A-P3, B-P1, B-P2
    // Consumer2: A-P1, B-P0, B-P3
    // Consumer3: A-P2, B-P1
    
    // 关键：所有分区混合后轮询，分配更均匀
}
```

### StickyAssignor（推荐）

尽量保持原有分配，只在必要时 Rebalance。

```
StickyAssignor 的优势：

场景：Consumer 3 刚加入

使用 RoundRobin：
- Consumer1: P0, P3  ← 原有分配要全部重新分配
- Consumer2: P1, P2
- Consumer3: 无 → 获得 P0, P1, P2, P3（全部移动）

使用 StickyAssignor：
- Consumer1: P0, P3  ← 保持！
- Consumer2: P1, P2  ← 保持！
- Consumer3: 无 → 只获得新增分区 P4, P5（最小移动）
```

## 五、时间轮分区器

在某些场景下，我们希望消息按照**时间顺序**均匀分布。

```java
// 时间轮分区器：按时间片轮询
public class TimeWheelPartitioner implements Partitioner {
    
    private final long wheelSizeMs;  // 每个时间片的大小
    private final long startTimeMs;   // 开始时间
    
    public TimeWheelPartitioner(long wheelSizeMs) {
        this.wheelSizeMs = wheelSizeMs;
        this.startTimeMs = System.currentTimeMillis();
    }
    
    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                        Object value, byte[] valueBytes, Cluster cluster) {
        
        int partitionCount = cluster.partitionCountForTopic(topic);
        long currentTimeMs = System.currentTimeMillis();
        
        // 计算当前时间片
        long timeSlot = (currentTimeMs - startTimeMs) / wheelSizeMs;
        
        // 时间片内轮询
        return (int) (timeSlot % partitionCount);
    }
}

// 使用场景：实时数据，要求消息按时间顺序均匀分布
// 10ms 一个时间片
// 每个时间片的消息发到不同分区
// 保证实时性的同时实现负载均衡
```

## 六、分区策略实战

### 场景一：用户订单消息

```java
// 需求：同一用户的订单消息必须有序
// 策略：按 userId 哈希

public class OrderProducer {
    
    private final KafkaProducer&lt;String, Order&gt; producer;
    
    public void sendOrder(Order order) {
        ProducerRecord&lt;String, Order&gt; record = new ProducerRecord&lt;&gt;(
            "order-topic",
            order.getUserId(),  // Key = userId
            order
        );
        producer.send(record);
    }
}

// 效果：
// userId=1001 的所有订单 → Partition 3
// userId=1002 的所有订单 → Partition 1
// 同一用户的订单按顺序到达，完美
```

### 场景二：日志采集

```java
// 需求：日志需要均匀分布，不要求有序
// 策略：轮询或随机

public class LogProducer {
    
    private final KafkaProducer&lt;String, LogEvent&gt; producer;
    
    public void sendLog(LogEvent log) {
        ProducerRecord&lt;String, LogEvent&gt; record = new ProducerRecord&lt;&gt;(
            "log-topic",
            null,  // Key = null，轮询分配
            log
        );
        producer.send(record);
    }
}
```

### 场景三：多租户系统

```java
// 需求：同一租户的消息必须在同一分区
//      不同租户的消息要负载均衡
// 策略：按租户 ID 哈希 + 热点租户检测

public class MultiTenantPartitioner implements Partitioner {
    
    private ConcurrentHashMap&lt;String, AtomicInteger&gt; tenantCounter = new ConcurrentHashMap&lt;&gt;();
    private int partitionCount;
    
    @Override
    public void configure(Map&lt;String, ?&gt; configs) {
        // 初始化...
    }
    
    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                        Object value, byte[] valueBytes, Cluster cluster) {
        
        if (partitionCount == 0) {
            partitionCount = cluster.partitionCountForTopic(topic);
        }
        
        // key 格式：tenantId:messageType
        String fullKey = new String(keyBytes);
        String tenantId = fullKey.split(":")[0];
        
        // 小租户：直接哈希
        if (!isLargeTenant(tenantId)) {
            return Math.abs(tenantId.hashCode()) % partitionCount;
        }
        
        // 大租户：使用计数器轮询
        // 避免一个大租户占用太多分区
        AtomicInteger counter = tenantCounter.computeIfAbsent(
            tenantId, k -> new AtomicInteger(0));
        return counter.incrementAndGet() % partitionCount;
    }
}
```

## 总结

分区策略选择指南：

| 场景 | 推荐策略 | 原因 |
|------|----------|------|
| 无状态消息 | 轮询 | 负载均衡 |
| 有状态消息（用户/订单） | 哈希 | 保证有序 |
| 多租户系统 | 自定义 | 租户隔离 + 负载均衡 |
| 实时数据流 | 时间轮 | 时间均匀 + 负载均衡 |
| 需要 Rebalance 优化 | StickyAssignor | 减少消息重复 |

**没有最好的策略，只有最适合业务的策略。**

---

## 留给你的问题

1. **热点 Key 困境**：你的系统有 100 个分区，大量消息的 Key 都是 `"vip-user"`，导致 80% 的消息都发到了同一个分区。怎么解决？

2. **分区数与消费者数不匹配**：你创建了 3 个分区的 Topic，但后来发现需要 5 个消费者并发处理。会有什么后果？应该怎么处理？

3. **分区重分配的影响**：运行中的系统需要从 5 分区扩容到 10 分区。分区重分配过程中，消费者会有什么感受？消息会不会乱序或丢失？

4. **Key 为 null 的情况**：如果没有指定消息的 Key，Kafka 会怎么处理？这时候消息有序性有保证吗？

思考这些问题，能帮你设计出更健壮的分区策略。
