# Oracle SQL 优化：让慢查询「快到飞起」

你有没有这种经历：

一条 SQL 卡了 30 秒，你优化后降到 200 毫秒。

老板问你做了什么，你说不清楚。

今天，系统学习 Oracle SQL 优化技巧。

---

## 优化前的准备

### 确认慢查询

```sql
-- 查看当前正在执行的 SQL
SELECT sid, serial#, sql_id, elapsed_time/1000000 AS elapsed_sec,
       SUBSTR(sql_text, 1, 100) AS sql_preview
FROM v$session s
JOIN v$sqlarea a ON s.sql_id = a.sql_id
WHERE status = 'ACTIVE'
  AND sql_id IS NOT NULL
ORDER BY elapsed_time DESC;

-- 查看历史最慢的 SQL
SELECT sql_id, executions, elapsed_time/executions/1000000 AS avg_sec,
       SUBSTR(sql_text, 1, 100) AS sql_preview
FROM v$sqlarea
WHERE executions > 0
ORDER BY elapsed_time/executions DESC
FETCH FIRST 20 ROWS ONLY;
```

### 查看执行计划

```sql
-- 生成并查看执行计划
EXPLAIN PLAN FOR
SELECT * FROM employees 
WHERE department_id = 50 
  AND salary > 5000;

SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY);

-- 查看实时执行计划（正在执行的 SQL）
SELECT * FROM TABLE(
    DBMS_XPLAN.DISPLAY_CURSOR(
        sql_id => 'abc123',
        cursor_child_no => 0,
        format => 'ALL'
    )
);
```

---

## 常见优化技巧

### 1. 避免 SELECT *

```sql
-- 慢查询：查询所有列
SELECT * FROM employees WHERE department_id = 50;

-- 优化：只查询需要的列
SELECT employee_id, name, salary 
FROM employees WHERE department_id = 50;
```

### 2. 使用绑定变量

```sql
-- 硬编码：每次都是新的执行计划
SELECT * FROM employees WHERE department_id = 50;
SELECT * FROM employees WHERE department_id = 60;

-- 绑定变量：共享执行计划
SELECT * FROM employees WHERE department_id = :dept_id;
```

```java
// Java 中使用绑定变量
String sql = "SELECT * FROM employees WHERE department_id = ?";
try (PreparedStatement ps = conn.prepareStatement(sql)) {
    ps.setInt(1, 50);  // 第一次执行
    ResultSet rs = ps.executeQuery();
    
    ps.setInt(1, 60);  // 第二次执行，共享执行计划
    rs = ps.executeQuery();
}
```

### 3. 使用 EXISTS 代替 IN

```sql
-- 效率较低：IN 先执行子查询
SELECT * FROM employees 
WHERE department_id IN (SELECT department_id FROM departments WHERE location = 'BEIJING');

-- 优化：EXISTS 找到匹配就返回
SELECT * FROM employees e
WHERE EXISTS (
    SELECT 1 FROM departments d 
    WHERE d.department_id = e.department_id 
      AND d.location = 'BEIJING'
);
```

### 4. 使用 UNION ALL 代替 UNION

```sql
-- UNION 会去重（额外的排序和去重）
SELECT name FROM employees UNION SELECT name FROM managers;

-- UNION ALL 不去重（直接合并）
SELECT name FROM employees UNION ALL SELECT name FROM managers;
```

### 5. 避免 LIKE 前缀通配符

```sql
-- 导致索引失效
SELECT * FROM employees WHERE name LIKE '%三%';
SELECT * FROM employees WHERE name LIKE '%三';

-- 使用索引
SELECT * FROM employees WHERE name LIKE '张三%';
```

### 6. 避免否定条件

```sql
-- 无法使用索引
SELECT * FROM employees WHERE department_id != 50;
SELECT * FROM employees WHERE NOT EXISTS (...);

-- 优化：改写为正向条件
SELECT * FROM employees WHERE department_id < 50 
UNION ALL
SELECT * FROM employees WHERE department_id > 50;
```

### 7. 分页优化

```sql
-- 低效：OFFSET 过大时扫描大量数据
SELECT * FROM (
    SELECT a.*, ROWNUM rn FROM (
        SELECT * FROM employees ORDER BY hire_date DESC
    ) a WHERE ROWNUM <= 10000
) WHERE rn >= 9991;

-- 优化：利用主键或索引
SELECT * FROM employees 
WHERE (hire_date, employee_id) < (
    SELECT hire_date, employee_id 
    FROM employees 
    ORDER BY hire_date DESC, employee_id DESC
    OFFSET 9990 ROWS FETCH NEXT 10 ROWS ONLY
)
ORDER BY hire_date DESC, employee_id DESC
FETCH NEXT 10 ROWS ONLY;
```

---

## 常见场景优化

### 场景一：大批量 INSERT

