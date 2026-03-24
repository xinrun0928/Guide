# SQL Server 乐观并发与行版本控制

你的系统用乐观锁还是悲观锁？

很多人会说：「我们用版本号！」

但版本号只是乐观锁的一种实现方式。真正的乐观并发控制，远不止「加个 version 字段」这么简单。

这篇文章，带你深入理解 SQL Server 的乐观并发机制，以及它与悲观并发的对比。

---

## 乐观锁 vs 悲观锁

### 悲观锁（Pesimistic Locking）

**核心思想**：「冲突一定会发生」，所以在读取时就加锁。

```sql
-- 悲观锁示例：SELECT FOR UPDATE
SELECT * FROM Orders WITH (UPDLOCK)
WHERE order_id = 1001;

-- 或者使用 SERIALIZABLE 隔离级别
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
BEGIN TRAN
SELECT * FROM Orders WHERE order_id = 1001;
UPDATE Orders SET status = 'shipped' WHERE order_id = 1001;
COMMIT
```

**特点**：
- 读取时锁定，防止其他事务修改
- 冲突在实际更新时不会发生
- 写-写冲突通过锁等待解决
- 并发度较低，但一致性高

### 乐观锁（Optimistic Locking）

**核心思想**：「冲突很少发生」，所以只在更新时检查冲突。

```sql
-- 乐观锁示例：版本号检查
-- 读取时获取版本号
SELECT order_id, status, version FROM Orders WHERE order_id = 1001;
-- 返回：order_id=1001, status='pending', version=5

-- 更新时检查版本号
UPDATE Orders 
SET status = 'shipped', version = version + 1
WHERE order_id = 1001 AND version = 5;
-- 影响行数 = 1：成功
-- 影响行数 = 0：版本不匹配，有冲突
```

**特点**：
- 读取时不加锁，允许其他事务并发读取
- 更新时检查数据是否被修改
- 冲突在更新时检测
- 并发度高，但如果冲突频繁，代价大

---

## SQL Server 的乐观并发机制

### 机制 1：行版本（Row Versioning）

SQL Server 通过行版本实现乐观并发。

```
┌─────────────────────────────────────────────────────────────┐
│                    行版本原理                               │
│                                                              │
│  修改前：                                                    │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ order_id | status    | version | row_ts               │ │
│  │ 1001     | pending  | 5       | 2024-03-15 10:00    │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                              │
│  事务 A 修改（status → shipped）：                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ order_id | status    | version | row_ts               │ │
│  │ 1001     | pending  | 5       | 2024-03-15 10:00    │ │
│  │ 1001     | shipped  | 6       | 2024-03-15 10:05    │ │
│  │          ↑                              ↑              │ │
│  │      新版本数据                      行版本时间戳        │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                              │
│  旧版本保存在 tempdb 的版本存储区                            │
└─────────────────────────────────────────────────────────────┘
```

### 机制 2：快照隔离（Snapshot Isolation）

```sql
-- 启用快照隔离
ALTER DATABASE MyDB SET ALLOW_SNAPSHOT_ISOLATION ON;

SET TRANSACTION ISOLATION LEVEL SNAPSHOT;

BEGIN TRAN
-- 读取事务开始时的数据版本
SELECT * FROM Orders WHERE order_id = 1001;
-- 即使其他事务修改并提交，只要本事务不结束，看到的仍是旧数据

-- 更新时检查
UPDATE Orders SET status = 'shipped' WHERE order_id = 1001 
    AND status = 'pending';  -- 只更新未修改的行
-- 如果被其他事务修改，此 UPDATE 会失败（行数 = 0）
COMMIT
```

---

## 乐观并发控制实现方式

### 方式 1：版本号字段

```sql
-- 创建表
CREATE TABLE Orders (
    order_id INT PRIMARY KEY,
    customer_id INT,
    status VARCHAR(20),
    version INT DEFAULT 1  -- 版本号字段
);

-- 读取
SELECT order_id, customer_id, status, version 
FROM Orders 
WHERE order_id = 1001;

-- 更新（乐观锁模式）
UPDATE Orders 
SET status = 'shipped', version = version + 1
WHERE order_id = 1001 AND version = @old_version;

-- 检查更新是否成功
IF @@ROWCOUNT = 0
    -- 冲突处理：重新读取，合并，尝试更新
    SELECT 'Conflict detected' AS message;
```

### 方式 2：时间戳（Timestamp）

```sql
-- 创建表
CREATE TABLE Orders (
    order_id INT PRIMARY KEY,
    customer_id INT,
    status VARCHAR(20),
    row_version TIMESTAMP  -- SQL Server 自动维护的时间戳
);

-- 读取
SELECT order_id, customer_id, status, row_version 
FROM Orders 
WHERE order_id = 1001;

-- 更新
UPDATE Orders 
SET status = 'shipped'
WHERE order_id = 1001 
    AND row_version = @old_row_version;

-- 注意：TIMESTAMP 不能在 WHERE 中直接比较，需要用二进制值
DECLARE @old_ts BINARY(8);
SELECT @old_ts = row_version FROM Orders WHERE order_id = 1001;

UPDATE Orders 
SET status = 'shipped'
WHERE order_id = 1001 
    AND row_version = @old_ts;
```

