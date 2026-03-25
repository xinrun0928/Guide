# Kafka Rebalance 触发条件与分区分配策略

Consumer Group 好好的，为什么突然开始 Rebalance？

系统抖动、消费停顿、消息重复——Rebalance 是个让人又爱又恨的机制。

理解它，才能驾驭它。

## 一、Rebalance 本质

Rebalance 是 Consumer Group 的自我修复机制。

当 Group 成员或分区发生变化时，通过 Rebalance 重新分配分区，让系统恢复平衡。

```
┌─────────────────────────────────────────────────────────────────┐
│                        Rebalance 本质                           │
│                                                                  │
│  触发前                    Rebalance                    触发后   │
│  ─────                    ─────────                    ──────   │
│  C1 ──→ P0                重新分配                    C1 ──→ P0
│  C2 ──→ P1     ───────→   分区              ───────→   C2 ──→ P1
│  C3 ──→ P2                & 更新元数据                   C3 ──→ P2
│                                                                  │
│  系统不平衡？                    分配给每个 Consumer           系统平衡了
│  某个 Consumer 挂了             合理的分区数
└─────────────────────────────────────────────────────────────────┘
```

**Rebalance 的价值**：系统故障时自动恢复。

**Rebalance 的代价**：消费停顿、可能重复消费。

## 二、Rebalance 触发条件

### 2.1 五大触发条件

| 触发条件 | 说明 | 常见场景 |
|----------|------|----------|
| Consumer 加入 | 新 Consumer 加入 Group | 弹性扩缩容 |
| Consumer 离开 | 主动离开或心跳超时 | 实例重启、网络抖动 |
| 分区增加 | Topic 分区数增加 | 扩容 |
| Broker 上线 | Broker 恢复或新加入 | 故障恢复 |
| 分区重新分配 | 管理员手动触发 | 运维操作 |

### 2.2 详细触发场景

```java
// 场景 1：Consumer 正常加入
public class ConsumerJoin {
    
    // Consumer 启动
    // 发送 JoinGroup 请求
    // Coordinator 触发 Rebalance
    // 新 Consumer 加入后，重新分配分区
}

// 场景 2：Consumer 心跳超时
public class HeartbeatTimeout {
    
    // Consumer 长时间没发心跳
    // Coordinator 认为 Consumer 挂了
    // 触发 Rebalance
    // 分配给它的分区被其他 Consumer 接管
}

// 场景 3：分区数增加
public class PartitionExpansion {
    
    // 运维增加 Topic 分区数
    // kafka-topics.sh --alter --topic my-topic --partitions 10
    // 自动触发 Rebalance
    // 分区重新分配
}

// 场景 4：Consumer 处理时间过长
public class LongProcessing {
    
    // max.poll.interval.ms = 5分钟
    // 但业务处理耗时 10 分钟
    // 下次 poll 之前，Coordinator 已经认为 Consumer 挂了
    // 触发 Rebalance
}
```

### 2.3 常见 Rebalance 场景详解

```
场景一：Consumer 重启

时刻 T0：
├── C1 ──→ P0, P1
├── C2 ──→ P2, P3
└── Group 正常

时刻 T1：
└── C1 重启（先 leave，再 join）

时刻 T2：
├── C1 发送 LeaveGroup 请求
├── Coordinator 触发 Rebalance
├── C2 临时接管 P0, P1
└── C2 ──→ P0, P1, P2, P3

时刻 T3：
└── C1 重启完成，发送 JoinGroup

时刻 T4：
└── 再次 Rebalance
    ├── C1 ──→ P0, P1（恢复）
    └── C2 ──→ P2, P3（恢复）
```

```
场景二：网络抖动

时刻 T0：
└── C1 网络抖动，短暂断开

时刻 T1（45 秒后）：
└── session.timeout.ms 触发
    └── Coordinator 认为 C1 挂了
    └── Rebalance 开始
    └── C2 接管 C1 的分区

时刻 T2（网络恢复）：
└── C1 重连
    └── 发送 JoinGroup
    └── 再次 Rebalance
    └── 恢复原始分配
```

