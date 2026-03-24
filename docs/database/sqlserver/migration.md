# SQL Server 登台环境与数据库迁移

你需要把 SQL Server 从 2012 升级到 2019。

或者从本地数据中心迁移到云端。

或者从物理机迁移到虚拟机。

数据库迁移是个高风险操作——一旦出错，可能导致业务中断、数据丢失。

这篇文章，带你系统地掌握 SQL Server 迁移的方法和最佳实践。

---

## 迁移概述

### 什么是数据库迁移？

数据库迁移 = 将数据库从一个环境移动到另一个环境。

```
┌─────────────────────────────────────────────────────────────┐
│                    数据库迁移场景                            │
│                                                              │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐ │
│  │  版本升级   │ ───► │   平台迁移  │ ───► │  环境迁移   │ │
│  │  2012→2019 │      │ 本地→云端   │      │ DEV→PROD  │ │
│  └─────────────┘      └─────────────┘      └─────────────┘ │
│                                                              │
│  共同特点：                                                  │
│  - 需要评估兼容性                                          │
│  - 需要测试验证                                            │
│  - 需要回滚方案                                            │
└─────────────────────────────────────────────────────────────┘
```

### 迁移类型

| 类型 | 说明 | 风险 | 停机时间 |
|-----|------|------|---------|
| **原地升级** | 就地升级 SQL Server | 高 | 长 |
| **迁移升级** | 备份/还原到新服务器 | 中 | 中 |
| **镜像迁移** | 使用数据库镜像过渡 | 低 | 短 |
| **Always On 迁移** | 使用可用性组过渡 | 低 | 极短 |

---

## 迁移前评估

### 1. 环境评估

```sql
-- 查看当前 SQL Server 版本
SELECT 
    @@VERSION AS Version,
    SERVERPROPERTY('ProductVersion') AS ProductVersion,
    SERVERPROPERTY('ProductLevel') AS ServicePack,
    SERVERPROPERTY('Edition') AS Edition,
    SERVERPROPERTY('ServerName') AS ServerName,
    SERVERPROPERTY('MachineName') AS MachineName;

-- 查看 SQL Server 功能使用情况
SELECT 
    feature_name,
    feature_id,
    feature_description
FROM sys.dm_db_registry_sql_features
ORDER BY feature_id;

-- 查看已安装的组件
EXEC sp_configure 'show advanced options', 1;
RECONFIGURE;
EXEC sp_configure;
```

### 2. 数据库评估

```sql
-- 查看数据库基本信息
SELECT 
    name AS DatabaseName,
    compatibility_level,
    collation_name,
    state_desc,
    recovery_model_desc,
    is_read_only,
    user_access_desc,
    create_date,
    snapshot_isolation_state_desc,
    is_ansi_null_default_on
FROM sys.databases
WHERE name NOT IN ('master', 'model', 'msdb', 'tempdb');

-- 查看数据库文件
SELECT 
    DB_NAME(database_id) AS DatabaseName,
    name AS FileName,
    physical_name,
    type_desc,
    size * 8 / 1024 AS SizeMB,
    max_size * 8 / 1024 AS MaxSizeMB,
    growth AS GrowthMB,
    is_percent_growth
FROM sys.master_files
WHERE database_id > 4;

-- 查看数据库大小
EXEC sp_spaceused;
EXEC sp_MSforeachtable 'EXEC sp_spaceused ''?''';

-- 查看是否使用过时的功能
SELECT 
    OBJECT_NAME(object_id) AS ObjectName,
    type_desc,
    definition
FROM sys.sql_modules
WHERE definition LIKE '%sp_%'  -- 检查是否使用旧存储过程命名
   OR definition LIKE '%text%';  -- 检查是否使用 text/ntext 类型
```

### 3. 应用评估

```powershell
# 查看连接字符串
Get-Content "C:\App\web.config" | Select-String "ConnectionString"

# 查看应用程序
Get-Process | Select-Object Name, Company, ProductVersion

# 查看依赖关系
# - .NET Framework 版本
# - ODBC/OLEDB 驱动
# - SQL Server Native Client 版本
```

