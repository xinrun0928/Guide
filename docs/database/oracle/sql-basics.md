# Oracle SQL 基础：SELECT、DML、DDL

如果说 SQL 是操作数据库的"语言"，那 Oracle SQL 就是这门语言的"大师级教材"。

MySQL 有的，Oracle 都有；MySQL 没有的，Oracle 也有。

今天，我们从 Oracle SQL 最基础的部分开始讲起。

---

## SELECT：数据查询的基础

SELECT 是 SQL 中最常用的语句，用来从数据库中查询数据。Oracle 的 SELECT 语法非常丰富。

### 基础查询

```sql
-- 查询表中所有列
SELECT * FROM employees;

-- 查询指定列
SELECT employee_id, first_name, salary FROM employees;

-- 带条件查询
SELECT employee_id, first_name, salary
FROM employees
WHERE salary > 5000;

-- 去重查询
SELECT DISTINCT department_id FROM employees;
```

### 算术运算与别名

```sql
-- 算术运算
SELECT employee_id,
       salary,
       salary * 1.1 AS new_salary,  -- 加薪 10%
       salary + NVL(commission_pct, 0) * salary AS total_salary
FROM employees;

-- 使用别名（AS 可省略）
SELECT first_name AS "First Name",   -- 双引号保留空格
       last_name 姓,                  -- 中文别名不需要引号
       salary "月薪"
FROM employees;
```

### 连接运算符

```sql
-- 字符串连接（Oracle 使用 || 或 CONCAT）
SELECT first_name || ' ' || last_name AS full_name,
       CONCAT(first_name, last_name) AS concat_name
FROM employees;

-- 别名作为列前缀（双竖线结果列别名）
SELECT first_name || ' ' || last_name "Employee Name"
FROM employees;
```

---

## DML：数据操作语言

DML 用于对表中的数据进行增删改操作。

### INSERT：插入数据

```sql
-- 插入单行（指定列）
INSERT INTO employees (employee_id, first_name, last_name, email, hire_date, job_id)
VALUES (1001, 'John', 'Doe', 'JOHN.DOE', SYSDATE, 'IT_PROG');

-- 插入单行（所有列，按表结构顺序）
INSERT INTO departments (department_id, department_name, manager_id, location_id)
VALUES (280, 'Data Science', NULL, 1700);

-- 插入多行（使用子查询）
INSERT INTO emp_backup
SELECT * FROM employees WHERE department_id = 50;

-- 插入日期类型数据（使用 TO_DATE 转换）
INSERT INTO employees (employee_id, first_name, hire_date)
VALUES (1002, 'Jane', TO_DATE('2024-03-15', 'YYYY-MM-DD'));
```

### UPDATE：更新数据

```sql
-- 更新单列
UPDATE employees
SET salary = 8000
WHERE employee_id = 100;

-- 更新多列
UPDATE employees
SET salary = 8500,
    commission_pct = 0.15,
    hire_date = SYSDATE
WHERE department_id = 50;

-- 使用子查询更新
UPDATE employees
SET salary = (SELECT AVG(salary) FROM employees WHERE department_id = 50)
WHERE employee_id = 100;
```

### DELETE：删除数据

```sql
-- 删除满足条件的行
DELETE FROM employees
WHERE employee_id = 1001;

-- 使用子查询删除
DELETE FROM employees
WHERE department_id IN (
    SELECT department_id
    FROM departments
    WHERE department_name LIKE '%Temp%'
);
```

### MERGE：合并数据

MERGE 是 Oracle 的强大功能，可以同时执行 INSERT、UPDATE、DELETE。

```sql
-- 使用 MERGE 同步数据
MERGE INTO emp_backup b
USING (SELECT * FROM employees) s
ON (b.employee_id = s.employee_id)
WHEN MATCHED THEN
    UPDATE SET b.salary = s.salary,
               b.department_id = s.department_id
WHEN NOT MATCHED THEN
    INSERT (employee_id, first_name, last_name, salary, department_id)
    VALUES (s.employee_id, s.first_name, s.last_name, s.salary, s.department_id);
```

