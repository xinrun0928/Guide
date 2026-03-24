# 文件组：数据存储的「多子多福」

你的数据库现在 500GB，单个数据文件。想做分区表，把历史数据迁移到归档存储，发现无从下手。

或者，数据文件写满了，想把新数据写到另一个磁盘，发现配置起来特别麻烦。

问题出在哪？**你没有理解文件组的设计哲学。**

今天，我们来聊聊 SQL Server 的文件组（Filegroup），一个被很多开发者忽视但极其重要的概念。

## 为什么需要文件组？

想象一个图书馆：所有书籍都放在一个大仓库里，查找慢，而且如果仓库满了，整座图书馆就瘫痪了。

文件组，就是把一个大仓库拆成多个小仓库，每个仓库可以放在不同位置，实现：

1. **性能优化** — 把热数据放 SSD，冷数据放 HDD
2. **空间管理** — 突破单文件的大小限制
3. **备份灵活性** — 备份/恢复可以针对特定文件组
4. **表分区** — 将不同分区放到不同文件组

## 文件组的结构

### 主文件组（PRIMARY）

每个数据库有一个**主文件组（PRIMARY）**，包含：

- 主数据文件（`.mdf`）
- 所有未显式分配到其他文件组的对象

```sql
-- 创建数据库时指定文件组
CREATE DATABASE MyDB
ON PRIMARY (
    NAME = 'MyDB_Data',
    FILENAME = 'D:\Data\MyDB.mdf',
    SIZE = 100MB,
    MAXSIZE = UNLIMITED,
    FILEGROWTH = 64MB
);
```

### 用户定义文件组

除了主文件组，你可以创建多个用户定义文件组：

```sql
ALTER DATABASE MyDB
ADD FILEGROUP HotData_FG;  -- 热数据文件组

ALTER DATABASE MyDB
ADD FILE (
    NAME = 'HotData_1',
    FILENAME = 'E:\SSD\HotData_1.ndf',
    SIZE = 50GB,
    MAXSIZE = UNLIMITED,
    FILEGROWTH = 1GB
) TO FILEGROUP HotData_FG;
```

### 日志文件

**重要**：事务日志文件不属于任何文件组，它们有独立的存储逻辑。

```sql
-- 添加日志文件
ALTER DATABASE MyDB
ADD LOG FILE (
    NAME = 'MyDB_Log2',
    FILENAME = 'F:\Logs\MyDB_Log2.ldf',
    SIZE = 50GB,
    MAXSIZE = UNLIMITED,
    FILEGROWTH = 1GB
);
```

## 文件组与表的关系

### 默认文件组

创建表时，如果不指定文件组，表会创建在**默认文件组**上：

```sql
-- 创建在默认文件组（通常是 PRIMARY）
CREATE TABLE Orders (
    OrderID INT PRIMARY KEY,
    OrderDate DATETIME,
    Amount DECIMAL(18,2)
);

-- 创建在指定文件组
CREATE TABLE Archive_Orders (
    OrderID INT PRIMARY KEY,
    OrderDate DATETIME,
    Amount DECIMAL(18,2)
) ON HotData_FG;  -- 指定文件组
```

### 迁移数据到另一个文件组

想把已存在的表迁移到新文件组？重建聚集索引即可：

```sql
-- 将表迁移到新文件组
CREATE CLUSTERED INDEX IX_Orders_Date 
ON Orders(OrderDate)
WITH (DROP_EXISTING = ON)
ON HotData_FG;
```

因为聚集索引的叶子节点就是数据，重建聚集索引会把整个表移动到新文件组。

## 文件组的实战应用

### 场景一：热数据与冷数据分离

```java
/**
 * 根据访问频率选择存储位置
 * 
 * 场景：订单系统，最近3个月是热数据，访问频繁
 *       3个月之前是冷数据，偶尔查询
 */
public class DataPlacementStrategy {
    
    // 热数据存储位置（SSD，高性能）
    private static final String HOT_DATA_FILEGROUP = "HotData_FG";
    
    // 冷数据存储位置（HDD，大容量低成本）
    private static final String COLD_DATA_FILEGROUP = "ColdData_FG";
    
    /**
     * 根据订单日期决定存储文件组
     * 
     * @param orderDate 订单日期
     * @return 应使用的文件组名称
     */
    public String selectFilegroup(LocalDate orderDate) {
        LocalDate threeMonthsAgo = LocalDate.now().minusMonths(3);
        
        if (orderDate.isAfter(threeMonthsAgo)) {
            return HOT_DATA_FILEGROUP;
        } else {
            return COLD_DATA_FILEGROUP;
        }
    }
    
    /**
     * 生成建表语句
     */
    public String generateCreateTableSQL(String tableName, LocalDate orderDate) {
        String filegroup = selectFilegroup(orderDate);
        return String.format(
            "CREATE TABLE %s (...) ON %s",
            tableName, filegroup
        );
    }
}
```

