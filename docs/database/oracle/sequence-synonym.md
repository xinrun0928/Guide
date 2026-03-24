# Oracle 序列与同义词

你知道吗？

Oracle 没有 MySQL 那样的 `AUTO_INCREMENT`。

那 Oracle 怎么实现自增主键？

答案是：**序列（SEQUENCE）**。

今天，我们来学习 Oracle 的序列和另一个实用工具：**同义词（SYNONYM）**。

---

## 序列（SEQUENCE）

### 什么是序列？

序列是 Oracle 提供的**独立数据库对象**，用于生成唯一的数值。通常用于生成主键值。

```
┌─────────────────────────────────────────────────────────────┐
│                      Oracle 序列                             │
│                                                             │
│  序列: emp_seq                                             │
│                                                             │
│  ┌─────────┐                                               │
│  │  START  │  ←── 当前值                                   │
│  │   WITH  │                                               │
│  │   1     │                                               │
│  └─────────┘                                               │
│       │                                                    │
│       ▼ NEXTVAL                                            │
│  ┌─────────┐                                               │
│  │   1     │  ───► 返回 1                                  │
│  └─────────┘                                               │
│       │                                                    │
│       ▼ NEXTVAL                                            │
│  ┌─────────┐                                               │
│  │   2     │  ───► 返回 2                                  │
│  └─────────┘                                               │
│       │                                                    │
│       ▼ NEXTVAL                                            │
│  ┌─────────┐                                               │
│  │   3     │  ───► 返回 3                                  │
│  └─────────┘                                               │
└─────────────────────────────────────────────────────────────┘
```

### 创建序列

```sql
-- 基本创建
CREATE SEQUENCE emp_seq
    START WITH 1           -- 起始值
    INCREMENT BY 1         -- 增量
    MAXVALUE 999999999      -- 最大值
    MINVALUE 1              -- 最小值
    NOCYCLE                 -- 达到最大值后不再循环
    CACHE 20                -- 预分配 20 个值（性能优化）
    NOCORDER;               -- 不保证有序

-- 简洁写法
CREATE SEQUENCE order_seq START WITH 1000 INCREMENT BY 1;
```

### 序列参数详解

| 参数 | 说明 | 默认值 |
|-----|------|-------|
| START WITH | 起始值 | - |
| INCREMENT BY | 增量（正数递增，负数递减） | 1 |
| MAXVALUE | 最大值 | 10^27 - 1 |
| NOMAXVALUE | 无最大值（递增序列） | - |
| MINVALUE | 最小值 | 1 |
| NOMINVALUE | 无最小值（递减序列） | - |
| CYCLE | 达到极限后循环 | NOCYCLE |
| CACHE | 预分配数量 | 20 |
| NOCACHE | 不缓存 | - |
| ORDER | 保证顺序（仅 RAC 有意义） | NOORDER |

### 使用序列

```sql
-- NEXTVAL：获取下一个值
INSERT INTO employees (employee_id, first_name, last_name)
VALUES (emp_seq.NEXTVAL, 'John', 'Doe');

-- CURRVAL：获取当前值（必须先调用 NEXTVAL）
SELECT emp_seq.CURRVAL FROM DUAL;

-- 在 Java 中使用
-- PreparedStatement ps = conn.prepareStatement("INSERT INTO employees ... VALUES (emp_seq.NEXTVAL, ?)");
```

### 序列的注意事项

```sql
-- 1. 序列是独立对象，不属于任何表
-- 2. 序列的值可能不连续（回滚、缓存）
-- 3. CURRVAL 只在当前会话有效
-- 4. 序列可以跨表使用

-- 查看序列
SELECT sequence_name, last_number, cache_size
FROM user_sequences;
```

---

## 序列与触发器：实现自增主键

Oracle 没有 `AUTO_INCREMENT`，但可以用序列 + 触发器模拟。

### 方式一：触发器

```sql
-- 1. 创建序列
CREATE SEQUENCE dept_seq START WITH 1 INCREMENT BY 1;

-- 2. 创建触发器
CREATE OR REPLACE TRIGGER trg_dept_insert
BEFORE INSERT ON departments
FOR EACH ROW
BEGIN
    IF :NEW.department_id IS NULL THEN
        :NEW.department_id := dept_seq.NEXTVAL;
    END IF;
END trg_dept_insert;
/

-- 3. 插入时不需要指定 ID
INSERT INTO departments (department_name, location_id)
VALUES ('Data Science', 1700);  -- ID 自动生成
```

