# PostgreSQL 函数重载与操作符重载

同一个函数名，不同的参数类型，都能调用？

`+` 操作符，可以用在自定义类型上？

是的，PostgreSQL 支持函数重载和操作符重载。

今天，我们来聊聊 PostgreSQL 的高级特性。

## 函数重载

### 什么是函数重载

函数重载（Function Overloading）是同一函数名可以接受不同参数：

```sql
-- 两个同名函数，不同参数
CREATE FUNCTION add(a INTEGER, b INTEGER) 
RETURNS INTEGER AS $$ SELECT a + b; $$ LANGUAGE SQL;

CREATE FUNCTION add(a TEXT, b TEXT) 
RETURNS TEXT AS $$ SELECT a || b; $$ LANGUAGE SQL;

-- 调用
SELECT add(1, 2);      -- 调用第一个：返回 3
SELECT add('Hello', 'World');  -- 调用第二个：返回 'HelloWorld'
```

### 实际应用场景

#### 1. 处理多种数据类型

```sql
-- 格式化输出：整数版本
CREATE OR REPLACE FUNCTION format_price(price INTEGER)
RETURNS TEXT AS $$
BEGIN
    RETURN '¥' || price;
END;
$$ LANGUAGE plpgsql;

-- 格式化输出：数值版本
CREATE OR REPLACE FUNCTION format_price(price NUMERIC(10,2))
RETURNS TEXT AS $$
BEGIN
    RETURN '¥' || ROUND(price, 2);
END;
$$ LANGUAGE plpgsql;

-- 格式化输出：带货币参数
CREATE OR REPLACE FUNCTION format_price(price NUMERIC, currency VARCHAR)
RETURNS TEXT AS $$
BEGIN
    RETURN currency || ' ' || ROUND(price, 2);
END;
$$ LANGUAGE plpgsql;

-- 测试
SELECT format_price(100);                   -- ¥100
SELECT format_price(99.99);                 -- ¥99.99
SELECT format_price(99.99, '$');            -- $ 99.99
```

#### 2. 可选参数

```sql
-- 默认参数版本
CREATE OR REPLACE FUNCTION create_user(
    username VARCHAR,
    email VARCHAR,
    OUT user_id BIGINT
)
RETURNS BIGINT AS $$
BEGIN
    INSERT INTO users (username, email)
    VALUES (create_user.username, create_user.email)
    RETURNING id INTO user_id;
END;
$$ LANGUAGE plpgsql;

-- 带默认值（通过重载实现）
CREATE OR REPLACE FUNCTION create_user(username VARCHAR)
RETURNS BIGINT AS $$
BEGIN
    RETURN create_user(username, username || '@example.com');
END;
$$ LANGUAGE plpgsql;

-- 测试
SELECT create_user('alice');                     -- 使用默认邮箱
SELECT create_user('bob', 'bob@company.com');   -- 指定邮箱
```

### 函数重载的限制

```sql
-- 1. 参数数量或类型必须不同
-- 不能重载：参数数量和类型都相同
CREATE FUNCTION test(a INTEGER) RETURNS INTEGER AS $$ SELECT a; $$ LANGUAGE SQL;
CREATE FUNCTION test(a INTEGER) RETURNS INTEGER AS $$ SELECT a + 1; $$ LANGUAGE SQL;
-- ERROR: cannot change return type of existing function

-- 2. 可以通过 VARIADIC 实现可变参数
CREATE OR REPLACE FUNCTION sum_all(VARIADIC numbers INTEGER[])
RETURNS INTEGER AS $$
DECLARE
    total INTEGER := 0;
BEGIN
    FOREACH num IN ARRAY numbers LOOP
        total := total + num;
    END LOOP;
    RETURN total;
END;
$$ LANGUAGE plpgsql;

SELECT sum_all(1, 2, 3);       -- 6
SELECT sum_all(1, 2, 3, 4, 5); -- 15
```

## 操作符重载

### 什么是操作符重载

PostgreSQL 允许为自定义类型定义操作符：

```sql
-- 创建复数类型
CREATE TYPE complex AS (
    real NUMERIC,
    imaginary NUMERIC
);

-- 定义 + 操作符
CREATE OPERATOR + (
    PROCEDURE = complex_add,
    LEFTARG = complex,
    RIGHTARG = complex
);

-- 定义 complex_add 函数
CREATE OR REPLACE FUNCTION complex_add(a complex, b complex)
RETURNS complex AS $$
BEGIN
    RETURN (a.real + b.real, a.imaginary + b.imaginary)::complex;
END;
$$ LANGUAGE plpgsql;

-- 现在可以用 + 操作符了
SELECT ('1', '2')::complex + ('3', '4')::complex;
```

