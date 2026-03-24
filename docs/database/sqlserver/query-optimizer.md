# SQL Server 查询优化器与计划指南

为什么同样一条 SQL，优化器有时候选择 Index Scan，有时候选择 Index Seek？

为什么同一个查询，这次执行快，下次执行慢？

答案藏在 SQL Server 的查询优化器里。

查询优化器是 SQL Server 最复杂的组件之一——它负责把 SQL 语句翻译成「最优」的执行计划。但「最优」是相对的，受限于统计信息、成本模型、配置参数等。

理解优化器，你才能真正掌控 SQL Server 的性能。

---

## 查询优化器概述

### 编译与重编译

```
┌─────────────────────────────────────────────────────────────┐
│                  SQL 执行流程                               │
│                                                              │
│  SQL 文本                                                    │
│      │                                                      │
│      ▼                                                      │
│  ┌─────────┐                                                │
│  │  解析   │ → 生成解析树                                    │
│  └────┬────┘                                                │
│       ▼                                                     │
│  ┌─────────┐                                                │
│  │  绑定   │ → 解析树 → 逻辑执行计划                         │
│  └────┬────┘                                                │
│       ▼                                                     │
│  ┌─────────┐                                                │
│  │  优化   │ → 逻辑计划 → 物理执行计划                       │
│  └────┬────┘                                                │
│       ▼                                                     │
│  ┌─────────┐                                                │
│  │  执行   │ → 按计划执行                                    │
│  └─────────┘                                                │
└─────────────────────────────────────────────────────────────┘
```

### 优化的两个阶段

| 阶段 | 说明 |
|-----|------|
| **查询优化** | 选择最优的物理操作和顺序 |
| **计划生成** | 将逻辑操作转换为物理操作 |

### 优化的类型

| 类型 | 说明 | 触发条件 |
|-----|------|---------|
| ** trivial 优化** | 简单的 SELECT，优化器识别出唯一执行方式 | 无 WHERE、无 JOIN |
| **自调整优化** | 基于规则的简单优化 | 小查询 |
| **完整优化** | 成本估算，寻找最优计划 | 复杂查询（默认） |

---

## 成本估算模型

### 成本模型基础

优化器基于**成本估算**选择执行计划。成本由多个因素决定：

```
成本 = I/O 成本 + CPU 成本

I/O 成本 = 读取页数 × 页面成本系数
CPU 成本 = 处理行数 × 行处理成本系数
```

### 成本系数

| 参数 | 说明 | 默认值 |
|-----|------|-------|
| `cost threshold for parallelism` | 并行计划阈值 | 5 秒 |
| `max degree of parallelism` | 最大并行度 | 0（自动） |
| `index create memory` | 索引创建内存 | 动态 |
| `min memory per query` | 每查询最小内存 | 1024 KB |

```sql
-- 查看相关配置
SELECT name, value, value_in_use, description
FROM sys.configurations
WHERE name IN (
    'cost threshold for parallelism',
    'max degree of parallelism',
    'min memory per query'
);

-- 修改配置
EXEC sp_configure 'max degree of parallelism', 4;
RECONFIGURE;
```

---

## 访问路径选择

### 访问路径类型

| 访问路径 | 说明 | 适用场景 |
|---------|------|---------|
| **Table Scan** | 全表扫描（堆表） | 无索引、返回大量数据 |
| **Clustered Index Scan** | 聚集索引扫描 | 全表扫描聚集表 |
| **Index Scan** | 非聚集索引扫描 | 索引覆盖全部需要列 |
| **Index Seek** | 索引查找 | 范围查询、高选择性查询 |
| **Key Lookup** | 聚集索引回表 | 索引未覆盖查询列 |

### 访问路径选择规则

**经验法则**：
- 预计返回 **< 5%** 行 → Index Seek
- 预计返回 **> 20%** 行 → Index Scan
- 5% - 20% 之间 → 取决于索引结构和成本估算

### 示例

```sql
-- 表 Orders 有 100 万行
-- 索引 IX_Orders_Customer(customer_id)

-- 查询 1：单个客户订单
SELECT * FROM Orders WHERE customer_id = 1001;
-- customer_id=1001 约 100 行（0.01%）
-- 优化器选择：Index Seek + Key Lookup

-- 查询 2：所有待处理订单
SELECT * FROM Orders WHERE status = 1;
-- status=1 约 50 万行（50%）
-- 优化器选择：Clustered Index Scan（全表扫描更快）

-- 查询 3：客户和状态组合
SELECT * FROM Orders WHERE customer_id = 1001 AND status = 1;
-- 约 10 行
-- 优化器选择：Index Seek（IX_Orders_Customer）
```

