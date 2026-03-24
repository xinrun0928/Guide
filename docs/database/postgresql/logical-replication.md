# PostgreSQL 逻辑复制 vs 物理复制

想复制部分表到另一个数据库？

想实现跨版本复制？

今天，我们来聊聊 PostgreSQL 的逻辑复制和物理复制。

## 复制类型概述

### 两种复制方式

```
物理复制（Streaming Replication）：
┌─────────────────────────────────────────┐
│           整个数据库实例                    │
│  ┌─────────┐    ┌─────────┐            │
│  │ WAL 日志 │ ──→ │ 完全复制  │            │
│  └─────────┘    └─────────┘            │
└─────────────────────────────────────────┘
特点：整个数据库的精确副本

逻辑复制（Logical Replication）：
┌─────────────────────────────────────────┐
│           特定表/数据                      │
│  ┌─────────┐    ┌─────────┐            │
│  │ 事务逻辑 │ ──→ │ 选择性复制 │            │
│  └─────────┘    └─────────┘            │
└─────────────────────────────────────────┘
特点：可以选择性复制特定表或数据
```

## 物理复制（流复制）

### 特点

- 复制整个数据库实例
- 完全同步（可选）
- 无法选择性复制
- 无法跨版本复制
- 主从完全一致

### 配置（见 streaming-replication.md）

## 逻辑复制

### 特点

| 特性 | 说明 |
|------|------|
| 表级复制 | 可以选择特定表复制 |
| 跨版本 | 可以跨 PostgreSQL 版本 |
| 数据过滤 | 可以过滤特定行 |
| 列过滤 | 可以只复制特定列 |
| 双向复制 | 支持多主复制 |
| DDL 复制 | 需要单独处理 |

### 逻辑复制架构

```
┌─────────────────────────────────────────────────────────┐
│                      Publisher (发布端)                   │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐            │
│  │  表数据  │ ──→ │ WAL 解析 │ ──→ │ 逻辑解码 │            │
│  └─────────┘    └─────────┘    └────┬────┘            │
└────────────────────────────────────┼──────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │  复制协议       │  复制协议        │
                    ▼                ▼                 ▼
              ┌─────────────────────────────────────────┐
              │           Subscription (订阅端)            │
              │  ┌─────────┐    ┌─────────┐            │
              │  │ 接收复制 │ ──→ │ 应用变更 │            │
              │  └─────────┘    └─────────┘            │
              └─────────────────────────────────────────┘
```

## 配置逻辑复制

### 1. 发布端配置

```sql
-- postgresql.conf
wal_level = logical
max_replication_slots = 10
max_wal_senders = 10
```

### 2. 创建发布

```sql
-- 创建发布（发布整个表）
CREATE PUBLICATION my_publication FOR ALL TABLES;

-- 发布特定表
CREATE PUBLICATION my_table_pub FOR TABLE users, orders, products;

-- 带过滤条件的发布
CREATE PUBLICATION active_users_pub FOR TABLE users
    WHERE (status = 'active');

-- 查看发布
SELECT * FROM pg_publication;

-- 查看发布中的表
SELECT * FROM pg_publication_tables;
```

### 3. 订阅端配置

```sql
-- 创建订阅
CREATE SUBSCRIPTION my_subscription
CONNECTION 'host=publisher_host port=5432 dbname=mydb user=replicator password=xxx'
PUBLICATION my_publication;

-- 查看订阅
SELECT * FROM pg_subscription;

-- 查看订阅状态
SELECT 
    subname,
    subenabled,
    subslotname,
    subconninfo
FROM pg_subscription;

-- 查看订阅的复制状态
SELECT * FROM pg_stat_subscription;
```

### 4. 初始数据同步

```sql
-- 订阅创建时会自动同步初始数据
-- 如果初始复制失败，可以手动同步

-- 使用 pg_dump 手动同步
pg_dump -h publisher_host -U replicator -t users | psql -h subscriber_host

-- 或者使用 pg_copy
SELECT pg_copy(
    'host=publisher_host dbname=mydb',
    'host=subscriber_host dbname=mydb',
    'users'
);
```

## 逻辑复制高级配置

### 列过滤

```sql
-- 只复制部分列
CREATE PUBLICATION users_pub FOR TABLE users
    USING COLUMN (id, name, email);

-- 不复制敏感列
CREATE PUBLICATION users_pub FOR TABLE users
    USING COLUMN (id, name, email)
    WITH (publish_via_partition_root = true);
```

### 行过滤

```sql
-- 只复制活跃用户
CREATE PUBLICATION active_users_pub FOR TABLE users
    WHERE (status = 'active');

-- 多条件过滤
CREATE PUBLICATION filtered_orders_pub FOR TABLE orders
    WHERE (region = 'US' OR region = 'EU');
```

### 复制的 DDL

```sql
-- 逻辑复制默认不复制 DDL
-- 需要手动同步 DDL

-- 方案一：使用事件触发器
CREATE OR REPLACE FUNCTION replicate_ddl()
RETURNS event_trigger AS $$
BEGIN
    -- 将 DDL 复制到订阅端
    PERFORM dblink_exec(
        'dbname=subscriber_db',
        tg_argv[0]
    );
END;
$$ LANGUAGE plpgsql;

CREATE EVENT TRIGGER ddl_capture
ON ddl_command_end
WHEN TAG IN ('CREATE TABLE', 'ALTER TABLE', 'DROP TABLE')
EXECUTE FUNCTION replicate_ddl();
```

### 故障恢复

