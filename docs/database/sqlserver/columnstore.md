# SQL Server 列存储索引与批处理模式

你的数据仓库有 10 亿行，分析查询却要几分钟。

这是传统行存储的瓶颈——分析型查询需要扫描大量行，但每次只读几列。

列存储索引是 SQL Server 为分析型工作负载打造的利器。它按列而非按行存储数据，配合批处理模式，可以让聚合查询快 10-100 倍。

这篇文章，带你全面掌握列存储索引。

---

## 列存储 vs 行存储

### 存储方式对比

```
┌─────────────────────────────────────────────────────────────┐
│                    行存储（Rowstore）                       │
│                                                              │
│  Page 1: [Row1全部列][Row2全部列][Row3全部列]              │
│  Page 2: [Row4全部列][Row5全部列][Row6全部列]              │
│                                                              │
│  优点：单行读取快                                           │
│  缺点：读取需要的列时，包含所有列                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   列存储（Columnstore）                     │
│                                                              │
│  Column Group 1:                                            │
│  Page 1: [Col1所有行]                                       │
│  Page 2: [Col1所有行]...                                    │
│                                                              │
│  Column Group 2:                                            │
│  Page 1: [Col2所有行]                                       │
│  Page 2: [Col2所有行]...                                    │
│                                                              │
│  优点：只读取需要的列，数据高度压缩                           │
│  缺点：单行读取需要组装多个列                                 │
└─────────────────────────────────────────────────────────────┘
```

### 列存储的优势

| 特性 | 行存储 | 列存储 |
|-----|--------|-------|
| **读取需要的列** | 读取所有列 | 只读需要的列 |
| **压缩率** | 低 | 高（相似值在一起） |
| **聚合查询** | 慢 | 快 |
| **点查询** | 快 | 慢 |
| **适合场景** | OLTP | OLAP/数据仓库 |

### 压缩原理

```
原始数据：
order_id | customer_id | status
1        | 1001        | 1
2        | 1001        | 1
3        | 1002        | 2
4        | 1001        | 1
5        | 1002        | 1

行存储：每行存储完整数据
[1, 1001, 1][2, 1001, 1][3, 1002, 2][4, 1001, 1][5, 1002, 1]

列存储：每列独立压缩
Column order_id: [1, 2, 3, 4, 5]           → RLE + 位图
Column customer_id: [1001, 1001, 1002, 1001, 1002] → RLE + 位图
Column status: [1, 1, 2, 1, 1]            → RLE + 位图

RLE（行程编码）：连续相同值只存一次+次数
customer_id: [1001×3, 1002×2]

位图索引：每个唯一值用位图表示
customer_id=1001: [1, 1, 0, 1, 0]
customer_id=1002: [0, 0, 1, 0, 1]
```

---

## 列存储索引类型

### 聚集列存储索引（Clustered Columnstore Index）

数据本身以列存储格式存放。

```sql
-- 创建聚集列存储索引
CREATE CLUSTERED COLUMNSTORE INDEX CCI_Orders
ON Orders;
-- 表数据完全以列存储存储
-- 只能有一个聚集列存储索引
```

### 非聚集列存储索引（Nonclustered Columnstore Index）

保留原有行存储表，额外创建列存储索引。

```sql
-- 创建非聚集列存储索引
CREATE COLUMNSTORE INDEX CS_Orders
ON Orders (order_id, customer_id, order_date, total_amount);
-- 行存储和列存储共存
-- SELECT * 可能用列存储
-- UPDATE/DELETE 仍用行存储
```

### 选择哪种？

| 场景 | 推荐类型 |
|-----|---------|
| **纯分析表** | 聚集列存储索引 |
| **混合工作负载** | 非聚集列存储索引 |
| **需要主键约束** | 非聚集列存储索引 |
| **实时写入** | 非聚集列存储索引 |

---

## 创建列存储索引

### 基础语法

