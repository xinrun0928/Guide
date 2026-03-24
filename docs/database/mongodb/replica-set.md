# Replica Set 副本集：成员角色与选举机制

如果你只部署一个 MongoDB 实例，当它挂了的时候，整个应用就瘫了。

副本集（Replica Set）就是来解决这个问题的——通过数据复制 + 自动故障转移，保证服务的高可用。

## 副本集是什么？

副本集是一组 MongoDB 实例组成的集群，包含：
- **1 个主节点（Primary）**：处理所有写操作
- **1+ 个从节点（Secondary）**：复制主节点数据，提供读取
- **0 或 1 个仲裁节点（Arbiter）**：参与选举但不存储数据

```
┌─────────────────────────────────────────────────────────┐
│                    Replica Set                          │
│                                                         │
│     ┌─────────┐    复制     ┌─────────┐                │
│     │Primary  │ ──────────▶ │Secondary│                │
│     │(主节点) │             │(从节点) │                │
│     └─────────┘             └─────────┘                │
│         ▲                        ▲                     │
│         │ 选举                   │ 选举                │
│         └────────────────────────┘                     │
│                                                         │
│     ┌─────────┐                                        │
│     │Arbiter  │ (仲裁节点，不存储数据)                   │
│     │(仲裁节点)│                                        │
│     └─────────┘                                        │
└─────────────────────────────────────────────────────────┘
```

## 副本集成员角色

### 1. Primary（主节点）

- 接收所有写操作
- 记录到 oplog（操作日志）
- 其他成员从主节点复制数据

```javascript
// 连接到主节点
db.adminCommand({replSetGetStatus: 1})
// 查看状态，role 应为 "PRIMARY"
```

### 2. Secondary（从节点）

从节点有以下类型：

| 类型 | 说明 | 配置 |
|-----|------|------|
| Standard | 普通从节点 | 默认 |
| Priority-0 | 优先级为 0，永远不成为主节点 | `priority: 0` |
| Hidden | 隐藏从节点，不对外提供读取 | `hidden: true` |
| Delayed | 延迟从节点，数据比主节点延迟 | `slaveDelay: 3600` |
| Non-Voting | 无投票权从节点 | `votes: 0` |

```javascript
// 配置不同类型的从节点
{
  "_id": "rs0",
  "members": [
    {_id: 0, host: "mongo1:27017"},      // 主节点候选
    {_id: 1, host: "mongo2:27017", priority: 0},  // 永不成为主节点
    {_id: 2, host: "mongo3:27017", hidden: true}, // 隐藏节点
    {_id: 3, host: "mongo4:27017", slaveDelay: 3600},  // 延迟 1 小时
    {_id: 4, host: "mongo5:27017", votes: 0}  // 无投票权
  ]
}
```

### 3. Arbiter（仲裁节点）

- 不存储数据
- 只参与选举投票
- 用于奇数节点时的选举

```javascript
// 仲裁节点配置
{_id: 4, host: "mongo4:27017", arbiterOnly: true}
```

> **注意**：仲裁节点不存储数据，所以不能用于读取。

## 选举机制

### 触发选举的条件

| 条件 | 说明 |
|-----|------|
| 主节点不可用 | 网络中断、进程崩溃等 |
| 心跳超时 | 从节点无法联系主节点（默认 10 秒） |
| 新节点加入 | 可能触发重新选举 |
| 管理员手动触发 | `replSetStepDown` |

### 选举算法

MongoDB 使用**Raft 共识算法**的变体进行选举：

```javascript
// 选举过程简化
1. 从节点发现主节点不可用
2. 从节点等待 electionTimeoutMillis（默认 10 秒）
3. 满足条件的从节点发起选举
4. 所有节点投票
5. 得票超过半数 → 成为新主节点
```

### 选举投票规则

```javascript
// 投票权重
{
  votes: 1,      // 普通节点，投 1 票
  votes: 0       // Non-Voting 节点，不投票
}

// 成为主节点的条件
// 1. 得票超过半数
// 2. 数据最新（Optime 最新）
// 3. 优先级 > 0
```

### 选举优先级

```javascript
// 副本集配置
{
  "members": [
    {_id: 0, host: "mongo1:27017", priority: 3},  // 优先级最高
    {_id: 1, host: "mongo2:27017", priority: 2},
    {_id: 2, host: "mongo3:27017", priority: 1}   // 优先级最低
  ]
}

// mongo1 最有可能成为主节点
```

## 副本集配置

### 初始化副本集

```javascript
// 初始化副本集
rs.initiate({
  _id: "myReplSet",
  members: [
    {_id: 0, host: "mongo1:27017"},
    {_id: 1, host: "mongo2:27017"},
    {_id: 2, host: "mongo3:27017"}
  ]
})

// 查看配置
rs.conf()

// 修改配置
var cfg = rs.conf()
cfg.members[0].priority = 2
rs.reconfig(cfg)
```

