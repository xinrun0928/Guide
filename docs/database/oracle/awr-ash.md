# Oracle AWR/ASH：性能诊断的双子星

数据库又卡了？

你一头雾水，不知道从哪查起。

top 命令看了，CPU 也不高，内存也够用。

AWR 和 ASH，就是 Oracle 给你的「性能雷达」。

今天，学会用 Oracle 内置的性能诊断工具。

---

## AWR 是什么？

AWR（Automatic Workload Repository，自动工作负载库）是 Oracle 收集的性能统计数据仓库。

```
AWR 数据收集：
    ↓ 每小时自动收集
    ↓ 可配置
快照数据 ────────────────────────────────────► AWR 存储（默认保留 8 天）
    ↓
    统计信息：
    ├── 系统统计（CPU、I/O、内存）
    ├── SQL 统计（执行次数、耗时、逻辑读）
    ├── 段统计（表、索引访问）
    └── 等待事件统计
```

---

## AWR 基本操作

### 查看快照

```sql
-- 查看 AWR 快照
SELECT snap_id, startup_time, begin_interval_time, end_interval_time
FROM dba_hist_snapshot
ORDER BY snap_id DESC
FETCH FIRST 20 ROWS;

-- 查看最近快照
SELECT * FROM (
    SELECT snap_id, 
           TO_CHAR(begin_interval_time, 'YYYY-MM-DD HH24:MI') AS begin_time,
           TO_CHAR(end_interval_time, 'YYYY-MM-DD HH24:MI') AS end_time
    FROM dba_hist_snapshot
    ORDER BY snap_id DESC
) WHERE ROWNUM <= 10;
```

### 生成 AWR 报告

```sql
-- SQL*Plus 中生成 AWR 报告
-- @$ORACLE_HOME/rdbms/admin/awrgrpt.sql

-- 指定时间段生成报告
 @$ORACLE_HOME/rdbms/admin/awrrpt.sql
```

### AWR 报告内容解读

```
AWR 报告主要部分：
├── 1. 报告概要
│   ├── 快照信息
│   ├── 负载配置
│   └── 缓存大小
├── 2. 关键统计摘要
│   ├── 实例统计
│   ├── 按秒统计
│   └── 等待事件统计
├── 3. 主等待事件
├── 4. SQL 统计
│   ├── SQL ordered by Elapsed Time
│   ├── SQL ordered by CPU Time
│   └── SQL ordered by Gets
├── 5. 实例统计
└── 6. 表空间 I/O
```

---

## 等待事件分析

### 等待事件概述

Oracle 性能问题归根结底是「等待」问题：

```
等待 = 资源争用

常见等待事件：
├── I/O 等待
│   ├── db file sequential read  -- 单块读（索引访问）
│   ├── db file scattered read   -- 多块读（全表扫描）
│   └── direct path read/write   -- 直接路径读写
├── 锁等待
│   ├── buffer busy waits        -- 块忙等待
│   └── enq: TX - row lock       -- 行锁等待
├── 内存等待
│   ├── buffer latch             -- 缓存闩锁
│   └── library cache lock       -- 库缓存锁
└── 网络等待
    └── SQL*Net message from client  -- 客户端等待
```

### 常见等待事件解读

| 等待事件 | 说明 | 可能原因 | 解决方案 |
|---------|------|---------|---------|
| db file sequential read | 单块读 | 索引扫描 | 检查索引是否合适 |
| db file scattered read | 多块读 | 全表扫描 | 添加索引或优化 SQL |
| direct path read | 直接读 | 并行查询 | 检查并行度设置 |
| buffer busy waits | 块忙等待 | 热块竞争 | 减少并发、表分区 |
| log file sync | 日志同步 | COMMIT 过频 | 批量提交、异步提交 |
| enq: TX - row lock | 行锁等待 | 并发更新 | 优化业务逻辑 |
| latch: library cache | 库缓存闩锁 | 大量硬解析 | 使用绑定变量 |

### 查看等待事件