```sql
-- 聚集列存储索引（SQL Server 2014+）
CREATE CLUSTERED COLUMNSTORE INDEX CCI_Orders
ON Orders;

-- 非聚集列存储索引（SQL Server 2012+）
CREATE COLUMNSTORE INDEX CS_Orders
ON Orders (customer_id, order_date, total_amount);

-- 包含列（非聚集列存储）
CREATE COLUMNSTORE INDEX CS_Orders2
ON Orders (customer_id, order_date)
INCLUDE (order_id, total_amount);
-- 注意：列存储索引的 INCLUDE 不像 B-Tree 那样工作
```

### 完整示例

```sql
-- 创建列存储优化的表
CREATE TABLE SalesData
(
    sale_id BIGINT IDENTITY(1,1) NOT NULL,
    sale_date DATE NOT NULL,
    customer_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    amount AS quantity * unit_price PERSISTED,
    region VARCHAR(50) NOT NULL,
    year_month AS CAST(FORMAT(sale_date, 'yyyyMM') AS INT) PERSISTED
)
WITH (DATA_COMPRESSION = COLUMNSTORE);

-- 创建聚集列存储索引
CREATE CLUSTERED COLUMNSTORE INDEX CCI_SalesData ON SalesData;

-- 查看列存储状态
SELECT 
    OBJECT_NAME(object_id) AS TableName,
    type_desc,
    state_desc,
    total_rows,
    compressed_rows,
    100.0 * compressed_rows / NULLIF(total_rows, 0) AS CompressionRatio
FROM sys.column_store_row_groups
WHERE object_id = OBJECT_ID('SalesData');
```

---

## 批处理模式（Batch Mode）

### 什么是批处理模式？

批处理模式 = 一次处理一组行（900 行），而非逐行处理。

```
┌─────────────────────────────────────────────────────────────┐
│              Row Mode vs Batch Mode                         │
│                                                              │
│  Row Mode：                                                 │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  行1 → 处理 → 输出                                    │ │
│  │  行2 → 处理 → 输出                                    │ │
│  │  行3 → 处理 → 输出                                    │ │
│  │  ... (逐行处理，每次调用一次函数)                     │ │
│  └─────────────────────────────────────────────────────┘ │
│  CPU 开销：O(n) × 行处理成本                               │
│                                                              │
│  Batch Mode：                                               │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  [行1~行900] → 处理 → 输出                           │ │
│  │  [行901~行1800] → 处理 → 输出                        │ │
│  │  [行1801~行2700] → 处理 → 输出                       │ │
│  │  ... (批处理，SIMD 优化)                             │ │
│  └─────────────────────────────────────────────────────┘ │
│  CPU 开销：O(n/900) × 批处理成本                          │
│  减少 90% 函数调用，使用 SIMD 指令集                       │
└─────────────────────────────────────────────────────────────┘
```

### 批处理模式的触发条件

| 条件 | 说明 |
|-----|------|
| **列存储索引** | 聚集或非聚集列存储 |
| **多核 CPU** | 自动向量化 |
| **大数据量** | 通常 > 10000 行 |

### 查看执行模式

```sql
-- 在 SSMS 执行计划中查看
-- 右键操作符 → 属性 → Execution Mode
-- Row Mode = 逐行
-- Batch Mode = 批处理

-- 查看哪些查询使用了批处理
SELECT 
    SUBSTRING(qt.text, (qs.statement_start_offset/2)+1, ...) AS QueryText,
    qs.execution_count,
    CASE 
        WHEN CHARINDEX('Batch', qp.query_plan) > 0 THEN 'Batch Mode'
        ELSE 'Row Mode'
    END AS ExecutionMode
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
ORDER BY qs.total_worker_time DESC;
```

---

## 列存储索引维护

### 行组状态

```
┌─────────────────────────────────────────────────────────────┐
│                    行组（Row Group）                         │
│                                                              │
│  列存储索引将数据分成行组（Row Group）：                    │
│  每个行组约 100 万行（压缩前）                              │
│                                                              │
│  行组状态：                                                 │
│  - OPEN：正在加载数据                                       │
│  - COMPRESSED：已压缩存储                                   │
│  - TOMBSTONE：标记删除，等待垃圾回收                         │
│  -元数据（DELETED）：已删除                                 │
└─────────────────────────────────────────────────────────────┘
```

