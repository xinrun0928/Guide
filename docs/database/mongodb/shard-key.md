# MongoDB 分片键选择原则与常见错误

分片键选错了，后果很严重——要么数据倾斜、要么查询退化、要么集群崩溃。

这一篇，我来说说分片键选择的核心原则和常见错误。

## 分片键的重要性

分片键决定了：

1. **数据分布**：数据如何分配到各个分片
2. **查询路由**：查询是否能定位到单个分片
3. **写入分布**：写入负载是否均衡
4. **集群扩展性**：未来能否平滑扩展

```
分片键 = 数据的「路由规则」
选对了，集群高效运转
选错了，集群性能灾难
```

## 分片键选择原则

### 原则 1：查询导向

分片键应该是查询条件中最常用的字段：

```javascript
// 场景：订单系统
// 主要查询模式：
// 1. db.orders.find({userId: "xxx"})           // 按用户查
// 2. db.orders.find({userId: "xxx", date: ...}) // 按用户+时间查

// 正确：分片键包含查询字段
sh.shardCollection("myapp.orders", {userId: 1})

// 查询 {userId: "user123"} → 定向到单个分片 ✅
db.orders.find({userId: "user123"})

// 查询 {date: "2024-01-01"} → 广播所有分片 ❌
db.orders.find({date: "2024-01-01"})
```

### 原则 2：基数要大

分片键的基数（不同值的数量）应该足够大：

```javascript
// 基数太小 → 分片数受限
// 基数为 2 的分片键，最多只有 2 个分片有数据

// 错误：基数为国家，分片数受限
sh.shardCollection("myapp.users", {country: 1})
// 最多只能有效利用 2-3 个分片（其他国家数据很少）

// 正确：基数为用户 ID，基数无限
sh.shardCollection("myapp.users", {userId: "hashed"})
// 可以充分利用所有分片
```

### 原则 3：避免单调递增/递减

单调递增的分片键会导致写入热点：

```javascript
// 错误：ObjectId 近似单调递增（时间戳在前）
// 所有新写入都会路由到最后一个 Chunk → 热点分片
sh.shardCollection("myapp.events", {_id: "hashed"})  // ObjectId 可以

// 但如果是自定义单调递增 ID
sh.shardCollection("myapp.orders", {orderId: 1})
// orderId 从 1 到 1000000000 递增
// 所有新数据都写入最高范围的分片 → 热点！

// 正确：使用哈希分散写入
sh.shardCollection("myapp.orders", {orderId: "hashed"})
```

### 原则 4：复合分片键补充基数

单一字段基数不够时，使用复合分片键：

```javascript
// 场景：用户订单
// 问题：userId 基数大，但查询需要按时间
// 方案：复合分片键

sh.shardCollection("myapp.orders", {userId: 1, orderId: "hashed"})

// 分布：
// {userId: "A", orderId: 1} → Shard 1
// {userId: "A", orderId: 2} → Shard 2
// {userId: "B", orderId: 1} → Shard 3
```

## 常见错误与后果

### 错误 1：低基数分片键

```javascript
// 错误：使用枚举类字段做分片键
sh.shardCollection("myapp.users", {status: 1})
// status 只有 3 个值：active、inactive、pending
// 大部分数据集中在某些 Chunk，无法分散到所有分片
```

**后果**：
- 数据分布不均匀
- 部分分片负载过重
- 扩容效果差

### 错误 2：单调递增键

```javascript
// 错误：使用自增 ID 做分片键
sh.shardCollection("myapp.logs", {logId: 1})
// logId 从 1 开始，每次 +1

// 写入分布：
// Shard 1: logId 0-100000
// Shard 2: logId 100001-200000
// Shard 3: logId 200001-300000
// 所有新写入都到 Shard 3！热点！
```

**后果**：
- 单分片写入热点
- 其他分片闲置
- 无法提升写入性能

### 错误 3：查询字段不包含分片键

```javascript
// 错误：分片键与查询无关
sh.shardCollection("myapp.orders", {orderId: "hashed"})

// 查询不包含 orderId
db.orders.find({userId: "user123", status: "paid"})
// 广播查询所有分片！性能极差！
```

**后果**：
- 所有查询变成广播查询
- 查询延迟大幅增加
- 分片优势完全丧失

