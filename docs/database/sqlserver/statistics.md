# 统计信息：优化器的「情报员」

为什么同样的 SQL，有时候快有时候慢？

为什么加了索引，查询还是全表扫描？

为什么优化器选择的执行计划看起来「很傻」？

答案可能是：**你的统计信息过时了。**

统计信息是优化器的「眼睛」。没有准确的统计信息，优化器就是「盲人摸象」。

今天，我们来深入理解 SQL Server 的统计信息。

## 统计信息是什么？

统计信息是关于**数据分布**的数据。它告诉优化器：

1. 表有多少行？
2. 列有多少个不同的值？
3. 每个值出现多少次？
4. 数据是均匀分布还是倾斜的？

```sql
-- 查看统计信息
DBCC SHOW_STATISTICS('Orders', 'IX_Orders_CustomerID');
```

返回结果包含三个部分：

### 1. 统计信息头部

```
Name              : IX_Orders_CustomerID
Updated           : 2024-01-15 10:30:00
Rows              : 1000000
Rows Sampled      : 1000000
Steps             : 200
Density           : 0.0005
Average key length: 4
String Index      : NO
Filter expression : NULL
Unfiltered rows   : 1000000
```

- **Rows** — 表中总行数
- **Rows Sampled** — 采样的行数
- **Steps** — 直方图的步数（最多 200 步）

### 2. 密度向量（Density Vector）

```
All Density  Average Column Length  Columns
0.0005       4                         CustomerID
```

**Density = 1 / 不同值的数量**

- 如果 CustomerID 有 2000 个不同值，Density = 1/2000 = 0.0005
- 密度越小，索引选择性越高

### 3. 直方图（Histogram）

```
RangeHiKey   RangeRows  EqRows  DistinctRangeRows  AverageRangeRows
1001         500        500     500                1
2001         500        500     500                1
3001         500        500     500                1
...
```

直方图将数据分成最多 200 个区间，每个区间记录：

- **RangeHiKey** — 这个区间的最高值
- **EqRows** — 等于此最高值的行数
- **RangeRows** — 在此区间内的行数（不包括最高值）

## 统计信息如何影响执行计划？

### 例子：预估行数

```sql
-- 表有 100 万行，CustomerID 有 2000 个不同值
-- 其中 CustomerID = 100 的实际行数是 1000

-- 查询 1：SELECT * FROM Orders WHERE CustomerID = 100
-- 优化器根据统计信息估算：
--   - 总行数：1,000,000
--   - 不同值：2,000
--   - 预估行数：1,000,000 / 2,000 = 500
-- 实际行数：1,000

-- 如果统计信息准确，预估接近实际，选择 Index Seek
-- 如果统计信息过时，预估偏差大，可能选择 Table Scan
```

```java
/**
 * 统计信息与执行计划的关系
 * 
 * 优化器选择执行计划的依据：
 * 1. 预估行数 = 估算需要处理多少行
 * 2. 预估成本 = 估算需要多少 I/O 和 CPU
 * 3. 选择成本最低的执行计划
 */
public class StatisticsAndPlan {
    
    /**
     * 执行计划选择的决策逻辑
     */
    public void explainDecision() {
        System.out.println("=== 优化器决策过程 ===");
        System.out.println();
        
        System.out.println("1. 读取统计信息");
        System.out.println("   - 表总行数");
        System.out.println("   - 列的选择性");
        System.out.println("   - 数据分布直方图");
        System.out.println();
        
        System.out.println("2. 估算成本");
        System.out.println("   - Index Seek: log(n) + 回表成本");
        System.out.println("   - Table Scan: 全表扫描成本");
        System.out.println("   - 选择成本最低的方案");
        System.out.println();
        
        System.out.println("3. 关键点");
        System.out.println("   - 预估行数不准 → 选择错误的计划");
        System.out.println("   - 统计过时 → 预估行数不准");
        System.out.println("   - 新数据 → 需要更新统计信息");
    }
}
```

## 统计信息过期的问题

### 问题场景

```sql
-- 场景：订单表
-- 早上 8 点：统计信息更新，OrderDate >= '2024-01-01' 匹配 1000 行
-- 下午 6 点：又插入了 100 万行新数据
-- 下午 6 点 30 分：查询 1 月 1 日之后的数据

-- 问题：统计信息还是早上 8 点的状态
-- 预估行数：1000
-- 实际行数：1,001,000

-- 结果：优化器可能选择 Index Seek
-- 实际：回表 100 万次，性能灾难
```

### 诊断方法

```sql
-- 检查统计信息更新时间
SELECT 
    OBJECT_NAME(s.object_id) AS TableName,
    s.name AS StatsName,
    s.auto_created,
    s.user_created,
    s.no_recompute,
    STATS_DATE(s.object_id, s.stats_id) AS LastUpdated,
    sp.rows AS TableRows
FROM sys.stats s
JOIN sys.objects o ON s.object_id = o.object_id
LEFT JOIN sys.partitions p ON s.object_id = p.object_id 
    AND p.index_id = CASE WHEN s.name LIKE '%IX%' THEN 1 ELSE s.name END
OUTER APPLY (SELECT SUM(rows) rows FROM sys.partitions 
             WHERE object_id = s.object_id AND index_id IN (0, 1)) sp
WHERE o.type = 'U'
ORDER BY STATS_DATE(s.object_id, s.stats_id);
```

## 统计信息的更新机制

### 自动更新

SQL Server 默认**自动更新统计信息**：

```sql
-- 查看自动统计信息设置
SELECT 
    name AS DatabaseName,
    is_auto_update_stats_on,
    is_auto_update_stats_async_on
FROM sys.databases
WHERE database_id = DB_ID();
```

