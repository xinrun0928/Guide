# PostgreSQL 慢查询分析与 pg_stat_statements

你的数据库突然变慢了。

没有改代码，没有加数据，接口响应时间从 50ms 飙升到 5s。

怎么查？

今天，我们来聊聊 PostgreSQL 的慢查询分析方法。

## 慢查询定位

### 1. 开启慢查询日志

```sql
-- 开启慢查询日志
ALTER SYSTEM SET log_min_duration_statement = 1000;  -- 超过 1 秒记录

-- 或者在 postgresql.conf 中设置
-- log_min_duration_statement = 1000

-- 查看当前设置
SHOW log_min_duration_statement;
```

### 2. 查看日志文件

```bash
# 日志位置（默认）
tail -f /var/log/postgresql/postgresql-*-main.log

# 筛选慢查询
grep "duration:" /var/log/postgresql/postgresql-*-main.log
```

### 3. 使用 pg_stat_statements

```sql
-- 安装扩展
CREATE EXTENSION pg_stat_statements;

-- 查看最慢的查询
SELECT 
    query,
    calls,
    total_exec_time / 1000 AS total_seconds,
    mean_exec_time AS avg_ms,
    rows,
    shared_blks_hit,
    shared_blks_read
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

### 4. 查看查询频率

```sql
-- 查看最频繁的查询
SELECT 
    query,
    calls,
    total_exec_time,
    mean_exec_time,
    rows,
    ROUND(rows * calls / 1000000.0, 2) AS total_millions_rows
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 10;
```

## pg_stat_statements 详解

### 常用字段

```sql
SELECT 
    query,                          -- 查询语句
    calls,                          -- 调用次数
    total_exec_time,                -- 总执行时间（毫秒）
    min_exec_time,                  -- 最小执行时间
    max_exec_time,                  -- 最大执行时间
    mean_exec_time,                  -- 平均执行时间
    stddev_exec_time,               -- 执行时间标准差
    rows,                           -- 返回的总行数
    shared_blks_hit,                -- 缓存命中块数
    shared_blks_read,               -- 读取块数
    shared_blks_dirtied,            -- 脏块数
    shared_blks_written,             -- 写入块数
    local_blks_hit,                 -- 本地表缓存命中
    local_blks_read,                -- 本地表读取
    temp_blks_read,                 -- 临时块读取
    temp_blks_written,              -- 临时块写入
    blk_read_time,                  -- 块读取时间
    blk_write_time                  -- 块写入时间
FROM pg_stat_statements
LIMIT 1;
```

### 实用查询

```sql
-- 1. 找出最消耗 I/O 的查询
SELECT 
    query,
    shared_blks_read + temp_blks_read AS total_reads,
    shared_blks_written + temp_blks_written AS total_writes,
    blk_read_time + blk_write_time AS io_time_ms
FROM pg_stat_statements
ORDER BY total_reads + total_writes DESC
LIMIT 10;

-- 2. 找出返回大量数据的查询
SELECT 
    query,
    rows,
    mean_exec_time,
    calls
FROM pg_stat_statements
ORDER BY rows DESC
LIMIT 10;

-- 3. 找出缓存命中率低的查询
SELECT 
    query,
    shared_blks_hit,
    shared_blks_read,
    ROUND(100.0 * shared_blks_hit / NULLIF(shared_blks_hit + shared_blks_read, 0), 2) AS cache_hit_ratio
FROM pg_stat_statements
WHERE shared_blks_hit + shared_blks_read > 1000
ORDER BY cache_hit_ratio ASC
LIMIT 10;

-- 4. 分析查询效率变化
SELECT 
    query,
    calls,
    mean_exec_time,
    rows,
    mean_exec_time / NULLIF(rows, 0) AS time_per_row_ms
FROM pg_stat_statements
WHERE rows > 0
ORDER BY time_per_row_ms DESC
LIMIT 10;
```

## 慢查询分析方法

### 1. 查看执行计划

```sql
-- 使用 EXPLAIN 分析
EXPLAIN {慢查询};

-- 使用 EXPLAIN ANALYZE 实际执行
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
{慢查询};
```

### 2. 分析执行计划

```sql
-- 示例查询
EXPLAIN (ANALYZE, BUFFERS)
SELECT 
    o.id, o.created_at, o.total_amount,
    u.name, u.email
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.created_at > '2026-01-01'
  AND o.status = 'completed';

-- 输出分析：
-- 1. 查看 cost 和 actual time
-- 2. 查看 rows（估算 vs 实际）
-- 3. 查看 Buffers（shared hit/read）
-- 4. 找出最慢的节点
```

### 3. 常见问题识别

```sql
-- 问题 1：Seq Scan 全表扫描
EXPLAIN SELECT * FROM orders WHERE status = 'pending';
-- 输出：
-- Seq Scan on orders
--   Filter: ((status)::text = 'pending'::text)
-- 解决：添加索引

-- 问题 2：Nested Loop 无索引
EXPLAIN 
SELECT * FROM orders o
JOIN users u ON o.user_id = u.id;
-- 输出：
-- Nested Loop
--   ->  Seq Scan on users
--   ->  Seq Scan on orders
-- 解决：添加 user_id 索引

-- 问题 3：Hash Join 内存不足
EXPLAIN 
SELECT * FROM large_table1 t1
JOIN large_table2 t2 ON t1.id = t2.t1_id;
-- 解决：增加 work_mem
SET work_mem = '256MB';
```

## 性能优化实战

### 案例一：优化无索引查询

```sql
-- 原始查询
SELECT * FROM orders 
WHERE customer_id = 100 
  AND status = 'pending' 
  AND created_at > '2026-01-01';

-- 查看执行计划
EXPLAIN SELECT * FROM orders 
WHERE customer_id = 100 
  AND status = 'pending' 
  AND created_at > '2026-01-01';

