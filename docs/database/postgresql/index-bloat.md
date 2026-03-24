# PostgreSQL 索引膨胀与 REINDEX 维护

索引会膨胀吗？

会的。

MySQL 的索引膨胀可以通过 OPTIMIZE TABLE 解决，PostgreSQL 呢？

今天，我们来聊聊 PostgreSQL 的索引膨胀问题和 REINDEX 维护。

## 索引膨胀的原因

### 什么是索引膨胀

索引膨胀（Index Bloat）是指索引文件大于其应有的尺寸：

```
正常索引：
┌─────────────────────────────────────────┐
│ [A][B][C][D][E][F][G][H][I][J]...      │
│ 紧凑排列，接近理论大小                    │
└─────────────────────────────────────────┘

膨胀索引：
┌─────────────────────────────────────────┐
│ [A][D][G]... ← 死条目堆积                │
│ [已删除][已删除][已删除]...               │
│ [B][E][H]...                           │
│ [已删除][已删除]...                       │
└─────────────────────────────────────────┘
```

### 膨胀的原因

1. **UPDATE 操作**
   ```sql
   -- UPDATE 会使旧索引条目失效，但不删除
   UPDATE users SET email = 'new@example.com' WHERE id = 1;
   ```

2. **DELETE 操作**
   ```sql
   -- DELETE 后索引条目仍保留
   DELETE FROM users WHERE id = 1;
   ```

3. **VACUUM 只清理表，不清理索引**
   ```sql
   VACUUM users;  -- 清理表中的死元组
   -- 但索引中的死条目仍然存在！
   ```

## 检测索引膨胀

### 方法一：使用 pgstattuple

```sql
-- 安装扩展
CREATE EXTENSION pgstattuple;

-- 查看表的膨胀
SELECT * FROM pgstattuple('users');

-- 结果：
-- table_len: 8192          -- 表长度（字节）
-- tuple_count: 1000        -- 实际元组数
-- tuple_len: 80000         -- 元组总长度
-- dead_tuple_count: 0      -- 死元组数
-- dead_tuple_len: 0        -- 死元组长度
-- free_space: 1024          -- 空闲空间
-- dead_tuple_space: 0       -- 死元组空间
```

### 方法二：使用 pgstattuple_approx

```sql
-- 近似膨胀检测（更快）
SELECT * FROM pgstattuple_approx('users');
```

### 方法三：使用 pg_index_bloat（自定义）

```sql
-- 创建膨胀检测视图
CREATE VIEW index_bloat AS
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
    CASE 
        WHEN n_dead_tup > 1000 THEN 'HIGH'
        WHEN n_dead_tup > 100 THEN 'MEDIUM'
        ELSE 'LOW'
    END AS bloat_level
FROM pg_stat_user_indexes
JOIN pg_index USING (indexrelid)
WHERE idx_scan < 100
AND indisunique = false
ORDER BY n_dead_tup DESC;

-- 查看膨胀的索引
SELECT * FROM index_bloat WHERE bloat_level != 'LOW';
```

### 方法四：手动计算膨胀率

```sql
-- 计算索引膨胀率
WITH index_stats AS (
    SELECT 
        schemaname,
        tablename,
        indexname,
        pg_relation_size(indexrelid) AS index_size,
        reltuples,
        relpages
    FROM pg_stat_user_indexes
    JOIN pg_class ON indrelid = pg_class.oid
)
SELECT 
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(index_size) AS size,
    reltuples,
    relpages,
    ROUND((index_size - (reltuples * 8)) / 8192.0, 2) AS extra_pages,
    ROUND((index_size - (reltuples * 8)) * 100.0 / index_size, 2) AS bloat_ratio
FROM index_stats
ORDER BY bloat_ratio DESC;
```

## REINDEX 重建索引

### 基本用法

```sql
-- 重建单个索引
REINDEX INDEX idx_users_email;

-- 重建表的所有索引
REINDEX TABLE users;

-- 重建数据库的所有索引
REINDEX DATABASE mydb;

-- 重建系统表（需要超级用户权限）
REINDEX SYSTEM mydb;
```

