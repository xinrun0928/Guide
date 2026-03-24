# PostgreSQL 分区表：Range、List、Hash 分区

1000 万条订单数据，全挤在一张表里。

查询越来越慢，索引越来越大，备份越来越久。

怎么办？

分区表。

今天，我们来聊聊 PostgreSQL 的分区表。

## 分区表基础

### 什么是分区表

分区表是将一个大表物理分成多个小表，这些小表叫做「分区」：

```
orders 表（未分区）：
┌─────────────────────────────────────────────────────┐
│ orders (1000 万行)                                   │
│ - 索引巨大                                          │
│ - 全表扫描极慢                                      │
│ - 备份/恢复都要操作整个表                           │
└─────────────────────────────────────────────────────┘

orders 表（按月分区）：
┌─────────────────────────────────────────────────────┐
│ orders (主表)                                        │
│ ├── orders_2026_01 (100 万行)                      │
│ ├── orders_2026_02 (100 万行)                      │
│ ├── orders_2026_03 (100 万行)                      │
│ └── ...                                             │
└─────────────────────────────────────────────────────┘
```

### 分区表的优势

1. **查询性能提升**：只扫描相关分区
2. **索引更小**：每个分区的索引更小、更高效
3. **批量删除**：DROP PARTITION 比 DELETE 快
4. **备份恢复**：可以独立备份/恢复分区
5. **数据管理**：历史数据可以归档或删除

## 分区类型

### 1. Range 分区（范围分区）

按数值或日期范围分区，最常用的类型：

```sql
-- 创建分区表（按月分区）
CREATE TABLE orders (
    id BIGSERIAL,
    customer_id BIGINT,
    total_amount NUMERIC(10,2),
    status VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (created_at);

-- 创建分区
CREATE TABLE orders_2026_01 PARTITION OF orders
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE orders_2026_02 PARTITION OF orders
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE orders_2026_03 PARTITION OF orders
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- 插入数据
INSERT INTO orders (customer_id, total_amount, status, created_at)
VALUES (1, 99.99, 'pending', '2026-01-15 10:00:00');

-- 查询自动路由到对应分区
SELECT * FROM orders WHERE created_at BETWEEN '2026-01-01' AND '2026-01-31';
```

### 2. List 分区（列表分区）

按枚举值分区：

```sql
-- 创建分区表（按地区分区）
CREATE TABLE products (
    id SERIAL,
    name VARCHAR(100),
    category VARCHAR(50),
    price NUMERIC(10,2)
) PARTITION BY LIST (category);

-- 创建分区
CREATE TABLE products_electronics PARTITION OF products
    FOR VALUES IN ('electronics', 'computers', 'phones');

CREATE TABLE products_clothing PARTITION OF products
    FOR VALUES IN ('clothing', 'shoes', 'accessories');

CREATE TABLE products_food PARTITION OF products
    FOR VALUES IN ('food', 'beverages', 'snacks');

CREATE TABLE products_other PARTITION OF products
    FOR VALUES IN (DEFAULT);  -- 其他类别

-- 查询
SELECT * FROM products WHERE category = 'electronics';
```

### 3. Hash 分区（哈希分区）

按哈希值均匀分布：

```sql
-- 创建分区表（哈希分区）
CREATE TABLE user_sessions (
    id BIGSERIAL,
    user_id BIGINT,
    session_token VARCHAR(100),
    created_at TIMESTAMPTZ
) PARTITION BY HASH (user_id);

-- 创建 8 个分区
CREATE TABLE user_sessions_0 PARTITION OF user_sessions
    FOR VALUES WITH (MODULUS 8, REMAINDER 0);

CREATE TABLE user_sessions_1 PARTITION OF user_sessions
    FOR VALUES WITH (MODULUS 8, REMAINDER 1);

-- ... 其他分区 2-7

-- 数据自动均匀分布
INSERT INTO user_sessions (user_id, session_token)
SELECT i, 'token_' || i FROM generate_series(1, 10000) i;
```

