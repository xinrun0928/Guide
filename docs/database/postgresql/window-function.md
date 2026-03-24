# PostgreSQL 窗口函数：ROW_NUMBER、RANK、LAG、LEAD

查每个部门的工资排名？

算每个月的累计销售额？

算每行与前一行的差值？

用窗口函数。

今天，我们来聊聊 PostgreSQL 的窗口函数。

## 窗口函数基础

### 什么是窗口函数

窗口函数在查询结果的「窗口」上执行计算，类似 GROUP BY，但不折叠行：

```
普通聚合 vs 窗口函数：

普通聚合（GROUP BY）：
┌────────────────────────┐
│ 部门   | 工资           │
├────────────────────────┤
│ 部门A   | 3000 (SUM)   │  ← 3 行变成 1 行
│ 部门B   | 5000 (SUM)   │
└────────────────────────┘

窗口函数（OVER）：
┌────────────────────────┐
│ 部门   | 工资  | 部门总计│
├────────────────────────┤
│ 部门A   | 1000  | 3000   │  ← 保留所有行
│ 部门A   | 2000  | 3000   │
│ 部门B   | 3000  | 5000   │
│ 部门B   | 2000  | 5000   │
└────────────────────────┘
```

### 基本语法

```sql
-- 窗口函数语法
function_name(expression) OVER (
    [PARTITION BY column1, column2, ...]
    [ORDER BY column1, column2, ...]
    [ROWS/RANGE BETWEEN frame_start AND frame_end]
)

-- 帧定义
ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW  -- 从开始到当前行
ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING  -- 从当前行到结束
ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING          -- 当前行前后各1行
```

## 排名函数

### ROW_NUMBER

为每行分配唯一序号：

```sql
SELECT 
    name,
    department,
    salary,
    ROW_NUMBER() OVER (
        PARTITION BY department 
        ORDER BY salary DESC
    ) AS row_num
FROM employees;

-- 结果：
-- name  | department | salary | row_num
-- ------+-----------+--------+---------
-- Alice | IT        | 15000  | 1
-- Bob   | IT        | 12000  | 2
-- Carol | IT        | 10000  | 3
-- Dave  | Sales     | 13000  | 1
-- Eve   | Sales     | 11000  | 2
```

### RANK

分配排名，有并列时跳号：

```sql
SELECT 
    name,
    department,
    salary,
    RANK() OVER (
        PARTITION BY department 
        ORDER BY salary DESC
    ) AS rank
FROM employees;

-- 结果：
-- name  | department | salary | rank
-- ------+-----------+--------+------
-- Alice | IT        | 15000  | 1
-- Bob   | IT        | 12000  | 2
-- Carol | IT        | 10000  | 3
-- Dave  | Sales     | 13000  | 1
-- Eve   | Sales     | 11000  | 2
```

### DENSE_RANK

分配排名，有并列时不跳号：

```sql
SELECT 
    name,
    department,
    salary,
    DENSE_RANK() OVER (
        PARTITION BY department 
        ORDER BY salary DESC
    ) AS dense_rank
FROM employees;

-- 结果（假设有并列）：
-- name  | department | salary | dense_rank
-- ------+-----------+--------+-----------
-- Alice | IT        | 15000  | 1
-- Bob   | IT        | 15000  | 1  ← 并列
-- Carol | IT        | 10000  | 2  ← 不跳号
-- Dave  | Sales     | 13000  | 1
```

### NTILE

将数据分成 N 组：

```sql
-- 将员工按工资分成 4 组
SELECT 
    name,
    salary,
    NTILE(4) OVER (ORDER BY salary) AS quartile
FROM employees;

-- 结果：
-- name  | salary | quartile
-- ------+--------+----------
-- Carol | 10000  | 1
-- Eve   | 11000  | 1
-- Bob   | 12000  | 2
-- Dave  | 13000  | 3
-- Alice | 15000  | 4
```

## 导航函数

### LAG

获取前一行的值：

```sql
-- 查看每个员工的工资与上一个员工的差距
SELECT 
    name,
    hire_date,
    salary,
    LAG(salary) OVER (ORDER BY hire_date) AS prev_salary,
    salary - LAG(salary) OVER (ORDER BY hire_date) AS salary_diff
FROM employees
ORDER BY hire_date;

-- 结果：
-- name  | hire_date | salary | prev_salary | salary_diff
-- ------+-----------+--------+-------------+------------
-- Carol | 2020-01-01 | 10000  | NULL        | NULL
-- Eve   | 2020-06-01 | 11000  | 10000       | 1000
-- Bob   | 2021-01-01 | 12000  | 11000       | 1000
-- Dave  | 2021-06-01 | 13000  | 12000       | 1000
-- Alice | 2022-01-01 | 15000  | 13000       | 2000
```

