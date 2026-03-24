# SQL Server 备份策略与恢复模式

凌晨 3 点，数据库被误删了。

你备份了吗？

备份是数据安全的最后一道防线。再好的高可用方案，也挡不住「rm -rf」。一个好的备份策略，能让你在灾难中恢复业务。

这篇文章，带你全面掌握 SQL Server 备份与恢复。

---

## 恢复模式

### 三种恢复模式

| 恢复模式 | 日志备份 | 恢复到时间点 | 适用场景 |
|---------|---------|------------|---------|
| **完整（FULL）** | 需要 | ✓ | 生产数据库 |
| **大容量日志（BULK_LOGGED）** | 需要 | 部分 | 大批量导入 |
| **简单（SIMPLE）** | 不需要 | ✗ | 开发/测试 |

### 完整恢复模式（FULL）

```
┌─────────────────────────────────────────────────────────────┐
│              完整恢复模式（FULL）                            │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ 数据库备份（Full Backup）                             │ │
│  │  ─────────────────────────────────────────────────  │ │
│  │                                                     │ │
│  │ ┌───────────────────────────────────────────────┐  │ │
│  │ │ 日志备份 1 (Log Backup)                       │  │ │
│  │ │ ───────────────────────────────────────────  │  │ │
│  │ │ 日志备份 2 (Log Backup)                      │  │ │
│  │ │ ───────────────────────────────────────────  │  │ │
│  │ │ 日志备份 3 (Log Backup)                      │  │ │
│  │ └───────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                              │
│  特点：                                                     │
│  - 可以恢复到任意时间点（PITR）                             │
│  - 需要定期备份日志                                         │
│  - 日志文件会持续增长                                       │
└─────────────────────────────────────────────────────────────┘
```

### 简单恢复模式（SIMPLE）

```
┌─────────────────────────────────────────────────────────────┐
│              简单恢复模式（SIMPLE）                           │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ 数据库备份 1 (Full Backup)                          │ │
│  │                                                     │ │
│  │ ─────────────────────────────────────────────────  │ │
│  │                                                     │ │
│  │ 数据库备份 2 (Full Backup)                          │ │
│  │                                                     │ │
│  │ 日志在检查点自动截断                                │ │
│  │  ─────────────────────────────────────────────────  │ │
│  │                                                     │ │
│  │                                                     │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                              │
│  特点：                                                     │
│  - 只能恢复到备份点                                        │
│  - 无法恢复到特定时间点                                     │
│  - 日志不会无限增长                                        │
│  - 适合开发/测试环境                                       │
└─────────────────────────────────────────────────────────────┘
```

### 修改恢复模式

```sql
-- 查看当前恢复模式
SELECT 
    name,
    recovery_model,
    recovery_model_desc
FROM sys.databases
WHERE name = 'SalesDB';

-- 修改为完整恢复模式
ALTER DATABASE SalesDB SET RECOVERY FULL;

-- 修改为简单恢复模式
ALTER DATABASE SalesDB SET RECOVERY SIMPLE;

-- 修改为大容量日志模式
ALTER DATABASE SalesDB SET RECOVERY BULK_LOGGED;
```

---

## 备份类型

### 完整备份（Full Backup）

```sql
-- 完整备份
BACKUP DATABASE SalesDB
TO DISK = 'D:\Backup\SalesDB_Full_20240315.bak'
WITH 
    COMPRESSION,           -- 压缩备份
    CHECKSUM,               -- 校验和验证
    DESCRIPTION = 'SalesDB Full Backup 2024-03-15',
    STATS = 10;             -- 每 10% 显示进度

-- 备份到多个文件（条带化备份）
BACKUP DATABASE SalesDB
TO DISK = 'D:\Backup\SalesDB_Stripe1.bak',
   DISK = 'E:\Backup\SalesDB_Stripe2.bak',
   DISK = 'F:\Backup\SalesDB_Stripe3.bak'
WITH COMPRESSION;

-- 备份只读文件组
BACKUP DATABASE SalesDB FILEGROUP = 'PRIMARY'
TO DISK = 'D:\Backup\SalesDB_PrimaryFG.bak'
WITH COMPRESSION;
```

