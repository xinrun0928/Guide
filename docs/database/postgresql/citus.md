# PostgreSQL Citus 分布式集群扩展

单机 PostgreSQL 支撑不住了？

想横向扩展 PostgreSQL？

今天，我们来聊聊 Citus——PostgreSQL 的分布式扩展。

## Citus 简介

### 什么是 Citus

Citus 是 PostgreSQL 的分布式扩展，将 PostgreSQL 变成一个分布式数据库：

```
┌─────────────────────────────────────────────────────────┐
│                    Citus Coordinator                    │
│                     (协调节点)                          │
│  ┌─────────────────────────────────────────────────┐ │
│  │            SQL 解析 & 分布式查询规划                 │ │
│  └─────────────────────────────────────────────────┘ │
└────────────────────┬────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Worker 1   │ │   Worker 2   │ │   Worker 3   │
│  (工作节点)   │ │  (工作节点)   │ │  (工作节点)   │
│  分片 1, 4   │ │  分片 2, 5   │ │  分片 3, 6   │
└──────────────┘ └──────────────┘ └──────────────┘
```

### Citus vs 单机 PostgreSQL

| 特性 | 单机 PostgreSQL | Citus |
|------|----------------|-------|
| 数据量 | TB 级 | PB 级 |
| 并发 | 数千连接 | 数十万连接 |
| 写入 | 单机 | 分布式写入 |
| 扩展性 | 垂直扩展 | 水平扩展 |
| 查询 | 标准 SQL | 分布式 SQL |

## Citus 核心概念

### 分片（Shard）

数据被分成多个分片，分布在不同工作节点：

```
orders 表分片：

┌─────────┐    ┌─────────┐    ┌─────────┐
│ Shard 1  │    │ Shard 2  │    │ Shard 3  │
│ user_id   │    │ user_id   │    │ user_id   │
│ 1-333333 │    │ 333334-  │    │ 666667-  │
│           │    │ 666666   │    │ 1000000  │
└─────────┘    └─────────┘    └─────────┘
```

### 分布列（Distribution Column）

决定数据如何分布的列：

```sql
-- 按 user_id 分布
SELECT create_distributed_table('orders', 'user_id');

-- 按 country 分布
SELECT create_distributed_table('products', 'country');
```

### 分片副本

每个分片可以有多个副本：

```sql
-- 创建具有副本的分片
SELECT create_distributed_table(
    'orders', 
    'user_id',
    shard_count => 8,
    shard_replication_factor => 2
);
```

## 配置 Citus

### 单机模式（开发）

```bash
# 安装 Citus 扩展
CREATE EXTENSION IF NOT EXISTS citus;

# 设置 Citus 模式为单机
SELECT citus_set_coordinator_host('localhost', 5432);
```

### 集群模式（生产）

```sql
-- 添加工作节点
SELECT citus_add_node('worker1', 5432);
SELECT citus_add_node('worker2', 5432);
SELECT citus_add_node('worker3', 5432);

-- 查看集群状态
SELECT * FROM citus_get_active_worker_nodes();

-- 查看分片分布
SELECT * FROM citus_shards;
```

### Docker Compose 配置

```yaml
version: '3'
services:
  coordinator:
    image: citusdata/citus:12.1
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: mydb
    volumes:
      - coordinator_data:/var/lib/postgresql/data
    command: ["postgres", "-c", "shared_preload_libraries=citus", "-c", "citus.shard_count=32"]

  worker1:
    image: citusdata/citus:12.1
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    command: ["postgres", "-c", "shared_preload_libraries=citus", "-c", "citus.coordinator_host=coordinator"]

  worker2:
    image: citusdata/citus:12.1
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    command: ["postgres", "-c", "shared_preload_libraries=citus", "-c", "citus.coordinator_host=coordinator"]

volumes:
  coordinator_data:
```

## 创建分布式表

### 分布表

```sql
-- 创建分布表
SELECT create_distributed_table('orders', 'user_id');

-- 创建具有特定分片数
SELECT create_distributed_table(
    'orders', 
    'user_id',
    shard_count => 16
);

-- 创建参考表（复制到所有节点）
SELECT create_reference_table('countries');
SELECT create_reference_table('categories');

-- 查看分布
SELECT * FROM citus_tables;
```

