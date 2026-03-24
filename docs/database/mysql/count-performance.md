# COUNT(*) 性能优化：为什么你的查询这么慢？

你有没有想过这个问题：

`SELECT COUNT(*) FROM orders;`

这条 SQL 有多慢？

如果 orders 表有 1000 万条记录，这条查询可能需要几十秒。

为什么？COUNT(*) 到底是怎么执行的？

---

## COUNT(*) 的实现原理

### MyISAM 引擎

MyISAM 存储了精确的行数，直接返回，不需要扫描。

```sql
SELECT COUNT(*) FROM orders;
-- MyISAM 直接返回 metadata 中的行数，O(1)
```

### InnoDB 引擎

InnoDB 要实时计算，因为：
1. MVCC 支持多版本
2. 并发写入
3. 事务隔离

```sql
SELECT COUNT(*) FROM orders;
-- InnoDB 需要遍历索引统计行数，O(n)
```

---

## COUNT(*) vs COUNT(1) vs COUNT(字段)

| 写法 | 说明 | 性能 |
|------|------|------|
| `COUNT(*)` | 统计所有行（包括 NULL） | 最快，InnoDB 优化过 |
| `COUNT(1)` | 对每一行返回 1，统计 1 的个数 | 和 COUNT(*) 几乎一样 |
| `COUNT(字段)` | 统计非 NULL 的值 | 稍慢，需要检查 NULL |

```sql
-- 这两条性能几乎一样
SELECT COUNT(*) FROM orders;
SELECT COUNT(1) FROM orders;

-- 这条稍慢
SELECT COUNT(id) FROM orders;
-- id 可能为 NULL？不，但还是要检查
```

**结论**：用 `COUNT(*)`，InnoDB 内部会优化。

---

## COUNT(*) 慢的原因

### 原因一：需要全表扫描

```sql
EXPLAIN SELECT COUNT(*) FROM orders;
```

```
+----+-------------+-------+------------+------+---------------+------+---------+------+--------+----------+-------------+
| id | select_type| table | type       | key  | key_len       | ref | rows    | Extra                        |
+----+-------------+-------+------------+------+---------------+------+---------+------+--------+----------+-------------+
|  1 | SIMPLE     | orders| index      | PRIMARY | 8          | NULL| 1500000 | Using index                  |
+----+-------------+-------+------------+------+---------------+------+---------+------+--------+----------+-------------+
```

- `type=index`：全索引扫描
- `rows=1500000`：扫描了 150 万行

### 原因二：MVCC 的可见性判断

每个事务看到的行数可能不同，需要判断每行对当前事务是否可见。

---

## COUNT(*) 优化方案

### 方案一：使用条件 COUNT

如果只需要统计满足条件的行数，加上 WHERE 条件。

```sql
-- 统计所有订单
SELECT COUNT(*) FROM orders;  -- 慢：1500 万行

-- 统计待支付订单
SELECT COUNT(*) FROM orders WHERE status = 'pending';  -- 快一点：扫描部分行

-- 确保有索引
CREATE INDEX idx_status ON orders(status);
```

### 方案二：维护计数器表

对于频繁查询的 COUNT，可以维护一个计数器。

```sql
-- 创建计数器表
CREATE TABLE order_stats (
    stat_date DATE PRIMARY KEY,
    total_count INT DEFAULT 0,
    pending_count INT DEFAULT 0,
    paid_count INT DEFAULT 0,
    updated_at DATETIME
);

-- 更新逻辑：插入/更新/删除订单时，同时更新计数器
-- 插入：
UPDATE order_stats SET total_count = total_count + 1,
       pending_count = pending_count + 1, updated_at = NOW()
WHERE stat_date = CURDATE();

-- 查询：
SELECT total_count FROM order_stats WHERE stat_date = CURDATE();
```

### 方案三：使用缓存

```java
@Service
public class OrderService {
    @Cacheable(value = "orderCount", key = "#status")
    public long getOrderCount(String status) {
        return orderMapper.countByStatus(status);
    }

    // 计数器更新时，清除缓存
    @CacheEvict(value = "orderCount", allEntries = true)
    public void createOrder(Order order) {
        orderMapper.insert(order);
    }
}
```

### 方案四：近似 COUNT

如果不需要精确值，可以用估算。

```sql
-- InnoDB 估算
SHOW TABLE STATUS LIKE 'orders';
-- Rows: 15000000（估算值）

-- performance_schema
SELECT table_rows FROM information_schema.tables
WHERE table_schema = 'guide' AND table_name = 'orders';
```

---

## 不同 COUNT 的性能对比

| 写法 | 性能 | 说明 |
|------|------|------|
| `COUNT(*)` | 最优 | InnoDB 专门优化 |
| `COUNT(1)` | ≈ COUNT(*) | 不取值，只计数 |
| `COUNT(id)` | 稍差 | 需要判断非 NULL |
| `COUNT(字段)` | 差 | 需要检查 NULL |
| `COUNT(DISTINCT 字段)` | 最差 | 需要去重 |

---

## Java 代码实现

```java
@Service
public class OrderCounter {
    private final OrderMapper orderMapper;
    private final RedisTemplate<String, String> redisTemplate;

    /**
     * 获取订单总数（带缓存）
     */
    public long getTotalCount() {
        String cacheKey = "order:total:count";
        String cached = redisTemplate.opsForValue().get(cacheKey);

        if (cached != null) {
            return Long.parseLong(cached);
        }

        // 查数据库
        long count = orderMapper.countAll();

        // 缓存 5 分钟
        redisTemplate.opsForValue().set(cacheKey, String.valueOf(count),
            Duration.ofMinutes(5));

        return count;
    }

    /**
     * 获取各状态订单数（单次查询）
     */
    public Map&lt;String, Long&gt; getCountByStatus() {
        List&lt;StatusCount&gt; counts = orderMapper.countGroupByStatus();
        return counts.stream()
            .collect(Collectors.toMap(StatusCount::getStatus, StatusCount::getCount));
    }
}

@Mapper
public interface OrderMapper {
    @Select("SELECT COUNT(*) FROM orders")
    long countAll();

    @Select("SELECT status, COUNT(*) AS count FROM orders GROUP BY status")
    List&lt;StatusCount&gt; countGroupByStatus();
}
```

---

## 面试追问方向

- COUNT(*) 和 COUNT(1) 有什么区别？
- InnoDB 和 MyISAM 的 COUNT(*) 性能差异？
- 如何优化大表的 COUNT(*) 查询？

> MyISAM 直接返回存储的行数（O(1)），InnoDB 需要扫描统计（O(n)）。对于大表，可以维护计数器表或使用缓存。
