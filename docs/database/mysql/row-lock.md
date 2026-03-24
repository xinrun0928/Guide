# 行锁：InnoDB 的精准打击

你已经知道了表锁，那行锁就好理解了——锁定的是表中的某一行（甚至某一列）。

InnoDB 是 MySQL 的默认存储引擎，它的行锁机制让并发性能大幅提升。

---

## 行锁的基本概念

行锁（Row Lock）锁定的是表中的具体行。

其他事务可以并发访问表的其他行，只有被锁定的行才需要等待。

```
表锁 vs 行锁：

┌─────────────────────────────────────────────────────────────┐
│ 表锁：锁定整张表                                             │
│ ┌─────────┬─────────┬─────────┬─────────┬─────────┐       │
│ │ 行 1 🔒 │ 行 2 🔒 │ 行 3 🔒 │ 行 4 🔒 │ 行 5 🔒 │       │
│ └─────────┴─────────┴─────────┴─────────┴─────────┘       │
│ 任何事务想操作任意一行，都要等锁                             │
├─────────────────────────────────────────────────────────────┤
│ 行锁：只锁定需要的行                                         │
│ ┌─────────┬─────────┬─────────┬─────────┬─────────┐       │
│ │ 行 1    │ 行 2 🔒 │ 行 3    │ 行 4    │ 行 5    │       │
│ └─────────┴─────────┴─────────┴─────────┴─────────┘       │
│ 只有行 2 被锁定，其他行可以正常操作                          │
└─────────────────────────────────────────────────────────────┘
```

---

## InnoDB 的行锁类型

### 共享锁（S 锁）

允许事务读取一行，多个事务可以同时持有共享锁。

```sql
-- 事务 A：加共享锁读取
SELECT * FROM orders WHERE id = 1 LOCK IN SHARE MODE;

-- 事务 B：也可以加共享锁读取
SELECT * FROM orders WHERE id = 1 LOCK IN SHARE MODE;  -- 成功

-- 但不能修改
UPDATE orders SET status = 'paid' WHERE id = 1;  -- 被阻塞
```

### 排他锁（X 锁）

允许事务读取或修改一行，只能有一个事务持有排他锁。

```sql
-- 事务 A：加排他锁
SELECT * FROM orders WHERE id = 1 FOR UPDATE;

-- 事务 B：想加任意锁
SELECT * FROM orders WHERE id = 1 LOCK IN SHARE MODE;  -- 被阻塞
UPDATE orders SET status = 'paid' WHERE id = 1;         -- 被阻塞
```

### 锁的兼容性

| 锁类型 | 共享锁（S） | 排他锁（X） |
|--------|-------------|-------------|
| 共享锁（S） | ✅ 兼容 | ❌ 互斥 |
| 排他锁（X） | ❌ 互斥 | ❌ 互斥 |

---

## 行锁的加锁方式

### 1. 自动加锁

在可重复读隔离级别下，普通的 UPDATE、DELETE 操作会自动加排他锁。

```sql
-- 事务 A
BEGIN;
UPDATE orders SET status = 'paid' WHERE id = 1;
-- InnoDB 自动给 id=1 的行加 X 锁

-- 事务 B
SELECT * FROM orders WHERE id = 1;  -- 可以读取（快照读）
SELECT * FROM orders WHERE id = 1 FOR UPDATE;  -- 被阻塞
UPDATE orders SET status = 'shipped' WHERE id = 1;  -- 被阻塞
```

### 2. 显式加锁

使用 `FOR UPDATE` 或 `LOCK IN SHARE MODE` 显式加锁。

```sql
-- FOR UPDATE：排他锁
SELECT * FROM orders WHERE id = 1 FOR UPDATE;

-- LOCK IN SHARE MODE：共享锁
SELECT * FROM orders WHERE id = 1 LOCK IN SHARE MODE;
```

---

## 行锁的范围

行锁锁定的是索引记录，而不是整个数据行。

### 精确行锁

如果查询命中唯一索引或主键索引，锁定的是精确的一行。

```sql
-- 命中主键索引，只锁定 id=1 的行
SELECT * FROM orders WHERE id = 1 FOR UPDATE;

-- 其他行不受影响
UPDATE orders SET status = 'paid' WHERE id = 2;  -- 成功
```

### 范围行锁

如果查询使用普通索引或范围查询，锁定的可能是一段索引范围。

```sql
-- orders 表有 idx_status(status) 索引

-- 事务 A
SELECT * FROM orders WHERE status = 'pending' FOR UPDATE;
-- 锁定所有 status='pending' 的行，以及它们之间的间隙

-- 事务 B
INSERT INTO orders (user_id, status, amount) VALUES (100, 'pending', 100);
-- 被间隙锁阻塞！
```

---

## 行锁与 MVCC

InnoDB 的行锁和 MVCC 是协同工作的。

### 快照读不加锁

在可重复读隔离级别下，普通的 SELECT 语句不加锁，读取历史快照。

```sql
-- 事务 A
BEGIN;
SELECT * FROM orders WHERE id = 1;  -- 快照读，不加锁

-- 事务 B
UPDATE orders SET status = 'paid' WHERE id = 1;  -- 可以成功
COMMIT;
```

### 当前读加锁

使用 `FOR UPDATE` 或 `LOCK IN SHARE MODE`，或者执行 UPDATE/DELETE 操作，会加锁读取最新数据。

```sql
-- 事务 A
BEGIN;
SELECT * FROM orders WHERE id = 1 FOR UPDATE;  -- 加锁当前读

-- 事务 B
UPDATE orders SET status = 'paid' WHERE id = 1;  -- 被阻塞
COMMIT;
```

---

## 行锁的性能问题

### 问题一：锁等待

多个事务竞争同一行的锁时，会产生锁等待。

```sql
-- 事务 A
BEGIN;
SELECT * FROM orders WHERE id = 1 FOR UPDATE;
-- 长时间不提交...

-- 事务 B
SELECT * FROM orders WHERE id = 1 FOR UPDATE;  -- 等待

-- 事务 C
SELECT * FROM orders WHERE id = 1 FOR UPDATE;  -- 等待
```

### 问题二：死锁

两个或多个事务相互等待对方释放锁，形成循环等待。

```sql
-- 事务 A
BEGIN;
SELECT * FROM orders WHERE id = 1 FOR UPDATE;  -- 锁住行 1
UPDATE orders SET amount = 200 WHERE id = 2;  -- 尝试锁行 2

-- 事务 B
BEGIN;
SELECT * FROM orders WHERE id = 2 FOR UPDATE;  -- 锁住行 2
UPDATE orders SET amount = 300 WHERE id = 1;  -- 尝试锁行 1，但行 1 被 A 锁住！
-- 死锁！MySQL 检测到并回滚一个事务
```

### 问题三：锁升级

如果一个事务锁定了太多行，InnoDB 可能会将行锁升级为表锁。

锁升级的触发条件由 `innodb_lock_wait_timeout` 和 `innodb_row_lock_*` 参数控制。

---

## 锁监控

```sql
-- 查看锁等待信息
SHOW ENGINE INNODB STATUS;

-- 查看锁信息
SELECT * FROM information_schema.INNODB_LOCKS;

-- 查看锁等待
SELECT * FROM information_schema.INNODB_LOCK_WAITS;

-- 查看事务
SELECT * FROM information_schema.INNODB_TRX;
```

---

## 一句话总结

InnoDB 的行锁精准锁定需要修改的行，兼顾并发性能。行锁依赖索引，范围查询可能锁住更多行，甚至触发间隙锁。
