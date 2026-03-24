# PostgreSQL 常用数据类型与高级类型

MySQL 里有 VARCHAR、TEXT、DATE...

PostgreSQL 呢？

有 VARCHAR、TTEXT、DATE，但远不止这些。

你能想象一个字段直接存储一个坐标点、一段 IP 地址、一组标签列表、或者一个 JSON 对象吗？

PostgreSQL 告诉你：当然可以，而且还能建索引。

今天，我们来聊聊 PostgreSQL 的数据类型体系。

## 基础数据类型

### 数值类型

| 类型名 | 说明 | 范围 |
|--------|------|------|
| SMALLINT (INT2) | 2 字节整数 | -32768 ~ 32767 |
| INTEGER (INT, INT4) | 4 字节整数 | -2147483648 ~ 2147483647 |
| BIGINT (INT8) | 8 字节整数 | -9223372036854775808 ~ 9223372036854775807 |
| NUMERIC(p, s) / DECIMAL(p, s) | 精确小数 | 最高 131072 位整数 |
| REAL (FLOAT4) | 4 字节浮点 | 6 位十进制精度 |
| DOUBLE PRECISION (FLOAT8) | 8 字节浮点 | 15 位十进制精度 |
| SERIAL | 自增整数 | 1 ~ 2147483647 |
| BIGSERIAL | 大自增整数 | 1 ~ 9223372036854775807 |

```sql
-- 创建表，演示数值类型
CREATE TABLE products (
    id SERIAL PRIMARY KEY,          -- 自增 ID
    code SMALLINT NOT NULL,         -- 产品代码
    price NUMERIC(10, 2),           -- 价格，精确到分
    rating REAL,                     -- 评分，浮点数
    stock_count BIGINT DEFAULT 0     -- 库存，大整数
);

-- 插入数据
INSERT INTO products (code, price, rating, stock_count) 
VALUES (1001, 99.99, 4.5, 1000000000);
```

**数值类型选择建议**：
- 大部分场景用 INTEGER
- 金额必须用 NUMERIC，避免浮点精度问题
- 统计类分析可用 DOUBLE PRECISION
- ID 推荐用 SERIAL 或 BIGSERIAL

### 字符类型

| 类型名 | 说明 |
|--------|------|
| VARCHAR(n) | 变长字符，最大 n 个字符 |
| CHAR(n) | 定长字符，不足用空格补齐 |
| TEXT | 变长字符，无长度限制 |
| BPCHAR | CHAR 的内部名称 |

```sql
CREATE TABLE users (
    username VARCHAR(50) NOT NULL,  -- 最大 50 字符
    nickname CHAR(20),             -- 固定 20 字符，不足补空格
    bio TEXT                        -- 无限制文本
);

-- 注意：VARCHAR(n) 中的 n 是字符数，不是字节数
-- PostgreSQL 默认支持 UTF-8，一个中文字符占 3 字节
-- VARCHAR(10) 可以存储 10 个中文字符
```

**字符类型选择**：
- 有明确长度限制用 VARCHAR(n)
- 固定格式用 CHAR(n)（如国家代码：CN、US）
- 无限制文本用 TEXT
- 避免用 VARCHAR 而不指定长度（等同于 TEXT）

### 日期时间类型

| 类型名 | 说明 | 范围 |
|--------|------|------|
| DATE | 日期 | 4713 BC ~ 294276 AD |
| TIME | 时间 | 00:00:00 ~ 24:00:00 |
| TIMESTAMP | 日期时间（无时区） | 4713 BC ~ 294276 AD |
| TIMESTAMPTZ | 日期时间（有时区） | 4713 BC ~ 294276 AD |
| INTERVAL | 时间间隔 | 任意 |

```sql
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    event_name VARCHAR(100),
    start_date DATE,
    start_time TIME,
    start_datetime TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    duration INTERVAL '2 hours 30 minutes'
);

-- 插入带时区的数据
INSERT INTO events (event_name, start_datetime, created_at)
VALUES (
    'Conference', 
    '2026-03-20 09:00:00',
    '2026-03-20 09:00:00+08'  -- 指定时区
);

-- 时间计算
SELECT 
    start_datetime,
    start_datetime + INTERVAL '1 day' AS next_day,
    start_datetime - created_at AS elapsed  -- 返回 INTERVAL
FROM events;

-- 提取日期部分
SELECT 
    created_at,
    DATE(created_at) AS date_only,
    EXTRACT(YEAR FROM created_at) AS year,
    EXTRACT(MONTH FROM created_at) AS month,
    EXTRACT(DAY FROM created_at) AS day;
```

