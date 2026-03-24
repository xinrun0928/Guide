# PL/SQL 异常处理：预定义异常、用户自定义异常

程序总会出错。

网络断了、数据不存在、用户输入非法……这些"意外"如果处理不好，轻则报错，重则崩溃。

Oracle 的异常处理机制，让你的 PL/SQL 程序即使遇到错误，也能优雅地应对。

今天，我们来深入学习 Oracle 的异常处理。

---

## 什么是异常？

异常是程序执行过程中发生的**中断正常流程的错误**。

```
┌─────────────────────────────────────────────────────────────┐
│                    异常处理流程                              │
│                                                             │
│  BEGIN                                                      │
│      -- 正常执行                                            │
│      SELECT ... INTO ...                                    │
│                                                             │
│      -- 异常发生                                            │
│      DBMS_OUTPUT.PUT_LINE(x / 0);  -- 除零错误             │
│                                                             │
│  EXCEPTION                                                  │
│      WHEN ZERO_DIVIDE THEN  -- 捕获异常                     │
│          -- 处理异常                                        │
│          DBMS_OUTPUT.PUT_LINE('除数不能为零');              │
│                                                             │
│      WHEN OTHERS THEN      -- 兜底处理                      │
│          -- 其他所有异常                                    │
│  END;                                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 异常处理机制

### EXCEPTION 的作用

EXCEPTION 块用于**捕获和处理异常**，防止程序崩溃，并提供有意义的错误信息。

```sql
BEGIN
    -- 可能出错的代码
    SELECT salary INTO v_salary
    FROM employees
    WHERE employee_id = 9999;  -- 员工不存在
    
    DBMS_OUTPUT.PUT_LINE('工资: ' || v_salary);
    
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        DBMS_OUTPUT.PUT_LINE('员工不存在');
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('发生错误: ' || SQLERRM);
END;
/
```

### 异常处理的原则

| 原则 | 说明 |
|-----|------|
| 精确捕获 | 尽量捕获具体异常，不要只用 `WHEN OTHERS` |
| 记录日志 | 捕获异常后记录详细信息，便于排查 |
| 不要静默 | 不要 `WHEN OTHERS THEN NULL`，会隐藏错误 |
| 适当抛出 | 必要时重新抛出异常，让调用者处理 |

---

## 预定义异常

Oracle 提供了一系列预定义异常，无需声明即可使用。

### 常用预定义异常

```sql
-- 1. NO_DATA_FOUND：SELECT INTO 没有返回数据
BEGIN
    SELECT salary INTO v_salary
    FROM employees
    WHERE employee_id = 9999;  -- 不存在
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        DBMS_OUTPUT.PUT_LINE('员工不存在');
END;
/

-- 2. TOO_MANY_ROWS：SELECT INTO 返回多行
BEGIN
    SELECT first_name INTO v_name
    FROM employees
    WHERE department_id = 50;  -- 返回多人
EXCEPTION
    WHEN TOO_MANY_ROWS THEN
        DBMS_OUTPUT.PUT_LINE('返回数据过多，请使用游标');
END;
/

-- 3. DUP_VAL_ON_INDEX：唯一索引冲突
BEGIN
    INSERT INTO employees (employee_id, email) VALUES (100, 'test@test.com');
    INSERT INTO employees (employee_id, email) VALUES (101, 'test@test.com');  -- 邮箱重复
EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
        DBMS_OUTPUT.PUT_LINE('邮箱已被使用');
END;
/

-- 4. INVALID_NUMBER：类型转换失败
BEGIN
    SELECT salary INTO v_salary
    FROM employees
    WHERE employee_id = TO_NUMBER('ABC');  -- 不是数字
EXCEPTION
    WHEN INVALID_NUMBER THEN
        DBMS_OUTPUT.PUT_LINE('无效的数字');
END;
/

-- 5. ZERO_DIVIDE：除数为零
BEGIN
    v_result := 100 / 0;
EXCEPTION
    WHEN ZERO_DIVIDE THEN
        DBMS_OUTPUT.PUT_LINE('除数不能为零');
END;
/

-- 6. VALUE_ERROR：数值或字符串错误
BEGIN
    v_name VARCHAR2(5);
    v_name := '这是一个很长的字符串';  -- 超过长度
