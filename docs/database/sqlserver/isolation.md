# SQL Server 隔离级别：脏读、不可重复读、幻读、快照隔离

并发事务听起来是个高级话题，但你的系统每天都在面对它。

用户 A 在查看订单，用户 B 在修改订单，用户 C 在取消订单——三个操作同时发生，系统该怎么处理？

隔离级别，就是数据库给这道并发难题提供的「难度选项」。选择越高的隔离级别，数据越安全，但性能越低；选择越低的隔离级别，性能越高，但可能出现各种「诡异」的问题。

理解隔离级别，你才能在「正确性」和「性能」之间做出明智的取舍。

---

## 并发问题的类型

在讨论隔离级别之前，先来看看并发事务会导致哪些「诡异」问题。

### 脏读（Dirty Read）

**定义**：读取了其他事务未提交的数据。

```
时间线：
T1: 事务 A                          T2: 事务 B
───────────────────────────────────────────────────────────
BEGIN TRAN                           BEGIN TRAN
UPDATE Orders SET status='cancelled' 
WHERE order_id=1001  ──────────────→ 读取 order_id=1001
                                      读到 status='cancelled' ← 脏读！
                                      （但 A 还没提交）
                                     ROLLBACK               ← A 回滚了！
                                     
结果：事务 B 读到了「从未存在」的数据
```

### 不可重复读（Non-Repeatable Read）

**定义**：同一事务中，两次读取同一行数据，结果不同（因为其他事务修改并提交了）。

```
时间线：
T1: 事务 A                          T2: 事务 B
───────────────────────────────────────────────────────────
BEGIN TRAN                           BEGIN TRAN
SELECT * FROM Orders 
WHERE order_id=1001
  → status='pending'                 UPDATE Orders SET status='shipped'
                                     WHERE order_id=1001
                                     COMMIT
SELECT * FROM Orders 
WHERE order_id=1001
  → status='shipped'  ← 不一样了！   （已提交）
```

### 幻读（Phantom Read）

**定义**：同一事务中，两次执行相同的查询，第二次返回了「不存在」的行（因为其他事务插入了新行并提交）。

```
时间线：
T1: 事务 A                          T2: 事务 B
───────────────────────────────────────────────────────────
BEGIN TRAN                           BEGIN TRAN
SELECT COUNT(*) FROM Orders 
WHERE customer_id=1001
  → 5 条记录
                                     INSERT INTO Orders ... (customer_id=1001)
                                     COMMIT
SELECT COUNT(*) FROM Orders 
WHERE customer_id=1001
  → 6 条记录  ← 多了一条「幻影」！
```

### 丢失更新（Lost Update）

**定义**：两个事务同时读取和修改同一行，后面的修改覆盖了前面的修改。

```
时间线：
T1: 事务 A                          T2: 事务 B
───────────────────────────────────────────────────────────
BEGIN TRAN                           BEGIN TRAN
SELECT stock FROM Products           SELECT stock FROM Products
WHERE product_id=100                  WHERE product_id=100
→ stock=10                           → stock=10
                                     stock=stock-5 → UPDATE stock=5
                                     COMMIT
stock=stock-3 → UPDATE stock=7       （计算基于旧值）
COMMIT                               
                                     
结果：stock=7，但应该是 10-5-3=2
```

---

## SQL Server 的隔离级别

SQL Server 提供了 5 个隔离级别：

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 实现方式 |
|---------|------|-----------|------|---------|
| **READ UNCOMMITTED** | ✗ | ✗ | ✗ | 无锁 |
| **READ COMMITTED**（默认） | ✓ | ✗ | ✗ | 锁 |
| **READ COMMITTED SNAPSHOT** | ✓ | ✗ | ✗ | 行版本 |
| **REPEATABLE READ** | ✓ | ✓ | ✗ | 锁 |
| **SERIALIZABLE** | ✓ | ✓ | ✓ | 锁 |

### 1. READ UNCOMMITTED

最低的隔离级别，**允许脏读**。

```sql
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

SELECT * FROM Orders WHERE customer_id = 1001;
-- 可以读取其他未提交事务修改的数据
```

**实现原理**：不申请任何锁，直接读取数据页。

**适用场景**：
- 不关心数据一致性的报表查询
- 大数据量聚合查询
- 可以接受「大概正确」的数据分析