### REINDEX 的过程

```
REINDEX 操作：
1. 获取 ShareUpdateExclusiveLock（允许并发读写）
2. 创建临时索引
3. 删除旧索引
4. 重命名临时索引为原名
5. 更新统计信息
```

### CONCURRENTLY 选项

```sql
-- 普通 REINDEX 会阻塞读写
REINDEX INDEX idx_users_email;  -- 阻塞！

-- CONCURRENTLY 方式（不阻塞）
REINDEX INDEX CONCURRENTLY idx_users_email;  -- 不阻塞
```

> 注意：CONCURRENTLY 需要两倍的磁盘空间，且不能用于系统表。

### REINDEX 的代价

```sql
-- REINDEX 需要：
-- 1. 两倍磁盘空间（临时索引 + 原索引）
-- 2. 写入负载（创建临时索引）
-- 3. 锁竞争（即使 CONCURRENTLY 也有轻微影响）

-- 建议：
-- - 在低峰期执行
-- - 监控磁盘空间
-- - 逐个索引重建
```

## 索引维护策略

### 定期维护脚本

```sql
-- 查找膨胀严重的索引
CREATE OR REPLACE FUNCTION find_bloated_indexes(threshold_pct INTEGER DEFAULT 20)
RETURNS TABLE (
    schemaname TEXT,
    tablename TEXT,
    indexname TEXT,
    index_size TEXT,
    bloat_ratio NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH index_stats AS (
        SELECT 
            schemaname,
            tablename,
            indexname,
            indexrelid,
            pg_relation_size(indexrelid) AS index_size,
            reltuples,
            relpages
        FROM pg_stat_user_indexes
        JOIN pg_class ON indrelid = pg_class.oid
    )
    SELECT 
        i.schemaname,
        i.tablename,
        i.indexname,
        pg_size_pretty(i.index_size)::TEXT,
        ROUND((i.index_size - COALESCE((reltuples * 8), 0)) * 100.0 / i.index_size, 2) AS bloat_ratio
    FROM index_stats i
    WHERE (i.index_size - COALESCE((reltuples * 8), 0)) * 100.0 / i.index_size > threshold_pct
    ORDER BY bloat_ratio DESC;
END;
$$ LANGUAGE plpgsql;

-- 查找膨胀超过 20% 的索引
SELECT * FROM find_bloated_indexes(20);
```

### 自动化维护

```sql
-- pgAgent 作业或 cron 脚本
-- rebuild_bloated_indexes.sql

DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN 
        SELECT schemaname, indexname 
        FROM find_bloated_indexes(50)  -- 只重建膨胀超过 50% 的
    LOOP
        RAISE NOTICE 'Rebuilding %.%', rec.schemaname, rec.indexname;
        
        -- 执行重建
        EXECUTE format('REINDEX INDEX CONCURRENTLY %I.%I', rec.schemaname, rec.indexname);
    END LOOP;
END $$;
```

### 监控脚本

```bash
#!/bin/bash
# check_index_size.sh

# 查找大小超过 1GB 的索引
psql -d mydb -c "
SELECT 
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE pg_relation_size(indexrelid) > 1024 * 1024 * 1024
ORDER BY pg_relation_size(indexrelid) DESC;
"
```

## 不同索引类型的膨胀处理

### B-Tree 索引

```sql
-- B-Tree 是最常见的索引类型
-- 膨胀原因：大量 UPDATE/DELETE
-- 解决方案：REINDEX

REINDEX INDEX CONCURRENTLY idx_orders_customer;
```

### GIN 索引

```sql
-- GIN 索引膨胀更严重
-- 原因：GIN 使用倒排索引，条目更多

-- 重建 GIN 索引
REINDEX INDEX CONCURRENTLY idx_products_tags;

-- 或者删除重建
DROP INDEX idx_products_tags;
CREATE INDEX CONCURRENTLY idx_products_tags ON products USING GIN (tags);
```

### BRIN 索引

