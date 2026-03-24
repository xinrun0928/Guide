# 子查询：小心 SQL 中的「定时炸弹」

很多人喜欢用子查询，因为「看起来清晰」。

但有时候，子查询是性能杀手——你写得爽，数据库跑得慢。

今天，我们彻底搞懂子查询。

---

## 什么是子查询？

子查询就是 SELECT 中的 SELECT，一个查询嵌套在另一个查询里。

```sql
-- 子查询示例：查所有有订单的用户
SELECT * FROM users
WHERE id IN (SELECT user_id FROM orders);

-- 子查询结果：
-- (SELECT user_id FROM orders) 返回 [1, 2, 3, ...]
-- 外层查询找到 id 在这些值中的用户
```

---

## 子查询的类型

### 标量子查询：返回单个值

```sql
-- 查询订单数大于平均值的用户
SELECT * FROM users
WHERE (SELECT COUNT(*) FROM orders WHERE orders.user_id = users.id)
      > (SELECT AVG(cnt) FROM (SELECT COUNT(*) AS cnt FROM orders GROUP BY user_id) AS t);
```

### 列子查询：返回一列值

```sql
-- 查询所有有订单的用户
SELECT * FROM users
WHERE id IN (SELECT user_id FROM orders);
```

### 行子查询：返回一行

```sql
-- 查询订单金额最大的订单
SELECT * FROM orders
WHERE (amount, created_at) = (SELECT MAX(amount), MAX(created_at) FROM orders);
```

### 表子查询：返回一个表

```sql
-- 查询每个用户最新的订单
SELECT * FROM orders
WHERE (user_id, created_at) IN
      (SELECT user_id, MAX(created_at) FROM orders GROUP BY user_id);
```

---

## 子查询的坑

### 坑一：相关子查询的性能问题

**相关子查询**：子查询引用了外层查询的字段。

```sql
-- 相关子查询：性能差
SELECT * FROM orders o
WHERE amount > (SELECT AVG(amount) FROM orders WHERE user_id = o.user_id);
-- 每行都执行一次子查询！
```

**优化**：用 JOIN 替代相关子查询。

```sql
-- 优化：用 GROUP BY + JOIN
SELECT o.*
FROM orders o
INNER JOIN (
    SELECT user_id, AVG(amount) AS avg_amount
    FROM orders
    GROUP BY user_id
) t ON o.user_id = t.user_id
WHERE o.amount > t.avg_amount;
```

### 坑二：IN 子查询的性能问题

MySQL 5.6 之前，IN 子查询会先执行子查询，再执行外层查询，效率很低。

```sql
-- IN 子查询
SELECT * FROM orders
WHERE user_id IN (SELECT id FROM users WHERE status = 'active');

-- MySQL 5.6+ 会自动优化为 JOIN
-- 但复杂场景可能还是慢
```

**优化**：用 EXISTS 或 JOIN 替代。

```sql
-- EXISTS 写法
SELECT * FROM orders o
WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id AND u.status = 'active');

-- JOIN 写法（通常更好）
SELECT DISTINCT o.*
FROM orders o
INNER JOIN users u ON o.user_id = u.id
WHERE u.status = 'active';
```

### 坑三：子查询返回 NULL 的问题

```sql
-- 如果子查询返回 NULL，IN 的行为会出错
SELECT * FROM users
WHERE id IN (SELECT user_id FROM orders WHERE status = 'cancelled');
-- 如果所有订单都取消了，user_id 列都是 NULL
-- IN (NULL) 永远不会匹配任何行！
```

**优化**：处理 NULL 值。

```sql
-- 使用 EXISTS 或 NOT EXISTS
SELECT * FROM users u
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status = 'cancelled');
```

---

## MySQL 优化器对子查询的优化

### 优化一：子查询物化

MySQL 5.6+ 会将子查询结果物化为临时表，并建立索引。

```sql
SELECT * FROM orders
WHERE user_id IN (SELECT id FROM users WHERE status = 'active');
-- MySQL 内部执行：
-- 1. 执行子查询，结果存入临时表（带索引）
-- 2. 主查询使用临时表进行匹配
```

### 优化二：半连接（Semi-Join）

MySQL 对 IN 子查询会尝试使用半连接优化。

```sql
-- 半连接优化
SELECT * FROM orders o
WHERE o.user_id IN (SELECT id FROM users WHERE status = 'active');
-- 优化器可能选择：
-- - Table pullout：将子查询表提出来做 JOIN
-- - FirstMatch：只匹配第一个满足条件的行
-- - LooseScan：扫描索引时跳过重复值
```

### 优化三：物化扫描

```sql
-- 物化扫描
SELECT * FROM orders o
WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id AND u.status = 'active');
-- 子查询物化为临时表，外层使用
```

---

## 最佳实践

### 实践一：能用 JOIN 就不用子查询

```sql
-- 不推荐：子查询
SELECT * FROM orders
WHERE user_id IN (SELECT id FROM users WHERE status = 'active');

-- 推荐：JOIN
SELECT DISTINCT o.*
FROM orders o
INNER JOIN users u ON o.user_id = u.id
WHERE u.status = 'active';
```

### 实践二：用 EXISTS 替代 IN

```sql
-- 不推荐：IN 子查询
SELECT * FROM orders
WHERE user_id IN (SELECT id FROM users WHERE status = 'active');

-- 推荐：EXISTS
SELECT * FROM orders o
WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id AND u.status = 'active');
```

### 实践三：避免相关子查询

```sql
-- 不推荐：相关子查询
SELECT *, (SELECT COUNT(*) FROM orders WHERE user_id = users.id) AS order_count
FROM users;

-- 推荐：GROUP BY + JOIN
SELECT u.*, COALESCE(t.order_count, 0) AS order_count
FROM users u
LEFT JOIN (
    SELECT user_id, COUNT(*) AS order_count
    FROM orders
    GROUP BY user_id
) t ON u.id = t.user_id;
```

---

## Java 代码示例

```java
@Service
public class SubqueryOptimizer {

    /**
     * 将子查询转换为 JOIN
     */
    public String optimizeSubquery(String sql) {
        // 简单示例：识别 IN 子查询并转换为 JOIN
        if (sql.contains("IN (SELECT") && sql.contains("DISTINCT")) {
            // 已经是 DISTINCT，不需要改
            return sql;
        }

        // 复杂场景需要 SQL 解析器
        // 这里只是演示思路
        if (sql.contains("IN (SELECT")) {
            // 可以考虑转换为 JOIN
            return "/* 建议转换为 JOIN 以提升性能 */" + sql;
        }

        return sql;
    }

    /**
     * 检查是否有相关子查询
     */
    public boolean hasCorrelatedSubquery(String sql) {
        // 简单检测：子查询中引用外层表
        // 需要 SQL 解析器或 AST
        // 这里只是演示思路
        return sql.matches(".*\\(SELECT.+\\b" + extractTableAlias(sql) + "\\..*");
    }
}
```

---

## 面试追问方向

- IN 和 EXISTS 的区别？哪个性能更好？
- 子查询和 JOIN 哪个性能更好？
- MySQL 对子查询做了哪些优化？

> EXISTS 和 IN 在大多数情况下性能差不多，但 EXISTS 更灵活（可以处理复杂的子查询条件）。JOIN 在数据量大且有索引时通常更好。
