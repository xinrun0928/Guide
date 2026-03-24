# SQL Server Always On 可用性组架构

你的业务要求 7×24 小时不间断运行。

数据库宕机意味着业务中断，损失按秒计算。传统的故障转移群集（FCI）能解决硬件故障，但无法解决数据库级别的故障和读写分离。

SQL Server Always On 是微软为企业级高可用打造的王牌——它不仅能实现秒级故障转移，还支持读写分离、异地灾备、多个同步副本。

这篇文章，带你全面理解 Always On 的架构和原理。

---

## Always On 概述

### 什么是 Always On？

Always On 是 SQL Server 的高可用和灾难恢复解决方案，核心是**可用性组（Availability Groups）**。

```
┌─────────────────────────────────────────────────────────────┐
│                  Always On 可用性组架构                        │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                   WSFC（故障转移群集）                  │ │
│  │                                                          │ │
│  │  ┌──────────────┐    ┌──────────────┐               │ │
│  │  │  主副本      │    │  辅助副本 1  │               │ │
│  │  │ (Primary)    │◄──►│  (Secondary) │               │ │
│  │  │              │    │              │               │ │
│  │  │ 应用读写     │    │ 只读路由     │               │ │
│  │  │              │    │ 备份         │               │ │
│  │  └──────────────┘    └──────────────┘               │ │
│  │         │                      │                       │ │
│  │         └──────────┬───────────┘                       │ │
│  │                    │                                   │ │
│  │                    ▼                                   │ │
│  │          ┌──────────────────┐                          │ │
│  │          │   共享存储       │                          │ │
│  │          │ (SAN/文件共享)   │                          │ │
│  │          └──────────────────┘                          │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Always On vs 传统方案

| 特性 | Always On AG | 故障转移群集 FCI | 数据库镜像 |
|-----|-------------|-----------------|-----------|
| **保护级别** | 数据库组 | 实例级 | 单数据库 |
| **故障转移** | 秒级 | 分钟级 | 秒级 |
| **读写分离** | ✓ | ✗ | ✗ |
| **多个副本** | ✓（最多 8） | ✗ | ✗ |
| **自动故障转移** | ✓ | ✓ | ✓ |
| **跨机房灾备** | ✓ | ✗ | ✗ |
| **需要 SAN** | ✗ | ✓ | ✗ |
| **最低版本** | SQL 2012+ Enterprise | 所有版本 | SQL 2005+ Standard |

---

## 核心组件

### 1. Windows Server Failover Cluster（WSFC）

WSFC = Always On 的基础，提供了故障检测和自动转移的机制。

```powershell
# 查看 WSFC 状态
Get-ClusterNode

# 查看集群资源
Get-ClusterResource

# 查看可用性组资源
Get-ClusterResource | Where-Object {$_.ResourceType -eq "Availability Group"}
```

### 2. 可用性组（Availability Group）

可用性组 = 包含一个或多个数据库的逻辑容器。

```sql
-- 创建可用性组
CREATE AVAILABILITY GROUP SalesAG
WITH (
    AUTOMATED_BACKUP_PREFERENCE = SECONDARY,  -- 备份优先在辅助副本
    FAILURE_CONDITION_LEVEL = 3,               -- 故障条件级别
    HEALTH_CHECK_TIMEOUT = 30000              -- 健康检查超时（毫秒）
)
FOR DATABASE SalesDB
REPLICA ON
    'SQLServer1' WITH (
        ENDPOINT_URL = 'TCP://SQLServer1:5022',
        AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
        FAILOVER_MODE = AUTOMATIC,
        BACKUP_PRIORITY = 50,
        SEEDING_MODE = AUTOMATIC
    ),
    'SQLServer2' WITH (
        ENDPOINT_URL = 'TCP://SQLServer2:5022',
        AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
        FAILOVER_MODE = AUTOMATIC,
        BACKUP_PRIORITY = 30,
        SEEDING_MODE = AUTOMATIC
    ),
    'SQLServer3' WITH (
        ENDPOINT_URL = 'TCP://SQLServer3:5022',
        AVAILABILITY_MODE = ASYNCHRONOUS_COMMIT,
        FAILOVER_MODE = MANUAL,
        BACKUP_PRIORITY = 20,
        SEEDING_MODE = MANUAL
    );
