# 表结构设计优化：字段类型、冗余字段、拆分字段

同样的业务，你的表比别人的大 3 倍。

查询比别人的慢 5 倍。

问题可能出在表结构设计上。

今天，彻底搞清楚表结构设计的优化技巧。

---

## 字段类型选择

### 整数类型

```sql
-- 选择合适的大小

-- TINYINT：-128 ~ 127 或 0 ~ 255
-- SMALLINT：-32768 ~ 32767 或 0 ~ 65535
-- MEDIUMINT：-8388608 ~ 8388607 或 0 ~ 16777215
-- INT：-2147483648 ~ 2147483647 或 0 ~ 4294967295
-- BIGINT：更大的整数

-- 建议：
-- 状态字段用 TINYINT
-- 数量字段用 INT
-- 金额字段用 DECIMAL
-- ID 用 BIGINT
```

### 字符串类型

```sql
-- CHAR vs VARCHAR

-- CHAR：固定长度，不足右补空格
-- VARCHAR：可变长度，1-2 字节存储长度

-- 选择原则：
-- 1. 固定长度用 CHAR（手机号、邮编）
-- 2. 长度变化大用 VARCHAR
-- 3. 超长文本用 TEXT

-- VARCHAR 长度选择：
-- 手机号：VARCHAR(11)
-- 邮箱：VARCHAR(100)
-- 地址：VARCHAR(200)
-- 描述：VARCHAR(500)
```

### 日期类型

```sql
-- DATE：日期（2024-01-01）
-- DATETIME：日期时间（2024-01-01 12:00:00）
-- TIMESTAMP：时间戳（自动更新）

-- 选择原则：
-- 1. 需要时区用 TIMESTAMP
-- 2. 需要大范围日期用 DATETIME
-- 3. 只需要日期用 DATE

-- 建议：
-- 创建时间：DATETIME 或 TIMESTAMP
-- 更新时间：TIMESTAMP
-- 生日：DATE
```

### DECIMAL vs DOUBLE

```sql
-- 金额必须用 DECIMAL

-- ❌ 不要用 DOUBLE
CREATE TABLE order (
    price DOUBLE  -- 精度丢失！
);

-- ✅ 用 DECIMAL
CREATE TABLE order (
    price DECIMAL(10,2)  -- 10 位整数，2 位小数
);

-- DECIMAL 优点：
-- 1. 精确存储
-- 2. 适合财务计算
```

---

## 字段设计原则

### 主键设计

```sql
-- 优先使用自增 BIGINT 主键

-- ❌ 不要用 UUID
CREATE TABLE orders (
    id VARCHAR(36) PRIMARY KEY  -- UUID
);
-- 问题：索引效率低，插入随机

-- ✅ 用自增 BIGINT
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT
);
-- 优点：索引效率高，插入顺序
```

### NOT NULL

```sql
-- 字段尽量 NOT NULL

-- 优点：
-- 1. 索引效率高
-- 2. 查询更快
-- 3. 避免 NULL 判断

-- 示例：
-- ❌ name VARCHAR(50)
-- ✅ name VARCHAR(50) NOT NULL DEFAULT ''

-- 如果必须有 NULL：
-- 用空字符串或特殊值代替
```

### 默认值

```sql
-- 给字段设置默认值

-- 数字字段：
price DECIMAL(10,2) NOT NULL DEFAULT 0

-- 字符串字段：
name VARCHAR(50) NOT NULL DEFAULT ''

-- 时间字段：
create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP

-- 状态字段：
status TINYINT NOT NULL DEFAULT 0
```

---

## 冗余字段设计

### 何时冗余？

```sql
-- 冗余原则：
-- 1. 查询频率远高于更新频率
-- 2. 冗余字段查询不需要 JOIN
-- 3. 数据一致性可以接受

-- 示例：订单表冗余用户名
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    user_id INT,
    user_name VARCHAR(50),  -- 冗余
    total_amount DECIMAL(10,2),
    create_time DATETIME
);
```

