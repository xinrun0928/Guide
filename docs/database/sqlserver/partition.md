# SQL Server 表分区：分区函数与分区方案

你的订单表有 10 亿行数据，用户查询「本月订单」却要 30 秒。

怎么办？

分区表是解决大表性能问题的利器——它把一张大表「拆分」成多个小表，但对用户和应用程序透明。

但分区表不是万能药。分区键选错了，性能反而更差；分区策略设计不当，维护成本高到离谱。

这篇文章，带你彻底搞懂 SQL Server 分区表的设计和使用。

---

## 分区表的概念

### 什么是分区表？

分区表 = 将一张大表按某种规则「拆分」成多个物理分区，但逻辑上还是一张表。

```
┌─────────────────────────────────────────────────────────────┐
│                    分区表示意图                              │
│                                                              │
│  逻辑上：                                                   │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                    Orders（总表）                   │ │
│  │  order_id | customer_id | order_date | total_amount │ │
│  │  ...      | ...         | ...          | ...       │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                              │
│  物理上：                                                   │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  分区函数定义边界                                     │ │
│  │  < 2024-01-01 │ 2024-01-01 ~ 2024-04-01 │ >= 2024-04-01 │
│  │       │              │                       │           │
│  │       ▼              ▼                       ▼           │
│  │  ┌─────────┐   ┌─────────┐   ┌─────────┐   │           │
│  │  │ 分区 1   │   │ 分区 2   │   │ 分区 3   │   │           │
│  │  │ 2023数据  │   │ 2024Q1  │   │ 2024Q2+ │   │           │
│  │  └─────────┘   └─────────┘   └─────────┘   │           │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 分区表的优势

| 优势 | 说明 |
|-----|------|
| **查询性能** | 只扫描相关分区，而非全表 |
| **并行处理** | 各分区可并行读写 |
| **数据维护** | 可对单个分区进行备份、重建、压缩 |
| **分区裁剪** | 优化器自动跳过不相关分区 |
| **历史数据管理** | 老分区可归档或删除 |

---

## 分区函数与分区方案

### 分区函数（Partition Function）

分区函数 = 定义如何划分数据。

```sql
-- 范围分区函数（按日期）
CREATE PARTITION FUNCTION OrderDatePF (DATETIME)
AS RANGE RIGHT FOR VALUES (
    '2023-01-01',
    '2024-01-01',
    '2025-01-01',
    '2026-01-01'
);
-- 结果：创建 5 个分区
-- 分区 1: < 2023-01-01
-- 分区 2: 2023-01-01 ~ 2024-01-01
-- 分区 3: 2024-01-01 ~ 2025-01-01
-- 分区 4: 2025-01-01 ~ 2026-01-01
-- 分区 5: >= 2026-01-01

-- LEFT vs RIGHT
-- RIGHT：边界值属于右边的分区
-- LEFT：边界值属于左边的分区

-- RIGHT 等价于：
CREATE PARTITION FUNCTION OrderDatePF (DATETIME)
AS RANGE LEFT FOR VALUES (
    '2023-01-01',  -- 边界值，属于分区 1 (<= 边界)
    '2024-01-01',
    '2025-01-01',
    '2026-01-01'
);
-- 分区 1: <= 2023-01-01
-- 分区 2: 2023-01-01 ~ 2024-01-01
```

### 分区方案（Partition Scheme）

分区方案 = 将分区函数映射到文件组。

```sql
-- 创建分区方案
CREATE PARTITION SCHEME OrderDatePS
AS PARTITION OrderDatePF
TO (
    FG_ARCHIVE_2023,    -- 分区 1
    FG_2024_Q1,         -- 分区 2
    FG_2024_Q2,         -- 分区 3
    FG_2024_REST,       -- 分区 4
    FG_CURRENT          -- 分区 5
);
-- 每个分区可以放到不同的文件组（磁盘）
```

### 完整示例

```sql
-- 步骤 1：创建文件组（物理存储）
ALTER DATABASE SalesDB ADD FILEGROUP FG_2023;
ALTER DATABASE SalesDB ADD FILEGROUP FG_2024_Q1;
ALTER DATABASE SalesDB ADD FILEGROUP FG_2024_Q2;
ALTER DATABASE SalesDB ADD FILEGROUP FG_2024_REST;
ALTER DATABASE SalesDB ADD FILEGROUP FG_CURRENT;

-- 步骤 2：添加文件到文件组
ALTER DATABASE SalesDB ADD FILE (
    NAME = 'FG_2023_Data',
    FILENAME = 'D:\Data\FG_2023.ndf',
    SIZE = 1GB,
    FILEGROWTH = 256MB
) TO FILEGROUP FG_2023;
-- ... 其他文件组类似