### 共址表（Colocated Tables）

相关表分布到相同的节点：

```sql
-- orders 和 order_items 按 user_id 分布
SELECT create_distributed_table('orders', 'user_id');
SELECT create_distributed_table('order_items', 'user_id', colocate_with => 'orders');

-- 现在 JOIN 可以直接在分片内完成
SELECT * FROM orders o
JOIN order_items oi ON o.id = oi.order_id
WHERE o.user_id = 123;
```

### 本地表

不分布的表，只存在于协调节点：

```sql
-- 创建本地表
CREATE TABLE app_config (
    key VARCHAR PRIMARY KEY,
    value TEXT
);
-- 本地表不参与分布式查询
```

## 分布式查询

### 路由查询

协调节点根据分布列路由查询：

```sql
-- 路由到单个分片（快）
SELECT * FROM orders WHERE user_id = 123;

-- 全分片查询（慢）
SELECT COUNT(*) FROM orders;

-- 聚合查询
SELECT COUNT(*) FROM orders GROUP BY status;
```

### 分布式 JOIN

```sql
-- 分片内 JOIN（快）
SELECT * FROM orders o
JOIN order_items oi ON o.id = oi.order_id
WHERE o.user_id = 100;

-- 跨分片 JOIN（慢）
SELECT * FROM orders o
JOIN users u ON o.user_id = u.id
WHERE u.country = 'China';
```

### 分布式聚合

```sql
-- 分片聚合后汇总
SELECT 
    status,
    COUNT(*) as count,
    SUM(total) as total
FROM orders
GROUP BY status;
```

## 写入数据

### 插入

```sql
-- 直接插入（协调节点自动路由）
INSERT INTO orders (user_id, total, status) 
VALUES (123, 100.00, 'pending');

-- 批量插入
INSERT INTO orders (user_id, total, status)
SELECT user_id, total, status FROM staging_orders;

-- COPY 命令
COPY orders FROM '/tmp/orders.csv' WITH (FORMAT csv);
```

### 更新和删除

```sql
-- 更新（需要分布列）
UPDATE orders SET status = 'completed' WHERE user_id = 123;

-- 删除
DELETE FROM orders WHERE user_id = 123 AND status = 'cancelled';

-- 注意：没有分布列的更新会失败
UPDATE orders SET status = 'completed';  -- 错误！
```

## 分片管理

### 重新分片

```sql
-- 将分片数从 8 增加到 16
SELECT rebalance_table_shards('orders');

-- 排除特定节点
SELECT rebalance_table_shards('orders', exclude_nodes => ARRAY['worker3:5432']);
```

### 移动分片

```sql
-- 将特定分片移动到指定节点
SELECT citus_move_shard_placement(
    shardid := 102008,
    source_node := 'worker1:5432',
    target_node := 'worker2:5432'
);
```

### 查看分片

```sql
-- 查看分片分布
SELECT 
    nodename,
    shardid,
    shardlength
FROM citus_shards
WHERE logicalrelname = 'orders';

-- 查看分片健康
SELECT * FROM citus_check_shard_size('orders');
```

## 分布式事务

### 2PC 事务

跨分片的事务使用两阶段提交：

```sql
-- 开始分布式事务
BEGIN;

UPDATE orders SET status = 'completed' WHERE user_id = 123;
UPDATE payments SET status = 'completed' WHERE user_id = 123;

COMMIT;
-- 内部执行 2PC
```

### 分布式锁

```sql
-- 获取分布式锁
SELECT citus_lock_waits;

-- 避免分布式死锁
-- 总是按相同顺序访问资源
```

## 监控

### Citus 视图

```sql
-- 查看节点状态
SELECT * FROM citus_get_active_worker_nodes();

-- 查看分片分布
SELECT * FROM citus_shards;

-- 查看复制状态
SELECT * FROM citus_shard_replications;

-- 查看查询统计
SELECT * FROM citus_stat_activity;

-- 查看长时间运行的查询
SELECT * FROM citus_stat_activity 
WHERE state = 'active' 
AND query_start < NOW() - INTERVAL '1 minute';
```

