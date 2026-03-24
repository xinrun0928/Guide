# Oracle 分区表：让千万级数据「分而治之」

你有遇到过这种场景吗？

一张表几亿条数据，查询慢得像蜗牛。

按时间查询，扫描全表。

历史数据归档，耗时一整天。

分区表，就是来解决这个问题的。

今天，学会 Oracle 分区表。

---

## 为什么需要分区表？

### 问题背景

```sql
-- 订单表：5年数据，5亿条记录
CREATE TABLE orders (
    order_id NUMBER PRIMARY KEY,
    order_date DATE NOT NULL,
    customer_id NUMBER,
    total_amount NUMBER
);
```

| 问题 | 表现 |
|-----|------|
| 全表扫描慢 | `SELECT * FROM orders WHERE order_date >= '2024-01-01'` 需要扫描5亿条 |
| 索引效率低 | 索引树太深，磁盘 I/O 大 |
| 历史数据难处理 | 删除一年前数据耗时几小时 |
| 可用性差 | 单表损坏影响全部数据 |

### 分区解决方案

```
orders 表按月分区：
├── orders_2024_01（2024年1月）
├── orders_2024_02（2024年2月）
├── orders_2024_03（2024年3月）
└── ...
```

查询 2024 年 1 月数据时，只扫描 `orders_2024_01` 分区，其他分区完全跳过。

---

## 分区类型

Oracle 支持多种分区策略：

| 分区类型 | 说明 | 适用场景 |
|---------|------|---------|
| 范围分区 | 按数值/日期范围 | 时间序列数据 |
| 列表分区 | 按枚举值列表 | 地域、类别 |
| 哈希分区 | 按哈希值均匀分布 | 消除热点 |
| 复合分区 | 两种分区方式组合 | 复杂业务 |

---

## 范围分区（Range Partitioning）

### 按日期范围分区

```sql
CREATE TABLE orders (
    order_id NUMBER,
    order_date DATE NOT NULL,
    customer_id NUMBER,
    total_amount NUMBER
)
PARTITION BY RANGE (order_date) (
    PARTITION p_2024_q1 VALUES LESS THAN (TO_DATE('2024-04-01', 'YYYY-MM-DD')),
    PARTITION p_2024_q2 VALUES LESS THAN (TO_DATE('2024-07-01', 'YYYY-MM-DD')),
    PARTITION p_2024_q3 VALUES LESS THAN (TO_DATE('2024-10-01', 'YYYY-MM-DD')),
    PARTITION p_2024_q4 VALUES LESS THAN (TO_DATE('2025-01-01', 'YYYY-MM-DD')),
    PARTITION p_max VALUES LESS THAN (MAXVALUE)
);
```

### 分区命名规范

```sql
-- 推荐命名：表名_分区键_值
PARTITION orders_2024_01 VALUES LESS THAN (TO_DATE('2024-02-01', 'YYYY-MM-DD'))
PARTITION orders_2024_02 VALUES LESS THAN (TO_DATE('2024-03-01', 'YYYY-MM-DD'))
```

### 自动创建分区

使用 INTERVAL 自动创建分区：

```sql
CREATE TABLE orders_auto (
    order_id NUMBER,
    order_date DATE NOT NULL,
    customer_id NUMBER
)
PARTITION BY RANGE (order_date) INTERVAL (NUMTOYMINTERVAL(1, 'MONTH')) (
    PARTITION p_initial VALUES LESS THAN (TO_DATE('2024-01-01', 'YYYY-MM-DD'))
);
```

当插入 2024 年 2 月数据时，Oracle 自动创建 `SYS_PXXX` 分区。

---

## 列表分区（List Partitioning）

### 按枚举值分区

```sql
CREATE TABLE customers (
    customer_id NUMBER,
    customer_name VARCHAR2(100),
    region VARCHAR2(20),
    signup_date DATE
)
PARTITION BY LIST (region) (
    PARTITION p_north VALUES ('BEIJING', 'TIANJIN', 'HEBEI'),
    PARTITION p_south VALUES ('GUANGDONG', 'FUJIAN', 'HANGZHOU'),
    PARTITION p_central VALUES ('SICHUAN', 'HUBEI', 'HENAN'),
    PARTITION p_other VALUES (DEFAULT)
);
```

