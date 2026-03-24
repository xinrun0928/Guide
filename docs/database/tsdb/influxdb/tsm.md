# InfluxDB TSM 存储引擎：数据是如何存储的

InfluxDB 为什么能存这么多数据，还查询这么快？

秘密藏在它的存储引擎里。

InfluxDB 使用的是 **TSM（Time-Structured Merge Tree）** 存储引擎——基于 LSM Tree，但针对时序数据做了专门优化。

---

## TSM vs LSM Tree

在说 TSM 之前，先回顾一下 LSM Tree：

```
LSM Tree (LevelDB/RocksDB):
MemTable → Immutable → SSTable → Compaction → Level N

TSM Tree (InfluxDB):
WAL → Cache → TSM File → Compaction → TSM File (更大)
```

**核心区别**：

| 特性 | LSM Tree | TSM Tree |
|-----|----------|----------|
| 设计目标 | 通用 Key-Value | 时序数据 |
| 文件格式 | SSTable | TSM File |
| 压缩 | 通用压缩 | 针对时序的压缩 |
| 时间排序 | 无 | 强制按时间排序 |

---

## TSM 文件结构

```
┌─────────────────────────────────────────────────────────────┐
│                     TSM File (.tsm)                          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                  Header (5 bytes)                    │  │
│  │  Magic: 0x16D116D1                                   │  │
│  │  Version: 1                                          │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                    Index Block                        │  │
│  │  ┌─────────────────────────────────────────────────┐│  │
│  │  │ Key1: Block Pointer (offset, size)              ││  │
│  │  │ Key2: Block Pointer (offset, size)              ││  │
│  │  │ Key3: Block Pointer (offset, size)              ││  │
│  │  │ ...                                              ││  │
│  │  └─────────────────────────────────────────────────┘│  │
│  │  ┌─────────────────────────────────────────────────┐│  │
│  │  │             CRC (4 bytes)                        ││  │
│  │  └─────────────────────────────────────────────────┘│  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                    Data Blocks                        │  │
│  │  ┌─────────────────────────────────────────────────┐│  │
│  │  │ Block 1: [timestamp][values][...][timestamp]... ││  │
│  │  └─────────────────────────────────────────────────┘│  │
│  │  ┌─────────────────────────────────────────────────┐│  │
│  │  │ Block 2: [...]                                  ││  │
│  │  └─────────────────────────────────────────────────┘│  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**核心思想**：按时间分块存储，同一时间范围的数据放在一起。

---

## 写入流程

```
写入请求
    │
    ├─→ WAL (Write-Ahead Log)
    │    └─→ 写入磁盘，保证持久性
    │
    ├─→ Cache (MemTable)
    │    └─→ 内存缓存，快速写入
    │
    └─→ TSM File (定期刷盘)
         └─→ 真正持久化存储
```

### 1. WAL 写入

```java
// 模拟 WAL 写入
public class WAL {
    private final FileChannel channel;

    // WAL 保证数据持久化
    // 即使系统崩溃，也能从 WAL 恢复
    public void write(Point point) throws IOException {
        // 1. 序列化为字节
        ByteBuffer buffer = serialize(point);

        // 2. 写入 WAL
        channel.write(buffer);

        // 3. 强制刷新到磁盘
        channel.force(true);
    }
}
```

### 2. Cache 写入

```java
// 模拟 Cache 写入
public class Cache {
    private final Map&lt;String, List&lt;Point&gt;&gt; memTable = new ConcurrentHashMap&lt;&gt;();

    // 内存缓存，写入极快
    public void write(Point point) {
        String key = point.getMeasurement() + ":" + point.getTags();
        memTable.computeIfAbsent(key, k -> new ArrayList&lt;&gt;())
                .add(point);
    }

    // 当 Cache 达到阈值，刷盘到 TSM
    public void flushToTSM() {
        // 1. 按 Key 排序
        // 2. 按时间排序
        // 3. 写入 TSM File
    }
}
```

### 3. TSM 刷盘

```java
// 模拟 TSM 刷盘
public class TSMWriter {
    private final FileChannel channel;

