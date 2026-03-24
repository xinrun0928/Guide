# EXPLAIN 执行计划详解：type、key、Extra 字段分析

面试官问：「你怎么分析一条 SQL 慢不慢？」

 答：「用 EXPLAIN 看执行计划。」

 面试官继续：「那 type 字段显示 ALL 是什么意思？怎么优化？」

 答：「......」

 你有没有过这种经历？今天我们来彻底搞懂 EXPLAIN。

---

## 为什么要用 EXPLAIN？

`EXPLAIN` 是 MySQL 的查询分析器，它告诉我们 MySQL 是**如何执行**一条 SQL 的，而不是告诉我们 SQL 写得对不对。

> 同样一条 SQL，在 100 条数据的表和 1000 万条数据的表上，执行计划可能完全不同。数据量是执行计划的重要参考。

---

## EXPLAIN 基础用法

```sql
EXPLAIN SELECT * FROM users WHERE name = '张三';
```

返回结果包含以下字段：

| 字段 | 含义 |
|---|---|
| id | 查询序号 |
| select_type | 查询类型 |
| table | 涉及的表 |
| type | 访问类型（重要） |
| possible_keys | 可能使用的索引 |
| key | 实际使用的索引（重要） |
| key_len | 索引长度 |
| ref | 与索引比较的列 |
| rows | 预估扫描行数（重要） |
| Extra | 额外信息（重要） |

---

## type 字段：访问类型的江湖地位

type 是面试高频考点，它描述了 MySQL 查找数据的方式，从好到坏排列：

```
system > const > eq_ref > ref > range > index > ALL
```

### system

表只有一行记录（系统表），几乎不会出现。

```sql
EXPLAIN SELECT * FROM (SELECT 1) AS t;
```

### const

主键或唯一索引的等值查询，最多匹配一行。

```sql
EXPLAIN SELECT * FROM users WHERE id = 1;
```

> 优化目标：让查询尽可能达到 const 或 eq_ref。

### eq_ref

**唯一索引**扫描，对于每个索引键值，只有一条记录匹配。

```sql
-- t1.id 是主键，t2.id 是外键
EXPLAIN SELECT * FROM orders t1 
JOIN users t2 ON t1.user_id = t2.id;
```

### ref

**非唯一索引**扫描，返回匹配某个值的所有行。

```sql
-- user_id 不是唯一索引
EXPLAIN SELECT * FROM orders WHERE user_id = 100;
```

### range

索引范围扫描，通常是 BETWEEN、>、<、IN 等操作。

```sql
EXPLAIN SELECT * FROM orders WHERE id BETWEEN 100 AND 200;
```

### index

全索引扫描，比 ALL 好，因为索引文件通常比数据文件小。

```sql
EXPLAIN SELECT id FROM orders;  -- 只查主键
```

### ALL（全表扫描）

最差的情况，需要扫描整个数据文件。

```sql
EXPLAIN SELECT * FROM orders WHERE name = '张三';  -- name 无索引
```

> **警告**：生产环境中看到 ALL，要立即警觉。

---

## key 字段：MySQL 最终选了哪个索引？

`possible_keys` 是可能使用的索引列表，`key` 是实际使用的索引。

```sql
CREATE INDEX idx_user_status ON orders(user_id, status);

EXPLAIN SELECT * FROM orders WHERE user_id = 1 AND status = 'paid';
```

```
possible_keys: idx_user_status
key: idx_user_status
```

如果没有使用索引，`key` 显示 NULL。

---

## Extra 字段：隐藏的优化线索

Extra 字段包含大量优化信息，是分析 SQL 的关键。

### Using index（覆盖索引）

所需数据都在索引中，无需回表。

```sql
EXPLAIN SELECT id, user_id FROM orders WHERE user_id = 1;
```

```
Extra: Using index
```

> 这是最好的情况，避免了回表查询。

### Using where

