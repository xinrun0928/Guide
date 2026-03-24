# 执行计划：查询的「幕后导演」

你的查询跑得慢，但不知道慢在哪。

`SELECT * FROM Orders WHERE CustomerID = 100`，明明有索引，为什么还是全表扫描？

答案藏在**执行计划**里。执行计划是查询优化器生成的「作战方案」，告诉你 SQL Server 打算怎么执行这条查询。

今天，我们来学会阅读执行计划。

## 为什么需要执行计划？

你写的 SQL 只是「要什么」，执行计划告诉你「怎么取」。

```java
/**
 * SQL 语句 vs 执行计划
 * 
 * SQL: 我要买一袋薯片
 * 执行计划: 
 *   1. 去超市
 *   2. 走到零食区
 *   3. 找到薯片区
 *   4. 拿起一袋薯片
 *   5. 结账
 * 
 * 优化器会选择他认为最快的方式
 */
public class SQLVsExecutionPlan {
    
    public void explain() {
        System.out.println("=== 查询执行过程 ===");
        System.out.println();
        System.out.println("SQL: SELECT * FROM Orders WHERE CustomerID = 100");
        System.out.println();
        System.out.println("可能的执行计划：");
        System.out.println("  Plan A: 索引查找 → 回表 → 返回结果");
        System.out.println("  Plan B: 全表扫描 → 过滤 → 返回结果");
        System.out.println();
        System.out.println("优化器根据统计信息选择他认为最优的方案");
    }
}
```

## 查看执行计划的方式

### 1. SSMS 图形化执行计划

在 SSMS 中：
1. 点击工具栏的「显示估计执行计划」
2. 或先执行查询，再点击「包括实际执行计划」
3. 右键点击操作符，选择「属性」查看详情

### 2. SET SHOWPLAN_XML

```sql
-- 查看执行计划但不执行
SET SHOWPLAN_XML ON;
GO
SELECT * FROM Orders WHERE CustomerID = 100;
GO
SET SHOWPLAN_XML OFF;
```

### 3. sys.dm_exec_query_plan

```sql
-- 查看缓存中的执行计划
SELECT 
    qp.query_plan,
    qs.execution_count,
    qs.total_worker_time,
    qs.total_elapsed_time,
    SUBSTRING(qt.text, (qs.statement_start_offset/2)+1, 
        ((CASE qs.statement_end_offset 
          WHEN -1 THEN DATALENGTH(qt.text) 
          ELSE qs.statement_end_offset END 
         - qs.statement_start_offset)/2)+1) AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
WHERE qt.text LIKE '%Orders%'
ORDER BY qs.total_elapsed_time DESC;
```

## 执行计划的核心操作符

### 扫描操作

| 操作符 | 含义 | 何时使用 |
|-------|------|---------|
| Table Scan | 全表扫描 | 无索引可用 |
| Clustered Index Scan | 聚集索引扫描 | 需要访问大量数据 |
| Index Scan | 非聚集索引扫描 | 需要访问索引中的大部分数据 |
| Index Seek | 索引查找 | 使用索引快速定位 |

```
图形化显示：

Table Scan (Orders)
  ↓
  [cost: 100%] ← 全表扫描成本最高

vs

Index Seek (IX_Orders_CustomerID)
  ↓
  RID Lookup (Orders)
  ↓
  [cost: 15%] ← 有索引成本低很多
```

### 查找操作

| 操作符 | 含义 | 说明 |
|-------|------|------|
| Index Seek | 索引查找 | 使用 B+ 树快速定位 |
| Key Lookup | 键查找（回表） | 非聚集索引需要回表获取其他列 |
| RID Lookup | 行ID查找 | 堆表的非聚集索引需要回表 |

### 连接操作

| 操作符 | 含义 | 特点 |
|-------|------|------|
| Nested Loops | 循环嵌套 | 小表驱动大表，最快 |
| Hash Match | 哈希连接 | 大表等值连接，内存哈希表 |
| Merge Join | 合并连接 | 两表都已排序，最高效 |

```java
/**
 * 连接操作的选择策略
 */
public class JoinStrategies {
    
    /**
     * 根据数据量选择连接方式
     */
    public void printStrategy() {
        System.out.println("=== 连接策略选择 ===");
        System.out.println();
        System.out.println("Nested Loops（嵌套循环）：");
        System.out.println("  驱动表: 小表（有索引）");
        System.out.println("  被驱动表: 大表（有索引）");
        System.out.println("  特点: O(m * log n)");
        System.out.println();
        
        System.out.println("Hash Match（哈希连接）：");
        System.out.println("  适用: 大表等值连接");
        System.out.println("  特点: 需要内存构建哈希表");
        System.out.println("  spill to tempdb: 内存不足时");
        System.out.println();
        
        System.out.println("Merge Join（合并连接）：");
        System.out.println("  适用: 两表都按连接列排序");
        System.out.println("  特点: O(m + n)，最优");
        System.out.println("  注意: 需要数据已排序");
    }
}
```

## 解读执行计划的要点

### 1. 成本占比

```
100% 的总成本中，每个操作符占多少？

| 操作符                  | 成本占比 |
|------------------------|---------|
| Clustered Index Scan   | 80%     | ← 主要瓶颈
| Hash Match             | 15%     |
| Sort                   | 5%      |
```

成本最高的操作符就是优化的重点。

### 2. 预估行数 vs 实际行数