```sql
-- 禁用订阅
ALTER SUBSCRIPTION my_subscription DISABLE;

-- 重新启用
ALTER SUBSCRIPTION my_subscription ENABLE;

-- 重新同步
ALTER SUBSCRIPTION my_subscription REFRESH PUBLICATION;

-- 删除并重建
DROP SUBSCRIPTION my_subscription;
CREATE SUBSCRIPTION my_subscription ...;
```

## 逻辑复制 vs 物理复制

| 特性 | 逻辑复制 | 物理复制 |
|------|---------|---------|
| 复制粒度 | 表级 | 实例级 |
| 数据过滤 | 支持 | 不支持 |
| 跨版本 | 支持 | 不支持 |
| DDL 复制 | 不支持 | 支持 |
| 性能 | 较低 | 较高 |
| 延迟 | 可能较高 | 低 |
| 用途 | 数据同步、CDC | HA、备份 |

## 实际应用场景

### 场景一：读写分离（逻辑复制）

```sql
-- 发布端
CREATE PUBLICATION read_only_pub FOR ALL TABLES;

-- 订阅端
CREATE SUBSCRIPTION read_only_sub
CONNECTION 'host=primary dbname=mydb'
PUBLICATION read_only_pub;

-- 订阅端设置为只读
ALTER DATABASE subscriber_db SET default_transaction_read_only = on;
```

### 场景二：数据汇聚（多对一复制）

```
┌─────────┐         ┌─────────┐
│ Region A│         │ Region B│
│  用户表  │ ──────→│         │
└─────────┘         │ 汇聚节点 │
                    │         │
┌─────────┐         │         │
│ Region C│ ──────→│         │
│  用户表  │         └─────────┘
└─────────┘
```

### 场景三：CDC（变更数据捕获）

```sql
-- 使用逻辑复制捕获变更
CREATE PUBLICATION cdc_pub FOR ALL TABLES
    WITH (publish = 'insert, update, delete');

-- 订阅端处理变更
-- 可以将变更发送到消息队列
-- 用于数据同步到 Elasticsearch、数据仓库等
```

### 场景四：跨版本升级

```
PostgreSQL 14 ──────→ PostgreSQL 16
  逻辑复制        ──────→ 不停机升级
```

## 性能调优

### 复制槽

```sql
-- 创建复制槽
SELECT pg_create_logical_replication_slot(
    'my_slot',
    'pgoutput'
);

-- 查看复制槽
SELECT * FROM pg_replication_slots
WHERE slot_type = 'logical';
```

### 并行复制

```sql
-- postgresql.conf
max_logical_replication_workers = 4
max_sync_workers_per_subscription = 2

-- 订阅端并行应用
ALTER SUBSCRIPTION my_subscription SET (copy_publications = true);
```

### 监控

```sql
-- 查看复制状态
SELECT 
    subname,
    subenabled,
    sub received_lsn,
    sub latest_end_lsn,
    sub latest_end_time
FROM pg_stat_subscription;

-- 查看复制延迟
SELECT 
    subname,
    (sent_lsn - confirmed_flush_lsn) AS lag_bytes
FROM pg_stat_subscription_internal;
```

## 常见问题

### 问题一：初始复制卡住

```sql
-- 检查复制状态
SELECT * FROM pg_stat_subscription;

-- 查看是否有错误
SELECT * FROM pg_stat_subscription_errors;

-- 强制刷新
ALTER SUBSCRIPTION my_subscription REFRESH PUBLICATION;

-- 检查大表，可能需要较长时间
```

### 问题二：订阅端数据不一致

```sql
-- 重建订阅
ALTER SUBSCRIPTION my_subscription DISABLE;
DROP SUBSCRIPTION my_subscription;

-- 删除订阅端表
DROP TABLE users CASCADE;

-- 重建订阅
CREATE SUBSCRIPTION my_subscription ...;
```

### 问题三：复制延迟过大

```sql
-- 检查网络延迟
SELECT * FROM pg_stat_subscription;

-- 调整并行度
ALTER SUBSCRIPTION my_subscription SET (max_parallel_workers = 4);

-- 检查订阅端负载
SELECT * FROM pg_stat_activity WHERE state = 'applying';
```

## 面试高频问题

### Q1: 逻辑复制和物理复制的区别？

**考察点**：复制原理

**参考答案**：
- 物理复制：复制整个数据库实例，基于 WAL
- 逻辑复制：复制特定表，基于逻辑解码
- 逻辑复制可以过滤数据、跨版本复制
- 物理复制性能更高

### Q2: 逻辑复制有什么限制？

**考察点**：复制限制

**参考答案**：
1. 不复制 DDL（需要手动处理）
2. 不复制序列
3. 不复制大对象（LO）
4. 初始复制可能很慢
5. 需要处理冲突

### Q3: 逻辑复制的典型应用场景？

**考察点**：实际应用

**参考答案**：
1. 读写分离
2. 数据汇聚（多对一）
3. CDC（变更数据捕获）
4. 跨版本升级
5. 数据同步到其他系统

### Q4: 如何处理逻辑复制的 DDL？

**考察点**：DDL 复制

**参考答案**：
1. 手动同步 DDL
2. 使用事件触发器
3. 使用第三方工具（如 pg-changetracking）
4. 订阅端使用 dblink 执行 DDL

## 总结

逻辑复制 vs 物理复制：

| 场景 | 推荐复制方式 |
|------|------------|
| HA 主从 | 物理复制 |
| 读写分离 | 物理复制或逻辑复制 |
| 数据同步 | 逻辑复制 |
| CDC | 逻辑复制 |
| 跨版本升级 | 逻辑复制 |

选择依据：
- 是否需要数据过滤
- 是否跨版本
- 是否需要低延迟
- DDL 是否需要同步
