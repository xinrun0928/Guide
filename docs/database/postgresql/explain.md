# PostgreSQL 执行计划分析：Seq Scan、Index Scan、Hash Join、Nested Loop

你的查询跑了 10 秒。

你知道为什么吗？

PostgreSQL 的执行计划藏着答案，但你会看吗？

今天，我们来彻底搞懂 PostgreSQL 的执行计划。

## EXPLAIN 命令

### 基本用法

```sql
-- 查看执行计划（不执行）
EXPLAIN SELECT * FROM users WHERE email = 'alice@example.com';

-- 查看执行计划（实际执行）
EXPLAIN ANALYZE SELECT * FROM users WHERE email = 'alice@example.com';

-- 查看缓冲区信息
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM users WHERE email = 'alice@example.com';

-- 查看格式化 JSON
EXPLAIN (FORMAT JSON) SELECT * FROM users WHERE email = 'alice@example.com';
```

### EXPLAIN 输出解读

```
EXPLAIN ANALYZE 结果：
┌──────────────────────────────────────────────────────────────┐
│ Index Scan using idx_users_email on users                    │
│   (cost=0.42..8.44 rows=1 width=97)                       │
│   (actual time=0.021..0.023 rows=1 loops=1)                │
│   Index Cond: ((email)::text = 'alice@example.com'::text)   │
│   Buffers: shared hit=3 read=0                              │
│ Planning Time: 0.5 ms                                       │
│ Execution Time: 0.8 ms                                      │
└──────────────────────────────────────────────────────────────┘
```

## 扫描类型（Scan Types）

### Seq Scan（顺序扫描）

```sql
-- 全表扫描
EXPLAIN SELECT * FROM users WHERE status = 'active';

-- 输出：
-- Seq Scan on users  (cost=0.00..12345.00 rows=10000 width=97)
--   Filter: ((status)::text = 'active'::text)
```

**何时使用 Seq Scan**：
- 表很小
- 查询返回大部分数据
- 没有合适的索引
- 统计信息不准确

### Index Scan（索引扫描）

```sql
-- 使用索引
EXPLAIN SELECT * FROM users WHERE id = 1;

-- 输出：
-- Index Scan using users_pkey on users
--   Index Cond: (id = 1)
```

**特点**：
- 需要回表（读取索引后再读取数据）
- 比 Seq Scan 多一次 I/O

### Index Only Scan（仅索引扫描）

```sql
-- 查询只需要索引列
EXPLAIN SELECT id FROM users WHERE id > 100;

-- 输出：
-- Index Only Scan using users_pkey on users
--   Index Cond: (id > 100)
```

**特点**：
- 不需要回表，性能更好
- 要求查询的所有列都在索引中

### Bitmap Scan（位图扫描）

```sql
-- 返回多行时
EXPLAIN SELECT * FROM users WHERE status = 'active' OR status = 'pending';

-- 输出：
-- Bitmap Heap Scan on users
--   Recheck Cond: ((status = 'active') OR (status = 'pending'))
--   ->  BitmapOr
--         ->  Bitmap Index Scan on idx_users_status
--               Index Cond: (status = 'active')
--         ->  Bitmap Index Scan on idx_users_status
--               Index Cond: (status = 'pending')
```

**Bitmap Scan 流程**：

```
1. Index Scan：扫描索引，生成行号位图
2. BitmapOr/BitmapAnd：合并位图
3. Bitmap Heap Scan：根据位图读取数据

┌─────────────────────────────────────────────────────────┐
│ Page 1: [1, 0, 1, 0, 1, 0, 1, 0] → 10101010          │
│ Page 2: [0, 1, 0, 1, 0, 1, 0, 1] → 01010101          │
│ BitmapOr: 11111111 → 读取所有页面                       │
└─────────────────────────────────────────────────────────┘
```

## 连接类型（Join Types）

### Nested Loop（嵌套循环）

