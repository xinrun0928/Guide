# PL/SQL 集合类型：VARRAY、NESTED TABLE、关联数组

在 Java 里，你会用 List、Map。
在 PL/SQL 里，类似的结构叫做**集合（Collection）**。

当你要处理一组数据时，集合是你最好的帮手。今天，我们来深入学习 Oracle PL/SQL 的集合类型。

---

## Oracle 集合的三种类型

Oracle PL/SQL 提供了三种集合类型：

| 类型 | 说明 | 索引类型 | 存储位置 |
|-----|------|---------|---------|
| VARRAY | 可变数组，大小固定 | 整数（1 到 n） | 数据库表 |
| NESTED TABLE | 嵌套表，大小可变 | 整数（1 到 n） | 数据库表 |
| Associative Array（关联数组） | 键值对 | 字符串或整数 | PGA 内存 |

---

## VARRAY：可变数组

### 基本概念

VARRAY（Variable-Size Array）是**大小固定**的集合，索引从 1 开始。

### 定义和使用

```sql
DECLARE
    -- 定义 VARRAY 类型
    TYPE t_emp_ids IS VARRAY(10) OF NUMBER(6);
    -- 定义 VARRAY 变量
    v_emp_ids t_emp_ids;
BEGIN
    -- 初始化（分配内存）
    v_emp_ids := t_emp_ids(100, 101, 102, 103, 104);
    
    -- 访问元素
    DBMS_OUTPUT.PUT_LINE('第1个员工ID: ' || v_emp_ids(1));
    DBMS_OUTPUT.PUT_LINE('第2个员工ID: ' || v_emp_ids(2));
    
    -- 修改元素
    v_emp_ids(1) := 999;
    
    -- 遍历
    FOR i IN 1..v_emp_ids.COUNT LOOP
        DBMS_OUTPUT.PUT_LINE('员工 ' || i || ': ' || v_emp_ids(i));
    END LOOP;
END;
/
```

### 越界访问

```sql
DECLARE
    TYPE t_numbers IS VARRAY(5) OF NUMBER;
    v_nums t_numbers := t_numbers(1, 2, 3);
BEGIN
    -- 访问超出范围会报错
    BEGIN
        DBMS_OUTPUT.PUT_LINE(v_nums(10));  -- ORA-06533: 下标超出数量
    EXCEPTION
        WHEN SUBSCRIPT_BEYOND_COUNT THEN
            DBMS_OUTPUT.PUT_LINE('下标超出范围');
    END;
END;
/
```

### 方法

```sql
DECLARE
    TYPE t_nums IS VARRAY(10) OF NUMBER;
    v_nums t_nums := t_nums(1, 2, 3, 4, 5);
BEGIN
    DBMS_OUTPUT.PUT_LINE('元素个数: ' || v_nums.COUNT);       -- 5
    DBMS_OUTPUT.PUT_LINE('最大容量: ' || v_nums.LIMIT);        -- 10
    DBMS_OUTPUT.PUT_LINE('第一个元素: ' || v_nums.FIRST);      -- 1
    DBMS_OUTPUT.PUT_LINE('最后一个: ' || v_nums.LAST);         -- 5
    DBMS_OUTPUT.PUT_LINE('是否存在: ' || v_nums.EXISTS(3));    -- TRUE
    
    v_nums.EXTEND;  -- 添加一个空元素
    v_nums(6) := 6;
    
    v_nums.TRIM;    -- 移除最后一个元素
    v_nums.DELETE;  -- 删除所有元素
    
    -- 扩展多个
    v_nums.EXTEND(3);
END;
/
```

---

## NESTED TABLE：嵌套表

### 基本概念

NESTED TABLE 是**大小可变**的集合，没有固定容量限制。

### 定义和使用

```sql
DECLARE
    -- 定义嵌套表类型
    TYPE t_emp_names IS TABLE OF VARCHAR2(100);
    -- 定义变量
    v_names t_emp_names := t_emp_names();
BEGIN
    -- 添加元素
    v_names.EXTEND;
    v_names(1) := '张三';
    
    v_names.EXTEND;
    v_names(2) := '李四';
    
    -- 初始化时添加（构造函数）
    v_names := t_emp_names('王五', '赵六', '孙七');
    
    -- 遍历
    FOR i IN 1..v_names.COUNT LOOP
        DBMS_OUTPUT.PUT_LINE(v_names(i));
    END LOOP;
END;
/
```

