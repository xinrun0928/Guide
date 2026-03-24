# Oracle 索引类型：让查询飞起来

你知道 Oracle 为什么能在毫秒级查询千万级数据吗？

不是硬件有多强，是索引的功劳。

但索引不是万能的——用错索引，反而拖累性能。

今天，系统梳理 Oracle 索引类型，让你的查询恰到好处。

---

## 索引基础

### 索引是什么？

索引是数据库中一种特殊的数据结构，用于加速数据检索。就像书籍的目录，不需要翻完整本书就能找到目标内容。

```sql
-- 创建索引
CREATE INDEX idx_emp_name ON employees(name);

-- 创建复合索引
CREATE INDEX idx_emp_dept_sal ON employees(department_id, salary DESC);

-- 查看索引
SELECT index_name, table_name, uniqueness, index_type
FROM user_indexes
WHERE table_name = 'EMPLOYEES';
```

### 索引的代价

| 代价 | 说明 |
|-----|------|
| 存储空间 | 索引本身占用磁盘空间 |
| 写入性能 | INSERT/UPDATE/DELETE 需要维护索引 |
| 维护成本 | 索引碎片需要定期整理 |

---

## B 树索引（B-Tree Index）

### 什么是 B 树索引？

B 树索引是 Oracle 默认的索引类型，结构类似倒立的树，平衡查找。

```
                    [50]
                  /       \
            [20, 30]      [70, 90]
            /     \       /       \
          ...    ...    ...       ...
```

### B 树索引适用场景

| 适用 | 不适用 |
|-----|-------|
| 高基数列（唯一或近似唯一） | 低基数列（性别、状态） |
| 范围查询 | 模糊查询（前缀%） |
| 排序 | 不等于查询（NOT EQUAL） |
| 主键、外键 | 全表扫描更快 |

```sql
-- 默认创建的就是 B 树索引
CREATE INDEX idx_emp_name ON employees(name);  -- B 树索引

-- 指定 B 树类型
CREATE INDEX idx_emp_id ON employees(employee_id) BITMAP;  -- 位图索引，不是 B 树
```

### B 树索引的变体

#### 1. 唯一索引

```sql
-- 唯一索引：保证列值唯一
CREATE UNIQUE INDEX idx_emp_email ON employees(email);

-- 主键自动创建唯一索引
ALTER TABLE employees ADD PRIMARY KEY (employee_id);
```

#### 2. 反向键索引

```sql
-- 反向键索引：适合递增序列值
CREATE INDEX idx_emp_id_reverse ON employees(employee_id) REVERSE;

-- 原理：索引键值被反转存储
-- 1001 -> 1001
-- 1002 -> 2001
-- 1003 -> 3001
-- 这样相邻的值索引位置分散，减少热块竞争
```

#### 3. 压缩索引

```sql
-- 压缩索引：减少存储空间
CREATE INDEX idx_emp_dept ON employees(department_id) COMPRESS 1;

-- 原理：重复的键值只存储一次
-- 适合前缀重复率高的列
```

---

## 位图索引（Bitmap Index）

### 什么是位图索引？

位图索引用位图表示每个键值的出现情况，适合低基数列。

```sql
-- 位图索引：适合低基数列
CREATE BITMAP INDEX idx_emp_gender ON employees(gender);       -- 只有 M/F
CREATE BITMAP INDEX idx_emp_status ON employees(status);     -- ACTIVE/INACTIVE
CREATE BITMAP INDEX idx_emp_dept_bm ON employees(department_id);
```

### 位图索引的位图表示

| ROWID | GENDER=M | GENDER=F |
|-------|----------|----------|
| AA... | 1 | 0 |
| AB... | 0 | 1 |
| AC... | 1 | 0 |
| AD... | 0 | 1 |

### 位图索引的位运算

