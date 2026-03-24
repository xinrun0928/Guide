# HBase Bloom Filter：快速判断数据是否存在

Bloom Filter 是一个巧妙的概率数据结构，能快速判断一个元素是否「可能存在」。

---

## Bloom Filter 原理

```
┌─────────────────────────────────────────────────────────────┐
│                    Bloom Filter 原理                          │
│                                                             │
│  1. 初始化：Bit Array 全为 0                                │
│  ┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐                │
│  │ 0 │ 0 │ 0 │ 0 │ 0 │ 0 │ 0 │ 0 │ 0 │ 0 │                │
│  └───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘                │
│                                                             │
│  2. 添加元素 "hello"：                                       │
│     - 计算多个哈希函数 h1(), h2(), h3()                       │
│     - 将对应位置设为 1                                        │
│  ┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐                │
│  │ 1 │ 0 │ 0 │ 1 │ 0 │ 1 │ 0 │ 0 │ 0 │ 0 │                │
│  └───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘                │
│       ↑          ↑          ↑                                │
│      h1         h2         h3                               │
│                                                             │
│  3. 查询元素 "hello"：                                       │
│     - 计算 h1(), h2(), h3()                                  │
│     - 检查所有位置是否都为 1                                  │
│     - 如果都是 → 可能存在（可能有假阳性）                      │
│     - 如果有 0 → 一定不存在（无假阴性）                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Bloom Filter 在 HBase 中的应用

### 位置

Bloom Filter 信息存储在 HFile 的 Meta Index 中：

```java
// Bloom Filter 在 HFile 中的位置
public class HFileBloomFilter {
    // 每个 HFile 的 Trailer 中记录 Bloom Filter 的位置
    public long getBloomFilterOffset();
    public int getBloomFilterSize();

    // 在打开 HFile 时加载到内存
    public void loadBloomFilter() {
        // 读取 Meta Index
        // 解析 Bloom Filter 数据
        // 存入内存
    }
}
```

### 类型

```java
// Bloom Filter 类型
public enum BloomType {
    NONE,       // 不使用 Bloom Filter
    ROW,        // 按 RowKey 过滤
    ROWCOL      // 按 RowKey + Column 过滤
}
```

### 配置

```java
// 创建带 Bloom Filter 的表
public class BloomFilterConfig {
    // 配置方式 1：表级
    TableDescriptor table = TableDescriptorBuilder
        .newBuilder(tableName)
        .setColumnFamilies(
            ColumnFamilyDescriptorBuilder
                .of("info")
                .setBloomFilterType(BloomType.ROW)  // 按 RowKey 过滤
                .build()
        )
        .build();

    // 配置方式 2：列族级
    ColumnFamilyDescriptor cfd = ColumnFamilyDescriptorBuilder
        .of("info")
        .setBloomFilterType(BloomType.ROWCOL)  // 按 RowKey+Column 过滤
        .build();
}
```

---

## Bloom Filter 的作用

### 跳过不存在的 HFile

```
┌─────────────────────────────────────────────────────────────┐
│                    Bloom Filter 加速读取                      │
│                                                             │
│  场景：查找 RowKey = "user_999999"                          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  HFile 1: 包含 user_001 - user_100000              │   │
│  │  BloomFilter: 不包含 user_999999 → 直接跳过！       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  HFile 2: 包含 user_900001 - user_1000000           │   │
│  │  BloomFilter: 可能包含 user_999999 → 需要扫描        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  效果：减少不必要的磁盘 I/O                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### ROW vs ROWCOL

| 类型 | 适用场景 | 内存开销 | 说明 |
|-----|---------|---------|------|
| ROW | 按 RowKey 查询 | 低 | 只判断 RowKey 是否存在 |
| ROWCOL | 按 RowKey + Column 查询 | 高 | 可以精确跳过不存在的 Column |

```java
// ROW Bloom Filter 示例
// 场景：每次查询按完整的 RowKey
Get get = new Get(Bytes.toBytes("user_001"));
// Bloom Filter 可以快速判断 user_001 是否在这个 HFile 中

// ROWCOL Bloom Filter 示例
// 场景：经常按 RowKey 查询特定列
Get get = new Get(Bytes.toBytes("user_001"));
get.addColumn(Bytes.toBytes("info"), Bytes.toBytes("email"));
// Bloom Filter 可以判断 (user_001, info:email) 是否存在
```

---

## Bloom Filter 的代价

### 内存开销

```java
// Bloom Filter 内存估算
public class BloomFilterSize {
    // 每个 HFile 的 Bloom Filter 大小
    // 公式：entries / 8 * 1.44 * ln(2) ≈ entries / 4.8
    // 假设：1000000 条数据
    // 大小 ≈ 1000000 / 4.8 ≈ 200KB

    // 减少误判率的配置
    // hbase-site.xml
    // &lt;property&gt;
    //   &lt;name&gt;hfile.block.bloom.error.rate&lt;/name&gt;
    //   &lt;value&gt;0.01&lt;/value&gt;  // 1% 误判率
    // &lt;/property&gt;
}
```

### 写入开销

```java
// 写入时需要更新 Bloom Filter
public class BloomFilterWrite {
    public void write(KeyValue kv) {
        // 1. 写入 MemStore
        memStore.put(kv);

        // 2. 更新 Bloom Filter（内存中）
        bloomFilter.add(kv.getKey());
    }
}
```

---

## 面试追问方向

- Bloom Filter 有什么缺点？
- 如何选择 ROW 和 ROWCOL 类型的 Bloom Filter？

下一节，我们来了解 HBase 的热点 Region 问题。
