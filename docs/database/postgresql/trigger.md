# PostgreSQL 触发器与规则系统

想在插入数据时自动记录日志？

想在更新数据时自动校验？

用触发器。

今天，我们来聊聊 PostgreSQL 的触发器与规则系统。

## 触发器基础

### 什么是触发器

触发器是在特定事件发生时自动执行的数据库对象：

```
INSERT/UPDATE/DELETE on table
         ↓
    检查触发时机 (BEFORE/AFTER)
         ↓
    执行触发函数
         ↓
    完成操作
```

### 触发器组成

1. **触发事件**：INSERT、UPDATE、DELETE、TRUNCATE
2. **触发时机**：BEFORE、AFTER、INSTEAD OF
3. **触发级别**：FOR EACH ROW、FOR EACH STATEMENT
4. **触发函数**：执行的具体逻辑

## 创建触发器

### 基本语法

```sql
-- 1. 创建触发器函数
CREATE OR REPLACE FUNCTION trigger_function()
RETURNS TRIGGER AS $$
BEGIN
    -- 触发器逻辑
    RETURN NEW;  -- 或 RETURN OLD 或 RETURN NULL
END;
$$ LANGUAGE plpgsql;

-- 2. 创建触发器
CREATE TRIGGER trigger_name
    [BEFORE | AFTER | INSTEAD OF] [INSERT | UPDATE | DELETE | TRUNCATE]
    ON table_name
    [FOR EACH {ROW | STATEMENT}]
    [WHEN (condition)]
    EXECUTE FUNCTION trigger_function();
```

### 示例：记录审计日志

```sql
-- 创建订单表
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    customer_id BIGINT,
    total_amount NUMERIC(10,2),
    status VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建订单变更日志表
CREATE TABLE order_changes (
    id SERIAL PRIMARY KEY,
    order_id BIGINT,
    old_status VARCHAR(20),
    new_status VARCHAR(20),
    old_amount NUMERIC(10,2),
    new_amount NUMERIC(10,2),
    changed_by VARCHAR(100),
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建触发器函数
CREATE OR REPLACE FUNCTION log_order_changes()
RETURNS TRIGGER AS $$
BEGIN
    -- 记录变更
    INSERT INTO order_changes (
        order_id,
        old_status,
        new_status,
        old_amount,
        new_amount,
        changed_by
    ) VALUES (
        NEW.id,
        OLD.status,    -- 变更前的状态
        NEW.status,    -- 变更后的状态
        OLD.total_amount,
        NEW.total_amount,
        current_user
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 创建 UPDATE 触发器
CREATE TRIGGER order_update_trigger
    BEFORE UPDATE ON orders
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status OR 
          OLD.total_amount IS DISTINCT FROM NEW.total_amount)
    EXECUTE FUNCTION log_order_changes();

-- 测试
INSERT INTO orders (customer_id, total_amount, status) 
VALUES (1, 100.00, 'pending');

UPDATE orders SET status = 'processing' WHERE id = 1;

SELECT * FROM order_changes;
```

### 示例：自动更新时间戳

```sql
-- 创建表
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100),
    email VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建触发器函数
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 创建触发器
CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- 测试
INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com');
SELECT * FROM users;

-- 等待一秒
SELECT pg_sleep(1);

UPDATE users SET email = 'alice.new@example.com' WHERE name = 'Alice';
SELECT * FROM users;  -- updated_at 已更新
```

### 示例：数据验证

```sql
-- 创建带验证的订单表
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    total_amount NUMERIC(10,2),
    status VARCHAR(20) CHECK (status IN ('pending', 'processing', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建验证触发器函数
CREATE OR REPLACE FUNCTION validate_order()
RETURNS TRIGGER AS $$
BEGIN
    -- 验证金额不能为负
    IF NEW.total_amount < 0 THEN
        RAISE EXCEPTION '订单金额不能为负数';
    END IF;
    
    -- 验证已完成订单不能修改金额
    IF OLD.status = 'completed' AND OLD.total_amount != NEW.total_amount THEN
        RAISE EXCEPTION '已完成订单不能修改金额';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validate_order_trigger
    BEFORE INSERT OR UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION validate_order();

-- 测试
INSERT INTO orders (total_amount, status) VALUES (-100, 'pending');
-- ERROR: 订单金额不能为负数
```

