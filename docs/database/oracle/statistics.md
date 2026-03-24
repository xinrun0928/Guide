# Oracle 统计信息：优化器的「眼睛」

你有没有遇到过这种情况：

同样的 SQL，昨天快今天慢。

明明加了索引，Oracle 就是不用。

表里只有 100 条数据，Oracle 却做了全表扫描。

这些问题的答案，都在统计信息里。

---

## 什么是统计信息？

统计信息是 Oracle 收集的关于表、索引、列的数据特征：

```
统计信息内容：
├── 表统计
│   ├── 行数（NUM_ROWS）
│   ├── 块数（BLOCKS）
│   └── 平均行长度（AVG_ROW_LEN）
├── 列统计
│   ├── 唯一值数量（NUM_DISTINCT）
│   ├── 空值数量（NULLS）
│   └── 数据分布（直方图）
└── 索引统计
    ├── 唯一值（NUM_DISTINCT）
    ├── 叶块数（LEAF_BLOCKS）
    └── 聚簇因子（CLUSTERING_FACTOR）
```

---

## 统计信息的作用

Oracle 优化器根据统计信息选择最优执行计划：

```sql
-- 没有统计信息：优化器「瞎猜」
SELECT * FROM employees WHERE department_id = 50;
-- 优化器假设返回 1000 行
-- 可能选择全表扫描

-- 有统计信息：优化器「看数据」
SELECT * FROM employees WHERE department_id = 50;
-- 优化器知道只有 50 行
-- 可能选择索引扫描
```

---

## 查看统计信息

### 查看表统计

```sql
-- 查看表统计信息
SELECT table_name, num_rows, blocks, avg_row_len, 
       sample_size, last_analyzed
FROM user_tables
WHERE table_name = 'EMPLOYEES';
```

### 查看列统计

```sql
-- 查看列统计信息
SELECT column_name, num_distinct, num_nulls, 
       density, histogram, sample_size, last_analyzed
FROM user_tab_columns
WHERE table_name = 'EMPLOYEES'
ORDER BY column_id;
```

### 查看直方图

```sql
-- 查看直方图信息
SELECT column_name, endpoint_number, endpoint_value
FROM user_tab_histograms
WHERE table_name = 'EMPLOYEES'
  AND column_name = 'DEPARTMENT_ID'
ORDER BY endpoint_number;
```

### 查看索引统计

```sql
-- 查看索引统计信息
SELECT index_name, blevel, leaf_blocks, distinct_keys,
       avg_leaf_blocks_per_key, avg_data_blocks_per_key,
       clustering_factor, last_analyzed
FROM user_indexes
WHERE table_name = 'EMPLOYEES';
```

---

## 收集统计信息

### DBMS_STATS 基本用法

```sql
-- 收集表统计信息
BEGIN
    DBMS_STATS.GATHER_TABLE_STATS(
        ownname => USER,           -- 用户名
        tabname => 'EMPLOYEES',    -- 表名
        cascade => TRUE,           -- 同时收集索引统计
        estimate_percent => 10,    -- 采样比例
        method_opt => 'FOR ALL COLUMNS SIZE AUTO'  -- 直方图策略
    );
END;
/

-- 收集模式统计信息
BEGIN
    DBMS_STATS.GATHER_SCHEMA_STATS(
        ownname => USER,
        estimate_percent => 10,
        cascade => TRUE
    );
END;
/

-- 收集数据库统计信息
BEGIN
    DBMS_STATS.GATHER_DATABASE_STATS(
        estimate_percent => 10,
        cascade => TRUE
    );
END;
/
```

### GATHER_INDEX_STATS

```sql
-- 收集索引统计
BEGIN
    DBMS_STATS.GATHER_INDEX_STATS(
        ownname => USER,
        indname => 'IDX_EMP_DEPT',
        estimate_percent => 10
    );
END;
/
```

---

## 自动统计信息

### 查看自动统计任务

```sql
-- 查看自动统计信息收集任务
SELECT task_name, status, enabled
FROM dba_autotask_client
WHERE client_name = 'auto optimizer stats collection';

-- 查看任务历史
SELECT client_name, window_name, window_start_time, 
       window_duration, tasks_success, tasks_failed
FROM dba_autotask_client_history
ORDER BY window_start_time DESC;
```

### 手动控制自动任务

```sql
-- 禁用自动统计收集
BEGIN
    DBMS_AUTO_TASK_ADMIN.DISABLE(
        client_name => 'auto optimizer stats collection',
        operation => NULL,
        window_name => NULL
    );
END;
/

-- 启用自动统计收集
BEGIN
    DBMS_AUTO_TASK_ADMIN.ENABLE(
        client_name => 'auto optimizer stats collection',
        operation => NULL,
        window_name => NULL
    );
END;
/
```

---

## 直方图（Histogram）

### 什么是直方图？

直方图记录列值的数据分布，帮助优化器准确估算基数：

```sql
-- 没有直方图：优化器假设均匀分布
-- 10000 行，10 个部门，平均每部门 1000 行
-- 实际：9 个部门各 10 行，1 个部门 9910 行
-- 优化器估算错误，选择全表扫描

-- 有直方图：优化器知道实际分布
CREATE INDEX idx_emp_dept ON employees(department_id);
-- Oracle 自动收集直方图（数据倾斜时）
```

### 直方图类型

| 类型 | 说明 | 适用场景 |
|-----|------|---------|
| HEIGHT BALANCED | 等高直方图 | 有限个不同值 |
| FREQUENCY | 频率直方图 | 值很少（<254） |

### 直方图收集策略