```sql
EXPLAIN
SELECT * FROM orders o
JOIN users u ON o.user_id = u.id
WHERE u.country = 'China';

-- 输出：
-- Nested Loop
--   ->  Index Scan using idx_users_country on users
--         Index Cond: (country = 'China')
--   ->  Index Scan using idx_orders_user_id on orders
--         Index Cond: (user_id = u.id)
```

**特点**：
- 外层表驱动内层表
- 适合小表驱动大表
- 如果有索引，性能好

### Hash Join（哈希连接）

```sql
EXPLAIN
SELECT * FROM orders o
JOIN users u ON o.user_id = u.id;

-- 输出：
-- Hash Join
--   Hash Cond: (o.user_id = u.id)
--   ->  Seq Scan on orders o
--   ->  Hash
--         ->  Seq Scan on users u
```

**Hash Join 流程**：

```
1. 扫描小表，建立哈希表
2. 扫描大表，探测哈希表

┌─────────────────────────────────────────────────────────┐
│ 小表建立哈希表：                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ user_id=1 → {id:1, name:'Alice'}                    │ │
│ │ user_id=2 → {id:2, name:'Bob'}                      │ │
│ └─────────────────────────────────────────────────────┘ │
│ 大表探测：                                              │
│ order.user_id=1 → 查找哈希表 → 匹配 Alice               │
└─────────────────────────────────────────────────────────┘
```

**特点**：
- 需要内存构建哈希表
- 适合大表连接
- 无法利用索引

### Merge Join（归并连接）

```sql
EXPLAIN
SELECT * FROM orders o
JOIN users u ON o.user_id = u.id
ORDER BY o.user_id, u.id;

-- 输出：
-- Merge Join
--   Merge Cond: (o.user_id = u.id)
--   ->  Index Scan using idx_orders_user_id on orders
--   ->  Index Scan using users_pkey on users
```

**特点**：
- 需要两边都排序
- 如果有索引，性能好
- 不需要额外内存

## 连接类型选择

### Nested Loop 适用场景

```
适合：
✅ 小表驱动大表
✅ 有索引支持
✅ 返回少量数据

不适合：
❌ 两个大表
❌ 无索引
❌ 范围查询
```

### Hash Join 适用场景

```
适合：
✅ 两个大表
✅ 没有合适的索引
✅ 内存足够

不适合：
❌ 小表太多（内存压力）
❌ 需要流式输出
❌ 内存不足
```

### Merge Join 适用场景

```
适合：
✅ 两边都已排序
✅ 有索引支持
✅ 返回大量数据

不适合：
❌ 数据无序且无法排序
❌ 需要排序成本高
```

## 成本估算

### 成本参数

```sql
-- 查看成本参数
SHOW seq_page_cost;        -- 默认 1.0
SHOW random_page_cost;     -- 默认 4.0
SHOW cpu_tuple_cost;       -- 默认 0.01
SHOW cpu_index_tuple_cost; -- 默认 0.005
SHOW cpu_operator_cost;    -- 默认 0.0025
```

### 成本计算

```
总成本 = I/O 成本 + CPU 成本

I/O 成本：
- Seq Scan: pages * seq_page_cost
- Index Scan: 索引页面读取 + 数据页面读取
- Index Only Scan: 索引页面读取

CPU 成本：
- 行数 * cpu_tuple_cost
- 索引行数 * cpu_index_tuple_cost
- 操作符评估 * cpu_operator_cost
```

### 调优成本参数

```sql
-- SSD 服务器：降低随机读取成本
ALTER SYSTEM SET random_page_cost = 1.1;

-- 内存充足：降低 CPU 成本
ALTER SYSTEM SET cpu_tuple_cost = 0.001;
```

## 常见问题分析

### 问题一：为什么走 Seq Scan 而不是 Index Scan？

```sql
EXPLAIN SELECT * FROM users WHERE id > 500000;

-- 原因分析：
-- 1. 表太小，Seq Scan 更快
-- 2. 查询范围太大，索引扫描大部分数据
-- 3. 统计信息不准

-- 解决方案：
-- 1. ANALYZE 更新统计
ANALYZE users;

-- 2. 查看表大小
SELECT pg_size_pretty(pg_relation_size('users'));

-- 3. 查看统计信息
SELECT * FROM pg_stats WHERE tablename = 'users';
```