### 创建自定义操作符

#### 语法

```sql
CREATE OPERATOR operator_name (
    PROCEDURE = function_name,
    LEFTARG = left_argument_type,  -- 可选
    RIGHTARG = right_argument_type,  -- 可选
    COMMUTATOR = commutator_op,  -- 可选：交换律操作符
    NEGATOR = negator_op,  -- 可选：取反操作符
    RESTRICT = restriction_function,  -- 可选：选择性估计函数
    JOIN = join_function  -- 可选：连接估计函数
);
```

#### 示例：向量加法

```sql
-- 创建向量类型
CREATE TYPE vector3d AS (
    x NUMERIC,
    y NUMERIC,
    z NUMERIC
);

-- 向量加法函数
CREATE OR REPLACE FUNCTION vector_add(a vector3d, b vector3d)
RETURNS vector3d AS $$
BEGIN
    RETURN (a.x + b.x, a.y + b.y, a.z + b.z)::vector3d;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 创建 + 操作符
CREATE OPERATOR + (
    PROCEDURE = vector_add,
    LEFTARG = vector3d,
    RIGHTARG = vector3d
);

-- 向量点积函数
CREATE OR REPLACE FUNCTION vector_dot(a vector3d, b vector3d)
RETURNS NUMERIC AS $$
BEGIN
    RETURN a.x * b.x + a.y * b.y + a.z * b.z;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 创建 * 操作符
CREATE OPERATOR * (
    PROCEDURE = vector_dot,
    LEFTARG = vector3d,
    RIGHTARG = vector3d
);

-- 测试
SELECT ('1', '2', '3')::vector3d + ('4', '5', '6')::vector3d;
SELECT ('1', '2', '3')::vector3d * ('4', '5', '6')::vector3d;  -- 点积：32
```

### 内置操作符的别名

PostgreSQL 提供了很多内置操作符，可以通过创建别名使用：

```sql
-- 使用操作符名而非函数名
SELECT * FROM users WHERE email = 'alice@example.com';
SELECT * FROM users WHERE email OPERATOR(=) 'alice@example.com';  -- 显式调用

-- 使用 <> 操作符
SELECT * FROM users WHERE id <> 1;

-- 创建不等于操作符的别名
CREATE OPERATOR != (
    PROCEDURE = int4ne,
    LEFTARG = INTEGER,
    RIGHTARG = INTEGER
);
```

### 操作符与函数的安全性

```sql
-- 操作符函数应该是 IMMUTABLE
-- 确保结果可预测，可以被优化器优化

CREATE OR REPLACE FUNCTION complex_add(a complex, b complex)
RETURNS complex AS $$
BEGIN
    RETURN (a.real + b.real, a.imaginary + b.imaginary)::complex;
END;
$$ LANGUAGE plpgsql IMMUTABLE;  -- 标记为 IMMUTABLE
```

## 实际应用场景

### 场景一：实现类似 JSON 的路径访问

```sql
-- 创建路径类型
CREATE TYPE json_path AS (path TEXT, value TEXT);

-- 路径访问函数
CREATE OR REPLACE FUNCTION json_get(data JSONB, path TEXT)
RETURNS TEXT AS $$
DECLARE
    result TEXT;
BEGIN
    result := data #>> string_to_array(path, '.');
    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 创建 -> 操作符
CREATE OPERATOR -> (
    PROCEDURE = json_get,
    LEFTARG = JSONB,
    RIGHTARG = TEXT
);

-- 使用
SELECT '{"name": "Alice", "age": 30}'::jsonb -> 'name';
```

### 场景二：日期范围操作

```sql
-- 范围重叠操作符
CREATE OR REPLACE FUNCTION ranges_overlap(a TSRANGE, b TSRANGE)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN a && b;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OPERATOR && (
    PROCEDURE = ranges_overlap,
    LEFTARG = TSRANGE,
    RIGHTARG = TSRANGE
);

-- 使用
SELECT 
    '[2026-01-01, 2026-01-31)'::TSRANGE && 
    '[2026-01-15, 2026-02-15)'::TSRANGE;  -- true
```

### 场景三：实现字符串包含

