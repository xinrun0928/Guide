# 索引优化：索引下推、覆盖索引、前缀索引

加了索引，查询还是慢？

```sql
-- 加了索引
CREATE INDEX idx_name ON users(name);

-- 查询
SELECT * FROM users WHERE name LIKE '张%' AND age = 25;

-- EXPLAIN 结果
type: range
key: idx_name
rows: 1000
Extra: Using index condition
```

明明用了索引，为什么还是扫描了 1000 行？

 问题出在哪？今天彻底搞懂索引下推、覆盖索引和前缀索引。

---

## 索引下推（Index Condition Pushdown）

### 什么是索引下推？

索引下推（ICP）是 MySQL 5.6+ 引入的优化特性。

> **核心思想**：把 WHERE 条件的过滤下推到存储引擎层，减少 MySQL 服务层和存储引擎层之间的数据传输。

### 没有 ICP 的执行流程

```
MySQL 服务层 → 存储引擎：给我 name LIKE '张%' 的所有行
存储引擎 → MySQL 服务层：返回 1000 行
MySQL 服务层 → MySQL 服务层：过滤 age = 25，剩 50 行
```

> 问题：1000 行全部返回，浪费了大量 I/O。

### 有 ICP 的执行流程

```
MySQL 服务层 → 存储引擎：给我 name LIKE '张%' 的所有行
存储引擎 → 存储引擎：在索引中过滤 age = 25
存储引擎 → MySQL 服务层：返回 50 行
```

> 优化：只返回真正需要的数据。

### ICP 生效条件

```sql
-- ICP 适用于这种场景
SELECT * FROM users WHERE name LIKE '张%' AND age = 25;

-- idx_name 是联合索引 (name, age)
CREATE INDEX idx_name_age ON users(name, age);
```

```sql
-- EXPLAIN 查看
EXPLAIN SELECT * FROM users WHERE name LIKE '张%' AND age = 25;
```

```
+----+------+-------+------+---------------+------+---------+------+------+-----------------------+
| id | type | table | key  | possible_keys | ... | rows    | Extra                     |
+----+------+-------+------+---------------+------+---------+------+------+-----------------------+
|  1 | range| users | idx_name_age | idx_name_age | ... | 50      | Using index condition   |
+----+------+-------+------+---------------+------+---------+------+------+-----------------------+
```

> Extra 显示 `Using index condition` 表示 ICP 生效。

### ICP 关闭

```sql
-- 查看当前设置
SHOW VARIABLES LIKE 'optimizer_switch';

-- 关闭 ICP
SET optimizer_switch = 'index_condition_pushdown=off';

-- 开启 ICP
SET optimizer_switch = 'index_condition_pushdown=on';
```

---

## 覆盖索引（Covering Index）

### 什么是覆盖索引？

如果一个索引包含了 SELECT、WHERE、ORDER BY、GROUP BY 所有需要的字段，就称为**覆盖索引**。

> **核心优势**：所有操作都在索引树中完成，无需回表。

### 回表查询 vs 覆盖索引

**场景**：查询 `name = '张三'` 的用户年龄

```sql
-- 原始查询
SELECT age FROM users WHERE name = '张三';
```

**方案一：回表查询（低效）**

```sql
CREATE INDEX idx_name ON users(name);

-- 执行过程：
-- 1. 在 idx_name 找到 name='张三'，获取主键 ID = 100
-- 2. 用主键回表查询整行数据
-- 3. 返回 age 字段
```

**方案二：覆盖索引（高效）**

```sql
CREATE INDEX idx_name_age ON users(name, age);

-- 执行过程：
-- 1. 在 idx_name_age 找到 name='张三'，直接返回 age
-- 2. 无需回表
```

```sql
EXPLAIN SELECT age FROM users WHERE name = '张三';
```

```
+----+------+-------+---------------+------+---------+------+------+-------------+
| id | type | table | key          | rows | Extra                          |
+----+------+-------+---------------+------+---------+------+------+-------------+
|  1 | ref  | users | idx_name_age |    1 | Using index                    |
+----+------+-------+---------------+------+---------+------+------+-------------+
```

> Extra 显示 `Using index` 表示使用覆盖索引，无需回表。

### 覆盖索引的判断

| Extra 值 | 含义 |
|---|---|
| Using index | 使用覆盖索引，性能最优 |
| Using index condition | 使用索引下推，但需要回表 |
| Using where | 需要在 MySQL 服务层过滤 |
| Using filesort | 需要额外排序 |

### 覆盖索引设计原则

**原则一：高频查询字段优先**

```sql
-- 场景：订单列表页
SELECT id, order_no, user_id, amount, status, create_time
FROM orders
WHERE user_id = 100
ORDER BY create_time DESC;

-- 覆盖索引设计
CREATE INDEX idx_user_time_cover ON orders(
    user_id,           -- 过滤条件
    create_time DESC,  -- 排序
    id, order_no, amount, status  -- 查询字段
);
```

**原则二：字段顺序很重要**

```sql
-- 低效：排序字段在查询字段前面
CREATE INDEX idx_user ON orders(user_id, create_time, id, order_no);

-- 高效：先过滤，再排序，再查询
CREATE INDEX idx_user ON orders(user_id, create_time DESC);
```

---

## 前缀索引（Prefix Index）

### 什么是前缀索引？

只索引字符串字段的前 N 个字符，而不是整个字符串。

> **适用场景**：字符串很长，但前几个字符就能区分记录。

### 创建前缀索引

```sql
-- email 字段平均长度 30，直接建索引太占空间
-- 使用前缀索引，只索引前 10 个字符
CREATE INDEX idx_email_prefix ON users(email(10));

-- 或者精确控制长度
CREATE INDEX idx_phone_prefix ON users(phone(7));
```

### 选择前缀长度

