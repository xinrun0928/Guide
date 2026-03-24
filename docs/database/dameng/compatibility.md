# DM 与 Oracle、MySQL 兼容性对比

你正在开发一个系统，数据库要从 Oracle 迁移到国产数据库。

最担心的是什么？

**代码改动多不多？存储过程还能用吗？现有 SQL 语法要改多少？**

这是所有迁移决策者最关心的问题。今天我们就来扒一扒达梦数据库的兼容性。

## 兼容性全景图

| 兼容性维度 | 与 Oracle | 与 MySQL |
|-----------|-----------|----------|
| SQL 语法 | ★★★★★ 高度兼容 | ★★★ 部分兼容 |
| PL/SQL 语法 | ★★★★★ 高度兼容 | 不支持 |
| 系统视图 | ★★★★☆ 核心兼容 | ★★ 较少兼容 |
| 数据类型 | ★★★★★ 完全兼容 | ★★★ 部分兼容 |
| 索引类型 | ★★★★☆ 核心兼容 | ★★★ 部分兼容 |
| 高可用方案 | ★★★★☆ 类似 | ★★ 完全不同 |

## SQL 语法兼容性

### 常见 DDL 语句

```sql
-- Oracle 风格
CREATE TABLE T_EMPLOYEE (
    ID NUMBER(18) PRIMARY KEY,
    NAME VARCHAR2(100) NOT NULL,
    SALARY NUMBER(15,2),
    HIRE_DATE DATE DEFAULT SYSDATE
);

-- 达梦完全兼容
CREATE TABLE T_EMPLOYEE (
    ID NUMBER(18) PRIMARY KEY,
    NAME VARCHAR2(100) NOT NULL,
    SALARY NUMBER(15,2),
    HIRE_DATE DATE DEFAULT SYSDATE
);

-- MySQL 需要调整：VARCHAR2 → VARCHAR
CREATE TABLE T_EMPLOYEE (
    ID BIGINT PRIMARY KEY,
    NAME VARCHAR(100) NOT NULL,
    SALARY DECIMAL(15,2),
    HIRE_DATE DATE DEFAULT CURRENT_TIMESTAMP
);
```

### 序列（Sequence）

达梦和 Oracle 的序列语法几乎一致：

```sql
-- 创建序列（Oracle 和达梦通用）
CREATE SEQUENCE SEQ_EMPLOYEE
    START WITH 1
    INCREMENT BY 1
    MINVALUE 1
    MAXVALUE 999999999999999999
    CACHE 20;

-- 使用序列
INSERT INTO T_EMPLOYEE (ID, NAME) VALUES (SEQ_EMPLOYEE.NEXTVAL, '张三');

-- 查询序列当前值
SELECT SEQ_EMPLOYEE.CURRVAL FROM DUAL;
```

### 同义词（Synonym）

```sql
-- 创建公共同义词
CREATE PUBLIC SYNONYM T_EMP FOR SYSDBA.T_EMPLOYEE;

-- 创建私有同义词
CREATE SYNONYM MY_EMP FOR T_EMPLOYEE;
```

## PL/SQL 兼容性

这是达梦最核心的优势——**存储过程、函数、包可以几乎不改代码直接迁移**。

### 存储过程

```sql
-- Oracle 存储过程
CREATE OR REPLACE PROCEDURE PROC_GET_EMPLOYEE(
    p_id IN NUMBER,
    p_name OUT VARCHAR2,
    p_salary OUT NUMBER
) AS
BEGIN
    SELECT NAME, SALARY INTO p_name, p_salary
    FROM T_EMPLOYEE
    WHERE ID = p_id;
END PROC_GET_EMPLOYEE;
/

-- 达梦完全兼容
CREATE OR REPLACE PROCEDURE PROC_GET_EMPLOYEE(
    p_id IN NUMBER,
    p_name OUT VARCHAR2,
    p_salary OUT NUMBER
) AS
BEGIN
    SELECT NAME, SALARY INTO p_name, p_salary
    FROM T_EMPLOYEE
    WHERE ID = p_id;
END;
```

### 函数

```sql
-- 创建函数（Oracle 和达梦通用）
CREATE OR REPLACE FUNCTION FUNC_GET_BONUS(
    p_salary NUMBER
) RETURN NUMBER AS
BEGIN
    RETURN p_salary * 0.15;
END;
/

-- Java 调用
CallableStatement cs = conn.prepareCall("{? = CALL FUNC_GET_BONUS(?)}");
cs.registerOutParameter(1, Types.DECIMAL);
cs.setBigDecimal(2, salary);
cs.execute();
```

### 包（Package）

```sql
-- 创建包规范
CREATE OR REPLACE PACKAGE PKG_EMPLOYEE AS
    PROCEDURE ADD_EMPLOYEE(p_name VARCHAR2, p_salary NUMBER);
    FUNCTION GET_TOTAL_SALARY RETURN NUMBER;
END PKG_EMPLOYEE;
/

-- 创建包体
CREATE OR REPLACE PACKAGE BODY PKG_EMPLOYEE AS
    PROCEDURE ADD_EMPLOYEE(p_name VARCHAR2, p_salary NUMBER) IS
    BEGIN
        INSERT INTO T_EMPLOYEE (ID, NAME, SALARY)
        VALUES (SEQ_EMPLOYEE.NEXTVAL, p_name, p_salary);
    END;
    
    FUNCTION GET_TOTAL_SALARY RETURN NUMBER IS
        v_total NUMBER;
    BEGIN
        SELECT SUM(SALARY) INTO v_total FROM T_EMPLOYEE;
        RETURN NVL(v_total, 0);
    END;
END PKG_EMPLOYEE;
/
```

