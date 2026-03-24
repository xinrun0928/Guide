# MySQL 并发控制：MVCC 与锁优化

你正在更新一条用户余额数据：

```sql
BEGIN;
UPDATE account SET balance = balance - 100 WHERE user_id = 1;
COMMIT;
```

与此同时，另一个事务正在查询这个用户的余额：

```sql
SELECT balance FROM account WHERE user_id = 1;
```

问题来了：查询会读到更新前的值还是更新后的值？

如果读到了更新前的值，那「余额」岂不是对不上了？
如果读到了更新后的值，那事务隔离的意义何在？

这就是 MySQL 并发控制要解决的核心问题。

## MVCC：看不见的「时空穿梭」

MySQL 的 InnoDB 引擎采用了 MVCC（Multi-Version Concurrency Control，多版本并发控制）来解决并发问题。简单来说，**同一行数据的不同版本可以同时存在，事务根据隔离级别看到不同版本**。

### 隐藏字段：数据的「时间戳」

InnoDB 为每行数据添加了两个隐藏字段：

1. **DB_TRX_ID**：最近修改的事务 ID（6 字节）
2. **DB_ROLL_PTR**：指向 undo log 的指针（7 字节）

当数据被修改时：
- 更新操作会生成 undo log 记录旧值
- `DB_ROLL_PTR` 指向这条 undo log
- 新数据的 `DB_ROLL_PTR` 指向最新记录

通过这个链表，所有历史版本都可以追溯。

### ReadView：快照的眼睛

MVCC 的关键在于 ReadView（读视图）。当一个事务执行快照读时，会生成一个 ReadView，记录：

- `m_ids`：当前活跃事务（未提交）的 ID 列表
- `min_trx_id`：最小活跃事务 ID
- `max_trx_id`：创建 ReadView 时最大事务 ID + 1
- `creator_trx_id`：当前事务 ID

判断规则：

```java
// 伪代码：判断某行数据的版本是否可见
if (row.trx_id == current_tx_id) {
    // 自己的修改，当然可见
    return true;
}
if (row.trx_id < min_trx_id) {
    // 在 ReadView 生成前已提交，可见
    return true;
}
if (row.trx_id >= max_trx_id) {
    // 在 ReadView 生成后开启，不可见
    return false;
}
if (row.trx_id in m_ids) {
    // 活跃事务的修改，不可见
    return false;
}
return true;  // 已提交事务的修改，可见
```

### RC 与 RR 的区别

**读已提交（Read Committed，RC）**：每次读取都生成新的 ReadView。

**可重复读（Repeated Read，RR）**：第一次读取时生成 ReadView，之后复用。

这就是为什么：

- RC 下，每次查询可能看到不同的数据（其他事务提交的新数据）
- RR 下，同一事务中的多次查询结果一致

```sql
-- 查看当前隔离级别
SELECT @@tx_isolation;

-- 设置隔离级别
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

## 锁：老实人的解决方案

MVCC 解决了「读」的问题，但「写」必须排队，否则会产生数据冲突。InnoDB 使用锁来保证写操作的串行化。

### 锁的类型

| 锁类型 | 说明 | 作用范围 |
|---|---|---|
| 共享锁 (S) | 允许同时持有 | 行 |
| 排他锁 (X) | 独占，不能同时持有 | 行 |
| 意向锁 | 表级标记，表明有行锁 | 表 |

### 行锁的三种算法

1. **Record Lock**：精确锁定一行记录
2. **Gap Lock**：锁定一个范围，不包括记录本身
3. **Next-Key Lock**：Record Lock + Gap Lock，锁定范围并包括记录本身

```sql
-- 显式加锁
SELECT * FROM user WHERE id = 1 FOR UPDATE;  -- 排他行锁
SELECT * FROM user WHERE id = 1 LOCK IN SHARE MODE;  -- 共享行锁

-- 注意：如果使用主键或唯一索引，InnoDB 会使用 Record Lock
-- 如果使用普通索引或范围查询，InnoDB 会使用 Next-Key Lock
```

### 幻读问题

在 RR 隔离级别下：

```sql
-- 事务 A
BEGIN;
SELECT * FROM user WHERE age = 20;  -- 第一次查询，0 条记录
INSERT INTO user VALUES (NULL, 'new_user', 20);  -- 插入一条
SELECT * FROM user WHERE age = 20;  -- 第二次查询，1 条记录
COMMIT;