## 三、分区分配策略

### 3.1 四种分配策略

```java
// Kafka 提供的四种分配策略
public class PartitionAssignmentStrategies {
    
    // 1. RangeAssignor（默认）
    //    按 Topic 分配，Consumer 获取连续的分区
    
    // 2. RoundRobinAssignor
    //    所有 Topic 分区混合后轮询分配
    
    // 3. StickyAssignor
    //    尽量保持原有分配，最小化分区移动
    
    // 4. CooperativeStickyAssignor
    //    协作式 Sticky，支持增量分配
}
```

### 3.2 RangeAssignor

```java
// RangeAssignor 分配算法
public class RangeAssignor implements ConsumerPartitionAssignor {
    
    @Override
    public Map&lt;String, List&lt;TopicPartition&gt;&gt; assign(
            Map&lt;String, Integer&gt; partitionsPerTopic,
            Map&lt;String, List&lt;String&gt;&gt; subscriptions) {
        
        Map&lt;String, List&lt;TopicPartition&gt;&gt; assignment = new HashMap&lt;&gt;();
        
        for (String memberId : subscriptions.keySet()) {
            assignment.put(memberId, new ArrayList&lt;&gt;());
        }
        
        // 按 Topic 逐个分配
        for (Map.Entry&lt;String, Integer&gt; topicEntry : partitionsPerTopic.entrySet()) {
            String topic = topicEntry.getKey();
            int partitions = topicEntry.getValue();
            List&lt;String&gt; members = subscriptions.get(topic);
            
            // 按消费者数切分
            int numMembers = members.size();
            int[] partsPerMember = assignPartitionsToMembers(
                partitions, numMembers);
            
            // 分配
            for (int i = 0; i < numMembers; i++) {
                int start = computeStart(partitions, numMembers, i);
                assignment.get(members.get(i))
                    .addAll(createTopicPartitions(topic, start, partsPerMember[i]));
            }
        }
        
        return assignment;
    }
}
```

```
RangeAssignor 示例：

Topic A (4 分区)，Topic B (4 分区)，3 个 Consumer

分配步骤：

1. Topic A 分配：
   - 4 / 3 = 1，余 1
   - C1: P0, P1（多拿 1 个）
   - C2: P2
   - C3: P3

2. Topic B 分配：
   - 4 / 3 = 1，余 1
   - C1: P0, P1
   - C2: P2
   - C3: P3

最终：
C1: A-P0, A-P1, B-P0, B-P1
C2: A-P2, B-P2
C3: A-P3, B-P3

⚠️ 问题：Consumer 3 只拿到 2 个分区，负载不均
```

### 3.3 RoundRobinAssignor

```java
// RoundRobinAssignor 分配算法
public class RoundRobinAssignor implements ConsumerPartitionAssignor {
    
    @Override
    public Map&lt;String, List&lt;TopicPartition&gt;&gt; assign(
            Map&lt;String, Integer&gt; partitionsPerTopic,
            Map&lt;String, List&lt;String&gt;&gt; subscriptions) {
        
        // 将所有 Topic 的分区混合
        List&lt;TopicPartition&gt; allPartitions = new ArrayList&lt;&gt;();
        for (Map.Entry&lt;String, Integer&gt; entry : partitionsPerTopic.entrySet()) {
            String topic = entry.getKey();
            for (int i = 0; i < entry.getValue(); i++) {
                allPartitions.add(new TopicPartition(topic, i));
            }
        }
        
        // 对 Consumer 排序（保证分配确定性）
        List&lt;String&gt; members = new ArrayList&lt;&gt;(subscriptions.keySet());
        Collections.sort(members);
        
        // 轮询分配
        Map&lt;String, List&lt;TopicPartition&gt;&gt; assignment = new HashMap&lt;&gt;();
        for (String member : members) {
            assignment.put(member, new ArrayList&lt;&gt;());
        }
        
        int i = 0;
        for (TopicPartition tp : allPartitions) {
            assignment.get(members.get(i % members.size())).add(tp);
            i++;
        }
        
        return assignment;
    }
}
```