```sql
-- 低效：逐条插入
BEGIN
    FOR rec IN (SELECT * FROM source_table) LOOP
        INSERT INTO target_table VALUES rec;
    END LOOP;
    COMMIT;
END;
/

-- 优化：批量 INSERT
INSERT /*+ APPEND */ INTO target_table
SELECT * FROM source_table;
```

### 场景二：批量 UPDATE

```sql
-- 低效：逐条更新
UPDATE employees SET salary = salary * 1.1 WHERE department_id = 50;

-- 优化：批量更新（使用 FORALL）
DECLARE
    TYPE t_id_list IS TABLE OF NUMBER;
    v_ids t_id_list;
BEGIN
    SELECT employee_id BULK COLLECT INTO v_ids
    FROM employees WHERE department_id = 50;
    
    FORALL i IN 1..v_ids.COUNT
        UPDATE employees 
        SET salary = salary * 1.1 
        WHERE employee_id = v_ids(i);
    
    COMMIT;
END;
/
```

### 场景三：多表关联

```sql
-- 低效：先 JOIN 再过滤
SELECT e.*, d.*
FROM employees e, departments d
WHERE e.department_id = d.department_id
  AND d.location = 'BEIJING';

-- 优化：先过滤再 JOIN
SELECT e.*, d.*
FROM (
    SELECT * FROM departments WHERE location = 'BEIJING'
) d
JOIN employees e ON d.department_id = e.department_id;
```

---

## 优化检查清单

### SQL 编写检查

- [ ] 避免 SELECT *，只查询需要的列
- [ ] 使用绑定变量，避免硬编码
- [ ] 避免在索引列上使用函数
- [ ] 避免 LIKE 前缀通配符
- [ ] 使用 EXISTS 代替 IN
- [ ] 使用 UNION ALL 代替 UNION（不去重时）
- [ ] 避免 NOT IN，使用 NOT EXISTS 或外连接

### 索引检查

- [ ] 查询条件列是否建有索引
- [ ] 复合索引顺序是否正确
- [ ] 是否存在函数索引需求
- [ ] 是否有多余的索引需要清理

### 执行计划检查

- [ ] 是否走全表扫描（数据量大？）
- [ ] 是否使用了正确的索引
- [ ] 连接顺序是否最优
- [ ] 连接方式是否合适

---

## SQL 优化实战

### 完整优化示例

```sql
-- 原始 SQL（执行时间 30 秒）
SELECT e.employee_id, e.name, e.salary, d.department_name
FROM employees e, departments d, locations l
WHERE e.department_id = d.department_id
  AND d.location_id = l.location_id
  AND l.country_id = 'CN'
  AND e.salary > 5000
ORDER BY e.salary DESC;

-- 步骤 1：检查执行计划
EXPLAIN PLAN FOR ...
-- 发现：全表扫描 employees，无索引

-- 步骤 2：创建索引
CREATE INDEX idx_emp_dept ON employees(department_id);
CREATE INDEX idx_emp_sal ON employees(salary);

-- 步骤 3：优化 SQL（添加 HINT）
SELECT /*+ LEADING(d l) USE_NL(e) INDEX(e idx_emp_dept) */ 
    e.employee_id, e.name, e.salary, d.department_name
FROM departments d
JOIN locations l ON d.location_id = l.location_id
JOIN employees e ON e.department_id = d.department_id
WHERE l.country_id = 'CN'
  AND e.salary > 5000
ORDER BY e.salary DESC;

-- 步骤 4：验证优化效果
-- 执行时间降至 200 毫秒
```

---

## 面试高频问题

### Q1: 如何优化一条慢 SQL？

分析执行计划找出瓶颈，检查是否走全表扫描、连接顺序是否正确、索引是否合理。根据诊断结果调整 SQL 写法或创建合适的索引。

### Q2: 什么情况下索引会失效？

在索引列上使用函数、使用 LIKE 前缀通配符、隐式类型转换、使用否定条件（!=、NOT IN、NOT EXISTS）、统计信息不准确导致优化器放弃索引。

### Q3: UNION 和 UNION ALL 的区别？

UNION 会对结果去重，额外消耗排序和去重的资源；UNION ALL 直接合并结果，性能更好。在不需要去重时，应该使用 UNION ALL。

---

## 总结

SQL 优化是性能调优的基础：

| 优化方向 | 常见技巧 |
|---------|---------|
| SELECT 优化 | 避免 SELECT *，只查需要的列 |
| 条件优化 | 避免索引列使用函数，注意类型转换 |
| 连接优化 | 选择合适的连接方式，控制连接顺序 |
| 索引优化 | 创建合适的索引，定期清理无用索引 |

优化没有银弹，需要根据具体情况分析。

---

## 下一步

- [Oracle 统计信息](/database/oracle/statistics)：优化器决策的依赖
- [Oracle 执行计划](/database/oracle/explain)：深入理解执行计划
