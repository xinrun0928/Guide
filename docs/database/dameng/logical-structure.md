# DM 数据库的逻辑结构：表空间、段、区、页

如果把数据库比作一座城市，物理结构是城市的道路和建筑，而逻辑结构则是城市的行政区划。

今天我们从逻辑视角看达梦数据库——表空间、段、区、页。

## 逻辑层次概览

```
表空间（Tablespace）
    │
    ├── 段（Segment）
    │     │
    │     └── 区（Extent）
    │           │
    │           └── 页（Page）
    │                 │
    │                 └── 行（Row）
    │
    └── SYSTEM 表空间（系统字典）
```

这四个层级从大到小，像俄罗斯套娃一样层层嵌套。

## 表空间（Tablespace）

表空间是逻辑结构的顶层，用于组织和管理数据。

### 达梦的默认表空间

| 表空间 | 用途 | 能否删除 |
|--------|------|----------|
| SYSTEM | 系统字典、字典缓存 | 不可 |
| ROLL | 回滚段、Undo 数据 | 不可 |
| TEMP | 临时表、排序中间结果 | 可 |
| MAIN | 默认用户表空间 | 可 |
| HMAIN | 堆表默认表空间 | 可 |

### 创建表空间

```sql
-- 创建简单的表空间
CREATE TABLESPACE TS_SALES DATAFILE '/dm/data/sales01.dbf' SIZE 512M;

-- 创建带多个数据文件的表空间
CREATE TABLESPACE TS_ARCHIVE
    DATAFILE '/dm/data/archive01.dbf' SIZE 1G,
             '/dm/data/archive02.dbf' SIZE 1G
    AUTOEXTEND ON NEXT 256M MAXSIZE 4G;
```

### 表空间的管理要点

1. **合理规划大小**：预估数据增长，避免频繁扩展
2. **分离热点数据**：将高频访问的表放在 SSD 磁盘表空间
3. **分离冷热数据**：历史归档数据放在普通磁盘表空间

```sql
-- 查看表空间信息
SELECT TABLESPACE_ID, NAME, TOTAL_SIZE, FREE_SIZE, PAGE_SIZE
FROM V$TABLESPACE;

-- 修改表空间状态（只读/读写）
ALTER TABLESPACE TS_SALES READ ONLY;
ALTER TABLESPACE TS_SALES READ WRITE;
```

## 段（Segment）

段是表或索引的存储容器，每个表或索引都对应一个或多个段。

### 段的类型

| 段类型 | 用途 | 包含对象 |
|--------|------|----------|
| 数据段 | 存储表数据 | 普通表、分区表的每个分区 |
| 索引段 | 存储索引数据 | 每个索引 |
| 回滚段 | 存储Undo数据 | 事务回滚所需 |
| 临时段 | 存储临时数据 | 排序、哈希连接中间结果 |

### 段的分配策略

DM 默认采用「按需分配」策略：

- 表刚创建时，只分配一个区（初始 extent）
- 随着数据增长，逐步分配新的区

```sql
-- 创建表时指定存储参数
CREATE TABLE T_SALES (
    ID NUMBER(18),
    AMOUNT NUMBER(15,2),
    SALE_DATE DATE
)
TABLESPACE TS_SALES
STORAGE(
    INITIAL 1M,      -- 初始区大小
    NEXT 1M,         -- 后续区大小
    MINEXTENTS 1,    -- 最小区数
    MAXEXTENTS 100   -- 最大区数
);
```

## 区（Extent）

区是段的下一级存储单位，是 DM 分配空间的最小单位。

### 区的大小

区的大小由创建表空间时的 `EXTENT_SIZE` 参数决定：

- 默认 `EXTENT_SIZE = 16`（16 页）
- 如果页大小为 8KB，则区大小 = 128KB

### 区的分配过程

```
第一次插入数据 → 分配第一个区（16 页）
                         │
数据增长到区满 → 分配第二个区（16 页）
                         │
数据继续增长 → 分配第三个区（16 页）
                         │
        ...以此类推...
```

### 查看段的区使用情况

