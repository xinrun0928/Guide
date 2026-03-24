# Oracle 常用函数：字符、数值、日期、转换函数

SQL 语句的灵魂是什么？

不是 SELECT，不是 JOIN，是**函数**。

一个好的 SQL 程序员，知道什么时候该用什么函数——这是区分"会用"和"用得好"的关键。

今天，我们来系统学习 Oracle 的常用函数。

---

## 字符函数

字符函数是使用频率最高的函数类型，用来处理字符串。

### 大小写转换

```sql
-- 转大写
SELECT UPPER('hello world') FROM DUAL;  -- HELLO WORLD

-- 转小写
SELECT LOWER('HELLO WORLD') FROM DUAL;  -- hello world

-- 首字母大写
SELECT INITCAP('hello world') FROM DUAL;  -- Hello World

-- 应用示例：忽略大小写的查询
SELECT *
FROM employees
WHERE UPPER(last_name) = 'KING';
```

### 字符串操作

```sql
-- LENGTH：返回字符串长度
SELECT LENGTH('Hello World') FROM DUAL;  -- 11

-- SUBSTR：截取字符串（从1开始，不是0）
SELECT SUBSTR('Hello World', 1, 5) FROM DUAL;   -- Hello
SELECT SUBSTR('Hello World', 7) FROM DUAL;       -- World
SELECT SUBSTR('Hello World', -5) FROM DUAL;      -- World（从右边开始）

-- INSTR：查找子串位置（找不到返回0）
SELECT INSTR('Hello World', 'World') FROM DUAL;   -- 7
SELECT INSTR('Hello World Hello', 'Hello', 1, 2) FROM DUAL;  -- 13（从1开始，找第2次）

-- LPAD / RPAD：填充到指定长度
SELECT LPAD('Hello', 10, '*') FROM DUAL;  -- *****Hello
SELECT RPAD('Hello', 10, '*') FROM DUAL;  -- Hello*****

-- TRIM：去除首尾空格
SELECT TRIM('   Hello   ') FROM DUAL;  -- Hello

-- LTRIM / RTRIM：去除左/右空格
SELECT LTRIM('   Hello') FROM DUAL;  -- Hello
SELECT RTRIM('Hello   ') FROM DUAL;  -- Hello

-- TRIM 去除指定字符
SELECT TRIM(LEADING '*' FROM '***Hello***') FROM DUAL;  -- Hello***（去左边）
SELECT TRIM(TRAILING '*' FROM '***Hello***') FROM DUAL;  -- ***Hello（去右边）
SELECT TRIM(BOTH '*' FROM '***Hello***') FROM DUAL;      -- Hello（去两边）

-- REPLACE：替换字符串
SELECT REPLACE('Hello World', 'World', 'Oracle') FROM DUAL;  -- Hello Oracle
SELECT REPLACE('Hello World', 'o', '0') FROM DUAL;  -- Hell0 W0rld

-- TRANSLATE：字符级替换（逐字符替换）
SELECT TRANSLATE('Hello World', 'elo', '310') FROM DUAL;  -- H3ll0 W0r1d
```

### 实战应用

```sql
-- 提取姓名首字母
SELECT SUBSTR(first_name, 1, 1) || '.' || last_name AS short_name
FROM employees;

-- 隐藏手机号中间4位
SELECT RPAD(SUBSTR(phone, 1, 3), LENGTH(phone)-4, '*') || 
       SUBSTR(phone, -4) AS hidden_phone
FROM employees;

-- 生成报表时补齐编号（如 1 -> 00001）
SELECT LPAD(employee_id, 5, '0') AS emp_no
FROM employees;
```

---

## 数值函数

### 基础数学运算

```sql
-- ROUND：四舍五入
SELECT ROUND(45.926, 2) FROM DUAL;  -- 45.93
SELECT ROUND(45.926, 0) FROM DUAL;  -- 46
SELECT ROUND(45.926, -1) FROM DUAL;  -- 50

-- TRUNC：截断（不四舍五入）
SELECT TRUNC(45.926, 2) FROM DUAL;  -- 45.92
SELECT TRUNC(45.926, 0) FROM DUAL;  -- 45
SELECT TRUNC(45.926, -1) FROM DUAL;  -- 40

-- MOD：取余
SELECT MOD(10, 3) FROM DUAL;  -- 1
SELECT MOD(-10, 3) FROM DUAL;  -- -1

-- ABS：绝对值
SELECT ABS(-10) FROM DUAL;  -- 10

-- POWER：幂运算
SELECT POWER(2, 3) FROM DUAL;  -- 8

-- SQRT：平方根
SELECT SQRT(16) FROM DUAL;  -- 4

-- SIGN：符号函数（正数返回1，负数返回-1，零返回0）
SELECT SIGN(-10) FROM DUAL;  -- -1
SELECT SIGN(10) FROM DUAL;   -- 1
SELECT SIGN(0) FROM DUAL;    -- 0
```

