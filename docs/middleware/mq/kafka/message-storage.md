# Kafka 消息存储：Segment + Index + 时间索引

消息存在哪？Kafka 怎么快速找到一条消息？

磁盘上的日志文件看起来是一坨，但 Kafka 能做到毫秒级查询。

秘密在于它的三层索引结构：**Segment + Index + 时间索引**。

## 一、消息存储结构

### 1.1 Partition 的物理结构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Partition 物理存储结构                          │
│                                                                  │
│  /data/kafka/  ← Kafka 日志目录                                  │
│  └── order-topic-0/  ← Topic 分区目录                            │
│      ├── 00000000000000000000.log     ← 消息日志                 │
│      ├── 00000000000000000000.index    ← 偏移量索引              │
│      ├── 00000000000000000000.timeindex ← 时间索引               │
│      ├── 00000000000000001000000.log     ← 第二个 Segment         │
│      ├── 00000000000000001000000.index   ← 偏移量索引             │
│      ├── 00000000000000001000000.timeindex                       │
│      └── leader-epoch-checkpoint        ← Leader Epoch            │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Segment 的概念

```
┌─────────────────────────────────────────────────────────────────┐
│                         Segment 机制                             │
│                                                                  │
│  Partition 日志：                                                │
│  ┌────────────┬────────────┬────────────┬────────────┐          │
│  │ Segment 0  │ Segment 1  │ Segment 2  │ Segment 3  │          │
│  │ 0 ~ 9999   │ 10000~19999│ 20000~29999│ 30000~39999│          │
│  │ 活跃段      │ 已归档      │ 已归档      │ 活跃段      │          │
│  └────────────┴────────────┴────────────┴────────────┘          │
│       ↑                                                   ↑       │
│       │                                                   │       │
│  当前写入段                                          最早可删除段    │
│                                                                  │
│  Segment 命名规则：起始 offset                                    │
│  Segment 0: 00000000000000000000                                │
│  Segment 1: 00000000000000010000                                │
└─────────────────────────────────────────────────────────────────┘
```

```java
// Segment 切分配置
public class SegmentConfig {
    
    // 达到多大字节后创建新 Segment
    // 默认：1GB
    // 太大：删除旧数据时删除粒度大
    // 太小：索引文件太多
    log.segment.bytes = 1073741824  // 1GB
    
    // 达到多长时间后创建新 Segment
    // 即使没达到大小限制
    // 默认：7 天
    log.roll.ms = 604800000  // 7 天
    
    // 段索引间隔
    // 每隔多少字节建一个索引项
    log.index.size.max.bytes = 10485760  // 10MB
}
```

## 二、消息格式

### 2.1 消息结构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Kafka 消息格式（V2）                           │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │                      Record                             │    │
│  │                                                         │    │
│  │  ┌──────────┬──────────┬──────────┬──────────┬────────┐│    │
│  │  │ Base     │ Record   │ Key      │ Value    │ Headers│    │
│  │  │ Offset   │ Body     │ (optional)│ (optional)│ (var) │    │
│  │  │ 8 bytes  │ (var)    │          │          │       │    │
│  │  └──────────┴──────────┴──────────┴──────────┴────────┘│    │
│  │                                                         │    │
│  │  ┌──────────┬──────────┬──────────┬──────────┬────────┐│    │
│  │  │ Timestamp│ CRC     │ Version  │ Attribute│ ...   ││    │
│  │  │ 8 bytes  │ 4 bytes  │ 1 byte   │ 1 byte   │ ...   ││    │
│  │  └──────────┴──────────┴──────────┴──────────┴────────┘│    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 消息字段说明

```java
// 消息核心字段
public class Record {
    
    // 1. BaseOffset：相对 Segment 起始的偏移量
    // 实际 offset = Segment 起始 offset + BaseOffset
    // 节省空间：存储相对值而非绝对值
    
    // 2. Timestamp：消息时间戳
    // - CreateTime：Producer 创建时间
    // - LogAppendTime：写入 Broker 时间
    long timestamp;
    
    // 3. Key：分区键（可选）
    // 用于分区路由
    byte[] key;
    
    // 4. Value：消息体（可选）
    byte[] value;
    
    // 5. Headers：消息头
    // 存放元数据，不参与业务
    Header[] headers;
    
    // 6. CRC：校验码
    // 保证消息完整性
    int crc;
    
    // 7. Version：版本号
    byte version;
    
    // 8. Attributes：属性
    // 压缩类型、事务标记等
    byte attributes;
}
```