```sql
-- BRIN 索引通常不会膨胀
-- 但如果物理顺序被打乱，可能需要重建

-- 重建 BRIN 索引
REINDEX INDEX CONCURRENTLY idx_logs_created_brin;

-- 检查 BRIN 索引的有效性
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan,
    pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE indexname LIKE '%brin%';
```

## 预防索引膨胀

### 1. 及时 VACUUM

```sql
-- 确保 autovacuum 正常工作
SHOW autovacuum_vacuum_threshold;
SHOW autovacuum_vacuum_scale_factor;

-- 调整参数（postgresql.conf）
autovacuum_vacuum_scale_factor = 0.1  -- 默认 0.2

-- 手动 VACUUM
VACUUM ANALYZE users;
```

### 2. 使用部分索引

```sql
-- 只索引需要的数据，减少膨胀
CREATE INDEX idx_orders_pending ON orders(created_at) 
WHERE status = 'pending';
```

### 3. 选择合适的索引类型

```sql
-- 对于频繁更新的表，谨慎选择索引类型
-- B-Tree 最通用，但膨胀最快
-- BRIN 膨胀最小，但只适合顺序数据
```

### 4. 控制连接池大小

```sql
-- 避免大量短事务导致索引频繁更新
-- 优化连接池配置
-- 批量操作代替逐行操作
```

## REINDEX 的注意事项

### 磁盘空间

```sql
-- 检查可用空间
SELECT pg_size_pretty(pg_available_disk_space());

-- 查看当前索引大小
SELECT 
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE schemaname = 'public';
```

### 锁等待

```sql
-- 查看是否有 REINDEX 阻塞
SELECT 
    pid,
    query,
    state,
    wait_event_type,
    wait_event
FROM pg_stat_activity
WHERE query LIKE '%reindex%';

-- 取消长时间运行的 REINDEX
SELECT pg_cancel_backend(pid);
-- 或强制终止
SELECT pg_terminate_backend(pid);
```

### 系统表索引

```sql
-- 系统表索引也会膨胀
-- 但 REINDEX SYSTEM 需要超级用户权限

-- 查看系统表索引膨胀
SELECT 
    schemaname,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE schemaname IN ('pg_catalog', 'information_schema')
ORDER BY pg_relation_size(indexrelid) DESC;

-- 重建系统表索引（谨慎操作）
REINDEX SYSTEM mydb;
```

## 面试高频问题

### Q1: 索引为什么会膨胀？

**考察点**：存储管理

**参考答案**：
1. UPDATE/DELETE 后，旧索引条目不删除
2. VACUUM 只清理表，不清理索引
3. 大量并发写入导致索引页面碎片化

### Q2: 如何检测索引膨胀？

**考察点**：运维能力

**参考答案**：
1. `pgstattuple` 查看索引元组统计
2. 对比索引实际大小和理论大小
3. `pg_stat_user_indexes` 查看扫描次数
4. 编写膨胀检测脚本

### Q3: REINDEX 和 VACUUM 的区别？

**考察点**：存储机制

**参考答案**：
- VACUUM：清理表中的死元组，更新 FSM，不重建索引
- REINDEX：重建索引，释放索引空间
- 需要两者配合使用

### Q4: REINDEX 会阻塞操作吗？

**考察点**：并发特性

**参考答案**：
- 普通 REINDEX 会获取 ShareUpdateExclusiveLock，允许读但阻塞写
- REINDEX CONCURRENTLY 不会阻塞，但需要两倍磁盘空间
- 系统表索引需要特殊处理

## 总结

索引膨胀处理流程：

```
检测 → 分析 → 重建 → 验证

1. 检测：pgstattuple 或膨胀率计算
2. 分析：确定膨胀程度和原因
3. 重建：REINDEX 或 REINDEX CONCURRENTLY
4. 验证：检查索引大小和使用情况
```

维护建议：

| 策略 | 说明 |
|------|------|
| 定期监控 | 每周检查索引大小和膨胀率 |
| 及时 VACUUM | 确保 autovacuum 正常工作 |
| 低峰期重建 | 在业务低峰期执行 REINDEX |
| 预防为主 | 使用部分索引减少膨胀源 |