-- 输出：
-- Seq Scan on orders
--   Filter: ((customer_id = 100) AND ...)
-- 解决：添加复合索引
CREATE INDEX idx_orders_cid_status_date 
ON orders(customer_id, status, created_at);

-- 再次查看
EXPLAIN SELECT * FROM orders 
WHERE customer_id = 100 
  AND status = 'pending' 
  AND created_at > '2026-01-01';

-- 输出：
-- Index Scan using idx_orders_cid_status_date on orders
--   Index Cond: (...)
```

### 案例二：优化 N+1 查询

```sql
-- N+1 问题
-- Java 代码（每次循环查询一次）
List<Order> orders = orderRepository.findAll();
for (Order order : orders) {
    User user = userRepository.findById(order.getUserId());  // N 次查询
}

-- 优化：JOIN 查询
EXPLAIN
SELECT o.id, o.total_amount, u.name
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.created_at > '2026-01-01';

-- 优化：批量查询
List<Long> userIds = orders.stream()
    .map(Order::getUserId)
    .collect(Collectors.toList());
// 一次 IN 查询
List<User> users = userRepository.findByIdIn(userIds);
```

### 案例三：优化分页查询

```sql
-- 原始分页（OFFSET）
EXPLAIN
SELECT * FROM orders 
ORDER BY created_at DESC 
LIMIT 20 OFFSET 10000;
-- 问题：OFFSET 越大，扫描越多

-- 优化：使用 Keyset Cursor
EXPLAIN
SELECT * FROM orders 
WHERE (created_at, id) < ('2026-01-01 00:00:00', 10000)
ORDER BY created_at DESC, id DESC
LIMIT 20;
-- 解决：利用索引定位，不需要扫描前面的行
```

## 监控与告警

### 设置告警阈值

```sql
-- 创建慢查询告警视图
CREATE VIEW slow_query_alert AS
SELECT 
    schemaname,
    LEFT(query, 100) AS query_preview,
    calls,
    ROUND(mean_exec_time, 2) AS avg_ms,
    ROUND(total_exec_time / 1000, 2) AS total_seconds,
    rows
FROM pg_stat_statements
WHERE mean_exec_time > 1000  -- 平均超过 1 秒
ORDER BY mean_exec_time DESC;

-- 定期检查
SELECT * FROM slow_query_alert;
```

### 自动分析

```sql
-- 创建定时任务（pg_cron）
CREATE EXTENSION pg_cron;

-- 每天凌晨 3 点分析慢查询
SELECT cron.schedule(
    'analyze-slow-queries',
    '0 3 * * *',
    $$SELECT * FROM slow_query_alert$$
);
```

## Java 应用集成

### 配置 Druid 连接池

```java
@Configuration
public class DruidConfig {
    
    @Bean
    public DataSource dataSource() {
        DruidDataSource dataSource = new DruidDataSource();
        dataSource.setUrl("jdbc:postgresql://localhost:5432/mydb");
        dataSource.setUsername("user");
        dataSource.setPassword("password");
        
        // 开启慢查询日志
        dataSource.setConnectionProperties(
            "config=data_source_properties"
        );
        
        // 慢查询阈值
        dataSource.setTimeBetweenEvictionRunsMillis(60000);
        dataSource.setMinEvictableIdleTimeMillis(300000);
        
        return dataSource;
    }
}
```

### 配置 HikariCP

```java
@Configuration
public class HikariConfig {
    
    @Bean
    public DataSource dataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://localhost:5432/mydb");
        config.setUsername("user");
        config.setPassword("password");
        
        // 慢查询日志
        config.setRegisterMbeans(true);
        config.setPoolName("PostgreSQL-Pool");
        
        return new HikariDataSource(config);
    }
}
```

## 面试高频问题

### Q1: 如何定位慢查询？

**考察点**：问题排查能力

**参考答案**：
1. 开启 `log_min_duration_statement`
2. 使用 `pg_stat_statements` 分析
3. 查看执行计划 `EXPLAIN ANALYZE`
4. 分析统计信息和索引使用情况

### Q2: pg_stat_statements 怎么用？

**考察点**：工具使用

**参考答案**：
- 需要安装扩展：`CREATE EXTENSION pg_stat_statements`
- 查询最慢的查询：`ORDER BY mean_exec_time DESC`
- 查询最频繁的查询：`ORDER BY calls DESC`
- 分析 I/O：`shared_blks_hit` vs `shared_blks_read`

### Q3: 常见的慢查询原因有哪些？

**考察点**：性能优化

**参考答案**：
1. 缺少索引
2. 统计信息不准确
3. N+1 查询问题
4. 大 OFFSET 分页
5. 全表扫描
6. 锁等待
7. 内存不足导致磁盘溢出

### Q4: 如何优化慢查询？

**考察点**：优化能力

**参考答案**：
1. 查看执行计划，找出瓶颈
2. 添加合适的索引
3. 优化查询写法（减少 SELECT *）
4. 使用批量查询替代循环查询
5. 调整 `work_mem`
6. 分区表拆分
7. 使用物化视图缓存结果

## 总结

慢查询分析流程：

```
1. 定位：pg_stat_statements / 慢查询日志
        ↓
2. 分析：EXPLAIN ANALYZE 执行计划
        ↓
3. 诊断：找出瓶颈节点
        ↓
4. 优化：添加索引 / 改写查询 / 调整参数
        ↓
5. 验证：再次分析确认优化效果
```

关键工具：
| 工具 | 用途 |
|------|------|
| log_min_duration_statement | 记录慢查询 |
| pg_stat_statements | 统计分析查询 |
| EXPLAIN ANALYZE | 分析执行计划 |
| pg_stat_activity | 实时活动监控 |
