# 索引结构：B+ 树的艺术

数据库查询慢，加个索引就快了——这是很多人的认知。

但如果你追问：索引到底是什么结构？为什么 B+ 树比 B 树更适合数据库？索引是怎么加快查询的？很多人就答不上来了。

今天，我们来深入理解 SQL Server 索引的底层结构。

## 为什么需要索引？

想象图书馆的例子：如果书籍按入库顺序摆放，想找「所有关于 Java 的书」，你只能从头到尾一本一本翻。

但如果建一个「按主题分类的索引卡」，你只需：
1. 在索引卡上找到「Java」分类
2. 根据索引卡上的位置信息，直接去对应书架取书

索引的作用，就是让你**不用扫描全表就能找到数据**。

## B+ 树：SQL Server 索引的基石

SQL Server 的聚集索引和非聚集索引，都使用 **B+ 树** 作为存储结构。

### B+ 树 vs B 树

| 特性 | B 树 | B+ 树 |
|------|------|-------|
| 数据存储位置 | 所有节点都存储数据 | 只有叶子节点存储数据 |
| 查询稳定性 | 最快 O(log n)，最慢也是 O(log n) | 范围查询 O(log n + k) 更稳定 |
| 叶子节点连接 | 无 | 叶子节点之间有双向链表 |
| 磁盘 I/O | 较多 | 更少（因为非叶子节点不存数据） |

B+ 树更适合数据库，因为：
1. **磁盘 I/O 更少** — 非叶子节点更小，可以一次读入更多层
2. **范围查询更快** — 叶子节点的链表让范围扫描是顺序 I/O
3. **查询性能稳定** — 所有查询都需要到达叶子节点

### B+ 树的结构

```
                    [15 | 50 | 80]
                    /    |    \
            [1-14]    [16-49]    [51-79]    [81-100]
              |          |          |           |
         叶子节点 ←→ 叶子节点 ←→ 叶子节点 ←→ 叶子节点 ←→
         (数据页)     (数据页)     (数据页)     (数据页)
```

```
B+ 树（假设每个节点最多 4 个键）
层数 = ceil(log_m(n))，其中 m 是每个节点最多子节点数

10亿条数据，m=100 时，层数 = ceil(log_100(1,000,000,000)) ≈ 5

5 层意味着最多 5 次磁盘 I/O 就能定位到任何一条记录
```

## 页与 B+ 树的关系

在 SQL Server 中：

- **每页 8KB**，是 B+ 树的最小存储单元
- **非叶子节点页** — 存储索引键和子页指针
- **叶子节点页** — 存储实际数据或指向数据的指针

```java
/**
 * B+ 树索引存储模型
 * 
 * 说明：
 * - 假设每页可存储 100 个索引条目
 * - 每个非叶子节点指向 100 个子页
 * - 5 层 B+ 树最多可索引 10^10 条记录
 */
public class BPlusTreeStorage {
    
    /**
     * 计算 B+ 树的层数
     * 
     * @param recordCount 表中记录数
     * @param recordsPerPage 每页可存储的记录数（假设 100）
     * @param pointersPerPage 每页可存储的指针数（假设 100）
     * @return 树的高度（层数）
     */
    public int calculateTreeHeight(long recordCount, 
                                   int recordsPerPage, 
                                   int pointersPerPage) {
        int height = 1;
        long recordsAtLevel = recordsPerPage;
        
        // 叶子层能存储的记录数
        while (recordsAtLevel < recordCount) {
            height++;
            // 每上一层，可索引的子页数增加 pointersPerPage 倍
            recordsAtLevel *= pointersPerPage;
        }
        
        return height;
    }
    
    /**
     * 估算查询性能（磁盘 I/O 次数）
     * 
     * 特点：
     * - 每层最多 1 次随机 I/O
     * - 范围查询只需扫描叶子层的连续页面
     */
    public int estimateIO(int treeHeight, boolean isRangeQuery, int rangePages) {
        // 定位目标记录的 I/O
        int pointIO = treeHeight;
        
        if (isRangeQuery) {
            // 范围查询：定位 + 顺序扫描叶子页
            return pointIO + rangePages;
        }
        
        return pointIO;
    }
}
```

## 聚集索引 vs 非聚集索引

这是 SQL Server 索引最核心的概念。

### 聚集索引（Clustered Index）

聚集索引的**叶子节点存储实际数据**。一个表只能有一个聚集索引（因为数据只能按一种方式排序）。

```
聚集索引 B+ 树结构：

                    [主键值]
                    /      \
            [较小主键]      [较大主键]
               |               |
          叶子页（存储完整行数据）
```

**特点**：
- 表数据按索引键排序存储
- 查询聚集索引，相当于直接读取数据
- 适合范围查询（数据物理有序）
- 主键默认创建聚集索引

### 非聚集索引（Nonclustered Index）

