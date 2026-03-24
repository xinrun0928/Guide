# MariaDB 窗口函数与 CTE（Common Table Expression）

你需要计算：
- 每位员工在其部门的工资排名
- 每个月销售额与上月的环比
- 累计销售额（从年初到当前月份）
- 移动平均（最近3个月的平均）

以前，你需要写复杂的自 JOIN 或者存储过程。

现在，MariaDB 10.2+ 告诉你：「一个 SQL 就够了。」

**窗口函数和 CTE 是现代 SQL 的两把瑞士军刀，让复杂的数据分析变得简单。**

---

## 窗口函数基础

### 什么是窗口函数？

窗口函数在**一行数据的「窗口」上执行计算**，这个窗口可以包含前后相邻的行。

```
┌─────────────────────────────────────────────────────────────┐
│                     窗口函数示意                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   数据集                                                    │
│   ┌──────┬───────┬────────┐                               │
│   │ 部门  │ 姓名   │ 工资    │                               │
│   ├──────┼───────┼────────┤                               │
│   │  A    │ 张三   │  10000 │                               │
│   │  A    │ 李四   │  12000 │                               │
│   │  A    │ 王五   │  11000 │                               │
│   │  B    │ 赵六   │   9000 │                               │
│   │  B    │ 钱七   │  11000 │                               │
│   └──────┴───────┴────────┘                               │
│                                                             │
│   窗口函数应用（按部门分组）                                  │
│   ┌──────┬───────┬────────┬─────────────┐                 │
│   │ 部门  │ 姓名   │ 工资    │ 部门排名     │                │
│   ├──────┼───────┼────────┼─────────────┤                 │
│   │  A    │ 张三   │  10000 │  3 (最低)   │  ← 当前行     │
│   │  A    │ 李四   │  12000 │  1 (最高)   │                │
│   │  A    │ 王五   │  11000 │  2         │                │
│   │  B    │ 赵六   │   9000 │  2         │                │
│   │  B    │ 钱七   │  11000 │  1         │                │
│   └──────┴───────┴────────┴─────────────┘                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 窗口函数语法

```sql
window_function(expression) OVER (
    [PARTITION BY column_list]
    [ORDER BY column_list]
    [ROWS/RANGE frame_specification]
)
```

关键组成部分：
- **PARTITION BY**：分区，类似于 GROUP BY，但不会减少行数
- **ORDER BY**：窗口内排序
- **ROWS/RANGE**：窗口大小（框架）

---

## 常用窗口函数

### 1. 排名函数

```sql
-- 创建测试数据
CREATE TABLE employees (
    id INT PRIMARY KEY,
    name VARCHAR(50),
    department VARCHAR(20),
    salary DECIMAL(10, 2)
);

INSERT INTO employees VALUES
(1, '张三', 'A', 10000),
(2, '李四', 'A', 12000),
(3, '王五', 'A', 11000),
(4, '赵六', 'B', 9000),
(5, '钱七', 'B', 11000),
(6, '孙八', 'B', 11000);  -- 与钱七工资相同
```

```sql
-- ROW_NUMBER：唯一的行号（无并列）
SELECT 
    name,
    department,
    salary,
    ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS row_num
FROM employees;
-- 结果：
-- 部门A: 李四(1), 王五(2), 张三(3)
-- 部门B: 钱七(1), 孙八(2), 赵六(3)  ← 并列也不影响

-- RANK：并列时跳号
SELECT 
    name,
    department,
    salary,
    RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS rank
FROM employees;
-- 结果：
-- 部门B: 钱七(1), 孙八(1), 赵六(3)  ← 并列后跳到3

-- DENSE_RANK：并列时不跳号
SELECT 
    name,
    department,
    salary,
    DENSE_RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS dense_rank
FROM employees;
-- 结果：
-- 部门B: 钱七(1), 孙八(1), 赵六(2)  ← 并列后连续编号
```

### 2. 聚合窗口函数

```sql
-- SUM：累计求和
SELECT 
    name,
    salary,
    SUM(salary) OVER (ORDER BY id) AS cumulative_salary,
    SUM(salary) OVER () AS total_salary,
    ROUND(salary / SUM(salary) OVER () * 100, 2) AS percentage
FROM employees;

