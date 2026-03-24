# SQL Server 复制：快照复制、事务复制、合并复制

你的应用需要把数据分发到多个服务器：

- 报表服务器：只读报表，不想影响主库
- 远程分支机构：需要本地数据访问
- 实时同步：多个服务器需要相同数据

数据库复制（Replication）是解决这些场景的利器。

这篇文章，带你全面理解 SQL Server 复制技术。

---

## 复制概述

### 什么是数据库复制？

复制 = 将数据从一个数据库「发布」到多个订阅数据库的技术。

```
┌─────────────────────────────────────────────────────────────┐
│                  SQL Server 复制架构                         │
│                                                              │
│  ┌──────────────┐              ┌──────────────┐              │
│  │   发布服务器   │    复制     │   分发服务器   │              │
│  │  (Publisher) │ ──────────► │  (Distributor)│              │
│  │              │              │              │              │
│  │  原始数据     │              │  存储复制数据  │              │
│  │              │              │  和历史记录    │              │
│  └──────────────┘              └──────────────┘              │
│                                        │                      │
│                                        │ 拉/推订阅            │
│                    ┌───────────────────┼───────────────────┐  │
│                    ▼                   ▼                   ▼  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐      │
│  │   订阅服务器   │ │   订阅服务器   │ │   订阅服务器   │      │
│  │ (Subscriber) │ │ (Subscriber) │ │ (Subscriber) │      │
│  └──────────────┘ └──────────────┘ └──────────────┘      │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    复制代理                           │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │   │
│  │  │ 快照代理  │ │ 日志读取 │ │ 分发代理  │            │   │
│  │  │ Snapshot  │ │ Log Reader│ │ Distrib  │            │   │
│  │  └──────────┘ └──────────┘ └──────────┘            │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 复制类型

| 类型 | 数据同步 | 延迟 | 离线支持 | 适用场景 |
|-----|---------|------|---------|---------|
| **快照复制** | 全量定时 | 高 | ✓ | 初始化、低频更新 |
| **事务复制** | 增量实时 | 低 | ✗ | 高实时性需求 |
| **合并复制** | 双向同步 | 中 | ✓ | 多站点、离线工作 |

---

## 快照复制（Snapshot Replication）

### 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                  快照复制流程                                 │
│                                                              │
│  1. 快照生成                                               │
│     读取发布表数据                                          │
│     生成 BCP 文件和架构脚本                                 │
│     存储在快照文件夹                                        │
│                                                              │
│  2. 快照分发                                               │
│     分发代理读取快照文件                                    │
│     推送到订阅服务器（推送订阅）                             │
│     或订阅服务器拉取（拉取订阅）                            │
│                                                              │
│  3. 数据应用                                               │
│     订阅数据库应用快照                                      │
│     替换现有数据                                            │
└─────────────────────────────────────────────────────────────┘
```

### 配置快照复制

#### 1. 配置分发服务器

```sql
-- 配置分发服务器（如果尚未配置）
EXEC sp_adddistributor 
    @distributor = 'DistributorServer',
    @security_mode = 1;

EXEC sp_adddistributiondb 
    @database = 'distribution',
    @max_distretention = 72,
    @min_distretention = 60;

EXEC sp_adddistpublisher 
    @publisher = 'PublisherServer',
    @distribution_db = 'distribution',
    @security_mode = 1;
```

#### 2. 创建发布

```sql
-- 创建快照发布
USE [SalesDB];
EXEC sp_addpublication
    @publication = 'ProductsSnapshot',
    @status = 'active',
    @allow_push = N'true',
    @allow_pull = N'true',
    @description = N'产品表快照发布';

-- 添加项目
EXEC sp_addarticle
    @publication = 'ProductsSnapshot',
    @article = 'Products',
    @source_owner = 'dbo',
    @source_object = 'Products',
    @type = N'logbased',
    @ins_cmd = N'CALL sp_MSins_Products',
    @upd_cmd = N'CALL sp_MSupd_Products',
    @del_cmd = N'CALL sp_MSdel_Products';

-- 配置快照
EXEC sp_addpublication_snapshot
    @publication = 'ProductsSnapshot',
    @frequency_type = 1,  -- 在发布时
    @frequency_interval = 1;
```

