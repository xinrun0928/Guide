# 索引类型：不仅仅是 B+ 树

提到索引，很多人只知道 B+ 树索引。

但 SQL Server 还有**列存储索引**、**空间索引**、**全文索引**、**XML 索引**……每种索引都有它的用武之地。

今天，我们来全面了解 SQL Server 支持的索引类型。

## 索引类型总览

```
SQL Server 索引家族：

├── B+ 树索引（行存储）
│   ├── 聚集索引
│   └── 非聚集索引
│
├── B+ 树索引（列存储）SQL Server 2012+
│   ├── 聚集列存储索引
│   └── 非聚集列存储索引
│
├── 特殊索引
│   ├── 唯一索引
│   ├── 过滤索引
│   ├── 复合索引
│   ├── 包含列索引
│   ├── 全文本索引
│   ├── XML 索引
│   └── 空间索引
│
└── 其他结构
    ├── 哈希索引（内存优化表）
    └── 非聚集索引（内存优化表）
```

## 唯一索引：数据的「身份证」

唯一索引确保索引键的值不重复。

```sql
-- 创建唯一非聚集索引
CREATE UNIQUE NONCLUSTERED INDEX IX_Users_Email
ON Users(Email);

-- 或者在创建表时
CREATE TABLE Users (
    UserID INT PRIMARY KEY,
    Email NVARCHAR(100) UNIQUE,  -- 唯一约束自动创建唯一索引
    UserName NVARCHAR(50)
);
```

**特点**：
- 允许 NULL 值，但只能有一个
- 自动创建唯一性检查
- 主键自动是唯一的

## 过滤索引：精准打击

过滤索引只对满足条件的行创建索引，适合**稀疏数据**。

```sql
-- 普通索引：包含所有 IsDeleted = 0 和 IsDeleted = 1 的行
CREATE INDEX IX_Orders_Status ON Orders(Status);

-- 过滤索引：只索引活跃订单
CREATE INDEX IX_Orders_Active 
ON Orders(CustomerID, OrderDate) 
WHERE Status = 'Active';
```

```java
/**
 * 过滤索引适用场景
 * 
 * 什么时候用过滤索引：
 * 1. 查询条件包含 WHERE 过滤条件
 * 2. 过滤后的数据量远小于总数据量
 * 3. 过滤条件是稳定的（不变的值）
 */
public class FilteredIndexScenarios {
    
    /**
     * 判断是否适合使用过滤索引
     */
    public boolean isGoodCandidate(String filterCondition, 
                                   double filteredRatio) {
        // 过滤后数据占比小于 20%，适合
        return filteredRatio < 0.2;
    }
}
```

**常见使用场景**：

| 场景 | 过滤条件 | 优势 |
|------|---------|------|
| 软删除表 | `WHERE IsDeleted = 0` | 只索引未删除数据 |
| 归档表 | `WHERE IsActive = 1` | 只索引活跃记录 |
| 状态枚举 | `WHERE Status = 'Active'` | 减少索引体积 |
| 稀疏列 | `WHERE Fax IS NOT NULL` | 只索引有值的行 |

## 复合索引：多列组合

复合索引是在多个列上创建的索引。

```sql
CREATE INDEX IX_Orders_CustomerDate 
ON Orders(CustomerID, OrderDate DESC, Status);
```

### 最左前缀原则

这是复合索引最重要的原则：

```sql
-- 假设有索引 IX(CustomerID, OrderDate, Status)

-- ✅ 能使用索引（从左到右）
SELECT * FROM Orders WHERE CustomerID = 100;
SELECT * FROM Orders WHERE CustomerID = 100 AND OrderDate > '2024-01-01';
SELECT * FROM Orders WHERE CustomerID = 100 AND OrderDate = '2024-01-01' AND Status = 'Shipped';

-- ⚠️ 部分使用索引（跳过中间列）
SELECT * FROM Orders WHERE CustomerID = 100 AND Status = 'Shipped';
-- 只能使用 CustomerID 部分

-- ❌ 不能使用索引（跳过最左列）
SELECT * FROM Orders WHERE OrderDate > '2024-01-01';
SELECT * FROM Orders WHERE Status = 'Shipped';
```