## 子分区（多级分区）

### 范围 + 列表组合

```sql
-- 创建多级分区表
CREATE TABLE sales (
    id SERIAL,
    region VARCHAR(50),
    sale_date DATE,
    amount NUMERIC(10,2)
) PARTITION BY RANGE (sale_date);

-- 创建主分区（按年）
CREATE TABLE sales_2026 PARTITION OF sales
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')
    PARTITION BY LIST (region);

-- 创建子分区（按地区）
CREATE TABLE sales_2026_north PARTITION OF sales_2026
    FOR VALUES IN ('north', 'northeast', 'northwest');

CREATE TABLE sales_2026_south PARTITION OF sales_2026
    FOR VALUES IN ('south', 'southeast', 'southwest');

CREATE TABLE sales_2026_central PARTITION OF sales_2026
    FOR VALUES IN ('central', 'east', 'west');
```

## 索引与分区

### 分区表索引

```sql
-- 在分区表上创建索引（自动应用到所有分区）
CREATE INDEX idx_orders_customer ON orders (customer_id);
CREATE INDEX idx_orders_status ON orders (status);
CREATE INDEX idx_orders_created ON orders (created_at);

-- 为特定分区创建索引
CREATE INDEX idx_orders_2026_01_customer ON orders_2026_01 (customer_id);

-- 索引自动继承
-- 每个分区都有 idx_orders_customer 索引
```

### 本地索引 vs 全局索引

```
PostgreSQL 分区表使用本地索引：
┌─────────────────────────────────────────────────────┐
│ orders (主表)                                        │
│ ├── orders_2026_01                                 │
│ │   └── idx_orders_customer (本地索引)             │
│ ├── orders_2026_02                                 │
│ │   └── idx_orders_customer (本地索引)             │
│ └── orders_2026_03                                 │
│     └── idx_orders_customer (本地索引)             │
└─────────────────────────────────────────────────────┘

PostgreSQL 不支持全局索引
```

## 分区管理

### 添加分区

```sql
-- 预创建未来分区
CREATE TABLE orders_2026_04 PARTITION OF orders
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE orders_2026_05 PARTITION OF orders
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
```

### 分离分区

```sql
-- 将分区从主表分离（可以独立管理）
ALTER TABLE orders DETACH PARTITION orders_2025_01;

-- 分离后可以单独备份或删除
```

### 附加分区

```sql
-- 将分区重新附加
ALTER TABLE orders ATTACH PARTITION orders_2025_01
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
```

### 删除旧分区

```sql
-- 方式 1：删除分区（数据也删除）
DROP TABLE orders_2024_01;

-- 方式 2：分离后归档
ALTER TABLE orders DETACH PARTITION orders_2024_01;
-- 然后备份或删除数据文件

-- 方式 3：交换分区（推荐）
CREATE TABLE orders_archive (LIKE orders INCLUDING ALL);
ALTER TABLE orders DETACH PARTITION orders_2024_01;
ALTER TABLE orders_archive ATTACH PARTITION orders_2024_01 
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
```

### 自动分区（PostgreSQL 17+）

```sql
-- PostgreSQL 17 支持自动分区
CREATE TABLE orders (
    id BIGSERIAL,
    created_at TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (created_at);

-- 自动创建分区（需要 pg_partman 扩展）
```

### 使用 pg_partman 管理分区

```bash
# 安装 pg_partman
CREATE EXTENSION pg_partman;

# 配置自动分区
SELECT partman.create_parent(
    p_main_table => 'public.orders',
    p_partition_type => 'range',
    p_interval => 'monthly',
    p_premake => 4,
    p_start_partition => '2026-01-01'
);

# 查看分区
SELECT partition_table_name, 
       pg_get_expr(partition_bound_spec, partition_table_name)
FROM pg_partman.part_config
WHERE parent_table = 'public.orders';
```

