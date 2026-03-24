# 分库分表：突破数据库的性能天花板

你的系统用户从 100 万增长到 5000 万，单库已经扛不住了。

单表几千万条记录，即使加了索引，查询也要好几秒。

分库分表，是解决单库性能瓶颈的终极方案。

---

## 什么时候需要分库分表？

### 性能瓶颈信号

```sql
-- 单表数据量超过 1000 万
SELECT COUNT(*) FROM orders;
-- 结果：12000000

-- 查询响应时间超过 1 秒
SELECT * FROM orders WHERE user_id = 12345;
-- 耗时：2.5 秒

-- 数据库 CPU 持续 100%
```

### 分库分表的时机

| 数据量 | 单机性能 | 建议 |
|--------|----------|------|
| < 1000 万 | 好 | 单库单表 + 索引 |
| 1000-5000 万 | 中 | 单库分表 |
| 5000 万 - 1 亿 | 差 | 多库分表 |
| > 1 亿 | 很差 | 多库分表 + 读写分离 |

---

## 分库分表的方式

### 方式一：垂直分库

按业务模块拆分到不同的数据库。

```
┌─────────────────────────────────────────────────────────────┐
│                    垂直分库                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   原始库：                                                   │
│   ┌─────────────────────────────────────────────┐          │
│   │ users, orders, products, inventory, logs   │          │
│   └─────────────────────────────────────────────┘          │
│                                                             │
│   垂直分库后：                                               │
│   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐         │
│   │ 用户库       │ │ 订单库       │ │ 商品库       │         │
│   │ users       │ │ orders      │ │ products    │         │
│   │             │ │ inventory   │ │             │         │
│   └─────────────┘ └─────────────┘ └─────────────┘         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 方式二：垂直分表

按字段冷热拆分到不同的表。

```
┌─────────────────────────────────────────────────────────────┐
│                    垂直分表                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   原始表：                                                   │
│   ┌─────────────────────────────────────────────┐          │
│   │ id | name | email | phone | address | ...   │          │
│   │    │      │       │       │        │       │          │
│   │   基本信息       │   联系信息    │  其他字段  │          │
│   └─────────────────────────────────────────────┘          │
│                                                             │
│   垂直分表后：                                               │
│   ┌───────────────────┐ ┌───────────────────┐               │
│   │ users_base        │ │ users_extended   │               │
│   │ id | name | email │ │ id | phone | addr │              │
│   └───────────────────┘ └───────────────────┘               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 方式三：水平分库

按某个字段（如用户 ID）拆分到不同的库。

```
┌─────────────────────────────────────────────────────────────┐
│                    水平分库                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   原始表（orders）：                                         │
│   ┌─────────────────────────────────────────────┐          │
│   │ 1 | 1001 | 100.00 | ...                    │          │
│   │ 2 | 1002 | 200.00 | ...                    │          │
│   │ 3 | 1001 | 150.00 | ...                    │          │
│   └─────────────────────────────────────────────┘          │
│                                                             │
│   按 user_id % 2 水平分库：                                 │
│   ┌─────────────────┐         ┌─────────────────┐         │
│   │ orders_db_0      │         │ orders_db_1      │         │
│   │ user_id % 2 = 0  │         │ user_id % 2 = 1  │         │
│   │ 1, 1001 | 3, 1001│         │ 2, 1002         │         │
│   └─────────────────┘         └─────────────────┘         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 方式四：水平分表

按某个字段拆分到不同的表。

```
┌─────────────────────────────────────────────────────────────┐
│                    水平分表                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   原始表（orders）：                                         │
│   ┌─────────────────────────────────────────────┐          │
│   │ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, ...       │          │
│   └─────────────────────────────────────────────┘          │
│                                                             │
│   按 id % 4 水平分表：                                      │
│   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │
│   │orders_0 │ │orders_1 │ │orders_2 │ │orders_3 │        │
│   │id % 4=0 │ │id % 4=1 │ │id % 4=2 │ │id % 4=3 │        │
│   │1,5,9... │ │2,6,10..│ │3,7,11..│ │4,8,12..│        │
│   └─────────┘ └─────────┘ └─────────┘ └─────────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 分片键的选择

分片键（Shard Key）是决定数据如何分布的关键字段。

### 选择原则