### 方式 3：检查字段（Check Sum / Hash）

```sql
-- 使用检查字段
CREATE TABLE Orders (
    order_id INT PRIMARY KEY,
    customer_id INT,
    status VARCHAR(20),
    row_hash AS CHECKSUM(order_id, customer_id, status) PERSISTED
);

-- 读取
SELECT order_id, customer_id, status, row_hash 
FROM Orders 
WHERE order_id = 1001;

-- 更新
UPDATE Orders 
SET status = 'shipped'
WHERE order_id = 1001 
    AND row_hash = CHECKSUM(1001, @customer_id, 'pending');
```

### 方式 4：原始值比较

```sql
-- 读取所有需要比较的字段
SELECT order_id, customer_id, status, amount 
FROM Orders 
WHERE order_id = 1001;
-- 假设：customer_id=5, status='pending', amount=100

-- 更新
UPDATE Orders 
SET status = 'shipped'
WHERE order_id = 1001 
    AND customer_id = 5 
    AND status = 'pending' 
    AND amount = 100;
```

---

## 冲突处理策略

### 策略 1：重试（Retry）

```java
// Java 伪代码
public void updateOrder(int orderId, String newStatus) {
    int maxRetries = 3;
    int retryCount = 0;
    
    while (retryCount < maxRetries) {
        // 读取当前数据
        Order order = selectOrder(orderId);
        int oldVersion = order.getVersion();
        
        // 尝试更新
        int affected = execute(
            "UPDATE Orders SET status=?, version=version+1 " +
            "WHERE order_id=? AND version=?",
            newStatus, orderId, oldVersion
        );
        
        if (affected == 1) {
            return;  // 成功
        }
        
        retryCount++;
        if (retryCount < maxRetries) {
            // 短暂等待后重试
            Thread.sleep(50);
        }
    }
    
    throw new ConcurrencyException("更新失败，已超过最大重试次数");
}
```

### 策略 2：最后写入胜出（Last-Write-Wins）

```sql
-- 直接更新，不检查版本
UPDATE Orders SET status = 'shipped' WHERE order_id = 1001;
-- 简单但可能导致更新丢失
```

### 策略 3：合并（Merge）

```sql
-- 读取最新数据
DECLARE @current_status VARCHAR(20);
SELECT @current_status = status FROM Orders WHERE order_id = 1001;

-- 根据当前状态决定如何更新
IF @current_status = 'cancelled'
    -- 订单已取消，不能发货
    RAISERROR('订单已取消', 16, 1);
ELSE IF @current_status = 'shipped'
    -- 已发货，忽略
    RETURN;
ELSE
    -- 可以发货
    UPDATE Orders SET status = 'shipped' WHERE order_id = 1001;
```

---

## 行版本存储（TempDB）

### 版本存储区

快照隔离依赖 tempdb 存储行版本。

```
┌─────────────────────────────────────────────────────────────┐
│                 版本存储区（Version Store）                 │
│                                                              │
│  tempdb 中存储修改前的行版本                                │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Version Store in tempdb                             │ │
│  │                                                     │ │
│  │ ┌───────────────────────────────────────────────┐ │ │
│  │ │ order_id=1001, version=5, status='pending'  │ │ │
│  │ │ order_id=1002, version=3, status='pending'   │ │ │
│  │ │ ...                                           │ │ │
│  │ └───────────────────────────────────────────────┘ │ │
│  │                                                     │ │
│  │ 版本垃圾回收：当没有事务需要时清理                   │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 监控版本存储

```sql
-- 查看版本存储使用
SELECT 
    DB_NAME(database_id) AS DatabaseName,
    database_id,
    user_objects_alloc_page_count * 8 / 1024 AS UserObjSizeMB,
    version_store_reserved_page_count * 8 / 1024 AS VersionStoreSizeMB,
    version_store_used_page_count * 8 / 1024 AS VersionStoreUsedMB,
    version_store_clean_page_count * 8 / 1024 AS VersionStoreCleanMB
FROM sys.dm_db_file_space_usage
WHERE database_id > 4;  -- 排除系统数据库

-- 查看版本存储的活跃事务
SELECT 
    transaction_id,
    session_id,
    transaction_begin_time,
    database_id,
    elapsed_time_seconds,
    version_scan_count
FROM sys.dm_tran_top_version_generators;

-- 查看版本存储等待
SELECT 
    wait_type,
    waiting_tasks_count,
    wait_time_ms
FROM sys.dm_os_wait_stats
WHERE wait_type LIKE 'VERSION%';
```

### 版本存储问题

**问题 1：版本存储膨胀**

```sql
-- 原因：长时间运行的事务导致版本无法清理
-- 解决方案：避免长时间事务

