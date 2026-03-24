# 分页查询：数据太多怎么「分页显示」？

你有 100 万条订单数据，前端要分页显示，每页 20 条。

`SELECT * FROM Orders` 返回 100 万条？肯定不行。

很多人会想到 `TOP`，但 `TOP` 只能取前 N 条，不能跳着取第 3 页。`LIMIT offset, count` 在 MySQL 里可以，SQL Server 怎么写？

今天，我们来彻底搞定 SQL Server 的分页查询。

## 为什么需要分页？

分页查询的三大价值：

1. **性能优化** — 只查询需要的 N 条记录，减少网络传输和内存占用
2. **用户体验** — 前端分页展示，让用户不用一次性面对海量数据
3. **业务需求** — 报表导出分批处理、后台管理分页等场景

## SQL Server 分页的演进

SQL Server 的分页语法经历了三次演进：

| 版本 | 语法 | 特点 |
|------|------|------|
| SQL Server 2000 及之前 | 嵌套 TOP | 复杂、嵌套层次深 |
| SQL Server 2005+ | ROW_NUMBER() | 相对简洁，成为主流 |
| SQL Server 2012+ | OFFSET FETCH | 官方标准，性能最优 |

## 方案一：嵌套 TOP（老派写法）

```sql
-- 查询第 1-20 条（第一页）
SELECT TOP 20 * 
FROM Orders 
ORDER BY OrderDate DESC;

-- 查询第 21-40 条（第二页）
-- 思路：先排除前 20 条，再取前 20 条
SELECT TOP 20 * 
FROM (
    SELECT TOP 40 * 
    FROM Orders 
    ORDER BY OrderDate DESC
) AS Page2
ORDER BY OrderDate ASC;  -- 再反转排序
```

**问题**：如果表有 1000 万条数据，查询第 1000 页需要扫描 2 亿条记录，性能极差。

## 方案二：ROW_NUMBER()（主流写法）

SQL Server 2005 引入了 `ROW_NUMBER()` 函数，为每行分配序号：

```sql
-- 完整的分页查询
WITH OrderedOrders AS (
    SELECT 
        ROW_NUMBER() OVER (ORDER BY OrderDate DESC, OrderID DESC) AS RowNum,
        OrderID,
        OrderDate,
        CustomerID,
        TotalAmount
    FROM Orders
)
SELECT * 
FROM OrderedOrders
WHERE RowNum BETWEEN 21 AND 40;  -- 第二页
```

对应的 Java 代码：

```java
/**
 * 生成分页查询 SQL
 * 
 * @param pageNum 页码（从 1 开始）
 * @param pageSize 每页条数
 * @param orderBy 排序字段
 * @param orderDirection 排序方向（ASC/DESC）
 * @return 分页 SQL
 */
public class PaginationSQL {
    
    public String generatePageSQL(int pageNum, int pageSize, 
                                   String orderBy, String orderDirection) {
        int offset = (pageNum - 1) * pageSize;
        
        return String.format(
            "WITH OrderedData AS ( " +
            "    SELECT ROW_NUMBER() OVER (ORDER BY %s %s) AS RowNum, * " +
            "    FROM YourTable " +
            ") " +
            "SELECT * FROM OrderedData WHERE RowNum BETWEEN %d AND %d",
            orderBy, orderDirection, offset + 1, pageNum * pageSize
        );
    }
}
```

### 带条件的分页查询

实际业务中，分页通常需要加筛选条件：

```sql
-- 带筛选条件的分页查询
ALTER PROCEDURE sp_GetOrders
    @PageNum INT = 1,
    @PageSize INT = 20,
    @CustomerID INT = NULL,
    @StartDate DATETIME = NULL,
    @EndDate DATETIME = NULL
AS
BEGIN
    SET NOCOUNT ON;
    
    ;WITH FilteredOrders AS (
        SELECT 
            ROW_NUMBER() OVER (ORDER BY OrderDate DESC, OrderID DESC) AS RowNum,
            *
        FROM Orders
        WHERE (@CustomerID IS NULL OR CustomerID = @CustomerID)
          AND (@StartDate IS NULL OR OrderDate >= @StartDate)
          AND (@EndDate IS NULL OR OrderDate <= @EndDate)
    )
    SELECT * 
    FROM FilteredOrders
    WHERE RowNum BETWEEN (@PageNum - 1) * @PageSize + 1 AND @PageNum * @PageSize;
    
    -- 同时返回总记录数（前端分页导航需要）
    ;WITH FilteredOrders AS (
        SELECT OrderID
        FROM Orders
        WHERE (@CustomerID IS NULL OR CustomerID = @CustomerID)
          AND (@StartDate IS NULL OR OrderDate >= @StartDate)
          AND (@EndDate IS NULL OR OrderDate <= @EndDate)
    )
    SELECT COUNT(*) AS TotalCount FROM FilteredOrders;
END
```

