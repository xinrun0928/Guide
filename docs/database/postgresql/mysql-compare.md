# PostgreSQL 与 MySQL 核心差异对比

很多人把 PostgreSQL 和 MySQL 的选择比作「专业相机 vs 傻瓜相机」。

MySQL 是傻瓜相机——操作简单，一键出片，适合日常拍摄（Web 开发）。

PostgreSQL 是专业相机——参数可调，画质更高，适合专业创作（复杂业务）。

但这个比喻不够准确。PostgreSQL 不是「更难用的 MySQL」，而是「另一个维度的数据库」。

今天，我们来深入对比这两者的核心差异。

## 架构层面的差异

### 连接管理

**MySQL**：每个连接对应一个线程，由线程池管理。连接开销相对较小。

**PostgreSQL**：采用进程模型（PostgreSQL 9.2 之前）或线程模型（PostgreSQL 9.2+），每个连接对应一个独立的进程或线程。这种设计更稳定，但连接开销相对较高。

这就是为什么 PostgreSQL 建议使用连接池（如 PgBouncer），而 MySQL 直连也能承受一定压力。

```java
// Java 中使用连接池
HikariConfig config = new HikariConfig();
config.setJdbcUrl("jdbc:postgresql://localhost:5432/mydb");
config.setMaximumPoolSize(20);  // PostgreSQL 推荐使用连接池
config.setMinimumIdle(5);

// MySQL 直连也能work，但连接池仍是最佳实践
config.setJdbcUrl("jdbc:mysql://localhost:3306/mydb");
config.setMaximumPoolSize(50);
```

### 存储引擎

**MySQL**：支持多种存储引擎，InnoDB 是默认也是最常用的。

| 存储引擎 | 特点 |
|---------|------|
| InnoDB | 支持事务、行级锁、外键 |
| MyISAM | 不支持事务、表级锁 |
| MEMORY | 数据存内存，访问快 |
| Archive | 压缩存储，适合日志 |

**PostgreSQL**：只有一种存储引擎，但它非常强大。PostgreSQL 的存储引擎实现了 MVCC、ACID、MVCC 等全部特性。

```
PostgreSQL：一种引擎，全部特性
MySQL：多种引擎，各有取舍
```

### 事务隔离级别

这是两者最核心的差异之一：

| 隔离级别 | MySQL (InnoDB) | PostgreSQL |
|---------|---------------|------------|
| Read Uncommitted | 支持（但实际是 RC） | 不支持 |
| Read Committed | 支持 | 支持（默认） |
| Repeatable Read | 支持（默认） | 支持 |
| Serializable | 支持 | 支持 |

**关键差异**：

- MySQL InnoDB 默认是 **Repeatable Read**
- PostgreSQL 默认是 **Read Committed**

这个差异会导致「不可重复读」现象的频率不同。

```sql
-- MySQL 默认 RR 隔离级别下
BEGIN;
-- 事务 A
SELECT * FROM orders WHERE id = 1;  -- 读到的 version = 1

-- 事务 B 修改了同一行
UPDATE orders SET status = 'shipped' WHERE id = 1;

-- 事务 A 再读
SELECT * FROM orders WHERE id = 1;  -- 仍然是 version = 1

COMMIT;

-- PostgreSQL 默认 RC 隔离级别下
BEGIN;
-- 事务 A
SELECT * FROM orders WHERE id = 1;  -- 读到的 version = 1

-- 事务 B 修改了同一行
UPDATE orders SET status = 'shipped' WHERE id = 1;

-- 事务 A 再读
SELECT * FROM orders WHERE id = 1;  -- 读到 version = 2（不可重复读！）

COMMIT;
```

## MVCC 实现差异

### MySQL InnoDB 的 MVCC

MySQL 使用「回滚段」实现 MVCC：

- 每行数据有两个隐藏列：`DB_TRX_ID`（最近修改的事务 ID）和 `DB_ROLL_PTR`（指向回滚段中的旧版本）
- 修改数据时，将旧版本写入回滚段
- 读取时，根据事务 ID 和回滚指针构建一致性视图

### PostgreSQL 的 MVCC

PostgreSQL 的 MVCC 更「优雅」：

