# HBase Region 分裂：自动扩容的秘密

HBase 的数据通过 Region 自动分片，支持水平扩展。

---

## Region 是什么？

Region 是 HBase 表的水平分片：

```
┌─────────────────────────────────────────────────────────────┐
│                    Region 分片                                │
│                                                             │
│  Table: t_user                                             │
│                                                             │
│  ┌─────────────────┬─────────────────┬─────────────────┐   │
│  │  Region 0      │  Region 1      │  Region 2      │   │
│  │  [user_001,     │  [user_100,    │  [user_200,    │   │
│  │   user_099]     │   user_199]     │   ...]         │   │
│  └─────────────────┴─────────────────┴─────────────────┘   │
│        │                  │                  │                │
│        ↓                  ↓                  ↓                │
│  RegionServer-1    RegionServer-2    RegionServer-3       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Region 分裂

### 分裂触发条件

```java
// 分裂触发条件
public class RegionSplit {
    // 1. HFile 大小达到阈值
    public static final long SPLIT_KEY = 10 * 1024 * 1024 * 1024L;  // 10GB

    // 2. 列族 HFile 数超过限制
    public static final int MAX_FILES = 3;
}
```

### 分裂流程

```
Region 分裂流程：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  1. Region 达到分裂阈值                                      │
│                                                             │
│  2. HBase 选择分裂点（RowKey 中间位置）                      │
│                                                             │
│  3. 关闭 Region（停止写入）                                  │
│                                                             │
│  4. 父 Region 分为两个子 Region                              │
│                                                             │
│  5. 更新 Meta 表                                            │
│                                                             │
│  6. 打开两个子 Region（恢复写入）                            │
│                                                             │
│  7. Master 调度负载均衡                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 预分区

### 为什么需要预分区？

```
热区问题：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  如果 RowKey 是自增 ID：                                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Region 0: [user_00001, user_20000]              │   │
│  │  Region 1: [user_20001, user_40000]              │   │
│  │  Region 2: [user_40001, user_60000]              │   │
│  │  ...                                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  问题：新用户 ID 总是最大，所有写入都打到最后一个 Region！      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 创建预分区表

```java
// 创建带预分区的表
public void createPreSplitTable() throws IOException {
    Admin admin = connection.getAdmin();
    TableName tableName = TableName.valueOf("t_user");

    // 计算分裂点（假设分 10 个 Region）
    byte[][] splitKeys = new byte[9][];
    for (int i = 1; i < 10; i++) {
        // 使用哈希前缀作为分裂点
        String hash = String.format("%02d", i);
        splitKeys[i-1] = Bytes.toBytes(hash + "_");
    }

    TableDescriptor table = TableDescriptorBuilder
        .newBuilder(tableName)
        .setColumnFamilies(
            ColumnFamilyDescriptorBuilder.of("info")
        )
        .build();

    admin.createTable(table, splitKeys);
}
```

### 哈希打散 + 预分区

```java
// RowKey 设计：哈希前缀 + 原始 ID
public class RowKeyDesign {
    public static String designRowKey(String userId) {
        // MD5 前 2 位作为前缀（00-FF，256 个桶）
        String prefix = MD5(userId).substring(0, 2);
        return prefix + "_" + userId;
    }

    // 分裂点：00_, 01_, 02_, ..., FF_
    public static byte[][] calculateSplitPoints() {
        byte[][] splits = new byte[255][];
        for (int i = 1; i < 256; i++) {
            splits[i-1] = Bytes.toBytes(String.format("%02x_", i));
        }
        return splits;
    }
}
```

---

## 负载均衡

### 自动均衡

```
Region 负载均衡：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  均衡前：                                                    │
│  RegionServer-1: 10 个 Region                               │
│  RegionServer-2:  2 个 Region                               │
│  RegionServer-3:  8 个 Region                               │
│                                                             │
│  Master 自动调度：                                           │
│  RegionServer-1:  7 个 Region                               │
│  RegionServer-2:  7 个 Region                               │
│  RegionServer-3:  6 个 Region                               │
│                                                             │
│  注意：均衡会触发 Region 迁移，有短暂影响                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 均衡配置

```java
// 均衡配置
public class LoadBalanceConfig {
    // 启用自动均衡（默认启用）
    // hbase-site.xml
    // &lt;property&gt;
    //   &lt;name&gt;hbase.master.loadbalance.bytable&lt;/name&gt;
    //   &lt;value&gt;true&lt;/value&gt;
    // &lt;/property&gt;

    // 均衡周期
    // &lt;property&gt;
    //   &lt;name&gt;hbase.balancer.period&lt;/name&gt;
    //   &lt;value&gt;300000&lt;/value&gt;  // 5 分钟
    // &lt;/property&gt;
}
```

---

## 面试追问方向

- Region 分裂和负载均衡有什么区别？
- 如何避免热点 Region？

下一节，我们来了解 HBase 的 Bloom Filter。
