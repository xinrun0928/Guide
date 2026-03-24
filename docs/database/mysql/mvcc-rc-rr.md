# MVCC 在 RC 和 RR 下的差异

你知道吗？同一个 MVCC 机制，在 Read Committed 和 Repeatable Read 隔离级别下，表现完全不同。

很多面试者能背出「MVCC 是多版本并发控制」，但追问一句「RC 和 RR 下 MVCC 的区别是什么」，十个人里有九个答不上来。

今天，我们把这个区别彻底讲清楚。

---

## 核心区别：ReadView 生成时机

| 隔离级别 | ReadView 生成时机 | 效果 |
|----------|------------------|------|
| Read Committed | **每次 SELECT 都重新生成** | 每次读取都看到最新已提交的数据 |
| Repeatable Read | **事务开始时只生成一次** | 整个事务看到相同的数据快照 |

```
时间线：

T1: BEGIN; -- 事务 100
T2: BEGIN; -- 事务 101
T2: UPDATE users SET age = 30 WHERE id = 1; -- 事务 101 修改
T2: COMMIT;
T1: SELECT * FROM users WHERE id = 1; -- 第一次读取

Read Committed：    -- T1 读取时生成 ReadView
    T1 看到 age = 30（事务 101 已提交）

T1: SELECT * FROM users WHERE id = 1; -- 第二次读取

Read Committed：    -- T1 再次生成新的 ReadView
    T1 仍看到 age = 30（没有变化）

Repeatable Read：   -- T1 只在事务开始时生成 ReadView
    T1 仍看到 age = 25（原值，事务 101 未提交时的快照）
```

---

## Read Committed 的 MVCC 行为

### 特点

每次执行 SELECT 语句，都会生成一个新的 ReadView。

这意味着：**每次读取都看到最新已提交的数据**。

### 示例

```sql
-- 设置为 Read Committed
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- 事务 A
BEGIN;
SELECT balance FROM accounts WHERE user_id = 1;  -- 读到 10000
-- 事务 B：UPDATE accounts SET balance = 5000 ... COMMIT;
SELECT balance FROM accounts WHERE user_id = 1;  -- 读到 5000（变化了！）
COMMIT;
```

### 结果

事务 A 两次读取同一行数据，结果不同——**不可重复读**。

---

## Repeatable Read 的 MVCC 行为

### 特点

事务开始时生成一个 ReadView，整个事务期间复用这个 ReadView。

这意味着：**整个事务看到的是同一个数据快照**。

### 示例

```sql
-- 设置为 Repeatable Read（InnoDB 默认）
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;

-- 事务 A
BEGIN;
SELECT balance FROM accounts WHERE user_id = 1;  -- 读到 10000
-- 事务 B：UPDATE accounts SET balance = 5000 ... COMMIT;
SELECT balance FROM accounts WHERE user_id = 1;  -- 仍读到 10000（没变！）
COMMIT;
```

### 结果

事务 A 两次读取同一行数据，结果相同——**可重复读**。

---

## 对比图解

```
┌────────────────────────────────────────────────────────────────────┐
│                 Read Committed vs Repeatable Read                  │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  时间线：                                                          │
│  T0: accounts 表：balance = 10000                                 │
│  T1: 事务 A 开始（TRX_ID = 100）                                   │
│  T2: 事务 B 开始（TRX_ID = 101）                                   │
│  T3: 事务 B：UPDATE accounts SET balance = 5000;                  │
│  T4: 事务 B：COMMIT;                                               │
│  T5: 事务 A：SELECT balance FROM accounts;  -- 第一次读取         │
│  T6: 事务 A：SELECT balance FROM accounts;  -- 第二次读取         │
│  T7: 事务 A：COMMIT;                                               │
│                                                                    │
│  Read Committed：                                                  │
│  T5: 生成 ReadView#1，事务 101 已提交，读取 balance = 5000        │
│  T6: 生成 ReadView#2，事务 101 已提交，读取 balance = 5000        │
│  结果：两次读取都是 5000                                            │
│                                                                    │
│  Repeatable Read：                                                 │
│  T5: 生成 ReadView#1，事务 101 未提交（相对于 ReadView#1 的快照）│
│      读取 balance = 10000                                          │
│  T6: 复用 ReadView#1，仍看不到事务 101 的修改                      │
│      读取 balance = 10000                                          │
│  结果：两次读取都是 10000                                           │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## 代码层面的理解

```java
// MVCC 在不同隔离级别下的行为
public class MVCCDemo {

    // Read Committed：每次读取都生成新 ReadView
    public Object queryRC(Connection conn, String sql) {
        // 1. 每次读取都创建新的 ReadView
        ReadView readView = createNewReadView();

        // 2. 根据 ReadView 找到可见的数据版本
        return executeWithReadView(sql, readView);
    }

    // Repeatable Read：事务开始时创建 ReadView，之后复用
    public Object queryRR(Transaction tx, String sql) {
        // 1. 事务开始时创建 ReadView
        if (tx.getReadView() == null) {
            tx.setReadView(createNewReadView());
        }

        // 2. 复用事务开始时的 ReadView
        return executeWithReadView(sql, tx.getReadView());
    }
}
```

---

## 实际应用中的影响

### 场景一：统计报表

```sql
-- 生成月度报表，需要统计整个月的订单
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
BEGIN;

-- 整个报表生成期间，看到的都是月初的数据快照
SELECT COUNT(*) FROM orders WHERE created_at BETWEEN '2024-01-01' AND '2024-01-31';
SELECT SUM(amount) FROM orders WHERE created_at BETWEEN '2024-01-01' AND '2024-01-31';

COMMIT;
```

### 场景二：实时数据监控

```sql
-- 监控实时数据，需要看到最新状态
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
BEGIN;

-- 每次查询都看到最新的已提交数据
SELECT COUNT(*) FROM orders WHERE status = 'pending';
-- 等待 1 秒
SELECT COUNT(*) FROM orders WHERE status = 'pending';  -- 数据可能变化

COMMIT;
```

---

## 面试追问方向

- Read Committed 会不会产生幻读？
- 如果一个事务执行了很久（1 小时），期间其他事务不断提交新数据，Repeatable Read 下能看到吗？
- MVCC 能否完全解决并发问题？还有什么场景它处理不了？

> 提示：MVCC 只解决快照读的并发问题。对于当前读（如 `SELECT ... FOR UPDATE`），仍然需要锁机制。InnoDB 在 Repeatable Read 下使用间隙锁来解决当前读的幻读问题。
