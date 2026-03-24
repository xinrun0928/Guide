# PostgreSQL 存储过程：PL/pgSQL 入门

想在数据库里写业务逻辑？

想让复杂的数据处理在数据库端完成？

用存储过程。

今天，我们来聊聊 PostgreSQL 的 PL/pgSQL。

## PL/pgSQL 基础

### 什么是 PL/pgSQL

PL/pgSQL 是 PostgreSQL 的过程语言，允许在数据库中编写类似编程语言的逻辑：

```sql
-- 比普通 SQL 更强大
-- 支持变量、条件、循环、异常处理
-- 可以创建函数、触发器、存储过程
```

### 基本结构

```sql
CREATE OR REPLACE FUNCTION function_name(params)
RETURNS return_type AS $$
DECLARE
    -- 声明变量
    variable_name datatype;
BEGIN
    -- 业务逻辑
    statement;
    RETURN result;
END;
$$ LANGUAGE plpgsql;
```

## 变量与数据类型

### 声明变量

```sql
CREATE OR REPLACE FUNCTION calculate_discount(price NUMERIC)
RETURNS NUMERIC AS $$
DECLARE
    base_discount NUMERIC := 0.1;  -- 基础折扣 10%
    vip_discount NUMERIC;           -- VIP 折扣
    final_discount NUMERIC;
BEGIN
    -- 计算 VIP 折扣
    vip_discount := base_discount * 1.5;  -- VIP 15%
    
    -- 计算最终折扣
    final_discount := price * (base_discount + vip_discount);
    
    RETURN final_discount;
END;
$$ LANGUAGE plpgsql;

-- 测试
SELECT calculate_discount(100.00);  -- 返回 25.00
```

### 记录类型（RECORD）

```sql
CREATE OR REPLACE FUNCTION get_order_summary(order_id BIGINT)
RETURNS TEXT AS $$
DECLARE
    order_record RECORD;  -- 类似 Java 的 Object
BEGIN
    SELECT id, total_amount, status, created_at
    INTO order_record
    FROM orders
    WHERE id = order_id;
    
    IF NOT FOUND THEN
        RETURN 'Order not found';
    END IF;
    
    RETURN format(
        'Order #%s: %s (%s) - %s',
        order_record.id,
        order_record.total_amount,
        order_record.status,
        order_record.created_at
    );
END;
$$ LANGUAGE plpgsql;
```

### 行类型（ROWTYPE）

```sql
CREATE OR REPLACE FUNCTION update_order_status(
    p_order_id BIGINT,
    p_new_status VARCHAR
)
RETURNS VOID AS $$
DECLARE
    order_row orders%ROWTYPE;  -- 声明为表行类型
BEGIN
    -- 从表获取行
    SELECT * INTO order_row FROM orders WHERE id = p_order_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order % not found', p_order_id;
    END IF;
    
    -- 更新状态
    order_row.status := p_new_status;
    
    -- 保存回表
    UPDATE orders SET ROW = order_row WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql;
```

## 控制结构

### IF 条件

```sql
CREATE OR REPLACE FUNCTION get_discount_rate(customer_level VARCHAR)
RETURNS NUMERIC AS $$
DECLARE
    discount_rate NUMERIC;
BEGIN
    IF customer_level = 'VIP' THEN
        discount_rate := 0.20;
    ELSIF customer_level = 'GOLD' THEN
        discount_rate := 0.15;
    ELSIF customer_level = 'SILVER' THEN
        discount_rate := 0.10;
    ELSE
        discount_rate := 0.05;
    END IF;
    
    RETURN discount_rate;
END;
$$ LANGUAGE plpgsql;
```

### CASE 语句