1. **业务逻辑**：选择查询最常用的字段
2. **数据分布**：选择分布均匀的字段
3. **查询支持**：尽量支持跨分片查询

### 常见分片键

| 场景 | 分片键 | 说明 |
|------|--------|------|
| 用户中心 | user_id | 按用户 ID 分片 |
| 订单系统 | user_id | 按用户分片，查询用户订单方便 |
| 电商系统 | merchant_id | 按商家分片 |
| 时间序列 | 时间字段 | 按时间分片，适合日志系统 |

---

## 分片策略

### 策略一：取模分片

```sql
shard_key = user_id % 4

-- 优点：数据分布均匀
-- 缺点：扩容困难（取模基数变化）
```

### 策略二：范围分片

```sql
-- 按 ID 范围分片
shard_key = user_id / 1000000
-- 0-999999 → db_0
-- 1000000-1999999 → db_1
```

**优点**：扩容方便
**缺点**：数据分布不均匀

### 策略三：一致性哈希

```java
// 一致性哈希环
public class ConsistentHash {
    private final TreeMap&lt;Long, String&gt; nodes = new TreeMap&lt;&gt;();

    // 添加节点
    public void addNode(String node) {
        // 虚拟节点，确保分布均匀
        for (int i = 0; i < 100; i++) {
            long hash = hash(node + ":" + i);
            nodes.put(hash, node);
        }
    }

    // 路由到节点
    public String route(String key) {
        long hash = hash(key);
        Map.Entry&lt;Long, String&gt; entry = nodes.ceilingEntry(hash);
        if (entry == null) {
            entry = nodes.firstEntry();
        }
        return entry.getValue();
    }
}
```

---

## 分库分表的挑战

### 挑战一：跨分片查询

```sql
-- 查询用户 1001 和 1002 的订单
-- 在分库分表下，需要查询多个库

-- 不好：多次查询
List&lt;Order&gt; orders0 = queryFromDb0("SELECT * FROM orders WHERE user_id IN (1001, 1002)");
List&lt;Order&gt; orders1 = queryFromDb1("SELECT * FROM orders WHERE user_id IN (1001, 1002)"));

-- 好：应用层聚合
List&lt;Order&gt; allOrders = Stream.concat(orders0.stream(), orders1.stream())
    .collect(Collectors.toList());
```

### 挑战二：分页查询

```sql
-- 分库分表下，查询第 100 页数据

-- 不好：每库都查
for (DataSource ds : allDataSources) {
    query(ds, "SELECT * FROM orders ORDER BY id LIMIT 1000 OFFSET 10000");
}

-- 好：限制返回数量
for (DataSource ds : allDataSources) {
    query(ds, "SELECT * FROM orders ORDER BY id LIMIT 100");
}
```

### 挑战三：分布式 ID

分库分表后，主键 ID 不能用自增了。

```java
// 雪花算法
public class SnowflakeIdGenerator {
    private final long twepoch = 1288834974657L;
    private final long workerIdBits = 5L;
    private final long datacenterIdBits = 5L;
    private final long maxWorkerId = ~(-1L << workerIdBits);
    private final long maxDatacenterId = ~(-1L << datacenterIdBits);

    public long nextId() {
        long timestamp = timeGen();
        // ... 雪花算法实现
    }
}
```

---

## Java 代码：分片路由

```java
@Component
public class ShardingRouter {
    private final int shardingCount = 4;

    /**
     * 获取数据源
     */
    public DataSource getDataSource(long userId) {
        int shardIndex = (int) (userId % shardingCount);
        String dsName = "ds_" + shardIndex;
        return dataSourceMap.get(dsName);
    }

    /**
     * 获取表名
     */
    public String getTableName(String tableName, long userId) {
        int shardIndex = (int) (userId % shardingCount);
        return tableName + "_" + shardIndex;
    }

    /**
     * 查询用户订单
     */
    public List&lt;Order&gt; queryOrders(long userId) {
        DataSource ds = getDataSource(userId);
        String tableName = getTableName("orders", userId);

        String sql = String.format("SELECT * FROM %s WHERE user_id = ?", tableName);
        return jdbcTemplate.query(sql, userId);
    }
}
```

---

## 一句话总结

分库分表是突破单机性能瓶颈的终极方案，但代价是复杂度大增。垂直分库按业务拆分，水平分库按数据拆分。选择分片键是关键，尽量让查询落在单个分片。