```
RoundRobinAssignor 示例：

Topic A (4 分区)，Topic B (4 分区)，3 个 Consumer

混合所有分区：
A-P0, A-P1, A-P2, A-P3, B-P0, B-P1, B-P2, B-P3

轮询分配：
C1: A-P0, A-P3, B-P1, B-P2
C2: A-P1, B-P0, B-P3
C3: A-P2, B-P1, B-P2 ← 不同 Topic 的分区可能不连续

效果：分配更均匀
```

### 3.4 StickyAssignor

```java
// StickyAssignor 核心思想
public class StickyAssignor implements ConsumerPartitionAssignor {
    
    // 核心目标：最小化分区移动
    
    // 1. 尽量保持原有分配
    // 2. 在必须移动时，移动尽可能少的分区
    // 3. Rebalance 后，所有 Consumer 的分区数差值 ≤ 1
    
    @Override
    public Map&lt;String, List&lt;TopicPartition&gt;&gt; assign(...) {
        
        // 1. 尝试复用原有分配
        // 2. 如果无法复用，使用贪心算法分配
        // 3. 保证分配均匀
        
        return assignment;
    }
}
```

```
StickyAssignor 示例：

Rebalance 前：
C1: P0, P1, P2
C2: P3, P4
C3: 无

Consumer 3 加入：

使用 RoundRobin：
C1: P0, P2, P4  ← 大量移动！
C2: P1, P3
C3: P5

使用 StickyAssignor：
C1: P0, P1      ← 保持 P0, P1
C2: P2, P3, P4  ← 保持 P2, P3, P4
C3: P5         ← 只分配新增的 P5

效果：最小化移动，减少重复消费
```

### 3.5 分配策略对比

| 策略 | 分配均匀度 | 分区移动 | 适用场景 |
|------|------------|----------|----------|
| Range | 不均匀 | 中 | 单 Topic 场景 |
| RoundRobin | 均匀 | 中 | 多 Topic 场景 |
| Sticky | 均匀 | 少 | 生产环境（推荐） |
| CooperativeSticky | 均匀 | 最少 | 大型集群 |

## 四、Rebalance 流程

### 4.1 完整流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    Rebalance 完整流程                             │
│                                                                  │
│  Coordinator                                    Consumer        │
│     │                                                 │         │
│     │  1. 检测到成员变化                               │         │
│     │     (Join/Leave/Timeout)                        │         │
│     │                                                 │         │
│     │  2. 等待 Join 阶段                              │         │
│     │     (等待所有 Consumer 加入)                      │         │
│     │ ←─────────────────────────────────────────────── │         │
│     │         JoinGroup Request                       │         │
│     │                                                 │         │
│     │  3. 收集所有订阅信息                              │         │
│     │                                                 │         │
│     │  4. 执行分区分配策略                              │         │
│     │     (根据配置选择分配算法)                        │         │
│     │                                                 │         │
│     │  5. 发送 JoinGroup Response                      │         │
│     │     (包含分区分配结果)                           │         │
│     │ ───────────────────────────────────────────────→ │         │
│     │                                                 │         │
│     │  6. Consumer 发送 SyncGroup                      │         │
│     │     (确认分配结果)                               │         │
│     │ ←─────────────────────────────────────────────── │         │
│     │                                                 │         │
│     │  7. 分发分区分配                                 │         │
│     │ ───────────────────────────────────────────────→ │         │
│     │                                                 │         │
│     │  8. 开始消费                                     │         │
│     │                                                 │         │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 JoinGroup 阶段

```java
// JoinGroup 详细过程
public class JoinGroupHandler {
    
    // Coordinator 等待所有 Consumer 加入
    // 等待时间由 session.timeout.ms 控制
    
    // JoinGroup 请求包含：
    // - memberId
    // - subscribedTopics
    // - partitionAssignmentStrategy
    
    // 所有 Consumer 都 Join 后：
    // - Coordinator 执行分区分配
    // - 生成 memberId -> partitions 映射
}
```