非聚集索引的**叶子节点存储索引键和行定位符**。一个表可以有多个非聚集索引。

```
非聚集索引 B+ 树结构：

                    [索引键值]
                    /        \
            [较小键值]          [较大键值]
               |                   |
          叶子页（存储：索引键 + 行定位符）
```

**行定位符**的格式：
- 如果表有聚集索引：存储聚集索引键值
- 如果是堆表（无聚集索引）：存储物理行标识符（RID = 文件号:页号:槽号）

### 对比总结

| 特性 | 聚集索引 | 非聚集索引 |
|------|---------|-----------|
| 叶子节点 | 存储完整行数据 | 存储索引键 + 定位符 |
| 数量限制 | 每个表 1 个 | 每个表最多 249 个 |
| 查询类型 | 范围查询快 | 定位查询快 |
| 创建方式 | `CREATE CLUSTERED INDEX` | `CREATE NONCLUSTERED INDEX` |

## 覆盖索引：索引的「一站式服务」

如果一个索引包含了查询需要的所有列，就称为**覆盖索引（Covering Index）**。使用覆盖索引时，无需回表，性能最优。

```sql
-- 创建覆盖索引
CREATE INDEX IX_Orders_Covering 
ON Orders (CustomerID, OrderDate)  -- 查询条件
INCLUDE (TotalAmount, Status);     -- 查询需要的列
```

```sql
-- 这个查询会被覆盖索引完全满足，无需回表
SELECT OrderDate, TotalAmount, Status
FROM Orders
WHERE CustomerID = 1001;
```

```java
/**
 * 覆盖索引判断逻辑
 * 
 * 一个索引能否覆盖查询，需要满足：
 * 1. 查询条件列在索引键中（等值或范围）
 * 2. SELECT 列在 INCLUDE 中，或本身就是索引键
 * 3. 排序列在索引键中（按顺序）
 */
public class CoveringIndexChecker {
    
    /**
     * 判断索引是否能覆盖查询
     */
    public boolean canCover(Query query, Index index) {
        // 1. 检查查询条件列
        for (String col : query.whereColumns) {
            if (!index.containsColumn(col)) {
                return false;
            }
        }
        
        // 2. 检查 SELECT 列
        for (String col : query.selectColumns) {
            if (!index.containsColumn(col) && !index.includesColumn(col)) {
                return false;
            }
        }
        
        // 3. 检查 ORDER BY 列
        for (String col : query.orderByColumns) {
            if (!index.containsColumn(col)) {
                return false;
            }
        }
        
        return true;
    }
}
```

## 索引的物理存储

### IAM 页：索引的「地图」

每个索引都有一个或多个 **IAM（Index Allocation Map）页**，记录该索引使用了哪些区。

```sql
-- 查看表的 IAM 信息
DBCC IND('YourDatabase', 'YourTable', 1);  -- 1 = 聚集索引
```

### 索引的 B+ 树层级

```sql
-- 使用 DBCC PAGE 查看索引页内容
DBCC TRACEON(3604);
DBCC PAGE('YourDatabase', 1, 页号, 3);
DBCC TRACEOFF(3604);
```

### sys.dm_db_index_physical_stats 查看索引碎片

```sql
-- 查看索引的物理统计信息
SELECT 
    OBJECT_NAME(i.object_id) AS TableName,
    i.name AS IndexName,
    ips.avg_fragmentation_in_percent,
    ips.page_count,
    ips.avg_page_space_used_in_percent,
    ips.index_type_desc,
    ips.depth AS TreeDepth,
    ips.forwarded_record_count
FROM sys.dm_db_index_physical_stats(
    DB_ID(), NULL, NULL, NULL, 'DETAILED'
) ips
JOIN sys.indexes i ON ips.object_id = i.object_id AND ips.index_id = i.index_id
WHERE OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
ORDER BY ips.page_count DESC;
```

**碎片类型**：
| 碎片类型 | 含义 | 解决方案 |
|---------|------|---------|
| 外部碎片 | 逻辑顺序与物理顺序不一致 | `ALTER INDEX REORGANIZE` 或 `REBUILD` |
| 内部碎片 | 页内空间未填满 | `ALTER INDEX REBUILD` |

## 总结

SQL Server 索引的核心要点：

1. **B+ 树是索引的存储结构** — 保证查询 O(log n) 的复杂度
2. **聚集索引 = 数据本身** — 数据按索引键物理排序
3. **非聚集索引 = 索引键 + 定位符** — 需要回表定位数据
4. **覆盖索引 = 索引包含所有需要的数据** — 避免回表，性能最优

---

**面试追问方向：**

- B+ 树和 B 树的核心区别是什么？为什么数据库索引用 B+ 树？
- 如果表没有主键，会发生什么？（堆表的问题）
- 索引碎片是怎么产生的？`REORGANIZE` 和 `REBUILD` 的区别是什么？

这些问题，值得你在实践中验证。
