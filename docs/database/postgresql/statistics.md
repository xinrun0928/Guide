# PostgreSQL 统计信息与成本估算模型

为什么 PostgreSQL 选择 Seq Scan 而不是 Index Scan？

为什么同样的查询，昨天快，今天慢？

答案藏在统计信息里。

今天，我们来深入理解 PostgreSQL 的统计信息和成本估算模型。

## 统计信息是什么？

### 为什么需要统计信息

```
执行计划生成过程：

1. 解析 SQL → 解析树
         ↓
2. 重写规则 → 重写树
         ↓
3. 生成执行计划 ← 需要估算代价
         ↓
4. 选择最优计划

统计信息的作用：帮助估算每种执行计划的代价
```

### PostgreSQL 维护的统计信息

```sql
-- 查看表统计信息
SELECT * FROM pg_class WHERE relname = 'orders';

-- 查看列统计信息
SELECT * FROM pg_stats WHERE tablename = 'orders';

-- 查看索引统计信息
SELECT * FROM pg_stat_user_indexes WHERE relname = 'orders';
```

## pg_stats 表详解

### 常用字段

```sql
SELECT 
    schemaname,         -- 模式名
    tablename,          -- 表名
    attname,            -- 列名
    inherited,          -- 是否继承
    null_frac,         -- 空值比例
    avg_width,          -- 平均宽度（字节）
    n_distinct,        -- 不同值数量（负数表示估算比例）
    most_common_vals,  -- 最常见的值
    most_common_freqs,  -- 最常见值的频率
    histogram_bounds,  -- 直方图边界
    correlation,        -- 与物理顺序的相关性
    most_common_elems,  -- 最常见数组元素
    most_common_elem_freqs,  -- 最常见数组元素频率
    elem_count_histogram  -- 数组元素计数直方图
FROM pg_stats
WHERE tablename = 'orders'
AND attname = 'status';
```

### 示例输出

```
attname: status
null_frac: 0.0
avg_width: 10
n_distinct: 5
most_common_vals: {pending,processing,shipped,delivered,cancelled}
most_common_freqs: {0.4,0.3,0.15,0.1,0.05}
histogram_bounds: {pending,processing,shipped,delivered,cancelled}
correlation: 0.85
```

## 统计信息详解

### 1. 空值比例（null_frac）

```sql
-- 查看空值比例
SELECT attname, null_frac 
FROM pg_stats 
WHERE tablename = 'orders';

-- 影响：
-- - 估算返回行数时考虑空值
-- - IS NULL 查询可以利用此信息
```

### 2. 不同值数量（n_distinct）

```sql
-- 查看不同值数量
SELECT attname, n_distinct 
FROM pg_stats 
WHERE tablename = 'orders';

-- n_distinct > 0：绝对数量
-- n_distinct < 0：比例（如 -0.5 表示约 50% 的行是不同值）

-- 高选择性列
SELECT attname, n_distinct 
FROM pg_stats 
WHERE tablename = 'orders'
ORDER BY n_distinct DESC;
-- 适合建索引
```

### 3. 直方图（histogram_bounds）

```sql
-- 查看直方图
SELECT attname, histogram_bounds 
FROM pg_stats 
WHERE tablename = 'orders'
AND attname = 'created_at';

-- 输出示例：
-- {2024-01-01,2024-01-15,2024-02-01,2024-02-15,2024-03-01}
-- 表示数据均匀分布在这 5 个边界点之间
```

### 4. 最常见值（most_common_vals）

```sql
-- 查看最常见值
SELECT attname, most_common_vals, most_common_freqs
FROM pg_stats 
WHERE tablename = 'orders'
AND attname = 'status';

-- 输出：
-- most_common_vals: {pending, processing, completed}
-- most_common_freqs: {0.4, 0.3, 0.2}

-- 影响：
-- - 估算过滤条件返回的行数
-- - 偏向选择高频率的值
```

### 5. 相关性（correlation）