### 高级数值函数

```sql
-- CEIL：向上取整
SELECT CEIL(45.3) FROM DUAL;  -- 46
SELECT CEIL(-45.3) FROM DUAL;  -- -45

-- FLOOR：向下取整
SELECT FLOOR(45.9) FROM DUAL;  -- 45
SELECT FLOOR(-45.9) FROM DUAL;  -- -46

-- LOG：求对数
SELECT LOG(10, 100) FROM DUAL;  -- 2

-- LN / LOG：自然对数和常用对数
SELECT LN(2.718281828) FROM DUAL;  -- 1
SELECT LOG(10, 100) FROM DUAL;      -- 2

-- BITAND：按位与
SELECT BITAND(6, 3) FROM DUAL;  -- 2 (110 AND 011 = 010)
```

---

## 日期函数

Oracle 的日期处理非常强大，日期本质上是一个数字（距离某个基准日期的天数）。

### 日期基础运算

```sql
-- SYSDATE：当前日期时间
SELECT SYSDATE FROM DUAL;  -- 2024-03-24

-- 日期加减（日期 +/- 数字 = 加减天数）
SELECT SYSDATE + 7 FROM DUAL;   -- 7天后
SELECT SYSDATE - 30 FROM DUAL;  -- 30天前

-- 日期相减（返回天数）
SELECT SYSDATE - TO_DATE('2024-01-01', 'YYYY-MM-DD') FROM DUAL;  -- 天数差

-- MONTHS_BETWEEN：两个日期相差的月数
SELECT MONTHS_BETWEEN(SYSDATE, TO_DATE('2023-01-01', 'YYYY-MM-DD'))
FROM DUAL;

-- ADD_MONTHS：加月数
SELECT ADD_MONTHS(SYSDATE, 6) FROM DUAL;   -- 6个月后
SELECT ADD_MONTHS(SYSDATE, -3) FROM DUAL;  -- 3个月前
```

### 日期提取与计算

```sql
-- EXTRACT：提取日期分量
SELECT EXTRACT(YEAR FROM SYSDATE) FROM DUAL;  -- 2024
SELECT EXTRACT(MONTH FROM SYSDATE) FROM DUAL;  -- 3
SELECT EXTRACT(DAY FROM SYSDATE) FROM DUAL;    -- 24

-- TRUNC 应用于日期（截断到指定单位）
SELECT TRUNC(SYSDATE, 'YEAR') FROM DUAL;   -- 当年1月1日
SELECT TRUNC(SYSDATE, 'MONTH') FROM DUAL;  -- 当月1日
SELECT TRUNC(SYSDATE, 'DAY') FROM DUAL;    -- 本周周一
SELECT TRUNC(SYSDATE) FROM DUAL;           -- 今天零点

-- NEXT_DAY：下一个指定星期几
SELECT NEXT_DAY(SYSDATE, 'MONDAY') FROM DUAL;  -- 下周一
SELECT NEXT_DAY(SYSDATE, 1) FROM DUAL;         -- 1=周日，7=周六

-- LAST_DAY：当月最后一天
SELECT LAST_DAY(SYSDATE) FROM DUAL;

-- ROUND 应用于日期
SELECT ROUND(SYSDATE, 'YEAR') FROM DUAL;   -- 四舍五入到年
SELECT ROUND(SYSDATE, 'MONTH') FROM DUAL;  -- 四舍五入到月
```

### 实战案例

```sql
-- 计算员工入职年限
SELECT employee_id,
       first_name,
       TRUNC(MONTHS_BETWEEN(SYSDATE, hire_date) / 12) || '年' AS years_of_service
FROM employees;

-- 计算本月剩余工作日
SELECT LAST_DAY(SYSDATE) - SYSDATE AS days_left
FROM DUAL;

-- 统计每周入职人数
SELECT TRUNC(hire_date, 'DAY') AS week_start,
       COUNT(*) AS emp_count
FROM employees
GROUP BY TRUNC(hire_date, 'DAY')
ORDER BY week_start;

-- 季度报表分组
SELECT EXTRACT(YEAR FROM hire_date) AS year,
       CEIL(EXTRACT(MONTH FROM hire_date) / 3) AS quarter,
       COUNT(*) AS emp_count
FROM employees
GROUP BY EXTRACT(YEAR FROM hire_date),
         CEIL(EXTRACT(MONTH FROM hire_date) / 3)
ORDER BY year, quarter;
```

