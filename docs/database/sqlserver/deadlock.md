# SQL Server 死锁产生条件与排查优化

你的系统突然告警：「检测到死锁！」

业务中断 10 秒，部分请求报错。用户抱怨，系统出问题了吗？

死锁是数据库并发控制的「顽疾」。它不像普通阻塞——普通阻塞只是等一等，死锁是「互相等待，永远解不开」。

这篇文章，带你搞懂死锁的原因、排查方法，以及如何预防。

---

## 什么是死锁？

### 死锁的定义

**死锁 = 两个或多个事务互相持有对方需要的锁，形成循环等待**。

```
┌─────────────────────────────────────────────────────────────┐
│                    死锁示意图                               │
│                                                              │
│  事务 A：                                                    │
│  持有锁 1（资源 A）                                          │
│  等待锁 2（资源 B）─────────────────────┐                 │
│                                           ↓                 │
│                                           │                 │
│  事务 B：                                    │                 │
│  持有锁 2（资源 B）                           │                 │
│  等待锁 1（资源 A）──────────────────────────┘                 │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 死锁环：                                                 │ │
│  │ A 持有 A，等待 B                                         │ │
│  │ B 持有 B，等待 A                                         │ │
│  │ 形成环，永远等待                                         │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 死锁 vs 普通阻塞

| 特性 | 普通阻塞 | 死锁 |
|-----|---------|------|
| **等待关系** | 单向 | 循环 |
| **自动解除** | 会（等锁释放） | 不会 |
| **处理方式** | 等待超时 | SQL Server 自动回滚一个事务 |
| **影响** | 局部 | 影响整个系统 |

---

## 死锁的四个必要条件

这四个条件必须**同时满足**，才会发生死锁：

| 条件 | 说明 | 能否破坏 |
|-----|------|---------|
| **互斥条件** | 资源只能被一个事务持有 | ✗（锁的本质） |
| **占有并等待** | 持有资源的同时等待其他资源 | ✓ |
| **不可抢占** | 锁不能被强制释放 | ✗（可回滚解决） |
| **循环等待** | 形成锁等待环 | ✓ |

**预防死锁 = 破坏其中一个或多个条件**。

---

## 死锁的典型场景

### 场景 1：两个表的不同顺序访问

```sql
-- 事务 A                          -- 事务 B
BEGIN TRAN                          BEGIN TRAN
UPDATE Orders ...                    UPDATE Products ...
UPDATE Products ...                  UPDATE Orders ...
-- 持有 Orders 锁，等待 Products     -- 持有 Products 锁，等待 Orders
```

**解决方案**：统一访问顺序。

```sql
-- 两个事务都按相同顺序访问表
-- 先 Orders，再 Products
```

### 场景 2：索引缺失导致锁扩大

```sql
-- 无索引查询
UPDATE Orders SET status = 'shipped' WHERE customer_id = 1001;
-- 可能锁住整个表或大量页（如果 customer_id 无索引）

-- 索引优化
CREATE INDEX IX_Orders_Customer ON Orders(customer_id);
-- 只锁住 customer_id=1001 的行
```

### 场景 3：存储过程中的死锁

```sql
-- 存储过程 A：更新订单 → 更新库存
CREATE PROCEDURE ProcessOrder
AS
BEGIN
    UPDATE Orders SET status='processing' WHERE order_id = @id;
    UPDATE Inventory SET stock = stock - 1 WHERE product_id = @product_id;
END

-- 存储过程 B：更新库存 → 更新订单（不同顺序！）
CREATE PROCEDURE ReserveInventory
AS
BEGIN
    UPDATE Inventory SET stock = stock - 1 WHERE product_id = @product_id;
    UPDATE Orders SET reserved = 1 WHERE order_id = @id;
END

-- 调用：
-- 事务 A 调用 ProcessOrder，先锁 Orders
-- 事务 B 调用 ReserveInventory，先锁 Inventory
-- → 死锁！
```

**解决方案**：使用 `sp_getapplock` 强制排序。

```sql
CREATE PROCEDURE ProcessOrder @id INT, @product_id INT
AS
BEGIN
    DECLARE @lock_result INT;
    
    -- 按固定顺序获取应用锁
    EXEC @lock_result = sp_getapplock 
        @Resource = 'OrderInventory_' + CAST(@id AS VARCHAR), 
        @LockMode = 'Exclusive',
        @LockTimeout = 5000;
    
    IF @lock_result < 0
    BEGIN
        RAISERROR('无法获取锁', 16, 1);
        RETURN;
    END
    
    -- 业务逻辑
    UPDATE Orders SET status='processing' WHERE order_id = @id;
    UPDATE Inventory SET stock = stock - 1 WHERE product_id = @product_id;
    
    EXEC sp_releaseapplock @Resource = 'OrderInventory_' + CAST(@id AS VARCHAR);
