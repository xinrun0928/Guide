# SQL Server 内存优化表（In-Memory OLTP）

你的系统要求百万级并发，订单处理要求毫秒级延迟。

普通磁盘数据库已经力不从心。

In-Memory OLTP（代号 Hekaton）是 SQL Server 的内存计算引擎——数据完全驻留在内存中，代码编译执行，消除锁和闩锁，实现极致性能。

但天下没有免费的午餐。In-Memory OLTP 有诸多限制，不是所有场景都适合。

这篇文章，带你全面了解内存优化表的设计和使用。

---

## In-Memory OLTP 概述

### 什么是 In-Memory OLTP？

In-Memory OLTP = 将热数据完全放在内存中，配合无锁算法，实现极高的事务处理能力。

```
┌─────────────────────────────────────────────────────────────┐
│              传统磁盘表 vs 内存优化表                        │
│                                                              │
│  传统磁盘表：                                               │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  内存（Buffer Pool）                                 │ │
│  │  ┌───────────────────────────────────────────────┐ │ │
│  │  │  热数据缓存                                    │ │ │
│  │  └───────────────────────────────────────────────┘ │ │
│  │                                                      │ │
│  │  磁盘                                              │ │
│  │  ┌───────────────────────────────────────────────┐ │ │
│  │  │  冷数据（磁盘）                                │ │ │
│  │  │  索引（B-Tree）                                │ │ │
│  │  └───────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────┘ │
│  特点：热数据在内存，访问需检查、可能缺页                   │
│                                                              │
│  内存优化表：                                               │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  内存（内存优化池）                                   │ │
│  │  ┌───────────────────────────────────────────────┐ │ │
│  │  │  全部数据（内存中）                            │ │ │
│  │  │  索引（哈希/非聚集）                          │ │ │
│  │  │  代码（编译存储过程）                         │ │ │
│  │  └───────────────────────────────────────────────┘ │ │
│  │                                                      │ │
│  │  磁盘（Checkpoint 文件）                           │ │
│  │  ┌───────────────────────────────────────────────┐ │ │
│  │  │  数据持久化（异步）                            │ │ │
│  │  │  恢复用                                        │ │ │
│  │  └───────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────┘ │
│  特点：全部在内存，无磁盘 I/O，极速访问                     │
└─────────────────────────────────────────────────────────────┘
```

### 性能优势

| 特性 | 传统磁盘表 | 内存优化表 |
|-----|-----------|-----------|
| **访问方式** | 缓冲池 + 磁盘 I/O | 直接内存访问 |
| **并发控制** | 锁 + 闩锁 | 无锁算法（多版本） |
| **索引类型** | B-Tree | 哈希 + 非聚集 |
| **事务隔离** | 锁隔离级别 | 乐观并发 + 快照隔离 |
| **性能提升** | 基准 | 10-100 倍 |

### 适用场景

| 场景 | 说明 |
|-----|------|
| **高频写入** | 交易处理、日志记录 |
| **低延迟要求** | 游戏、实时报价 |
| **高并发访问** | Web 应用、API |
| **会话/状态存储** | 用户会话、购物车 |
| **ETL 暂存** | 数据加载中间表 |

---

## 内存优化池（Memory-Optimized Pool）

### 创建内存优化文件组

```sql
-- 步骤 1：添加内存优化文件组
ALTER DATABASE InMemDB ADD FILEGROUP MOFD CONTAINS MEMORY_OPTIMIZED_DATA;
-- 必须至少有一个内存优化文件组

-- 步骤 2：添加内存优化数据文件
ALTER DATABASE InMemDB ADD FILE (
    NAME = 'MOFD_File1',
    FILENAME = 'D:\Data\MOFD_File1',
    SIZE = 1GB,
    MAXSIZE = 100GB,
    FILEGROWTH = 256MB
) TO FILEGROUP MOFD;
-- 建议：多个文件分散到不同磁盘，提高并发
```

### 配置内存

