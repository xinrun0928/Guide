# 分页查询优化：延迟关联、游标分页、覆盖索引

「分页到第 100 页就加载不出来了。」

 用户抱怨的是这种 SQL：

```sql
SELECT * FROM orders 
ORDER BY create_time DESC 
LIMIT 10000, 20;
```

 LIMIT offset 越大，性能越差。这是 MySQL 分页的天生缺陷。

 但别慌，今天我们来彻底解决它。

---

## 分页查询为什么慢？

### LIMIT 的工作原理

```sql
SELECT * FROM orders 
ORDER BY create_time DESC 
LIMIT 10000, 20;
```

MySQL 执行过程：

```
1. 扫描前 10020 行（不是 20 行！）
2. 丢弃前 10000 行
3. 返回剩余的 20 行
```

> 关键问题：**MySQL 必须扫描并丢弃前 10000 行，这是性能瓶颈的根源。**

### 性能对比

| SQL | 扫描行数 | 执行时间 |
|---|---|---|
| LIMIT 0, 20 | 20 | 0.001s |
| LIMIT 10000, 20 | 10020 | 0.85s |
| LIMIT 1000000, 20 | 1000020 | 8.2s |

> 随着 offset 增大，性能呈线性下降。

---

## 优化方案一：延迟关联

### 核心思想

先定位数据范围，再关联获取完整字段，避免扫描不需要的行。

### 实现方式

```sql
-- 低效：直接分页
SELECT * FROM orders 
ORDER BY create_time DESC 
LIMIT 10000, 20;

-- 高效：延迟关联
SELECT t.*, u.name as user_name, p.product_name
FROM (
    SELECT id, user_id, product_id, amount, create_time
    FROM orders
    ORDER BY create_time DESC
    LIMIT 10000, 20
) t
JOIN users u ON t.user_id = u.id
JOIN products p ON t.product_id = p.id;
```

### 原理分析

```
子查询：只扫描主键和排序字段
  → 只扫描 10020 行
  → 返回 20 个主键 ID

主查询：通过主键 ID 获取完整数据
  → 20 次主键查询（极快）
  → 关联用户和商品信息
```

### 适用场景

- 深度分页（offset > 1000）
- 分页字段有索引
- SELECT 需要除排序字段外的其他字段

---

## 优化方案二：游标分页（Keyset Pagination）

### 核心思想

不记录 offset，改用上一页最后一条记录的关键信息定位。

### 实现方式

```sql
-- 初始查询
SELECT * FROM orders 
ORDER BY create_time DESC, id DESC
LIMIT 20;

-- 下一页：传入上一页最后一条的时间戳和 ID
SELECT * FROM orders 
WHERE (create_time, id) < ('2024-01-15 10:30:00', 99999)
ORDER BY create_time DESC, id DESC
LIMIT 20;
```

### 关键点

```sql
-- 创建复合索引支持游标分页
CREATE INDEX idx_create_time_id ON orders(create_time, id);

-- 使用上一条记录的排序字段值作为游标
WHERE create_time < #{lastCursorTime}
  AND (create_time != #{lastCursorTime} OR id < #{lastCursorId})
```

> 这种方式的时间复杂度是 O(1)，不受分页深度影响。

### 完整 Java 示例

```java
public PageResult<Order> cursorPage(Long lastId, LocalDateTime lastCursor, int pageSize) {
    // 第一页
    if (lastId == null) {
        return orderMapper.selectPage(null, pageSize);
    }
    
    // 游标分页
    return orderMapper.selectByCursor(lastId, lastCursor, pageSize);
}
```

```java
@Select("SELECT * FROM orders " +
        "WHERE (create_time, id) < (#{lastCursor}, #{lastId}) " +
        "ORDER BY create_time DESC, id DESC " +
        "LIMIT #{pageSize}")
List<Order> selectByCursor(
    @Param("lastCursor") LocalDateTime lastCursor,
    @Param("lastId") Long lastId,
    @Param("pageSize") int pageSize
);
```

---

## 优化方案三：覆盖索引优化

### 核心思想

让分页查询只扫描索引，不扫描数据行。

### 实现方式

```sql
-- 原始 SQL
SELECT * FROM orders WHERE status = 'paid' ORDER BY create_time DESC LIMIT 10000, 20;

-- 添加覆盖索引
CREATE INDEX idx_status_time ON orders(status, create_time, id);

-- 延迟关联 + 覆盖索引
SELECT t.*, u.name
FROM (
    SELECT id FROM orders 
    WHERE status = 'paid' 
    ORDER BY create_time DESC 
    LIMIT 10000, 20
) t
JOIN orders o ON t.id = o.id
JOIN users u ON o.user_id = u.id;
```

### 覆盖索引原理

```
索引 idx_status_time 的结构：
(status, create_time, id)
 ├─ status = 'paid'  过滤
 ├─ create_time DESC  排序
 └─ id                返回

只需扫描索引，无需访问数据行
```

