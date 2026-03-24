# MongoDB 内存管理：WiredTiger Cache 与内存配置

MongoDB 占用的内存主要在哪里？如何配置才能既高效又不会把机器吃满？

这一篇，我们来深入了解 MongoDB 的内存管理机制。

## MongoDB 内存使用分布

```
┌──────────────────────────────────────────────────────────────┐
│                     机器总内存                                  │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │            WiredTiger Cache (50-60% RAM)               │ │
│  │  ┌────────────────────────────────────────────────────┐│ │
│  │  │  Data Pages (热点数据)                                ││ │
│  │  │  索引数据                                            ││ │
│  │  └────────────────────────────────────────────────────┘│ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │            MongoDB 内部结构 (~1-2 GB)                    │ │
│  │  连接、缓存、索引元数据                                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │            连接与线程栈 (~256KB/连接)                      │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │            操作系统预留 & 其他进程                         │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

## WiredTiger Cache

### Cache 作用

WiredTiger Cache 是 MongoDB 最主要的内存消耗者：

| 功能 | 说明 |
|-----|------|
| **缓存数据页** | 热点数据存储在内存，减少磁盘 I/O |
| **缓存索引页** | 索引数据 |
| **写入缓冲** | 批量写入，减少 I/O |
| **Checkpoint 缓冲** | 检查点刷盘前的数据 |

### Cache 大小配置

```javascript
// 默认：机器 RAM 的 50%
// 最小：256 MB
// 最大：不受限制（但不要超过机器 RAM）

// 命令行配置
mongod --wiredTigerCacheSizeGB=8

// 配置文件
storage:
  wiredTiger:
    engineConfig:
      cacheSizeGB: 8
```

### Cache 大小建议

| 机器内存 | 推荐 Cache 大小 | 说明 |
|---------|---------------|------|
| 8 GB | 4 GB (50%) | 标准配置 |
| 16 GB | 8 GB (50%) | 标准配置 |
| 32 GB | 16 GB (50%) | 标准配置 |
| 64 GB | 32 GB (50%) | 标准配置 |
| 128 GB+ | 50-60 GB | 不要用满，预留空间 |

> **经验法则**：WiredTiger Cache 设为机器内存的 50%，至少预留 1-2 GB 给操作系统和其他用途。

## Cache 淘汰机制

### WiredTiger EVICT

```javascript
// WiredTiger Cache 满了会触发 eviction（淘汰）
// 淘汰策略：最近最少使用（LRU）

// eviction 线程后台运行
// 当 dirty pages 超过阈值，会触发强制 eviction

// 查看 eviction 统计
db.serverStatus().wiredTiger.cache

// 输出示例
{
  "tracked dirty pages in the cache": 1234,
  "pages currently held in the cache": 50000,
  "total page size in cache": "5GB",
  "maximum bytes configured": "8GB",
  "percentage of maximum bytes used": "62.5%",
  "percentage of maximum bytes used for checkpoint": "50%"
}
```

### eviction 调优

```javascript
// 配置 eviction 行为
storage:
  wiredTiger:
    engineConfig:
      cacheSizeGB: 8
      journalCompressor: snappy
    collectionConfig:
      blockCompressor: snappy
      allocfract DEFAULT "cache_full_percent=80"
```

## 内存监控

### 查看 Cache 使用

```javascript
// 实时监控 Cache
db.serverStatus().wiredTiger.cache

// 查看脏页比例
db.serverStatus().wiredTiger.cache["pages read into cache"]
db.serverStatus().wiredTiger.cache["pages written from cache"]

// 查看 eviction 次数
db.serverStatus().wiredTiger.cache["pages evicted"]
```

### 诊断内存问题

```javascript
// 查看连接内存
db.serverStatus().connections

// 查看内存使用趋势
db.serverStatus().mem

// 输出
{
  "bits": 64,
  "resident": "2GB",      // MongoDB 实际占用
  "virtual": "10GB",      // 虚拟内存（含 mmap）
  "supported": true
}
```

### 告警规则

| 指标 | 告警阈值 | 说明 |
|-----|---------|------|
| Cache 使用率 | > 80% | 可能需要增加 Cache |
| dirty pages | > 30% | eviction 频繁 |
| eviction 次数 | 持续增长 | Cache 不够用 |
| 磁盘 I/O | 持续高 | Cache 命中率低 |

## 常见内存问题

### 问题 1：Cache 太小

```javascript
// 症状：
// - 磁盘 I/O 持续高
// - 读取性能差
// - Cache 命中率低

// 解决方案：
// 1. 增加 Cache 大小
// 2. 优化查询，减少数据访问
// 3. 增加索引
```

### 问题 2：Cache 太大

```javascript
// 症状：
// - MongoDB 占用内存接近机器总内存
// - 操作系统开始 swap
// - 系统不稳定