```sql
-- 查询男性且在职的员工
SELECT * FROM employees
WHERE gender = 'M' AND status = 'ACTIVE';

-- Oracle 自动进行位图运算
-- GENDER='M' 的位图 AND STATUS='ACTIVE' 的位图
```

### B 树 vs 位图

| 特性 | B 树索引 | 位图索引 |
|-----|---------|---------|
| 适用列基数 | 高 | 低 |
| 存储空间 | 较大 | 较小 |
| DML 性能 | 较好 | 较差（锁粒度粗） |
| 并发支持 | 好 | 差 |
| OR/AND 运算 | 需要合并 | 位图运算 |

### 位图索引的坑

位图索引在 OLTP 环境中要慎用，因为位图锁会锁定整个位图段：

```sql
-- 位图索引的问题：并发更新时可能锁定大片数据
-- 会话 1: UPDATE employees SET status='ACTIVE' WHERE gender='F';
-- 会话 2: UPDATE employees SET status='INACTIVE' WHERE gender='F';
-- 两个会话可能相互阻塞
```

---

## 复合索引（Composite Index）

### 什么是复合索引？

复合索引在多个列上创建，遵循最左前缀原则。

```sql
-- 复合索引
CREATE INDEX idx_emp_dept_sal ON employees(department_id, salary DESC, hire_date);

-- 等效查询（可以使用索引）
SELECT * FROM employees WHERE department_id = 50;                    -- 使用前导列
SELECT * FROM employees WHERE department_id = 50 AND salary > 5000;  -- 使用前导列+第二列
SELECT * FROM employees WHERE department_id = 50 AND salary > 5000 AND hire_date > '2024-01-01';  -- 全部使用

-- 不能使用索引（跳过前导列）
SELECT * FROM employees WHERE salary > 5000;
SELECT * FROM employees WHERE hire_date > '2024-01-01';
```

### 列顺序原则

| 原则 | 说明 |
|-----|------|
| 等值查询优先 | 将等值列放前面 |
| 选择性高优先 | 区分度高的列放前面 |
| 范围列放最后 | 范围条件后面的列无法使用索引 |

```sql
-- 好例子：等值 + 范围
CREATE INDEX idx_good ON orders(customer_id, order_date);
-- 可以优化：customer_id=100 AND order_date > '2024-01-01'

-- 问题例子：范围放前面
CREATE INDEX idx_bad ON orders(order_date, customer_id);
-- customer_id 条件无法使用索引
```

---

## 函数索引（Function-Based Index）

### 什么是函数索引？

函数索引在表达式上创建索引，包含计算后的值。

```sql
-- 函数索引：在大写列上查询
CREATE INDEX idx_emp_name_upper ON employees(UPPER(name));

-- 可以使用索引的查询
SELECT * FROM employees WHERE UPPER(name) = 'ZHANG SAN';

-- 无法使用索引的查询（未使用函数）
SELECT * FROM employees WHERE name = 'Zhang San';
```

### 常用函数索引场景

```sql
-- 1. 大小写不敏感查询
CREATE INDEX idx_emp_email_lower ON employees(LOWER(email));

-- 2. 日期计算
CREATE INDEX idx_emp_hire_year ON employees(EXTRACT(YEAR FROM hire_date));

-- 3. 计算列
CREATE INDEX idx_order_total ON orders(total_amount + tax_amount - discount);

-- 4. 条件表达式
CREATE INDEX idx_emp_active ON employees(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END);
```

### 使用函数索引的注意事项

```sql
-- 函数必须是确定的（不依赖 SYSDATE 等）
CREATE INDEX idx_order_year ON orders(order_date);  -- 好
CREATE INDEX idx_order_next_day ON orders(order_date + 1);  -- 可以

-- 需要设置 QUERY REWRITE INTEGRITY
ALTER SYSTEM SET QUERY_REWRITE_ENABLED = TRUE;
```

---

## 其他索引类型

### 1. 全文索引（Text Index）

