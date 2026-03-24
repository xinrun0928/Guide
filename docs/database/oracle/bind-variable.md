# Oracle 绑定变量：性能与灵活的平衡术

你有没有遇到这种情况：

每秒钟几千条 SQL，但 SQL 文本只有几十种。

Oracle 每个 SQL 都要解析一遍，CPU 飙升。

一条 SQL 卡住，CPU 打满，数据库濒临崩溃。

绑定变量，就是来解决这个问题的。

---

## 什么是绑定变量？

绑定变量是将 SQL 中的常量替换为占位符，让 Oracle 共享执行计划：

```sql
-- 硬编码：每次都是新的 SQL
SELECT * FROM employees WHERE department_id = 50;
SELECT * FROM employees WHERE department_id = 60;
SELECT * FROM employees WHERE department_id = 70;
-- 三条不同的 SQL，三次硬解析

-- 绑定变量：一条 SQL 多次执行
SELECT * FROM employees WHERE department_id = :dept_id;
-- 一条 SQL，多次绑定变量值，一次硬解析 + 多次软解析
```

---

## 硬解析 vs 软解析

### 解析过程

```
SQL 执行流程：
    SQL 文本
        ↓
    语法检查
        ↓
    语义检查
        ↓
    权限检查
        ↓
    生成执行计划（硬解析）
        ↓
    执行计划缓存
        ↓
    执行 SQL
```

### 硬解析（Hard Parse）

- 每条 SQL 都要执行完整的解析过程
- 消耗 CPU、内存资源
- 竞争闩锁（Latch）
- **尽量避免**

### 软解析（Soft Parse）

- 复用已有的执行计划
- 只做语法、权限检查
- 性能远优于硬解析
- **应该尽量复用**

---

## 绑定变量的使用

### SQL 中的绑定变量

```sql
-- 冒号 + 变量名
SELECT * FROM employees WHERE employee_id = :emp_id;
SELECT * FROM employees WHERE name = :name;
SELECT * FROM employees WHERE hire_date > :start_date;
```

### Java 中使用绑定变量

```java
// 使用 PreparedStatement
String sql = "SELECT * FROM employees WHERE department_id = ?";
try (PreparedStatement ps = conn.prepareStatement(sql)) {
    ps.setInt(1, 50);  // 绑定变量值
    ResultSet rs = ps.executeQuery();
}

// 正确：使用绑定变量
String sql = "SELECT * FROM employees WHERE department_id = ?";

// 错误：拼接 SQL
String sql = "SELECT * FROM employees WHERE department_id = " + deptId;
```

### PL/SQL 中使用绑定变量

```sql
-- 存储过程中使用绑定变量
CREATE OR REPLACE PROCEDURE proc_get_employees(
    p_dept_id IN NUMBER,
    p_cursor OUT SYS_REFCURSOR
)
AS
BEGIN
    OPEN p_cursor FOR
        'SELECT * FROM employees WHERE department_id = :1'
        USING p_dept_id;
END;
/

-- 动态 SQL 中使用绑定变量
BEGIN
    FOR dept_id IN 1..10 LOOP
        EXECUTE IMMEDIATE 
            'SELECT COUNT(*) FROM employees WHERE department_id = :1'
            INTO v_count
            USING dept_id;
        
        DBMS_OUTPUT.PUT_LINE('部门 ' || dept_id || ' 员工数: ' || v_count);
    END LOOP;
END;
/
```

---

## 绑定变量的类型

### 标量绑定变量

```sql
-- 数值绑定变量
SELECT * FROM employees WHERE salary > :salary;

-- 字符串绑定变量
SELECT * FROM employees WHERE name = :name;

-- 日期绑定变量
SELECT * FROM employees WHERE hire_date > :start_date;
```

### 数组绑定变量

```sql
-- PL/SQL 中的数组绑定
DECLARE
    TYPE t_id_list IS TABLE OF NUMBER;
    v_ids t_id_list := t_id_list(1, 2, 3, 4, 5);
BEGIN
    -- FORALL 使用数组
    FORALL i IN 1..v_ids.COUNT
        UPDATE employees
        SET salary = salary * 1.1
        WHERE employee_id = v_ids(i);
END;
/
```

### Cursor 变量

```sql
-- 使用 REF CURSOR
CREATE OR REPLACE FUNCTION func_get_employees(p_dept_id NUMBER)
RETURN SYS_REFCURSOR
AS
    v_cursor SYS_REFCURSOR;
BEGIN
    OPEN v_cursor FOR
        'SELECT * FROM employees WHERE department_id = :1'
        USING p_dept_id;
    RETURN v_cursor;
END;
/
```

---

## 绑定变量的优势

### 1. 减少硬解析

```java
// 没有绑定变量
for (long deptId : deptIds) {
    String sql = "SELECT * FROM employees WHERE department_id = " + deptId;
    stmt.execute(sql);  // 每次都硬解析
}

// 使用绑定变量
String sql = "SELECT * FROM employees WHERE department_id = ?";
for (long deptId : deptIds) {
    PreparedStatement ps = conn.prepareStatement(sql);
    ps.setLong(1, deptId);  // 复用执行计划
    ps.execute();
}
```

### 2. 减少 SQL 注入风险

```java
// 危险：SQL 注入
String sql = "SELECT * FROM users WHERE name = '" + name + "'";
// 如果 name = "'; DROP TABLE users;--" 后果严重

// 安全：绑定变量
String sql = "SELECT * FROM users WHERE name = ?";
ps.setString(1, name);  // 自动转义
```

### 3. 减少 Shared Pool 占用