    // TSM 文件特点：
    // 1. 按 Key 排序（方便二分查找）
    // 2. 每个 Key 的数据按时间排序
    // 3. 相同的 Key 在索引中只出现一次
    public void write(SortedMap&lt;String, List&lt;Point&gt;&gt; data) throws IOException {
        // 1. 先写入 Data Blocks
        Map&lt;String, List&lt;BlockPointer&gt;&gt; index = new TreeMap&lt;&gt;();

        for (Map.Entry&lt;String, List&lt;Point&gt;&gt; entry : data.entrySet()) {
            String key = entry.getKey();
            List&lt;Point&gt; points = entry.getValue();

            // 2. 按时间分块
            List&lt;ByteBuffer&gt; blocks = splitByBlock(points);

            // 3. 写入每个块
            for (ByteBuffer block : blocks) {
                long offset = channel.position();
                channel.write(block);

                // 4. 记录索引
                index.get(key).add(new BlockPointer(offset, block.remaining()));
            }
        }

        // 5. 写入索引
        writeIndex(index);

        // 6. 写入尾部
        writeFooter();
    }
}
```

---

## TSM 压缩

TSM 的核心优势之一是**高效的压缩**：

### 1. 时间戳压缩

```java
// 时间戳使用 Delta encoding
// 示例：时间戳序列 [1000, 1001, 1005, 1008]
// 存储：1000, [1, 4, 3]  (存差值，不存绝对值)

// 伪代码
public void compressTimestamps(long[] timestamps) {
    long prev = 0;
    for (long ts : timestamps) {
        long delta = ts - prev;
        // 差值通常更小，可以更紧凑存储
        writeVarint(delta);
        prev = ts;
    }
}
```

### 2. 值压缩

```java
// 相同值使用 RLE (Run-Length Encoding)
// 示例：[100, 100, 100, 100, 200, 200]
// 存储：[(100, 4), (200, 2)]  (值, 重复次数)

public void compressValues(Object[] values) {
    Object prev = null;
    int count = 0;

    for (Object value : values) {
        if (value.equals(prev)) {
            count++;  // 继续计数
        } else {
            if (count > 0) {
                write(prev, count);  // 写入上一个值
            }
            prev = value;
            count = 1;
        }
    }
    if (count > 0) {
        write(prev, count);
    }
}
```

### 3. 浮点数压缩

```java
// 浮点数使用 Gorilla XOR 压缩
// 压缩率可达 5-10x

public void compressFloat(double[] values) {
    long prevLeading = 0;
    long prevTrailing = 0;
    long prevValue = 0;

    for (double value : values) {
        long bits = Double.doubleToLongBits(value);

        if (bits == 0) {
            writeBit(0);  // 特殊标记：0
        } else {
            long thisValue = bits;
            long xor = prevValue ^ thisValue;

            if (xor == 0) {
                writeBit(1);  // 和上一个值相同
            } else {
                // Gorilla 压缩算法
                writeBits(thisValue, prevLeading, prevTrailing);
            }
        }
        prevValue = bits;
    }
}
```

---

## Compaction：后台合并

TSM 会定期进行 Compaction：

```
Level 0:  [tsm1]  [tsm2]  [tsm3]  (可能有重叠的 Key)
    ↓ Compaction
Level 1:  [tsm1-2-3]  (Key 已排序，无重叠)
    ↓ Compaction
Level 2:  [larger_tsm]  (更大的文件)
    ↓ ...
Level N:  [largest_tsm]
```

### Compaction 类型

| 类型 | 触发条件 | 作用 |
|-----|---------|------|
| Level Compact | L0 文件超过阈值 | 合并 L0 文件到 L1 |
| File Compact | 文件超过阈值 | 压缩数据，减少大小 |
| Full Compact | 定期执行 | 全面优化 |

---

## 查询流程

```java
public class TSMQuery {
    private final TSMIndex index;

    // 查询某个 Key 的数据
    public List&lt;Point&gt; query(String key, long start, long end) {
        List&lt;Point&gt; results = new ArrayList&lt;&gt;();

        // 1. 先查 Cache
        List&lt;Point&gt; cacheData = index.getFromCache(key, start, end);
        results.addAll(cacheData);

        // 2. 再查 TSM 文件
        for (TSMFile file : getTSMFiles()) {
            // 3. 用索引快速定位
            BlockPointer pointer = file.getIndex().lookup(key);
            if (pointer != null) {
                // 4. 读取数据块
                ByteBuffer block = file.readBlock(pointer);
                // 5. 反序列化
                List&lt;Point&gt; blockData = deserialize(block, start, end);
                results.addAll(blockData);
            }
        }

        // 6. 按时间排序
        Collections.sort(results);
        return results;
    }
}
```

---

## 面试追问方向

- TSM 和 LSM Tree 的核心区别是什么？
- 为什么时序数据适合用追加写入而不是原地更新？

下一节，我们来对比 InfluxQL 和 Flux 查询语言。
