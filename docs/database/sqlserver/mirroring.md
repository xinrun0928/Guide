# SQL Server 镜像（Database Mirroring）

面试官问：「你用过数据库镜像吗？」

你：「用过 Always On。」

面试官追问：「那你知道数据库镜像和 Always On 的区别吗？」

你：「……」

数据库镜像（Database Mirroring）是 SQL Server 2005 引入的高可用方案，在 SQL Server 2012 被 Always On 取代。虽然已过时，但理解它有助于理解 Always On 的演进，也可能在老系统中遇到。

这篇文章，带你全面了解数据库镜像。

---

## 数据库镜像概述

### 什么是数据库镜像？

数据库镜像 = 将主数据库（Principal）的日志实时传输到镜像数据库（Mirror），实现数据同步。

```
┌─────────────────────────────────────────────────────────────┐
│                  数据库镜像架构                               │
│                                                              │
│  ┌──────────────┐              ┌──────────────┐          │
│  │   主服务器    │    ──────►    │   镜像服务器   │          │
│  │  (Principal)  │   日志传输    │   (Mirror)    │          │
│  │              │              │              │          │
│  │  主数据库     │              │  镜像数据库   │          │
│  │  (Principal   │              │  (Mirror DB) │          │
│  │   Database)   │              │              │          │
│  └──────────────┘              └──────────────┘          │
│                                                              │
│                    ┌──────────────┐                        │
│                    │   见证服务器  │                        │
│                    │  (Witness)   │                        │
│                    │   (可选)     │                        │
│                    └──────────────┘                        │
│                                                              │
│  客户端通过连接字符串自动故障转移                            │
└─────────────────────────────────────────────────────────────┘
```

### 镜像模式

| 模式 | 说明 | 事务安全 | 适用场景 |
|-----|------|---------|---------|
| **高安全模式** | 同步传输 | FULL | LAN，需要零数据丢失 |
| **高性能模式** | 异步传输 | OFF | WAN，可以容忍少量数据丢失 |

### 高安全模式（同步）

```
┌─────────────────────────────────────────────────────────────┐
│              高安全模式（同步）                               │
│                                                              │
│  主服务器：                                                 │
│  1. 事务写入主数据库日志                                   │
│  2. 发送日志到镜像服务器                                    │
│  3. 等待镜像服务器确认                                      │
│  4. ✓ 镜像写入日志后，主服务器提交                          │
│                                                              │
│  特点：                                                    │
│  - 零数据丢失                                              │
│  - 有事务延迟                                              │
│  - 支持自动故障转移（需要见证服务器）                        │
└─────────────────────────────────────────────────────────────┘
```

### 高性能模式（异步）

```
┌─────────────────────────────────────────────────────────────┐
│              高性能模式（异步）                               │
│                                                              │
│  主服务器：                                                 │
│  1. 事务写入主数据库日志                                   │
│  2. 发送日志后立即提交（不等镜像）                          │
│  3. 异步发送到镜像服务器                                    │
│                                                              │
│  特点：                                                    │
│  - 可能数据丢失（未发送的日志）                             │
│  - 无事务延迟                                              │
│  - 不支持自动故障转移                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 配置数据库镜像

### 前置条件

| 要求 | 说明 |
|-----|------|
| SQL Server 版本 | Enterprise/Standard |
| 恢复模式 | FULL |
| 数据库 | 完整恢复模式 |
| 端点 | 需要数据库镜像端点 |
| 网络 | 主服务器和镜像服务器互通 |

### 配置步骤

#### 1. 确保数据库使用完整恢复模式

```sql
-- 检查恢复模式
SELECT 
    name,
    recovery_model,
    recovery_model_desc
FROM sys.databases
WHERE name = 'SalesDB';

-- 修改为完整恢复模式
ALTER DATABASE SalesDB SET RECOVERY FULL;
```

#### 2. 创建端点

```sql
-- 在主服务器上创建端点
CREATE ENDPOINT DatabaseMirroring
    STATE = STARTED
    AS TCP (LISTENER_PORT = 5022, LISTENER_IP = ALL)
    FOR DATABASE_MIRRORING (
        AUTHENTICATION = WINDOWS NTLM,
        ENCRYPTION = REQUIRED,
        ROLE = ALL
    );