### 多级嵌套表

```sql
DECLARE
    -- 内层：部门名称列表
    TYPE t_dept_names IS TABLE OF VARCHAR2(50);
    -- 外层：按地区分组
    TYPE t_region_depts IS TABLE OF t_dept_names;
    
    v_region_depts t_region_depts := t_region_depts(
        t_dept_names('销售部', '市场部'),      -- 华北区
        t_dept_names('研发部', '测试部'),      -- 华南区
        t_dept_names('人事部', '财务部')       -- 华东区
    );
BEGIN
    -- 访问多级嵌套表
    DBMS_OUTPUT.PUT_LINE('华东区第1个部门: ' || v_region_depts(3)(1));
    DBMS_OUTPUT.PUT_LINE('华南区部门数: ' || v_region_depts(2).COUNT);
END;
/
```

### NESTED TABLE 与数据库表

NESTED TABLE 可以作为表的列类型存储：

```sql
-- 创建嵌套表类型
CREATE OR REPLACE TYPE t_phone_list IS TABLE OF VARCHAR2(20);
/

-- 创建使用嵌套表列的表
CREATE TABLE contacts (
    contact_id NUMBER PRIMARY KEY,
    name VARCHAR2(100),
    phone_numbers t_phone_list  -- 嵌套表列
) NESTED TABLE phone_numbers STORE AS phone_table;

-- 插入数据
INSERT INTO contacts VALUES (1, '张三', t_phone_list('13800000001', '13900000001'));
INSERT INTO contacts VALUES (2, '李四', t_phone_list('13800000002'));

-- 查询
SELECT name, t.* FROM contacts c, TABLE(c.phone_numbers) t WHERE name = '张三';
```

---

## 关联数组（Associative Array）

### 基本概念

关联数组使用**字符串或整数作为键**，类似于其他语言的 Map/HashMap。

### 整数索引的关联数组

```sql
DECLARE
    -- 定义关联数组（整数索引）
    TYPE t_salary_map IS TABLE OF NUMBER(10, 2)
        INDEX BY PLS_INTEGER;
    
    v_salaries t_salary_map;
BEGIN
    -- 添加元素（键可以是任意整数）
    v_salaries(100) := 5000;
    v_salaries(200) := 6000;
    v_salaries(300) := 7000;
    
    -- 访问
    DBMS_OUTPUT.PUT_LINE('员工100工资: ' || v_salaries(100));
    
    -- 遍历方法1：FIRST/NEXT
    DECLARE
        v_key PLS_INTEGER := v_salaries.FIRST;
    BEGIN
        WHILE v_key IS NOT NULL LOOP
            DBMS_OUTPUT.PUT_LINE('员工' || v_key || ': ' || v_salaries(v_key));
            v_key := v_salaries.NEXT(v_key);
        END LOOP;
    END;
    
    -- 遍历方法2：KEYS_ONLY
    DECLARE
        v_key PLS_INTEGER;
    BEGIN
        v_key := v_salaries.FIRST;
        WHILE v_key IS NOT NULL LOOP
            DBMS_OUTPUT.PUT_LINE('员工' || v_key || ': ' || v_salaries(v_key));
            v_key := v_salaries.NEXT(v_key);
        END LOOP;
    END;
END;
/
```

### 字符串索引的关联数组

```sql
DECLARE
    -- 定义字符串索引的关联数组
    TYPE t_emp_info IS TABLE OF VARCHAR2(100)
        INDEX BY VARCHAR2(50);
    
    v_emp_info t_emp_info;
BEGIN
    -- 使用字符串作为键
    v_emp_info('CEO') := 'John Smith';
    v_emp_info('CTO') := 'Jane Doe';
    v_emp_info('CFO') := 'Bob Johnson';
    
    -- 访问
    DBMS_OUTPUT.PUT_LINE('CEO是: ' || v_emp_info('CEO'));
    
    -- 检查键是否存在
    IF v_emp_info.EXISTS('CEO') THEN
        DBMS_OUTPUT.PUT_LINE('CEO存在');
    END IF;
    
    -- 删除元素
    v_emp_info.DELETE('CFO');
END;
/
```

