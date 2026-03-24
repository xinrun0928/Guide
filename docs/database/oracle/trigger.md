# PL/SQL 触发器：DML 触发器、INSTEAD OF 触发器、系统触发器

你有没有想过：**当某个表被 INSERT、UPDATE、DELETE 时，自动执行一段代码？**

比如：
- 每次插入订单时，自动检查库存是否充足
- 每次删除员工时，自动记录到审计表
- 每次修改工资时，自动发送通知

这些场景，**触发器（Trigger）** 都能帮你实现。

今天，我们来深入学习 Oracle 触发器。

---

## 触发器是什么？

触发器是**与表关联的存储过程**，当特定事件发生时自动执行。

```
┌─────────────────────────────────────────────────────────────┐
│                      Oracle 触发器                           │
│                                                             │
│  ┌───────────────┐                                         │
│  │   触发事件    │                                         │
│  │  INSERT       │                                         │
│  │  UPDATE       │────────► 触发器体 ────► 执行             │
│  │  DELETE       │         (PL/SQL 块)                     │
│  └───────────────┘                                         │
│       ▲                                                    │
│       │                                                    │
│  用户对表执行 DML 操作                                      │
└─────────────────────────────────────────────────────────────┘
```

---

## 触发器类型

### 按触发时机

| 类型 | 说明 |
|-----|------|
| BEFORE | 在操作执行之前触发 |
| AFTER | 在操作执行之后触发 |
| INSTEAD OF | 代替原始操作执行（用于视图） |

### 按触发级别

| 类型 | 说明 |
|-----|------|
| 语句级（DEFAULT） | 每个语句触发一次 |
| 行级（FOREACH ROW） | 每行受影响触发一次 |

### 按触发事件

| 事件 | 说明 |
|-----|------|
| INSERT | 插入数据 |
| UPDATE | 更新数据 |
| DELETE | 删除数据 |
| CREATE | 创建对象 |
| ALTER | 修改对象 |
| DROP | 删除对象 |

---

## DML 触发器

### 基本语法

```sql
CREATE [OR REPLACE] TRIGGER trigger_name
{BEFORE | AFTER | INSTEAD OF}
{INSERT | UPDATE [OF column, ...] | DELETE}
ON {table_name | view_name}
[REFERENCING {OLD AS old | NEW AS new}]
[FOR EACH ROW [WHEN condition]]
[DECLARE
    -- 声明
]
BEGIN
    -- 触发器体
[EXCEPTION
    -- 异常处理
]
END [trigger_name];
/
```

### INSERT 触发器

```sql
-- 员工入职时，自动记录日志
CREATE OR REPLACE TRIGGER trg_emp_insert
AFTER INSERT ON employees
FOR EACH ROW
BEGIN
    INSERT INTO emp_audit (
        audit_id, action, emp_id, emp_name, action_date
    ) VALUES (
        audit_seq.NEXTVAL, 'INSERT', :NEW.employee_id, 
        :NEW.first_name || ' ' || :NEW.last_name, SYSDATE
    );
END trg_emp_insert;
/

-- :NEW 和 :OLD 的使用
-- INSERT: 只有 :NEW（插入的新值）
-- DELETE: 只有 :OLD（删除前的值）
-- UPDATE: 两者都有
```

### UPDATE 触发器

```sql
-- 工资变更时，自动记录变更日志
CREATE OR REPLACE TRIGGER trg_emp_salary_update
AFTER UPDATE OF salary ON employees
FOR EACH ROW
WHEN (OLD.salary != NEW.salary)  -- 仅当工资实际变化时
BEGIN
    INSERT INTO salary_change_log (
        emp_id, old_salary, new_salary, change_date, changed_by
    ) VALUES (
        :OLD.employee_id,
        :OLD.salary,
        :NEW.salary,
        SYSDATE,
        USER
    );
END trg_emp_salary_update;
/

-- UPDATE OF column: 只监控特定列
-- WHEN 条件: 行级触发器的过滤条件
```

### DELETE 触发器

