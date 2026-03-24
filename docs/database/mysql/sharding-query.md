# 分库分表查询：跨分片操作的解决方案

分库分表后，最头疼的问题来了：**跨分片查询**。

本来一条 SQL 能搞定的事，现在要查多个库、多张表，再合并结果。

今天，我们来解决这个问题。

---

## 跨分片查询的挑战

### 场景一：分页查询

```sql
-- 原始需求：查询第 100 页，每页 20 条
-- 分成 4 个分片

-- 错误做法：每个分片都查
SELECT * FROM orders LIMIT 100, 20  -- 每个分片查 120 条
-- 合并后再取第 100 页？逻辑复杂

-- 正确做法：限制每个分片的返回量
-- 如果能接受每页显示部分分片的数据
SELECT * FROM orders LIMIT 25  -- 每个分片只查 25 条
-- 合并后最多 100 条，取前 20 条
```

### 场景二：聚合查询

```sql
-- 原始需求：统计订单总数
-- 分成 4 个分片

-- 正确做法：各分片分别统计，汇总
分片 0: SELECT COUNT(*) FROM orders_0  → 25
分片 1: SELECT COUNT(*) FROM orders_1  → 30
分片 2: SELECT COUNT(*) FROM orders_2  → 28
分片 3: SELECT COUNT(*) FROM orders_3  → 27
总计: 25 + 30 + 28 + 27 = 110
```

### 场景三：JOIN 查询

```sql
-- 分片键不同，无法跨分片 JOIN
-- orders 表按 user_id 分片
-- products 表按 product_id 分片

-- SELECT o.*, p.name FROM orders o
-- JOIN products p ON o.product_id = p.id
-- WHERE o.user_id = 1

-- 解决方案：应用层分步查询
List&lt;Order&gt; orders = queryOrdersByUserId(userId);
List&lt;Long&gt; productIds = orders.stream().map(Order::getProductId).collect(toList());
List&lt;Product&gt; products = queryProductsByIds(productIds);
// 应用层 JOIN
```

---

## 跨分片查询策略

### 策略一：路由到单分片

这是最理想的情况，查询能直接路由到单个分片。

```java
public class SingleShardQuery {
    /**
     * 按分片键查询，直接路由到单个分片
     */
    public List&lt;Order&gt; queryByUserId(long userId) {
        // 根据 user_id 计算分片
        int shardIndex = (int) (userId % SHARD_COUNT);
        DataSource ds = getDataSource(shardIndex);
        String tableName = getTableName("orders", shardIndex);

        String sql = String.format("SELECT * FROM %s WHERE user_id = ?", tableName);
        return jdbcTemplate.query(sql, userId);
    }
}
```

### 策略二：广播查询

需要查询所有分片，然后合并结果。

```java
public class BroadcastQuery {
    /**
     * 查询所有分片，合并结果
     */
    public List&lt;Order&gt; queryAll() {
        List&lt;Order&gt; allOrders = new ArrayList&lt;&gt;();

        for (int i = 0; i < SHARD_COUNT; i++) {
            DataSource ds = getDataSource(i);
            String tableName = getTableName("orders", i);
            String sql = String.format("SELECT * FROM %s", tableName);

            List&lt;Order&gt; orders = jdbcTemplate.query(sql);
            allOrders.addAll(orders);
        }

        return allOrders;
    }

    /**
     * COUNT 查询
     */
    public long countAll() {
        long total = 0;
        for (int i = 0; i < SHARD_COUNT; i++) {
            String sql = String.format("SELECT COUNT(*) FROM orders_%d", i);
            long count = jdbcTemplate.queryForObject(sql, Long.class);
            total += count;
        }
        return total;
    }
}
```

### 策略三：聚合查询

```java
public class AggregationQuery {
    /**
     * SUM 查询
     */
    public BigDecimal sumAmount(long userId) {
        BigDecimal total = BigDecimal.ZERO;

        for (int i = 0; i < SHARD_COUNT; i++) {
            String sql = String.format(
                "SELECT SUM(amount) FROM orders_%d WHERE user_id = ?", i);
            BigDecimal sum = jdbcTemplate.queryForObject(sql, BigDecimal.class, userId);
            if (sum != null) {
                total = total.add(sum);
            }
        }

        return total;
    }

    /**
     * GROUP BY 查询
     */
    public Map&lt;String, Long&gt; groupByStatus() {
        Map&lt;String, Long&gt; result = new HashMap&lt;&gt;();

        for (int i = 0; i < SHARD_COUNT; i++) {
            String sql = String.format(
                "SELECT status, COUNT(*) FROM orders_%d GROUP BY status", i);
            List&lt;Map&lt;String, Object&gt;&gt; rows = jdbcTemplate.queryForList(sql);

            for (Map&lt;String, Object&gt; row : rows) {
                String status = (String) row.get("status");
                Long count = (Long) row.get("COUNT(*)");
                result.merge(status, count, Long::sum);
            }
        }

        return result;
    }
}
```

---

## 分页查询实现

### 方案一：深度分页限制