### LEAD

获取后一行的值：

```sql
-- 查看每个员工的工资与下一个员工的差距
SELECT 
    name,
    hire_date,
    salary,
    LEAD(salary) OVER (ORDER BY hire_date) AS next_salary,
    LEAD(salary) OVER (ORDER BY hire_date) - salary AS next_salary_diff
FROM employees
ORDER BY hire_date;

-- 结果：
-- name  | hire_date | salary | next_salary | next_salary_diff
-- ------+-----------+--------+-------------+------------------
-- Carol | 2020-01-01 | 10000  | 11000       | 1000
-- Eve   | 2020-06-01 | 11000  | 12000       | 1000
-- Bob   | 2021-01-01 | 12000  | 13000       | 1000
-- Dave  | 2021-06-01 | 13000  | 15000       | 2000
-- Alice | 2022-01-01 | 15000  | NULL        | NULL
```

### LAG/LEAD 的默认值

```sql
-- 使用默认值
SELECT 
    name,
    salary,
    LAG(salary, 1, 0) OVER (ORDER BY salary) AS prev_salary  -- 默认值 0
FROM employees;

-- 查看前两行的值
SELECT 
    name,
    salary,
    LAG(salary, 2) OVER (ORDER BY salary) AS prev_2_salary,
    LAG(salary, 2, salary) OVER (ORDER BY salary) AS prev_2_or_self  -- 默认值为当前行
FROM employees;
```

## 聚合窗口函数

### SUM, AVG, COUNT 等

```sql
-- 计算累计销售额
SELECT 
    month,
    sales,
    SUM(sales) OVER (
        ORDER BY month
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cumulative_sales
FROM monthly_sales;

-- 结果：
-- month   | sales | cumulative_sales
-- ---------+-------+-----------------
-- 2026-01 | 10000 | 10000
-- 2026-02 | 12000 | 22000
-- 2026-03 | 15000 | 37000
-- 2026-04 | 11000 | 48000
```

### 计算移动平均

```sql
-- 计算 3 个月移动平均
SELECT 
    month,
    sales,
    ROUND(
        AVG(sales) OVER (
            ORDER BY month
            ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
        ), 2
    ) AS moving_avg_3m
FROM monthly_sales;

-- 结果：
-- month   | sales | moving_avg_3m
-- ---------+-------+---------------
-- 2026-01 | 10000 | 10000.00
-- 2026-02 | 12000 | 11000.00
-- 2026-03 | 15000 | 12333.33
-- 2026-04 | 11000 | 12666.67
```

### FIRST_VALUE 和 LAST_VALUE

```sql
-- 获取部门最高工资
SELECT 
    name,
    department,
    salary,
    FIRST_VALUE(salary) OVER (
        PARTITION BY department 
        ORDER BY salary DESC
    ) AS max_in_dept
FROM employees;

-- 获取部门最低工资
SELECT 
    name,
    department,
    salary,
    LAST_VALUE(salary) OVER (
        PARTITION BY department 
        ORDER BY salary
        RANGE BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING  -- 需要这个！
    ) AS min_in_dept
FROM employees;
```

### NTH_VALUE

```sql
-- 获取部门第二高工资
SELECT 
    name,
    department,
    salary,
    NTH_VALUE(salary, 2) OVER (
        PARTITION BY department 
        ORDER BY salary DESC
        RANGE BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) AS second_highest
FROM employees;
```

## 高级用法

### 帧（Frame）的区别

```sql
-- ROWS vs RANGE

-- ROWS：按物理行数
SELECT 
    month,
    sales,
    SUM(sales) OVER (
        ORDER BY month
        ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING
    ) AS sum_rows
FROM monthly_sales;

-- RANGE：按值范围（相同值一起处理）
SELECT 
    month,
    sales,
    SUM(sales) OVER (
        ORDER BY month
        RANGE BETWEEN 1 PRECEDING AND 1 FOLLOWING
    ) AS sum_range
FROM monthly_sales;
```

### 百分比排名

