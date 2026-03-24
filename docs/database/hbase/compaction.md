# HBase Compaction：数据文件的整理艺术

MemStore 不断 Flush，产生越来越多的小 HFile。

Compaction 就是把这些小文件合并成大文件的过程。

---

## Compaction 类型

```
┌─────────────────────────────────────────────────────────────┐
│                    Compaction 类型                            │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Minor Compaction                                    │   │
│  │  合并少量小 HFile，不删除过期数据                    │   │
│  │  触发频率：高                                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Major Compaction                                   │   │
│  │  合并所有 HFile，删除过期数据和删除标记              │   │
│  │  触发频率：低（建议手动触发）                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Minor Compaction

### 触发条件

```java
// Minor Compaction 触发条件
public class MinorCompaction {
    // 1. HFile 数量超过阈值
    public static final int COMPACTION_MIN = 3;  // 至少 3 个

    // 2. HFile 大小满足条件
    // Ratio = smallestHFile / sumOfOtherHFiles
    // 当 Ratio > threshold 时触发
    public static final double COMPACTION_RATIO = 1.2;
}
```

### 合并策略

```
Minor Compaction 合并策略：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  合并前（多个小文件）：                                       │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                │
│  │ 1MB │ │ 2MB │ │ 3MB │ │ 4MB │ │ 5MB │                │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘                │
│                                                             │
│  合并后（一个大文件）：                                       │
│  ┌─────────────────┐                                        │
│  │      15MB      │                                        │
│  └─────────────────┘                                        │
│                                                             │
│  注意：不会删除过期数据（Major 会）                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Major Compaction

### 触发条件

```java
// Major Compaction 触发条件
public class MajorCompaction {
    // 1. 所有 HFile 合并成一个
    // 2. 删除标记被处理
    // 3. 删除已过期数据
    // 4. 触发时间间隔
    public static final long COMPACTION_ENABLED_CRON = 7 * 24 * 60 * 60 * 1000L;  // 7天
}
```

### Major Compaction 影响

```
Major Compaction 影响：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  正面影响：                                                  │
│  - 减少 HFile 数量，提高读取性能                             │
│  - 删除过期数据，释放磁盘空间                                │
│  - 删除被标记删除的数据                                      │
│                                                             │
│  负面影响：                                                  │
│  - 大量磁盘 I/O，影响读写性能                               │
│  - 网络压力（如果 HFile 跨节点）                             │
│  - 可能触发 OOM（内存压力大）                                │
│                                                             │
│  建议：业务低峰期手动触发 Major Compaction                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Compaction 执行流程

```java
// Compaction 执行流程
public class CompactionProcess {
    // 1. 选择待合并的 HFile
    public List&lt;HStoreFile&gt; selectFilesToCompact() {
        // 1.1 检查 HFile 是否过期
        // 1.2 检查 HFile 是否达到合并条件
        // 1.3 选择合适的 HFile 集合
        // 1.4 创建 Compaction 请求
    }

    // 2. 执行合并
    public void performCompaction(List&lt;HStoreFile&gt; files) {
        // 2.1 创建临时 Writer
        StoreFileWriter writer = createWriter();

        // 2.2 合并写入
        for (HStoreFile file : files) {
            for (KeyValue kv : file.getScanner()) {
                writer.append(kv);
            }
        }

        // 2.3 关闭 Writer
        writer.close();

        // 2.4 替换旧文件
        replaceFiles(oldFiles, newFile);
    }
}
```

---

## Compaction 配置

```java
// Compaction 配置
public class CompactionConfig {
    // 表级配置
    TableDescriptor table = TableDescriptorBuilder
        .newBuilder(tableName)
        .setColumnFamilies(
            ColumnFamilyDescriptorBuilder
                .of("info")
                // 合并策略
                .setCompactionEnabled(true)
                // 最大 HFile 数（超过后强制合并）
                .setMaxFilesToCompact(10)
                // 最小 HFile 数（Major Compaction 阈值）
                .setMinFilesToCompact(3)
                // TTL（数据过期时间）
                .setTimeToLive(7 * 24 * 3600)  // 7 天
                .build()
        )
        .build();
}
```

---

## Compaction 优化

### 1. 选择合适的触发时机

```bash
# 手动触发 Major Compaction
hbase shell
> major_compact 't_user'

# 只压缩特定列族
> major_compact 't_user', 'info'
```

### 2. 调整合并策略

```java
// 使用 DateTieredCompaction（适合时序数据）
ColumnFamilyDescriptor cfd = ColumnFamilyDescriptorBuilder
    .of("info")
    .setCompactionDataType(DataBlockEncoding.DATE_TIERED_COMPACTION)
    .build();

// 或者使用 FIFO Compaction（极高性能，但不支持更新删除）
ColumnFamilyDescriptor cfd = ColumnFamilyDescriptorBuilder
    .of("log")
    .setCompactionDataType(DataBlockEncoding.FIFO)
    .build();
```

### 3. 监控 Compaction 状态

```java
// 监控 RegionServer 状态
Admin admin = connection.getAdmin();
ClusterStatus status = admin.getClusterStatus();

for (ServerName server : status.getServers()) {
    ServerMetrics metrics = status.getServerLoad(server);
    CompactionState state = metrics.getCompactionState();
    System.out.println(server + ": " + state);
}
```

---

## 面试追问方向

- Minor 和 Major Compaction 有什么区别？
- Compaction 对读写性能有什么影响？

下一节，我们来了解 HBase 的 Region 分裂机制。
