# JOIN 优化：让连接快如闪电

JOIN 是 SQL 中最消耗性能的操作之一。

但只要掌握正确的优化技巧，JOIN 也可以很快。

---

## 优化原则一：确保连接字段有索引

这是最重要的优化。

```sql
-- orders.user_id 连接 users.id
-- 确保 users.id 是主键（有索引）
-- 确保 orders.user_id 有索引

CREATE INDEX idx_user_id ON orders(user_id);
```

验证：

```sql
EXPLAIN SELECT * FROM orders o
INNER JOIN users u ON o.user_id = u.id;
```

```
+----+-------------+-------+--------+---------------+---------+---------+--------+----------+-------+
| id | select_type| table | type   | key           | key_len | ref     | rows   | Extra    |       |
+----+-------------+-------+--------+---------------+---------+---------+--------+----------+-------+
|  1 | SIMPLE     | o     | ALL    | NULL          | NULL    | NULL    | 10000  |          |       |
|  1 | SIMPLE     | u     | eq_ref | PRIMARY       | 8       | o.user_id| 1     |          |       |
+----+-------------+-------+--------+---------------+---------+---------+--------+----------+-------+
```

`type=eq_ref` 说明 users 表使用主键索引，性能好。

---

## 优化原则二：小表驱动大表

NLJ 中，应该让小表做驱动表。

```sql
-- users 表 1000 行，orders 表 100000 行
-- 应该让 users 做驱动表

-- 查看优化器选择的驱动表
EXPLAIN SELECT * FROM orders o
INNER JOIN users u ON o.user_id = u.id;
```

如果优化器选错了，可以用 `STRAIGHT_JOIN` 强制顺序：

```sql
-- 强制 users 做驱动表
SELECT STRAIGHT_JOIN * FROM users u
INNER JOIN orders o ON o.user_id = u.id;
```

---

## 优化原则三：减少 JOIN 的表数量

超过 5 个表的 JOIN 很难优化。

### 场景：用户订单商品三表查询

```sql
-- 一次 JOIN 三个表
SELECT u.name, o.order_no, p.name
FROM users u
JOIN orders o ON u.id = o.user_id
JOIN products p ON o.product_id = p.id
WHERE u.id = 1;
```

优化建议：
- 确认每个表的连接字段都有索引
- 使用 EXPLAIN 分析每个步骤

### 拆分成多个查询

```java
// 用 Java 代码分步查询
public List&lt;OrderDetail&gt; getOrderDetail(long userId) {
    // 1. 先查用户
    User user = userMapper.selectById(userId);

    // 2. 再查订单
    List&lt;Order&gt; orders = orderMapper.selectByUserId(userId);

    // 3. 再查商品
    List&lt;Long&gt; productIds = orders.stream().map(Order::getProductId).collect(toList());
    Map&lt;Long, Product&gt; productMap = productMapper.selectByIds(productIds)
        .stream().collect(toMap(Product::getId, p -> p));

    // 4. 组装结果
    return orders.stream().map(o -> {
        OrderDetail detail = new OrderDetail();
        detail.setUser(user);
        detail.setOrder(o);
        detail.setProduct(productMap.get(o.getProductId()));
        return detail;
    }).collect(toList());
}
```

---

## 优化原则四：避免 SELECT *

只查询需要的字段，减少网络传输和内存消耗。

```sql
-- 不好：SELECT *
SELECT * FROM orders o
INNER JOIN users u ON o.user_id = u.id;

-- 好：明确字段
SELECT o.order_no, o.amount, u.name
FROM orders o
INNER JOIN users u ON o.user_id = u.id;
```

---

## 优化原则五：优化子查询为 JOIN

子查询性能往往不如 JOIN。

```sql
-- 子查询写法（可能性能差）
SELECT * FROM orders
WHERE user_id IN (SELECT id FROM users WHERE status = 'active');

-- JOIN 写法（通常更好）
SELECT DISTINCT o.*
FROM orders o
INNER JOIN users u ON o.user_id = u.id
WHERE u.status = 'active';
```

MySQL 8.0+ 对子查询有优化，但 JOIN 仍然是首选。

---

## 优化原则六：利用覆盖索引

```sql
-- 如果只需要订单号和用户名
SELECT o.order_no, u.name
FROM orders o
INNER JOIN users u ON o.user_id = u.id;

-- 创建覆盖索引
CREATE INDEX idx_user_name ON users(id, name);
CREATE INDEX idx_order_user ON orders(user_id, order_no);
```

---

## 实战案例

### 案例一：用户积分统计

```sql
-- 原始 SQL（慢）
SELECT u.id, u.name, SUM(o.amount) AS total_amount
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE o.status = 'paid'
GROUP BY u.id, u.name;
-- 问题：可能扫描大量数据

-- 优化：添加索引
CREATE INDEX idx_orders_status_user ON orders(status, user_id, amount);

-- EXPLAIN 分析
EXPLAIN SELECT u.id, u.name, SUM(o.amount) AS total_amount
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE o.status = 'paid'
GROUP BY u.id, u.name;
```

### 案例二：商品销售排行

```sql
-- 原始 SQL
SELECT p.id, p.name, COUNT(o.id) AS sales_count
FROM products p
LEFT JOIN orders o ON p.id = o.product_id
GROUP BY p.id, p.name
ORDER BY sales_count DESC
LIMIT 20;

-- 优化：确保有索引
CREATE INDEX idx_orders_product ON orders(product_id);

-- 如果经常查销售排行，可以建汇总表
CREATE TABLE product_sales_summary (
    product_id BIGINT PRIMARY KEY,
    sales_count INT,
    last_updated DATETIME
);
-- 定期更新汇总数据，查询直接读汇总表
```

---

## Java 代码优化示例

```java
@Service
public class JoinQueryOptimizer {

    /**
     * 分析 JOIN 查询是否需要优化
     */
    public JoinAnalysis analyzeJoinQuery(String sql) {
        JoinAnalysis analysis = new JoinAnalysis();

        // 1. EXPLAIN 分析
        String explainSql = "EXPLAIN " + sql;
        // 执行并解析结果

        // 2. 检查连接字段是否有索引
        List&lt;JoinCondition&gt; conditions = parseJoinConditions(sql);
        for (JoinCondition cond : conditions) {
            boolean hasIndex = checkIndex(cond.getTable(), cond.getColumn());
            if (!hasIndex) {
                analysis.addWarning(String.format(
                    "表 %s 的字段 %s 没有索引，建议添加",
                    cond.getTable(), cond.getColumn()
                ));
            }
        }

        // 3. 检查驱动表选择
        String driverTable = analysis.getDriverTable();
        long driverRows = analysis.getDriverRows();
        if (driverRows > 10000) {
            analysis.addWarning("驱动表 " + driverTable + " 行数较多，考虑用小表驱动");
        }

        return analysis;
    }

    /**
     * 优化建议
     */
    public List&lt;String&gt; suggestOptimizations(JoinAnalysis analysis) {
        List&lt;String&gt; suggestions = new ArrayList&lt;&gt;();

        // 检查是否有多表 JOIN
        if (analysis.getJoinCount() > 5) {
            suggestions.add("JOIN 表数量过多，考虑拆分或使用临时表");
        }

        // 检查是否 SELECT *
        if (sql.contains("SELECT *")) {
            suggestions.add("避免使用 SELECT *，只查询需要的字段");
        }

        return suggestions;
    }
}
```

---

## 一句话总结

JOIN 优化的核心是：**索引支持、小表驱动、字段精简、数量控制**。每个连接字段都要有索引，尽量让小表驱动大表，只查需要的字段。