```sql
-- 计算每个员工在其部门的工资百分比排名
SELECT 
    name,
    department,
    salary,
    ROUND(
        PERCENT_RANK() OVER (
            PARTITION BY department 
            ORDER BY salary
        ) * 100, 
        1
    ) AS pct_rank
FROM employees;
```

### CUME_DIST

```sql
-- 计算累计分布（值小于等于当前值的比例）
SELECT 
    name,
    salary,
    ROUND(
        CUME_DIST() OVER (ORDER BY salary) * 100,
        1
    ) AS cum_dist
FROM employees;
```

## Java 应用

### JPA 窗口函数查询

```java
@Entity
@NamedNativeQuery(
    name = "Employee.findRankedByDepartment",
    query = """
        SELECT id, name, department, salary,
               RANK() OVER (PARTITION BY department ORDER BY salary DESC) as salary_rank
        FROM employees
        """
)
public class Employee {
    @Id
    private Long id;
    private String name;
    private String department;
    private BigDecimal salary;
}

@Repository
public interface EmployeeRepository extends JpaRepository<Employee, Long> {
    
    @Query(value = """
        SELECT e.*, 
               RANK() OVER (PARTITION BY department ORDER BY salary DESC) as rank
        FROM employees e
        WHERE e.department = :department
        ORDER BY rank
        """, nativeQuery = true)
    List<Object[]> findRankedByDepartment(@Param("department") String department);
}
```

### MyBatis 窗口函数查询

```java
@Select("""
    SELECT 
        month,
        sales,
        SUM(sales) OVER (ORDER BY month ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as cumulative_sales,
        ROUND(AVG(sales) OVER (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2) as moving_avg
    FROM monthly_sales
    WHERE year = #{year}
    ORDER BY month
    """)
List<MonthlySalesResult> getMonthlySalesReport(@Param("year") int year);
```

## 性能优化

### 窗口函数的开销

```sql
-- 窗口函数通常需要排序
-- 大数据量时可能很慢

-- 优化：创建合适的索引
CREATE INDEX idx_employees_dept_salary 
ON employees(department, salary DESC);

-- 优化：使用窗口函数的结果而不是多次查询
-- 不好：
SELECT * FROM (
    SELECT *, RANK() OVER (PARTITION BY department ORDER BY salary DESC) as rank
    FROM employees
) ranked
WHERE rank = 1;

-- 好：直接用窗口函数
SELECT * FROM (
    SELECT *, RANK() OVER (PARTITION BY department ORDER BY salary DESC) as rank
    FROM employees
) ranked
WHERE rank = 1;
```

## 面试高频问题

### Q1: 窗口函数和 GROUP BY 的区别是什么？

**考察点**：窗口函数基础

**参考答案**：
- GROUP BY 折叠行，每组返回一行
- 窗口函数不折叠行，每行都有结果
- 窗口函数可以引用分组内的其他行

### Q2: ROW_NUMBER、RANK、DENSE_RANK 的区别是什么？

**考察点**：排名函数

**参考答案**：
- ROW_NUMBER：连续序号，无并列
- RANK：并列跳号（如 1, 1, 3）
- DENSE_RANK：并列不跳号（如 1, 1, 2）

### Q3: LAG 和 LEAD 的作用是什么？

**考察点**：导航函数

**参考答案**：
- LAG：获取前一行的值
- LEAD：获取后一行的值
- 常用于计算同比、环比、差值

### Q4: OVER 子句有哪些组成部分？

**考察点**：窗口函数语法

**参考答案**：
- PARTITION BY：分组
- ORDER BY：排序
- ROWS/RANGE：帧定义（行范围）

## 总结

PostgreSQL 窗口函数：

| 函数类型 | 函数 | 说明 |
|---------|------|------|
| 排名 | ROW_NUMBER, RANK, DENSE_RANK | 分配序号/排名 |
| 导航 | LAG, LEAD | 获取前后行值 |
| 聚合 | SUM, AVG, COUNT, MIN, MAX | 窗口聚合 |
| 导航 | FIRST_VALUE, LAST_VALUE, NTH_VALUE | 获取特定行值 |
| 分布 | PERCENT_RANK, CUME_DIST | 百分比排名 |

OVER 子句：
- PARTITION BY：分组
- ORDER BY：排序
- ROWS/RANGE：帧定义

窗口函数让 SQL 更加强大，可以实现很多以前需要子查询或应用层处理的功能。
