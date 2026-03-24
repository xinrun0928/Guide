# PL/SQL 块结构：DECLARE、BEGIN、EXCEPTION、END

你有没有这种感觉：SQL 查询已经足够强大了，但处理复杂业务逻辑时，还是需要写很多重复的 SQL？

Oracle 的答案是：**PL/SQL**。

PL/SQL（Procedural Language/SQL）是 Oracle 对 SQL 的扩展，它让你可以在数据库端编写过程式代码——变量、循环、条件判断、异常处理，一个都不能少。

今天，我们从 PL/SQL 最基础的部分讲起：**块结构**。

---

## PL/SQL 块结构详解

PL/SQL 程序由**块（Block）**组成，每个块包含三个部分：

```
┌─────────────────────────────────────────────────────────────┐
│                      PL/SQL 块结构                          │
│                                                             │
│  DECLARE        -- 可选：声明变量、常量、游标               │
│      v_var VARCHAR2(20);                                   │
│  BEGIN          -- 必需：程序逻辑                           │
│      -- SQL 语句                                            │
│      -- PL/SQL 语句                                        │
│  EXCEPTION     -- 可选：异常处理                           │
│      WHEN OTHERS THEN                                      │
│          -- 处理异常                                        │
│  END;          -- 必需：程序结束                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 最小结构：只有 BEGIN 和 END

```sql
BEGIN
    DBMS_OUTPUT.PUT_LINE('Hello, Oracle!');
END;
/
```

注意：PL/SQL 块以 `/` 结束，表示执行。

---

## DECLARE：声明部分

### 变量声明

```sql
DECLARE
    -- 变量声明：变量名 数据类型 [NOT NULL] [:= 初始值]
    v_emp_name VARCHAR2(50);
    v_salary NUMBER(10, 2);
    v_hire_date DATE;
    v_count NUMBER := 0;  -- 带初始值
    v_pi CONSTANT NUMBER := 3.14159;  -- 常量
BEGIN
    NULL;  -- 空语句，什么都不做
END;
/
```

### 数据类型

```sql
DECLARE
    v_num1 NUMBER;           -- 数字
    v_num2 NUMBER(10,2);     -- 整数或定点数
    v_char VARCHAR2(100);    -- 字符串
    v_date DATE;             -- 日期
    v_bool BOOLEAN;          -- 布尔型
    v_clob CLOB;             -- 大对象
    v_blob BLOB;             -- 二进制大对象
BEGIN
    NULL;
END;
/
```

### 使用 %TYPE 属性

使用 `%TYPE` 可以让变量类型与表字段或变量类型保持一致：

```sql
DECLARE
    -- 与 employees 表的 last_name 字段类型相同
    v_name employees.last_name%TYPE;
    -- 与已声明变量类型相同
    v_name2 v_name%TYPE;
BEGIN
    NULL;
END;
/
```

### 使用 %ROWTYPE 属性

使用 `%ROWTYPE` 可以声明一个记录类型，与表行结构一致：

```sql
DECLARE
    -- 整个 employees 表的行结构
    v_emp employees%ROWTYPE;
BEGIN
    SELECT * INTO v_emp
    FROM employees
    WHERE employee_id = 100;
    
    DBMS_OUTPUT.PUT_LINE('员工姓名: ' || v_emp.first_name);
END;
/
```

### RECORD 类型

自定义记录类型：

```sql
DECLARE
    TYPE t_emp_record IS RECORD (
        emp_id    NUMBER,
        emp_name  VARCHAR2(100),
        emp_salary NUMBER(10, 2)
    );
    v_emp t_emp_record;
BEGIN
    v_emp.emp_id := 100;
    v_emp.emp_name := 'John';
    v_emp.emp_salary := 5000;
END;
/
```

---

## BEGIN：执行部分

### 基本语句

```sql
DECLARE
    v_name VARCHAR2(50);
    v_salary NUMBER(10, 2);
BEGIN
    -- 赋值语句
    v_name := '张三';
    v_salary := 8000.50;
    
    -- SELECT INTO（必须返回一行）
    SELECT first_name, salary
    INTO v_name, v_salary
    FROM employees
    WHERE employee_id = 100;
    
    -- 输出
    DBMS_OUTPUT.PUT_LINE('姓名: ' || v_name || ', 工资: ' || v_salary);
END;
/
```

### 条件判断

```sql
DECLARE
    v_salary NUMBER(10, 2);
    v_level VARCHAR2(20);
