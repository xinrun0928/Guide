# 死锁：MySQL 的自处理机制

你有没有遇到过这种情况：

两个事务互相等待对方释放锁，谁也不让谁，程序就这么卡住了。

这就是**死锁**。

MySQL 有自己的死锁检测和处理机制，但你需要理解它，才能避免踩坑。

---

## 什么是死锁？

死锁（Deadlock）是指两个或多个事务相互持有对方需要的锁，形成循环等待。

```
死锁示意：

事务 A：                          事务 B：
┌────────────────────┐          ┌────────────────────┐
│ SELECT * FROM t1    │          │ SELECT * FROM t2   │
│ WHERE id=1 FOR      │          │ WHERE id=1 FOR     │
│ UPDATE;             │          │ UPDATE;            │
│ ────────────────    │          │ ────────────────   │
│ 锁住 t1 的 id=1     │          │ 锁住 t2 的 id=1    │
│                     │          │                     │
│ SELECT * FROM t2    │          │ SELECT * FROM t1   │
│ WHERE id=1 FOR      │          │ WHERE id=1 FOR     │
│ UPDATE;             │    ↔     │ UPDATE;            │
│                     │          │                     │
│ 等待 t2 的 id=1...  │          │ 等待 t1 的 id=1... │
└────────────────────┘          └────────────────────┘
     ↑                                          ↓
     └──────────────────────────────────────────┘
              循环等待，死锁！
```

---

## 死锁的典型场景

### 场景一：交叉锁

两个事务以不同顺序锁定多行。

```sql
-- 事务 A：先锁行 1，再锁行 2
BEGIN;
SELECT * FROM orders WHERE id = 1 FOR UPDATE;  -- 锁行 1
SELECT * FROM orders WHERE id = 2 FOR UPDATE;  -- 尝试锁行 2

-- 事务 B：先锁行 2，再锁行 1
BEGIN;
SELECT * FROM orders WHERE id = 2 FOR UPDATE;  -- 锁行 2
SELECT * FROM orders WHERE id = 1 FOR UPDATE;  -- 尝试锁行 1
-- 死锁！
```

### 场景二：索引锁

更新操作锁定索引范围时，可能锁定多个索引记录。

```sql
-- orders 表有 idx_status(status) 索引

-- 事务 A
BEGIN;
SELECT * FROM orders WHERE status = 'pending' FOR UPDATE;
-- 锁定所有 status='pending' 的行 + 间隙

-- 事务 B
BEGIN;
SELECT * FROM orders WHERE status = 'paid' FOR UPDATE;
-- 锁定所有 status='paid' 的行 + 间隙
-- 可能与事务 A 的间隙锁冲突
```

### 场景三：不同表的操作

不同事务以不同顺序操作多张表。

```sql
-- 事务 A：先操作 orders，再操作 products
BEGIN;
SELECT * FROM orders WHERE id = 1 FOR UPDATE;  -- 锁 orders
SELECT * FROM products WHERE id = 1 FOR UPDATE;  -- 锁 products

-- 事务 B：先操作 products，再操作 orders
BEGIN;
SELECT * FROM products WHERE id = 1 FOR UPDATE;  -- 锁 products
SELECT * FROM orders WHERE id = 1 FOR UPDATE;  -- 锁 orders
-- 死锁！
```

---

## InnoDB 的死锁处理

MySQL InnoDB 有自动的死锁检测和处理机制。

### 检测机制：等待图

InnoDB 维护一个「等待图」（Wait-For Graph），实时检测是否存在循环等待。

```
等待图示意：
┌────────────────────────────────────────────────────────────┐
│                                                            │
│    事务 A ──等待──→ 事务 B                                │
│      ↑                  │                                 │
│      │                  ↓                                 │
│      └─────── 循环等待 ◀┘                                 │
│                                                            │
│  当检测到循环等待时，说明死锁发生了                         │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 处理策略：回滚代价最小的事务

当检测到死锁时，InnoDB 会回滚**代价最小的事务**。

判断标准通常是：
1. 事务所做的修改最少
2. 事务持有锁的时间最短
3. 事务的 undo log 最小

```sql
-- 死锁发生时，MySQL 输出日志
SHOW ENGINE INNODB STATUS\G
-- 输出：
-- *** (1) TRANSACTION:
-- TRANSACTION 12345, ACTIVE 10 sec inserting
-- ...
-- *** (2) TRANSACTION:
-- TRANSACTION 12346, ACTIVE 5 sec inserting
-- ...
-- *** WE ROLL BACK TRANSACTION (2)  -- 回滚了事务 2
```

---

## 如何避免死锁？

### 策略一：按固定顺序访问表/行

如果多个事务需要操作多行，按相同顺序操作可以避免循环等待。

```sql
-- 好的做法：按 id 顺序加锁
-- 事务 A
BEGIN;
SELECT * FROM orders WHERE id = 1 FOR UPDATE;
SELECT * FROM orders WHERE id = 2 FOR UPDATE;

-- 事务 B
BEGIN;
SELECT * FROM orders WHERE id = 1 FOR UPDATE;  -- 等待 A
SELECT * FROM orders WHERE id = 2 FOR UPDATE;  -- 等待 A
-- 没有死锁，只是排队等待
```

### 策略二：减少锁持有时间

尽量缩短事务的执行时间，减少锁冲突的概率。

```sql
-- 错误：事务中包含大量业务逻辑
BEGIN;
SELECT * FROM orders WHERE id = 1 FOR UPDATE;
processLongBusinessLogic();  -- 长时间处理
UPDATE orders SET status = 'paid';  -- 最后才更新
COMMIT;

-- 正确：只保留必要的锁
BEGIN;
SELECT * FROM orders WHERE id = 1 FOR UPDATE;
UPDATE orders SET status = 'paid';
COMMIT;
-- 业务逻辑放在事务外面
```

### 策略三：使用低隔离级别

降低隔离级别可以减少锁的范围，降低死锁概率。

```sql
-- 可重复读下，范围查询会加间隙锁
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
-- 读已提交下，间隙锁更少
```

### 策略四：使用 SELECT ... FOR UPDATE NOWAIT

如果获取不到锁立即报错，避免长时间等待。

```sql
-- 尝试获取锁，不等待
SELECT * FROM orders WHERE id = 1 FOR UPDATE NOWAIT;
-- ERROR: Resource lock unavailable
```

### 策略五：监控和告警

```sql
-- 开启死锁信息记录
SET GLOBAL innodb_print_all_deadlocks = ON;

-- 查看死锁日志
SHOW ENGINE INNODB STATUS\G
```

---

## 死锁与业务处理

业务代码需要正确处理死锁异常：

```java
public class OrderService {
    public void updateOrder(long orderId) {
        int maxRetries = 3;
        for (int i = 0; i < maxRetries; i++) {
            try {
                // 执行更新
                orderMapper.updateStatus(orderId, "paid");
                return;
            } catch (DeadlockException e) {
                // 死锁时，稍等重试
                if (i < maxRetries - 1) {
                    Thread.sleep(100 * (i + 1));
                }
            }
        }
        throw new RuntimeException("更新失败，死锁次数过多");
    }
}
```

---

## 面试追问方向

- InnoDB 是如何检测死锁的？时间复杂度是多少？
- 为什么有时候死锁没有被检测到？
- 如何在业务代码中处理死锁？
- 死锁和锁等待有什么区别？

> 死锁是相互等待，锁等待是等待释放。死锁是循环等待，锁等待是单向等待。
