# SQL Server 性能监控：DMV 与扩展事件（XEvent）

凌晨 2 点，数据库告警响应慢。

你打开 SSMS，却发现不知道该看什么指标。

这是很多 DBA 的困境。SQL Server 内置了大量监控工具，但很多人不知道它们的存在，或者不知道该用什么工具。

这篇文章，帮你建立完整的 SQL Server 监控知识体系。

---

## SQL Server 监控工具全景

```
┌─────────────────────────────────────────────────────────────┐
│                    SQL Server 监控工具                       │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │   DMV/DMF   │  │  XEvent    │  │   Profiler  │      │
│  │ 动态管理视图│  │ 扩展事件   │  │  (已过时)   │      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │  SSMS 监控  │  │  性能计数器  │  │  错误日志   │      │
│  │  活动监视器 │  │  PerfMon    │  │ Error Log   │      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## DMV（动态管理视图）

### DMV 分类

| 类别 | 前缀 | 说明 |
|-----|------|------|
| **数据库相关** | `dm_db_*` | 数据库操作统计 |
| **执行相关** | `dm_exec_*` | 查询执行、连接、会话 |
| **索引相关** | `dm_db_index_*` | 索引使用统计 |
| **I/O 相关** | `dm_io_*` | I/O 操作统计 |
| **内存相关** | `dm_os_*` | 内存、缓冲池统计 |
| **等待相关** | `dm_os_wait_*` | 等待类型统计 |

### 常用 DMV 查询

#### 1. 当前会话与连接

```sql
-- 查看当前所有会话
SELECT 
    session_id AS spid,
    login_name AS login_name,
    host_name AS host,
    program_name AS program,
    status AS status,
    cpu_time AS cpu_ms,
    memory_usage AS memory_8kb,
    reads AS logical_reads,
    writes AS writes,
    total_elapsed_time AS total_ms,
    CASE 
        WHEN status = 'running' THEN '运行中'
        WHEN status = 'runnable' THEN '可运行'
        WHEN status = 'suspended' THEN '挂起'
        WHEN status = 'sleeping' THEN '休眠'
    END AS status_desc,
    blocking_session_id AS blocked_by,
    SUBSTRING(st.text, (qs.statement_start_offset/2)+1,
        ((CASE qs.statement_end_offset
          WHEN -1 THEN DATALENGTH(st.text)
          ELSE qs.statement_end_offset END
         - qs.statement_start_offset)/2)+1) AS current_sql
FROM sys.dm_exec_sessions s
LEFT JOIN sys.dm_exec_requests q ON s.session_id = q.session_id
CROSS APPLY sys.dm_exec_sql_text(q.sql_handle) st
WHERE s.is_user_process = 1
ORDER BY s.cpu_time DESC;
```

#### 2. 当前阻塞

```sql
-- 查看阻塞信息
SELECT 
    blocked.session_id AS blocked_spid,
    blocker.session_id AS blocker_spid,
    blocked.status AS blocked_status,
    blocked.login_name AS blocked_login,
    blocked_txt.text AS blocked_sql,
    blocker.status AS blocker_status,
    blocker.login_name AS blocker_login,
    blocker_txt.text AS blocker_sql,
    blocked.wait_time AS wait_ms,
    blocked.wait_type AS wait_type,
    blocked.last_wait_type AS last_wait_type,
    blocked.blocking_session_id AS blocking_by,
    -- 被阻塞的锁信息
    bl.request_session_id AS blocked_lock_spid,
    bl.request_mode AS blocked_lock_mode,
    bl.request_status AS blocked_lock_status,
    resource_type = CASE bl.resource_type
        WHEN 'DATABASE' THEN '数据库'
        WHEN 'TABLE' THEN '表'
        WHEN 'PAGE' THEN '页'
        WHEN 'KEY' THEN '键'
        WHEN 'RID' THEN '行'
        ELSE bl.resource_type
    END,
    bl.resource_description AS lock_resource
FROM sys.dm_exec_requests blocked
CROSS APPLY sys.dm_exec_sql_text(blocked.sql_handle) blocked_txt
JOIN sys.dm_exec_requests blocker 
    ON blocked.blocking_session_id = blocker.session_id
