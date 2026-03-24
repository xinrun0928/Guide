# PostgreSQL 索引失效场景与 EXPLAIN 分析

索引建了，查询却跑不动？

明明有索引，EXPLAIN 却显示 Seq Scan？

索引失效是 PostgreSQL 开发中最常见的问题之一。

今天，我们来全面解析索引失效的场景，以及如何用 EXPLAIN 分析。

## 索引失效的常见场景

### 场景一：函数/表达式包裹索引列

```sql
-- 创建索引
CREATE INDEX idx_users_email ON users(email);

-- ❌ 失效：使用了函数
SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';

-- ❌ 失效：使用了表达式
SELECT * FROM users WHERE email || '@company.com' = 'alice@company.com';

-- ✅ 生效：直接使用列
SELECT * FROM users WHERE email = 'alice@example.com';

-- ✅ 生效：创建表达式索引
CREATE INDEX idx_users_email_lower ON users(LOWER(email));
SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';
```

### 场景二：类型转换

```sql
-- id 是 INTEGER 类型
CREATE INDEX idx_orders_id ON orders(id);

-- ❌ 失效：字符串与整数比较
SELECT * FROM orders WHERE id = '1';  -- '1' 是字符串

-- ✅ 生效：类型匹配
SELECT * FROM orders WHERE id = 1;  -- 1 是整数

-- ✅ 生效：显式转换
SELECT * FROM orders WHERE id = '1'::INTEGER;
```

### 场景三：LIKE 模式

```sql
-- 创建索引
CREATE INDEX idx_users_name ON users(name);

-- ✅ 生效：前缀匹配
SELECT * FROM users WHERE name LIKE 'Alice%';

-- ❌ 失效：后缀匹配
SELECT * FROM users WHERE name LIKE '%lice';

-- ❌ 失效：中间匹配
SELECT * FROM users WHERE name LIKE '%Ali%';

-- 解决方案：使用全文搜索或 trigram 索引
CREATE EXTENSION pg_trgm;
CREATE INDEX idx_users_name_trgm ON users USING GIN (name gin_trgm_ops);
SELECT * FROM users WHERE name LIKE '%Ali%';  -- 现在可以用索引
```

### 场景四：OR 条件

```sql
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_active ON users(active);

-- ❌ 可能失效：OR 连接不同列
SELECT * FROM users WHERE status = 'active' OR active = true;

-- PostgreSQL 可能选择全表扫描而不是两个索引的 OR

-- ✅ 优化方案：UNION
SELECT * FROM users WHERE status = 'active'
UNION
SELECT * FROM users WHERE active = true AND status != 'active';

-- ✅ 优化方案：重构查询
SELECT * FROM users WHERE COALESCE(status, '') = 'active' OR active = true;
```

### 场景五：IS NULL / IS NOT NULL

```sql
CREATE INDEX idx_users_email ON users(email);

-- ✅ 生效（部分数据库支持）
SELECT * FROM users WHERE email IS NULL;

-- ✅ 生效
SELECT * FROM users WHERE email IS NOT NULL;
-- 某些情况下可能选择全表扫描而不是索引扫描
```

### 场景六：数据分布不均

```sql
-- 假设 99% 的用户是 active=true，1% 是 active=false
CREATE INDEX idx_users_active ON users(active);

-- ❌ 失效：查询不常见值
SELECT * FROM users WHERE active = false;
-- PostgreSQL 可能认为全表扫描更快

-- ✅ 生效：查询常见值
SELECT * FROM users WHERE active = true;
-- 索引更可能被使用

-- ✅ 更好的方案：部分索引
CREATE INDEX idx_users_inactive ON users(created_at) WHERE active = false;
```

### 场景七：计算操作

```sql
CREATE INDEX idx_orders_total ON orders(total_amount);

-- ❌ 失效：计算操作
SELECT * FROM orders WHERE total_amount + 100 > 1000;

-- ✅ 生效：重构为范围查询
SELECT * FROM orders WHERE total_amount > 900;

-- ✅ 生效：表达式索引
CREATE INDEX idx_orders_total_plus ON orders(total_amount + 100);
SELECT * FROM orders WHERE total_amount + 100 > 1000;
```

### 场景八：NOT 操作

