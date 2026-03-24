# Oracle 隔离级别：并发与一致的平衡

你有没有想过：

为什么 MySQL 默认是可重复读，而 Oracle 默认是读已提交？

为什么同一个查询，在事务中执行两次，结果不一样？

为什么有时候查询会卡住，等其他事务提交后才能继续？

这些问题的答案，都在隔离级别里。

今天，深入理解 Oracle 的隔离级别。

---

## 为什么需要隔离级别？

并发与一致性是数据库的两难选择：

- **更高的一致性**：意味着更严格的隔离，并发性下降
- **更高的并发**：意味着更宽松的隔离，可能出现异常

```
    一致性
       ↑
       │      Serializable
       │              ↑
       │         Repeatable Read
       │                ↑
       │            Read Committed
       │                ↑
       │         Read Uncommitted
       └─────────────────────────────→ 并发性
```

### 并发异常类型

| 异常类型 | 说明 | 隔离级别 |
|---------|------|---------|
| 脏读（Dirty Read） | 读取未提交数据 | READ UNCOMMITTED |
| 不可重复读（Non-repeatable Read） | 同一查询结果不同 | READ COMMITTED |
| 幻读（Phantom Read） | 同一查询发现新行 | REPEATABLE READ |
| 串行化异常（Serialization Error） | 更新冲突 | SERIALIZABLE |

---

## Oracle 的隔离级别

Oracle 支持两种标准隔离级别：

| 隔离级别 | Oracle 支持 | 说明 |
|---------|-----------|------|
| READ COMMITTED | 是（默认） | 只读取已提交的数据 |
| SERIALIZABLE | 是 | 事务像串行执行 |

Oracle 不支持 READ UNCOMMITTED 和 REPEATABLE READ。

```sql
-- 查看当前隔离级别
SELECT TRANSACTION_ISOLATION_LEVEL 
FROM v$database;

-- 设置隔离级别
ALTER SESSION SET ISOLATION_LEVEL = READ COMMITTED;
ALTER SESSION SET ISOLATION_LEVEL = SERIALIZABLE;
```

---

## READ COMMITTED（读已提交）

### 默认行为

READ COMMITTED 是 Oracle 的默认隔离级别：

```sql
-- 会话 A
SQL> UPDATE employees SET salary = 15000 WHERE employee_id = 100;
SQL> -- 不提交

-- 会话 B
SQL> SELECT salary FROM employees WHERE employee_id = 100;

SALARY
------
10000        -- 看到的是旧值，因为会话 A 未提交

SQL> COMMIT;  -- 会话 A 提交

SQL> SELECT salary FROM employee WHERE employee_id = 100;

SALARY
------
15000        -- 现在看到新值
```

### 特点

| 特点 | 说明 |
|-----|------|
| 脏读 | 不可能 |
| 不可重复读 | 可能 |
| 幻读 | 可能 |
| 阻塞 | 可能（写写冲突） |

### 每次读取都创建新快照

READ COMMITTED 模式下，每个查询都基于当前已提交的数据创建新快照：

```sql
-- 事务 T1
SELECT salary FROM employees WHERE employee_id = 100;  -- 结果: 10000

-- 事务 T2（另一会话）修改并提交
UPDATE employees SET salary = 15000 WHERE employee_id = 100;
COMMIT;

-- 事务 T1 再次查询
SELECT salary FROM employees WHERE employee_id = 100;  -- 结果: 15000
-- 两次查询结果不同（不可重复读）
```

---

## SERIALIZABLE（串行化）

### 工作原理

SERIALIZABLE 模式下，事务看到的是事务开始时的数据快照：

```sql
-- 会话 A
SQL> SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SQL> SELECT salary FROM employees WHERE employee_id = 100;

SALARY
------
10000        -- 快照时刻的值

-- 会话 B（另一会话）修改并提交
UPDATE employees SET salary = 15000 WHERE employee_id = 100;
COMMIT;

-- 会话 A 再次查询
SELECT salary FROM employees WHERE employee_id = 100;

SALARY
------
10000        -- 仍然是快照的值（不可重复读不会发生）
```

### 串行化冲突

