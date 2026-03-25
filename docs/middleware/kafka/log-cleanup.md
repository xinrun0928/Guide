# Kafka 日志清理策略：delete vs compact

Kafka 的磁盘会无限增长吗？

当然不会。Kafka 会定期清理旧数据，释放磁盘空间。

但怎么清理？清理哪些数据？什么时候清理？

这就是日志清理策略要回答的问题。

## 一、为什么要清理日志？

```
问题：Kafka 消息无限堆积

假设：
- 每天产生 100GB 消息
- 保留 7 天
- 需要 700GB 磁盘空间

如果不清理：
- 第 8 天：800GB
- 第 30 天：3TB
- 第 365 天：36.5TB

磁盘会爆！

解决方案：日志清理
```

## 二、两种清理策略

Kafka 有两种日志清理策略：

| 策略 | 适用场景 | 清理方式 |
|------|----------|----------|
| Delete | 大多数场景 | 按时间或大小删除旧消息 |
| Compact | 需要保留最新状态 | 按 Key 合并，只保留最新值 |

### 2.1 Delete 策略

Delete 是默认策略，适用于大多数场景。

```
Delete 策略原理：

┌─────────────────────────────────────────────────────────────────┐
│                    Delete 策略示意                                  │
│                                                                  │
│  保留 7 天                                                       │
│                                                                  │
│  Day 1 ──────────────────────────────────────────────────────→│
│  │                                                              │
│  │  [msg1][msg2][msg3][msg4][msg5]...                        │
│  │                                                              │
│  └──────────────────────────────────────────────────────────    │
│  Day 8  之前的消息被删除                                          │
│                                                                  │
│  [msg8][msg9][msg10][msg11][msg12]...                        │
│  ↑                                                              │
│  消息 1~7 被删除                                                │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Compact 策略

Compact 策略适用于需要保留最新状态的消息。

```
Compact 策略原理：

┌─────────────────────────────────────────────────────────────────┐
│                    Compact 策略示意                                  │
│                                                                  │
│  每个 Key 只保留最新值                                             │
│                                                                  │
│  原始消息：                                                      │
│  [key=user1, value=profile_v1]  ← 旧版本                       │
│  [key=user2, value=profile_a]                                  │
│  [key=user1, value=profile_v2]  ← 新版本                       │
│  [key=user3, value=profile_x]                                  │
│  [key=user1, value=profile_v3]  ← 最新版本                     │
│                                                                  │
│  Compact 后：                                                    │
│  [key=user1, value=profile_v3]  ← 只保留最新                    │
│  [key=user2, value=profile_a]                                  │
│  [key=user3, value=profile_x]                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 三、Delete 策略详解

### 3.1 配置参数

```java
// Delete 策略配置
public class DeleteConfig {
    
    // 1. 按时间保留
    // 消息超过这个时间被删除
    // 默认：7 天
    log.retention.ms = 604800000  // 7 天
    log.retention.hours = 168    // 7 天（小时）
    log.retention.minutes =      // 很少用
    
    // 2. 按大小保留
    // 日志文件超过这个大小开始删除旧段
    // 默认：-1（不限制）
    log.retention.bytes = -1     // -1 表示不按大小删除
    
    // 3. 保留检查间隔
    // 多久检查一次是否需要删除
    // 默认：5 分钟
    log.retention.check.interval.ms = 300000  // 5 分钟
    
    // 4. 段文件保留时间
    // 段文件超过这个时间，如果已写满，可被删除
    // 默认：7 天
    log.segment.ms = 604800000   // 7 天
}
```

### 3.2 清理流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    Delete 清理流程                                 │
│                                                                  │
│  定时任务（每 5 分钟执行一次）                                     │
│  │                                                              │
│  ├─→ 检查段文件列表                                              │
│  │                                                              │
│  ├─→ 计算截止时间                                                │
│  │   截止时间 = 当前时间 - retention.ms                          │
│  │                                                              │
│  ├─→ 找到可删除的段                                              │
│  │   段结束时间 < 截止时间                                        │
│  │                                                              │
│  ├─→ 删除段文件                                                  │
│  │   - 删除 .log 文件                                           │
│  │   - 删除 .index 文件                                          │
│  │   - 删除 .timeindex 文件                                      │
│  │                                                              │
│  └─→ 清理完成                                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 清理时机

```
何时清理？

1. 基于时间
   - 消息时间戳 > retention.ms
   - 段文件修改时间 > segment.ms

2. 基于大小
   - topic.log.retention.bytes
   - 整个 topic 的日志大小超过限制

3. 立即删除
   - 使用 kafka-delete-records.sh 脚本
   - 删除指定 offset 之前的所有消息
```

### 3.4 清理配置示例

