# SQL Server 面试知识体系

SQL Server 是微软的企业级关系型数据库，广泛应用于 Windows 生态的企业系统中。相比 MySQL，SQL Server 提供了更完善的高可用方案、更强大的性能调优工具，以及与 .NET 生态的无缝集成。

本模块涵盖 SQL Server 的核心知识点，从基础架构到高级特性，从性能调优到高可用集群，帮你全面掌握 SQL Server。

---

## 模块目录

### SQL Server 基础

了解 SQL Server 的核心架构和存储结构。

- [SQL Server 整体架构：关系引擎与存储引擎](/database/sqlserver/architecture)
- [SQL Server 页面与区（Page & Extent）存储结构](/database/sqlserver/page-extent)
- [SQL Server 数据库文件：主数据文件、日志文件、文件组](/database/sqlserver/file-group)
- [SQL Server 日志体系：LDF 与 Write-Ahead Logging](/database/sqlserver/transaction-log)
- [SQL Server T-SQL 基础与常用语法](/database/sqlserver/tsql-basics)
- [SQL Server 分页：OFFSET FETCH vs CTE 分页](/database/sqlserver/pagination)

### 索引与查询

掌握 SQL Server 的索引结构和查询优化技术。

- [SQL Server 索引结构：B-Tree 与聚集索引、非聚集索引](/database/sqlserver/index-structure)
- [SQL Server 聚集索引 vs 非聚集索引设计原则](/database/sqlserver/clustered-index)
- [SQL Server 索引类型：位图索引、包含列索引、过滤索引](/database/sqlserver/index-type)
- [SQL Server 执行计划分析：SSMS 与 SET STATISTICS IO ON](/database/sqlserver/explain)
- [SQL Server 慢查询优化实战](/database/sqlserver/slow-query)
- [SQL Server 统计信息与执行计划重编译](/database/sqlserver/statistics)

### 事务与锁

深入理解 SQL Server 的事务机制和锁策略。

- [SQL Server 事务日志与 Write-Ahead Logging](/database/sqlserver/wal)
- [SQL Server 隔离级别：脏读、不可重复读、幻读、快照隔离](/database/sqlserver/isolation)
- [SQL Server 锁模式：共享锁、排他锁、更新锁、意向锁](/database/sqlserver/lock-mode)
- [SQL Server 死锁产生条件与排查优化](/database/sqlserver/deadlock)
- [SQL Server 乐观并发与行版本控制](/database/sqlserver/optimistic-concurrency)

### 性能与调优

学会监控和优化 SQL Server 的性能。

- [SQL Server 性能监控：DMV 与扩展事件（XEvent）](/database/sqlserver/dmv)
- [SQL Server 查询优化器与计划指南](/database/sqlserver/query-optimizer)
- [SQL Server 内存管理：Buffer Pool 与 Columnstore](/database/sqlserver/memory)
- [SQL Server 表分区：分区函数与分区方案](/database/sqlserver/partition)
- [SQL Server 内存优化表（In-Memory OLTP）](/database/sqlserver/in-memory)
- [SQL Server 列存储索引与批处理模式](/database/sqlserver/columnstore)

### 高可用与集群

掌握 SQL Server 的高可用解决方案。

- [SQL Server Always On 可用性组架构](/database/sqlserver/always-on)
- [SQL Server 故障转移群集（FCI）](/database/sqlserver/fci)
- [SQL Server 镜像（Database Mirroring）](/database/sqlserver/mirroring)
- [SQL Server 复制：快照复制、事务复制、合并复制](/database/sqlserver/replication)
- [SQL Server 备份策略与恢复模式](/database/sqlserver/backup)
- [SQL Server 登台环境与数据库迁移](/database/sqlserver/migration)

### 面试汇总

回顾 SQL Server 的核心知识点，准备面试。

- [SQL Server 面试高频问题汇总](/database/sqlserver/interview-summary)

---

## 学习路径

```
第一阶段：基础入门
├── 架构与存储
│   ├── SQL Server 整体架构
│   ├── 页面与区结构
│   └── 文件组与日志
├── T-SQL 基础
│   ├── 常用语法
│   └── 分页查询
└── 索引基础
    ├── B-Tree 结构
    └── 聚集 vs 非聚集索引

第二阶段：核心原理
├── 事务机制
│   ├── WAL 原理
│   └── 隔离级别
├── 锁机制
│   ├── 锁模式
│   ├── 死锁处理
│   └── 乐观并发
└── 查询优化
    ├── 执行计划分析
    ├── 慢查询优化
    └── 统计信息

第三阶段：高级特性
├── 性能调优
│   ├── DMV 监控
│   ├── 查询优化器
│   └── 内存管理
├── 表分区
│   ├── 分区设计
│   └── 滑动窗口
├── 高级索引
│   ├── 列存储索引
│   └── In-Memory OLTP
└── 高可用
    ├── Always On
    ├── FCI
    └── 备份恢复

第四阶段：面试准备
└── 面试高频问题汇总
```

---

## 与其他数据库对比

| 特性 | SQL Server | MySQL | PostgreSQL |
|-----|-----------|-------|------------|
| **存储单位** | 页 8KB | InnoDB 页 16KB | 页 8KB |
| **索引结构** | B-Tree | B+Tree | B-Tree/GiST/GIN |
| **聚集索引** | 1 个 | InnoDB 1 个 | 可选 |
| **事务日志** | LDF (WAL) | redo log | WAL |
| **高可用方案** | Always On | 主从/MGR | 流复制/ Patroni |
| **适用场景** | 企业 Windows 环境 | Web/轻量级 | 复杂查询/扩展性 |

---

## 推荐阅读

如果你已经掌握 SQL Server，可以继续学习其他数据库模块：

- [MySQL 面试知识体系](/database/mysql/index) - Web 后端最常用的数据库
- [Redis 核心知识点](/database/redis/index) - 缓存与高性能利器
- [PostgreSQL 面试知识体系](/database/postgresql/index) - 功能强大的开源数据库
- [Oracle 面试知识体系](/database/oracle/index) - 企业级数据库标杆