### 2.3 批量消息格式

```
┌─────────────────────────────────────────────────────────────────┐
│                    批量消息格式（Record Batch）                     │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                     Record Batch                          │  │
│  │                                                           │  │
│  │  ┌─────────────────────────────────────────────────────┐ │  │
│  │  │  Base Offset (8)                                     │ │  │
│  │  │  Batch Length (4)                                    │ │  │
│  │  │  Partition Leader Epoch (4)                          │ │  │
│  │  │  Magic (1)                                           │ │  │
│  │  │  CRC (4)                                             │ │  │
│  │  │  Last Offset Delta (4)                               │ │  │
│  │  │  First Timestamp (8)                                 │ │  │
│  │  │  Max Timestamp (8)                                   │ │  │
│  │  │  Producer ID (8)                                     │ │  │
│  │  │  Producer Epoch (2)                                  │ │  │
│  │  │  First Sequence (4)                                  │ │  │
│  │  │  Records Count (4)                                   │ │  │
│  │  ├─────────────────────────────────────────────────────┤ │  │
│  │  │  Record 1                                            │ │  │
│  │  │  Record 2                                            │ │  │
│  │  │  ...                                                 │ │  │
│  │  │  Record N                                            │ │  │
│  │  └─────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 三、索引机制

### 3.1 偏移量索引

偏移量索引让你能快速定位到指定 offset 的消息。

```
┌─────────────────────────────────────────────────────────────────┐
│                    偏移量索引（.index 文件）                      │
│                                                                  │
│  索引文件结构：                                                   │
│  ┌──────────┬──────────┬──────────┬──────────┐                 │
│  │ Position │  Offset  │ Position │  Offset  │  ...              │
│  │  4 bytes │  4 bytes │  4 bytes │  4 bytes │                 │
│  └──────────┴──────────┴──────────┴──────────┘                 │
│                                                                  │
│  示例：                                                          │
│  Position  │  Offset  │  说明                                  │
│  ──────────┼──────────┼───────────────                          │
│  0         │ 0        │  offset 0 在文件 offset 0             │
│  500       │ 100       │  offset 100 在文件 offset 500         │
│  1200      │ 250       │  offset 250 在文件 offset 1200        │
│                                                                  │
│  查找 offset=200：                                               │
│  1. 二分查找索引，找到最大的 index.offset <= 200                 │
│  2. 找到 index: Position=500, Offset=100                        │
│  3. 从 Position=500 开始顺序读取，直到找到 offset=200            │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 时间索引

时间索引让你能快速定位到指定时间戳的消息。

```
┌─────────────────────────────────────────────────────────────────┐
│                    时间索引（.timeindex 文件）                    │
│                                                                  │
│  索引文件结构：                                                   │
│  ┌──────────┬──────────┬──────────┬──────────┐                 │
│  │ Timestamp│  Offset  │ Timestamp│  Offset  │  ...              │
│  │  8 bytes │  4 bytes │  8 bytes │  4 bytes │                 │
│  └──────────┴──────────┴──────────┴──────────┘                 │
│                                                                  │
│  示例：                                                          │
│  Timestamp      │  Offset  │  说明                              │
│  ──────────────┼──────────┼───────────────                      │
│  1700000000000 │ 0        │  某个时间点的第一条消息             │
│  1700000100000 │ 500      │  1 秒后的消息                       │
│  1700000200000 │ 1200     │  2 秒后的消息                       │
│                                                                  │
│  查找时间戳 T=1700000150000：                                     │
│  1. 二分查找索引，找到最大的 index.timestamp <= T                 │
│  2. 找到 index: Timestamp=1700000100000, Offset=500             │
│  3. 从 offset=500 开始顺序读取，直到找到目标时间                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 索引查找流程

```java
// 索引查找流程
public class IndexSearch {
    
