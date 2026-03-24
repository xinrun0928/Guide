# PL/SQL 游标：显式游标与隐式游标

SELECT 返回多行数据怎么办？

在 Java 里，你会用 ResultSet。
在 PL/SQL 里，你会用**游标（CURSOR）**。

游标是 PL/SQL 中处理多行数据的核心机制。今天，我们来彻底搞懂它。

---

## 什么是游标？

游标是一个**临时的工作区域**，用于存储 SQL 语句的执行结果。

```
┌─────────────────────────────────────────────────────────────┐
│                      Oracle 游标                            │
│                                                             │
│  ┌──────────────┐      ┌──────────────┐                    │
│  │   SQL 语句    │ ───► │   游标       │ ───► 处理每行     │
│  │   (SELECT)   │      │  (结果集)    │                    │
│  └──────────────┘      └──────────────┘                    │
│                                    │                        │
│                      ┌─────────────┼─────────────┐         │
│                      ▼             ▼             ▼          │
│                  [Row 1]       [Row 2]      [Row N]         │
└─────────────────────────────────────────────────────────────┘
```

### 游标的两个类型

| 类型 | 说明 | 使用场景 |
|-----|------|---------|
| 隐式游标 | PL/SQL 自动创建，自动管理 | 单行 SELECT、DML 操作 |
| 显式游标 | 程序员手动声明、打开、关闭 | 多行查询 |

---

## 隐式游标

### 什么是隐式游标？

隐式游标是 PL/SQL 为**单行 SELECT、DML 操作**自动创建的游标。

### SQL% 属性

```sql
-- %FOUND：最近执行的语句是否影响了行
-- %NOTFOUND：最近执行的语句是否没有影响行
-- %ROWCOUNT：最近执行的语句影响的行数
-- %ISOPEN：游标是否打开（隐式游标总是 FALSE）

-- UPDATE
BEGIN
    UPDATE employees SET salary = salary * 1.1 WHERE department_id = 50;
    
    IF SQL%FOUND THEN
        DBMS_OUTPUT.PUT_LINE('更新了 ' || SQL%ROWCOUNT || ' 行');
    ELSE
        DBMS_OUTPUT.PUT_LINE('没有符合条件的行');
    END IF;
END;
/
```

### %ROWCOUNT 示例

```sql
BEGIN
    -- INSERT
    INSERT INTO employees (...) VALUES (...);
    DBMS_OUTPUT.PUT_LINE('插入 ' || SQL%ROWCOUNT || ' 行');
    
    -- DELETE
    DELETE FROM employees WHERE salary < 3000;
    DBMS_OUTPUT.PUT_LINE('删除了 ' || SQL%ROWCOUNT || ' 行');
    
    -- UPDATE
    UPDATE employees SET commission_pct = 0.1 WHERE commission_pct IS NULL;
    DBMS_OUTPUT.PUT_LINE('更新了 ' || SQL%ROWCOUNT || ' 行');
END;
/
```

### %ISOPEN 属性

```sql
BEGIN
    -- 隐式游标的 %ISOPEN 永远是 FALSE
    SELECT salary INTO v_salary FROM employees WHERE employee_id = 100;
    
    IF SQL%ISOPEN THEN
        DBMS_OUTPUT.PUT_LINE('游标打开');  -- 永远不会执行
    ELSE
        DBMS_OUTPUT.PUT_LINE('游标已关闭');  -- 总是执行
    END IF;
END;
/
```

---

## 显式游标

### 什么是显式游标？

显式游标是程序员**手动声明和控制**的游标，用于处理多行查询结果。

### 显式游标的生命周期

```
┌─────────────────────────────────────────────────────────────┐
│                    显式游标生命周期                          │
│                                                             │
│  1. DECLARE   ───► 声明游标，定义查询                      │
│       │                                                    │
│       ▼                                                    │
│  2. OPEN      ───► 打开游标，执行查询，结果存入游标        │
│       │                                                    │
│       ▼                                                    │
│  3. FETCH     ───► 取出一行数据，移动指针                  │
│       │                                                    │
│       │  ┌───────┐                                        │
│       │  │ 有数据 │ ───► 处理数据                          │
│       └──┤       │                                        │
│          └───────┘                                        │
│              │                                            │
│              ▼ No                                         │
│          ◄──────────────────── 回到 FETCH                  │
│                                                             │
│  4. CLOSE     ───► 关闭游标，释放资源                    │
└─────────────────────────────────────────────────────────────┘
```

