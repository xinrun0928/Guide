# Using filesort 与 Using temporary 优化思路

用户反映：「订单列表加载太慢了，100 条数据要 3 秒。」

 你查了代码，SQL 是这样的：

```sql
SELECT * FROM orders 
WHERE user_id = 100 
ORDER BY create_time DESC 
LIMIT 100;
```

 EXPLAIN 一看：

```
Extra: Using filesort
Rows: 500000
```

 500 万行排序？难怪慢。但具体优化方案是什么？今天彻底搞懂这两个性能杀手。

---

## 先搞清楚它们是什么

### Using filesort：不是「文件排序」

很多人被名字骗了——filesort **不一定**涉及磁盘文件。

> filesort 的真实含义是：MySQL 无法利用索引的有序性，需要额外排序。

排序发生在两个地方：
- **内存排序区**（sort_buffer_size）：小数据量
- **外部文件排序**：大数据量（会产生临时文件）

### Using temporary：临时表怪兽

Using temporary 意味着 MySQL 需要创建**临时表**存储中间结果。

> 临时表存储在磁盘（MyISAM）或内存（InnoDB/MEMORY），读写磁盘是性能噩梦。

---

## 为什么会出现 Using filesort？

### 场景一：ORDER BY 字段没有索引

```sql
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    user_id BIGINT,
    status VARCHAR(20),
    create_time DATETIME,
    INDEX idx_user_id (user_id)  -- 只有这个索引
);

-- 触发 filesort
SELECT * FROM orders WHERE user_id = 100 ORDER BY create_time DESC;
```

**原因**：`idx_user_id` 只包含 `user_id`，无法同时满足查询条件和排序需求。

### 场景二：索引顺序与 ORDER BY 不匹配

```sql
CREATE INDEX idx_user_time ON orders(user_id, create_time);

-- 这个查询可以使用索引排序
SELECT * FROM orders WHERE user_id = 100 ORDER BY create_time DESC;

-- 但这个不行！
SELECT * FROM orders WHERE user_id = 100 ORDER BY status DESC, create_time DESC;
```

**原因**：联合索引 `idx_user_time` 的顺序是 `(user_id, create_time)`，无法支持先按 `status` 再按 `create_time` 排序。

### 场景三：排序方向不一致

```sql
CREATE INDEX idx_user_time ON orders(user_id, create_time);

-- OK：都是 DESC
SELECT * FROM orders WHERE user_id = 100 ORDER BY create_time DESC;

-- 触发 filesort：方向不一致
SELECT * FROM orders WHERE user_id = 100 ORDER BY create_time ASC;
```

---

## 为什么会出现 Using temporary？

### 场景一：GROUP BY 字段没有索引

```sql
-- 无索引
SELECT status, COUNT(*) as cnt 
FROM orders 
WHERE user_id = 100 
GROUP BY status;
```

### 场景二：DISTINCT 去重无索引支持

```sql
-- phone 字段无索引
SELECT DISTINCT phone FROM users WHERE city = '北京';
```

### 场景三：UNION 合并结果

```sql
SELECT name FROM users
UNION
SELECT name FROM admins;
```

> UNION 默认会进行去重，需要临时表。

---

## 优化方案大全

### 方案一：创建合适的索引

这是最有效的方案，让 MySQL 既能筛选又能排序/分组。

**针对 filesort 的优化**：

```sql
-- 原始 SQL
SELECT * FROM orders 
WHERE user_id = 100 
ORDER BY create_time DESC;

-- 优化：创建覆盖排序需求的联合索引
CREATE INDEX idx_user_time ON orders(user_id, create_time);

-- 如果还需要其他字段
CREATE INDEX idx_user_time_status ON orders(user_id, create_time, status);
```

**针对 temporary 的优化**：

```sql
-- 原始 SQL
SELECT status, COUNT(*) FROM orders GROUP BY status;

-- 优化：创建分组字段索引
CREATE INDEX idx_status ON orders(status);

-- 原始 SQL
SELECT DISTINCT phone FROM users WHERE city = '北京';

-- 优化：创建覆盖索引
CREATE INDEX idx_city_phone ON users(city, phone);
```

### 方案二：调整 SQL 语句

不是所有问题都要靠索引，SQL 改写也很重要。

**案例：避免子查询产生临时表**

```sql
-- 低效：子查询产生临时表
SELECT * FROM (
    SELECT id, user_id, status 
    FROM orders 
    WHERE user_id = 100
) t ORDER BY create_time DESC;

-- 高效：直接查询
SELECT id, user_id, status 
FROM orders 
WHERE user_id = 100 
ORDER BY create_time DESC;
```