### 方式二：应用层指定

```sql
-- 应用层获取序列值
DECLARE
    v_new_id NUMBER;
BEGIN
    v_new_id := emp_seq.NEXTVAL;
    
    INSERT INTO employees (employee_id, first_name, last_name)
    VALUES (v_new_id, 'John', 'Doe');
    
    DBMS_OUTPUT.PUT_LINE('新员工ID: ' || v_new_id);
END;
/
```

### 方式三：RETURNING INTO

```sql
-- 在 INSERT 时直接获取生成的值
DECLARE
    v_new_id NUMBER;
BEGIN
    INSERT INTO employees (employee_id, first_name, last_name)
    VALUES (emp_seq.NEXTVAL, 'John', 'Doe')
    RETURNING employee_id INTO v_new_id;
    
    DBMS_OUTPUT.PUT_LINE('新员工ID: ' || v_new_id);
END;
/
```

---

## 同义词（SYNONYM）

### 什么是同义词？

同义词是数据库对象的**别名**。可以让你用不同的名字访问同一个对象。

```
┌─────────────────────────────────────────────────────────────┐
│                      Oracle 同义词                           │
│                                                             │
│  同义词 emp_details_view                                     │
│       │                                                     │
│       │ "指向"                                               │
│       ▼                                                     │
│  ┌─────────────────┐                                         │
│  │ hr.employees_v  │  ───► 实际对象                          │
│  │ (远程表/视图)   │                                         │
│  └─────────────────┘                                         │
└─────────────────────────────────────────────────────────────┘
```

### 为什么需要同义词？

1. **简化长对象名**：不用每次都写 `schema.object`
2. **隐藏对象位置**：应用只关心同义词，不关心实际对象
3. **实现对象透明性**：修改对象名时，只需改同义词
4. **访问远程对象**：通过 DB Link 访问其他数据库的对象

### 创建同义词

```sql
-- 私有同义词（默认，只在当前用户可见）
CREATE SYNONYM emp FOR hr.employees;

-- 公有同义词（所有用户可见）
CREATE PUBLIC SYNONYM employees FOR hr.employees;

-- 使用同义词
SELECT * FROM emp;  -- 等价于 SELECT * FROM hr.employees
```

### 同义词使用场景

```sql
-- 场景1：简化跨 Schema 访问
-- HR 用户
CREATE SYNONYM depts FOR sys.departments;
GRANT SELECT ON depts TO app_user;

-- APP_USER
SELECT * FROM depts;  -- 不需要写成 hr.departments

-- 场景2：隐藏表位置
CREATE SYNONYM order_data FOR sales_archive.orders_2024;

-- 场景3：DB Link 访问远程表
CREATE DATABASE LINK remote_db CONNECT TO remote_user IDENTIFIED BY password
    USING 'remote_tnsname';

CREATE SYNONYM remote_orders FOR orders@remote_db;

SELECT * FROM remote_orders;  -- 访问远程数据库的 orders 表
```

### 管理同义词

```sql
-- 查看同义词
SELECT synonym_name, table_name, table_owner
FROM user_synonyms;

-- 查看公有同义词
SELECT * FROM DBA_SYNONYMS WHERE owner = 'PUBLIC';

-- 删除同义词
DROP SYNONYM emp;
DROP PUBLIC SYNONYM employees;

-- 重新编译（对象结构改变后）
ALTER SYNONYM emp COMPILE;
```

---

## 序列与同义词的结合

### 常见应用：创建 API 层

```sql
-- 1. HR 创建一个包，封装对 employees 表的访问
CREATE OR REPLACE PACKAGE emp_api AS
    FUNCTION get_next_id RETURN NUMBER;
    PROCEDURE insert_emp(p_first_name VARCHAR2, p_last_name VARCHAR2);
END emp_api;
/

CREATE OR REPLACE PACKAGE BODY emp_api AS
    FUNCTION get_next_id RETURN NUMBER IS
    BEGIN
        RETURN emp_seq.NEXTVAL;
    END;
    
    PROCEDURE insert_emp(p_first_name VARCHAR2, p_last_name VARCHAR2) IS
    BEGIN
        INSERT INTO employees (employee_id, first_name, last_name, hire_date)
        VALUES (emp_seq.NEXTVAL, p_first_name, p_last_name, SYSDATE);
    END;
END emp_api;
/

-- 2. 创建同义词，隐藏实现细节
CREATE PUBLIC SYNONYM emp_api FOR hr.emp_api;
GRANT EXECUTE ON emp_api TO PUBLIC;

-- 3. 其他用户使用
SELECT emp_api.get_next_id FROM DUAL;
BEGIN
    emp_api.insert_emp('John', 'Doe');
END;
/
```