### 4.3 SyncGroup 阶段

```java
// SyncGroup 详细过程
public class SyncGroupHandler {
    
    // 分配结果只发给各 Consumer 的 Coordinator
    // Consumer 从 Coordinator 获取自己的分配
    
    // SyncGroup 请求包含：
    // - memberId
    // - partitionAssignment（Consumer 侧可以为空，由 Coordinator 填充）
    
    // SyncGroup 响应包含：
    // - 分配给该 Consumer 的分区列表
}
```

## 五、Rebalance 优化

### 5.1 减少 Rebalance 触发

```java
// 优化配置
public class RebalanceOptimization {
    
    // 1. 合理设置心跳间隔
    //    不要太短（增加网络开销）
    //    不要太长（延迟检测故障）
    //    推荐：session.timeout.ms / 3
    props.put("session.timeout.ms", "45000");
    props.put("heartbeat.interval.ms", "15000");
    
    // 2. 合理设置 poll 间隔
    //    要大于最大处理时间
    props.put("max.poll.interval.ms", "300000");  // 5 分钟
    
    // 3. 控制每次 poll 的消息数
    //    不要一次拉太多，处理不过来
    props.put("max.poll.records", "500");
    
    // 4. 使用 StickyAssignor
    props.put("partition.assignment.strategy", 
        "org.apache.kafka.clients.consumer.StickyAssignor");
    
    // 5. 升级到 CooperativeStickyAssignor（Kafka 2.4+）
    props.put("partition.assignment.strategy", 
        "org.apache.kafka.clients.consumer.CooperativeStickyAssignor");
}
```

### 5.2 监控 Rebalance

```bash
# 查看 Rebalance 次数
kafka-consumer-groups.sh \
    --bootstrap-server localhost:9092 \
    --describe \
    --group my-group | grep CONSUMER

# 监控 lag
# lag 持续增长可能是 Rebalance 导致的
```

```java
// Rebalance 监听器
public class RebalanceListener implements ConsumerRebalanceListener {
    
    @Override
    public void onPartitionsRevoked(Collection&lt;TopicPartition&gt; partitions) {
        // Rebalance 前调用
        // 适合在这里提交 offset
        
        Map&lt;TopicPartition, OffsetAndMetadata&gt; offsets = new HashMap&lt;&gt;();
        for (TopicPartition tp : partitions) {
            long offset = consumer.position(tp);
            offsets.put(tp, new OffsetAndMetadata(offset));
        }
        consumer.commitSync(offsets);
    }
    
    @Override
    public void onPartitionsAssigned(Collection&lt;TopicPartition&gt; partitions) {
        // Rebalance 后调用
        // 分区分配给你了，可以开始消费
    }
}

// 使用
consumer.subscribe(Arrays.asList("my-topic"), new RebalanceListener());
```

### 5.3 静默 Rebalance

```java
// 某些情况下需要静默 Rebalance
public class GracefulRebalance {
    
    // 场景：迁移 Consumer Group 到新集群
    
    // 步骤：
    // 1. 停止旧 Consumer（不要立刻停止，先停止消费）
    
    // 2. 等待 offset 消费完成
    //    确保 offset 提交到最新
    
    // 3. 导出 offset 信息
    //    kafka-consumer-groups.sh --export
    
    // 4. 启动新 Consumer
    //    从导出的 offset 开始消费
}
```

## 六、协作式 Rebalance（Kafka 2.4+）

### 6.1 传统 Rebalance 的问题

```
传统 Rebalance（停止世界）：

T0：开始 Rebalance
T1：Consumer 停止消费
T2：等待所有 Consumer 加入
T3：重新分配分区
T4：Consumer 开始消费

停顿时间：T0 ~ T4
可能长达 10-30 秒
```

### 6.2 协作式 Rebalance