```sql
-- 会话 A
SQL> SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SQL> UPDATE employees SET salary = 12000 WHERE employee_id = 100;
-- 成功，因为没人修改过

-- 会话 B（另一会话）修改并提交
UPDATE employees SET salary = 15000 WHERE employee_id = 100;
COMMIT;

-- 会话 A 尝试更新
SQL> UPDATE employees SET salary = 16000 WHERE employee_id = 100;
-- ORA-08177: 不能序列化访问此事务

-- 解决：必须重新开始事务
ROLLBACK;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SELECT salary FROM employees WHERE employee_id = 100;
UPDATE employees SET salary = 16000 WHERE employee_id = 100;
COMMIT;
```

### 特点

| 特点 | 说明 |
|-----|------|
| 脏读 | 不可能 |
| 不可重复读 | 不可能 |
| 幻读 | 可能（通过 UNDO 链实现） |
| 冲突处理 | ORA-08177 |

---

## READ COMMITTED 的优化

### READ COMMITTED + NOWAIT

```sql
-- 不等待锁
SELECT * FROM employees WHERE employee_id = 100 FOR UPDATE NOWAIT;
-- 如果锁不可用，立即报错 ORA-00054

-- 等待锁
SELECT * FROM employees WHERE employee_id = 100 FOR UPDATE;
-- 等待锁释放
```

### READ COMMITTED + SKIP LOCKED

Oracle 12c+ 支持跳过已锁定的行：

```sql
-- 任务队列处理：跳过已锁定的任务
SELECT * FROM (
    SELECT task_id, task_data
    FROM task_queue
    WHERE status = 'PENDING'
    ORDER BY priority
) WHERE ROWNUM <= 10
FOR UPDATE SKIP LOCKED;

-- 多个会话可以并行处理不同任务
-- 已锁定的任务会被跳过，不会等待
```

```java
// Java 中使用 SKIP LOCKED
String sql = """
    SELECT * FROM (
        SELECT * FROM task_queue
        WHERE status = 'PENDING'
        ORDER BY priority
    ) WHERE ROWNUM <= 10
    FOR UPDATE SKIP LOCKED
    """;

try (Connection conn = ds.getConnection();
     PreparedStatement ps = conn.prepareStatement(sql);
     ResultSet rs = ps.executeQuery()) {
    
    while (rs.next()) {
        processTask(rs.getLong("task_id"), rs.getString("task_data"));
        
        // 完成任务后更新状态
        updateTaskStatus(rs.getLong("task_id"), "COMPLETED");
    }
}
```

---

## SCN（系统改变号）

### SCN 是什么？

Oracle 使用 SCN（System Change Number）标记数据库的时间点：

```sql
-- 查看当前 SCN
SELECT CURRENT_SCN FROM v$database;

-- 根据 SCN 查询历史数据
SELECT * FROM employees AS OF SCN 12345678 WHERE employee_id = 100;

-- 根据时间查询历史数据
SELECT * FROM employees AS OF TIMESTAMP 
    TO_TIMESTAMP('2024-01-15 10:00:00', 'YYYY-MM-DD HH24:MI:SS')
WHERE employee_id = 100;
```

### SCN 与读一致性

```
时间线：
─────────────────────────────────────────────────────────────────►
      │                    │                    │
   SCN 100              SCN 200              SCN 300
   事务T1开始          事务T2提交          事务T3查询

事务T3查询：
- 读取 SCN 200 之后提交的数据
- 不读取事务T2的未提交数据（SCN 200之前）
```

---

## 隔离级别选择指南

### 何时使用 READ COMMITTED？

| 场景 | 原因 |
|-----|------|
| 大多数 OLTP 系统 | 高并发，性能好 |
| 短事务 | 冲突概率低 |
| 并发更新同一行 | 自动等待，不报错 |
| 不确定冲突概率 | 更灵活 |

### 何时使用 SERIALIZABLE？

| 场景 | 原因 |
|-----|------|
| 金融交易 | 需要强一致性 |
| 批量更新 | 冲突时重试整个事务 |
| 报表生成 | 只读，不需要更新 |
| 冲突率低的场景 | 避免 ORA-08177 |

---

## 实战：并发场景分析

### 场景一：库存扣减