### 冗余字段维护

```sql
-- 维护方式：

-- 1. 触发器（不推荐）
-- 性能差，不推荐

-- 2. 应用层双写
// 下单时同时更新用户名
public void createOrder(Order order) {
    orderMapper.insert(order);
    userMapper.updateName(order.getUserId(), order.getUserName());
}

-- 3. 异步同步
-- 使用 MQ 异步更新冗余字段

-- 4. 允许不一致
-- 定时任务补偿
```

---

## 表拆分设计

### 垂直拆分

```sql
-- 按业务拆分字段

-- 原始表：
CREATE TABLE user (
    id BIGINT,
    name VARCHAR(50),
    email VARCHAR(100),
    phone VARCHAR(20),
    avatar VARCHAR(200),  -- 大字段
    description TEXT,  -- 大字段
    ...
);

-- 拆分后：
CREATE TABLE user (
    id BIGINT,
    name VARCHAR(50),
    email VARCHAR(100),
    phone VARCHAR(20),
    ...
);

CREATE TABLE user_detail (
    user_id BIGINT,
    avatar VARCHAR(200),
    description TEXT
);
```

### 水平拆分

```sql
-- 按数据拆分行

-- 按时间拆分：
CREATE TABLE orders_2024 (
    ...
);

CREATE TABLE orders_2023 (
    ...
);

-- 按用户拆分：
CREATE TABLE orders_0 (
    ...
);

CREATE TABLE orders_1 (
    ...
);
```

---

## 表设计检查清单

### 必检项

```sql
-- 1. 主键类型：优先自增 BIGINT
-- 2. 字段类型：选择最小合适类型
-- 3. 金额字段：必须用 DECIMAL
-- 4. NOT NULL：尽量 NOT NULL
-- 5. 默认值：设置合理的默认值
-- 6. 索引：避免过多索引
-- 7. 大字段：单独存储
```

### 常见错误

```sql
-- ❌ 错误：
-- price DOUBLE  -- 金额不能用浮点
-- phone VARCHAR(200)  -- 手机号太长
-- name VARCHAR  -- 没指定长度
-- id VARCHAR(36)  -- ID 不要用字符串

-- ✅ 正确：
-- price DECIMAL(10,2)
-- phone VARCHAR(11)
-- name VARCHAR(50)
-- id BIGINT
```

---

## 面试高频追问

### Q1：主键用自增还是 UUID？

```sql
-- 自增 BIGINT：
-- 优点：索引效率高，插入顺序
-- 缺点：不能分布式

-- UUID：
-- 优点：全局唯一，可分布式
-- 缺点：索引效率低，插入随机

-- 建议：
-- 单机：自增 BIGINT
-- 分布式：雪花算法
```

### Q2：VARCHAR(255) 和 VARCHAR(256) 有区别吗？

```sql
-- VARCHAR(255)：
-- 1. 使用 1 字节存储长度
-- 2. 某些存储引擎更高效

-- VARCHAR(256)：
-- 1. 使用 2 字节存储长度
-- 2. 略微增加存储空间

-- 建议：
-- 255 是经验值，不是性能关键
-- 选择够用的长度即可
```

### Q3：为什么不要 SELECT *？

```sql
-- 原因：
-- 1. 增加网络传输
-- 2. 可能覆盖覆盖索引
-- 3. 无法利用索引覆盖
-- 4. 字段多时性能差

-- 建议：
-- 明确列出需要的字段
SELECT id, name, price FROM orders;
```

---

## 总结

| 设计项 | 建议 |
|-------|-----|
| 主键 | 自增 BIGINT |
| 金额 | DECIMAL |
| 字符串 | VARCHAR + 合适长度 |
| 时间 | DATETIME / TIMESTAMP |
| NULL | 尽量 NOT NULL |
| 大字段 | 单独表 |

**记住：好的表结构设计是性能的基础。**