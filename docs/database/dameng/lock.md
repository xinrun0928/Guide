# 达梦数据库锁机制：并发控制的核心

你见过这种场景吗？

系统上线后运行平稳，并发量一上来就开始频繁超时。查看监控，发现大量线程在等待锁。

这不是硬件问题，是你的锁机制用错了。

今天，我们来深入理解达梦数据库的锁机制，让并发不再成为性能的绊脚石。

## 锁的分类

### 按锁粒度划分

**表级锁：** 锁定整张表，开销小，冲突概率高。

```sql
-- 手动加表级锁
LOCK TABLE employee IN SHARE MODE;      -- 共享锁：阻止其他事务修改
LOCK TABLE employee IN EXCLUSIVE MODE; -- 排他锁：完全独占
```

**行级锁：** 锁定表中某一行，开销大，冲突概率低。

```sql
-- UPDATE/DELETE 默认加行级排他锁
UPDATE employee SET salary = 10000 WHERE emp_id = 1001;
-- 其他事务仍可修改其他行，但不能修改这一行
```

**页级锁：** 锁定数据页（介于表级和行级之间）。

### 按锁模式划分

| 锁模式 | 简称 | 作用 | 兼容情况 |
|-------|------|------|---------|
| 共享锁 (Shared) | S | 读取数据 | 与 S 锁兼容，与 X 锁互斥 |
| 排他锁 (Exclusive) | X | 修改数据 | 与任何锁都互斥 |
| 意向共享锁 (IS) | IS | 准备获取 S 锁 | 兼容性良好 |
| 意向排他锁 (IX) | IX | 准备获取 X 锁 | 兼容性良好 |
| 共享意向排他锁 (SIX) | SIX | 表级 S + 行级 X | 与 IX 互斥 |

```
意向锁的意义：
当事务 T1 对某行加 X 锁时，会自动对整张表加 IX 锁。
其他事务看到 IX，就知道「有人对这个表的部分行加锁了」。
这避免了全表扫描检查每一行的锁状态。
```

## 达梦的锁等待与死锁

### 锁等待

当事务 A 持有锁，事务 B 尝试获取相同的锁时，B 会进入等待状态。

```sql
-- 会话1：开启事务，锁定一行
SESSION1> BEGIN;
SESSION1> UPDATE employee SET salary = 10000 WHERE emp_id = 1001;
-- 1 row updated

-- 会话2：尝试更新同一行（会被阻塞）
SESSION2> BEGIN;
SESSION2> UPDATE employee SET salary = 10000 WHERE emp_id = 1001;
-- 此时会话2会等待，直到会话1提交或回滚
```

**设置锁等待超时：**

```sql
-- 设置锁等待超时时间（毫秒）
SET LOCK_TIMEOUT = 5000;  -- 等待5秒后报错退出

-- 查看当前会话的锁等待状态
SELECT * FROM V$LOCK;
```

### 死锁

死锁是循环等待：事务 A 持有锁 1 等锁 2，事务 B 持有锁 2 等锁 1。

```sql
-- 场景演示
-- 会话1：先锁 ID=1，再锁 ID=2
SESSION1> BEGIN;
SESSION1> UPDATE employee SET salary = 10000 WHERE emp_id = 1;  -- 锁定 ID=1
SESSION1> UPDATE employee SET salary = 10000 WHERE emp_id = 2;  -- 尝试锁定 ID=2

-- 会话2：先锁 ID=2，再锁 ID=1
SESSION2> BEGIN;
SESSION2> UPDATE employee SET salary = 10000 WHERE emp_id = 2;  -- 锁定 ID=2
SESSION2> UPDATE employee SET salary = 10000 WHERE emp_id = 1;  -- 尝试锁定 ID=1
-- 死锁！会话1等会话2释放ID=2，会话2等会话1释放ID=1
```

达梦会自动检测死锁并回滚其中一个事务：