## INSTEAD OF 触发器

### 作用在视图上

PostgreSQL 不允许直接在视图上执行 INSERT/UPDATE/DELETE，但可以用 INSTEAD OF 触发器实现：

```sql
-- 创建视图（联表查询）
CREATE VIEW order_summary AS
SELECT 
    o.id,
    o.total_amount,
    o.status,
    c.name AS customer_name,
    c.email AS customer_email
FROM orders o
JOIN customers c ON o.customer_id = c.id;

-- 创建 INSTEAD OF 触发器
CREATE OR REPLACE FUNCTION order_summary_insert()
RETURNS TRIGGER AS $$
BEGIN
    -- 插入到 customers 表（如果不存在）
    INSERT INTO customers (name, email)
    VALUES (NEW.customer_name, NEW.customer_email)
    ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name
    RETURNING id INTO customer_id;
    
    -- 插入到 orders 表
    INSERT INTO orders (customer_id, total_amount, status)
    VALUES (customer_id, NEW.total_amount, NEW.status)
    RETURNING id INTO NEW.id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER order_summary_insert_trigger
    INSTEAD OF INSERT ON order_summary
    FOR EACH ROW
    EXECUTE FUNCTION order_summary_insert();

-- 现在可以直接向视图插入数据
INSERT INTO order_summary (total_amount, status, customer_name, customer_email)
VALUES (100.00, 'pending', 'Bob', 'bob@example.com');
```

## 规则系统（Rules）

### 规则 vs 触发器

| 特性 | 触发器 | 规则 |
|------|--------|------|
| 触发时机 | BEFORE/AFTER/INSTEAD OF | INSTEAD |
| 执行时机 | 事件发生时立即执行 | 重写查询后执行 |
| 灵活性 | 高（可编写复杂逻辑） | 低（仅重写查询） |
| 性能 | 每次触发执行 | 仅在查询重写时影响 |
| 适用场景 | 数据验证、日志 | 视图实现、日志 |

### 创建规则

```sql
-- 创建规则：将所有 SELECT 重定向到视图
CREATE RULE order_summary_select AS
    ON SELECT TO order_summary
    DO INSTEAD
    SELECT 
        o.id,
        o.total_amount,
        o.status,
        c.name AS customer_name,
        c.email AS customer_email
    FROM orders o
    JOIN customers c ON o.customer_id = c.id;

-- 创建规则：自动记录变更
CREATE RULE log_orders_insert AS
    ON INSERT TO orders
    DO ALSO
    INSERT INTO order_log (action, new_data) 
    VALUES ('INSERT', row_to_json(NEW));
```

## 触发器高级用法

### 多个触发器执行顺序

```sql
-- 同一个表可以有多个触发器
-- 同一个事件可以有多个触发器（按名称顺序执行）

-- 触发器 1：记录变更日志
CREATE TRIGGER order_log_trigger
    AFTER UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION log_order_changes();

-- 触发器 2：发送通知
CREATE TRIGGER order_notify_trigger
    AFTER UPDATE ON orders
    FOR EACH ROW
    WHEN (OLD.status != NEW.status)
    EXECUTE FUNCTION notify_order_change();

-- 查看触发器顺序
SELECT 
    tgname,
    tgrelid::REGCLASS,
    tgtype,
    tgenabled,
    tgname
FROM pg_trigger
WHERE tgrelid = 'orders'::REGCLASS
ORDER BY tgname;
```

### 条件触发器

```sql
-- 只在满足条件时触发
CREATE TRIGGER order_high_value_alert
    AFTER INSERT OR UPDATE ON orders
    FOR EACH ROW
    WHEN (NEW.total_amount > 10000)  -- 只对高价值订单触发
    EXECUTE FUNCTION send_high_value_alert();
```

### 禁用/启用触发器