需要额外过滤条件，MySQL 会在存储引擎返回后再进行过滤。

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 1 AND status = 'paid';
```

### Using index condition（索引下推）

MySQL 5.6+ 的特性，部分条件下推存储引擎层处理。

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 1 AND status LIKE 'p%';
```

### Using filesort（文件排序）

无法使用索引排序，需要额外的排序步骤。

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 1 ORDER BY create_time;
```

> **警告**：filesort 在数据量大时性能急剧下降，需要优化。

### Using temporary（临时表）

需要使用临时表存储结果，常见于 GROUP BY、DISTINCT、UNION。

```sql
EXPLAIN SELECT DISTINCT status FROM orders WHERE user_id = 1;
```

> **警告**：temporary 也会严重影响性能。

### Using join buffer (Block Nested Loop)

join 操作无法使用索引，MySQL 使用嵌套循环暴力匹配。

```sql
EXPLAIN SELECT * FROM orders t1 
JOIN users t2 ON t1.user_id = t2.id;
```

> **警告**：BNL 在大表关联时是性能杀手。

---

## 实战：解读一个真实的执行计划

```sql
EXPLAIN SELECT o.*, u.name 
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.status = 'paid'
ORDER BY o.create_time DESC
LIMIT 100;
```

执行计划输出：

```
+----+-------------+-------+------+--------------------------+------------+----------
| id | select_type | table | type | key                      | rows       | Extra    |
+----+-------------+-------+------+--------------------------+----------- -+----------
|  1 | SIMPLE      | o     | ref  | idx_status_create        |      12345 | Using W  |
|  1 | SIMPLE      | u     | eq_ref| idx_id                  |         1 | Using    |
+----+-------------+-------+------+--------------------------+-----------+----------+
```

分析：

1. **type = ref**：使用非唯一索引查询，性能良好
2. **key = idx_status_create**：使用联合索引 `idx_status_create(status, create_time)`
3. **rows = 12345**：预估扫描 1.2 万行
4. **Extra = Using Where**：需要额外过滤
5. **join 使用 eq_ref**：关联字段使用了唯一索引，性能优秀

---

## 常见问题分析

### 为什么 type 是 ALL？

常见原因：
- WHERE 条件字段没有索引
- 查询了 SELECT *，需要所有列
- 数据量太小，优化器认为全表扫描更快

### 为什么有 Using filesort？

常见原因：
- ORDER BY 字段没有索引
- ORDER BY 使用了不同的方向（ASC 和 DESC 混用）
- 多字段排序但没有创建合适的联合索引

### 为什么 Using temporary？

常见原因：
- GROUP BY 字段没有索引
- GROUP BY 使用了函数或表达式
- DISTINCT 去重字段没有索引

---

## 优化原则

| type 值 | 优化建议 |
|---|---|
| ALL | 必须优化，添加索引 |
| index | 检查是否可以用更好的方式 |
| range | 确保范围合理，避免全索引扫描 |
| ref | 正常，性能良好 |
| eq_ref | 正常，性能优秀 |
| const | 最优 |

| Extra 值 | 优化建议 |
|---|---|
| Using filesort | 添加排序字段索引或优化排序方式 |
| Using temporary | 添加分组/去重字段索引 |
| Using where | 检查过滤条件是否需要索引 |

---

## 总结与思考

EXPLAIN 是分析 SQL 性能的第一把瑞士军刀。拿到执行计划后，重点看三个地方：

1. **type 字段**：找到性能瓶颈类型
2. **key 字段**：确认是否使用了索引
3. **Extra 字段**：发现隐藏的性能问题

---

## 留给你的问题

1. 如果一条 SQL 的 type 是 ALL，但 rows 显示只有 10 行，是否还需要优化？考虑边界情况。

2. Extra 字段同时出现「Using filesort」和「Using temporary」意味着什么？这种情况通常如何优化？

3. 为什么 MySQL 选择不使用索引（key 为 NULL），但 EXPLAIN 显示 possible_keys 有可用索引？这种情况在什么场景下会发生？