CROSS APPLY sys.dm_exec_sql_text(blocker.sql_handle) blocker_txt
LEFT JOIN sys.dm_tran_locks bl
    ON bl.request_session_id = blocked.session_id
    AND bl.request_status = 'WAIT'
WHERE blocked.session_id > 50
ORDER BY blocked.wait_time DESC;
```

#### 3. 最耗资源的查询

```sql
-- 按总 CPU 时间排序
SELECT TOP 20
    SUBSTRING(qt.text, (qs.statement_start_offset/2)+1,
        ((CASE qs.statement_end_offset
          WHEN -1 THEN DATALENGTH(qt.text)
          ELSE qs.statement_end_offset END
         - qs.statement_start_offset)/2)+1) AS QueryText,
    qs.execution_count AS ExecCount,
    qs.total_worker_time / 1000 AS TotalCpuMs,
    qs.total_worker_time / 1000 / NULLIF(qs.execution_count, 0) AS AvgCpuMs,
    qs.total_elapsed_time / 1000 AS TotalElapsedMs,
    qs.total_elapsed_time / 1000 / NULLIF(qs.execution_count, 0) AS AvgElapsedMs,
    qs.total_logical_reads / NULLIF(qs.execution_count, 0) AS AvgLogicalReads,
    qs.total_physical_reads / NULLIF(qs.execution_count, 0) AS AvgPhysicalReads,
    qs.total_logical_writes / NULLIF(qs.execution_count, 0) AS AvgLogicalWrites,
    qs.last_execution_time AS LastExec,
    qp.query_plan AS QueryPlan
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
ORDER BY qs.total_worker_time DESC;

-- 按总逻辑读取排序
SELECT TOP 20
    SUBSTRING(qt.text, (qs.statement_start_offset/2)+1, ...) AS QueryText,
    qs.total_logical_reads AS TotalLogicalReads,
    qs.total_logical_reads / NULLIF(qs.execution_count, 0) AS AvgLogicalReads,
    qs.execution_count AS ExecCount
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
ORDER BY qs.total_logical_reads DESC;
```

#### 4. 等待统计

```sql
-- 整体等待统计
SELECT TOP 20
    wait_type AS WaitType,
    waiting_tasks_count AS WaitingTasksCount,
    wait_time_ms AS WaitTimeMs,
    max_wait_time_ms AS MaxWaitTimeMs,
    signal_wait_time_ms AS SignalWaitTimeMs,
    wait_time_ms - signal_wait_time_ms AS ResourceWaitTimeMs,
    CAST(100.0 * wait_time_ms / NULLIF(SUM(wait_time_ms) OVER(), 0) AS DECIMAL(5,2)) AS WaitPercentage,
    CASE wait_type
        WHEN 'CXPACKET' THEN '并行等待'
        WHEN 'PAGEIOLATCH_*' THEN 'I/O 等待'
        WHEN 'PAGELATCH_*' THEN '页闩锁'
        WHEN 'LCK_M_*' THEN '锁等待'
        WHEN 'ASYNC_NETWORK_IO' THEN '网络等待'
        WHEN 'WRITELOG' THEN '日志写入'
        WHEN 'SOS_SCHEDULER_YIELD' THEN '调度器让出'
        WHEN 'OLEDB' THEN 'OLEDB 调用'
        ELSE '其他'
    END AS WaitCategory
FROM sys.dm_os_wait_stats
WHERE wait_type NOT IN (
    SELECT wait_type FROM sys.dm_os_wait_stats
    WHERE wait_type LIKE 'SLEEP%'
    OR wait_type IN ('WAITFOR', 'REQUEST_OPERATION_MANAGER')
)
ORDER BY wait_time_ms DESC;

