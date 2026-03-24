# HBase 写入流程：WAL + MemStore + Flush

理解 HBase 的写入流程，是理解它高吞吐量的关键。

---

## 写入流程总览

```
┌─────────────────────────────────────────────────────────────┐
│                    HBase 写入流程                              │
│                                                             │
│  Client                                                     │
│     │                                                        │
│     ├─→ 1. 写 WAL (Write-Ahead Log)                         │
│     │     ↓                                                   │
│     ├─→ 2. 写 MemStore (内存)                                │
│     │     ↓                                                   │
│     └─→ 3. 返回成功                                          │
│                                                             │
│  后台：MemStore → Flush → HFile                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. WAL 写入

WAL（Write-Ahead Log）保证数据不丢失：

```java
// WAL 写入（伪代码）
public class WALWrite {
    private final WAL wal;

    public void write(Put put) throws IOException {
        // 1. 构造 WAL Entry
        WALKey key = new WALKey(
            put.getRow(),
            put.getTableName(),
            put.getFamilyMap().keySet()
        );
        WALEdit edit = new WALEdit();
        for (Map.Entry&lt;byte[], List&lt;KeyValue&gt;&gt; entry : put.getFamilyMap().entrySet()) {
            for (KeyValue kv : entry.getValue()) {
                edit.add(kv);
            }
        }

        // 2. 写入 WAL（先追加，不刷盘）
        long sequenceId = wal.append(regionInfo, key, edit, true);

        // 3. 强制刷盘（可选，根据配置）
        // wal.sync();
    }
}
```

### WAL 持久化策略

```java
// WAL 持久化级别
public enum Durability {
    USE_DEFAULT,      // 使用表级默认配置
    SKIP_WAL,        // 不写 WAL（最快，但可能丢数据）
    ASYNC_WAL,       // 异步刷盘
    SYNC_WAL,        // 同步刷盘（默认）
    FSYNC_WAL        // 强制 fsync
}

// 设置表的持久化级别
TableDescriptor table = TableDescriptorBuilder
    .newBuilder(tableName)
    .setDurability(Durability.SYNC_WAL)
    .build();
```

---

## 2. MemStore 写入

MemStore 是内存中的数据结构，按 RowKey 排序：

```java
// MemStore 写入（伪代码）
public class MemStoreWrite {
    private final ConcurrentSkipListMap&lt;byte[], Cell&gt; memStore;

    public void write(Put put) {
        // 1. 获取写入序列号
        long sequenceId = wal.getLastSequenceId();

        // 2. 写入 MemStore（内存中的跳表）
        for (Map.Entry&lt;byte[], List&lt;KeyValue&gt;&gt; entry : put.getFamilyMap().entrySet()) {
            for (KeyValue kv : entry.getValue()) {
                // MemStore 内部按 RowKey + CF + CQ + TS 排序
                memStore.put(kv.getKey(), kv);
            }
        }
    }
}
```

### MemStore 的特点

- **有序**：内部使用 ConcurrentSkipListMap，按 RowKey 排序
- **写优化**：顺序写入内存，比写磁盘快几个数量级
- **批量聚合**：同一 Key 的多次写入在内存中合并

---

## 3. MemStore Flush

当 MemStore 达到阈值，触发 Flush 到磁盘：

```
Flush 触发条件：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  条件1: MemStore 大小达到阈值（默认 128MB × Region 数）      │
│  条件2: WAL 大小超过阈值                                     │
│  条件3: 定时 Flush（默认 1 小时）                           │
│  条件4: 手动 Flush                                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

```java
// Flush 配置
public class FlushConfig {
    // Region 级 Flush 阈值
    public static final long MEMSTORE_SIZE = 128 * 1024 * 1024L;  // 128MB

    // 全局 Flush 阈值（防止一个 Region 刷盘影响其他）
    // globalMemStoreSize = MEMSTORE_SIZE × Region 数 × 0.95
}
```

### Flush 流程

```
MemStore Flush 流程：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  1. 创建 Snapshot（快照，保存当前 MemStore 状态）           │
│                                                             │
│  2. 清空 MemStore（接受新写入）                             │
│                                                             │
│  3. 将 Snapshot 写成 HFile（后台线程）                      │
│                                                             │
│  4. 删除旧 HFile 中的废弃数据                               │
│                                                             │
│  5. 更新 Meta 信息                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 完整写入示例

```java
public class HBaseWriteFlow {
    private final Connection connection;

    public void writeData(String rowKey, String cf, String cq, String value)
            throws IOException {
        Table table = connection.getTable(TableName.valueOf("t_user"));

        // 1. 构造 Put
        Put put = new Put(Bytes.toBytes(rowKey));
        put.addColumn(
            Bytes.toBytes(cf),
            Bytes.toBytes(cq),
            Bytes.toBytes(value)
        );

        // 2. 写入（内部自动处理 WAL + MemStore）
        table.put(put);

        // 3. 或者批量写入（性能更好）
        List&lt;Put&gt; puts = new ArrayList&lt;&gt;();
        puts.add(put);
        table.put(puts);

        // 4. 关闭
        table.close();
    }

    // 异步写入（高吞吐场景）
    public void asyncWrite(List&lt;Put&gt; puts) throws IOException {
        Table table = connection.getTable(TableName.valueOf("t_user"));

        // 使用 AsyncRequestFutureBuilder 实现高吞吐
        AsyncTable&lt;?&gt; asyncTable = AsyncConnectionImpl.getAsyncTable();
        // ... 异步写入逻辑

        table.close();
    }
}
```

---

## 写入性能优化

### 1. 批量写入

```java
// 批量写入 vs 单条写入
public class BatchWrite {
    // 错误：逐条写入
    public void badBatchWrite(Table table, List&lt;Put&gt; puts) {
        for (Put put : puts) {
            table.put(put);  // 每条一次 RPC
        }
    }

    // 正确：批量写入
    public void goodBatchWrite(Table table, List&lt;Put&gt; puts) {
        table.put(puts);  // 一次 RPC
    }
}
```

### 2. 关闭 WAL（高吞吐场景）

```java
// 高吞吐场景可以关闭 WAL（但可能丢数据）
Put put = new Put(Bytes.toBytes(rowKey));
put.setDurability(Durability.SKIP_WAL);  // 不写 WAL
put.addColumn(Bytes.toBytes(cf), Bytes.toBytes(cq), Bytes.toBytes(value));
table.put(put);
```

### 3. 预分区

```java
// 创建表时预分区，避免热点
byte[][] splitKeys = new byte[9][];
for (int i = 1; i < 10; i++) {
    splitKeys[i-1] = Bytes.toBytes("user_" + i + "0000000");
}

admin.createTable(
    TableDescriptorBuilder.newBuilder(tableName)
        .setColumnFamilies(ColumnFamilyDescriptorBuilder.of("info"))
        .build(),
    splitKeys  // 指定分区点
);
```

---

## 面试追问方向

- HBase 的 MemStore 为什么需要排序？
- Flush 和 Compaction 有什么区别？

下一节，我们来了解 HBase 的读取流程。
