# PostgreSQL 性能监控：pg_stat_activity、pg_stat_bgwriter

数据库突然变慢了。

没有改代码，没有加数据。

怎么查？

今天，我们来聊聊 PostgreSQL 的性能监控。

## pg_stat_activity

### 基本使用

```sql
-- 查看所有活动连接
SELECT 
    pid,
    usename,
    application_name,
    client_addr,
    state,
    query,
    query_start,
    state_change,
    wait_event_type,
    wait_event,
    backend_xid,
    backend_xmin
FROM pg_stat_activity
ORDER BY query_start;
```

### 字段说明

| 字段 | 说明 |
|------|------|
| pid | 进程 ID |
| usename | 用户名 |
| application_name | 应用名称 |
| client_addr | 客户端 IP |
| state | 连接状态 |
| query | 当前查询 |
| query_start | 查询开始时间 |
| state_change | 状态变更时间 |
| wait_event_type | 等待事件类型 |
| wait_event | 等待事件 |
| backend_xid | 后端事务 ID |
| backend_xmin | 后端最小事务 ID |

### 连接状态

```sql
-- 查看不同状态的连接
SELECT state, COUNT(*) 
FROM pg_stat_activity
GROUP BY state;

-- 状态类型：
-- idle：等待命令
-- idle in transaction：事务空闲（可能有未提交的事务）
-- active：执行查询
-- fastpath function call：执行 fastpath 函数
-- disabled：未启用（禁用统计信息收集）
```

### 查看慢查询

```sql
-- 查看正在执行的慢查询
SELECT 
    pid,
    now() - query_start AS duration,
    state,
    query
FROM pg_stat_activity
WHERE state = 'active'
AND now() - query_start > INTERVAL '5 seconds'
ORDER BY duration DESC;

-- 查看所有超过 1 秒的查询
SELECT 
    pid,
    usename,
    now() - query_start AS duration,
    LEFT(query, 100) AS query_preview
FROM pg_stat_activity
WHERE state = 'active'
AND now() - query_start > INTERVAL '1 second'
ORDER BY query_start;
```

### 查看锁等待

```sql
-- 查看等待锁的进程
SELECT 
    blocked_locks.pid AS blocked_pid,
    blocking_locks.pid AS blocking_pid,
    blocked_activity.usename AS blocked_user,
    blocking_activity.usename AS blocking_user,
    blocked_activity.query AS blocked_query,
    blocking_activity.query AS blocking_query,
    blocked_activity.state AS blocked_state,
    blocking_activity.state AS blocking_state
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity 
    ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks
    ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
    AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
    AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
    AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
    AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
    AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
    AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
    AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
    AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity 
    ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

### 查看长事务

```sql
-- 查看运行时间超过 10 分钟的事务
SELECT 
    pid,
    usename,
    state,
    backend_xid,
    xact_start,
    now() - xact_start AS xact_duration,
    query_start,
    now() - query_start AS query_duration,
    query
FROM pg_stat_activity
WHERE state != 'idle'
AND backend_xid IS NOT NULL
AND xact_start < NOW() - INTERVAL '10 minutes'
ORDER BY xact_start;
```

### 查看空闲事务

```sql
-- 查看空闲但未关闭的事务（可能导致 MVCC 问题）
SELECT 
    pid,
    usename,
    state,
    xact_start,
    now() - xact_start AS idle_duration,
    query
FROM pg_stat_activity
WHERE state = 'idle in transaction'
AND xact_start < NOW() - INTERVAL '5 minutes'
ORDER BY xact_start;
```

## pg_stat_bgwriter

### 基本使用

```sql
-- 查看后台写入器统计
SELECT * FROM pg_stat_bgwriter;

-- 字段说明：
-- checkpoints_timed: 计划检查点数
-- checkpoints_req: 请求检查点数
-- checkpoint_write_time: 检查点写入时间
-- checkpoint_sync_time: 检查点同步时间
-- buffers_checkpoint: 检查点写入的缓冲区数
-- buffers_clean: bgwriter 清理的缓冲区数
-- maxwritten_clean: bgwriter 达到最大写入次数
-- buffers_backend: 后端直接写入的缓冲区数
-- buffers_backend_fsync: 后端需要 fsync 的次数
-- buffers_alloc: 分配的缓冲区数
```

### 解读统计

```sql
-- 分析 bgwriter 效率
SELECT 
    ROUND(100.0 * buffers_checkpoint / NULLIF(buffers_checkpoint + buffers_clean + buffers_backend, 0), 2) AS checkpoint_pct,
    ROUND(100.0 * buffers_clean / NULLIF(buffers_checkpoint + buffers_clean + buffers_backend, 0), 2) AS bgwriter_pct,
    ROUND(100.0 * buffers_backend / NULLIF(buffers_checkpoint + buffers_clean + buffers_backend, 0), 2) AS backend_pct,
    maxwritten_clean,
    checkpoints_req,
    buffers_checkpoint,
    buffers_clean
FROM pg_stat_bgwriter;