### 副本集状态

```javascript
// 查看副本集状态
rs.status()

// 常用状态
// PRIMARY   - 主节点
// SECONDARY - 从节点
// RECOVERING - 恢复中
// STARTUP2 - 初始同步中
// ARBITER - 仲裁节点
// DOWN - 节点不可达
```

### 添加/删除节点

```javascript
// 添加从节点
rs.add("mongo4:27017")

// 添加仲裁节点
rs.addArb("mongo5:27017")

// 删除节点
rs.remove("mongo4:27017")
```

## 读写分离

### 读取偏好

| 模式 | 说明 | 使用场景 |
|-----|------|---------|
| `primary` | 只读主节点 | 强一致性读取 |
| `primaryPreferred` | 优先主节点，主节点不可用时读从节点 | 多数读取从主节点 |
| `secondary` | 只读从节点 | 分担主节点压力 |
| `secondaryPreferred` | 优先从节点 | 读取负载均衡 |
| `nearest` | 读最近的节点 | 地理分布场景 |

```javascript
// MongoDB Shell 设置读取偏好
db.getMongo().setReadPref('secondaryPreferred')

// 查询时设置
db.orders.find({...}).readPref('secondary')

// Java 设置读取偏好
MongoCollection&lt;Document&gt; collection = database.getCollection("orders")
    .withReadPreference(ReadPreference.secondaryPreferred());
```

### 读取偏好与数据一致性

```javascript
// 问题：从节点可能数据滞后
// 从节点读取可能读到旧数据

// 解决方案 1：使用标签（Tag）确保数据一致性
{
  members: [
    {_id: 0, host: "mongo1:27017", tags: {"dc": "us-east"}},
    {_id: 1, host: "mongo2:27017", tags: {"dc": "us-east"}}
  ]
}

// 按标签读取
db.orders.find({...}).readPref('secondary', [{dc: 'us-east'}])

// 解决方案 2：使用 readConcern 保证一致性
db.orders.find({...}).readConcern("majority")
```

## Java 连接副本集

```java
import com.mongodb.MongoClientSettings;
import com.mongodb.ReadPreference;
import com.mongodb.WriteConcern;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;

// 副本集连接字符串
String connectionString = "mongodb://mongo1:27017,mongo2:27017,mongo3:27017/?replicaSet=myReplSet";

try (MongoClient mongoClient = MongoClients.create(connectionString)) {
    MongoDatabase database = mongoClient.getDatabase("myapp");
    MongoCollection&lt;Document&gt; collection = database.getCollection("orders");

    // 写入主节点
    collection.insertOne(new Document("orderId", "..."));

    // 读取从节点
    MongoCollection&lt;Document&gt; readCollection = collection
        .withReadPreference(ReadPreference.secondaryPreferred());

    for (Document doc : readCollection.find()) {
        // 处理数据
    }
}
```

## 故障转移过程

```javascript
// 场景：主节点 mongo1 突然宕机

// 1. 从节点检测到主节点不可用（心跳超时）
// 2. mongo2 或 mongo3 发起选举
// 3. 新的主节点被选举出来
// 4. 应用自动重定向到新主节点

// 验证：查看新状态
rs.status()

// 新主节点应该是原来的从节点之一
```

## 副本集成员数量设计

| 成员数 | 仲裁节点 | 可容忍故障数 | 适用场景 |
|-------|---------|-------------|---------|
| 3 | 0 | 1 | 最小生产环境 |
| 5 | 0 | 2 | 标准生产环境 |
| 3 | 1 | 0 | 成本敏感场景 |
| 5 | 1 | 1 | 成本+可用性平衡 |

> **建议**：生产环境至少 3 个数据节点，避免单点故障。

## 总结

副本集核心概念：

| 组件 | 说明 |
|-----|------|
| Primary | 主节点，处理写操作 |
| Secondary | 从节点，复制数据，提供读取 |
| Arbiter | 仲裁节点，只参与选举 |
| oplog | 操作日志，记录写操作用于复制 |

**选举机制**：
- 基于 Raft 算法
- 触发条件：主节点不可用
- 得票超过半数才能成为主节点
- 优先级高的节点更容易成为主节点

**读取偏好**：
- `primary`：强一致
- `secondary`：分担负载，可能有延迟
- `nearest`：最低延迟

---

**下一步，你可以：**

- 了解 [Replica Set 副本集同步原理：oplog](/database/mongodb/oplog)
- 学习 [MongoDB 分片集群架构](/database/mongodb/sharded-cluster)
- 掌握 [MongoDB 高可用故障转移与选举原理](/database/mongodb/failover)