    // 查找 offset=2000 的消息
    public int searchOffset(Segment segment, long targetOffset) {
        
        // 1. 二分查找偏移量索引
        // 找到 index.position 和 index.offset
        IndexEntry entry = binarySearch(
            segment.offsetIndex(),
            targetOffset
        );
        
        // 2. 从 entry.position 开始顺序扫描日志
        long startOffset = entry.offset;
        long position = entry.position;
        
        // 3. 顺序读取直到找到目标 offset
        ByteBuffer buffer = segment.log().read(position);
        
        while (buffer.hasRemaining()) {
            Record record = Record.parse(buffer);
            
            long absoluteOffset = segment.baseOffset() + record.baseOffset();
            
            if (absoluteOffset == targetOffset) {
                return position;  // 找到了
            }
            
            if (absoluteOffset > targetOffset) {
                break;  // 已经超过，跳出
            }
        }
        
        return -1;  // 没找到
    }
}
```

## 四、Leader Epoch

### 4.1 问题引入

在没有 Leader Epoch 之前，故障恢复可能出现数据不一致：

```
问题场景：

Broker 1 (Leader) 写入 offset 0~1000 后宕机
Broker 2 成为新 Leader，继续写入 offset 0~500
Broker 1 恢复，以 Follower 身份同步

旧 Leader 有 offset 0~500 的消息，但内容可能不同！

Broker 2 的 offset 0~500：新数据
Broker 1 的 offset 0~500：旧数据

Broker 1 直接截断到 offset 500 会丢失新数据！
```

### 4.2 Leader Epoch 解决方案

```
┌─────────────────────────────────────────────────────────────────┐
│                    Leader Epoch 机制                             │
│                                                                  │
│  Leader Epoch 数据结构：                                          │
│  ┌────────────┬────────────┐                                   │
│  │  Epoch     │ StartOffset│                                   │
│  │  (版本号)  │ (起始偏移量) │                                   │
│  └────────────┴────────────┘                                   │
│                                                                  │
│  Epoch 文件示例：                                                │
│  ┌───────┬────────────┐                                       │
│  │   0   │     0      │  → Epoch 0 从 offset 0 开始           │
│  │   1   │   1000     │  → Epoch 1 从 offset 1000 开始         │
│  │   2   │   1500     │  → Epoch 2 从 offset 1500 开始         │
│  └───────┴────────────┘                                       │
│                                                                  │
│  选举时带上 Epoch，Follower 截断到正确的 offset                    │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 Epoch Checkpoint

```java
// Leader Epoch Checkpoint 文件
public class LeaderEpochCheckpoint {
    
    // 文件路径：leader-epoch-checkpoint
    // 格式：N + N × (Epoch, StartOffset)
    
    // 文件内容示例：
    // 3                          ← 条目数
    // 0 0                        ← Epoch 0, StartOffset 0
    // 1 1000                     ← Epoch 1, StartOffset 1000
    // 2 1500                     ← Epoch 2, StartOffset 1500
    
    // 写入时机：
    // 1. Broker 成为新 Leader 时
    // 2. 写入新消息时（如果 Epoch 变了）
    // 3. 定期 checkpoint
}
```

## 五、日志清理与存储

### 5.1 日志段文件

```
┌─────────────────────────────────────────────────────────────────┐
│                    日志段文件详情                                 │
│                                                                  │
│  00000000000000000000.log                                        │
│  ├── 消息存储                                                    │
│  ├── 顺序写入                                                    │
│  └── 追加模式                                                    │
│                                                                  │
│  00000000000000000000.index                                      │
│  ├── 偏移量索引                                                  │
│  ├── 稀疏索引                                                    │
│  └── 固定间隔建索引                                              │
│                                                                  │
│  00000000000000000000.timeindex                                  │
│  ├── 时间索引                                                    │
│  ├── 按时间戳索引                                                │
│  └── 支持时间查询                                                │
│                                                                  │
│  leader-epoch-checkpoint                                         │
│  ├── Leader Epoch 记录                                          │
│  └── 用于故障恢复                                                │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 索引大小配置

```java
// 索引配置
public class IndexConfig {
    