### 基本语法

```sql
DECLARE
    -- 1. 声明游标
    CURSOR emp_cursor IS
        SELECT employee_id, first_name, salary
        FROM employees
        WHERE department_id = 50
        ORDER BY salary DESC;
    
    -- 声明变量存储游标数据
    v_emp_id employees.employee_id%TYPE;
    v_emp_name employees.first_name%TYPE;
    v_emp_salary employees.salary%TYPE;
BEGIN
    -- 2. 打开游标
    OPEN emp_cursor;
    
    -- 3. 循环读取
    LOOP
        FETCH emp_cursor INTO v_emp_id, v_emp_name, v_emp_salary;
        
        -- 退出条件：没有数据了
        EXIT WHEN emp_cursor%NOTFOUND;
        
        -- 处理数据
        DBMS_OUTPUT.PUT_LINE(v_emp_id || ': ' || v_emp_name || ' - ' || v_emp_salary);
    END LOOP;
    
    -- 4. 关闭游标
    CLOSE emp_cursor;
END;
/
```

### 使用 %ROWTYPE 简化

```sql
DECLARE
    -- 用 %ROWTYPE 存储游标数据
    CURSOR emp_cursor IS
        SELECT * FROM employees WHERE department_id = 50;
    
    v_emp emp_cursor%ROWTYPE;
BEGIN
    OPEN emp_cursor;
    
    LOOP
        FETCH emp_cursor INTO v_emp;
        EXIT WHEN emp_cursor%NOTFOUND;
        
        DBMS_OUTPUT.PUT_LINE(v_emp.employee_id || ': ' || v_emp.first_name);
    END LOOP;
    
    CLOSE emp_cursor;
END;
/
```

### 带参数的游标

```sql
DECLARE
    -- 定义带参数的游标
    CURSOR emp_cursor(p_dept_id NUMBER, p_min_salary NUMBER) IS
        SELECT employee_id, first_name, salary
        FROM employees
        WHERE department_id = p_dept_id
          AND salary >= p_min_salary
        ORDER BY salary DESC;
    
    v_emp emp_cursor%ROWTYPE;
BEGIN
    -- 打开游标时传递参数
    OPEN emp_cursor(50, 5000);
    
    LOOP
        FETCH emp_cursor INTO v_emp;
        EXIT WHEN emp_cursor%NOTFOUND;
        
        DBMS_OUTPUT.PUT_LINE(v_emp.employee_id || ': ' || v_emp.salary);
    END LOOP;
    
    CLOSE emp_cursor;
END;
/
```

### FOR 循环游标（最简洁）

PL/SQL 提供了**简化的语法**，自动处理 OPEN、FETCH、CLOSE：

```sql
BEGIN
    -- FOR 循环自动打开游标、读取数据、关闭游标
    FOR emp_rec IN (SELECT * FROM employees WHERE department_id = 50)
    LOOP
        DBMS_OUTPUT.PUT_LINE(emp_rec.employee_id || ': ' || emp_rec.first_name);
    END LOOP;
    -- 自动关闭游标
END;
/
```

```sql
-- 带参数的 FOR 循环游标
DECLARE
    CURSOR emp_cursor(p_dept_id NUMBER) IS
        SELECT employee_id, first_name, salary
        FROM employees
        WHERE department_id = p_dept_id;
BEGIN
    FOR emp_rec IN emp_cursor(50)
    LOOP
        DBMS_OUTPUT.PUT_LINE(emp_rec.first_name || ': ' || emp_rec.salary);
    END LOOP;
END;
/
```

---

## 游标属性

### 隐式游标属性

| 属性 | 说明 |
|-----|------|
| SQL%FOUND | 最近 DML/SELECT 影响行 → TRUE |
| SQL%NOTFOUND | 最近 DML/SELECT 没影响行 → TRUE |
| SQL%ROWCOUNT | 最近 DML/SELECT 影响的行数 |
| SQL%ISOPEN | 游标是否打开（隐式游标总是 FALSE） |

