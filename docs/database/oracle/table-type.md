# Oracle 表类型：不止是「堆表」

你以为表只有一种？

Oracle 的表类型远比你想象的丰富。

堆表、临时表、索引表、聚簇表……每种都有它的适用场景。

今天，重新认识 Oracle 的表类型。

---

## Oracle 表类型概览

| 类型 | 说明 | 适用场景 |
|-----|------|---------|
| 堆表（Heap Table） | 默认表类型，无序存储 | 大部分场景 |
| 临时表（Temporary Table） | 会话或事务结束后自动清空 | 临时计算结果 |
| 索引表（IOT） | 主键索引组织，物理有序 | 主键查询频繁 |
| 聚簇表（Clustered Table） | 多表物理聚簇存储 | 多表关联查询 |
| 分区表（Partitioned Table） | 大表按规则拆分 | 海量数据管理 |

---

## 堆表（Heap Table）

### 什么是堆表？

堆表是 Oracle 默认的表类型，数据无序存储，按需分配空间。

```sql
-- 默认创建的表就是堆表
CREATE TABLE employees (
    employee_id NUMBER PRIMARY KEY,
    name VARCHAR2(100),
    email VARCHAR2(100),
    hire_date DATE,
    salary NUMBER(10, 2)
) TABLESPACE users;

-- 查看表类型
SELECT table_name, cluster_name, iot_name, temporary
FROM user_tables
WHERE table_name = 'EMPLOYEES';
```

### 堆表的特点

| 特点 | 说明 |
|-----|------|
| 无序存储 | 数据按插入顺序存储 |
| ROWID 定位 | 每行数据有唯一的 ROWID |
| 灵活扩展 | 空间按需分配 |
| 全表扫描 | 大量数据时可能需要全表扫描 |

---

## 临时表（Temporary Table）

### 什么是临时表？

临时表存储临时数据，会话结束或事务结束后自动清空。

### 会话级临时表

```sql
-- 会话级临时表：数据在会话结束前有效
CREATE GLOBAL TEMPORARY TABLE temp_session_data (
    session_id NUMBER,
    data_value VARCHAR2(100),
    created_at DATE
) ON COMMIT PRESERVE ROWS;

-- 插入数据
INSERT INTO temp_session_data VALUES (1, '测试数据', SYSDATE);

-- 提交事务后，数据仍然存在
COMMIT;

-- 会话结束，数据自动清空
```

### 事务级临时表

```sql
-- 事务级临时表：事务结束自动清空
CREATE GLOBAL TEMPORARY TABLE temp_transaction_data (
    id NUMBER,
    description VARCHAR2(100)
) ON COMMIT DELETE ROWS;

-- 插入
INSERT INTO temp_transaction_data VALUES (1, '事务数据');

-- 提交后，数据被清空
COMMIT;

-- SELECT 会返回空
```

### 临时表的特性

| 特性 | 会话级 | 事务级 |
|-----|--------|--------|
| 语法 | ON COMMIT PRESERVE ROWS | ON COMMIT DELETE ROWS |
| 数据保留 | 会话结束前 | 事务结束前 |
| 多会话隔离 | 完全隔离 | 完全隔离 |
| 索引 | 可以创建 | 可以创建 |
| 统计信息 | 不收集 | 不收集 |

```sql
-- 查看临时表
SELECT table_name, temporary, duration
FROM user_tables
WHERE temporary = 'Y';

-- 临时表支持 DML
INSERT INTO temp_session_data VALUES (1, '测试');
UPDATE temp_session_data SET description = '新值' WHERE id = 1;
DELETE FROM temp_session_data WHERE id = 1;

-- 临时表可以建索引
CREATE INDEX idx_temp_session ON temp_session_data(session_id);

-- 临时表可以建约束
ALTER TABLE temp_session_data ADD CONSTRAINT pk_temp PRIMARY KEY (session_id);
```

### 临时表实战场景

```java
// 场景：批量处理时存储中间结果
public void batchProcess(List&lt;Long&gt; orderIds) {
    // 1. 将订单 ID 插入临时表
    String insertTemp = "INSERT INTO temp_order_ids VALUES (?)";
    try (PreparedStatement ps = conn.prepareStatement(insertTemp)) {
        for (Long orderId : orderIds) {
            ps.setLong(1, orderId);
            ps.executeUpdate();
        }
    }
    
    // 2. 关联临时表查询
    String querySql = """
        SELECT o.*, i.* 
        FROM orders o
        JOIN temp_order_ids t ON o.order_id = t.order_id
        JOIN order_items i ON o.order_id = i.order_id
        """;
    
    // 3. 处理结果
    // ...
    
    // 4. 会话结束，临时表自动清空
}
```

---

## 索引组织表（IOT - Index Organized Table）

### 什么是 IOT？

IOT 将数据按照主键顺序物理存储，表本身就是索引结构。

```sql
CREATE TABLE countries (
    country_id NUMBER PRIMARY KEY,
    country_name VARCHAR2(100),
    region_id NUMBER
) ORGANIZATION INDEX;

-- 查看 IOT
SELECT table_name, iot_type, iot_name
FROM user_tables
WHERE iot_type IS NOT NULL;
```

### IOT vs 堆表

| 特性 | IOT | 堆表 |
|-----|-----|------|
| 存储方式 | 主键索引 | 无序堆 |
| ROWID | 无（使用主键） | 有 |
| 空间使用 | 更少（无冗余） | 可能有碎片 |
| 主键查询 | 更快 | 需要索引回表 |
| 非主键列 | 存储在溢出段 | 存储在行中 |
| 适合场景 | 主键频繁查询 | 宽表、DML频繁 |

### IOT 的溢出段

当 IOT 的行超过一定大小时，非主键列会存储在溢出段：

