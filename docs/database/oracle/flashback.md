# Oracle Flashback：回到过去的时光机

你有没有遇到过这种情况：

误删了数据，想恢复却发现没有备份。

用户反馈数据被改错了，但你不知道改了什么。

想撤销一个小时的误操作，但回滚段早就被覆盖了。

Oracle 的 Flashback 技术，就是来解决这些问题的。

今天，认识 Oracle 的「时光机」。

---

## Flashback 是什么？

Flashback 是 Oracle 提供的一系列数据恢复技术，让你能够：

1. **查询过去的数据**：查看历史某个时间点的数据
2. **恢复误删的表**：恢复被 DROP 的表
3. **撤销误操作**：回滚不需要提交
4. **查看数据变化**：追踪数据变更历史

```
现在 ◄─────────── Flashback ───────────► 过去
        │                              │
        │   Flashback Query            │
        │   Flashback Table            │
        │   Flashback Drop             │
        │   Flashback Transaction      │
```

---

## Flashback Query（闪回查询）

### 查看历史数据

```sql
-- 查看过去某个时间点的数据
SELECT * FROM employees AS OF TIMESTAMP 
    TO_TIMESTAMP('2024-01-15 10:00:00', 'YYYY-MM-DD HH24:MI:SS')
WHERE employee_id = 100;

-- 查看 5 分钟前的数据
SELECT * FROM employees AS OF TIMESTAMP 
    SYSDATE - INTERVAL '5' MINUTE
WHERE employee_id = 100;

-- 查看 1 天前的数据
SELECT * FROM employees AS OF TIMESTAMP 
    SYSDATE - 1
WHERE employee_id = 100;
```

### 使用 SCN 查询

```sql
-- 获取过去的 SCN
SELECT TIMESTAMP_TO_SCN(
    TO_TIMESTAMP('2024-01-15 10:00:00', 'YYYY-MM-DD HH24:MI:SS')
) AS scn FROM dual;

-- 根据 SCN 查询
SELECT * FROM employees AS OF SCN 12345678 WHERE employee_id = 100;
```

### Flashback Query 的用途

```sql
-- 场景一：恢复误更新的数据
-- 发现 1 小时前数据被错误更新
SELECT * FROM employees AS OF TIMESTAMP SYSDATE - INTERVAL '1' HOUR
MINUS
SELECT * FROM employees;

-- 场景二：恢复误删除的行
SELECT * FROM employees AS OF TIMESTAMP SYSDATE - INTERVAL '10' MINUTE
WHERE employee_id NOT IN (
    SELECT employee_id FROM employees
);

-- 场景三：查看数据在某个时间段的变化
SELECT versions_startscn, versions_endscn, 
       versions_starttime, versions_endtime,
       employee_id, salary
FROM employees
VERSIONS BETWEEN TIMESTAMP 
    SYSDATE - INTERVAL '2' HOUR AND SYSDATE
WHERE employee_id = 100;
```

---

## Flashback Table（闪回表）

### 闪回表到过去某个时间点

```sql
-- 闪回表需要启用行移动
ALTER TABLE employees ENABLE ROW MOVEMENT;

-- 闪回到指定时间
FLASHBACK TABLE employees TO TIMESTAMP 
    TO_TIMESTAMP('2024-01-15 10:00:00', 'YYYY-MM-DD HH24:MI:SS');

-- 闪回到 SCN
FLASHBACK TABLE employees TO SCN 12345678;

-- 闪回到 10 分钟前
FLASHBACK TABLE employees TO TIMESTAMP SYSDATE - INTERVAL '10' MINUTE;
```

### 闪回表示例

```sql
-- 场景：用户误更新了员工工资
-- 查看修改前
SELECT employee_id, name, salary FROM employees
WHERE department_id = 50;

SELECT employee_id, name, salary FROM employees AS OF TIMESTAMP 
    SYSDATE - INTERVAL '30' MINUTE
WHERE department_id = 50;

-- 闪回整张表
FLASHBACK TABLE employees TO TIMESTAMP SYSDATE - INTERVAL '30' MINUTE;

-- 验证恢复
SELECT employee_id, name, salary FROM employees
WHERE department_id = 50;
```

### 闪回表的限制

