# PostgreSQL 多版本实现与 VACUUM 机制

你可能听说过 VACUUM，但你知道它为什么存在吗？

MySQL 用回滚段自动管理旧版本，PostgreSQL 呢？

旧版本直接留在表里——这听起来很糟糕，但 PostgreSQL 有自己的解决方案。

今天，我们来深入理解 PostgreSQL 的 VACUUM 机制。

## PostgreSQL 的 MVCC 与空间问题

### UPDATE 的真相

在 PostgreSQL 中，UPDATE 并不是「原地修改」，而是：

```
原数据：id=1, balance=1000, xmin=T1, xmax=0
执行 UPDATE balance = 1500：
┌─────────────────────────────────────┐
│ id=1, balance=1000, xmin=T1, xmax=T2 │  ← 旧版本，被标记删除
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ id=1, balance=1500, xmin=T2, xmax=0 │  ← 新版本
└─────────────────────────────────────┘
```

旧版本没有消失，只是被标记为「已删除」。

### 死元组（Dead Tuple）

这些不再被任何事务需要的元组，叫做「死元组」：

```sql
-- 创建测试表
CREATE TABLE vacuum_test (
    id SERIAL PRIMARY KEY,
    data TEXT
);

-- 插入数据
INSERT INTO vacuum_test (data) SELECT 'data' || i FROM generate_series(1, 1000) i;

-- 执行大量更新
UPDATE vacuum_test SET data = 'updated' WHERE id % 2 = 0;

-- 查看表膨胀
SELECT 
    pg_size_pretty(pg_total_relation_size('vacuum_test')) AS total_size,
    pg_size_pretty(pg_relation_size('vacuum_test')) AS table_size;
```

### 为什么要 VACUUM？

死元组的问题：

1. **占用空间**：表文件越来越大
2. **影响查询**：扫描时需要跳过死元组
3. **统计信息不准**：影响执行计划选择
4. **事务 ID 回卷**：长期不清理会导致事务 ID 耗尽

```
没有 VACUUM 的后果：
┌────────────────────────────────────────────────────┐
│ Page 1: [活元组][死元组][死元组][活元组][死元组]...  │
│ Page 2: [死元组][死元组][活元组][死元组][死元组]...  │
│ Page 3: [活元组][死元组][死元组][死元组][活元组]...  │
│                                                    │
│ 查询时需要遍历所有页面，包括死元组                    │
└────────────────────────────────────────────────────┘

VACUUM 后：
┌────────────────────────────────────────────────────┐
│ Page 1: [活元组][活元组][活元组]                    │
│ Page 2: [活元组]                                   │
│ Page 3: [活元组][活元组]                           │
│                                                    │
│ 页内紧凑，扫描效率提高                               │
└────────────────────────────────────────────────────┘
```

## VACUUM 的类型

### 标准 VACUUM

```sql
-- 清理单个表
VACUUM vacuum_test;

-- 清理整个数据库
VACUUM;

-- 清理并分析（推荐）
VACUUM ANALYZE vacuum_test;

-- 显示详细信息
VACUUM VERBOSE vacuum_test;
```

标准 VACUUM 是**非阻塞的**，允许并发读写。

### VACUUM FULL

```sql
-- 重写整个表，释放所有空间
VACUUM FULL vacuum_test;

-- 相当于：
ALTER TABLE vacuum_test SET (
    fillfactor = 100
);
REINDEX TABLE vacuum_test;
```

VACUUM FULL 会**锁定表**，不适合生产环境使用。

### Autovacuum

PostgreSQL 自动运行 VACUUM，不需要手动执行：

```sql
-- 查看 autovacuum 配置
SHOW autovacuum;
SHOW autovacuum_vacuum_threshold;  -- 默认 50 行
SHOW autovacuum_analyze_threshold;  -- 默认 50 行

-- postgresql.conf 配置
autovacuum = on
autovacuum_vacuum_threshold = 50
autovacuum_vacuum_scale_factor = 0.2  -- 20% 表变化后触发
autovacuum_analyze_threshold = 50
autovacuum_analyze_scale_factor = 0.1  -- 10% 表变化后触发
```

