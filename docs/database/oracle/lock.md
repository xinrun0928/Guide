# Oracle 锁机制：并发控制的艺术

你有没有遇到过这种尴尬：

明明只是查个数据，却把整张表锁了。

更新一条记录，其他用户的查询都在排队。

明明没死锁，系统却卡死了。

Oracle 的锁机制，比你想象的精细得多。

今天，深入理解 Oracle 的锁。

---

## 锁的基本概念

### 什么是锁？

锁是 Oracle 用来控制并发访问的机制，确保数据一致性和完整性。

```
会话 A                      会话 B
   |                           |
   |--- 锁定行 100 ------------>|
   |    (UPDATE)               |
   |                           |
   |                           |--- 读取行 100 ---> 等待
   |                           |
   |<-- 提交事务 ---------------|
   |    (COMMIT)               |
   |                           |
   |                           |-- 读取行 100 ---> 完成
```

### 锁的类型

| 锁类型 | 说明 | 粒度 |
|-------|------|------|
| TX | 事务锁 | 行级 |
| TM | 表级锁 | 表级 |
| Latch | 闩锁 | 内存结构 |
| Mutex | 互斥锁 | 对象级 |

---

## 行级锁（TX 锁）

### 行级锁的工作原理

Oracle 的行级锁是最细粒度的锁，只锁定被修改的行：

```sql
-- 会话 1：锁定单行
UPDATE employees SET salary = 15000 WHERE employee_id = 100;
-- 只锁定 employee_id=100 的行

-- 会话 2：同一行被锁定
UPDATE employees SET salary = 16000 WHERE employee_id = 100;
-- 等待会话 1 释放锁

-- 会话 2：其他行不受影响
UPDATE employees SET salary = 12000 WHERE employee_id = 101;
-- 正常执行，不等待
```

### 查看行级锁

```sql
-- 查看锁持有者
SELECT 
    s.sid,
    s.serial#,
    s.username,
    o.object_name,
    l.locked_mode
FROM v$session s
JOIN v$locked_object l ON s.sid = l.session_id
JOIN dba_objects o ON l.object_id = o.object_id;

-- 查看 TX 锁（事务锁）
SELECT 
    sid,
    type,
    lmode,
    request,
    id1,
    id2
FROM v$lock
WHERE TYPE = 'TX';

-- 查看锁等待关系
SELECT 
    w.sid AS waiting_sid,
    w.id1 AS waiting_id1,
    w.id2 AS waiting_id2,
    b.sid AS blocking_sid,
    b.username AS blocking_user
FROM v$session_wait w
JOIN v$session b ON w.blocking_session = b.sid;
```

### 行级锁的组成

行级锁由两部分组成：

1. **TM 锁（表级意向锁）**：表示表中有行被锁定
2. **TX 锁（事务锁）**：锁定具体的行

```sql
-- 查看 TM 锁
SELECT 
    sid,
    id1 AS object_id,
    lmode,
    request
FROM v$lock
WHERE TYPE = 'TM';

-- 查看 TM 锁模式
SELECT 
    lock_type,
    mode_held,
    mode_requested,
    lock_id1,
    lock_id2
FROM v$lock
WHERE TYPE = 'TM';
```

---

## 表级锁（TM 锁）

### 锁模式

| 模式 | 缩写 | 说明 | 与其他 TM 锁冲突 |
|-----|------|------|-----------------|
| Row Share | RS | 行共享，允许其他事务同时锁定表的不同行 | X, S |
| Row Exclusive | RX | 行排他，允许其他事务锁定其他行 | RS, SRX, S, X |
| Share | S | 共享，阻止其他事务修改表 | RS, RX, SRX, X |
| Share Row Exclusive | SRX | 共享行排他 | RS, RX, S, SRX, X |
| Exclusive | X | 排他，完全阻止其他事务访问 | 全部 |

### 锁模式对照表

```
              RS    RX     S    SRX    X
RS            -     Y      Y      Y     Y
RX            Y     -      Y      Y     Y
S             Y     Y      -      Y     Y
SRX           Y     Y      Y      -     Y
X             Y     Y      Y      Y     -
Y = 冲突（不能同时持有）
- = 不冲突
```

### DML 操作的默认锁

```sql
-- INSERT：获取 RX 锁
INSERT INTO employees VALUES (...);

-- UPDATE：获取 RX 锁
UPDATE employees SET salary = 15000 WHERE employee_id = 100;

-- DELETE：获取 RX 锁
DELETE FROM employees WHERE employee_id = 100;

-- SELECT：不加锁（通过 UNDO 实现读一致性）
SELECT * FROM employees;
```

### 显式锁定

