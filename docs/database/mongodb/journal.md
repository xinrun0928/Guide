# MongoDB Journal 日志与崩溃恢复

如果 MongoDB 突然崩溃了，正在写入的数据会丢失吗？

答案是：**不会**。因为有 **Journal 日志**机制。

这一篇，我们来深入了解 MongoDB 的 Journal 日志和崩溃恢复机制。

## Journal 是什么？

Journal（Write-Ahead Log）是 MongoDB 的预写日志机制，类似于 MySQL 的 redo log：

```
写入操作
    │
    ▼
┌─────────────────────┐
│      Journal        │  ← 第一步：写入日志（顺序写入，快）
│  (WAL, 预写日志)     │
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│   WiredTiger Cache  │  ← 第二步：写入内存（可批量）
└─────────────────────┘
    │
    ▼ (Checkpoint, 每60秒)
┌─────────────────────┐
│     Data Files      │  ← 第三步：刷盘（慢，随机写入）
└─────────────────────┘
```

## Journal 的作用

| 作用 | 说明 |
|-----|------|
| **保证持久性** | 崩溃后可以从 Journal 恢复 |
| **加快写入** | 顺序写入日志比随机写入数据文件快 |
| **崩溃恢复** | 重放 Journal，恢复到一致状态 |

## Journal 配置

### 启用 Journal

```javascript
// MongoDB 3.2+ 默认启用 Journal
// WiredTiger 存储引擎必须启用 Journal

// 启动时禁用 Journal（不推荐！）
mongod --nojournal
```

### Journal 路径

```javascript
// Journal 文件位置
// <dbpath>/journal/

// WiredTigerLog.0000000001
// WiredTigerLog.0000000002
// WiredTigerPreplog.0000000001
```

### Journal 大小

```javascript
// Journal 大小计算公式
// Journal 大小 = (数据文件大小 * 3%) * 2
// 最小：1 GB
// 最大：10 GB

// 默认：数据文件大小的 1%（最小 1GB）
```

## Journal 写入机制

### 写入流程

```javascript
// 1. 应用程序发起写入
db.orders.insertOne({orderId: "123", amount: 100})

// 2. WiredTiger 生成 Journal 记录
// 包含：事务 ID、操作类型、修改前/后的数据
{
  "txn_id": 12345,
  "timestamp": ISODate("..."),
  "operations": [
    {
      "optype": "update",
      "collection": "orders",
      "document_id": ObjectId("..."),
      "before": {...},
      "after": {...}
    }
  ]
}

// 3. Journal 刷盘（WAL 机制）
// 4. 内存中的数据更新
// 5. 定期 Checkpoint 将数据刷盘
```

### Journal 刷盘

```javascript
// Journal 刷盘间隔（毫秒）
// 默认：100ms

// 查看刷盘间隔
db.adminCommand({getParameter: 1, journalCommitInterval: 1})

// 调整刷盘间隔（谨慎）
mongod --journalCommitInterval=200

// 配置文件
storage:
  journal:
    enabled: true
    commitIntervalMs: 100
```

## Checkpoint 与 Journal 配合

### Checkpoint 机制

```javascript
// Checkpoint 默认每 60 秒执行一次
// Checkpoint 将所有脏页（dirty pages）刷盘
// Checkpoint 后，Journal 可以清理旧数据

// 查看 Checkpoint 统计
db.serverStatus().wiredTiger.checkpoint

// 输出示例
{
  "checkpoint id": "WTCheckpoint.11",
  "checkpoint timestamp": "Dec 20, 2024 10:00:00",
  "time since last checkpoint": 58,
  "checkpoint duration (milliseconds)": 150,
  "bytes written since last checkpoint": "10MB"
}
```

### 数据恢复流程

```
崩溃发生
    │
    ▼
MongoDB 重启
    │
    ▼
读取 Checkpoint 位置
    │
    ▼
重放 Journal（从 Checkpoint 到崩溃点）
    │
    ▼
恢复完成 → 服务可用
```

## 崩溃恢复测试

### 模拟崩溃

```javascript
// 1. 插入大量数据
for (let i = 0; i < 100000; i++) {
  db.test.insertOne({i: i, data: "test"});
}

// 2. 查看数据状态
db.test.count()  // 100000

// 3. 强制 kill MongoDB（模拟崩溃）
// killall -9 mongod

// 4. 重启 MongoDB
// mongod --fork --logpath /var/log/mongodb.log

// 5. 检查数据完整性
db.test.count()  // 应该仍然是 100000
// 数据已通过 Journal 恢复
```

### Journal 恢复验证

```javascript
// 查看恢复信息（MongoDB 日志）
// grep "recovery" /var/log/mongodb/mongodb.log

// 输出示例
[initandlisten] WiredTiger recovery connection. recovery was performed.
[initandlisten] recovery took 5 seconds
```

## Journal 性能优化

### Journal 与写入性能

```javascript
// Journal 对写入性能的影响：
// 1. 每次写入需要写 Journal（顺序 I/O，很快）
// 2. Journal 刷盘间隔影响持久性保证
// 3. 批量写入可以合并 Journal 写入

// Journal 压缩（减少 I/O 量）
storage:
  wiredTiger:
    engineConfig:
      journalCompressor: snappy  # snappy/zlib/zstd
```

