# Oracle 事务机制：ACID 的 Oracle 实现

你有没有遇到过这种情况：

两个用户同时下单，库存扣减了两次。

系统崩溃后，数据不知道该回滚还是提交。

明明只是查数据，却把表锁住了。

这些问题的答案，都在事务里。

今天，深入理解 Oracle 的事务机制。

---

## 事务是什么？

事务是数据库中一组逻辑工作单元，要么全部成功，要么全部失败。

```sql
-- 开启事务
BEGIN;

-- 转账操作
UPDATE accounts SET balance = balance - 1000 WHERE account_id = 1;  -- 转出
UPDATE accounts SET balance = balance + 1000 WHERE account_id = 2;  -- 转入

-- 提交
COMMIT;
-- 或回滚
-- ROLLBACK;
```

### ACID 四大特性

| 特性 | 说明 | Oracle 实现 |
|-----|------|------------|
| Atomicity（原子性） | 事务要么全做，要么全不做 | UNDO 日志 |
| Consistency（一致性） | 事务前后数据保持一致 | 约束、触发器 |
| Isolation（隔离性） | 并发事务互不干扰 | 锁、MVCC |
| Durability（持久性） | 提交后数据永久保存 | REDO 日志 |

---

## 事务控制语句

### COMMIT 与 ROLLBACK

```sql
-- 显式提交
COMMIT;

-- 显式回滚
ROLLBACK;

-- 设置保存点
SAVEPOINT sp1;

-- 回滚到保存点
ROLLBACK TO sp1;

-- 回滚整个事务
ROLLBACK;
```

### 隐式提交与回滚

```sql
-- 导致隐式提交的操作
COMMIT;
-- DDL 语句（CREATE、ALTER、DROP）
-- DCL 语句（GRANT、REVOKE）
-- 正常退出 SQL*Plus

-- 导致隐式回滚的操作
-- 异常退出 SQL*Plus
-- 实例崩溃
-- 执行 ROLLBACK 后
```

### 保存点示例

```sql
BEGIN
    INSERT INTO orders (...) VALUES (...);
    SAVEPOINT order_inserted;
    
    INSERT INTO order_items (...) VALUES (...);
    SAVEPOINT item_inserted;
    
    -- 假设这里出错
    UPDATE inventory SET stock = stock - 1 WHERE ...;  -- 失败！
    
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK TO item_inserted;  -- 回滚到 item_inserted
        -- order_inserted 保留
        DBMS_OUTPUT.PUT_LINE('订单项插入失败，但订单已保留');
END;
/
```

---

## UNDO 日志与回滚

### UNDO 的作用

Oracle 使用 UNDO 表空间存储回滚信息：

1. **事务回滚**：撤销未提交事务的修改
2. **读一致性**：保证查询看到一致的数据
3. **实例恢复**：用于回滚实例崩溃时未提交的事务

```sql
-- 查看 UNDO 表空间使用情况
SELECT tablespace_name, status, sum(bytes)/1024/1024 AS size_mb
FROM dba_undo_extents
GROUP BY tablespace_name, status;
```

### UNDO 的工作原理

```
事务 T1 开始：
    UPDATE employees SET salary = 15000 WHERE employee_id = 100;
    
    修改前：salary = 10000
    修改后：salary = 15000
    
    UNDO 记录：{ employee_id=100, salary=10000 }
    
    修改后：salary = 15000（数据文件）

事务 T2 查询：
    SELECT salary FROM employees WHERE employee_id = 100;
    -- T2 看到的是 15000（已提交数据）

事务 T1 回滚：
    ROLLBACK;
    
    从 UNDO 读取：{ employee_id=100, salary=10000 }
    恢复数据：salary = 10000
```

### UNDO 与读一致性