```sql
-- 查看表占用多少个区
SELECT SEGMENT_NAME, TABLESPACE_NAME, EXTENTS, BYTES/1024/1024 AS SIZE_MB
FROM DBA_SEGMENTS
WHERE OWNER = 'SYSDBA'
ORDER BY EXTENTS DESC;
```

## 页（Page）

页是 DM 存储的最小单位，是数据读写的最基本单元。

### 页的结构

```
┌────────────────────────────────────┐
│           页头（Page Header）       │  约 32 字节
├────────────────────────────────────┤
│           行数据（Row Data）        │  主要数据区域
├────────────────────────────────────┤
│           行偏移数组（Slot Array）  │  每行一个指针
└────────────────────────────────────┘
```

### 页的类型

| 页类型 | 大小 | 存储内容 |
|--------|------|----------|
| 数据页 | 4/8/16/32 KB | 表数据 |
| 索引页 | 4/8/16/32 KB | 索引数据 |
| Undo 页 | 4/8/16/32 KB | 回滚数据 |

### 为什么不建议页设置过大？

| 页大小 | 优点 | 缺点 |
|--------|------|------|
| 4KB | 减少内部碎片 | 单行数据受限，最多 4066 字节 |
| 8KB | 平衡选择 | 默认推荐 |
| 16KB | 适合大字段 | 可能浪费空间 |
| 32KB | 适合大字段+分析场景 | 内存压力增大 |

```sql
-- 创建页大小为 16KB 的表空间
CREATE TABLESPACE TS_LARGE
    DATAFILE '/dm/data/large01.dbf' SIZE 1G
    EXTENT MANAGEMENT LOCAL
    PAGE_SIZE = 16384;
```

## 行（Row）

行是数据的最终载体，每个页可以存放多行数据。

### 行的结构

```
┌────────────────────────────────────┐
│ 列1值 │ 列2值 │ 列3值 │ ... │ 列N值│
└────────────────────────────────────┘
```

### 行溢出

当一行数据超过页大小时，DM 会将大字段列（VARCHAR/BLOB/CLOB）溢出到溢出页：

```sql
-- 查看某行是否发生行溢出
SELECT ID, LENGTH(DATA_COL) AS DATA_LEN
FROM T_LARGE_DATA
WHERE DATA_OVERFLOW = 1;
```

## 逻辑结构与物理结构的对应

```
逻辑结构                    物理结构
────────────────────────────────────────
表空间（Tablespace）  →   数据文件（.dbf）
段（Segment）         →   数据文件中的存储区域
区（Extent）          →   连续的 16 个页
页（Page）            →   固定大小的存储块
```

## 实战：规划一个高效的表空间结构

假设我们需要存储 1TB 的销售数据：

```sql
-- 1. 创建元数据表空间（小表高频访问，放在 SSD）
CREATE TABLESPACE TS_META
    DATAFILE '/ssd/data/meta01.dbf' SIZE 1G
    PAGE_SIZE 8192;

-- 2. 创建业务数据表空间（大表，放在普通磁盘）
CREATE TABLESPACE TS_DATA
    DATAFILE '/hdd/data/data01.dbf' SIZE 500G,
             '/hdd/data/data02.dbf' SIZE 500G
    EXTENT MANAGEMENT LOCAL
    PAGE_SIZE 16384;

-- 3. 创建索引表空间（索引单独存放）
CREATE TABLESPACE TS_INDEX
    DATAFILE '/ssd/data/index01.dbf' SIZE 100G;

-- 4. 创建临时表空间（排序用）
CREATE TABLESPACE TS_TEMP
    DATAFILE '/ssd/data/temp01.dbf' SIZE 50G;

-- 5. 将表和索引分别创建在不同表空间
CREATE TABLE T_SALES (
    ID NUMBER(18) PRIMARY KEY,
    DATA CLOB
) TABLESPACE TS_DATA;

CREATE INDEX IDX_SALES_DATE ON T_SALES(SALE_DATE) TABLESPACE TS_INDEX;
```

## 面试追问方向

- 表空间使用率达到 100% 会发生什么？
- 如果一个表的数据分布在多个数据文件，查询会有什么影响？
- 临时表空间和普通表空间的区别是什么？

这些问题的答案，都在理解逻辑结构的底层机制中。