```sql
-- 查看 In-Memory 内存使用
SELECT 
    dopc.instance_name AS PoolName,
    dopc.cntr_value AS CurrentMemoryKB,
    dopc2.cntr_value AS MaxMemoryKB,
    CAST(dopc.cntr_value * 100.0 / NULLIF(dopc2.cntr_value, 0) AS DECIMAL(10,2)) AS UsedPercent
FROM sys.dm_os_performance_counters dopc
JOIN sys.dm_os_performance_counters dopc2 
    ON dopc.instance_name = dopc2.instance_name
WHERE dopc.counter_name = 'Memory Used (KB)'
  AND dopc2.counter_name = 'Max Memory (KB)';

-- 配置内存限制
-- Resource Governor 控制 In-Memory OLTP 内存
CREATE RESOURCE POOL Pool_MemOpt
WITH (MIN_PERCENT = 0, MAX_PERCENT = 50);
-- 限制内存优化表最多使用 50% 的 max server memory

ALTER RESOURCE GOVERNOR RECONFIGURE;
```

---

## 创建内存优化表

### 基本语法

```sql
CREATE TABLE Orders_MemOpt
(
    order_id INT NOT NULL,
    customer_id INT NOT NULL,
    order_date DATETIME2 NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    status TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME2 DEFAULT GETDATE(),
    CONSTRAINT PK_Orders_MemOpt PRIMARY KEY NONCLUSTERED (order_id)
)
WITH (MEMORY_OPTIMIZED = ON, DURABILITY = SCHEMA_AND_DATA);
```

### 持久化选项

| 选项 | 说明 | 适用场景 |
|-----|------|---------|
| **SCHEMA_AND_DATA** | 架构和数据都持久化 | 生产环境 |
| **SCHEMA_ONLY** | 只持久化架构，不持久化数据 | 临时表、会话状态 |

```sql
-- 临时表推荐使用 SCHEMA_ONLY
CREATE TABLE #TempOrders (
    order_id INT NOT NULL PRIMARY KEY NONCLUSTERED,
    total_amount DECIMAL(10,2)
)
WITH (MEMORY_OPTIMIZED = ON, DURABILITY = SCHEMA_ONLY);
```

### 索引设计

内存优化表只支持两种索引：

| 索引类型 | 说明 | 适用场景 |
|--------|------|---------|
| **哈希索引** | 精确匹配查找 | 等值查询（WHERE id = ?）|
| **非聚集索引** | 范围查找 | 范围查询、排序 |

```sql
CREATE TABLE Orders_MemOpt
(
    order_id INT NOT NULL,
    customer_id INT NOT NULL,
    order_date DATETIME2 NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    -- 主键必须是 NONCLUSTERED
    CONSTRAINT PK_Orders PRIMARY KEY NONCLUSTERED (order_id),
    -- 哈希索引：精确匹配
    INDEX ix_customer HASH (customer_id) WITH (BUCKET_COUNT = 100000),
    -- 非聚集索引：范围查询
    INDEX ix_order_date NONCLUSTERED (order_date),
    INDEX ix_customer_date NONCLUSTERED (customer_id, order_date)
)
WITH (MEMORY_OPTIMIZED = ON, DURABILITY = SCHEMA_AND_DATA);
```

### 哈希索引详解

```sql
-- 哈希索引 = 固定数量的桶 + 哈希函数

-- BUCKET_COUNT 选择：
-- 原则：Bucket 数 = 预估唯一键数 × 1-2
-- 如果 Bucket 数太小 → 哈希冲突 → 性能下降
-- 如果 Bucket 数太大 → 内存浪费

-- 估算示例：
-- customer_id 预计 1000 万个唯一值
-- BUCKET_COUNT = 10000000 × 2 = 20000000
INDEX ix_customer HASH (customer_id) WITH (BUCKET_COUNT = 20000000)

-- 查看哈希索引统计
SELECT 
    OBJECT_NAME(h.object_id) AS TableName,
    i.name AS IndexName,
    h.total_bucket_count,
    h.empty_bucket_count,
    CAST(100.0 * h.empty_bucket_count / NULLIF(h.total_bucket_count, 0) AS DECIMAL(10,2)) AS EmptyBucketPercent,
    h.avg_chain_length,
    h.max_chain_length
FROM sys.dm_db_xtp_hash_index_stats h
JOIN sys.indexes i ON h.object_id = i.object_id AND h.index_id = i.index_id
WHERE h.object_id = OBJECT_ID('Orders_MemOpt');
```

