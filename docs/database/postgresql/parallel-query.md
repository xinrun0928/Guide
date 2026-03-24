# PostgreSQL 并行查询与多核利用

你的服务器有 64 核。

但你的查询只用 1 核。

为什么？

今天，我们来聊聊 PostgreSQL 的并行查询。

## 并行查询基础

### PostgreSQL 为什么需要并行查询

```
传统查询（单进程）：
┌─────────────────────────────────────┐
│           CPU 使用率                  │
│                                     │
│  核心 1: ████████████████████ 100% │
│  核心 2: ░░░░░░░░░░░░░░░░░░░░░  0%  │
│  核心 3: ░░░░░░░░░░░░░░░░░░░░░  0%  │
│  ...                                │
│  核心 64: ░░░░░░░░░░░░░░░░░░░░░ 0%  │
└─────────────────────────────────────┘

并行查询（多进程）：
┌─────────────────────────────────────┐
│           CPU 使用率                  │
│                                     │
│  核心 1: ████████░░░░░░░░░░░░░  40% │
│  核心 2: ████████░░░░░░░░░░░░░  40% │
│  核心 3: ████████░░░░░░░░░░░░░  40% │
│  ...                                │
│  核心 64: ████████░░░░░░░░░░░░  40% │
└─────────────────────────────────────┘
```

### 并行查询流程

```
并行 Seq Scan 流程：

┌─────────────────────────────────────────────────────┐
│                  Gather                              │
│         (收集所有 Worker 的结果)                       │
└─────────────────┬───────────────────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    ↓             ↓             ↓
┌────────┐  ┌────────┐  ┌────────┐
│Worker 1│  │Worker 2│  │Worker 3│
│扫描1/4  │  │扫描1/4  │  │扫描1/4  │
└────────┘  └────────┘  └────────┘
    ↓             ↓             ↓
┌────────┐  ┌────────┐  ┌────────┐
│Page 1-25│  │Page 26-50│  │Page 51-75│
└────────┘  └────────┘  └────────┘
```

## 并行查询配置

### 参数配置

```sql
-- 查看并行查询相关参数
SHOW max_parallel_workers_per_gather;  -- 每个 Gather 节点的最大 Worker 数

-- 默认值：2（PostgreSQL 9.6+）

-- 设置最大 Worker 数
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;

-- 查看所有并行相关参数
SHOW max_parallel_workers;           -- 全局最大并行 Worker 数
SHOW max_worker_processes;          -- 最大后台进程数
SHOW min_parallel_table_scan_size;  -- 触发并行扫描的最小表大小
SHOW min_parallel_index_scan_size;   -- 触发并行索引扫描的最小大小
```

### 推荐配置

```ini
# postgresql.conf

# 并行 Worker 配置
max_worker_processes = 16           # 通常等于 CPU 核心数
max_parallel_workers = 8            # 全局最大并行 Worker
max_parallel_workers_per_gather = 4 # 每个查询最大并行度

# 影响并行决策的参数
min_parallel_table_scan_size = 8MB  # 默认 8MB
min_parallel_index_scan_size = 512MB # 默认 512MB（较大值减少索引并行）
parallel_tuple_cost = 0.1           # 行传输成本（越小越容易并行）
parallel_setup_cost = 1000.0        # 并行启动成本（越大越不容易并行）
```

## 并行查询类型

### 1. Parallel Seq Scan（并行顺序扫描）

```sql
-- 查看执行计划
EXPLAIN SELECT * FROM orders WHERE total_amount > 1000;

-- 输出：
-- Gather
--   Workers Planned: 4
--   ->  Parallel Seq Scan on orders
--         Filter: (total_amount > 1000)
```

### 2. Parallel Index Scan（并行索引扫描）

```sql
EXPLAIN SELECT * FROM orders WHERE customer_id = 100;

-- 输出：
-- Gather
--   Workers Planned: 4
--   ->  Parallel Index Scan using idx_orders_customer on orders
--         Index Cond: (customer_id = 100)
```