-- 事务 B
INSERT INTO user VALUES (NULL, 'another_user', 20);  -- 插入一条
```

这个场景中，事务 A 两次查询结果不同，这就是「幻读」——同一个事务中，两次相同条件的查询结果不一致。

**Next-Key Lock 解决幻读**：InnoDB 在 RR 级别下会对扫描到的索引加 Next-Key Lock，阻止其他事务在范围内插入数据。

## 锁优化：让并发更高效

### 减少锁的范围

**原则：锁的范围越小，并发度越高。**

```sql
-- 错误：全表扫描，所有行都被锁
UPDATE user SET status = 1 WHERE status = 0;  -- 如果没有索引，会锁全表

-- 正确：利用索引精确定位
UPDATE user SET status = 1 WHERE id = 1;  -- 只锁一行

-- 添加合适的索引
CREATE INDEX idx_status ON user(status);
```

### 避免死锁

死锁的四个必要条件：
1. 互斥：资源只能被一个事务持有
2. 持有并等待：持有资源的同时请求其他资源
3. 不可抢占：资源不能被强制释放
4. 循环等待：事务之间形成循环依赖

```sql
-- 死锁示例
-- 事务 A
UPDATE account SET balance = balance - 100 WHERE id = 1;  -- 锁住 id=1
UPDATE account SET balance = balance + 100 WHERE id = 2;  -- 等待 id=2

-- 事务 B（同时执行）
UPDATE account SET balance = balance - 100 WHERE id = 2;  -- 锁住 id=2
UPDATE account SET balance = balance + 100 WHERE id = 1;  -- 等待 id=1，死锁！
```

**解决死锁的几种策略**：

1. **统一访问顺序**：所有事务按相同顺序访问资源

```sql
-- 统一顺序：总是先操作 id 小的记录
UPDATE account SET balance = balance - 100 WHERE id < id;  -- 伪代码，实际需要确定顺序
```

2. **减少事务持锁时间**：尽快提交，减少持有锁的窗口

3. **使用低隔离级别**：在允许的场景下，使用 RC 级别减少锁冲突

4. **合理设计索引**：避免大范围扫描导致的锁放大

### 监控锁状态

```sql
-- 查看当前锁等待
SELECT * FROM information_schema.INNODB_LOCK_WAITS;

-- 查看当前锁
SELECT * FROM information_schema.INNODB_LOCKS;

-- 查看事务
SELECT * FROM information_schema.INNODB_TRX;
```

```sql
-- 紧急情况下，Kill 阻塞的事务
KILL [trx_mysql_thread_id];
```

## MVCC 与锁的配合

InnoDB 的并发控制实际上是 MVCC + 锁的组合：

- **快照读**（普通的 SELECT）：使用 MVCC，不需要加锁
- **当前读**（SELECT ... FOR UPDATE、INSERT、UPDATE、DELETE）：使用锁

```sql
-- 快照读：MVCC，无锁
SELECT * FROM user WHERE id = 1;

-- 当前读：加锁
SELECT * FROM user WHERE id = 1 FOR UPDATE;
UPDATE user SET name = 'new' WHERE id = 1;
```

## 总结

MySQL 的并发控制是「快照」与「当前」的权衡：

1. **MVCC 让读不阻塞写**：快照读可以看到历史版本
2. **锁让写不冲突写**：通过锁机制保证数据一致性
3. **不同隔离级别有不同的表现**：RC 下更容易出现幻读，RR 下更容易出现锁等待
4. **锁优化是关键**：减少锁范围、避免死锁、合理设计索引

---

## 留给你的问题

假设有这样的业务场景：

- 用户积分系统，支持积分赠送
- 两个用户 A 和 B，可以互相赠送积分
- 要求：积分赠送过程中，不能出现「积分凭空消失」或「积分凭空增加」

请思考：

1. 这个场景涉及哪些并发控制问题？
2. 如果用悲观锁（SELECT ... FOR UPDATE）实现，会有什么问题？
3. 如果用乐观锁（版本号）实现，性能会更好吗？为什么？

这道题没有标准答案，关键在于理解不同并发控制策略的适用场景。
