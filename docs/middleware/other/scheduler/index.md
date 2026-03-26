# 分布式任务调度

凌晨 2 点，你的订单系统需要在每天凌晨结算昨日交易数据；每小时要同步一次商品库存；每周要给活跃用户发送邮件。这些定时任务，单机跑没问题。

但当业务增长到日活 100 万，订单数据变成一亿条——单机执行需要 10 个小时，你只有 10 个小时的时间窗口。

怎么办？

**答案是：分布式任务调度**。

## 什么是任务调度？

任务调度，就是让计算机在指定的时间自动执行指定的任务。你每天早上 7 点被闹钟叫醒，本质上也是一种「任务调度」。

在软件系统中，常见的调度需求：

```
┌─────────────────────────────────────────────────────────────┐
│                    典型调度场景                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   定时报表    每天凌晨2点生成前一天的报表                      │
│   数据同步    每小时同步一次商品库存                          │
│   邮件推送    每周一早上给活跃用户发邮件                       │
│   缓存刷新    每隔5分钟刷新一次热点数据                        │
│   对账任务    每天0点进行交易对账                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 为什么需要分布式调度？

单机调度的问题：

| 问题 | 说明 | 后果 |
|---|---|---|
| 单点故障 | 机器挂了，所有任务停止 | 业务中断 |
| 性能瓶颈 | 单机处理能力有限 | 大数据量任务无法完成 |
| 扩展困难 | 增加机器不能自动分担任务 | 资源利用率低 |
| 状态管理 | 任务状态分散，难以统一监控 | 运维困难 |

分布式调度解决这些问题：

```
┌─────────────────────────────────────────────────────────────┐
│                    分布式调度优势                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌────────────┐  ┌────────────┐  ┌────────────┐          │
│   │  Server 1  │  │  Server 2  │  │  Server 3  │          │
│   │  任务A     │  │  任务B     │  │  任务C     │          │
│   └────────────┘  └────────────┘  └────────────┘          │
│          │                │                │              │
│          └────────────────┼────────────────┘              │
│                           ▼                                │
│              ┌─────────────────────────┐                  │
│              │     调度中心/协调者      │                  │
│              │  · 任务分配              │                  │
│              │  · 故障转移              │                  │
│              │  · 状态监控              │                  │
│              └─────────────────────────┘                  │
│                                                             │
│   优势：                                                   │
│   · 高可用：任意节点挂，其他节点接管                        │
│   · 高性能：任务分片，并行处理                              │
│   · 可扩展：动态增减节点                                    │
│   · 可监控：统一的任务状态管理                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 核心组件

一个完整的任务调度系统，离不开这四个核心组件：

| 组件 | 职责 | 类比 |
|---|---|---|
| Job（任务） | 做什么 | 厨师做菜 |
| JobDetail（任务描述） | 任务的描述和上下文 | 菜单 + 桌位信息 |
| Trigger（触发器） | 什么时候做 | 闹钟 |
| Scheduler（调度器） | 协调调度 | 餐厅服务员 |

## 技术选型

| 技术 | 定位 | 核心优势 | 适用场景 |
|---|---|---|---|
| [Quartz](/middleware/scheduler/quartz-core) | 老牌调度框架 | 功能完善、Spring 集成好 | 需要精细控制的企业级应用 |
| [XXL-Job](/middleware/scheduler/xxljob-architecture) | 分布式调度平台 | 调度中心 + 执行器、可视化管理 | 通用分布式调度场景 |
| [ElasticJob](/middleware/scheduler/elasticjob-architecture) | 分布式调度框架 | 原生分片支持、ZooKeeper 协调 | 大数据量、分片复杂场景 |

## 模块内容

### Quartz

[Quartz](/middleware/scheduler/quartz-core) 是任务调度领域的老牌框架，功能强大且灵活。

- [核心概念](/middleware/scheduler/quartz-core)：Scheduler、Trigger、Job、JobDetail
- [Trigger 类型](/middleware/scheduler/quartz-trigger)：SimpleTrigger、CronTrigger
- [Job 状态](/middleware/scheduler/quartz-job-state)：@PersistJobDataAfterExecution、@DisallowConcurrentExecution
- [Spring Boot 集成](/middleware/scheduler/quartz-springboot)：与 Spring 生态无缝集成
- [集群原理](/middleware/scheduler/quartz-cluster)：JDBC JobStore、分布式锁
- [Misfire 策略](/middleware/scheduler/quartz-misfire)：错过触发的处理

