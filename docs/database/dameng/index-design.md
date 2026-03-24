# 索引设计规范：让查询从龟速到飞速

你遇到过这种情况吗？

明明给表加了索引，查询还是慢得像蜗牛。检查了一圈，索引也在、字段也对，可就是不走索引。

这很可能不是索引的错，而是你的**索引设计**出了问题。

## 索引设计的核心原则： selectivity > coverage > Composite

### 选择性（Selectivity）：索引的生命线

索引列的选择性 = 不同值的数量 / 总行数

选择性越高，索引越有效。

```sql
-- 查看列的选择性
SELECT
    COUNT(DISTINCT column_name) / COUNT(*) AS selectivity
FROM table_name;
```

| 列类型 | 选择性 | 索引效果 |
|-------|-------|---------|
| 性别（2个值） | ~0.5 | 差，大量回表 |
| 订单状态（5个值） | ~0.2 | 一般 |
| 手机号（几乎唯一） | ~1.0 | 优秀 |

**实战经验：**

- 选择性 < 0.1 的列，通常不适合建 B 树索引，考虑位图索引或其他方案
- 主键和唯一索引的选择性是 1.0，效果最佳

### 覆盖索引（Covering Index）：减少回表

回表是性能杀手——先查索引，再回主表取数据，两次 I/O。

如果索引本身就能覆盖查询需要的全部字段，就不需要回表了。

```sql
-- 假设有以下查询
SELECT emp_no, name, dept_id FROM employee WHERE dept_id = 10;

-- 普通索引：需要回表
CREATE INDEX idx_dept ON employee(dept_id);  -- 回表取 emp_no, name

-- 覆盖索引：不需要回表
CREATE INDEX idx_dept_covered ON employee(dept_id, emp_no, name);
```

```java
// 覆盖索引的 Java 应用示例
public class CoveringIndexDemo {

    // 应用场景：下拉列表、报表等频繁查询
    public List&lt;String&gt; getEmployeeNamesByDept(int deptId) {
        // 这个查询会被覆盖索引满足，无需回表
        String sql = "SELECT emp_no, name FROM employee WHERE dept_id = ?";
        // 执行计划中会有 "Using index" 标识，说明使用了覆盖索引
        return jdbcTemplate.queryForList(sql, String.class, deptId);
    }
}
```

## 复合索引设计：顺序决定成败

复合索引的字段顺序，**必须遵循最左前缀原则**。

### 最左前缀原则

复合索引 `(A, B, C)` 相当于创建了三个索引：

- `(A)`
- `(A, B)`
- `(A, B, C)`

```sql
-- 创建复合索引
CREATE INDEX idx_name ON employee(dept_id, salary, hire_date);

-- 这些查询能使用索引
SELECT * FROM employee WHERE dept_id = 10;                      -- 使用 (A)
SELECT * FROM employee WHERE dept_id = 10 AND salary > 5000;    -- 使用 (A, B)
SELECT * FROM employee WHERE dept_id = 10 AND salary > 5000     -- 使用 (A, B, C)
       AND hire_date > '2023-01-01';

-- 这些查询无法使用索引
SELECT * FROM employee WHERE salary > 5000;                    -- 跳过 A
SELECT * FROM employee WHERE hire_date > '2023-01-01';          -- 跳过 A, B
```

### 字段顺序设计原则

**原则一：区分度高的字段放前面**

```sql
-- 错误：dept_id 区分度低，salary 区分度高
CREATE INDEX idx_wrong ON employee(dept_id, salary);

-- 正确：salary 放前面
CREATE INDEX idx_right ON employee(salary, dept_id);
```

**原则二：等值条件字段放范围条件字段前面**

```sql
-- 查询条件：dept_id = 10 AND salary > 5000
-- 正确：等值在前，范围在后
CREATE INDEX idx_order ON employee(dept_id, salary);
```

**原则三：考虑查询频率**

如果经常按 `dept_id` 查询，也经常按 `salary` 查询，考虑拆成两个单列索引，而非一个复合索引。

## 索引设计避坑指南

### 坑一：索引不是越多越好

每增加一个索引，写入性能都会下降。

```java
// 索引数量的性能影响
public class IndexOverheadDemo {

    public void insertWithIndexes(int indexCount) {
        // 没有索引：1 次写入
        // 1 个索引：1 次写入 + 1 次索引更新
        // 10 个索引：1 次写入 + 10 次索引更新
        // 索引越多，INSERT/UPDATE/DELETE 的开销越大
    }
}
```

**经验法则：**

- 单表索引数量建议控制在 5-7 个以内
- 定期检查索引使用率，删除长期未使用的索引

### 坑二：避免在索引列上使用函数

```sql
-- 无法使用索引
SELECT * FROM employee WHERE YEAR(hire_date) = 2024;

-- 能使用索引（前置计算）
SELECT * FROM employee WHERE hire_date BETWEEN '2024-01-01' AND '2024-12-31';

-- 或者使用函数索引
CREATE INDEX idx_year ON employee(YEAR(hire_date));
```

### 坑三：隐式类型转换导致索引失效

```sql
-- phone 是 VARCHAR 类型
-- 无法使用索引（整型到字符串的隐式转换）
SELECT * FROM user WHERE phone = 13800138000;

-- 正确写法
SELECT * FROM user WHERE phone = '13800138000';
```

## 索引创建的最佳时机

| 时机 | 建议 |
|-----|------|
| 建表时 | 为主键、唯一约束、外键创建索引 |
| 开发期 | 根据实际查询添加索引，避免过早优化 |
| 上线前 | 检查慢查询，针对性添加索引 |
| 运维期 | 定期分析索引使用情况，清理无效索引 |

## 索引维护：索引也需要保养

索引不是建好就完事了，需要定期维护。

```sql
-- 分析表，更新统计信息（让优化器选择正确的执行计划）
ANALYZE TABLE employee;

-- 检查索引使用情况
SELECT * FROM V$OBJECT_USAGE WHERE index_name = 'IDX_NAME';

-- 重建碎片化的索引
ALTER INDEX idx_name REBUILD;
```

## 面试追问方向

- 联合索引 (A, B, C)，查询 `WHERE B = 1 AND C = 2` 能命中吗？
- 索引下推（Index Condition Pushdown）是什么？达梦支持吗？

---

## 一句话总结

索引设计是门艺术：选择性决定要不要建，顺序决定能不能用，覆盖决定快不快。记住，索引不是越多越好，适合的才是最好的。
