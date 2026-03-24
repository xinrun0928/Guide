# MongoDB 分片策略：范围分片 vs 哈希分片

MongoDB 有两种主要的分片策略：范围分片和哈希分片。选对策略，是分片集群成功的关键。

## 分片键与 Chunk

在了解分片策略之前，先理解分片键和 Chunk：

```javascript
// 分片键：决定数据如何分布
sh.shardCollection("myapp.orders", {orderId: "hashed"})

// Chunk：数据块，每个 Chunk 包含一段分片键范围
// 默认大小 64 MB
// 包含 {orderId: 1000} 到 {orderId: 5000} 的数据
```

## 范围分片（Range Sharding）

### 原理

范围分片按分片键的值范围划分数据：

```
分片键：{orderId: 1}

┌─────────────────────────────────────────────────────────────┐
│                      Config Server                          │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐                │
│  │Chunk: -∞~100│ │Chunk:100~200│ │Chunk:200~+∞│            │
│  │→ Shard 1 │   │→ Shard 2 │   │→ Shard 3 │                │
│  └──────────┘   └──────────┘   └──────────┘                │
└─────────────────────────────────────────────────────────────┘
```

### 优点

- **范围查询高效**：连续范围的数据在同一分片
- **查询路由优化**：范围查询可能只需访问少数分片

### 缺点

- **热点风险**：单调递增的分片键会导致写入热点
- **数据倾斜**：不同范围数据量可能不均匀

### 适用场景

```javascript
// 适合范围分片的场景：
// 1. 时间序列数据（按时间范围查询）
sh.shardCollection("myapp.logs", {timestamp: 1})

// 查询最近一天的数据，只需访问少数分片
db.logs.find({timestamp: {$gte: yesterday, $lt: now}})

// 2. 地理区域数据（按地区查询）
sh.shardCollection("myapp.stores", {region: 1, storeId: 1})

// 3. 需要范围聚合的场景
db.logs.aggregate([
  {$match: {timestamp: {$gte: startOfMonth, $lt: endOfMonth}}},
  {$group: {_id: "$type", count: {$sum: 1}}}
])
```

## 哈希分片（Hashed Sharding）

### 原理

哈希分片对分片键计算哈希值，根据哈希值分布数据：

```javascript
// 哈希分片
sh.shardCollection("myapp.orders", {orderId: "hashed"})

// 数据分布示意
// orderId = 100  → hash(100) = 0xABC  → Shard 1
// orderId = 101  → hash(101) = 0xDEF  → Shard 2
// orderId = 102  → hash(102) = 0xXYZ  → Shard 1
// orderId = 103  → hash(103) = 0x123  → Shard 3
```

```
┌─────────────────────────────────────────────────────────────┐
│                     Hashed Sharding                         │
│                                                              │
│  orderId=100  ──hash──▶  0xABC  ──▶  Shard 1               │
│  orderId=101  ──hash──▶  0xDEF  ──▶  Shard 2               │
│  orderId=102  ──hash──▶  0xXYZ  ──▶  Shard 1               │
│  orderId=103  ──hash──▶  0x123  ──▶  Shard 3               │
│                                                              │
│  特点：数据随机分布，写入分散                                  │
└─────────────────────────────────────────────────────────────┘
```

### 优点

- **写入分散**：写入自动分布到各个分片
- **数据均匀**：哈希值分布均匀，数据分布平衡

### 缺点

- **范围查询低效**：范围查询需要广播到所有分片
- **无法利用局部性**：相近的数据可能在不同分片

### 适用场景

```javascript
// 适合哈希分片的场景：
// 1. 用户 ID、订单 ID 等唯一标识
sh.shardCollection("myapp.orders", {orderId: "hashed"})

// 写入均匀分散
db.orders.insertOne({orderId: new ObjectId()})

// 2. 高写入压力场景
sh.shardCollection("myapp.events", {eventId: "hashed"})

// 3. 无范围查询需求的场景
db.events.find({eventId: "specific-id"})  // 精确查询
```

## 两种策略对比

| 特性 | 范围分片 | 哈希分片 |
|-----|---------|---------|
| 数据分布 | 按值范围 | 随机分布 |
| 写入热点 | 可能（单调递增键） | 无（数据随机） |
| 范围查询 | 高效 | 低效（广播） |
| 精确查询 | 高效 | 高效 |
| 数据均匀性 | 可能不均匀 | 较均匀 |
| 适用场景 | 时序数据、地理数据 | 用户 ID、订单 ID |

## 组合分片策略

### 复合分片键

```javascript
// 复合分片键：范围键 + 哈希键
sh.shardCollection("myapp.orders", {region: 1, orderId: "hashed"})

// 分布逻辑：
// 1. 先按 region 分片（东北、华北、华南等）
// 2. 同 region 内按 orderId 哈希分布

// 结果：
// Shard 1: {region: "北京", orderId: ...}
// Shard 2: {region: "北京", orderId: ...}
// Shard 3: {region: "上海", orderId: ...}
// Shard 4: {region: "上海", orderId: ...}
```