### XXL-Job

[XXL-Job](/middleware/scheduler/xxljob-architecture) 是国产开源的分布式任务调度平台，以「调度中心 + 执行器」架构著称。

- [架构原理](/middleware/scheduler/xxljob-architecture)：调度中心、执行器、注册机制
- [任务类型](/middleware/scheduler/xxljob-task-type)：Bean 模式、GLUE 模式、Script 脚本
- [路由策略](/middleware/scheduler/xxljob-route)：FIRST、ROUND、CONSISTENT_HASH、SHARDING
- [失败重试](/middleware/scheduler/xxljob-retry)：超时控制、重试机制、阻塞处理
- [任务编排](/middleware/scheduler/xxljob-chaining)：任务依赖、串行执行
- [GLUE 热更新](/middleware/scheduler/xxljob-glue)：在线编写代码、实时生效
- [高可用](/middleware/scheduler/xxljob-ha)：调度中心集群、执行器高可用

### ElasticJob

[ElasticJob](/middleware/scheduler/elasticjob-architecture) 是当当网开源的分布式调度框架，以去中心化架构和原生分片支持见长。

- [架构原理](/middleware/scheduler/elasticjob-architecture)：LiteJob、CloudJob、ZooKeeper 协调
- [分片原理](/middleware/scheduler/elasticjob-sharding)：分片分配、动态重分配、自定义分片策略
- [作业类型](/middleware/scheduler/elasticjob-job-type)：SimpleJob、DataflowJob、ScriptJob
- [监听器](/middleware/scheduler/elasticjob-listener)：ElasticJobListener、ExecutionListener
- [配置详解](/middleware/scheduler/elasticjob-config)：Spring Boot 配置、分片参数
- [Cloud 模式](/middleware/scheduler/elasticjob-cloud)：Mesos 资源调度
- [注册中心](/middleware/scheduler/elasticjob-registry)：ZooKeeper 节点结构、选举机制
- [对比选型](/middleware/scheduler/elasticjob-compare)：与 XXL-Job 的详细对比

### 综合内容

- [单机 vs 分布式](/middleware/scheduler/single-vs-distributed)：什么时候需要分布式调度
- [技术对比](/middleware/scheduler/compare)：Quartz、XXL-Job、ElasticJob 横向对比
- [常见问题](/middleware/scheduler/common-problem)：任务丢失、重复执行、数据一致性问题
- [面试题汇总](/middleware/scheduler/interview-summary)：高频面试题与解答

## 面试核心要点

```
┌─────────────────────────────────────────────────────────────┐
│                    面试高频考点                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Quartz 集群原理：                                          │
│   · JDBC JobStore 存储调度状态                               │
│   · QRTZ_LOCKS 表实现分布式锁                               │
│   · 节点竞争获取锁，执行任务                                 │
│   · 节点失联后任务重新触发（Misfire）                        │
│                                                             │
│   XXL-Job 路由策略：                                         │
│   · FIRST/LAST/ROUND/RANDOM                                │
│   · CONSISTENT_HASH 保证同一任务路由到同一执行器              │
│   · SHARDING 分片广播，所有执行器同时执行                     │
│                                                             │
│   ElasticJob 分片：                                          │
│   · 通过 ZooKeeper 实现分片分配                             │
│   · 哈希取模决定分片归属节点                                 │
│   · 节点增减时自动重新分配                                   │
│                                                             │
│   分布式调度核心问题：                                       │
│   · 任务不重复执行（幂等性设计）                             │
│   · 任务不漏执行（可靠性保证）                               │
│   · 任务执行状态可视化                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 写在最后

任务调度的学习，有一个核心心法：**不是学框架，是理解问题**。

Quartz、XXL-Job、ElasticJob 只是解决「如何在多台机器上可靠执行定时任务」这个问题的不同方案。每个框架都有自己的适用场景，没有绝对的好坏。

选择框架之前，先问自己三个问题：

1. 任务需要分片吗？（ElasticJob 擅长）
2. 需要可视化管理吗？（XXL-Job 擅长）
3. 只是想在 Spring 中简单用用？（Quartz 擅长）

带着问题学框架，比单纯学知识点更有效。