## 查询路由

### 自动路由

```sql
-- 查询自动路由到对应分区
EXPLAIN SELECT * FROM orders WHERE created_at = '2026-01-15';

-- 输出：
-- Append  (cost=0.00..0.00 rows=0 width=0)
--   ->  Seq Scan on orders_2026_01  -- 只扫描 2026_01 分区
--         Filter: (created_at = '2026-01-15'::date)
```

### 手动指定分区

```sql
-- 直接查询分区（绕过路由）
SELECT * FROM orders_2026_01 WHERE customer_id = 100;

-- 使用 ONLY 强制只查主表（查所有分区）
SELECT * FROM ONLY orders WHERE created_at = '2026-01-15';
```

## Java 应用

### JPA 实体映射

```java
@Entity
@Table(name = "orders")
public class Order {
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    private Long customerId;
    
    private BigDecimal totalAmount;
    
    private String status;
    
    @Column(name = "created_at")
    private Instant createdAt;
    
    // 分区键不需要特殊注解
}
```

### MyBatis 查询

```java
@Select("""
    SELECT * FROM orders 
    WHERE created_at >= #{startDate} 
      AND created_at < #{endDate}
      AND customer_id = #{customerId}
    ORDER BY created_at DESC
    LIMIT #{limit}
    """)
List<Order> findOrders(
    @Param("startDate") Instant startDate,
    @Param("endDate") Instant endDate,
    @Param("customerId") Long customerId,
    @Param("limit") int limit
);
```

## 性能优化

### 分区剪裁（Partition Pruning）

```sql
-- 查看分区剪裁
EXPLAIN SELECT * FROM orders WHERE created_at = '2026-01-15';

-- 强制禁用分区剪裁（调试用）
SET enable_partition_pruning = off;
```

### 分区键选择

```
分区键选择原则：

✅ 选择查询条件经常包含的列
✅ 选择数据分布均匀的列
✅ 选择有明确边界可以划分的列

❌ 不要选择高基数的列（会导致过多分区）
❌ 不要选择很少在 WHERE 中出现的列
```

### 分区数量控制

```
分区数量建议：
- 每个分区 100 万行左右最佳
- 总分区数控制在 100 个以内
- 避免过多小分区（增加查询规划时间）
```

## 面试高频问题

### Q1: PostgreSQL 分区表有哪些类型？

**考察点**：分区基础

**参考答案**：
- Range 分区：按数值/日期范围
- List 分区：按枚举值
- Hash 分区：按哈希值均匀分布
- 多级分区：范围 + 列表/哈希组合

### Q2: 分区表有什么优势？

**考察点**：分区原理

**参考答案**：
1. 查询只扫描相关分区，性能提升
2. 每个分区索引更小
3. 批量删除用 DROP PARTITION，极快
4. 可独立备份/恢复分区
5. 历史数据归档方便

### Q3: 分区表有哪些限制？

**考察点**：工程实践

**参考答案**：
1. 主键必须包含分区键
2. 分区键只能有一个
3. 不支持全局索引
4. 太多分区会增加查询规划时间
5. 需要定期创建新分区

### Q4: 如何选择分区键？

**考察点**：分区设计

**参考答案**：
1. 查询条件经常包含
2. 有明确范围可以划分
3. 数据分布尽量均匀
4. 常见选择：日期、地区、用户类型

## 总结

| 分区类型 | 适用场景 | 示例 |
|---------|---------|------|
| Range | 时间序列数据 | 订单、日志 |
| List | 枚举类型数据 | 地区、类别 |
| Hash | 均匀分布需求 | 用户 ID、会话 |
| 多级 | 复杂查询模式 | 销售数据 |

分区表是处理大数据的利器，但要合理设计分区策略：
- 分区键要匹配查询模式
- 分区大小要适中
- 定期维护新分区
- 及时归档/删除旧分区
