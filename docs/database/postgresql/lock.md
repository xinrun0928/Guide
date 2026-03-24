# PostgreSQL 锁机制：表级锁、行级锁、死锁检测

当你执行一条 UPDATE 语句时，PostgreSQL 内部发生了什么？

锁是怎么获取的？会阻塞其他操作吗？

死锁是怎么检测和解决的？

今天，我们来深入理解 PostgreSQL 的锁机制。

## PostgreSQL 锁模型

PostgreSQL 使用多粒度锁，允许多种锁模式共存：

```
┌─────────────────────────────────────────────────────┐
│                   表级锁                             │
│  ┌─────────────────────────────────────────────┐  │
│  │               行级锁                          │  │
│  │  ┌───────────────────────────────────────┐  │  │
│  │  │         页面锁（内部使用）               │  │  │
│  │  └───────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 锁模式表

| 锁模式 | 简写 | 允许的并发操作 | 被阻塞的操作 |
|--------|------|---------------|-------------|
| ACCESS SHARE | AS | 并发读 | ACCESS EXCLUSIVE |
| ROW SHARE | RS | 并发读 | EXCLUSIVE, ACCESS EXCLUSIVE |
| ROW EXCLUSIVE | RE | 并发更新 | SHARE, SHARE ROW EXCLUSIVE, EXCLUSIVE, ACCESS EXCLUSIVE |
| SHARE UPDATE EXCLUSIVE | SUE | 并发查询和更新 | ACCESS EXCLUSIVE |
| SHARE | S | 并发读 | ROW EXCLUSIVE, SHARE UPDATE EXCLUSIVE, EXCLUSIVE, ACCESS EXCLUSIVE |
| SHARE ROW EXCLUSIVE | SRE | 只能一个事务执行 | 所有写锁 |
| EXCLUSIVE | X | 只能读 | 所有写锁和 ROW SHARE |
| ACCESS EXCLUSIVE | AX | 独占 | 所有锁 |

## 表级锁

### 获取表级锁的场景

```sql
-- SELECT 默认获取 ACCESS SHARE 锁
SELECT * FROM orders;

-- UPDATE/DELETE/INSERT 获取 ROW EXCLUSIVE 锁
UPDATE orders SET status = 'shipped' WHERE id = 1;

-- ALTER TABLE 获取 ACCESS EXCLUSIVE 锁
ALTER TABLE orders ADD COLUMN notes TEXT;  -- 阻塞所有读写

-- CREATE INDEX 获取 SHARE UPDATE EXCLUSIVE 锁
CREATE INDEX idx_orders_status ON orders(status);  -- 不阻塞读写

-- CREATE INDEX CONCURRENTLY 获取 ACCESS EXCLUSIVE 锁（不阻塞）
CREATE INDEX CONCURRENTLY idx_orders_status ON orders(status);
```

### 查看表级锁

```sql
-- 查看当前持有的表锁
SELECT 
    l.locktype,
    l.relation::REGCLASS,
    l.mode,
    l.granted,
    l.pid,
    a.usename,
    a.query
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE l.locktype = 'relation'
AND l.relation IS NOT NULL
ORDER BY l.granted DESC, l.pid;

-- 查看锁等待
SELECT 
    l.pid,
    l.locktype,
    l.mode,
    l.relation::REGCLASS,
    l.granted,
    a.query
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE NOT l.granted;
```

## 行级锁

### 行锁模式

| 锁模式 | 获取方式 | 冲突 | 说明 |
|--------|---------|------|------|
| FOR UPDATE | SELECT ... FOR UPDATE | FOR UPDATE, FOR NO KEY UPDATE, FOR SHARE, FOR KEY SHARE | 排他锁，防止其他事务修改或读取 |
| FOR NO KEY UPDATE | UPDATE（不是 key 更新） | FOR UPDATE, FOR NO KEY UPDATE, FOR SHARE, FOR KEY SHARE | 比 FOR UPDATE 弱，允许多个 KEY SHARE |
| FOR SHARE | SELECT ... FOR SHARE | FOR UPDATE, FOR NO KEY UPDATE | 共享锁，允许多个事务同时持有 |
| FOR KEY SHARE | SELECT ... FOR KEY SHARE | FOR UPDATE, FOR NO KEY UPDATE | 最弱的行锁，允许多个 KEY SHARE |

### 行锁示例

```sql
-- 会话 1
BEGIN;
SELECT * FROM orders WHERE id = 1 FOR UPDATE;
-- 获取了 id=1 行的排他锁

-- 会话 2
BEGIN;
SELECT * FROM orders WHERE id = 1 FOR UPDATE;
-- 等待...（被阻塞）

-- 会话 3
BEGIN;
SELECT * FROM orders WHERE id = 1 FOR SHARE;
-- 等待...（被 FOR UPDATE 阻塞）
```

### 锁等待超时

```sql
-- 设置锁等待超时（毫秒）
SET lock_timeout = '3s';

