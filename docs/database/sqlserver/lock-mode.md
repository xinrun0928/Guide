# SQL Server 锁模式：共享锁、排他锁、更新锁、意向锁

面试官问：「什么是乐观锁和悲观锁？」

你：「乐观锁是版本号，悲观锁是 SELECT FOR UPDATE。」

面试官追问：「那 SQL Server 的锁模式有哪些？更新锁和排他锁的区别是什么？」

你：「……」

锁是 SQL Server 实现并发控制的核心机制。理解各种锁模式，你才能真正理解：为什么死锁会发生？为什么加了索引反而更容易死锁？为什么某些查询会阻塞？

---

## 锁的分类

SQL Server 的锁可以从多个维度分类：

```
┌─────────────────────────────────────────────────────────────┐
│                    锁的分类                                 │
│                                                              │
│  按粒度：                                                   │
│  ├─ 行锁（RID/KEY）                                       │
│  ├─ 页锁（PAGE）                                          │
│  ├─ 表锁（TABLE）                                         │
│  └─ 数据库锁（DATABASE）                                  │
│                                                              │
│  按模式：                                                   │
│  ├─ 共享锁（S）                                           │
│  ├─ 排他锁（X）                                           │
│  ├─ 更新锁（U）                                           │
│  ├─ 意向锁（I）                                           │
│  ├─ 架构锁（Sch）                                         │
│  └─ 大容量锁（BU）                                        │
│                                                              │
│  按兼容性：                                                 │
│  └─ S 与 X 互斥，S 与 S 兼容                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 基础锁模式

### 共享锁（Shared Lock，S）

**作用**：允许并发读取，阻止写入。

**获取时机**：`SELECT` 语句默认申请共享锁。

```sql
-- 事务 A
BEGIN TRAN
SELECT * FROM Orders WHERE order_id = 1001;  -- 申请 S 锁
-- 读取 order_id=1001 的数据
-- S 锁持有直到语句结束（默认 READ COMMITTED）
```

**兼容性**：
| 锁模式 | S | X | U |
|-------|---|---|---|
| **S** | ✓ | ✗ | 部分 |
| **X** | ✗ | ✗ | ✗ |
| **U** | ✓ | ✗ | ✗ |

### 排他锁（Exclusive Lock，X）

**作用**：完全独占，阻止其他任何锁。

**获取时机**：`INSERT`、`UPDATE`、`DELETE` 语句申请排他锁。

```sql
-- 事务 A
BEGIN TRAN
UPDATE Orders SET status = 'shipped' WHERE order_id = 1001;  -- 申请 X 锁
-- 修改数据
-- X 锁持有直到事务结束
```

**兼容性**：
- X 锁与其他任何锁都不兼容
- 只能有一个 X 锁在同一资源上

### 更新锁（Update Lock，U）

**作用**：防止死锁，用于 UPDATE 的「读取阶段」。

**为什么需要 U 锁？**

```
死锁场景（没有 U 锁）：
T1: 事务 A                          T2: 事务 B
───────────────────────────────────────────────────────────
SELECT * FROM Orders WHERE id=1    SELECT * FROM Orders WHERE id=1
→ 申请 S 锁                        → 申请 S 锁
UPDATE Orders SET status='A'       UPDATE Orders SET status='B'
→ 等待 X 锁（被 B 的 S 锁阻塞）     → 等待 X 锁（被 A 的 S 锁阻塞）
                                     ← 死锁！
```

```
有 U 锁的情况：
T1: 事务 A                          T2: 事务 B
───────────────────────────────────────────────────────────
SELECT * FROM Orders WHERE id=1    
→ 申请 U 锁（U 锁与 U 锁兼容！）
                                    SELECT * FROM Orders WHERE id=1
                                    → 申请 U 锁
                                    → 等待 A 释放 U 锁
UPDATE Orders SET status='A'
→ U 锁 → X 锁（升级）
→ X 锁 获取成功，修改数据
                                    → 获得 U 锁，继续执行
                                    → U 锁 → X 锁，修改数据