**TIMESTAMP vs TIMESTAMPTZ**：
- TIMESTAMP：存储本地时间，不带时区信息
- TIMESTAMPTZ：存储 UTC 时间，自动转换显示

```sql
-- 如果用户分布在全球，用 TIMESTAMPTZ
-- 存储时自动转为 UTC，读取时自动转为客户端时区
SET TIMEZONE = 'UTC';
SET TIMEZONE = 'Asia/Shanghai';
```

## 高级数据类型

### JSON 和 JSONB

JSONB 是 PostgreSQL 处理 JSON 数据的利器。相比 JSON 类型，JSONB 以二进制格式存储，支持索引。

| 类型 | 存储格式 | 保留空格 | 支持索引 | 查询性能 |
|------|---------|---------|---------|---------|
| JSON | 原始文本 | 是 | 否 | 较慢 |
| JSONB | 二进制 | 否 | 是 | 快 |

```sql
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    order_data JSONB  -- 推荐用 JSONB
);

-- 插入 JSON 数据
INSERT INTO orders (order_data) VALUES (
    '{
        "customer": "Alice",
        "items": [
            {"product": "Book", "quantity": 2, "price": 29.99},
            {"product": "Pen", "quantity": 5, "price": 2.50}
        ],
        "shipping": {
            "address": "123 Main St",
            "city": "Beijing",
            "zip": "100000"
        }
    }'::JSONB
);

-- 查询 JSON 字段
-- -> 操作符返回 JSON 类型
-- ->> 操作符返回 TEXT 类型
SELECT 
    order_data->>'customer' AS customer_name,  -- 返回 "Alice"
    order_data->'shipping'->>'city' AS city,  -- 嵌套查询
    order_data->'items'->0->>'product' AS first_item  -- 数组索引
FROM orders;

-- JSONB 特定操作符
SELECT * FROM orders 
WHERE order_data @> '{"customer": "Alice"}';  -- 包含指定键值

SELECT * FROM orders 
WHERE order_data ? 'shipping';  -- 包含指定键

SELECT * FROM orders 
WHERE order_data ?& array['customer', 'shipping'];  -- 同时包含多个键

-- JSONB 路径查询（PostgreSQL 14+）
SELECT order_data.jsonb_path_query('$.items[*].price') 
FROM orders;

-- 为 JSONB 字段建索引
CREATE INDEX idx_order_customer ON orders USING GIN (order_data);

-- 表达式索引：索引特定路径
CREATE INDEX idx_order_city ON orders ((order_data->>'shipping'));
```

### 数组类型

PostgreSQL 原生支持数组类型，这在其他数据库中需要额外表来实现。

```sql
CREATE TABLE tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50),
    article_ids INTEGER[],  -- 数组字段
    keywords TEXT[]          -- 文本数组
);

-- 插入数组
INSERT INTO tags (name, article_ids, keywords) VALUES (
    'Java',
    ARRAY[1, 2, 3],
    ARRAY['programming', 'backend', 'spring']
);

-- 查询数组
-- ANY：匹配数组中任意元素
SELECT * FROM tags WHERE 2 = ANY(article_ids);

-- ALL：匹配数组中所有元素
SELECT * FROM tags WHERE keywords @> ARRAY['programming', 'backend'];

-- 包含：数组完全包含指定元素
SELECT * FROM tags WHERE article_ids @> ARRAY[1, 2];

-- 重叠：数组与指定元素有交集
SELECT * FROM tags WHERE article_ids && ARRAY[2, 4];

-- 数组函数
SELECT 
    array_length(keywords, 1) AS keyword_count,  -- 数组长度
    unnest(keywords) AS keyword                    -- 展开数组
FROM tags;

-- 更新数组
UPDATE tags 
SET article_ids = array_append(article_ids, 4) 
WHERE name = 'Java';

UPDATE tags 
SET article_ids = array_remove(article_ids, 2) 
WHERE name = 'Java';
```

### 范围类型

范围类型可以表示一个连续区间，常用于日程、资源预订等场景。