## VACUUM 的工作原理

### 阶段一：标记

VACUUM 扫描表，标记死元组为可重用：

```
扫描过程：
1. 读取每个页面
2. 检查每个元组的可见性（xmin/xmax vs 快照）
3. 死元组标记到自由空间映射（FSM）

┌─────────────────────────────────────────┐
│ FSM（自由空间映射）                        │
│ Page 1: 40% 空闲                         │
│ Page 2: 90% 空闲                         │
│ Page 3: 0%  空闲                         │
└─────────────────────────────────────────┘
```

### 阶段二：清理

更新可见性映射（VM）和自由空间映射：

```sql
-- 查看可见性映射
SELECT 
    relname,
    n_live_tup,
    n_dead_tup,
    last_vacuum,
    last_autovacuum
FROM pg_stat_user_tables
WHERE relname = 'vacuum_test';
```

### 阶段三：更新统计信息

VACUUM 同时更新统计信息：

```sql
-- ANALYZE 部分
VACUUM ANALYZE vacuum_test;

-- 等同于
VACUUM vacuum_test;
ANALYZE vacuum_test;
```

## VACUUM 与事务 ID

### 事务 ID 回卷问题

PostgreSQL 的事务 ID 是 32 位整数，最大约 42 亿。

如果事务 ID 回卷，会发生什么？

```sql
-- 事务 ID 回卷风险
-- 如果不及时清理，旧事务可能被「误认为」已提交

-- VACUUM 会清理死亡元组，并冻结旧事务 ID
-- 冻结事务 ID：将 xmin 设置为 2（表示「总是可见」）
```

### 冻结处理

```sql
-- 查看表的事务年龄（多久没被冻结）
SELECT 
    relname,
    age(relfrozenxid) AS xid_age,
    pg_size_pretty(pg_table_size(oid)) AS table_size
FROM pg_class
WHERE relkind = 'r'
ORDER BY age(relfrozenxid) DESC;

-- 手动冻结
VACUUM FREEZE vacuum_test;

-- 冻结整个数据库（不推荐在生产环境）
VACUUM FREEZE --freeze;
```

> PostgreSQL 默认在事务 ID 达到 2 亿时强制冻结，这由 `vacuum_failsafe_age` 和 `autovacuum_failsafe_age` 控制。

## VACUUM 调优

### 表级参数

```sql
-- 为频繁更新的表配置 autovacuum
ALTER TABLE orders SET (
    autovacuum_vacuum_threshold = 1000,
    autovacuum_vacuum_scale_factor = 0.05,  -- 5% 变化触发
    autovacuum_analyze_threshold = 500
);

-- 禁用 autovacuum（通常不推荐）
ALTER TABLE critical_table SET (autovacuum_enabled = off);
```

### 配置建议

```ini
# postgresql.conf

# autovacuum 配置
autovacuum = on
autovacuum_max_workers = 4  -- 工作进程数
autovacuum_naptime = 1min   -- 检查间隔

# 触发阈值
autovacuum_vacuum_threshold = 50
autovacuum_vacuum_scale_factor = 0.2  -- 20% 表变化

# 冻结阈值
vacuum_failsafe_age = 200000000
autovacuum_failsafe_age = 200000000

# 成本控制
vacuum_cost_delay = 2ms
vacuum_cost_limit = 1000
```

### 监控

```sql
-- 查看 VACUUM 统计
SELECT 
    schemaname,
    relname,
    n_dead_tup,
    n_live_tup,
    last_vacuum,
    last_autovacuum,
    vacuum_count,
    autovacuum_count
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;

-- 查看正在进行的 VACUUM
SELECT 
    pid,
    query,
    state,
    (now() - query_start) AS duration
FROM pg_stat_activity
WHERE query LIKE 'vacuum%';

-- 查看 VACUUM 进度
SELECT 
    pid,
    query,
    phase,
    heap_blks_total,
    heap_blks_scanned,
    heap_blks_vacuumed,
    (100.0 * heap_blks_scanned / NULLIF(heap_blks_total, 0)) AS percent_scanned
FROM pg_stat_progress_vacuum;
```

## VACUUM 与性能