```java
/**
 * 复合索引列顺序设计策略
 * 
 * 原则：
 * 1. 区分度高的列放前面（减少候选行数）
 * 2. 等值查询的列放范围查询列前面
 * 3. 常一起查询的列放在一起
 */
public class CompositeIndexStrategy {
    
    /**
     * 评估复合索引列顺序
     */
    public int evaluateOrder(List<String> columns, QueryPattern[] patterns) {
        int score = 100;
        
        for (QueryPattern p : patterns) {
            int matchLength = calculateMatchLength(columns, p);
            
            if (matchLength == 0) {
                score -= 50;  // 完全不匹配，扣分严重
            } else if (matchLength == columns.size()) {
                // 完美匹配，不扣分
            } else {
                // 部分匹配，扣一定分数
                score -= (columns.size() - matchLength) * 10;
            }
        }
        
        return score;
    }
    
    /**
     * 计算匹配的列数（按最左前缀原则）
     */
    private int calculateMatchLength(List<String> columns, QueryPattern p) {
        int matchCount = 0;
        for (String col : columns) {
            if (p.whereColumns.contains(col)) {
                matchCount++;
            } else {
                break;  // 不匹配就停止
            }
        }
        return matchCount;
    }
}
```

## 包含列索引：扩大覆盖范围

INCLUDE 索引可以添加非键列到叶子节点，避免回表。

```sql
-- 方式一：INCLUDE（SQL Server 2005+）
CREATE INDEX IX_Orders_CustomerID 
ON Orders(CustomerID)
INCLUDE (OrderDate, TotalAmount, Status);
-- 查询覆盖，无需回表
SELECT OrderDate, TotalAmount, Status 
FROM Orders WHERE CustomerID = 100;

-- 方式二：复合索引（INCLUDE 等价于把所有列放入键）
CREATE INDEX IX_Orders_CustomerID2 
ON Orders(CustomerID, OrderDate, TotalAmount, Status);
-- 两种方式效果类似，但有区别：
-- - INCLUDE 列不参与排序，不占用索引空间
-- - 键列有长度限制（900 字节），INCLUDE 没有
```

### 包含列 vs 复合索引

| 特性 | 包含列索引 | 复合索引 |
|------|----------|---------|
| 键列长度限制 | 900 字节 | 900 字节 |
| INCLUDE 列限制 | 无 | 无 |
| 排序优化 | 键列可以优化排序 | 键列可以优化排序 |
| 索引大小 | 通常更小 | 取决于键列宽度 |
| 适用场景 | 覆盖索引 | 等值 + 范围查询 |

## 全文索引：文本搜索利器

全文索引用于**模糊搜索**和**自然语言查询**。

```sql
-- 创建全文目录
CREATE FULLTEXT CATALOG FT_Catalog;

-- 创建全文索引
CREATE FULLTEXT INDEX ON Products(
    Description,    -- 要搜索的文本列
    Name            -- 要搜索的列
) KEY INDEX PK_Products  -- 唯一索引（主键）
ON FT_Catalog;

-- 使用全文谓词
SELECT * FROM Products
WHERE CONTAINS(Description, 'database');  -- 包含 database

SELECT * FROM Products
WHERE FREETEXT(Description, 'best database solution');  -- 语义相关

SELECT * FROM Products
WHERE CONTAINS(Description, '"data*"');  -- 通配符搜索
```

### 全文索引 vs LIKE