END
```

---

## 死锁的排查

### 方法 1：查看错误日志

```sql
-- 查看死锁信息（需要开启跟踪标志 1222）
-- 在 SQL Server Error Log 中会记录死锁 XML

-- 开启详细死锁信息
DBCC TRACEON (1222, 3605, -1);
-- 1222：将死锁信息写入错误日志
-- 3605：将输出写入错误日志

-- 查看当前跟踪标志状态
DBCC TRACESTATUS (1222);
```

### 方法 2：扩展事件（Extended Events）

```sql
-- 创建捕获死锁的扩展事件
CREATE EVENT SESSION [DeadlockMonitor] ON SERVER
ADD EVENT sqlserver.xml_deadlock_report
(
    ACTION
    (
        sqlserver.session_id,
        sqlserver.sql_text,
        sqlserver.tsql_stack
    )
)
ADD TARGET package0.event_file
(
    SET filename = 'C:\XEvents\Deadlock.xel'
)
WITH (STARTUP_STATE = ON);

ALTER EVENT SESSION DeadlockMonitor ON SERVER STATE = START;
```

### 方法 3：Profiler（已过时，不推荐）

```sql
-- 图形化工具查看死锁图
-- SSMS → Tools → SQL Server Profiler（不推荐，性能影响大）
-- 推荐使用 Extended Events
```

### 方法 4：读取死锁图

```sql
-- 读取死锁 XEL 文件
SELECT 
    event_data.value('(event/data[@name="xml_report"])[1]', 'NVARCHAR(MAX)') AS deadlock_xml
FROM sys.fn_xe_file_target_read_file(
    'C:\XEvents\Deadlock*.xel', 
    NULL, NULL, NULL
);
```

---

## 死锁图解读

死锁图是 XML 格式，记录了死锁的详细信息：

```xml
<deadlock>
  <victim-list>
    <victimProcess id="process123" />  <!-- 被回滚的事务 -->
  </victim-list>
  <process-list>
    <process id="process123" ...>
      <executionStack>
        <!-- 正在执行的 SQL -->
      </executionStack>
      <inputbuf>
        UPDATE Orders SET status='shipped' WHERE order_id=1001
      </inputbuf>
    </process>
    <process id="process456" ...>
      <executionStack>
      </executionStack>
      <inputbuf>
        UPDATE Inventory SET stock=stock-1 WHERE product_id=200
      </inputbuf>
    </process>
  </process-list>
  <resource-list>
    <keylock hobtid="72057594038779904" ...>
      <owner-list>
        <owner id="process456" mode="X" />  <!-- 进程 456 持有排他锁 -->
      </owner-list>
      <waiter-list>
        <waiter id="process123" mode="X" />  <!-- 进程 123 等待此锁 -->
      </waiter-list>
    </keylock>
    <keylock hobtid="72057594038779905" ...>
      <owner-list>
        <owner id="process123" mode="X" />
      </owner-list>
      <waiter-list>
        <waiter id="process456" mode="X" />
      </waiter-list>
    </keylock>
  </resource-list>
</deadlock>
```

### 死锁图的关键信息

| 节点 | 说明 |
|-----|------|
| **victim-process** | 被选择回滚的事务（通常回滚代价较小的） |
| **process-list** | 涉及的进程和执行的 SQL |
| **resource-list** | 涉及的资源（锁）和锁的模式 |

---

## 死锁预防策略

### 策略 1：统一访问顺序

```sql
-- 所有事务按相同顺序访问资源
-- 例如：总是先访问 Orders，再访问 Products

-- 事务 A
BEGIN TRAN
    SELECT * FROM Orders WITH (UPDLOCK) WHERE order_id = @id;
    SELECT * FROM Products WITH (UPDLOCK) WHERE product_id = @product_id;
COMMIT

-- 事务 B（相同顺序）
BEGIN TRAN
    SELECT * FROM Orders WITH (UPDLOCK) WHERE order_id = @id;
    SELECT * FROM Products WITH (UPDLOCK) WHERE product_id = @product_id;
COMMIT
```

### 策略 2：减少锁的持有时间

```sql
-- 不好：锁持有时间长
BEGIN TRAN
    SELECT * FROM Orders WHERE order_id = @id;  -- S 锁
    -- 处理复杂业务逻辑（很慢！）
    UPDATE Orders SET status = 'shipped' WHERE order_id = @id;  -- X 锁
COMMIT

-- 好：减少锁持有时间
BEGIN TRAN
    UPDATE Orders SET status = 'processing' WHERE order_id = @id;  -- 直接 X 锁
    -- 业务逻辑处理（完成后才提交）
COMMIT
```

### 策略 3：创建合适的索引

```sql
-- 避免全表扫描导致的锁扩大
CREATE INDEX IX_Orders_Customer ON Orders(customer_id);
CREATE INDEX IX_Products_ProductID ON Products(product_id);

