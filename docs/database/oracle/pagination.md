# Oracle 分页查询：ROWNUM 与 ROW_NUMBER

面试官问："Oracle 中如何实现分页查询？"

很多人脱口而出："用 LIMIT 啊！"

然后就没有然后了……

**Oracle 没有 LIMIT**。这是 MySQL 的语法。在 Oracle 中，分页要靠 `ROWNUM` 和 `ROW_NUMBER()`。

今天，我们来彻底搞懂 Oracle 的分页查询。

---

## ROWNUM：伪列中的战斗机

### 什么是 ROWNUM？

ROWNUM 是 Oracle 自动为查询结果分配的**伪列**，从 1 开始递增。

```sql
-- 查看员工表，每行自动带上行号
SELECT ROWNUM, employee_id, first_name
FROM employees
WHERE ROWNUM <= 10;
```

### ROWNUM 的工作原理

ROWNUM 是在**查询结果生成后**分配的，而不是在表中预先存在的。

```
查询执行顺序（理解 ROWNUM 的关键）：

1. FROM → WHERE → SELECT → ROWNUM 分配
                    ↓
              先过滤数据，再分配行号
```

这意味着：**ROWNUM 只能用于 `<` 或 `<=` 条件，不能用于 `>` 条件**。

```sql
-- 这样查第 1-10 行：✓ 正确
SELECT *
FROM employees
WHERE ROWNUM <= 10;

-- 这样查第 11-20 行：✗ 错误（永远查不到）
SELECT *
FROM employees
WHERE ROWNUM > 10 AND ROWNUM <= 20;  -- 永远为空！

-- 为什么？因为 ROWNUM > 10 永远为 FALSE
-- 假设有 100 行，第1行 ROWNUM=1，不满足 > 10
-- 第2行 ROWNUM=2，不满足 > 10
-- ...第11行 ROWNUM=11，满足 > 10？但第11行是前面10行过滤后才存在的
-- 所以 ROWNUM > 10 永远查不到任何数据
```

---

## 基础分页：三层嵌套

要查第 11-20 行，需要**嵌套查询**：

```sql
-- 标准分页查询：查第 11-20 行
SELECT *
FROM (
    SELECT ROWNUM AS rn, a.*
    FROM (
        SELECT employee_id, first_name, last_name, salary
        FROM employees
        ORDER BY salary DESC
    ) a
    WHERE ROWNUM <= 20  -- 先查出前20行
)
WHERE rn >= 11;  -- 再过滤出行号11-20
```

### 为什么需要三层嵌套？

```
第一层（最内层）：正常查询 + 排序
  ↓
第二层：在结果上标记 ROWNUM，限制总数（<=20）
  ↓
第三层：过滤出行号范围（>=11）
```

**每一层都有其存在的意义：**

1. **最内层**：确保排序正确
2. **中间层**：限制总数，生成 ROWNUM
3. **最外层**：过滤行号范围

### 常见的分页写法

```sql
-- 第 1 页（每页 10 条）
SELECT *
FROM (
    SELECT ROWNUM AS rn, t.*
    FROM (
        SELECT * FROM employees ORDER BY hire_date DESC
    ) t
    WHERE ROWNUM <= 10
)
WHERE rn >= 1;

-- 第 2 页
WHERE ROWNUM <= 20
...
WHERE rn >= 11;

-- 第 3 页
WHERE ROWNUM <= 30
...
WHERE rn >= 21;
```

---

## ROW_NUMBER()：更强大的行号函数

### 什么是 ROW_NUMBER()？

`ROW_NUMBER()` 是分析函数，为每行分配**连续的序号**（从 1 开始）。

与 ROWNUM 不同，ROW_NUMBER() 支持**ORDER BY**，可以精确控制排序。

```sql
-- 为员工按工资排名
SELECT employee_id, first_name, salary,
       ROW_NUMBER() OVER (ORDER BY salary DESC) AS rank
FROM employees;
```

### ROW_NUMBER() vs ROWNUM