### 3. Parallel Bitmap Scan（并行位图扫描）

```sql
EXPLAIN SELECT * FROM orders WHERE status IN ('pending', 'processing');

-- 输出：
-- Gather
--   Workers Planned: 4
--   ->  Parallel Bitmap Heap Scan on orders
--         Recheck Cond: ...
--         ->  Bitmap Index Scan on idx_orders_status
```

### 4. Parallel Hash Join（并行哈希连接）

```sql
EXPLAIN SELECT * FROM orders o
JOIN customers c ON o.customer_id = c.id
WHERE o.total_amount > 1000;

-- 输出：
-- Gather
--   Workers Planned: 4
--   ->  Parallel Hash Join
--         Hash Cond: (o.customer_id = c.id)
--         ->  Parallel Seq Scan on orders o
--         ->  Hash
--               ->  Parallel Seq Scan on customers c
```

### 5. Parallel Aggregate（并行聚合）

```sql
EXPLAIN SELECT COUNT(*), AVG(total_amount) FROM orders;

-- 输出：
-- Gather
--   Workers Planned: 4
--   ->  Parallel Aggregate
--         Aggregate: count(*), avg(total_amount)
```

## 影响并行查询的因素

### 1. 表大小

```sql
-- min_parallel_table_scan_size 控制触发并行的最小表大小
SHOW min_parallel_table_scan_size;  -- 默认 8MB

-- 大于 8MB 的表可能触发并行
-- 每增加 4 倍大小，并行度增加 1

-- 8MB   → 1 worker
-- 32MB  → 2 workers
-- 128MB → 3 workers
-- 512MB → 4 workers (max_parallel_workers_per_gather)
```

### 2. 成本估算

```sql
-- 成本参数影响并行决策
SHOW parallel_tuple_cost;    -- 默认 0.1
SHOW parallel_setup_cost;    -- 默认 1000.0

-- 如果并行成本 < 串行成本，选择并行
-- parallel_setup_cost 是启动成本（创建进程的开销）
-- parallel_tuple_cost 是每行传输成本
```

### 3. max_parallel_workers_per_gather

```sql
-- 强制单个查询的并行度
SHOW max_parallel_workers_per_gather;

-- 禁用特定查询的并行
EXPLAIN SELECT * FROM orders;  -- 可能并行

SET max_parallel_workers_per_gather = 0;
EXPLAIN SELECT * FROM orders;  -- 不并行
```

### 4. 索引与 Hint

```sql
-- 索引可能导致不使用并行
-- 例如：索引覆盖查询，可能直接走 Index Only Scan

-- 强制使用并行（PostgreSQL 不支持 Hint）
-- 但可以通过调整参数影响决策
SET parallel_tuple_cost = 0;
SET parallel_setup_cost = 0;
EXPLAIN SELECT * FROM orders WHERE total_amount > 1000;
```

## 常见问题

### 问题一：并行查询不生效

```sql
-- 检查 1：并行度是否被禁用
SHOW max_parallel_workers_per_gather;  -- 应该 > 0

-- 检查 2：表是否太小
SHOW min_parallel_table_scan_size;
SELECT pg_size_pretty(pg_relation_size('orders'));

-- 检查 3：成本估算是否正确
EXPLAIN ANALYZE SELECT * FROM orders WHERE total_amount > 1000;

-- 检查 4：是否有阻止并行的因素
-- 例如：查询包含函数、触发器、子查询等
```

### 问题二：并行度过高

```sql
-- 降低全局最大并行度
ALTER SYSTEM SET max_parallel_workers_per_gather = 2;

-- 为特定会话设置
SET max_parallel_workers_per_gather = 2;

-- 查看当前并行度
EXPLAIN SELECT * FROM orders;
```

### 问题三：并行查询反而更慢