---

## 升级前测试

### 数据迁移助手（DMA）

```powershell
# 下载并安装 DMA
# https://docs.microsoft.com/en-us/sql/dma/dma-overview

# 运行 DMA 评估
# 1. 选择「Assessment」
# 2. 选择源服务器和数据库
# 3. 选择目标版本（2019）
# 4. 查看兼容性报告

# DMA 检测的问题类型：
# - Breaking Changes（破坏性更改）
# - Behavior Changes（行为更改）
# - Deprecated Features（弃用功能）
```

### 升级顾问（Upgrade Advisor）

```powershell
# 下载并安装 Upgrade Advisor
# 用于 SQL Server 2005/2008 迁移到新版本

# 分析服务器
Setup.exe /Action=RunDiscovery
Setup.exe /Action=ScanForUpdates
Setup.exe /Action=Upgrade
```

---

## 迁移方法

### 方法 1：备份/还原（最简单）

```sql
-- 源服务器：完整备份
BACKUP DATABASE SalesDB
TO DISK = '\\BackupShare\SalesDB_Full.bak'
WITH COMPRESSION,
     CHECKSUM,
     STATS = 10;

-- 目标服务器：检查备份
RESTORE HEADERONLY
FROM DISK = '\\BackupShare\SalesDB_Full.bak';

-- 目标服务器：还原数据库
RESTORE DATABASE SalesDB
FROM DISK = '\\BackupShare\SalesDB_Full.bak'
WITH REPLACE,
     MOVE 'SalesDB_Data' TO 'E:\Data\SalesDB.mdf',
     MOVE 'SalesDB_Log' TO 'F:\Logs\SalesDB_log.ldf';

-- 验证数据库
DBCC CHECKDB('SalesDB');
```

**优点**：简单、无需额外工具
**缺点**：需要停机时间、数据传输时间长

### 方法 2：分离/附加（快速）

```sql
-- 源服务器：分离数据库
USE master;
EXEC sp_detach_db @dbname = 'SalesDB',
                  @skipchecks = 'true';

-- 复制数据文件到目标服务器
-- COPY \\SourceServer\D$\Data\SalesDB.mdf \\TargetServer\D$\Data\
-- COPY \\SourceServer\D$\Data\SalesDB_log.ldf \\TargetServer\D$\Data\

-- 目标服务器：附加数据库
CREATE DATABASE SalesDB
ON PRIMARY (
    NAME = 'SalesDB_Data',
    FILENAME = 'E:\Data\SalesDB.mdf'
)
LOG ON (
    NAME = 'SalesDB_Log',
    FILENAME = 'F:\Logs\SalesDB_log.ldf'
)
FOR ATTACH;

-- 验证数据库
DBCC CHECKDB('SalesDB');
```

**优点**：停机时间短
**缺点**：源数据库必须离线、有风险

### 方法 3：日志传送（低停机）