```sql
-- 自动（Oracle 推荐）
BEGIN
    DBMS_STATS.GATHER_TABLE_STATS(
        USER, 'EMPLOYEES',
        method_opt => 'FOR ALL COLUMNS SIZE AUTO'
    );
END;
/

-- 只收集有数据的列
BEGIN
    DBMS_STATS.GATHER_TABLE_STATS(
        USER, 'EMPLOYEES',
        method_opt => 'FOR COLUMNS SIZE AUTO department_id'
    );
END;
/

-- 手动指定桶数
BEGIN
    DBMS_STATS.GATHER_TABLE_STATS(
        USER, 'EMPLOYEES',
        method_opt => 'FOR COLUMNS SIZE 50 department_id'
    );
END;
/
```

---

## 统计信息管理

### 查看统计信息历史

```sql
-- 查看统计信息历史
SELECT table_name, stattype_locked, stats_update_time
FROM user_tab_stats_history
WHERE table_name = 'EMPLOYEES';

-- 查看统计信息更新时间
SELECT table_name, last_analyzed
FROM user_tables
WHERE table_name = 'EMPLOYEES';
```

### 恢复统计信息

```sql
-- 恢复到之前版本的统计信息
BEGIN
    DBMS_STATS.RESTORE_TABLE_STATS(
        ownname => USER,
        tabname => 'EMPLOYEES',
        as_of_timestamp => SYSDATE - 1  -- 恢复到一天前
    );
END;
/

-- 删除过时的统计信息
BEGIN
    DBMS_STATS.PURGE_STATS(
        before_timestamp => SYSDATE - 30  -- 删除 30 天前的统计信息
    );
END;
/
```

### 锁定统计信息

```sql
-- 锁定表统计信息（防止自动收集覆盖）
BEGIN
    DBMS_STATS.LOCK_TABLE_STATS(
        ownname => USER,
        tabname => 'EMPLOYEES'
    );
END;
/

-- 解锁表统计信息
BEGIN
    DBMS_STATS.UNLOCK_TABLE_STATS(
        ownname => USER,
        tabname => 'EMPLOYEES'
    );
END;
/
```

---

## 统计信息问题排查

### 问题一：统计信息过期

```sql
-- 查看数据量与统计信息对比
SELECT table_name, 
       num_rows "统计行数",
       (SELECT COUNT(*) FROM employees) "实际行数"
FROM user_tables
WHERE table_name = 'EMPLOYEES';

-- 如果差异超过 10%，需要重新收集统计信息
```

### 问题二：统计信息缺失

```sql
-- 查看哪些表没有统计信息
SELECT table_name
FROM user_tables
WHERE num_rows IS NULL;

-- 收集统计信息
BEGIN
    DBMS_STATS.GATHER_TABLE_STATS(USER, 'EMPLOYEES');
END;
/
```

### 问题三：直方图缺失

```sql
-- 查看哪些列需要直方图
SELECT column_name, num_distinct, histogram
FROM user_tab_columns
WHERE table_name = 'EMPLOYEES'
  AND num_distinct > 1
  AND histogram = 'NONE';

-- 收集直方图
BEGIN
    DBMS_STATS.GATHER_TABLE_STATS(
        USER, 'EMPLOYEES',
        method_opt => 'FOR ALL COLUMNS SIZE AUTO'
    );
END;
/
```

---

## 性能调优场景

### 场景：批量导入后

```sql
-- 批量导入数据后，必须收集统计信息
INSERT /*+ APPEND */ INTO employees SELECT * FROM source_employees;
COMMIT;

-- 收集统计信息
BEGIN
    DBMS_STATS.GATHER_TABLE_STATS(USER, 'EMPLOYEES');
END;
/
```

### 场景：分区表统计

```sql
-- 收集分区统计
BEGIN
    DBMS_STATS.GATHER_TABLE_STATS(
        ownname => USER,
        tabname => 'ORDERS',
        partname => 'P_2024_Q1',  -- 指定分区
        cascade => TRUE
    );
END;
/

-- 收集全局统计
BEGIN
    DBMS_STATS.GATHER_TABLE_STATS(
        ownname => USER,
        tabname => 'ORDERS',
        granularity => 'GLOBAL',
        cascade => TRUE
    );
END;
/
```

---

## 面试高频问题

### Q1: 统计信息过期会导致什么问题？

优化器基于过期的统计信息选择执行计划，可能选择错误的执行计划（如应该用索引却用全表扫描），导致 SQL 性能下降。

### Q2: 什么是直方图？什么时候需要？

直方图记录列值的数据分布，帮助优化器准确估算基数。当列值分布不均匀（倾斜）时，需要直方图。Oracle 11g+ 会自动决定是否收集直方图。

### Q3: 如何处理统计信息导致的问题？

恢复之前的统计信息（`DBMS_STATS.RESTORE_TABLE_STATS`）、手动收集新的统计信息、锁定统计信息防止自动覆盖。

---

## 总结

统计信息是优化器决策的基础：

| 统计类型 | 内容 | 重要性 |
|---------|------|--------|
| 表统计 | 行数、块数、平均行长度 | 高 |
| 列统计 | 唯一值、空值数 | 高 |
| 直方图 | 数据分布 | 中（倾斜时高） |
| 索引统计 | 聚簇因子、叶块数 | 高 |

保持统计信息准确，是 SQL 性能稳定的前提。

---

## 下一步

- [Oracle 绑定变量](/database/oracle/bind-variable)：执行计划共享
- [Oracle SQL 优化](/database/oracle/sql-tuning)：慢查询调优技巧
