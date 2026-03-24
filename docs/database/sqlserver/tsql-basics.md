# T-SQL 基础：让 SQL 变得有条理

你用过 SQL，但觉得 SQL Server 的 T-SQL 语法有点别扭？

`SELECT TOP 10` 而不是 `LIMIT 10`？变量要用 `@` 开头？存储过程怎么写？

别急，T-SQL 只是扩展了标准 SQL，添加了变量、控制流、函数等编程能力。学会它，你的 SQL 会变得有条理。

今天，我们来系统学习 T-SQL 的核心语法。

## 变量与数据类型

### 声明变量

T-SQL 使用 `DECLARE` 声明变量，变量名以 `@` 开头：

```sql
-- 声明单个变量
DECLARE @UserName NVARCHAR(50);
DECLARE @UserCount INT;

-- 声明多个变量
DECLARE @StartDate DATETIME, 
        @EndDate DATETIME,
        @Status TINYINT;

-- 声明并赋值（使用 SET 或 SELECT）
DECLARE @Today DATE = GETDATE();
DECLARE @MaxId INT = (SELECT MAX(ID) FROM Users);
```

### 局部变量 vs 全局变量

| 类型 | 写法 | 作用域 | 示例 |
|------|------|--------|------|
| 局部变量 | `@name` | 当前批处理/会话 | `DECLARE @x INT` |
| 全局变量 | `@@name` | 整个服务器实例 | `@@ROWCOUNT`, `@@ERROR` |

```sql
-- 全局变量示例
SELECT @@VERSION;              -- SQL Server 版本
SELECT @@SERVERNAME;           -- 服务器名称
SELECT @@ROWCOUNT;             -- 上条语句影响的行数
SELECT @@IDENTITY;             -- 最后插入的标识值
```

## 流程控制

T-SQL 支持常见的编程结构，让你的 SQL 可以「做判断」和「循环」。

### IF...ELSE

```sql
DECLARE @OrderCount INT;
SELECT @OrderCount = COUNT(*) FROM Orders WHERE CustomerID = 1001;

IF @OrderCount > 100
BEGIN
    PRINT 'VIP 客户';
    -- 可以执行多条语句
    SELECT 'Premium discount applied' AS Result;
END
ELSE IF @OrderCount > 50
BEGIN
    PRINT '高级客户';
END
ELSE
BEGIN
    PRINT '普通客户';
END
```

### WHILE 循环

```sql
-- 计算 1 到 100 的和
DECLARE @Sum INT = 0;
DECLARE @Counter INT = 1;

WHILE @Counter <= 100
BEGIN
    SET @Sum = @Sum + @Counter;
    SET @Counter = @Counter + 1;
    
    -- 可选：避免无限循环
    IF @Counter > 1000
        BREAK;
END

SELECT @Sum AS TotalSum;
```

### CASE 表达式

`CASE` 是 SQL 中的「switch」，用于在查询中做条件判断：

```sql
SELECT 
    ProductName,
    UnitPrice,
    UnitsInStock,
    CASE 
        WHEN UnitsInStock = 0 THEN '缺货'
        WHEN UnitsInStock < 10 THEN '库存紧张'
        WHEN UnitsInStock < 50 THEN '库存正常'
        ELSE '库存充足'
    END AS StockStatus,
    CASE 
        WHEN UnitPrice < 10 THEN '低价'
        WHEN UnitPrice < 50 THEN '中价'
        ELSE '高价'
    END AS PriceLevel
FROM Products
ORDER BY UnitPrice DESC;
```

### TRY...CATCH 错误处理

```sql
BEGIN TRY
    -- 可能出错的语句
    INSERT INTO Products (ProductName, UnitPrice)
    VALUES ('NewProduct', -100);  -- 价格不能为负数
    
END TRY
BEGIN CATCH
    -- 错误处理
    SELECT 
        ERROR_NUMBER() AS ErrorNumber,
        ERROR_MESSAGE() AS ErrorMessage,
        ERROR_LINE() AS ErrorLine,
        ERROR_SEVERITY() AS ErrorSeverity,
        ERROR_STATE() AS ErrorState;
        
    -- 可以根据错误号做不同处理
    IF ERROR_NUMBER() = 547  -- 约束违反
        PRINT '数据验证失败';
    
    -- 可以抛出自定义错误
    ;THROW 50001, '自定义错误消息', 1;
END CATCH
```

