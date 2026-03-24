# JOIN 原理与嵌套循环连接（NLJ）

你的 JOIN 查询跑得很慢。

两张表 JOIN，到底是怎么执行的？

今天，彻底搞清楚 JOIN 的原理。

---

## JOIN 的执行方式

### 嵌套循环连接（NLJ）

**嵌套循环连接**：驱动表扫描，被驱动表匹配。

```sql
-- 示例
SELECT * FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.status = 'pending';

-- NLJ 执行过程：
-- 1. 扫描驱动表 orders（status = 'pending'）
-- 2. 对每一行，扫描被驱动表 users
-- 3. 如果 o.user_id = u.id，连接结果
```

### NLJ 的复杂度

```sql
-- 复杂度分析：
-- 驱动表扫描次数：N（行数）
-- 被驱动表扫描次数：M × N（行数）
-- 总复杂度：O(N × M)

-- 示例：
-- orders 表：1 万行
-- users 表：1000 行
-- 如果 orders 是驱动表：1 万 × 1000 = 1000 万次扫描
```

---

## 驱动表的选择

### 小表驱动大表

```sql
-- 小表驱动大表

-- orders 表：10 行
-- users 表：100 万行

-- 选择 orders 驱动（10 × 100万 = 1000 万）
SELECT * FROM orders o
JOIN users u ON o.user_id = u.id;

-- 选择 users 驱动（100万 × 10 = 1000 万）
-- 结果一样，但顺序影响中间结果

-- 原则：小表作为驱动表，减少扫描次数
```

### 如何确定驱动表？

```sql
-- 原则：
-- 1. LEFT JOIN：左边是驱动表
-- 2. INNER JOIN：优化器自动选择
-- 3. 通常选择有索引的表作为被驱动表

-- 查看执行计划
EXPLAIN SELECT * FROM orders o
JOIN users u ON o.user_id = u.id;

-- 关注 id=1 先执行的就是驱动表
```

---

## Index NLJ（索引 NLJ）

### 什么是 Index NLJ？

**Index NLJ**：被驱动表使用索引匹配。

```sql
-- 如果被驱动表有索引
CREATE INDEX idx_user_id ON orders(user_id);

-- Index NLJ 执行过程：
-- 1. 扫描驱动表 orders
-- 2. 对每一行，通过索引查找 users
-- 3. 索引查找 O(log M)，总复杂度 O(N × log M)

-- 对比：
-- 无索引 NLJ：O(N × M)
-- Index NLJ：O(N × log M)
```

### Index NLJ 的条件

```sql
-- 条件：
-- 1. 被驱动表的 JOIN 列有索引
-- 2. JOIN 条件是等值连接（=）

-- 非等值连接无法使用 Index NLJ
SELECT * FROM orders o
JOIN users u ON o.user_id < u.id;
-- 无法使用索引
```

---

## Block Nested-Loop Join（BNLJ）

### 什么是 BNLJ？

**BNLJ**：把驱动表数据加载到缓存，分批匹配被驱动表。

```sql
-- 如果被驱动表没有索引
-- MySQL 使用 BNLJ

-- 执行过程：
-- 1. 读取驱动表所有数据到 join_buffer
-- 2. 扫描被驱动表
-- 3. 在内存中匹配
```

### BNLJ 的问题

```sql
-- BNLJ 的问题：
-- 1. 扫描被驱动表 N 次
-- 2. 如果 join_buffer 放不下，需要分批
-- 3. 性能很差

-- 优化：增加 join_buffer_size
SET join_buffer_size = 524288;  -- 512KB
```

---

## JOIN 优化原则

### 原则一：小表驱动大表

```sql
-- 验证小表
EXPLAIN SELECT STRAIGHT_JOIN *
FROM orders o
JOIN users u ON o.user_id = u.id;
-- STRAIGHT_JOIN 强制按书写顺序执行
```

### 原则二：被驱动表有索引

```sql
-- 确保被驱动表的 JOIN 列有索引
CREATE INDEX idx_user_id ON orders(user_id);

-- 查看执行计划
EXPLAIN SELECT * FROM orders o
JOIN users u ON o.user_id = u.id;
-- type: ref  ← 使用了索引
```

### 原则三：减少 JOIN 的数据量

```sql
-- ❌ 先 JOIN 再过滤
SELECT * FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.status = 'pending';

-- ✅ 先过滤再 JOIN
SELECT * FROM orders o
INNER JOIN (
    SELECT * FROM orders WHERE status = 'pending'
) t ON o.user_id = t.user_id
JOIN users u ON o.user_id = u.id;

-- 或者确保过滤条件在 JOIN 之前生效
```

---

## 实战优化

### 场景一：多表 JOIN

```sql
-- 原始 SQL
SELECT *
FROM orders o
JOIN users u ON o.user_id = u.id
JOIN products p ON o.product_id = p.id
WHERE o.status = 'pending';

-- 优化：
-- 1. 确保每个 JOIN 的列都有索引
CREATE INDEX idx_user_id ON orders(user_id);
CREATE INDEX idx_product_id ON orders(product_id);

-- 2. 选择合适的驱动表
-- orders 表过滤后最小，作为驱动表

-- 3. 添加过滤条件
WHERE o.status = 'pending'
```

### 场景二：JOIN 后聚合

```sql
-- 原始 SQL
SELECT u.name, COUNT(*) as cnt
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.status = 'paid'
GROUP BY u.name;

-- 优化：
-- 1. 先聚合再 JOIN
SELECT u.name, order_cnt as cnt
FROM users u
INNER JOIN (
    SELECT user_id, COUNT(*) as order_cnt
    FROM orders
    WHERE status = 'paid'
    GROUP BY user_id
) o ON u.id = o.user_id;

-- 2. 确保有索引
CREATE INDEX idx_status_user ON orders(status, user_id);
```

---

## 面试高频追问

### Q1：JOIN 和子查询哪个快？

```sql
-- 取决于情况：
-- 1. 子查询转 JOIN：优化器会自动转换
-- 2. 相关子查询：通常比 JOIN 慢
-- 3. 不相关子查询：可以先执行子查询

-- 建议：看执行计划，选择更优的
EXPLAIN SELECT * FROM orders o
WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id);
```

### Q2：JOIN 一定会走索引吗？

```sql
-- 不一定：
-- 1. 如果没有索引，使用 BNLJ
-- 2. 如果 JOIN 列类型不匹配，无法使用索引
-- 3. 优化器可能认为全表扫描更快
```

### Q3：INNER JOIN 和 LEFT JOIN 怎么选？

```sql
-- 语义不同：
-- INNER JOIN：只保留两边都有的记录
-- LEFT JOIN：保留左表所有记录

-- 优先使用 INNER JOIN：
-- 1. 性能更好
-- 2. 语义更清晰
-- 3. 如果需要保留左表所有记录，再考虑 LEFT JOIN
```

---

## 总结

| JOIN 类型 | 原理 | 性能 |
|---------|-----|-----|
| NLJ | 嵌套循环 | 差 |
| Index NLJ | 嵌套循环 + 索引 | 一般 |
| BNLJ | 缓存 + 循环 | 差 |

**记住：JOIN 优化的核心是小表驱动大表，被驱动表有索引。**