### 关联数组 vs VARRAY/NESTED TABLE

| 对比项 | 关联数组 | VARRAY/NESTED TABLE |
|-------|---------|---------------------|
| 索引类型 | 字符串或整数 | 只能是整数 |
| 存储位置 | PGA（内存） | 可以持久化到数据库 |
| 大小限制 | 无 | VARRAY 有上限 |
| 用途 | PL/SQL 内部使用 | 可作为表列类型 |

---

## 集合方法一览

| 方法 | 说明 |
|-----|------|
| EXISTS(n) | 检查索引 n 的元素是否存在 |
| COUNT | 返回元素个数 |
| LIMIT | 返回 VARRAY 的最大容量（NESTED TABLE/关联数组返回 NULL） |
| FIRST | 返回第一个索引 |
| LAST | 返回最后一个索引 |
| PRIOR(n) | 返回索引 n 之前的索引 |
| NEXT(n) | 返回索引 n 之后的索引 |
| EXTEND | 添加一个空元素 |
| EXTEND(n) | 添加 n 个空元素 |
| TRIM | 移除最后一个元素 |
| TRIM(n) | 移除最后 n 个元素 |
| DELETE | 删除所有元素 |
| DELETE(n) | 删除索引 n 的元素 |
| DELETE(m,n) | 删除索引 m 到 n 之间的所有元素 |

---

## 批量操作：BULK COLLECT 与 FORALL

### BULK COLLECT：批量查询

```sql
DECLARE
    TYPE t_emp_names IS TABLE OF VARCHAR2(100);
    v_names t_emp_names;
    
    TYPE t_emp_record IS RECORD (
        emp_id NUMBER,
        emp_name VARCHAR2(100),
        emp_salary NUMBER(10, 2)
    );
    TYPE t_emp_list IS TABLE OF t_emp_record;
    v_emps t_emp_list;
BEGIN
    -- 批量查询到嵌套表
    SELECT employee_id, first_name, salary
    BULK COLLECT INTO v_emps
    FROM employees
    WHERE department_id = 50
    LIMIT 100;
    
    -- 只查询特定列
    SELECT first_name BULK COLLECT INTO v_names
    FROM employees;
    
    FOR i IN 1..v_emps.COUNT LOOP
        DBMS_OUTPUT.PUT_LINE(v_emps(i).emp_name);
    END LOOP;
END;
/
```

### FORALL：批量 DML

```sql
DECLARE
    TYPE t_emp_ids IS TABLE OF NUMBER;
    v_ids t_emp_ids := t_emp_ids(100, 101, 102, 103, 104);
    
    TYPE t_salaries IS TABLE OF NUMBER;
    v_salaries t_salaries := t_salaries(5000, 6000, 7000, 8000, 9000);
BEGIN
    -- 批量更新（一次 SQL 执行）
    FORALL i IN 1..v_ids.COUNT
        UPDATE employees
        SET salary = v_salaries(i)
        WHERE employee_id = v_ids(i);
    
    DBMS_OUTPUT.PUT_LINE('更新了 ' || SQL%ROWCOUNT || ' 行');
    COMMIT;
END;
/
```

### FORALL + SAVE EXCEPTIONS

```sql
DECLARE
    TYPE t_ids IS TABLE OF NUMBER;
    v_ids t_ids := t_ids(100, 200, 300);
    
    e_dml_errors EXCEPTION;
    PRAGMA EXCEPTION_INIT(e_dml_errors, -24381);
    
    v_error_count NUMBER;
BEGIN
    FORALL i IN 1..v_ids.COUNT SAVE EXCEPTIONS
        UPDATE employees SET salary = -1 WHERE employee_id = v_ids(i);
    
EXCEPTION
    WHEN e_dml_errors THEN
        v_error_count := SQL%BULK_EXCEPTIONS.COUNT;
        DBMS_OUTPUT.PUT_LINE('错误数: ' || v_error_count);
        
        FOR i IN 1..v_error_count LOOP
            DBMS_OUTPUT.PUT_LINE(
                '第 ' || SQL%BULK_EXCEPTIONS(i).ERROR_INDEX || 
                ' 行出错: ' || SQL%BULK_EXCEPTIONS(i).ERROR_CODE || ' - ' ||
                SQLERRM(-SQL%BULK_EXCEPTIONS(i).ERROR_CODE));
        END LOOP;
END;
/
```