```

### 3. 副本（Replica）

副本 = 可用性组在每个节点上的数据库实例。

| 副本类型 | 说明 |
|---------|------|
| **主副本（Primary）** | 接收所有读写请求 |
| **辅助副本（Secondary）** | 保持数据同步，可以只读 |

### 4. 端点（Endpoint）

端点 = 用于副本间数据传输的 TCP 端口（默认 5022）。

```sql
-- 查看端点
SELECT 
    name AS EndpointName,
    endpoint_id,
    protocol_desc,
    type_desc,
    state_desc,
    port
FROM sys.database_mirroring_endpoints;
```

---

## 同步模式

### 同步提交（SYNCHRONOUS_COMMIT）

```
┌─────────────────────────────────────────────────────────────┐
│              同步提交模式                                    │
│                                                              │
│  主副本：                                                  │
│  1. 事务写入主副本日志                                   │
│  2. 发送到辅助副本                                        │
│  3. 等待辅助副本确认                                      │
│  4. ✓ 辅助副本写入日志后，主副本提交                      │
│                                                              │
│  特点：                                                    │
│  - 零数据丢失（RPO = 0）                                  │
│  - 有延迟（受网络影响）                                    │
│  - 适合 LAN 环境                                          │
└─────────────────────────────────────────────────────────────┘
```

### 异步提交（ASYNCHRONOUS_COMMIT）

```
┌─────────────────────────────────────────────────────────────┐
│              异步提交模式                                    │
│                                                              │
│  主副本：                                                  │
│  1. 事务写入主副本日志                                    │
│  2. 发送后立即提交（不等辅助副本）                         │
│  3. 异步发送到辅助副本                                      │
│                                                              │
│  特点：                                                    │
│  - 可能有数据丢失（RPO > 0）                               │
│  - 无延迟                                                    │
│  - 适合 WAN/异地灾备                                       │
└─────────────────────────────────────────────────────────────┘
```

### 配置建议

| 场景 | 副本 1 | 副本 2 | 副本 3 |
|------|--------|--------|--------|
| **本地高可用** | 同步 | 同步 | - |
| **同城灾备** | 同步 | 同步 | 异步 |
| **异地灾备** | 同步 | 异步 | 异步 |

---

## 故障转移（Failover）

### 故障转移类型

| 类型 | 触发方式 | 数据丢失 | 说明 |
|-----|---------|---------|------|
| **自动故障转移** | 系统自动触发 | 零丢失 | 需要同步模式 + 自动故障转移配置 |
| **手动故障转移** | 管理员手动触发 | 零丢失 | 同步模式下可以手动切换 |
| **强制故障转移** | 管理员强制执行 | 可能丢失 | 最后手段，异步模式下使用 |

### 故障转移过程

```
┌─────────────────────────────────────────────────────────────┐
│                    故障转移过程                               │
│                                                              │
│  1. 故障检测                                               │
│     WSFC 检测到主副本不可用                                │
│                                                              │
│  2. 评估条件                                               │
│     检查 FAILOVER_MODE 和 AVAILABILITY_MODE                 │
│                                                              │
│  3. 选择新主副本                                           │
│     WSFC 选择优先级最高的同步副本                           │
│                                                              │
│  4. 数据同步                                               │
│     辅助副本完成日志同步                                    │
│                                                              │
│  5. 角色切换                                               │
│     辅助副本升级为主副本                                    │
│     应用程序自动重定向到新主副本                            │
│                                                              │
│  总时间：通常 < 30 秒                                       │
└─────────────────────────────────────────────────────────────┘
```

### 执行手动故障转移

```sql
-- 在主副本上执行（正常切换）
ALTER AVAILABILITY GROUP SalesAG FAILOVER;
ALTER AVAILABILITY GROUP SalesAG FAILOVER WITH泰SUSPEND;

