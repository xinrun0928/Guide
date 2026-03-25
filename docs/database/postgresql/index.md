# PostgreSQL

如果说 MySQL 是互联网的标配，那 PostgreSQL 就是那个「功能丰富度远超你想象」的选择。

PostgreSQL 不仅是关系型数据库，它还支持 JSON/JSONB、地理空间数据、全文检索、窗口函数、CTE 递归查询——几乎涵盖了所有高级特性。

---

## 模块内容

### PostgreSQL 基础

从整体架构入手，理解 PostgreSQL 的设计哲学。

- [PostgreSQL 概述与核心特性](/database/postgresql/overview)
- [PostgreSQL 与 MySQL 核心差异对比](/database/postgresql/mysql-compare)
- [PostgreSQL 架构：连接管理器、查询引擎、存储引擎、索引机制](/database/postgresql/architecture)
- [PostgreSQL 常用数据类型与高级类型](/database/postgresql/data-type)
- [PostgreSQL 分页查询：OFFSET vs Keyset Cursor](/database/postgresql/pagination)

### MVCC 与事务

PostgreSQL 的 MVCC 实现与 MySQL 有本质区别。

- [PostgreSQL MVCC 原理：xmin、xmax、tuple 可见性判断](/database/postgresql/mvcc)
- [PostgreSQL 事务隔离级别：Read Committed vs Repeatable Read vs Serializable](/database/postgresql/isolation)
- [PostgreSQL 多版本实现与 VACUUM 机制](/database/postgresql/vacuum)
- [PostgreSQL 锁机制：表级锁、行级锁、死锁检测](/database/postgresql/lock)
- [PostgreSQL 事务回滚与 savepoint](/database/postgresql/transaction)

### 索引

PostgreSQL 的索引类型远多于 MySQL。

- [PostgreSQL 索引类型：B-Tree、Hash、GIN、GiST、BRIN、Partial Index](/database/postgresql/index-type)
- [PostgreSQL 复合索引与最左前缀原则](/database/postgresql/composite-index)
- [PostgreSQL 表达式索引与函数索引](/database/postgresql/expression-index)
- [PostgreSQL 索引失效场景与 EXPLAIN 分析](/database/postgresql/index-invalid)
- [PostgreSQL 索引膨胀与 REINDEX 维护](/database/postgresql/index-bloat)
- [PostgreSQL 全文检索：tsvector、tsquery 与全文索引](/database/postgresql/fulltext)

### 性能优化

PostgreSQL 的性能调优有自己的一套方法论。

- [PostgreSQL 执行计划分析：Seq Scan、Index Scan、Hash Join、Nested Loop](/database/postgresql/explain)
- [PostgreSQL 慢查询分析与 pg_stat_statements](/database/postgresql/slow-query)
- [PostgreSQL 统计信息与成本估算模型](/database/postgresql/statistics)
- [PostgreSQL 连接池：PgBouncer vs Pgpool-II](/database/postgresql/connection-pool)
- [PostgreSQL 分区表：Range、List、Hash 分区](/database/postgresql/partition)
- [PostgreSQL 并行查询与多核利用](/database/postgresql/parallel-query)
- [PostgreSQL 性能监控：pg_stat_activity、pg_stat_bgwriter](/database/postgresql/monitor)

### 高级特性

PostgreSQL 藏着大量高级特性。

- [PostgreSQL 触发器与规则系统](/database/postgresql/trigger)
- [PostgreSQL 存储过程：PL/pgSQL 入门](/database/postgresql/plpgsql)
- [PostgreSQL 函数重载与操作符重载](/database/postgresql/overload)
- [PostgreSQL 窗口函数：ROW_NUMBER、RANK、LAG、LEAD](/database/postgresql/window-function)
- [PostgreSQL CTE 与递归查询](/database/postgresql/cte)
- [PostgreSQL JSON/JSONB 数据类型与函数](/database/postgresql/json)
- [PostgreSQL PostGIS 空间数据库扩展](/database/postgresql/postgis)

### 高可用与扩展

企业级 PostgreSQL 必须面对的问题。

- [PostgreSQL 流复制（Streaming Replication）原理](/database/postgresql/streaming-replication)
- [PostgreSQL 主从切换与故障转移](/database/postgresql/failover)
- [PostgreSQL 逻辑复制 vs 物理复制](/database/postgresql/logical-replication)
- [PostgreSQL Citus 分布式集群扩展](/database/postgresql/citus)
- [PostgreSQL 备份与恢复：pg_dump、pg_basebackup、PITR](/database/postgresql/backup)
- [PostgreSQL 高可用方案：Patroni + etcd、PAF、Corosync](/database/postgresql/ha-solution)

---

## MySQL vs PostgreSQL 对比速查

| 特性 | MySQL | PostgreSQL |
|------|-------|------------|
| 事务隔离级别 | 4 种（默认 RR） | 4 种（默认 RC） |
| MVCC | undo log + ReadView | tuple + xmin/xmax + VACUUM |
| 索引类型 | B-Tree、Hash、全文、R-Tree | B-Tree、Hash、GIN、GiST、BRIN 等 |
| JSON 支持 | JSON 函数，较弱 | JSONB，强大且可建索引 |
| 地理空间 | MyISAM 阶段强，InnoDB 弱 | PostGIS 扩展，业界最强 |
| CTAS 支持 | 支持 | 支持，更丰富 |
| 窗口函数 | MySQL 8.0+ 支持 | 原生支持 |
| 分区表 | 分区较少 | 分区类型丰富（Range/List/Hash） |
| 扩展性 | 插件较少 | 扩展极强（PostGIS、pgvector 等） |

---

## 留给你的问题

PostgreSQL 的 VACUUM 机制是用来干什么的？为什么 MySQL 不需要类似的功能？

这个问题的答案，藏在两种数据库 MVCC 实现机制的根本差异里。
