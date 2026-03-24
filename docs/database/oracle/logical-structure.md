# Oracle 逻辑结构：表空间、段、区、块

你有没有想过，一条数据在 Oracle 中到底是怎么存储的？

当你执行 `INSERT INTO users VALUES (1, '张三')` 时，数据从你的 SQL 语句变成磁盘上的比特，要经历多少层抽象？

今天，我们从逻辑层面揭开 Oracle 存储体系的面纱。

---

## 逻辑结构四层塔

Oracle 的逻辑结构分为四层，从大到小依次是：

```
表空间（Tablespace）
    │
    └──► 段（Segment）
            │
            └──► 区（Extent）
                    │
                    └──► 块（Block）
```

这四层构成了 Oracle 数据存储的骨架。理解它们，是理解 Oracle 存储引擎的第一步。

---

## 表空间（Tablespace）

### 表空间是什么？

**表空间是 Oracle 逻辑存储的最高层**，是连接逻辑结构与物理结构的桥梁。每个表空间由一个或多个数据文件组成。

```sql
-- 查看所有表空间
SQL> SELECT tablespace_name, status, contents
     FROM dba_tablespaces;

TABLESPACE_NAME                STATUS    CONTENTS
------------------------------ --------- ---------
SYSTEM                         ONLINE    PERMANENT
SYSAUX                         ONLINE    PERMANENT
UNDOTBS1                       ONLINE    UNDO
TEMP                           ONLINE    TEMPORARY
USERS                          ONLINE    PERMANENT
```

### 三种表空间类型

| 类型 | 关键字 | 用途 | 示例 |
|-----|-------|------|------|
| 永久表空间 | PERMANENT | 存储永久对象（表、索引） | SYSTEM、USERS |
| 临时表空间 | TEMPORARY | 存储排序操作的中间结果 | TEMP |
| 撤销表空间 | UNDO | 存储撤销数据，用于回滚和读一致性 | UNDOTBS1 |

### 创建表空间

```sql
-- 创建标准表空间
CREATE TABLESPACE user_data
DATAFILE '/u01/oradata/orcl/user_data01.dbf'
SIZE 100M
AUTOEXTEND ON NEXT 10M MAXSIZE UNLIMITED
EXTENT MANAGEMENT LOCAL
SEGMENT SPACE MANAGEMENT AUTO;

-- 创建临时表空间
CREATE TEMPORARY TABLESPACE user_temp
TEMPFILE '/u01/oradata/orcl/user_temp01.dbf'
SIZE 50M
AUTOEXTEND ON;
```

### 表空间与数据文件的关系

```
表空间 USERS
├── 数据文件 1: /u01/.../users01.dbf (100M)
└── 数据文件 2: /u02/.../users02.dbf (100M)
```

一个表空间可以包含多个数据文件，实现跨磁盘分布。这是 Oracle 存储管理的灵活性之一。

---

## 段（Segment）

### 段是什么？

**段是表空间中一个逻辑存储单元**，代表一个数据库对象（如表、索引）的所有数据存储空间。

| 对象类型 | 段类型 | 说明 |
|---------|-------|------|
| 表 | TABLE | 存储表的行数据 |
| 索引 | INDEX | 存储索引数据 |
| 临时表 | TEMPORARY | 临时操作使用 |
| 撤销段 | TYPE2 UNDO | 回滚段（老版本） |

```sql
-- 查看表对应的段
SQL> SELECT segment_name, segment_type, tablespace_name, bytes/1024/1024 AS size_mb
FROM dba_segments
WHERE owner = 'SCOTT'
AND segment_name = 'EMP';

SEGMENT_NAME  SEGMENT_TYPE  TABLESPACE_NAME   SIZE_MB
------------- ------------- ---------------- --------
EMP           TABLE         USERS             .0625
```

### 段的分配方式

Oracle 支持两种段分配方式：

1. **手动段管理**（Manual）：DBA 手动管理 freelist
2. **自动段空间管理**（ASSM）：Oracle 自动管理空闲空间

```sql
-- 创建使用 ASSM 的表空间（推荐）
CREATE TABLESPACE efficient_ts
DATAFILE '/u01/.../efficient01.dbf' SIZE 100M
SEGMENT SPACE MANAGEMENT AUTO;

-- 创建使用手动管理的表空间
CREATE TABLESPACE manual_ts
DATAFILE '/u01/.../manual01.dbf' SIZE 100M
SEGMENT SPACE MANAGEMENT MANUAL;
```

**生产环境推荐使用 ASSM**，它能更好地管理并发插入，减少竞争。

---

## 区（Extent）

### 区是什么？

**区是 Oracle 分配空间的最小单位**，由一组连续的 Oracle 块组成。当段需要更多空间时，Oracle 以区为单位进行分配。

```
段 EMP
├── 区 1（包含 8 个 Oracle 块）
├── 区 2（包含 8 个 Oracle 块）
└── 区 3（包含 8 个 Oracle 块）
```

### 区的分配规则

