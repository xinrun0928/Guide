# MongoDB 面试高频问题汇总

MongoDB 是面试中的高频考点，尤其是分布式和性能优化相关的问题。

这一篇，汇总了 MongoDB 面试中最常见的问题和参考答案。

## 一、基础概念

### Q1：MongoDB 是什么？它和 MySQL 有什么区别？

**参考答案**：

MongoDB 是一款开源的面向文档的 NoSQL 数据库，使用 BSON 格式存储数据。

| 对比项 | MongoDB | MySQL |
|-------|---------|-------|
| 数据模型 | 文档（BSON） | 关系表（行） |
| Schema | 灵活，无模式 | 固定，需要预定义 |
| 主键 | `_id`（自动 ObjectId） | 自增 ID 或 UUID |
| 事务 | 4.0+ 支持多文档事务 | 原生 ACID 事务 |
| 扩展性 | 原生水平分片 | 垂直扩展为主 |

### Q2：MongoDB 的数据存储结构是什么？

**参考答案**：

MongoDB 的数据组织结构是 **Database → Collection → Document**：

- **Database**：数据库实例
- **Collection**：集合，类似于 MySQL 的表
- **Document**：文档，类似于 MySQL 的行，但可以是嵌套结构

```javascript
// MongoDB 文档示例
{
  "_id": ObjectId("..."),
  "name": "张三",
  "address": {
    "city": "北京",
    "district": "朝阳"
  },
  "orders": [
    {product: "iPhone", amount: 8999}
  ]
}
```

### Q3：BSON 是什么？和 JSON 有什么区别？

**参考答案**：

BSON（Binary JSON）是 JSON 的二进制表示，主要区别：

| 特性 | JSON | BSON |
|-----|------|------|
| 数据类型 | 有限（string、number、boolean、null、array、object） | 丰富（额外支持 Date、Binary、ObjectId、Decimal128 等） |
| 存储效率 | 低 | 高（二进制编码） |
| 可读性 | 高 | 低（但对程序友好） |

## 二、索引与查询

### Q4：MongoDB 有哪些索引类型？

**参考答案**：

| 索引类型 | 说明 | 示例 |
|---------|------|------|
| 单字段索引 | 最基本的索引 | `{age: 1}` |
| 复合索引 | 多字段组合 | `{age: 1, name: 1}` |
| 多键索引 | 数组字段索引 | 自动为 `{tags: []}` 创建 |
| 地理空间索引 | 地理位置查询 | `{location: "2dsphere"}` |
| 文本索引 | 全文搜索 | `{content: "text"}` |
| 哈希索引 | 哈希分片键 | `{_id: "hashed"}` |
| 唯一索引 | 唯一约束 | `{email: 1}, {unique: true}` |
| 稀疏索引 | 只索引存在字段 | `{phone: 1}, {sparse: true}` |

### Q5：什么是复合索引的最左前缀原则？

**参考答案**：

复合索引 `{age: 1, city: 1, name: 1}` 相当于创建了三个索引：

- `{age: 1}`
- `{age: 1, city: 1}`
- `{age: 1, city: 1, name: 1}`

查询必须从最左边的字段开始，才能使用索引：

```javascript
// 这些查询可以使用索引
db.users.find({age: 25})                    // ✅ 使用 age
db.users.find({age: 25, city: "北京"})      // ✅ 使用 age + city
db.users.find({age: 25, city: "北京", name: "张三"})  // ✅ 使用全部

// 这些查询不能使用全部索引
db.users.find({city: "北京"})              // ❌ 只用不了 age 前缀
db.users.find({name: "张三"})              // ❌ 根本用不了
```

### Q6：MongoDB 的慢查询如何优化？

**参考答案**：

1. **使用 explain() 分析执行计划**
   ```javascript
   db.orders.find({...}).explain("executionStats")
   ```

2. **检查是否使用 IXSCAN（索引扫描）而不是 COLLSCAN（全表扫描）**

3. **优化步骤**：
   - 添加合适的索引
   - 确保查询条件包含分片键（分片集群）
   - 使用投影只返回需要的字段
   - 避免深度分页，使用游标分页

## 三、事务与并发

### Q7：MongoDB 4.0 之前如何保证原子性？

**参考答案**：

MongoDB 单文档操作是原子性的。如果需要跨文档原子性，有以下方案：

1. **嵌入式设计**：将相关数据放在同一文档中
   ```javascript
   // 用户和账户在同一文档
   {
     userId: "123",
     balance: 1000,
     transactions: [{...}]
   }
   ```

2. **应用层补偿机制**：先执行操作，记录日志，失败后回滚