```sql
-- 会话 1：开启事务
SQL1> UPDATE employees SET salary = 15000 WHERE employee_id = 100;
SQL1> COMMIT;

-- 会话 2：开启事务（在会话 1 提交前）
SQL2> SELECT salary FROM employees WHERE employee_id = 100;
-- 如果会话 1 未提交，看到的是旧数据（10000）
-- Oracle 通过 UNDO 提供读一致性
```

---

## REDO 日志与恢复

### REDO 的作用

REDO 日志记录所有修改操作，用于：

1. **实例恢复**：重做已提交事务
2. **介质恢复**：恢复数据文件损坏
3. **热备份恢复**：从备份恢复后，应用 REDO 恢复

```sql
-- 查看 REDO 日志
SELECT group#, sequence#, status, bytes/1024/1024 AS size_mb
FROM v$log;

-- 查看归档日志
SELECT sequence#, name, first_time, archived
FROM v$log_history
ORDER BY sequence# DESC
FETCH FIRST 10 ROWS;
```

### REDO 的写入机制

```sql
-- LGWR 将 REDO 日志写入磁盘
-- 事务提交时必须先写 REDO

-- 日志切换触发检查点
ALTER SYSTEM SWITCH LOGFILE;

-- 查看检查点进度
SELECT checkpoint_change# FROM v$database;
```

### REDO vs UNDO

| 特性 | REDO | UNDO |
|-----|------|------|
| 用途 | 重做操作 | 撤销操作 |
| 内容 | 修改后的值 | 修改前的值 |
| 用于 | 恢复已提交事务 | 回滚未提交事务 |
| 持久化 | 必须先写入磁盘才能提交 | 保存在内存（定期写盘） |

---

## 事务的隔离级别

Oracle 支持四种隔离级别：

| 隔离级别 | 说明 | 脏读 | 不可重复读 | 幻读 |
|---------|------|------|-----------|------|
| READ UNCOMMITTED | 未提交读 | 可能 | 可能 | 可能 |
| READ COMMITTED | 已提交读（默认） | 不可能 | 可能 | 可能 |
| REPEATABLE READ | 可重复读 | 不可能 | 不可能 | 可能 |
| SERIALIZABLE | 串行化 | 不可能 | 不可能 | 不可能 |

```sql
-- 设置隔离级别
ALTER SESSION SET ISOLATION_LEVEL = SERIALIZABLE;
ALTER SESSION SET ISOLATION_LEVEL = READ COMMITTED;
```

### READ COMMITTED（默认）

```sql
-- 会话 A
UPDATE employees SET salary = 15000 WHERE employee_id = 100;
-- 不提交

-- 会话 B
SELECT salary FROM employees WHERE employee_id = 100;
-- 看到的是旧数据（10000），因为会话 A 未提交

COMMIT;

SELECT salary FROM employees WHERE employee_id = 100;
-- 现在看到新数据（15000）
```

### SERIALIZABLE

```sql
-- 会话 A
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SELECT salary FROM employees WHERE employee_id = 100;  -- 10000

-- 会话 B
UPDATE employees SET salary = 15000 WHERE employee_id = 100;
COMMIT;

-- 会话 A 重新查询
SELECT salary FROM employees WHERE employee_id = 100;
-- 仍然看到 10000（事务开始时的快照）

UPDATE employees SET salary = 12000 WHERE employee_id = 100;
-- ORA-08177: 不能序列化访问此事务
```

---

## 事务与锁

### 行级锁

Oracle 使用行级锁，最大限度支持并发：

```sql
-- 会话 1：锁定行
UPDATE employees SET salary = 15000 WHERE employee_id = 100;
-- 只锁定 employee_id=100 的行

-- 会话 2：可以修改其他行
UPDATE employees SET salary = 12000 WHERE employee_id = 101;  -- OK

-- 会话 2：尝试修改同一行
UPDATE employees SET salary = 16000 WHERE employee_id = 100;
-- 等待会话 1 释放锁
```

### 查看锁