### 差异备份（Differential Backup）

```sql
-- 差异备份（基于上次完整备份）
BACKUP DATABASE SalesDB
TO DISK = 'D:\Backup\SalesDB_Diff_20240315.bak'
WITH 
    DIFFERENTIAL,
    COMPRESSION,
    CHECKSUM;

-- 差异备份记录了自上次完整备份以来的所有更改
-- 恢复时需要：完整备份 + 最新差异备份 + 日志备份
```

### 日志备份（Log Backup）

```sql
-- 日志备份（只适用于完整/大容量日志模式）
BACKUP LOG SalesDB
TO DISK = 'D:\Backup\SalesDB_Log_20240315_1400.trn'
WITH 
    COMPRESSION,
    CHECKSUM,
    COMPRESSION;

-- 备份日志并截断
-- 在 SIMPLE 模式下不能使用

-- 只截断日志，不备份
BACKUP LOG SalesDB WITH TRUNCATE_ONLY;

-- 备份日志到多个文件
BACKUP LOG SalesDB
TO DISK = 'D:\Backup\SalesDB_Log1.trn',
   DISK = 'E:\Backup\SalesDB_Log2.trn'
WITH COMPRESSION;
```

### 文件备份（File Backup）

```sql
-- 备份特定数据文件
BACKUP DATABASE SalesDB
FILE = 'SalesDB_Data1'
TO DISK = 'D:\Backup\SalesDB_File1.bak'
WITH COMPRESSION;

-- 备份文件组
BACKUP DATABASE SalesDB
FILEGROUP = 'SalesDB_FG1'
TO DISK = 'D:\Backup\SalesDB_FG1.bak'
WITH COMPRESSION;
```

---

## 备份策略设计

### 典型备份策略

#### 策略 1：完整 + 日志（最常用）

```sql
-- 每天完整备份（每天凌晨 2 点）
-- 每小时日志备份（除完整备份时间）

-- 备份脚本（完整备份）
BACKUP DATABASE SalesDB
TO DISK = '\\BackupServer\SalesDB\Full\SalesDB_Full_' 
    + CONVERT(VARCHAR(10), GETDATE(), 112) + '.bak'
WITH 
    COMPRESSION,
    CHECKSUM,
    INIT;  -- 覆盖媒体集

-- 备份脚本（日志备份）
BACKUP LOG SalesDB
TO DISK = '\\BackupServer\SalesDB\Log\SalesDB_Log_' 
    + CONVERT(VARCHAR(10), GETDATE(), 112) + '_' 
    + REPLACE(CONVERT(VARCHAR(5), GETDATE(), 108), ':', '') + '.trn'
WITH 
    COMPRESSION,
    NOINIT;  -- 追加到媒体集
```

#### 策略 2：完整 + 差异 + 日志

```sql
-- 每周完整备份（周日）
-- 每天差异备份（周一-周六）
-- 每小时日志备份

-- 差异备份
BACKUP DATABASE SalesDB
TO DISK = 'D:\Backup\SalesDB_Diff.bak'
WITH 
    DIFFERENTIAL,
    COMPRESSION,
    INIT;  -- 每次覆盖

-- 恢复顺序：
-- 1. 最新完整备份
-- 2. 最新差异备份
-- 3. 最新日志备份
```

### RPO 和 RTO

| 指标 | 说明 | 影响因素 |
|-----|------|---------|
| **RPO（恢复点目标）** | 最多能丢失多长时间的数据 | 日志备份频率 |
| **RTO（恢复时间目标）** | 恢复需要多长时间 | 备份大小、恢复测试 |

```
备份策略 → RPO/RTO

每分钟日志备份 → RPO ≤ 1 分钟
每15分钟日志备份 → RPO ≤ 15 分钟
每小时日志备份 → RPO ≤ 1 小时

完整备份 100GB → RTO 约 30 分钟
完整备份 1TB → RTO 约 3-4 小时
```

---

## 恢复操作

### 恢复完整备份