---

## DDL：数据定义语言

DDL 用于定义和管理数据库对象（表、视图、索引等）。

### CREATE：创建对象

```sql
-- 创建表
CREATE TABLE employees (
    employee_id    NUMBER(6) PRIMARY KEY,
    first_name     VARCHAR2(20),
    last_name      VARCHAR2(25) NOT NULL,
    email          VARCHAR2(25) UNIQUE,
    phone_number   VARCHAR2(20),
    hire_date      DATE DEFAULT SYSDATE,
    job_id         VARCHAR2(10),
    salary         NUMBER(8,2) CHECK (salary > 0),
    commission_pct NUMBER(2,2),
    manager_id     NUMBER(6),
    department_id   NUMBER(4),
    CONSTRAINT emp_email_uk UNIQUE (email),
    CONSTRAINT emp_salary_min CHECK (salary > 0)
);

-- 创建视图
CREATE OR REPLACE VIEW emp_dept_view AS
SELECT e.employee_id,
       e.first_name || ' ' || e.last_name AS full_name,
       d.department_name,
       d.location_id
FROM employees e
JOIN departments d ON e.department_id = d.department_id
WITH READ ONLY;

-- 创建序列
CREATE SEQUENCE emp_seq
    START WITH 1000
    INCREMENT BY 1
    MAXVALUE 999999
    NOCYCLE
    NOCACHE;
```

### ALTER：修改对象

```sql
-- 添加列
ALTER TABLE employees ADD (manager_name VARCHAR2(30));

-- 修改列
ALTER TABLE employees MODIFY (salary NUMBER(10,2));

-- 删除列
ALTER TABLE employees DROP COLUMN manager_name;

-- 重命名列
ALTER TABLE employees RENAME COLUMN phone_number TO contact_phone;

-- 添加约束
ALTER TABLE employees ADD CONSTRAINT emp_manager_fk
    FOREIGN KEY (manager_id) REFERENCES employees(employee_id);

-- 禁用/启用约束
ALTER TABLE employees DISABLE CONSTRAINT emp_manager_fk;
ALTER TABLE employees ENABLE CONSTRAINT emp_manager_fk;
```

### DROP 与 TRUNCATE：删除对象

```sql
-- 删除表（结构和数据都删除）
DROP TABLE employees;

-- 删除表但保留回收站（闪回删除）
DROP TABLE employees PURGE;  -- 彻底删除，不进回收站

-- 清空表数据（保留结构，删除所有行，重置 HWM）
TRUNCATE TABLE employees;

-- 清空表但保留extent分配
TRUNCATE TABLE employees DROP STORAGE;
```

---

## Oracle SQL 的特殊语法

### 层次查询（Hierarchical Query）

Oracle 特有，用于处理树形结构（如组织架构）。

```sql
-- 层次查询示例：显示员工汇报关系
SELECT employee_id, first_name, last_name, manager_id, LEVEL
FROM employees
START WITH manager_id IS NULL  -- 从 CEO 开始
CONNECT BY PRIOR employee_id = manager_id  -- 父 = 子的经理
ORDER SIBLINGS BY last_name;  -- 同级别内排序

-- LEVEL 伪列：表示层级
-- 1 = 根节点，2 = 第二层，以此类推

-- WHERE 子句过滤特定行（只过滤当前行，不影响子节点）
SELECT employee_id, first_name, LEVEL
FROM employees
WHERE salary > 5000
START WITH manager_id IS NULL
CONNECT BY PRIOR employee_id = manager_id;

-- SYS_CONNECT_BY_PATH：获取路径
SELECT employee_id, first_name,
       SYS_CONNECT_BY_PATH(first_name, '/') AS path
FROM employees
START WITH manager_id IS NULL
CONNECT BY PRIOR employee_id = manager_id;
```

### WITH 子句（公用表表达式）