```sql
-- 创建自定义包含操作符
CREATE OPERATOR <@> (
    PROCEDURE = text_contians,
    LEFTARG = TEXT,
    RIGHTARG = TEXT
);

CREATE OR REPLACE FUNCTION text_contians(haystack TEXT, needle TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN position(needle IN haystack) > 0;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 使用
SELECT 'Hello World' <@> 'World';  -- true
SELECT 'Hello World' <@> 'Python';  -- false
```

## 查看和删除

### 查看重载函数

```sql
-- 查看所有重载的函数
SELECT 
    proname,
    pronargs,
    proargtypes::regtype[]
FROM pg_proc
WHERE proname = 'format_price'
AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- 查看函数定义
SELECT pg_get_functiondef(oid) 
FROM pg_proc
WHERE proname = 'format_price';
```

### 查看操作符

```sql
-- 查看操作符定义
SELECT 
    oprname,
    oprleft::regtype AS left_arg,
    oprright::regtype AS right_arg,
    oprcode::regproc AS function_name
FROM pg_operator
WHERE oprname = '+';

-- 查看特定类型的操作符
SELECT * FROM pg_operator WHERE oprleft = 'complex'::regtype;
```

### 删除重载

```sql
-- 删除特定函数（需要指定参数类型）
DROP FUNCTION format_price(INTEGER);
DROP FUNCTION format_price(NUMERIC);
DROP FUNCTION format_price(NUMERIC, VARCHAR);

-- 删除操作符
DROP OPERATOR + (complex, complex);

-- 删除函数和操作符（如果确定的话）
DROP FUNCTION IF EXISTS format_price(INTEGER);
```

## 最佳实践

### 1. 函数命名

```sql
-- 好的命名
CREATE FUNCTION calculate_discount(price NUMERIC, rate NUMERIC) ...;
CREATE FUNCTION get_customer_by_id(id BIGINT) ...;

-- 不好的命名
CREATE FUNCTION calc(p NUMERIC, r NUMERIC) ...;  -- 缩写太短
CREATE FUNCTION func1(...) ...;  -- 无意义
```

### 2. 操作符命名规范

```sql
-- 使用双字符操作符表示操作
-- @@: 相似性
-- <@>: 包含
-- &&: 重叠
-- <->: 距离

-- 避免创建单字符操作符（容易冲突）
CREATE OPERATOR === ( ... );  -- 不推荐
```

### 3. 性能考虑

```sql
-- 重载函数和操作符函数应该标记为 IMMUTABLE
-- 这样 PostgreSQL 可以安全地优化

CREATE OR REPLACE FUNCTION add(a INTEGER, b INTEGER)
RETURNS INTEGER AS $$ SELECT a + b; $$ LANGUAGE SQL IMMUTABLE;

-- 标记错误会导致优化器无法优化
CREATE OR REPLACE FUNCTION current_timestamp_text()
RETURNS TEXT AS $$ SELECT now()::TEXT; $$ LANGUAGE SQL;
-- 应该是 STABLE，不是 IMMUTABLE
```

## 面试高频问题

### Q1: 什么是函数重载？

**考察点**：函数重载理解

**参考答案**：
- 同一函数名，不同参数类型或数量
- PostgreSQL 根据调用参数选择合适的函数
- 常用于处理多种数据类型

### Q2: PostgreSQL 如何选择调用哪个重载函数？

**考察点**：重载解析

**参考答案**：
1. PostgreSQL 分析参数类型
2. 匹配最精确的函数签名
3. 如果没有精确匹配，尝试类型转换
4. 抛出错误如果无法匹配

### Q3: 什么是操作符重载？

**考察点**：操作符重载理解

**参考答案**：
- 为自定义类型定义操作符行为
- 使用 CREATE OPERATOR 创建
- 操作符函数通常是 IMMUTABLE

### Q4: 函数重载有什么限制？

**考察点**：重载限制

**参考答案**：
1. 参数数量或类型必须不同
2. 不能仅通过返回值类型区分
3. 不能重载不存在的函数

## 总结

函数重载和操作符重载是 PostgreSQL 的高级特性：

| 特性 | 说明 |
|------|------|
| 函数重载 | 同名函数，不同参数 |
| 操作符重载 | 自定义类型的操作符行为 |
| IMMUTABLE | 函数/操作符应该是纯函数 |
| 类型安全 | 根据参数类型匹配 |

使用场景：
- 处理多种数据类型
- 自定义业务逻辑
- 实现 DSL（领域特定语言）
- 扩展 PostgreSQL 行为