EXCEPTION
    WHEN VALUE_ERROR THEN
        DBMS_OUTPUT.PUT_LINE('值超出范围');
END;
/

-- 7. LOGIN_DENIED：登录失败
BEGIN
    NULL;  -- 模拟登录验证
EXCEPTION
    WHEN LOGIN_DENIED THEN
        DBMS_OUTPUT.PUT_LINE('用户名或密码错误');
END;
/
```

### 预定义异常一览

| 异常名称 | 错误代码 | 说明 |
|---------|---------|------|
| NO_DATA_FOUND | ORA-01403 | SELECT INTO 没返回数据 |
| TOO_MANY_ROWS | ORA-01422 | SELECT INTO 返回多行 |
| DUP_VAL_ON_INDEX | ORA-00001 | 唯一索引冲突 |
| INVALID_NUMBER | ORA-01722 | 字符串转数字失败 |
| ZERO_DIVIDE | ORA-01476 | 除数为零 |
| VALUE_ERROR | ORA-06502 | 数值或字符串错误 |
| LOGIN_DENIED | ORA-01017 | 登录失败 |
| NOT_LOGGED_ON | ORA-01012 | 未连接数据库 |
| STORAGE_ERROR | ORA-06500 | 内存错误 |
| PROGRAM_ERROR | ORA-06501 | 内部程序错误 |
| CURSOR_ALREADY_OPEN | ORA-06511 | 游标已打开 |
| INVALID_CURSOR | ORA-01001 | 无效的游标操作 |

---

## 非预定义异常

非预定义异常是 Oracle 错误，但没有预定义名称。需要先声明异常，再将异常与错误代码关联。

### 声明和使用

```sql
DECLARE
    -- 声明异常（无参数）
    e_parent_not_found EXCEPTION;
    -- 将异常与错误代码关联
    PRAGMA EXCEPTION_INIT(e_parent_not_found, -02291);
BEGIN
    -- 外键约束错误
    INSERT INTO employees (employee_id, department_id)
    VALUES (9999, 9999);  -- 部门不存在
EXCEPTION
    WHEN e_parent_not_found THEN
        DBMS_OUTPUT.PUT_LINE('父表记录不存在');
END;
/
```

### 常用错误代码

| 错误代码 | 说明 |
|---------|------|
| -02291 | 外键约束不存在 |
| -02292 | 违反子表约束 |
| -02421 | 主键/唯一键冲突 |
| -04091 | 表正在被修改 |
| -1441 | 无效的日期 |

---

## 用户自定义异常

用户自定义异常是根据**业务规则**定义的异常，需要手动声明和抛出。

### 基本用法

```sql
DECLARE
    -- 声明异常
    e_invalid_salary EXCEPTION;
    e_emp_not_found EXCEPTION;
    
    v_salary NUMBER(10, 2);
BEGIN
    -- 业务验证
    v_salary := -1000;
    
    IF v_salary < 0 THEN
        -- 抛出异常
        RAISE e_invalid_salary;
    END IF;
    
    UPDATE employees SET salary = v_salary WHERE employee_id = 100;
    
    IF SQL%ROWCOUNT = 0 THEN
        RAISE e_emp_not_found;
    END IF;
    
EXCEPTION
    WHEN e_invalid_salary THEN
        DBMS_OUTPUT.PUT_LINE('错误：工资不能为负数');
        ROLLBACK;
    WHEN e_emp_not_found THEN
        DBMS_OUTPUT.PUT_LINE('错误：员工不存在');
        ROLLBACK;
END;
/
```

### RAISE vs RAISE_APPLICATION_ERROR

| 对比项 | RAISE | RAISE_APPLICATION_ERROR |
|-------|-------|----------------------|
| 适用场景 | 用户自定义异常 | 需要指定错误码的场景 |
| 错误代码 | 异常声明决定 | 手动指定（-20000 到 -20999） |
| 错误消息 | 异常消息 | 手动指定 |
| 调用栈 | 包含 | 包含 |

```sql
-- RAISE：抛出已声明的异常
DECLARE
    e_custom EXCEPTION;
BEGIN
    RAISE e_custom;
END;
/