```sql
-- 员工离职时，将其转入离职员工表
CREATE OR REPLACE TRIGGER trg_emp_delete
BEFORE DELETE ON employees
FOR EACH ROW
BEGIN
    -- 先插入离职表
    INSERT INTO former_employees (
        emp_id, emp_name, hire_date, terminate_date, final_salary
    ) VALUES (
        :OLD.employee_id,
        :OLD.first_name || ' ' || :OLD.last_name,
        :OLD.hire_date,
        SYSDATE,
        :OLD.salary
    );
    
    -- 记录删除日志
    INSERT INTO emp_audit (
        audit_id, action, emp_id, emp_name, action_date
    ) VALUES (
        audit_seq.NEXTVAL, 'DELETE', :OLD.employee_id,
        :OLD.first_name || ' ' || :OLD.last_name, SYSDATE
    );
END trg_emp_delete;
/
```

### 复合触发器（Compound Trigger）

Oracle 11g 引入，可以在同一个触发器中处理所有时机：

```sql
CREATE OR REPLACE TRIGGER trg_emp_compound
FOR INSERT OR UPDATE OR DELETE ON employees
COMPOUND TRIGGER

    -- 声明部分（所有时机共享）
    TYPE t_audit IS TABLE OF emp_audit%ROWTYPE INDEX BY PLS_INTEGER;
    v_audit_list t_audit;
    v_count NUMBER := 0;

BEFORE STATEMENT IS
BEGIN
    v_count := 0;
    DBMS_OUTPUT.PUT_LINE('Statement started');
END BEFORE STATEMENT;

BEFORE EACH ROW IS
BEGIN
    DBMS_OUTPUT.PUT_LINE('Row change about to happen');
END BEFORE EACH ROW;

AFTER EACH ROW IS
BEGIN
    v_count := v_count + 1;
    
    IF INSERTING THEN
        v_audit_list(v_count).action := 'INSERT';
        v_audit_list(v_count).emp_id := :NEW.employee_id;
    ELSIF UPDATING THEN
        v_audit_list(v_count).action := 'UPDATE';
        v_audit_list(v_count).emp_id := :OLD.employee_id;
    ELSIF DELETING THEN
        v_audit_list(v_count).action := 'DELETE';
        v_audit_list(v_count).emp_id := :OLD.employee_id;
    END IF;
END AFTER EACH ROW;

AFTER STATEMENT IS
BEGIN
    -- 批量插入日志
    FOR i IN 1..v_count LOOP
        NULL;  -- 实际批量插入逻辑
    END LOOP;
    DBMS_OUTPUT.PUT_LINE('Statement ended, ' || v_count || ' rows affected');
END AFTER STATEMENT;

END trg_emp_compound;
/
```

---

## INSTEAD OF 触发器

INSTEAD OF 触发器用于**不可更新的视图**，替代原始操作执行。

### 问题背景

有些视图包含复杂的 JOIN，无法直接 UPDATE：

```sql
-- 创建视图：员工与部门信息
CREATE OR REPLACE VIEW emp_dept_view AS
SELECT e.employee_id,
       e.first_name,
       e.salary,
       d.department_name,
       d.location_id
FROM employees e
JOIN departments d ON e.department_id = d.department_id;

-- 直接 UPDATE 视图会失败
UPDATE emp_dept_view SET salary = 5000 WHERE employee_id = 100;
-- ORA-01733: view not updatable
```

### 解决方案：INSTEAD OF 触发器

```sql
-- 为视图创建 INSTEAD OF 触发器
CREATE OR REPLACE TRIGGER trg_view_update
INSTEAD OF UPDATE ON emp_dept_view
FOR EACH ROW
BEGIN
    -- 实际更新 employees 表
    UPDATE employees
    SET salary = :NEW.salary,
        first_name = :NEW.first_name
    WHERE employee_id = :OLD.employee_id;
    
    DBMS_OUTPUT.PUT_LINE('View update: emp_id=' || :OLD.employee_id);
END trg_view_update;
/

-- 现在可以更新视图了
UPDATE emp_dept_view SET salary = 5000 WHERE employee_id = 100;
```

### INSTEAD OF INSERT