---

## 连接算法

### 三种连接算法

| 算法 | 说明 | 适用场景 |
|-----|------|---------|
| **Nested Loop** | 内外表嵌套循环 | 小表驱动大表、被驱动表有索引 |
| **Hash Match** | 构建哈希表 | 大表等值连接、无合适索引 |
| **Merge Join** | 排序数据归并 | 已排序的输入、有序连接 |

### Nested Loop Join

```
┌─────────────────────────────────────────────────────────────┐
│                  Nested Loop Join                           │
│                                                              │
│  外表（驱动表）                                              │
│  ┌─────────┐                                               │
│  │  小表   │  100 行                                        │
│  └────┬────┘                                                │
│       ▼                                                     │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ FOR EACH 外表行 LOOP                                │ │
│  │     查找内表匹配行（索引）                           │ │
│  │     输出连接结果                                     │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                              │
│  特点：小表在外，索引在内                                    │
└─────────────────────────────────────────────────────────────┘
```

### Hash Match Join

```
┌─────────────────────────────────────────────────────────────┐
│                   Hash Match Join                            │
│                                                              │
│  阶段 1：构建（Build）                                      │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ 外表数据 → 哈希函数 → 哈希桶                         │ │
│  │                                                     │ │
│  │  桶1: [row1, row3]                                  │ │
│  │  桶2: [row2]                                        │ │
│  │  桶3: [row5, row7]                                  │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                              │
│  阶段 2：探测（Probe）                                      │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ 内表数据 → 哈希函数 → 查找哈希桶                     │ │
│  │ 匹配则输出                                          │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                              │
│  特点：适用于大表、无索引、内存密集                          │
└─────────────────────────────────────────────────────────────┘
```

### Merge Join

```
┌─────────────────────────────────────────────────────────────┐
│                    Merge Join                                │
│                                                              │
│  输入要求：两边都已按连接列排序                              │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ 表 A（排序）│ 表 B（排序）                           │ │
│  │  1  │  1  │                                        │ │
│  │  2  │  2  │                                        │ │
│  │  3  │  4  │                                        │ │
│  │  4  │  6  │                                        │ │
│  │  6  │     │                                        │ │
│  └─────┴─────┘                                            │ │
│      │        │                                           │
│      ▼        ▼                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ 双指针比较：                                         │ │
│  │   A=1 vs B=1 → 相等，输出                           │ │
│  │   A=2 vs B=2 → 相等，输出                           │ │
│  │   A=3 vs B=4 → A小，A前进                          │ │
│  │   A=4 vs B=4 → 相等，输出                           │ │
│  │   A=6 vs B=6 → 相等，输出                           │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                              │
│  特点：需要排序输入、高吞吐                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 统计信息与成本估算

### 统计信息的重要性

优化器使用统计信息估算行数，成本 = 行数 × 行处理成本。

```sql
-- 查看统计信息
DBCC SHOW_STATISTICS('Orders', 'IX_Orders_Customer');
-- 输出：直方图、密度向量、列统计

-- 关键列：
-- Rows: 表总行数
-- Rows Sampled: 采样行数
-- All density: 列组合的密度（越小越有价值）
-- Average key length: 平均键长度
```

### 统计信息不准确的影响

```sql
-- 问题：统计信息过时
-- Orders 表有 1000 万行，统计信息显示 100 万行

SELECT * FROM Orders WHERE order_date >= '2024-01-01';
-- 优化器估算：0 行（过时统计）
-- 实际：500 万行
-- 结果：选择了错误的执行计划

-- 解决方案：更新统计信息
UPDATE STATISTICS Orders WITH FULLSCAN;
```

---

## 执行计划提示（Hint）

### 常用提示

```sql
-- 强制使用特定索引
SELECT * FROM Orders WITH (INDEX(IX_Orders_Customer))
WHERE customer_id = 1001;

-- 强制索引查找（禁用扫描）
SELECT * FROM Orders WITH (FORCESEEK)
WHERE customer_id = 1001;

-- 强制特定连接顺序
SELECT * 
FROM Orders o
INNER JOIN Customers c WITH (FORCE ORDER)
    ON o.customer_id = c.customer_id;

-- 强制并行
SELECT * FROM Orders 
WHERE order_date >= '2024-01-01'
OPTION (MAXDOP 4);