```sql
-- 开启统计信息显示
SET STATISTICS IO ON;
SET STATISTICS TIME ON;

-- 执行查询
SELECT * FROM Orders WHERE CustomerID = 100;

-- 查看消息面板的输出
/*
Table 'Orders'. Scan count 1, logical reads 1500, physical reads 0.
 SQL Server Execution Times: CPU time = 15 ms, elapsed time = 20 ms.
*/
```

| 统计项 | 含义 |
|-------|------|
| Scan count | 扫描次数 |
| Logical reads | 逻辑读（内存页数） |
| Physical reads | 物理读（磁盘页数） |
| CPU time | CPU 时间 |
| Elapsed time | 总耗时 |

**逻辑读是评估查询成本的核心指标**。逻辑读越少，查询越快。

### 3. 警告标志

执行计划中可能出现以下警告：

| 警告 | 含义 | 解决方案 |
|------|------|---------|
| ⚠️ No Join Predicate | 笛卡尔积 | 检查 WHERE 条件 |
| ⚠️ Missing Index | 建议创建索引 | 查看并评估建议 |
| ⚠️ Table Spool | 重复扫描数据 | 优化查询 |
| ⚠️ Sort Warning | 无法在内存排序 | 考虑增加索引 |

## 常见执行计划问题

### 问题一：全表扫描

```sql
-- 问题 SQL
SELECT * FROM Orders WHERE YEAR(OrderDate) = 2024;

-- 问题原因：YEAR() 函数导致索引失效
-- 执行计划显示：Clustered Index Scan

-- 解决方案：改写查询
SELECT * FROM Orders 
WHERE OrderDate >= '2024-01-01' AND OrderDate < '2025-01-01';

-- 解决方案：创建函数索引（SQL Server 不直接支持，改用计算列）
ALTER TABLE Orders ADD OrderYear AS YEAR(OrderDate);
CREATE INDEX IX_Orders_Year ON Orders(OrderYear);
```

### 问题二：索引未被使用

```sql
-- 问题 SQL
SELECT * FROM Orders WHERE Status = 'Active' AND Amount > 100;

-- 假设有索引 IX_Orders_Status(Status)
-- 但执行计划显示全表扫描

-- 可能原因：
-- 1. Amount > 100 过滤掉了大部分数据，扫描更快
-- 2. 统计信息过期
-- 3. 数据分布不均匀

-- 解决方案：检查统计信息
DBCC SHOW_STATISTICS('Orders', 'IX_Orders_Status');

-- 更新统计信息
UPDATE STATISTICS Orders;
```

### 问题三：隐式类型转换

```sql
-- 问题 SQL（假设 OrderID 是 INT 类型）
SELECT * FROM Orders WHERE OrderID = '100';  -- 字符串 '100'

-- 问题原因：字符串转 INT 导致索引失效
-- 执行计划：Index Scan + 隐式转换

-- 解决方案：使用正确的类型
SELECT * FROM Orders WHERE OrderID = 100;
```

```java
/**
 * 常见导致执行计划变差的写法
 */
public class BadQueryPatterns {
    
    public void printExamples() {
        System.out.println("=== 导致索引失效的写法 ===");
        System.out.println();
        System.out.println("1. 函数在列上");
        System.out.println("   错误: WHERE YEAR(OrderDate) = 2024");
        System.out.println("   正确: WHERE OrderDate >= '2024-01-01'");
        System.out.println();
        
        System.out.println("2. 隐式类型转换");
        System.out.println("   错误: WHERE OrderID = '100'");
        System.out.println("   正确: WHERE OrderID = 100");
        System.out.println();
        
        System.out.println("3. OR 条件");
        System.out.println("   错误: WHERE Status = 'A' OR Status = 'B'");
        System.out.println("   正确: WHERE Status IN ('A', 'B')");
        System.out.println();
        
        System.out.println("4. LIKE 前缀通配符");
        System.out.println("   错误: WHERE Name LIKE '%张%'");
        System.out.println("   正确: WHERE Name LIKE '张%'");
    }
}
```

## 执行计划分析实战

```sql
-- 完整示例：分析慢查询
SET SHOWPLAN_XML ON;
GO

-- 问题查询：订单统计
SELECT 
    c.CustomerName,
    COUNT(o.OrderID) AS OrderCount,
    SUM(o.TotalAmount) AS TotalAmount
FROM Customers c
LEFT JOIN Orders o ON c.CustomerID = o.CustomerID
WHERE o.OrderDate >= '2024-01-01'
GROUP BY c.CustomerName
HAVING COUNT(o.OrderID) > 10
ORDER BY TotalAmount DESC;

GO
SET SHOWPLAN_XML OFF;
```

**可能发现的问题**：

1. **缺少聚集索引** — 如果 Customers 表无主键，可能有警告
2. **统计信息缺失** — 可能提示创建统计信息
3. **缺失索引** — 提示 `Missing Index`
4. **连接顺序错误** — 可能小表驱动大表

## 总结

执行计划是优化 SQL 的起点：

1. **看总成本** — 找到成本最高的操作符
2. **看预估行数** — 对比实际行数，检查统计信息
3. **看警告** — 索引缺失、类型转换等
4. **看操作符** — 扫描、查找、连接的类型
5. **看统计 IO** — 逻辑读是核心指标

---

**面试追问方向：**

- 执行计划的预估行数和实际行数差异很大，说明什么？
- 如何通过执行计划判断索引是否合理？
- SET STATISTICS IO ON 显示的 logical reads 是什么含义？

这些问题，值得你在 SSMS 中实际演练。
