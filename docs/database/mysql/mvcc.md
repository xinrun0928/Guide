# MVCC 原理：MySQL 的时间魔法

你有没有想过这个问题：

在可重复读隔离级别下，同一个事务里两次执行同样的查询，为什么返回的结果是一样的？

即使在这个过程中，有其他事务插入了新数据、修改了旧数据...

答案就是 **MVCC**（Multi-Version Concurrency Control，多版本并发控制）。

---

## MVCC 的核心思想

MVCC 的本质是：**每个事务看到的是数据库在某个「时间点」的快照。**

就像你看书时看到的历史照片——无论后来发生了什么，你看到的都是拍摄时的画面。

```
MVCC 示意：

数据库状态随时间变化：
T0: [A=1, B=2, C=3]   ← 快照 1 的视野
     │
     ↓ (T1 时刻)
T1: [A=1, B=5, C=3]   ← T2 事务的修改
     │
     ↓ (T2 时刻)
T2: [A=1, B=5, C=7]   ← 快照 2 的视野

事务 T1（始于 T0）：看到 A=1, B=2, C=3
事务 T2（始于 T1）：看到 A=1, B=5, C=3
事务 T3（始于 T2）：看到 A=1, B=5, C=7
```

---

## MVCC 的两个关键概念

### 隐藏列

InnoDB 中，每行数据都有两个隐藏列：

```sql
-- 实际的表结构（InnoDB）
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    name VARCHAR(50),
    age INT
);

-- InnoDB 实际存储的是：
-- id | name | age | DB_ROW_ID | DB_TX_ID | DB_ROLL_PTR
-- 1    张三   25     -           -          -
```

| 隐藏列 | 说明 |
|--------|------|
| `DB_ROW_ID` | 行 ID，6 字节，InnoDB 自动生成（无主键时作为聚簇索引） |
| `DB_TX_ID` | 事务 ID，每次事务递增，记录最后修改该行的事务 ID |
| `DB_ROLL_PTR` | 回滚指针，指向 Undo Log 中的历史版本 |

### Undo Log（回滚日志）

每行数据的历史版本都存储在 Undo Log 中，通过 `DB_ROLL_PTR` 串联成链表：

```
一行数据的多个版本：

当前版本（最新事务修改）：
┌──────┬───────┬──────┬──────────────┐
│ name │ age   │ TX_ID│ ROLL_PTR     │
│ 李四 │ 30    │ 105  │              │  ← 最新
└──────┴───────┴──────┴──────────────┘
          │
          │ ROLL_PTR 指向
          ↓
┌──────┬───────┬──────┬──────────────┐
│ name │ age   │ TX_ID│ ROLL_PTR     │
│ 张三 │ 25    │ 100  │              │  ← 历史版本 1
└──────┴───────┴──────┴──────────────┘
          │
          │ ROLL_PTR 指向
          ↓
┌──────┬───────┬──────┬──────────────┐
│ name │ age   │ TX_ID│ ROLL_PTR     │
│ 张三 │ 24    │ 90   │              │  ← 历史版本 2
└──────┴───────┴──────┴──────────────┘
```

---

## ReadView：快照的「快照」

ReadView 是 MVCC 的关键机制，它记录了**当前数据库中活跃事务的 ID 列表**。

```java
// ReadView 简化结构
public class ReadView {
    // 活跃事务的最小 ID
    private long minTrxId;
    // 活跃事务的最大 ID
    private long maxTrxId;
    // 当前事务的 ID
    private long creatorTrxId;
    // 活跃事务 ID 列表
    private List&lt;Long&gt; activeTransactions;
}
```

### ReadView 的判断规则

当事务读取一行数据时，根据以下规则决定读取哪个版本：

```java
public boolean isVisible(ReadView rv, Row row) {
    // 规则 1：如果数据行的事务 ID 等于当前事务 ID，可以读取
    if (row.getTrxId() == rv.getCreatorTrxId()) {
        return true;
    }

    // 规则 2：如果事务 ID 小于活跃事务的最小 ID，说明已提交，可以读取
    if (row.getTrxId() < rv.getMinTrxId()) {
        return true;
    }

    // 规则 3：如果事务 ID 在活跃列表中，不可见
    if (rv.getActiveTransactions().contains(row.getTrxId())) {
        return false;
    }

    // 规则 4：事务 ID 大于等于最大 ID，需要和 maxTrxId 比较
    // ...

    return true;
}
```

### ReadView 的生成时机

| 隔离级别 | ReadView 生成时机 |
|----------|------------------|
| Read Committed | **每次读取数据时**都生成新的 ReadView |
| Repeatable Read | **事务开始时**生成一个 ReadView，事务内复用 |

```
Read Committed 下的查询：
T1: BEGIN;
T1: SELECT ... FROM users; -- 生成 ReadView#1
T2: UPDATE users SET name='李四' WHERE id=1; COMMIT;
T1: SELECT ... FROM users; -- 重新生成 ReadView#2，看到新数据

Repeatable Read 下的查询：
T1: BEGIN; -- 生成 ReadView#1
T1: SELECT ... FROM users; -- 使用 ReadView#1
T2: UPDATE users SET name='李四' WHERE id=1; COMMIT;
T1: SELECT ... FROM users; -- 仍使用 ReadView#1，看不到新数据
```

---

## 快照读 vs 当前读

MVCC 只对**快照读**生效。对于**当前读**，MySQL 仍然需要加锁。

### 快照读（Snapshot Read）

普通的 SELECT 语句，读取的是历史快照：

```sql
SELECT * FROM users WHERE id = 1;  -- 快照读
```

### 当前读（Current Read）

读取的是最新提交的数据，需要加锁：

```sql
SELECT * FROM users WHERE id = 1 FOR UPDATE;  -- 当前读，加排他锁
INSERT INTO users ...;   -- 当前读，加排他锁
UPDATE users ...;       -- 当前读，加排他锁
DELETE FROM users ...;   -- 当前读，加排他锁
```

**面试追问**：可重复读隔离级别下，为什么 `SELECT ... FOR UPDATE` 仍然会阻塞？

因为 `FOR UPDATE` 是当前读，需要读取最新数据，而此时其他事务可能持有排他锁，必须等待。

---

## MVCC + 间隙锁 = 解决幻读

可重复读隔离级别下，MVCC 解决了大部分幻读问题。

但对于**当前读**（如 `SELECT ... FOR UPDATE`），MVCC 不够用了——需要配合**间隙锁**来防止幻读。

```
幻读场景（无间隙锁）：

T1: SELECT * FROM orders WHERE user_id = 1 FOR UPDATE;
    -- 读到 2 条记录

T2: INSERT INTO orders (user_id, amount) VALUES (1, 100);
    -- 插入了一条新订单

T1: SELECT * FROM orders WHERE user_id = 1 FOR UPDATE;
    -- 读到 3 条记录（幻读！）

幻读场景（有间隙锁）：

T1: SELECT * FROM orders WHERE user_id = 1 FOR UPDATE;
    -- InnoDB 自动在 user_id 的间隙加间隙锁

T2: INSERT INTO orders (user_id, amount) VALUES (1, 100);
    -- 被间隙锁阻塞！

T1: COMMIT;  -- 提交后，间隙锁释放
T2: 插入成功
```

---

## 面试追问方向

- MVCC 的 Undo Log 什么时候会被 purge（清理）？
- Read Committed 和 Repeatable Read 在 MVCC 实现上有什么区别？
- 为什么 MVCC 能解决快照读的幻读，但不能解决当前读的幻读？

> 提示：MVCC 的核心是快照读，而幻读发生在当前读场景。当前读需要配合锁机制来解决。