```java
public class PaginationQuery {
    /**
     * 分页查询（深度分页有限制）
     */
    public Page&lt;Order&gt; paginate(int pageNum, int pageSize) {
        // 限制最大页码，避免性能问题
        if (pageNum > MAX_PAGE) {
            throw new IllegalArgumentException("页码不能超过 " + MAX_PAGE);
        }

        List&lt;Order&gt; allOrders = new ArrayList&lt;&gt;();
        for (int i = 0; i < SHARD_COUNT; i++) {
            String sql = String.format(
                "SELECT * FROM orders_%d ORDER BY id LIMIT ?",
                i, pageSize * MAX_SHARD
            );
            List&lt;Order&gt; orders = jdbcTemplate.query(sql);
            allOrders.addAll(orders);
        }

        // 排序
        allOrders.sort(Comparator.comparing(Order::getId));

        // 分页
        int offset = (pageNum - 1) * pageSize;
        List&lt;Order&gt; pageOrders = allOrders.stream()
            .skip(offset)
            .limit(pageSize)
            .collect(Collectors.toList());

        return new Page<>(pageOrders, pageNum, pageSize);
    }
}
```

### 方案二：游标分页（推荐）

```java
public class CursorPagination {
    /**
     * 游标分页查询
     */
    public CursorPage&lt;Order&gt; cursorPage(Long lastId, int pageSize) {
        List&lt;Order&gt; allOrders = new ArrayList&lt;&gt;();

        for (int i = 0; i < SHARD_COUNT; i++) {
            String sql;
            if (lastId == null) {
                sql = String.format(
                    "SELECT * FROM orders_%d ORDER BY id LIMIT ?", i, pageSize);
            } else {
                sql = String.format(
                    "SELECT * FROM orders_%d WHERE id > ? ORDER BY id LIMIT ?",
                    i, lastId, pageSize);
            }
            List&lt;Order&gt; orders = jdbcTemplate.query(sql, lastId == null ? pageSize : lastId, pageSize);
            allOrders.addAll(orders);
        }

        // 全局排序
        allOrders.sort(Comparator.comparing(Order::getId));

        // 取一页数据
        List&lt;Order&gt; pageOrders = allOrders.stream()
            .limit(pageSize)
            .collect(Collectors.toList());

        // 计算下一页游标
        Long nextCursor = null;
        if (pageOrders.size() == pageSize) {
            nextCursor = pageOrders.get(pageOrders.size() - 1).getId();
        }

        return new CursorPage<>(pageOrders, nextCursor);
    }
}
```

---

## 跨分片 JOIN 实现

### 异构查询

两个表分片键不同，需要在应用层关联。

```java
public class CrossShardJoin {
    /**
     * 查询用户订单及其商品信息（异构分片）
     */
    public List&lt;OrderDetail&gt; queryOrderDetails(long userId) {
        // 1. 查询用户的订单
        List&lt;Order&gt; orders = queryOrdersByUserId(userId);

        // 2. 收集商品 ID
        List&lt;Long&gt; productIds = orders.stream()
            .map(Order::getProductId)
            .distinct()
            .collect(Collectors.toList());

        // 3. 查询商品信息（按 product_id 计算分片）
        Map&lt;Long, Product&gt; productMap = queryProductsByIds(productIds);

        // 4. 应用层 JOIN
        return orders.stream()
            .map(order -> {
                OrderDetail detail = new OrderDetail();
                detail.setOrder(order);
                detail.setProduct(productMap.get(order.getProductId()));
                return detail;
            })
            .collect(Collectors.toList());
    }

    /**
     * 按 product_id 查询商品（不同分片键）
     */
    private Map&lt;Long, Product&gt; queryProductsByIds(List&lt;Long&gt; productIds) {
        Map&lt;Long, Product&gt; result = new HashMap&lt;&gt;();

        // 按 product_id % 4 计算分片
        Map&lt;Integer, List&lt;Long&gt;&gt; groupedIds = productIds.stream()
            .collect(Collectors.groupingBy(id -> (int) (id % SHARD_COUNT)));

        for (Map.Entry&lt;Integer, List&lt;Long&gt;&gt; entry : groupedIds.entrySet()) {
            int shardIndex = entry.getKey();
            List&lt;Long&gt; ids = entry.getValue();

            String sql = String.format(
                "SELECT * FROM products_%d WHERE id IN (%s)",
                shardIndex, ids.stream().map(String::valueOf).collect(Collectors.joining(",")));
            List&lt;Product&gt; products = jdbcTemplate.query(sql);
            products.forEach(p -> result.put(p.getId(), p));
        }

        return result;
    }
}
```

---

## 最佳实践

| 场景 | 解决方案 |
|------|----------|
| 按分片键查询 | 路由到单个分片 |
| 全表查询 | 广播查询 + 合并 |
| COUNT/SUM 查询 | 各分片聚合 + 汇总 |
| 分页查询 | 限制页码深度 或 游标分页 |
| 异构分片 JOIN | 应用层关联 |

---

## 一句话总结

跨分片查询的核心是：**能路由到单分片就路由，不能就广播查询再合并**。聚合查询各分片分别计算最后汇总，分页用游标替代深度页码。