-- 步骤 3：创建分区函数
CREATE PARTITION FUNCTION OrderDatePF (DATETIME)
AS RANGE RIGHT FOR VALUES ('2024-01-01', '2024-04-01', '2024-07-01');

-- 步骤 4：创建分区方案
CREATE PARTITION SCHEME OrderDatePS
AS PARTITION OrderDatePF
TO (FG_2023, FG_2024_Q1, FG_2024_Q2, FG_2024_REST);

-- 步骤 5：创建分区表
CREATE TABLE Orders
(
    order_id INT NOT NULL,
    customer_id INT NOT NULL,
    order_date DATETIME NOT NULL,
    total_amount DECIMAL(10,2) NOT NULL,
    status TINYINT NOT NULL,
    created_at DATETIME DEFAULT GETDATE()
)
ON OrderDatePS(order_date);  -- 指定分区列
-- 注意：分区列必须是主键的一部分（如果表有主键）
```

---

## 分区表的使用

### 查询分区表

```sql
-- 普通查询（自动分区裁剪）
SELECT * FROM Orders WHERE order_date = '2024-02-15';
-- 优化器自动只扫描分区 2

-- 查看分区信息
SELECT 
    OBJECT_NAME(p.object_id) AS TableName,
    i.name AS IndexName,
    p.partition_number AS PartitionNum,
    p.rows AS RowCount,
    p.data_compression_desc AS Compression,
    fg.name AS FileGroupName,
    v.value AS BoundaryValue
FROM sys.partitions p
JOIN sys.indexes i ON p.object_id = i.object_id AND p.index_id = i.index_id
JOIN sys.partition_schemes ps ON i.data_space_id = ps.data_space_id
JOIN sys.partition_functions pf ON ps.function_id = pf.function_id
LEFT JOIN sys.partition_range_values v ON pf.function_id = v.function_id 
    AND p.partition_number = v.boundary_id + 1
JOIN sys.filegroups fg ON p.data_space_id = fg.data_space_id
WHERE p.object_id = OBJECT_ID('Orders')
ORDER BY p.partition_number;
```

### 强制使用特定分区

```sql
-- 使用查询提示强制分区裁剪
SELECT * FROM Orders WITH (FORCESEEK)
WHERE order_date = '2024-02-15'
OPTION (FAST 1);
```

### DML 操作与分区

```sql
-- INSERT：自动根据分区列路由
INSERT INTO Orders VALUES (1, 100, '2024-02-15', 100.00, 1);

-- DELETE：删除单个分区
ALTER TABLE Orders DROP PARTITION p1;  -- 删除分区 1

-- SWITCH：快速移动分区（用于归档）
-- 将历史分区切换到归档表
ALTER TABLE Orders SWITCH PARTITION 1 TO Orders_Archive PARTITION 1;

-- TRUNCATE：按分区清空
ALTER TABLE Orders TRUNCATE PARTITIONS 1, 2, 3;
```

---

## 分区表索引

### 分区对齐

分区表的索引默认与表分区对齐。

```sql
-- 创建与分区对齐的聚集索引（必须使用分区方案）
CREATE CLUSTERED INDEX IX_Orders_Date 
ON Orders(order_date)
ON OrderDatePS(order_date);  -- 使用分区方案

-- 创建非对齐索引（不推荐）
CREATE NONCLUSTERED INDEX IX_Orders_Customer
ON Orders(customer_id)
ON FG_CURRENT;  -- 强制放到一个文件组

-- 建议：非聚集索引也使用分区方案
CREATE NONCLUSTERED INDEX IX_Orders_Customer
ON Orders(customer_id)
ON OrderDatePS(order_date);  -- 与分区表对齐
```

### 索引对分区裁剪的影响

```sql
-- 好的设计：查询条件包含分区键
SELECT * FROM Orders 
WHERE order_date >= '2024-01-01' 
  AND order_date < '2024-02-01'
  AND customer_id = 1001;
-- 分区裁剪 + 索引查找

-- 不好的设计：查询条件不包含分区键
SELECT * FROM Orders WHERE customer_id = 1001;
-- 只能扫描所有分区
```

---

## 分区表的设计原则

### 分区键选择

| 场景 | 推荐分区键 | 原因 |
|------|-----------|------|
| **时间序列数据** | 日期列 | 范围查询、按时间归档 |
| **多租户应用** | tenant_id | 隔离租户数据 |
| **大表+小表关联** | 主表分区键 | 分区对齐优化连接 |

### 分区数与大小

```sql
-- 每个分区的理想大小：1-10 GB
-- 分区数不宜过多（管理成本）
-- 建议：20-100 个分区

