# MongoDB 性能监控：mongostat、mongotop、Profiler

MongoDB 跑得怎么样？有没有慢查询？内存够不够？

这一篇，我来介绍 MongoDB 的监控工具。

## MongoDB 监控工具概览

| 工具 | 用途 | 实时性 |
|-----|------|-------|
| `mongostat` | 查看数据库操作统计 | 实时 |
| `mongotop` | 查看集合级别的读写时间 | 实时 |
| Profiler | 记录慢查询 | 可配置 |
| `serverStatus` | 服务器状态统计 | 实时 |
| `db.stats()` | 数据库统计信息 | 静态 |
| `coll.stats()` | 集合统计信息 | 静态 |

## mongostat：操作统计

### 基本用法

```bash
# 每秒刷新一次
mongostat --port 27017

# 每 5 秒刷新一次，显示 3 次
mongostat --port 27017 5 3

# 显示详细信息
mongostat --port 27017 --humanReadable
```

### 输出解读

```bash
# mongostat 输出示例
insert  query update delete getmore command % idx miss    flushes  vsize   res qrw  arw
*0     *0    *0    *0     0     2|0  0         0       0  1.42GB 1.13GB q0 r0 0|0
10     50    20     5     0    100|0  0         0       0  1.45GB 1.15GB q0 r0 0|0
```

| 字段 | 说明 |
|-----|------|
| `insert` | 每秒插入数 |
| `query` | 每秒查询数 |
| `update` | 每秒更新数 |
| `delete` | 每秒删除数 |
| `getmore` | 每秒获取更多游标数 |
| `command` | 每秒命令数 |
| `% idx miss` | 索引未命中率 |
| `flushes` | 每秒刷盘次数（Journal） |
| `vsize` | 虚拟内存使用 |
| `res` | 实际内存使用 |
| `qrw` | 读写队列长度 |
| `arw` | 主从读写队列 |

### mongostat 常用参数

```bash
# 只看特定字段
mongostat --port 27017 --discover --humanReadable insert query update

# 查看副本集所有成员
mongostat --host rs0/mongo1:27017,mongo2:27017,mongo3:27017

# 查看特定数据库
mongostat --port 27017 --dynamicCollectionNames
```

## mongotop：集合读写时间

### 基本用法

```bash
# 每秒刷新一次
mongotop --port 27017

# 每 3 秒刷新一次
mongotop 3

# 只显示写入
mongotop --port 27017 --locks
```

### 输出解读

```bash
# mongotop 输出示例
                        ns    total    read    write
              admin.$cmd    0ms     0ms      0ms
            myapp.orders 1234ms   100ms   1134ms
              myapp.users  200ms   200ms      0ms
           myapp.products   50ms    30ms     20ms
```

| 字段 | 说明 |
|-----|------|
| `ns` | 命名空间（数据库.集合） |
| `total` | 该集合总读写时间 |
| `read` | 读取时间 |
| `write` | 写入时间 |

## serverStatus：服务器状态

### 基本用法

```javascript
// 查看完整状态
db.adminCommand({serverStatus: 1})

// 只看特定部分
db.adminCommand({serverStatus: 1}).connections
db.adminCommand({serverStatus: 1}).mem
db.adminCommand({serverStatus: 1}).wiredTiger
```

### 关键指标

```javascript
// 1. 连接数
db.adminCommand({serverStatus: 1}).connections

// 输出
{
  "current": 100,        // 当前连接
  "available": 9900,    // 可用连接
  "totalCreated": 50000  // 历史总连接
}

// 2. 内存使用
db.adminCommand({serverStatus: 1}).mem

// 输出
{
  "bits": 64,
  "resident": "2GB",    // 实际占用
  "virtual": "10GB",    // 虚拟内存
  "supported": true
}

// 3. WiredTiger Cache
db.adminCommand({serverStatus: 1}).wiredTiger.cache

// 输出
{
  "maximum bytes configured": "8GB",
  "size in memory": "5GB",
  "percentage of maximum bytes used": "62.5%"
}
```

## Profiler：慢查询分析

### 开启 Profiler

```javascript
// 查看当前配置
db.getProfilingStatus()

// { "was": 0, "slowms": 100, "sampleRate": 1 }

// 开启 Profiler（记录慢查询）
db.setProfilingLevel(1, {slowms: 100})

// 开启 Profiler（记录所有查询）
db.setProfilingLevel(2)

// 参数说明：
// was: 0 - 关闭
// was: 1 - 只记录慢操作
// was: 2 - 记录所有操作

// slowms: 慢查询阈值（毫秒）
// sampleRate: 采样率（0.0 - 1.0）
```

### 查看 Profiler 数据

```javascript
// 查看最近的慢查询
db.system.profile.find().sort({millis: -1}).limit(10).pretty()

// 输出示例
{
  "op": "query",           // 操作类型
  "ns": "myapp.orders",   // 命名空间
  "command": {
    "find": "orders",
    "filter": {"userId": "123"},
    "limit": 10
  },
  "nreturned": 10,
  "responseLength": 1024,
  "millis": 1234,         // 执行时间（毫秒）
  "ts": ISODate("..."),
  "client": "192.168.1.100",
  "user": "app_user"
}
```

### Profiler 操作类型

| op | 说明 | 示例 |
|----|------|------|
| `query` | 查询 | `db.orders.find()` |
| `insert` | 插入 | `db.orders.insertOne()` |
| `update` | 更新 | `db.orders.updateOne()` |
| `delete` | 删除 | `db.orders.deleteOne()` |
| `command` | 命令 | `db.adminCommand()` |
| `getmore` | 游标获取 | 翻页 |

## dbStats 和 collStats

### dbStats：数据库统计