## 函数

### 系统函数

```sql
-- 字符串函数
SELECT LEFT('Hello World', 5);           -- 'Hello'
SELECT RIGHT('Hello World', 5);           -- 'World'
SELECT LEN('Hello World');                 -- 11（不含尾部空格）
SELECT DATALENGTH('Hello World');          -- 12（含尾部空格）
SELECT SUBSTRING('Hello World', 7, 5);     -- 'World'
SELECT CHARINDEX('World', 'Hello World'); -- 7
SELECT REPLACE('Hello World', 'World', 'SQL');  -- 'Hello SQL'

-- 日期函数
SELECT GETDATE();                          -- 当前时间
SELECT GETUTCDATE();                       -- UTC 时间
SELECT DATEADD(DAY, 7, GETDATE());        -- 加 7 天
SELECT DATEDIFF(DAY, '2024-01-01', GETDATE());  -- 天数差
SELECT YEAR(GETDATE()), MONTH(GETDATE()), DAY(GETDATE());

-- 聚合函数
SELECT 
    COUNT(*) AS TotalCount,
    COUNT(DISTINCT CustomerID) AS UniqueCustomers,
    SUM(Amount) AS TotalAmount,
    AVG(Amount) AS AvgAmount,
    MIN(Amount) AS MinAmount,
    MAX(Amount) AS MaxAmount
FROM Orders;
```

### 自定义函数

T-SQL 支持创建标量函数和表值函数：

```sql
-- 标量函数：返回一个值
CREATE FUNCTION dbo.fn_CalculateDiscount
(
    @OriginalPrice DECIMAL(18,2),
    @DiscountRate DECIMAL(5,4)  -- 如 0.15 表示 15%
)
RETURNS DECIMAL(18,2)
AS
BEGIN
    RETURN @OriginalPrice * (1 - @DiscountRate);
END
GO

-- 使用标量函数
SELECT 
    ProductName,
    UnitPrice,
    dbo.fn_CalculateDiscount(UnitPrice, 0.1) AS DiscountedPrice
FROM Products;
```

```sql
-- 表值函数：返回一个表
CREATE FUNCTION dbo.fn_GetOrdersByCustomer
(
    @CustomerID INT
)
RETURNS TABLE
AS
RETURN
(
    SELECT OrderID, OrderDate, TotalAmount
    FROM Orders
    WHERE CustomerID = @CustomerID
)
GO

-- 使用表值函数（像表一样查询）
SELECT * FROM dbo.fn_GetOrdersByCustomer(1001);
```

## 批处理与脚本

### GO 命令

`GO` 不是 SQL 语句，是客户端工具（如 SSMS）的命令，表示**批处理的结束**：

```sql
-- 第一批：创建表
CREATE TABLE TempTable (
    ID INT PRIMARY KEY,
    Name NVARCHAR(50)
);

GO

-- 第二批：插入数据
INSERT INTO TempTable VALUES (1, '张三');
INSERT INTO TempTable VALUES (2, '李四');

GO

-- 第三批：查询
SELECT * FROM TempTable;
```

### 变量作用域

变量在批处理内有效，跨批处理需要传递或持久化：

```sql
DECLARE @MaxPrice DECIMAL(18,2) = 100;
GO

-- 这里 @MaxPrice 不存在，作用域已结束
-- 需要重新声明或使用临时表传递
```

## 临时表

### 局部临时表

`#` 开头的临时表，只在当前会话中可见：

```sql
-- 创建局部临时表
CREATE TABLE #TempOrders (
    OrderID INT,
    CustomerName NVARCHAR(100),
    OrderDate DATETIME
);

-- 插入数据
INSERT INTO #TempOrders
SELECT o.OrderID, c.CustomerName, o.OrderDate
FROM Orders o
JOIN Customers c ON o.CustomerID = c.CustomerID
WHERE o.OrderDate >= '2024-01-01';

-- 使用临时表
SELECT * FROM #TempOrders WHERE CustomerName LIKE '张%';

-- 完成后删除
DROP TABLE #TempOrders;
```

### 全局临时表

`##` 开头的临时表，所有会话都可以访问，会话断开后自动删除：