-- 如果 buffers_backend 占比高，说明后端在频繁写入
-- 考虑增加 bgwriter 写入频率
SHOW bgwriter_delay;
SHOW bgwriter_flush_after;
SHOW bgwriter_lru_maxpages;
```

## pg_stat_database

### 基本使用

```sql
-- 查看数据库统计
SELECT 
    datname,
    numbackends,
    xact_commit,
    xact_rollback,
    blks_read,
    blks_hit,
    ROUND(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS cache_hit_ratio,
    tup_returned,
    tup_fetched,
    tup_inserted,
    tup_updated,
    tup_deleted,
    conflicts,
    temp_files,
    temp_bytes,
    deadlocks
FROM pg_stat_database
WHERE datname = 'mydb';
```

### 缓存命中率

```sql
-- 缓存命中率
SELECT 
    datname,
    blks_hit,
    blks_read,
    ROUND(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS hit_ratio
FROM pg_stat_database;

-- 缓存命中率 < 99% 可能是问题
-- 考虑增加 shared_buffers
SHOW shared_buffers;
```

## pg_stat_user_tables

### 基本使用

```sql
-- 查看表统计
SELECT 
    schemaname,
    relname,
    seq_scan,
    seq_tup_read,
    idx_scan,
    idx_tup_fetch,
    n_tup_ins,
    n_tup_upd,
    n_tup_del,
    n_live_tup,
    n_dead_tup,
    n_mod_since_analyze,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze,
    vacuum_count,
    autovacuum_count
FROM pg_stat_user_tables
WHERE relname = 'orders'
ORDER BY relname;
```

### 找出需要 VACUUM 的表

```sql
-- 找出死元组多的表
SELECT 
    schemaname,
    relname,
    n_live_tup,
    n_dead_tup,
    ROUND(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_tuple_pct,
    last_autovacuum,
    autovacuum_count
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
```

### 找出未使用的索引

```sql
-- 找出从未被扫描的索引
SELECT 
    schemaname,
    relname,
    indexrelname,
    idx_scan,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
AND schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;
```

## pg_stat_user_indexes

### 基本使用

```sql
-- 查看索引使用统计
SELECT 
    schemaname,
    relname,
    indexrelname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    idx_blks_read,
    idx_blks_hit,
    ROUND(100.0 * idx_blks_hit / NULLIF(idx_blks_hit + idx_blks_read, 0), 2) AS index_hit_ratio
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;
```

## 性能监控视图

### 创建监控视图

```sql
-- 创建综合监控视图
CREATE VIEW db_monitor AS
SELECT 
    -- 连接信息
    (SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active') AS active_connections,
    (SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'idle') AS idle_connections,
    (SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'idle in transaction') AS idle_in_transaction,
    
    -- 缓存命中率
    (SELECT ROUND(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2)
     FROM pg_stat_database WHERE datname = current_database()) AS cache_hit_ratio,
    
    -- 事务统计
    (SELECT SUM(xact_commit) FROM pg_stat_database WHERE datname = current_database()) AS total_commits,
    (SELECT SUM(xact_rollback) FROM pg_stat_database WHERE datname = current_database()) AS total_rollbacks,
    
    -- 死元组统计
    (SELECT SUM(n_dead_tup) FROM pg_stat_user_tables) AS total_dead_tuples,
    
    -- 连接数
    (SELECT COUNT(*) FROM pg_stat_activity) AS total_connections;
```

## 监控脚本

### 常用监控 SQL

```sql
-- 1. 当前负载概览
SELECT 
    numbackends AS connections,
    xact_commit AS commits,
    xact_rollback AS rollbacks,
    blks_read AS reads,
    blks_hit AS hits,
    ROUND(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS cache_hit_pct
FROM pg_stat_database
WHERE datname = current_database();

-- 2. 找出最慢的查询
SELECT 
    pid,
    now() - query_start AS duration,
    state,
    LEFT(query, 200) AS query_preview
FROM pg_stat_activity
WHERE state = 'active'
AND query_start IS NOT NULL
ORDER BY query_start;

-- 3. 找出等待锁的查询
SELECT 
    pid,
    usename,
    query,
    wait_event,
    state
FROM pg_stat_activity
WHERE wait_event IS NOT NULL
ORDER BY query_start;

-- 4. 表使用统计
SELECT 
    relname,
    seq_scan,
    idx_scan,
    n_tup_ins,
    n_tup_upd,
    n_tup_del,
    n_live_tup,
    n_dead_tup
FROM pg_stat_user_tables
ORDER BY (idx_scan + seq_scan) DESC
LIMIT 20;
```

## 面试高频问题

### Q1: 如何监控 PostgreSQL 的性能？

**考察点**：监控能力

**参考答案**：
1. `pg_stat_activity`：查看连接和查询
2. `pg_stat_bgwriter`：查看后台写入器
3. `pg_stat_database`：查看数据库统计
4. `pg_stat_user_tables`：查看表统计
5. `pg_stat_user_indexes`：查看索引统计

### Q2: 如何找出慢查询？

**考察点**：问题排查

**参考答案**：
1. `pg_stat_activity` 查看正在运行的查询
2. `pg_stat_statements` 查看历史查询统计
3. `EXPLAIN ANALYZE` 分析执行计划
4. 设置 `log_min_duration_statement` 记录慢查询

### Q3: 如何处理长事务？

**考察点**：并发控制

**参考答案**：
1. 使用 `pg_stat_activity` 找出长事务
2. 分析事务在做什么
3. 如果无意义，终止事务
4. 优化应用逻辑，避免长事务

### Q4: 如何找出未使用的索引？

**考察点**：索引优化

**参考答案**：
1. `pg_stat_user_indexes` 查看 `idx_scan = 0`
2. 分析业务是否真的不需要
3. 考虑删除不用的索引
4. 注意：某些索引可能只在特定场景使用

## 总结

PostgreSQL 性能监控核心视图：

| 视图 | 用途 |
|------|------|
| pg_stat_activity | 连接、查询、等待 |
| pg_stat_bgwriter | 后台写入、检查点 |
| pg_stat_database | 缓存命中率、事务统计 |
| pg_stat_user_tables | 表扫描、更新、VACUUM |
| pg_stat_user_indexes | 索引扫描、使用率 |
| pg_stat_statements | 查询历史统计 |

监控是性能优化的第一步：
1. 了解基线
2. 发现异常
3. 分析根因
4. 持续优化