#### 3. 创建订阅

```sql
-- 创建推送订阅
USE [SalesDB];
EXEC sp_addsubscription
    @publication = N'ProductsSnapshot',
    @subscriber = N'SubscriberServer',
    @destination_db = N'SalesDB_Replica',
    @subscription_type = N'push',
    @sync_type = N'automatic',
    @article = N'all',
    @update_mode = N'snapshot';

-- 创建拉取订阅
EXEC sp_addpullsubscription
    @publisher = N'PublisherServer',
    @publication = N'ProductsSnapshot',
    @publisher_db = N'SalesDB',
    @subscription_type = N'pull';

EXEC sp_addpullsubscription_agent
    @publisher = N'PublisherServer',
    @publisher_db = N'SalesDB',
    @publication = N'ProductsSnapshot',
    @distributor = N'DistributorServer',
    @run_continuous = N'false',
    @schedule_type = N'snapshot';
```

### 触发快照

```sql
-- 手动触发快照
EXEC sp_startpublication_snapshot
    @publication = 'ProductsSnapshot';

-- 查看快照状态
SELECT 
    publication,
    publisher_db,
    publication_type,
    snapshot_location,
    incremental_timestamp
FROM MSsnapshot_agents;

-- 查看分发历史
EXEC sp_replmonitorsubscriptionpendingcmds
    @publisher = 'PublisherServer',
    @publisher_db = 'SalesDB',
    @publication = 'ProductsSnapshot',
    @subscriber = 'SubscriberServer',
    @subscriber_db = 'SalesDB_Replica';
```

---

## 事务复制（Transactional Replication）

### 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                  事务复制流程                                 │
│                                                              │
│  1. 日志读取（Log Reader Agent）                            │
│     监控发布数据库的事务日志                                  │
│     读取标记为复制的命令                                     │
│     写入分发数据库                                           │
│                                                              │
│  2. 分发（Distribution Agent）                               │
│     从分发数据库读取复制命令                                 │
│     发送到订阅服务器                                         │
│                                                              │
│  3. 应用（Distribution Agent）                               │
│     在订阅服务器上应用命令                                   │
│     保持事务一致性                                          │
│                                                              │
│  特点：低延迟、实时同步、单向传输                            │
└─────────────────────────────────────────────────────────────┘
```

### 配置事务复制

#### 1. 创建发布

```sql
-- 创建事务发布
USE [SalesDB];
EXEC sp_addpublication
    @publication = 'OrdersTransactional',
    @status = 'active',
    @allow_push = N'true',
    @allow_pull = N'false',
    @replicate_ddl = 1,
    @snapshot_in_defaultfolder = 'false',
    @alt_snapshot_folder = '\\SnapshotServer\Snapshots',
    @compression = 1;

-- 添加项目（带列筛选）
EXEC sp_addarticle
    @publication = 'OrdersTransactional',
    @article = 'Orders',
    @source_owner = 'dbo',
    @source_object = 'Orders',
    @type = N'logbased',
    @schema_option = 0x0000000008000331,
    @destination_table = 'Orders',
    @ins_cmd = N'CALL sp_MSins_Orders',
    @upd_cmd = N'SCALL sp_MSupd_Orders',
    @del_cmd = N'SCALL sp_MSdel_Orders';

-- 添加行筛选器
EXEC sp_addarticlefilter
    @publication = 'OrdersTransactional',
    @article = 'Orders',
    @filter_name = N'Filter_Orders_Active',
    @filter_clause = N'[status] IN (1, 2, 3)';