    // 偏移量索引文件大小
    // 默认：10MB
    // 索引文件是稀疏的，不是每个 offset 都有索引
    log.index.size.max.bytes = 10485760  // 10MB
    
    // 索引间隔（字节）
    // 每隔 4KB 数据建立一个索引项
    log.index.interval.bytes = 4096
    
    // 索引项大小：8 字节（position 4 + offset 4）
    // 10MB / 8 = 约 130 万个索引项
    // 每个索引项覆盖约 4KB 数据
}
```

## 六、消息读取流程

### 6.1 Consumer 读取流程

```java
// Consumer 读取消息流程
public class FetchManager {
    
    public List&lt;Record&gt; fetch(ConsumerConfig config, long offset, int maxBytes) {
        
        // 1. 定位 Segment
        Segment segment = locateSegment(offset);
        
        // 2. 在 Segment 内定位消息
        long position = segment.offsetIndex().lookup(offset);
        
        // 3. 读取消息
        ByteBuffer buffer = segment.log().read(position, maxBytes);
        
        // 4. 解析消息
        return parseRecords(buffer);
    }
    
    // 定位 Segment
    private Segment locateSegment(long offset) {
        // 二分查找 Segment 列表
        // 找到 baseOffset <= offset 的最大 Segment
    }
}
```

### 6.2 读取优化

```java
// 读取优化配置
public class FetchConfig {
    
    // 最大拉取字节数
    // 每次从每个分区拉取的最大数据量
    fetch.max.bytes = 52428800  // 50MB
    
    // 最大等待时间
    // 数据量没达到也要返回
    fetch.max.wait.ms = 500
    
    // 最小拉取数据量
    fetch.min.bytes = 1
    
    // 最大分区拉取字节数
    max.partition.fetch.bytes = 1048576  // 1MB
}
```

## 七、存储设计关键思想

### 7.1 稀疏索引

```
Kafka 使用稀疏索引，不是每个消息都有索引

好处：
- 索引文件小（10MB 可索引 10GB 数据）
- 查找时需要顺序扫描一小段
- 平衡了空间和时间

坏处：
- 查询需要顺序扫描
- 不适合精确查找大量数据
```

### 7.2 顺序写保证

```
为什么 Kafka 写这么快？

核心：顺序写入

1. 消息追加到文件末尾
2. 只写入，不修改
3. 磁盘顺序写速度接近内存

对比：
- 随机写：每次需要磁头移动，~10ms/次
- 顺序写：一次磁头移动，~0.1ms/次

结论：
- 10000 次顺序写 = 1 秒
- 10000 次随机写 = 100 秒
```

### 7.3 内存映射

```
Kafka 使用 mmap（内存映射）加速索引读取

mmap 原理：
1. 将磁盘文件映射到内存地址空间
2. 读取时像访问内存一样
3. OS 自动将磁盘数据加载到 Page Cache

好处：
- 索引读取极快
- 不占用 JVM 堆内存
```

## 总结

消息存储三层结构：

| 层级 | 文件 | 作用 |
|------|------|------|
| 日志层 | .log | 消息存储 |
| 偏移量索引 | .index | 按 offset 快速定位 |
| 时间索引 | .timeindex | 按 timestamp 快速定位 |

**Segment 机制让 Kafka 实现了高效存储和快速清理。**

---

## 留给你的问题

1. **索引间隔的选择**：索引间隔太大，查询要扫描更多数据；太小，索引文件太大。怎么选择？

2. **稀疏索引的代价**：稀疏索引查询需要顺序扫描。如果查询一个不存在或很老的 offset，会扫描多少数据？

3. **Segment 大小的影响**：Segment 太大，删除旧数据时一次删除很多；太小，索引文件太多。怎么权衡？

4. **mmap 的问题**：内存映射文件在进程崩溃时会丢失未刷盘的数据吗？Kafka 怎么处理这个问题？

思考这些问题，能帮你理解 Kafka 存储设计的权衡。