BEGIN
    SELECT salary INTO v_salary
    FROM employees
    WHERE employee_id = 100;
    
    -- IF-THEN-ELSIF-ELSE
    IF v_salary >= 10000 THEN
        v_level := '高薪';
    ELSIF v_salary >= 5000 THEN
        v_level := '中等';
    ELSE
        v_level := '普通';
    END IF;
    
    DBMS_OUTPUT.PUT_LINE('薪资等级: ' || v_level);
END;
/
```

### CASE 语句

```sql
DECLARE
    v_dept_id NUMBER := 50;
    v_dept_name VARCHAR2(50);
BEGIN
    -- CASE 表达式
    v_dept_name := CASE v_dept_id
        WHEN 10 THEN '行政部'
        WHEN 20 THEN '市场部'
        WHEN 30 THEN '销售部'
        ELSE '其他部门'
    END;
    
    DBMS_OUTPUT.PUT_LINE('部门: ' || v_dept_name);
END;
/
```

### 循环

```sql
DECLARE
    v_counter NUMBER := 1;
BEGIN
    -- 基本循环
    LOOP
        DBMS_OUTPUT.PUT_LINE('计数器: ' || v_counter);
        v_counter := v_counter + 1;
        EXIT WHEN v_counter > 5;  -- 退出条件
    END LOOP;
END;
/
```

```sql
BEGIN
    -- WHILE 循环
    DECLARE
        v_counter NUMBER := 1;
    BEGIN
        WHILE v_counter <= 5 LOOP
            DBMS_OUTPUT.PUT_LINE('WHILE: ' || v_counter);
            v_counter := v_counter + 1;
        END LOOP;
    END;
END;
/
```

```sql
BEGIN
    -- FOR 循环
    FOR i IN 1..5 LOOP
        DBMS_OUTPUT.PUT_LINE('FOR: ' || i);
    END LOOP;
    
    -- REVERSE 反向
    FOR i IN REVERSE 1..5 LOOP
        DBMS_OUTPUT.PUT_LINE('REVERSE: ' || i);
    END LOOP;
END;
/
```

### GOTO 语句（不推荐）

```sql
BEGIN
    GOTO skip_output;  -- 跳转到标签
    DBMS_OUTPUT.PUT_LINE('这条不会执行');
    <<skip_output>>
    DBMS_OUTPUT.PUT_LINE('跳到这里执行');
END;
/
```

**注意**：GOTO 语句会破坏程序结构，不推荐使用。

---

## EXCEPTION：异常处理

### 什么是异常？

异常是程序执行过程中发生的错误。PL/SQL 提供了完善的异常处理机制。

```
异常分类：
┌─────────────────────────────────────────────────────────────┐
│                      Oracle 异常                            │
│                                                             │
│  ┌───────────────────────┐  ┌───────────────────────────┐   │
│  │    系统异常            │  │    用户自定义异常         │   │
│  │    (预定义)           │  │                           │   │
│  │                       │  │    RAISE_APPLICATION_ERROR│   │
│  │  TOO_MANY_ROWS       │  │    RAISE                   │   │
│  │  NO_DATA_FOUND       │  │                           │   │
│  │  DUP_VAL_ON_INDEX    │  │                           │   │
│  │  ...                 │  │                           │   │
│  └───────────────────────┘  └───────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 预定义异常

```sql
DECLARE
    v_name VARCHAR2(50);
    v_salary NUMBER(10, 2);
BEGIN
    -- NO_DATA_FOUND：查询没有返回数据
    SELECT first_name INTO v_name
    FROM employees
    WHERE employee_id = 9999;  -- 不存在的员工
    
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        DBMS_OUTPUT.PUT_LINE('员工不存在');
    WHEN TOO_MANY_ROWS THEN
        DBMS_OUTPUT.PUT_LINE('返回数据过多');
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('其他错误: ' || SQLERRM);
END;
/
```

### TOO_MANY_ROWS 处理

```sql
DECLARE
    v_name VARCHAR2(50);
BEGIN
    -- 返回多行会触发 TOO_MANY_ROWS
    SELECT first_name INTO v_name
    FROM employees
    WHERE department_id = 50;
    
EXCEPTION
    WHEN TOO_MANY_ROWS THEN
        DBMS_OUTPUT.PUT_LINE('部门有多名员工，请使用游标');
END;
/
```

### 用户自定义异常

```sql
DECLARE
    -- 声明异常
    e_invalid_salary EXCEPTION;
    v_salary NUMBER(10, 2) := -1000;
BEGIN
    -- 检查业务规则
    IF v_salary < 0 THEN
        -- 抛出异常
        RAISE e_invalid_salary;
    END IF;
    
EXCEPTION
    WHEN e_invalid_salary THEN
        DBMS_OUTPUT.PUT_LINE('错误：工资不能为负数');
END;
/
```

