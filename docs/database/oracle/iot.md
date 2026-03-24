# Oracle IOT 表：把表变成索引

你有没有想过：

能不能让表本身就是一个索引？

查询主键时不需要回表？

IOT（Index Organized Table，索引组织表）就是来解决这个问题的。

今天，深入理解 Oracle 的 IOT 表。

---

## 为什么需要 IOT？

### 传统堆表的问题

```sql
-- 传统堆表：主键查询需要两步
SELECT * FROM employees WHERE employee_id = 100;

-- 执行计划：
-- 1. INDEX UNIQUE SCAN idx_emp_pk   -- 找到主键索引位置
-- 2. TABLE ACCESS BY INDEX ROWID    -- 回表获取完整数据
```

两次 I/O 才能获取数据，能不能合并成一次？

### IOT 的解决方案

```sql
-- IOT 表：表数据按主键顺序存储
CREATE TABLE employees_iot (
    employee_id NUMBER PRIMARY KEY,
    name VARCHAR2(100),
    email VARCHAR2(100),
    hire_date DATE,
    salary NUMBER(10, 2)
) ORGANIZATION INDEX;
```

```
IOT 结构：
                    [主键索引]
                    /        \
              索引节点      包含所有列数据
              /      \
           ...       ...
```

现在查询主键时，数据就在索引结构中，无需回表。

---

## IOT 的工作原理

### 结构对比

| 组件 | 堆表 | IOT |
|-----|------|-----|
| 主键索引 | 独立结构 | 表本身就是索引 |
| ROWID | 有 | 无（使用主键定位） |
| 数据存储 | 无序堆 | 按主键有序 |
| 回表 | 需要 | 不需要 |

```sql
-- 查看 IOT 表的统计信息
SELECT table_name, iot_type, iot_name, num_rows, blocks
FROM user_tables
WHERE iot_type = 'IOT';
```

### IOT 的优势

1. **减少 I/O**：主键查询只需一次 I/O
2. **节省空间**：无需 ROWID 存储
3. **范围扫描快**：数据按主键物理有序
4. **提高缓存效率**：热数据更集中

### IOT 的限制

1. **必须有主键**：IOT 必须定义主键
2. **不支持簇表**：不能是簇表的一部分
3. **溢出开销**：行太长时需要溢出段
4. **DML 性能**：插入可能触发行迁移

---

## 创建 IOT 表

### 基本语法

```sql
CREATE TABLE countries (
    country_id NUMBER PRIMARY KEY,
    country_name VARCHAR2(100),
    region_id NUMBER,
    population NUMBER
) ORGANIZATION INDEX;
```

### 带溢出段的 IOT

当行数据较大时，非主键列可以溢出到独立段：

```sql
CREATE TABLE order_items_iot (
    order_id NUMBER,
    item_id NUMBER,
    product_id NUMBER,
    product_name VARCHAR2(500),    -- 可能很长的字段
    description VARCHAR2(2000),    -- 溢出到溢出段
    quantity NUMBER,
    price NUMBER(10, 2),
    PRIMARY KEY (order_id, item_id)
) ORGANIZATION INDEX
TABLESPACE users
PCTTHRESHOLD 50                  -- 行超过块容量 50% 时溢出
INCLUDING product_name           -- product_name 及其后的列溢出
OVERFLOW TABLESPACE overflow;
```

### PCTTHRESHOLD 与 INCLUDING

| 参数 | 说明 |
|-----|------|
| PCTTHRESHOLD | 行数据超过块容量的百分比时，INCLUDING 后的列溢出 |
| INCLUDING | 指定哪些列保留在索引段，哪些列溢出 |

```sql
-- 示例
CREATE TABLE large_table_iot (
    id NUMBER PRIMARY KEY,
    col1 VARCHAR2(100),      -- 索引段
    col2 VARCHAR2(200),       -- 索引段
    col3 VARCHAR2(1000),      -- 索引段或溢出
    col4 CLOB                 -- 必须溢出
) ORGANIZATION INDEX
PCTTHRESHOLD 40
INCLUDING col2;
-- col1, col2 在索引段
-- col3（INCLUDING col2 之后）溢出
-- col4（CLOB）强制溢出
```