```sql
CREATE OR REPLACE TRIGGER trg_view_insert
INSTEAD OF INSERT ON emp_dept_view
FOR EACH ROW
DECLARE
    v_dept_id NUMBER;
BEGIN
    -- 查找或创建部门
    SELECT department_id INTO v_dept_id
    FROM departments
    WHERE department_name = :NEW.department_name;
    
    -- 插入员工
    INSERT INTO employees (
        employee_id, first_name, salary, department_id, hire_date
    ) VALUES (
        emp_seq.NEXTVAL, :NEW.first_name, :NEW.salary, v_dept_id, SYSDATE
    );
END trg_view_insert;
/
```

---

## 系统触发器

除了 DML 触发器，Oracle 还支持**DDL 触发器**和**数据库级触发器**。

### DDL 触发器

```sql
-- 禁止删除核心表
CREATE OR REPLACE TRIGGER trg_no_drop
BEFORE DROP ON SCHEMA
BEGIN
    IF ODI_DICTIONARY_OBJ_OWNER = USER AND
       ODI_DICTIONARY_OBJ_NAME IN ('EMPLOYEES', 'DEPARTMENTS') THEN
        RAISE_APPLICATION_ERROR(-20001, '禁止删除核心表: ' || ODI_DICTIONARY_OBJ_NAME);
    END IF;
END trg_no_drop;
/

-- 记录所有 DDL 操作
CREATE TABLE ddl_audit (
    audit_id NUMBER PRIMARY KEY,
    os_user VARCHAR2(100),
    current_user VARCHAR2(100),
    ddl_stmt VARCHAR2(100),
    obj_owner VARCHAR2(100),
    obj_name VARCHAR2(100),
    action_date DATE
);

CREATE OR REPLACE TRIGGER trg_ddl_audit
AFTER DDL ON SCHEMA
BEGIN
    INSERT INTO ddl_audit (
        audit_id, os_user, current_user, ddl_stmt,
        obj_owner, obj_name, action_date
    ) VALUES (
        audit_seq.NEXTVAL,
        ODI_DICTIONARY_OBJ_OWNER,
        SYS.LOGIN_USER,
        ODI_DICTIONARY_OBJ_TYPE,
        ODI_DICTIONARY_OBJ_OWNER,
        ODI_DICTIONARY_OBJ_NAME,
        SYSDATE
    );
END trg_ddl_audit;
/
```

### LOGON/LOGOFF 触发器

```sql
-- 记录用户登录
CREATE TABLE logon_audit (
    user_name VARCHAR2(50),
    logon_time DATE,
    terminal VARCHAR2(100)
);

CREATE OR REPLACE TRIGGER trg_logon_audit
AFTER LOGON ON DATABASE
BEGIN
    INSERT INTO logon_audit (user_name, logon_time, terminal)
    VALUES (USER, SYSDATE, SYS_CONTEXT('USERENV', 'TERMINAL'));
END trg_logon_audit;
/

-- 限制用户连接数
CREATE OR REPLACE TRIGGER trg_limit_session
AFTER LOGON ON DATABASE
DECLARE
    v_count NUMBER;
BEGIN
    IF USER = 'APP_USER' THEN
        SELECT COUNT(*) INTO v_count
        FROM v$session
        WHERE username = 'APP_USER';
        
        IF v_count > 5 THEN
            RAISE_APPLICATION_ERROR(-20002, '连接数超限，请稍后再试');
        END IF;
    END IF;
END trg_limit_session;
/
```

---

## 触发器管理

```sql
-- 查看触发器列表
SELECT trigger_name, table_name, trigger_type, triggering_event
FROM user_triggers;

-- 查看触发器源代码
SELECT trigger_body
FROM user_triggers
WHERE trigger_name = 'TRG_EMP_INSERT';

-- 禁用/启用触发器
ALTER TRIGGER trg_emp_insert DISABLE;
ALTER TRIGGER trg_emp_insert ENABLE;

-- 禁用表的所有触发器
ALTER TABLE employees DISABLE ALL TRIGGERS;
ALTER TABLE employees ENABLE ALL TRIGGERS;

-- 重新编译触发器
ALTER TRIGGER trg_emp_insert COMPILE;

-- 删除触发器
DROP TRIGGER trg_emp_insert;
```