### DEFAULT 分区

未匹配的记录进入 DEFAULT 分区：

```sql
-- 插入 'SHANGHAI' 地区的数据
INSERT INTO customers VALUES (1, '张三', 'SHANGZHOU', SYSDATE);  -- 注意拼写

-- 会进入 p_other 分区
```

---

## 哈希分区（Hash Partitioning）

### 均匀分布

```sql
CREATE TABLE transactions (
    transaction_id NUMBER,
    account_id NUMBER,
    transaction_date DATE,
    amount NUMBER
)
PARTITION BY HASH (account_id) (
    PARTITION p_hash_1,
    PARTITION p_hash_2,
    PARTITION p_hash_3,
    PARTITION p_hash_4
);
```

### 自动创建哈希分区

```sql
CREATE TABLE orders_hash (
    order_id NUMBER,
    customer_id NUMBER
)
PARTITION BY HASH (customer_id) INTERVAL (16);
-- Oracle 自动创建 16 个分区（或根据 CPU 核心数）
```

### 哈希分区的特点

| 特点 | 说明 |
|-----|------|
| 数据均匀 | 自动均匀分布 |
| 消除热点 | 减少数据倾斜 |
| 无法范围裁剪 | 无法按范围跳过分区 |
| 并行 DML | 分区可并行操作 |

---

## 复合分区（Composite Partitioning）

### 范围-列表复合分区

```sql
CREATE TABLE sales (
    sale_id NUMBER,
    sale_date DATE,
    region VARCHAR2(20),
    product_id NUMBER,
    amount NUMBER
)
PARTITION BY RANGE (sale_date)
SUBPARTITION BY LIST (region) (
    PARTITION p_2024_q1 VALUES LESS THAN (TO_DATE('2024-04-01', 'YYYY-MM-DD')) (
        SUBPARTITION p_q1_north VALUES ('BEIJING', 'TIANJIN'),
        SUBPARTITION p_q1_south VALUES ('GUANGDONG', 'FUJIAN'),
        SUBPARTITION p_q1_other VALUES (DEFAULT)
    ),
    PARTITION p_2024_q2 VALUES LESS THAN (TO_DATE('2024-07-01', 'YYYY-MM-DD')) (
        SUBPARTITION p_q2_north VALUES ('BEIJING', 'TIANJIN'),
        SUBPARTITION p_q2_south VALUES ('GUANGDONG', 'FUJIAN'),
        SUBPARTITION p_q2_other VALUES (DEFAULT)
    )
);
```

### 范围-哈希复合分区

```sql
CREATE TABLE large_orders (
    order_id NUMBER,
    order_date DATE,
    customer_id NUMBER
)
PARTITION BY RANGE (order_date)
SUBPARTITION BY HASH (customer_id) SUBPARTITIONS 4 (
    PARTITION p_2024 VALUES LESS THAN (TO_DATE('2025-01-01', 'YYYY-MM-DD'))
);
```

---

## 分区操作

### 添加分区

```sql
-- 添加范围分区
ALTER TABLE orders ADD PARTITION p_2025_q1 VALUES LESS THAN (TO_DATE('2025-04-01', 'YYYY-MM-DD'));

-- 添加列表分区
ALTER TABLE customers ADD PARTITION p_east VALUES ('SHANDONG', 'SHANXI');
```

### 删除分区

```sql
-- 删除分区（同时删除数据）
ALTER TABLE orders DROP PARTITION p_2020_q1;

-- 截断分区（保留分区，删除数据）
ALTER TABLE orders TRUNCATE PARTITION p_2020_q1;

-- 删除子分区
ALTER TABLE sales TRUNCATE SUBPARTITION p_q1_north;
```

### 合并分区

```sql
-- 合并相邻分区
ALTER TABLE orders MERGE PARTITIONS p_2024_q1, p_2024_q2 INTO PARTITION p_2024_h1;
```

### 拆分分区

```sql
-- 拆分分区
ALTER TABLE orders SPLIT PARTITION p_2024_q1 
AT (TO_DATE('2024-02-01', 'YYYY-MM-DD'))
INTO (
    PARTITION p_2024_01,
    PARTITION p_2024_q1_remain
);
```