---

## 方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
|---|---|---|---|
| 直接分页 | 简单 | offset 大时性能差 | offset < 1000 |
| 延迟关联 | 效果好 | 需要改 SQL | 深度分页 |
| 游标分页 | 性能稳定 O(1) | 无法跳页 | feed 流、消息列表 |
| 覆盖索引 | 避免回表 | 索引维护成本 | 查询字段少 |

---

## 实战优化案例

### 原始问题

订单列表页加载慢：

```sql
-- 第 10 页加载时间超过 5 秒
SELECT o.*, u.name, p.product_name
FROM orders o
JOIN users u ON o.user_id = u.id
JOIN products p ON o.product_id = p.id
WHERE o.status = 'paid'
ORDER BY o.create_time DESC
LIMIT 9000, 30;
```

### 诊断分析

```sql
EXPLAIN SELECT o.*, u.name, p.product_name
FROM orders o
JOIN users u ON o.user_id = u.id
JOIN products p ON o.product_id = p.id
WHERE o.status = 'paid'
ORDER BY o.create_time DESC
LIMIT 9000, 30;
```

```
+----+------+-------+------+---------------+--------+---------+------+--------+-------------+
| id | type | table | key  | rows          | Extra                               |
+----+------+-------+------+---------------+--------+---------+------+--------+-------------+
|  1 | ALL  | o     | NULL | 500000        | Using filesort                     |
|  1 | ref  | u     | PRIMARY| 1           | Using index                        |
|  1 | ref  | p     | PRIMARY| 1           | Using index                        |
+----+------+-------+------+---------------+--------+---------+------+--------+-------------+
```

问题：全表扫描 + filesort，扫描 50 万行。

### 优化步骤

**第一步：添加索引**

```sql
ALTER TABLE orders ADD INDEX idx_paid_time(status, create_time);
```

**第二步：改写 SQL（延迟关联 + 覆盖索引）**

```sql
SELECT o.id, o.user_id, o.product_id, o.amount, o.create_time,
       u.name, p.product_name
FROM (
    SELECT id FROM orders 
    WHERE status = 'paid' 
    ORDER BY create_time DESC 
    LIMIT 9000, 30
) t
JOIN orders o ON t.id = o.id
JOIN users u ON o.user_id = u.id
JOIN products p ON o.product_id = p.id;
```

**第三步：验证优化效果**

```sql
EXPLAIN SELECT o.id, o.user_id, o.product_id, o.amount, o.create_time,
       u.name, p.product_name
FROM (
    SELECT id FROM orders 
    WHERE status = 'paid' 
    ORDER BY create_time DESC 
    LIMIT 9000, 30
) t
JOIN orders o ON t.id = o.id
JOIN users u ON o.user_id = u.id
JOIN products p ON o.product_id = p.id;
```

```
+----+------+-------+------+-------------+------+---------+------+--------+-------------+
| id | type | table | key  | rows        | Extra                               |
+----+------+-------+------+-------------+------+---------+------+--------+-------------+
|  1 | ref  | o     | idx_paid_time | 30 | Using index condition              |
|  1 | eq_ref| u    | PRIMARY       | 1  | Using index                        |
|  1 | eq_ref| p    | PRIMARY       | 1  | Using index                        |
+----+------+-------+------+-------------+------+---------+------+--------+-------------+
```

### 性能对比

| 指标 | 优化前 | 优化后 |
|---|---|---|
| 执行时间 | 5.2 秒 | 0.035 秒 |
| 扫描行数 | 50 万 | 30 |
| Using filesort | 有 | 无 |

---

## COUNT(*) 和总页数的处理

分页通常需要返回总页数，但 COUNT(*) 在大表上也很慢。

### 方案一：缓存计数

```sql
-- 使用缓存存储总数，定期更新
-- Redis: page_count = SELECT COUNT(*) / page_size
```

### 方案二：估算总数

```sql
-- InnoDB 可以用估算值
SHOW TABLE STATUS LIKE 'orders';
-- Rows: 5000000（估算值）
```

### 方案三：接受不精确

对于大表，「大约有多少页」比「精确有多少条」更实用。

---

## 总结与思考

分页优化有三条路：

1. **减少扫描行数**：延迟关联
2. **避免 offset**：游标分页
3. **避免回表**：覆盖索引

> 没有银弹，只有组合拳。

---

## 留给你的问题

1. 游标分页无法跳页（如「跳到第 50 页」），如何解决这个问题？有什么折中方案？

2. 延迟关联中，子查询返回的只是主键 ID，为什么后续 JOIN 还能获取到完整数据？IN 查询和 JOIN 哪种更快？

3. 如果订单表有 1 亿数据，分页到第 1000 页，游标分页的游标值如何生成才能保证不丢数据？