-- AVG：移动平均
SELECT 
    name,
    salary,
    AVG(salary) OVER (ORDER BY id ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS moving_avg_3
FROM employees;

-- COUNT：窗口内计数
SELECT 
    name,
    department,
    salary,
    COUNT(*) OVER (PARTITION BY department) AS dept_count,
    COUNT(*) OVER () AS total_count
FROM employees;
```

### 3. 值访问函数

```sql
-- FIRST_VALUE / LAST_VALUE：第一/最后一个值
SELECT 
    name,
    department,
    salary,
    FIRST_VALUE(salary) OVER (PARTITION BY department ORDER BY salary) AS min_salary,
    LAST_VALUE(salary) OVER (PARTITION BY department ORDER BY salary 
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS max_salary
FROM employees;

-- LAG / LEAD：前一行/后一行的值
SELECT 
    name,
    salary,
    LAG(salary, 1) OVER (ORDER BY id) AS prev_salary,
    salary AS current_salary,
    LEAD(salary, 1) OVER (ORDER BY id) AS next_salary,
    salary - LAG(salary, 1) OVER (ORDER BY id) AS salary_diff
FROM employees;
```

### 4. 百分比函数

```sql
-- PERCENT_RANK：百分比排名（0-1之间）
SELECT 
    name,
    salary,
    PERCENT_RANK() OVER (ORDER BY salary) AS percent_rank
FROM employees;

-- CUME_DIST：累积分布（0-1之间）
SELECT 
    name,
    salary,
    CUME_DIST() OVER (ORDER BY salary) AS cumulative_dist
FROM employees;

-- NTILE：分成N个组
SELECT 
    name,
    salary,
    NTILE(4) OVER (ORDER BY salary) AS quartile
FROM employees;
```

---

## 窗口框架（Frame）

### ROWS vs RANGE

```sql
-- ROWS：按物理行数计算
SELECT 
    name,
    salary,
    SUM(salary) OVER (ORDER BY id ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) AS sum_3_rows
FROM employees;

-- RANGE：按值范围计算
SELECT 
    name,
    salary,
    SUM(salary) OVER (ORDER BY salary RANGE BETWEEN 1000 PRECEDING AND 1000 FOLLOWING) AS sum_1000_range
FROM employees;
```

### 框架关键字

```sql
-- 常见框架定义
ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW    -- 从开始到当前行
ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING     -- 从当前行到结束
ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING             -- 前后各2行
ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING  -- 整个分区
RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW    -- 按值范围
```

### 实战示例：累计销售额

```sql
CREATE TABLE monthly_sales (
    month DATE PRIMARY KEY,
    sales DECIMAL(12, 2)
);

INSERT INTO monthly_sales VALUES
('2024-01-01', 100000),
('2024-02-01', 120000),
('2024-03-01', 95000),
('2024-04-01', 150000),
('2024-05-01', 180000),
('2024-06-01', 160000);

SELECT 
    DATE_FORMAT(month, '%Y-%m') AS month,
    sales,
    -- 累计销售额
    SUM(sales) OVER (ORDER BY month) AS cumulative_sales,
    -- 环比增长
    sales - LAG(sales, 1) OVER (ORDER BY month) AS mom_diff,
    ROUND((sales - LAG(sales, 1) OVER (ORDER BY month)) / LAG(sales, 1) OVER (ORDER BY month) * 100, 2) AS mom_growth_pct,
    -- 3个月移动平均
    AVG(sales) OVER (ORDER BY month ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS ma_3,
    -- 季度至今总额
    SUM(sales) OVER (
        ORDER BY month 
        ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
    ) AS quarter_total
FROM monthly_sales;
```

---

## CTE（公用表表达式）

### 什么是 CTE？

CTE 是「一次性创建的临时命名结果集」，可以在一个查询中引用多次。

```sql
-- 简单 CTE
WITH dept_avg AS (
    SELECT department, AVG(salary) AS avg_salary
    FROM employees
    GROUP BY department
)
SELECT 
    e.name,
    e.department,
    e.salary,
    d.avg_salary,
    e.salary - d.avg_salary AS diff_from_avg
FROM employees e
JOIN dept_avg d ON e.department = d.department;
```

### 普通 CTE vs 递归 CTE

#### 普通 CTE

```sql
-- 计算各部门内高于平均工资的员工
WITH dept_stats AS (
    SELECT 
        department,
        AVG(salary) AS avg_salary,
        MAX(salary) AS max_salary
    FROM employees
    GROUP BY department
),
high_earners AS (
    SELECT 
        e.name,
        e.department,
        e.salary,
        s.avg_salary,
        s.max_salary
    FROM employees e
    JOIN dept_stats s ON e.department = s.department
    WHERE e.salary > s.avg_salary
)
SELECT * FROM high_earners ORDER BY department, salary DESC;
```

#### 递归 CTE

```sql
-- 生成数字序列 1-100
WITH RECURSIVE nums AS (
    SELECT 1 AS n
    UNION ALL
    SELECT n + 1 FROM nums WHERE n < 100
)
SELECT n FROM nums;

-- 生成分类树结构
CREATE TABLE categories (
    id INT PRIMARY KEY,
    name VARCHAR(50),
    parent_id INT
);

INSERT INTO categories VALUES
(1, '电子产品', NULL),
(2, '手机', 1),
(3, '电脑', 1),
(4, '苹果', 2),
(5, '安卓', 2),
(6, '服装', NULL),
(7, '男装', 6),
(8, '女装', 6);

-- 递归查询：获取完整分类路径
WITH RECURSIVE category_tree AS (
    -- 基础查询：叶子节点开始
    SELECT id, name, parent_id, name AS path, 0 AS level
    FROM categories
    WHERE parent_id IS NULL
    
    UNION ALL
    
    -- 递归查询
    SELECT c.id, c.name, c.parent_id, 
           CONCAT(ct.path, ' > ', c.name) AS path,
           ct.level + 1
    FROM categories c
    JOIN category_tree ct ON c.parent_id = ct.id
)
SELECT * FROM category_tree ORDER BY path;
```

---

## Java 中的窗口函数与 CTE

### 窗口函数示例

```java
public class WindowFunctionDemo {
    
    public void rankEmployees(Connection conn) throws SQLException {
        // 按部门排名
        String sql = """
            SELECT 
                name,
                department,
                salary,
                ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS row_num,
                RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS rank,
                DENSE_RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS dense_rank
            FROM employees
            ORDER BY department, row_num
            """;
        
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            System.out.println("员工部门排名：");
            System.out.println("=".repeat(70));
            while (rs.next()) {
                System.out.printf("%s | %s | 工资: %,.0f | 行号: %d | 排名: %d | 密排: %d%n",
                    rs.getString("department"),
                    rs.getString("name"),
                    rs.getBigDecimal("salary"),
                    rs.getInt("row_num"),
                    rs.getInt("rank"),
                    rs.getInt("dense_rank"));
            }
        }
    }
    
    public void cumulativeSales(Connection conn) throws SQLException {
        // 累计销售额分析
        String sql = """
            SELECT 
                month,
                sales,
                SUM(sales) OVER (ORDER BY month) AS cumulative,
                sales - LAG(sales) OVER (ORDER BY month) AS diff,
                ROUND(sales / SUM(sales) OVER () * 100, 2) AS pct_of_total
            FROM monthly_sales
            ORDER BY month
            """;
        
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            System.out.println("\n销售分析：");
            System.out.println("=".repeat(70));
            while (rs.next()) {
                System.out.printf("%s | 销售额: %10,.0f | 累计: %12,.0f | 占比: %5.2f%%%n",
                    rs.getDate("month"),
                    rs.getBigDecimal("sales"),
                    rs.getBigDecimal("cumulative"),
                    rs.getDouble("pct_of_total"));
            }
        }
    }
    
    public void movingAverage(Connection conn) throws SQLException {
        // 3个月移动平均
        String sql = """
            SELECT 
                month,
                sales,
                ROUND(AVG(sales) OVER (
                    ORDER BY month 
                    ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
                ), 2) AS ma_3
            FROM monthly_sales
            ORDER BY month
            """;
        
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            System.out.println("\n移动平均分析：");
            while (rs.next()) {
                System.out.printf("%s | 销售额: %10,.0f | 3月均线: %10,.2f%n",
                    rs.getDate("month"),
                    rs.getBigDecimal("sales"),
                    rs.getBigDecimal("ma_3"));
            }
        }
    }
}
```

### CTE 示例

```java
public class CTEDemo {
    
