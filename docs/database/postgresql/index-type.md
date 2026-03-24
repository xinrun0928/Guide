# PostgreSQL 索引类型：B-Tree、Hash、GIN、GiST、BRIN、Partial Index

MySQL 只有 B-Tree。

PostgreSQL 呢？

B-Tree、Hash、GIN、GiST、BRIN、Partial Index、Expression Index...

PostgreSQL 的索引体系，远比 MySQL 丰富。

今天，我们来全面了解 PostgreSQL 的索引类型。

## 索引类型概览

| 索引类型 | 底层结构 | 适用场景 |
|---------|---------|---------|
| B-Tree | B+ Tree | 默认，等值查询、范围查询 |
| Hash | 动态哈希表 | 仅等值查询，不支持范围 |
| GiST | R-Tree / 堆叠 B-Tree | 几何数据、全文搜索 |
| GIN | 倒排索引 | 数组、JSON、全文搜索 |
| BRIN | 块范围索引 | 物理顺序相关的大表 |
| Partial Index | 任意 | 条件索引 |
| Expression Index | 任意 | 计算列索引 |

## B-Tree 索引

### 默认索引

PostgreSQL 默认使用 B-Tree 索引，适用于大多数场景：

```sql
-- 创建 B-Tree 索引（默认）
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_orders_customer_date ON orders(customer_id, created_at DESC);

-- 查看索引类型
SELECT indexname, indexdef FROM pg_indexes 
WHERE tablename = 'users';
```

### B-Tree 支持的操作

```sql
-- 等值查询
SELECT * FROM users WHERE email = 'alice@example.com';

-- 范围查询
SELECT * FROM orders WHERE created_at BETWEEN '2026-01-01' AND '2026-03-31';

-- 前缀匹配
SELECT * FROM users WHERE name LIKE 'A%';

-- IS NULL 查询（有限支持）
SELECT * FROM users WHERE email IS NULL;
```

### 复合索引与最左前缀

复合索引 `(a, b, c)` 支持：

```
✅ WHERE a = ? 
✅ WHERE a = ? AND b = ?
✅ WHERE a = ? AND b = ? AND c = ?
❌ WHERE b = ?
❌ WHERE c = ?
```

```sql
-- 复合索引
CREATE INDEX idx_orders_cid_status_date ON orders (customer_id, status, created_at);

-- 查询会用索引
SELECT * FROM orders WHERE customer_id = 1;
SELECT * FROM orders WHERE customer_id = 1 AND status = 'pending';
SELECT * FROM orders WHERE customer_id = 1 AND status = 'pending' AND created_at > '2026-01-01';

-- 查询不会用索引
SELECT * FROM orders WHERE status = 'pending';  -- 跳过了 customer_id
SELECT * FROM orders WHERE created_at > '2026-01-01';  -- 跳过了前两列
```

## Hash 索引

### 适用场景

Hash 索引只支持等值查询，不支持范围查询，但等值查询性能更高：

```sql
-- 创建 Hash 索引
CREATE INDEX idx_users_session_hash ON users USING HASH (session_token);

-- 只支持等值查询
SELECT * FROM users WHERE session_token = 'abc123';

-- 不支持范围查询
SELECT * FROM users WHERE session_token > 'abc';  -- 不会用 Hash 索引
```

### Hash 索引的限制

```sql
-- Hash 索引不能用于：
-- 1. 范围查询
-- 2. 排序
-- 3. 前缀匹配

-- Hash 索引不能跨平台使用
-- （PostgreSQL 9.0 之前的 Hash 索引存储格式可能不兼容）
```

### 什么时候用 Hash？

```sql
-- 适合：超大数据量的等值查询
-- 如：session 表、token 表、唯一标识符查询

-- 不适合：大部分场景用 B-Tree 就够了
```

## GIN 索引

### 适用场景

GIN（Generalized Inverted Index）适合：
- 数组元素查询
- JSON/JSONB 全文搜索
- 文档搜索

### 数组索引

```sql
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    tags TEXT[]  -- 标签数组
);

-- 为数组字段创建 GIN 索引
CREATE INDEX idx_products_tags ON products USING GIN (tags);

-- 查询数组包含指定元素
SELECT * FROM products WHERE tags @> ARRAY['electronics'];
SELECT * FROM products WHERE tags && ARRAY['electronics', 'sale'];
SELECT * FROM products WHERE tags ? 'electronics';
```

### JSON/JSONB 索引

```sql
CREATE TABLE app_config (
    id SERIAL PRIMARY KEY,
    config JSONB
);

-- 为 JSONB 创建 GIN 索引
CREATE INDEX idx_app_config ON app_config USING GIN (config);

-- 查询 JSON 字段
SELECT * FROM app_config WHERE config @> '{"theme": "dark"}';
SELECT * FROM app_config WHERE config ? 'theme';
SELECT * FROM app_config WHERE config ?| array['theme', 'language'];
```