```sql
-- 方法一：乐观锁（适合冲突少）
UPDATE inventory 
SET stock = stock - :quantity, version = version + 1
WHERE product_id = :product_id 
  AND version = :expected_version 
  AND stock >= :quantity;

-- 方法二：悲观锁（适合冲突多）
SELECT stock FROM inventory WHERE product_id = :product_id FOR UPDATE;
-- 检查库存
-- 更新库存
UPDATE inventory SET stock = stock - :quantity WHERE product_id = :product_id;
```

```java
// Java 实现
public class InventoryService {
    
    // 乐观锁实现
    public boolean reduceStockOptimistic(long productId, int quantity, int expectedVersion) {
        String sql = """
            UPDATE inventory 
            SET stock = stock - ?, version = version + 1
            WHERE product_id = ? AND version = ? AND stock >= ?
            """;
        
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, quantity);
            ps.setLong(2, productId);
            ps.setInt(3, expectedVersion);
            ps.setInt(4, quantity);
            return ps.executeUpdate() > 0;
        }
    }
    
    // 悲观锁实现
    public boolean reduceStockPessimistic(long productId, int quantity) throws SQLException {
        String lockSql = "SELECT stock FROM inventory WHERE product_id = ? FOR UPDATE";
        String updateSql = "UPDATE inventory SET stock = stock - ? WHERE product_id = ?";
        
        try {
            conn.setAutoCommit(false);
            
            try (PreparedStatement ps = conn.prepareStatement(lockSql)) {
                ps.setLong(1, productId);
                ResultSet rs = ps.executeQuery();
                if (!rs.next() || rs.getInt("stock") < quantity) {
                    conn.rollback();
                    return false;
                }
            }
            
            try (PreparedStatement ps = conn.prepareStatement(updateSql)) {
                ps.setInt(1, quantity);
                ps.setLong(2, productId);
                ps.executeUpdate();
            }
            
            conn.commit();
            return true;
        } catch (SQLException e) {
            conn.rollback();
            throw e;
        }
    }
}
```

### 场景二：订单状态流转

```sql
-- 确保订单状态正确流转
DECLARE
    v_current_status VARCHAR2(20);
BEGIN
    -- 使用 FOR UPDATE 锁定订单
    SELECT status INTO v_current_status
    FROM orders
    WHERE order_id = :order_id
    FOR UPDATE;
    
    -- 状态检查
    IF v_current_status != 'PENDING' THEN
        RAISE_APPLICATION_ERROR(-20001, '订单状态不正确');
    END IF;
    
    -- 更新状态
    UPDATE orders SET status = 'PROCESSED' WHERE order_id = :order_id;
    
    -- 业务处理
    -- ...
    
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        RAISE;
END;
/
```

---

## 面试高频问题

### Q1: Oracle 的默认隔离级别是什么？

Oracle 的默认隔离级别是 READ COMMITTED（读已提交）。

### Q2: READ COMMITTED 和 SERIALIZABLE 的区别？

READ COMMITTED 每次查询都看到最新已提交的数据，可能出现不可重复读；SERIALIZABLE 事务自始至终看到事务开始时的数据快照，不出现不可重复读，但可能出现 ORA-08177 错误。

### Q3: 什么是 SNAPSHOT TOO OLD 错误？

当 UNDO 表空间不足或 UNDO 记录被覆盖时，长时间运行的事务可能无法获取所需的旧版本数据，导致 ORA-01555 错误。解决方案是增大 UNDO 表空间或延长 UNDO 保留时间。

### Q4: 如何避免长事务导致的快照问题？

1. 尽量缩短事务时间
2. 增大 UNDO 表空间
3. 设置 UNDO_RETENTION 参数
4. 使用 SCN 或 TIMESTAMP 限定查询范围

---

## 总结

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | Oracle 支持 |
|---------|------|-----------|------|-----------|
| READ UNCOMMITTED | 可能 | 可能 | 可能 | 不支持 |
| READ COMMITTED | 不可能 | 可能 | 可能 | 支持（默认） |
| REPEATABLE READ | 不可能 | 不可能 | 可能 | 不支持 |
| SERIALIZABLE | 不可能 | 不可能 | 可能 | 支持 |

选择合适的隔离级别，是在并发性能和一致性之间的权衡。

---

## 下一步

- [Oracle Flashback](/database/oracle/flashback)：闪回查询与数据恢复
- [Oracle 事务机制](/database/oracle/transaction)：事务的 ACID 特性
