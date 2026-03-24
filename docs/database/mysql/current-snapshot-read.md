# 当前读与快照读：MVCC 的两副面孔

你知道吗？

同一个 SELECT 语句，在不同场景下可能读到不同的数据。

有时候读到的是「历史快照」，有时候读到的是「最新数据」。

这背后就是**当前读**和**快照读**的区分。

---

## 什么是快照读？

快照读（Snapshot Read）读取的是**历史版本的数据**，是 MVCC 机制的体现。

普通的 SELECT 语句就是快照读：

```sql
SELECT * FROM users WHERE id = 1;  -- 快照读
```

快照读的特点：
- 读取的是某个时间点的数据快照
- 不加锁，不会阻塞其他事务
- 依赖 ReadView 实现

---

## 什么是当前读？

当前读（Current Read）读取的是**最新提交的数据**。

当前读需要读取最新数据，所以必须加锁：

```sql
-- 加锁读取（当前读）
SELECT * FROM users WHERE id = 1 FOR UPDATE;   -- 排他锁
SELECT * FROM users WHERE id = 1 LOCK IN SHARE MODE;  -- 共享锁

-- 写操作（都是当前读）
INSERT INTO users ...;  -- 排他锁
UPDATE users ...;      -- 排他锁
DELETE FROM users ...; -- 排他锁
```

当前读的特点：
- 读取最新提交的数据
- 需要加锁
- 可能阻塞其他事务

---

## 对比图解

```
┌─────────────────────────────────────────────────────────────────┐
│                     快照读 vs 当前读                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  快照读（普通 SELECT）：                                         │
│  T1: SELECT * FROM users;  -- 读取历史快照，不加锁              │
│      └── 读到的是 ReadView 生成时的数据版本                     │
│                                                                 │
│  当前读（SELECT FOR UPDATE）：                                   │
│  T1: SELECT * FROM users FOR UPDATE;  -- 读取最新数据，加锁     │
│      └── 必须等待其他事务释放锁                                  │
│                                                                 │
│  当前读（INSERT/UPDATE/DELETE）：                               │
│  T1: UPDATE users SET name = '李四' WHERE id = 1;               │
│      └── 加排他锁，读取最新数据后修改                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 为什么需要区分？

### 场景：订单状态更新

```sql
-- 场景：检查订单状态，然后更新
-- 错误写法（快照读）
BEGIN;
SELECT status FROM orders WHERE id = 1;  -- 快照读：status = 'pending'
-- 此时另一个事务把 status 改成了 'paid' 并提交
UPDATE orders SET status = 'cancelled' WHERE id = 1 AND status = 'pending';
-- 更新成功，但可能覆盖了别人的修改！

-- 正确写法（当前读）
BEGIN;
SELECT status FROM orders WHERE id = 1 FOR UPDATE;  -- 当前读，加锁
-- 此时其他事务无法修改这条记录
UPDATE orders SET status = 'cancelled' WHERE id = 1;
COMMIT;
```

### 场景：库存扣减

```java
// 错误的并发扣减（快照读）
public boolean deductInventoryWrong(long productId, int count) {
    // 快照读：查到库存 = 10
    Integer stock = jdbcTemplate.queryForObject(
        "SELECT stock FROM products WHERE id = ?",
        Integer.class, productId
    );

    if (stock >= count) {
        // 但此时另一个请求已经扣了 8 库存
        jdbcTemplate.update(
            "UPDATE products SET stock = stock - ? WHERE id = ?",
            count, productId
        );
        return true;
    }
    return false;
}

// 正确的并发扣减（当前读 + 乐观锁）
public boolean deductInventoryCorrect(long productId, int count, int version) {
    int rows = jdbcTemplate.update(
        "UPDATE products SET stock = stock - ?, version = version + 1 " +
        "WHERE id = ? AND version = ? AND stock >= ?",
        count, productId, version, count
    );
    return rows > 0;
}
```

---

## 实际应用中的选择

### 用快照读的场景

- 纯粹的查询，不需要修改
- 生成报表、数据统计
- 读取为主，更新冲突少的场景

```sql
-- 快照读适合
SELECT COUNT(*) FROM orders WHERE user_id = 1;
SELECT SUM(amount) FROM orders WHERE status = 'paid';
SELECT * FROM articles WHERE id = 100;
```

### 用当前读的场景

- 检查后再更新（Check-Then-Act）
- 库存扣减、余额扣款等需要原子操作的场景
- 需要确保读取的是最新数据

```sql
-- 当前读适合
SELECT * FROM orders WHERE id = 1 FOR UPDATE;  -- 检查订单状态
UPDATE orders SET status = 'shipped' WHERE id = 1;  -- 更新订单状态
```

---

## MVCC 与锁的关系

MVCC 和锁是两种不同的并发控制机制：

| 特性 | MVCC | 锁 |
|------|------|-----|
| 读取什么 | 历史快照 | 最新数据 |
| 是否加锁 | 不加锁（快照读） | 加锁（当前读） |
| 阻塞情况 | 不阻塞其他读 | 可能阻塞其他事务 |
| 适用场景 | 读多写少 | 写多读多 |

```
┌─────────────────────────────────────────────────────────────────┐
│                      并发控制的两条路径                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  读操作：                                                        │
│  ┌──────────────┐    MVCC    ┌─────────────┐                   │
│  │  SELECT ...  │ ────────→ │  历史快照   │                   │
│  └──────────────┘            └─────────────┘                   │
│                                                                 │
│  写操作 + 关键读操作：                                           │
│  ┌──────────────┐    锁机制  ┌─────────────┐                   │
│  │ SELECT ...   │ ────────→ │ 最新数据    │                   │
│  │   FOR UPDATE │            │ （加锁）    │                   │
│  └──────────────┘            └─────────────┘                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 面试场景

**面试官：** 什么是当前读和快照读？

**你：** 快照读是普通的 SELECT 语句，读取的是某个时间点的数据快照，不加锁，不会阻塞其他事务。当前读包括 SELECT ... FOR UPDATE、INSERT、UPDATE、DELETE，读取的是最新提交的数据，需要加锁。

**面试官：** MVCC 解决了什么问题？

**你：** MVCC 主要解决了快照读的并发问题，让读操作不加锁也能看到一致的数据快照，从而提高并发性能。但对于需要读取最新数据的场景（如扣库存），仍然需要使用当前读配合锁机制。

**面试官：** `SELECT ... FOR UPDATE` 会阻塞吗？

**你：** 会。因为 FOR UPDATE 是当前读，需要读取最新数据，如果其他事务持有排他锁，就会等待。

---

## 一句话总结

快照读和当前读是 MVCC 的两副面孔：**快照读**看到历史，不加锁；**当前读**看到最新，要加锁。读多写少用快照，写多写多或 Check-Then-Act 场景用当前读。