---

## 转换函数

Oracle 是强类型数据库，类型转换必须显式进行。

### TO_CHAR：转换为字符串

```sql
-- 日期转字符串
SELECT TO_CHAR(SYSDATE, 'YYYY-MM-DD') FROM DUAL;          -- 2024-03-24
SELECT TO_CHAR(SYSDATE, 'YYYY"年"MM"月"DD"日"') FROM DUAL;  -- 2024年03月24日
SELECT TO_CHAR(SYSDATE, 'DAY') FROM DUAL;                   -- 星期几（全名）
SELECT TO_CHAR(SYSDATE, 'DY') FROM DUAL;                    -- 星期几（缩写）

-- 时间格式化
SELECT TO_CHAR(SYSDATE, 'HH24:MI:SS') FROM DUAL;  -- 14:30:25
SELECT TO_CHAR(SYSDATE, 'YYYY-MM-DD HH24:MI:SS') FROM DUAL;

-- 数字转字符串
SELECT TO_CHAR(1234.56, '9,999.99') FROM DUAL;  -- 1,234.56
SELECT TO_CHAR(1234.56, '0000.00') FROM DUAL;  -- 1234.56
SELECT TO_CHAR(1234.56, 'L9,999.99') FROM DUAL; -- $1,234.56（本地货币）
SELECT TO_CHAR(0.5, '990.00') FROM DUAL;        -- .50
SELECT TO_CHAR(0.5, '0.00') FROM DUAL;          -- 0.50
```

### TO_NUMBER：转换为数字

```sql
-- 字符串转数字
SELECT TO_NUMBER('123.45') + 100 FROM DUAL;  -- 223.45

-- 带格式的转换
SELECT TO_NUMBER('$1,234.56', 'L9,999.99') FROM DUAL;
```

### TO_DATE：转换为日期

```sql
-- 字符串转日期
SELECT TO_DATE('2024-03-24', 'YYYY-MM-DD') FROM DUAL;
SELECT TO_DATE('2024/03/24 14:30:25', 'YYYY/MM/DD HH24:MI:SS') FROM DUAL;

-- 只有日期，没有时间（时间默认为00:00:00）
SELECT TO_DATE('2024-03-24', 'YYYY-MM-DD') FROM DUAL;
```

### TO_TIMESTAMP：转换为时间戳

```sql
-- 字符串转时间戳
SELECT TO_TIMESTAMP('2024-03-24 14:30:25.123456', 
                    'YYYY-MM-DD HH24:MI:SS.FF6') FROM DUAL;

-- 时间戳转字符串
SELECT TO_CHAR(SYSTIMESTAMP, 'YYYY-MM-DD HH24:MI:SS.FF6') FROM DUAL;
```

---

## 空值处理函数

空值处理是 Oracle SQL 中最容易出错的点。

### NVL / NVL2

```sql
-- NVL：如果第一个参数为 NULL，返回第二个参数
SELECT first_name,
       NVL(commission_pct, 0) AS commission  -- NULL -> 0
FROM employees;

-- NVL2：如果第一个参数为 NULL，返回第三个参数；否则返回第二个参数
SELECT first_name,
       NVL2(commission_pct, '有提成', '无提成') AS commission_status
FROM employees;
```

### COALESCE：返回第一个非 NULL 值

```sql
-- COALESCE：返回第一个非 NULL 值
SELECT first_name,
       COALESCE(commission_pct, manager_id, 0) AS priority_value
FROM employees;

-- 实际应用：组合多个联系方式
SELECT first_name,
       COALESCE(mobile_phone, office_phone, email, '无联系方式') AS contact
FROM employees;
```

### NULLIF：比较两个值

```sql
-- NULLIF：如果两个值相等，返回 NULL；否则返回第一个值
SELECT first_name,
       NULLIF(salary, 0) AS salary_if_nonzero  -- 工资为0的变成NULL
FROM employees;
```

---

## 条件表达式