-- 按类型分组统计
SELECT 
    CASE 
        WHEN wait_type LIKE 'PAGEIOLATCH%' THEN 'PAGEIOLATCH'
        WHEN wait_type LIKE 'PAGELATCH%' THEN 'PAGELATCH'
        WHEN wait_type LIKE 'LCK_M%' THEN 'LOCK'
        WHEN wait_type LIKE 'ASYNC%' THEN 'ASYNC'
        WHEN wait_type LIKE 'NETWORK%' THEN 'NETWORK'
        ELSE 'OTHER'
    END AS WaitCategory,
    SUM(wait_time_ms) AS TotalWaitMs,
    SUM(waiting_tasks_count) AS TotalWaitingTasks,
    MAX(max_wait_time_ms) AS MaxWaitMs,
    CAST(100.0 * SUM(wait_time_ms) / NULLIF(SUM(wait_time_ms) OVER(), 0) AS Percentage
FROM sys.dm_os_wait_stats
GROUP BY 
    CASE 
        WHEN wait_type LIKE 'PAGEIOLATCH%' THEN 'PAGEIOLATCH'
        WHEN wait_type LIKE 'PAGELATCH%' THEN 'PAGELATCH'
        WHEN wait_type LIKE 'LCK_M%' THEN 'LOCK'
        WHEN wait_type LIKE 'ASYNC%' THEN 'ASYNC'
        WHEN wait_type LIKE 'NETWORK%' THEN 'NETWORK'
        ELSE 'OTHER'
    END
ORDER BY TotalWaitMs DESC;
```

#### 5. 索引使用统计

```sql
-- 查看索引使用情况
SELECT 
    OBJECT_NAME(s.object_id) AS TableName,
    i.name AS IndexName,
    i.type_desc AS IndexType,
    s.user_seeks AS Seeks,
    s.user_scans AS Scans,
    s.user_lookups AS Lookups,
    s.user_updates AS Updates,
    s.last_user_seek AS LastSeek,
    s.last_user_scan AS LastScan,
    s.last_user_lookup AS LastLookup,
    s.last_user_update AS LastUpdate,
    -- 使用率评分
    CAST(100.0 * (s.user_seeks + s.user_scans) / NULLIF(s.user_updates, 0) AS DECIMAL(10,2)) AS SeekScanToUpdateRatio,
    CASE 
        WHEN s.user_seeks + s.user_scans = 0 THEN '未使用'
        WHEN s.user_updates > 10 * (s.user_seeks + s.user_scans) THEN '可能不需要'
        ELSE '使用中'
    END AS Recommendation
FROM sys.dm_db_index_usage_stats s
JOIN sys.indexes i ON s.object_id = i.object_id AND s.index_id = i.index_id
WHERE OBJECTPROPERTY(s.object_id, 'IsUserTable') = 1
  AND s.database_id = DB_ID()
ORDER BY (s.user_seeks + s.user_scans) ASC;
```

---

## 扩展事件（XEvent）

### XEvent vs Profiler

| 特性 | Extended Events | SQL Profiler |
|-----|----------------|--------------|
| **性能开销** | 低 | 高 |
| **可扩展性** | 强 | 弱 |
| **目标类型** | 多种（文件、环形缓冲区、ETW） | 仅跟踪文件/表 |
| **事件数量** | 数百个 | 几十个 |
| **支持平台** | Windows/Linux | 仅 Windows |
| **推荐程度** | ✓ 推荐 | ✗ 已过时 |

### 创建 XEvent 会话

#### 1. 捕获慢查询

```sql
-- 创建捕获 > 1 秒查询的会话
CREATE EVENT SESSION [SlowQueries] ON SERVER
ADD EVENT sqlserver.sql_statement_completed
(
    ACTION
    (
        sqlserver.sql_text,
        sqlserver.query_hash,
        sqlserver.query_plan_hash,
        sqlserver.session_id,
        sqlserver.tsql_stack,
        sqlserver.username
    )
    WHERE [duration] > 1000000  -- 超过 1 秒（微秒）
)
ADD EVENT sqlserver.sp_statement_completed
(
    ACTION
    (
        sqlserver.sql_text,
        sqlserver.query_hash,
        sqlserver.session_id
    )
    WHERE [duration] > 1000000
)
ADD TARGET package0.event_file
(
    SET filename = 'C:\XEvents\SlowQueries.xel',
        max_file_size = 100,
        max_rollover_files = 5
)
WITH (STARTUP_STATE = OFF);

-- 启动会话
ALTER EVENT SESSION [SlowQueries] ON SERVER STATE = START;

-- 停止会话
ALTER EVENT SESSION [SlowQueries] ON SERVER STATE = STOP;

-- 删除会话
DROP EVENT SESSION [SlowQueries] ON SERVER;
```

#### 2. 捕获死锁

```sql
-- 创建捕获死锁的会话
CREATE EVENT SESSION [Deadlocks] ON SERVER
ADD EVENT sqlserver.xml_deadlock_report
(
    ACTION
    (
        sqlserver.sql_text,
        sqlserver.session_id,
        sqlserver.tsql_stack
    )
)
ADD TARGET package0.event_file
(
    SET filename = 'C:\XEvents\Deadlocks.xel',
        max_file_size = 50,
        max_rollover_files = 10
)
WITH (STARTUP_STATE = ON);  -- 服务器启动时自动启动

ALTER EVENT SESSION [Deadlocks] ON SERVER STATE = START;
```

#### 3. 捕获阻塞

```sql
-- 创建捕获长时间阻塞的会话
CREATE EVENT SESSION [LongBlocking] ON SERVER
ADD EVENT sqlserver.lock_wait_end
(
    ACTION
    (
        sqlserver.sql_text,
        sqlserver.session_id,
        sqlserver.blocking_session_id,
        sqlserver.database_name
    )
    WHERE [duration] > 30000  -- 超过 30 秒
)
ADD TARGET package0.ring_buffer
(
    SET max_memory = 4096
)
WITH (STARTUP_STATE = OFF);
```

### 读取 XEvent 数据

```sql
-- 从文件读取
SELECT 
    event_data.value('(event/@timestamp)[1]', 'DATETIME2') AS EventTime,
    event_data.value('(event/data[@name="duration"])[1]', 'BIGINT') / 1000 AS DurationMs,
    event_data.value('(event/data[@name="cpu_time"])[1]', 'INT') / 1000 AS CpuMs,
    event_data.value('(event/data[@name="logical_reads"])[1]', 'BIGINT') AS LogicalReads,
    event_data.value('(event/action[@name="sql_text"])[1]', 'NVARCHAR(MAX)') AS SqlText,
    event_data.value('(event/action[@name="session_id"])[1]', 'INT') AS SessionId,
    event_data.value('(event/action[@name="query_hash"])[1]', 'NVARCHAR(100)') AS QueryHash
FROM sys.fn_xe_file_target_read_file
(
    'C:\XEvents\SlowQueries*.xel',
    NULL, NULL, NULL
) AS e
CROSS APPLY (SELECT CAST(e.event_data AS XML) AS event_data) AS ed
ORDER BY EventTime DESC;

-- 从环形缓冲区读取
SELECT 
    event_data.value('(event/@timestamp)[1]', 'DATETIME2') AS EventTime,
    event_data.value('(event/data[@name="duration"])[1]', 'BIGINT') / 1000 AS DurationMs,
    event_data.value('(event/action[@name="session_id"])[1]', 'INT') AS SessionId,
    event_data.value('(event/action[@name="blocking_session_id"])[1]', 'INT') AS BlockingSessionId,
    event_data.value('(event/action[@name="sql_text"])[1]', 'NVARCHAR(MAX)') AS SqlText
FROM 
(
    SELECT CAST(event_data AS XML) AS event_data
    FROM sys.dm_xe_sessions xs
    JOIN sys.dm_xe_session_targets xst ON xs.address = xst.event_session_address
    CROSS APPLY (SELECT CAST(target_data AS XML) FROM sys.dm_xe_session_target_values WHERE target_data IS NOT NULL) AS td(event_data)
    WHERE xs.name = 'LongBlocking'
) AS events
ORDER BY EventTime DESC;
```

---

## 常用监控脚本

### 1. 系统概览

```sql
-- SQL Server 整体健康检查
SELECT 
    @@SERVERNAME AS ServerName,
    DB_NAME() AS DatabaseName,
    GETDATE() AS CurrentTime,
    
    -- CPU 信息
    (SELECT AVG(cpu_busy) FROM sys.dm_os_sys_info) AS AvgCpuBusyPercent,
    
    -- 内存信息
    (SELECT cntr_value / 1024.0 FROM sys.dm_os_performance_counters 
     WHERE counter_name = 'Total Server Memory (KB)') AS TotalServerMemoryMB,
    (SELECT cntr_value / 1024.0 FROM sys.dm_os_performance_counters 
     WHERE counter_name = 'Target Server Memory (KB)') AS TargetServerMemoryMB,
    
    -- 缓冲池信息
    (SELECT COUNT(*) * 8 / 1024 FROM sys.dm_os_buffer_descriptors) AS BufferPoolUsedMB,
    
    -- 连接数
    (SELECT COUNT(*) FROM sys.dm_exec_connections) AS CurrentConnections,
    (SELECT MAX(CAST(value AS INT)) FROM sys.configurations WHERE name = 'max server memory (MB)') AS MaxMemoryMB,
    
    -- 可用空间
    (SELECT SUM(CAST(size AS BIGINT) * 8 / 1024) FROM sys.database_files WHERE type = 0) AS DataFileSizeMB,
    (SELECT SUM(CAST(size AS BIGINT) * 8 / 1024) FROM sys.database_files WHERE type = 1) AS LogFileSizeMB;
```

### 2. 性能基线

```sql
-- 建立性能基线（定期执行，记录结果）
CREATE TABLE PerformanceBaseline (
    ID INT IDENTITY PRIMARY KEY,
    CaptureTime DATETIME DEFAULT GETDATE(),
    MetricName NVARCHAR(100),
    MetricValue DECIMAL(18,4)
);

-- 捕获基线
INSERT INTO PerformanceBaseline (MetricName, MetricValue)
SELECT 'BatchRequestsPerSec', 
    CAST(SUM(CASE WHEN counter_name = 'Batch Requests/sec' THEN cntr_value END) AS FLOAT)
FROM sys.dm_os_performance_counters
WHERE object_name LIKE '%Batch%';

INSERT INTO PerformanceBaseline (MetricName, MetricValue)
SELECT 'PageLifeExpectancy',
    CAST(SUM(CASE WHEN counter_name = 'Page life expectancy' THEN cntr_value END) AS FLOAT)
FROM sys.dm_os_performance_counters
WHERE object_name LIKE '%Buffer Manager%';

INSERT INTO PerformanceBaseline (MetricName, MetricValue)
SELECT 'WaitStats_TotalWaitTime',
    CAST(SUM(wait_time_ms) AS FLOAT)
FROM sys.dm_os_wait_stats;
```

---

## 监控最佳实践

### 1. 定期监控任务

```sql
-- 创建每日监控作业
CREATE PROCEDURE usp_DailyHealthCheck
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @html NVARCHAR(MAX);
    
    -- 检查点 1：当前阻塞
    IF EXISTS (SELECT 1 FROM sys.dm_exec_requests WHERE blocking_session_id > 0)
    BEGIN
        PRINT '警告：存在阻塞会话！';
        -- 记录或告警
    END
    
    -- 检查点 2：页面预期寿命
    DECLARE @ple INT;
    SELECT @ple = cntr_value FROM sys.dm_os_performance_counters 
    WHERE counter_name = 'Page life expectancy';
    
    IF @ple < 300
    BEGIN
        PRINT '警告：页面预期寿命低于 300 秒！';
    END
    
    -- 检查点 3：日志空间
    DBCC SQLPERF(LOGSPACE);
    -- 检查日志使用率
    
    -- 检查点 4：长时间运行的查询
    SELECT * FROM sys.dm_exec_requests 
    WHERE total_elapsed_time > 60000  -- 超过 1 分钟
      AND session_id > 50;
END
```

### 2. 告警配置

```sql
-- 配置数据库邮件
EXEC sp_configure 'show advanced options', 1;
RECONFIGURE;
EXEC sp_configure 'Database Mail XPs', 1;
RECONFIGURE;

-- 发送告警邮件
EXEC msdb.dbo.sp_send_dbmail
    @profile_name = 'DBA_Profile',
    @recipients = 'dba@company.com',
    @subject = 'SQL Server 告警：检测到死锁',
    @body = '检测到死锁，请立即检查！',
    @body_format = 'HTML';
```

---

## 面试追问方向

- SQL Server 有哪些监控工具？DMV 和扩展事件的区别是什么？
- 如何使用 DMV 查看当前阻塞？
- 如何使用 DMV 找出最耗资源的查询？
- 扩展事件如何创建和配置？
- 常用的等待类型有哪些？如何分析等待统计？
- Page Life Expectancy (PLE) 是什么指标？

---

## 下一步

学会了性能监控，我们来看 [SQL Server 查询优化器与计划指南](/database/sqlserver/query-optimizer)，深入理解查询优化的内部机制。