```sql
-- 创建全文索引
CREATE INDEX idx_emp_resume ON employees(resume) INDEXTYPE IS CTXSYS.CONTEXT;

-- 使用 CONTAINS 查询
SELECT * FROM employees
WHERE CONTAINS(resume, 'Oracle PL/SQL');
```

### 2. 域索引（Domain Index）

用于特定应用场景，如空间数据、多媒体数据。

```sql
-- 空间数据索引（需要 Oracle Spatial）
CREATE INDEX idx_location ON customers(location) INDEXTYPE IS MDSYS.SPATIAL_INDEX;
```

### 3. 位图连接索引（Bitmap Join Index）

```sql
-- 为连接创建索引
CREATE BITMAP INDEX idx_emp_dept_name ON employees(departments.dept_name)
FROM employees, departments
WHERE employees.dept_id = departments.dept_id;
```

---

## 索引管理

### 查看索引

```sql
-- 查看表的所有索引
SELECT index_name, column_name, column_position
FROM user_ind_columns
WHERE table_name = 'EMPLOYEES'
ORDER BY index_name, column_position;

-- 查看索引使用情况
SELECT * FROM v$object_usage;
```

### 重建索引

```sql
-- 重建索引
ALTER INDEX idx_emp_name REBUILD;

-- 重建并移动表空间
ALTER INDEX idx_emp_name REBUILD TABLESPACE users;

-- 合并索引（清理碎片）
ALTER INDEX idx_emp_name COALESCE;
```

### 监控索引使用

```sql
-- 开始监控
ALTER INDEX idx_emp_name MONITORING USAGE;

-- 查看监控结果
SELECT * FROM v$object_usage WHERE index_name = 'IDX_EMP_NAME';

-- 停止监控
ALTER INDEX idx_emp_name NOMONITORING USAGE;
```

### 删除索引

```sql
-- 删除索引
DROP INDEX idx_emp_name;

-- 删除约束会自动删除索引
ALTER TABLE employees DROP CONSTRAINT pk_emp;
```

---

## 索引设计原则

| 原则 | 说明 |
|-----|------|
| 不要索引所有列 | 只索引频繁查询的列 |
| 选择合适的列顺序 | 等值列优先，高选择性列优先 |
| 避免过多索引 | 每个索引增加写入开销 |
| 定期监控和清理 | 删除不用的索引 |
| 复合索引考虑覆盖 | SELECT 列都在索引中时，无需回表 |

---

## 面试高频问题

### Q1: 复合索引的最左前缀原则是什么？

复合索引 `(A, B, C)` 可以被查询 `(A)`、`(A, B)`、`(A, B, C)` 使用，但不能被 `(B)`、`(C)`、`(B, C)` 使用。

### Q2: 什么时候用 B 树索引，什么时候用位图索引？

B 树索引适合高基数列（唯一或近似唯一）、需要范围查询、并发写入的 OLTP 系统；位图索引适合低基数列（枚举值）、静态数据、OLAP 报表系统。

### Q3: 函数索引有什么用？

函数索引可以对表达式结果建索引，使得使用函数的查询也能走索引。例如 `UPPER(name)` 上建函数索引，`WHERE UPPER(name) = 'XXX'` 就可以使用索引。

---

## 总结

| 索引类型 | 适用场景 | 注意事项 |
|---------|---------|---------|
| B 树索引 | 高基数列、主键、外键 | 最常用的索引 |
| 位图索引 | 低基数列、静态数据 | 并发更新慎用 |
| 复合索引 | 多条件查询 | 遵循最左前缀 |
| 函数索引 | 函数表达式查询 | 必须是确定性函数 |
| 唯一索引 | 唯一约束 | 自动创建主键索引 |

选对索引，是 SQL 优化的第一步。

---

## 下一步

- [Oracle 分区表](/database/oracle/partition)：大表如何分区
- [Oracle SQL 优化](/database/oracle/sql-tuning)：慢查询如何调优