    public void multiLevelCTE(Connection conn) throws SQLException {
        // 使用 CTE 进行复杂分析
        String sql = """
            WITH 
            -- 第一层：计算各部门统计
            dept_stats AS (
                SELECT 
                    department,
                    COUNT(*) AS emp_count,
                    AVG(salary) AS avg_salary,
                    SUM(salary) AS total_salary,
                    MAX(salary) - MIN(salary) AS salary_range
                FROM employees
                GROUP BY department
            ),
            -- 第二层：计算公司总体
            company_stats AS (
                SELECT 
                    COUNT(*) AS total_emp,
                    AVG(salary) AS company_avg,
                    SUM(salary) AS company_total
                FROM employees
            ),
            -- 第三层：员工与公司比较
            employee_comparison AS (
                SELECT 
                    e.name,
                    e.department,
                    e.salary,
                    d.avg_salary AS dept_avg,
                    c.company_avg AS company_avg,
                    ROUND(e.salary / d.avg_salary * 100, 1) AS pct_vs_dept,
                    ROUND(e.salary / c.company_avg * 100, 1) AS pct_vs_company
                FROM employees e
                JOIN dept_stats d ON e.department = d.department
                CROSS JOIN company_stats c
            )
            -- 最终查询：找出高于平均的员工
            SELECT 
                department,
                name,
                salary,
                dept_avg,
                pct_vs_dept,
                CASE 
                    WHEN pct_vs_dept > 150 THEN '极高'
                    WHEN pct_vs_dept > 120 THEN '较高'
                    WHEN pct_vs_dept < 80 THEN '较低'
                    ELSE '正常'
                END AS salary_level
            FROM employee_comparison
            WHERE pct_vs_dept > 110
            ORDER BY department, salary DESC
            """;
        
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            System.out.println("高薪员工分析：");
            while (rs.next()) {
                System.out.printf("%s | %s | %.0f | 部门均: %.0f | 高 %.1f%% | %s%n",
                    rs.getString("department"),
                    rs.getString("name"),
                    rs.getBigDecimal("salary"),
                    rs.getBigDecimal("dept_avg"),
                    rs.getDouble("pct_vs_dept"),
                    rs.getString("salary_level"));
            }
        }
    }
}
```

---

## 窗口函数与 CTE 的对比

### 窗口函数 vs GROUP BY

| 维度 | GROUP BY | 窗口函数 |
|------|----------|----------|
| 行数 | 减少 | 保持不变 |
| 聚合粒度 | 固定 | 可以逐行变化 |
| 引用原始列 | 不能直接引用 | 可以 |
| 多个聚合 | 需要多次 JOIN | 一个查询搞定 |
| 排名 | 需要子查询 | 直接支持 |

### CTE vs 子查询

| 维度 | 子查询 | CTE |
|------|--------|-----|
| 可读性 | 嵌套复杂 | 清晰分层 |
| 可重用性 | 不可重用 | 同一查询内可多次引用 |
| 递归支持 | 不支持 | 支持 |
| 调试 | 困难 | 可以逐层验证 |
| 兼容性 | 所有 SQL | 较新（MariaDB 10.2+） |

---

## 面试追问

### 追问一：ROW_NUMBER、RANK、DENSE_RANK 的区别是什么？

```sql
-- 示例数据：张三=10000, 李四=10000, 王五=9000
SELECT 
    name,
    salary,
    ROW_NUMBER() OVER (ORDER BY salary DESC) AS row_num,  -- 1, 2, 3
    RANK() OVER (ORDER BY salary DESC) AS rank,              -- 1, 1, 3（跳号）
    DENSE_RANK() OVER (ORDER BY salary DESC) AS dense_rank     -- 1, 1, 2（不跳号）