```sql
-- 不能闪回的情况：
-- 1. 表结构被修改（DROP COLUMN、ALTER COLUMN）
-- 2. 表被 TRUNCATE
-- 3. UNDO 信息已被覆盖
-- 4. 表移动到其他表空间后

-- 检查闪回是否可行
SELECT SCN_TO_TIMESTAMP((
    SELECT MAX(ORA_ROWSCN) FROM employees
)) FROM dual;
```

---

## Flashback Drop（闪回删除）

### 恢复被删除的表

```sql
-- 删除表
DROP TABLE employees;

-- 查看回收站
SELECT object_name, original_name, droptime, type
FROM user_recyclebin
WHERE original_name = 'EMPLOYEES';

-- 恢复表
FLASHBACK TABLE employees TO BEFORE DROP;

-- 或者恢复到新名称
FLASHBACK TABLE "BIN$xxx" TO BEFORE DROP RENAME TO employees_new;
```

### 回收站管理

```sql
-- 清空回收站
PURGE RECYCLEBIN;

-- 清空特定表
PURGE TABLE employees;

-- 清空整个表空间
PURGE dba_recYCLEBIN;

-- 查看回收站大小
SELECT SUM(bytes)/1024/1024 AS size_mb
FROM dba_segments
WHERE segment_name IN (
    SELECT object_name FROM user_recyclebin
);
```

### 回收站工作原理

```
DROP TABLE employees;
    ↓
employees 表被重命名为 BIN$xxx
    ↓
表移动到回收站（数据保留）
    ↓
PURGE TABLE employees; 或 UNDO 空间不足时自动清理
    ↓
数据真正被删除
```

### 禁用回收站

```sql
-- 会话级别禁用
ALTER SESSION SET recyclebin = OFF;

-- 系统级别禁用
ALTER SYSTEM SET recyclebin = OFF SCOPE = SPFILE;
-- 需要重启数据库
```

---

## Flashback Version Query（闪出版本查询）

### 查看行的历史版本

```sql
-- 查看某行在时间范围内的所有版本
SELECT 
    employee_id,
    salary,
    versions_startscn,
    versions_endscn,
    versions_starttime,
    versions_endtime,
    versions_operation
FROM employees
VERSIONS BETWEEN TIMESTAMP 
    SYSDATE - INTERVAL '1' HOUR AND SYSDATE
WHERE employee_id = 100;
```

### 版本查询结果解读

| 列 | 说明 |
|---|------|
| VERSIONS_STARTSCN | 版本开始的 SCN |
| VERSIONS_ENDSCN | 版本结束的 SCN（NULL 表示当前） |
| VERSIONS_STARTTIME | 版本开始时间 |
| VERSIONS_ENDTIME | 版本结束时间 |
| VERSIONS_OPERATION | 操作类型（I/U/D） |
| VERSIONS_XID | 事务 ID |

### 实用示例

```sql
-- 查看某行是谁改的、什么时候改的
SELECT 
    versions_starttime,
    versions_operation,
    salary,
    DBMS_ROWID.ROWID_OBJECT(rowid) AS obj_id
FROM employees
VERSIONS BETWEEN TIMESTAMP 
    SYSDATE - INTERVAL '7' DAY AND SYSDATE
WHERE employee_id = 100;

-- 查看某段时间内所有被修改的行
SELECT DISTINCT employee_id, versions_operation
FROM employees
VERSIONS BETWEEN TIMESTAMP 
    SYSDATE - INTERVAL '1' DAY AND SYSDATE
WHERE versions_operation IS NOT NULL;
```

---

## Flashback Transaction Query（闪回事务查询）

### 查看事务的详细信息

```sql
-- 查看事务包含的操作
SELECT 
    xid,
    commit_timestamp,
    operation,
    undo_sql,
    table_name,
    table_owner
FROM flashback_transaction_report
WHERE xid = '0A00123456789012';

-- 查看某个时间范围内的事务
SELECT 
    start_timestamp,
    commit_timestamp,
    xid,
    operation,
    table_name
FROM flashback_transaction_report
WHERE start_timestamp >= SYSDATE - 1
ORDER BY commit_timestamp DESC;
```

### 生成 UNDO SQL

```sql
-- 闪回事务查询可以生成逆向 SQL
SELECT 
    operation,
    undo_sql
FROM flashback_transaction_report
WHERE table_name = 'EMPLOYEES'
  AND commit_timestamp >= SYSDATE - INTERVAL '1' HOUR;
```

