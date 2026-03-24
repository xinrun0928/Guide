# Oracle 表压缩：让存储「省钱」

你的数据库存储空间还够用吗？

数据量每年翻倍，磁盘告警此起彼伏。

Oracle 的表压缩技术，能帮你省下大量空间。

今天，学会 Oracle 的表压缩技术。

---

## 为什么需要压缩？

### 数据膨胀问题

```sql
-- 一个典型的订单表
CREATE TABLE orders (
    order_id NUMBER,
    order_date DATE,
    customer_name VARCHAR2(200),
    product_names VARCHAR2(1000),
    status VARCHAR2(20)
);

-- 5年后，数据量可能膨胀到原来的 5 倍
-- 索引碎片、空闲空间、行迁移……
```

### 压缩的收益

| 收益 | 说明 |
|-----|------|
| 节省空间 | 压缩率通常 2-10 倍 |
| 减少 I/O | 读取相同数据量需要的磁盘操作更少 |
| 提高缓存效率 | 更多数据可以放入 Buffer Cache |
| 降低存储成本 | 减少存储设备投入 |

---

## Oracle 压缩类型

Oracle 提供多种压缩技术：

| 压缩类型 | 说明 | Oracle 版本 | 适用场景 |
|---------|------|-----------|---------|
| 基本表压缩 | DML 操作压缩 | 9i+ | 批量加载后少修改 |
| OLTP 表压缩 | 实时 DML 压缩 | 11gR2+ | 频繁 DML 操作 |
| 混合列压缩 | 按列类型优化 | 12c+ | 数据仓库 |
| 高级索引压缩 | 索引压缩 | 12c+ | 节省索引空间 |
| 表压缩 | Hive/Oracle Big Data | 12c+ | Hadoop 集成 |

---

## 基本表压缩（Basic Compression）

### 开启压缩

```sql
-- 创建时指定压缩
CREATE TABLE orders (
    order_id NUMBER,
    order_date DATE,
    customer_id NUMBER
) COMPRESS;

-- 对已有表启用压缩
ALTER TABLE orders COMPRESS;

-- 对分区启用压缩
ALTER TABLE orders MODIFY PARTITION p_2024 COMPRESS;
```

### 压缩行为

| 特点 | 说明 |
|-----|------|
| 压缩时机 | 数据在块中填满时压缩 |
| DML 影响 | INSERT/UPDATE 会解压缩再压缩 |
| 批量加载 | 直接写入压缩格式，效率高 |
| 适用场景 | 历史数据、归档数据、批量加载 |

### 批量加载与压缩

```sql
-- 批量加载自动利用压缩
INSERT /*+ APPEND */ INTO orders SELECT * FROM orders_old;

-- 直接路径加载
SQL*Loader 的 DIRECT=TRUE 参数

-- 批量加载压缩效果最好
```

### 解压行为

```sql
-- 启用压缩后，DML 操作会影响压缩效果
INSERT INTO orders VALUES (...);  -- 新行不压缩
UPDATE orders SET status = 'CANCELLED' WHERE ...;  -- 更新的行可能解压缩

-- 查看表的压缩状态
SELECT table_name, compression, compress_for
FROM user_tables
WHERE table_name = 'ORDERS';
```

---

## OLTP 表压缩（Advanced OLTP Compression）

### 什么是 OLTP 压缩？

专门为频繁 DML 操作设计的压缩技术，压缩和解压开销更低：

```sql
-- 创建 OLTP 压缩表
CREATE TABLE orders_oltp (
    order_id NUMBER,
    order_date DATE,
    customer_id NUMBER,
    status VARCHAR2(20)
) COMPRESS FOR OLTP;
```

### 与基本压缩对比

| 特性 | 基本压缩 | OLTP 压缩 |
|-----|---------|-----------|
| 压缩率 | 更高 | 略低 |
| DML 性能 | 影响较大 | 影响较小 |
| CPU 开销 | 较低 | 较高 |
| 适用场景 | 历史表、批量加载 | 活跃表 |

