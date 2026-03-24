# PostgreSQL CTE 与递归查询

想写一个查询，但嵌套太深？

想遍历树形结构？

用 CTE。

今天，我们来聊聊 PostgreSQL 的 CTE 和递归查询。

## CTE（Common Table Expression）

### 什么是 CTE

CTE（公共表表达式）是为复杂查询定义临时结果集的方式：

```sql
-- CTE 语法
WITH cte_name AS (
    SELECT ...
)
SELECT * FROM cte_name;
```

### 简单示例

```sql
-- 不使用 CTE（嵌套查询）
SELECT *
FROM (
    SELECT department, AVG(salary) as avg_salary
    FROM employees
    GROUP BY department
) dept_avg
WHERE avg_salary > 10000;

-- 使用 CTE（更清晰）
WITH dept_avg AS (
    SELECT department, AVG(salary) as avg_salary
    FROM employees
    GROUP BY department
)
SELECT *
FROM dept_avg
WHERE avg_salary > 10000;
```

### 多重 CTE

```sql
-- 多个 CTE
WITH 
    high_earners AS (
        SELECT * FROM employees WHERE salary > 10000
    ),
    active_departments AS (
        SELECT department FROM employees GROUP BY department HAVING COUNT(*) > 5
    )
SELECT 
    e.name,
    e.department,
    e.salary
FROM employees e
JOIN high_earners h ON e.id = h.id
JOIN active_departments a ON e.department = a.department
ORDER BY e.salary DESC;
```

### CTE 的优势

```sql
-- 1. 代码可读性
-- 复杂查询拆分成多个步骤

WITH 
    monthly_orders AS (
        SELECT 
            DATE_TRUNC('month', created_at) as month,
            COUNT(*) as order_count,
            SUM(total_amount) as revenue
        FROM orders
        WHERE created_at >= '2026-01-01'
        GROUP BY DATE_TRUNC('month', created_at)
    ),
    monthly_growth AS (
        SELECT 
            month,
            order_count,
            revenue,
            LAG(order_count) OVER (ORDER BY month) as prev_orders,
            LAG(revenue) OVER (ORDER BY month) as prev_revenue
        FROM monthly_orders
    )
SELECT 
    month,
    order_count,
    ROUND(
        100.0 * (order_count - prev_orders) / NULLIF(prev_orders, 0), 
        2
    ) as order_growth_pct,
    ROUND(
        100.0 * (revenue - prev_revenue) / NULLIF(prev_revenue, 0), 
        2
    ) as revenue_growth_pct
FROM monthly_growth
ORDER BY month;
```

### 递归 CTE

递归 CTE 允许引用自己：

```sql
-- 递归 CTE 语法
WITH RECURSIVE cte_name AS (
    -- 基础查询（非递归）
    SELECT ...
    
    UNION ALL
    
    -- 递归查询（引用 cte_name）
    SELECT ...
    FROM cte_name
    WHERE ...
)
SELECT * FROM cte_name;
```

## 递归查询

### 场景一：生成序列

```sql
-- 生成数字序列 1-10
WITH RECURSIVE sequence AS (
    SELECT 1 as n
    UNION ALL
    SELECT n + 1
    FROM sequence
    WHERE n < 10
)
SELECT * FROM sequence;

-- 生成日期序列
WITH RECURSIVE dates AS (
    SELECT DATE '2026-01-01' as date
    UNION ALL
    SELECT date + 1
    FROM dates
    WHERE date < DATE '2026-01-31'
)
SELECT * FROM dates;
```

### 场景二：遍历组织架构

```sql
-- 员工表（包含经理 ID）
CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    manager_id INT REFERENCES employees(id),
    title VARCHAR(100)
);

-- 插入数据
INSERT INTO employees (name, manager_id, title) VALUES
    ('CEO', NULL, 'CEO'),
    ('VP Engineering', 1, 'VP'),
    ('VP Sales', 1, 'VP'),
    ('Engineering Manager', 2, 'Manager'),
    ('Tech Lead', 4, 'Lead'),
    ('Developer 1', 5, 'Engineer'),
    ('Developer 2', 5, 'Engineer'),
    ('Sales Manager', 3, 'Manager'),
    ('Sales Rep 1', 8, 'Rep');

-- 查询整个组织树（从 CEO 开始）
WITH RECURSIVE org_tree AS (
    -- 基础：CEO
    SELECT 
        id,
        name,
        manager_id,
        title,
        1 as level,
        name::TEXT as path
    FROM employees
    WHERE manager_id IS NULL
    
    UNION ALL
    
    -- 递归：下属
    SELECT 
        e.id,
        e.name,
        e.manager_id,
        e.title,
        o.level + 1,
        o.path || ' > ' || e.name
    FROM employees e
    JOIN org_tree o ON e.manager_id = o.id
)
SELECT * FROM org_tree
ORDER BY path;

-- 结果：
-- id | name       | manager_id | title    | level | path
-- ---+------------+------------+----------+-------+-------------------------
-- 1  | CEO        | NULL       | CEO      | 1     | CEO
-- 2  | VP Eng     | 1          | VP       | 2     | CEO > VP Engineering
-- 4  | Eng Mgr    | 2          | Manager  | 3     | CEO > VP Engineering > ...
-- 5  | Tech Lead  | 4          | Lead     | 4     | CEO > VP Engineering > ...
-- 6  | Dev 1      | 5          | Engineer | 5     | ...
```