// 解决方案：
// 1. 减少 Cache 大小
// 2. 检查是否有内存泄漏
// 3. 添加更多内存
```

### 问题 3：内存碎片

```javascript
// 症状：
// - virtual memory 远大于 resident memory
// - MongoDB 报告内存不足，但实际有空闲

// 解决方案：
// 1. 重启 MongoDB
// 2. 避免大量小文档
// 3. 定期 compact（可选）
```

## 写入内存管理

### Journal vs Cache

```javascript
// Journal 写入流程：
// 1. 写入 Journal（先保证持久性）
// 2. 写入 WiredTiger Cache
// 3. Cache 中的 dirty pages 在 checkpoint 时刷盘

// Journal 大小
// 默认：数据文件大小的 1%（最小 1GB，最大 10GB）
```

### 批量写入优化

```javascript
// 批量写入减少 I/O
const batch = [];
for (let i = 0; i < 1000; i++) {
  batch.push({data: "..."});
}
db.collection.insertMany(batch, {ordered: false});

// unordered 写入可以并发处理
```

## 连接与线程内存

### 连接内存消耗

```javascript
// 每个连接占用约 256KB - 1MB
// 主要用于：
// - 连接缓冲区
// - 请求上下文
// - 线程栈

// 查看连接数
db.serverStatus().connections

// 输出
{
  "current": 100,        // 当前连接数
  "available": 9900,     // 可用连接数
  "totalCreated": 50000  // 历史总连接数
}
```

### 线程内存

```javascript
// MongoDB 使用线程池处理请求
// 每个线程约占用 256KB-1MB

// 查看线程数
db.serverStatus().metrics.thread
```

## Java 内存配置

```java
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import com.mongodb.ConnectionString;

public class MemoryConfig {
    public static void main(String[] args) {
        // MongoDB 内存配置在服务端
        // Java Driver 端主要配置连接池

        // 配置连接池大小
        MongoClientSettings settings = MongoClientSettings.builder()
            .applyConnectionString(
                new ConnectionString("mongodb://localhost:27017")
            )
            .applyToConnectionPoolSettings(builder ->
                builder.maxSize(100)           // 最大连接数
                    .minSize(10)                // 最小连接数
                    .maxWaitTime(5, TimeUnit.SECONDS)
            )
            .build();

        try (MongoClient client = MongoClients.create(settings)) {
            // 获取服务端状态
            var status = client.getDatabase("admin")
                .runCommand(new Document("serverStatus", 1));

            System.out.println("内存使用: " + status.get("mem"));
            System.out.println("WiredTiger Cache: " +
                status.get("wiredTiger",
                    org.bson.Document.class).get("cache",
                    org.bson.Document.class));
        }
    }
}
```

## 内存配置最佳实践

### 场景 1：专用 MongoDB 服务器

```yaml
# mongod.conf
storage:
  dbPath: /data/db
  wiredTiger:
    engineConfig:
      cacheSizeGB: 16      # 32GB 机器的 50%
      journalCompressor: snappy
    collectionConfig:
      blockCompressor: snappy
    indexConfig:
      prefixCompression: true
```

### 场景 2：MongoDB 与其他服务共部署

```yaml
# mongod.conf
storage:
  dbPath: /data/db
  wiredTiger:
    engineConfig:
      # 留更多给其他服务
      cacheSizeGB: 8       # 32GB 机器的 25%
```

### 场景 3：大数据量服务器

```yaml
# mongod.conf
storage:
  dbPath: /data/db
  wiredTiger:
    engineConfig:
      # 大内存机器可以使用更多 Cache
      cacheSizeGB: 64      # 128GB 机器的 50%
```

## 总结

MongoDB 内存使用速查：

| 组件 | 默认占用 | 说明 |
|-----|--------|------|
| WiredTiger Cache | 50% RAM | 数据和索引缓存 |
| MongoDB 内部 | 1-2 GB | 连接、线程、索引元数据 |
| 操作系统 | 1-2 GB | 文件系统缓存、系统预留 |

**监控指标**：
| 指标 | 说明 | 告警阈值 |
|-----|------|---------|
| Cache 使用率 | WiredTiger Cache 占用 | > 80% |
| dirty pages | 未刷盘的脏页 | > 30% |
| eviction | 页面淘汰次数 | 持续增长 |

**配置原则**：
- Cache 设为机器内存的 50%
- 预留 1-2 GB 给操作系统
- 监控实际使用情况调整

---

**下一步，你可以：**

- 了解 [MongoDB Journal 日志与崩溃恢复](/database/mongodb/journal)
- 学习 [MongoDB 性能监控](/database/mongodb/monitor)
- 掌握 [MongoDB 常见性能瓶颈与优化思路](/database/mongodb/performance)