```javascript
// 查看数据库统计
db.stats()

// 输出
{
  "db": "myapp",
  "collections": 10,
  "views": 2,
  "objects": 1000000,          // 文档总数
  "avgObjSize": 1024,         // 平均文档大小
  "dataSize": "1GB",          // 数据大小
  "storageSize": "2GB",       // 磁盘占用
  "indexes": 25,              // 索引数
  "indexSize": "500MB",       // 索引大小
  "totalSize": "2.5GB",       // 总大小
  "scaleFactor": 1
}
```

### collStats：集合统计

```javascript
// 查看集合统计
db.orders.stats()

// 输出
{
  "ns": "myapp.orders",
  "count": 1000000,
  "size": "500MB",
  "avgObjSize": 512,
  "numOrphanDocs": 0,
  "storageSize": "600MB",
  "capped": false,
  "wiredTiger": {
    "metadata": {...},
    "compression": "snappy",
    "block signature": "snappy"
  },
  "indexDetails": {...},
  "indexSizes": {
    "_id_": "100MB",
    "userId_1": "80MB",
    "createdAt_1": "90MB"
  }
}
```

## 副本集监控

### 副本集状态

```javascript
// 查看副本集状态
rs.status()

// 查看同步状态
rs.printSecondaryReplicationInfo()

// 查看 Oplog 状态
db.getReplicationInfo()

// 输出
{
  "logSizeMB": 10240,
  "usedMB": 2048,
  "timeDiff": 3600,
  "tFirst": "2024-01-01T00:00:00",
  "tLast": "2024-01-01T01:00:00"
}
```

### 监控复制延迟

```javascript
// 查看每个从节点的延迟
db.adminCommand({replSetGetStatus: 1}).members.forEach(m => {
  if (m.stateStr !== "PRIMARY") {
    const lag = (new Date() - m.optimeDate) / 1000
    print(m.name + ": " + lag + " 秒延迟")
  }
})
```

## Java 监控实现

```java
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import org.bson.Document;
import java.util.concurrent.atomic.AtomicReference;

public class MongoMonitor {
    public static void main(String[] args) {
        try (MongoClient client = MongoClients.create()) {
            var admin = client.getDatabase("admin");

            // 1. serverStatus
            Document status = admin.runCommand(new Document("serverStatus", 1));
            System.out.println("=== Server Status ===");
            System.out.println("连接数: " + status.get("connections"));
            System.out.println("内存: " + status.get("mem"));
            System.out.println("WiredTiger: " + status.get("wiredTiger"));

            // 2. collStats
            var collStats = client.getDatabase("myapp")
                .runCommand(new Document("collStats", "orders"));
            System.out.println("=== Orders Collection ===");
            System.out.println("文档数: " + collStats.get("count"));
            System.out.println("大小: " + collStats.get("size"));

            // 3. Profiler
            admin.runCommand(new Document("setParameter", 1)
                .append(" profiler", 2));

            // 4. 副本集状态
            var replStatus = admin.runCommand(new Document("replSetGetStatus", 1));
            System.out.println("=== Replication ===");
            replStatus.getList("members", Document.class).forEach(m -> {
                System.out.println(m.get("name") + ": " + m.get("stateStr"));
            });
        }
    }
}
```

## 监控脚本示例

```javascript
// MongoDB Shell 监控脚本

// 1. 慢查询检查
function checkSlowQueries() {
  const queries = db.system.profile.find(
    {millis: {$gt: 1000}}
  ).sort({millis: -1}).limit(5)

  print("=== Slow Queries (> 1s) ===")
  queries.forEach(q => {
    print(q.ns + ": " + q.millis + "ms")
    print("Command: " + q.command)
  })
}

// 2. Cache 使用检查
function checkCache() {
  const cache = db.adminCommand({serverStatus: 1}).wiredTiger.cache
  const usage = cache.size in memory / cache.maximum bytes configured * 100

  print("=== WiredTiger Cache ===")
  print("使用率: " + usage + "%")

  if (usage > 80) {
    print("警告：Cache 使用率过高！")
  }
}

// 3. 副本延迟检查
function checkReplicationLag() {
  const status = rs.status()
  const primary = status.members.find(m => m.stateStr === "PRIMARY")

  print("=== Replication Lag ===")
  status.members.forEach(m => {
    if (m.stateStr !== "PRIMARY") {
      const lag = primary.optimeDate - m.optimeDate
      print(m.name + ": " + lag + "ms")
    }
  })
}

// 定期执行
checkSlowQueries()
checkCache()
checkReplicationLag()
```

## 总结

监控工具速查：

| 工具 | 命令 | 用途 |
|-----|------|------|
| mongostat | `mongostat --port 27017` | 操作统计 |
| mongotop | `mongotop --port 27017` | 集合读写时间 |
| serverStatus | `db.adminCommand({serverStatus: 1})` | 服务器状态 |
| Profiler | `db.setProfilingLevel(1, {slowms: 100})` | 慢查询分析 |
| collStats | `db.collection.stats()` | 集合统计 |
| dbStats | `db.stats()` | 数据库统计 |

**核心监控指标**：

| 类别 | 指标 | 告警阈值 |
|-----|------|---------|
| 连接 | 当前连接数 | > 80% 可用 |
| 内存 | Cache 使用率 | > 80% |
| 查询 | 慢查询数 | 持续存在 |
| 复制 | 从节点延迟 | > 30 秒 |

---

**下一步，你可以：**

- 掌握 [MongoDB 常见性能瓶颈与优化思路](/database/mongodb/performance)
- 学习 [MongoDB Spring Data MongoDB 集成](/database/mongodb/spring-data)
- 了解 [MongoDB 数据备份与恢复](/database/mongodb/backup)