| 类型 | 说明 |
|------|------|
| int4range | INTEGER 范围 |
| int8range | BIGINT 范围 |
| numrange | NUMERIC 范围 |
| tsrange | TIMESTAMP 范围（无时区） |
| tstzrange | TIMESTAMP 范围（有时区） |
| daterange | DATE 范围 |

```sql
-- 创建预订表
CREATE TABLE reservations (
    id SERIAL PRIMARY KEY,
    room_id INT,
    guest_name VARCHAR(100),
    period TSTZRANGE  -- 时间范围
);

-- 插入数据
INSERT INTO reservations (room_id, guest_name, period) VALUES (
    101,
    'Alice',
    '[2026-03-20 14:00, 2026-03-22 12:00)'  -- 左闭右开区间
);

-- 查询范围
-- &&：范围重叠
SELECT * FROM reservations r1
WHERE EXISTS (
    SELECT 1 FROM reservations r2
    WHERE r1.id != r2.id
    AND r1.room_id = r2.room_id
    AND r1.period && r2.period  -- 检查时间冲突
);

-- @>：范围包含
SELECT * FROM reservations 
WHERE period @> '2026-03-21 10:00'::TIMESTAMPTZ;

-- 提取范围边界
SELECT 
    lower_bound(period) AS start_time,
    upper_bound(period) AS end_time,
    lower_inc(period) AS is_start_inclusive,   -- 下界是否包含
    upper_inc(period) AS is_end_inclusive     -- 上界是否包含
FROM reservations;

-- 创建排除约束（防止重叠预订）
ALTER TABLE reservations 
ADD CONSTRAINT no_overlap_reservation
EXCLUDE USING GIST (
    room_id WITH =,
    period WITH &&
);
```

### UUID 类型

```sql
-- UUID v4 生成
SELECT gen_random_uuid();  -- 9d8e7c6b-5a4f-3e2d-1c0b-9a8f7e6d5c4b

-- 或使用 uuid-ossp 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
SELECT uuid_generate_v4();

-- 使用 UUID 作为主键
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 分布式环境下，UUID 比自增 ID 更安全
-- 不需要中心化的 ID 生成服务
```

### 网络地址类型

PostgreSQL 内置了网络相关的数据类型。

```sql
-- IP 地址
CREATE TABLE hosts (
    id SERIAL PRIMARY KEY,
    ip INET,
    mac_address MACADDR,
    network CIDR  -- 网段
);

INSERT INTO hosts (ip, mac_address, network) VALUES (
    '192.168.1.100',
    '08:00:27:ce:35:51',
    '192.168.1.0/24'
);

-- 查询网络
SELECT * FROM hosts WHERE ip << '192.168.0.0/16';  -- IP 在网段内

-- 提取 IP 信息
SELECT 
    ip,
    host(ip) AS ip_address,
    text(ip) AS ip_text,
    family(ip) AS ip_family  -- 4=IPv4, 6=IPv6
FROM hosts;
```

### 枚举类型

```sql
-- 创建枚举类型
CREATE TYPE order_status AS ENUM (
    'pending',      -- 待处理
    'processing',   -- 处理中
    'shipped',      -- 已发货
    'delivered',    -- 已送达
    'cancelled'     -- 已取消
);

-- 使用枚举
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    status order_status DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 修改枚举值（PostgreSQL 14+）
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'refunded';

-- 查询枚举
SELECT * FROM orders WHERE status = 'pending';
SELECT * FROM orders WHERE status IN ('pending', 'processing');

-- 枚举排序按定义顺序
SELECT * FROM orders ORDER BY status;
```

### 几何类型

PostgreSQL 原生支持二维几何类型：

```sql
-- 点
SELECT point(0, 0);
SELECT '(0,0)'::POINT;

-- 线段
SELECT lseg(point(0,0), point(1,1));

-- 矩形
SELECT box(point(0,0), point(1,1));
SELECT '(0,0),(1,1)'::BOX;

-- 圆
SELECT circle(point(0,0), 1);

-- 多边形
SELECT polygon(circle(point(0,0), 1), ARRAY[point(1,0), point(0,1)]);

-- 距离计算
SELECT 
    point(0,0) <-> point(3,4) AS distance;  -- 计算两点距离：5

-- 实际应用（需要 PostGIS 扩展）
-- 见后续 PostGIS 章节
```