### 适用场景

```javascript
// 1. 多租户应用
sh.shardCollection("myapp.tenant_data", {tenantId: 1, dataId: "hashed"})

// 2. 时序 + 负载均衡
sh.shardCollection("myapp.sensor_data", {deviceId: 1, timestamp: 1})

// 3. 地理 + 写入分散
sh.shardCollection("myapp.user_activities", {city: 1, userId: "hashed"})
```

## 分片策略选择指南

### 决策树

```
是否需要范围查询？
├── 是
│   ├── 是否按时间范围查询？
│   │   ├── 是 → 范围分片（时间字段）
│   │   └── 否 → 范围分片（查询字段）
│   └── 写入是否集中？
│       ├── 是 → 复合分片（范围 + 哈希）
│       └── 否 → 范围分片
└── 否
    └── 哈希分片
```

### 常见场景选择

| 场景 | 推荐策略 | 示例分片键 |
|-----|---------|-----------|
| 订单系统（无特定范围查询） | 哈希分片 | `{orderId: "hashed"}` |
| 时序日志 | 范围分片 | `{timestamp: 1}` |
| 用户行为分析 | 复合分片 | `{date: 1, userId: "hashed"}` |
| 社交应用（好友关系） | 哈希分片 | `{userId: "hashed"}` |
| 物联网（按设备+时间） | 复合分片 | `{deviceId: 1, timestamp: 1}` |
| 多租户 SaaS | 复合分片 | `{tenantId: 1, entityId: "hashed"}` |

## 实践建议

### 反面教材

```javascript
// 错误 1：用单调递增字段做哈希分片键
sh.shardCollection("myapp.orders", {_id: "hashed"})

// _id 是 ObjectId，时间递增 → 哈希分散 → OK

// 错误 2：用非查询字段做分片键
sh.shardCollection("myapp.orders", {randomField: 1})
db.orders.find({otherField: "value"})  // 广播查询！

// 正确：分片键应该是查询条件的一部分
sh.shardCollection("myapp.orders", {tenantId: 1, orderId: 1})
```

### 正面示例

```javascript
// 场景 1：电商订单系统
// 主要查询：按用户查订单、按时间查订单
sh.shardCollection("myapp.orders", {userId: 1, createdAt: 1})

// 用户维度查询高效（定向查询）
db.orders.find({userId: "user123"})

// 时间维度查询需要广播
db.orders.find({createdAt: {$gte: lastMonth}})

// 场景 2：日志系统
// 主要查询：按时间范围查、按服务名查
sh.shardCollection("myapp.logs", {timestamp: 1, service: 1})

// 时间范围查询高效
db.logs.find({timestamp: {$gte: yesterday}})

// 场景 3：用户系统
// 主要查询：按用户 ID 精确查询
sh.shardCollection("myapp.users", {userId: "hashed"})

// 写入分散，无热点
for (int i = 0; i < 1000000; i++) {
  db.users.insertOne({userId: i, ...})
}
```

## Java 分片策略配置

```java
import com.mongodb.sharding.api.MongoSharding;

public class ShardingConfig {
    public static void main(String[] args) {
        // 连接 mongos
        try (MongoClient client = MongoClients.create("mongodb://mongos:27017")) {
            MongoDatabase admin = client.getDatabase("admin");

            // 启用数据库分片
            admin.runCommand(new Document("enableSharding", "myapp"));

            // 范围分片
            admin.runCommand(new Document("shardCollection", "myapp.orders")
                .append("key", new Document("timestamp", 1)));

            // 哈希分片
            admin.runCommand(new Document("shardCollection", "myapp.events")
                .append("key", new Document("eventId", "hashed")));

            // 复合分片
            admin.runCommand(new Document("shardCollection", "myapp.userOrders")
                .append("key", new Document("userId", 1)
                    .append("orderId", "hashed")));
        }
    }
}
```

## 总结

| 分片策略 | 适用场景 | 不适用场景 |
|---------|---------|-----------|
| 范围分片 | 时序数据、地理数据、范围查询多 | 单调递增键、写入热点 |
| 哈希分片 | 用户 ID、订单 ID、写入分散 | 范围查询 |
| 复合分片 | 多维度查询、多租户 | 简单均匀分布需求 |

**分片策略选择原则**：

1. **查询优先**：选择查询中最常用的字段作为分片键前缀
2. **均匀分布**：避免热点，数据分布均匀
3. **写入分散**：高写入场景考虑哈希分片
4. **组合使用**：复杂场景使用复合分片键

---

**下一步，你可以：**

- 掌握 [MongoDB 分片键选择原则与常见错误](/database/mongodb/shard-key)
- 学习 [MongoDB 均衡器与 Chunk 迁移](/database/mongodb/balancer)
- 了解 [MongoDB 高可用故障转移与选举原理](/database/mongodb/failover)