```sql
-- 锁定整张表（行共享）
LOCK TABLE employees IN ROW SHARE MODE;

-- 锁定整张表（排他）
LOCK TABLE employees IN EXCLUSIVE MODE;

-- 锁定表中的行（FOR UPDATE）
SELECT * FROM employees WHERE department_id = 50 FOR UPDATE;
-- 为查询结果加排他锁

-- 锁定并等待（默认）
SELECT * FROM employees WHERE employee_id = 100 FOR UPDATE;

-- 锁定但不等待
SELECT * FROM employees WHERE employee_id = 100 FOR UPDATE NOWAIT;

-- 锁定，等待超时
SELECT * FROM employees WHERE employee_id = 100 FOR UPDATE WAIT 10;
```

### FOR UPDATE 的用法

```sql
-- 锁定查询结果
SELECT * FROM employees WHERE status = 'PENDING' FOR UPDATE;

-- 锁定并排序
SELECT * FROM orders WHERE status = 'PENDING' 
ORDER BY order_date FOR UPDATE;

-- 锁定多表
SELECT o.*, i.* 
FROM orders o
JOIN order_items i ON o.order_id = i.order_id
WHERE o.status = 'PENDING'
FOR UPDATE OF o.status;  -- 只锁定 orders 表

-- Java 中的 FOR UPDATE
String sql = "SELECT * FROM inventory WHERE product_id = ? FOR UPDATE";
try (Connection conn = ds.getConnection();
     PreparedStatement ps = conn.prepareStatement(sql)) {
    ps.setLong(1, productId);
    ResultSet rs = ps.executeQuery();
    if (rs.next()) {
        // 已锁定 product_id 这一行
        int stock = rs.getInt("stock");
        if (stock > 0) {
            updateInventory(productId, stock - 1);
        }
    }
}
```

---

## 闩锁（Latch）

### 什么是闩锁？

闩锁是 Oracle 内部使用的轻量级锁，用于保护内存结构（SGA 等）。

```sql
-- 闩锁争用
SELECT * FROM v$latch WHERE sleeps > 0 ORDER BY sleeps DESC;
```

### 闩锁 vs 锁

| 特性 | Latch | Lock |
|-----|-------|------|
| 持有时间 | 微秒级 | 可长可短 |
| 获取方式 | CPU 原子操作 | 排队 |
| 死锁检测 | 自动重试 | Oracle 检测 |
| 用途 | 保护内存结构 | 保护数据 |
| 可见性 | v$latch | v$lock |

### 闩锁争用诊断

```sql
-- 查看闩锁统计
SELECT name, gets, misses, sleeps, immediate_gets, immediate_misses
FROM v$latch
WHERE sleeps > 0
ORDER BY sleeps DESC;

-- 查看特定闩锁
SELECT * FROM v$latch WHERE name LIKE '%cache buffers%';

-- 查看闩锁等待事件
SELECT event, total_waits, time_waited
FROM v$system_event
WHERE event LIKE '%latch%';
```

---

## 锁与并发

### 并发控制的原则

1. **最小化锁粒度**：优先使用行级锁
2. **缩短持有时间**：尽快提交或回滚
3. **避免死锁**：统一操作顺序
4. **监控锁等待**：及时发现性能问题

### 乐观锁 vs 悲观锁

```sql
-- 悲观锁：先锁定再处理
SELECT * FROM inventory WHERE product_id = 100 FOR UPDATE;
-- 处理业务逻辑
UPDATE inventory SET stock = stock - 1 WHERE product_id = 100;
COMMIT;

-- 乐观锁：通过版本号控制
UPDATE inventory 
SET stock = stock - 1, version = version + 1
WHERE product_id = 100 AND version = :old_version;
-- 如果影响行数为 0，说明版本已变化，需要重试
```

```java
// Java 中的乐观锁实现
public boolean updateInventory(long productId, int quantity, int expectedVersion) {
    String sql = """
        UPDATE inventory 
        SET stock = stock - ?, version = version + 1
        WHERE product_id = ? AND version = ?
        """;
    
    try (PreparedStatement ps = conn.prepareStatement(sql)) {
        ps.setInt(1, quantity);
        ps.setLong(2, productId);
        ps.setInt(3, expectedVersion);
        int rows = ps.executeUpdate();
        return rows > 0;  // 如果为 0，说明版本冲突
    }
}

// 乐观锁冲突重试
public void purchaseWithRetry(long productId, int quantity) {
    int maxRetries = 3;
    int retry = 0;
    
    while (retry < maxRetries) {
        int currentVersion = getCurrentVersion(productId);
        if (updateInventory(productId, quantity, currentVersion)) {
            return;  // 成功
        }
        retry++;
        Thread.sleep(100 * retry);  // 指数退避
    }
    throw new OptimisticLockException("库存更新失败，请重试");
}
```

### 避免锁争用