```sql
CREATE OR REPLACE FUNCTION get_status_label(status VARCHAR)
RETURNS TEXT AS $$
BEGIN
    RETURN CASE status
        WHEN 'pending' THEN '待处理'
        WHEN 'processing' THEN '处理中'
        WHEN 'completed' THEN '已完成'
        WHEN 'cancelled' THEN '已取消'
        ELSE '未知状态'
    END;
END;
$$ LANGUAGE plpgsql;

-- 搜索 CASE
CREATE OR REPLACE FUNCTION calculate_shipping_fee(
    weight NUMERIC,
    region VARCHAR
)
RETURNS NUMERIC AS $$
DECLARE
    fee NUMERIC;
BEGIN
    fee := CASE
        WHEN weight <= 1 THEN 10
        WHEN weight <= 5 THEN 10 + (weight - 1) * 5
        WHEN weight <= 10 THEN 10 + 4 * 5 + (weight - 5) * 3
        ELSE 10 + 4 * 5 + 5 * 3 + (weight - 10) * 2
    END;
    
    -- 地区附加费
    fee := fee * CASE region
        WHEN 'remote' THEN 1.5
        WHEN 'overseas' THEN 2.0
        ELSE 1.0
    END;
    
    RETURN fee;
END;
$$ LANGUAGE plpgsql;
```

### LOOP 循环

```sql
-- 简单循环
CREATE OR REPLACE FUNCTION calculate_factorial(n INTEGER)
RETURNS BIGINT AS $$
DECLARE
    result BIGINT := 1;
    i INTEGER;
BEGIN
    i := n;
    LOOP
        EXIT WHEN i <= 1;
        result := result * i;
        i := i - 1;
    END LOOP;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- WHILE 循环
CREATE OR REPLACE FUNCTION fibonacci(n INTEGER)
RETURNS BIGINT AS $$
DECLARE
    prev BIGINT := 0;
    curr BIGINT := 1;
    next_val BIGINT;
    i INTEGER;
BEGIN
    IF n = 0 THEN RETURN 0; END IF;
    IF n = 1 THEN RETURN 1; END IF;
    
    i := 2;
    WHILE i <= n LOOP
        next_val := prev + curr;
        prev := curr;
        curr := next_val;
        i := i + 1;
    END LOOP;
    
    RETURN curr;
END;
$$ LANGUAGE plpgsql;

-- FOR 循环（整数范围）
CREATE OR REPLACE FUNCTION generate_series_text(n INTEGER)
RETURNS TEXT AS $$
DECLARE
    result TEXT := '';
BEGIN
    FOR i IN 1..n LOOP
        result := result || i || ',';
    END LOOP;
    
    RETURN rtrim(result, ',');
END;
$$ LANGUAGE plpgsql;

-- FOR 循环（查询结果）
CREATE OR REPLACE FUNCTION get_order_total(p_customer_id BIGINT)
RETURNS NUMERIC AS $$
DECLARE
    total NUMERIC := 0;
    order_row RECORD;
BEGIN
    FOR order_row IN SELECT total_amount FROM orders WHERE customer_id = p_customer_id LOOP
        total := total + order_row.total_amount;
    END LOOP;
    
    RETURN total;
END;
$$ LANGUAGE plpgsql;
```

### FOREACH 循环（数组）

```sql
CREATE OR REPLACE FUNCTION calculate_sum(numbers INTEGER[])
RETURNS INTEGER AS $$
DECLARE
    total INTEGER := 0;
    num INTEGER;
BEGIN
    FOREACH num IN ARRAY numbers LOOP
        total := total + num;
    END LOOP;
    
    RETURN total;
END;
$$ LANGUAGE plpgsql;

-- 测试
SELECT calculate_sum(ARRAY[1, 2, 3, 4, 5]);  -- 返回 15
```

## 异常处理

### 基本异常处理

```sql
CREATE OR REPLACE FUNCTION safe_divide(a NUMERIC, b NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
    RETURN a / b;
EXCEPTION
    WHEN division_by_zero THEN
        RAISE NOTICE 'Division by zero detected';
        RETURN NULL;
    WHEN OTHERS THEN
        RAISE NOTICE 'Error: %', SQLERRM;
        RETURN NULL;
END;
$$ LANGUAGE plpgsql;
```

### 自定义异常