FROM employees;
```

### 追问二：窗口函数的性能如何优化？

1. **减少分区大小**：PARTITION BY 使用区分度高的列
2. **控制窗口大小**：ROWS BETWEEN 避免全分区扫描
3. **创建物化视图**：对频繁使用的窗口计算
4. **索引优化**：为 ORDER BY 列创建索引

### 追问三：CTE 和临时表的区别？

| 维度 | CTE | 临时表 |
|------|-----|--------|
| 作用域 | 单次查询 | 会话内 |
| 生命周期 | 查询结束 | 会话结束或手动删除 |
| 性能 | 可能重复计算 | 只计算一次 |
| 递归支持 | ✅ | ❌（需要特殊处理） |
| 调试 | 容易 | 容易 |

---

## 总结

| 要点 | 窗口函数 | CTE |
|------|----------|-----|
| **核心能力** | 跨行计算而不减少行 | 临时命名结果集 |
| **主要函数** | RANK, SUM, AVG, LAG, LEAD... | WITH...AS |
| **PARTITION BY** | 分区（类似 GROUP BY） | - |
| **ORDER BY** | 窗口内排序 | - |
| **递归支持** | ❌ | ✅ |
| **版本要求** | MariaDB 10.2+ | MariaDB 10.2+ |

**窗口函数和 CTE 是现代 SQL 的重要特性，让复杂的数据分析查询变得简洁高效。掌握它们，你就拥有了处理 80% 复杂报表的能力。**

---

## 下一步

- 想了解 MariaDB 的审计功能？[MariaDB 审计插件与安全增强](/database/mariadb/audit)
- 想了解 MariaDB 的集群方案？[MariaDB Galera Cluster 原理：同步多主复制](/database/mariadb/galera)
- 想了解更多 MariaDB 知识？[MariaDB vs MySQL：核心差异对比](/database/mariadb/mysql-compare)