---

## 面试高频问题

### Q1: :NEW 和 :OLD 有什么区别？

| 操作 | :OLD | :NEW |
|-----|------|------|
| INSERT | NULL | 插入的值 |
| UPDATE | 更新前的值 | 更新后的值 |
| DELETE | 删除前的值 | NULL |

### Q2: 语句级触发器和行级触发器的区别？

| 对比项 | 语句级 | 行级 |
|-------|--------|------|
| 关键字 | 无 | `FOR EACH ROW` |
| 触发次数 | 每个语句触发一次 | 每行受影响触发一次 |
| :NEW/:OLD | 不可用 | 可用 |
| 性能 | 更好 | 稍差 |
| WHEN 子句 | 不支持 | 支持 |

### Q3: 触发器可以调用存储过程吗？

**可以**。触发器可以调用存储过程和函数，但不能调用匿名块。

### Q4: 触发器有什么限制？

1. 触发器体内不能包含事务控制语句（COMMIT/ROLLBACK）
2. 触发器不能调用返回 LONG 或 LONG RAW 类型的函数
3. 不能在触发器中调用自治事务过程（除非使用 PRAGMA AUTONOMOUS_TRANSACTION）
4. 行级触发器中不能修改触发表的主键

---

## 最佳实践

### 1. 避免触发器递归

```sql
-- 不好：触发器修改触发表，导致递归
CREATE TRIGGER trg_update
AFTER UPDATE ON table1
FOR EACH ROW
BEGIN
    UPDATE table1 SET col = col + 1 WHERE id = :NEW.id;  -- 递归！
END;

-- 好：使用 WHEN 条件避免
CREATE TRIGGER trg_update
AFTER UPDATE OF other_col ON table1
FOR EACH ROW
WHEN (OLD.other_col != NEW.other_col)
BEGIN
    -- 只处理 other_col 的变化
    NULL;
END;
```

### 2. 记录异常而非抛出

```sql
CREATE OR REPLACE TRIGGER trg_salary_check
BEFORE INSERT OR UPDATE OF salary ON employees
FOR EACH ROW
DECLARE
    PRAGMA AUTONOMOUS_TRANSACTION;
BEGIN
    IF :NEW.salary < 0 THEN
        -- 记录到错误表而不是抛出异常
        INSERT INTO salary_errors (emp_id, salary, error_msg, error_time)
        VALUES (:NEW.employee_id, :NEW.salary, '工资不能为负', SYSDATE);
        COMMIT;
        :NEW.salary := 0;  -- 修正值
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        NULL;  -- 静默处理，避免阻塞操作
END;
```

### 3. 使用复合触发器减少开销

```sql
-- 不好：每行都执行 INSERT
CREATE TRIGGER trg_audit
AFTER INSERT ON orders
FOR EACH ROW
BEGIN
    INSERT INTO order_audit (...) VALUES (...);  -- N 次 INSERT
END;

-- 好：使用复合触发器批量处理
-- 参考前面的复合触发器示例
```

---

## 总结

| 触发器类型 | 关键字 | 用途 |
|-----------|--------|------|
| BEFORE 触发器 | BEFORE | 数据验证、修改输入 |
| AFTER 触发器 | AFTER | 记录日志、派生数据 |
| INSTEAD OF 触发器 | INSTEAD OF | 使视图可更新 |
| 语句级触发器 | 无 FOR EACH ROW | 性能好 |
| 行级触发器 | FOR EACH ROW | 需要访问 :NEW/:OLD |
| 复合触发器 | COMPOUND TRIGGER | 批量处理，性能优 |

触发器是强大的功能，但也要慎用——过度使用会导致性能问题和维护困难。

---

## 下一步

- [PL/SQL 游标](/database/oracle/cursor)：显式游标与隐式游标
- [PL/SQL 集合类型](/database/oracle/collection)：VARRAY、NESTED TABLE、关联数组