```sql
-- 恢复到最新完整备份
RESTORE DATABASE SalesDB
FROM DISK = 'D:\Backup\SalesDB_Full_20240315.bak'
WITH REPLACE,
     NORECOVERY;  -- 准备恢复后续备份

-- 恢复后验证
RESTORE VERIFYONLY
FROM DISK = 'D:\Backup\SalesDB_Full_20240315.bak';
```

### 恢复差异备份

```sql
-- 先恢复完整备份
RESTORE DATABASE SalesDB
FROM DISK = 'D:\Backup\SalesDB_Full_20240310.bak'
WITH REPLACE,
     NORECOVERY;

-- 恢复差异备份
RESTORE DATABASE SalesDB
FROM DISK = 'D:\Backup\SalesDB_Diff_20240315.bak'
WITH NORECOVERY;
```

### 恢复到时间点

```sql
-- 恢复到特定时间点
RESTORE DATABASE SalesDB
FROM DISK = 'D:\Backup\SalesDB_Full_20240315.bak'
WITH NORECOVERY;

RESTORE LOG SalesDB
FROM DISK = 'D:\Backup\SalesDB_Log_20240315_1000.trn'
WITH NORECOVERY;

RESTORE LOG SalesDB
FROM DISK = 'D:\Backup\SalesDB_Log_20240315_1100.trn'
WITH STOPAT = '2024-03-15 10:45:00',  -- 恢复到 10:45
     RECOVERY;
```

### 恢复日志序列

```sql
-- 查看备份历史
SELECT 
    bs.backup_set_id,
    bs.backup_set_uuid,
    bs.media_set_id,
    bs.database_name,
    bs.backup_start_date,
    bs.backup_finish_date,
    bs.backup_size,
    bs.first_lsn,
    bs.last_lsn,
    bs.checkpoint_lsn,
    bs.database_backup_lsn,
    bm.physical_device_name,
    CASE bs.type
        WHEN 'D' THEN 'Full'
        WHEN 'I' THEN 'Differential'
        WHEN 'L' THEN 'Log'
    END AS backup_type
FROM msdb.dbo.backupset bs
JOIN msdb.dbo.backupmediafamily bm ON bs.media_set_id = bm.media_set_id
WHERE bs.database_name = 'SalesDB'
ORDER BY bs.backup_start_date DESC;

-- 使用备份历史恢复
RESTORE HEADERONLY
FROM DISK = 'D:\Backup\SalesDB_Full.bak';
```

---

## 备份维护

### 备份保留策略

```sql
-- 删除过期备份
EXEC sp_delete_backuphistory 
    @oldest_date = '2024-01-01';

-- 删除旧的备份文件（维护计划）
EXECUTE master.dbo.xp_delete_file 
    0,  -- 文件类型（0=备份文件）
    'D:\Backup\SalesDB\',  -- 路径
    'bak',  -- 扩展名
    '2024-01-01';  -- 删除此日期之前的文件

-- 使用 SQL Server 维护计划
-- Management → Maintenance Plans → 向导
```

### 验证备份

```sql
-- 验证备份完整性
RESTORE VERIFYONLY
FROM DISK = 'D:\Backup\SalesDB_Full_20240315.bak'
WITH CHECKSUM;

-- 恢复到测试数据库
RESTORE DATABASE SalesDB_Test
FROM DISK = 'D:\Backup\SalesDB_Full_20240315.bak'
WITH REPLACE,
     RECOVERY,
     MOVE 'SalesDB_Data' TO 'D:\Data\SalesDB_Test.mdf',
     MOVE 'SalesDB_Log' TO 'D:\Logs\SalesDB_Test_log.ldf';

-- 完整性检查
DBCC CHECKDB('SalesDB_Test');
```

### 监控备份