### CASE 表达式

```sql
-- 简单 CASE
SELECT employee_id, salary,
       CASE department_id
           WHEN 10 THEN '行政部'
           WHEN 20 THEN '市场部'
           WHEN 30 THEN '销售部'
           ELSE '其他部门'
       END AS dept_name
FROM employees;

-- 搜索 CASE
SELECT employee_id, salary,
       CASE
           WHEN salary < 3000 THEN '低薪'
           WHEN salary BETWEEN 3000 AND 8000 THEN '中等'
           WHEN salary > 8000 THEN '高薪'
           ELSE '未定义'
       END AS salary_level
FROM employees;
```

### DECODE 函数

DECODE 是 Oracle 特有的函数，语法比 CASE 更简洁，但功能也更强。

```sql
-- DECODE：类似 CASE 的简写
SELECT employee_id,
       DECODE(department_id,
              10, '行政部',
              20, '市场部',
              30, '销售部',
              '其他部门') AS dept_name
FROM employees;

-- 使用 DECODE 进行排序（按部门名称排序，而不是部门ID）
SELECT first_name, department_id
FROM employees
ORDER BY DECODE(department_id,
                30, 1,  -- 销售排第一
                20, 2,  -- 市场排第二
                10, 3,  -- 行政排第三
                4);    -- 其他排第四
```

---

## 聚合函数与 LISTAGG

### LISTAGG：字符串聚合（Oracle 11g R2+）

```sql
-- 字符串聚合：将多行拼接成一行
SELECT department_id,
       LISTAGG(last_name, ',') WITHIN GROUP (ORDER BY last_name) AS employees
FROM employees
GROUP BY department_id;

-- 按部门聚合员工姓名（按工资排序）
SELECT d.department_name,
       LISTAGG(e.last_name || '(' || e.salary || ')', ', ')
               WITHIN GROUP (ORDER BY e.salary DESC) AS employee_list
FROM employees e
JOIN departments d ON e.department_id = d.department_id
GROUP BY d.department_name;
```

---

## 面试高频问题

### Q1: NVL 和 COALESCE 的区别？

- **NVL**：只能处理两个参数
- **COALESCE**：可以处理多个参数，返回第一个非 NULL 值

```sql
-- NVL
NVL(a, b)  -- 如果a为NULL，返回b

-- COALESCE
COALESCE(a, b, c, d)  -- 返回第一个非NULL值
```

### Q2: TRUNC 和 ROUND 在日期上的区别？

- **ROUND**：四舍五入到最近的日期单位
- **TRUNC**：截断，直接取起点

```sql
-- ROUND 对日期四舍五入
SELECT ROUND(SYSDATE, 'MONTH') FROM DUAL;  -- 如果是月中之后，返回下月1日

-- TRUNC 对日期截断
SELECT TRUNC(SYSDATE, 'MONTH') FROM DUAL;  -- 始终返回当月1日
```

### Q3: NUMBER 类型格式化中的 9 和 0 的区别？

```sql
SELECT TO_CHAR(0.5, '990.00') FROM DUAL;  -- ' .50'（不够的补0）
SELECT TO_CHAR(0.5, '0.00') FROM DUAL;   -- '0.50'（前导0）
SELECT TO_CHAR(12.34, '99.99') FROM DUAL; -- '12.34'
SELECT TO_CHAR(123.45, '99.99') FROM DUAL; -- '###'（不够显示）
```

---

## 总结

Oracle 函数分类：

| 类型 | 常用函数 |
|-----|---------|
| 字符函数 | UPPER、LOWER、SUBSTR、INSTR、LENGTH、TRIM、REPLACE |
| 数值函数 | ROUND、TRUNC、MOD、ABS、CEIL、FLOOR |
| 日期函数 | SYSDATE、ADD_MONTHS、MONTHS_BETWEEN、TRUNC、EXTRACT |
| 转换函数 | TO_CHAR、TO_NUMBER、TO_DATE、TO_TIMESTAMP |
| 空值函数 | NVL、NVL2、COALESCE、NULLIF |
| 条件函数 | CASE、DECODE |

函数是 SQL 编程的基础，熟练掌握这些函数能大大提高查询效率。

---

## 下一步

- [Oracle 分页查询](/database/oracle/pagination)：ROWNUM 与 ROW_NUMBER
- [Oracle PL/SQL 块结构](/database/oracle/plsql-block)：DECLARE、BEGIN、EXCEPTION、END