## 方案三：OFFSET FETCH（SQL Server 2012+，推荐）

`OFFSET FETCH` 是 SQL Server 2012 引入的官方标准语法，性能和可读性都更好：

```sql
-- 基础用法
SELECT 
    OrderID,
    OrderDate,
    CustomerID,
    TotalAmount
FROM Orders
ORDER BY OrderDate DESC, OrderID DESC
OFFSET 20 ROWS        -- 跳过前 20 条
FETCH NEXT 20 ROWS ONLY;  -- 取接下来 20 条
```

**重要**：`ORDER BY` 是必须的，`OFFSET FETCH` 必须配合排序使用。

### 对应 Java 代码

```java
/**
 * 使用 OFFSET FETCH 生成分页 SQL
 * 
 * @param pageNum 页码（从 1 开始）
 * @param pageSize 每页条数
 * @return 分页 SQL
 */
public String generateOffsetFetchSQL(int pageNum, int pageSize) {
    int offset = (pageNum - 1) * pageSize;
    
    return String.format(
        "SELECT OrderID, OrderDate, CustomerID, TotalAmount " +
        "FROM Orders " +
        "ORDER BY OrderDate DESC, OrderID DESC " +
        "OFFSET %d ROWS " +
        "FETCH NEXT %d ROWS ONLY",
        offset, pageSize
    );
}
```

### OFFSET FETCH 的优势

```java
/**
 * OFFSET FETCH vs ROW_NUMBER() 性能对比
 * 
 * 关键区别：
 * 1. OFFSET FETCH 是 SQL Server 原生优化
 * 2. ROW_NUMBER() 需要创建完整的序号列
 * 3. 在大偏移量时，OFFSET FETCH 可能更优（取决于执行计划）
 */
public class PaginationComparison {
    
    /**
     * 性能测试场景
     * 
     * 假设表有 1000 万条记录，OrderID 是主键
     * 
     * @param pageNum 页码
     * @param pageSize 每页条数
     */
    public void comparePerformance(int pageNum, int pageSize) {
        int offset = (pageNum - 1) * pageSize;
        
        System.out.println("=== 两种分页方式对比 ===");
        System.out.println();
        
        System.out.println("方案 1：ROW_NUMBER()");
        System.out.println("  WITH OrderedData AS (");
        System.out.println("    SELECT ROW_NUMBER() OVER (ORDER BY OrderID) AS RN, *");
        System.out.println("    FROM Orders");
        System.out.println("  ) SELECT * FROM OrderedData");
        System.out.println("  WHERE RN BETWEEN " + (offset + 1) + " AND " + (offset + pageSize));
        
        System.out.println();
        System.out.println("方案 2：OFFSET FETCH（推荐）");
        System.out.println("  SELECT * FROM Orders");
        System.out.println("  ORDER BY OrderID");
        System.out.println("  OFFSET " + offset + " ROWS");
        System.out.println("  FETCH NEXT " + pageSize + " ROWS ONLY");
        
        System.out.println();
        System.out.println("性能建议：");
        System.out.println("  - 小偏移量（<10000）：两者性能相近");
        System.out.println("  - 大偏移量：考虑使用键值分页");
        System.out.println("  - 关键：确保 ORDER BY 列有索引");
    }
}
```

## 键值分页：解决大偏移量性能问题

当偏移量非常大时（如查询第 100 万页），即使 `OFFSET` 很快，扫描 100 万条记录的开销也很大。

这时可以使用**键值分页（Keyset Pagination）**：

```sql
-- 普通 OFFSET FETCH（查询第 100001 页）
SELECT * FROM Orders
ORDER BY OrderDate DESC, OrderID DESC
OFFSET 2000000 ROWS
FETCH NEXT 20 ROWS ONLY;

-- 键值分页（基于上一页最后一条的 OrderID）
-- 假设上一页最后一条是 OrderID = 5000
SELECT TOP 20 * FROM Orders
WHERE OrderID < 5000  -- 利用主键索引
ORDER BY OrderID DESC;
```

