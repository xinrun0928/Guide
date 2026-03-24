# TiDB 模块

## 概述

TiDB 是一款开源的分布式关系型数据库，兼容 MySQL 协议，支持水平扩展、强一致性和高可用。适用于 OLTP 水平扩展、HTAP 混合负载等场景。

## 核心概念

| 组件 | 职责 |
|-----|------|
| TiDB Server | SQL 解析、优化、执行（无状态） |
| TiKV | 分布式 KV 存储，Raft 复制，MVCC |
| PD | 调度中心，元信息管理，TSO 分配 |
| TiFlash | 列式存储，OLAP 分析 |

## 快速导航

### 基础入门
- [TiDB 整体架构](/database/tidb/architecture) - 四大核心组件介绍
- [MySQL 兼容性](/database/tidb/mysql-compatibility) - 从 MySQL 迁移指南
- [应用场景](/database/tidb/use-case) - 典型业务场景分析

### 存储引擎 TiKV
- [Region 数据分片](/database/tidb/tikv-region) - TiKV 的核心数据单元
- [Raft 协议](/database/tidb/raft) - 强一致性保证
- [MVCC 并发控制](/database/tidb/mvcc) - 多版本与快照隔离
- [Leader 调度](/database/tidb/leader-schedule) - 热点问题的终结者
- [TiKV 与 TiDB 的关系](/database/tidb/tikv-tidb) - 存储与计算的协作

### SQL 引擎
- [SQL 执行引擎](/database/tidb/sql-engine) - 从 SQL 到 KV 的转换
- [MPP 并行查询](/database/tidb/mpp) - 大规模并行处理
- [DDL 分布式执行](/database/tidb/ddl) - 在线表变更
- [查询优化器](/database/tidb/optimizer) - 智能执行计划
- [Percolator 事务](/database/tidb/percolator) - 分布式事务原理

### 集群管理与运维
- [PD 调度策略](/database/tidb/pd-schedule) - 数据分布的智能大脑
- [扩缩容](/database/tidb/scale) - 弹性伸缩的艺术
- [Binlog 与 DM](/database/tidb/binlog-dm) - 数据同步工具
- [备份恢复](/database/tidb/backup) - 数据安全的最后防线
- [监控体系](/database/tidb/monitor) - 洞察集群的每一个角落
- [故障排查](/database/tidb/troubleshoot) - 从现象到根因

### HTAP 能力
- [TiFlash 列式存储](/database/tidb/tiflash) - 实时分析引擎
- [HTAP 实战](/database/tidb/htap-practice) - 混合负载最佳实践
- [TiSpark 集成](/database/tidb/tispark) - 大数据生态桥梁
- [HTAP 能力详解](/database/tidb/htap) - 存储计算分离架构

### 面试准备
- [TiDB 面试汇总](/database/tidb/interview-summary) - 高频问题与深度解答

## 推荐学习路径

```
入门 → 架构理解 → 核心原理 → 运维实践 → 面试冲刺
```

1. **入门**：阅读架构概述和应用场景
2. **架构理解**：掌握 TiDB Server、TiKV、PD 的职责
3. **核心原理**：深入 Raft、MVCC、Percolator
4. **运维实践**：学习扩缩容、监控、备份
5. **面试冲刺**：回顾高频面试问题