```

#### 2. 创建订阅

```sql
-- 创建订阅
USE [SalesDB];
EXEC sp_addsubscription
    @publication = 'OrdersTransactional',
    @subscriber = 'SubscriberServer',
    @destination_db = 'OrdersReplica',
    @subscription_type = N'push',
    @sync_type = N'automatic',
    @article = N'all';

-- 配置读取优先级
EXEC sp_helpsubscription
    @publication = 'OrdersTransactional';
```

### 监控事务复制

```sql
-- 查看复制状态
SELECT 
    publisher,
    publisher_db,
    publication,
    distributor,
    distributor_db,
    publication_type
FROM MSpublications;

-- 查看订阅状态
SELECT 
    publisher,
    publisher_db,
    publication,
    subscriber,
    subscriber_db,
    subscription_type,
    sync_type,
    status
FROM MSsubscriptions;

-- 查看复制延迟
SELECT 
    agent_id,
    runstatus,
    delivered_transactions,
    delivered_commands,
    average_commands,
    delivery_rate
FROM MSlogreader_agents;

-- 查看分发队列
EXEC sp_replmonitorshowpendingcmds
    @publication = 'OrdersTransactional',
    @publisher = 'PublisherServer',
    @publisher_db = 'SalesDB';
```

---

## 合并复制（Merge Replication）

### 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                  合并复制流程                                 │
│                                                              │
│  1. 初始化                                                 │
│     快照代理创建初始数据                                    │
│     应用到所有订阅服务器                                    │
│     分配唯一标识符给每个订阅服务器                          │
│                                                              │
│  2. 离线工作                                               │
│     每个站点独立修改数据                                    │
│     记录在本地冲突表中                                      │
│                                                              │
│  3. 同步合并                                               │
│     Merge Agent 连接所有订阅服务器                          │
│     按优先级合并更改                                        │
│     检测并解决冲突                                          │
│                                                              │
│  特点：支持双向同步、离线工作、冲突解决                      │
└─────────────────────────────────────────────────────────────┘
```

### 配置合并复制

#### 1. 创建发布

```sql
-- 创建合并发布
USE [SalesDB];
EXEC sp_addmergepublication
    @publication = 'SalesDataMerge',
    @status = 'active',
    @snapshot_in_defaultfolder = 'false',
    @alt_snapshot_folder = '\\SnapshotServer\MergeSnapshots',
    @description = N'销售数据合并发布',
    @allow_subscriber_initiated_snapshot = N'true',
    @sync_mode = N'native',
    @retention = 14,
    @keep_partition_changes = N'true';

-- 添加项目和筛选
EXEC sp_addarticle
    @publication = 'SalesDataMerge',
    @article = 'Customers',
    @source_owner = 'dbo',
    @source_object = 'Customers',
    @type = N'table',
    @schema_option = 0x000000000CF5D2,
    @destination_table = 'Customers',
    @priority = 50;

-- 添加参数化筛选器
EXEC sp_addmergefilter
    @publication = 'SalesDataMerge',
    @article = 'Orders',
    @filtername = N'Filter_Orders_ByRegion',
    @filter_clause = N'[region_id] = HOST_NAME()',
    @join_articlename = N'Customers',
    @join_filterclause = N'Customers.customer_id = Orders.customer_id',
    @join_unique_key = 1;
```

#### 2. 创建订阅

```sql
-- 创建订阅
USE [SalesDB];
EXEC sp_addmergesubscription
    @publication = N'SalesDataMerge',
    @subscriber = N'SubscriberServer',
    @subscriber_db = N'CustomerDB',
    @subscription_type = N'push',
    @sync_type = N'Automatic',
    @hostname = N'RegionEast';  -- 匹配筛选器

-- 配置优先级
EXEC sp_changemergesubscription
    @publication = N'SalesDataMerge',
    @subscriber = N'SubscriberServer',
    @subscriber_db = N'CustomerDB',
    @property = N'priority',
    @value = 75;
```

### 冲突解决