-- 在目标辅助副本上执行（需要连接到目标副本）
ALTER AVAILABILITY GROUP SalesAG SET (ROLE = SECONDARY);
ALTER AVAILABILITY GROUP SalesAG SET (ROLE = PRIMARY);
```

---

## 只读路由（Read-Only Routing）

Always On 支持将读请求路由到辅助副本，实现读写分离。

### 配置只读路由

```sql
-- 在主副本上配置只读路由列表
ALTER AVAILABILITY GROUP SalesAG
MODIFY REPLICA ON
    'SQLServer1' WITH (
        SESSION_TIMEOUT = 10,
        READ_ONLY_ROUTING_URL = 'TCP://SQLServer1:1433'
    );

ALTER AVAILABILITY GROUP SalesAG
MODIFY REPLICA ON
    'SQLServer2' WITH (
        SESSION_TIMEOUT = 10,
        READ_ONLY_ROUTING_URL = 'TCP://SQLServer2:1433'
    );

-- 配置只读路由列表（优先级顺序）
ALTER AVAILABILITY GROUP SalesAG
MODIFY REPLICA ON
    'SQLServer1' WITH (
        SECONDARY_ROLE (
            READ_ONLY_ROUTING_LIST = ('SQLServer2', 'SQLServer3'),
            READ_ONLY_ROUTING_FAILOVER = ON  -- 允许路由列表内故障转移
        )
    );
```

### 连接字符串配置

```java
// Java/JDBC 连接字符串
// 主副本（读写）
String primaryConnection = 
    "jdbc:sqlserver://SQLServer1:1433;" +
    "databaseName=SalesDB;" +
    "applicationIntent=ReadWrite;" +  // 读写意图
    "failoverPartner=SQLServer2";      // 故障转移伙伴

// 辅助副本（只读）
String readOnlyConnection = 
    "jdbc:sqlserver://SQLServer2:1433;" +
    "databaseName=SalesDB;" +
    "applicationIntent=ReadOnly;" +     // 只读意图
    "failoverPartner=SQLServer1";

// 应用程序使用不同连接字符串
// 写操作 → ReadWrite
// 读操作 → ReadOnly
```

---

## 备份策略

### 备份偏好设置

```sql
-- 设置备份偏好
ALTER AVAILABILITY GROUP SalesAG
SET (AUTOMATED_BACKUP_PREFERENCE = SECONDARY);

-- 备份偏好选项：
-- PRIMARY：在主副本备份
-- SECONDARY_ONLY：只在辅助副本备份
-- SECONDARY_PREFERRED：优先辅助副本
-- NONE：无所谓在哪备份
```

### 备份脚本

```sql
-- 智能备份脚本
BACKUP DATABASE SalesDB TO DISK = 'D:\Backup\SalesDB.bak'
WITH COPY_ONLY;  -- COPY_ONLY 不影响日志链

-- 在辅助副本上备份
BACKUP DATABASE SalesDB TO DISK = 'D:\Backup\SalesDB_Replica.bak'
WITH COPY_ONLY, NORECOVERY;

-- 日志备份
BACKUP LOG SalesDB TO DISK = 'D:\Backup\SalesDB_Log.trn'
WITH COMPRESSION;
```

---

## 监听器（Listener）

监听器 = 虚拟网络名称（VNN），为可用性组提供统一的连接入口。

### 创建监听器

```sql
-- 使用 SSMS 或 T-SQL 创建
-- 监听器会自动在 WSFC 中创建客户端访问点（CAP）

-- 查看监听器
SELECT 
    listener_id,
    listener_name,
    ip_configuration_string,
    port,
    state_desc