-- 或者设置语句超时
SET statement_timeout = '10s';
```

## Advisory Lock（咨询锁）

PostgreSQL 特有的锁机制，用于应用层面的锁控制：

```sql
-- 获取会话级咨询锁
SELECT pg_advisory_lock(12345);  -- 锁定 key=12345
SELECT pg_advisory_lock(1, 2);  -- 锁定复合 key

-- 释放
SELECT pg_advisory_unlock(12345);

-- 获取事务级咨询锁（自动释放）
SELECT pg_advisory_xact_lock(12345);  -- 事务结束时自动释放

-- 尝试获取（非阻塞）
SELECT pg_try_advisory_lock(12345);
-- 返回 true/false
```

### 实际应用

```java
// Java 中使用咨询锁实现乐观锁
public void processOrder(Long orderId) {
    // 尝试获取咨询锁
    Boolean acquired = jdbcTemplate.queryForObject(
        "SELECT pg_try_advisory_lock(?)", 
        Boolean.class, 
        orderId
    );
    
    if (!acquired) {
        throw new RuntimeException("无法获取锁，请稍后重试");
    }
    
    try {
        // 执行业务逻辑
        doProcess(orderId);
    } finally {
        // 释放锁
        jdbcTemplate.execute("SELECT pg_advisory_unlock(?)", orderId);
    }
}

// 分布式场景：使用复合 key
public void processPayment(Long userId, Long orderId) {
    // 使用两个字段组合作为 key，避免不同类型数据的 key 冲突
    Long combinedKey = (userId << 32) | orderId;
    jdbcTemplate.execute("SELECT pg_advisory_lock(?)", combinedKey);
    // ...
}
```

## 锁升级

PostgreSQL **不进行锁升级**（lock escalation），这是与 MySQL InnoDB 的重要区别：

```
MySQL InnoDB：行锁 → 表锁（锁升级）
- 当行锁数量过多时，自动升级为表锁
- 优点：减少锁开销
- 缺点：降低并发度

PostgreSQL：行锁 → 永远不升级
- 无论多少行被锁定，始终保持行级锁
- 优点：高并发
- 缺点：锁数量可能很大（但 PostgreSQL 优化得很好）
```

## 死锁检测

### 死锁是如何发生的？

```sql
-- 场景：两个事务交叉锁定资源

-- 事务 T1
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;  -- 锁定 id=1
-- 此时 T1 持有 id=1 的排他锁

-- 事务 T2（在另一个会话）
BEGIN;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;  -- 锁定 id=2
-- T2 持有 id=2 的排他锁

-- 继续 T1
UPDATE accounts SET balance = balance + 100 WHERE id = 2;  -- 等待 id=2...
-- T1 被阻塞，等待 T2

-- 继续 T2
UPDATE accounts SET balance = balance - 100 WHERE id = 1;  -- 等待 id=1...
-- T2 被阻塞，等待 T1

-- 死锁！
```

### 死锁检测机制

PostgreSQL 自动检测死锁：

```
死锁检测算法（简化）：
1. 维护等待图：谁在等谁的锁
2. 检测环：T1 等待 T2，T2 等待 T1
3. 选择受害者：回滚事务 ID 较小或修改数据较少的事务
4. 通知应用：抛出错误
```

### 死锁处理

```sql
-- 会话 1
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1 FOR UPDATE;
-- 等待...然后收到错误

-- ERROR: deadlock detected
-- DETAIL: Process 12345 waits for ShareLock on transaction 67890; 
--         blocked by process 67891.
-- Process 67891 waits for ShareLock on transaction 67890; 
--         blocked by process 12345.
-- HINT: See server log for query details.
```

### 应用层重试

```java
public void transfer(Long fromAccount, Long toAccount, BigDecimal amount) {
    int maxRetries = 3;
    for (int i = 0; i < maxRetries; i++) {
        try {
            jdbcTemplate.execute("BEGIN");
            
            // 先锁定 from_account
            jdbcTemplate.update(
                "UPDATE accounts SET balance = balance - ? WHERE id = ?",
                amount, fromAccount
            );
            
            // 再锁定 to_account
            jdbcTemplate.update(
                "UPDATE accounts SET balance = balance + ? WHERE id = ?",
                amount, toAccount
            );
            
            jdbcTemplate.execute("COMMIT");
            return;  // 成功
        } catch (DataAccessException e) {
            jdbcTemplate.execute("ROLLBACK");
            
            if (isDeadlockException(e) && i < maxRetries - 1) {
                log.warn("Deadlock detected, retrying... attempt {}", i + 1);
                try {
                    Thread.sleep(100 * (i + 1));  // 指数退避
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new RuntimeException("Interrupted", ie);
                }
                continue;
            }
            throw e;  // 超过重试次数或其他错误
        }
    }
}