### 显式游标属性

| 属性 | 说明 |
|-----|------|
| cursor_name%FOUND | 最后一次 FETCH 取到数据 → TRUE |
| cursor_name%NOTFOUND | 最后一次 FETCH 没取到数据 → TRUE |
| cursor_name%ROWCOUNT | 累计 FETCH 到的行数 |
| cursor_name%ISOPEN | 游标是否打开 |

```sql
DECLARE
    CURSOR emp_cursor IS SELECT * FROM employees WHERE department_id = 50;
    v_emp emp_cursor%ROWTYPE;
BEGIN
    OPEN emp_cursor;
    
    FETCH emp_cursor INTO v_emp;
    
    IF emp_cursor%FOUND THEN
        DBMS_OUTPUT.PUT_LINE('取到数据: ' || emp_cursor%ROWCOUNT || ' 行');
    END IF;
    
    CLOSE emp_cursor;
END;
/
```

---

## 游标与事务

### 游标在事务中的行为

```sql
BEGIN
    -- 打开游标
    FOR emp_rec IN (SELECT * FROM employees WHERE department_id = 50)
    LOOP
        -- 在循环中执行 DML
        UPDATE emp_salary_log
        SET last_raise = SYSDATE
        WHERE emp_id = emp_rec.employee_id;
        
        -- 每处理 100 行提交一次
        IF MOD(emp_cursor%ROWCOUNT, 100) = 0 THEN
            COMMIT;
        END IF;
    END LOOP;
    
    COMMIT;
END;
/
```

### WHERE CURRENT OF

使用 `WHERE CURRENT OF` 可以**直接更新/删除当前游标行**：

```sql
DECLARE
    CURSOR emp_cursor IS
        SELECT employee_id, salary FROM employees FOR UPDATE;
BEGIN
    FOR emp_rec IN emp_cursor
    LOOP
        -- 直接更新当前行
        UPDATE employees
        SET salary = salary * 1.1
        WHERE CURRENT OF emp_cursor;
    END LOOP;
    
    COMMIT;
END;
/
```

注意：`FOR UPDATE` 会在查询时锁定行，防止其他会话修改。

### 锁定与 FOR UPDATE

```sql
DECLARE
    -- FOR UPDATE 锁定查询的行
    CURSOR emp_cursor IS
        SELECT employee_id, salary
        FROM employees
        WHERE department_id = 50
        FOR UPDATE NOWAIT;  -- 不等待锁
BEGIN
    FOR emp_rec IN emp_cursor
    LOOP
        UPDATE employees
        SET salary = salary * 1.1
        WHERE CURRENT OF emp_cursor;
    END LOOP;
    
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        DBMS_OUTPUT.PUT_LINE('锁定失败: ' || SQLERRM);
END;
/
```

---

## 高级：REF 游标

REF 游标是**动态游标**，可以在运行时决定查询内容。

### 强类型 vs 弱类型 REF 游标

```sql
DECLARE
    -- 强类型 REF 游标：指定返回类型
    TYPE emp_ref_cursor IS REF CURSOR RETURN employees%ROWTYPE;
    v_emp_cursor emp_ref_cursor;
    
    -- 弱类型 REF 游标：不指定返回类型
    TYPE generic_cursor IS REF CURSOR;
    v_gen_cursor generic_cursor;
    
    v_emp employees%ROWTYPE;
    v_count NUMBER;
BEGIN
    -- 打开弱类型游标（动态 SQL）
    OPEN v_gen_cursor FOR 'SELECT COUNT(*) FROM employees';
    FETCH v_gen_cursor INTO v_count;
    CLOSE v_gen_cursor;
    
    DBMS_OUTPUT.PUT_LINE('员工总数: ' || v_count);
END;
/
```

### 动态 REF 游标的应用

```sql
CREATE OR REPLACE PROCEDURE execute_query(
    p_sql IN VARCHAR2,
    p_result OUT SYS_REFCURSOR
) IS
BEGIN
    -- 动态打开游标
    OPEN p_result FOR p_sql;
END execute_query;
/
```