---

## IOT 的查询优化

### 主键查询

```sql
-- IOT 主键查询：只需一次 I/O
SELECT * FROM countries WHERE country_id = 1;

-- 执行计划
-- INDEX (IOT TOP) UNIQUE SCAN  -- 直接获取数据，无需回表
```

### 范围查询

```sql
-- IOT 范围查询：数据物理有序，范围扫描更快
SELECT * FROM countries
WHERE country_id BETWEEN 10 AND 50;

-- 执行计划
-- INDEX (IOT TOP) RANGE SCAN   -- 顺序读取即可
```

### 全表扫描

```sql
-- IOT 全表扫描
SELECT * FROM countries;

-- 执行计划
-- INDEX (IOT TOP) FULL SCAN   -- 遍历整个 IOT 结构
```

---

## IOT 与约束

### 主键约束

IOT 必须有主键：

```sql
-- 正确：定义了主键
CREATE TABLE t1 (
    id NUMBER PRIMARY KEY,
    name VARCHAR2(100)
) ORGANIZATION INDEX;

-- 错误：没有主键
CREATE TABLE t2 (
    id NUMBER,
    name VARCHAR2(100)
) ORGANIZATION INDEX;
-- ORA-25175: no PRIMARY KEY constraint for index-organized table
```

### 唯一约束

IOT 上的唯一约束必须包含主键：

```sql
-- 错误：唯一约束不包含主键
CREATE TABLE t1 (
    id NUMBER PRIMARY KEY,
    code VARCHAR2(50)
) ORGANIZATION INDEX;

ALTER TABLE t1 ADD CONSTRAINT uk_code UNIQUE (code);  -- ORA-25176: ...

-- 正确：唯一约束包含主键
ALTER TABLE t1 ADD CONSTRAINT uk_id_code UNIQUE (id, code);
```

### 外键约束

IOT 表可以作为父表或子表：

```sql
-- IOT 作为父表
CREATE TABLE countries (
    country_id NUMBER PRIMARY KEY,
    country_name VARCHAR2(100)
) ORGANIZATION INDEX;

-- 普通表作为子表（常见配置）
CREATE TABLE cities (
    city_id NUMBER PRIMARY KEY,
    city_name VARCHAR2(100),
    country_id NUMBER REFERENCES countries(country_id)
);
```

---

## IOT 的溢出管理

### 监控溢出

```sql
-- 查看 IOT 的溢出统计
SELECT table_name, 
       iot_name,
       overflow_name,
       num_rows AS total_rows,
       (SELECT COUNT(*) 
        FROM user_tab_columns 
        WHERE table_name = t.overflow_name) AS overflow_cols
FROM user_tables t
WHERE iot_type = 'IOT';

-- 查看溢出段使用情况
SELECT segment_name, segment_type, bytes/1024/1024 AS size_mb
FROM user_segments
WHERE segment_name LIKE '%OVERFLOW%';
```

### 减少溢出的方法

1. **减小 PCTTHRESHOLD**：让更多数据保留在索引段
2. **调整 INCLUDING**：让更多列保留在索引段
3. **分离大字段**：将 CLOB/BLOB 分离到独立表

```sql
-- 优化：分离大字段
CREATE TABLE orders (
    order_id NUMBER PRIMARY KEY,
    order_date DATE,
    total_amount NUMBER
) ORGANIZATION INDEX;

-- 分离长文本
CREATE TABLE order_items (
    item_id NUMBER PRIMARY KEY,
    order_id NUMBER REFERENCES orders(order_id),
    item_description CLOB
);
```

---

## IOT 的 DML 操作

### INSERT