### 2. READ COMMITTED（默认）

**防止脏读**，但可能出现不可重复读和幻读。

```sql
-- 默认行为
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- 读取时申请共享锁，读取后立即释放
SELECT * FROM Orders WHERE order_id = 1001;
-- 如果这行正被其他事务修改，会等待锁释放
```

**问题**：同一事务中，两次读取同一行可能得到不同结果。

### 3. READ COMMITTED SNAPSHOT ISOLATION (RCSI)

**防止脏读**，但可能出现不可重复读和幻读。

**与 READ COMMITTED 的区别**：使用**行版本**而非锁来保证一致性。

```sql
-- 启用 RCSI
ALTER DATABASE MyDB SET READ_COMMITTED_SNAPSHOT ON;
```

**工作原理**：
1. 读取数据时，如果数据被其他事务锁定，读取**行版本**（修改前的快照）
2. 无需等待锁，提高并发性

```
时间线（RCSI）：
T1: 事务 A                          T2: 事务 B
───────────────────────────────────────────────────────────
BEGIN TRAN                           BEGIN TRAN
SELECT * FROM Orders 
WHERE order_id=1001                  UPDATE Orders SET status='shipped'
→ status='pending'                   WHERE order_id=1001
  （读取时的行版本）
                                     事务 B 已提交
SELECT * FROM Orders 
WHERE order_id=1001                  
→ status='pending'  ← 仍然是 pending
  （重新读取另一个行版本）
```

**适用场景**：
- 需要高并发但又不想脏读的场景
- 读写冲突较多的 OLTP 系统

### 4. REPEATABLE READ

**防止脏读和不可重复读**，但可能出现幻读。

```sql
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;

BEGIN TRAN
SELECT * FROM Orders WHERE customer_id = 1001;
-- 申请共享锁，直到事务结束才释放
-- 其他事务不能修改这些行
COMMIT;  -- 锁才释放
```

**锁的范围**：
- 读取的行：共享锁（S 锁）持有到事务结束
- 不会幻读？实际上：RR 只能防止已读取行的修改，不能防止新行插入

### 5. SERIALIZABLE

最高的隔离级别，**防止脏读、不可重复读和幻读**。

```sql
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

BEGIN TRAN
SELECT * FROM Orders WHERE customer_id = 1001;
-- 申请范围锁，锁定整个查询范围
-- 其他事务不能插入、修改、删除 customer_id=1001 的订单
COMMIT;
```

**实现方式**：
- 对查询范围加锁（Range Lock）
- 可能导致严重的锁争用和死锁

---

## 快照隔离（Snapshot Isolation）

### 与 RCSI 的区别

| 特性 | RCSI | 快照隔离 |
|-----|------|---------|
| **隔离点** | 每条语句 | 整个事务 |
| **版本读取** | 语句级别 | 事务级别 |
| **事务开始版本** | 语句开始时 | 事务开始时 |
| **事务一致性** | 语句级一致 | 事务级一致 |

### SNAPSHOT 隔离级别

```sql
-- 启用快照隔离
ALTER DATABASE MyDB SET ALLOW_SNAPSHOT_ISOLATION ON;

SET TRANSACTION ISOLATION LEVEL SNAPSHOT;

BEGIN TRAN
SELECT * FROM Orders WHERE customer_id = 1001;
-- 读取事务开始时的行版本
-- 即使其他事务插入/修改，只要本事务不结束，看到的数据不变
COMMIT;
```

### 快照隔离的更新冲突

**重要**：快照隔离可能出现**更新冲突**（与 RCSI 的关键区别）。

```sql
-- 事务 A                          -- 事务 B
BEGIN TRAN                          BEGIN TRAN
SELECT stock FROM Products          SELECT stock FROM Products
WHERE product_id=100                WHERE product_id=100
→ stock=10                         → stock=10
                                    stock=stock-5 
                                    UPDATE Products SET stock=7
                                    WHERE product_id=100
                                    COMMIT  ✓
stock=stock-3 
UPDATE Products SET stock=7         ← 冲突！版本已被 B 修改
WHERE product_id=100
COMMIT  ✗ 错误！
```

**原因**：A 读取的版本在 B 修改后过时，A 基于旧值计算并更新时，发现数据已被别人修改。

**错误信息**：`Msg 3960: Snapshot isolation transaction aborted due to update conflict`