### 问题二：为什么 Hash Join 内存爆了？

```sql
-- 查看 Hash Join 的内存使用
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM large_table1 t1
JOIN large_table2 t2 ON t1.id = t2.t1_id;

-- 调整 work_mem
SET work_mem = '256MB';

-- 查看当前 work_mem
SHOW work_mem;
```

### 问题三：为什么 Nested Loop 无索引？

```sql
-- 查看执行计划
EXPLAIN
SELECT * FROM orders o
JOIN users u ON o.user_id = u.id;

-- 如果 Nested Loop 但无索引，可能很慢

-- 检查索引
\d orders

-- 添加索引
CREATE INDEX idx_orders_user_id ON orders(user_id);
```

## 优化建议

### 1. 查看慢查询的执行计划

```sql
-- 使用 pg_stat_statements
CREATE EXTENSION pg_stat_statements;

-- 查看最慢的查询
SELECT query, calls, mean_time, total_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- 查看执行计划
EXPLAIN (ANALYZE, BUFFERS)
{最慢的查询};
```

### 2. 分析执行计划的瓶颈

```sql
-- 查看哪个节点最慢
EXPLAIN (ANALYZE, FORMAT JSON)
SELECT * FROM orders o
JOIN users u ON o.user_id = u.id
WHERE u.country = 'China';

-- 分析：
-- - 查看 actual time，找到最慢的节点
-- - 查看 rows，验证估算准确性
-- - 查看 Buffers，查看缓存命中率
```

### 3. 优化执行计划

```sql
-- 优化统计信息
ANALYZE orders;
ANALYZE users;

-- 优化表结构
-- - 添加缺失的索引
-- - 调整 fillfactor
-- - 使用分区表

-- 优化查询
-- - 减少返回列
-- - 添加合适的 WHERE 条件
-- - 避免 SELECT *
```

## 面试高频问题

### Q1: PostgreSQL 有哪些扫描类型？

**考察点**：执行计划理解

**参考答案**：
- Seq Scan：全表扫描
- Index Scan：索引扫描
- Index Only Scan：仅索引扫描
- Bitmap Scan：位图扫描
- TID Scan：元组 ID 扫描

### Q2: Hash Join 和 Nested Loop 的区别？

**考察点**：连接算法

**参考答案**：
- Nested Loop：外层驱动内层，适合小表或有索引
- Hash Join：构建哈希表，适合大表，无索引
- Merge Join：两边排序后合并，需要两边排序

### Q3: 如何分析慢查询？

**考察点**：性能优化

**参考答案**：
1. 使用 EXPLAIN ANALYZE 查看执行计划
2. 分析各节点的 cost 和 actual time
3. 找出瓶颈（通常是扫描大量数据）
4. 检查索引是否被使用
5. 验证统计信息准确性

### Q4: 为什么估算的 rows 和实际不符？

**考察点**：统计信息

**参考答案**：
- 统计信息过期，需要 ANALYZE
- 数据分布不均，需要调整统计目标
- 使用了复杂的表达式
- 多表 JOIN 时估算可能不准确

## 总结

执行计划的核心概念：

| 类型 | 说明 | 适用场景 |
|------|------|---------|
| Seq Scan | 全表扫描 | 小表、无索引 |
| Index Scan | 索引扫描 | 有索引、返回少量 |
| Index Only Scan | 仅索引扫描 | 覆盖索引 |
| Bitmap Scan | 位图扫描 | 返回多行、多条件 |
| Nested Loop | 嵌套循环 | 小表、有索引 |
| Hash Join | 哈希连接 | 大表、无索引 |
| Merge Join | 归并连接 | 已排序、有索引 |

学会看执行计划，才能找到 SQL 性能问题的根源。