```sql
-- 查看物理顺序相关性
SELECT attname, correlation 
FROM pg_stats 
WHERE tablename = 'orders'
AND attname = 'created_at';

-- correlation 接近 1 或 -1：数据有序
-- correlation 接近 0：数据无序

-- 影响 BRIN 索引的选择
-- correlation = 0.9 → BRIN 索引效果好
-- correlation = 0.1 → BRIN 索引效果差
```

## 统计信息收集

### 自动收集（Autovacuum）

```sql
-- autovacuum 自动分析表
-- 触发条件：
-- - 表行数变化超过 autovacuum_analyze_threshold
-- - 或变化超过 autovacuum_analyze_scale_factor * 表行数

SHOW autovacuum_analyze_threshold;     -- 默认 50
SHOW autovacuum_analyze_scale_factor;  -- 默认 0.1（10%）

-- 查看上次分析时间
SELECT 
    relname,
    last_analyze,
    last_autoanalyze,
    n_live_tup,
    n_dead_tup
FROM pg_stat_user_tables
WHERE relname = 'orders';
```

### 手动收集

```sql
-- ANALYZE：只收集统计信息
ANALYZE orders;
ANALYZE VERBOSE orders;

-- VACUUM ANALYZE：清理 + 收集统计信息
VACUUM ANALYZE orders;

-- ANALYZE 特定列
ANALYZE orders (status, created_at);
```

### ANALYZE vs ANALYZE VERBOSE

```sql
-- 普通 ANALYZE
ANALYZE orders;

-- 详细输出
ANALYZE VERBOSE orders;

-- 输出示例：
-- INFO:  analyzing "public.orders"
-- INFO:  "orders": scanned 123 of 456 pages, containing 12345 live rows and 67 dead rows
-- INFO:  "orders": 5 most common values of status
-- INFO:  "orders": 123 distinct values of created_at estimated
-- INFO:  analyzing "public.orders" completed
```

## 成本估算模型

### 成本参数

```sql
-- 查看成本参数
SHOW seq_page_cost;        -- 顺序页面读取成本：1.0
SHOW random_page_cost;     -- 随机页面读取成本：4.0
SHOW cpu_tuple_cost;       -- 每行 CPU 成本：0.01
SHOW cpu_index_tuple_cost; -- 索引行 CPU 成本：0.005
SHOW cpu_operator_cost;    -- 操作符 CPU 成本：0.0025
SHOW parallel_tuple_cost;  -- 并行行传输成本：0.1
SHOW min_parallel_table_scan_size;  -- 并行扫描最小表大小：8MB
SHOW min_parallel_index_scan_size;  -- 并行索引扫描最小大小：512KB
```

### 成本计算公式

```
Seq Scan 成本 = pages * seq_page_cost + rows * cpu_tuple_cost

Index Scan 成本 = 
    index_pages * random_page_cost + 
    heap_pages * random_page_cost + 
    index_rows * cpu_index_tuple_cost + 
    heap_rows * cpu_tuple_cost

Index Only Scan 成本 = 
    index_pages * random_page_cost + 
    index_rows * cpu_index_tuple_cost
```

### 实际例子

```sql
-- 表有 10000 行，100 个页面
-- 索引有 50 个页面

-- Seq Scan 成本估算：
-- cost = 100 * 1.0 + 10000 * 0.01 = 100 + 100 = 200

-- Index Scan 成本估算（假设 10% 数据匹配）：
-- cost = 50 * 4.0 + 1000 * 4.0 + 1000 * 0.005 + 1000 * 0.01
-- cost = 200 + 4000 + 5 + 10 = 4215

-- 结论：Seq Scan 更便宜，PostgreSQL 选择它
```

## 调整成本参数

### SSD 服务器优化

```sql
-- SSD：随机读取和顺序读取差别不大
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET seq_page_cost = 1.0;

-- 重新加载配置
SELECT pg_reload_conf();

-- 验证
SHOW random_page_cost;
```

### 内存服务器优化