```sql
-- 方案一：分批处理
DECLARE
    v_batch_size NUMBER := 1000;
    v_offset NUMBER := 0;
    v_processed NUMBER := 0;
BEGIN
    LOOP
        UPDATE orders
        SET status = 'PROCESSED'
        WHERE order_id IN (
            SELECT order_id FROM (
                SELECT order_id FROM orders 
                WHERE status = 'PENDING'
                ORDER BY order_id
            ) WHERE ROWNUM <= v_batch_size
        );
        
        v_processed := SQL%ROWCOUNT;
        COMMIT;
        v_offset := v_offset + v_processed;
        
        EXIT WHEN v_processed = 0;
    END LOOP;
END;
/

-- 方案二：使用序列分片处理
DECLARE
    v_start_id NUMBER;
    v_end_id NUMBER;
BEGIN
    FOR batch IN 1..10 LOOP
        v_start_id := (batch - 1) * 10000 + 1;
        v_end_id := batch * 10000;
        
        UPDATE orders
        SET status = 'ARCHIVED'
        WHERE order_id BETWEEN v_start_id AND v_end_id
          AND status = 'COMPLETED';
        
        COMMIT;
    END LOOP;
END;
/
```

---

## 锁的监控与诊断

### 常用诊断脚本

```sql
-- 1. 查看当前所有锁
SELECT 
    l.session_id,
    s.serial#,
    s.username,
    l.locked_mode,
    o.object_name,
    o.object_type,
    l.lock_type,
    l.id1,
    l.id2
FROM v$lock l
JOIN v$session s ON l.sid = s.sid
JOIN dba_objects o ON l.id1 = o.object_id
WHERE l.block = 1;  -- 阻塞其他会话的锁

-- 2. 查看锁等待链
SELECT 
    w.sid AS waiter_sid,
    w.id1 AS waiter_id1,
    w.id2 AS waiter_id2,
    w.type AS waiter_type,
    b.sid AS blocker_sid,
    b.username AS blocker_user
FROM v$session_wait w
JOIN v$session b ON w.blocking_session = b.sid
WHERE w.sid IN (
    SELECT sid FROM v$session_wait WHERE blocking_session IS NOT NULL
);

-- 3. 查看长时间锁
SELECT 
    s.sid,
    s.serial#,
    s.username,
    s.program,
    s.sql_id,
    s.status,
    TO_CHAR(s.logon_time, 'YYYY-MM-DD HH24:MI:SS') AS logon_time,
    ROUND((SYSDATE - s.logon_time) * 24, 2) AS hours_held
FROM v$session s
WHERE sid IN (
    SELECT DISTINCT sid FROM v$lock WHERE TYPE IN ('TX', 'TM')
)
AND s.status = 'INACTIVE'
ORDER BY s.logon_time;

-- 4. 杀掉阻塞会话
-- ALTER SYSTEM KILL SESSION 'sid,serial#' IMMEDIATE;
ALTER SYSTEM KILL SESSION '145, 23567' IMMEDIATE;
```

---

## 面试高频问题

### Q1: Oracle 的锁粒度是什么？

Oracle 使用行级锁（Row-Level Locking），只锁定被修改的行，最大程度支持并发。只有在特定情况下才会升级为表级锁。

### Q2: FOR UPDATE 和 FOR UPDATE NOWAIT 有什么区别？

FOR UPDATE 会等待获取锁；FOR UPDATE NOWAIT 立即返回，如果锁不可用则报错；FOR UPDATE WAIT n 等待 n 秒后仍未获取锁则报错。

### Q3: 什么是锁升级？为什么 Oracle 不使用？

锁升级是将多个行锁合并为表锁的过程（如某些数据库的做法）。Oracle 不使用锁升级，始终保持行级锁，这意味着更精细的并发控制，但需要更多的锁管理开销。

### Q4: 如何处理长时间持有的锁？

先诊断锁的来源（用户、程序、SQL），如果是正常业务需要，等待用户主动提交；如果是异常阻塞，可以通过 ALTER SYSTEM KILL SESSION 强制终止会话。

---

## 总结

Oracle 的锁机制设计精妙：

| 锁类型 | 粒度 | 用途 | 性能影响 |
|-------|------|------|---------|
| TX 锁 | 行级 | 锁定被修改的行 | 低 |
| TM 锁 | 表级 | 保护表结构 | 低 |
| Latch | 内存 | 保护 SGA 结构 | 低 |
| Mutex | 对象 | 保护库缓存对象 | 极低 |

理解锁机制，是编写高并发应用的基础。

---

## 下一步

- [Oracle 隔离级别](/database/oracle/isolation)：隔离级别的实现
- [Oracle Flashback](/database/oracle/flashback)：闪回查询与恢复
