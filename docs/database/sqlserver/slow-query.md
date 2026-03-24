# 慢查询分析：让 SQL 飞起来

你的查询从 2 秒变成 20 秒，用户抱怨连连。

加了索引？还是慢。
换了机器？没用。
问题到底在哪？

今天，我们来系统学习 SQL Server 慢查询的分析和优化方法。

## 慢查询的常见原因

80% 的慢查询问题，都逃不出这四类：

| 类型 | 占比 | 典型问题 |
|------|------|---------|
| 索引问题 | 40% | 无索引、索引失效、索引选择错误 |
| 统计信息 | 20% | 统计信息过期、数据分布不均 |
| 查询写法 | 25% | SELECT *、OR 条件、函数操作 |
| 执行计划 | 15% | 连接顺序错误、不必要的排序 |

## 找到慢查询

### 方法一：查询 DMV

```sql
-- 找出最耗时的查询
SELECT TOP 20 
    qs.execution_count,
    qs.total_elapsed_time / 1000 AS total_time_ms,
    qs.total_logical_reads,
    qs.total_logical_writes,
    qs.total_cpu_time / 1000 AS cpu_time_ms,
    qs.last_elapsed_time / 1000 AS last_time_ms,
    SUBSTRING(qt.text, (qs.statement_start_offset/2)+1, 
        ((CASE qs.statement_end_offset 
          WHEN -1 THEN DATALENGTH(qt.text) 
          ELSE qs.statement_end_offset END 
         - qs.statement_start_offset)/2)+1) AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
WHERE qt.dbid = DB_ID('YourDatabase')
ORDER BY qs.total_elapsed_time DESC;
```

### 方法二：查询等待统计

```sql
-- 找出等待最多的类型
SELECT TOP 10
    wait_type,
    waiting_tasks_count,
    wait_time_ms,
    signal_wait_time_ms,
    wait_time_ms - signal_wait_time_ms AS resource_wait_ms
FROM sys.dm_os_wait_stats
WHERE wait_type NOT IN (
    'CLR_SEMAPHORE', 'LAZYWRITER_SLEEP', 'RESOURCE_QUEUE',
    'SLEEP_TASK', 'SLEEP_SYSTEMTASK', 'SQLTRACE_BUFFER_FLUSH',
    'WAITFOR', 'LOGMGR_QUEUE', 'CHECKPOINT_QUEUE'
)
ORDER BY wait_time_ms DESC;
```

**常见的等待类型及含义**：

| 等待类型 | 含义 | 优化方向 |
|---------|------|---------|
| PAGEIOLATCH_SH | 等待从磁盘读取页 | 增加内存、优化 I/O |
| CXPACKET | 并行查询等待 | 调整 MAXDOP |
| LCK_M_IX | 等待排他锁 | 优化事务、减少锁竞争 |
| ASYNC_NETWORK_IO | 等待客户端读取数据 | 减少数据传输 |
| SOS_SCHEDULER_YIELD | CPU 调度等待 | 增加 CPU、减少计算 |

### 方法三：扩展事件

```sql
-- 创建扩展事件捕获慢查询
CREATE EVENT SESSION [SlowQueries] ON SERVER
ADD EVENT sqlserver.sql_statement_completed (
    ACTION (sqlserver.sql_text, sqlserver.database_id)
    WHERE (duration > 100000)  -- 超过 100ms
)
ADD TARGET package0.event_file (
    SET filename = 'C:\Temp\SlowQueries.xel'
)
WITH (MAX_DISPATCH_LATENCY = 1 SECONDS);
GO

ALTER EVENT SESSION SlowQueries ON SERVER STATE = START;
```

## 慢查询分析框架

```java
/**
 * 慢查询分析框架
 * 
 * 遇到慢查询，按这个流程分析：
 * 1. 收集信息：执行计划、统计信息、等待类型
 * 2. 识别问题：索引、统计、写法、执行计划
 * 3. 验证假设：通过修改和测试验证
 * 4. 实施优化：改 SQL 或加索引
 * 5. 确认效果：对比优化前后的指标
 */
public class SlowQueryAnalysis {
    
    /**
     * 分析慢查询的核心步骤
     */
    public void analyze() {
        System.out.println("=== 慢查询分析流程 ===");
        System.out.println();
        
        System.out.println("Step 1: 收集信息");
        System.out.println("  - 获取执行计划 (SSMS)");
        System.out.println("  - 检查逻辑读 (SET STATISTICS IO)");
        System.out.println("  - 查看等待类型 (DMV)");
        System.out.println();
        
        System.out.println("Step 2: 识别瓶颈");
        System.out.println("  - 全表扫描？ → 检查索引");
        System.out.println("  - 预估行数偏差？ → 更新统计");
        System.out.println("  - 排序/哈希？ → 检查查询写法");
        System.out.println();
        
        System.out.println("Step 3: 制定方案");
        System.out.println("  - 添加索引？ → 评估覆盖性");
        System.out.println("  - 改写 SQL？ → 遵循最佳实践");
        System.out.println("  - 调整参数？ → 小心翼翼");
        System.out.println();
        
        System.out.println("Step 4: 验证效果");
        System.out.println("  - 对比执行时间");
        System.out.println("  - 对比逻辑读");
        System.out.println("  - 观察资源消耗");
    }
}
```