---

## 性能注意事项

### 1. 避免在循环中频繁打开关闭

```sql
-- 不好：每次循环都查询
FOR i IN 1..1000 LOOP
    SELECT salary INTO v_sal FROM employees WHERE employee_id = i;
    -- 处理...
END LOOP;

-- 好：一次查询，用游标处理
SELECT employee_id, salary BULK COLLECT INTO v_emps FROM employees;
FOR i IN 1..v_emps.COUNT LOOP
    -- 处理...
END LOOP;
```

### 2. 使用 BULK COLLECT 提高性能

```sql
DECLARE
    TYPE t_emp_table IS TABLE OF employees%ROWTYPE INDEX BY PLS_INTEGER;
    v_emps t_emp_table;
BEGIN
    -- 批量收集，减少 SQL 引擎切换次数
    SELECT * BULK COLLECT INTO v_emps
    FROM employees
    WHERE department_id = 50;
    
    FOR i IN 1..v_emps.COUNT LOOP
        DBMS_OUTPUT.PUT_LINE(v_emps(i).first_name);
    END LOOP;
END;
/
```

### 3. LIMIT 子句控制批量大小

```sql
DECLARE
    CURSOR emp_cursor IS SELECT * FROM employees;
    TYPE t_emp_table IS TABLE OF employees%ROWTYPE;
    v_emps t_emp_table;
BEGIN
    OPEN emp_cursor;
    
    LOOP
        -- 每次获取 100 行
        FETCH emp_cursor BULK COLLECT INTO v_emps LIMIT 100;
        
        EXIT WHEN v_emps.COUNT = 0;
        
        -- 处理数据
        FORALL i IN 1..v_emps.COUNT
            INSERT INTO emp_backup VALUES v_emps(i);
        
        COMMIT;
    END LOOP;
    
    CLOSE emp_cursor;
END;
/
```

---

## 面试高频问题

### Q1: 隐式游标和显式游标的区别？

| 对比项 | 隐式游标 | 显式游标 |
|-------|---------|---------|
| 创建方式 | PL/SQL 自动创建 | 手动声明 |
| 适用范围 | 单行 SELECT、DML | 多行查询 |
| 属性访问 | SQL% 属性 | cursor% 属性 |
| OPEN/FETCH/CLOSE | 自动管理 | 手动管理 |

### Q2: FOR 循环游标有什么优势？

1. 自动处理 OPEN、FETCH、CLOSE
2. 代码简洁，不易出错
3. 自动处理 %NOTFOUND 退出循环

### Q3: WHERE CURRENT OF 有什么用？

在游标处理循环中，**直接引用当前行进行 UPDATE/DELETE**，比 WHERE 条件更简洁高效。

```sql
UPDATE employees SET salary = salary * 1.1
WHERE CURRENT OF emp_cursor;  -- 直接定位到当前行
```

### Q4: BULK COLLECT 是什么？

批量收集查询结果到集合中，**减少 PL/SQL 和 SQL 引擎之间的上下文切换**，大幅提升性能。

---

## 总结

游标是 PL/SQL 处理多行数据的核心机制：

| 类型 | 特点 | 使用场景 |
|-----|------|---------|
| 隐式游标 | 自动管理 | 单行操作、DML |
| 显式游标 | 手动控制 | 多行查询 |
| FOR 循环游标 | 自动管理 | 最常用 |
| REF 游标 | 动态 | 动态 SQL |

```sql
-- 标准显式游标
CURSOR c1 IS SELECT ...;
OPEN c1;
FETCH c1 INTO variables;
CLOSE c1;

-- FOR 循环游标（推荐）
FOR rec IN (SELECT ...) LOOP
    -- 处理
END LOOP;

-- BULK COLLECT
SELECT * BULK COLLECT INTO collection FROM ...;
```

---

## 下一步

- [PL/SQL 集合类型](/database/oracle/collection)：VARRAY、NESTED TABLE、关联数组
- [PL/SQL 异常处理](/database/oracle/exception)：预定义异常、用户自定义异常