### 场景二：只读文件组减少备份时间

将历史数据放到只读文件组，备份时跳过它：

```sql
-- 将文件组设为只读
ALTER DATABASE MyDB
MODIFY FILEGROUP ColdData_FG READONLY;

-- 备份只读文件组（只需做一次）
BACKUP DATABASE MyDB FILEGROUP='ColdData_FG' TO DISK='C:\Backup\ColdData.bak';

-- 后续备份只需处理读写文件组
BACKUP DATABASE MyDB READ_WRITE_FILEGROUPS TO DISK='C:\Backup\Partial.bak';
```

### 场景三：突破文件大小限制

Windows 的 NTFS 文件有 16TB 的理论限制（实际更小）。通过多个文件组，可以让数据库超过单文件大小限制：

```sql
-- 添加新文件组和文件
ALTER DATABASE MyDB
ADD FILEGROUP FG2;

ALTER DATABASE MyDB
ADD FILE (
    NAME = 'MyDB_Data2',
    FILENAME = 'G:\Data\MyDB_Data2.ndf',
    SIZE = 100GB,
    MAXSIZE = UNLIMITED,
    FILEGROWTH = 10GB
) TO FILEGROUP FG2;
```

## 文件组的查询与管理

### 查看文件组信息

```sql
-- 查看数据库的文件和文件组
SELECT 
    fg.name AS FilegroupName,
    f.name AS FileName,
    f.physical_name,
    f.size * 8 / 1024 AS SizeMB,
    f.max_size * 8 / 1024 AS MaxSizeMB,
    f.growth * 8 / 1024 AS GrowthMB
FROM sys.filegroups fg
JOIN sys.database_files f ON fg.data_space_id = f.data_space_id
WHERE f.type_desc = 'ROWS';
```

### 查看对象所在的文件组

```sql
-- 查看表所在的文件组
SELECT 
    OBJECT_NAME(i.object_id) AS TableName,
    i.name AS IndexName,
    fg.name AS FilegroupName,
    i.type_desc
FROM sys.indexes i
JOIN sys.filegroups fg ON i.data_space_id = fg.data_space_id
WHERE OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
ORDER BY TableName, IndexName;
```

### 查看文件组使用情况

```sql
-- 使用存储过程查看空间使用
EXEC sp_helpfilegroup 'PRIMARY';
EXEC sp_spaceused @updateusage = 'TRUE';
```

## 文件组的注意事项

### 事务日志不属于文件组

这是新手最容易犯的错误：**事务日志文件不在文件组里**。做文件组级别的备份时，不包含日志，必须单独备份日志。

### 默认文件组

```sql
-- 查看当前默认文件组
SELECT name, is_default 
FROM sys.filegroups 
WHERE is_default = 1;

-- 更改默认文件组
ALTER DATABASE MyDB
MODIFY FILEGROUP HotData_FG DEFAULT;
```

### 文件组与性能

文件组本身不提升性能，**真正提升性能的是把文件放到不同的物理磁盘上**。如果多个文件组指向同一个磁盘，并不会带来 I/O 提升。

```java
/**
 * 文件组性能优化建议
 */
public class FilegroupPerformanceTips {
    
    /**
     * 不同场景的文件组配置建议
     */
    public void printRecommendations() {
        System.out.println("=== 文件组配置最佳实践 ===");
        System.out.println();
        System.out.println("1. 热数据文件组：");
        System.out.println("   - 放在 SSD 或高速存储");
        System.out.println("   - 配置足够的文件数量（等于 CPU 核心数）");
        System.out.println();
        System.out.println("2. 索引文件组：");
        System.out.println("   - 如果索引和数据分离");
        System.out.println("   - 放在与数据文件组不同的物理磁盘");
        System.out.println();
        System.out.println("3. 冷数据文件组：");
        System.out.println("   - 放在大容量的 HDD");
        System.out.println("   - 设为 READ ONLY 减少维护开销");
        System.out.println();
        System.out.println("4. 注意事项：");
        System.out.println("   - 每个文件组至少一个文件");
        System.out.println("   - 同一文件组的文件大小尽量相同");
        System.out.println("   - 启用 Trace Flag 1118（SQL 2014 及之前）");
    }
}
```

## 总结

文件组是 SQL Server 存储架构的精髓。它解决的不是「要不要分文件」的问题，而是：

1. **在哪存** — 不同性能要求的表放在不同存储
2. **怎么管** — 表分区、只读优化、备份灵活性
3. **怎么扩** — 突破单文件大小限制

理解文件组，你才能真正掌控 SQL Server 的存储策略。

---

**面试追问方向：**

- 文件组和文件有什么区别？日志文件属于哪个文件组？
- 如果某个文件组已满，新数据还能插入吗？会发生什么？
- 表分区和文件组有什么关系？什么时候适合使用？

这些问题的答案，会在[分区表](/database/sqlserver/partition)章节详细展开。