-- 禁用并行
SELECT * FROM Orders 
WHERE order_date >= '2024-01-01'
OPTION (MAXDOP 1);

-- 强制哈希连接
SELECT * FROM Orders o
INNER HASH JOIN Customers c ON o.customer_id = c.customer_id;

-- 强制嵌套循环连接
SELECT * FROM Orders o
INNER LOOP JOIN Customers c ON o.customer_id = c.customer_id;
```

### 提示使用场景

| 场景 | 提示 | 说明 |
|-----|------|------|
| 优化器选错索引 | `INDEX()` / `FORCESEEK` | 强制使用指定索引 |
| 统计信息不准 | `RECOMPILE` | 每次执行重编译 |
| 并行度问题 | `MAXDOP` | 控制并行度 |
| 连接顺序问题 | `FORCE ORDER` | 强制驱动表顺序 |
| 内存不足 | `MIN_GRANT_PERCENT` | 保证最小内存 |

### 使用提示的注意事项

```sql
-- ⚠️ 提示会绕过优化器，可能导致次优计划
-- ⚠️ 提示可能在新版本变好/变坏
-- ⚠️ 维护成本高（版本升级后可能失效）

-- ✅ 好的做法：
-- 1. 先分析执行计划，确认问题
-- 2. 尝试其他方法（索引、统计信息）
-- 3. 最后才使用提示
-- 4. 添加注释说明为什么用提示
```

---

## 参数化与计划缓存

### 简单参数化

```sql
-- SQL Server 自动参数化
-- 第一次执行
SELECT * FROM Orders WHERE order_id = 1;
-- 参数化后可能变成
EXEC sp_executesql N'SELECT * FROM Orders WHERE order_id = @p0', N'@p0 INT', @p0 = 1

-- 第二次执行相同结构
SELECT * FROM Orders WHERE order_id = 1001;
-- 重用计划
```

### 强制参数化

```sql
-- 启用强制参数化（整个数据库）
ALTER DATABASE MyDB SET PARAMETERIZATION FORCED;

-- 问题：
-- 1. 可能导致参数嗅探问题
-- 2. 某些查询可能生成坏计划

-- 替代方案：OPTIMIZE FOR hint
SELECT * FROM Orders WHERE customer_id = @id
OPTION (OPTIMIZE FOR (@id = 1000));
```

### 计划重用问题

```sql
-- 查看缓存中的计划
SELECT 
    cp.usecounts AS UseCount,
    cp.size_in_bytes / 1024 AS SizeKB,
    cp.plan_handle,
    qt.text AS SqlText
FROM sys.dm_exec_cached_plans cp
CROSS APPLY sys.dm_exec_sql_text(cp.plan_handle) qt
WHERE qt.dbid = DB_ID('MyDB')
ORDER BY cp.usecounts DESC;

-- 强制重编译（单次）
SELECT * FROM Orders WHERE customer_id = @id
OPTION (RECOMPILE);

-- 强制重编译（存储过程级别）
CREATE PROCEDURE GetOrders @customer_id INT
WITH RECOMPILE
AS
BEGIN
    SELECT * FROM Orders WHERE customer_id = @customer_id;
END
```

---

## 优化器相关配置

```sql
-- 查看所有优化器相关配置
SELECT name, value, value_in_use, description
FROM sys.configurations
WHERE name LIKE '%optimize%'
   OR name LIKE '%query%'
   OR name LIKE '%plan%';

-- 常用配置
-- 1. cost threshold for parallelism
--    默认 5，优化器生成并行计划的最小成本估算
EXEC sp_configure 'cost threshold for parallelism', 10;
RECONFIGURE;

-- 2. max degree of parallelism
--    默认 0（自动），单查询最大并行线程数
EXEC sp_configure 'max degree of parallelism', 4;
RECONFIGURE;

-- 3. query optimizer hotfixes
--    启用最新优化器修复
EXEC sp_configure 'query optimizer hotfixes', 1;
RECONFIGURE;
```

---

## 面试追问方向

- 查询优化器是如何工作的？有哪些优化阶段？
- 什么是成本估算模型？受哪些因素影响？
- 三种连接算法（Nested Loop、Hash、Merge）分别在什么场景下使用？
- 执行计划提示（Hint）有什么作用？使用提示有什么风险？
- 什么是参数嗅探？如何解决？
- 什么是计划缓存？如何监控和清理？

---

## 下一步

理解了查询优化器，我们来看 [SQL Server 内存管理：Buffer Pool 与 Columnstore](/database/sqlserver/memory)，学习 SQL Server 的内存架构。
