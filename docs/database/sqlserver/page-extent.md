# 页与区：SQL Server 的存储基石

你有 100GB 的数据，想知道它实际占用多少磁盘空间，该怎么算？

很多人会说：「看文件大小啊。」但如果我问你：文件里每一页存的是什么？为什么有时候表占用空间和实际数据量差好几倍？

这些问题的答案，都藏在 SQL Server 的**页（Page）和区（Extent）** 里。

## 为什么需要页和区？

SQL Server 存储数据的方式，不是按行随意散落，而是有严格的组织结构。

想象一下图书馆：如果书籍随意堆放，查找一本需要翻遍整个仓库。但如果用书架、格子、标签来组织，效率会提升百倍。

页和区，就是 SQL Server 的「书架格子」。

## 数据页：8KB 的固定容器

**数据页（Data Page）** 是 SQL Server 最基本的存储单位，大小固定为 **8KB**（8192 字节）。

### 页的结构

```
┌────────────────────────────────────────────────────────┐
│                    Page Header (96 字节)               │
│  页号 | 对象ID | 可用空间指针 | 其他元数据               │
├────────────────────────────────────────────────────────┤
│                                                        │
│                    Data Rows                            │
│                    (8076 字节可用)                       │
│                                                        │
│                                                        │
│                                                        │
│                                                        │
└────────────────────────────────────────────────────────┘
```

页头占 96 字节，剩余 **8060~8096 字节**（取决于行偏移数组大小）用于存储数据行。

### 页的类型

SQL Server 的页不只有一种：

| 页类型 | 说明 | 用途 |
|-------|------|------|
| Data Page | 数据页 | 存储表数据（堆或聚集索引叶子节点） |
| Index Page | 索引页 | 存储索引数据（索引树的中间节点和叶子节点） |
| Text/Image Page | 文本页 | 存储超过 8000 字节的文本、图像数据 |
| GAM Page | 全局分配映射 | 记录已分配的区 |
| SGAM Page | 共享全局分配映射 | 记录混合分配的区 |
| IAM Page | 索引分配映射 | 记录对象使用的区 |
| PFS Page | 页面可用空间 | 记录页面的可用空间百分比 |
| DCM Page | 更改映射 | 记录自上次 Checkpoint 后的变化 |

有意思的是，即使你只存储一个字节的字符串，SQL Server 也会占用整整一页。这导致了一个常见问题：**小表占空间大**，我们后面会详细讨论。

## 区：8 个连续的页

**区（Extent）** 是 SQL Server 的分配单元，由 **8 个连续的页** 组成，大小为 **64KB**（8 × 8KB）。

```
┌─────────────────────────────────────────────────────────┐
│                      Extent (64KB)                       │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ │
│  │ Page 1│ │ Page 2│ │ Page 3│ │ Page 4│ │ Page 5│ │ Page 6│ │ Page 7│ │ Page 8│ │
│  │ 8KB   │ │ 8KB   │ │ 8KB   │ │ 8KB   │ │ 8KB   │ │ 8KB   │ │ 8KB   │ │ 8KB   │ │
│  └───────┘ └───────┘ └───────┘ └───────┘ └───────┘ └───────┘ └───────┘ └───────┘ │
└─────────────────────────────────────────────────────────┘
```

### 区的类型

**统一区（Uniform Extent）** — 区中所有 8 个页都属于同一个对象。当表或索引需要扩展时，整区分配给它。

**混合区（Mixed Extent）** — 区中 8 个页属于不同对象。新建小表或小索引时，从混合区分配一页，避免空间浪费。

分配策略：**新对象先从混合区获取页，当对象超过 8 页后，后续分配都使用统一区。**

## 行存储结构：数据行怎么放？

### 定长数据类型

`INT`、`BIGINT`、`DATETIME`、`CHAR(n)` 等定长类型，占用固定字节，存储简单。

```java
/**
 * 模拟 SQL Server 行数据存储
 * 实际存储涉及复杂的字节序、NULL 位图等细节
 */
public class RowStorage {
    
    /**
     * 计算一行数据的存储大小
     */
    public int calculateRowSize(TableSchema schema, Object[] values) {
        int fixedSize = 0;   // 定长列
        int variableSize = 0; // 可变长列
        int nullBitmapSize = 0; // NULL 位图
        
        for (int i = 0; i < schema.columns.length; i++) {
            Column col = schema.columns[i];
            
            if (values[i] == null) {
                // NULL 值只在 NULL 位图中标记，不占实际空间
                continue;
            }
            
            if (col.isFixedLength()) {
                fixedSize += col.getStorageSize();
            } else {
                variableSize += col.getStorageSize(values[i]);
            }
        }
        
        // NULL 位图 = 2 + (列数 + 7) / 8
        nullBitmapSize = 2 + (schema.columns.length + 7) / 8;
        
        // 行大小 = 定长列 + 可变列 + NULL 位图 + 行偏移数组
        return fixedSize + variableSize + nullBitmapSize 
               + schema.columns.length * 2;
    }
}
```