### RAISE_APPLICATION_ERROR

用于抛出带错误码的自定义错误：

```sql
BEGIN
    -- 模拟业务验证
    IF TRUE THEN
        -- 错误码范围：-20000 到 -20999
        RAISE_APPLICATION_ERROR(-20001, '业务错误：无效的操作');
    END IF;
    
EXCEPTION
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('错误码: ' || SQLCODE);
        DBMS_OUTPUT.PUT_LINE('错误消息: ' || SQLERRM);
        RAISE;  -- 重新抛出异常
END;
/
```

### SQLCODE 和 SQLERRM

```sql
EXCEPTION
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('错误码: ' || SQLCODE);   -- 错误码
        DBMS_OUTPUT.PUT_LINE('错误消息: ' || SQLERRM);  -- 错误信息
        -- 记录日志
        INSERT INTO error_log (error_code, error_msg, error_time)
        VALUES (SQLCODE, SQLERRM, SYSDATE);
        COMMIT;
END;
/
```

---

## 完整示例：员工薪资调整

```sql
DECLARE
    v_emp_id NUMBER := 100;
    v_old_salary NUMBER(10, 2);
    v_new_salary NUMBER(10, 2);
    v_raise_percent NUMBER := 0.1;
    e_salary_limit EXCEPTION;
BEGIN
    -- 获取当前工资
    SELECT salary INTO v_old_salary
    FROM employees
    WHERE employee_id = v_emp_id;
    
    -- 计算新工资
    v_new_salary := v_old_salary * (1 + v_raise_percent);
    
    -- 检查业务规则：涨薪后不超过 30000
    IF v_new_salary > 30000 THEN
        RAISE e_salary_limit;
    END IF;
    
    -- 更新工资
    UPDATE employees
    SET salary = v_new_salary
    WHERE employee_id = v_emp_id;
    
    COMMIT;
    
    DBMS_OUTPUT.PUT_LINE('员工 ' || v_emp_id || ' 工资调整完成');
    DBMS_OUTPUT.PUT_LINE('原工资: ' || v_old_salary || ', 新工资: ' || v_new_salary);
    
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        DBMS_OUTPUT.PUT_LINE('错误：员工不存在');
        ROLLBACK;
    WHEN e_salary_limit THEN
        DBMS_OUTPUT.PUT_LINE('错误：涨薪后超过上限 30000');
        ROLLBACK;
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('未知错误: ' || SQLERRM);
        ROLLBACK;
END;
/
```

---

## 面试高频问题

### Q1: PL/SQL 块的三部分是什么？

**DECLARE（可选）** → **BEGIN（必须）** → **EXCEPTION（可选）** → **END（必须）**

### Q2: %TYPE 和 %ROWTYPE 的区别？

- **%TYPE**：获取表字段或变量的数据类型
- **%ROWTYPE**：获取整行的数据类型（记录类型）

### Q3: 预定义异常有哪些？

| 异常 | 说明 |
|-----|------|
| NO_DATA_FOUND | SELECT INTO 没有返回数据 |
| TOO_MANY_ROWS | SELECT INTO 返回多行 |
| DUP_VAL_ON_INDEX | 唯一索引冲突 |
| INVALID_NUMBER | 字符串转数字失败 |
| ZERO_DIVIDE | 除以零 |
| OTHERS | 捕获所有异常 |

### Q4: WHEN OTHERS THEN NULL; 是好习惯吗？

**不是**。这种方式会静默吞掉异常，不推荐。应该记录日志或重新抛出异常：

```sql
-- 不好
EXCEPTION
    WHEN OTHERS THEN NULL;

-- 推荐
EXCEPTION
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('错误: ' || SQLERRM);
        RAISE;  -- 重新抛出
END;
/
```

---

## 总结

PL/SQL 块结构核心要点：

| 部分 | 关键字 | 说明 |
|-----|--------|------|
| 声明 | DECLARE | 变量、常量、游标、异常 |
| 执行 | BEGIN | 程序逻辑 |
| 异常 | EXCEPTION | 错误处理 |
| 结束 | END | 程序结束 |

```sql
DECLARE
    -- 声明变量
    v_var VARCHAR2(50);
BEGIN
    -- 执行逻辑
    NULL;
EXCEPTION
    -- 异常处理
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE(SQLERRM);
END;
/
```

理解块结构，是学习 PL/SQL 的基础。下一节，我们来学习存储过程和函数。

---

## 下一步

- [PL/SQL 存储过程与函数](/database/oracle/procedure-function)：参数模式与返回类型
- [PL/SQL 游标](/database/oracle/cursor)：显式游标与隐式游标
