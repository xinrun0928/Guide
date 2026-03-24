# PostgreSQL MVCC 原理：xmin、xmax、tuple 可见性判断

当你在事务 A 里查询数据时，事务 B 刚刚修改了这条数据——你看到的是旧值还是新值？

这个「谁能看到什么」的问题，是数据库并发控制的核心。

MySQL 用回滚段实现，PostgreSQL 呢？

今天，我们来深入理解 PostgreSQL 的 MVCC 机制。

## MVCC 是什么？

MVCC（Multi-Version Concurrency Control，多版本并发控制）的核心思想是：

**每个读取操作的客户端，看到的是数据库在某个「时间点」的快照，而不是正在被其他事务修改的数据。**

这带来两个好处：
1. **读不阻塞写**：读取操作不需要等待写锁
2. **写不阻塞读**：写操作不会影响读取操作

```
传统锁模型：读和写互相等待
┌─────────┐    写锁冲突    ┌─────────┐
│  事务 A  │ ←────────────→ │  事务 B  │
│  (写)    │                │  (写)    │
└─────────┘                └─────────┘
      ↑                           ↑
      │ 写锁阻塞读                  │ 写锁阻塞读
      ↓                           ↓
   ┌─────────────────────────────────┐
   │            读操作等待            │
   └─────────────────────────────────┘

MVCC：读和写互不阻塞
┌─────────┐  ┌─────────┐
│  事务 A  │  │  事务 B  │
│  (读快照) │  │  (写新版本)│
└─────────┘  └─────────┘
      ↑           ↓
      │           ↓
   ┌─────────────────────┐
   │    并行执行，互不阻塞  │
   └─────────────────────┘
```

## PostgreSQL 的 MVCC 实现

### 核心：xmin 和 xmax

PostgreSQL 的每行数据（元组）都有两个关键字段：

| 字段 | 含义 | 作用 |
|------|------|------|
| xmin | 创建此元组版本的事务 ID | 标识「谁创建了这个版本」 |
| xmax | 删除/更新此元组版本的事务 ID | 标识「谁要删除/更新这个版本」，0 表示未被删除 |

```
元组结构简化版：
┌──────────────────────────────────────┐
│ Header: xmin, xmax, t_ctid, ...     │
├──────────────────────────────────────┤
│ Data: 实际列值                       │
└──────────────────────────────────────┘
```

### 一个经典的例子

```sql
-- 创建表
CREATE TABLE accounts (
    id INT PRIMARY KEY,
    balance NUMERIC(10,2)
);

-- 初始数据
INSERT INTO accounts VALUES (1, 1000.00);

-- 现在表里有 1 个元组：
┌──────────────────────────────────────┐
│ id=1, balance=1000.00                │
│ xmin=T1, xmax=0                     │
│ (T1 是创建这个元组的事务 ID)           │
└──────────────────────────────────────┘

-- 事务 T2 修改余额
BEGIN;
UPDATE accounts SET balance = 1500.00 WHERE id = 1;
-- 此时发生了什么？
```

**UPDATE 在 PostgreSQL 内部是「删除 + 插入」的组合操作**：

```
执行 UPDATE 之前：
┌──────────────────────────────────────┐
│ id=1, balance=1000.00                │
│ xmin=T1, xmax=0  ← 可见版本          │
└──────────────────────────────────────┘

执行 UPDATE 之后：
┌──────────────────────────────────────┐
│ id=1, balance=1000.00               │
│ xmin=T1, xmax=T2  ← 被 T2 标记删除   │
│ (旧版本，不再是最新的)                 │
└──────────────────────────────────────┘
┌──────────────────────────────────────┐
│ id=1, balance=1500.00               │
│ xmin=T2, xmax=0  ← 新版本           │
│ (T2 创建的新版本)                     │
└──────────────────────────────────────┘
```

### t_ctid 指针

每个元组还有一个 `t_ctid` 字段，指向「新版本」的物理位置：

```
UPDATE 前后，t_ctid 的变化：

┌────────────────┐         ┌────────────────┐
│ id=1           │         │ id=1           │
│ balance=1000   │ ──t_ctid──→ │ balance=1500 │
│ xmin=T1        │         │ xmin=T2        │
│ xmax=T2        │         │ xmax=0         │
└────────────────┘         └────────────────┘
  (旧版本)                   (新版本)
```

## 可见性判断规则

现在的问题是：给定一个事务的快照，哪些元组版本是「可见的」？

PostgreSQL 使用以下规则判断可见性：

### 关键概念

1. **事务快照（Snapshot）**：包含当前正在运行的事务 ID 列表
2. **当前事务 ID（Current XID）**：正在执行的事务 ID
3. **xmin/xmax**：元组的创建/删除事务 ID

### 可见性算法

一个元组对当前事务可见，当且仅当：

```
可见条件 = (xmin 对应事务已提交) 
        AND (xmin != 当前事务ID 或 当前事务可见自己的修改)
        AND (xmax = 0 或 xmax 对应事务未提交 或 隔离级别不允许)
```

简化版（Read Committed 隔离级别）：

```
可见性检查：

1. 如果 xmin 事务尚未提交 → 不可见
2. 如果 xmin 事务回滚了 → 不可见
3. 如果 xmax = 0 → 可见（元组未被删除）
4. 如果 xmax 事务尚未提交 → 可见（旧版本仍可见）
5. 如果 xmax 事务已提交：
   - 如果 xmax 事务在当前事务快照之前提交 → 不可见（已被删除）
   - 如果 xmax 事务在当前事务快照之后提交 → 可见（删除未提交）
```

### 具体例子

