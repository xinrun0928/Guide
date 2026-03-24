# PostgreSQL 表达式索引与函数索引

你的查询是这样的：

```sql
SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';
```

表上有索引 `idx_users_email`，但这条查询用得上索引吗？

答案是：用不上。

因为索引是按原始值建的，不是按 `LOWER(email)` 建的。

今天，我们来聊聊 PostgreSQL 的表达式索引和函数索引。

## 问题引出

### 普通索引无法加速表达式查询

```sql
-- 创建表
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建普通索引
CREATE INDEX idx_users_email ON users(email);

-- 查询 1：直接用 email
SELECT * FROM users WHERE email = 'alice@example.com';
-- ✅ 用到索引

-- 查询 2：用 LOWER()
SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';
-- ❌ 用不到索引
```

为什么会这样？

```
索引结构（按原始 email）：
┌─────────────────────────────────┐
│ alice@example.com → row pointer │
│ bob@example.com → row pointer   │
└─────────────────────────────────┘

查询 LOWER(email) = 'alice@example.com'：
- 索引中的值是原始的 'Alice@example.com'
- 但查询期望找 LOWER() 后的 'alice@example.com'
- 索引无法直接使用
```

## 表达式索引

### 解决方案：表达式索引

```sql
-- 为 LOWER(email) 创建表达式索引
CREATE INDEX idx_users_email_lower ON users(LOWER(email));

-- 现在查询用得上索引
SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';
-- ✅ 用到 idx_users_email_lower
```

### 表达式索引的原理

```
表达式索引（按 LOWER(email)）：
┌─────────────────────────────────┐
│ alice@example.com → row pointer │  ← 存储的就是小写
│ bob@example.com → row pointer   │
└─────────────────────────────────┘

查询 LOWER(email) = 'alice@example.com'：
- 索引中的值和查询条件相同
- 可以直接二分查找
```

### 表达式索引语法

```sql
-- 语法
CREATE INDEX index_name ON table_name (expression);

-- 常用表达式
CREATE INDEX idx_name ON table_name (LOWER(column));
CREATE INDEX idx_name ON table_name (UPPER(column));
CREATE INDEX idx_name ON table_name (ABS(column));
CREATE INDEX idx_name ON table_name (date_trunc('day', timestamp_col)));
```

### 实际应用场景

#### 场景一：大小写不敏感的邮箱查询

```sql
-- 创建表达式索引
CREATE INDEX idx_users_email_ci ON users(LOWER(email));

-- 大小写不敏感查询
SELECT * FROM users WHERE LOWER(email) = LOWER('Alice@Example.COM');
-- 或者
SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';
```

#### 场景二：部分字符串匹配

```sql
-- 为字符串前缀创建索引
CREATE INDEX idx_users_name_prefix ON users(SUBSTRING(name FROM 1 FOR 2));

-- 查询某前缀开头的用户
SELECT * FROM users WHERE SUBSTRING(name FROM 1 FOR 2) = 'Al';
```

#### 场景三：数值计算优化

```sql
-- 为计算结果创建索引
CREATE INDEX idx_orders_revenue ON orders((quantity * unit_price));

-- 查询总销售额大于某值的订单
SELECT * FROM orders WHERE (quantity * unit_price) > 10000;
```

#### 场景四：JSON 字段查询

```sql
-- 为 JSON 特定路径创建索引
CREATE INDEX idx_users_prefs_theme ON users((preferences->>'theme'));

-- 查询特定偏好的用户
SELECT * FROM users WHERE (preferences->>'theme') = 'dark';
```

## 函数索引

### 函数索引 vs 表达式索引

在 PostgreSQL 中，「函数索引」和「表达式索引」几乎是同一概念。

广义上说：
- **函数索引**：使用函数创建索引，如 `LOWER(email)`
- **表达式索引**：使用表达式创建索引，如 `(quantity * price)`

狭义上说，函数索引特指使用 PostgreSQL 内置或自定义函数的场景。

### 内置函数索引