### 场景三：查询特定员工的所有下属

```sql
-- 查询 Tech Lead 的所有下属
WITH RECURSIVE subordinates AS (
    -- 基础：Tech Lead 本人
    SELECT id, name, manager_id, title
    FROM employees
    WHERE name = 'Tech Lead'
    
    UNION ALL
    
    -- 递归：下属
    SELECT e.id, e.name, e.manager_id, e.title
    FROM employees e
    JOIN subordinates s ON e.manager_id = s.id
)
SELECT * FROM subordinates;

-- 查询 Developer 1 的所有上级
WITH RECURSIVE hierarchy AS (
    SELECT id, name, manager_id, title, 1 as level
    FROM employees
    WHERE name = 'Developer 1'
    
    UNION ALL
    
    SELECT e.id, e.name, e.manager_id, e.title, h.level + 1
    FROM employees e
    JOIN hierarchy h ON e.id = h.manager_id
)
SELECT * FROM hierarchy ORDER BY level;
```

### 场景四：计算累计值

```sql
-- 使用递归 CTE 计算累计销售额
WITH RECURSIVE cumulative AS (
    -- 基础：第一天
    SELECT 
        date,
        revenue,
        revenue as total
    FROM daily_sales
    WHERE date = (SELECT MIN(date) FROM daily_sales)
    
    UNION ALL
    
    -- 递归：第二天开始
    SELECT 
        d.date,
        d.revenue,
        c.total + d.revenue
    FROM daily_sales d
    JOIN cumulative c ON d.date = c.date + INTERVAL '1 day'
)
SELECT date, revenue, total
FROM cumulative;
```

### 场景五：图的遍历

```sql
-- 城市连接表
CREATE TABLE city_connections (
    from_city VARCHAR(50),
    to_city VARCHAR(50),
    distance INTEGER
);

-- 查询从北京到所有城市的最短路径
WITH RECURSIVE shortest_path AS (
    -- 起点
    SELECT 
        to_city,
        from_city,
        distance,
        ARRAY[from_city, to_city] as path,
        distance as total_distance
    FROM city_connections
    WHERE from_city = 'Beijing'
    
    UNION ALL
    
    -- 扩展路径
    SELECT 
        c.to_city,
        sp.from_city,
        c.distance,
        sp.path || c.to_city,
        sp.total_distance + c.distance
    FROM city_connections c
    JOIN shortest_path sp ON c.from_city = sp.to_city
    WHERE NOT c.to_city = ANY(sp.path)  -- 避免循环
    AND array_length(sp.path, 1) < 10   -- 限制深度
)
SELECT 
    to_city as city,
    total_distance as shortest_distance,
    path
FROM shortest_path
WHERE total_distance = (
    SELECT MIN(total_distance) 
    FROM shortest_path 
    WHERE to_city = shortest_path.to_city
)
ORDER BY total_distance;
```

## 递归 CTE 的控制

### 深度限制

```sql
-- 限制递归深度为 5 层
WITH RECURSIVE deep_tree AS (
    SELECT id, name, manager_id, 1 as depth
    FROM employees
    WHERE manager_id IS NULL
    
    UNION ALL
    
    SELECT e.id, e.name, e.manager_id, d.depth + 1
    FROM employees e
    JOIN deep_tree d ON e.manager_id = d.id
    WHERE d.depth < 5  -- 限制深度
)
SELECT * FROM deep_tree;
```

### 避免无限循环