-- RAISE_APPLICATION_ERROR：抛出带错误码的异常
BEGIN
    IF some_condition THEN
        RAISE_APPLICATION_ERROR(-20001, '业务错误：余额不足');
    END IF;
END;
/
```

### 完整示例：订单处理

```sql
CREATE OR REPLACE PROCEDURE process_order(
    p_order_id IN NUMBER,
    p_customer_id IN NUMBER,
    p_product_id IN NUMBER,
    p_quantity IN NUMBER
) IS
    -- 声明异常
    e_insufficient_stock EXCEPTION;
    e_invalid_quantity EXCEPTION;
    e_order_not_found EXCEPTION;
    
    -- 变量
    v_stock NUMBER;
    v_price NUMBER;
    v_customer_balance NUMBER;
BEGIN
    -- 验证数量
    IF p_quantity <= 0 THEN
        RAISE e_invalid_quantity;
    END IF;
    
    -- 检查库存
    SELECT stock_quantity INTO v_stock
    FROM products
    WHERE product_id = p_product_id;
    
    IF v_stock < p_quantity THEN
        RAISE e_insufficient_stock;
    END IF;
    
    -- 检查客户余额
    SELECT balance INTO v_customer_balance
    FROM customers
    WHERE customer_id = p_customer_id;
    
    -- 获取价格
    SELECT price INTO v_price
    FROM products
    WHERE product_id = p_product_id;
    
    IF v_customer_balance < v_price * p_quantity THEN
        RAISE_APPLICATION_ERROR(-20001, '客户余额不足');
    END IF;
    
    -- 更新库存
    UPDATE products
    SET stock_quantity = stock_quantity - p_quantity
    WHERE product_id = p_product_id;
    
    -- 创建订单
    INSERT INTO orders (order_id, customer_id, product_id, quantity, order_date)
    VALUES (p_order_id, p_customer_id, p_product_id, p_quantity, SYSDATE);
    
    -- 更新客户余额
    UPDATE customers
    SET balance = balance - v_price * p_quantity
    WHERE customer_id = p_customer_id;
    
    COMMIT;
    
    DBMS_OUTPUT.PUT_LINE('订单处理成功');
    
EXCEPTION
    WHEN e_invalid_quantity THEN
        DBMS_OUTPUT.PUT_LINE('错误：数量必须大于0');
        ROLLBACK;
    WHEN e_insufficient_stock THEN
        DBMS_OUTPUT.PUT_LINE('错误：库存不足，当前库存: ' || v_stock);
        ROLLBACK;
    WHEN NO_DATA_FOUND THEN
        DBMS_OUTPUT.PUT_LINE('错误：产品或客户不存在');
        ROLLBACK;
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('未知错误: ' || SQLERRM);
        ROLLBACK;
        RAISE;  -- 重新抛出，让调用者知道
END process_order;
/
```

---

## SQLCODE 和 SQLERRM

### 获取错误信息

```sql
EXCEPTION
    WHEN OTHERS THEN
        -- 错误代码（负数）
        DBMS_OUTPUT.PUT_LINE('错误代码: ' || SQLCODE);
        
        -- 错误消息（最多 512 字符）
        DBMS_OUTPUT.PUT_LINE('错误消息: ' || SQLERRM);
        
        -- 完整错误消息（带正数错误代码）
        DBMS_OUTPUT.PUT_LINE('完整错误: ' || SQLERRM(SQLCODE));
END;
/
```

### SQLERRM 详解

```sql
BEGIN
    NULL;
EXCEPTION
    WHEN OTHERS THEN
        -- SQLCODE = 0：无错误
        -- SQLCODE = 1：用户自定义异常（RAISE）
        -- SQLCODE = 100：NO_DATA_FOUND
        -- SQLCODE < 0：系统错误
        
        -- SQLERRM(-942)：获取特定错误码的消息
        DBMS_OUTPUT.PUT_LINE(SQLERRM(-942));  -- ORA-00942: table or view does not exist
END;
/
```

---

## 异常传播

### 子程序中的异常传播

```sql
CREATE OR REPLACE PROCEDURE inner_proc IS
BEGIN
    RAISE_APPLICATION_ERROR(-20001, '内部错误');
EXCEPTION
    WHEN OTHERS THEN
        -- 处理后重新抛出
        RAISE;
END inner_proc;
/