### 何时需要手动 VACUUM

1. **批量删除/更新后**
   ```sql
   -- 批量删除
   DELETE FROM logs WHERE created_at < '2025-01-01';
   VACUUM logs;
   ```

2. **VACUUM 跟不上更新速度**
   ```sql
   -- 检查是否积压
   SELECT * FROM pg_stat_user_tables 
   WHERE n_dead_tup > 100000;
   ```

3. **准备重要操作前**
   ```sql
   -- 索引重建前先 VACUUM
   VACUUM ANALYZE;
   REINDEX TABLE orders;
   ```

### VACUUM 成本控制

VACUUM 会消耗 I/O 和 CPU，影响前台查询。

```sql
-- 查看当前 I/O 成本
SHOW vacuum_cost_delay;  -- 默认 0（立即执行）

-- 降低 I/O 优先级
SET vacuum_cost_delay = '10ms';

-- 限制 VACUUM 的 I/O 量
SET vacuum_cost_limit = 200;
```

## 常见问题

### 问题一：表一直在膨胀

```sql
-- 检查原因
SELECT 
    schemaname,
    relname,
    n_dead_tup,
    last_autovacuum,
    autovacuum_count
FROM pg_stat_user_tables
WHERE relname = 'your_table';

-- 查看表的膨胀率
SELECT 
    relname,
    pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) AS bloat_size,
    ROUND(100 * (pg_total_relation_size(relid) - pg_relation_size(relid)) 
        / NULLIF(pg_total_relation_size(relid), 0), 2) AS bloat_ratio
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY bloat_ratio DESC;
```

### 问题二：VACUUM 一直失败

```sql
-- 查看错误日志
SELECT 
    pid,
    query,
    state,
    query_start,
    wait_event_type,
    wait_event
FROM pg_stat_activity
WHERE state = 'active' AND query LIKE '%vacuum%';

-- 常见原因：长事务阻塞
SELECT * FROM pg_stat_activity 
WHERE state != 'idle' 
AND backend_xid IS NOT NULL
AND xact_start < NOW() - INTERVAL '1 hour';
```

### 问题三：autovacuum 不够用

```sql
-- 增加 worker 数量
ALTER SYSTEM SET autovacuum_max_workers = 8;

-- 或者使用手动 VACUUM
SELECT pg_size_pretty(pg_total_relation_size('huge_table'));
-- 如果很大，考虑分批处理
```

## 面试高频问题

### Q1: PostgreSQL 的 UPDATE 是怎么实现的？

**考察点**：MVCC 理解

**参考答案**：
- UPDATE = DELETE + INSERT
- 旧版本标记 xmax 为当前事务 ID
- 新版本设置 xmin 为当前事务 ID
- 旧版本成为死元组，需要 VACUUM 清理

### Q2: 为什么要 VACUUM？

**考察点**：存储管理

**参考答案**：
1. 清理死元组，释放空间
2. 更新统计信息，影响执行计划
3. 冻结旧事务 ID，防止回卷
4. 更新可见性映射，优化扫描

### Q3: VACUUM 会阻塞读写吗？

**考察点**：并发特性

**参考答案**：
- 标准 VACUUM 不阻塞读写（并发安全）
- VACUUM FULL 会锁定表（不推荐生产使用）
- Autovacuum 默认是非阻塞的

### Q4: Autovacuum 什么时候会失效？

**考察点**：运维理解

**参考答案**：
1. 长事务阻塞：VACUUM 看不到长事务开始后的死元组
2. 复制槽阻塞：复制槽会阻止事务 ID 冻结
3. 表被设为 autovacuum_enabled = off
4. VACUUM 跟不上更新速度

## 总结

VACUUM 是 PostgreSQL 存储管理的核心机制：

| 类型 | 特点 | 阻塞 |
|------|------|------|
| VACUUM | 标准清理 | 否 |
| VACUUM FULL | 重写表，释放空间 | 是 |
| Autovacuum | 后台自动运行 | 否 |
| VACUUM FREEZE | 冻结事务 ID | 否 |

理解 VACUUM，才能理解 PostgreSQL 的存储模型和性能调优。
