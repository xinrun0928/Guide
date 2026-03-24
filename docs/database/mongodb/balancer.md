# MongoDB 均衡器（Balancer）与 Chunk 迁移

分片集群中的数据不是一开始就能均匀分布的。随着数据增长，Chunk 会分裂、迁移，**均衡器（Balancer）** 就是负责这项工作的自动化工具。

## 什么是均衡器？

均衡器是运行在 Config Server Primary 节点上的后台进程，负责监控和调整 Chunk 在各分片间的分布，确保数据负载均衡。

```
┌─────────────────────────────────────────────────────────────┐
│                    Config Server                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                      Balancer                          │  │
│  │  监控 Chunk 分布 → 检测不均衡 → 执行迁移               │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                    Chunk 迁移命令
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
    ┌─────────┐          ┌─────────┐          ┌─────────┐
    │ Shard 1 │  ◀─────  │ Chunk   │  ──────▶ │ Shard 2 │
    │  3 个   │          │ 迁移    │          │  1 个   │
    └─────────┘          └─────────┘          └─────────┘
```

## Chunk 的概念

### Chunk 是什么？

Chunk 是 MongoDB 用于数据分片的基本单位：

| 属性 | 默认值 | 说明 |
|-----|-------|------|
| 大小 | 64 MB | 单个 Chunk 的最大容量 |
| 数量 | 无限制 | 按需分裂 |
| 范围 | 分片键值范围 | 包含一段连续的分片键值 |

```javascript
// 示例：按 userId 分片
sh.shardCollection("myapp.users", {userId: "hashed"})

// Config Server 中存储的 Chunk 信息
{
  _id: "myapp.users-userId_1234567890",
  ns: "myapp.users",
  min: {userId: NumberLong("-9223372036854775808")},
  max: {userId: NumberLong("-4611686018427387904")},
  shard: "shard0000",
  jumbo: false
}
```

### Chunk 分裂

当一个 Chunk 接近满（64 MB）时，会自动分裂：

```javascript
// Chunk 分裂过程
// Chunk [0-10] 满了
// 分裂为两个 Chunk：[0-5] 和 [5-10]
// 分裂是瞬间的，元数据更新
```

## 均衡器工作原理

### 均衡时机

| 触发条件 | 说明 |
|---------|------|
| Chunk 数量差异 | 最大分片 Chunk 数 > 最小分片 Chunk 数 + 迁移阈值 |
| 手动触发 | 管理员手动执行均衡 |
| 定时任务 | 均衡器周期性检查 |

### 迁移阈值

```javascript
// 迁移阈值根据分片数量计算
// 阈值 = Chunk 数量差异达到一定比例

// 示例：
// 3 个分片：允许最大差异 2 个 Chunk
// 5 个分片：允许最大差异 4 个 Chunk
// 10 个分片：允许最大差异 8 个 Chunk
```

### 迁移过程

```javascript
// Chunk 迁移的步骤：
// 1. Config Server 标记 Chunk 为迁移状态
// 2. 源分片开始复制数据到目标分片
// 3. 复制过程中，写入同时发往源和目标（2PC）
// 4. 复制完成，更新 Config Server 元数据
// 5. 删除源分片中的数据

// 迁移对应用透明，应用无感知
```

## 均衡器管理

### 查看均衡器状态

```javascript
// 查看均衡器是否启用
sh.getBalancerState()  // true/false

// 查看均衡器状态
sh.isBalancerRunning()

// 查看当前迁移状态
db.getSiblingDB("config").balancer.activeMoves.find().pretty()
```

### 启用/禁用均衡器

```javascript
// 禁用均衡器
sh.stopBalancer()

// 启用均衡器
sh.startBalancer()

// 在维护窗口期间禁用
use admin
db.getSiblingDB("config").settings.updateOne(
  {_id: "balancer"},
  {$set: {stopped: true}},
  {upsert: true}
)
```

### 手动迁移 Chunk

```javascript
// 手动移动 Chunk
db.adminCommand({
  moveChunk: "myapp.users",
  find: {userId: "someUserId"},
  to: "shard0001"
})

// 手动均衡某个集合
sh.moveChunk("myapp.users", {userId: "value"}, "shard0002")
```

## Chunk 大小配置

### 修改 Chunk 大小

```javascript
// 全局设置 Chunk 大小（MB）
db.getSiblingDB("config").settings.updateOne(
  {_id: "chunksize"},
  {$set: {value: 128}},  // 改为 128 MB
  {upsert: true}
)

// 注意：只影响新分裂的 Chunk，不影响现有 Chunk
```

### Jumbo Chunk

当 Chunk 无法分裂且超过正常大小时，会变成 Jumbo Chunk：

```javascript
// 查看 jumbo Chunk
db.getSiblingDB("config").chunks.find(
  {ns: "myapp.users", jumbo: true}
)

// 处理 Jumbo Chunk
// 1. 临时增大 Chunk 大小
// 2. 手动分裂或迁移
// 3. 使用 _ranged collection 或其他策略
```

## 均衡器与写入

### 写入分发

```javascript
// 写入时，mongos 计算目标 Chunk
// 1. 计算分片键的哈希值
// 2. 查找该值属于哪个 Chunk
// 3. 定向到对应的分片

// 所有新文档会写入其分片键对应的 Chunk
// 如果 Chunk 满了 → 分裂 → 新写入指向新 Chunk
```

