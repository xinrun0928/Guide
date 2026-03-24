# Oracle 执行计划：SQL 执行的神秘「地图」

你有没有遇到过这种情况：

一条 SQL 明明有索引，却跑了十几秒。

Explain Plan 里全是 TABLE ACCESS FULL。

你怀疑 Oracle 脑子坏了，但其实是你的 SQL 写法有问题。

今天，学会读懂 Oracle 的执行计划。

---

## 什么是执行计划？

执行计划是 Oracle 解析 SQL 后生成的「执行路线图」，告诉你 Oracle 会如何执行这条 SQL。

```sql
-- 查看执行计划
EXPLAIN PLAN FOR
SELECT * FROM employees WHERE department_id = 50;

SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY);
```

---

## EXPLAIN PLAN 基本用法

### 查看执行计划

```sql
-- 1. 生成执行计划
EXPLAIN PLAN FOR
SELECT e.employee_id, e.name, d.dept_name
FROM employees e
JOIN departments d ON e.department_id = d.department_id
WHERE e.salary > 5000;

-- 2. 查看执行计划
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY);

-- 3. 查看更详细的执行计划（Oracle 11g+）
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(FORMAT => 'ALL'));
```

### 使用 AUTOTRACE

```sql
-- 启用 AUTOTRACE（SQL*Plus 或 SQL Developer）
SET AUTOTRACE ON;

-- 只会显示执行计划，不实际执行
SET AUTOTRACE TRACEONLY;

-- 显示执行计划 + 统计信息
SET AUTOTRACE TRACEONLY STATISTICS;

-- 关闭 AUTOTRACE
SET AUTOTRACE OFF;
```

---

## 执行计划解读

### 典型执行计划示例

```
Plan hash value: 1234567890

-----------------------------------------------------------------------------------------
| Id | Operation                    | Name    | Rows | Bytes | Cost (%CPU)| Pstart| Pstop |
-----------------------------------------------------------------------------------------
|   0| SELECT STATEMENT             |         |  100 |  3000| 5 (0)     |        |       |
|   1|  TABLE ACCESS BY INDEX ROWID|EMPLOYEES|  100|  3000| 3 (0)     |        |       |
|*  2|   INDEX RANGE SCAN          |EMP_DEPT |   50|      | 2 (0)     |        |       |
|   3|  TABLE ACCESS BY INDEX ROWID|DEPARTMENTS|   1|    20| 1 (0)     |        |       |
|*  4|   INDEX UNIQUE SCAN         |PK_DEPT  |   1|      | 0 (0)     |        |       |
-----------------------------------------------------------------------------------------

Predicate Information (identified by operation id):
---------------------------------------------------
   2 - access("E"."DEPARTMENT_ID"=50)
   4 - access("D"."DEPARTMENT_ID"=50)
```

### 关键列解读

| 列名 | 说明 |
|-----|------|
| Id | 操作步骤编号 |
| Operation | 操作类型（表访问、索引访问等） |
| Name | 访问的对象名（表或索引） |
| Rows | Oracle 预估的行数 |
| Bytes | 预估的字节数 |
| Cost | Oracle 计算的成本值 |
| Pstart/Pstop | 分区范围（分区表） |

### 常见操作类型

| 操作 | 说明 | 性能 |
|-----|------|------|
| TABLE ACCESS FULL | 全表扫描 | 慢 |
| TABLE ACCESS BY INDEX ROWID | 通过 ROWID 访问表 | 快 |
| INDEX UNIQUE SCAN | 索引唯一扫描 | 最快 |
| INDEX RANGE SCAN | 索引范围扫描 | 快 |
| INDEX FULL SCAN | 索引全扫描 | 中等 |
| INDEX FAST FULL SCAN | 索引快速全扫描 | 较快 |
| NESTED LOOP | 嵌套循环连接 | 适合小表 |
| HASH JOIN | 哈希连接 | 适合大表 |
| MERGE JOIN | 排序合并连接 | 适合已排序数据 |