```sql
-- IOT 的 INSERT 性能可能略低于堆表
INSERT INTO countries VALUES (1, 'China', 1, 1400000000);

-- 如果行太长，会自动溢出
INSERT INTO countries VALUES (2, 'Very Long Country Name', 2, 100);
```

### UPDATE

```sql
-- UPDATE 可能导致行迁移
UPDATE countries SET population = 1500000000 WHERE country_id = 1;

-- 监控行迁移
SELECT table_name, chain_cnt
FROM user_tables
WHERE table_name = 'COUNTRIES';
```

### DELETE

```sql
-- DELETE 标记行为删除，但不释放空间
DELETE FROM countries WHERE country_id = 1;

-- 重建 IOT 回收空间
ALTER TABLE countries MOVE;
```

---

## IOT vs 堆表：性能对比

### 适用场景对比

| 场景 | 推荐 | 原因 |
|-----|------|------|
| 主键频繁查询 | IOT | 无需回表 |
| 范围扫描 | IOT | 物理有序 |
| 宽表（列多/字段大） | 堆表 | 避免溢出开销 |
| 高并发 DML | 堆表 | IOT 插入可能触发行迁移 |
| 静态数据 | IOT | 优化读取 |

### 测试示例

```sql
-- 创建对比表
CREATE TABLE countries_heap AS SELECT * FROM countries;
CREATE TABLE countries_iot (CONSTRAINT pk_country PRIMARY KEY(country_id)) ORGANIZATION INDEX AS SELECT * FROM countries_heap;

-- 主键查询性能对比
EXPLAIN PLAN FOR SELECT * FROM countries_heap WHERE country_id = 100;
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY);

EXPLAIN PLAN FOR SELECT * FROM countries_iot WHERE country_id = 100;
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY);
```

---

## IOT 的维护

### 重建 IOT

```sql
-- 重建 IOT（回收空间、消除碎片）
ALTER TABLE countries MOVE;

-- 重建并修改参数
ALTER TABLE countries MOVE TABLESPACE users PCTTHRESHOLD 60 INCLUDING population;

-- 重建溢出段
ALTER TABLE order_items_iot MOVE OVERFLOW TABLESPACE overflow;
```

### 统计信息

```sql
-- 收集统计信息
BEGIN
    DBMS_STATS.GATHER_TABLE_STATS(USER, 'COUNTRIES');
END;
/

-- 查看统计信息
SELECT table_name, num_rows, blocks, iot_type
FROM user_tables
WHERE table_name = 'COUNTRIES';
```

---

## 面试高频问题

### Q1: IOT 和堆表有什么区别？

IOT 按主键顺序存储数据，表本身就是索引结构，主键查询无需回表；堆表数据无序存储，通过 ROWID 定位，需要回表获取完整数据。IOT 适合主键查询频繁的场景，堆表适合 DML 操作频繁的场景。

### Q2: IOT 必须有主键吗？

是的。IOT 必须定义主键，因为主键决定了数据的物理存储顺序。没有主键的表不能创建为 IOT。

### Q3: PCTTHRESHOLD 和 INCLUDING 的区别？

PCTTHRESHOLD 设置行大小阈值，超过该比例的行数据会溢出；INCLUDING 指定从哪个列开始溢出，INCLUDING 之后的所有列都会溢出到溢出段。

---

## 总结

| 特性 | IOT | 堆表 |
|-----|-----|------|
| 存储方式 | 主键索引组织 | 无序堆 |
| 主键查询 | 一次 I/O | 两次 I/O |
| ROWID | 无 | 有 |
| 范围扫描 | 快 | 慢 |
| 溢出段 | 可选 | 无 |
| 主键要求 | 必须有 | 可选 |

IOT 是优化读取性能的有力工具，但要根据实际场景选择。

---

## 下一步

- [Oracle 分区表](/database/oracle/partition)：大表如何分区管理
- [Oracle 索引类型](/database/oracle/index-type)：各种索引的特点与选择