```bash
# Topic 级别配置
kafka-topics.sh --create \
    --topic order-events \
    --bootstrap-server localhost:9092 \
    --partitions 6 \
    --replication-factor 3 \
    --config retention.ms=604800000 \
    --config retention.bytes=-1

# 修改配置
kafka-topics.sh --alter \
    --topic order-events \
    --bootstrap-server localhost:9092 \
    --add-config retention.ms=86400000  # 改为 1 天
```

## 四、Compact 策略详解

### 4.1 适用场景

Compact 策略适用于以下场景：

| 场景 | 说明 |
|------|------|
| 用户配置 | 用户最新配置 |
| 账户信息 | 用户最新账户状态 |
| 变更日志 | Key 是实体 ID，Value 是最新状态 |
| 缓存 | 需要实时更新的缓存数据 |

```
典型使用场景：

1. 事件溯源
   - 用户每次操作生成一条消息
   - Compact 后只保留用户最新状态
   - Consumer 始终能获取最新状态

2. 实时缓存
   - 消息是缓存项
   - Compact 后每个 Key 只有一条最新记录
   - 作为持久化缓存使用
```

### 4.2 配置参数

```java
// Compact 策略配置
public class CompactConfig {
    
    // 1. 启用 Compact
    log.cleanup.policy = compact
    
    // 2. 最小段文件大小
    // 小于这个大小的段不会被清理
    // 避免清理还在写入的活跃段
    log.segment.bytes = 1073741824  // 1GB
    log.cleaner.min.cleanable.dirty.ratio = 0.5  // 50%
    
    // 3. 最小消息大小
    // 小于这个大小的消息不计入清理
    log.cleaner.min.compact.lag.ms = 0  // 不限制
    
    // 4. 清理线程数
    log.cleaner.threads = 1  // 清理线程数
    
    // 5. 清理批次大小
    log.cleaner.io.buffer.size = 512*1024  // 512KB
}
```

### 4.3 Compact 流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    Compact 清理流程                                 │
│                                                                  │
│  Cleaner 线程                                                      │
│  │                                                              │
│  ├─→ 读取段文件（保留头，跳过已清理部分）                           │
│  │                                                              │
│  ├─→ 构建 Key → Offset 映射                                      │
│  │   key=user1 → offset=1000                                    │
│  │   key=user2 → offset=500                                     │
│  │   key=user1 → offset=2000  ← 更新                            │
│  │   key=user3 → offset=3000                                    │
│  │                                                              │
│  ├─→ 写新段文件                                                  │
│  │   - 保留每个 Key 的最新值                                     │
│  │   - 按 offset 顺序写入                                       │
│  │   - 保留 tombstone 消息（删除标记）                           │
│  │                                                              │
│  ├─→ 替换旧段文件                                                │
│  │   - 删除旧段                                                  │
│  │   - 使用新段                                                  │
│  │                                                              │
│  └─→ 清理完成                                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 4.4 Tombstone 消息

```
Tombstone 消息：

作用：标记某个 Key 被删除

格式：value = null

Compact 后：
- 正常消息：保留最新值
- Tombstone 消息：直到超过 delete.retention.ms 才删除

示例：
[user1, profile_v2]       ← 旧值，被覆盖
[user1, null]               ← Tombstone，标记删除 user1
...
[user1, null]               ← Tombstone 被 Compact 移除
```

```java
// 发送 Tombstone 消息
public class TombstoneExample {
    
    public void sendTombstone() {
        // value 设为 null 即为 Tombstone
        ProducerRecord&lt;String, String&gt; record = new ProducerRecord&lt;&gt;(
            "user-config",    // Topic
            "user-123",      // Key
            null             // Value = null = Tombstone
        );
        
        producer.send(record);
    }
}
```

## 五、Delete vs Compact

| 特性 | Delete | Compact |
|------|--------|---------|
| 清理方式 | 删除旧消息 | 合并同 Key 消息 |
| 保留数据 | 最新 N 天的数据 | 每个 Key 的最新值 |
| 适用场景 | 事件流、时间窗口 | 状态快照、配置缓存 |
| 磁盘使用 | 与保留时间成正比 | 与 Key 数量成正比 |
| Consumer | 需要处理历史数据 | 只关心最新状态 |

## 六、清理优化

### 6.1 Delete 优化

```java
// Delete 策略优化
public class DeleteOptimization {
    
    // 1. 合理设置保留时间
    // 太长：浪费磁盘
    // 太短：无法回溯
    log.retention.ms = 604800000  // 7 天
    
    // 2. 段文件大小
    // 影响删除粒度
    log.segment.bytes = 1073741824  // 1GB
    
    // 3. 清理检查间隔
    // 太频繁：影响性能
    // 太长：磁盘可能爆
    log.retention.check.interval.ms = 300000  // 5 分钟
    
    // 4. 监控磁盘使用
    // 设置告警阈值
    // 磁盘使用率 > 80% 告警
}
```