```sql
-- 硬编码：10万条 SQL 占用 10万 个缓存位置
SELECT * FROM employees WHERE department_id = 1;
SELECT * FROM employees WHERE department_id = 2;
... (10万次)

-- 绑定变量：1个缓存位置
SELECT * FROM employees WHERE department_id = :dept_id;
-- 10万次执行，只占用 1 个位置
```

---

## 绑定变量的代价

### 绑定变量窥视（Bind Peeking）

Oracle 第一次执行时使用绑定变量值「窥视」数据分布：

```sql
-- 第一次执行：窥视 department_id = 50
SELECT * FROM employees WHERE department_id = :dept_id;
-- 优化器看到 50 只有 10 行 → 选择索引

-- 第二次执行：department_id = 1
SELECT * FROM employees WHERE department_id = :dept_id;
-- 但数据分布完全不同 → 可能选错执行计划
```

### 自适应执行计划

Oracle 12c+ 可以自适应执行计划：

```sql
-- 查看自适应特性
SELECT parameter_name, parameter_value
FROM v$sql_feature_info
WHERE parameter_name LIKE '%adaptive%';
```

### 统计信息的影响

```sql
-- 绑定变量与统计信息
-- 第一次执行时：
-- 1. 窥视绑定变量值
-- 2. 查看相关统计信息
-- 3. 选择执行计划
-- 4. 如果统计信息不准，可能选错计划
```

---

## 最佳实践

### 何时使用绑定变量

| 场景 | 推荐 | 原因 |
|-----|------|------|
| OLTP 系统 | 必须使用 | 高并发，重复 SQL |
| 报表查询 | 可不用 | 一次执行，不需要共享 |
| 数据仓库 | 可不用 | 复杂查询，统计信息更重要 |
| 批量操作 | FORALL | 减少上下文切换 |

### 何时避免绑定变量

```sql
-- 数据分布严重不均
-- department_id = 50：只有 5 行
-- department_id = 60：却有 100 万行
-- 使用绑定变量可能选错执行计划

-- 解决方案：
-- 1. 使用提示强制执行计划
SELECT /*+ INDEX(employees idx_dept) */ 
    * FROM employees WHERE department_id = :dept_id;

-- 2. 使用绑定变量分组
SELECT * FROM employees WHERE department_id = :dept_id AND :dept_id IN (50, 60);

-- 3. 收集更精确的统计信息
BEGIN
    DBMS_STATS.GATHER_TABLE_STATS(
        USER, 'EMPLOYEES',
        method_opt => 'FOR COLUMNS SIZE 100 department_id'
    );
END;
/
```

### Java 中的正确用法

```java
public class EmployeeDao {
    
    // 正确：使用 PreparedStatement
    public List&lt;Employee&gt; findByDepartmentId(long deptId) {
        String sql = "SELECT * FROM employees WHERE department_id = ?";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, deptId);
            List&lt;Employee&gt; result = new ArrayList&lt;&gt;();
            ResultSet rs = ps.executeQuery();
            while (rs.next()) {
                result.add(mapRow(rs));
            }
            return result;
        }
    }
    
    // 错误：拼接 SQL
    public List&lt;Employee&gt; findByDepartmentIdBad(long deptId) {
        String sql = "SELECT * FROM employees WHERE department_id = " + deptId;
        // 不要这样做！
    }
    
    // 批量操作：使用 FORALL
    public void batchUpdateSalary(List&lt;Long&gt; empIds, int percent) {
        String sql = "UPDATE employees SET salary = salary * (1 + ?/100) WHERE employee_id = ?";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            conn.setAutoCommit(false);
            for (Long empId : empIds) {
                ps.setInt(1, percent);
                ps.setLong(2, empId);
                ps.addBatch();
            }
            ps.executeBatch();
            conn.commit();
        }
    }
}
```

---

## 监控绑定变量

### 查看 SQL 执行统计

```sql
-- 查看 SQL 解析统计
SELECT sql_id, sql_text, 
       executions, 
       parse_calls,
       round(elapsed_time/executions/1000000, 3) AS avg_sec
FROM v$sqlarea
WHERE executions > 0
ORDER BY elapsed_time/executions DESC
FETCH FIRST 20 ROWS ONLY;
```

### 查看绑定变量值

```sql
-- 查看历史绑定变量值
SELECT 
    sql_id,
    name,
    value_string,
    last_captured
FROM v$sql_bind_capture
WHERE sql_id = '&lt;sql_id&gt;';

-- 查看当前会话的绑定变量
SELECT * FROM v$session WHERE sid = SYS_CONTEXT('USERENV', 'SID');
```

---

## 面试高频问题

### Q1: 什么是硬解析和软解析？

硬解析是首次执行 SQL，需要完整解析过程（语法检查、语义检查、权限检查、生成执行计划）；软解析是复用已有的执行计划，只需做语法和权限检查。硬解析消耗资源多，应尽量减少。

### Q2: 绑定变量的优点和缺点？

优点：减少硬解析、降低 CPU 消耗、减少 Shared Pool 竞争、防止 SQL 注入。缺点：可能导致执行计划不优（绑定变量窥视问题）、不适合数据分布不均匀的场景。

### Q3: 什么时候不用绑定变量？

数据分布严重不均时、报表查询（一次执行不需共享）、需要根据常量值选择不同执行计划时。

---

## 总结

| 场景 | 建议 |
|-----|------|
| OLTP 高并发 | 必须使用绑定变量 |
| 数据分布均匀 | 推荐使用绑定变量 |
| 数据分布不均 | 谨慎使用，考虑提示 |
| 一次执行 | 可不使用 |

绑定变量是 OLTP 系统的性能利器，但要了解其代价。

---

## 下一步

- [Oracle SQL 优化](/database/oracle/sql-tuning)：慢查询调优技巧
- [Oracle AWR/ASH](/database/oracle/awr-ash)：性能诊断工具
