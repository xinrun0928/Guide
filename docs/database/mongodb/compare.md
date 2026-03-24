# MongoDB vs MySQL vs Redis 选型对比

「我应该用哪个数据库？」这个问题没有标准答案，取决于你的业务场景。

这一篇，我们从多个维度对比 MongoDB、MySQL 和 Redis，帮助你做出正确的技术选型。

## 基本特性对比

| 特性 | MongoDB | MySQL | Redis |
|-----|--------|-------|-------|
| **类型** | 文档数据库 | 关系数据库 | KV 数据库 |
| **数据模型** | BSON 文档 | 关系表 | 键值对 |
| **Schema** | 灵活（无模式） | 固定（需预定义） | 无结构 |
| **事务** | 单文档 ACID，4.0+ 多文档事务 | ACID | 有限事务支持 |
| **扩展方式** | 水平扩展（分片） | 垂直扩展为主 | 水平扩展 |
| **查询语言** | MongoDB Query API | SQL | Redis 命令 |

## 数据模型对比

### MySQL：关系模型

```sql
-- 用户表
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50),
    email VARCHAR(100)
);

-- 订单表
CREATE TABLE orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    amount DECIMAL(10,2),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### MongoDB：文档模型

```javascript
// 单个文档包含所有信息
{
  _id: ObjectId("..."),
  username: "张三",
  email: "zhang@example.com",
  orders: [
    {product: "iPhone", amount: 8999},
    {product: "MacBook", amount: 12999}
  ]
}
```

### Redis：KV 模型

```redis
# 字符串
SET user:123 '{"name":"张三","age":28}'

# Hash
HSET user:123 name "张三" age "28"

# Set
SADD tags:javascript 1001 1002 1003
```

## 适用场景对比

### MongoDB 适用场景

| 场景 | 原因 |
|-----|------|
| **内容管理/CMS** | 灵活的文档结构，字段差异大的内容 |
| **用户画像** | 一对多关系，嵌套数据结构 |
| **物联网时序数据** | 高写入性能，支持时序集合 |
| **实时分析** | 聚合管道，地理空间查询 |
| **快速原型开发** | 无 Schema，快速迭代 |
| **大数据量水平扩展** | 原生分片支持 |

### MySQL 适用场景

| 场景 | 原因 |
|-----|------|
| **金融交易** | 强 ACID 事务 |
| **订单系统** | 复杂关联查询，强一致性 |
| **ERP/CRM** | 结构化数据，多表关联 |
| **传统业务系统** | 成熟稳定，生态完善 |
| **需要复杂 JOIN** | 原生 SQL JOIN 支持 |
| **强 schema 需求** | 预定义表结构，数据校验 |

### Redis 适用场景

| 场景 | 原因 |
|-----|------|
| **缓存** | 超高读写性能，丰富数据结构 |
| **会话存储** | 内存存储，快速访问 |
| **实时排行榜** | Sorted Set 支持 ZSET |
| **消息队列** | Pub/Sub 功能 |
| **分布式锁** | SETNX + Lua 脚本 |
| **限流** | 计数器 + 过期时间 |
| **实时投票/计数** | INCR/INCRBY 高效原子操作 |

## 性能对比

### 写入性能

```
写入速度（ops/s）：越高越好

Redis: 100,000 - 1,000,000+
MongoDB: 10,000 - 100,000
MySQL: 1,000 - 10,000

（具体数值取决于硬件、数据量、并发模型）
```

### 读取性能

| 场景 | 推荐 | 说明 |
|-----|------|------|
| KV 精确查找 | Redis | O(1) 复杂度 |
| 范围查询 | MySQL | B+Tree 索引 |
| 复杂条件查询 | MongoDB/MySQL | 索引支持 |
| 全文搜索 | Elasticsearch | 专业搜索引擎 |

### 延迟对比

| 数据库 | 典型延迟 | 说明 |
|-------|---------|------|
| Redis | 0.1 - 1ms | 纯内存操作 |
| MongoDB | 1 - 10ms | 内存 + 磁盘 |
| MySQL | 1 - 10ms | InnoDB 缓存池 |

## 事务能力对比

### MySQL：完整 ACID

```sql
START TRANSACTION;

UPDATE accounts SET balance = balance - 1000 WHERE id = 1;
UPDATE accounts SET balance = balance + 1000 WHERE id = 2;

COMMIT;  -- 保证原子性，一致性，持久性
```

### MongoDB：文档级 ACID

```javascript
// 单文档操作是原子的
db.accounts.updateOne(
  {_id: 1},
  {$inc: {balance: -1000}}
)

// 4.0+ 多文档事务
session.startTransaction()
session.getDatabase("myapp").accounts.updateOne(...)
session.commitTransaction()
```

### Redis：有限事务

```redis
MULTI
SET key1 value1
SET key2 value2
EXEC
-- 原子但不回滚（EXEC 前不检查错误）
```

## 扩展能力对比

### 垂直扩展 vs 水平扩展

| 扩展方式 | MongoDB | MySQL | Redis |
|---------|---------|-------|-------|
| 垂直扩展 | 支持 | 支持 | 支持 |
| 水平扩展（分片） | 原生支持 | 需要中间件（ShardingSphere） | 原生支持（Cluster） |
| 数据再平衡 | 自动 | 手动 | 自动 |

### 分片策略

```javascript
// MongoDB 分片
sh.shardCollection("myapp.orders", {userId: "hashed"})