- 每行数据有 `xmin`（创建版本的事务 ID）和 `xmax`（删除/更新版本的事务 ID）
- 不需要回滚段，旧版本直接存储在表中
- 通过「可见性判断规则」决定哪些版本对当前事务可见

```
MySQL MVCC = 回滚段 + 隐藏列
PostgreSQL MVCC = xmin/xmax + 无回滚段
```

PostgreSQL 的设计避免了回滚段的空间浪费，但也带来了 VACUUM 的必要性。

## 索引机制差异

### 索引类型

| 索引类型 | MySQL | PostgreSQL |
|---------|-------|------------|
| B-Tree | 支持 | 支持（默认） |
| Hash | 支持 | 支持 |
| Full-text | 支持 | 支持（但有 GIN/GiST 更强） |
| R-Tree | 支持（空间索引） | 支持（GiST） |
| GIN | 不支持 | 支持（数组、JSON） |
| GiST | 不支持 | 支持（几何、全文） |
| BRIN | 不支持 | 支持（大表顺序扫描） |
| Composite Index | 支持 | 支持 |
| Partial Index | 有限支持 | 支持 |
| Expression Index | 支持 | 支持 |

### 主键与自增

**MySQL**：

```sql
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100)
);
-- MySQL 自动生成自增 ID
INSERT INTO users (name) VALUES ('Alice');  -- id = 1
```

**PostgreSQL**：

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,  -- 或者用 BIGSERIAL
    name VARCHAR(100)
);
-- PostgreSQL 使用 SERIAL 类型
INSERT INTO users (name) VALUES ('Alice');  -- id = 1

-- PostgreSQL 12+ 推荐的方式
CREATE TABLE users (
    id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100)
);
```

PostgreSQL 的 `GENERATED ALWAYS AS IDENTITY` 更符合 SQL 标准。

## SQL 标准遵循度

### Window Function

**MySQL 8.0+** 支持窗口函数：

```sql
SELECT 
    name,
    department,
    salary,
    RANK() OVER (PARTITION BY department ORDER BY salary DESC) as dept_rank
FROM employees;
```

**PostgreSQL**：早就支持，而且实现更完善。

### CTEs（WITH 子句）

```sql
WITH high_earners AS (
    SELECT * FROM employees WHERE salary > 100000
)
SELECT 
    e.name,
    d.department_name
FROM high_earners e
JOIN departments d ON e.dept_id = d.id;
```

两者都支持 CTEs，但 PostgreSQL 的递归 CTEs 更强大。

### Recursive Query

```sql
-- PostgreSQL 的递归查询
WITH RECURSIVE employee_hierarchy AS (
    -- 基础查询（根节点）
    SELECT id, name, manager_id, 1 as level
    FROM employees
    WHERE manager_id IS NULL
    
    UNION ALL
    
    -- 递归部分
    SELECT e.id, e.name, e.manager_id, eh.level + 1
    FROM employees e
    JOIN employee_hierarchy eh ON e.manager_id = eh.id
)
SELECT * FROM employee_hierarchy;
```

MySQL 8.0+ 也支持递归查询，但 PostgreSQL 在语法和优化上都更成熟。

## 数据类型差异

### JSON 支持

**MySQL 5.7+**：

```sql
CREATE TABLE app_data (
    id INT,
    data JSON
);

INSERT INTO app_data VALUES (1, '{"user": "Alice", "prefs": {"theme": "dark"}}');

-- 查询 JSON 字段
SELECT data->>'$.user' FROM app_data;  -- 返回 "Alice"
```

**PostgreSQL**：

```sql
CREATE TABLE app_data (
    id INT,
    data JSONB  -- JSONB 比 JSON 更好：二进制格式，支持索引
);

INSERT INTO app_data VALUES (1, '{"user": "Alice", "prefs": {"theme": "dark"}}');

-- 查询 JSON 字段
SELECT data->>'user' FROM app_data;  -- 返回 "Alice"

-- 更强大的查询：JSONPath（PostgreSQL 14+）
SELECT data.jsonpath_query('$.prefs.theme') FROM app_data;