FROM sys.availability_group_listeners;
```

### 连接字符串配置

```java
// 使用监听器连接（推荐）
String connectionString = 
    "jdbc:sqlserver://SalesAG_Listener:1433;" +
    "databaseName=SalesDB;" +
    "failoverPartner=BackupListener";  // 备份监听器

// 优势：
// 1. 故障转移时自动重定向
// 2. 只读路由时自动路由到辅助副本
// 3. 应用程序无需感知拓扑变化
```

---

## 监控与管理

### DMV 监控

```sql
-- 查看可用性组状态
SELECT 
    ag.name AS AGName,
    ag.is_distributed,
    ar.replica_id,
    ar.replica_server_name,
    ar.availability_mode_desc,
    ar.failover_mode_desc,
    ars.role_desc,
    ars.synchronization_state_desc,
    ars.last_redone_time,
    ars.last_commit_time
FROM sys.availability_groups ag
JOIN sys.availability_replicas ar ON ag.group_id = ar.group_id
LEFT JOIN sys.dm_hadr_availability_replica_states ars 
    ON ar.replica_id = ars.replica_id;

-- 查看同步状态
SELECT 
    database_name,
    synchronization_state_desc,
    is_primary_RePLiCa,
    last_sent_time,
    last_received_time,
    last_redone_time,
    log_send_queue_size,
    log_send_rate
FROM sys.dm_hadr_database_replica_states;

-- 查看故障转移历史
SELECT 
    start_time,
    failure_type_desc,
    target_replica_server_name,
    duration_seconds
FROM sys.dm_hadr_fabric_replica_failover_log;
```

### 扩展事件

```sql
-- 创建 Always On 监控事件
CREATE EVENT SESSION [AlwaysOn_Monitor] ON SERVER
ADD EVENT sqlserver.availability_replica_state_change
(
    ACTION (sqlserver.server_instance_name)
),
ADD EVENT sqlserver.availability_replica_data_loss
(
    ACTION (sqlserver.database_name)
),
ADD EVENT sqlserver.failover_error
(
    ACTION (sqlserver.error_number)
)
ADD TARGET package0.event_file
(SET filename = 'C:\XEvents\AlwaysOn_Monitor.xel')
WITH (STARTUP_STATE = ON);
```

---

## 常见问题

### 问题 1：辅助副本长时间不同步

```sql
-- 检查网络延迟
SELECT 
    ar.replica_server_name,
    drs.log_send_queue_size,
    drs.log_send_rate,
    drs.redo_queue_size,
    drs.redo_rate
FROM sys.dm_hadr_database_replica_states drs
JOIN sys.availability_replicas ar ON drs.replica_id = ar.replica_id;

-- 如果 redo_queue 很大，手动加速
ALTER DATABASE [SalesDB] SET HADR RESUME;
```

### 问题 2：自动故障转移失败

```sql
-- 检查 WSFC 状态
SELECT 
    NodeName,
    NodeState,
    NodeWeight
FROM sys.dm_hadr_cluster_nodes;

-- 检查仲裁配置
SELECT 
    WitnessServer,
    WitnessSharePath,
    QuorumTypeDesc
FROM sys.dm_hadr_cluster;

-- 可能的解决方案：
-- 1. 确保仲裁配置正确
-- 2. 检查网络连通性
-- 3. 调整 HEALTH_CHECK_TIMEOUT
```

---

## 面试追问方向

- Always On 和故障转移群集（FCI）有什么区别？
- 同步提交和异步提交的区别是什么？各自的适用场景？
- 什么是只读路由？如何配置？
- 什么是可用性组监听器？有什么作用？
- 什么是 RPO 和 RTO？Always On 能达到多少？
- 自动故障转移和手动故障转移有什么区别？

---

## 下一步

理解了 Always On，我们来看 [SQL Server 故障转移群集（FCI）](/database/sqlserver/fci)，学习另一种高可用方案。