```sql
-- 禁用触发器（批量操作时）
ALTER TABLE orders DISABLE TRIGGER ALL;

-- 执行批量操作
INSERT INTO orders (customer_id, total_amount, status)
SELECT customer_id, total_amount, status FROM old_orders;

-- 启用触发器
ALTER TABLE orders ENABLE TRIGGER ALL;

-- 只禁用特定触发器
ALTER TABLE orders DISABLE TRIGGER order_log_trigger;

-- 查看触发器状态
SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'orders'::REGCLASS;
```

## 触发器性能问题

### 触发器的性能影响

```
触发器性能考量：

1. 每个 INSERT/UPDATE/DELETE 都会触发执行
2. 触发器函数不能有耗时操作
3. 批量操作时触发器可能成为瓶颈

优化建议：
- 使用 WHEN 条件过滤不必要触发
- 避免在触发器中执行复杂查询
- 批量操作时考虑禁用触发器
```

### 批量操作优化

```sql
-- 批量插入时禁用触发器
ALTER TABLE orders DISABLE TRIGGER ALL;

COPY orders (customer_id, total_amount, status) FROM '/tmp/orders.csv';

ALTER TABLE orders ENABLE TRIGGER ALL;

-- 事后补录日志
INSERT INTO order_log (action, new_data)
SELECT 'INSERT', row_to_json(NEW)
FROM (SELECT * FROM orders WHERE created_at > (SELECT MAX(changed_at) FROM order_log)) AS NEW;
```

## Java 应用中的触发器

### 触发器 vs 应用层逻辑

```java
// 应用层记录日志
public void updateOrder(Long orderId, String newStatus) {
    Order order = orderRepository.findById(orderId);
    String oldStatus = order.getStatus();
    
    order.setStatus(newStatus);
    orderRepository.save(order);
    
    // 应用层记录日志
    orderChangeLogRepository.save(new OrderChangeLog(
        orderId, oldStatus, newStatus
    ));
}

// vs 触发器（数据库层自动处理）
public void updateOrder(Long orderId, String newStatus) {
    // 只需要更新订单
    jdbcTemplate.update(
        "UPDATE orders SET status = ? WHERE id = ?",
        newStatus, orderId
    );
    // 触发器自动记录日志
}
```

### 触发器监控

```sql
-- 查看触发器执行统计
SELECT 
    t.tgname,
    c.relname AS table_name,
    t.tgfreq,
    t.tgnargs
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
WHERE t.tgenabled = 'O'  -- 只统计启用的触发器
AND NOT t.tgisinternal;

-- 查看触发器函数内容
SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'order_log_trigger';
```

## 面试高频问题

### Q1: PostgreSQL 触发器有哪些类型？

**考察点**：触发器基础

**参考答案**：
1. 按触发时机：BEFORE、AFTER、INSTEAD OF
2. 按触发级别：FOR EACH ROW、FOR EACH STATEMENT
3. 按触发事件：INSERT、UPDATE、DELETE、TRUNCATE

### Q2: 触发器和规则的区别是什么？

**考察点**：触发器与规则

**参考答案**：
1. 触发器在事件发生时执行，规则重写查询
2. 触发器更灵活，规则主要用于视图
3. 触发器性能影响更直接

### Q3: 触发器有什么性能问题？

**考察点**：性能优化

**参考答案**：
1. 每次触发事件都要执行
2. 不能有耗时操作
3. 批量操作时触发器可能成为瓶颈
4. 优化：使用 WHEN 条件、禁用不必要的触发器

### Q4: INSTEAD OF 触发器用在什么地方？

**考察点**：触发器应用

**参考答案**：
1. 用于视图（让视图可更新）
2. 实现复杂的视图插入逻辑
3. 将一个 INSERT 分解为多个表的操作

## 总结

触发器和规则是 PostgreSQL 的自动化机制：

| 特性 | 触发器 | 规则 |
|------|--------|------|
| 时机 | BEFORE/AFTER/INSTEAD OF | INSTEAD |
| 粒度 | ROW/STATEMENT | 整个语句 |
| 适用 | 表、视图 | 视图为主 |
| 灵活性 | 高 | 低 |

使用场景：
- 审计日志
- 数据验证
- 自动时间戳
- 视图可更新
