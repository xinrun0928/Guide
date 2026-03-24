# 隔离级别：MySQL 的四层防护罩

为什么需要隔离级别？

因为性能和安全性是一对矛盾体。

隔离级别越高，数据越安全，但并发性能越差；隔离级别越低，性能越好，但可能出现各种并发问题。

MySQL 提供了 4 种隔离级别，让你在性能和安全性之间找到平衡。

---

## 四种隔离级别

### Read Uncommitted（读未提交）

**规则**：可以读取其他事务未提交的数据。

这是最低的隔离级别，基本没有并发保护。

```sql
-- 设置隔离级别
SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

-- 事务 A
BEGIN;
UPDATE accounts SET balance = 5000 WHERE user_id = 1;  -- 未提交
-- 事务 B
SELECT balance FROM accounts WHERE user_id = 1;  -- 读到了 5000（脏读！）
```

**问题**：脏读、不可重复读、幻读都可能发生。

**适用场景**：几乎不用，除非你完全不在乎数据准确性。

---

### Read Committed（读已提交）

**规则**：只能读取其他事务已提交的数据。

这是 Oracle、SQL Server 等数据库的默认隔离级别。

```sql
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- 事务 A
BEGIN;
UPDATE accounts SET balance = 5000 WHERE user_id = 1;
-- 事务 B
SELECT balance FROM accounts WHERE user_id = 1;  -- 读到的是原值（事务 A 未提交）
COMMIT;  -- 事务 A 提交了
-- 事务 B
SELECT balance FROM accounts WHERE user_id = 1;  -- 读到了 5000（提交后的值）
```

**解决了**：脏读（只能读已提交的）。

**仍存在**：不可重复读、幻读。

---

### Repeatable Read（可重复读）

**规则**：同一事务中，多次读取同一数据，结果都是一致的。

这是 MySQL InnoDB 的默认隔离级别。

```sql
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;

-- 事务 A
BEGIN;
SELECT balance FROM accounts WHERE user_id = 1;  -- 读到 10000
-- 事务 B：UPDATE accounts SET balance = 5000 WHERE user_id = 1; COMMIT;
SELECT balance FROM accounts WHERE user_id = 1;  -- 仍是 10000（可重复读！）
```

**解决了**：脏读、不可重复读。

**InnoDB 额外解决**：幻读（通过 MVCC + 间隙锁）。

---

### Serializable（串行化）

**规则**：事务强制串行执行，就像一个接一个地执行。

这是最高的隔离级别，但并发性能最差。

```sql
SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE;

-- 事务 A
BEGIN;
SELECT balance FROM accounts WHERE user_id = 1;  -- 事务 B 无法同时读取或修改
-- 事务 B
SELECT balance FROM accounts WHERE user_id = 1;  -- 等待 A 结束
```

**解决了**：脏读、不可重复读、幻读。

**代价**：并发性能极差，基本等同于单线程。

---

## 四种隔离级别对比

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 并发性能 |
|----------|------|------------|------|----------|
| Read Uncommitted | ❌ 未防止 | ❌ 未防止 | ❌ 未防止 | 最高 |
| Read Committed | ✅ 防止 | ❌ 未防止 | ❌ 未防止 | 较高 |
| Repeatable Read | ✅ 防止 | ✅ 防止 | ✅ 防止（InnoDB） | 一般 |
| Serializable | ✅ 防止 | ✅ 防止 | ✅ 防止 | 最低 |

---

## 设置隔离级别

### 查看当前隔离级别

```sql
SELECT @@transaction_isolation;
-- 或
SHOW VARIABLES LIKE 'transaction_isolation';
```

### 设置隔离级别

```sql
-- 会话级别（只影响当前连接）
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- 全局级别（影响后续新连接）
SET GLOBAL TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

### 建表时指定

```sql
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    ...
) ENGINE=InnoDB, TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

---

## 隔离级别与 MVCC

InnoDB 在 Read Committed 和 Repeatable Read 隔离级别下使用 MVCC（多版本并发控制）。

核心区别在于 **ReadView 的生成时机**：

| 隔离级别 | ReadView 生成时机 | 说明 |
|----------|------------------|------|
| Read Committed | 每次读取都生成新的 ReadView | 每次读取都看到最新已提交的数据 |
| Repeatable Read | 事务开始时生成 ReadView | 整个事务都看到相同的数据快照 |

```
┌─────────────────────────────────────────────────────────────────┐
│ Read Committed vs Repeatable Read                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Read Committed（每次读取都重新生成 ReadView）：                  │
│ T1: BEGIN;                                                      │
│ T1: SELECT balance FROM accounts WHERE user_id = 1; -- 生成RV1  │
│ T2: UPDATE ... COMMIT;                                         │
│ T1: SELECT balance FROM accounts WHERE user_id = 1; -- 重新生成RV2 │
│ T1: COMMIT;                                                     │
│                                                                 │
│ Repeatable Read（事务开始时生成 ReadView）：                     │
│ T1: BEGIN;                                                      │
│ T1: SELECT balance FROM accounts WHERE user_id = 1; -- 生成RV1  │
│ T2: UPDATE ... COMMIT;                                          │
│ T1: SELECT balance FROM accounts WHERE user_id = 1; -- 复用RV1 │
│ T1: COMMIT;                                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 面试场景

**面试官：** MySQL 的默认隔离级别是什么？

**你：** MySQL InnoDB 的默认隔离级别是可重复读（Repeatable Read）。

**面试官：** Oracle 的默认隔离级别呢？

**你：** Oracle 的默认隔离级别是读已提交（Read Committed）。

**面试官：** 为什么 MySQL 默认用 Repeatable Read 而不是 Read Committed？

**你：** MySQL 早期为了兼容和推广，选择了更严格的隔离级别。另外 InnoDB 在 Repeatable Read 下通过 MVCC + 间隙锁解决了幻读问题，性能开销并不大。

---

## 一句话总结

隔离级别是 MySQL 提供的四层防护：**读未提交**什么保护都没有，**读已提交**防止脏读，**可重复读**防止脏读和不可重复读，**串行化**全部防止但性能最差。MySQL InnoDB 的默认级别是可重复读。