| 特性 | ROWNUM | ROW_NUMBER() |
|-----|--------|-------------|
| 类型 | 伪列 | 分析函数 |
| 排序支持 | 不能直接排序 | 支持 OVER (ORDER BY) |
| 分页 | 需要嵌套 | 更简洁 |
| 去重 | 不能 | 配合 PARTITION BY |
| 稳定性 | 无 | 无重复 |

### 使用 ROW_NUMBER() 实现分页

```sql
-- 使用 ROW_NUMBER() 分页
SELECT *
FROM (
    SELECT employee_id, first_name, salary,
           ROW_NUMBER() OVER (ORDER BY salary DESC) AS rn
    FROM employees
)
WHERE rn BETWEEN 11 AND 20;
```

---

## 两种分页方式对比

### ROWNUM 分页

```sql
SELECT *
FROM (
    SELECT ROWNUM AS rn, a.*
    FROM (
        SELECT employee_id, first_name, salary, hire_date
        FROM employees
        ORDER BY salary DESC
    ) a
    WHERE ROWNUM <= 20
)
WHERE rn >= 11;
```

**优点**：
- 兼容性更好（所有版本都支持）
- 在某些场景下性能略优

**缺点**：
- 语法繁琐
- 不能直接排序后再分页（需要嵌套）

### ROW_NUMBER() 分页

```sql
SELECT *
FROM (
    SELECT employee_id, first_name, salary, hire_date,
           ROW_NUMBER() OVER (ORDER BY salary DESC) AS rn
    FROM employees
)
WHERE rn BETWEEN 11 AND 20;
```

**优点**：
- 语法更简洁清晰
- 支持复杂的排序需求

**缺点**：
- 需要全表排序后生成行号
- 如果有 WHERE 条件，需要额外处理

---

## 实战：带条件的分页查询

### 场景：按部门筛选，按工资排序，分页显示

```sql
-- ROWNUM 版本
SELECT *
FROM (
    SELECT ROWNUM AS rn, t.*
    FROM (
        SELECT employee_id, first_name, salary, department_id
        FROM employees
        WHERE department_id = 50
        ORDER BY salary DESC
    ) t
    WHERE ROWNUM <= 20
)
WHERE rn >= 11;

-- ROW_NUMBER() 版本
SELECT *
FROM (
    SELECT employee_id, first_name, salary, department_id,
           ROW_NUMBER() OVER (ORDER BY salary DESC) AS rn
    FROM employees
    WHERE department_id = 50
)
WHERE rn BETWEEN 11 AND 20;
```

### 场景：多字段排序

```sql
-- ROWNUM 版本
SELECT *
FROM (
    SELECT ROWNUM AS rn, t.*
    FROM (
        SELECT employee_id, first_name, salary, department_id
        FROM employees
        WHERE department_id = 50
        ORDER BY department_id, salary DESC, hire_date ASC
    ) t
    WHERE ROWNUM <= 20
)
WHERE rn >= 11;

-- ROW_NUMBER() 版本
SELECT *
FROM (
    SELECT employee_id, first_name, salary, department_id,
           ROW_NUMBER() OVER (
               ORDER BY department_id, salary DESC, hire_date ASC
           ) AS rn
    FROM employees
    WHERE department_id = 50
)
WHERE rn BETWEEN 11 AND 20;
```

---

## 高级：分区 + 分页

### 使用 PARTITION BY 分组编号

如果需要**先按部门分组，再在组内排名**，使用 `PARTITION BY`：

```sql
-- 按部门分组，每组内按工资排名
SELECT department_id, employee_id, first_name, salary,
       ROW_NUMBER() OVER (
           PARTITION BY department_id
           ORDER BY salary DESC
       ) AS dept_rank
FROM employees
WHERE department_id IN (30, 50, 80);
```

### 分页 + 分组排名

```sql
-- 每个部门显示工资排名前 3 的员工（分页）
SELECT *
FROM (
    SELECT department_id, employee_id, first_name, salary,
           ROW_NUMBER() OVER (
               PARTITION BY department_id
               ORDER BY salary DESC
           ) AS dept_rank
    FROM employees
)
WHERE dept_rank <= 3
ORDER BY department_id, dept_rank;
```

---

## RANK() 与 DENSE_RANK()：排名函数

### 三种排名函数的区别