```sql
-- 查看当前等待事件
SELECT event, state, seconds_in_wait, p1text, p1
FROM v$session_wait
WHERE sid = (SELECT sid FROM v$session WHERE username = USER);

-- 查看等待事件统计
SELECT event, total_waits, total_timeouts,
       average_wait, time_waited
FROM v$system_event
WHERE event IN (
    'db file sequential read',
    'db file scattered read',
    'buffer busy waits'
)
ORDER BY time_waited DESC;
```

---

## ASH 是什么？

ASH（Active Session History，活动会话历史）采样当前活动会话信息：

```
ASH 工作原理：
    ↓ 每秒采样（可配置）
活动会话信息 ────────────────────────────────────► ASH 内存缓冲区
    ↓                                              ↓
    每小时写入磁盘                                 v$active_session_history
    ↓                                              ↓
    DBA_HIST_ACTIVE_SESS_HISTORY                  采样数据
```

---

## ASH 基本操作

### 生成 ASH 报告

```sql
-- SQL*Plus 中生成 ASH 报告
-- @$ORACLE_HOME/rdbms/admin/ashrpt.sql
```

### ASH 报告内容解读

```
ASH 报告主要部分：
├── 1. 报告概要
│   ├── 分析时段
│   └── 采样数
├── 2. 顶层事件
│   └── 按等待事件分布
├── 3. 顶层 SQL
│   └── 消耗时间最多的 SQL
├── 4. 顶层会话
│   └── 最活跃的会话
├── 5. 顶层对象
│   ├── 顶层段（表、索引）
│   └── 顶层文件
└── 6. 活动会话历史详情
```

### 使用 ASH 诊断

```sql
-- 查看当前活动会话
SELECT sid, serial#, username, event, sql_id,
       ROUND(seconds_in_wait) AS wait_sec
FROM v$session
WHERE status = 'ACTIVE'
  AND username IS NOT NULL
ORDER BY seconds_in_wait DESC;

-- 查看特定 SQL 的 ASH 采样
SELECT session_id, session_serial#, 
       sample_time, event, action
FROM v$active_session_history
WHERE sql_id = '&lt;sql_id&gt;'
ORDER BY sample_time DESC
FETCH FIRST 50 ROWS ONLY;

-- 查看特定时段的 ASH
SELECT * FROM TABLE(
    DBMS_WORKLOAD_REPOSITORY.ASH_REPORT_HTML(
        l_dbid => (SELECT dbid FROM v$database),
        l_inst_num => 1,
        l_btime => SYSDATE - 1/24,  -- 1小时前
        l_etime => SYSDATE
    )
);
```

---

## AWR vs ASH

| 特性 | AWR | ASH |
|-----|-----|-----|
| 数据类型 | 聚合统计 | 采样数据 |
| 采样间隔 | 每小时（可调） | 每秒 |
| 数据保留 | 默认 8 天 | 默认 7 天 |
| 数据粒度 | 汇总数据 | 细粒度数据 |
| 用途 | 趋势分析 | 实时诊断 |

---

## 性能诊断实战

### 场景一：CPU 使用率高

```sql
-- 1. 查看 CPU 相关等待
SELECT event, time_waited, average_wait
FROM v$system_event
WHERE event LIKE '%CPU%' OR event = 'resmgr:cpu quantum'
ORDER BY time_waited DESC;

-- 2. 查看消耗 CPU 的 SQL
SELECT sql_id, executions, round(elapsed_time/1000000/executions, 2) AS avg_sec,
       round(buffer_gets/executions) AS avg_gets,
       substr(sql_text, 1, 100) AS sql_preview
FROM v$sqlarea
WHERE executions > 0
ORDER BY elapsed_time/executions DESC
FETCH FIRST 10 ROWS ONLY;

-- 3. 查看 ASH 中的 CPU 会话
SELECT session_id, session_serial#, program,
       ROUND(sample_time, 'MI') AS sample_min,
       COUNT(*) AS sample_cnt
FROM v$active_session_history
WHERE sample_time > SYSDATE - 1/24
  AND session_type = 'FOREGROUND'
GROUP BY session_id, session_serial#, program,
         ROUND(sample_time, 'MI')
ORDER BY sample_cnt DESC
FETCH FIRST 10 ROWS ONLY;
```

