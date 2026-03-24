# PL/SQL 存储过程与函数：参数模式与返回类型

你已经会写 PL/SQL 块了，但每次都要在 SQL*Plus 里粘贴执行，效率太低。

怎么办？

**存储过程和函数**就是答案。它们存储在数据库中，可以被反复调用，是 PL/SQL 编程的核心。

今天，我们来深入学习 Oracle 的存储过程和函数。

---

## 存储过程 vs 函数：核心区别

| 对比项 | 存储过程 (Procedure) | 函数 (Function) |
|-------|---------------------|-----------------|
| 返回值 | 可以有 0 个或多个 OUT 参数 | 必须有 RETURN 语句返回单个值 |
| 调用方式 | 独立调用，或作为 CALL 语句 | 只能在 SQL 表达式或 PL/SQL 中调用 |
| 使用位置 | 可独立执行 | 可在 SELECT、WHERE 中使用 |
| DML 操作 | 可包含事务控制 | 不能直接包含 COMMIT/ROLLBACK |

```sql
-- 函数可以在 SQL 中调用
SELECT get_employee_name(100) FROM DUAL;

-- 存储过程必须单独调用
CALL update_salary(100, 5000);
```

---

## 存储过程

### 创建语法

```sql
CREATE OR REPLACE PROCEDURE procedure_name
    [(parameter1 [IN|OUT|IN OUT] datatype, ...)]
IS|AS
    -- 声明部分
BEGIN
    -- 执行部分
EXCEPTION
    -- 异常处理
END [procedure_name];
/
```

### 参数模式

```sql
-- IN：输入参数（默认），只读
CREATE OR REPLACE PROCEDURE greet(p_name IN VARCHAR2) IS
BEGIN
    DBMS_OUTPUT.PUT_LINE('Hello, ' || p_name || '!');
END;
/

-- 调用
BEGIN
    greet('Oracle');  -- Hello, Oracle!
END;
/

-- OUT：输出参数，只写
CREATE OR REPLACE PROCEDURE get_emp_info(
    p_emp_id IN NUMBER,
    p_emp_name OUT VARCHAR2,
    p_emp_salary OUT NUMBER
) IS
BEGIN
    SELECT first_name, salary
    INTO p_emp_name, p_emp_salary
    FROM employees
    WHERE employee_id = p_emp_id;
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        p_emp_name := 'NOT FOUND';
        p_emp_salary := 0;
END;
/

-- 调用（需要变量接收输出）
DECLARE
    v_name VARCHAR2(50);
    v_salary NUMBER(10, 2);
BEGIN
    get_emp_info(100, v_name, v_salary);
    DBMS_OUTPUT.PUT_LINE('姓名: ' || v_name || ', 工资: ' || v_salary);
END;
/

-- IN OUT：既输入又输出
CREATE OR REPLACE PROCEDURE double_value(p_num IN OUT NUMBER) IS
BEGIN
    p_num := p_num * 2;
END;
/

-- 调用
DECLARE
    v_num NUMBER := 10;
BEGIN
    double_value(v_num);  -- v_num 变成 20
    DBMS_OUTPUT.PUT_LINE('结果: ' || v_num);
END;
/
```

### 完整示例：员工薪资调整

```sql
CREATE OR REPLACE PROCEDURE adjust_salary(
    p_emp_id    IN  NUMBER,
    p_raise_pct IN  NUMBER,
    p_new_salary OUT NUMBER,
    p_result    OUT VARCHAR2
) IS
    v_old_salary NUMBER(10, 2);
    v_max_salary CONSTANT NUMBER := 50000;
BEGIN
    -- 获取当前工资
    SELECT salary INTO v_old_salary
    FROM employees
    WHERE employee_id = p_emp_id;
    
    -- 计算新工资
    p_new_salary := v_old_salary * (1 + p_raise_pct);
    
    -- 检查上限
    IF p_new_salary > v_max_salary THEN
        p_result := 'FAILED: 超过最高工资限制 ' || v_max_salary;
        RETURN;
    END IF;
    
    -- 更新工资
    UPDATE employees
    SET salary = p_new_salary
    WHERE employee_id = p_emp_id;
    
    p_result := 'SUCCESS';
    
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        p_result := 'FAILED: 员工不存在';
        p_new_salary := 0;
    WHEN OTHERS THEN
        p_result := 'FAILED: ' || SQLERRM;
        p_new_salary := 0;
END adjust_salary;
/

-- 调用
DECLARE
    v_new_salary NUMBER(10, 2);
    v_result VARCHAR2(200);
BEGIN
    adjust_salary(100, 0.1, v_new_salary, v_result);
    DBMS_OUTPUT.PUT_LINE(v_result);
    IF v_result LIKE 'SUCCESS%' THEN
        COMMIT;
    ELSE
        ROLLBACK;
    END IF;
END;
/
```