COMMIT                              COMMIT
```

**U 锁的规则**：
- U 锁与 S 锁兼容
- U 锁与 U 锁兼容
- U 锁与 X 锁不兼容
- 只有一个事务能在资源上持有 U 锁

---

## 意向锁（Intent Lock）

### 为什么需要意向锁？

意向锁是「占位标记」，表示「有人正在或将要在这下面加锁」。

```
┌─────────────────────────────────────────────────────────────┐
│ 为什么需要意向锁？                                           │
│                                                              │
│ 场景：表有 100 万行，事务 A 要锁一行                         │
│                                                              │
│ 没有意向锁：                                                 │
│ 检查表是否被锁 → 遍历 100 万行 → 找到锁 → 太慢！           │
│                                                              │
│ 有意向锁：                                                   │
│ 检查表是否有 IX 锁 → 发现有 → 继续检查                       │
│ → 直接知道「表下有行被锁」，无需遍历                          │
└─────────────────────────────────────────────────────────────┘
```

### 意向锁类型

| 锁模式 | 符号 | 说明 |
|-------|------|------|
| **意向共享锁** | IS | 有人将在下面获取 S 锁 |
| **意向排他锁** | IX | 有人将在下面获取 X 锁 |
| **意向更新锁** | IU | 有人将在下面获取 U 锁（内部使用） |
| **共享意向排他锁** | SIX | 表有 S 锁，下面有 X 锁（内部使用） |

### 意向锁兼容性

| 锁模式 | IS | IX | S | X |
|-------|----|----|---|---|
| **IS** | ✓ | ✓ | ✓ | ✗ |
| **IX** | ✓ | ✓ | ✗ | ✗ |
| **S** | ✓ | ✗ | ✓ | ✗ |
| **X** | ✗ | ✗ | ✗ | ✗ |

---

## 锁的粒度

### 行锁 vs 页锁 vs 表锁

```
┌─────────────────────────────────────────────────────────────┐
│                    锁粒度层级                               │
│                                                              │
│              ┌─────────────────┐                           │
│              │      表锁        │                           │
│              │   TABLE lock    │                           │
│              └────────┬────────┘                           │
│                       │                                     │
│        ┌──────────────┼──────────────┐                    │
│        │              │              │                     │
│   ┌────┴────┐   ┌────┴────┐   ┌────┴────┐              │
│   │   页锁   │   │   页锁   │   │   页锁   │              │
│   │PAGE lock│   │PAGE lock│   │PAGE lock│              │
│   └────┬────┘   └────┬────┘   └────┬────┘              │
│        │              │              │                     │
│   ┌────┴────┐   ┌────┴────┐   ┌────┴────┐              │
│   │   行锁   │   │   行锁   │   │   行锁   │              │
│   │KEY lock │   │KEY lock │   │KEY lock │              │
│   └─────────┘   └─────────┘   └─────────┘              │
│                                                              │
│ 锁层级：高等级锁持有后，低等级锁会在路径上自动加意向锁       │
└─────────────────────────────────────────────────────────────┘
```

### 锁升级（Lock Escalation）

**定义**：当行锁/页锁数量过多时，SQL Server 自动将锁升级为表锁。

**触发条件**（SQL Server 2014+）：
- 单个语句获取超过 5000 个锁
- 锁占用的内存超过 40% 的锁管理器内存

```sql
-- 查看锁升级设置
SELECT 
    name,
    lock_escalation,
    lock_escalation_desc
FROM sys.tables
WHERE name = 'Orders';

-- 修改锁升级策略
ALTER TABLE Orders SET (LOCK_ESCALATION = AUTO);
-- AUTO：只在堆表上自动升级到表锁，聚集表升级到分区锁
-- TABLE：总是升级到表锁
-- DISABLE：禁用锁升级（可能导致锁内存压力）

-- 监控锁升级
SELECT * FROM sys.dm_db_index_operational_stats(NULL, NULL, NULL, NULL)
WHERE lock_escalation_count > 0;
```

---

## 锁的持续时间

### READ COMMITTED（默认）

共享锁在语句结束后立即释放。

```sql
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

BEGIN TRAN
SELECT * FROM Orders WHERE customer_id = 1001;  -- S 锁
-- S 锁在这里释放
SELECT * FROM Orders WHERE customer_id = 1002;  -- 申请新的 S 锁
COMMIT;
```

### REPEATABLE READ

共享锁持有到事务结束。

```sql
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;

BEGIN TRAN
SELECT * FROM Orders WHERE customer_id = 1001;  -- S 锁
-- S 锁在这里不释放！
SELECT * FROM Orders WHERE customer_id = 1002;
COMMIT;  -- S 锁在这里释放
```

### SERIALIZABLE

获取范围锁，持有到事务结束。

```sql
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