```
ERROR at line 1:
Deadlock detected while waiting for resource.
```

```java
// Java 应用处理死锁：重试机制
public class DeadlockRetryDemo {

    public void updateWithRetry(int maxRetries) {
        for (int i = 0; i < maxRetries; i++) {
            try {
                jdbcTemplate.update("UPDATE employee SET salary = ? WHERE emp_id = ?", 10000, 1001);
                return;  // 成功，直接返回
            } catch (DataAccessException e) {
                if (isDeadlockException(e) && i < maxRetries - 1) {
                    // 死锁异常，随机等待后重试
                    try {
                        Thread.sleep(new Random().nextInt(1000));
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                    }
                } else {
                    throw e;  // 非死锁异常或已达最大重试次数
                }
            }
        }
    }
}
```

## 锁的查看与诊断

```sql
-- 查看当前锁等待链
SELECT
    l.session_id AS blocked_session,
    l.locked_obj_id,
    l.lock_type,
    w.session_id AS waiting_session,
    w.blocking_session
FROM V$LOCK l
JOIN V$LOCK_WAITS w ON w.lock_id = l.lock_id;

-- 查看具体会话持有的锁
SELECT
    s.sid,
    s.serial#,
    o.object_name,
    l.locked_mode
FROM V$SESSION s
JOIN V$LOCKED_OBJECT l ON s.sid = l.session_id
JOIN USER_OBJECTS o ON l.object_id = o.object_id;

-- 杀掉持有锁的会话（谨慎使用）
ALTER SYSTEM KILL SESSION 'sid, serial#';
```

## 锁优化建议

### 1. 减少事务时长

```java
// 错误做法：事务中做耗时操作
public void wrongApproach() {
    jdbcTemplate.execute("BEGIN");
    jdbcTemplate.update("UPDATE account SET balance = balance - 1000 WHERE id = 1");
    // 业务逻辑耗时 10 秒
    doSomeBusinessLogic();  // 锁被长时间持有
    jdbcTemplate.update("UPDATE account SET balance = balance + 1000 WHERE id = 2");
    jdbcTemplate.execute("COMMIT");
}

// 正确做法：业务逻辑移到事务外
public void rightApproach() {
    // 事务只包含数据库操作
    jdbcTemplate.execute("BEGIN");
    jdbcTemplate.update("UPDATE account SET balance = balance - 1000 WHERE id = 1");
    jdbcTemplate.update("UPDATE account SET balance = balance + 1000 WHERE id = 2");
    jdbcTemplate.execute("COMMIT");

    // 业务逻辑在事务外执行
    doSomeBusinessLogic();  // 不影响锁的持有时长
}
```

### 2. 按固定顺序访问资源

多个事务访问多个资源时，按相同顺序加锁可避免死锁。

```java
// 错误：不同事务按不同顺序访问
// T1: lock(A) -> lock(B)
// T2: lock(B) -> lock(A)  -- 可能死锁

// 正确：统一顺序
public void transferInOrder(Long fromId, Long toId, BigDecimal amount) {
    // 始终按 ID 大小顺序加锁
    Long firstId = fromId.compareTo(toId) < 0 ? fromId : toId;
    Long secondId = fromId.compareTo(toId) < 0 ? toId : fromId;

    jdbcTemplate.update("UPDATE account SET balance = balance - ? WHERE id = ?", amount, firstId);
    jdbcTemplate.update("UPDATE account SET balance = balance + ? WHERE id = ?", amount, secondId);
}
```

### 3. 使用低隔离级别

在允许的场景下使用较低的隔离级别，减少锁竞争。

## 面试追问方向

- 什么情况下会升级为表锁？
- 意向锁的作用是什么？为什么需要它？
- 如何排查生产环境的死锁问题？

---

## 一句话总结

锁是双刃剑：用得好，保证数据安全；用不好，制造性能灾难。记住，锁的持有时间要短，访问顺序要统一，粒度要恰到好处。