---

## 管理脚本

### 序列管理

```sql
-- 修改序列（不能修改 START WITH，需重建）
ALTER SEQUENCE emp_seq INCREMENT BY 2 MAXVALUE 9999999999 CACHE 50;

-- 删除序列
DROP SEQUENCE emp_seq;

-- 查询序列信息
SELECT sequence_name, 
       min_value, 
       max_value, 
       increment_by, 
       last_number,
       cache_size
FROM user_sequences;

-- 获取当前序列值（必须先 NEXTVAL）
SELECT emp_seq.CURRVAL FROM DUAL;
```

### 同义词管理

```sql
-- 查看同义词的依赖对象
SELECT * FROM user_dependencies
WHERE name = 'EMP_SYNONYM';

-- 检查无效同义词
SELECT * FROM user_synonyms
WHERE status != 'VALID';

-- 重新编译
ALTER SYNONYM emp COMPILE;
```

---

## 面试高频问题

### Q1: Oracle 如何实现自增主键？

Oracle 没有 `AUTO_INCREMENT`，需要：
1. 创建序列
2. 创建触发器（可选但推荐）
3. 插入时使用 `seq.NEXTVAL`

### Q2: 序列的 CACHE 有什么用？

预分配一定数量的序列值到内存，提高获取 NEXTVAL 的性能。代价是数据库异常关闭时，可能丢失部分序列值。

### Q3: 序列值会回退吗？

不会。序列是递增的，不会因为回滚事务而减少。缓存的序列值在数据库重启后也可能跳过。

### Q4: 私有同义词和公有同义词的区别？

| 对比项 | 私有同义词 | 公有同义词 |
|-------|-----------|-----------|
| 所有者 | 创建用户 | PUBLIC |
| 可见范围 | 创建用户 | 所有用户 |
| 权限 | 隐式访问 | 需授权 |
| 命名冲突 | 无 | 可能冲突 |

### Q5: 同义词可以指向什么对象？

表、视图、物化视图、序列、存储过程、函数、包、同义词（链式引用）。

---

## 最佳实践

### 序列

```sql
-- 1. 使用有意义的命名
CREATE SEQUENCE seq_表名_PK;

-- 2. 设置合理的缓存
CREATE SEQUENCE emp_seq CACHE 20;  -- 高并发系统可增加

-- 3. 监控序列使用
SELECT sequence_name, last_number FROM user_sequences;

-- 4. 避免序列值不连续
-- CACHE 会导致序列值不连续，如果需要连续值，使用 NOCACHE
```

### 同义词

```sql
-- 1. 优先使用公有同义词给核心对象
CREATE PUBLIC SYNONYM employees FOR hr.employees;

-- 2. 私有同义词不要与对象同名
-- 好
CREATE SYNONYM emp_details FOR hr.emp_details_v;
-- 不好（与 employees 表名冲突）
CREATE SYNONYM employees FOR hr.employees_v;

-- 3. 同义词用于实现接口隔离
-- 业务层只依赖同义词，不直接依赖表
CREATE SYNONYM biz_employee FOR schema.employee_table_v;
```

---

## 总结

| 对象 | 用途 | 关键点 |
|-----|------|-------|
| 序列 | 生成唯一数值 | NEXTVAL/CURRVAL、CACHE、触发器配合 |
| 同义词 | 对象别名 | 私有/公有、简化访问、对象隔离 |

```sql
-- 序列示例
CREATE SEQUENCE emp_seq START WITH 1 INCREMENT BY 1 CACHE 20;
INSERT INTO emp (id, name) VALUES (emp_seq.NEXTVAL, 'John');

-- 同义词示例
CREATE SYNONYM emp FOR hr.employees;
SELECT * FROM emp;
```

序列和同义词虽然简单，但在 Oracle 开发中非常实用。

---

## 下一步

- [Oracle 表类型](/database/oracle/table-type)：堆表、索引组织表、聚簇表
- [Oracle 事务管理](/database/oracle/transaction)：COMMIT、ROLLBACK 的内部机制