```
协作式 Rebalance（增量迁移）：

T0：开始 Rebalance
T1：Consumer 1 交出部分分区，继续消费其他分区
T2：Consumer 2 接管这些分区
T3：Consumer 1 继续消费，不中断

停顿时间：很短
支持增量分配
```

### 6.3 使用协作式 Rebalance

```java
// 启用协作式 Rebalance
props.put("partition.assignment.strategy", 
    "org.apache.kafka.clients.consumer.CooperativeStickyAssignor");

// 监听器需要适配
public class CooperativeRebalanceListener implements ConsumerRebalanceListener {
    
    @Override
    public void onPartitionsRevoked(Collection&lt;TopicPartition&gt; partitions) {
        // 分区被回收，同步提交 offset
        commitOffsets(partitions);
    }
    
    @Override
    public void onPartitionsLost(Collection&lt;TopicPartition&gt; partitions) {
        // 分区丢失（不是主动交出的）
        // 不要在这里处理，可能已经在其他地方处理
    }
    
    @Override
    public void onPartitionsAssigned(Collection&lt;TopicPartition&gt; partitions) {
        // 分区分配给你，开始消费
    }
}
```

## 七、实战问题

### 7.1 分区数小于 Consumer 数

```
问题：
6 个 Consumer，3 个分区

分配结果：
C1: P0
C2: P1
C3: P2
C4: 无
C5: 无
C6: 无

多余 Consumer 空闲！

解决：
1. 减少 Consumer 数量
2. 增加分区数量
3. 改为多 Group 模式
```

### 7.2 Consumer 处理时间过长

```java
// 问题：处理一条消息需要 10 分钟
// 但 max.poll.interval.ms = 5 分钟

public class LongProcessingFix {
    
    // 方案 1：增加 poll 间隔
    props.put("max.poll.interval.ms", "600000");  // 10 分钟
    
    // 方案 2：减少每次 poll 的消息数
    props.put("max.poll.records", "10");
    
    // 方案 3：异步处理，不阻塞 poll
    public void consume() {
        while (true) {
            ConsumerRecords&lt;String, String&gt; records = consumer.poll(100);
            
            // 异步提交到线程池处理
            for (ConsumerRecord&lt;String, String&gt; record : records) {
                executor.submit(() -> process(record));
            }
            
            // 继续 poll，不等待处理完成
        }
    }
}
```

### 7.3 频繁 Rebalance

```
问题：Consumer 频繁 Rebalance

原因：
1. 心跳间隔太短
2. GC 暂停导致心跳超时
3. 网络抖动
4. 处理时间过长

排查：
1. 检查 GC 日志
2. 检查网络延迟
3. 检查处理逻辑

解决：
1. 增加 session.timeout.ms
2. 减少 max.poll.records
3. 优化处理逻辑
4. 使用 StickyAssignor
```

## 总结

Rebalance 核心要点：

| 要点 | 说明 |
|------|------|
| 触发条件 | Join/Leave/Timeout/分区变更 |
| 分配策略 | Range/RoundRobin/Sticky/Cooperative |
| 优化方向 | 合理配置 + StickyAssignor |
| Kafka 2.4+ | 协作式 Rebalance，几乎零停顿 |

**理解 Rebalance，才能避免踩坑。**

---

## 留给你的问题

1. **StickyAssignor 的代价**：StickyAssignor 能减少分区移动，但第一次 Rebalance 时分配可能不均匀。这能接受吗？

2. **协作式 Rebalance 的边界**：协作式 Rebalance 能增量迁移分区，但如果 Consumer 在迁移过程中挂了，会发生什么？

3. **Rebalance 期间的消费位置**：Rebalance 发生时，正在处理的消息会被重复消费吗？怎么避免？

4. **多 Consumer 实例的 Rebalance**：同一个进程里运行多个 Consumer 线程，和启动多个 Consumer 进程，在 Rebalance 时行为有什么不同？

思考这些问题，能帮你设计更健壮的消费者架构。