```sql
-- 查看最近备份
SELECT TOP 10
    bs.database_name,
    bs.backup_start_date,
    bs.backup_finish_date,
    bs.backup_size / 1024 / 1024 AS SizeMB,
    CASE bs.type
        WHEN 'D' THEN 'Full'
        WHEN 'I' THEN 'Differential'
        WHEN 'L' THEN 'Log'
    END AS backup_type,
    DATEDIFF(MINUTE, bs.backup_start_date, bs.backup_finish_date) AS DurationMin
FROM msdb.dbo.backupset bs
WHERE bs.backup_set_id IN (
    SELECT MAX(backup_set_id)
    FROM msdb.dbo.backupset
    WHERE database_name = 'SalesDB'
    GROUP BY type
)
ORDER BY bs.backup_start_date DESC;

-- 检查失败的备份
SELECT 
    bs.database_name,
    bs.backup_start_date,
    bs.backup_finish_date,
    bs.server_name,
    bs.message
FROM msdb.dbo.backupset bs
WHERE bs.backup_set_id IN (
    SELECT MAX(backup_set_id)
    FROM msdb.dbo.backupset
    WHERE database_name = 'SalesDB'
    GROUP BY type
)
AND bs.backup_finish_date < DATEADD(DAY, -1, GETDATE());

-- 查看备份文件大小趋势
SELECT 
    CAST(backup_start_date AS DATE) AS backup_date,
    type,
    SUM(backup_size) / 1024 / 1024 AS total_size_mb,
    COUNT(*) AS backup_count
FROM msdb.dbo.backupset
WHERE database_name = 'SalesDB'
GROUP BY CAST(backup_start_date AS DATE), type
ORDER BY backup_date DESC;
```

---

## 常见备份场景

### 场景 1：复制数据库

```sql
-- 完整备份并恢复到新数据库
BACKUP DATABASE SalesDB
TO DISK = 'D:\Backup\SalesDB_Copy.bak'
WITH COMPRESSION;

RESTORE DATABASE SalesDB_Copy
FROM DISK = 'D:\Backup\SalesDB_Copy.bak'
WITH REPLACE,
     RECOVERY,
     MOVE 'SalesDB_Data' TO 'D:\Data\SalesDB_Copy.mdf',
     MOVE 'SalesDB_Log' TO 'D:\Logs\SalesDB_Copy_log.ldf';
```

### 场景 2：恢复部分数据

```sql
-- 恢复到新数据库
RESTORE DATABASE SalesDB_Restore
FROM DISK = 'D:\Backup\SalesDB_Full.bak'
WITH NORECOVERY,
     MOVE 'SalesDB_Data' TO 'D:\Data\SalesDB_Restore.mdf',
     MOVE 'SalesDB_Log' TO 'D:\Logs\SalesDB_Restore_log.ldf';

-- 从备份表复制数据
INSERT INTO Orders
SELECT * FROM SalesDB_Restore.dbo.Orders
WHERE order_date >= '2024-03-01';

-- 删除临时数据库
RESTORE DATABASE SalesDB_Restore WITH RECOVERY;
DROP DATABASE SalesDB_Restore;
```

### 场景 3：系统数据库备份

```sql
-- 备份 Master 数据库
BACKUP DATABASE master
TO DISK = 'D:\Backup\master.bak'
WITH COMPRESSION;

-- 备份 MSDB 数据库（包含作业、警报等）
BACKUP DATABASE msdb
TO DISK = 'D:\Backup\msdb.bak'
WITH COMPRESSION;

-- 备份 Model 数据库
BACKUP DATABASE model
TO DISK = 'D:\Backup\model.bak'
WITH COMPRESSION;

-- 注意：备份系统数据库后，应该记录：
-- - 服务器名称和实例名
-- - 登录名和密码
-- - 作业和警报定义
-- - 链接服务器
```

---

## 面试追问方向

- SQL Server 有哪三种恢复模式？各自的区别是什么？
- 完整备份、差异备份、日志备份的区别是什么？
- 什么是 RPO 和 RTO？如何确定备份策略？
- 如何恢复到特定时间点？
- 备份文件如何验证完整性？
- 如何备份和恢复系统数据库？

---

## 下一步

理解了备份策略，我们来看 [SQL Server 登台环境与数据库迁移](/database/sqlserver/migration)，学习如何安全地迁移数据库。
