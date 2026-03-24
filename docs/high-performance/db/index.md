# 数据库性能优化

凌晨 2 点，你被一阵急促的告警铃声惊醒。

监控系统显示：数据库 CPU 飙升至 98%，响应时间从 50ms 飙升到 8 秒。用户开始疯狂投诉，订单量断崖式下跌。

你赶紧登录数据库，执行 `show processlist`——好家伙，几百个慢查询堵在那里。其中一条 SQL 跑了整整 45 秒，扫描了全表 300 万行数据。

你冷汗直流：这 SQL 昨天还好好的，今天怎么突然慢了？

这是每一个后端工程师都可能遇到的真实场景。**数据库是大多数系统的性能瓶颈所在，而数据库优化，是每个工程师的必修课。**

本模块系统讲解 SQL 优化、MySQL 调优、Redis 性能优化、NoSQL 与搜索引擎优化，助你成为数据库性能专家。

---

## 模块速览

### SQL 优化与执行计划

| 文档 | 简介 |
|-----|-----|
| [慢查询定位与分析](/high-performance/db/sql-slow) | 开启慢查询日志，定位问题 SQL |
| [EXPLAIN 执行计划解读](/high-performance/db/explain) | 读懂执行计划每个字段的含义 |
| [索引优化全攻略](/high-performance/db/index-optimize) | 索引设计原则与最佳实践 |
| [JOIN 优化与 MRR](/high-performance/db/join-optimize) | JOIN 原理与优化技巧 |
| [filesort 与临时表](/high-performance/db/filesort-temporary) | 何时产生，如何避免 |
| [分页查询优化](/high-performance/db/pagination) | 深分页问题的解决方案 |
| [COUNT(*) 优化](/high-performance/db/count-optimize) | 飞龙表的处理方式 |
| [批量操作优化](/high-performance/db/batch-optimize) | 批量插入、更新、删除 |

### MySQL 调优

| 文档 | 简介 |
|-----|-----|
| [MySQL 配置参数调优](/high-performance/db/mysql-config) | 核心配置项解读与调优 |
| [连接池配置与调优](/high-performance/db/connection-pool) | 连接池大小计算与配置 |
| [并发控制：MVCC 与锁](/high-performance/db/concurrency) | 事务隔离与锁机制 |
| [读写分离实战](/high-performance/db/read-write) | 主从复制与延迟处理 |
| [热点行问题解决](/high-performance/db/hot-row) | 高并发下的行锁竞争 |

### Redis 性能优化

| 文档 | 简介 |
|-----|-----|
| [Redis 大 Key 问题](/high-performance/db/redis-big-key) | 大 Key 的识别与处理 |
| [Redis 热 Key 问题](/high-performance/db/redis-hot-key) | 热 Key 的发现与解决 |
| [Redis 内存优化](/high-performance/db/redis-memory) | 内存碎片、存储优化 |
| [Redis 持久化策略](/high-performance/db/redis-persistence) | RDB、AOF 详解与选择 |
| [Redis 管道与事务](/high-performance/db/redis-pipeline) | 批量操作优化 |
| [Redis 集群优化](/high-performance/db/redis-cluster-optimize) | 集群选型与运维 |

### NoSQL 与搜索引擎

| 文档 | 简介 |
|-----|-----|
| [MongoDB 优化实战](/high-performance/db/mongodb-optimize) | 索引设计、查询优化 |
| [ES 查询优化](/high-performance/db/es-query) | 分片策略、查询缓存 |
| [ES 写入优化](/high-performance/db/es-write) | 批量写入、刷新策略 |
| [ClickHouse 高性能实战](/high-performance/db/clickhouse) | 列式存储与向量化执行 |

---

## 数据库优化的三个层次

### 第一层：SQL 优化

SQL 优化是最基础也是最重要的优化手段。很多性能问题，只需要一条索引就能解决。

关键点：

- 学会读 `EXPLAIN` 执行计划
- 理解索引失效的常见场景
- 避免全表扫描和filesort
- 控制 JOIN 的复杂度

### 第二层：MySQL 调优

当 SQL 层面优化到极致后，下一步是 MySQL 本身的调优。

关键点：

- 合理配置缓冲池大小
- 选择合适的隔离级别
- 优化锁策略，减少锁竞争
- 利用读写分离分担压力

### 第三层：架构优化

架构层面的优化，解决的是更深层次的问题。

关键点：

- 分库分表：水平拆分突破单库瓶颈
- Redis 缓存：热点数据缓存减少数据库压力
- 搜索引擎：复杂查询交给 ES
- 分析型数据库：OLAP 场景用 ClickHouse

---

## 学习路径建议

### 入门：从 SQL 优化开始

建议先学习**慢查询定位**和**执行计划解读**。

这是数据库优化的基础。学会定位慢 SQL，读懂执行计划，你就迈出了数据库优化的第一步。

### 进阶：深入 MySQL 机制

学习**索引优化**、**JOIN 原理**、**并发控制**等核心知识点。

这些内容需要深入理解原理，不能只记结论。建议配合实际案例，边学边练。

### 高级：架构层面的优化

学习**分库分表**、**Redis 缓存**、**搜索引擎优化**等架构知识。

这些是解决大规模数据场景的必备技能，也是高级工程师的核心竞争力。

---

## 延伸思考

数据库优化有个「80/20 法则」：80% 的性能问题可以通过 20% 的优化手段解决。

这条法则告诉我们：**不要过度优化，先解决最明显的问题。**

一条缺失的索引、一个不合理的 JOIN、一个深分页查询——这些往往是性能问题的罪魁祸首。

掌握了 SQL 优化和 MySQL 调优，你就解决了大部分问题。至于分库分表、NoSQL 等架构优化，那是后续进阶的内容。

**记住：先把简单的做好，再考虑复杂的。**