```sql
CREATE OR REPLACE FUNCTION withdraw_money(
    account_id BIGINT,
    amount NUMERIC
)
RETURNS VOID AS $$
DECLARE
    current_balance NUMERIC;
BEGIN
    -- 获取余额
    SELECT balance INTO current_balance
    FROM accounts
    WHERE id = account_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Account % not found', account_id;
    END IF;
    
    IF current_balance < amount THEN
        RAISE EXCEPTION 'Insufficient balance. Have: %, Need: %', 
            current_balance, amount;
    END IF;
    
    -- 执行取款
    UPDATE accounts
    SET balance = balance - amount
    WHERE id = account_id;
    
EXCEPTION
    WHEN raise_exception THEN
        RAISE;
    WHEN OTHERS THEN
        RAISE NOTICE 'Withdraw failed: %', SQLERRM;
        RAISE;
END;
$$ LANGUAGE plpgsql;
```

### 异常信息变量

```sql
-- 可用的异常信息变量
-- SQLERRM: 异常消息
-- SQLSTATE: 异常状态码
-- GET STACKED DIAGNOSTICS: 获取详细诊断信息

CREATE OR REPLACE FUNCTION test_exception()
RETURNS VOID AS $$
BEGIN
    RAISE EXCEPTION 'Custom error: %', 'something wrong';
EXCEPTION
    WHEN raise_exception THEN
        RAISE NOTICE 'SQLSTATE: %', SQLSTATE;
        RAISE NOTICE 'SQLERRM: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;
```

## 游标

### 显式游标

```sql
CREATE OR REPLACE FUNCTION process_orders_batch()
RETURNS VOID AS $$
DECLARE
    order_cursor CURSOR FOR 
        SELECT id, total_amount, customer_id 
        FROM orders 
        WHERE status = 'pending';
    
    order_row order_cursor%ROWTYPE;
    processed_count INTEGER := 0;
BEGIN
    OPEN order_cursor;
    
    LOOP
        FETCH order_cursor INTO order_row;
        EXIT WHEN NOT FOUND;
        
        -- 处理每个订单
        -- UPDATE orders SET status = 'processing' WHERE id = order_row.id;
        
        processed_count := processed_count + 1;
    END LOOP;
    
    CLOSE order_cursor;
    
    RAISE NOTICE 'Processed % orders', processed_count;
END;
$$ LANGUAGE plpgsql;
```

### 带参数的游标

```sql
CREATE OR REPLACE FUNCTION get_customer_orders(
    p_customer_id BIGINT,
    p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
    order_id BIGINT,
    total_amount NUMERIC,
    status VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT o.id, o.total_amount, o.status
    FROM orders o
    WHERE o.customer_id = p_customer_id
    ORDER BY o.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
```

## 返回结果集

### 返回表

```sql
CREATE OR REPLACE FUNCTION get_orders_by_status(
    p_status VARCHAR,
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    order_id BIGINT,
    total_amount NUMERIC,
    customer_name VARCHAR,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT o.id, o.total_amount, c.name, o.created_at
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    WHERE o.status = p_status
    ORDER BY o.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- 使用
SELECT * FROM get_orders_by_status('pending', 10);
```

### 返回 SETOF

```sql
CREATE OR REPLACE FUNCTION get_top_customers(n INTEGER)
RETURNS SETOF customers AS $$
BEGIN
    RETURN QUERY
    SELECT * FROM customers
    ORDER BY total_spent DESC
    LIMIT n;
END;
$$ LANGUAGE plpgsql;

-- 返回数组
CREATE OR REPLACE FUNCTION get_order_ids(customer_id BIGINT)
RETURNS SETOF BIGINT AS $$
BEGIN
    RETURN QUERY
    SELECT id FROM orders WHERE customer_id = customer_id;
END;
$$ LANGUAGE plpgsql;
```

## 存储过程 vs 函数

### 区别

```
PostgreSQL 中的函数和存储过程区别：

函数：
- 必须有返回值
- 可以在 SQL 中调用
- 不能执行事务控制（COMMIT/ROLLBACK）
- 相当于有返回值的存储过程

存储过程（PostgreSQL 11+）：
- 可以没有返回值
- 可以执行事务控制
- 用 CALL 调用

PostgreSQL 11 之前：只有函数，没有存储过程
PostgreSQL 11+：有函数，也有存储过程
```