BEGIN TRAN
SELECT * FROM Orders WHERE customer_id BETWEEN 1000 AND 2000;
-- 申请 Range 锁，锁定整个范围
-- 其他事务不能插入/修改 customer_id 1000-2000 的订单
COMMIT;
```

---

## 锁的监控

### 查看当前锁

```sql
-- 查看当前数据库的锁
SELECT 
    request_session_id AS spid,
    DB_NAME(resource_database_id) AS database_name,
    resource_type AS resource_type,
    resource_description AS resource,
    CASE resource_type
        WHEN 'RID' THEN 'Row ID'
        WHEN 'KEY' THEN 'Row Key'
        WHEN 'PAGE' THEN 'Page'
        WHEN 'TABLE' THEN 'Table'
        WHEN 'DATABASE' THEN 'Database'
        ELSE resource_type
    END AS resource_desc,
    request_mode AS lock_mode,
    request_status AS lock_status,
    CASE request_status
        WHEN 'GRANT' THEN '已获取'
        WHEN 'WAIT' THEN '等待中'
        WHEN 'CONVERT' THEN '转换中'
    END AS status_desc
FROM sys.dm_tran_locks
WHERE resource_database_id = DB_ID()
ORDER BY request_session_id, resource_type DESC;
```

### 查看阻塞信息

```sql
-- 查看阻塞链
SELECT 
    blocked.session_id AS blocked_spid,
    blocked.status AS blocked_status,
    blocked.login_name AS blocked_login,
    blocked_txt.text AS blocked_sql,
    blocker.session_id AS blocker_spid,
    blocker.status AS blocker_status,
    blocker.login_name AS blocker_login,
    blocker_txt.text AS blocker_sql,
    blocked.wait_time AS wait_ms,
    blocked.wait_type AS wait_type
FROM sys.dm_exec_requests blocked
CROSS APPLY sys.dm_exec_sql_text(blocked.sql_handle) blocked_txt
JOIN sys.dm_exec_requests blocker 
    ON blocked.blocking_session_id = blocker.session_id
CROSS APPLY sys.dm_exec_sql_text(blocker.sql_handle) blocker_txt;
```

### 查看锁等待类型

```sql
-- 查看所有等待类型
SELECT 
    wait_type,
    waiting_tasks_count,
    wait_time_ms,
    max_wait_time_ms,
    signal_wait_time_ms
FROM sys.dm_os_wait_stats
WHERE wait_type LIKE 'LCK%'
ORDER BY wait_time_ms DESC;
```

---

## 锁与索引的关系

### 索引如何影响锁

**聚集索引**：锁定位到键值（KEY 锁）

**堆表 + 非聚集索引**：锁定位到 RID（行标识符）

```
聚集表：
UPDATE Orders SET status = 'shipped' WHERE order_id = 1001
→ KEY 锁在 order_id=1001（聚集索引键）

堆表 + 非聚集索引：
UPDATE Orders SET status = 'shipped' WHERE customer_id = 1001
→ 如果有 customer_id 索引：KEY 锁在 customer_id=1001 + RID 锁在数据行
→ 如果没有索引：PAGE 或 TABLE 锁（锁粒度更大！）
```

**结论**：合适的索引可以减少锁粒度，提高并发性。

---

## 常见问题

### 问题 1：锁升级导致阻塞

```sql
-- 场景：批量更新大表
UPDATE Orders SET status = 'archived' WHERE order_date < '2023-01-01';
-- 可能锁升级为表锁，阻塞所有读取

-- 优化：分批更新
DECLARE @batch INT = 1000;
DECLARE @rows INT;

WHILE 1 = 1
BEGIN
    UPDATE TOP (@batch) Orders 
    SET status = 'archived' 
    WHERE order_date < '2023-01-01' AND status <> 'archived';
    
    SET @rows = @@ROWCOUNT;
    IF @rows < @batch BREAK;
    
    CHECKPOINT;  -- 释放锁，减少锁升级风险
END
```

### 问题 2：长时间读取阻塞写入

```sql
-- 场景：报表查询（REPEATABLE READ）阻塞订单更新

-- 优化 1：使用 NOLOCK（不推荐，可能脏读）
SELECT * FROM Orders WITH (NOLOCK);

-- 优化 2：使用 RCSI（推荐）
ALTER DATABASE MyDB SET READ_COMMITTED_SNAPSHOT ON;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- 优化 3：使用 SNAPSHOT 隔离级别
SET TRANSACTION ISOLATION LEVEL SNAPSHOT;
```

---

## 面试追问方向

- 共享锁、排他锁、更新锁的区别是什么？各自的兼容性如何？
- 为什么要用更新锁？它如何防止死锁？
- 意向锁的作用是什么？有哪些类型？
- 什么是锁升级？什么时候会发生？
- 锁粒度如何选择？行锁 vs 表锁的权衡？
- 如何监控和诊断锁问题？

---

## 下一步

理解了锁模式，我们来看 [SQL Server 死锁产生条件与排查优化](/database/sqlserver/deadlock)，学习如何避免和处理死锁。
