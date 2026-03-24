# PostgreSQL 事务回滚与 Savepoint

有时候，事务执行到一半，你突然发现前面有个逻辑错误。

是回滚整个事务重头来？还是有更优雅的方案？

今天，我们来聊聊 PostgreSQL 的事务控制和 Savepoint。

## 事务基础回顾

### 事务的开始和结束

```sql
-- 显式开始
BEGIN;
-- 或者
START TRANSACTION;

-- 提交
COMMIT;

-- 回滚
ROLLBACK;
```

### 自动提交模式

PostgreSQL 默认是自动提交模式（除了 psql 客户端可能不同）：

```sql
-- psql 中，默认每条语句是一个事务
-- 要么手动 BEGIN...COMMIT
-- 要么设置自动提交

\set AUTOCOMMIT on  -- psql 设置

-- 或者在应用层
SET autocommit = on;
```

## Savepoint 是什么？

Savepoint 允许你在事务中创建「标记点」，可以回滚到标记点而不影响之前的修改。

```
事务执行流程：

BEGIN;
    INSERT INTO users (name) VALUES ('Alice');  -- point A 之前
    SAVEPOINT sp1;                               -- 创建保存点
    INSERT INTO users (name) VALUES ('Bob');     -- point A 之后
    ROLLBACK TO SAVEPOINT sp1;                   -- 回滚到 sp1
    INSERT INTO users (name) VALUES ('Charlie'); -- point A 之后（Bob 不在了）
COMMIT;

-- 结果：Alice 和 Charlie 被插入，Bob 没有
```

## Savepoint 操作

### 创建 Savepoint

```sql
BEGIN;

-- 执行一些操作
INSERT INTO orders (customer_id, total) VALUES (1, 100);

-- 创建保存点
SAVEPOINT my_savepoint;

-- 继续操作
INSERT INTO orders (customer_id, total) VALUES (1, 200);
-- 假设这里出错了
```

### 回滚到 Savepoint

```sql
-- 回滚到保存点（不提交也不回滚整个事务）
ROLLBACK TO SAVEPOINT my_savepoint;

-- 保存点之后的修改被撤销，但保存点之前的修改保留
SELECT * FROM orders;  -- 只有第一条 INSERT

-- 可以继续执行
INSERT INTO orders (customer_id, total) VALUES (1, 150);
```

### 释放 Savepoint

```sql
-- 释放保存点（标记为不可回滚）
RELEASE SAVEPOINT my_savepoint;

-- 注意：RELEASE 不回滚，只是让这个保存点失效
-- 回滚时只能回滚到仍然存在的保存点
```

### Savepoint 的命名

```sql
-- 保存点名称是字符串
SAVEPOINT 'my_savepoint';
ROLLBACK TO SAVEPOINT 'my_savepoint';

-- 可以创建多个嵌套的保存点
SAVEPOINT level1;
    SAVEPOINT level2;
    SAVEPOINT level3;
ROLLBACK TO SAVEPOINT level2;  -- 回滚到 level2，level3 自动失效
```

## 实际应用场景

### 场景一：批量操作中的部分失败

```sql
-- 批量插入订单，如果某个失败不影响其他的
BEGIN;

-- 保存初始状态
SAVEPOINT batch_start;

DO $$
DECLARE
    i INTEGER;
BEGIN
    FOR i IN 1..100 LOOP
        BEGIN
            INSERT INTO orders (customer_id, total, created_at)
            VALUES (1, i * 10, NOW());
            
            -- 模拟某个条件下的失败
            IF i = 50 THEN
                RAISE EXCEPTION 'Simulated error at row 50';
            END IF;
        EXCEPTION
            WHEN OTHERS THEN
                -- 回滚到保存点，继续下一条
                RAISE NOTICE 'Error at row %: %', i, SQLERRM;
                ROLLBACK TO SAVEPOINT batch_start;
        END;
    END LOOP;
END $$;

COMMIT;
```

### 场景二：Java 应用中的 Savepoint