```sql
CREATE INDEX idx_users_status ON users(status);

-- ❌ 可能失效：NOT IN
SELECT * FROM users WHERE status NOT IN ('deleted', 'archived');

-- ❌ 可能失效：<> 操作符
SELECT * FROM users WHERE status <> 'deleted';

-- ✅ 替代方案：使用范围
SELECT * FROM users WHERE status < 'deleted' OR status > 'deleted';

-- ✅ 更好的方案：只索引有效数据
CREATE INDEX idx_users_active ON users(status) WHERE status != 'deleted';
```

## EXPLAIN 分析

### 基本用法

```sql
-- 查看执行计划（不执行）
EXPLAIN SELECT * FROM users WHERE email = 'alice@example.com';

-- 查看执行计划（实际执行）
EXPLAIN ANALYZE SELECT * FROM users WHERE email = 'alice@example.com';

-- 查看缓冲区信息
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM users WHERE email = 'alice@example.com';
```

### 常见操作类型

| 操作 | 说明 |
|------|------|
| Seq Scan | 全表扫描 |
| Index Scan | 索引扫描（需要回表） |
| Index Only Scan | 仅索引扫描（不回表） |
| Bitmap Scan | 位图扫描（先索引，再位图合并） |
| Nested Loop | 嵌套循环连接 |
| Hash Join | 哈希连接 |
| Merge Join | 归并连接 |
| Sort | 排序 |
| Aggregate | 聚合 |

### 示例分析

```sql
-- 创建一个慢查询
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM orders 
WHERE status = 'pending' 
  AND created_at > '2026-01-01'
ORDER BY created_at DESC;

-- 输出：
-- Index Scan using idx_orders_status_date on orders  (cost=0.42..8.44 rows=1 width=...)
--   Index Cond: (status = 'pending' AND created_at > '2026-01-01')
--   Filter: (status = 'pending')  -- 这个 Filter 说明...
-- Planning Time: 0.5 ms
-- Execution Time: 0.8 ms

-- 问题分析：
-- Index Cond 和 Filter 同时出现
-- 说明索引列的过滤不完整
```

### 解读成本

```
cost=0.42..8.44
      ↑    ↑
   启动成本  总成本
```

- **启动成本**：获取第一行的时间
- **总成本**：获取所有行的时间
- 单位：页面读取次数（假设 seq_page_cost = 1）

```
成本估算：
- 读取 1 个索引页面 + 读取 1 个数据页面 = cost 约 2.0
- 读取 10000 个页面 = cost 约 10000
```

## 常见问题诊断

### 问题一：为什么走 Seq Scan 而不是 Index Scan？

```sql
EXPLAIN SELECT * FROM users WHERE id > 100;

-- 输出：
-- Seq Scan on users  (cost=0.00..1234.00 rows=5678 width=...)
--   Filter: (id > 100)

-- 可能原因：
-- 1. 表太小，Sequential Scan 更快
-- 2. 统计信息不准确
-- 3. 查询范围太大
-- 4. 索引不适用

-- 解决方案：
-- 1. ANALYZE 更新统计信息
ANALYZE users;

-- 2. 查看表大小
SELECT pg_size_pretty(pg_relation_size('users'));

-- 3. 查看统计信息
SELECT * FROM pg_stats WHERE tablename = 'users';
```

### 问题二：为什么走了错误的索引？

```sql
-- 表有多个索引
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_name ON users(name);

-- 查询
EXPLAIN SELECT * FROM users WHERE name = 'Alice' AND email = 'alice@example.com';

-- 输出：
-- Index Scan using idx_users_email on users
--   Index Cond: (email = 'alice@example.com')
--   Filter: (name = 'Alice')

-- 问题：选择了 email 索引，但 name 的过滤可能更重要

-- 解决：强制使用特定索引
EXPLAIN SELECT * FROM users WHERE name = 'Alice' AND email = 'alice@example.com';
SET enable_indexscan = off;  -- 禁用索引扫描
```

### 问题三：Bitmap Scan 是什么？