### 压缩级别

```sql
-- 指定压缩级别（Oracle 12c+）
CREATE TABLE t1 COMPRESS FOR OLTP;           -- 低压缩
CREATE TABLE t2 COMPRESS FOR QUERY LOW;      -- 查询优化
CREATE TABLE t3 COMPRESS FOR QUERY HIGH;     -- 高压缩查询
CREATE TABLE t4 COMPRESS FOR ARCHIVE LOW;    -- 归档优化
CREATE TABLE t5 COMPRESS FOR ARCHIVE HIGH;   -- 高压缩归档
```

---

## 混合列压缩（Hybrid Columnar Compression）

### HCC 是什么？

Oracle Exadata 特有的压缩技术，按列存储数据而不是按行：

```sql
-- HCC 压缩（仅 Exadata）
CREATE TABLE warehouse_data (
    sensor_id NUMBER,
    reading_value NUMBER,
    reading_time DATE
) COMPRESS FOR QUERY;
```

### HCC 压缩类型

| 类型 | 压缩率 | 适用场景 |
|-----|--------|---------|
| FOR QUERY LOW | 2-4x | 频繁查询 |
| FOR QUERY HIGH | 6-10x | 报表分析 |
| FOR ARCHIVE LOW | 6-10x | 冷数据 |
| FOR ARCHIVE HIGH | 10-15x | 归档数据 |

### HCC 的限制

1. **硬件要求**：仅 Oracle Exadata、ZFS、Sun Flash
2. **DML 限制**：大量 DML 可能导致性能下降
3. **兼容性**：非 Exadata 环境无法读取 Exadata 压缩数据

---

## 索引压缩

### 索引压缩的好处

索引通常占大量空间，压缩索引效果显著：

```sql
-- 创建压缩索引
CREATE INDEX idx_emp_dept ON employees(department_id) COMPRESS 1;

-- 复合索引压缩
CREATE INDEX idx_emp_dept_sal 
ON employees(department_id, salary) 
COMPRESS 2;
```

### 索引压缩原理

```sql
-- 未压缩：每个索引条目都存储键值
-- dept_id=50: [50][ROWID1], [50][ROWID2], [50][ROWID3], ...
-- dept_id=60: [60][ROWID4], [60][ROWID5], ...

-- 压缩后：重复键值只存储一次
-- dept_id=50: [50][ROWID1,ROWID2,ROWID3,...]
-- dept_id=60: [60][ROWID4,ROWID5,...]
```

### 压缩级别选择

```sql
-- COMPRESS 1: 前缀压缩（默认）
-- 适合前导列重复率高

-- COMPRESS 2: 更高压缩率
-- 适合所有列重复率高
```

---

## 查看压缩效果

### 压缩统计

```sql
-- 查看表的压缩信息
SELECT table_name, 
       compression,
       compress_for,
       num_rows,
       blocks,
       avg_row_len
FROM user_tables
WHERE table_name = 'ORDERS';

-- 查看分区压缩状态
SELECT partition_name,
       compression,
       compress_for,
       num_rows
FROM user_tab_partitions
WHERE table_name = 'ORDERS';
```

### 估算压缩效果

```sql
-- 使用 DBMS_COMPRESSION 包估算
DECLARE
    v_compr_type NUMBER;
    v_orig_size NUMBER;
    v_compr_size NUMBER;
BEGIN
    DBMS_COMPRESSION.GET_COMPRESSION_RATIO(
        scratch_tbsname => 'USERS',
        tabname => 'ORDERS',
        partname => NULL,
        comp_ratio => v_compr_type,
        comp_bytes => v_compr_size,
        uncompress_bytes => v_orig_size
    );
    
    DBMS_OUTPUT.PUT_LINE('压缩比: ' || v_compr_type);
    DBMS_OUTPUT.PUT_LINE('原始大小: ' || v_orig_size / 1024 / 1024 || ' MB');
    DBMS_OUTPUT.PUT_LINE('压缩后: ' || v_compr_size / 1024 / 1024 || ' MB');
END;
/
```