### 错误 4：频繁更新的字段做分片键

```javascript
// 错误：使用频繁更新的字段做分片键
sh.shardCollection("myapp.sessions", {status: 1})

// 更新时需要移动 Chunk
db.sessions.updateOne(
  {_id: "session1"},
  {$set: {status: "active"}}
)
```

**后果**：
- 更新操作触发 Chunk 迁移
- 更新延迟增加
- 数据一致性问题风险

## 正确的分片键选择

### 场景 1：用户系统

```javascript
// 查询模式：按 userId 精确查询
// 需求：写入分散、高并发
// 选择：哈希分片

sh.shardCollection("myapp.users", {userId: "hashed"})

// 优点：写入均匀、无热点
// 查询：db.users.find({userId: "xxx"}) → 定向查询
```

### 场景 2：订单系统

```javascript
// 查询模式：
// 1. 按 userId 查用户的所有订单
// 2. 按时间范围查订单
// 3. 按 orderId 精确查订单

// 选择：复合分片键
sh.shardCollection("myapp.orders", {userId: 1, orderId: "hashed"})

// 优点：
// - 用户维度查询高效
// - 用户内写入按 orderId 哈希分散
// - orderId 查询高效
```

### 场景 3：日志系统

```javascript
// 查询模式：按时间范围查询
// 需求：时序聚合、按服务筛选
// 选择：范围分片

sh.shardCollection("myapp.logs", {timestamp: 1, service: 1})

// 优点：
// - 时间范围查询高效
// - 同时间段内按服务分散
// - 支持按服务筛选
```

### 场景 4：多租户 SaaS

```javascript
// 查询模式：按租户隔离查询
// 需求：租户隔离、数据隔离
// 选择：租户 ID 分片

sh.shardCollection("myapp.data", {tenantId: 1, entityId: "hashed"})

// 优点：
// - 租户数据分布在特定分片
// - 租户间数据隔离
// - 同租户内数据分散
```

## 分片键修改

MongoDB 不支持直接修改分片键。如果必须修改，需要：

```javascript
// 方案 1：重新分片（Refactor）
// 1. 创建新集合，指定新的分片键
// 2. 从旧集合迁移数据到新集合
// 3. 切换应用使用新集合
// 4. 删除旧集合

// 方案 2：使用复合分片键
// 在现有分片键基础上添加新字段
sh.shardCollection("myapp.orders", {userId: 1, newField: 1})

// 方案 3：添加新字段作为辅助查询
// 不改变分片键，添加冗余字段辅助查询
db.orders.updateMany({}, {$set: {userIdQuery: "$userId"}})
```

## 分片键监控

```javascript
// 查看 Chunk 分布
db.getSiblingDB("config").chunks.find(
  {ns: "myapp.orders"}
).count({shard: "shard0000"})

// 查看数据分布
db.orders.aggregate([
  {$group: {_id: null, total: {$sum: 1}}},
  {$lookup: {
    from: "config.chunks",
    let: {},
    pipeline: [],
    as: "chunks"
  }}
])

// 检测热点 Chunk
db.adminCommand({chunkDiff: 1, ns: "myapp.orders"})
```

## 总结

分片键选择检查清单：

| 检查项 | 问题 | 解决方案 |
|-------|------|---------|
| 基數是否足够大？ | 枚举值太少 | 使用更大基数的字段 |
| 是否避免单调递增？ | 新数据都写入一个分片 | 使用哈希分片 |
| 是否包含查询字段？ | 查询变成广播 | 选择查询常用字段 |
| 是否频繁更新？ | 更新触发迁移 | 避免使用更新频繁的字段 |
| 是否 cardinality 合适？ | 复合键冗余 | 精简复合键字段 |

**分片键选择核心原则**：
1. 查询导向：包含查询条件中的字段
2. 高基数：确保能充分利用分片
3. 分散写入：避免写入热点
4. 稳定不变：避免频繁更新

---

**下一步，你可以：**

- 学习 [MongoDB 均衡器与 Chunk 迁移](/database/mongodb/balancer)
- 了解 [MongoDB 高可用故障转移与选举原理](/database/mongodb/failover)
- 掌握 [MongoDB WiredTiger 存储引擎原理](/database/mongodb/wiredtiger)
