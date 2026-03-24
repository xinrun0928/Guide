# MongoDB 压缩机制：snappy、zstd、zlib

MongoDB 的 WiredTiger 存储引擎内置了强大的压缩功能，可以显著减少存储空间。

这一篇，我们来详细了解 MongoDB 的压缩机制。

## 为什么需要压缩？

| 指标 | 无压缩 | 有压缩 | 节省 |
|-----|-------|--------|------|
| 存储空间 | 100 GB | 30-40 GB | 60-70% |
| 磁盘 I/O | 高 | 低 | - |
| 网络传输 | 多 | 少 | - |
| CPU 开销 | 低 | 略高 | - |

> **结论**：压缩用少量 CPU 换大量磁盘空间和 I/O，通常是划算的。

## WiredTiger 压缩架构

```
┌──────────────────────────────────────────────────────────────┐
│                    MongoDB 数据存储                            │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              WiredTiger Storage Engine                   │  │
│  │                                                           │  │
│  │  ┌──────────────────────┐   ┌──────────────────────┐    │  │
│  │  │    Collection       │   │       Index          │    │  │
│  │  │   数据压缩           │   │   前缀压缩            │    │  │
│  │  │  snappy/zlib/zstd   │   │   (默认开启)          │    │  │
│  │  └──────────────────────┘   └──────────────────────┘    │  │
│  │                         │                               │  │
│  │              ┌──────────┴──────────┐                   │  │
│  │              │     Journal         │                   │  │
│  │              │    日志压缩          │                   │  │
│  │              │  snappy(默认)       │                   │  │
│  │              └─────────────────────┘                   │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## 压缩算法对比

| 算法 | 压缩率 | CPU 开销 | 压缩速度 | MongoDB 支持 |
|-----|-------|---------|---------|-------------|
| **snappy** | 中等（60-70%） | 低 | 快 | 默认 |
| **zlib** | 高（70-80%） | 中 | 中 | 是 |
| **zstd** | 高（70-80%） | 低-中 | 快-中 | MongoDB 4.2+ |
| **none** | 0% | 无 | 无 | 是 |

## snappy 算法

### 特点

- Google 开发
- 专为速度设计
- 压缩率适中
- CPU 开销低
- **MongoDB 默认压缩算法**

### 适用场景

```javascript
// 默认配置（使用 snappy）
// 适合大多数场景
// 平衡了压缩率和性能
```

## zlib 算法

### 特点

- 经典压缩算法
- 压缩率高
- CPU 开销较大
- 速度较慢

### 适用场景

```javascript
// 存储敏感数据、空间紧张的场景

// 配置集合使用 zlib
db.createCollection("sensitiveData", {
  storageEngine: {
    wiredTiger: {
      configString: "block_compressor=zlib"
    }
  }
})
```

### zlib 压缩级别

```javascript
// zlib 压缩级别（1-9，默认为 6）
// 级别越高，压缩率越高，CPU 开销越大

storage:
  wiredTiger:
    collectionConfig:
      blockCompressor:
        class: zlib
        config: compression_level=9
```

## zstd 算法（MongoDB 4.2+）

### 特点

- Facebook 开发
- 高压缩率 + 低 CPU 开销
- 可调节压缩级别
- **MongoDB 4.2+ 推荐使用**

### 适用场景

```javascript
// 高性能 + 高压缩率
// 大数据量场景
// 希望替代 snappy 的首选

// 配置集合使用 zstd
db.createCollection("logs", {
  storageEngine: {
    wiredTiger: {
      configString: "block_compressor=zstd"
    }
  }
})

// 配置索引使用 zstd
db.users.createIndex(
  {email: 1},
  {storageEngine: {wiredTiger: {configString: "block_compressor=zstd"}}}
)
```

### zstd 压缩级别

```javascript
// zstd 压缩级别（1-22，默认 1）
// 级别越高，压缩率越高，CPU 开销越大

// 高压缩率场景
storage:
  wiredTiger:
    collectionConfig:
      blockCompressor:
        class: zstd
        config: compression_level=19
```

## 索引前缀压缩

### 什么是前缀压缩？

索引中，相邻条目如果有相同前缀，只存储一次：

```javascript
// 未压缩的索引
{email: "a@test.com"}
{email: "b@test.com"}
{email: "c@test.com"}

// 前缀压缩后
{a@test.com}      // 完整值
{,b@test.com}      // 只存储差异部分
{,c@test.com}

// 可以节省 30-50% 的索引空间
```

### 前缀压缩配置

```javascript
// 默认开启前缀压缩
// 可以关闭（对于随机字符串索引可能无效）

db.users.createIndex(
  {randomToken: 1},
  {
    storageEngine: {
      wiredTiger: {
        configString: "prefix_compression=false"
      }
    }
  }
)
```

## Journal 日志压缩

### Journal 压缩

```javascript
// Journal 默认使用 snappy 压缩
// 可以配置不同的压缩算法

storage:
  wiredTiger:
    engineConfig:
      journalCompressor: snappy  # snappy/zlib/zstd/none
```

### Journal 压缩效果

```javascript
// 查看 Journal 大小
db.serverStatus().durability

// Journal 文件位置
// <dbpath>/journal/WiredTigerLog.*.*