```sql
-- 时间线
T1: BEGIN; INSERT INTO accounts VALUES (1, 1000);
T2: BEGIN; SELECT * FROM accounts;  -- T2 看到什么？
T3: BEGIN; UPDATE accounts SET balance = 1500;
T4: COMMIT;
T5: BEGIN; SELECT * FROM accounts;  -- T5 看到什么？
T6: SELECT * FROM accounts;          -- T6 看到什么？
```

**T2 的查询结果**：
- xmin=T1（已提交？在 Read Committed 下，T1 未提交）
- 结果：看不到新插入的行（因为 T1 未提交）

**T5 的查询结果**：
- xmin=T1（事务已提交）
- xmax=T3（事务已提交，且在 T5 快照之前）
- 结果：看到 balance=1500（新版本，T3 的修改）

**T6 的查询结果**：
- 当前时刻，T1 和 T3 都已提交
- 结果：看到 balance=1500

## 不同隔离级别下的可见性

PostgreSQL 支持三种用户可用的隔离级别（Read Uncommitted 实际等同于 Read Committed）：

| 隔离级别 | 可见性特点 |
|---------|-----------|
| Read Committed（默认） | 每个语句看到的是该语句开始时已提交的数据 |
| Repeatable Read | 整个事务看到的是事务开始时已提交的数据 |
| Serializable | 严格串行化，事务像串行执行一样 |

### Read Committed

```sql
-- 会话 1
BEGIN;
INSERT INTO accounts VALUES (2, 2000);
-- 不提交

-- 会话 2
BEGIN;
SELECT * FROM accounts;  -- 看不到 id=2
INSERT INTO accounts VALUES (3, 3000);
COMMIT;

-- 会话 1
COMMIT;  -- 现在 id=2 可见了
SELECT * FROM accounts;  -- 可以看到 id=2, 3
```

### Repeatable Read

```sql
-- 会话 1
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT * FROM accounts;  -- 当前看到：id=1, balance=1000

-- 会话 2（在另一个会话）
BEGIN;
UPDATE accounts SET balance = 2000 WHERE id = 1;
COMMIT;

-- 会话 1
SELECT * FROM accounts;  -- 仍然是：id=1, balance=1000（快照不变）
UPDATE accounts SET balance = 3000 WHERE id = 1;  
-- 错误！ERROR: could not serialize access
```

Repeatable Read 会在检测到序列化冲突时抛出错误，而不是产生脏读。

## PostgreSQL vs MySQL MVCC

| 维度 | PostgreSQL | MySQL InnoDB |
|------|-----------|--------------|
| 版本字段 | xmin/xmax | DB_TRX_ID/DB_ROLL_PTR |
| 旧版本存储 | 表中（死元组） | 回滚段 |
| 清理机制 | VACUUM | InnoDB 自动清理 |
| 隔离级别 | RC/RR/S | RU/RC/RR/S |
| 默认级别 | RC | RR |

**关键区别**：

```
MySQL：旧版本写入回滚段，表本身始终是最新的
PostgreSQL：旧版本保留在表中，需要 VACUUM 清理
```

## 实战：查看元组版本

```sql
-- 创建测试表
CREATE TABLE test_mvcc (
    id INT,
    value TEXT
);

-- 插入数据
INSERT INTO test_mvcc VALUES (1, 'original');

-- 在另一个会话执行 UPDATE
-- UPDATE test_mvcc SET value = 'modified' WHERE id = 1;

-- 查看元组信息（包括 xmin, xmax, xmin）
SELECT 
    id,
    value,
    xmin,
    xmax,
    ctid,
    xmin::TEXT || CASE WHEN xmax = 0 THEN ' (active)' ELSE ' (deleted)' END as status
FROM test_mvcc;

-- 查看所有版本（包括死元组）
SELECT * FROM test_mvcc;  -- 只显示可见版本

-- 使用 pgstattuple 查看表元组统计
CREATE EXTENSION pgstattuple;
SELECT * FROM pgstattuple('test_mvcc');
```

## 面试高频问题

### Q1: PostgreSQL 的 MVCC 是怎么实现的？

**考察点**：MVCC 原理

**参考答案**：
1. 每个元组有 xmin（创建事务）和 xmax（删除/更新事务）字段
2. UPDATE = DELETE + INSERT，创建新版本，标记旧版本
3. 事务开始时获取快照，根据快照判断可见性
4. 死元组通过 VACUUM 清理

### Q2: PostgreSQL 和 MySQL 的 MVCC 实现有什么区别？

**考察点**：数据库对比

**参考答案**：
- MySQL 用回滚段存储旧版本，InnoDB 表本身始终是最新的
- PostgreSQL 旧版本保留在表中，通过 xmin/xmax 标识
- PostgreSQL 需要 VACUUM 清理死元组，MySQL 由 InnoDB 自动管理
- PostgreSQL 的实现更简单，但空间管理更复杂

### Q3: 为什么 PostgreSQL 需要 VACUUM？

**考察点**：MVCC 与存储管理

**参考答案**：
- PostgreSQL 的 UPDATE 是 DELETE + INSERT，旧版本留在表中
- 这些死元组（dead tuple）占用空间
- VACUUM 清理死元组，释放空间
- 不 VACUUM 的后果：表膨胀、查询变慢、事务 ID 回卷风险

## 总结

PostgreSQL MVCC 的核心：

1. **xmin/xmax**：标识元组版本的创建者和删除者
2. **事务快照**：决定哪些事务的修改对当前事务可见
3. **可见性规则**：基于事务状态和快照判断
4. **UPDATE = DELETE + INSERT**：产生新版本，旧版本成为死元组
5. **VACUUM**：清理死元组，释放空间

理解 MVCC 是理解 PostgreSQL 并发控制和存储机制的基础。