### 重命名分区

```sql
ALTER TABLE orders RENAME PARTITION p_2024_q1 TO p_2024_q1_old;
```

---

## 分区维护：历史数据归档

### 交换分区（Exchange Partition）

```sql
-- 1. 创建归档表（结构与分区一致）
CREATE TABLE orders_2023_archive (
    order_id NUMBER,
    order_date DATE,
    customer_id NUMBER,
    total_amount NUMBER
);

-- 2. 交换分区（快速，几乎不占资源）
ALTER TABLE orders EXCHANGE PARTITION p_2023 WITH TABLE orders_2023_archive;

-- 3. 导出归档表数据
-- expdp user/password tables=orders_2023_archive ...

-- 4. 可选：删除分区
ALTER TABLE orders DROP PARTITION p_2023;
```

### 归档流程对比

| 方法 | 耗时 | 资源占用 | 风险 |
|-----|------|---------|------|
| DELETE | 几小时 | 高 | 产生大量UNDO |
| DROP PARTITION | 秒级 | 低 | 数据永久删除 |
| EXCHANGE + EXPORT | 分钟级 | 低 | 需要额外步骤 |

---

## 分区与索引

### 本地索引

索引按分区一一对应：

```sql
-- 创建本地索引
CREATE INDEX idx_order_customer ON orders(customer_id) LOCAL;

-- 本地索引随分区管理
ALTER TABLE orders DROP PARTITION p_2020_q1;
-- 对应的本地索引分区自动删除
```

### 全局索引

整个表的统一索引：

```sql
-- 创建全局索引（默认）
CREATE INDEX idx_order_id ON orders(order_id) GLOBAL;

-- 全局索引在分区操作后需要重建
ALTER TABLE orders DROP PARTITION p_2020_q1 UPDATE GLOBAL INDEXES;
-- UPDATE GLOBAL INDEXES 会自动重建全局索引（耗时较长）
```

### 索引策略

| 索引类型 | 适用场景 | 维护 |
|---------|---------|------|
| 本地索引 | 分区键查询、分区维护 | 自动随分区管理 |
| 全局索引 | 跨分区查询 | 需要手动维护 |

---

## 分区裁剪（Partition Pruning）

### 什么是分区裁剪？

查询只访问需要的分区，跳过其他分区：

```sql
-- 查看分区裁剪
EXPLAIN PLAN FOR
SELECT * FROM orders WHERE order_date >= TO_DATE('2024-01-01', 'YYYY-MM-DD');

-- 执行计划应显示分区访问信息
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY);
```

### 分区裁剪原理

```sql
-- 静态裁剪（编译时确定）
SELECT * FROM orders PARTITION (p_2024_q1) WHERE customer_id = 100;

-- 动态裁剪（运行时确定）
SELECT * FROM orders WHERE order_date BETWEEN '2024-01-01' AND '2024-03-31';
```

---

## 面试高频问题

### Q1: 什么时候应该分区？

表数据量超过 100GB、查询总是有分区键条件、历史数据需要归档或清理、单分区索引过大导致性能下降时，应该考虑分区。

### Q2: 分区键怎么选择？

选择查询条件中经常使用的列、数据分布均匀的列、能够均匀分布数据的列。时间字段是最常见的分区键。

### Q3: 本地索引和全局索引的区别？

本地索引与分区一一对应，分区维护时自动管理；全局索引覆盖所有分区，分区维护后需要手动重建或使用 UPDATE GLOBAL INDEXES。

---

## 总结

分区表是大数据管理的利器：

| 分区类型 | 适用场景 |
|---------|---------|
| 范围分区 | 时间序列、连续数值 |
| 列表分区 | 枚举值、类别 |
| 哈希分区 | 均匀分布、消除热点 |
| 复合分区 | 复杂业务、多维度 |

分区让大表可管理，让查询更高效。

---

## 下一步

- [Oracle SQL 优化](/database/oracle/sql-tuning)：慢查询如何调优
- [Oracle 表压缩](/database/oracle/compression)：如何节省存储
