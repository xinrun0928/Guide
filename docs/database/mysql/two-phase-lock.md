# 两阶段锁：事务加锁的规矩

面试官问：「MySQL 的两阶段锁协议是什么？」

你张口就来：「加锁和解锁分为两个阶段。」

面试官追问：「具体是什么意思？」

你沉默了。

两阶段锁是数据库并发控制的重要协议，理解它是理解 MySQL 锁机制的关键。

---

## 什么是两阶段锁？

两阶段锁（Two-Phase Locking，简称 2PL）协议规定：

1. **扩展阶段（Growing Phase）**：只能加锁，不能释放锁
2. **收缩阶段（Shrinking Phase）**：只能释放锁，不能加锁

**关键点**：锁的释放和获取必须分为两个不相交的阶段。

```sql
-- 两阶段锁示意
BEGIN;
-- 扩展阶段：只能加锁
SELECT * FROM orders WHERE id = 1 FOR UPDATE;  -- 加锁 ✅
SELECT * FROM orders WHERE id = 2 FOR UPDATE;  -- 加锁 ✅
UPDATE orders SET status = 'paid' WHERE id = 1;  -- 加锁 ✅

-- 收缩阶段：只能释放锁
COMMIT;  -- 释放所有锁

-- 错误示例：扩展阶段释放锁
BEGIN;
SELECT * FROM orders WHERE id = 1 FOR UPDATE;  -- 加锁
COMMIT;  -- 释放了！但后面还有加锁操作
SELECT * FROM orders WHERE id = 2 FOR UPDATE;  -- 加锁
COMMIT;
-- 这违反了两阶段锁协议
```

---

## 两阶段锁的分类

### 严格两阶段锁（Strict 2PL）

**规则**：事务持有排他锁，直到事务结束（COMMIT 或 ROLLBACK）才释放。

```sql
-- 严格两阶段锁
BEGIN;
UPDATE orders SET status = 'paid' WHERE id = 1;  -- 加 X 锁
UPDATE orders SET amount = 100 WHERE id = 2;  -- 加 X 锁
-- 必须等到 COMMIT 才释放所有锁
COMMIT;
```

**优点**：防止级联回滚。如果事务 A 修改了数据，事务 B 读取了数据并提交，事务 A 回滚了——严格 2PL 下 B 的提交不会有问题。

### 强严格两阶段锁（Strong Strict 2PL）

**规则**：事务持有的所有锁（不仅是排他锁），都要等到事务结束才释放。

```sql
-- 强严格两阶段锁
BEGIN;
SELECT * FROM orders WHERE id = 1 LOCK IN SHARE MODE;  -- 加 S 锁
SELECT * FROM orders WHERE id = 2 LOCK IN SHARE MODE;  -- 加 S 锁
-- 必须等到 COMMIT 才释放所有锁
COMMIT;
```

**InnoDB 采用的就是强严格两阶段锁**：事务开始时加锁，事务结束时（COMMIT 或 ROLLBACK）统一释放所有锁。

---

## 两阶段锁与并发控制

两阶段锁保证了事务的可串行化调度。

### 可串行化

如果多个事务的并发执行结果，与它们按某种顺序串行执行的结果一致，就说这个调度是可串行化的。

```sql
-- 调度 1（串行执行）
T1: BEGIN; UPDATE orders SET amount = 100 WHERE id = 1; COMMIT;
T2: BEGIN; UPDATE orders SET amount = 200 WHERE id = 1; COMMIT;
-- 结果：T2 的修改覆盖了 T1 的修改

-- 调度 2（并发执行）
T1: BEGIN; UPDATE orders SET amount = 100 WHERE id = 1;
T2: BEGIN; UPDATE orders SET amount = 200 WHERE id = 1;
T1: COMMIT;
T2: COMMIT;
-- 两阶段锁保证：最终结果等价于某种串行顺序
```

### 两阶段锁防止的问题

两阶段锁可以防止脏写、脏读、不可重复读、幻读等问题。

