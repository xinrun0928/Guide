# GROUP BY 优化：让聚合查询飞起来

GROUP BY 看似简单，但如果数据量大，它可能比 JOIN 还慢。

今天，我们彻底搞懂 GROUP BY 的优化。

---

## GROUP BY 的执行过程

### 无索引时的 GROUP BY

```sql
SELECT status, COUNT(*) FROM orders GROUP BY status;
```

```
执行流程：
┌─────────────────────────────────────────────────────────────┐
│ 1. 全表扫描 orders 表                                       │
│ 2. 创建临时表                                               │
│ 3. 对于每一行，计算 GROUP BY 字段的值                       │
│ 4. 如果分组已存在，累加 COUNT；如果不存在，插入新行          │
│ 5. 扫描完成后，返回临时表内容                                │
└─────────────────────────────────────────────────────────────┘
```

### 有索引时的 GROUP BY

```sql
-- 假设有索引 idx_status
CREATE INDEX idx_status ON orders(status);

SELECT status, COUNT(*) FROM orders GROUP BY status;
```

```
执行流程：
┌─────────────────────────────────────────────────────────────┐
│ 1. 扫描索引 idx_status（索引本身是有序的）                  │
│ 2. 相同 status 的行在索引中连续存储                         │
│ 3. 顺序扫描索引，统计每组的数量                             │
│ 4. 直接返回结果，无需临时表                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## GROUP BY 的性能问题

### 问题一：Using temporary

```sql
EXPLAIN SELECT status, COUNT(*), SUM(amount) FROM orders GROUP BY status;
```

```
+----+-------------+--------+------------+------+---------------+------+---------+------+--------+----------+-----------------------------+
| id | select_type| table  | type       | key  | key_len       | ref | rows    | Extra                        |
+----+-------------+--------+------------+------+---------------+------+---------+------+--------+----------+-----------------------------+
|  1 | SIMPLE     | orders | index      | idx_status | 23    | NULL| 10000   | Using index; Using temporary |
+----+-------------+--------+------------+------+---------------+------+---------+------+--------+----------+-----------------------------+
```

`Using temporary` 说明需要创建临时表，性能较差。

### 问题二：Using filesort

当 GROUP BY 和 ORDER BY 不一致时。

```sql
SELECT status, COUNT(*) FROM orders GROUP BY status ORDER BY COUNT(*) DESC;
```

```
Extra: Using temporary; Using filesort
```

---

## GROUP BY 优化方案

### 方案一：创建合适的索引

让 GROUP BY 的字段在索引中。

```sql
-- 查询
SELECT status, COUNT(*) FROM orders GROUP BY status;

-- 索引
CREATE INDEX idx_status ON orders(status);

-- 或者更完整
CREATE INDEX idx_status_count ON orders(status, id);
```

### 方案二：确保 GROUP BY 和 ORDER BY 一致

```sql
-- 不一致：产生临时表和文件排序
SELECT status, COUNT(*) FROM orders GROUP BY status ORDER BY status;

-- 一致：直接使用索引
SELECT status, COUNT(*) FROM orders GROUP BY status ORDER BY status;
-- Extra: Using index
```

### 方案三：用 HAVING 过滤而非 WHERE

```sql
-- 不好：WHERE 在 GROUP BY 之前执行，可能过滤大量数据
SELECT status, COUNT(*)
FROM orders
WHERE amount > 100
GROUP BY status;

-- 好：先用 GROUP BY，再用 HAVING
SELECT status, COUNT(*)
FROM orders
GROUP BY status
HAVING SUM(amount) > 100;
```

### 方案四：利用松散索引扫描

当 GROUP BY 是索引的前缀列时，MySQL 可以利用松散索引扫描。

```sql
-- 索引：(status, user_id, amount)
-- GROUP BY status，status 是索引最左前缀

SELECT status, COUNT(*), SUM(amount)
FROM orders
GROUP BY status;
-- 可能使用松散索引扫描，效率高
```

---

## 常见 GROUP BY 优化案例

### 案例一：用户订单统计

```sql
-- 查询每个用户的订单数
SELECT user_id, COUNT(*) AS order_count
FROM orders
GROUP BY user_id;

-- 优化：确保 user_id 有索引
CREATE INDEX idx_user_id ON orders(user_id);
```

### 案例二：多字段分组统计

```sql
-- 按状态和月份分组
SELECT status, DATE_FORMAT(created_at, '%Y-%m') AS month,
       COUNT(*), SUM(amount)
FROM orders
GROUP BY status, month;

-- 索引
CREATE INDEX idx_status_month ON orders(status, created_at);

-- EXPLAIN 分析
EXPLAIN SELECT status, DATE_FORMAT(created_at, '%Y-%m') AS month,
       COUNT(*), SUM(amount)
FROM orders
GROUP BY status, month;
```

### 案例三：DISTINCT 替代 GROUP BY

```sql
-- GROUP BY 写法
SELECT status, COUNT(DISTINCT user_id) AS user_count
FROM orders
GROUP BY status;

-- EXPLAIN：会使用临时表

-- 如果只需要去重计数，考虑其他方式
SELECT COUNT(DISTINCT user_id) FROM orders WHERE status = 'pending';
```

---

## 近似 GROUP BY

如果不需要精确值，可以使用近似计算。

```sql
-- 精确统计
SELECT status, COUNT(*) FROM orders GROUP BY status;
-- 耗时 10 秒

-- 近似统计：利用索引
SELECT status, COUNT(*) FROM orders USE INDEX(idx_status) GROUP BY status;
-- 可能有微小误差，但快很多
```

---

## Java 代码实现

```java
@Service
public class GroupByOptimizer {

    /**
     * 检查 GROUP BY 查询是否需要优化
     */
    public GroupByAnalysis analyze(String sql) {
        GroupByAnalysis analysis = new GroupByAnalysis();

        // 1. 解析 GROUP BY 字段
        List&lt;String&gt; groupByFields = parseGroupBy(sql);

        // 2. 检查是否有对应索引
        for (String field : groupByFields) {
            boolean hasIndex = checkIndex(field);
            if (!hasIndex) {
                analysis.addWarning("字段 " + field + " 没有索引");
            }
        }

        // 3. 检查 ORDER BY 是否和 GROUP BY 一致
        List&lt;String&gt; orderByFields = parseOrderBy(sql);
        if (!groupByFields.equals(orderByFields)) {
            analysis.addWarning("GROUP BY 和 ORDER BY 不一致，可能产生 filesort");
        }

        return analysis;
    }

    /**
     * 生成优化建议
     */
    public List&lt;String&gt; suggestIndexes(List&lt;String&gt; groupByFields) {
        // 生成联合索引建议
        String indexSql = String.format(
            "CREATE INDEX idx_%s ON orders(%s)",
            String.join("_", groupByFields),
            String.join(", ", groupByFields)
        );
        return Collections.singletonList(indexSql);
    }
}
```

---

## 面试追问方向

- GROUP BY 的执行过程是什么？
- GROUP BY 和 DISTINCT 有什么区别？
- 如何优化大表的 GROUP BY 查询？

> GROUP BY 先扫描数据，再分组统计；DISTINCT 是去重，本质上也是一种分组（每组只返回一条）。对于大表的 GROUP BY，索引是关键。
