# 分页优化：告别深度分页的噩梦

你一定见过这种 SQL：

```sql
SELECT * FROM orders ORDER BY id LIMIT 1000000, 100;
```

这条 SQL 查的是第 10000 页，每页 100 条。

你知道它有多慢吗？

扫描 100 万行，只返回 100 行。

**深度分页是 SQL 优化的经典难题。**

---

## 深度分页的问题

### 性能分析

```sql
EXPLAIN SELECT * FROM orders ORDER BY id LIMIT 1000000, 100;
```

```
+----+-------------+--------+------------+------+---------------+------+---------+------+--------+----------+------------------+
| id | select_type| table  | type | key  | key_len       | ref | rows    | Extra                        |
+----+-------------+--------+------------+------+---------------+------+---------+------+--------+----------+------------------+
|  1 | SIMPLE     | orders | ALL  | NULL | NULL          | NULL| 1500000 | Using filesort              |
+----+-------------+--------+------------+------+---------------+------+---------------+------+--------+----------+------------------+
```

- `type=ALL`：全表扫描
- `rows=1500000`：扫描了 150 万行
- `Using filesort`：需要排序

### 问题原因

MySQL 的 LIMIT m, n 工作原理：
1. 先扫描前 m+n 行
2. 丢弃前 m 行
3. 返回后面 n 行

如果 m=1000000，MySQL 要扫描 1000100 行才能返回结果。

---

## 解决方案一：游标分页（推荐）

使用上一页的最后一条记录的 ID 作为游标。

```sql
-- 第一页
SELECT * FROM orders ORDER BY id LIMIT 100;
-- 返回 id = 1 ~ 100

-- 第二页（使用上一页最后的 id）
SELECT * FROM orders
WHERE id > 100
ORDER BY id
LIMIT 100;
-- 直接从 id=101 开始，只扫描 100 行
```

### Java 代码实现

```java
public class CursorPager {

    /**
     * 游标分页查询
     * @param lastId 上一页最后一条记录的 ID（null 表示第一页）
     * @param pageSize 每页大小
     * @return 分页结果
     */
    public Page&lt;Order&gt; cursorPage(Long lastId, int pageSize) {
        List&lt;Order&gt; orders;

        if (lastId == null) {
            // 第一页
            orders = orderMapper.selectPage(null, pageSize);
        } else {
            // 游标分页：id > lastId
            orders = orderMapper.selectAfterId(lastId, pageSize);
        }

        // 计算下一页的游标
        Long nextCursor = null;
        if (orders.size() == pageSize) {
            nextCursor = orders.get(orders.size() - 1).getId();
        }

        return new Page<>(orders, nextCursor);
    }
}

@Mapper
public interface OrderMapper {
    @Select("SELECT * FROM orders ORDER BY id LIMIT #{limit}")
    List&lt;Order&gt; selectPage(@Param("limit") int limit);

    @Select("SELECT * FROM orders WHERE id > #{lastId} ORDER BY id LIMIT #{limit}")
    List&lt;Order&gt; selectAfterId(@Param("lastId") Long lastId, @Param("limit") int limit);
}
```

### 游标分页的优缺点

| 优点 | 缺点 |
|------|------|
| 性能稳定，不随页码增加而变慢 | 不能跳转到任意页 |
| 只扫描需要的行数 | 用户体验略有不同 |
| 适合移动端下拉刷新 | 不支持「跳到第 10 页」 |

---

## 解决方案二：延迟关联

先查询 ID，再根据 ID 查询完整数据。

```sql
-- 原始写法（慢）
SELECT * FROM orders ORDER BY id LIMIT 1000000, 100;

-- 延迟关联（快）
SELECT o.*
FROM orders o
INNER JOIN (
    SELECT id FROM orders ORDER BY id LIMIT 1000000, 100
) t ON o.id = t.id;
```

**原理**：
- 内层只查主键，不回表
- 外层用主键 JOIN，利用主键索引

### 性能对比

```sql
EXPLAIN SELECT o.*
FROM orders o
INNER JOIN (
    SELECT id FROM orders ORDER BY id LIMIT 1000000, 100
) t ON o.id = t.id;
```

```
+----+-------------+------------+-------+---------------+---------+---------+--------+----------+------------------+
| id | select_type| table      | type  | key           | key_len | ref     | rows   | Extra    |                  |
+----+-------------+------------+-------+---------------+---------+---------+--------+----------+------------------+
|  1 | PRIMARY    | o          | range | PRIMARY       | 8       | t.id    | 100    |          |                  |
|  1 | PRIMARY    | <derived2> | ALL   | NULL          | NULL    | NULL    | 100    |          | Using index     |
|  2 | DERIVED    | orders     | index | PRIMARY       | 8       | NULL    | 100    |          |                  |
+----+-------------+------------+-------+---------------+---------+---------+--------+----------+------------------+
```

`type=range`：使用主键范围查找，`rows=100`：只扫描 100 行。

---

## 解决方案三：记录总数优化

如果不需要精确总数，可以用估算。

```sql
-- 精确总数（慢）
SELECT COUNT(*) FROM orders WHERE status = 'pending';
-- 需要全表扫描

-- 估算总数（快）
SHOW TABLE STATUS LIKE 'orders';
-- Rows: 1500000（估算值）
```

或者只显示「有更多」：

```sql
-- 只查多一条，判断是否有下一页
SELECT * FROM orders ORDER BY id LIMIT 1000000, 101;
-- 如果返回 101 条，说明还有下一页
```

---

## 解决方案四：倒序分页

如果按时间倒序，可以优化为正序。

```sql
-- 原始：按时间倒序，深层分页（慢）
SELECT * FROM orders
WHERE created_at < '2024-01-01'
ORDER BY created_at DESC
LIMIT 1000000, 100;

-- 优化：按时间正序，利用主键
SELECT * FROM orders
WHERE created_at > '2024-01-01'
ORDER BY created_at ASC
LIMIT 100;

-- 如果需要「跳页」：
SELECT * FROM orders
WHERE (created_at, id) > (SELECT created_at, id FROM orders ORDER BY created_at, id LIMIT 1000000, 1)
ORDER BY created_at, id
LIMIT 100;
```

---

## 最佳实践总结

| 场景 | 推荐方案 |
|------|----------|
| 移动端下拉刷新 | 游标分页 |
| PC 端列表翻页 | 延迟关联 |
| 需要跳页 | 记录总数 + 延迟关联 |
| 海量数据导出 | 游标 + 批处理 |

---

## Java 代码：统一分页工具

```java
public class Pager<T> {
    private List<T> data;
    private boolean hasMore;
    private Long nextCursor;

    public static <T> Pager<T> of(List<T> data, int pageSize) {
        Pager<T> pager = new Pager<>();
        pager.setData(data);
        pager.setHasMore(data.size() > pageSize);
        if (data.size() > pageSize) {
            pager.setData(data.subList(0, pageSize));
        }
        return pager;
    }

    public static <T> Pager<T> ofCursor(List<T> data, Long nextCursor) {
        Pager<T> pager = new Pager<>();
        pager.setData(data);
        pager.setNextCursor(nextCursor);
        return pager;
    }
}
```

---

## 面试追问方向

- LIMIT 1000000, 100 为什么慢？
- 游标分页和传统分页的区别？
- 延迟关联的原理是什么？

> 游标分页适合不需要跳页的场景，性能稳定；传统分页适合需要跳页的场景，但深度分页时性能差。延迟关联让内层只查主键，外层根据主键回表，减少回表次数。