```sql
-- 日期函数
CREATE INDEX idx_orders_month ON orders(DATE_TRUNC('month', created_at));
CREATE INDEX idx_orders_year ON orders(EXTRACT(YEAR FROM created_at));

-- 字符串函数
CREATE INDEX idx_users_phone_area ON users(SPLIT_PART(phone, '-', 1));

-- 类型转换
CREATE INDEX idx_users_id_int ON users((user_id::TEXT));
```

### 自定义函数索引

```sql
-- 创建自定义函数
CREATE OR REPLACE FUNCTION get_year(TIMESTAMPTZ) RETURNS INTEGER AS $$
    BEGIN
        RETURN EXTRACT(YEAR FROM $1);
    END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 为自定义函数创建索引
CREATE INDEX idx_orders_year_fn ON orders(get_year(created_at));

-- 查询
SELECT * FROM orders WHERE get_year(created_at) = 2026;
```

> 注意：自定义函数必须标记为 `IMMUTABLE`，表示函数结果只取决于输入参数，不会有副作用。

### 函数索引的性能对比

```sql
-- 测试：有无函数索引的性能差异

-- 无索引
EXPLAIN ANALYZE 
SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';

-- 有表达式索引后
CREATE INDEX idx_users_email_lower ON users(LOWER(email));
EXPLAIN ANALYZE 
SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';
```

典型结果：

```
无索引：
Seq Scan on users  (cost=0.00..12345.00 rows=1 width=...)
  Filter: (lower(email) = 'alice@example.com')

有索引：
Index Scan using idx_users_email_lower on users  (cost=0.42..8.44 rows=1 width=...)
  Index Cond: (lower(email) = 'alice@example.com')
```

## 表达式索引的注意事项

### 1. 查询必须匹配表达式

```sql
-- 索引
CREATE INDEX idx_users_email_lower ON users(LOWER(email));

-- ✅ 能用索引
SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';

-- ❌ 用不到索引（表达式不匹配）
SELECT * FROM users WHERE email = 'alice@example.com';
```

### 2. 表达式的稳定性

```sql
-- IMMUTABLE：结果永不改变
CREATE INDEX idx1 ON users(LOWER(email));  -- ✅ LOWER 是 IMMUTABLE

-- STABLE：结果取决于输入，但不会改变
CREATE INDEX idx2 ON orders(DATE_TRUNC('day', created_at));  -- ✅

-- VOLATILE：结果可能随时改变（不能创建索引）
CREATE INDEX idx3 ON users(NOW());  -- ❌ NOW() 是 VOLATILE
```

### 3. 索引列的函数化

当索引列出现在函数中时，也可以考虑表达式索引：

```sql
-- 原始表
CREATE TABLE products (
    barcode VARCHAR(20),
    ...
);

-- 查询经常用 TRIM()
SELECT * FROM products WHERE TRIM(barcode) = '12345';

-- 创建表达式索引
CREATE INDEX idx_products_barcode_trim ON products(TRIM(barcode));
```

## 表达式索引 vs 生成列

### 生成列（Generated Columns）

PostgreSQL 12+ 支持生成列，可以用来替代部分表达式索引：

```sql
-- 创建表，包含生成列
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(100),
    email_lower VARCHAR(100) GENERATED ALWAYS AS (LOWER(email)) STORED
);

-- 为生成列创建普通索引
CREATE INDEX idx_users_email_lower ON users(email_lower);

-- 查询（自动使用生成列）
SELECT * FROM users WHERE email_lower = 'alice@example.com';
```

### 表达式索引 vs 生成列

| 特性 | 表达式索引 | 生成列 |
|------|-----------|--------|
| 修改表结构 | 不修改 | 添加列 |
| 存储方式 | 只存索引 | 数据也存表 |
| 索引大小 | 小 | 需要额外索引 |
| 灵活性 | 表达式任意 | 受类型限制 |
| 查询写法 | 必须用表达式 | 直接用列名 |

```sql
-- 场景：经常查询 LOWER(email)

-- 方法 1：表达式索引
CREATE INDEX idx1 ON users(LOWER(email));
SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';

-- 方法 2：生成列 + 普通索引
ALTER TABLE users ADD COLUMN email_lower TEXT GENERATED ALWAYS AS (LOWER(email)) STORED;
CREATE INDEX idx2 ON users(email_lower);
SELECT * FROM users WHERE email_lower = 'alice@example.com';
```