### 常用监控查询

```sql
-- 查看每个节点的负载
SELECT 
    nodename,
    SUM(shardlength) / 1024 / 1024 AS total_mb
FROM citus_shards
GROUP BY nodename;

-- 查看分片延迟
SELECT 
    shardid,
    colocationid,
    shardname
FROM citus_shard_placement
WHERE shardstate != 1;

-- 查看分布式查询延迟
SELECT 
    datname,
    query,
    calls,
    mean_time
FROM citus_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

## 最佳实践

### 1. 选择分布列

```
✅ 好的分布列：
- 高选择性的列
- 经常用于 JOIN 的列
- 数据分布均匀的列

❌ 差的分布列：
- 低选择性的列（如状态）
- 经常更新的列
- 导致数据倾斜的列
```

### 2. 共址表设计

```sql
-- 经常一起查询的表放在相同节点
SELECT create_distributed_table('orders', 'user_id');
SELECT create_distributed_table('order_items', 'user_id', colocate_with => 'orders');
SELECT create_distributed_table('addresses', 'user_id', colocate_with => 'users');
```

### 3. 参考表

```sql
-- 小表、经常 JOIN 的表使用参考表
SELECT create_reference_table('countries');
SELECT create_reference_table('categories');
```

## 常见问题

### 问题一：查询失败

```sql
-- 没有分布列的查询会失败
SELECT * FROM orders;  -- 错误！

-- 解决方案：添加分布列条件
SELECT * FROM orders WHERE user_id > 0;
```

### 问题二：数据倾斜

```sql
-- 检查数据分布
SELECT 
    user_id,
    COUNT(*) as count
FROM orders
GROUP BY user_id
ORDER BY count DESC
LIMIT 10;

-- 重新分布
SELECT alter_distributed_table(
    'orders',
    shard_count => 32,
    colocate_with => 'none'
);
```

### 问题三：副本不同步

```sql
-- 检查副本状态
SELECT * FROM citus_shard_placement WHERE shardstate != 1;

-- 手动恢复副本
SELECT citus_copy_shard_placement(
    shardid := 102008,
    source_node := 'worker1:5432',
    target_node := 'worker2:5432'
);
```

## 面试高频问题

### Q1: Citus 是什么？如何扩展 PostgreSQL？

**考察点**：分布式概念

**参考答案**：
- Citus 是 PostgreSQL 的分布式扩展
- 将数据分片分布在多个节点
- 协调节点负责查询路由和聚合
- 支持水平扩展

### Q2: 如何选择分布列？

**考察点**：分片设计

**参考答案**：
1. 高选择性：使查询能路由到少量节点
2. 数据均匀：不导致数据倾斜
3. 不常更新：更新分布列代价大
4. 常用 JOIN 列：使分片内 JOIN 可行

### Q3: Citus 支持哪些类型的表？

**考察点**：表类型

**参考答案**：
- 分布表：数据分片到多个节点
- 参考表：复制到所有节点
- 共址表：分布在相同节点
- 本地表：只在协调节点

### Q4: Citus 的限制是什么？

**考察点**：限制理解

**参考答案**：
1. 分布式事务有额外开销
2. 某些 SQL 不支持
3. 分布列更新困难
4. 需要选择合适的分布列

## 总结

Citus 核心概念：

| 概念 | 说明 |
|------|------|
| 协调节点 | 接收请求、路由查询 |
| 工作节点 | 存储分片、执行查询 |
| 分片 | 数据的子集 |
| 分布列 | 决定数据分布的列 |

Citus 表类型：
| 类型 | 特点 |
|------|------|
| 分布表 | 数据分片，性能最佳 |
| 参考表 | 复制到所有节点，无 JOIN 限制 |
| 共址表 | 分布在相同节点，分片内 JOIN |
| 本地表 | 协调节点本地，不分布式 |

使用场景：
- 超大数据量（TB → PB）
- 高并发写入
- 分布式分析查询
- 多租户 SaaS 平台