---

## 全表扫描 vs 索引扫描

### 全表扫描（TABLE ACCESS FULL）

```sql
-- 触发全表扫描
SELECT * FROM employees WHERE salary > 5000;

-- 执行计划
-- |   0| SELECT STATEMENT             |
-- |   1|  TABLE ACCESS FULL|EMPLOYEES|  -- 全表扫描

-- 全表扫描特点：
-- - 读取整个表的所有数据块
-- - 不受索引影响
-- - 适合数据量小的表（<5%）
-- - 适合返回大量数据（>20%）
```

### 索引扫描

```sql
-- 索引唯一扫描（最佳）
SELECT * FROM employees WHERE employee_id = 100;
-- |   1|   INDEX UNIQUE SCAN|PK_EMP|

-- 索引范围扫描（常用）
SELECT * FROM employees WHERE department_id = 50;
-- |   1|   INDEX RANGE SCAN|IDX_EMP_DEPT|

-- 索引全扫描
SELECT * FROM employees ORDER BY name;
-- |   1|   INDEX FULL SCAN|IDX_EMP_NAME|
```

### 选择原则

| 场景 | 推荐访问方式 |
|-----|------------|
| 小表（< 1000 行） | 全表扫描 |
| 返回大量数据（> 20%） | 全表扫描 |
| 主键/唯一键查询 | 索引唯一扫描 |
| 范围查询 | 索引范围扫描 |
| 大表 + 少量数据 | 索引扫描 + 回表 |

---

## 连接方式

### 嵌套循环连接（NESTED LOOP）

```sql
-- 触发嵌套循环
SELECT * FROM employees e, departments d
WHERE e.dept_id = d.dept_id;

-- 执行计划
-- |   0| SELECT STATEMENT             |
-- |   1|  NESTED LOOPS                |
-- |   2|   TABLE ACCESS FULL|EMPLOYEES|
-- |   3|   TABLE ACCESS BY INDEX ROWID|DEPARTMENTS|
-- |   4|    INDEX UNIQUE SCAN|PK_DEPT|
```

适用场景：小表驱动大表，内表有索引

### 哈希连接（HASH JOIN）

```sql
-- 触发哈希连接
SELECT * FROM large_table1 t1, large_table2 t2
WHERE t1.id = t2.id;

-- 执行计划
-- |   0| SELECT STATEMENT             |
-- |   1|  HASH JOIN                  |
-- |   2|   TABLE ACCESS FULL|T1       |
-- |   3|   TABLE ACCESS FULL|T2       |
```

适用场景：大表连接，等值连接

### 排序合并连接（MERGE JOIN）

```sql
-- 触发排序合并
SELECT * FROM t1, t2
WHERE t1.id = t2.id
ORDER BY id;

-- 执行计划
-- |   0| SELECT STATEMENT             |
-- |   1|  MERGE JOIN                  |
-- |   2|   SORT JOIN                  |
-- |   3|    TABLE ACCESS FULL|T1       |
-- |   4|   SORT JOIN                  |
-- |   5|    TABLE ACCESS FULL|T2       |
```

适用场景：已排序的数据，大表连接

---

## 常见问题诊断

### 问题一：全表扫描

```sql
-- 问题 SQL
SELECT * FROM employees WHERE name = '张三';

-- 诊断
EXPLAIN PLAN FOR SELECT * FROM employees WHERE name = '张三';
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY);

-- 如果显示 TABLE ACCESS FULL
-- 解决：检查 name 列是否有索引
CREATE INDEX idx_emp_name ON employees(name);
```

### 问题二：索引失效

```sql
-- 问题 SQL：函数导致索引失效
SELECT * FROM employees WHERE UPPER(name) = 'ZHANG SAN';

-- 诊断
EXPLAIN PLAN FOR SELECT * FROM employees WHERE UPPER(name) = 'ZHANG SAN';

-- 解决：使用函数索引
CREATE INDEX idx_emp_name_upper ON employees(UPPER(name));

-- 问题 SQL：隐式类型转换
SELECT * FROM employees WHERE employee_id = '100';  -- 字符串和数字比较

-- 解决：使用正确的类型
SELECT * FROM employees WHERE employee_id = 100;
```

