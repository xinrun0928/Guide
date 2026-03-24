# PostgreSQL 复合索引与最左前缀原则

面试官问：「有一条 SQL `WHERE b = 1 AND c = 2`，表上有复合索引 `(a, b, c)`，能用到索引吗？」

你答：「不能，因为 b 不是最左列。」

面试官追问：「那 `(b, c)` 能用到索引吗？」

你：「...」

今天，我们来彻底搞清楚 PostgreSQL 的复合索引和最左前缀原则。

## 复合索引基础

### 什么是复合索引

复合索引（Composite Index）是在多个列上创建的索引：

```sql
-- 创建两列复合索引
CREATE INDEX idx_orders_cid_status ON orders(customer_id, status);

-- 创建三列复合索引
CREATE INDEX idx_orders_cid_status_date ON orders(customer_id, status, created_at);
```

### 复合索引的内部结构

复合索引 `(a, b, c)` 的 B-Tree 结构：

```
索引结构（按 (a, b, c) 排序）：

                    ┌─────────────────┐
                    │     a = 1       │
                    ├─────────────────┤
              ┌─────┴─────┐     ┌─────┴─────┐
              │   a = 1    │     │   a = 2    │
              │   b = 1    │     │   b = 1    │
              ├───────────┤     ├───────────┤
           ┌──┴──┐     ┌──┴──┐  ┌──┴──┐     ┌──┴──┐
           │c=10 │     │c=20 │  │c=15 │     │c=25 │
           └─────┘     └─────┘  └─────┘     └─────┘

先按 a 排序，a 相同时按 b 排序，b 相同时按 c 排序
```

## 最左前缀原则

### 什么是「最左前缀」

最左前缀原则（Leftmost Prefix Rule）：

> 复合索引 `(a, b, c)` 可以用于查找包含 `a`，或 `a + b`，或 `a + b + c` 的查询条件。

### 能用到索引的情况

```sql
-- 表结构
CREATE INDEX idx_orders ON orders(customer_id, status, created_at);

-- ✅ 能用到索引（使用 a）
SELECT * FROM orders WHERE customer_id = 1;

-- ✅ 能用到索引（使用 a, b）
SELECT * FROM orders WHERE customer_id = 1 AND status = 'pending';

-- ✅ 能用到索引（使用 a, b, c）
SELECT * FROM orders WHERE customer_id = 1 AND status = 'pending' AND created_at > '2026-01-01';
```

### 不能用到索引的情况

```sql
-- ❌ 不能用到索引（跳过 a）
SELECT * FROM orders WHERE status = 'pending';

-- ❌ 不能用到索引（跳过 a）
SELECT * FROM orders WHERE status = 'pending' AND created_at > '2026-01-01';

-- ❌ 不能用到索引（跳过了中间列）
SELECT * FROM orders WHERE customer_id = 1 AND created_at > '2026-01-01';
```

### 图解最左前缀

```
索引：(a, b, c)

┌─────────────────────────────────────────────────────────────┐
│                         查询条件                              │
├─────────────┬─────────────┬─────────────┬───────────────────┤
│   WHERE a   │   WHERE a   │  WHERE a    │      WHERE b      │
│             │  AND b      │  AND b      │                   │
│             │             │  AND c      │                   │
├─────────────┼─────────────┼─────────────┼───────────────────┤
│             │             │             │                   │
│     ✅      │     ✅      │     ✅      │        ❌         │
│   全部匹配   │   全部匹配   │   全部匹配   │    跳过最左列    │
│             │             │             │                   │
└─────────────┴─────────────┴─────────────┴───────────────────┘

简记：查询条件必须从索引的最左列开始，连续不中断
```

## 实际案例分析

### 案例一：订单表

```sql
CREATE INDEX idx_orders ON orders (customer_id, status, created_at DESC);

-- 场景 1：查询某客户的所有订单
SELECT * FROM orders WHERE customer_id = 100;
-- ✅ 用到 customer_id 列

-- 场景 2：查询某客户待处理的订单
SELECT * FROM orders WHERE customer_id = 100 AND status = 'pending';
-- ✅ 用到 customer_id + status 列

-- 场景 3：查询某客户近期待处理订单
SELECT * FROM orders 
WHERE customer_id = 100 
  AND status = 'pending' 
  AND created_at > '2026-03-01';
-- ✅ 用到全部三列

-- 场景 4：查询所有待处理订单
SELECT * FROM orders WHERE status = 'pending';
-- ❌ 跳过最左列，用不到索引
```

### 案例二：用户表

```sql
CREATE INDEX idx_users ON users (country, city, age);

-- 场景 1：查询某国家的用户
SELECT * FROM users WHERE country = 'China';
-- ✅ 用到 country

-- 场景 2：查询某城市用户
SELECT * FROM users WHERE city = 'Beijing';
-- ❌ 跳过 country，用不到索引

-- 场景 3：查询某国家某城市用户
SELECT * FROM users WHERE country = 'China' AND city = 'Beijing';
-- ✅ 用到 country + city

-- 场景 4：范围查询
SELECT * FROM users WHERE country = 'China' AND age > 18;
-- ✅ 用到 country，但 age 范围查询只能部分用索引
```

## 索引列顺序的重要性

### 选择性（Cardinality）

列的选择性越高，越应该放在前面：

```
选择性：列中不同值的比例

country: 200 个国家（高选择性）
status: 5 种状态（低选择性）

索引 (country, status) 比 (status, country) 更好
```

### 什么时候把选择性低的放前面？

1. **查询总是包含低选择性列**：
   ```sql
   -- 所有查询都包含 status
   WHERE status = 'active' AND ...
   WHERE status = 'active' AND created_at > ...
   
   -- 可以把 status 放前面
   CREATE INDEX idx ON orders(status, created_at);
   ```