触发条件：
- 表有 500 行以上
- 当 500 + 20% 的行被修改后，自动更新
- 对于大表，阈值是 500 + SQRT(表行数 × 1000)

### 手动更新

```sql
-- 更新单个统计信息
UPDATE STATISTICS Orders IX_Orders_CustomerID;

-- 更新表的所有统计信息
UPDATE STATISTICS Orders;

-- 使用采样更新（平衡速度和准确性）
UPDATE STATISTICS Orders WITH SAMPLE 50 PERCENT;

-- 使用全表扫描更新（最准确，但慢）
UPDATE STATISTICS Orders WITH FULLSCAN;
```

### 异步更新

```sql
-- 启用异步统计信息更新
-- 查询不会等待统计信息更新，减少查询延迟
-- 但可能使用过时的执行计划

ALTER DATABASE YourDatabase
SET AUTO_UPDATE_STATISTICS_ASYNC ON;
```

## 创建自定义统计信息

当单列索引不足以描述数据分布时，可以创建**多列统计信息**：

```sql
-- 创建复合统计信息
CREATE STATISTICS Stats_CustomerDate 
ON Orders(CustomerID, OrderDate)
WITH FULLSCAN;

-- 创建过滤统计信息
CREATE STATISTICS Stats_ActiveOrders 
ON Orders(CustomerID, OrderDate)
WHERE Status = 'Active';
```

```java
/**
 * 什么时候需要创建自定义统计信息
 */
public class CustomStatisticsScenarios {
    
    /**
     * 判断是否需要创建自定义统计信息
     */
    public boolean needsCustomStats(String tableName, 
                                     String[] columns,
                                     QueryPattern query) {
        // 1. 多列一起查询，但单列选择性差
        if (columns.length > 1 && !query.usesAllColumns(columns)) {
            return true;
        }
        
        // 2. 过滤条件的数据分布不均匀
        if (query.hasFilter() && query.filterSelectivity() < 0.1) {
            return true;
        }
        
        // 3. 查询涉及表达式或函数
        if (query.hasExpressions()) {
            return true;
        }
        
        return false;
    }
}
```

## 统计信息相关问题排查

### 问题一：统计信息缺失

```sql
-- 检查缺失的统计信息
SELECT 
    OBJECT_NAME(m.object_id) AS TableName,
    m.object_id,
    m.name AS MissingIndex
FROM sys.dm_db_missing_index_details m
JOIN sys.objects o ON m.object_id = o.object_id
WHERE o.type = 'U'
  AND m.database_id = DB_ID();
```

### 问题二：统计信息过期

```sql
-- 查看哪些统计信息需要更新
SELECT 
    OBJECT_NAME(s.object_id) AS TableName,
    s.name AS StatsName,
    STATS_DATE(s.object_id, s.stats_id) AS LastUpdated,
    SUM(p.rows) AS TableRows
FROM sys.stats s
JOIN sys.partitions p ON s.object_id = p.object_id
JOIN sys.objects o ON s.object_id = o.object_id
WHERE o.type = 'U'
  AND p.index_id IN (0, 1)
GROUP BY s.object_id, s.stats_id
HAVING STATS_DATE(s.object_id, s.stats_id) < DATEADD(DAY, -7, GETDATE())
ORDER BY TableRows DESC;
```

### 问题三：采样率过低

```sql
-- 查看采样率
DBCC SHOW_STATISTICS('Orders', 'IX_Orders_CustomerID') WITH DENSITY_VECTOR;

-- 如果 Rows 和 Rows Sampled 差异大，考虑重新采样
UPDATE STATISTICS Orders IX_Orders_CustomerID WITH FULLSCAN;
```

## 统计信息最佳实践

```java
/**
 * 统计信息管理最佳实践
 */
public class StatisticsBestPractices {
    
    public void printPractices() {
        System.out.println("=== 统计信息管理最佳实践 ===");
        System.out.println();
        
        System.out.println("1. 保持自动更新开启（默认）");
        System.out.println("   - 适用于大多数场景");
        System.out.println("   - 平衡了准确性和性能");
        System.out.println();
        
        System.out.println("2. 关键表定期手动更新");
        System.out.println("   - 大数据量表：使用 SAMPLE");
        System.out.println("   - 实时性要求高：使用 FULLSCAN");
        System.out.println();
        
        System.out.println("3. 使用异步更新减少查询延迟");
        System.out.println("   - 适合统计数据、报表库");
        System.out.println("   - 注意：可能使用过期计划");
        System.out.println();
        
        System.out.println("4. 创建多列统计信息");
        System.out.println("   - 多列一起查询时");
        System.out.println("   - 列之间有相关性时");
        System.out.println();
        
        System.out.println("5. 监控统计信息健康");
        System.out.println("   - 检查更新时间");
        System.out.println("   - 检查采样率");
        System.out.println("   - 检查缺失统计");
    }
}
```

## 总结

统计信息是优化器的决策依据：

1. **统计信息描述数据分布** — 让优化器知道有多少行符合条件
2. **过时的统计信息导致错误决策** — 执行计划可能很差
3. **自动更新是默认配置** — 大多数情况下足够用
4. **关键场景需要手动干预** — 大表、重要查询需要精细管理

---

**面试追问方向：**

- 什么时候会自动更新统计信息？阈值是多少？
- 为什么不建议总是使用 WITH FULLSCAN 更新统计信息？
- 多列统计信息和复合索引有什么区别？

这些问题，值得你在实践中验证。
