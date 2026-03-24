# HBase 读取流程：BlockCache + BloomFilter + HFile

HBase 的读取比写入复杂，因为数据可能分散在多个地方。

---

## 读取流程总览

```
┌─────────────────────────────────────────────────────────────┐
│                    HBase 读取流程                              │
│                                                             │
│  读取请求                                                     │
│     │                                                        │
│     ├─→ BlockCache (MemStore + LRU Cache)                    │
│     │     │ 命中?                                              │
│     │     ├─ 是 → 返回                                        │
│     │     └─ 否 → 继续                                        │
│     │                                                        │
│     ├─→ MemStore (内存)                                       │
│     │     │ 命中?                                              │
│     │     ├─ 是 → 返回                                        │
│     │     └─ 否 → 继续                                        │
│     │                                                        │
│     └─→ HFile (磁盘)                                          │
│           │ 命中?                                              │
│           ├─ 是 → 返回 + 写入 BlockCache                      │
│           └─ 否 → 返回空                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. BlockCache

BlockCache 是 HBase 的读缓存，采用 LRU 策略：

```
BlockCache 结构：
┌─────────────────────────────────────────────────────────────┐
│                    LRUBlockCache                              │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │  │
│  │  │ Block A │ │ Block B │ │ Block C │ │ Block D │   │  │
│  │  │ (访问2) │ │ (访问5) │ │ (访问1) │ │ (访问3) │   │  │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │  │
│  │                                                         │  │
│  │  ┌───────────────────────────────────────────────┐   │  │
│  │  │  BucketCache (可选，用于堆外内存)              │   │  │
│  │  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐           │   │  │
│  │  │  │ ... │ │ ... │ │ ... │ │ ... │           │   │  │
│  │  │  └─────┘ └─────┘ └─────┘ └─────┘           │   │  │
│  │  └───────────────────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  淘汰策略：访问次数最少、时间最久的 Block 被淘汰              │
└─────────────────────────────────────────────────────────────┘
```

### BlockCache 配置

```java
// BlockCache 配置
public class BlockCacheConfig {
    // 默认使用 LRUBlockCache
    // 建议设置为 RegionServer 堆内存的 20-40%
    public static final float CACHE_SIZE = 0.4f;  // 40% 堆内存
}

// 表级配置
TableDescriptor table = TableDescriptorBuilder
    .newBuilder(tableName)
    .setBlockCacheEnabled(true)      // 启用缓存
    .setReadOnly(false)               // 可读写
    .build();
```

---

## 2. MemStore 读取

MemStore 存储未刷盘的数据：

```java
// MemStore 读取
public class MemStoreRead {
    // MemStore 按 RowKey 排序
    // 同一 RowKey 可能有多次写入
    // 最新版本在最前面

    public KeyValue getFromMemStore(String rowKey) {
        // 1. 二分查找
        // 2. 如果找到，返回最新版本
        // 3. 如果没找到，返回 null
    }
}
```

---

## 3. HFile 读取

数据从磁盘读取，并写入 BlockCache：

```java
// HFile 读取流程
public class HFileRead {
    // 读取流程：
    // 1. 加载 Block Index（已在内存）
    // 2. 二分查找定位 Block
    // 3. 读取 Block 数据
    // 4. Bloom Filter 加速定位

    // 读取单个 Key
    public KeyValue read(String rowKey) {
        // 1. 检查 Bloom Filter
        if (!bloomFilter.mayContain(rowKey)) {
            return null;  // 一定不存在
        }

        // 2. 二分查找 Block Index
        BlockIndexEntry entry = findBlockIndex(rowKey);

        // 3. 读取 Block
        byte[] blockData = readBlock(entry.getOffset(), entry.getSize());

        // 4. 写入 BlockCache
        blockCache.cacheBlock(entry.getBlockKey(), blockData);

        // 5. 在 Block 内查找 Key
        return findInBlock(blockData, rowKey);
    }
}
```

---

## 4. 读取合并

同一 RowKey 的数据可能来自多个 HFile 和 MemStore：

```
读取合并（Read Recovery）：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  RowKey: user_001                                           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  MemStore（最新）                                     │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  info:name = "张三丰" (v3) ← 最新版本     │   │   │
│  │  │  info:age = 30 (v2)                       │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  HFile 1                                             │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  info:name = "张三" (v1)                   │   │   │
│  │  │  info:age = 25 (v1)                       │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  合并结果（最新优先）：                                       │
│  info:name = "张三丰" (v3)                                  │
│  info:age = 30 (v2)                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 完整读取示例

```java
public class HBaseRead {
    private final Connection connection;

    // 读取单条
    public String read(String rowKey, String cf, String cq) throws IOException {
        Table table = connection.getTable(TableName.valueOf("t_user"));

        Get get = new Get(Bytes.toBytes(rowKey));
        get.addColumn(Bytes.toBytes(cf), Bytes.toBytes(cq));

        Result result = table.get(get);

        byte[] value = result.getValue(Bytes.toBytes(cf), Bytes.toBytes(cq));
        return value != null ? Bytes.toString(value) : null;
    }

    // 读取多版本
    public List&lt;String&gt; readVersions(String rowKey, String cf, String cq, int versions)
            throws IOException {
        Table table = connection.getTable(TableName.valueOf("t_user"));

        Get get = new Get(Bytes.toBytes(rowKey));
        get.addColumn(Bytes.toBytes(cf), Bytes.toBytes(cq));
        get.setMaxVersions(versions);  // 获取多个版本

        Result result = table.get(get);

        List&lt;String&gt; values = new ArrayList&lt;&gt;();
        for (Cell cell : result.getColumnCells(Bytes.toBytes(cf), Bytes.toBytes(cq))) {
            values.add(Bytes.toString(CellUtil.cloneValue(cell)));
        }
        return values;
    }

    // 范围扫描
    public List&lt;Result&gt; scan(String startRow, String stopRow) throws IOException {
        Table table = connection.getTable(TableName.valueOf("t_user"));

        Scan scan = new Scan();
        scan.withStartRow(Bytes.toBytes(startRow));
        scan.withStopRow(Bytes.toBytes(stopRow));

        List&lt;Result&gt; results = new ArrayList&lt;&gt;();
        try (ResultScanner scanner = table.getScanner(scan)) {
            for (Result result : scanner) {
                results.add(result);
            }
        }
        return results;
    }
}
```

---

## 读取性能优化

### 1. 批量读取

```java
// 批量读取
public void batchRead(Table table, List&lt;String&gt; rowKeys) throws IOException {
    List&lt;Get&gt; gets = rowKeys.stream()
        .map(rk -> {
            Get get = new Get(Bytes.toBytes(rk));
            return get;
        })
        .collect(Collectors.toList());

    // 一次 RPC 获取多行
    Result[] results = table.get(gets);
}
```

### 2. 指定列族

```java
// 只读取需要的列族，减少数据量
Scan scan = new Scan();
scan.addFamily(Bytes.toBytes("info"));  // 只读 info 列族
scan.addFamily(Bytes.toBytes("profile")); // 只读 profile 列族
```

### 3. 缓存优化

```java
// 对于频繁读取的数据，可以强制缓存
Scan scan = new Scan();
scan.setCacheBlocks(true);  // 缓存扫描结果
scan.setCaching(1000);       // 每次 RPC 返回的行数
```

---

## 面试追问方向

- HBase 的 BlockCache 和 MemStore 有什么区别？
- 为什么 HBase 读取需要合并多个数据源？

下一节，我们来了解 HBase 的 Compaction 机制。