### 触发器

```sql
-- 创建触发器（Oracle 和达梦通用）
CREATE OR REPLACE TRIGGER TRG_EMPLOYEE_SALARY
    BEFORE INSERT OR UPDATE OF SALARY ON T_EMPLOYEE
    FOR EACH ROW
BEGIN
    IF :NEW.SALARY < 3000 THEN
        RAISE_APPLICATION_ERROR(-20001, '工资不能低于 3000');
    END IF;
END;
/
```

## 数据类型对比

| Oracle | 达梦 DM | MySQL | 说明 |
|--------|---------|-------|------|
| NUMBER | NUMBER | DECIMAL | 数值类型 |
| VARCHAR2 | VARCHAR | VARCHAR | 变长字符串 |
| CHAR | CHAR | CHAR | 定长字符串 |
| DATE | DATETIME/DATE | DATETIME/DATE | 日期时间 |
| CLOB | CLOB/TEXT | TEXT | 大文本 |
| BLOB | BLOB | BLOB | 二进制大对象 |
| TIMESTAMP | TIMESTAMP | TIMESTAMP | 时间戳 |

```sql
-- 数据类型对比示例
CREATE TABLE T_TEST_TYPES (
    -- Oracle/NUMBER
    col_number    NUMBER(18,2),
    -- 达梦兼容 Oracle
    col_varchar2   VARCHAR2(100),
    col_date       DATE,
    col_timestamp  TIMESTAMP(6),
    col_clob       CLOB,
    col_blob       BLOB
);
```

## 系统视图对比

### 核心数据字典

| Oracle | 达梦 DM | MySQL | 用途 |
|--------|---------|-------|------|
| DBA_TABLES | DBA_TABLES | information_schema.TABLES | 表信息 |
| DBA_INDEXES | DBA_INDEXES | information_schema.STATISTICS | 索引信息 |
| DBA_TAB_COLUMNS | DBA_TAB_COLUMNS | information_schema.COLUMNS | 列信息 |
| V$SESSION | V$SESSION | PROCESSLIST | 会话信息 |
| V$SQL | V$SQL | 不可直接查看 | SQL 执行信息 |

```sql
-- 查看表结构（三个数据库通用语法）
-- Oracle 和达梦
SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE
FROM USER_TAB_COLUMNS
WHERE TABLE_NAME = 'T_EMPLOYEE'
ORDER BY COLUMN_ID;

-- MySQL
SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'test' AND TABLE_NAME = 't_employee'
ORDER BY ORDINAL_POSITION;
```

## 重要差异提醒

### 达梦与 Oracle 的差异点

1. **分页语法差异**

```sql
-- Oracle 12c 之前
SELECT * FROM T_EMPLOYEE WHERE ROWNUM <= 10;

-- Oracle 12c+
SELECT * FROM T_EMPLOYEE OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY;

-- 达梦支持两种方式
-- 方式1：ROWNUM
SELECT * FROM T_EMPLOYEE WHERE ROWNUM <= 10;

-- 方式2：LIMIT（MySQL 兼容）
SELECT * FROM T_EMPLOYEE LIMIT 10 OFFSET 0;
```

2. **递归 CTE 语法**

```sql
-- Oracle 和达梦都支持
WITH RECURSIVE CTE AS (
    SELECT 1 AS LVL, 'ROOT' AS NAME, 0 AS PARENT_ID
    UNION ALL
    SELECT LVL + 1, A.NAME, A.PARENT_ID
    FROM CTE, T_ORG A
    WHERE A.PARENT_ID = CTE.ID
)
SELECT * FROM CTE;
```

### 达梦与 MySQL 的差异点

1. **自增主键**

```sql
-- MySQL
CREATE TABLE T_USER (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    NAME VARCHAR(50)
);

-- 达梦（兼容 Oracle）
CREATE TABLE T_USER (
    ID NUMBER(18) IDENTITY(1,1) PRIMARY KEY,
    NAME VARCHAR(50)
);

-- 或者使用序列（更推荐）
CREATE TABLE T_USER (
    ID NUMBER(18) PRIMARY KEY,
    NAME VARCHAR(50)
);
```

2. **日期函数**

```sql
-- MySQL
SELECT NOW(), DATE_FORMAT(NOW(), '%Y-%m-%d');

-- 达梦（兼容 Oracle）
SELECT SYSDATE, TO_CHAR(SYSDATE, 'YYYY-MM-DD');
```

## 迁移建议

### 从 Oracle 迁移到达梦

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | 语法兼容性检查 | 使用达梦迁移工具扫描 |
| 2 | 数据类型转换 | VARCHAR2 → VARCHAR |
| 3 | 存储过程迁移 | 大部分无需修改 |
| 4 | 索引重建 | 语法兼容，检查索引类型 |
| 5 | 测试验证 | 功能测试 + 性能测试 |

### 从 MySQL 迁移到达梦

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | 自增主键转换 | 改用序列或 IDENTITY |
| 2 | SQL 方言改造 | LIMIT → ROWNUM 或分页语句 |
| 3 | 存储过程重构 | 需要改写为达梦 PL/SQL |
| 4 | 引擎差异注意 | InnoDB → 达梦堆表 |

## 面试追问方向

- 如果 Oracle 存储过程中使用了动态 SQL（EXECUTE IMMEDIATE），迁移到达梦要注意什么？
- 达梦的 PL/SQL 和 Oracle 的 PL/SQL 在性能调优方面有什么差异？
- 如何评估迁移的兼容性程度？

这些问题在实际迁移项目中经常会遇到，值得深入了解。
