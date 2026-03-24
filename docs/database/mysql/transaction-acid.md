# ACID 特性：事务的四个铁律

你有没有遇到过这种情况：

在电商系统里，你下单购买一件商品，流程是：
1. 扣减库存
2. 创建订单
3. 扣减账户余额

如果执行到第 2 步时数据库崩了，库存扣了，但订单没创建，余额也没扣...
你的钱和货都不翼而飞了。

这就是为什么需要**事务**。

---

## 什么是事务？

事务是数据库执行的最小逻辑单元，一个事务包含一条或多条 SQL 语句。

这些语句要么全部成功，要么全部失败——没有中间状态。

```sql
START TRANSACTION;

-- 扣减库存
UPDATE inventory SET count = count - 1 WHERE product_id = 100;

-- 创建订单
INSERT INTO orders (user_id, product_id) VALUES (1, 100);

-- 扣减余额
UPDATE accounts SET balance = balance - 99.00 WHERE user_id = 1;

COMMIT;  -- 全部成功，提交
-- ROLLBACK;  -- 任何一步失败，回滚全部
```

---

## ACID：事务的四个铁律

事务必须满足 ACID 四个特性，这是数据库处理数据的基石。

### A - Atomicity（原子性）

**定义**：事务是最小执行单元，事务中的操作要么全部成功，要么全部失败。

```
原子性示意：

事务 T:
  BEGIN;
  UPDATE inventory SET count = count - 1;  -- 成功
  INSERT INTO orders ...;                    -- 成功
  UPDATE accounts SET balance = ...;        -- 失败！
  COMMIT;

结果：整个事务回滚，所有操作都无效
       库存没扣，订单没创建，余额没变
```

**为什么重要？** 想象一下转账场景：A 给 B 转 100 块。如果扣了 A 的 100 块，但 B 没收到——这不是「部分成功」，这是系统故障。原子性保证这种事不会发生。

### C - Consistency（一致性）

**定义**：事务执行前后，数据库的状态必须保持一致。

一致性的「一致性」是**业务逻辑层面**的一致，不是数据库层面自动保证的。

```java
// 一致性需要业务逻辑保证
public void transfer(Account from, Account to, BigDecimal amount) {
    // 业务规则：A 的余额必须 >= 转账金额
    if (from.getBalance().compareTo(amount) < 0) {
        throw new InsufficientBalanceException("余额不足");
    }

    // 数据库操作
    from.setBalance(from.getBalance().subtract(amount));
    to.setBalance(to.getBalance().add(amount));

    // 提交后，数据库状态满足业务规则：一方的减少 = 另一方的增加
}
```

**重要**：数据库只保证**数据层面**的一致性（如外键约束、唯一索引），业务逻辑的一致性需要程序员自己保证。

### I - Isolation（隔离性）

**定义**：并发执行的事务之间相互隔离，不互相干扰。

这是最复杂的特性。并发场景下，多个事务同时操作同一批数据，可能产生各种「异常」现象。

```
并发事务示意：

时间线：
T1: BEGIN;
T2: BEGIN;
T1: SELECT balance FROM accounts WHERE user_id = 1;  -- 余额 = 1000
T2: UPDATE accounts SET balance = 900 WHERE user_id = 1;  -- T2 扣了 100
T2: COMMIT;
T1: SELECT balance FROM accounts WHERE user_id = 1;  -- T1 看到了什么？900 还是 1000？
T1: UPDATE accounts SET balance = balance - 100;     -- T1 扣了 100
T1: COMMIT;
```

隔离级别越高，并发性能越差；隔离级别越低，并发性能越好，但可能出现更多异常。

### D - Durability（持久性）

**定义**：事务提交后，对数据库的修改是永久性的，即使数据库崩溃也不会丢失。

```
持久性保证：

事务 T:
  BEGIN;
  UPDATE accounts SET balance = 900 WHERE user_id = 1;
  COMMIT;  -- 事务提交

此时数据库崩溃重启...

重启后：SELECT balance FROM accounts WHERE user_id = 1;
结果：balance = 900（修改被持久化了）
```

InnoDB 通过 Redo Log 保证持久性：事务提交时，先写 Redo Log，再写数据文件。即使数据库崩溃，也可以通过 Redo Log 恢复。

---

## ACID 与 MySQL InnoDB

| 特性 | InnoDB 如何实现 |
|------|----------------|
| 原子性 | Undo Log：记录事务修改前的数据，用于回滚 |
| 一致性 | Redo Log + Undo Log + 锁机制 |
| 隔离性 | 锁机制 + MVCC（多版本并发控制） |
| 持久性 | Redo Log（Write-Ahead Logging）+ 双写缓冲 |

---

## 面试场景

**面试官：** 事务的 ACID 分别是什么？

**你：** A 是原子性，事务中的操作要么全部成功，要么全部失败；C 是一致性，事务执行前后数据库状态必须一致；I 是隔离性，并发事务之间相互隔离；D 是持久性，事务提交后修改永久保存。

**面试官：** 数据库怎么保证原子性？

**你：** 通过 Undo Log。事务执行过程中，每次修改都会记录修改前的值到 Undo Log。如果事务失败，MySQL 会读取 Undo Log 中的数据，将修改撤销。

**面试官：** 持久性呢？

**你：** 通过 Redo Log。事务提交时，先把修改写入 Redo Log（顺序写入），再真正修改数据页（随机写入）。即使数据库崩溃，也可以从 Redo Log 恢复。

---

## 一句话总结

ACID 是事务的四个铁律：**原子性保证操作不可分割，一致性保证数据合法，隔离性保证并发安全，持久性保证写入不丢失。**