### 场景二：I/O 慢

```sql
-- 1. 查看 I/O 等待事件
SELECT event, total_waits, average_wait,
       ROUND(total_time_waited/1000000) AS total_sec
FROM v$system_event
WHERE event LIKE '%file read%' OR event LIKE '%file write%'
ORDER BY total_time_waited DESC;

-- 2. 查看物理读最高的 SQL
SELECT sql_id, executions,
       ROUND(buffer_gets/executions) AS avg_buffer_gets,
       ROUND(physical_reads/executions) AS avg_physical_reads,
       substr(sql_text, 1, 100) AS sql_preview
FROM v$sqlarea
WHERE executions > 0
ORDER BY physical_reads/executions DESC
FETCH FIRST 10 ROWS ONLY;

-- 3. 查看热数据文件
SELECT file#, name, phyrds, phywrts,
       ROUND(phyrtim/phyrds, 3) AS avg_read_ms,
       ROUND(phywtim/phywrts, 3) AS avg_write_ms
FROM v$filestat
ORDER BY (phyrds + phywrts) DESC
FETCH FIRST 10 ROWS ONLY;
```

### 场景三：锁等待

```sql
-- 1. 查看当前锁
SELECT l.session_id, l.locked_mode, o.object_name,
       l.lock_type, l.id1, l.id2
FROM v$locked_object l
JOIN dba_objects o ON l.object_id = o.object_id;

-- 2. 查看锁等待关系
SELECT 
    w.sid AS waiting_sid,
    s.username AS waiting_user,
    w.event AS waiting_event,
    b.sid AS blocking_sid,
    b.username AS blocking_user,
    b.event AS blocking_event
FROM v$session_wait w
JOIN v$session b ON w.blocking_session = b.sid
JOIN v$session s ON w.sid = s.sid;

-- 3. 查看 TX 锁等待（行锁）
SELECT * FROM v$lock WHERE TYPE = 'TX';
```

---

## ADDM（自动数据库诊断监控）

ADDM 是 Oracle 自动分析 AWR 数据并给出建议的工具：

```sql
-- 生成 ADDM 报告
-- @$ORACLE_HOME/rdbms/admin/addmrpt.sql

-- 查看 ADDM 建议
SELECT task_name, task_id, execution_start, 
       advisor_name, message
FROM dba_advisor_findings
WHERE task_name LIKE 'SYS_AUTO_SQL_TUNING_TASK%'
ORDER BY execution_start DESC;
```

---

## 面试高频问题

### Q1: AWR 和 ASH 的区别？

AWR 是聚合统计数据，每小时收集一次，用于趋势分析和长期诊断；ASH 是活动会话采样数据，每秒采样一次，用于实时诊断和短期分析。

### Q2: 如何使用 AWR 定位性能瓶颈？

查看 AWR 报告的等待事件部分，找出 Top 等待事件；然后查看 Top SQL，按 Elapsed Time 或 CPU Time 排序，找出问题 SQL。

### Q3: 常见等待事件有哪些？

db file sequential read（索引扫描）、db file scattered read（全表扫描）、buffer busy waits（热块竞争）、log file sync（日志同步）、enq: TX（行锁）。

---

## 总结

AWR 和 ASH 是 Oracle 性能诊断的核心工具：

| 工具 | 用途 | 使用场景 |
|-----|------|---------|
| AWR | 趋势分析、长期诊断 | 每小时负载、Top SQL |
| ASH | 实时诊断、短期分析 | 当前会话、突发问题 |
| ADDM | 自动诊断建议 | 快速定位问题 |

掌握这两个工具，你就能像 DBA 一样诊断数据库性能问题。

---

## 下一步

- [Oracle SQL 优化](/database/oracle/sql-tuning)：慢查询调优
- [Oracle RAC 高可用](/database/oracle/rac)：集群架构