```sql
CREATE TABLE order_items_iot (
    order_id NUMBER,
    item_id NUMBER,
    product_name VARCHAR2(100),
    description VARCHAR2(1000),  -- 大字段溢出
    quantity NUMBER,
    price NUMBER(10, 2),
    PRIMARY KEY (order_id, item_id)
) ORGANIZATION INDEX
TABLESpace users
PCTTHRESHOLD 50              -- 行超过块容量的50%时溢出
INCLUDING product_name        -- product_name 及其后的列溢出
OVERFLOW TABLESPACE overflow;
```

### IOT 适用场景

1. **主键查询为主**：如配置表、字典表
2. **需要范围扫描**：如时间序列数据
3. **表空间紧凑**：减少存储空间

```sql
-- IOT 的优势：主键范围查询更快
SELECT * FROM countries
WHERE country_id BETWEEN 100 AND 200;
-- 不需要回表，数据按主键顺序存储
```

---

## 聚簇表（Clustered Table）

### 什么是聚簇表？

聚簇表将多个表的相关数据物理存储在一起，减少磁盘 I/O。

### Hash Cluster

```sql
-- 创建 HASH CLUSTER
CREATE CLUSTER emp_dept_cluster (
    dept_id NUMBER
) HASHKEYS 100;

-- 在聚簇中创建表
CREATE TABLE emp_cluster (
    employee_id NUMBER,
    name VARCHAR2(100),
    dept_id NUMBER
) CLUSTER emp_dept_cluster(dept_id);

CREATE TABLE dept_cluster (
    dept_id NUMBER PRIMARY KEY,
    dept_name VARCHAR2(100)
) CLUSTER emp_dept_cluster(dept_id);
```

### Index Cluster

```sql
-- 创建 INDEX CLUSTER
CREATE CLUSTER emp_cluster (
    dept_id NUMBER
);

-- 创建索引聚簇的索引
CREATE INDEX emp_cluster_idx ON CLUSTER emp_cluster;

-- 在聚簇中创建表
CREATE TABLE emp_in_cluster (
    employee_id NUMBER,
    name VARCHAR2(100),
    dept_id NUMBER
) CLUSTER emp_dept_cluster(dept_id);
```

### 聚簇表的特性

| 特性 | 说明 |
|-----|------|
| 多表聚簇 | 相关表物理存储在一起 |
| 减少 I/O | 关联查询可能一次 I/O 完成 |
| 固定空间 | 创建时分配固定空间 |
| 更新影响大 | 更新聚簇键可能导致行迁移 |

---

## 外部表（External Table）

### 什么是外部表？

外部表访问存储在文件系统中的数据，像访问普通表一样：

```sql
-- 创建外部表（数据在 /u01/data 目录下）
CREATE TABLE ext_employees (
    employee_id NUMBER,
    name VARCHAR2(100),
    salary NUMBER
)
ORGANIZATION EXTERNAL (
    TYPE ORACLE_LOADER
    DEFAULT DIRECTORY data_dir
    ACCESS PARAMETERS (
        RECORDS DELIMITED BY NEWLINE
        FIELDS TERMINATED BY ','
        (employee_id, name, salary)
    )
    LOCATION ('employees.csv')
);

-- 查询外部表
SELECT * FROM ext_employees;

-- 不能 DML，只能查询
```

### 外部表的使用场景

1. **ETL 数据加载**：数据仓库场景
2. **日志分析**：分析数据库告警日志
3. **数据迁移**：临时表过渡

---

## 表类型选择指南

| 场景 | 推荐表类型 |
|-----|-----------|
| 一般业务表 | 堆表 |
| 临时计算结果 | 临时表 |
| 主键频繁查询 | IOT |
| 多表关联查询 | 聚簇表 |
| 配置/字典表 | IOT |
| 大数据导入 | 外部表 |
| 分区大表 | 分区表（见后续章节） |

---

## 查看表信息

```sql
-- 查看表结构和类型
SELECT table_name, tablespace_name, cluster_name, iot_name, temporary
FROM user_tables
ORDER BY table_name;

-- 查看表的列
SELECT column_id, column_name, data_type, data_length, nullable
FROM user_tab_columns
WHERE table_name = 'EMPLOYEES'
ORDER BY column_id;

-- 查看表的约束
SELECT constraint_name, constraint_type, search_condition
FROM user_constraints
WHERE table_name = 'EMPLOYEES';
```

---

## 面试高频问题

### Q1: 堆表和 IOT 的区别？

堆表数据无序存储，通过 ROWID 定位；IOT 按主键顺序存储，表本身就是索引结构，没有 ROWID。IOT 查询主键更快，但非主键列有溢出开销。

### Q2: 会话级临时表和事务级临时表的区别？

会话级临时表（ON COMMIT PRESERVE ROWS）在会话结束前数据保留，事务结束后仍可查询；事务级临时表（ON COMMIT DELETE ROWS）在事务提交后自动清空。

### Q3: 什么时候适合用 IOT？

主键查询为主的场景（如配置表、字典表）、需要主键范围扫描、追求存储空间紧凑的场景。

---

## 总结

Oracle 提供了丰富的表类型：

| 类型 | 特点 | 选择建议 |
|-----|------|---------|
| 堆表 | 默认，无序灵活 | 大部分场景 |
| 临时表 | 自动清空 | 临时计算结果 |
| IOT | 主键索引组织 | 主键频繁查询 |
| 聚簇表 | 多表物理聚合 | 多表关联优化 |

根据业务场景选择合适的表类型，可以显著提升性能。

---

## 下一步

- [Oracle 索引类型](/database/oracle/index-type)：B树、位图、函数索引
- [Oracle 分区表](/database/oracle/partition)：大表分割策略