2. **等值查询优先**：
   ```sql
   -- 等值查询比范围查询更能利用索引
   WHERE status = 'active' AND created_at > ...
   
   -- 适合 (status, created_at)
   -- status 是等值，created_at 是范围
   ```

### 最佳实践

```sql
-- 推荐顺序：等值列 > 排序列 > 范围列

-- 场景：查询某客户按时间排序的订单
SELECT * FROM orders 
WHERE customer_id = 100 
ORDER BY created_at DESC;

-- 最佳索引
CREATE INDEX idx_orders ON orders(customer_id, created_at DESC);
--              ^^^^^^^^  ^^^^^^^^^^^^
--              等值查询   排序字段

-- 不要用 (created_at, customer_id)
-- 因为查询中 created_at 是范围，不能利用索引排序
```

## Java 代码示例

### MyBatis 动态 SQL

```java
@Select("<script>" +
    "SELECT * FROM orders " +
    "WHERE 1=1 " +
    "<if test='customerId != null'>" +
    "  AND customer_id = #{customerId} " +
    "</if>" +
    "<if test='status != null'>" +
    "  AND status = #{status} " +
    "</if>" +
    "<if test='startDate != null'>" +
    "  AND created_at >= #{startDate} " +
    "</if>" +
    "<if test='endDate != null'>" +
    "  AND created_at <= #{endDate} " +
    "</if>" +
    "ORDER BY created_at DESC " +
    "</script>")
List<Order> findOrders(OrderQuery query);
```

### 查询分析与优化

```java
public List<Order> analyzeQuery(OrderQuery query) {
    // 分析 WHERE 条件，生成最优查询
    
    // 假设有索引：(customer_id, status, created_at)
    
    // 场景 1：只有 customer_id
    // ✅ 索引效率高
    
    // 场景 2：customer_id + status
    // ✅ 索引效率高
    
    // 场景 3：customer_id + status + created_at 范围
    // ✅ 索引效率高
    
    // 场景 4：只有 status
    // ❌ 用不到索引，考虑添加 (status) 索引或部分索引
}
```

## 索引覆盖（Covering Index）

### 什么是索引覆盖

如果查询的所有列都包含在索引中，不需要回表：

```sql
-- 索引
CREATE INDEX idx_orders_cid_status_date ON orders(customer_id, status, created_at);

-- 覆盖查询（不回表）
SELECT customer_id, status, created_at 
FROM orders 
WHERE customer_id = 100 AND status = 'pending';

-- 非覆盖查询（需要回表）
SELECT * 
FROM orders 
WHERE customer_id = 100 AND status = 'pending';
-- 需要读取其他列（total_amount 等），必须回表
```

### 索引覆盖的好处

```sql
-- 创建覆盖索引
CREATE INDEX idx_orders_covering ON orders(customer_id, status, created_at)
INCLUDE (total_amount, customer_name);

-- 现在这个查询完全不需要回表
SELECT customer_id, status, created_at, total_amount, customer_name
FROM orders
WHERE customer_id = 100 AND status = 'pending';
```

> PostgreSQL 12+ 支持 CREATE INDEX ... INCLUDE，用于添加非键列到索引中。

## 联合索引 vs 多个单列索引

### 联合索引的优势

```sql
-- 一个联合索引
CREATE INDEX idx_orders ON orders(customer_id, status, created_at);

-- 查询 1：customer_id + status
SELECT * FROM orders WHERE customer_id = 100 AND status = 'pending';
-- ✅ 用联合索引

-- 查询 2：customer_id
SELECT * FROM orders WHERE customer_id = 100;
-- ✅ 用联合索引的前缀
```

### 多个单列索引

```sql
-- 三个单列索引
CREATE INDEX idx_orders_cid ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at);

-- 查询 customer_id + status
SELECT * FROM orders WHERE customer_id = 100 AND status = 'pending';
-- PostgreSQL 可以同时使用两个索引（Index Intersection）
-- 但通常不如联合索引高效
```

### 选择建议

| 场景 | 推荐 |
|------|------|
| 多个列总是同时查询 | 联合索引 |
| 单列查询为主 | 单列索引 |
| 列选择性差异大 | 把高选择性放前面 |
| 需要索引覆盖 | 使用 INCLUDE |

## 面试高频问题

### Q1: 什么是复合索引的最左前缀原则？

**考察点**：索引基础

**参考答案**：
- 复合索引 (a, b, c) 可以用于查找 a，或 a+b，或 a+b+c
- 必须从最左列开始，不能跳过中间列
- 不连续使用会导致索引失效

### Q2: 复合索引 (a, b, c) 中，WHERE b = 1 能用到索引吗？

**考察点**：最左前缀理解

**参考答案**：
- 不能，因为跳过了最左列 a
- 只能从头开始使用索引

### Q3: 复合索引列顺序怎么选择？

**考察点**：索引优化

**参考答案**：
1. 等值查询列优先于范围查询列
2. 选择性高的列优先
3. 排序列尽量靠后
4. 考虑实际的查询模式

### Q4: 联合索引和多个单列索引怎么选？

**考察点**：索引设计

**参考答案**：
- 如果多个列总是同时作为条件，使用联合索引
- 如果单列查询多，可能需要单列索引
- 考虑查询频率和维护成本

## 总结

复合索引的核心原则：

```
1. 最左前缀：必须从索引的最左列开始
2. 连续性：列必须连续，不能中断
3. 选择性：把高选择性列放前面
4. 覆盖：让查询不需要回表
```

理解这些原则，才能设计出高效的索引。