```sql
-- 步骤 1：源服务器 - 完整备份并还原（NORECOVERY）
BACKUP DATABASE SalesDB
TO DISK = '\\BackupShare\SalesDB_Full.bak'
WITH COMPRESSION;

RESTORE DATABASE SalesDB
FROM DISK = '\\BackupShare\SalesDB_Full.bak'
WITH NORECOVERY,
     MOVE 'SalesDB_Data' TO 'E:\Data\SalesDB.mdf',
     MOVE 'SalesDB_Log' TO 'F:\Logs\SalesDB_log.ldf';

-- 步骤 2：配置日志传送
-- 右键数据库 → Properties → Transaction Log Shipping

-- 或使用 T-SQL 配置
-- 主服务器：启用日志传送
EXEC sp_addlog_shipping_primary_database
    @database = 'SalesDB',
    @backup_directory = '\\BackupShare\LogShipping\SalesDB',
    @backup_share = '\\BackupShare\LogShipping\SalesDB',
    @backup_job_name = 'LSBackup_SalesDB',
    @backup_retention_period = 1440,
    @backup_threshold = 60,
    @threshold_alert_enabled = 1,
    @history_retention_period = 1440,
    @backup_job_id = @backup_job_id OUTPUT;

-- 辅助服务器：初始化
RESTORE LOG SalesDB
FROM DISK = '\\BackupShare\LogShipping\SalesDB\SalesDB_LogBackup.trn'
WITH NORECOVERY;

EXEC sp_addlog_shipping_secondary_database
    @primary_database = 'SalesDB',
    @secondary_server = 'TargetServer',
    @secondary_database = 'SalesDB',
    @restore_delay = 0,
    @restore_interval = 0,
    @restore_threshold = 45,
    @threshold_alert_enabled = 1,
    @history_retention_period = 1440,
    @restore_job_name = 'LSRestore_SalesDB',
    @monitor_server = 'MonitorServer';

-- 步骤 3：监控日志传送
-- 右键数据库 → Transaction Log Shipping → View Log Shipping Status

-- 步骤 4：切换
-- 1. 源服务器：最终日志备份
BACKUP LOG SalesDB
TO DISK = '\\BackupShare\LogShipping\SalesDB\Final.trn'
WITH NORECOVERY;

-- 2. 辅助服务器：恢复最终日志
RESTORE LOG SalesDB
FROM DISK = '\\BackupShare\LogShipping\SalesDB\Final.trn'
WITH RECOVERY;

-- 3. 更新连接字符串指向新服务器
```

### 方法 4：Always On 迁移（零停机）

```sql
-- 步骤 1：配置 Always On AG（在新服务器上）
CREATE AVAILABILITY GROUP SalesAG
FOR DATABASE SalesDB
REPLICA ON
    'NewServer1' WITH (
        ENDPOINT_URL = 'TCP://NewServer1:5022',
        AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
        FAILOVER_MODE = AUTOMATIC
    ),
    'NewServer2' WITH (
        ENDPOINT_URL = 'TCP://NewServer2:5022',
        AVAILABILITY_MODE = SYNCHRONOUS_COMMIT,
        FAILOVER_MODE = AUTOMATIC
    );

-- 步骤 2：同步数据
-- AG 会自动同步数据

-- 步骤 3：执行故障转移
ALTER AVAILABILITY GROUP SalesAG FAILOVER;

-- 步骤 4：验证
SELECT 
    ag.name AS AGName,
    ar.replica_server_name,
    ars.role_desc,
    ars.synchronization_state_desc
FROM sys.availability_groups ag
JOIN sys.availability_replicas ar ON ag.group_id = ar.group_id
JOIN sys.dm_hadr_availability_replica_states ars ON ar.replica_id = ars.replica_id;
```

---

## 迁移后验证

### 1. 数据库完整性

```sql
-- 检查数据库完整性
DBCC CHECKDB('SalesDB');

-- 检查所有数据库
EXEC sp_MSforeachdb 'DBCC CHECKDB(''?'')';
```

### 2. 对象完整性

```sql
-- 检查缺失的外键
SELECT 
    OBJECT_NAME(parent_object_id) AS TableName,
    name AS ConstraintName,
    type_desc
FROM sys.key_constraints
WHERE type = 'F'
AND parent_object_id NOT IN (SELECT object_id FROM sys.tables);

-- 检查孤立用户
EXEC sp_change_users_login 'Report';

-- 检查索引
EXEC sp_MSforeachtable 'EXEC sp_spaceused ''?''';
```

### 3. 应用程序验证

```powershell
# 测试连接
Test-NetConnection -ComputerName "NewServer" -Port 1433

# 测试应用程序
# - 启动应用程序
# - 测试核心功能
# - 验证性能
```

### 4. 性能基线