## Java 应用示例

### JPA 表达式查询

```java
// 使用 JPA Specification 构建查询
Specification<User> spec = (root, query, cb) -> {
    if (email != null) {
        // 使用 LOWER 函数
        Expression<String> lowerEmail = cb.lower(root.get("email"));
        return cb.equal(lowerEmail, email.toLowerCase());
    }
    return null;
};

List<User> users = userRepository.findAll(spec);
```

### MyBatis 动态 SQL

```java
@Select("<script>" +
    "SELECT * FROM users " +
    "WHERE 1=1 " +
    "<if test='email != null'>" +
    "  AND LOWER(email) = LOWER(#{email})" +
    "</if>" +
    "</script>")
List<User> findByEmailIgnoreCase(@Param("email") String email);
```

### 创建表达式索引的 SQL

```java
// 在 Flyway 或 Liquibase 中创建表达式索引
// Flyway
// V1__create_users.sql
// CREATE INDEX idx_users_email_lower ON users(LOWER(email));

// Liquibase
// <createIndex indexName="idx_users_email_lower" tableName="users">
//     <expression>LOWER(email)</expression>
// </createIndex>
```

## 常见错误

### 错误一：表达式索引不匹配查询

```sql
-- 创建了索引
CREATE INDEX idx_users_email_lower ON users(LOWER(email));

-- 但查询没有用 LOWER
SELECT * FROM users WHERE email = 'alice@example.com';
-- ❌ 用不到索引

-- 正确写法
SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';
```

### 错误二：函数稳定性问题

```sql
-- 错误：NOW() 是 VOLATILE，不能创建索引
CREATE INDEX idx_orders_now ON orders(NOW());
-- ERROR: functions in index expression must not be volatile

-- 正确：使用 DATE_TRUNC 等 IMMUTABLE 函数
CREATE INDEX idx_orders_date ON orders(DATE_TRUNC('day', created_at));
```

### 错误三：忘记表达式索引

```sql
-- 每次查询都做全表扫描
SELECT * FROM users WHERE LOWER(email) = 'alice@example.com';

-- 改进：创建表达式索引
CREATE INDEX idx_users_email_lower ON users(LOWER(email));
```

## 面试高频问题

### Q1: 什么是表达式索引？

**考察点**：索引类型

**参考答案**：
- 为表达式或函数结果创建的索引
- 当查询条件包含表达式时，可以直接使用索引
- 需要查询和索引的表达式完全匹配

### Q2: 为什么普通索引不能加速 `LOWER(email)` 查询？

**考察点**：索引原理

**参考答案**：
- 索引按原始值存储（'Alice@example.com'）
- 查询使用 `LOWER()` 处理后的值（'alice@example.com'）
- 索引中找不到匹配项，只能全表扫描

### Q3: 表达式索引有什么限制？

**考察点**：索引使用

**参考答案**：
1. 查询必须使用与索引完全相同的表达式
2. 函数必须标记为 IMMUTABLE 或 STABLE
3. 索引表达式不能太长
4. 维护成本略高（更新数据时计算表达式）

### Q4: 生成列和表达式索引怎么选？

**考察点**：设计选择

**参考答案**：
- 表达式索引：不需要修改表结构
- 生成列：数据也存储，可以创建主键或唯一约束
- 根据具体场景选择

## 总结

表达式索引是 PostgreSQL 的强大特性：

| 场景 | 示例 |
|------|------|
| 大小写不敏感 | `LOWER(email)` |
| 日期处理 | `DATE_TRUNC('month', created_at)` |
| 数值计算 | `(quantity * price)` |
| JSON 路径 | `(preferences->>'theme')` |
| 字符串处理 | `TRIM(barcode)` |

记住：
1. 查询必须匹配索引表达式
2. 函数必须稳定（IMMUTABLE/STABLE）
3. 表达式索引是优化特定查询的利器
