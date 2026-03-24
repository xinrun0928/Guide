# 表锁：MySQL 的最粗粒度锁

你有没有遇到过这种情况：

一个复杂的报表查询跑了 5 分钟，结果把整个数据库的更新都阻塞了。

你一脸懵：「我只是个 SELECT 啊，为什么别人写不进去？」

答案就是**表锁**。

---

## 什么是表锁？

表锁是 MySQL 最基本的锁机制，锁定的是整张表。

顾名思义，锁住整个表，其他事务对这张表的所有操作都要等待锁释放。

```sql
-- 给表加读锁（共享锁）
LOCK TABLES orders READ;
-- 其他事务可以读，但不能写

-- 给表加写锁（排他锁）
LOCK TABLES orders WRITE;
-- 其他事务不能读也不能写
```

### 表锁的特点

- **粒度最粗**：锁定整张表
- **开销最小**：不需要记录每行数据的状态
- **冲突概率高**：并发性能差
- **MyISAM 支持好**：MyISAM 引擎默认使用表锁
- **InnoDB 支持有限**：InnoDB 更倾向于行锁，但在某些场景下也会使用表锁

---

## 表锁的分类

### 共享锁（Shared Lock，S 锁）

也称为读锁。多个事务可以同时持有共享锁，互不阻塞。

```sql
LOCK TABLES orders READ;
-- 其他事务也可以：LOCK TABLES orders READ;  -- 成功
-- 但不能：LOCK TABLES orders WRITE;  -- 被阻塞
```

### 排他锁（Exclusive Lock，X 锁）

也称为写锁。一旦某个事务持有排他锁，其他事务既不能加共享锁也不能加排他锁。

```sql
LOCK TABLES orders WRITE;
-- 其他事务都不能读写这张表，直到锁释放
```

### 锁的兼容性矩阵

| 锁类型 | 共享锁（S） | 排他锁（X） |
|--------|-------------|-------------|
| 共享锁（S） | ✅ 兼容 | ❌ 互斥 |
| 排他锁（X） | ❌ 互斥 | ❌ 互斥 |

---

## InnoDB 中的表锁

虽然 InnoDB 的核心是行锁，但在某些场景下也会使用表锁：

### MDL（元数据锁）

MySQL 5.5+ 引入了 MDL（Metadata Lock），自动在表级别加锁。

```sql
-- 查询时自动加 MDL 读锁
SELECT * FROM orders WHERE id = 1;
-- 其他事务可以并发查询
-- 但 ALTER TABLE orders ADD COLUMN ... 会被阻塞

-- 修改时自动加 MDL 写锁
INSERT INTO orders ...;
-- 其他事务的读写都会被阻塞
```

### 表级意向锁

这是 InnoDB 用来协调行锁和表锁的机制（后面会详细讲）。

### 显式表锁

InnoDB 也支持显式加表锁：

```sql
-- 加表级共享锁
LOCK TABLES orders READ LOCAL;

-- 加表级排他锁
LOCK TABLES orders WRITE;

-- 释放锁
UNLOCK TABLES;
```

**注意**：`LOCK TABLES` 会隐式提交当前事务。

---

## 表锁的问题

### 问题一：并发性能差

```sql
-- 事务 A：给 orders 表加写锁
LOCK TABLES orders WRITE;
UPDATE orders SET status = 'paid' WHERE id = 1;
-- 事务 B：想查询 orders 表
SELECT * FROM orders WHERE id = 2;  -- 被阻塞！
```

### 问题二：长事务导致锁等待

```sql
-- 事务 A：开始事务但忘记提交
BEGIN;
SELECT * FROM orders;  -- MDL 读锁
-- 长时间不操作...

-- 事务 B：想修改表结构
ALTER TABLE orders ADD COLUMN remark VARCHAR(500);  -- 被 MDL 写锁阻塞！

-- 后续所有查询也都被阻塞！
```

### 问题三：MyISAM 的表锁问题

MyISAM 引擎不支持行锁，所有操作都加表锁。

```sql
-- 事务 A：查询（加读锁）
SELECT COUNT(*) FROM orders;  -- 持有读锁
-- 事务 B：插入（需要写锁，但被读锁阻塞）
INSERT INTO orders ...;  -- 等待
```

MyISAM 的读写是串行的：读操作会阻塞写操作，写操作会阻塞读操作。

---

## 表锁的使用建议

### 场景一：MyISAM 引擎表

适合读多写少、数据量小的场景。

### 场景二：需要锁定整张表的场景

比如批量更新、全表统计等。

### 场景三：DDL 操作

ALTER TABLE 等 DDL 语句需要加 MDL 写锁。

### 场景四：尽量避免的场景

- InnoDB 表的并发写入
- 长事务（可能导致 MDL 锁等待）
- 大表操作（阻塞时间长）

---

## 锁监控

```sql
-- 查看表锁信息
SHOW STATUS LIKE 'Table_locks%';
-- 输出：
-- Table_locks_immediate: 1000000  -- 可以立即获取的锁数量
-- Table_locks_waited: 100         -- 需要等待的锁数量

-- 查看 MDL 锁
SELECT * FROM performance_schema.metadata_locks;

-- 查看 Innodb 锁信息
SHOW ENGINE INNODB STATUS;
```

---

## 一句话总结

表锁是 MySQL 最粗粒度的锁，锁定整张表，开销小但并发差。InnoDB 虽然以行锁为主，但 MDL 等机制仍会使用表锁。