### 全文搜索索引

```sql
-- 详见 fulltext.md
-- GIN 索引可以加速全文搜索
CREATE INDEX idx_articles_content ON articles USING GIN (to_tsvector('english', content));
```

## GiST 索引

### 适用场景

GiST（Generalized Search Tree）适合：
- 几何类型（点、线、面）
- 范围类型
- 全文搜索（非 GIN）

### 几何索引

```sql
CREATE TABLE locations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    coord POINT  -- 坐标点
);

-- 为几何字段创建 GiST 索引
CREATE INDEX idx_locations_coord ON locations USING GIST (coord);

-- 查找附近的位置
SELECT * FROM locations 
WHERE coord <-> point(116.4, 39.9) < 0.1  -- 距离某点 0.1 度以内
ORDER BY coord <-> point(116.4, 39.9)
LIMIT 10;
```

### 范围类型索引

```sql
CREATE TABLE reservations (
    id SERIAL PRIMARY KEY,
    room_id INT,
    period TSRANGE
);

-- 为范围类型创建 GiST 索引
CREATE INDEX idx_reservations_period ON reservations USING GIST (period);

-- 查找时间段重叠的预订
SELECT * FROM reservations 
WHERE period && '[2026-03-20 14:00, 2026-03-20 16:00)';
```

## BRIN 索引

### 适用场景

BRIN（Block Range Index）专为物理顺序相关的大表设计：

```
表数据按插入顺序存储（通常按时间）
┌──────────────────────────────────────┐
│ Page 1: rows 1-1000 (2025-01-01)    │
│ Page 2: rows 1001-2000 (2025-01-02) │
│ Page 3: rows 2001-3000 (2025-01-03) │
│ ...                                  │
│ Page 10000: rows 9999000-10000000    │
└──────────────────────────────────────┘

BRIN 索引存储每个 Block Range 的统计信息：
┌────────────────────────┐
│ Range 1: min_id=1, max_id=1000, min_date=2025-01-01, max_date=2025-01-01 │
│ Range 2: min_id=1001, max_id=2000, min_date=2025-01-02, max_date=2025-01-02 │
└────────────────────────┘
```

### 创建 BRIN 索引

```sql
-- 假设 orders 表按时间顺序插入
CREATE INDEX idx_orders_created_at_brin ON orders USING BRIN (created_at);

-- 适合超大型表（TB 级别）
-- 比 B-Tree 索引小得多（通常只有几 KB）
```

### BRIN vs B-Tree

| 特性 | B-Tree | BRIN |
|------|--------|------|
| 索引大小 | 较大（与数据量成正比） | 极小（与块范围数成正比） |
| 适用场景 | 随机插入 | 顺序插入 |
| 查询性能 | O(log n) | O(n/r)，r = 块范围数 |
| 维护开销 | 较高（插入需要更新索引） | 极低 |

### BRIN 参数

```sql
-- 自定义块范围大小
CREATE INDEX idx_orders_created_brin ON orders 
USING BRIN (created_at) WITH (pages_per_range = 128);

-- pages_per_range: 每个范围包含的页面数
-- 越大索引越小，但查询可能更慢
```

## Partial Index（部分索引）

### 什么是部分索引

部分索引只为满足特定条件的行创建：

```sql
-- 普通索引：索引所有行
CREATE INDEX idx_orders_status ON orders(status);

-- 部分索引：只索引 status = 'pending' 的行
CREATE INDEX idx_orders_pending ON orders(created_at) WHERE status = 'pending';
```

### 部分索引的优势

1. **更小**：只索引满足条件的行
2. **更快**：查询匹配条件时使用
3. **更强**：可以添加 B-Tree 不支持的 WHERE 条件

### 实际应用

```sql
-- 场景 1：活跃用户的邮箱索引
CREATE INDEX idx_users_active_email ON users(email) WHERE active = true;

-- 查询：只用索引找活跃用户
SELECT * FROM users WHERE email = 'alice@example.com' AND active = true;

-- 查询：查找非活跃用户（走全表扫描）
SELECT * FROM users WHERE email = 'alice@example.com' AND active = false;


-- 场景 2：近期订单的索引
CREATE INDEX idx_orders_recent ON orders(customer_id, created_at) 
WHERE created_at > NOW() - INTERVAL '90 days';

-- 查询近期订单用索引
SELECT * FROM orders 
WHERE customer_id = 1 AND created_at > '2026-01-01';

-- 查询历史订单走全表扫描


-- 场景 3：唯一部分索引
CREATE UNIQUE INDEX idx_users_active_email_unique ON users(email) WHERE active = true;

-- 允许非活跃用户有重复邮箱
INSERT INTO users (email, active) VALUES ('dup@example.com', false);
INSERT INTO users (email, active) VALUES ('dup@example.com', false);

-- 不允许活跃用户有重复邮箱
INSERT INTO users (email, active) VALUES ('unique@example.com', true);  -- OK
INSERT INTO users (email, active) VALUES ('unique@example.com', true);  -- ERROR
```