private boolean isDeadlockException(Exception e) {
    String message = e.getMessage();
    return message != null && message.contains("deadlock detected");
}
```

### 预防死锁

最佳实践：按照固定顺序访问资源：

```java
// 好的做法：按 ID 顺序锁定
public void transfer(Long fromAccount, Long toAccount, BigDecimal amount) {
    Long firstId = Math.min(fromAccount, toAccount);
    Long secondId = Math.max(fromAccount, toAccount);
    
    // 始终先锁定 ID 较小的
    if (firstId.equals(fromAccount)) {
        // from -> to
        jdbcTemplate.update("UPDATE accounts SET balance = balance - ? WHERE id = ?", amount, firstId);
        jdbcTemplate.update("UPDATE accounts SET balance = balance + ? WHERE id = ?", amount, secondId);
    } else {
        // to -> from
        jdbcTemplate.update("UPDATE accounts SET balance = balance - ? WHERE id = ?", amount, firstId);
        jdbcTemplate.update("UPDATE accounts SET balance = balance + ? WHERE id = ?", amount, secondId);
    }
}
```

## 锁监控

```sql
-- 查看所有锁的等待情况
SELECT 
    l.locktype,
    l.relation::REGCLASS,
    l.mode,
    l.pid,
    a.usename,
    a.query,
    a.query_start,
    CASE WHEN l.granted THEN 'granted' ELSE 'waiting' END AS status
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY l.granted, a.query_start;

-- 查看锁持有时间
SELECT 
    pid,
    mode,
    relation::REGCLASS,
    granted,
    (now() - query_start)::INTERVAL AS hold_time,
    query
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE l.granted
ORDER BY hold_time DESC;

-- 查看最慢的查询（可能持有锁很长时间）
SELECT 
    pid,
    query,
    (now() - query_start)::INTERVAL AS duration
FROM pg_stat_activity
WHERE state = 'active'
AND query_start < NOW() - INTERVAL '5 minutes'
ORDER BY query_start;
```

## 常见问题

### 问题一：查询被阻塞

```sql
-- 查找阻塞者
SELECT 
    blocked.pid AS blocked_pid,
    blocked.query AS blocked_query,
    blocking.pid AS blocking_pid,
    blocking.query AS blocking_query
FROM pg_stat_activity AS blocked
JOIN pg_stat_activity AS blocking
    ON blocked.pid = ANY(pg_blocking_pids(blocking.pid))
WHERE blocked.cardinality(pg_blocking_pids(blocking.pid)) > 0;

-- 或者手动查找
SELECT * FROM pg_stat_activity 
WHERE pid IN (
    SELECT pid FROM pg_locks 
    WHERE NOT granted 
    AND relation IN (
        SELECT relation FROM pg_locks 
        WHERE pid = (SELECT pid FROM pg_stat_activity WHERE state = 'active' LIMIT 1)
    )
);
```

### 问题二：长事务导致锁等待

```sql
-- 查看长事务
SELECT 
    pid,
    xmin,
    xact_start,
    (now() - xact_start)::INTERVAL AS xact_age,
    query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
AND state != 'idle'
AND xact_start < NOW() - INTERVAL '10 minutes';

-- 终止长事务
SELECT pg_terminate_backend(pid) FROM pg_stat_activity 
WHERE xact_start < NOW() - INTERVAL '10 minutes';
```

## 面试高频问题

### Q1: PostgreSQL 有哪些锁类型？

**考察点**：锁机制理解

**参考答案**：
1. 表级锁：ACCESS SHARE, ROW SHARE, ROW EXCLUSIVE, SHARE, SHARE ROW EXCLUSIVE, EXCLUSIVE, ACCESS EXCLUSIVE
2. 行级锁：FOR UPDATE, FOR NO KEY UPDATE, FOR SHARE, FOR KEY SHARE
3. 咨询锁：pg_advisory_lock
4. 页面锁：内部使用

### Q2: PostgreSQL 和 MySQL 的锁机制有什么区别？

**考察点**：数据库对比

**参考答案**：
- PostgreSQL 不进行锁升级（MySQL 会行锁→表锁）
- PostgreSQL 行锁更轻量，支持更多并发
- PostgreSQL 有咨询锁（MySQL 没有）
- PostgreSQL 死锁自动检测，MySQL 类似

### Q3: 如何排查锁等待问题？

**考察点**：问题排查能力

**参考答案**：
1. `pg_stat_activity` 查看活动查询
2. `pg_locks` 查看锁信息
3. `pg_blocking_pids()` 查找阻塞者
4. 识别长事务、慢查询
5. 考虑终止或优化

### Q4: 死锁如何处理？

**考察点**：并发控制

**参考答案**：
1. PostgreSQL 自动检测死锁并回滚一个事务
2. 应用层捕获死锁错误并重试
3. 预防：按固定顺序访问资源
4. 监控：设置 `deadlock_timeout` 和 `log_lock_waits`

## 总结

PostgreSQL 的锁机制：

| 维度 | 说明 |
|------|------|
| 表级锁 | 7 种模式，控制 DDL 和并发访问 |
| 行级锁 | 4 种模式，控制行数据访问 |
| 咨询锁 | 应用层面的锁控制 |
| 锁升级 | PostgreSQL 不进行锁升级 |
| 死锁检测 | 自动检测，自动回滚一个事务 |

理解锁机制，是解决并发问题和性能调优的基础。