### 监控行组

```sql
-- 查看行组状态
SELECT 
    OBJECT_NAME(object_id) AS TableName,
    index_id,
    row_group_id,
    state_desc,
    total_rows,
    deleted_rows,
    size_in_bytes / 1024 / 1024 AS SizeMB,
    100.0 * deleted_rows / NULLIF(total_rows, 0) AS DeletedPercent
FROM sys.column_store_row_groups
WHERE object_id = OBJECT_ID('SalesData')
ORDER BY row_group_id;

-- 优化目标：
-- COMPRESSED 行组：deleted_rows 应尽量少
-- OPEN 行组：应该被定期压缩
-- DELETED 行组：已压缩的删除行
```

### 压缩行组

```sql
-- 手动压缩（如果有大比例删除）
ALTER INDEX CCI_SalesData ON SalesData REORGANIZE;

-- 重建索引（更彻底）
ALTER INDEX CCI_SalesData ON SalesData REBUILD;

-- 查看碎片
SELECT 
    OBJECT_NAME(object_id) AS TableName,
    avg_fragmentation_in_percent,
    fragment_count,
    avg_page_space_used_in_percent
FROM sys.dm_db_index_physical_stats
(
    DB_ID(), 
    OBJECT_ID('SalesData'),
    NULL, NULL, 'DETAILED'
)
WHERE index_id = 1;
```

---

## 列存储与分区

### 分区 + 列存储

```sql
-- 创建分区列存储表
CREATE TABLE SalesData
(
    sale_id BIGINT IDENTITY(1,1) NOT NULL,
    sale_date DATE NOT NULL,
    customer_id INT NOT NULL,
    product_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL
)
ON SaleDatePS(sale_date);  -- 分区方案

-- 创建列存储索引
CREATE CLUSTERED COLUMNSTORE INDEX CCI_SalesData
ON SalesData
ON SaleDatePS(sale_date);  -- 与分区对齐

-- 每个分区有独立的行组
-- 可以对单个分区进行压缩/重建
```

### 分区维护

```sql
-- 查看每个分区的行组
SELECT 
    OBJECT_NAME(object_id) AS TableName,
    p.partition_number AS PartitionNum,
    SUM(total_rows) AS TotalRows,
    SUM(CASE WHEN state_desc = 'COMPRESSED' THEN 1 ELSE 0 END) AS CompressedRowGroups,
    SUM(CASE WHEN state_desc = 'OPEN' THEN 1 ELSE 0 END) AS OpenRowGroups
FROM sys.column_store_row_groups r
JOIN sys.partitions p ON r.object_id = p.object_id AND r.index_id = p.index_id
WHERE OBJECT_NAME(object_id) = 'SalesData'
GROUP BY p.partition_number
ORDER BY p.partition_number;

-- 压缩单个分区
ALTER INDEX CCI_SalesData ON SalesData
REORGANIZE PARTITION = 5;
```

---

## 列存储与数据加载

### 批量加载

```sql
-- 批量插入触发列存储压缩
BULK INSERT SalesData FROM 'C:\Data\sales.csv';

-- 分批加载时监控行组
-- 如果 OPEN 行组过多，需要手动压缩
WHILE 1 = 1
BEGIN
    -- 检查 OPEN 行组
    IF NOT EXISTS (
        SELECT 1 FROM sys.column_store_row_groups
        WHERE object_id = OBJECT_ID('SalesData') 
          AND state_desc = 'OPEN'
    )
        BREAK;
    
    -- 等待数据加载
    WAITFOR DELAY '00:01:00';
    
    -- 压缩
    ALTER INDEX CCI_SalesData ON SalesData REORGANIZE;
END
```

### 增量加载

