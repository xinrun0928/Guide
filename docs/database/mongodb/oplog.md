# Replica Set 副本集同步原理：oplog 同步

上一篇文章讲了副本集的基本架构，这一篇我们来深入理解数据同步的原理——oplog 是如何工作的。

## oplog 是什么？

oplog（Operations Log）是副本集中的**操作日志**，类似于 MySQL 的 binlog。它记录了主节点上所有的写操作，从节点通过重放 oplog 来实现数据同步。

```
┌─────────────────────────────────────────────────────────────┐
│                         Primary                             │
│  ┌─────────────┐                                            │
│  │   oplog     │  记录所有写操作                             │
│  │ (local.oplog.rs) │                                       │
│  └─────────────┘                                            │
│         │                                                    │
│         │  同步                                              │
│         ▼                                                    │
│  ┌─────────────┐    ┌─────────────┐                        │
│  │ Secondary   │    │ Secondary   │                        │
│  │  重放 oplog  │───▶│  重放 oplog  │                        │
│  └─────────────┘    └─────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

## oplog 集合

### 存储位置

```javascript
// oplog 存储在 local 数据库中
use local

// 查看 oplog
db.oplog.rs.find().sort({ts: -1}).limit(5)

// oplog 是一个固定集合（Capped Collection）
db.oplog.rs.stats()
// capped: true, size: 约 5% 磁盘空间
```

### oplog 文档结构

```javascript
{
  "ts": Timestamp(1700000000, 1),    // 时间戳（逻辑时间）
  "t": NumberLong(5),              // 任期（选举代数）
  "h": NumberLong("1234567890"),  // 操作的哈希值
  "v": NumberLong(2),             // oplog 版本
  "op": "u",                      // 操作类型
  "ns": "myapp.orders",           // 命名空间（集合）
  "ui": UUID("..."),              // 事务 ID（如果操作在事务中）
  "o": {                          // 操作文档
    "$set": {"status": "shipped"}}
  },
  "o2": {_id: ObjectId("...")}    // 查询文档
}
```

### oplog 操作类型

| op | 操作 | 说明 |
|----|------|------|
| `i` | insert | 插入 |
| `u` | update | 更新 |
| `d` | delete | 删除 |
| `c` | command | 命令（如 createIndex） |
| `n` | noop | 空操作（心跳/心跳填充） |

## oplog 同步过程

### 1. 初始同步（Initial Sync）

当一个新节点加入副本集或节点数据损坏时，会进行初始同步：

```javascript
// 初始同步过程
1. 选择一个源节点（主节点或其他同步节点）
2. 复制所有数据库数据
3. 重放在复制期间产生的 oplog
4. 建立索引
5. 切换为从节点
```

```javascript
// 手动触发初始同步（从节点上执行）
db.adminCommand({resync: 1})
```

### 2. 增量同步（Tail oplog）

初始同步完成后，从节点持续监听 oplog 的变化并重放：

```javascript
// 从节点持续执行
while (true) {
  // 1. 获取本地最后应用的 oplog 位置
  const localOplog = db.getSiblingDB("local").oplog.rs
  const lastOpTime = getLastOpTime()

  // 2. 从源节点获取增量 oplog
  const oplogTail = sourceNode.oplog.find({
    ts: {$gt: lastOpTime}
  })

  // 3. 重放每个操作
  for (op of oplogTail) {
    applyOperation(op)
    saveCheckpoint(op.ts)
  }
}
```

### 3. oplog 批量重放优化

```javascript
// MongoDB 会批量重放 oplog 提高效率
// 可以通过设置 oplogBatchSize 调整批次大小
db.adminCommand({
  setParameter: 1,
  oplogBatchSize: 500
})
```

## oplog 大小

### 默认大小

| 配置 | 平台 | 默认大小 |
|-----|------|---------|
| 64 位 | Linux | 磁盘空间的 5%（最大 50GB） |
| 64 位 | macOS/Windows | 192 MB |
| 32 位 | 所有平台 | 192 MB |

### oplog 大小计算

```javascript
// 计算 oplog 大小的公式
// oplog_size = (write_rate * time_window) / (1 - overhead)

// write_rate: 每秒写入量
// time_window: 期望覆盖的时间窗口（建议至少 24 小时）
// overhead: oplog 的额外开销（约 5%）

// 示例
// 每秒 1000 次写入，每次写入平均 200 字节
// 期望覆盖 24 小时
// oplog_size = 1000 * 200 * 86400 / 0.95 ≈ 17.3 GB
```

### 修改 oplog 大小

```javascript
// 创建 oplog（副本集初始化时）
rs.initiate({
  _id: "myReplSet",
  members: [
    {_id: 0, host: "mongo1:27017"},
    {_id: 1, host: "mongo2:27017"},
    {_id: 2, host: "mongo3:27017"}
  ],
  settings: {
    oplogSizeMB: 10240  // 10 GB
  }
})

// 如果副本集已存在，需要重新创建 oplog
use admin
db.adminCommand({replSetResizeOplog: 1, size: 10240})
```

## oplog 常见问题

### 问题 1：oplog 不够大导致同步失败

```javascript
// 症状：从节点持续报错 "oplogReplay - old log"
db.getSiblingDB("local").oplog.rs.find().sort({ts: -1}).limit(1)

