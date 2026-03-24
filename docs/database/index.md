# 数据库

数据库是软件系统的核心基础设施，本模块全面覆盖主流关系型数据库与 NoSQL 数据库的核心知识点。

---

## 模块总览

| 数据库 | 定位 | 文件数 | 说明 |
|-------|------|--------|------|
| [MySQL](/database/mysql/index) | 关系型首选 | 54 篇 | 索引、事务、锁、SQL 优化、主从复制、分库分表 |
| [Redis](/database/redis/index) | 缓存/分布式存储 | 43 篇 | 持久化、集群、缓存策略、应用场景 |
| [MongoDB](/database/mongodb/index) | 文档型 NoSQL | 35 篇 | 副本集、分片集群、聚合管道、WiredTiger |
| [PostgreSQL](/database/postgresql/index) | 功能型关系型 | 34 篇 | MVCC、并行查询、丰富索引类型、PostGIS |
| [Oracle](/database/oracle/index) | 企业级关系型 | 35 篇 | RAC、Data Guard、PL/SQL、性能调优 |
| [SQL Server](/database/sqlserver/index) | Windows 生态 | 32 篇 | Always On、列存储、内存优化表 |
| [SQLite](/database/sqlite/index) | 嵌入式 | 7 篇 | 轻量级、无服务器、 WAL 模式 |
| [MariaDB](/database/mariadb/index) | MySQL 分支 | 15 篇 | Galera 集群、线程池、CONNECT 引擎 |
| [达梦 (DM)](/database/dameng/index) | 国产关系型 | 24 篇 | 与 Oracle 兼容、数据守护、MPP |
| [TiDB](/database/tidb/index) | 分布式关系型 | 24 篇 | NewSQL、HTAP、水平扩展 |
| [HBase](/database/hbase/index) | 列族 NoSQL | 21 篇 | 大数据存储、Region 分片、WAL |
| [时序数据库](/database/tsdb/concept) | TSDB | — | InfluxDB、TDengine、Prometheus |

---

## 核心知识体系

### 关系型数据库共同主题

| 主题 | MySQL | PostgreSQL | Oracle | 核心要点 |
|------|-------|-----------|--------|---------|
| 索引结构 | B+ 树 | B-Tree / GIN / GiST | B-Tree / 位图 | 索引选择与最左前缀 |
| 事务隔离 | MVCC (RC/RR) | MVCC (SSI) | MVCC + SCN | 隔离级别与并发问题 |
| 锁机制 | 行锁 + 意向锁 | 行锁 + 乐观锁 | TM/TX 锁 | 死锁避免与排查 |
| SQL 优化 | EXPLAIN / 慢查询 | EXPLAIN / pg_stat | AWR / SQL Tuning | 执行计划分析 |
| 主从复制 | binlog | 流复制 / 逻辑复制 | Data Guard | 复制模式与延迟 |
| 高可用 | MGR / MHA | Patroni + etcd | RAC + DG | 故障转移与一致性 |

### NoSQL 数据库共同主题

| 主题 | Redis | MongoDB | HBase | Cassandra | 核心要点 |
|------|-------|---------|-------|-----------|---------|
| 数据模型 | K-V / 结构化 | 文档 | 列族 | 列族 | 模型设计原则 |
| 分布式 | Cluster / Sentinel | Sharded Cluster | Region 分片 | Gossip | 数据分布策略 |
| 一致性 | 最终一致 | 可调一致 | 强一致 | 最终一致 | CAP 权衡 |
| 索引 | Hash / B+ 树 | B-Tree / 地理 | 行键索引 | 二级索引 | 索引类型与使用 |

---

## 面试核心路线图

```
关系型数据库面试路线：

MySQL 索引原理（B+ 树）
    ↓
MySQL 事务与 MVCC
    ↓
MySQL 锁机制与死锁
    ↓
MySQL SQL 优化与执行计划
    ↓
MySQL 主从复制与高可用
    ↓
分库分表与分布式中间件
```

```
NoSQL 数据库面试路线：

Redis 数据类型与底层结构
    ↓
Redis 持久化与复制
    ↓
Redis 集群与哨兵
    ↓
Redis 缓存策略（穿透/击穿/雪崩）
    ↓
MongoDB 分片集群原理
    ↓
HBase 存储架构与读写流程
```

---

## 学习建议

### 按需选择数据库

| 业务场景 | 推荐数据库 | 理由 |
|---------|-----------|------|
| 互联网 OLTP | MySQL / TiDB | 高并发、强事务、水平扩展 |
| 数据仓库/分析 | PostgreSQL / ClickHouse | 丰富索引、列存储、并行查询 |
| 缓存/会话 | Redis / Memcached | 内存存储、高性能、数据结构 |
| 文档存储 | MongoDB | 灵活 Schema、强伸缩性 |
| 大数据日志 | HBase / InfluxDB | 时序写入、压缩存储 |
| 国产化替代 | 达梦 / TiDB | Oracle 兼容、信创支持 |

### 学习优先级建议

**第一梯队（必学）：**
- MySQL 索引与事务
- Redis 持久化与集群
- 缓存经典三问（穿透/击穿/雪崩）

**第二梯队（深入）：**
- MySQL 主从复制与分库分表
- Redis 分布式锁
- MongoDB 分片集群

**第三梯队（扩展）：**
- TiDB 分布式架构
- PostgreSQL 高级特性
- HBase 大数据场景

### 避免的常见误区

| 误区 | 正确认知 |
|-----|---------|
| 索引越多越好 | 每次写入都要维护索引，增加开销 |
| Redis 是纯内存数据库 | 支持 RDB/AOF 持久化 |
| NoSQL 不支持事务 | MongoDB 4.0+ 支持多文档事务 |
| 分库分表能解决一切性能问题 | 引入跨节点查询和分布式事务复杂度 |

---

## 相关模块

- [Redis 缓存策略](/database/redis/cache-pattern) — 穿透、击穿、雪崩详解
- [MySQL 分库分表](/database/mysql/sharding) — 垂直与水平拆分
- [分布式系统](/distributed/index) — 分布式事务与一致性
- [高性能与高可用](/high-performance/index) — 系统性能优化思路