## 索引相关优化

### 检查索引是否被使用

```sql
-- 查看索引使用统计
SELECT 
    OBJECT_NAME(i.object_id) AS TableName,
    i.name AS IndexName,
    i.type_desc,
    us.user_seeks,       -- seek 次数
    us.user_scans,       -- scan 次数
    us.user_lookups,     -- lookup 次数
    us.user_updates,     -- 更新次数
    i.is_disabled        -- 是否禁用
FROM sys.indexes i
LEFT JOIN sys.dm_db_index_usage_stats us 
    ON i.object_id = us.object_id 
    AND i.index_id = us.index_id
WHERE OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
ORDER BY us.user_seeks + us.user_scans ASC;
```

**优化建议**：
- `user_seeks` 很高但 `user_scans` 也很高：可能索引顺序不对
- `user_seeks = 0` 且 `user_scans = 0`：索引可能从未被使用，考虑删除
- `user_updates` 很高：索引维护成本高，确认是否值得

### 创建合适的索引

```sql
-- 根据慢查询创建索引
-- 假设慢查询是：
-- SELECT OrderDate, TotalAmount FROM Orders WHERE CustomerID = 100 AND Status = 'Shipped'

-- 分析：WHERE 条件包含 CustomerID 和 Status
-- 创建覆盖索引

CREATE NONCLUSTERED INDEX IX_Orders_CustomerStatus
ON Orders(CustomerID, Status)      -- 索引键
INCLUDE (OrderDate, TotalAmount);  -- 覆盖列
```

### 索引碎片修复

```sql
-- 检查索引碎片
SELECT 
    OBJECT_NAME(ips.object_id) AS TableName,
    i.name AS IndexName,
    ips.avg_fragmentation_in_percent,
    ips.avg_page_space_used_in_percent,
    ips.page_count
FROM sys.dm_db_index_physical_stats(
    DB_ID(), NULL, NULL, NULL, 'DETAILED'
) ips
JOIN sys.indexes i ON ips.object_id = i.object_id AND ips.index_id = i.index_id
WHERE ips.avg_fragmentation_in_percent > 10
ORDER BY ips.avg_fragmentation_in_percent DESC;

-- 修复碎片
-- 碎片 < 30%：REORGANIZE（轻量，不锁表）
ALTER INDEX IX_Orders_CustomerID ON Orders REORGANIZE;

-- 碎片 >= 30%：REBUILD（重建，更彻底）
ALTER INDEX IX_Orders_CustomerID ON Orders REBUILD;
```

## 查询写法优化

### 避免 SELECT *

```sql
-- 慢查询
SELECT * FROM Orders WHERE CustomerID = 100;

-- 优化后
SELECT OrderID, OrderDate, TotalAmount 
FROM Orders WHERE CustomerID = 100;
```

### 避免在列上使用函数

```sql
-- 慢查询：函数导致索引失效
SELECT * FROM Orders 
WHERE YEAR(OrderDate) = 2024 
  AND MONTH(OrderDate) = 1;

-- 优化后：使用范围查询
SELECT * FROM Orders 
WHERE OrderDate >= '2024-01-01' 
  AND OrderDate < '2024-02-01';
```

### 使用 UNION ALL 代替 UNION

```sql
-- UNION 会去重，有额外开销
SELECT CustomerID, Email FROM ActiveCustomers
UNION
SELECT CustomerID, Email FROM InactiveCustomers;

-- 如果不需要去重，使用 UNION ALL
SELECT CustomerID, Email FROM ActiveCustomers
UNION ALL
SELECT CustomerID, Email FROM InactiveCustomers;
```

### 减少 JOIN

```sql
-- 慢查询：多层 JOIN
SELECT o.*, c.*, p.*, s.*
FROM Orders o
JOIN Customers c ON o.CustomerID = c.CustomerID
JOIN Products p ON o.ProductID = p.ProductID
JOIN Suppliers s ON p.SupplierID = s.SupplierID
WHERE o.OrderDate > '2024-01-01';

-- 优化：只 JOIN 需要的表和列
SELECT o.OrderID, o.TotalAmount, c.CustomerName
FROM Orders o
JOIN Customers c ON o.CustomerID = c.CustomerID
WHERE o.OrderDate > '2024-01-01';
```