```sql
-- 使用 path 数组追踪访问过的节点
WITH RECURSIVE safe_tree AS (
    SELECT 
        id,
        name,
        manager_id,
        ARRAY[id] as visited
    FROM employees
    WHERE manager_id IS NULL
    
    UNION ALL
    
    SELECT 
        e.id,
        e.name,
        e.manager_id,
        safe_tree.visited || e.id
    FROM employees e
    JOIN safe_tree ON e.manager_id = safe_tree.id
    WHERE NOT e.id = ANY(safe_tree.visited)  -- 检查是否访问过
)
SELECT * FROM safe_tree;
```

## 性能注意事项

### 递归 CTE 的开销

```sql
-- 递归 CTE 可能很慢（特别是大数据量）
-- 优化建议：
-- 1. 添加深度限制
-- 2. 使用 LATERAL JOIN 优化
-- 3. 考虑使用其他方法（如物化路径）

-- 不推荐：递归遍历大表
WITH RECURSIVE large_tree AS (
    SELECT ...
    FROM big_table
    UNION ALL
    SELECT ...
    FROM big_table bt
    JOIN large_tree lt ON bt.parent_id = lt.id
)
SELECT * FROM large_tree;  -- 可能非常慢

-- 推荐：使用物化路径存储树
ALTER TABLE employees ADD COLUMN path TEXT;
UPDATE employees SET path = (
    SELECT STRING_AGG(name, ' > ' ORDER BY level)
    FROM (
        WITH RECURSIVE ancestors AS (...)
        SELECT * FROM ancestors
    ) a
);
-- 现在查询更简单：
SELECT * FROM employees WHERE path LIKE 'CEO > VP%';
```

## Java 应用

### JPA 递归查询

```java
@Entity
@Table(name = "employees")
public class Employee {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    private String name;
    
    @Column(name = "manager_id")
    private Long managerId;
    
    private String title;
}

@Repository
public interface EmployeeRepository extends JpaRepository<Employee, Long> {
    
    @Query(value = """
        WITH RECURSIVE subordinates AS (
            SELECT * FROM employees WHERE id = :id
            UNION ALL
            SELECT e.* FROM employees e
            JOIN subordinates s ON e.manager_id = s.id
        )
        SELECT * FROM subordinates
        """, nativeQuery = true)
    List<Employee> findAllSubordinates(@Param("id") Long id);
}
```

### MyBatis 递归查询

```java
@Select("""
    WITH RECURSIVE tree AS (
        SELECT id, name, parent_id, 1 as level
        FROM categories
        WHERE id = #{rootId}
        
        UNION ALL
        
        SELECT c.id, c.name, c.parent_id, t.level + 1
        FROM categories c
        JOIN tree t ON c.parent_id = t.id
    )
    SELECT * FROM tree ORDER BY level, name
    """)
@Results({
    @Result(property = "id", column = "id"),
    @Result(property = "name", column = "name"),
    @Result(property = "parentId", column = "parent_id"),
    @Result(property = "level", column = "level")
})
List<CategoryTree> getCategoryTree(@Param("rootId") Long rootId);
```

## 面试高频问题

### Q1: CTE 和子查询有什么区别？

**考察点**：CTE 基础

**参考答案**：
- CTE 可以多次引用，子查询每次都要重复
- CTE 代码更清晰易读
- CTE 可以递归，子查询不能
- CTE 是标准 SQL，子查询更通用

### Q2: 递归 CTE 怎么用？

**考察点**：递归查询

**参考答案**：
1. 基础查询（非递归部分）
2. UNION ALL
3. 递归查询（引用 CTE 自身）
4. 添加终止条件避免无限循环

### Q3: 递归 CTE 的典型应用场景？

**考察点**：实际应用

**参考答案**：
1. 树形结构遍历（组织架构、分类）
2. 图的遍历（最短路径）
3. 生成序列（数字、日期）
4. 累计计算

### Q4: 递归 CTE 如何避免无限循环？

**考察点**：递归安全

**参考答案**：
1. 添加深度限制（WHERE depth < N）
2. 使用 visited 数组追踪已访问节点
3. 设置 max_recursion_depth 参数

## 总结

CTE 和递归查询是 PostgreSQL 的强大特性：

| 特性 | 说明 |
|------|------|
| 普通 CTE | 定义临时结果集，提高可读性 |
| 多重 CTE | 多个临时结果集 |
| 递归 CTE | 遍历树形结构、生成序列 |

递归查询结构：
```
WITH RECURSIVE cte AS (
    基础查询（非递归）
    UNION ALL
    递归查询（引用 cte）
    WHERE 终止条件
)
SELECT * FROM cte;
```

适用场景：
- 组织架构遍历
- 分类树遍历
- 路径计算
- 序列生成