### 支持的数据类型

| 支持 | 不支持 |
|-----|-------|
| INT, BIGINT, SMALLINT, TINYINT | text, ntext, image |
| VARCHAR, NVARCHAR, CHAR | varchar(max), nvarchar(max) |
| DATETIME, DATETIME2, DATE, TIME | timestamp |
| DECIMAL, NUMERIC, MONEY | sql_variant |
| BIT, UNIQUEIDENTIFIER | xml |
| FLOAT, REAL | 用户定义类型 |

---

## 编译存储过程

### 本机编译存储过程

本机编译存储过程 = 编译成机器码，直接在内存中执行，无解释开销。

```sql
CREATE PROCEDURE sp_InsertOrder
    @order_id INT,
    @customer_id INT,
    @order_date DATETIME2,
    @total_amount DECIMAL(10,2)
WITH NATIVE_COMPILATION, SCHEMABINDING
AS
BEGIN ATOMIC
    WITH (TRANSACTION ISOLATION LEVEL = SNAPSHOT, LANGUAGE = N'English')
    
    INSERT INTO dbo.Orders_MemOpt 
        (order_id, customer_id, order_date, total_amount)
    VALUES 
        (@order_id, @customer_id, @order_date, @total_amount);
END
```

### 本机编译的限制

| 限制 | 说明 |
|-----|------|
| **语言** | 只能是 T-SQL 块 |
| **事务** | ATOMIC 块 |
| **不支持** | 动态 SQL、游标、GOTO |
| **约束** | 仅 CHECK 和主键 |

### 调用本机编译过程

```sql
-- 调用本机编译存储过程
EXEC sp_InsertOrder 
    @order_id = 1,
    @customer_id = 1001,
    @order_date = '2024-03-15',
    @total_amount = 100.00;
```

---

## 并发控制

### 无锁并发

内存优化表使用**多版本乐观并发控制**，不使用锁。

```
┌─────────────────────────────────────────────────────────────┐
│                  内存优化表并发控制                          │
│                                                              │
│  传统磁盘表：                                               │
│  事务 A ──→ 锁 ──→ 等待事务 B ──→ 死锁？                   │
│                                                              │
│  内存优化表：                                               │
│  事务 A ──→ 读取版本 1 ──→ 写入版本 2 ──→ 验证            │
│  事务 B ──→ 读取版本 1 ──→ 写入版本 3 ──→ 验证（冲突！）  │
│                                                              │
│  冲突检测：比较写入时的版本和读取时的版本                    │
└─────────────────────────────────────────────────────────────┘
```

### 事务隔离级别

| 隔离级别 | 支持 | 说明 |
|---------|------|------|
| **SNAPSHOT** | ✓ | 推荐，与内存优化表最配 |
| **REPEATABLE READ** | ✗ | 不支持 |
| **SERIALIZABLE** | ✗ | 不支持 |
| **READ COMMITTED** | ✓ | 默认 |

```sql
-- 显式使用快照隔离
SET TRANSACTION ISOLATION LEVEL SNAPSHOT;

BEGIN TRANSACTION
    SELECT * FROM Orders_MemOpt WHERE customer_id = 1001;
    -- 读取版本1
    UPDATE Orders_MemOpt SET total_amount = 200 WHERE order_id = 1;
    -- 验证版本1未被修改，失败则回滚
COMMIT
```

---

## 数据恢复

### 恢复过程

```
┌─────────────────────────────────────────────────────────────┐
│                  内存优化表数据恢复                          │
│                                                              │
│  启动 SQL Server：                                          │
│  1. 读取 Checkpoint 文件 → 恢复数据到内存                    │
│  2. 重放日志 → 恢复到最新状态                               │
│  3. 表上线                                                  │
│                                                              │
│  恢复时间取决于：                                            │
│  - 数据量大小                                               │
│  - 日志量大小                                               │
│  - 磁盘 I/O 速度                                            │
└─────────────────────────────────────────────────────────────┘
```

### 检查点文件