---

## 设置隔离级别

### 会话级别设置

```sql
-- 当前会话设置
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- 查看当前会话隔离级别
DBCC USEROPTIONS;
-- isolation level                      read committed
```

### 事务级别设置

```sql
BEGIN TRANSACTION;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

SELECT * FROM Orders WHERE customer_id = 1001;

COMMIT;  -- 隔离级别在事务结束时自动恢复为默认级别
```

### 提示（Hint）

```sql
-- 在查询中使用提示指定隔离级别
SELECT * FROM Orders WITH (NOLOCK)
WHERE customer_id = 1001;
-- 等价于 READ UNCOMMITTED

SELECT * FROM Orders WITH (UPDLOCK, HOLDLOCK)
WHERE customer_id = 1001;
-- 等价于 REPEATABLE READ（更细粒度控制）
```

### 常用锁提示

| 提示 | 说明 |
|-----|------|
| **NOLOCK** | READ UNCOMMITTED，可能脏读 |
| **HOLDLOCK** | 持有锁直到事务结束（SERIALIZABLE） |
| **UPDLOCK** | 读取时申请更新锁而非共享锁 |
| **ROWLOCK** | 使用行锁而非页锁或表锁 |
| **XLOCK** | 排他锁 |

---

## 选择合适的隔离级别

### 选择决策树

```
需要防止脏读吗？
│
├── 是 → READ COMMITTED 是否足够？
│   │
│   ├── 写入冲突多 → 考虑 RCSI 或 SNAPSHOT
│   │
│   └── 写入冲突少 → READ COMMITTED
│
└── 否 → READ UNCOMMITTED
    │
    └── 可以接受脏读，用于分析查询
```

### 各场景推荐

| 场景 | 推荐隔离级别 | 原因 |
|------|-------------|------|
| **金融交易** | SERIALIZABLE 或 SNAPSHOT | 绝对不能出错 |
| **订单处理** | READ COMMITTED 或 RCSI | 平衡并发与一致性 |
| **后台统计** | READ UNCOMMITTED | 可以脏读，追求性能 |
| **报表生成** | RCSI | 一致性好，并发高 |

### RCSI vs SNAPSHOT

| 特性 | RCSI | SNAPSHOT |
|-----|------|---------|
| **语句一致性** | ✓ | ✓ |
| **事务一致性** | ✗ | ✓ |
| **更新冲突检测** | ✗ | ✓ |
| **适合 OLTP** | ✓ | ✓ |
| **适合报表** | ✓ | ✓ |
| **TempDB 开销** | 低 | 中 |

---

## 监控隔离级别相关问题

```sql
-- 查看当前会话的锁
SELECT 
    request_session_id AS spid,
    resource_type,
    resource_description,
    request_mode AS mode,
    request_status AS status
FROM sys.dm_tran_locks
WHERE resource_database_id = DB_ID();

-- 查看阻塞信息
SELECT 
    blocked.session_id AS blocked_spid,
    blocker.session_id AS blocker_spid,
    blocked_txt.text AS blocked_sql,
    blocker_txt.text AS blocker_sql
FROM sys.dm_exec_requests blocked
CROSS APPLY sys.dm_exec_sql_text(blocked.sql_handle) blocked_txt
JOIN sys.dm_exec_requests blocker ON blocked.blocking_session_id = blocker.session_id
CROSS APPLY sys.dm_exec_sql_text(blocker.sql_handle) blocker_txt;

-- 查看版本存储
SELECT 
    DB_NAME(database_id) AS database_name,
    file_id,
    total_page_count,
    available_pages_count,
    version_store_reserved_page_count
FROM sys.dm_db_file_space_usage;
```

---

## 面试追问方向

- 脏读、不可重复读、幻读分别是什么？能举例说明吗？
- READ COMMITTED 和 READ COMMITTED SNAPSHOT 的区别是什么？
- RCSI 和 SNAPSHOT 隔离级别的区别是什么？
- 什么是更新冲突？哪个隔离级别会检测更新冲突？
- 什么情况下需要使用 SERIALIZABLE？
- 快照隔离对 TempDB 有什么影响？

---

## 下一步

理解了隔离级别，我们来看 [SQL Server 锁模式：共享锁、排他锁、更新锁、意向锁](/database/sqlserver/lock-mode)，深入理解锁的实现机制。