```sql
-- 查看冲突表
SELECT * FROM MSmerge_conflicts_info;

-- 查看冲突数据
SELECT * FROM Orders_MSTABConflicts;

-- 解决冲突（手动）
-- 保留特定版本的更改
UPDATE Orders_MSTAB
SET order_status = 'resolved'
WHERE order_id = 1001;

-- 配置冲突解决策略
-- 优先级：谁高用谁
-- 首次发布优先：先处理的服务器
-- 最新的更改优先：最后修改的
EXEC sp_changemergepublication
    @publication = 'SalesDataMerge',
    @property = 'conflict_retention',
    @value = 7;  -- 保留冲突天数
```

---

## 对比与选择

### 三种复制的对比

| 特性 | 快照复制 | 事务复制 | 合并复制 |
|-----|---------|---------|---------|
| **数据同步** | 全量 | 增量 | 双向增量 |
| **同步延迟** | 高（分钟-小时） | 低（秒-分钟） | 中（分钟） |
| **离线工作** | ✓ | ✗ | ✓ |
| **双向同步** | ✗ | ✗ | ✓ |
| **冲突解决** | ✗ | ✗ | ✓ |
| **订阅服务器修改** | ✗ | ✗ | ✓ |
| **数据量** | 小-中 | 大 | 中 |
| **网络要求** | 低 | 高 | 中 |

### 选择指南

| 场景 | 推荐复制类型 |
|-----|-------------|
| **报表数据库** | 快照复制 |
| **高实时性分发** | 事务复制 |
| **读写分离** | 事务复制 |
| **多分支机构** | 合并复制 |
| **离线应用** | 合并复制 |
| **跨地域同步** | 合并复制 |
| **DR 复制** | 事务复制（异步） |

---

## 常见问题

### 问题 1：复制延迟高

```sql
-- 检查日志读取延迟
SELECT 
    publisher,
    publisher_db,
    publication,
    runstatus,
    time,
    delivered_transactions,
    delivery_rate
FROM MSlogreader_agents;

-- 检查分发延迟
SELECT 
    publisher,
    publisher_db,
    publication,
    subscriber,
    subscriber_db,
    runstatus,
    time,
    delivered_transactions,
    delivery_rate
FROM MSdistribution_agents;

-- 可能原因：
-- 1. 网络延迟
-- 2. 分发服务器性能不足
-- 3. 订阅服务器性能不足
-- 4. 大事务导致复制滞后
```

### 问题 2：复制冲突

```sql
-- 检查合并复制冲突
SELECT 
    origin_datasource,
    conflict_table,
    conflict_type,
    conflict_text,
    CRYPTimestamp
FROM MSmerge_conflicts_info;

-- 解决冲突：保留发布服务器版本
DELETE FROM Orders_MSTABConflicts
WHERE origin_datasource = 'SubscriberServer';

-- 配置解决策略
EXEC sp_changemergearticle
    @publication = 'SalesDataMerge',
    @article = 'Orders',
    @property = 'conflict_resolution',
    @value = 'publisher wins';
```

### 问题 3：重建订阅

```sql
-- 移除订阅
EXEC sp_dropsubscription
    @publication = 'OrdersTransactional',
    @subscriber = 'SubscriberServer',
    @destination_db = 'OrdersReplica',
    @article = N'all';

-- 重新初始化订阅
EXEC sp_refreshsubscriptions
    @publication = 'OrdersTransactional';

-- 或使用快照重新初始化
EXEC sp_reinitalize_subscription
    @subscriber = 'SubscriberServer',
    @subscriber_db = 'OrdersReplica',
    @invalidate_snapshot = 0;
```

---

## 面试追问方向

- SQL Server 有哪几种复制类型？各自的特点是什么？
- 事务复制的工作原理是什么？
- 快照复制和事务复制的核心区别是什么？
- 合并复制有什么特点？适用于什么场景？
- 什么是复制冲突？如何解决？
- 如何监控复制延迟？

---

## 下一步

理解了复制技术，我们来看 [SQL Server 备份策略与恢复模式](/database/sqlserver/backup)，学习数据保护的基础。