### 监控压缩表

```sql
-- 查看压缩表空间使用
SELECT segment_name,
       SUM(bytes) / 1024 / 1024 AS size_mb
FROM user_segments
WHERE segment_name IN (SELECT table_name FROM user_tables WHERE compression = 'ENABLED')
GROUP BY segment_name;
```

---

## 表压缩实战

### 场景一：历史数据归档

```sql
-- 1. 创建压缩归档表
CREATE TABLE orders_archive (
    order_id NUMBER,
    order_date DATE,
    customer_id NUMBER
) COMPRESS;

-- 2. 交换分区
ALTER TABLE orders EXCHANGE PARTITION p_2023 WITH TABLE orders_archive;

-- 3. 表空间足够小，可以放到慢速存储
ALTER TABLE orders_archive MOVE TABLESPACE archive_tbs;
```

### 场景二：OLTP 表启用压缩

```sql
-- 评估现有表的 DML 模式
SELECT table_name, num_rows, inserts, updates, deletes
FROM user_tables t
JOIN user_tab_modifications m ON t.table_name = m.table_name;

-- 对低 DML 表使用基本压缩
ALTER TABLE dim_products COMPRESS;

-- 对中等 DML 表使用 OLTP 压缩
ALTER TABLE orders COMPRESS FOR OLTP;
```

### 场景三：分区差异化压缩

```sql
-- 最近分区：OLTP 压缩（活跃数据）
CREATE TABLE orders (
    order_id NUMBER,
    order_date DATE
) PARTITION BY RANGE (order_date) (
    PARTITION p_2024 RECENT VALUES LESS THAN (MAXVALUE)
) COMPRESS FOR OLTP;

-- 历史分区：基本压缩（少修改）
ALTER TABLE orders MODIFY PARTITION p_2023 COMPRESS;
```

---

## 压缩注意事项

### 压缩对性能的影响

| 影响 | 说明 |
|-----|------|
| CPU 开销 | 压缩/解压消耗 CPU |
| DML 性能 | OLTP 压缩影响较小，基本压缩影响较大 |
| 查询性能 | 通常提升（减少 I/O） |

### 避免过度压缩

```sql
-- 不要对所有表都压缩
-- 考虑因素：
-- 1. DML 频率
-- 2. 数据访问模式
-- 3. CPU 资源
-- 4. 压缩收益
```

### 压缩与加密

```sql
-- TDE（Transparent Data Encryption）可以与压缩共存
-- 压缩优先：先压缩再加密
ALTER TABLE orders COMPRESS;
ALTER TABLE orders ENCRYPT;
```

---

## 面试高频问题

### Q1: 基本表压缩和 OLTP 表压缩的区别？

基本压缩在数据块填满时压缩，DML 操作会导致解压和重压缩，性能影响大；OLTP 压缩专为实时 DML 设计，压缩解压开销更低，但压缩率略低。

### Q2: 压缩会影响查询性能吗？

通常会提升查询性能，因为相同 I/O 可以读取更多数据。但会增加 CPU 开销，如果 CPU 是瓶颈，可能需要权衡。

### Q3: 哪些表适合压缩？

修改频率低的历史数据表、批量加载的数据、存储密集型的分析表、需要长期归档的数据。

---

## 总结

| 压缩类型 | 适用场景 | DML 影响 |
|---------|---------|---------|
| 基本压缩 | 批量加载、历史数据 | 较大 |
| OLTP 压缩 | 活跃表 | 较小 |
| HCC | Exadata/数据仓库 | 较大 |
| 索引压缩 | 大索引 | 较小 |

合理使用压缩技术，可以在不牺牲太多性能的前提下，显著节省存储空间。

---

## 下一步

- [Oracle 事务机制](/database/oracle/transaction)：ACID 特性详解
- [Oracle SQL 优化](/database/oracle/sql-tuning)：慢查询如何调优