-- 为 JSON 字段建索引
CREATE INDEX idx_data ON app_data USING GIN (data);
```

PostgreSQL 的 JSONB 支持更完善，索引能力更强。

### 数组类型

**MySQL**：不支持原生数组类型，需要用 JSON 或关联表模拟。

**PostgreSQL**：

```sql
CREATE TABLE tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50),
    article_ids INTEGER[]  -- 数组类型
);

INSERT INTO tags VALUES (1, 'Java', ARRAY[1, 2, 3]);

-- 查询包含特定值的数组
SELECT * FROM tags WHERE 2 = ANY(article_ids);
```

### 范围类型

PostgreSQL 独有：

```sql
CREATE TABLE reservations (
    id SERIAL PRIMARY KEY,
    room_id INT,
    period TSRANGE  -- 时间范围类型
);

-- 排除重叠的预订
SELECT * FROM reservations r1
WHERE NOT EXISTS (
    SELECT 1 FROM reservations r2
    WHERE r1.id != r2.id 
    AND r1.room_id = r2.room_id
    AND r1.period && r2.period  -- && 表示范围重叠
);
```

## 并发控制差异

### 锁机制

**MySQL InnoDB**：

- 行级锁：共享锁（S）、排他锁（X）
- 间隙锁：在索引间隙加锁，防止幻读
- Next-Key Lock：记录锁 + 间隙锁

**PostgreSQL**：

- 表级锁：多种模式（ACCESS SHARE、ROW SHARE、ROW EXCLUSIVE 等）
- 行级锁：FOR UPDATE、FOR SHARE、FOR NO KEY UPDATE
- Advisory Lock：应用层面的锁机制

### 死锁处理

两者都会检测死锁，但处理策略不同：

```sql
-- 查看 PostgreSQL 死锁日志
SHOW log_lock_waits;  -- 需要开启

-- MySQL 查看死锁信息
SHOW ENGINE INNODB STATUS;
```

## 面试中的高频问题

### Q1: MySQL 和 PostgreSQL 的主要区别是什么？

**考察点**：数据库选型理解、深度比较

**参考答案**：
1. SQL 标准遵循度：PostgreSQL 几乎完全遵循，MySQL 有自己的扩展
2. 事务隔离级别默认：MySQL 默认 RR，PostgreSQL 默认 RC
3. MVCC 实现：MySQL 用回滚段，PostgreSQL 用 xmin/xmax
4. 索引类型：PostgreSQL 更丰富（GIN、GiST、BRIN 等）
5. 数据类型：PostgreSQL 更丰富（数组、范围、JSONB）
6. 连接模型：MySQL 线程池，PostgreSQL 进程/线程
7. 扩展性：PostgreSQL 更强大

### Q2: 为什么 PostgreSQL 要有 VACUUM，而 MySQL 不需要？

**考察点**：MVCC 实现的理解

**参考答案**：
- PostgreSQL 的 MVCC 不使用回滚段，旧版本直接存在表中
- 随着时间推移，死元组（dead tuple）会积累，占用空间
- VACUUM 清理这些死元组，释放空间
- MySQL 用回滚段，旧版本写入回滚段，表本身不会被污染

### Q3: 什么场景下选 PostgreSQL 而不是 MySQL？

**考察点**：技术选型能力

**参考答案**：
1. 复杂查询：多表 JOIN、复杂子查询、窗口函数
2. 丰富数据类型：需要数组、JSONB、GIS、UUID 等
3. 数据一致性要求高：需要 Serializable 隔离级别
4. 需要高级特性：CTEs、递归查询、自定义类型/函数
5. 需要高扩展性：PostGIS、pgvector 等扩展

## 总结

| 维度 | MySQL | PostgreSQL |
|------|-------|------------|
| 核心理念 | 简单、性能 | 功能、标准 |
| SQL 标准 | 部分实现 | 几乎完全 |
| 事务隔离（默认） | RR | RC |
| MVCC 实现 | 回滚段 | xmin/xmax |
| 索引类型 | 5 种左右 | 6+ 种 |
| 数据类型 | 基础为主 | 极其丰富 |
| JSON 支持 | 一般 | 优秀（JSONB） |
| 数组类型 | 不支持 | 支持 |
| 扩展性 | 有限 | 强大 |
| 适用场景 | Web、简单业务 | 企业级、复杂业务 |