```sql
-- 使用 WITH 简化复杂查询
WITH
    dept_salaries AS (
        SELECT department_id,
               SUM(salary) AS total_sal,
               AVG(salary) AS avg_sal
        FROM employees
        GROUP BY department_id
    ),
    high_salary_depts AS (
        SELECT department_id
        FROM dept_salaries
        WHERE total_sal > 100000
    )
SELECT e.employee_id,
       e.first_name,
       e.salary,
       d.department_name
FROM employees e
JOIN departments d ON e.department_id = d.department_id
WHERE e.department_id IN (SELECT department_id FROM high_salary_depts);
```

---

## Oracle vs MySQL：SQL 语法差异

| 特性 | Oracle | MySQL |
|-----|--------|-------|
| 字符串引号 | 单引号 `'` | 单引号 `'` 或双引号 `"` |
| 空值函数 | `NVL(expr1, expr2)` | `IFNULL(expr1, expr2)` 或 `COALESCE()` |
| 日期字面量 | `DATE '2024-03-15'` 或 `TO_DATE()` | `'2024-03-15'` |
| 分页语法 | `ROWNUM` 或 `ROW_NUMBER()` | `LIMIT offset, count` |
| 自增主键 | 需要序列 + 触发器 | `AUTO_INCREMENT` |
| 伪列 | `ROWNUM`, `ROWID` | 无 |
| 限制返回行 | `WHERE ROWNUM <= n` | `LIMIT n` |

---

## 常用数据字典

```sql
-- 查看当前用户的表
SELECT table_name FROM user_tables;

-- 查看表结构
DESC employees;
-- 或
SELECT column_name, data_type, data_length, nullable, data_default
FROM user_tab_columns
WHERE table_name = 'EMPLOYEES';

-- 查看索引
SELECT index_name, column_name, uniqueness
FROM user_indexes i, user_ind_columns c
WHERE i.index_name = c.index_name
  AND i.table_name = 'EMPLOYEES';

-- 查看约束
SELECT constraint_name, constraint_type, search_condition
FROM user_constraints
WHERE table_name = 'EMPLOYEES';
```

---

## 面试高频问题

### Q1: DELETE 和 TRUNCATE 的区别？

| 对比项 | DELETE | TRUNCATE |
|-------|--------|---------|
| 类型 | DML（可回滚） | DDL（不可回滚） |
| 速度 | 慢（逐行删除） | 快（释放extent） |
| 触发器 | 会触发 | 不触发 |
| HWM | 不改变 | 重置 |
| 空间释放 | 不会立即释放 | 立即释放 |

### Q2: DROP、DELETE、TRUNCATE 的区别？

- **DROP**：删除表结构（DDL），不可回滚
- **DELETE**：删除数据（DML），可回滚，记录日志
- **TRUNCATE**：清空数据（DDL），不可回滚，不记录日志

### Q3: Oracle 中如何实现自增主键？

Oracle 没有自增主键功能，需要借助序列（SEQUENCE）：

```sql
-- 创建序列
CREATE SEQUENCE emp_seq START WITH 1 INCREMENT BY 1;

-- 插入时使用序列
INSERT INTO employees (id, name) VALUES (emp_seq.NEXTVAL, 'John');

-- 获取刚插入的值
SELECT emp_seq.CURRVAL FROM DUAL;
```

---

## 总结

Oracle SQL 基础部分，我们学习了：

- **SELECT**：查询、算术运算、字符串连接、别名
- **DML**：INSERT、UPDATE、DELETE、MERGE
- **DDL**：CREATE、ALTER、DROP、TRUNCATE
- **特色语法**：层次查询、WITH 子句

SQL 是数据库操作的基础，建议多加练习。下一节，我们来学习 Oracle 的常用函数。

---

## 下一步

- [Oracle 常用函数](/database/oracle/functions)：字符、数值、日期、转换函数
- [Oracle 分页查询](/database/oracle/pagination)：ROWNUM 与 ROW_NUMBER