// 未压缩：可能达到数 GB
// snappy 压缩：通常减少 50-60%
```

## 压缩配置位置

### 1. 集合级别压缩

```javascript
// 创建集合时指定压缩算法
db.createCollection("logs", {
  storageEngine: {
    wiredTiger: {
      configString: "block_compressor=zstd"
    }
  }
})

// 修改集合压缩算法（重建集合）
db.adminCommand({
  collMod: "logs",
  storageEngine: {
    wiredTiger: {
      configString: "block_compressor=snappy"
    }
  }
})
```

### 2. 索引级别压缩

```javascript
// 创建索引时指定压缩算法
db.users.createIndex(
  {email: 1},
  {
    storageEngine: {
      wiredTiger: {
        configString: "block_compressor=zstd"
      }
    }
  }
)

// 注意：索引压缩不能独立于集合压缩
// 索引继承集合的压缩设置
```

### 3. 全局默认压缩

```javascript
// 配置文件 mongod.conf
storage:
  wiredTiger:
    engineConfig:
      journalCompressor: snappy
    collectionConfig:
      blockCompressor: snappy
    indexConfig:
      prefixCompression: true
```

### 4. 运行时调整

```javascript
// 通过 collMod 命令修改集合参数
db.adminCommand({
  collMod: "myCollection",
  validationLevel: "moderate"
})

// 实际修改压缩算法需要重建集合
db.adminCommand({cloneCollectionAsCapped: "myCollection", toCollection: "tmp_collection", size: 1024 * 1024 * 1024})
```

## 压缩对性能的影响

### CPU 开销

```
压缩算法     CPU 开销
none        最少
snappy      低
zstd        低-中
zlib        中-高
```

### I/O 优化

```javascript
// 压缩带来的 I/O 优化：
// 1. 读取：从磁盘读取压缩数据，解压后使用
//    压缩率高 → 读取 I/O 减少 → 读取性能提升

// 2. 写入：压缩数据后写入磁盘
//    压缩率高 → 写入 I/O 减少 → 写入性能提升

// 3. 内存：压缩数据存储在 WiredTiger Cache
//    压缩率高 → Cache 中存储更多数据 → Cache 命中率提升
```

## 监控压缩效果

### 查看压缩统计

```javascript
// 查看集合压缩信息
db.collection.stats().wiredTiger

// 输出示例
{
  "compression": {
    "compressed pages": 12345,
    "compressed page size": "15MB",
    "uncompressed page size": "45MB",
    "compression ratio": 0.33  // 压缩率 33%
  }
}
```

### 查看全局压缩统计

```javascript
// 查看 WiredTiger 压缩统计
db.serverStatus().wiredTiger['block-manager']

// 输出示例
{
  "file bytes read (fastpath)": "100MB",
  "file bytes read (cache)": "500MB",
  "file bytes written": "200MB",
  "page written to cache": "300MB"
}
```

## Java 配置压缩

```java
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;

public class CompressionConfig {
    public static void main(String[] args) {
        // 通过连接字符串配置
        // 注意：MongoDB Java Driver 本身不控制压缩
        // 压缩是在服务端 WiredTiger 引擎处理的

        // 但可以通过 Admin 命令查看压缩配置
        try (MongoClient client = MongoClients.create("mongodb://localhost:27017")) {
            // 获取集合统计
            var stats = client.getDatabase("myapp")
                .getCollection("orders")
                .aggregate(java.util.List.of(
                    new org.bson.Document("$collStats",
                        new org.bson.Document("storageStats", new org.bson.Document()))
                ))
                .first();

            System.out.println("压缩统计: " + stats);
        }
    }
}
```

## 最佳实践

### 选择压缩算法

| 场景 | 推荐算法 | 原因 |
|-----|---------|------|
| 通用场景 | snappy | 默认，平衡性能 |
| 大数据量 | zstd | 高压缩率 + 低 CPU |
| 空间极度紧张 | zlib | 最高压缩率 |
| 高性能写入 | none | 无压缩开销 |
| 索引 | 前缀压缩（默认） | 自动优化 |

### 混合压缩策略

```javascript
// 热数据（频繁访问）：snappy
// 冷数据（归档）：zstd
// 索引：前缀压缩

// 通过集合分离实现
db.createCollection("hot_data", {
  storageEngine: {
    wiredTiger: {
      configString: "block_compressor=snappy"
    }
  }
})

db.createCollection("cold_data", {
  storageEngine: {
    wiredTiger: {
      configString: "block_compressor=zstd"
    }
  }
})
```

## 总结

压缩配置速查：

| 配置位置 | 配置项 | 可选值 |
|---------|-------|-------|
| 全局 | `blockCompressor` | snappy/zlib/zstd/none |
| 全局 | `journalCompressor` | snappy/zlib/zstd/none |
| 索引 | `prefixCompression` | true/false |
| 集合 | `block_compressor` | snappy/zlib/zstd/none |

**选择建议**：
- **默认**：使用 snappy
- **追求性能**：zstd（MongoDB 4.2+）
- **极致压缩**：zlib
- **最高性能**：none

---

**下一步，你可以：**

- 学习 [MongoDB 内存管理：WiredTiger Cache 与内存配置](/database/mongodb/memory)
- 了解 [MongoDB Journal 日志与崩溃恢复](/database/mongodb/journal)
- 掌握 [MongoDB 性能监控](/database/mongodb/monitor)