---

## Flashback Data Archive（闪回数据归档）

### 创建闪回数据归档

```sql
-- 创建闪回归档表空间
CREATE TABLESPACE fda_tbs 
DATAFILE '/u01/oradata/orcl/fda_tbs.dbf' 
SIZE 1G;

-- 创建闪回数据归档
CREATE FLASHBACK ARCHIVE DEFAULT fda_archive
TABLESPACE fda_tbs
RETENTION 1 YEAR;  -- 保留 1 年

-- 为表启用闪回归档
ALTER TABLE employees FLASHBACK ARCHIVE fda_archive;

-- 查看启用了归档的表
SELECT table_name, flashback_archive_name
FROM user_flashback_archive_tables;
```

### 使用闪回归档

```sql
-- 闪回归档支持更长时间的查询
SELECT * FROM employees AS OF TIMESTAMP 
    SYSDATE - INTERVAL '30' DAY;  -- 可以查询 30 天前的数据

-- 查看表的历史（即使 UNDO 已过期）
SELECT * FROM employees AS OF TIMESTAMP 
    SYSDATE - INTERVAL '6' MONTH;  -- 半年内的数据
```

### 归档管理

```sql
-- 修改归档保留时间
ALTER FLASHBACK ARCHIVE fda_archive
MODIFY RETENTION 2 YEAR;

-- 清除归档中的数据
ALTER FLASHBACK ARCHIVE fda_archive
PURGE BEFORE TIMESTAMP SYSDATE - INTERVAL '3' MONTH;

-- 删除归档
DROP FLASHBACK ARCHIVE fda_archive;
```

---

## 配置与限制

### 启用 Flashback 的前提

```sql
-- 1. 数据库必须是归档模式
ARCHIVE LOG LIST;

-- 2. 配置 UNDO 表空间
SHOW PARAMETER UNDO;

-- 3. 设置 UNDO 保留时间
ALTER TABLESPACE undotbs1 RETENTION GUARANTEE;

-- 4. 设置闪回恢复区
ALTER SYSTEM SET DB_RECOVERY_FILE_DEST_SIZE = 10G;
ALTER SYSTEM SET DB_RECOVERY_FILE_DEST = '/u01/fra';
```

### 查看 Flashback 配置

```sql
-- 查看数据库是否支持闪回
SELECT flashback_on FROM v$database;

-- 查看 UNDO 保留时间
SHOW PARAMETER UNDO_RETENTION;

-- 查看闪回恢复区使用情况
SELECT 
    reclaimable,
    occupied_total,
    oldest_flashback_time
FROM v$flash_recovery_area_usage;
```

---

## 面试高频问题

### Q1: Flashback Query 和 Flashback Table 的区别？

Flashback Query 只是查询过去的数据，不修改任何内容；Flashback Table 将表恢复到过去某个时间点，数据会被修改。

### Q2: 闪回查询能查到多久之前的数据？

取决于 UNDO 表空间大小和 UNDO_RETENTION 参数设置。默认情况下，一般能查到几分钟到几小时前的数据。使用 Flashback Data Archive 可以保留更长时间（如几年）。

### Q3: DROP TABLE 后还能恢复吗？

可以，只要回收站中的数据未被 PURGE。可以使用 `FLASHBACK TABLE ... TO BEFORE DROP` 恢复。如果回收站被清空或 UNDO 空间不足，则无法恢复。

### Q4: 闪回表需要什么条件？

需要表启用了 ROW MOVEMENT（`ALTER TABLE ... ENABLE ROW MOVEMENT`），并且 UNDO 信息还存在。

---

## 总结

| Flashback 技术 | 用途 | 时间范围 |
|--------------|------|---------|
| Flashback Query | 查询历史数据 | UNDO 决定 |
| Flashback Table | 恢复表到过去 | UNDO 决定 |
| Flashback Drop | 恢复被删除的表 | 回收站决定 |
| Flashback Version Query | 查看行版本历史 | UNDO 决定 |
| Flashback Data Archive | 长期历史查询 | 用户定义 |

Flashback 技术让「后悔药」成为可能，但也要注意定期备份。

---

## 下一步

- [Oracle 乐观锁与悲观锁](/database/oracle/optimistic-pessimistic)：锁策略选择
- [Oracle 事务机制](/database/oracle/transaction)：ACID 特性