---

## 集合与 SQL

### 在 SQL 中使用 PL/SQL 集合

```sql
-- 创建表和嵌套表类型
CREATE OR REPLACE TYPE t_num_list IS TABLE OF NUMBER;
/

CREATE TABLE orders (
    order_id NUMBER,
    item_ids t_num_list  -- 嵌套表列
) NESTED TABLE item_ids STORE AS item_tab;

-- 插入数据
INSERT INTO orders VALUES (1, t_num_list(101, 102, 103));
INSERT INTO orders VALUES (2, t_num_list(201, 202));

-- 查询嵌套表
SELECT order_id, COLUMN_VALUE
FROM orders, TABLE(orders.item_ids);

-- UNNEST：展开嵌套表
SELECT o.order_id, i.COLUMN_VALUE AS item_id
FROM orders o, TABLE(o.item_ids) i;
```

### 批量绑定性能对比

```sql
-- 方式1：逐行处理（性能差）
BEGIN
    FOR rec IN (SELECT * FROM employees WHERE department_id = 50) LOOP
        UPDATE emp_log SET last_update = SYSDATE WHERE emp_id = rec.employee_id;
    END LOOP;
    COMMIT;
END;

-- 方式2：批量处理（性能优）
DECLARE
    TYPE t_ids IS TABLE OF NUMBER;
    v_ids t_ids;
BEGIN
    SELECT employee_id BULK COLLECT INTO v_ids
    FROM employees WHERE department_id = 50;
    
    FORALL i IN 1..v_ids.COUNT
        UPDATE emp_log SET last_update = SYSDATE WHERE emp_id = v_ids(i);
    
    COMMIT;
END;
/
```

---

## 面试高频问题

### Q1: VARRAY 和 NESTED TABLE 的区别？

| 对比项 | VARRAY | NESTED TABLE |
|-------|--------|--------------|
| 大小 | 固定上限 | 可变，无固定上限 |
| 存储 | 始终作为单列存储 | 可以作为表列持久化 |
| 稀疏性 | 不能有稀疏（1,2,3...） | 可以有稀疏 |
| 索引类型 | 只能是整数 | 只能是整数 |

### Q2: 关联数组和嵌套表的区别？

- **关联数组**：只在 PGA 内存中，不能持久化到数据库，适合 PL/SQL 内部使用
- **嵌套表**：可以持久化到数据库列中，但存储为单列，不适合稀疏数据

### Q3: BULK COLLECT 的限制？

1. 不能在大表上使用（内存溢出风险）
2. LIMIT 子句控制批量大小
3. 目标集合必须是 PL/SQL 表类型

### Q4: FORALL 相比普通循环的优势？

批量执行 SQL，**减少 PL/SQL 与 SQL 引擎之间的上下文切换**，性能提升可达 10-100 倍。

---

## 总结

Oracle PL/SQL 集合类型对比：

| 类型 | 索引 | 持久化 | 用途 |
|-----|------|-------|------|
| VARRAY | 整数 | 可持久化 | 固定大小集合 |
| NESTED TABLE | 整数 | 可持久化 | 可变大集合 |
| 关联数组 | 字符串/整数 | 内存 | PL/SQL 内部映射 |

```sql
-- VARRAY
TYPE t_arr IS VARRAY(10) OF NUMBER;

-- NESTED TABLE
TYPE t_nt IS TABLE OF NUMBER;

-- 关联数组
TYPE t_aa IS TABLE OF NUMBER INDEX BY VARCHAR2(50);
```

集合是 PL/SQL 编程的重要工具，BULK COLLECT 和 FORALL 可以显著提升批量操作的性能。

---

## 下一步

- [PL/SQL 异常处理](/database/oracle/exception)：预定义异常、用户自定义异常
- [Oracle 序列与同义词](/database/oracle/sequence-synonym)：序列、同义词的使用