-- 分区太少的例子（500GB 分为 2 个分区）
-- 问题：分区仍太大，维护困难

-- 分区太多的例子（1GB 分为 1000 个分区）
-- 问题：元数据开销大，分区裁剪收益不明显
```

### 滑动窗口技术

滑动窗口 = 定期滚动添加新分区、移除旧分区。

```sql
-- 场景：保留最近 3 年的订单数据

-- 1. 每月添加新分区
ALTER DATABASE SalesDB ADD FILEGROUP FG_2024_08;
ALTER PARTITION SCHEME OrderDatePS NEXT USED FG_2024_08;
ALTER PARTITION FUNCTION OrderDatePF() SPLIT RANGE ('2024-08-01');

-- 2. 归档旧分区（SWITCH + 备份）
ALTER TABLE Orders SWITCH PARTITION 1 TO Orders_Archive PARTITION 1;
BACKUP DATABASE SalesDB ...;
DROP TABLE Orders_Archive;

-- 3. 删除最旧分区
ALTER PARTITION FUNCTION OrderDatePF() MERGE RANGE ('2023-01-01');
```

---

## 分区表的维护

### 查看分区信息

```sql
-- 查看分区函数
SELECT 
    name AS PartitionFunction,
    type_desc AS Type,
    fanout AS PartitionCount
FROM sys.partition_functions;

-- 查看分区方案
SELECT 
    ps.name AS PartitionScheme,
    pf.name AS PartitionFunction,
    fg.name AS FileGroupName,
    fg.data_space_id
FROM sys.partition_schemes ps
JOIN sys.destination_data_spaces dds ON ps.data_space_id = dds.partition_scheme_id
JOIN sys.filegroups fg ON dds.data_space_id = fg.data_space_id;

-- 查看分区统计
SELECT 
    OBJECT_NAME(object_id) AS TableName,
    index_id,
    partition_number,
    row_count AS RowCount,
    used_page_count * 8 / 1024 AS UsedSizeMB,
    reserved_page_count * 8 / 1024 AS ReservedSizeMB
FROM sys.dm_db_partition_stats
WHERE object_id = OBJECT_ID('Orders')
ORDER BY partition_number;
```

### 分区维护操作

```sql
-- 重建单个分区（减少碎片）
ALTER INDEX IX_Orders_Date ON Orders 
REBUILD PARTITION = 5;

-- 合并分区（减少分区数）
ALTER PARTITION FUNCTION OrderDatePF() 
MERGE RANGE ('2024-01-01');
-- 将分区 1 和 2 合并

-- 拆分分区（增加分区数）
ALTER PARTITION FUNCTION OrderDatePF() 
SPLIT RANGE ('2024-05-01');
-- 在分区中间插入新的边界
```

---

## 分区表与性能

### 分区裁剪示例

```sql
-- 表 Orders 有 10 亿行，按月分区（36 个月）

-- 查询 1：单月数据
SELECT * FROM Orders WHERE order_date = '2024-03-15';
-- 优化器只扫描 1 个分区
-- 扫描行数：约 3000 万行

-- 查询 2：全年数据
SELECT * FROM Orders WHERE YEAR(order_date) = 2024;
-- 优化器扫描 12 个分区
-- 扫描行数：约 3.6 亿行

-- 查询 3：不带日期条件
SELECT * FROM Orders WHERE customer_id = 1001;
-- 优化器必须扫描所有分区
-- 扫描行数：约 10 亿行
```

### 分区消除（Partition Elimination）

```sql
-- 查看执行计划中的分区消除信息
-- 在执行计划中搜索：
-- "Partitioned" - 表示使用了分区
-- "Partition Count" - 使用的分区数
-- "Partition Columns" - 分区列

-- 强制分区消除
SELECT * FROM Orders WITH (FORCESEEK)
WHERE order_date >= '2024-01-01'
  AND order_date < '2024-02-01'
OPTION (MAXDOP 1);
```

---

## 面试追问方向

- 什么是分区表？分区函数和分区方案的区别是什么？
- 什么是分区裁剪（Partition Elimination）？什么情况下会生效？
- 分区键如何选择？有哪些常见选择？
- 什么是滑动窗口技术？如何实现？
- 分区表有哪些维护操作？
- 分区表索引和非分区表索引有什么区别？

---

## 下一步

理解了分区表，我们来看 [SQL Server 内存优化表（In-Memory OLTP）](/database/sqlserver/in-memory)，学习内存计算技术。