### 写入热点

```javascript
// 问题：单调递增分片键 + 均衡器
// Shard 1: 100-200 (Chunk 满了)
// Shard 2: 0-100 (迁移来)
// Shard 3: 200-300 (新写入)

// 新写入总是路由到 Shard 1 或 Shard 3
// Shard 2 基本没有写入！热点！
```

### 解决方案

```javascript
// 1. 使用哈希分片
sh.shardCollection("myapp.orders", {orderId: "hashed"})

// 2. 使用复合分片键
sh.shardCollection("myapp.orders", {userId: 1, orderId: "hashed"})

// 3. 预分区
sh.enableSharding("myapp")
sh.shardCollection("myapp.orders", {orderId: "hashed"})
for (int i = 0; i < 10; i++) {
  // 预先创建空的 Chunk
  db.adminCommand({split: "myapp.orders", middle: {orderId: i * 1000000}})
}
```

## 均衡器性能影响

### 影响

| 影响 | 说明 |
|-----|------|
| 网络带宽 | Chunk 迁移消耗网络带宽 |
| CPU/内存 | 读取、传输、写入数据 |
| 写入延迟 | 2PC 期间写入延迟增加 |
| 读取性能 | 迁移期间读取可能稍慢 |

### 优化建议

```javascript
// 1. 在低峰期执行均衡
// 配置均衡器工作时间窗口
use config
db.settings.updateOne(
  {_id: "balancer"},
  {$set: {
    activeWindow: {
      start: "23:00",
      stop: "06:00"
    }
  }},
  {upsert: true}
)

// 2. 限制并发迁移数
db.settings.updateOne(
  {_id: "balancer"},
  {$set: {maxChunkSize: 1024}},
  {upsert: true}
)

// 3. 监控迁移进度
db.getSiblingDB("config").balancer.activeMoves.find().pretty()
```

## Java 均衡器管理

```java
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import org.bson.Document;

public class BalancerManager {
    public static void main(String[] args) {
        try (MongoClient client = MongoClients.create("mongodb://mongos:27017")) {
            // 连接到 admin 数据库
            var admin = client.getDatabase("admin");

            // 查看均衡器状态
            Document balancerStatus = admin.runCommand(
                new Document("balancerStatus", 1)
            );
            System.out.println("均衡器状态: " + balancerStatus);

            // 查看是否运行中
            boolean isRunning = admin.runCommand(
                new Document("isbalancer", 1)
            ).getBoolean("isBalancerRunning", false);

            // 停止均衡器
            admin.runCommand(new Document("stopBalancer", 1));

            // 启动均衡器
            admin.runCommand(new Document("startBalancer", 1));

            // 手动移动 Chunk
            admin.runCommand(new Document("moveChunk", "myapp.orders")
                .append("find", new Document("userId", "someId"))
                .append("to", "shard0001"));
        }
    }
}
```

## 常见问题与排查

### 问题 1：均衡器不工作

```javascript
// 检查 1：均衡器是否启用
sh.getBalancerState()  // 应该返回 true

// 检查 2：迁移阈值
// Chunk 数量差异小于阈值，均衡器不会移动

// 检查 3：是否有迁移正在进行
db.getSiblingDB("config").balancer.activeMoves.find().count()

// 检查 4：查看均衡器日志
db.getSiblingDB("admin").runCommand({logRotate: 1})
```

### 问题 2：Chunk 分布不均

```javascript
// 查看 Chunk 分布
db.getSiblingDB("config").chunks.aggregate([
  {$group: {_id: "$shard", count: {$sum: 1}}},
  {$sort: {count: -1}}
])

// 如果差异很大，手动触发均衡
sh.startBalancer()
```

### 问题 3： Jumbo Chunk 无法迁移

```javascript
// 原因：Chunk 太大，超过 Chunk 大小设置
// 解决方案 1：增大 Chunk 大小
db.adminCommand({setParameter: 1, chunksize: 256})

// 解决方案 2：手动分裂 Jumbo Chunk
db.adminCommand({
  split: "myapp.orders",
  middle: {userId: "someValue"}
})

// 解决方案 3：标记 Chunk 为可迁移
db.adminCommand({
  moveChunk: "myapp.orders",
  find: {userId: "someValue"},
  to: "shard0001",
  _secondaryThrottle: true
})
```

## 总结

均衡器核心要点：

| 概念 | 说明 |
|-----|------|
| Balancer | 后台进程，负责 Chunk 迁移 |
| Chunk | 数据分片单位，默认 64 MB |
| 迁移阈值 | Chunk 数量差异达到一定程度触发均衡 |
| 迁移过程 | 2PC 写入，对应用透明 |

**管理命令**：
| 命令 | 说明 |
|-----|------|
| `sh.getBalancerState()` | 查看均衡器状态 |
| `sh.startBalancer()` | 启动均衡器 |
| `sh.stopBalancer()` | 停止均衡器 |
| `moveChunk` | 手动迁移 Chunk |

**优化建议**：
- 低峰期执行均衡
- 监控迁移进度
- 避免 Jumbo Chunk

---

**下一步，你可以：**

- 了解 [MongoDB 高可用故障转移与选举原理](/database/mongodb/failover)
- 学习 [MongoDB WiredTiger 存储引擎原理](/database/mongodb/wiredtiger)
- 掌握 [MongoDB 性能监控](/database/mongodb/monitor)
