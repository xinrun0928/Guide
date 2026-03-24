# MongoDB WiredTiger 存储引擎原理

MongoDB 为什么能在高并发场景下表现出色？答案之一就是 **WiredTiger 存储引擎**。

从 MongoDB 3.0 开始，WiredTiger 成为默认存储引擎（MMAPv1 已废弃）。这一篇，我们来深入了解它的原理。

## WiredTiger 概述

WiredTiger 是一款高性能、支持并发、压缩存储的存储引擎：

| 特性 | 说明 |
|-----|------|
| **B+Tree** | 默认索引结构 |
| **LSM Tree** | 可选的日志结构存储引擎 |
| **MVCC** | 多版本并发控制 |
| **文档级锁** | 高并发写入 |
| **压缩** | 支持 snappy、zstd、zlib |
| **Checkpoint** | 定期刷盘保证一致性 |

## 数据存储结构

### B+Tree 结构

```
┌─────────────────────────────────────────────────────────────┐
│                       B+Tree                                  │
│                                                              │
│                         [Root]                               │
│                        /     \                               │
│                    [Page]   [Page]                          │
│                   / | \    / | \                            │
│                 ...  ...  ...  ...                         │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Data Page                           │   │
│  │  ┌──────────┬──────────┬──────────┬──────────┐     │   │
│  │  │ Record 1 │ Record 2 │ Record 3 │ Record 4 │     │   │
│  │  └──────────┴──────────┴──────────┴──────────┘     │   │
│  │  ~16KB per page (默认)                               │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Page 类型

| 类型 | 说明 | 大小 |
|-----|------|------|
| `leaf page` | 存储文档数据 | 约 16 KB |
| `internal page` | B+Tree 索引页 | 约 4 KB |
| `overflow page` | 大字段溢出页 | 按需 |
| `empty page` | 已删除页面 | 回收重用 |

### WiredTiger vs MMAPv1

| 特性 | WiredTiger | MMAPv1（已废弃） |
|-----|-----------|-----------------|
| 并发控制 | 文档级锁 | 集合级锁 |
| 内存管理 | WiredTiger Cache | 操作系统 Page Cache |
| 压缩 | 支持 | 不支持 |
| 索引 | B+Tree | B-Tree |
| 空间回收 | 自动 | 需 compact |

## Write-Ahead Logging (WAL)

### 日志机制

WiredTiger 使用 Write-Ahead Logging 保证数据持久性：

```
写入操作
    │
    ▼
┌─────────────────┐
│  Journal Log    │  ← 先写入日志（持久化）
│  (WAL 文件)     │
└─────────────────┘
    │
    ▼
┌─────────────────┐
│  Data File      │  ← 异步写入数据文件
│  (Checkpoint)   │
└─────────────────┘
```

### Journal 配置

```javascript
// 查看 Journal 状态
db.adminCommand({serverStatus: 1}).durability

// Journal 刷新间隔（毫秒）
// 默认每 100ms 刷新一次
```

### Journal 与崩溃恢复

```javascript
// Journal 文件存储在 --dbpath/journal 目录
// WiredTiger WAL: WiredTigerLog.*.7f...

// 崩溃恢复过程：
// 1. MongoDB 启动
// 2. 读取 Journal
// 3. 重放未刷盘的修改
// 4. 恢复到一致状态
```

## Cache 与内存管理

### WiredTiger Cache

```
┌──────────────────────────────────────────────────────────────┐
│                     MongoDB 进程内存                          │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              WiredTiger Cache (默认 50% RAM)            │ │
│  │  ┌────────────────────────────────────────────────────┐ │ │
│  │  │  Data Pages (热点数据)                             │ │ │
│  │  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐    │ │ │
│  │  │  │ Page 1 │ │ Page 2 │ │ Page 3 │ │ Page 4 │    │ │ │
│  │  │  └────────┘ └────────┘ └────────┘ └────────┘    │ │ │
│  │  └────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │            MongoDB 内部结构 (约 1-2 GB)                │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Cache 配置

```javascript
// 查看 Cache 使用情况
db.serverStatus().wiredTiger.cache

// 输出示例
{
  "tracked dirty pages in the cache": 123,
  "pages currently held in the cache": 4567,
  "total page size in cache": "789MB",
  "maximum bytes configured": "10GB",
  "percentage of maximum bytes used": "7.8%"
}
```

### 内存配置建议

```javascript
// 配置 WiredTiger Cache 大小（命令行启动）
mongod --wiredTigerCacheSizeGB=8

// 或在配置文件
storage:
  wiredTiger:
    engineConfig:
      cacheSizeGB: 8
```

> **经验法则**：WiredTiger Cache 设为机器内存的 50-60%，其他给操作系统。

## 并发控制：MVCC

### 多版本并发控制

WiredTiger 使用 MVCC 实现并发读写：

```javascript
// 读操作：获取快照，读取一致的数据
// 写操作：创建新版本，不阻塞读操作

// 示例
Tx1: 读取文档 v1
Tx2: 更新文档 v1 → v2（不阻塞 Tx1）
Tx1: 继续读取 v1（不受 Tx2 影响）
Tx1: 提交
Tx2: 提交
```

### 文档级锁

```javascript
// WiredTiger 支持文档级锁
// 不同文档的写入可以并发

// 锁粒度对比：
// MMAPv1: 集合级锁
// WiredTiger: 文档级锁

// 批量写入优化
// 无序写入可以并发处理
db.orders.insertMany(docs, {ordered: false})
```