```sql
-- 查看检查点文件
SELECT 
    state_desc,
    file_type_desc,
    file_size_in_bytes / 1024 / 1024 AS SizeMB,
    file_size_used_in_bytes / 1024 / 1024 AS UsedMB
FROM sys.dm_db_xtp_checkpoint_files
WHERE database_id = DB_ID();

-- 状态说明：
-- ACTIVE：正在使用
-- CONSTRUCTED：已构造
-- CHECKPOINT：已检查点
-- TOMBSTONE：已删除
```

---

## 与磁盘表对比

```sql
-- 性能对比测试
-- 磁盘表
CREATE TABLE Orders_Disk (
    order_id INT PRIMARY KEY,
    customer_id INT,
    order_date DATETIME2,
    total_amount DECIMAL(10,2)
);
CREATE NONCLUSTERED INDEX IX ON Orders_Disk(customer_id);

-- 内存优化表
CREATE TABLE Orders_MemOpt (
    order_id INT PRIMARY KEY NONCLUSTERED,
    customer_id INT,
    order_date DATETIME2,
    total_amount DECIMAL(10,2),
    INDEX ix_customer HASH (customer_id) WITH (BUCKET_COUNT = 100000)
)
WITH (MEMORY_OPTIMIZED = ON, DURABILITY = SCHEMA_AND_DATA);

-- 基准测试（SQL Server 提供的工具）
-- 或使用 ostress.exe / sqlslap.exe 进行压力测试
```

---

## 监控与诊断

```sql
-- 查看内存使用
SELECT 
    OBJECT_NAME(object_id) AS TableName,
    memory_allocated_for_table_kb / 1024 AS TableAllocatedMB,
    memory_used_by_table_kb / 1024 AS TableUsedMB,
    memory_allocated_for_indexes_kb / 1024 AS IndexAllocatedMB,
    memory_used_by_indexes_kb / 1024 AS IndexUsedMB
FROM sys.dm_db_xtp_table_memory_stats
WHERE object_id > 0
ORDER BY TableAllocatedMB DESC;

-- 查看索引统计
SELECT 
    OBJECT_NAME(object_id) AS TableName,
    index_id,
    total_bucket_count,
    empty_bucket_count,
    avg_chain_length,
    max_chain_length
FROM sys.dm_db_xtp_hash_index_stats;

-- 查看扫描统计
SELECT 
    OBJECT_NAME(object_id) AS TableName,
    index_id,
    scan_count,
    rows_scanned_total,
    rows_expired_total,
    rows_expired_scanned_total
FROM sys.dm_db_xtp_index_operational_stats
WHERE object_id = OBJECT_ID('Orders_MemOpt');
```

---

## 迁移策略

### 何时迁移

| 适合迁移 | 不适合迁移 |
|---------|-----------|
| 高频访问的热点数据 | 很少访问的历史数据 |
| 低延迟要求 | 需要全文搜索 |
| 高并发写入 | 需要外键约束 |
| 会话/状态数据 | 需要 text/image 类型 |

### 迁移步骤

```sql
-- 1. 创建内存优化表（SCHEMA_AND_DATA）
CREATE TABLE Orders_MemOpt LIKE Orders
WITH (MEMORY_OPTIMIZED = ON, DURABILITY = SCHEMA_AND_DATA);

-- 2. 迁移数据
INSERT INTO Orders_MemOpt
SELECT * FROM Orders;

-- 3. 重命名切换
EXEC sp_rename 'Orders', 'Orders_Disk';
EXEC sp_rename 'Orders_MemOpt', 'Orders';

-- 4. 调整应用程序连接字符串（如果需要）
```

---

## 面试追问方向

- 什么是 In-Memory OLTP？和传统磁盘表有什么区别？
- 内存优化表支持哪些索引类型？哈希索引如何选择 BUCKET_COUNT？
- 内存优化表如何保证数据持久化？
- 什么是本机编译存储过程？有什么限制？
- 内存优化表使用什么并发控制机制？支持哪些隔离级别？
- 内存优化表的恢复过程是怎样的？

---

## 下一步

理解了 In-Memory OLTP，我们来看 [SQL Server 列存储索引与批处理模式](/database/sqlserver/columnstore)，学习分析型查询的优化技术。