```java
public void createOrderWithItems(Long customerId, List&lt;OrderItem&gt; items) {
    jdbcTemplate.execute("BEGIN");
    
    try {
        // 1. 创建订单
        Long orderId = jdbcTemplate.queryForObject(
            "INSERT INTO orders (customer_id, created_at) VALUES (?, NOW()) RETURNING id",
            Long.class,
            customerId
        );
        
        // 2. 逐个插入订单项
        for (OrderItem item : items) {
            try {
                jdbcTemplate.update("""
                    INSERT INTO order_items (order_id, product_id, quantity, price)
                    VALUES (?, ?, ?, ?)
                    """,
                    orderId, item.getProductId(), item.getQuantity(), item.getPrice()
                );
            } catch (DuplicateKeyException e) {
                // 如果某个商品有问题，记录日志但不中断
                log.warn("Duplicate item in order {}: {}", orderId, item.getProductId());
            }
        }
        
        // 3. 更新客户统计
        updateCustomerStats(customerId);
        
        jdbcTemplate.execute("COMMIT");
    } catch (Exception e) {
        jdbcTemplate.execute("ROLLBACK");
        throw new RuntimeException("创建订单失败", e);
    }
}
```

### 场景三：复杂业务逻辑的条件回滚

```sql
-- 账户转账，同时更新余额和流水记录
BEGIN;

-- 扣款
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
SAVEPOINT deduct_done;

-- 记录流水（假设可能失败）
INSERT INTO transactions (account_id, type, amount)
VALUES (1, 'transfer', -100);
SAVEPOINT log_done;

-- 入账
UPDATE accounts SET balance = balance + 100 WHERE id = 2;

-- 检查是否有异常（如风控拦截）
DO $$
DECLARE
    risk_flag BOOLEAN;
BEGIN
    SELECT blocked INTO risk_flag 
    FROM accounts WHERE id = 1;
    
    IF risk_flag THEN
        -- 风控拦截，回滚所有操作
        RAISE EXCEPTION 'Risk control triggered';
    END IF;
END $$;

COMMIT;
-- 如果风控触发，整个事务回滚
```

## Savepoint 与异常处理

### PL/pgSQL 中的 EXCEPTION

```sql
CREATE OR REPLACE FUNCTION process_payment(
    p_order_id BIGINT,
    p_amount NUMERIC
) RETURNS VOID AS $$
DECLARE
    v_savepoint TEXT := 'payment_sp';
BEGIN
    -- 保存初始状态
    PERFORM 1 FROM orders WHERE id = p_order_id FOR UPDATE;
    
    PERFORM 1 FROM accounts WHERE id = (
        SELECT customer_id FROM orders WHERE id = p_order_id
    ) FOR UPDATE;
    
    -- 更新订单状态
    UPDATE orders SET status = 'paid', paid_at = NOW() WHERE id = p_order_id;
    
    -- 扣款
    UPDATE accounts 
    SET balance = balance - p_amount
    WHERE id = (SELECT customer_id FROM orders WHERE id = p_order_id);
    
    -- 插入支付记录
    INSERT INTO payment_log (order_id, amount, status)
    VALUES (p_order_id, p_amount, 'success');
    
EXCEPTION WHEN OTHERS THEN
    -- 错误处理
    INSERT INTO payment_log (order_id, amount, status, error_message)
    VALUES (p_order_id, p_amount, 'failed', SQLERRM);
    RAISE;  -- 重新抛出异常
END;
$$ LANGUAGE plpgsql;
```

### 嵌套事务模拟

PostgreSQL 没有真正的嵌套事务，但可以用 Savepoint 模拟：

```java
// 模拟嵌套事务
public void outerTransaction() {
    jdbcTemplate.execute("BEGIN");
    
    try {
        // 业务操作 A
        doOperationA();
        
        // 嵌套事务 B
        try {
            innerTransaction();
        } catch (Exception e) {
            // 嵌套事务失败，回滚到保存点
            jdbcTemplate.execute("ROLLBACK TO SAVEPOINT inner_sp");
            log.warn("Inner transaction rolled back, continuing...");
        }
        
        // 业务操作 C
        doOperationC();
        
        jdbcTemplate.execute("COMMIT");
    } catch (Exception e) {
        jdbcTemplate.execute("ROLLBACK");
        throw e;
    }
}

public void innerTransaction() {
    jdbcTemplate.execute("SAVEPOINT inner_sp");
    
    try {
        // 嵌套事务的业务逻辑
        doSomething();
        jdbcTemplate.execute("RELEASE SAVEPOINT inner_sp");
    } catch (Exception e) {
        jdbcTemplate.execute("ROLLBACK TO SAVEPOINT inner_sp");
        throw e;
    }
}
```