## 索引结构

### B+Tree 索引

```javascript
// WiredTiger 默认使用 B+Tree 索引
db.users.createIndex({email: 1})

// B+Tree 特点：
// - 所有数据在叶子节点
// - 叶子节点链表连接
// - 范围查询高效
```

### 索引与数据文件的关系

```
┌──────────────────────────────────────────────────────────────┐
│                       索引文件                                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ email: "a@test.com"  →  Point to Page 5               │ │
│  │ email: "b@test.com"  →  Point to Page 3              │ │
│  │ email: "c@test.com"  →  Point to Page 7              │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                           │
                           │ 指向
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                       数据文件                                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Page 3: {_id: "b", email: "b@test.com", ...}         │ │
│  │ Page 5: {_id: "a", email: "a@test.com", ...}         │ │
│  │ Page 7: {_id: "c", email: "c@test.com", ...}         │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

## Checkpoint（检查点）

### Checkpoint 机制

Checkpoint 是数据一致性的保证：

```javascript
// 默认每 60 秒创建一个检查点
// 检查点将所有脏页刷盘

// Checkpoint 过程：
// 1. 获取所有脏页列表
// 2. 刷盘所有脏页
// 3. 记录检查点位置（Journal）
// 4. 允许从该位置恢复

// 查看检查点信息
db.serverStatus().wiredTiger.checkpoint
```

### Checkpoint 配置

```javascript
// 配置文件
storage:
  wiredTiger:
    engineConfig:
      journalCompressor: snappy
    checkpoint:
      (1) wait: 60        # 等待时间（秒）
      (2) scopy: true      # 快照时复制
```

## 压缩

### 压缩算法

| 算法 | 压缩率 | CPU 开销 | 适用场景 |
|-----|-------|---------|---------|
| snappy | 中等 | 低 | 默认，推荐 |
| zlib | 高 | 中 | 存储敏感 |
| zstd | 高 | 低 | MongoDB 4.2+ |
| none | 无 | 无 | 高性能需求 |

### 压缩配置

```javascript
// 集合级别压缩
db.createCollection("logs", {
  storageEngine: {
    wiredTiger: {
      configString: "block_compressor=snappy"
    }
  }
})

// 索引压缩
db.users.createIndex(
  {email: 1},
  {storageEngine: {wiredTiger: {configString: "block_compressor=zlib"}}}
)

// 全局配置
storage:
  wiredTiger:
    engineConfig:
      directoryForIndexes: false
    collectionConfig:
      blockCompressor: snappy
    indexConfig:
      prefixCompression: true
```

## 空间回收

### WiredTiger 自动回收

```javascript
// WiredTiger 使用增量回收
// 不需要手动 compact

// 查看存储统计
db.stats()

// 输出
{
  "dataSize": "10GB",      // 数据大小（压缩前）
  "storageSize": "5GB",     // 磁盘占用（压缩后）
  "indexSize": "2GB",       // 索引大小
  "fileSize": "12GB"        // 文件总大小
}
```

### manual 回收（可选）

```javascript
// compact 命令可以回收空间
db.runCommand({compact: "collectionName"})

// 注意：
// 1. 需要额外磁盘空间
// 2. 会在副本集节点上执行
// 3. 会阻塞操作（建议在从节点执行）
```

## Java 监控 WiredTiger

```java
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import org.bson.Document;

public class WiredTigerMonitor {
    public static void main(String[] args) {
        try (MongoClient client = MongoClients.create()) {
            // 获取 WiredTiger 缓存统计
            Document cache = client.getDatabase("admin")
                .runCommand(new Document("serverStatus", 1))
                .get("wiredTiger", Document.class)
                .get("cache", Document.class);

            long maxCacheSize = cache.getLong("maximum bytes configured");
            long usedCacheSize = cache.getLong("size in memory");

            System.out.println("Cache 最大: " + (maxCacheSize / 1024 / 1024 / 1024) + " GB");
            System.out.println("Cache 使用: " + (usedCacheSize / 1024 / 1024 / 1024) + " GB");

            // 获取事务统计
            Document txn = cache.get("transaction", Document.class);
            System.out.println("当前活跃事务: " + txn.get("transaction_thread count"));
        }
    }
}
```

## 总结

WiredTiger 核心特性：

| 特性 | 说明 |
|-----|------|
| B+Tree | 默认索引结构 |
| MVCC | 多版本并发控制，文档级锁 |
| WAL | 先写日志再写数据，保证持久性 |
| Cache | 默认 50% RAM，减少磁盘 I/O |
| 压缩 | snappy/zlib/zstd，减少存储 |
| Checkpoint | 定期刷盘，保证一致性 |

**关键配置参数**：

| 参数 | 默认值 | 说明 |
|-----|-------|------|
| `cacheSizeGB` | 50% RAM | WiredTiger Cache 大小 |
| `journalCompressor` | snappy | Journal 压缩算法 |
| `blockCompressor` | snappy | 数据压缩算法 |
| `checkpoint.wait` | 60 秒 | 检查点间隔 |

---

**下一步，你可以：**

- 了解 [MongoDB 压缩机制](/database/mongodb/compression)
- 学习 [MongoDB 内存管理](/database/mongodb/memory)
- 掌握 [MongoDB Journal 日志与崩溃恢复](/database/mongodb/journal)