```sql
-- 使用分区切换加载新数据
-- 1. 创建临时表
CREATE TABLE SalesData_Staging
(
    sale_id BIGINT,
    sale_date DATE,
    customer_id INT,
    product_id INT,
    amount DECIMAL(10,2)
)
WITH (HEAP);

CREATE COLUMNSTORE INDEX CS_Staging ON SalesData_Staging;

-- 2. 加载数据到临时表
BULK INSERT SalesData_Staging FROM 'C:\Data\new_sales.csv';

-- 3. 切换分区
ALTER TABLE SalesData_Staging SWITCH TO SalesData PARTITION 10;

-- 4. 压缩新分区
ALTER INDEX CCI_SalesData ON SalesData REORGANIZE PARTITION = 10;
```

---

## 列存储与实时分析

### 实时操作（SQL Server 2016+）

```sql
-- 创建支持实时操作的列存储表
CREATE TABLE SalesData_Realtime
(
    sale_id BIGINT IDENTITY(1,1) NOT NULL,
    sale_date DATE NOT NULL,
    customer_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    INDEX CCI CLUSTERED COLUMNSTORE
    WITH (DATA_COMPRESSION = COLUMNSTORE ON (PARTITIONS (1 TO 100)))
);

-- 添加可更新的非聚集列存储
ALTER TABLE SalesData_Realtime
ADD INDEX CS_SalesData
NONCLUSTERED COLUMNSTORE
ON (sale_date, customer_id, amount);
-- 非聚集列存储实时更新
```

### 约束支持

```sql
-- 聚集列存储索引（SQL Server 2017+）支持约束
CREATE TABLE SalesData
(
    sale_id BIGINT NOT NULL,
    sale_date DATE NOT NULL,
    customer_id INT NOT NULL,
    CONSTRAINT PK_SalesData PRIMARY KEY NONCLUSTERED (sale_id),
    CONSTRAINT CK_SalesData_Date CHECK (sale_date >= '2000-01-01')
)
WITH (DATA_COMPRESSION = COLUMNSTORE);

CREATE CLUSTERED COLUMNSTORE INDEX CCI ON SalesData;
```

---

## 性能对比

### 测试对比

```sql
-- 创建测试表
CREATE TABLE Orders_Rowstore (
    order_id BIGINT,
    order_date DATETIME,
    customer_id INT,
    total_amount DECIMAL(10,2)
);
CREATE CLUSTERED INDEX IX ON Orders_Rowstore(order_id);
CREATE NONCLUSTERED INDEX IX2 ON Orders_Rowstore(order_date);

CREATE TABLE Orders_Columnstore (
    order_id BIGINT,
    order_date DATETIME,
    customer_id INT,
    total_amount DECIMAL(10,2)
);
CREATE CLUSTERED COLUMNSTORE INDEX CCI ON Orders_Columnstore;

-- 加载 1000 万行测试数据
-- ...

-- 分析查询对比
SET STATISTICS IO ON;
SET STATISTICS TIME ON;

-- 行存储查询
SELECT 
    YEAR(order_date) AS year,
    MONTH(order_date) AS month,
    SUM(total_amount) AS total,
    COUNT(*) AS order_count
FROM Orders_Rowstore
GROUP BY YEAR(order_date), MONTH(order_date)
ORDER BY year, month;

-- 列存储查询
SELECT 
    YEAR(order_date) AS year,
    MONTH(order_date) AS month,
    SUM(total_amount) AS total,
    COUNT(*) AS order_count
FROM Orders_Columnstore
GROUP BY YEAR(order_date), MONTH(order_date)
ORDER BY year, month;
```

---

## 面试追问方向

- 列存储索引和行存储索引的本质区别是什么？
- 列存储索引的压缩原理是什么？有什么优势？
- 什么是批处理模式？为什么比行模式快？
- 什么是行组（Row Group）？有哪些状态？
- 如何维护列存储索引？
- 列存储索引支持实时更新吗？有什么限制？

---

## 下一步

掌握了列存储索引，我们来看 [SQL Server Always On 可用性组架构](/database/sqlserver/always-on)，学习 SQL Server 的高可用解决方案。