```sql
-- 大内存：降低 CPU 成本
ALTER SYSTEM SET cpu_tuple_cost = 0.001;
ALTER SYSTEM SET cpu_index_tuple_cost = 0.0005;
```

## 统计信息不准确的问题

### 问题现象

```sql
-- 估算行数 vs 实际行数差距大
EXPLAIN SELECT * FROM orders WHERE status = 'pending';

-- 输出：
-- Index Scan using idx_orders_status on orders
--   Index Cond: (status = 'pending')
--   Rows Removed by Index Recheck: 500  -- 重检查删除了 500 行！
```

### 问题原因

```sql
-- 1. 统计信息过期
SELECT relname, last_analyze, n_live_tup 
FROM pg_stat_user_tables 
WHERE relname = 'orders';

-- 2. 数据分布变化
-- 大批量 INSERT/UPDATE 后统计信息未更新

-- 3. 多表 JOIN 估算不准
```

### 解决方案

```sql
-- 1. 手动 ANALYZE
ANALYZE orders;

-- 2. 增加统计目标
ALTER TABLE orders 
ALTER COLUMN status SET STATISTICS 500;

ANALYZE orders;

-- 3. 增加 autovacuum 频率
ALTER SYSTEM SET autovacuum_analyze_scale_factor = 0.05;

-- 4. 使用 CREATE STATISTICS 收集多列统计
CREATE STATISTICS order_status_stats (dependencies)
ON status, created_at
FROM orders;

ANALYZE orders;
```

## 多列统计信息

### 创建多列统计

```sql
-- 创建依赖统计
CREATE STATISTICS order_status_date_stats (dependencies)
ON status, created_at
FROM orders;

-- 创建功能依赖统计
CREATE STATISTICS order_func_stats (functional_dependencies)
ON date_trunc('month', created_at), status
FROM orders;

-- 创建 MCV 列表
CREATE STATISTICS order_mcv_stats (mcv)
ON status, created_at
FROM orders;

-- 收集统计信息
ANALYZE orders;
```

### 查看多列统计

```sql
-- 查看统计对象
SELECT * FROM pg_statistic_ext;

-- 查看统计结果
SELECT * FROM pg_statistic_ext_statistic
WHERE stxname IN ('order_status_stats', 'order_func_stats');
```

## 面试高频问题

### Q1: PostgreSQL 如何估算返回行数？

**考察点**：统计信息原理

**参考答案**：
1. 基于 pg_stats 中的直方图、最常见值、空值比例
2. 使用选择度公式计算
3. 选择度 * 总行数 = 估算返回行数

### Q2: 为什么执行计划在表数据变化后变差？

**考察点**：统计信息理解

**参考答案**：
1. autovacuum 没有及时分析表
2. 统计信息基于旧数据
3. 解决方案：手动 ANALYZE 或调整 autovacuum 参数

### Q3: 如何提高统计信息准确性？

**考察点**：优化实践

**参考答案**：
1. 增加统计目标：`ALTER TABLE ... SET STATISTICS 500`
2. 创建多列统计：`CREATE STATISTICS`
3. 定期手动 ANALYZE
4. 调整 autovacuum 参数

### Q4: 成本参数如何调整？

**考察点**：成本模型理解

**参考答案**：
1. SSD：`random_page_cost` 降低到 1.1
2. 内存充足：`cpu_tuple_cost` 可以降低
3. 并行查询：`parallel_tuple_cost` 影响并行度选择

## 总结

统计信息是 PostgreSQL 生成执行计划的基础：

| 统计信息 | 说明 | 影响 |
|---------|------|------|
| n_distinct | 不同值数量 | 选择性估算 |
| most_common_vals | 最常见值 | 过滤估算 |
| histogram_bounds | 直方图 | 范围查询估算 |
| null_frac | 空值比例 | NULL 查询估算 |
| correlation | 物理顺序相关性 | 索引选择 |

成本估算 = I/O 成本 + CPU 成本

优化统计信息是提升查询性能的重要手段。