### 6.2 Compact 优化

```java
// Compact 策略优化
public class CompactOptimization {
    
    // 1. 段文件大小
    // 太频繁清理会影响性能
    // 太大会导致清理时间过长
    log.segment.bytes = 1073741824  // 1GB
    
    // 2. 最小清理比率
    // dirty ratio = 脏数据 / 总数据
    // 小于此比率不清理
    log.cleaner.min.cleanable.dirty.ratio = 0.5  // 50%
    
    // 3. 清理线程数
    // 根据 CPU 核心数配置
    // 默认 1，建议设置为 CPU 核心数的一半
    log.cleaner.threads = 4
    
    // 4. IO 缓冲区大小
    // 越大清理越快，但占用内存越多
    log.cleaner.io.buffer.size = 524288  // 512KB
}
```

### 6.3 监控清理状态

```bash
# 查看 Topic 的日志清理状态
kafka-logges.sh --describe \
    --topic order-events \
    --bootstrap-server localhost:9092

# 输出示例：
# Topic: order-events    Partition: 0
#     LogSize: 1073741824 (segments: 5)
#     FirstOffset: 100000
#     LastOffset: 1100000
#     NumberOfCleanSegments: 3
#     NumberOfDirtySegments: 2
#     CleanerStatus: Running
```

```java
// JMX 监控指标
public class CleanerMetrics {
    
    // log.cleaner.delete.retention.ms
    // Tombstone 保留时间
    
    // log.cleaner.io.ratio
    // 清理 IO 比率
    
    // kafka.log:type=Cleaner,name=cleaner-offset-checkpoint-error-count
    // 清理错误计数
}
```

## 七、实战配置

### 7.1 订单事件 Topic

```properties
# 订单事件：按时间保留 7 天
order-events:
  cleanup.policy: delete
  retention.ms: 604800000
  retention.bytes: -1
  segment.bytes: 1073741824
```

### 7.2 用户配置 Topic

```properties
# 用户配置：Compact 保留最新配置
user-config:
  cleanup.policy: compact
  min.cleanable.dirty.ratio: 0.3
  segment.bytes: 1073741824
  delete.retention.ms: 86400000  # Tombstone 保留 1 天
  min.compact.lag.ms: 0
```

### 7.3 审计日志 Topic

```properties
# 审计日志：按大小保留
audit-log:
  cleanup.policy: delete
  retention.bytes: 107374182400  # 100GB
  retention.ms: -1
  segment.bytes: 536870912  # 512MB
```

## 八、常见问题

### 8.1 删除消息没释放磁盘

```
问题：删除了消息，但磁盘使用率没降低

原因：
1. Segment 还在写入，未达到清理条件
2. 段文件是追加的，消息在中间无法删除
3. Kafka 只能删除整个段文件

解决：
1. 等待段文件过期
2. 使用 delete-records 脚本强制删除
3. 降低 segment.ms 时间
```

### 8.2 Compact 后数据丢失

```
问题：Compact 后发现部分历史消息不见了

原因：
1. Compact 只保留每个 Key 的最新值
2. 如果只发过一条消息，删除后就没了
3. Tombstone 消息会被最终删除

解决：
1. 如果需要历史数据，用 Delete 策略
2. 确认是否需要 Compact
3. 合理设置 delete.retention.ms
```

### 8.3 清理影响性能

```
问题：清理时 Broker 性能下降

原因：
1. 清理需要读写磁盘
2. 与正常读写竞争 IO

解决：
1. 在低峰期清理
2. 减少清理线程数
3. 增加清理缓冲区
```

## 总结

日志清理策略对比：

| 策略 | 适用场景 | 配置要点 |
|------|----------|----------|
| Delete | 事件流、日志 | retention.ms 合理设置 |
| Compact | 状态存储、缓存 | min.cleanable.dirty.ratio |

**选择正确的清理策略，能在保证功能的同时优化磁盘使用。**

---

## 留给你的问题

1. **Delete 的清理粒度**：Kafka 只能删除整个 Segment，不能删除中间的消息。如果只保留 7 天，但某个 Segment 包含 8 天的数据，会怎么处理？

2. **Compact 的数据一致性**：Compact 过程中，Consumer 读取会看到不一致的数据吗？同一个 Key 可能同时有新值和旧值？

3. **Tombstone 的保留时间**：`delete.retention.ms` 设置为 1 天，Consumer 在 1 天内没运行，会怎样？

4. **混合策略**：能否同时使用 Delete 和 Compact？比如近 7 天用 Delete，7 天后用 Compact？

思考这些问题，能帮你更好地理解日志清理的细节。