CREATE OR REPLACE PROCEDURE outer_proc IS
BEGIN
    inner_proc;  -- 调用内部过程
EXCEPTION
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('捕获到异常: ' || SQLERRM);
END outer_proc;
/
```

### RAISE 语句

```sql
-- 在异常处理中重新抛出异常
EXCEPTION
    WHEN OTHERS THEN
        -- 记录日志
        INSERT INTO error_log (...) VALUES (...);
        COMMIT;
        -- 重新抛出
        RAISE;
END;
/
```

---

## 异常处理最佳实践

### 1. 不要吞掉异常

```sql
-- 不好：静默处理
EXCEPTION
    WHEN OTHERS THEN NULL;  -- 错误被隐藏！

-- 好：记录并处理或抛出
EXCEPTION
    WHEN OTHERS THEN
        log_error(SQLCODE, SQLERRM);
        RAISE;
END;
/
```

### 2. 按顺序捕获

```sql
-- 好：先具体后一般
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        -- 先处理具体异常
        DBMS_OUTPUT.PUT_LINE('找不到数据');
    WHEN TOO_MANY_ROWS THEN
        DBMS_OUTPUT.PUT_LINE('数据过多');
    WHEN OTHERS THEN
        -- 最后兜底
        DBMS_OUTPUT.PUT_LINE('其他错误');
END;
/
```

### 3. 使用 WHEN OTHERS THEN

```sql
-- 好：在异常块中放在最后
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        handle_not_found;
    WHEN DUP_VAL_ON_INDEX THEN
        handle_duplicate;
    WHEN OTHERS THEN
        log_error;
        RAISE;
END;
```

### 4. 记录详细日志

```sql
CREATE TABLE error_log (
    error_id NUMBER PRIMARY KEY,
    error_code NUMBER,
    error_message VARCHAR2(2000),
    error_backtrace VARCHAR2(4000),
    user_name VARCHAR2(50),
    program_name VARCHAR2(100),
    error_time DATE
);

EXCEPTION
    WHEN OTHERS THEN
        INSERT INTO error_log (
            error_id, error_code, error_message, user_name, program_name, error_time
        ) VALUES (
            error_seq.NEXTVAL,
            SQLCODE,
            SQLERRM,
            USER,
            $$PLSQL_UNIT,
            SYSDATE
        );
        
        -- 获取调用栈
        DBMS_UTILITY.FORMAT_ERROR_BACKTRACE;
        
        COMMIT;
        RAISE;
END;
/
```

---

## 面试高频问题

### Q1: 如何抛出自定义异常？

1. 声明异常：`e_my_exception EXCEPTION;`
2. 抛出异常：`RAISE e_my_exception;`
3. 捕获异常：`WHEN e_my_exception THEN ...`

### Q2: RAISE 和 RAISE_APPLICATION_ERROR 的区别？

- **RAISE**：抛出已声明的异常，错误代码由声明决定
- **RAISE_APPLICATION_ERROR**：抛出带自定义错误码（-20000~-20999）和消息的异常

### Q3: WHEN OTHERS THEN NULL; 有什么问题？

会静默吞掉异常，隐藏错误，导致问题难以排查。应该记录日志或重新抛出。

### Q4: SQLCODE 和 SQLERRM 的区别？

- **SQLCODE**：返回错误代码（数字）
- **SQLERRM**：返回错误消息（字符串）

---

## 总结

异常处理核心要点：

| 类型 | 说明 | 使用方式 |
|-----|------|---------|
| 预定义异常 | Oracle 内置 | 直接使用 |
| 非预定义异常 | Oracle 错误，需关联 | `PRAGMA EXCEPTION_INIT` |
| 用户自定义异常 | 业务规则 | 声明 + `RAISE` |

```sql
EXCEPTION
    WHEN specific_exception THEN
        -- 处理特定异常
    WHEN OTHERS THEN
        -- 记录日志
        log_error;
        -- 重新抛出
        RAISE;
END;
```

完善的异常处理是高质量 PL/SQL 代码的标志。

---

## 下一步

- [Oracle 序列与同义词](/database/oracle/sequence-synonym)：序列、同义词的使用
- [Oracle 事务管理](/database/oracle/transaction)：COMMIT、ROLLBACK 的内部机制