-- 在镜像服务器上创建端点（相同配置）
CREATE ENDPOINT DatabaseMirroring
    STATE = STARTED
    AS TCP (LISTENER_PORT = 5022, LISTENER_IP = ALL)
    FOR DATABASE_MIRRORING (
        AUTHENTICATION = WINDOWS NTLM,
        ENCRYPTION = REQUIRED,
        ROLE = ALL
    );
```

#### 3. 备份和还原数据库

```sql
-- 主服务器：完整备份 + 日志备份
BACKUP DATABASE SalesDB TO DISK = 'D:\Backup\SalesDB_Full.bak'
WITH COMPRESSION;
BACKUP LOG SalesDB TO DISK = 'D:\Backup\SalesDB_Log.trn'
WITH COMPRESSION;

-- 镜像服务器：还原备份（NORECOVERY）
RESTORE DATABASE SalesDB FROM DISK = 'D:\Backup\SalesDB_Full.bak'
WITH NORECOVERY;
RESTORE LOG SalesDB FROM DISK = 'D:\Backup\SalesDB_Log.trn'
WITH NORECOVERY;
```

#### 4. 建立镜像关系

```sql
-- 在主服务器上执行（连接到主服务器）
ALTER DATABASE SalesDB 
SET PARTNER = 'TCP://MirrorServer:5022';
-- 指定镜像服务器地址

-- 在镜像服务器上执行（连接到镜像服务器）
ALTER DATABASE SalesDB 
SET PARTNER = 'TCP://PrincipalServer:5022';
-- 指定主服务器地址
```

#### 5. 添加见证服务器（可选）

```sql
-- 在见证服务器上创建端点
CREATE ENDPOINT DatabaseMirroring
    STATE = STARTED
    AS TCP (LISTENER_PORT = 5022)
    FOR DATABASE_MIRRORING (
        AUTHENTICATION = WINDOWS NTLM,
        ENCRYPTION = REQUIRED,
        ROLE = WITNESS
    );

-- 在主服务器上配置见证服务器
ALTER DATABASE SalesDB SET WITNESS = 'TCP://WitnessServer:5022';
```

---

## 监控镜像状态

### DMV 监控

```sql
-- 查看镜像状态
SELECT 
    db_name(database_id) AS DatabaseName,
    mirroring_role_desc,
    mirroring_state_desc,
    mirroring_safety_level_desc,
    mirroring_partner_instance,
    mirroring_witness_name,
    mirroring_connection_timeout
FROM sys.database_mirroring
WHERE mirroring_guid IS NOT NULL;

-- 查看镜像性能
SELECT 
    db_name(database_id) AS DatabaseName,
    mirroring_role,
    synchronization_state_desc,
    mirroring_connection_timeout,
    last_sent_time,
    last_sent_lsn,
    last_received_time,
    last_received_lsn,
    last_redone_time,
    last_redone_lsn,
    log_send_queue_size,
    log_send_rate,
    redo_queue_size,
    redo_rate
FROM sys.dm_database_mirroring_connectivity;
```

### 事件监控

```sql
-- 查看镜像相关事件
SELECT 
    message,
    severity,
    log_date,
    processinfo
FROM sys.event_log
WHERE event_type = 'database_mirroring';
```

---

## 故障转移

### 自动故障转移

需要：高安全模式 + 见证服务器

```
条件满足时自动触发：
1. 主服务器不可用
2. 镜像服务器可达
3. 见证服务器确认主服务器不可用

过程：
主服务器故障 → 见证服务器通知 → 镜像服务器自动升级 → 客户端重定向
```

### 手动故障转移

```sql
-- 在主服务器上执行
USE master;
ALTER DATABASE SalesDB SET PARTNER FAILOVER;
-- 镜像服务器升级为主服务器

