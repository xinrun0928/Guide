# Oracle 并行查询：多核 CPU 的性能加速器

你有没有这种数据量：

单核 CPU 跑一个查询要 10 分钟。

服务器有 32 核，只用了一核。

想让查询利用所有 CPU 核心。

并行查询，就是来解决这个问题的。

---

## 什么是并行查询？

并行查询将一个任务分解成多个子任务，由多个进程并行执行：

```
串行执行：
    任务 ───► [====进程1====] ───► 结果
                (1核)

并行执行：
    任务 ───► [拆分] ──┬──► [进程1] ──┐
                       ├──► [进程2] ──┼──► [合并] ───► 结果
                       ├──► [进程3] ──┤
                       └──► [进程4] ──┘
                    (4核同时工作)
```

---

## 并行度（DOP）

### 并行度概念

DOP（Degree of Parallelism）是并行执行时使用的进程数：

```sql
-- 默认并行度由 Oracle 自动决定
-- 基于 CPU 核心数、表大小等因素

-- 查看 CPU 核心数
SELECT value AS cpu_count FROM v$parameter WHERE name = 'cpu_count';

-- 查看并行度配置
SELECT name, value FROM v$parameter 
WHERE name LIKE '%parallel%';
```

### 并行度配置

```sql
-- 表级别设置默认并行度
ALTER TABLE orders PARALLEL 4;

-- 索引级别设置并行度
CREATE INDEX idx_emp_dept ON employees(department_id) PARALLEL 4;

-- 取消并行度（使用默认值）
ALTER TABLE orders NOPARALLEL;

-- 查看表的并行度设置
SELECT table_name, degree, instances
FROM user_tables
WHERE degree > 1;
```

---

## 并行查询的使用

### 并行 Hint

```sql
-- 指定并行度查询
SELECT /*+ PARALLEL(employees, 4) */ *
FROM employees WHERE department_id = 50;

-- 自动并行度
SELECT /*+ PARALLEL(AUTO) */ *
FROM employees e, departments d
WHERE e.department_id = d.department_id;

-- 表别名使用并行
SELECT /*+ PARALLEL(e, 4) PARALLEL(d, 4) */ *
FROM employees e
JOIN departments d ON e.department_id = d.department_id;
```

### 启用并行 DML

```sql
-- 默认 DML 不并行
-- 需要显式启用

ALTER SESSION ENABLE PARALLEL DML;

-- 并行 INSERT
INSERT /*+ APPEND PARALLEL(orders, 4) */ 
INTO orders SELECT * FROM orders_old;

-- 并行 UPDATE
UPDATE /*+ PARALLEL(employees, 4) */ 
employees SET salary = salary * 1.1;

-- 并行 DELETE
DELETE /*+ PARALLEL(employees, 4) */ 
FROM employees WHERE status = 'INACTIVE';
```

### 启用并行 DDL

```sql
-- 并行创建索引
CREATE INDEX idx_emp_name ON employees(name) PARALLEL 8;

-- 并行创建表
CREATE TABLE orders_archive PARALLEL 8 AS
SELECT * FROM orders WHERE order_date < '2024-01-01';

-- 并行重组表
ALTER TABLE orders MOVE PARALLEL 4;

-- 并行收集统计信息
BEGIN
    DBMS_STATS.GATHER_TABLE_STATS(
        USER, 'ORDERS',
        degree => 4
    );
END;
/
```

---

## 并行执行原理

### PX 协调器

```
并行查询执行流程：

1. Query Coordinator（QC）接收 SQL
         ↓
2. QC 创建并行执行计划
         ↓
3. PX Server Pool 分配多个 PX Server
         ↓
4. PX Server 执行子任务
         ↓
5. PX Server 交换数据（Data Flow Operator）
         ↓
6. PX Server 返回结果给 QC
         ↓
7. QC 合并结果返回客户端
```

### 并行连接方式

```sql
-- 查看并行执行信息
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(FORMAT => 'ALL'));

-- 执行计划中的并行信息
-- |   1| PX COORDINATOR                   |           |
-- |   2|  PX SEND QC (RANDOM)             |           |
-- |   3|   PX BLOCK ITERATOR              |           |
-- |   4|    TABLE ACCESS FULL|ORDERS      |     ...|  P->S |
-- P->S 表示并行执行
```

---

## 并行度的决定因素

### 自动 DOP

Oracle 11g+ 支持自动 DOP：

```sql
-- 启用自动 DOP
ALTER SYSTEM SET parallel_degree_policy = AUTO;

-- 查看当前 DOP 策略
SELECT value FROM v$parameter WHERE name = 'parallel_degree_policy';

-- 自动 DOP 会考虑：
-- 1. CPU 核心数
-- 2. 表大小
-- 3. 查询复杂度
-- 4. 系统负载
```

### 手动 DOP

```sql
-- 表级别强制 DOP
ALTER TABLE orders PARALLEL 8;

-- Hint 指定 DOP
SELECT /*+ PARALLEL(8) */ * FROM orders;

-- 会话级别设置
ALTER SESSION SET parallel_degree_limit = 8;
ALTER SESSION SET parallel_adaptive_multi_user = TRUE;
```