---

## 函数

### 创建语法

```sql
CREATE OR REPLACE FUNCTION function_name
    [(parameter1 [IN] datatype, ...)]
    RETURN return_datatype
IS|AS
    -- 声明部分
BEGIN
    -- 执行部分
    RETURN value;
EXCEPTION
    -- 异常处理
END [function_name];
/
```

### 简单函数

```sql
-- 函数：获取员工全名
CREATE OR REPLACE FUNCTION get_full_name(
    p_first_name IN VARCHAR2,
    p_last_name IN VARCHAR2
) RETURN VARCHAR2 IS
BEGIN
    RETURN p_first_name || ' ' || p_last_name;
END get_full_name;
/

-- 调用
BEGIN
    DBMS_OUTPUT.PUT_LINE(get_full_name('John', 'Smith'));
END;
/

-- 在 SQL 中调用
SELECT get_full_name(first_name, last_name) AS full_name
FROM employees;
```

### 带异常处理的函数

```sql
-- 函数：根据 ID 获取员工工资
CREATE OR REPLACE FUNCTION get_employee_salary(
    p_emp_id IN NUMBER
) RETURN NUMBER IS
    v_salary NUMBER(10, 2);
BEGIN
    SELECT salary INTO v_salary
    FROM employees
    WHERE employee_id = p_emp_id;
    
    RETURN v_salary;
    
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        RETURN -1;  -- 用 -1 表示员工不存在
END get_employee_salary;
/

-- 调用
BEGIN
    DBMS_OUTPUT.PUT_LINE('工资: ' || get_employee_salary(100));
END;
/
```

### 函数中使用 DML

函数中不能直接使用 COMMIT/ROLLBACK，但可以执行 DML：

```sql
-- 函数：更新员工电话
CREATE OR REPLACE FUNCTION update_phone(
    p_emp_id IN NUMBER,
    p_new_phone IN VARCHAR2
) RETURN BOOLEAN IS
BEGIN
    UPDATE employees
    SET phone_number = p_new_phone
    WHERE employee_id = p_emp_id;
    
    RETURN SQL%ROWCOUNT > 0;  -- 返回是否更新成功
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN FALSE;
END update_phone;
/

-- 调用
BEGIN
    IF update_phone(100, '515-123-4567') THEN
        COMMIT;
        DBMS_OUTPUT.PUT_LINE('电话更新成功');
    ELSE
        ROLLBACK;
        DBMS_OUTPUT.PUT_LINE('电话更新失败');
    END IF;
END;
/
```

---

## 高级特性

### 默认参数值

```sql
CREATE OR REPLACE PROCEDURE create_employee(
    p_first_name IN VARCHAR2,
    p_last_name IN VARCHAR2,
    p_email IN VARCHAR2 := 'N/A',        -- 默认值
    p_salary IN NUMBER := 3000,           -- 默认值
    p_dept_id IN NUMBER := 10             -- 默认值
) IS
BEGIN
    INSERT INTO employees (
        employee_id, first_name, last_name, 
        email, salary, department_id, hire_date
    ) VALUES (
        emp_seq.NEXTVAL, p_first_name, p_last_name,
        p_email, p_salary, p_dept_id, SYSDATE
    );
    
    DBMS_OUTPUT.PUT_LINE('员工创建成功');
END create_employee;
/

-- 调用（省略默认参数）
BEGIN
    create_employee('John', 'Doe');
    create_employee('Jane', 'Smith', 'JANE.SMITH', 5000);
END;
/
```

### PRAGMA AUTONOMOUS_TRANSACTION

使函数/过程拥有独立事务，可以执行 COMMIT：