## Savepoint 的限制

### Savepoint 不能做什么

```sql
BEGIN;

-- Savepoint 不能在子事务中创建命名的临时对象
CREATE TEMP TABLE my_temp (id INT);
SAVEPOINT sp1;  -- 可以

INSERT INTO my_temp VALUES (1);
ROLLBACK TO SAVEPOINT sp1;  -- temp 表的 DDL 不会被回滚

-- Savepoint 不能回滚 DDL 操作
CREATE TABLE test1 (id INT);
SAVEPOINT sp2;
DROP TABLE test1;
ROLLBACK TO SAVEPOINT sp2;  -- table 还是被删了
```

### Savepoint 与隔离级别

```sql
-- Savepoint 内的查询遵循当前事务的隔离级别
BEGIN ISOLATION LEVEL REPEATABLE READ;

SELECT * FROM accounts WHERE id = 1;  -- 1000

SAVEPOINT sp1;

-- 另一个事务修改了数据
-- UPDATE accounts SET balance = 2000 WHERE id = 1;

SELECT * FROM accounts WHERE id = 1;  -- 仍然看到 1000（RR 快照）

ROLLBACK TO SAVEPOINT sp1;

SELECT * FROM accounts WHERE id = 1;  -- 还是 1000
```

## 最佳实践

### 1. 合理使用 Savepoint

```sql
-- 好的做法：明确保存点的用途
BEGIN;

-- 主业务逻辑
UPDATE inventory SET stock = stock - 1 WHERE product_id = 1;

-- 保存检查点
SAVEPOINT before_validation;

-- 验证逻辑（可能回滚）
IF NOT validate_stock(1) THEN
    ROLLBACK TO SAVEPOINT before_validation;
END IF;

COMMIT;
```

### 2. Savepoint 命名规范

```sql
-- 使用有意义的命名
SAVEPOINT 'before_customer_check';
SAVEPOINT 'after_payment_processing';
SAVEPOINT 'inventory_locked';

-- 避免使用默认命名或数字
SAVEPOINT '1';  -- 不推荐
```

### 3. 错误日志与回滚

```sql
CREATE OR REPLACE FUNCTION safe_update() RETURNS VOID AS $$
BEGIN
    BEGIN
        -- 业务逻辑
        UPDATE accounts SET balance = balance + 100 WHERE id = 1;
    EXCEPTION WHEN OTHERS THEN
        -- 记录错误，但不中断事务
        RAISE NOTICE 'Update failed: %', SQLERRM;
        -- 可以在此做其他处理
    END;
END;
$$ LANGUAGE plpgsql;
```

## 面试高频问题

### Q1: Savepoint 和 ROLLBACK 的区别是什么？

**考察点**：事务控制理解

**参考答案**：
- ROLLBACK 回滚整个事务
- ROLLBACK TO SAVEPOINT 回滚到保存点，保留保存点之前的修改
- RELEASE SAVEPOINT 释放保存点，但不能回滚

### Q2: PostgreSQL 有嵌套事务吗？

**考察点**：事务模型理解

**参考答案**：
- PostgreSQL 没有真正的嵌套事务
- 可以用 Savepoint 模拟嵌套事务的行为
- Savepoint 更轻量，是 PostgreSQL 推荐的方式

### Q3: 什么时候用 Savepoint？

**考察点**：实际应用

**参考答案**：
1. 批量操作中部分失败，需要继续处理其他项
2. 复杂的业务逻辑，需要条件回滚
3. 嵌套的业务组件，需要独立的事务边界
4. 调试时临时保存状态

## 总结

Savepoint 是 PostgreSQL 事务控制的利器：

| 操作 | 作用 |
|------|------|
| SAVEPOINT name | 创建保存点 |
| ROLLBACK TO SAVEPOINT name | 回滚到保存点 |
| RELEASE SAVEPOINT name | 释放保存点 |

适用场景：
- 批量操作的部分失败处理
- 复杂业务逻辑的条件回滚
- 嵌套事务模拟
- 调试和错误恢复

合理使用 Savepoint，可以让业务逻辑更灵活，同时保持数据一致性。