-- 查看锁的使用情况
SELECT 
    request_session_id AS spid,
    DB_NAME(resource_database_id) AS db,
    resource_type AS resource_type,
    resource_description AS resource,
    request_mode AS mode,
    request_status AS status
FROM sys.dm_tran_locks
WHERE resource_database_id = DB_ID('MyDB')
  AND request_session_id > 50;  -- 排除系统会话
```

### 策略 4：使用低隔离级别

```sql
-- 在允许脏读的场景使用 READ UNCOMMITTED
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

SELECT * FROM Orders WHERE customer_id = 1001;
-- 不申请共享锁，避免与其他事务冲突

-- 或使用 RCSI
ALTER DATABASE MyDB SET READ_COMMITTED_SNAPSHOT ON;
```

### 策略 5：使用快照隔离

```sql
-- 启用快照隔离（避免写-写冲突导致的死锁）
ALTER DATABASE MyDB SET ALLOW_SNAPSHOT_ISOLATION ON;

SET TRANSACTION ISOLATION LEVEL SNAPSHOT;

BEGIN TRAN
    -- 快照隔离不锁定读取
    SELECT * FROM Orders WHERE order_id = @id;
    -- 只有 UPDATE 才会检测冲突
    UPDATE Orders SET status = 'shipped' WHERE order_id = @id;
COMMIT
-- 如果数据被其他事务修改，会报更新冲突
```

---

## 死锁监控与告警

### 创建死锁监控作业

```sql
-- 监控死锁并记录到表
CREATE TABLE DeadlockLog (
    ID INT IDENTITY PRIMARY KEY,
    DeadlockDate DATETIME DEFAULT GETDATE(),
    DeadlockXML XML
);

-- 创建作业，定期检查新的死锁
CREATE OR ALTER PROCEDURE usp_MonitorDeadlocks
AS
BEGIN
    INSERT INTO DeadlockLog (DeadlockXML)
    SELECT event_data.value('(event/data[@name="xml_report"])[1]', 'NVARCHAR(MAX)')
    FROM sys.fn_xe_file_target_read_file(
        'C:\XEvents\Deadlock*.xel', NULL, NULL, NULL
    ) WHERE event_data.value('(event/@timestamp)[1]', 'DATETIME2') > DATEADD(HOUR, -1, GETDATE());
END

-- 发送告警
IF EXISTS (SELECT 1 FROM DeadlockLog WHERE DeadlockDate > DATEADD(MINUTE, -5, GETDATE()))
BEGIN
    -- 发送邮件或告警
    EXEC msdb.dbo.sp_send_dbmail 
        @profile_name = 'DBA',
        @recipients = 'dba@company.com',
        @subject = 'Deadlock Alert',
        @body = '检测到死锁，请检查 DeadlockLog 表';
END
```

---

## 常见死锁案例

### 案例 1：主表 + 详情表的死锁

```sql
-- 事务 A：更新主表 → 更新详情表
BEGIN TRAN
    UPDATE Orders SET status='shipped' WHERE order_id=1001;  -- 锁住订单
    UPDATE OrderItems SET shipped=1 WHERE order_id=1001;      -- 锁住详情
COMMIT

-- 事务 B：更新详情表 → 更新主表（相反顺序！）
BEGIN TRAN
    UPDATE OrderItems SET shipped=1 WHERE order_id=1002;
    UPDATE Orders SET status='shipped' WHERE order_id=1002;
COMMIT

-- 如果同时发生：
-- A 锁住订单 1001，等待详情 1001
-- B 锁住详情 1002，等待订单 1002
-- 死锁！

-- 解决方案：使用 SELECT ... WITH (UPDLOCK, HOLDLOCK) 预锁定
BEGIN TRAN
    SELECT * FROM Orders WITH (UPDLOCK, HOLDLOCK) WHERE order_id=1001;
    SELECT * FROM OrderItems WITH (UPDLOCK, HOLDLOCK) WHERE order_id=1001;
    -- 现在可以安全更新，不会死锁
    UPDATE Orders SET status='shipped' WHERE order_id=1001;
    UPDATE OrderItems SET shipped=1 WHERE order_id=1001;
COMMIT
```

---

## 面试追问方向

- 死锁和普通阻塞的区别是什么？
- 死锁的四个必要条件是什么？如何破坏它们？
- 如何排查和定位死锁？
- 死锁图中 `victim-process` 是什么含义？
- 如何预防死锁？有哪些策略？
- 什么时候使用 `UPDLOCK` 提示？

---

## 下一步

理解了死锁，我们来看 [SQL Server 乐观并发与行版本控制](/database/sqlserver/optimistic-concurrency)，学习另一种并发控制方式。