```sql
CREATE OR REPLACE FUNCTION log_action(
    p_action IN VARCHAR2,
    p_user IN VARCHAR2
) RETURN NUMBER IS
    PRAGMA AUTONOMOUS_TRANSACTION;  -- 声明自治事务
    v_log_id NUMBER;
BEGIN
    INSERT INTO action_log (action, user_name, action_time)
    VALUES (p_action, p_user, SYSDATE);
    
    COMMIT;  -- 可以在自治事务中提交
    
    RETURN SQL%ROWCOUNT;
END log_action;
/
```

### PIPELINED 函数：返回表

创建像表一样查询的函数：

```sql
CREATE OR REPLACE TYPE t_emp_row IS OBJECT (
    emp_id NUMBER,
    emp_name VARCHAR2(100),
    emp_salary NUMBER(10, 2)
);
/

CREATE OR REPLACE TYPE t_emp_table IS TABLE OF t_emp_row;
/

CREATE OR REPLACE FUNCTION get_high_salary_emps(p_min_salary NUMBER)
    RETURN t_emp_table
    PIPELINED
IS
    v_emp t_emp_row;
BEGIN
    FOR rec IN (SELECT employee_id, first_name || ' ' || last_name AS name, salary
                FROM employees
                WHERE salary >= p_min_salary) LOOP
        v_emp := t_emp_row(rec.employee_id, rec.name, rec.salary);
        PIPE ROW(v_emp);
    END LOOP;
    
    RETURN;
END get_high_salary_emps;
/

-- 使用
SELECT * FROM TABLE(get_high_salary_emps(10000));
```

---

## 管理存储过程和函数

```sql
-- 查看用户的所有过程
SELECT object_name, object_type
FROM user_objects
WHERE object_type IN ('PROCEDURE', 'FUNCTION');

-- 查看过程源代码
SELECT text
FROM user_source
WHERE name = 'ADJUST_SALARY'
ORDER BY line;

-- 重新编译
ALTER PROCEDURE adjust_salary COMPILE;

-- 删除
DROP PROCEDURE adjust_salary;
DROP FUNCTION get_employee_salary;

-- 查看依赖关系
SELECT * FROM user_dependencies
WHERE name = 'ADJUST_SALARY';
```

---

## 面试高频问题

### Q1: 存储过程和函数的区别？

- **函数**必须有返回值，存储过程可以没有
- **函数**可以在 SQL 中调用，存储过程不能
- **函数**不能包含事务控制语句（COMMIT/ROLLBACK），存储过程可以

### Q2: IN、OUT、IN OUT 参数的区别？

| 模式 | 方向 | 说明 |
|-----|------|------|
| IN | 输入 | 只读，默认模式 |
| OUT | 输出 | 只写，调用前初始值被忽略 |
| IN OUT | 输入输出 | 既读又写 |

### Q3: 如何在 SQL 中调用函数？

函数必须满足以下条件才能在 SQL 中调用：

1. 参数必须是 IN 模式
2. 参数类型必须是 SQL 支持的类型
3. 函数体不能包含 COMMIT/ROLLBACK
4. 不能在函数中调用包含 DDL 的过程

### Q4: PRAGMA AUTONOMOUS_TRANSACTION 有什么用？

创建**自治事务**，使函数/过程拥有独立于主事务的事务上下文。常用于日志记录，即使主事务回滚，日志也能提交。

---

## 总结

| 对比项 | 存储过程 | 函数 |
|-------|---------|------|
| 返回值 | 0 个或多个 OUT 参数 | RETURN 语句返回值 |
| SQL 调用 | 不能 | 可以 |
| 事务控制 | 可以 COMMIT/ROLLBACK | 不能直接控制 |
| 使用场景 | 复杂业务逻辑、DML 操作 | 计算、转换、返回单值 |

```sql
-- 存储过程
CREATE OR REPLACE PROCEDURE proc_name(param IN NUMBER) IS
BEGIN
    -- 业务逻辑
END proc_name;

-- 函数
CREATE OR REPLACE FUNCTION func_name(param IN NUMBER) RETURN NUMBER IS
BEGIN
    RETURN param * 2;
END func_name;
```

---

## 下一步

- [PL/SQL 触发器](/database/oracle/trigger)：DML 触发器、INSTEAD OF 触发器
- [PL/SQL 游标](/database/oracle/cursor)：显式游标与隐式游标