-- 问题 2：版本存储耗尽
-- 原因：大量修改导致 tempdb 满
-- 解决方案：
-- 1. 增加 tempdb 大小
-- 2. 减少长事务
-- 3. 监控版本存储使用
```

---

## RCSI vs 快照隔离

### 对比

| 特性 | READ COMMITTED SNAPSHOT (RCSI) | SNAPSHOT |
|-----|--------------------------------|----------|
| **隔离点** | 语句级 | 事务级 |
| **读取一致** | 语句开始时 | 事务开始时 |
| **更新冲突检测** | ✗ | ✓ |
| **适用场景** | 大多数 OLTP | 需要事务级一致的场景 |

### 示例对比

```sql
-- 场景：事务中两次读取，中间其他事务修改
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

BEGIN TRAN
    SELECT * FROM Orders WHERE order_id = 1001;  -- 读到 pending
                                                   -- 事务 B 修改并提交
    SELECT * FROM Orders WHERE order_id = 1001;  -- 读到 shipped（不同！）
COMMIT

-- SNAPSHOT 隔离级别
SET TRANSACTION ISOLATION LEVEL SNAPSHOT;
ALTER DATABASE MyDB SET ALLOW_SNAPSHOT_ISOLATION ON;

BEGIN TRAN
    SELECT * FROM Orders WHERE order_id = 1001;  -- 读到 pending
                                                   -- 事务 B 修改并提交
    SELECT * FROM Orders WHERE order_id = 1001;  -- 仍读到 pending（事务级一致）
COMMIT
```

---

## 乐观并发的适用场景

### 适合使用乐观并发的场景

| 场景 | 说明 |
|-----|------|
| **冲突概率低** | 读多写少，大部分操作不冲突 |
| **并发要求高** | 需要最大化并发能力 |
| **长事务** | 悲观锁会长时间阻塞其他事务 |
| **分布式系统** | 网络延迟高，悲观锁代价大 |
| **互联网应用** | 高并发，冲突相对较少 |

### 不适合使用乐观并发的场景

| 场景 | 说明 |
|-----|------|
| **冲突概率高** | 频繁冲突导致大量重试 |
| **一致性要求高** | 不能接受任何更新丢失 |
| **实时金融交易** | 必须确保原子性 |
| **复杂合并逻辑** | 重试可能导致业务逻辑错误 |

---

## 实战：实现订单更新

```sql
-- 完整示例：订单状态更新（乐观并发）

CREATE PROCEDURE sp_UpdateOrderStatus
    @order_id INT,
    @expected_status VARCHAR(20),
    @new_status VARCHAR(20),
    @result INT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    
    DECLARE @current_status VARCHAR(20);
    DECLARE @current_version INT;
    
    -- 读取当前状态
    SELECT 
        @current_status = status,
        @current_version = version
    FROM Orders WITH (UPDLOCK, HOLDLOCK)
    WHERE order_id = @order_id;
    
    -- 检查是否存在
    IF @current_status IS NULL
    BEGIN
        SET @result = -1;  -- 订单不存在
        RETURN;
    END
    
    -- 检查状态是否符合预期（乐观并发检查）
    IF @current_status <> @expected_status
    BEGIN
        SET @result = -2;  -- 状态已被其他事务修改
        RETURN;
    END
    
    -- 执行更新
    UPDATE Orders 
    SET status = @new_status, 
        version = version + 1,
        updated_at = GETDATE()
    WHERE order_id = @order_id;
    
    SET @result = @@ROWCOUNT;  -- 1 = 成功
END
```

### 调用示例

```java
// Java 调用
public void shipOrder(int orderId) {
    SqlParameter outParam = new SqlParameter("@result", SqlTypes.INTEGER);
    
    int result = jdbcTemplate.call(new CallableStatementCreator() {
        @Override
        public CallableStatement createCallableStatement(Connection con) {
            CallableStatement cs = con.prepareCall("{call sp_UpdateOrderStatus(?, ?, ?, ?)}");
            cs.setInt(1, orderId);
            cs.setString(2, "pending");
            cs.setString(3, "shipped");
            cs.registerOutParameter(4, Types.INTEGER);
            return cs;
        }
    }, Collections.singletonList(outParam));
    
    switch (result) {
        case 1:
            // 成功
            break;
        case -1:
            throw new OrderNotFoundException("订单不存在");
        case -2:
            // 乐观并发冲突 - 可以重试或提示用户
            throw new ConcurrentModificationException("订单状态已被其他操作修改");
    }
}
```

---

## 面试追问方向

- 乐观锁和悲观锁的区别是什么？各自适用场景？
- SQL Server 如何实现行版本控制？
- RCSI 和 SNAPSHOT 隔离级别的区别是什么？
- 乐观并发冲突如何处理？有哪些策略？
- 版本存储区在哪个数据库？监控命令是什么？
- 什么是更新冲突？在哪种隔离级别下会发生？

---

## 下一步

理解了乐观并发与行版本控制，我们来看 [SQL Server 性能监控：DMV 与扩展事件（XEvent）](/database/sqlserver/dmv)，学习如何监控 SQL Server 性能。
