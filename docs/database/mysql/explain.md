# EXPLAIN：读懂 SQL 的执行计划

你知道吗？

一条 `EXPLAIN` 语句，能让你看清 MySQL 是怎么执行你的 SQL 的。

有没有走索引？走了哪个索引？扫描了多少行？有没有排序？

EXPLAIN 告诉你一切。

---

## 基本用法

```sql
EXPLAIN SELECT * FROM orders WHERE status = 'pending';
```

输出：

```
+----+-------------+--------+------------+------+---------------+------+---------+------+--------+----------+-------+
| id | select_type| table  | type       | key  | key_len       | ref | rows    | Extra                        |
+----+-------------+--------+------------+------+---------------+------+---------+------+--------+----------+-------+
|  1 | SIMPLE     | orders | ALL        | NULL | NULL          | NULL| 1000000 | Using where                  |
+----+-------------+--------+------------+------+---------------+------+---------+------+--------+----------+-------+
```

---

## 关键字段解析

### type：访问类型

type 字段描述了 MySQL 决定如何访问表中的数据，从最优到最差：

| type 值 | 含义 | 说明 |
|---------|------|------|
| **system** | 系统表，只有单行 | 最优 |
| **const** | 最多匹配一行 | 主键或唯一索引 |
| **eq_ref** | 唯一扫描 | 关联查询中使用主键或唯一索引 |
| **ref** | 非唯一索引扫描 | 非唯一索引 |
| **range** | 索引范围扫描 | BETWEEN、IN、>、< |
| **index** | 全索引扫描 | 遍历整个索引 |
| **ALL** | 全表扫描 | 最差，需要优化 |

**实战关注**：
- 如果是 `ALL`，说明走了全表扫描，需要优化
- `const` 和 `eq_ref` 是最优的
- `ref` 和 `range` 是可以接受的

### key：使用的索引

key 字段显示 MySQL 实际使用的索引。

```
key: idx_status  -- 使用了 idx_status 索引
key: NULL        -- 没有使用索引
```

### rows：扫描行数

MySQL 估算需要扫描的行数。这个数字越小越好。

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 100;
-- rows: 500  -- 估算扫描 500 行
-- rows: 1000000  -- 估算扫描 100 万行，需要优化
```

### Extra：额外信息

这是最重要的字段，告诉你 MySQL 做了什么额外操作：

| Extra 值 | 含义 | 说明 |
|----------|------|------|
| **Using index** | 覆盖索引 | 不需要回表 |
| **Using where** | 使用 WHERE 过滤 | 需要在存储引擎层过滤 |
| **Using filesort** | 使用文件排序 | 性能差，需要优化 |
| **Using temporary** | 使用临时表 | 性能差，需要优化 |
| **Using index condition** | 索引下推 | ICP 生效 |
| **Using MRR** | 使用 MRR 优化 | 回表优化 |

---

## 实战分析

### 案例一：全表扫描

```sql
EXPLAIN SELECT * FROM orders WHERE status = 'pending';
```

```
+----+-------------+--------+------------+------+---------------+------+---------+------+--------+----------+-------------+
| id | select_type| table  | type       | key  | key_len       | ref | rows    | Extra                        |
+----+-------------+--------+------------+------+---------------+------+---------+------+--------+----------+-------------+
|  1 | SIMPLE     | orders | ALL        | NULL | NULL          | NULL| 1000000 | Using where                  |
+----+-------------+--------+------------+------+---------------+------+---------+------+--------+----------+-------------+
```

**问题**：
- `type=ALL`：全表扫描
- `key=NULL`：没有使用索引
- `rows=1000000`：扫描了 100 万行

**优化**：给 `status` 字段加索引

```sql
CREATE INDEX idx_status ON orders(status);
```

### 案例二：索引覆盖

```sql
EXPLAIN SELECT id, status, created_at FROM orders WHERE status = 'pending';
```

```
+----+-------------+--------+------------+------+---------------+-------------+------+----------+-----------------------+
| id | select_type| table  | type       | key  | key_len       | ref         | rows | Extra    |                       |
+----+-------------+--------+------------+------+---------------+-------------+------+----------+-----------------------+
|  1 | SIMPLE     | orders | ref        | idx_status | 23       | const       | 5000 | Using index           |
+----+-------------+--------+------------+------+---------------+-------------+------+----------+-----------------------+
```

**分析**：
- `type=ref`：使用索引
- `key=idx_status`：使用 idx_status 索引
- `Extra=Using index`：覆盖索引，不需要回表

### 案例三：文件排序

```sql
EXPLAIN SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at;
```

```
+----+-------------+--------+------------+------+---------------+------+--------+----------+-----------------------------+
| id | select_type| table  | type       | key  | key_len       | ref  | rows   | Extra    |                            |
+----+-------------+--------+------------+------+---------------+------+--------+----------+-----------------------------+
|  1 | SIMPLE     | orders | ref        | idx_status | 23     | const  | 5000   | Using where; Using filesort |
+----+-------------+--------+------------+------+---------------+------+--------+----------+-----------------------------+
```

**问题**：`Extra=Using filesort`，说明需要在内存或磁盘中排序

**优化**：创建联合索引

```sql
CREATE INDEX idx_status_created ON orders(status, created_at);
```

### 案例四：关联查询

```sql
EXPLAIN SELECT o.*, u.name
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.status = 'pending';
```

```
+----+-------------+-------+--------+---------------+-------------+---------+--------+--------------------------+
| id | select_type| table | type   | key           | key_len     | ref     | rows   | Extra                    |
+----+-------------+-------+--------+---------------+-------------+---------+--------+--------------------------+
|  1 | SIMPLE     | o     | ref    | idx_user_id   | 8           | const   | 5000   | Using where              |
|  1 | SIMPLE     | u     | eq_ref| PRIMARY       | 8           | o.user_id| 1     |                          |
+----+-------------+-------+--------+---------------+-------------+---------+--------+--------------------------+
```

**分析**：
- `type=ref`：orders 表使用索引
- `type=eq_ref`：users 表使用主键索引，是最优的关联方式
- `rows=5000`：orders 表扫描 5000 行

---

## EXPLAIN ANALYZE（MySQL 8.0+）

MySQL 8.0 引入了 `EXPLAIN ANALYZE`，可以查看实际执行的成本：

```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE status = 'pending';
```

输出包含估算行数 vs 实际行数、实际执行时间等信息。

---

## 一句话总结

EXPLAIN 的核心是看三个指标：**type**（越接近 const/eq_ref 越好）、**key**（是否有索引可用）、**Extra**（有没有 filesort/temporary）。发现全表扫描或文件排序，就要优化。
