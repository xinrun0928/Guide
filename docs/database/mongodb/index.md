# MongoDB

MongoDB 是一款开源的面向文档的 NoSQL 数据库，使用 BSON（二进制 JSON）格式存储数据。

## 模块概述

本模块全面介绍 MongoDB 的核心知识点，从基础概念到高级特性，涵盖面试中常见的技术问题。

## 学习路径

### 第一阶段：基础入门

| 文章 | 说明 |
|-----|------|
| [MongoDB 整体架构与适用场景](/database/mongodb/overview) | MongoDB 简介、核心特性、与 MySQL 的对比 |
| [MongoDB 数据模型](/database/mongodb/data-model) | 文档、集合、数据库，嵌入式 vs 引用式设计 |
| [MongoDB CRUD 操作](/database/mongodb/crud) | insert、find、update、delete 操作详解 |
| [MongoDB 数据类型与 BSON 规范](/database/mongodb/bson) | BSON 类型系统、ObjectId、Decimal128 |
| [MongoDB SQL 对比](/database/mongodb/sql-compare) | MongoDB 与 MySQL 概念的对应关系 |

### 第二阶段：索引与查询

| 文章 | 说明 |
|-----|------|
| [MongoDB 索引类型](/database/mongodb/index-type) | 单字段、复合、多键、地理空间、文本索引 |
| [MongoDB 索引管理](/database/mongodb/index-manage) | 创建、查看、删除、执行计划分析 |
| [MongoDB 慢查询分析与优化](/database/mongodb/slow-query) | explain() 用法、慢查询优化技巧 |
| [MongoDB 聚合管道](/database/mongodb/aggregation) | Aggregation Pipeline 入门 |
| [MongoDB 聚合阶段](/database/mongodb/aggregation-stage) | $match、$group、$sort、$lookup 详解 |
| [MongoDB $lookup 与 JOIN 对比](/database/mongodb/lookup) | $lookup 用法与 SQL JOIN 的对比 |

### 第三阶段：事务与并发

| 文章 | 说明 |
|-----|------|
| [MongoDB 多文档事务](/database/mongodb/transaction) | startSession、startTransaction 用法 |
| [MongoDB 事务隔离级别](/database/mongodb/transaction-isolation) | readConcern、writeConcern 配置 |
| [MongoDB 并发控制](/database/mongodb/concurrency) | 乐观锁与版本字段实现 |
| [MongoDB 锁机制](/database/mongodb/lock) | 全局锁、集合锁、文档锁 |

### 第四阶段：集群与高可用

| 文章 | 说明 |
|-----|------|
| [Replica Set 副本集](/database/mongodb/replica-set) | 主从复制、成员角色、选举机制 |
| [Replica Set oplog 同步](/database/mongodb/oplog) | oplog 同步原理、增量同步 |
| [MongoDB Sharded Cluster](/database/mongodb/sharded-cluster) | 分片集群架构、mongos、Config Server |
| [MongoDB 分片策略](/database/mongodb/sharding-strategy) | 范围分片 vs 哈希分片 |
| [MongoDB 分片键选择](/database/mongodb/shard-key) | 分片键选择原则、常见错误 |
| [MongoDB 均衡器与 Chunk 迁移](/database/mongodb/balancer) | Balancer 工作原理、Chunk 迁移 |
| [MongoDB 高可用故障转移](/database/mongodb/failover) | 选举原理、自动故障转移 |

### 第五阶段：存储与性能

| 文章 | 说明 |
|-----|------|
| [MongoDB WiredTiger 存储引擎](/database/mongodb/wiredtiger) | WiredTiger 特性、MVCC、Checkpoint |
| [MongoDB 压缩机制](/database/mongodb/compression) | snappy、zstd、zlib 压缩算法 |
| [MongoDB 内存管理](/database/mongodb/memory) | WiredTiger Cache、内存配置 |
| [MongoDB Journal 日志](/database/mongodb/journal) | WAL 日志、崩溃恢复 |
| [MongoDB 性能监控](/database/mongodb/monitor) | mongostat、mongotop、Profiler |
| [MongoDB 性能瓶颈与优化](/database/mongodb/performance) | 常见瓶颈与优化思路 |

### 第六阶段：应用与安全

| 文章 | 说明 |
|-----|------|
| [MongoDB Spring Data 集成](/database/mongodb/spring-data) | Spring Data MongoDB 使用指南 |
| [MongoDB 认证与授权](/database/mongodb/security) | SCRAM、x.509、LDAP 认证 |
| [MongoDB 用户角色与权限管理](/database/mongodb/auth) | RBAC 权限模型、角色管理 |
| [MongoDB 数据备份与恢复](/database/mongodb/backup) | mongodump、mongorestore、快照备份 |
| [MongoDB vs MySQL vs Redis 选型](/database/mongodb/compare) | 数据库选型对比与建议 |

## 面试汇总

| 文章 | 说明 |
|-----|------|
| [MongoDB 面试高频问题汇总](/database/mongodb/interview-summary) | 核心面试问题与参考答案 |

## 核心知识点

### 数据模型

```
Database
├── Collection (集合)
│   ├── Document (文档)
│   │   ├── _id (ObjectId)
│   │   ├── field1: value
│   │   ├── field2: [array]
│   │   └── nested_doc: {key: value}
│   └── ...
└── ...
```

### 集群架构

```
┌─────────────────────────────────────────────────┐
│                    分片集群                        │
│                                                 │
│  ┌──────────┐                                  │
│  │ mongos   │  ─── 路由节点                     │
│  └────┬─────┘                                  │
│       │                                          │
│  ┌────┴─────┐                                  │
│  │ Config    │  ─── 元数据存储                   │
│  │ Server    │                                  │
│  └──────────┘                                  │
│       │                                          │
│  ┌────┴─────┐                                  │
│  │ Shard 1   │  ─── 数据分片（副本集）           │
│  └──────────┘                                  │
│                                                 │
└─────────────────────────────────────────────────┘
```

## 面试重点

| 优先级 | 知识点 | 面试频率 |
|--------|--------|----------|
| ⭐⭐⭐⭐⭐ | 分片键选择原则 | 极高 |
| ⭐⭐⭐⭐⭐ | 副本集选举机制 | 极高 |
| ⭐⭐⭐⭐ | 索引类型与最左前缀 | 高 |
| ⭐⭐⭐⭐ | 事务隔离级别 | 高 |
| ⭐⭐⭐ | WiredTiger 存储引擎 | 中 |
| ⭐⭐⭐ | 慢查询优化 | 中 |
| ⭐⭐ | 压缩与内存管理 | 低 |

## 相关模块

- [MySQL](/database/mysql/index) - 关系型数据库对比
- [Redis](/database/redis/index) - KV 缓存数据库对比
- [Java](/java/index) - Java 应用开发