```sql
-- 对比迁移前后的性能
-- CPU 使用率
-- 内存使用率
-- 查询响应时间
-- I/O 延迟

-- 捕获关键查询的执行计划
SELECT TOP 20
    qs.execution_count,
    qs.total_worker_time / 1000 AS total_cpu_ms,
    qs.total_elapsed_time / 1000 AS total_elapsed_ms,
    SUBSTRING(qt.text, (qs.statement_start_offset/2)+1,
        ((CASE qs.statement_end_offset
          WHEN -1 THEN DATALENGTH(qt.text)
          ELSE qs.statement_end_offset END
         - qs.statement_start_offset)/2)+1) AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
ORDER BY qs.total_worker_time DESC;
```

---

## 回滚方案

### 准备回滚

```sql
-- 在迁移前创建还原点
-- 保持源服务器数据库处于静默模式
ALTER DATABASE SalesDB SET READ_ONLY;

-- 或使用数据库快照（Enterprise Edition）
CREATE DATABASE SalesDB_Snapshot
ON (
    NAME = 'SalesDB_Data',
    FILENAME = 'D:\Snapshots\SalesDB_Snapshot.ss'
) AS SNAPSHOT OF SalesDB;

-- 记录源服务器连接信息
-- 保持备份副本
```

### 执行回滚

```sql
-- 如果需要回滚
-- 1. 停止应用程序
-- 2. 分离目标服务器数据库
EXEC sp_detach_db @dbname = 'SalesDB';

-- 3. 还原源服务器数据库
RESTORE DATABASE SalesDB
FROM DISK = '\\BackupShare\SalesDB_Full.bak'
WITH REPLACE,
     RECOVERY;

-- 4. 恢复应用程序连接
```

---

## 常见问题

### 问题 1：兼容性级别过低

```sql
-- 查看兼容性级别
SELECT 
    name,
    compatibility_level
FROM sys.databases;

-- 升级兼容性级别（谨慎）
ALTER DATABASE SalesDB SET COMPATIBILITY_LEVEL = 150;  -- SQL Server 2019

-- 测试后再升级
-- 或保持原兼容性级别直到测试完成
```

### 问题 2：孤立登录名

```sql
-- 查看孤立用户
EXEC sp_change_users_login 'Report';

-- 修复孤立用户
EXEC sp_change_users_login 'Auto_Fix', 'AppUser', NULL, 'Password123';

-- 或创建登录名
CREATE LOGIN [Domain\AppUser] FROM WINDOWS;
CREATE LOGIN [AppUser] WITH PASSWORD = 'Password123', DEFAULT_DATABASE = SalesDB;

-- 使用迁移脚本生成登录名
EXEC sp_help_revlogin;
```

### 问题 3：TempDB 配置

```sql
-- 查看 TempDB 配置
SELECT 
    name,
    physical_name,
    size * 8 / 1024 AS SizeMB,
    max_size,
    growth
FROM tempdb.sys.database_files;

-- 优化 TempDB
-- 1. 增加文件数量（CPU 核心数）
-- 2. 设置初始大小
-- 3. 禁用自动增长

ALTER DATABASE tempdb MODIFY FILE (
    NAME = 'tempdev',
    SIZE = 1024MB,
    FILEGROWTH = 256MB
);

-- 添加更多 TempDB 数据文件
ALTER DATABASE tempdb ADD FILE (
    NAME = 'tempdev2',
    FILENAME = 'E:\Data\tempdb2.ndf',
    SIZE = 1024MB,
    FILEGROWTH = 256MB
);
```

---

## 面试追问方向

- 数据库迁移有哪些方法？各自的优缺点是什么？
- 什么是日志传送？适用于什么场景？
- 如何实现零停机迁移？
- 迁移前需要做哪些评估？
- 如何处理孤立用户？
- 回滚方案应该怎么设计？

---

## 下一步

掌握了数据库迁移，我们来看 [SQL Server 面试高频问题汇总](/database/sqlserver/interview-summary)，回顾 SQL Server 的核心知识点。
