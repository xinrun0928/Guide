# MySQL

MySQL 是目前最流行的开源关系型数据库，几乎每个 Java 后端工程师都需要熟练掌握它。

从增删改查到事务隔离级别，从索引原理到 SQL 优化，从主从复制到分库分表——这一模块覆盖 MySQL 的核心知识点。

---

## 模块内容

### MySQL 基础

先从整体架构入手，理解 MySQL 的分层设计。

- [MySQL 整体架构：连接层、服务层、存储引擎层](/database/mysql/architecture)
- [MySQL 存储引擎对比：InnoDB vs MyISAM vs Memory](/database/mysql/engine-compare)
- [InnoDB 存储引擎特性详解](/database/mysql/innodb)
- [MySQL 数据类型选择与优化](/database/mysql/data-type)
- [SQL 执行过程：从客户端到结果返回](/database/mysql/sql-execution)

### 索引与数据结构

索引是 MySQL 面试的重灾区，必须深入理解。

- [MySQL 索引体系：B+ 树索引、Hash 索引、全文索引、空间索引](/database/mysql/index-type)
- [B+ 树索引结构与查询原理](/database/mysql/btree-index)
- [B+ 树 vs B 树 vs 红黑树 vs 哈希表](/database/mysql/index-structure-compare)
- [聚簇索引 vs 非聚簇索引（二级索引）](/database/mysql/clustered-index)
- [回表查询与覆盖索引](/database/mysql/covering-index)
- [联合索引与最左前缀原则](/database/mysql/composite-index)
- [索引下推（Index Condition Pushdown）](/database/mysql/index-pushdown)
- [索引失效的 11 种情况](/database/mysql/index-invalid)
- [索引创建原则与使用注意事项](/database/mysql/index-design)

### 事务与隔离级别

事务是数据库最重要的特性之一。

- [事务的 ACID 特性与实现原理](/database/mysql/transaction-acid)
- [并发事务问题：脏读、不可重复读、幻读](/database/mysql/transaction-problem)
- [四种隔离级别：Read Uncommitted ~ Serializable](/database/mysql/isolation-level)
- [MVCC 原理：ReadView 与版本链](/database/mysql/mvcc)
- [MVCC 在 RC 和 RR 级别下的差异](/database/mysql/mvcc-rc-rr)

### 锁机制

锁是并发控制的核心手段。

- [全局锁与表级锁：MDL 锁](/database/mysql/table-lock)
- [行锁与 Next-Key Lock：记录锁、间隙锁、临键锁](/database/mysql/row-lock)
- [意向锁：IX 与 IS](/database/mysql/intention-lock)
- [两阶段锁协议与死锁避免](/database/mysql/two-phase-lock)
- [死锁产生条件与处理策略](/database/mysql/deadlock)

### SQL 优化

写出高效的 SQL，是每个开发者的必修课。

- [慢查询定位：slow_query_log 与 long_query_time](/database/mysql/slow-query)
- [EXPLAIN 执行计划详解：type、key、Extra 字段](/database/mysql/explain)
- [Using filesort 与 Using temporary 优化](/database/mysql/filesort-temporary)
- [JOIN 原理与嵌套循环连接（NLJ）](/database/mysql/join-optimize)
- [分页查询优化：延迟关联与游标分页](/database/mysql/pagination)

### 数据库架构

扩展和可用性是生产环境的必备知识。

- [主从复制原理：binlog、relaylog、IO 线程、SQL 线程](/database/mysql/replication)
- [主从复制模式：异步复制、半同步复制、全同步复制](/database/mysql/replication-mode)
- [主从延迟原因与解决方案](/database/mysql/replication-lag)
- [读写分离架构与数据一致性](/database/mysql/read-write-separation)
- [MySQL 高可用方案：主备切换、MGR、MHA、Galera](/database/mysql/ha-solution)
- [分库分表：垂直拆分与水平拆分](/database/mysql/sharding)

---

## 面试核心考点

| 高频考点 | 关联文档 |
|---|---|
| 索引失效场景 | [索引失效的 11 种情况](/database/mysql/index-invalid) |
| MVCC 原理 | [MVCC 原理](/database/mysql/mvcc)、[MVCC 在 RC 和 RR 下差异](/database/mysql/mvcc-rc-rr) |
| 隔离级别与并发问题 | [隔离级别](/database/mysql/isolation-level)、[并发问题](/database/mysql/transaction-problem) |
| MySQL 日志体系 | [binlog、redo log、undo log](/database/mysql/mysql-logs) |
| 慢查询优化 | [慢查询定位](/database/mysql/slow-query)、[EXPLAIN](/database/mysql/explain) |

---

## 留给你的问题

MySQL 在 RC 隔离级别下，事务 T1 读取了某行数据，事务 T2 随后更新并提交了同一行，事务 T1 再次读取时能看到 T2 的修改吗？

答案是肯定的——因为 RC 级别下，每次读取都会生成新的 ReadView。这个问题的深入理解，关系到你对 MVCC 的真正掌握。