### 存储过程示例

```sql
-- PostgreSQL 11+ 支持的存储过程
CREATE OR REPLACE PROCEDURE transfer_money(
    from_account BIGINT,
    to_account BIGINT,
    amount NUMERIC
) AS $$
BEGIN
    -- 扣款
    UPDATE accounts SET balance = balance - amount WHERE id = from_account;
    
    -- 入账
    UPDATE accounts SET balance = balance + amount WHERE id = to_account;
    
    -- 提交（可选，过程结束时自动提交）
    -- COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        RAISE;
END;
$$ LANGUAGE plpgsql;

-- 调用存储过程
CALL transfer_money(1, 2, 100.00);
```

## 性能注意事项

### 内联函数 vs 复杂函数

```sql
-- 简单查询，PostgreSQL 可以内联
CREATE FUNCTION get_order_count(customer_id BIGINT)
RETURNS BIGINT AS $$
    SELECT COUNT(*) FROM orders WHERE customer_id = $1;
$$ LANGUAGE sql;

-- 复杂逻辑必须用 plpgsql
-- plpgsql 有函数调用开销
```

### STABLE/IMMUTABLE 标记

```sql
-- IMMUTABLE：函数结果永不改变
CREATE OR REPLACE FUNCTION add_numbers(a INTEGER, b INTEGER)
RETURNS INTEGER AS $$
BEGIN
    RETURN a + b;
END;
$$ LANGUAGE plpgsql IMMUTABLE;  -- 可以被优化

-- STABLE：函数结果依赖于输入但不改变数据
CREATE OR REPLACE FUNCTION get_current_user()
RETURNS TEXT AS $$
BEGIN
    RETURN current_user;
END;
$$ LANGUAGE plpgsql STABLE;  -- 不会修改数据

-- VOLATILE：函数结果可能随时改变
CREATE OR REPLACE FUNCTION random_number()
RETURNS INTEGER AS $$
BEGIN
    RETURN floor(random() * 100)::INTEGER;
END;
$$ LANGUAGE plpgsql VOLATILE;  -- 默认
```

## 面试高频问题

### Q1: PL/pgSQL 和普通 SQL 有什么区别？

**考察点**：PL/pgSQL 基础

**参考答案**：
1. PL/pgSQL 支持变量、条件、循环
2. PL/pgSQL 可以有异常处理
3. PL/pgSQL 可以创建复杂的业务逻辑
4. 普通 SQL 不能有控制流程

### Q2: 存储过程和函数的区别是什么？

**考察点**：存储过程 vs 函数

**参考答案**：
1. 存储过程可以没有返回值
2. 存储过程可以控制事务（COMMIT/ROLLBACK）
3. 函数可以在 SQL 中调用，存储过程用 CALL 调用

### Q3: PL/pgSQL 函数可以返回什么？

**考察点**：返回类型

**参考答案**：
1. 基本类型：INTEGER、TEXT 等
2. RECORD：动态行类型
3. SETOF：多行结果
4. TABLE：表格形式
5. 数组

### Q4: 异常如何处理？

**考察点**：异常处理

**参考答案**：
1. 使用 EXCEPTION WHEN 捕获
2. SQLERRM 获取错误消息
3. SQLSTATE 获取错误码
4. 可以自定义异常和错误消息

## 总结

PL/pgSQL 是 PostgreSQL 的过程语言：

| 特性 | 说明 |
|------|------|
| 变量 | DECLARE 中声明 |
| 条件 | IF/ELSIF/ELSE、CASE |
| 循环 | LOOP、WHILE、FOR、FOREACH |
| 异常 | EXCEPTION WHEN |
| 游标 | 处理结果集 |
| 返回 | 基本类型、SETOF、TABLE |

适用场景：
- 复杂业务逻辑
- 数据验证和转换
- 自动化任务
- 触发器函数