// 解决方案
// 1. 增加 oplog 大小
db.adminCommand({replSetResizeOplog: 1, size: 20480})

// 2. 加快从节点性能
// 3. 减少主节点写入量
```

### 问题 2：从节点严重滞后

```javascript
// 查看从节点状态
db.getReplicationInfo()

// 输出示例
{
  "logSizeMB": 10240,
  "usedMB": 2048,
  "timeDiff": 3600,
  "timeDiffHours": 0.04,
  "tFirst": "2024-01-01T00:00:00",
  "tLast": "2024-01-01T00:00:00",
  "now": "2024-01-01T00:00:00"
}

// timeDiff 为 0 说明从节点已追上主节点
```

### 问题 3：oplog 格式变化

```javascript
// oplog 版本
// v1: MongoDB 3.0 之前
// v2: MongoDB 3.0+，包含 txn 字段

// 检查 oplog 版本
db.getSiblingDB("local").oplog.rs.findOne().v
```

## 同步延迟

### 查看同步延迟

```javascript
// 查看每个从节点的延迟
db.getSiblingDB("admin").runCommand({replSetGetStatus: 1}).members
// 每个成员的 "optimeDate" 和主节点的 "optimeDate" 差值即为延迟

// 自动化脚本检查延迟
function checkSyncLag() {
  const status = rs.status()
  const primary = status.members.find(m => m.stateStr === "PRIMARY")

  status.members.forEach(m => {
    if (m.stateStr !== "PRIMARY") {
      const lagMs = primary.optimeDate - m.optimeDate
      const lagSec = lagMs / 1000
      print(`${m.name}: ${lagSec} 秒延迟`)

      if (lagSec > 300) {  // 超过 5 分钟
        print("警告：同步延迟过大！")
      }
    }
  })
}
```

### 减少同步延迟

| 方法 | 说明 |
|-----|------|
| 减少写入量 | 合并写入、减少索引 |
| 提升网络 | 减少主从之间网络延迟 |
| 提升从节点性能 | 增加 CPU/内存、使用 SSD |
| 增加 oplog 大小 | 给从节点更多追赶时间 |

## 多源同步（MongoDB 3.0+）

MongoDB 从节点支持从多个源同步数据：

```javascript
// 配置多源同步（从多个副本集同步）
db.adminCommand({
  replSetSyncFrom: "sourceNode:27017"
})

// 查看当前同步源
db.adminCommand({replSetGetStatus: 1}).syncSource

// 切换同步源
db.adminCommand({
  replSetSyncFrom: "newSourceNode:27017"
})
```

## Java 监控 oplog

```java
import com.mongodb.client.MongoCollection;
import com.mongodb.client.model.Filters;
import org.bson.Document;
import java.util.Date;

public class OplogMonitor {
    public static void main(String[] args) {
        MongoCollection&lt;Document&gt; oplog = client
            .getDatabase("local")
            .getCollection("oplog.rs");

        // 获取最新的 oplog 条目
        Document latest = oplog.find()
            .sort(new Document("$natural", -1))
            .first();

        System.out.println("最新 oplog 时间戳: " + latest.get("ts"));

        // 获取指定时间之后的 oplog
        Date since = new Date(System.currentTimeMillis() - 60000);
        for (Document op : oplog.find(
                Filters.gt("ts", new org.bson.types.Timestamp(since.getTime() / 1000, 0))
            )) {
            System.out.println("操作: " + op.getString("op"));
        }
    }
}
```

## oplog 备份与恢复

### 备份 oplog

```bash
# 使用 mongodump 备份 oplog
mongodump --db=local --collection=oplog.rs --out=/backup/oplog
```

### 恢复到指定时间点

```javascript
// 使用 oplog 进行时间点恢复
// 1. 恢复最近的全量备份
mongorestore --drop /backup/full

// 2. 应用 oplog 到指定时间点
mongorestore --db=local --collection=oplog.rs \
  --oplogReplay \
  --oplogLimit="2024-01-15T10:30:00"
```

## 总结

oplog 同步核心要点：

| 概念 | 说明 |
|-----|------|
| oplog | 操作日志，记录主节点所有写操作 |
| 初始同步 | 新节点从源节点复制全部数据 |
| 增量同步 | 从节点持续监听并重放 oplog |
| oplog 大小 | 建议覆盖 24-48 小时的操作 |

**关键指标**：
- `ts`：逻辑时间戳
- `t`：选举代数
- `timeDiff`：与主节点的时间差

**问题排查**：
- 同步延迟过大 → 检查网络、性能、增加 oplog
- oplog 不够大 → 增大 oplogSizeMB

---

**下一步，你可以：**

- 学习 [MongoDB Sharded Cluster 分片集群架构](/database/mongodb/sharded-cluster)
- 了解 [MongoDB 分片策略：范围分片 vs 哈希分片](/database/mongodb/sharding-strategy)
- 掌握 [MongoDB 分片键选择原则与常见错误](/database/mongodb/shard-key)