**案例：UNION 改写为 UNION ALL**

```sql
-- 低效：需要临时表去重
SELECT name FROM users
UNION
SELECT name FROM admins;

-- 高效：不需要去重
SELECT name FROM users
UNION ALL
SELECT name FROM admins WHERE name NOT IN (
    SELECT name FROM users
);
```

### 方案三：调整排序缓冲区

如果 filesort 不可避免，可以尝试增大排序缓冲区：

```sql
-- 查看当前配置
SHOW VARIABLES LIKE 'sort_buffer_size';

-- 临时调整（生产环境建议在配置文件中修改）
SET GLOBAL sort_buffer_size = 2 * 1024 * 1024;  -- 2MB
```

> 注意：每个连接都会分配 sort_buffer_size，大了反而浪费内存。

### 方案四：覆盖索引减少回表

如果无法避免 filesort，至少让它扫描更少的数据：

```sql
-- 低效：需要回表获取所有字段
SELECT * FROM orders WHERE user_id = 100 ORDER BY create_time DESC;

-- 高效：只查索引字段，避免回表
SELECT id, user_id, create_time 
FROM orders WHERE user_id = 100 
ORDER BY create_time DESC;
```

---

## 实战优化案例

### 原始 SQL

```sql
SELECT o.*, u.name as user_name
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.status = 'paid'
ORDER BY o.create_time DESC
LIMIT 100;
```

### 分析执行计划

```sql
EXPLAIN SELECT o.*, u.name as user_name
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.status = 'paid'
ORDER BY o.create_time DESC
LIMIT 100;
```

```
+-----+------+-------+------+-------------+------+---------+------+--------+--------------------------------+
| id  | type | table | key  | rows        | Extra                                   |
+-----+------+-------+------+-------------+---------------------------------------+
|   1 | ALL  | o     | NULL | 500000      | Using where; Using filesort; Using tmpr |
|   1 | ref  | u     | PRIMARY      | 1         | Using index                      |
+-----+------+-------+------+-------------+---------------------------------------+
```

**问题诊断**：
1. orders 表是 ALL（全表扫描）
2. Using filesort + Using temporary 双管齐下
3. 扫描 50 万行

### 优化步骤

**第一步：添加合适的索引**

```sql
ALTER TABLE orders ADD INDEX idx_status_create(status, create_time);
```

**第二步：验证优化效果**

```sql
EXPLAIN SELECT o.*, u.name as user_name
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.status = 'paid'
ORDER BY o.create_time DESC
LIMIT 100;
```

```
+-----+------+-------+------+-------------+------+---------+------+--------+-------------+
| id  | type | table | key  | rows        | Extra                               |
+-----+------+-------+------+-------------+---------------------------------------+
|   1 | ref  | o     | idx_status_create | 1000 | Using index condition        |
|   1 | ref  | u     | PRIMARY      | 1        | Using index                |
+-----+------+-------+------+-------------+--------------------------------+
```

**优化后结果**：
- type 从 ALL 变成 ref
- filesort 和 temporary 消失
- rows 从 50 万降到 1000

### 最终验证

```sql
-- 执行优化后的 SQL
SELECT o.id, o.user_id, o.status, o.create_time, u.name as user_name
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.status = 'paid'
ORDER BY o.create_time DESC
LIMIT 100;
```

**性能对比**：

| 指标 | 优化前 | 优化后 |
|---|---|---|
| 执行时间 | 3.2 秒 | 0.015 秒 |
| 扫描行数 | 50 万 | 1000 |
| filesort | 有 | 无 |
| temporary | 有 | 无 |

---

## 判断优化是否到位

优化完成后，再次执行 EXPLAIN，检查以下信号：

| 目标 | 检查点 |
|---|---|
| 消除 filesort | Extra 中不再出现 Using filesort |
| 消除 temporary | Extra 中不再出现 Using temporary |
| 使用索引 | type 为 ref/eq_ref/const 之一 |
| 扫描行数下降 | rows 值显著降低 |

---

## 总结与思考

Using filesort 和 Using temporary 是性能问题的高频信号，但它们只是症状，不是病因。

> 优化思路：**先找索引问题，再考虑 SQL 改写，最后考虑参数调优**。

大多数情况下，添加合适的索引就能解决问题。

---

## 留给你的问题

1. 一条 SQL 同时出现 Using filesort 和 Using temporary，是否一定比只有其中一个更慢？考虑数据量大小。

2. 如果表有 1000 万数据，索引已经建好，但 EXPLAIN 还是显示 Using filesort，可能的原因是什么？

3. 覆盖索引（Using index）和 filesort 是什么关系？覆盖索引能完全消除 filesort 吗？