```sql
EXPLAIN SELECT * FROM users WHERE status IN ('active', 'pending', 'processing');

-- 输出：
-- Bitmap Heap Scan on users
--   Recheck Cond: (status = ANY ('{active,pending,processing}'::text[]))
--   ->  Bitmap Index Scan on idx_users_status
--         Index Cond: (status = ANY ('{active,pending,processing}'::text[]))

-- Bitmap Scan 流程：
-- 1. 先用索引找出所有匹配的行，生成位图
-- 2. 再根据位图读取数据页面
-- 适合：返回多行的情况
```

### 问题四：Nested Loop vs Hash Join

```sql
EXPLAIN
SELECT * FROM orders o 
JOIN users u ON o.user_id = u.id 
WHERE u.country = 'China';

-- Nested Loop：适合小表 join 大表
-- Hash Join：适合两个大表的 join

-- 查看连接类型
EXPLAIN (FORMAT JSON)
SELECT * FROM orders o JOIN users u ON o.user_id = u.id;
```

## 强制使用索引

### 设置索引扫描

```sql
-- 启用/禁用索引扫描
SET enable_indexscan = on;   -- 默认
SET enable_indexscan = off;  -- 禁用

-- 启用/禁用顺序扫描
SET enable_seqscan = off;  -- 强制不使用 Seq Scan

-- 启用/禁用位图扫描
SET enable_bitmapscan = off;
```

### 强制使用特定索引

```sql
-- 使用 hint（PostgreSQL 不支持 Oracle 风格的 hint）
-- 但可以使用 CTE 重写查询

WITH indexed_orders AS (
    SELECT * FROM orders WHERE status = 'pending'
)
SELECT * FROM indexed_orders o
JOIN users u ON o.user_id = u.id;
```

## 统计信息与 ANALYZE

### 更新统计信息

```sql
-- 分析表
ANALYZE users;

-- 分析表和索引
ANALYZE VERBOSE users;

-- 自动 vacuum analyze
VACUUM ANALYZE users;
```

### 查看统计信息

```sql
-- 查看表统计信息
SELECT 
    relname,
    reltuples::BIGINT AS estimated_rows,
    relpages AS pages,
    pg_size_pretty(pg_relation_size(relid)) AS table_size
FROM pg_class
WHERE relname = 'users';

-- 查看列统计信息
SELECT 
    attname,
    n_distinct,           -- 不同值数量
    correlation,           -- 与物理顺序的相关性
    most_common_vals,      -- 最常见的值
    most_common_freqs      -- 频率
FROM pg_stats
WHERE tablename = 'users';
```

## 面试高频问题

### Q1: 什么情况下索引会失效？

**考察点**：索引原理

**参考答案**：
1. 使用函数或表达式包裹索引列
2. 类型不匹配
3. LIKE 模式不以前缀开头
4. OR 连接不同列的条件
5. 数据分布不均
6. NOT 操作（<>、NOT IN、NOT NULL）
7. 统计信息不准确

### Q2: 如何分析查询为什么走全表扫描？

**考察点**：问题排查

**参考答案**：
1. 使用 EXPLAIN 查看执行计划
2. 检查统计信息是否过期
3. 查看数据分布
4. 确认索引是否存在
5. 确认查询条件是否匹配索引

### Q3: EXPLAIN 输出中 Seq Scan 和 Index Scan 怎么选？

**考察点**：优化决策

**参考答案**：
- 小表：Seq Scan 可能更快
- 大表大部分行：Seq Scan 可能更快
- 查询范围小：Index Scan 更快
- 需要排序：Index Scan 更快

### Q4: Bitmap Scan 什么时候用？

**考察点**：执行计划理解

**参考答案**：
- 返回多行时
- 多条件 OR 查询
- 需要合并多个索引结果
- 大表的范围查询

## 总结

索引失效的常见原因：

| 场景 | 解决方案 |
|------|---------|
| 函数包裹 | 表达式索引 |
| 类型转换 | 确保类型一致 |
| LIKE 后缀 | 全文搜索或 trigram |
| OR 不同列 | UNION 或 IN |
| 分布不均 | 部分索引 |
| 统计信息不准 | ANALYZE |

使用 EXPLAIN 分析：
1. 查看操作类型（Seq Scan、Index Scan 等）
2. 理解成本估算
3. 识别 Filter 和 Index Cond
4. 根据实际情况优化