```java
/**
 * 键值分页实现
 * 
 * 思路：不用 OFFSET，用 WHERE 条件定位起始位置
 * 优点：不受偏移量影响，性能稳定
 * 缺点：不能跳页，只能「下一页」
 */
public class KeysetPagination {
    
    /**
     * 键值分页查询
     * 
     * @param lastSeenOrderId 上一页最后一条的 OrderID
     * @param pageSize 每页条数
     * @return 分页 SQL
     */
    public String generateKeysetSQL(Long lastSeenOrderId, int pageSize) {
        // 第一页没有 lastSeenOrderId
        if (lastSeenOrderId == null) {
            return String.format(
                "SELECT TOP %d * FROM Orders ORDER BY OrderID DESC",
                pageSize
            );
        }
        
        // 后续页使用键值条件
        return String.format(
            "SELECT TOP %d * FROM Orders " +
            "WHERE OrderID < %d " +
            "ORDER BY OrderID DESC",
            pageSize, lastSeenOrderId
        );
    }
    
    /**
     * 复合键值分页（多列排序时）
     */
    public String generateCompositeKeysetSQL(
            LocalDateTime lastSeenDate, Long lastSeenId, int pageSize) {
        
        if (lastSeenDate == null) {
            return String.format(
                "SELECT TOP %d * FROM Orders ORDER BY OrderDate DESC, OrderID DESC",
                pageSize
            );
        }
        
        // 复合条件：OrderDate 小于 OR (等于 AND OrderID 小于)
        return String.format(
            "SELECT TOP %d * FROM Orders " +
            "WHERE (OrderDate < '%s') " +
            "   OR (OrderDate = '%s' AND OrderID < %d) " +
            "ORDER BY OrderDate DESC, OrderID DESC",
            pageSize, lastSeenDate, lastSeenDate, lastSeenId
        );
    }
}
```

## 获取总记录数的优化

前端分页导航需要总记录数，但 `COUNT(*)` 在大表上很慢。可以考虑：

### 方案一：单独查询

```sql
-- 两条语句分开执行
SELECT COUNT(*) FROM Orders WHERE ...;
SELECT * FROM Orders WHERE ... OFFSET ... FETCH ...;
```

### 方案二：使用窗口函数

```sql
-- 一次查询，同时返回数据和总数
SELECT *,
    COUNT(*) OVER() AS TotalCount
FROM Orders
WHERE ...
ORDER BY OrderDate DESC
OFFSET 0 ROWS FETCH NEXT 20 ROWS ONLY;
```

**注意**：如果过滤后数据量很大，`COUNT(*) OVER()` 仍然需要扫描全表。

### 方案三：缓存总记录数

```java
/**
 * 总记录数缓存策略
 * 
 * 场景：订单列表页，实时性要求不高
 * 
 * @param tableName 表名
 * @param whereClause 查询条件
 * @return 总记录数
 */
public long getTotalCountWithCache(String tableName, String whereClause) {
    // 1. 尝试从缓存获取
    String cacheKey = "count:" + tableName + ":" + whereClause.hashCode();
    Long cachedCount = cache.get(cacheKey);
    
    if (cachedCount != null) {
        return cachedCount;
    }
    
    // 2. 缓存未命中，查询数据库
    String sql = "SELECT COUNT(*) FROM " + tableName + " WHERE " + whereClause;
    long count = jdbcTemplate.queryForObject(sql, Long.class);
    
    // 3. 写入缓存（5 分钟过期）
    cache.set(cacheKey, count, Duration.ofMinutes(5));
    
    return count;
}
```

## 分页与索引

分页查询的性能瓶颈在于**排序**，而排序性能依赖索引。

```sql
-- 分页查询最理想的索引结构
-- 覆盖索引：包含所有 SELECT 和 WHERE 的列
CREATE NONCLUSTERED INDEX IX_Orders_Paging 
ON Orders (OrderDate DESC, OrderID DESC)  -- 排序列
INCLUDE (CustomerID, TotalAmount);         -- 查询列
```

```java
/**
 * 分页性能优化检查清单
 */
public class PaginationOptimization {
    
    public void printChecklist() {
        System.out.println("=== 分页查询性能检查清单 ===");
        System.out.println();
        System.out.println("1. 索引优化");
        System.out.println("   - ORDER BY 列是否有索引？");
        System.out.println("   - WHERE 条件列是否有索引？");
        System.out.println("   - 是否创建覆盖索引？");
        System.out.println();
        System.out.println("2. 查询优化");
        System.out.println("   - 偏移量是否过大？（考虑键值分页）");
        System.out.println("   - 是否使用 SELECT *？（改用具体列）");
        System.out.println("   - WHERE 条件是否会导致索引失效？");
        System.out.println();
        System.out.println("3. 总数优化");
        System.out.println("   - 是否真的需要实时总数？");
        System.out.println("   - 是否可以缓存总数？");
        System.out.println("   - 总数是否可以使用近似值？");
    }
}
```

## 总结

SQL Server 分页查询的三种方案：

| 方案 | 适用版本 | 性能 | 可读性 |
|------|---------|------|--------|
| 嵌套 TOP | 2000+ | 差 | 差 |
| ROW_NUMBER() | 2005+ | 中 | 中 |
| OFFSET FETCH | 2012+ | 好 | 好 |

**推荐**：使用 SQL Server 2012+ 的 `OFFSET FETCH` 语法，配合覆盖索引，性能最优。

---

**面试追问方向：**

- 如果 ORDER BY 的列没有索引，会发生什么？
- 大偏移量分页（查询第 100 万页）有什么性能问题？如何优化？
- COUNT(*) 和 COUNT(1) 在 SQL Server 中有性能差异吗？

这些问题，值得你在实践中验证。
