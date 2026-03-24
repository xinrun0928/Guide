# MongoDB Sharded Cluster 分片集群架构

当数据量达到 TB 级别，单个 MongoDB 实例已经无法承载时，怎么办？

答案就是**分片集群（Sharded Cluster）**——MongoDB 的水平扩展方案。

## 什么是分片集群？

分片集群通过将数据分布到多个 MongoDB 实例（分片）来实现水平扩展。每个分片只存储部分数据，整个集群可以处理 PB 级别的数据。

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Sharded Cluster                              │
│                                                                      │
│                           ┌─────────┐                               │
│                           │ mongos  │ ← 路由节点（Query Router）     │
│                           │ :27017  │                               │
│                           └────┬────┘                               │
│                                │                                     │
│         ┌──────────────────────┼──────────────────────┐               │
│         │                      │                      │               │
│         ▼                      ▼                      ▼               │
│    ┌─────────┐            ┌─────────┐            ┌─────────┐        │
│    │ Shard 1 │            │ Shard 2 │            │ Shard 3 │        │
│    │Primary  │            │Primary  │            │Primary  │        │
│    │Secondary│            │Secondary│            │Secondary│        │
│    │Secondary│            │Secondary│            │Secondary│        │
│    └─────────┘            └─────────┘            └─────────┘        │
│       0-33%                   33%-66%               66%-100%        │
│                                                                      │
│    ┌─────────────────────────────────────────────────────────┐       │
│    │                    Config Server (Replica Set)           │       │
│    │                      mongos 配置节点                     │       │
│    │              存储集群元数据：分片信息、Chunk 分布          │       │
│    └─────────────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────────┘
```

## 分片集群核心组件

### 1. mongos（路由节点）

mongos 是客户端连接集群的入口点，负责：

- 接收客户端请求
- 查询 Config Server 获取数据分布
- 将请求路由到正确的分片
- 合并多个分片的结果返回给客户端

```bash
# 启动 mongos
mongos --configdb configReplSet/host1:27019,host2:27019,host3:27019 --port 27017
```

### 2. Config Server（配置节点）

Config Server 存储集群的元数据：

| 元数据 | 说明 |
|-------|------|
| 分片信息 | 哪些分片，每个分片的范围 |
| Chunk 信息 | 数据块分布、版本号 |
| 均衡器状态 | 负载均衡信息 |
| 认证信息 | 用户、权限 |

```javascript
// Config Server 本质是一个副本集
{
  "_id": "configReplSet",
  "configsvr": true,
  "members": [
    {_id: 0, host: "config1:27019"},
    {_id: 1, host: "config2:27019"},
    {_id: 2, host: "config3:27019"}
  ]
}
```

### 3. Shard（分片节点）

每个分片本身是一个副本集，负责存储部分数据：

```javascript
// 分片副本集配置
{
  "_id": "shardReplSet1",
  "members": [
    {_id: 0, host: "shard1a:27018},
    {_id: 1, host: "shard1b:27018},
    {_id: 2, host: "shard1c:27018}
  ]
}
```

## 分片集群架构特点

### 数据分布：Chunk

MongoDB 按 Chunk（数据块）来划分数据：

```
┌─────────────────────────────────────────────────────────────┐
│                      Shard 1                                │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │ Chunk 1 │  │ Chunk 2 │  │ Chunk 3 │  │ Chunk N │       │
│  │ 0 - 10  │  │ 10 - 20 │  │ 20 - 30 │  │ ...     │       │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘       │
└─────────────────────────────────────────────────────────────┘
```

- **默认 Chunk 大小**：64 MB
- **Chunk 分裂**：当数据量接近阈值时自动分裂
- **Chunk 迁移**：均衡器会自动迁移 Chunk 实现负载均衡

### 请求路由：广播 vs 定向

```javascript
// 定向查询：mongos 直接路由到单个分片（高效）
db.orders.find({_id: ObjectId("...")})  // 有 shard key

// 广播查询：mongos 查询所有分片再合并（低效）
db.orders.find({status: "completed"})   // 没有 shard key
```

## 分片集群配置

### 1. 初始化 Config Server 副本集

```javascript
// 启动 config server
mongod --configsvr --dbpath /data/config --port 27019

// 初始化副本集
rs.initiate({
  _id: "configReplSet",
  configsvr: true,
  members: [
    {_id: 0, host: "config1:27019"},
    {_id: 1, host: "config2:27019"},
    {_id: 2, host: "config3:27019"}
  ]
})
```

### 2. 启动 mongos

```bash
# 启动 mongos，指定 config server
mongos --configdb configReplSet/config1:27019,config2:27019,config3:27019
```

### 3. 添加分片

```javascript
// 连接到 mongos
mongos> sh.addShard("shardReplSet1/shard1a:27018,shard1b:27018,shard1c:27018")
mongos> sh.addShard("shardReplSet2/shard2a:27018,shard2b:27018,shard2c:27018")
mongos> sh.addShard("shardReplSet3/shard3a:27018,shard3b:27018,shard3c:27018")

// 查看集群状态
sh.status()
```

### 4. 启用分片

```javascript
// 启用数据库分片
sh.enableSharding("myapp")

// 对集合进行分片
sh.shardCollection("myapp.orders", {orderId: "hashed"})
sh.shardCollection("myapp.users", {userId: 1, region: 1})
```

## 分片集群 vs 副本集

| 特性 | 副本集 | 分片集群 |
|-----|-------|---------|
| 数据量 | 单机容量 | PB 级别 |
| 扩展方式 | 垂直扩展 | 水平扩展 |
| 写入能力 | 单机 | 多机并行 |
| 复杂度 | 简单 | 复杂 |
| 成本 | 低 | 高 |
| 适用场景 | < 1 TB | > 1 TB |

## 分片集群的优点

1. **水平扩展**：通过添加分片轻松扩展容量
2. **写入分散**：写入分散到多个分片，提高写入性能
3. **高可用**：每个分片都是副本集，单分片故障不影响其他分片
4. **地理分布**：可以将分片部署在不同数据中心

## 分片集群的挑战

1. **查询性能**：广播查询需要扫描所有分片
2. **数据分布**：分片键选择不当会导致热点
3. **事务限制**：跨分片事务（4.0+）性能较差
4. **运维复杂度**：组件多，排查问题困难

## Java 连接分片集群

```java
import com.mongodb.MongoClientSettings;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;

// 连接分片集群（通过 mongos）
String connectionString = "mongodb://mongos1:27017,mongos2:27017/?readPreference=secondaryPreferred";

try (MongoClient mongoClient = MongoClients.create(connectionString)) {
    MongoDatabase database = mongoClient.getDatabase("myapp");
    MongoCollection&lt;Document&gt; collection = database.getCollection("orders");

    // 写入会自动分布到各个分片
    collection.insertOne(new Document("orderId", "...")
        .append("shardingKey", "value"));
}
```

## 分片集群使用建议

| 建议 | 说明 |
|-----|------|
| **不要过早分片** | 数据量 < 1TB 优先考虑副本集 |
| **合理选择分片键** | 参考后面关于分片键的文章 |
| **避免广播查询** | 查询条件包含分片键 |
| **监控 Chunk 分布** | 避免数据倾斜 |
| **做好容量规划** | 预估数据增长，提前规划 |

## 常见架构示例

### 最小生产架构

```
组件：
- 3 x Config Server（副本集）
- 3 x Shard（每个是 3 节点副本集）
- 2 x mongos（负载均衡）

特点：最小高可用配置
```

### 多数据中心架构

```
组件：
- Config Server：3 个（分布在 3 个机房）
- Shard 1：副本分布在 DC1、DC2、DC3
- Shard 2：副本分布在 DC1、DC2、DC3
- mongos：每个机房 1 个

特点：容灾能力强，跨机房读取
```

## 总结

分片集群核心组件：

| 组件 | 作用 | 数量 |
|-----|------|------|
| mongos | 路由节点，处理客户端请求 | 2+ |
| Config Server | 存储元数据 | 3（副本集） |
| Shard | 存储实际数据 | 2+（副本集） |

**数据分布机制**：
- 数据按 Chunk 划分（默认 64 MB）
- Chunk 通过分片键的值范围分配到分片
- 均衡器自动迁移 Chunk 实现负载均衡

**路由策略**：
- 有分片键的查询 → 定向到单个分片（高效）
- 无分片键的查询 → 广播到所有分片（低效）

---

**下一步，你可以：**

- 了解 [MongoDB 分片策略：范围分片 vs 哈希分片](/database/mongodb/sharding-strategy)
- 掌握 [MongoDB 分片键选择原则与常见错误](/database/mongodb/shard-key)
- 学习 [MongoDB 均衡器与 Chunk 迁移](/database/mongodb/balancer)
