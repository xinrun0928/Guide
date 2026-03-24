# JOIN 优化：嵌套循环连接与 MRR 优化

两条 SQL 都用了 JOIN，查询时间却差了 100 倍。

```sql
-- SQL A：0.5 秒
SELECT * FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.user_id = 100;

-- SQL B：52 秒
SELECT * FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.status = 'paid';
```

明明逻辑一样，为什么性能差距这么大？

JOIN 的水很深，今天我们来彻底搞懂它。

---

## MySQL JOIN 的执行原理

MySQL 使用的是**嵌套循环连接（Nested Loop Join）**算法，理解它是优化 JOIN 的基础。

### 嵌套循环连接原理

```
FOR each row in t1 (驱动表):
    FOR each row in t2 (被驱动表):
        IF row t1 matches row t2:
            RETURN combined row
```

**特点**：
- 驱动表（外表）先执行，被驱动表（内表）多次访问
- 被驱动表必须有索引，否则是灾难
- 驱动表返回多少行，被驱动表就要扫描多少次

### 驱动表 vs 被驱动表

```sql
SELECT * FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.user_id = 100;
```

这里：
- `orders` 是驱动表（因为有限制条件 `o.user_id = 100`）
- `users` 是被驱动表（通过 `u.id` 关联）

---

## 七种 JOIN 类型与性能

MySQL 的 EXPLAIN type 字段会显示 JOIN 的访问类型：

### eq_ref：最优

每个外表格最多匹配一行。

```sql
-- users.id 是主键
EXPLAIN SELECT * FROM orders o
JOIN users u ON o.user_id = u.id;
```

```
+----+------+-------+------+---------------+---------+
| id | type | table | key  | ref           | rows    |
+----+------+-------+------+---------------+---------+
|  1 | ALL  | o     | NULL | NULL          | 500000  |
|  1 | eq_ref| u    | PRIMARY| const       | 1       |
+----+------+-------+------+---------------+---------+
```

> 性能最优，每次匹配最多返回一行。

### ref：次优

非唯一索引扫描。

```sql
-- user_id 不是唯一索引
EXPLAIN SELECT * FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.user_id = 100;
```

### ref_or_null：带 NULL 值的 ref

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 100 OR user_id IS NULL;
```

### range：范围扫描

```sql
EXPLAIN SELECT * FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.user_id BETWEEN 100 AND 200;
```

### index：全索引扫描

比 ref 差，但比 ALL 好。

### ALL：全表扫描（危险）

```sql
-- 无 WHERE 条件的全表 JOIN
EXPLAIN SELECT * FROM orders o
JOIN users u ON o.user_id = u.id;
```

> **警告**：生产环境看到 type=ALL 的 JOIN，要立即警觉。

---

## MRR 优化：Multi-Range Read

MRR 是 MySQL 针对 JOIN 优化的高级特性，理解它能帮我们写出更高效的 SQL。

### MRR 的作用

传统 JOIN 流程：

```
1. 从驱动表取出一行 (user_id = 100)
2. 在被驱动表查找 user_id = 100
3. 从驱动表取出一行 (user_id = 101)
4. 在被驱动表查找 user_id = 101
...
```

> 问题：随机 I/O 太多，磁盘寻道浪费时间。

MRR 优化流程：

```
1. 从驱动表取出所有匹配行的关联键（100, 101, 105, 200...）
2. 对这些键排序
3. 按顺序批量读取被驱动表数据
```

> 优势：利用磁盘顺序读取，减少随机 I/O。

### 开启 MRR

```sql
-- 查看 MRR 是否开启
SHOW VARIABLES LIKE 'optimizer_switch';

-- 开启 MRR（全局）
SET GLOBAL optimizer_switch = 'mrr=on,mrr_cost_based=off';
```

### MRR 生效条件

MRR 不是万能的，以下情况会生效：
- 使用 range 访问类型
- 使用 ref 或 eq_ref 访问
- 涉及的索引是主键或唯一索引

### MRR 效果验证

```sql
SET optimizer_switch = 'mrr=on,mrr_cost_based=off';

EXPLAIN SELECT * FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.user_id BETWEEN 100 AND 1000;