### 可变长数据类型

`VARCHAR`、`NVARCHAR`、`VARBINARY` 等可变长类型，存储时分为两部分：

1. **列偏移数组** — 每列在行中的起始位置（2 字节/列）
2. **实际数据** — 存储在行末尾

有意思的是，VARCHAR 的最大长度是 **8000 字节**（非 Unicode）或 **4000 字符**（Unicode）。如果你需要存储更大的文本，SQL Server 会使用 **TEXTPAGE** 链式存储。

### 行溢出：大数据的分页存储

当一行数据超过 8060 字节时，SQL Server 会使用**行溢出（Row Overflow）** 机制：

```sql
CREATE TABLE BigRow (
    ID INT,
    BigColumn VARCHAR(10000)  -- 单列就超过 8KB
);

INSERT INTO BigRow VALUES (1, REPLICATE('A', 10000));
```

存储结构：

```
┌─────────────────────────────────────┐
│ 主数据页                              │
│ ID 列 + 行溢出指针（24字节）           │
│ 指针指向溢出页                         │
└─────────────────────────────────────┘
                ↓
┌─────────────────────────────────────┐
│ 行溢出页                              │
│ 存储 BigColumn 的超长部分              │
└─────────────────────────────────────┘
```

**重要提示**：包含行溢出数据的查询会比普通查询慢，因为需要额外的一次 I/O 来获取溢出数据。这也是为什么应该避免过宽的行。

## 如何查看页和区的信息？

SQL Server 提供了 `DBCC PAGE` 命令，可以查看数据页的内容：

```sql
-- 开启跟踪标志，查看页信息
DBCC TRACEON(3604);

-- 查看指定页的内容
DBCC PAGE('YourDatabase', 1, 1, 3);

-- 关闭跟踪标志
DBCC TRACEOFF(3604);
```

或者使用 `sp_spaceused` 查看表的空间使用：

```sql
EXEC sp_spaceused 'YourTable';
```

返回结果包含：

- `data` — 数据占用空间
- `index_size` — 索引占用空间
- `unused` — 已分配但未使用的空间

## 存储计算：你的数据占用多少空间？

```java
/**
 * 估算表的存储空间
 * 
 * 公式：
 * 数据空间 = 页数 × 8KB
 * 页数 ≈ 总行数 × 每行大小 / 8060（考虑碎片）
 */
public class StorageCalculator {
    
    /**
     * 估算数据表所需页数
     * 
     * @param rowCount 预估行数
     * @param avgRowSize 平均每行字节数
     * @return 预估页数
     */
    public long estimatePages(long rowCount, int avgRowSize) {
        // 有效载荷：每页约 8060 字节
        int payloadPerPage = 8060;
        
        // 考虑 10% 的碎片和空间浪费
        double wasteFactor = 1.1;
        
        return (long) Math.ceil(
            rowCount * avgRowSize * wasteFactor / payloadPerPage
        );
    }
    
    /**
     * 估算所需存储空间
     */
    public String estimateStorage(long rowCount, int avgRowSize) {
        long pages = estimatePages(rowCount, avgRowSize);
        long extents = (long) Math.ceil(pages / 8.0);
        long sizeKB = extents * 64;
        
        if (sizeKB > 1024) {
            return String.format("约 %.2f MB", sizeKB / 1024.0);
        }
        return sizeKB + " KB";
    }
}
```

## 碎片问题：空间浪费的隐形杀手

页和区的分配方式，导致了两类碎片：

### 内部碎片

由于页大小固定，如果每行平均 500 字节，一页只能存 16 行（8000/500），但页的最后 40 字节就浪费了。**内部碎片 = 已分配但未使用的空间**。

### 外部碎片

当数据频繁增删时，原本连续的区可能被不同对象使用，导致逻辑上的数据不连续。**外部碎片影响磁盘 I/O 效率**。

解决碎片的方案：

```sql
-- 重建聚集索引，重新组织页和区
ALTER INDEX PK_YourTable ON dbo.YourTable REBUILD;

-- 或者重新组织（比重建轻量）
ALTER INDEX PK_YourTable ON dbo.YourTable REORGANIZE;
```

## 总结

SQL Server 的页和区设计，核心目标就两个：

1. **减少磁盘寻道** — 通过区和页的连续分配，让顺序 I/O 尽可能高效
2. **简化空间管理** — 以 64KB 为单位分配，比逐页管理效率更高

理解了这个基础，你就能理解为什么大表扫描是顺序 I/O，而随机 I/O 才是性能杀手。

---

**面试追问方向：**

- 如果一行数据超过 8060 字节，SQL Server 怎么处理？
- 为什么要设计行溢出机制，而不是直接增大页大小？
- 如何判断一个表是否存在严重的碎片问题？`sys.dm_db_index_physical_stats` 这个 DMV 怎么用？

这些问题，会在后续的索引和性能调优章节中详细解答。