## 复合类型与域

### 自定义复合类型

```sql
-- 创建复合类型
CREATE TYPE inventory_item AS (
    product_name VARCHAR(100),
    supplier_id INT,
    quantity INT
);

-- 使用复合类型
CREATE TABLE warehouse (
    id SERIAL PRIMARY KEY,
    item inventory_item
);

-- 插入数据
INSERT INTO warehouse (item) VALUES (
    ('Widget', 101, 50)
);

-- 查询复合类型
SELECT 
    item.product_name,
    item.quantity
FROM warehouse;
```

### 域（Domain）

域是基于现有类型定义的约束类型：

```sql
-- 创建域：正整数
CREATE DOMAIN positive_int AS INT CHECK (VALUE > 0);

-- 创建域：邮编格式
CREATE DOMAIN us_zipcode AS TEXT 
CHECK (VALUE ~ '^\d{5}(-\d{4})?$');

-- 使用域
CREATE TABLE addresses (
    id SERIAL PRIMARY KEY,
    zip us_zipcode,      -- 自动验证格式
    building_num positive_int  -- 必须大于 0
);

-- 插入测试
INSERT INTO addresses (zip, building_num) VALUES ('12345', 100);  -- OK
INSERT INTO addresses (zip, building_num) VALUES ('abcde', 100);   -- 错误！
INSERT INTO addresses (zip, building_num) VALUES ('12345', -5);   -- 错误！
```

## 类型转换

### 显式转换

```sql
-- :: 操作符（PostgreSQL 风格）
SELECT '123'::INTEGER;
SELECT '2026-03-20'::DATE;
SELECT '99.99'::NUMERIC(5,2);

-- CAST 函数（标准 SQL）
SELECT CAST('123' AS INTEGER);
SELECT CAST('2026-03-20' AS DATE);

-- 函数风格
SELECT INTEGER '123';
SELECT DATE '2026-03-20';
```

### 自动类型转换

```sql
-- 字符串自动转日期
SELECT '2026-03-20'::DATE + '1 day'::INTERVAL;

-- 数字运算中的自动转换
SELECT 1 + 2.5;  -- INTEGER + NUMERIC → NUMERIC
```

## 面试高频问题

### Q1: PostgreSQL 支持哪些 MySQL 没有的数据类型？

**考察点**：知识广度

**参考答案**：
1. 数组类型（INTEGER[]、TEXT[]）
2. JSONB 类型（二进制 JSON，支持索引）
3. 范围类型（TSRANGE、INT4RANGE 等）
4. UUID 类型
5. 网络地址类型（INET、CIDR、MACADDR）
6. 几何类型（POINT、LINE、BOX 等）
7. 枚举类型
8. 复合类型

### Q2: JSON 和 JSONB 的区别是什么？

**考察点**：JSON 处理能力

**参考答案**：
- JSON 存储原始文本，保留格式
- JSONB 存储二进制格式，不保留空格
- JSONB 支持 GIN 索引
- JSONB 查询性能更好
- 选择：大多数场景用 JSONB，只有需要保留原始格式才用 JSON

### Q3: 什么时候用数组类型而不是关联表？

**考察点**：数据模型设计

**参考答案**：
- 数组适合：标签列表、小型集合、配置参数
- 关联表适合：需要单独维护的实体、关系复杂、需要 JOIN 查询
- 关键考虑：是否需要单独索引、是否需要事务一致性、数组元素数量是否固定

## 总结

PostgreSQL 的数据类型体系非常丰富：

| 类别 | 代表类型 | MySQL 对比 |
|------|---------|-----------|
| 数值 | NUMERIC、SERIAL | 类似 |
| 字符 | VARCHAR、TEXT | 类似 |
| 日期时间 | TIMESTAMPTZ | 更丰富（有时区支持） |
| JSON | JSONB | PostgreSQL 更强 |
| 数组 | INTEGER[] | PostgreSQL 独有 |
| 范围 | TSRANGE | PostgreSQL 独有 |
| UUID | UUID | MySQL 8.0+ 支持 |
| 网络 | INET、CIDR | PostgreSQL 独有 |
| 几何 | POINT | MySQL 有但不完善 |

善用这些数据类型，可以简化模型设计、提升查询效率。