## Expression Index（表达式索引）

### 什么是表达式索引

表达式索引为表达式或函数结果创建索引：

```sql
-- 为小写邮箱创建索引
CREATE INDEX idx_users_email_lower ON users(LOWER(email));

-- 查询时自动使用索引
SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';

-- 直接查不会用索引
SELECT * FROM users WHERE email = 'Alice@example.com';
```

### 实际应用

```sql
-- 场景 1：函数索引
CREATE INDEX idx_orders_year ON orders(EXTRACT(YEAR FROM created_at));

SELECT * FROM orders WHERE EXTRACT(YEAR FROM created_at) = 2026;


-- 场景 2：计算列索引
CREATE INDEX idx_users_fullname ON users((first_name || ' ' || last_name));

SELECT * FROM users WHERE first_name || ' ' || last_name = 'John Doe';


-- 场景 3：JSON 路径索引（PostgreSQL 12+）
CREATE INDEX idx_users_prefs_theme ON users(((preferences->>'theme')));

SELECT * FROM users WHERE (preferences->>'theme') = 'dark';
```

## 索引创建语法

```sql
-- 基本语法
CREATE INDEX idx_name ON table_name (column);

-- 指定索引类型
CREATE INDEX idx_name ON table_name USING GIN (column);

-- 多列索引
CREATE INDEX idx_name ON table_name (col1, col2, col3);

-- 唯一索引
CREATE UNIQUE INDEX idx_name ON table_name (column);

-- 部分索引
CREATE INDEX idx_name ON table_name (column) WHERE condition;

-- 表达式索引
CREATE INDEX idx_name ON table_name (expression);

-- 索引并行创建（不影响并发读写）
CREATE INDEX CONCURRENTLY idx_name ON table_name (column);

-- 重命名索引
ALTER INDEX idx_name RENAME TO new_idx_name;

-- 删除索引
DROP INDEX idx_name;
```

## 索引维护

```sql
-- 查看索引使用情况
SELECT 
    schemaname,
    relname,
    indexrelname,
    idx_scan,      -- 索引扫描次数
    idx_tup_read,  -- 索引返回的行数
    idx_tup_fetch  -- 索引实际获取的行数
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- 查看未使用的索引
SELECT 
    schemaname,
    relname,
    indexrelname,
    idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
AND schemaname = 'public';

-- 查看表大小和索引大小
SELECT 
    relname,
    pg_size_pretty(pg_relation_size(relid)) AS table_size,
    pg_size_pretty(pg_indexes_size(relid)) AS index_size
FROM pg_stat_user_tables
WHERE schemaname = 'public';

-- 重建索引
REINDEX INDEX idx_name;
REINDEX TABLE table_name;
```

## 面试高频问题

### Q1: PostgreSQL 有哪些索引类型？

**考察点**：知识广度

**参考答案**：
- B-Tree：默认，最通用
- Hash：等值查询，不支持范围
- GIN：数组、JSON、全文搜索
- GiST：几何、范围、全文搜索
- BRIN：大表、顺序数据
- Partial Index：条件索引
- Expression Index：表达式索引

### Q2: GIN 和 GiST 的区别是什么？

**考察点**：索引原理

**参考答案**：
- GIN：倒排索引，适合多值类型（数组、JSON）
- GiST：通用搜索树，适合范围和几何查询
- GIN 适合「包含」查询，GiST 适合「重叠」查询

### Q3: 什么时候用 BRIN 而不是 B-Tree？

**考察点**：索引选型

**参考答案**：
- BRIN 适合物理顺序相关的大表（如按时间插入的日志表）
- B-Tree 适合随机插入的数据
- BRIN 索引极小，但查询可能扫描更多页面

### Q4: 部分索引有什么优势？

**考察点**：索引优化

**参考答案**：
1. 更小：只索引需要的行
2. 更快：查询匹配条件时使用
3. 灵活：可以添加 WHERE 条件
4. 场景：活跃用户、近期数据、唯一约束

## 总结

PostgreSQL 的索引类型非常丰富：

| 类型 | 适用场景 | 索引大小 |
|------|---------|---------|
| B-Tree | 默认选择 | 中等 |
| Hash | 大数据等值查询 | 中等 |
| GIN | 数组、JSON | 较大 |
| GiST | 几何、范围 | 中等 |
| BRIN | 大表顺序数据 | 极小 |
| Partial | 条件过滤 | 小 |
| Expression | 函数结果 | 中等 |

选择正确的索引类型，可以让查询性能提升数十倍甚至百倍。