-- 在镜像服务器上执行（强制故障转移，可能丢失数据）
ALTER DATABASE SalesDB SET PARTNER FORCE_SERVICE_ALLOW_DATA_LOSS;
-- 最后手段
```

---

## 客户端连接

### 连接字符串配置

```java
// 使用故障转移伙伴的连接字符串
String connectionString = 
    "jdbc:sqlserver://PrincipalServer:1433;" +
    "databaseName=SalesDB;" +
    "failoverPartner=MirrorServer:1433;" +  // 故障转移伙伴
    "MultiSubnetFailover=Yes;";               // 多子网故障转移

// 故障发生时：
// 1. 主服务器连接失败
// 2. JDBC 驱动自动连接镜像服务器
// 3. 应用继续运行
```

---

## 数据库镜像 vs Always On

| 特性 | 数据库镜像 | Always On |
|-----|-----------|-----------|
| **Enterprise 版支持** | ✓ | ✓ |
| **Standard 版支持** | ✓ | 仅基本可用性组 |
| **数据库数量** | 单数据库 | 多个数据库组 |
| **只读辅助副本** | ✗ | ✓ |
| **备份辅助副本** | ✗ | ✓ |
| **多个辅助副本** | ✗ | 最多 8 个 |
| **自动故障转移** | ✓（需见证） | ✓ |
| **跨子网支持** | ✗ | ✓ |
| **读写分离** | ✗ | ✓ |
| **状态** | SQL 2012 已弃用 | 推荐方案 |

---

## 迁移到 Always On

### 为什么需要迁移？

1. 数据库镜像在 SQL Server 2012 已弃用
2. Always On 提供更多功能
3. 微软不再增强镜像功能

### 迁移步骤

```sql
-- 1. 移除镜像
ALTER DATABASE SalesDB SET PARTNER OFF;

-- 2. 准备 Always On 环境
-- - 配置 WSFC 群集
-- - 在副本上还原数据库

-- 3. 创建可用性组
CREATE AVAILABILITY GROUP SalesAG
FOR DATABASE SalesDB
REPLICA ON
    'PrimaryServer' WITH (
        ENDPOINT_URL = 'TCP://PrimaryServer:5022',
        AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
        FAILOVER_MODE = AUTOMATIC
    ),
    'SecondaryServer' WITH (
        ENDPOINT_URL = 'TCP://SecondaryServer:5022',
        AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
        FAILOVER_MODE = AUTOMATIC
    );

-- 4. 验证和切换
```

---

## 常见问题

### 问题 1：镜像状态为「挂起」

```sql
-- 检查状态
SELECT 
    db_name(database_id),
    mirroring_state_desc,
    mirroring_partner_instances
FROM sys.database_mirroring;

-- 恢复镜像
ALTER DATABASE SalesDB SET PARTNER RESUME;

-- 如果无法恢复，可能需要重新配置
```

### 问题 2：日志积累

```sql
-- 检查日志发送队列
SELECT 
    db_name(database_id),
    log_send_queue_size,
    log_send_rate,
    redo_queue_size,
    redo_rate
FROM sys.dm_database_mirroring_connectivity;

-- 如果队列很大，检查：
-- 1. 网络延迟
-- 2. 镜像服务器性能
-- 3. 磁盘 I/O
```

### 问题 3：见证服务器断开

```sql
-- 检查见证服务器状态
SELECT 
    mirroring_witness_name,
    mirroring_witness_state_desc
FROM sys.database_mirroring;

-- 移除见证服务器（如果见证服务器不可用）
ALTER DATABASE SalesDB SET WITNESS OFF;
```

---

## 面试追问方向

- 数据库镜像有哪两种模式？有什么区别？
- 数据库镜像的故障转移机制是怎样的？
- 数据库镜像和 Always On 有什么核心区别？
- 为什么要从数据库镜像迁移到 Always On？
- 什么是见证服务器？它的作用是什么？
- 数据库镜像在现代生产环境中还能使用吗？

---

## 下一步

理解了数据库镜像，我们来看 [SQL Server 复制：快照复制、事务复制、合并复制](/database/sqlserver/replication)，学习另一种数据分发技术。