```
没有两阶段锁（可能导致脏写）：

T1: BEGIN;
T2: BEGIN;
T1: SELECT amount FROM orders WHERE id = 1;  -- amount = 1000
T2: SELECT amount FROM orders WHERE id = 1;  -- amount = 1000
T1: UPDATE orders SET amount = 900 WHERE id = 1;
T2: UPDATE orders SET amount = 800 WHERE id = 1;  -- T1 的修改被覆盖了！
T1: ROLLBACK;  -- T1 回滚，amount = 1000
T2: COMMIT;  -- T2 提交，amount = 800
-- T2 的提交基于错误的假设（amount 应该是 1000，不是 900）

有两阶段锁：

T1: BEGIN;
T2: BEGIN;
T1: UPDATE orders SET amount = 900 WHERE id = 1;  -- 加 X 锁
T2: UPDATE orders SET amount = 800 WHERE id = 1;  -- 等待 T1 释放锁
T1: ROLLBACK;  -- 释放锁，amount = 1000
T2: 获取锁，UPDATE orders SET amount = 800;  -- 基于正确的值
T2: COMMIT;
```

---

## 两阶段锁的潜在问题

### 问题一：锁等待和死锁

两阶段锁可能导致事务相互等待，形成死锁。

```sql
-- 死锁场景
T1: BEGIN;
T1: SELECT * FROM orders WHERE id = 1 FOR UPDATE;  -- 锁住行 1
T2: BEGIN;
T2: SELECT * FROM orders WHERE id = 2 FOR UPDATE;  -- 锁住行 2
T1: SELECT * FROM orders WHERE id = 2 FOR UPDATE;  -- 等待 T2
T2: SELECT * FROM orders WHERE id = 1 FOR UPDATE;  -- 等待 T1
-- 死锁！MySQL 会检测并回滚一个事务
```

### 问题二：长事务导致锁积累

如果一个事务运行时间很长，它持有的锁会阻塞其他事务很长时间。

```sql
-- 事务 A
BEGIN;
SELECT * FROM orders WHERE user_id = 1 FOR UPDATE;  -- 锁定很多行
-- 长时间处理业务逻辑...
-- 其他事务想操作这些行？只能等待
```

---

## InnoDB 的两阶段锁实现

InnoDB 实现了严格两阶段锁，所有锁在事务结束时释放。

```java
// InnoDB 的锁获取流程（简化）
public class InnoDBTransaction {
    private List&lt;Lock&gt; locks = new ArrayList&lt;&gt;();

    public void lockRow(String table, long rowId) {
        Lock lock = lockManager.acquire(table, rowId);
        locks.add(lock);  // 记录锁
        // 扩展阶段：可以继续加锁
    }

    public void commit() {
        // 收缩阶段：释放所有锁
        for (Lock lock : locks) {
            lockManager.release(lock);
        }
        locks.clear();
    }

    public void rollback() {
        // 收缩阶段：释放所有锁
        for (Lock lock : locks) {
            lockManager.release(lock);
        }
        locks.clear();
    }
}
```

---

## 面试场景

**面试官：** 什么是两阶段锁？

**你：** 两阶段锁协议规定，事务的锁操作分为两个阶段：扩展阶段只能加锁，收缩阶段只能释放锁。InnoDB 实现的是严格两阶段锁，所有锁在事务提交或回滚时统一释放。

**面试官：** 两阶段锁有什么用？

**你：** 两阶段锁保证了事务的可串行化调度，防止脏读、脏写、不可重复读等问题。它是数据库并发控制的基础协议。

**面试官：** 两阶段锁有什么问题？

**你：** 可能导致锁等待和死锁。另外，如果事务运行时间长，它持有的锁会阻塞其他事务很久。所以实际开发中要注意控制事务大小。

---

## 一句话总结

两阶段锁是 MySQL 并发控制的基石：**扩展阶段只加锁，收缩阶段只释放锁**。InnoDB 采用严格两阶段锁，事务结束时统一释放所有锁。