### 问题三：错误的驱动表

```sql
-- 问题：大表驱动小表
SELECT /*+ ORDERED */ * FROM large_table t1, small_table t2
WHERE t1.id = t2.id;

-- 解决：使用 LEADING 提示
SELECT /*+ LEADING(t2) */ * FROM large_table t1, small_table t2
WHERE t1.id = t2.id;
```

---

## 使用提示（HINT）优化

### 常用提示

```sql
-- 指定索引
SELECT /*+ INDEX(employees idx_emp_name) */ * 
FROM employees WHERE name = '张三';

-- 指定连接顺序
SELECT /*+ LEADING(departments employees) */ *
FROM employees e JOIN departments d ON e.dept_id = d.dept_id;

-- 指定连接方式
SELECT /*+ USE_HASH(employees) */ *
FROM employees e, departments d WHERE e.dept_id = d.dept_id;

SELECT /*+ USE_NL(employees) */ *
FROM employees e, departments d WHERE e.dept_id = d.dept_id;

-- 并行执行
SELECT /*+ PARALLEL(employees, 4) */ * FROM employees;
```

### 提示的优先级

提示不是命令，是「建议」。Oracle 可能忽略某些提示：

1. 语法错误导致提示无效
2. 提示与优化器目标冲突
3. 提示导致更差的执行计划
4. Oracle 版本不支持该提示

---

## DBMS_XPLAN 高级用法

### 格式化选项

```sql
-- 显示基本执行计划
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY);

-- 显示统计信息
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, NULL, 'BASIC +ROWS +COST'));

-- 显示提示信息
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, NULL, 'BASIC +HINT'));

-- 显示所有信息
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(FORMAT => 'ALL'));
```

### 查看历史执行计划

```sql
-- Oracle 11g+：查看 SQL 历史执行计划
SELECT * FROM TABLE(
    DBMS_XPLAN.DISPLAY_CURSOR(
        sql_id => 'abc123xyz',
        cursor_child_no => 0,
        format => 'ALL'
    )
);

-- 查看 AWR 中的执行计划
SELECT * FROM TABLE(
    DBMS_XPLAN.DISPLAY_AWR(
        sql_id => 'abc123xyz'
    )
);
```

---

## 面试高频问题

### Q1: 什么情况下会走全表扫描？

查询条件不带索引、返回数据量超过表的 20%、使用函数导致索引失效、隐式类型转换、统计信息不准确。

### Q2: NESTED LOOP 和 HASH JOIN 的区别？

NESTED LOOP 适合小表驱动大表、内表有索引的场景，时间复杂度 O(n*m)；HASH JOIN 适合大表连接，建立哈希表后遍历另一表，时间复杂度 O(n+m)。

### Q3: 如何判断索引是否被使用？

通过 EXPLAIN PLAN 查看执行计划，如果操作列显示 INDEX RANGE SCAN、INDEX UNIQUE SCAN 等，说明索引被使用。

---

## 总结

执行计划是 SQL 优化的基础：

| 操作 | 性能 | 适用场景 |
|-----|------|---------|
| TABLE ACCESS FULL | 慢 | 小表、大量数据 |
| INDEX UNIQUE SCAN | 最快 | 主键/唯一查询 |
| INDEX RANGE SCAN | 快 | 范围查询 |
| HASH JOIN | 快 | 大表等值连接 |
| NESTED LOOP | 中 | 小表驱动、内表有索引 |

学会读懂执行计划，就迈出了 SQL 优化的第一步。

---

## 下一步

- [Oracle SQL 优化](/database/oracle/sql-tuning)：慢查询调优技巧
- [Oracle 统计信息](/database/oracle/statistics)：优化器的依赖