```java
/**
 * 全文索引 vs LIKE 性能对比
 */
public class FullTextVsLike {
    
    public void comparePerformance() {
        System.out.println("=== LIKE vs 全文索引 ===");
        System.out.println();
        
        System.out.println("LIKE '%keyword%'：");
        System.out.println("  - 必然全表扫描");
        System.out.println("  - 无法利用索引");
        System.out.println("  - 大文本列尤其慢");
        System.out.println();
        
        System.out.println("全文索引：");
        System.out.println("  - 倒排索引结构");
        System.out.println("  - 支持词根化、同义词");
        System.out.println("  - 性能是 LIKE 的 10-100 倍");
        System.out.println();
        
        System.out.println("适用场景：");
        System.out.println("  - LIKE 用于简单模式匹配");
        System.out.println("  - 全文用于复杂文本搜索");
    }
}
```

## XML 索引：结构化查询

SQL Server 支持对 XML 数据类型建立索引。

```sql
-- 创建主 XML 索引
CREATE PRIMARY XML INDEX PXML_Products_Spec
ON Products(Specification);

-- 创建二级 XML 索引（提升特定查询性能）
CREATE XML INDEX SXML_Products_Value
ON Products(Specification)
USING XML INDEX PXML_Products_Spec
FOR VALUE;  -- PATH, VALUE, PROPERTY

-- 查询示例
SELECT ProductID, ProductName
FROM Products
WHERE Specification.exist('/Product/Color[. = "Red"]') = 1;
```

## 空间索引：地理位置

空间索引用于 `GEOGRAPHY` 和 `GEOMETRY` 类型。

```sql
-- 创建空间索引
CREATE SPATIAL INDEX SIX_Stores_Location
ON Stores(Location)
USING GEOMETRY_AUTO_GRID;  -- 或 GEOMETRY_GRID

-- 查询：找出某点 10 公里范围内的门店
SELECT * FROM Stores
WHERE Location.STDistance(@Point) <= 10000;
```

## 索引设计最佳实践

```java
/**
 * 索引设计决策树
 */
public class IndexDesignBestPractices {
    
    public void printDecisionTree() {
        System.out.println("=== 索引设计决策树 ===");
        System.out.println();
        System.out.println("1. 唯一性检查");
        System.out.println("   → 有唯一性要求？ → 创建唯一索引");
        System.out.println();
        System.out.println("2. 查询覆盖检查");
        System.out.println("   → 能完全覆盖查询？ → 添加 INCLUDE 列");
        System.out.println();
        System.out.println("3. 列顺序检查");
        System.out.println("   → 复合索引？ → 区分度高的列放前面");
        System.out.println();
        System.out.println("4. 数据分布检查");
        System.out.println("   → 稀疏数据？ → 考虑过滤索引");
        System.out.println();
        System.out.println("5. 数据类型检查");
        System.out.println("   → 大文本？ → 考虑全文索引");
        System.out.println("   → XML？ → 创建 XML 索引");
        System.out.println("   → 地理位置？ → 创建空间索引");
    }
}
```

## 索引类型选择指南

| 需求 | 推荐索引类型 |
|------|------------|
| 主键 | 聚集索引（自增整数） |
| 唯一约束 | 唯一非聚集索引 |
| 外键查询 | 非聚集索引 |
| 范围查询 | 聚集索引或复合索引 |
| 模糊搜索 | 全文索引 |
| 大文本搜索 | 全文索引 |
| XML 查询 | XML 索引 |
| 地理位置 | 空间索引 |
| 稀疏条件 | 过滤索引 |

## 总结

SQL Server 的索引类型远不止 B+ 树：

1. **唯一索引** — 保证数据唯一性
2. **过滤索引** — 只索引满足条件的行，适合稀疏数据
3. **复合索引** — 多列组合，遵循最左前缀原则
4. **包含列索引** — 扩大覆盖范围，避免回表
5. **全文索引** — 文本搜索，比 LIKE 快 10-100 倍
6. **特殊索引** — XML、空间等针对特定数据类型

---

**面试追问方向：**

- 复合索引 `(A, B, C)` 和 `(A, C, B)` 有什么区别？
- 什么情况下过滤索引比普通索引更好？
- 全文索引的倒排索引结构是怎么工作的？

这些问题的答案，值得你在实践中探索。