3. **升级到 MongoDB 4.0+**：使用多文档事务

### Q8：MongoDB 的事务和 MySQL 的事务有什么区别？

**参考答案**：

| 特性 | MongoDB | MySQL |
|-----|---------|-------|
| 事务范围 | 单文档（4.0 前）、多文档（4.0+） | 多表 |
| 隔离级别 | snapshot（快照） | 可配置（RC/RR/Serializable） |
| 性能 | 跨文档事务开销较大 | 成熟优化 |
| 使用场景 | 简单场景优先 | 强一致性场景 |

### Q9：MongoDB 的锁机制是什么？

**参考答案**：

MongoDB 4.0+ 使用**文档级锁**（Document-Level Locking）：

- WiredTiger 引擎支持文档级锁
- 不同文档的写入可以并发
- 锁粒度比 MMAPv1 的集合级锁更细

```javascript
// 不同文档可以并发写入
db.orders.updateOne({_id: 1}, {$inc: {count: 1}})  // 锁文档 1
db.orders.updateOne({_id: 2}, {$inc: {count: 1}})  // 可以并发执行
```

## 四、集群与高可用

### Q10：副本集（Replica Set）是什么？

**参考答案**：

副本集是一组 MongoDB 实例组成的集群，提供数据冗余和高可用：

| 角色 | 说明 |
|-----|------|
| **Primary** | 主节点，处理所有写操作 |
| **Secondary** | 从节点，复制主节点数据 |
| **Arbiter** | 仲裁节点，只参与选举，不存储数据 |

**故障转移过程**：
1. 主节点不可达（心跳超时）
2. 从节点发起选举
3. 得票超过半数成为新主节点
4. 应用自动重连

### Q11：副本集的选举机制是怎样的？

**参考答案**：

MongoDB 使用类 Raft 算法进行选举：

```javascript
// 成为主节点的条件：
// 1. 得票超过半数
// 2. 数据最新（optime 最接近原主节点）
// 3. 优先级 > 0
```

**常见问题**：
- 2 节点副本集：单节点故障后无法选举（需要仲裁节点或第三节点）
- 脑裂问题：网络分区后，可能出现两个主节点，MongoDB 通过选举代数（election term）解决

### Q12：分片集群（Sharded Cluster）是什么？

**参考答案**：

分片集群通过将数据分布到多个分片实现水平扩展：

```
┌─────────────────────────────────────────────┐
│                 mongos（路由节点）              │
│          接收请求，路由到正确的分片              │
└─────────────────────────────────────────────┘
                    │
     ┌──────────────┼──────────────┐
     ▼              ▼              ▼
┌─────────┐   ┌─────────┐   ┌─────────┐
│ Shard 1 │   │ Shard 2 │   │ Shard 3 │
│ ReplicaSet│   │ ReplicaSet│   │ ReplicaSet│
└─────────┘   └─────────┘   └─────────┘
```

**核心组件**：
- **mongos**：路由节点
- **Config Server**：存储元数据
- **Shard**：数据分片

### Q13：范围分片和哈希分片有什么区别？

**参考答案**：

| 特性 | 范围分片 | 哈希分片 |
|-----|---------|---------|
| 数据分布 | 按值范围 | 随机分布 |
| 写入热点 | 可能（单调递增键） | 无 |
| 范围查询 | 高效 | 低效（广播） |
| 适用场景 | 时序数据 | 用户 ID、订单 ID |

```javascript
// 范围分片
sh.shardCollection("logs", {timestamp: 1})  // 按时间范围查询高效

// 哈希分片
sh.shardCollection("orders", {orderId: "hashed"})  // 写入分散
```

### Q14：分片键选择的原则是什么？

**参考答案**：

1. **查询导向**：分片键应该是查询条件中最常用的字段
2. **高基数**：分片键的基数（不同值数量）要足够大
3. **避免单调递增**：单调递增的键会导致写入热点
4. **复合分片键**：单一字段基数不够时使用复合分片键

```javascript
// 差：低基数
sh.shardCollection("users", {country: 1})  // 国家数有限，分片效果差

// 好：高基数 + 哈希
sh.shardCollection("orders", {orderId: "hashed"})
```

## 五、存储引擎

### Q15：WiredTiger 存储引擎有哪些特性？

**参考答案**：

WiredTiger 是 MongoDB 3.0+ 的默认存储引擎：

| 特性 | 说明 |
|-----|------|
| **B+Tree 索引** | 默认索引结构 |
| **MVCC** | 多版本并发控制，文档级锁 |
| **压缩** | 支持 snappy、zlib、zstd |
| **Checkpoint** | 定期刷盘，保证一致性 |
| **Journal** | WAL 日志，保证持久性 |