-- Extra 中会显示 "Using MRR"
```

---

## Batched Key Access (BKA)

BKA 是 MRR 的增强版，让 JOIN 也能利用批量访问优化。

### BKA 工作原理

```
1. 使用 join buffer 批量获取驱动表行
2. 将关联键打包发送给存储引擎
3. 存储引擎批量获取数据并排序
4. 返回匹配结果
```

### 开启 BKA

```sql
SET optimizer_switch = 'batched_key_access=on';
```

> 注意：BKA 需要 MRR 先开启。

---

## JOIN 优化实战

### 案例一：小表驱动大表

**原则**：让数据量小的表做驱动表。

```sql
-- 假设 users 表只有 1000 行，orders 表有 500 万行
-- 低效：大表做驱动表
SELECT * FROM orders o
JOIN users u ON o.user_id = u.id;

-- 高效：小表做驱动表
SELECT * FROM users u
JOIN orders o ON o.user_id = u.id;
```

> MySQL 优化器通常会自动选择小表做驱动表，但显式指定更可靠。

### 案例二：被驱动表关联字段要有索引

```sql
-- 低效：被驱动表无索引
SELECT * FROM orders o
JOIN users u ON o.user_id = u.id;

-- 高效：添加索引
ALTER TABLE orders ADD INDEX idx_user_id(user_id);
```

### 案例三：使用 STRAIGHT_JOIN 强制指定顺序

当 MySQL 选错驱动表时，可以用 STRAIGHT_JOIN 强制：

```sql
SELECT STRAIGHT_JOIN * FROM orders o
JOIN users u ON o.user_id = u.id;
```

> 谨慎使用，只有在确定 MySQL 选择错误时才用。

### 案例四：分步查询替代大表 JOIN

```sql
-- 低效：大表直接 JOIN
SELECT o.*, u.name
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.create_time > '2024-01-01';

-- 高效：分步查询
-- Step 1: 先查询用户 ID 列表
SELECT id INTO @user_ids FROM users WHERE vip_level = 'gold';

-- Step 2: 再查订单
SELECT * FROM orders
WHERE user_id IN (@user_ids)
AND create_time > '2024-01-01';
```

### 案例五：利用覆盖索引减少回表

```sql
-- 低效：需要回表
SELECT o.id, o.amount, u.name
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.user_id = 100;

-- 高效：覆盖索引
ALTER TABLE orders ADD INDEX idx_user_id_amount(user_id, amount);
```

---

## JOIN 性能黄金法则

| 法则 | 说明 |
|---|---|
| 驱动表数据量要小 | 让小表驱动大表 |
| 被驱动表关联字段要有索引 | 没有索引是性能灾难 |
| 尽量用主键/唯一索引关联 | eq_ref 比 ref 快 |
| 控制 JOIN 结果集大小 | 先过滤再 JOIN |
| 避免 SELECT * | 只查需要的字段 |

---

## 常见错误与避坑

### 错误一：忽视驱动表数据量

```sql
-- 错误：复杂子查询作为驱动表
SELECT * FROM (
    SELECT * FROM orders WHERE status = 'paid'
) t
JOIN users u ON t.user_id = u.id;
```

### 错误二：JOIN 条件使用函数

```sql
-- 低效：函数导致索引失效
SELECT * FROM orders o
JOIN users u ON DATE(o.create_time) = DATE(u.register_time);

-- 高效：范围查询
SELECT * FROM orders o
JOIN users u ON o.create_time >= u.register_time 
              AND o.create_time < DATE_ADD(u.register_time, INTERVAL 1 DAY);
```

### 错误三：多表 JOIN 忽略中间表大小

```sql
-- 四表 JOIN：A -> B -> C -> D
-- 如果 B 表有 1 亿行，即使 A 和 D 很小，也很慢
SELECT * FROM A
JOIN B ON A.id = B.a_id
JOIN C ON B.id = C.b_id
JOIN D ON C.id = D.c_id;
```

---

## 总结与思考

JOIN 优化的核心是**减少被驱动表的扫描次数**和**利用好索引**。

> 记住：驱动表决定扫描次数，被驱动表的索引决定每次扫描的成本。

MRR 和 BKA 是高阶优化手段，大多数情况下，合理的索引设计就能解决问题。

---

## 留给你的问题

1. 为什么被驱动表的关联字段要建索引？如果不建索引，性能会差多少？

2. STRAIGHT_JOIN 和 JOIN 的区别是什么？什么情况下需要强制指定 JOIN 顺序？

3. 假设有三个表 A(100行)、B(1亿行)、C(1000行)，A JOIN B JOIN C，如果 B 是中间表，如何优化？