| 函数 | 说明 | 示例输出 |
|-----|------|---------|
| ROW_NUMBER() | 连续排名，无并列 | 1, 2, 3, 4 |
| RANK() | 有并列，跳过后续名次 | 1, 2, 2, 4 |
| DENSE_RANK() | 有并列，不跳过名次 | 1, 2, 2, 3 |

```sql
SELECT first_name, salary,
       ROW_NUMBER() OVER (ORDER BY salary DESC) AS row_num,
       RANK() OVER (ORDER BY salary DESC) AS rank,
       DENSE_RANK() OVER (ORDER BY salary DESC) AS dense_rank
FROM employees
WHERE ROWNUM <= 10;
```

### 实际应用

```sql
-- 查询工资排名第 3 的员工（可能有并列）
SELECT *
FROM (
    SELECT first_name, salary,
           DENSE_RANK() OVER (ORDER BY salary DESC) AS sal_rank
    FROM employees
)
WHERE sal_rank = 3;
```

---

## 分页性能优化

### 避免全表扫描

分页查询最大的性能问题是：**深层页码需要扫描大量数据**。

```sql
-- 查第 1000 页（每页 10 条）
-- 假设有 100 万条数据，需要扫描 10000 行才能得到结果

-- 解决方案：确保排序字段有索引
CREATE INDEX idx_emp_salary ON employees(salary DESC);
```

### 记录总数

如果要显示"共 X 页，当前第 Y 页"，需要单独查询总数：

```sql
-- 查询条件
v_where := 'department_id = 50';
v_page_size := 10;
v_page_num := 3;

-- 查询总数
SELECT COUNT(*) INTO v_total
FROM employees
WHERE &v_where;

-- 计算总页数
v_total_pages := CEIL(v_total / v_page_size);
```

---

## 面试高频问题

### Q1: ROWNUM 和 ROW_NUMBER() 的区别？

| 对比项 | ROWNUM | ROW_NUMBER() |
|-------|--------|-------------|
| 本质 | 伪列 | 分析函数 |
| ORDER BY | 不能直接控制排序 | 支持 OVER (ORDER BY) |
| WHERE 条件 | 只支持 `<` / `<=` | 支持任意条件 |
| 去重 | 不能 | 配合 PARTITION BY |

### Q2: 为什么 ROWNUM 不能直接用于 `> 10`？

因为 ROWNUM 是在 WHERE 之后、SELECT 之前分配的。ROWNUM 从 1 开始，只有前面的行满足条件，后续行才能获得递增的行号。

### Q3: 分页查询优化有什么建议？

1. 确保排序字段有索引
2. 使用 ROW_NUMBER() 时，避免在子查询中使用复杂的 WHERE 条件
3. 深层分页可以考虑"游标分页"（记住上一页最后一条记录的位置）
4. 如果只需要前 N 条，用 `ROWNUM <= N` 而不是 `ROW_NUMBER()`

---

## 总结

Oracle 分页查询的核心：

1. **ROWNUM**：Oracle 原生伪列，需要嵌套才能实现分页
2. **ROW_NUMBER()**：分析函数，语法更清晰，支持复杂排序
3. **三层嵌套**：排序 → ROWNUM 限制 → 行号过滤
4. **RANK / DENSE_RANK**：处理排名场景

```sql
-- 标准 ROWNUM 分页
SELECT *
FROM (
    SELECT ROWNUM AS rn, t.*
    FROM (
        SELECT * FROM employees ORDER BY salary DESC
    ) t
    WHERE ROWNUM <= 页大小 * 页码
)
WHERE rn > 页大小 * (页码 - 1);

-- ROW_NUMBER 分页
SELECT *
FROM (
    SELECT *, ROW_NUMBER() OVER (ORDER BY salary DESC) AS rn
    FROM employees
)
WHERE rn BETWEEN (页码-1)*页大小+1 AND 页码*页大小;
```

---

## 下一步

- [Oracle PL/SQL 块结构](/database/oracle/plsql-block)：DECLARE、BEGIN、EXCEPTION、END
- [Oracle 游标](/database/oracle/cursor)：显式游标与隐式游标