// MySQL 分库分表（需要 ShardingSphere）
// 配置分片规则

// Redis Cluster
redis-cli --cluster create 192.168.1.1:7000 192.168.1.2:7000 192.168.1.3:7000
```

## 数据安全对比

| 特性 | MongoDB | MySQL | Redis |
|-----|---------|-------|-------|
| **持久化** | Journal + Checkpoint | redo log | 可选 RDB/AOF |
| **事务日志** | oplog | binlog | AOF |
| **复制** | Replica Set | 主从复制 | 主从复制 |
| **故障恢复** | 自动选举 | 半自动 | 手动/自动 |
| **备份恢复** | mongodump | mysqldump | RDB/AOF |

## 运维复杂度

| 维度 | MongoDB | MySQL | Redis |
|-----|---------|-------|-------|
| **学习曲线** | 中 | 中 | 低 |
| **运维工具** | mongosh, Ops Manager | MySQL Workbench | redis-cli |
| **监控** | Cloud/Atlas, mongostat | PMM, slow query log | redis INFO |
| **集群复杂度** | 高 | 中 | 中 |
| **社区生态** | 大 | 非常大 | 大 |

## 成本对比

| 维度 | MongoDB | MySQL | Redis |
|-----|---------|-------|-------|
| **开源版本** | Apache 协议 | GPL 协议 | BSD 协议 |
| **企业版** | 付费 | MySQL Enterprise | Redis Enterprise |
| **云服务** | Atlas | RDS, Aurora | Memorystore, Redis Labs |
| **硬件要求** | 中等 | 中等 | 高（内存密集） |

## 组合使用建议

### 常见架构组合

```
┌─────────────────────────────────────────────────────────────┐
│                         应用层                               │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
    ┌─────────┐         ┌─────────┐          ┌─────────┐
    │  Redis  │         │MongoDB  │          │  MySQL  │
    │ (缓存)  │         │(主存储) │          │ (分析)   │
    └─────────┘         └─────────┘          └─────────┘
```

| 组合 | 场景 |
|-----|------|
| **Redis + MySQL** | 缓存加速，读多写少 |
| **Redis + MongoDB** | 缓存 + 文档存储 |
| **MongoDB + MySQL** | 分工明确，各司其职 |
| **Redis + MongoDB + MySQL** | 全功能架构 |

### 具体场景示例

**场景 1：电商系统**

```
用户信息、订单 → MySQL（强一致性，复杂关联）
商品详情、评论 → MongoDB（灵活结构，高并发读取）
Session、购物车、热点数据 → Redis（高性能缓存）
排行榜、实时库存 → Redis（Sorted Set）
```

**场景 2：社交应用**

```
用户资料、动态 → MongoDB（文档模型）
消息队列 → Redis（Pub/Sub）
 Feed 缓存 → Redis（List）
 关注关系 → Redis（Set）
```

**场景 3：日志分析系统**

```
原始日志 → MongoDB（文档存储）
聚合统计 → MongoDB Aggregation
实时排行 → Redis（ZSET）
冷数据归档 → MySQL（历史分析）
```

## 选型决策树

```
数据需要强一致性？
├── 是 → MySQL
│         └── 考虑事务强度选择隔离级别
└── 否 ↓
数据模式固定？
├── 是 → MySQL
└── 否 ↓
数据结构复杂/嵌套？
├── 是 → MongoDB
└── 否 ↓
需要超高性能缓存？
├── 是 → Redis
└── 否 ↓
考虑团队熟悉度、项目周期、运维能力
```

## 总结

| 维度 | MongoDB | MySQL | Redis |
|-----|---------|-------|-------|
| **数据模型** | 文档（灵活） | 关系（严谨） | KV（简单） |
| **事务** | 单文档 ACID，多文档（4.0+） | 完整 ACID | 有限 |
| **查询能力** | 丰富 | SQL 强大 | 简单 |
| **写入性能** | 高 | 中 | 极高 |
| **扩展性** | 原生分片 | 需中间件 | Cluster |
| **一致性** | 最终一致（可配置） | 强一致 | 最终一致 |
| **适用场景** | 灵活结构、实时分析 | 强事务、复杂关联 | 缓存、计数器、排行榜 |

**一句话总结**：
- **MySQL**：当你的数据需要严谨的结构、复杂的关系、强一致的事务时
- **MongoDB**：当你的数据结构灵活、追求开发速度、需要水平扩展时
- **Redis**：当你需要超高性能的缓存、计数器、实时特性时

---

**下一步，你可以：**

- 掌握 [MongoDB 面试高频问题汇总](/database/mongodb/interview-summary)