---

## 并行度限制

### 资源限制

```sql
-- 并行度总限制
ALTER SYSTEM SET parallel_degree_limit = 16;

-- 每个进程的内存限制
ALTER SYSTEM SET parallel_servers_target = 64;

-- 查看并行资源使用
SELECT name, value
FROM v$resource_limit
WHERE name LIKE '%parallel%';
```

### 并行度与性能的关系

```
性能提升曲线：
     性能
        ↑
        │      ╭───────────── 收益递减
        │     ╱
        │    ╱
        │   ╱
        │  ╱
        │ ╱
        │╱
        └───────────────────────────► 并行度
              ↑
           最佳 DOP
```

| 因素 | 影响 |
|-----|------|
| CPU 核心数 | 决定最大 DOP |
| 磁盘 I/O | 瓶颈时增加 DOP 无效 |
| 表大小 | 小表不建议并行 |
| 查询复杂度 | 复杂查询收益更大 |
| 系统负载 | 高负载时降低 DOP |

---

## 并行监控

### 查看并行执行状态

```sql
-- 查看当前并行执行
SELECT sid, serial#, qcserial#, qcinst_id,
       degree, req_degree
FROM v$px_session
ORDER BY qcinst_id, sid;

-- 查看并行进程
SELECT pname, username, sid, serial#
FROM v$process
WHERE pname LIKE 'P00%';

-- 查看并行统计
SELECT sql_id, sql_text,
       ROUND(elapsed_time/1000000, 2) AS elapsed_sec,
       ROUND((elapsed_time/1000000)/round(executions), 2) AS avg_sec,
       PX_workers, PX_server#
FROM v$sql
WHERE executions > 0
ORDER BY elapsed_time DESC
FETCH FIRST 10 ROWS ONLY;
```

### 等待事件

```sql
-- 并行相关等待事件
SELECT event, total_waits, average_wait
FROM v$system_event
WHERE event LIKE '%PX%' OR event LIKE '%parallel%'
ORDER BY total_waits DESC;
```

---

## 并行使用场景

### 场景一：大表全表扫描

```sql
-- 大表查询使用并行
SELECT /*+ PARALLEL(orders, 8) */ COUNT(*)
FROM orders WHERE order_date >= '2024-01-01';

-- 多表关联使用并行
SELECT /*+ PARALLEL(e, 4) PARALLEL(d, 4) */ *
FROM employees e
JOIN departments d ON e.department_id = d.department_id;
```

### 场景二：批量数据加载

```sql
-- 并行 INSERT
INSERT /*+ APPEND PARALLEL(orders_archive, 4) */ 
INTO orders_archive
SELECT * FROM orders WHERE order_date < '2024-01-01';

-- 并行 CREATE TABLE AS
CREATE TABLE orders_archive PARALLEL 8 AS
SELECT * FROM orders WHERE order_date < '2024-01-01';
```

### 场景三：批量统计

```sql
-- 并行收集统计信息
BEGIN
    DBMS_STATS.GATHER_SCHEMA_STATS(
        ownname => USER,
        degree => 4,
        cascade => TRUE
    );
END;
/

-- 并行重建索引
ALTER INDEX idx_emp_dept REBUILD PARALLEL 4;
```

---

## 并行注意事项

### 避免过度并行

| 场景 | 建议 DOP |
|-----|---------|
| CPU 核心数 16 | DOP 8-12 |
| 内存充足 | 可提高 DOP |
| I/O 瓶颈 | 提高 DOP 无效 |
| 小表 (< 100MB) | 不建议并行 |

### 并行的开销

```sql
-- 并行不是免费的：
-- 1. 进程创建和管理开销
-- 2. 数据重新分发开销
-- 3. 内存协调开销
-- 4. 结果合并开销

-- 小表不建议并行
SELECT * FROM small_table;  -- 几秒

SELECT /*+ PARALLEL(small_table, 4) */ * FROM small_table;  -- 可能更慢
```

---

## 面试高频问题

### Q1: 什么是并行查询？

并行查询将大任务分解为多个子任务，由多个进程并行执行，充分利用多核 CPU 提升性能。

### Q2: 如何控制并行度？

表级别设置 `ALTER TABLE ... PARALLEL N`、Hint 指定 `/*+ PARALLEL(table, N) */`、系统参数 `parallel_degree_limit`。

### Q3: 什么情况下不适合并行？

小表（数据量小）、I/O 瓶颈（磁盘能力不足）、高并发系统（资源竞争）、简单查询（并行开销大于收益）。

---

## 总结

并行查询是处理海量数据的利器：

| 场景 | 推荐使用 |
|-----|---------|
| 大表全表扫描 | 是 |
| 大表关联 | 是 |
| 批量数据加载 | 是 |
| 统计信息收集 | 是 |
| 小表查询 | 否 |
| OLTP 短查询 | 否 |

合理使用并行，可以显著提升查询性能。

---

## 下一步

- [Oracle Data Guard](/database/oracle/data-guard)：数据保护方案
- [Oracle RAC](/database/oracle/rac)：集群架构