### 批量写入优化

```javascript
// 批量写入减少 Journal 写入次数
// 每个批次使用一个 Journal 事务

// 好：批量写入
db.orders.insertMany([
  {orderId: "1", amount: 100},
  {orderId: "2", amount: 200},
  {orderId: "3", amount: 300}
])

// 差：逐条写入（每条都有 Journal 开销）
db.orders.insertOne({orderId: "1", amount: 100})
db.orders.insertOne({orderId: "2", amount: 200})
db.orders.insertOne({orderId: "3", amount: 300})
```

## Journal 与数据安全

### Write Concern 与 Journal

```javascript
// Write Concern 决定写入确认级别

// w: 1 - 只等主节点确认
db.orders.insertOne({...}, {writeConcern: {w: 1}})

// w: majority - 等多数节点确认
db.orders.insertOne({...}, {writeConcern: {w: "majority"}})

// j: true - Journal 必须刷盘
db.orders.insertOne({...}, {writeConcern: {j: true}})

// 推荐：平衡性能和安全
db.orders.insertOne(
  {...},
  {writeConcern: {w: "majority", j: true}}
)
```

### Write Concern 对比

| Write Concern | 持久性 | 性能 | 说明 |
|---------------|--------|------|------|
| `{w: 1}` | 中 | 高 | 只等主节点确认 |
| `{w: 1, j: true}` | 高 | 中 | 主节点 + Journal 刷盘 |
| `{w: "majority"}` | 高 | 中 | 多数节点确认 |
| `{w: "majority", j: true}` | 最高 | 低 | 最安全，也最慢 |

## Java Journal 配置

```java
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import com.mongodb.WriteConcern;

public class JournalConfig {
    public static void main(String[] args) {
        try (MongoClient client = MongoClients.create()) {
            var db = client.getDatabase("myapp");
            var collection = db.getCollection("orders");

            // 1. 默认写入（w: 1）
            collection.insertOne(new Document("orderId", "1"));

            // 2. 高安全写入（w: majority, j: true）
            collection.withWriteConcern(WriteConcern.MAJORITY)
                .insertOne(new Document("orderId", "2"));

            // 3. 自定义 Write Concern
            WriteConcern safeWrite = new WriteConcern(1, 0, false, true);
            collection.withWriteConcern(safeWrite)
                .insertOne(new Document("orderId", "3"));
        }
    }
}
```

## Journal 与副本集

### Oplog vs Journal

| 特性 | Oplog | Journal |
|-----|-------|---------|
| 用途 | 副本同步 | 崩溃恢复 |
| 位置 | local.oplog.rs | dbpath/journal/ |
| 内容 | 复制操作 | 持久化操作 |
| 复制 | 被其他节点复制 | 不复制 |

### 副本集写入

```javascript
// 副本集写入流程：
// 1. 写入主节点 Journal
// 2. 写入主节点数据
// 3. 主节点写入 Oplog
// 4. 从节点从 Oplog 同步

// Write Concern: w: "majority" 确保多数节点持久化
db.orders.insertOne(
  {...},
  {writeConcern: {w: "majority", j: true}}
)
```

## 常见问题

### 问题 1：Journal 文件占用空间大

```javascript
// Journal 默认最大 10GB
// 如果数据量很大，可能需要调整

// 查看 Journal 大小
ls -lh /data/db/journal/

// 清理 Journal（不要手动删除）
// Journal 由 MongoDB 自动管理
```

### 问题 2：写入变慢

```javascript
// 检查：
// 1. Journal 刷盘是否正常
db.serverStatus().durability

// 2. 磁盘 I/O 是否饱和
db.serverStatus().backgroundFlushing

// 解决方案：
// 1. 使用 SSD
// 2. 降低 Journal 刷盘频率（以牺牲持久性为代价）
// 3. 增加批量写入
```

### 问题 3：恢复时间过长

```javascript
// 如果 Journal 很大，恢复可能需要较长时间
// Journal 越大，恢复越慢

// 优化：
// 1. 定期 Checkpoint
// 2. 减少 Journal 大小（如果可能）
// 3. 使用更快磁盘
```

## 总结

Journal 核心要点：

| 概念 | 说明 |
|-----|------|
| Journal | 预写日志（WAL），保证持久性 |
| Checkpoint | 定期刷盘，清理 Journal |
| 恢复 | 从 Checkpoint + Journal 恢复 |

**配置参数**：

| 参数 | 默认值 | 说明 |
|-----|-------|------|
| `journalCommitInterval` | 100ms | 刷盘间隔 |
| `journalCompressor` | snappy | Journal 压缩 |

**Write Concern 选择**：

| 场景 | 推荐配置 |
|-----|---------|
| 高性能 | `{w: 1}` |
| 平衡 | `{w: "majority"}` |
| 高安全 | `{w: "majority", j: true}` |

---

**下一步，你可以：**

- 学习 [MongoDB 性能监控](/database/mongodb/monitor)
- 掌握 [MongoDB 常见性能瓶颈与优化思路](/database/mongodb/performance)
- 了解 [MongoDB 数据备份与恢复](/database/mongodb/backup)