### Q16：MongoDB 的 Journal 日志有什么用？

**参考答案**：

Journal（预写日志）保证数据持久性：

```javascript
// 写入流程：
// 1. 写入 Journal（顺序 I/O，很快）
// 2. 写入 WiredTiger Cache
// 3. Checkpoint 时刷盘
```

**Write Concern 选项**：
- `w: 1`：只等主节点确认
- `w: "majority"`：等多数节点确认
- `j: true`：Journal 必须刷盘

## 六、性能优化

### Q17：如何监控 MongoDB 的性能？

**参考答案**：

| 工具 | 用途 |
|-----|------|
| `mongostat` | 查看每秒操作数、索引命中率、队列长度 |
| `mongotop` | 查看集合级别的读写时间 |
| `serverStatus` | 查看内存、连接、缓存统计 |
| `Profiler` | 记录慢查询 |
| `db.currentOp()` | 查看当前正在执行的操作 |

### Q18：如何优化 MongoDB 的写入性能？

**参考答案**：

1. **批量写入**：减少网络往返
   ```java
   collection.insertMany(docs);
   ```

2. **无序写入**：允许并发处理
   ```java
   collection.insertMany(docs, new InsertManyOptions().ordered(false));
   ```

3. **减少索引**：避免每次写入更新索引

4. **使用 SSD**：提高 I/O 性能

5. **合理分片**：分散写入压力

## 七、安全

### Q19：MongoDB 有哪些认证方式？

**参考答案**：

| 认证方式 | 说明 |
|---------|------|
| **SCRAM** | 默认推荐，用户名密码认证 |
| **x.509 证书** | 证书双向认证 |
| **LDAP** | 企业统一认证 |
| **Kerberos** | 大型企业 AD 集成 |

## 八、综合应用

### Q20：什么场景下选择 MongoDB 而不是 MySQL？

**参考答案**：

| 场景 | 推荐 | 原因 |
|-----|------|------|
| 灵活 Schema | MongoDB | 无需预定义表结构 |
| 嵌套数据 | MongoDB | 嵌入式文档减少 JOIN |
| 水平扩展 | MongoDB | 原生分片支持 |
| 物联网/日志 | MongoDB | 高写入性能 |
| 强事务 | MySQL | ACID 更成熟 |
| 复杂关联 | MySQL | SQL JOIN 更强大 |
| 结构固定 | MySQL | 成熟稳定 |

### Q21：MongoDB 的聚合管道是什么？

**参考答案**：

聚合管道是 MongoDB 的数据处理框架，类似于 SQL 的 GROUP BY、HAVING 等：

```javascript
db.orders.aggregate([
  // $match：过滤
  {$match: {status: "paid"}},

  // $group：分组
  {$group: {
    _id: "$userId",
    totalAmount: {$sum: "$amount"}
  }},

  // $sort：排序
  {$sort: {totalAmount: -1}},

  // $limit：限制
  {$limit: 10}
])
```

## 面试追问方向

### 追问 1：分片键选择错误会导致什么问题？

- 数据分布不均匀（热点分片）
- 查询退化为广播查询
- 写入集中在单个分片

### 追问 2：副本集和主从复制的区别？

- 副本集支持自动故障转移，主从复制需要手动切换
- 副本集所有节点都可以是数据节点
- 副本集使用 oplog 同步，主从复制使用 binlog

### 追问 3：MongoDB 的 oplog 是什么？

- oplog（Operations Log）是主节点的操作日志
- 从节点通过重放 oplog 实现数据同步
- oplog 是固定集合，大小需要规划

### 追问 4：WiredTiger Cache 如何配置？

- 默认：机器 RAM 的 50%
- 建议：保留部分内存给操作系统
- 监控：`db.serverStatus().wiredTiger.cache`

## 总结

MongoDB 面试核心知识点：

| 模块 | 高频考点 |
|-----|---------|
| 基础概念 | 数据模型、BSON vs JSON |
| 索引 | 索引类型、最左前缀原则、慢查询优化 |
| 事务 | 单文档原子性、多文档事务（4.0+） |
| 集群 | 副本集、分片集群、分片键选择 |
| 存储 | WiredTiger、Journal、Checkpoint |
| 性能 | 监控工具、写入优化 |

---

**推荐阅读**：

- [MongoDB 整体架构与适用场景](/database/mongodb/overview)
- [MongoDB 分片键选择原则与常见错误](/database/mongodb/shard-key)
- [MongoDB 常见性能瓶颈与优化思路](/database/mongodb/performance)