```sql
CREATE TABLE ##GlobalConfig (
    ConfigKey NVARCHAR(50),
    ConfigValue NVARCHAR(200)
);
```

### 表变量

`@` 开头的表变量，在 batches 和存储过程中使用更方便：

```sql
DECLARE @OrderItems TABLE (
    ItemID INT PRIMARY KEY,
    ProductName NVARCHAR(100),
    Quantity INT,
    UnitPrice DECIMAL(18,2)
);

INSERT INTO @OrderItems VALUES (1, '产品A', 2, 50.00);
INSERT INTO @OrderItems VALUES (2, '产品B', 1, 120.00);

SELECT * FROM @OrderItems;
```

| 特性 | 临时表 (#) | 表变量 (@) |
|------|-----------|-----------|
| 作用域 | 当前会话 | 当前批处理 |
| 事务支持 | 参与 | 不参与 |
| 统计信息 | 有 | 无 |
| 索引 | 可以建索引 | 只能在声明时建 |
| 数据量 | 较大 | 较小 |
| 适合场景 | 中间结果集、大数据 | 参数、少量数据 |

## 常用技巧

### NULL 处理

```sql
-- ISNULL：NULL 时返回默认值
SELECT ISNULL(NULL, 'N/A');  -- 'N/A'

-- COALESCE：返回第一个非 NULL 值
SELECT COALESCE(NULL, NULL, '第三个', '第四个');  -- '第三个'

-- NULLIF：相等时返回 NULL
SELECT NULLIF(10, 10);   -- NULL
SELECT NULLIF(10, 20);   -- 10
```

### 字符串拼接

```sql
-- 使用 +
SELECT 'Hello' + ' ' + 'World';

-- 使用 CONCAT（自动处理 NULL）
SELECT CONCAT('Hello', NULL, 'World');  -- 'HelloWorld'

-- 使用 CONCAT_WS（带分隔符）
SELECT CONCAT_WS('-', '2024', '01', '15');  -- '2024-01-15'
```

### 开窗函数

```java
/**
 * 开窗函数应用场景
 * 
 * 场景：计算每个部门的工资排名、部门内平均工资
 * 
 * 关键概念：
 * - OVER()：定义窗口
 * - PARTITION BY：分组
 * - ORDER BY：排序
 * - ROW_NUMBER / RANK / DENSE_RANK：排名方式
 */
public class WindowFunctionExamples {
    
    /**
     * 典型场景：
     * 1. 计算累计销售额
     * 2. 计算每个客户的订单排名
     * 3. 计算与平均值的差异
     */
    public void printExamples() {
        System.out.println("=== T-SQL 开窗函数 ===");
        System.out.println();
        
        // 场景 1：累计值
        System.out.println("累计销售额：");
        System.out.println("SUM(Amount) OVER (ORDER BY OrderDate) AS CumulativeSum");
        
        // 场景 2：分组排名
        System.out.println("部门内排名：");
        System.out.println("ROW_NUMBER() OVER (PARTITION BY Department ORDER BY Salary DESC)");
        
        // 场景 3：移动平均
        System.out.println("最近 7 天平均：");
        System.out.println("AVG(Amount) OVER (ORDER BY Date ROWS 6 PRECEDING)");
    }
}
```

对应的 SQL 示例：

```sql
-- 每个部门的工资排名
SELECT 
    EmployeeName,
    Department,
    Salary,
    ROW_NUMBER() OVER (PARTITION BY Department ORDER BY Salary DESC) AS Rank,
    AVG(Salary) OVER (PARTITION BY Department) AS DeptAvgSalary,
    Salary - AVG(Salary) OVER (PARTITION BY Department) AS DiffFromAvg
FROM Employees;
```

## 总结

T-SQL 的核心是让 SQL 变得**可编程**：

1. **变量和流程控制** — 让 SQL 可以做判断和循环
2. **错误处理** — 让脚本更健壮
3. **函数** — 封装可复用的逻辑
4. **临时表** — 处理复杂中间结果
5. **开窗函数** — 在不分组的情况下计算聚合

---

**面试追问方向：**

- 临时表和表变量的区别？什么时候用哪个？
- `GO` 和 `SELECT` 的区别？`GO` 是 SQL 语句吗？
- TRY...CATCH 能捕获所有错误吗？有哪些错误是捕获不到的？

这些问题，值得你在实践中深入探索。