```sql
-- 查看当前锁
SELECT 
    l.session_id,
    l.locked_mode,
    l.locked_mode_desc,
    o.object_name,
    l.lock_type
FROM v$locked_object l
JOIN dba_objects o ON l.object_id = o.object_id;

-- 查看锁等待
SELECT 
    w.session_id AS waiting_session,
    w.lock_type,
    w.mode_held,
    w.mode_requested,
    w.lock_id1,
    w.lock_id2,
    b.session_id AS blocking_session
FROM v$session_wait w
JOIN v$session b ON w.blocking_session = b.sid;

-- 查看锁详细信息
SELECT * FROM v$lock WHERE TYPE IN ('TX', 'TM');
```

### 死锁

Oracle 自动检测和处理死锁：

```sql
-- 会话 1
UPDATE employees SET salary = 15000 WHERE employee_id = 100;  -- 锁定 100
UPDATE employees SET salary = 12000 WHERE employee_id = 200;  -- 等待 200

-- 会话 2
UPDATE employees SET salary = 11000 WHERE employee_id = 200;  -- 锁定 200
UPDATE employees SET salary = 16000 WHERE employee_id = 100;  -- 死锁！

-- ORA-00060: 检测到死锁
-- Oracle 自动回滚其中一个事务
```

---

## 长事务处理

### 长事务的风险

| 风险 | 说明 |
|-----|------|
| UNDO 表空间 | 长时间不提交，UNDO 可能不够 |
| 并发冲突 | 其他事务可能长时间等待 |
| 资源占用 | 持有锁的时间过长 |

### 处理建议

```sql
-- 定期提交，释放资源
BEGIN
    FOR rec IN (SELECT * FROM employees WHERE status = 'PENDING')
    LOOP
        -- 处理每条记录
        UPDATE employees SET status = 'PROCESSED' WHERE employee_id = rec.employee_id;
        
        -- 每 1000 条提交一次
        IF MOD(rec.employee_id, 1000) = 0 THEN
            COMMIT;
        END IF;
    END LOOP;
    
    COMMIT;
END;
/
```

### UNDO 表空间配置

```sql
-- 查看 UNDO 配置
SHOW PARAMETER UNDO;

-- 设置 UNDO 表空间
CREATE UNDO TABLESPACE undotbs2
DATAFILE '/u01/oradata/orcl/undotbs02.dbf'
SIZE 10G
AUTOEXTEND ON;

ALTER SYSTEM SET undo_tablespace = undotbs2;

-- 设置保留时间
ALTER TABLESPACE undotbs1 RETENTION GUARANTEE;
```

---

## 面试高频问题

### Q1: COMMIT 和 ROLLBACK 的区别？

COMMIT 提交事务，永久保存所有修改；ROLLBACK 回滚事务，撤销所有未提交的修改。

### Q2: Oracle 的读一致性是如何实现的？

Oracle 通过 UNDO 日志实现读一致性。每个查询都看到事务开始时的数据快照，通过 UNDO 恢复旧值，保证查询期间数据不变。

### Q3: 什么是死锁？Oracle 如何处理？

两个或多个事务相互等待对方持有的锁，形成循环等待。Oracle 自动检测死锁并回滚其中一个事务，打破循环。

### Q4: REDO 和 UNDO 的区别？

REDO 记录修改后的值，用于恢复已提交事务；UNDO 记录修改前的值，用于回滚未提交事务。事务提交必须先写 REDO，确保持久性。

---

## 总结

事务是 Oracle 数据一致性的基石：

| 组件 | 作用 |
|-----|------|
| UNDO | 回滚未提交事务，提供读一致性 |
| REDO | 恢复已提交事务，保证持久性 |
| 锁 | 控制并发访问，保证隔离性 |
| 约束 | 保证数据一致性 |

正确使用事务，是写出健壮应用的基础。

---

## 下一步

- [Oracle 锁机制](/database/oracle/lock)：细粒度锁与并发控制
- [Oracle 隔离级别](/database/oracle/isolation)：隔离级别的实现