```sql
-- 原因：表太小，并行开销大于收益

-- 解决方案：禁用小表的并行
SET max_parallel_workers_per_gather = 0;
SELECT * FROM small_table;

-- 或者使用 ALTER TABLE 设置
ALTER TABLE small_table SET (parallel_workers = 0);
```

## Java 应用中的并行查询

### 设置连接参数

```java
@Configuration
public class ParallelQueryConfig {
    
    @Bean
    public DataSource dataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://localhost:5432/mydb");
        
        // 每个连接可以有自己的并行度设置
        config.addDataSourceProperty("options", "-c max_parallel_workers_per_gather=4");
        
        return new HikariDataSource(config);
    }
}
```

### OLAP vs OLTP

```java
// OLAP 查询（分析型）：适合并行
String olapQuery = """
    SELECT 
        DATE_TRUNC('month', created_at) AS month,
        COUNT(*) AS order_count,
        SUM(total_amount) AS total_revenue
    FROM orders
    GROUP BY DATE_TRUNC('month', created_at)
    """;

// OLTP 查询（事务型）：不适合并行
String oltpQuery = """
    SELECT * FROM orders 
    WHERE id = ?
    """;
```

## 监控并行查询

### 查看并行 Worker 状态

```sql
-- 查看并行查询统计
SELECT 
    query,
    parallel_workers_launched,
    parallel_workers_dead,
    parallel_workers_died
FROM pg_stat_statements
WHERE parallel_workers_launched > 0
ORDER BY parallel_workers_launched DESC;
```

### 查看当前并行查询

```sql
-- 查看正在运行的并行查询
SELECT 
    pid,
    query,
    state,
    parallel_worker_active,
    wait_event_type,
    wait_event
FROM pg_stat_activity
WHERE state = 'active'
AND parallel_worker_active = true;

-- 查看并行查询的 Worker 进程
SELECT 
    l.pid,
    l.relation::REGCLASS,
    l.mode,
    l.granted
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE a.parallel_worker_active = true;
```

## 面试高频问题

### Q1: PostgreSQL 并行查询的原理是什么？

**考察点**：并行查询原理

**参考答案**：
- 使用多个 Worker 进程并行执行查询
- 主进程（Gather）收集 Worker 结果
- 适用于 Seq Scan、Index Scan、Hash Join、Aggregate 等

### Q2: 什么情况下不会使用并行查询？

**考察点**：并行查询限制

**参考答案**：
1. 小表（小于 `min_parallel_table_scan_size`）
2. 查询包含不支持并行的操作（触发器、函数等）
3. `max_parallel_workers_per_gather = 0`
4. 成本估算认为串行更快

### Q3: 如何优化并行查询？

**考察点**：性能调优

**参考答案**：
1. 合理设置 `max_parallel_workers_per_gather`
2. 调整 `parallel_tuple_cost` 和 `parallel_setup_cost`
3. 为大表增加 `parallel_workers`
4. 避免对支持并行的列使用函数

### Q4: 并行查询有什么开销？

**考察点**：并行查询成本

**参考答案**：
1. 进程创建开销（`parallel_setup_cost`）
2. 数据传输开销（`parallel_tuple_cost`）
3. 结果合并开销
4. 对于小表或简单查询，并行可能更慢

## 总结

并行查询是 PostgreSQL 利用多核的利器：

| 参数 | 说明 | 推荐值 |
|------|------|-------|
| max_worker_processes | 最大进程数 | CPU 核心数 |
| max_parallel_workers | 全局最大并行 Worker | CPU 核心数的一半 |
| max_parallel_workers_per_gather | 每查询最大并行度 | 4-8 |
| min_parallel_table_scan_size | 触发并行的最小表大小 | 8MB |
| parallel_tuple_cost | 行传输成本 | 0.1 |

适用场景：
- 大表扫描
- 大表 JOIN
- 聚合运算
- 分析型查询

不适用的场景：
- 小表查询
- 简单 OLTP 查询
- 单行查询
- 有锁等待的查询