```java
/**
 * 慢查询优化清单
 */
public class SlowQueryOptimization {
    
    public void printChecklist() {
        System.out.println("=== 慢查询优化检查清单 ===");
        System.out.println();
        
        System.out.println("索引检查：");
        System.out.println("  □ WHERE 条件的列是否有索引？");
        System.out.println("  □ JOIN 条件的列是否有索引？");
        System.out.println("  □ ORDER BY 的列是否有索引？");
        System.out.println("  □ 索引是否覆盖查询？");
        System.out.println("  □ 索引是否有碎片？");
        System.out.println();
        
        System.out.println("查询写法检查：");
        System.out.println("  □ 是否使用 SELECT *？");
        System.out.println("  □ 列上是否使用了函数？");
        System.out.println("  □ 是否有隐式类型转换？");
        System.out.println("  □ WHERE 条件是否太复杂？");
        System.out.println("  □ 是否有多余的 JOIN？");
        System.out.println();
        
        System.out.println("执行计划检查：");
        System.out.println("  □ 是否有全表扫描？");
        System.out.println("  □ 预估行数和实际是否一致？");
        System.out.println("  □ 是否有多余的排序？");
        System.out.println("  □ 连接类型是否合适？");
    }
}
```

## 统计信息优化

### 检查统计信息

```sql
-- 查看表的统计信息
EXEC sp_helpstats 'Orders', 'ALL';

-- 查看特定统计信息详情
DBCC SHOW_STATISTICS('Orders', 'IX_Orders_CustomerID');
```

### 更新统计信息

```sql
-- 更新单个索引的统计信息
UPDATE STATISTICS Orders IX_Orders_CustomerID;

-- 更新表的所有统计信息
UPDATE STATISTICS Orders;

-- 使用 FULLSCAN 获取最准确的统计（大数据表耗时）
UPDATE STATISTICS Orders WITH FULLSCAN;

-- 或者让 SQL Server 自动更新
ALTER DATABASE YourDatabase SET AUTO_UPDATE_STATISTICS ON;
```

### 异步统计信息更新

```sql
-- 启用异步统计信息更新（减少查询等待）
ALTER DATABASE YourDatabase 
SET AUTO_UPDATE_STATISTICS_ASYNC ON;
```

## 综合优化案例

```sql
-- 原始慢查询
SELECT o.OrderID, o.OrderDate, o.TotalAmount,
       c.CustomerName, c.Email,
       p.ProductName
FROM Orders o
JOIN Customers c ON o.CustomerID = c.CustomerID
JOIN Products p ON o.ProductID = p.ProductID
WHERE o.OrderDate >= '2024-01-01'
  AND YEAR(o.OrderDate) = 2024
ORDER BY o.OrderDate DESC;

-- 优化步骤：

-- 1. 修复 YEAR() 函数问题
-- 索引 IX_Orders_Date 已存在，但 YEAR() 导致失效

-- 2. 创建合适的覆盖索引
CREATE NONCLUSTERED INDEX IX_Orders_DateCovering
ON Orders (OrderDate DESC, CustomerID)
INCLUDE (TotalAmount);

-- 3. 改写查询（移除函数）
SELECT o.OrderID, o.OrderDate, o.TotalAmount,
       c.CustomerName, c.Email,
       p.ProductName
FROM Orders o
JOIN Customers c ON o.CustomerID = c.CustomerID
JOIN Products p ON o.ProductID = p.ProductID
WHERE o.OrderDate >= '2024-01-01'
  AND o.OrderDate < '2025-01-01'
ORDER BY o.OrderDate DESC;

-- 4. 检查执行计划
-- 预估应该变成：Index Seek + Key Lookup
-- 逻辑读从 50000+ 降到 200 以内
```

## 总结

慢查询优化的核心是**定位瓶颈**：

1. **查 DMV** — 找出最慢的查询
2. **看执行计划** — 找到成本最高的操作
3. **检查索引** — 是否缺失、是否失效、是否碎片
4. **优化写法** — 避免函数、SELECT *、隐式转换
5. **更新统计** — 让优化器做出正确决策

---

**面试追问方向：**

- 如何通过 DMV 找出数据库中最耗资源的查询？
- 什么时候应该删除一个索引？
- 统计信息和执行计划的关系是什么？

这些问题，值得你在生产环境中验证。