```sql
-- 分析字段前缀的区分度
SELECT 
    LEFT(email, 5) as prefix5,
    COUNT(DISTINCT email) as distinct_count
FROM users
GROUP BY LEFT(email, 5)
ORDER BY distinct_count DESC
LIMIT 20;

-- 计算前缀选择性
SELECT 
    COUNT(DISTINCT LEFT(email, 5)) / COUNT(*) as sel5,
    COUNT(DISTINCT LEFT(email, 10)) / COUNT(*) as sel10,
    COUNT(DISTINCT LEFT(email, 15)) / COUNT(*) as sel15,
    COUNT(DISTINCT LEFT(email, 20)) / COUNT(*) as sel20
FROM users;
```

> 选择性越接近完整字段越好，一般选择 0.9 以上的。

### 前缀索引的限制

```sql
-- 无法用于 ORDER BY
CREATE INDEX idx_email_prefix ON users(email(10));

-- 这个查询无法使用前缀索引排序
SELECT * FROM users ORDER BY email DESC LIMIT 10;

-- 可以使用，但无法用于分组
SELECT COUNT(*) FROM users GROUP BY email;
```

---

## 三种索引优化实战

### 场景：用户搜索优化

**需求**：

```sql
-- 搜索用户
SELECT id, name, email, phone, create_time
FROM users
WHERE name LIKE '张%'
  AND status = 'active'
ORDER BY create_time DESC
LIMIT 20;
```

**低效方案**

```sql
-- 单独索引
CREATE INDEX idx_name ON users(name);
CREATE INDEX idx_status ON users(status);

-- EXPLAIN 结果
type: range
key: idx_name
rows: 5000
Extra: Using where; Using filesort
```

> 问题：filesort，需要回表获取其他字段。

**高效方案**

```sql
-- 覆盖索引：name + status + create_time + 查询字段
CREATE INDEX idx_search ON users(
    name,               -- LIKE 查询
    status,             -- 精确匹配
    create_time DESC,   -- 排序
    id, email, phone    -- 查询字段
);

-- EXPLAIN 结果
type: range
key: idx_search
rows: 50
Extra: Using index
```

### 场景：订单统计优化

**需求**：

```sql
SELECT status, COUNT(*) as cnt, SUM(amount) as total
FROM orders
WHERE create_time BETWEEN '2024-01-01' AND '2024-01-31'
GROUP BY status;
```

**优化方案**

```sql
-- 使用索引下推 + 覆盖索引
CREATE INDEX idx_time_status ON orders(
    create_time,  -- 范围查询
    status,      -- 分组
    amount       -- 聚合字段
);

-- 验证
EXPLAIN SELECT status, COUNT(*), SUM(amount)
FROM orders
WHERE create_time BETWEEN '2024-01-01' AND '2024-01-31'
GROUP BY status;
```

```
+----+------+-------+----------------+------+---------+------+--------+-------------+
| id | type | table | key           | rows | Extra                          |
+----+------+-------+----------------+------+---------+------+--------+-------------+
|  1 | range| orders| idx_time_status| 1000 | Using index condition; Using  |
|    |      |       |                |      | temporary; Using filesort     |
+----+------+-------+----------------+------+---------+------+--------+-------------+
```

> 分组还是会用到临时表和文件排序，但扫描行数大幅减少。

### 场景：手机号查询优化

**需求**：

```sql
-- 手机号精确查询
SELECT * FROM users WHERE phone = '13812345678';
```

**问题**：手机号 11 位，VARCHAR(11)，建完整索引占用空间大。

**解决方案：前缀索引**

```sql
-- 分析前缀区分度
SELECT 
    COUNT(DISTINCT LEFT(phone, 3)) / COUNT(*) as sel3,   -- 0.001
    COUNT(DISTINCT LEFT(phone, 6)) / COUNT(*) as sel6,   -- 0.100
    COUNT(DISTINCT LEFT(phone, 7)) / COUNT(*) as sel7,   -- 0.500
    COUNT(DISTINCT LEFT(phone, 8)) / COUNT(*) as sel8,   -- 0.900
    COUNT(DISTINCT LEFT(phone, 9)) / COUNT(*) as sel9,   -- 0.990
    COUNT(DISTINCT phone) / COUNT(*) as sel_all          -- 1.000
FROM users;

-- 选择前 9 位，前缀选择性 0.99
CREATE INDEX idx_phone_prefix ON users(phone(9));
```

> 索引大小减少 18%，查询性能几乎不变。

---

## 索引优化检查清单

| 检查项 | 方法 |
|---|---|
| 是否使用索引 | EXPLAIN 的 type 是否在 ref/range/eq_ref |
| 是否回表 | Extra 是否出现 Using index |
| 是否下推 | Extra 是否出现 Using index condition |
| 字段顺序 | 过滤条件字段是否在排序字段前面 |
| 索引长度 | 字符串字段是否可以用前缀索引 |

---

## 总结与思考

三种索引优化各有侧重：

| 优化技术 | 解决问题 | 适用场景 |
|---|---|---|
| 索引下推 | 减少回表次数 | LIKE + 额外条件 |
| 覆盖索引 | 避免回表 | SELECT 字段少 |
| 前缀索引 | 减小索引体积 | 字符串字段长 |

> 好的索引设计 = 合理的字段顺序 + 适当的索引长度 + 覆盖查询字段。

---

## 留给你的问题

1. 索引下推（ICP）和覆盖索引是什么关系？两者可以同时生效吗？

2. 前缀索引和普通索引在查询性能上有什么本质区别？为什么前缀索引无法用于 ORDER BY 和 GROUP BY？

3. 假设有一个字段是 VARCHAR(500) 的 URL，平均长度 200，但前 50 个字符区分度只有 0.1。如何设计索引？