| Oracle 版本 | 默认区大小（首次分配） |
|------------|---------------------|
| Oracle 12c+ | 64KB 或 1MB |
| 老版本 | 8 个 Oracle 块（通常 8KB×8=64KB） |

```sql
-- 查看段的区信息
SQL> SELECT segment_name, tablespace_name,
       COUNT(*) AS extent_count,
       SUM(bytes)/1024 AS total_kb
FROM dba_extents
WHERE owner = 'SCOTT'
GROUP BY segment_name, tablespace_name;

SEGMENT_NAME  TABLESPACE_NAME  EXTENT_COUNT  TOTAL_KB
------------- ---------------- -------------
EMP           USERS                       1         64
```

### 区的手动分配

在某些场景下，你可能需要手动控制区的分配：

```sql
-- 创建表并指定存储参数
CREATE TABLE manual_alloc (
    id NUMBER,
    name VARCHAR2(100)
)
TABLESPACE users
STORAGE (
    INITIAL 1M    -- 初始区大小
    NEXT 512K     -- 下一个区大小
    MINEXTENTS 2  -- 最小区数
    MAXEXTENTS 100
);
```

---

## Oracle 块（Block）

### 块是什么？

**块是 Oracle 最基本的 I/O 单位**，是数据库读写数据的最小单位。默认大小是 8KB。

```sql
-- 查看数据块大小
SQL> SELECT value AS block_size FROM v$parameter WHERE name = 'db_block_size';

VALUE
-----
8192
```

### 块的内部结构

```
┌─────────────────────────────────────────┐
│            Oracle Block (8KB)            │
├─────────────────────────────────────────┤
│  Block Header (19-24 bytes)             │
│  ├── 块类型                             │
│  ├── 块地址 (RDBA)                      │
│  ├── 目录信息 (ITL)                     │
│  └── 行数量                             │
├─────────────────────────────────────────┤
│  Row Data                                │
│  ├── 行 1: [row header][column 1][col 2]│
│  ├── 行 2: [row header][column 1][col 2]│
│  └── ...                                │
├─────────────────────────────────────────┤
│  Free Space (PCTFREE 控制)              │
└─────────────────────────────────────────┘
```

### PCTFREE 与 PCTUSED

这两个参数控制块的空间使用：

| 参数 | 作用 | 默认值 |
|-----|------|-------|
| PCTFREE | 预留空间百分比 | 10% |
| PCTUSED | 可重用下限 | 40% |

```sql
-- 查看表的 PCTFREE/PCTUSED
SQL> SELECT table_name, pct_free, pct_used
FROM user_tables
WHERE table_name = 'EMP';

TABLE_NAME  PCT_FREE  PCT_USED
---------- ---------- ----------
EMP                10         40
```

**PCTFREE=10 意味着**：当块的使用空间达到 90% 时，不再插入新行，为更新操作预留空间。

**PCTUSED=40 意味着**：当块的使用空间降到 40% 以下时，才允许插入新行。

---

## 逻辑结构与物理结构的映射

这是理解 Oracle 存储的关键：

```
逻辑结构                    物理结构
─────────────────────────────────────────
表空间（Tablespace）  ──►   数据文件（Data File）
段（Segment）         ──►   数据文件中的空间
区（Extent）         ──►   连续的数据块
块（Block）          ──►   操作系统块（或倍数的块）
```

当你往表里插入数据时：
1. Oracle 从表空间获取空闲区
2. 区由连续的 Oracle 块组成
3. 数据写入块中
4. 块最终持久化到数据文件

---

## 面试高频问题

### Q1: 表空间和数据文件的区别是什么？

表空间是逻辑结构，数据文件是物理结构。一个表空间由一个或多个数据文件组成，但表空间本身是逻辑概念。

### Q2: INITIAL、NEXT、PCTFREE 这些存储参数分别控制什么？

- `INITIAL`：创建段时的第一个区大小
- `NEXT`：第一个区填满后，分配的新区大小
- `PCTFREE`：块内预留空间百分比，用于行更新
- `PCTUSED`：块内空间降到此值以下时，允许新行插入

### Q3: 什么情况下会导致表的空间不连续？

大量 DELETE 操作后，表空间可能变得不连续。虽然 Oracle 会复用已删除行占用的空间，但如果使用 `TRUNCATE`，会直接释放所有空间。

---

## 总结

| 层级 | 定义 | 面试关注点 |
|-----|------|---------|
| 表空间 | 逻辑最高层，物理上对应数据文件 | 类型、存储位置 |
| 段 | 对象的所有空间 | ASSM vs 手动管理 |
| 区 | 连续块的集合，分配单位 | 分配规则、大小 |
| 块 | 最小 I/O 单位 | PCTFREE/PCTUSED |

理解了这四层结构，你就理解了 Oracle 存储体系的核心。

---

## 下一步

- [Oracle SGA 与 PGA](/database/oracle/sga-pga)：内存结构如何与逻辑结构交互
- [Oracle 物理结构](/database/oracle/physical-structure)：数据在磁盘上到底怎么存的
