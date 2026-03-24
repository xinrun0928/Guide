# COUNT(*) 优化与飞龙表处理

用户问：「你们系统有多少用户？」

 你跑了一条 SQL：

```sql
SELECT COUNT(*) FROM users;
```

 10 秒后，返回结果。

 一个简单的 COUNT(*) 为什么会这么慢？今天彻底搞懂它。

---

## COUNT(*) 为什么不走索引？

### MySQL 执行 COUNT(*) 的原理

```sql
EXPLAIN SELECT COUNT(*) FROM orders;
```

```
+----+-------------+-------+------+------+
| id | select_type| table | type | rows |
+----+-------------+-------+------+------+
|  1 | SIMPLE      | orders| index| idx_id |  -- 使用主键索引
|    |             |       |      | 5000000|
+----+-------------+-------+------+------+
```

> MySQL 使用最小的索引扫描，避免回表。

### 为什么不用其他索引？

```sql
-- idx_user_id 是联合索引 (user_id, status)
EXPLAIN SELECT COUNT(*) FROM orders WHERE user_id = 100;
```

```
type: ref
key: idx_user_id
```

MySQL 会选择能最快完成的路径：
- `COUNT(*)`：扫描最小索引（通常是主键）
- `COUNT(column)`：扫描该列的索引
- `COUNT(*) WHERE` 有条件：扫描最合适的索引

---

## InnoDB 与 MyISAM 的区别

### MyISAM 的优化

```sql
-- MyISAM 会缓存总行数，COUNT(*) 是 O(1)
SELECT COUNT(*) FROM myisam_table;  -- 瞬间返回
```

> MyISAM 把总行数存在元数据中，但仅限于没有 WHERE 条件的情况。

### InnoDB 为什么不缓存？

```sql
-- InnoDB 支持事务，同一时间点各事务看到的行数不同
-- 事务 A 插入 100 行
-- 事务 B 插入 200 行
-- 事务 A 的 COUNT(*) 是多少？不确定！
```

> MVCC 导致 InnoDB 无法缓存精确行数。

---

## COUNT(*) 优化方案

### 方案一：使用辅助索引

```sql
-- 主键索引 vs 辅助索引
EXPLAIN SELECT COUNT(*) FROM orders;  -- 扫描主键
EXPLAIN SELECT COUNT(*) FROM orders;   -- 扫描 idx_status（如果更小）

-- 添加一个小的辅助索引用于 COUNT
CREATE INDEX idx_status ON orders(status);

-- 查询改为
SELECT COUNT(*) FROM orders WHERE status = 'active';
```

### 方案二：分区表优化

```sql
-- 创建按月分区的表
CREATE TABLE orders (
    id BIGINT,
    user_id BIGINT,
    create_time DATETIME
) PARTITION BY RANGE (YEAR(create_time) * 100 + MONTH(create_time)) (
    PARTITION p202401 VALUES LESS THAN (202402),
    PARTITION p202402 VALUES LESS THAN (202403),
    PARTITION p202403 VALUES LESS THAN (202404),
    PARTITION pmax VALUES LESS THAN MAXVALUE
);

-- 统计指定月份
SELECT COUNT(*) FROM orders PARTITION (p202401);
```

### 方案三：缓存计数结果

```java
@Service
public class OrderService {
    
    @Autowired
    private RedisTemplate&lt;String, String&gt; redis;
    
    public long getOrderCount() {
        String count = redis.opsForValue().get("order:count");
        if (count != null) {
            return Long.parseLong(count);
        }
        
        Long actualCount = orderMapper.selectCount(null);
        redis.opsForValue().set("order:count", String.valueOf(actualCount));
        return actualCount;
    }
    
    // 异步更新计数
    @Async
    public void updateCountCache() {
        Long count = orderMapper.selectCount(null);
        redis.opsForValue().set("order:count", String.valueOf(count));
    }
}
```

### 方案四：近似计数

```sql
-- 快速估算（误差 1-2%）
SHOW TABLE STATUS LIKE 'orders';
-- Rows: 5000000（估算值）
```

> 适合大数据量下快速获取近似值。

---

## 飞龙表（MySQL 日志表）处理

飞龙表（Flying Dragon Table）是一种经典的设计模式：

```
每天一张新表：orders_20240115, orders_20240116, ...
每月一张归档表：orders_archive_202401
```

### 适用场景

- 历史数据量大，但访问频率低
- 需要长期保存但不需要实时查询
- 写入压力大，需要分表减负

### 创建飞龙表

```sql
-- 按天分表
CREATE TABLE orders_20240115 LIKE orders;
CREATE TABLE orders_20240116 LIKE orders;
CREATE TABLE orders_20240117 LIKE orders;

-- 添加定时任务（每天凌晨 2 点执行）
-- cron: 0 2 * * *
CREATE EVENT create_daily_order_table
ON SCHEDULE EVERY 1 DAY
STARTS DATE_ADD(CURDATE(), INTERVAL 2 HOUR)
DO
BEGIN
    SET @table_name = CONCAT('orders_', DATE_FORMAT(CURDATE(), '%Y%m%d'));
    SET @sql = CONCAT('CREATE TABLE ', @table_name, ' LIKE orders');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
END;
```

### 查询跨表数据

```sql
-- 低效：UNION ALL 逐表查询
SELECT COUNT(*) FROM orders_20240115
UNION ALL
SELECT COUNT(*) FROM orders_20240116
UNION ALL
SELECT COUNT(*) FROM orders_20240117;

-- 高效：使用 UNION VIEW
CREATE VIEW orders_recent AS
SELECT * FROM orders_20240115
UNION ALL
SELECT * FROM orders_20240116
UNION ALL
SELECT * FROM orders_20240117;

SELECT COUNT(*) FROM orders_recent;
```

### 定时归档脚本

```java
@Service
public class OrderArchivalService {
    
    @Autowired
    private JdbcTemplate jdbcTemplate;
    
    /**
     * 将 90 天前的数据归档到月表
     */
    public void archiveOldOrders() {
        LocalDate archiveDate = LocalDate.now().minusDays(90);
        String monthTable = "orders_archive_" + 
            archiveDate.format(DateTimeFormatter.ofPattern("yyyyMM"));
        
        // 1. 创建月归档表（如果不存在）
        createArchiveTableIfNotExists(monthTable);
        
        // 2. 迁移数据
        String insertSql = String.format(
            "INSERT IGNORE INTO %s " +
            "SELECT * FROM orders WHERE create_time &lt; ?",
            monthTable);
        jdbcTemplate.update(insertSql, 
            archiveDate.atStartOfDay());
        
        // 3. 删除原表数据
        String deleteSql = 
            "DELETE FROM orders WHERE create_time &lt; ?";
        jdbcTemplate.update(deleteSql, 
            archiveDate.atStartOfDay());
        
        // 4. 记录归档日志
        log.info("归档完成：日期={}, 表={}", archiveDate, monthTable);
    }
    
    private void createArchiveTableIfNotExists(String tableName) {
        String sql = String.format(
            "CREATE TABLE IF NOT EXISTS %s LIKE orders", tableName);
        jdbcTemplate.execute(sql);
    }
}
```

---

## COUNT 语义的区别

MySQL 提供了多种 COUNT 函数，它们的性能不同：

| 语义 | 执行逻辑 | 性能 |
|---|---|---|
| `COUNT(*)` | 统计行数，包含 NULL | 最快（优化过） |
| `COUNT(1)` | 统计表达式 1 的结果 | 几乎同 COUNT(*) |
| `COUNT(id)` | 统计非 NULL 的 id | 略慢（需要判断） |
| `COUNT(column)` | 统计非 NULL 的列值 | 取决于列索引 |

### 常见误解

```sql
-- 错误：COUNT(*) 不包括 NULL
-- 实际上 COUNT(*) 统计所有行

-- 正确理解：
-- COUNT(*) 直接统计行数，不关心列值
-- COUNT(column) 统计非 NULL 的列值

-- 示例：
SELECT COUNT(*), COUNT(1), COUNT(name), COUNT(NULL)
FROM (SELECT NULL as name UNION SELECT '张三' UNION SELECT NULL) t;

-- 结果：
-- COUNT(*): 3        -- 总行数
-- COUNT(1): 3        -- 表达式始终非 NULL
-- COUNT(name): 1     -- 只有'张三'不是 NULL
-- COUNT(NULL): 0     -- NULL 不被计数
```

---

## 实战：优化统计报表

### 原始需求

订单统计页面需要显示：
- 今日订单数
- 本周订单数
- 本月订单数
- 累计订单数

### 低效实现

```sql
SELECT 
    (SELECT COUNT(*) FROM orders WHERE DATE(create_time) = CURDATE()) as today_count,
    (SELECT COUNT(*) FROM orders WHERE YEARWEEK(create_time) = YEARWEEK(CURDATE())) as week_count,
    (SELECT COUNT(*) FROM orders WHERE DATE_FORMAT(create_time, '%Y%m') = DATE_FORMAT(CURDATE(), '%Y%m')) as month_count,
    (SELECT COUNT(*) FROM orders) as total_count;
```

> 四次全表扫描，20 秒执行时间。

### 高效实现

```sql
-- 使用缓存 + 异步更新
SELECT 
    COALESCE(today.cnt, 0) as today_count,
    COALESCE(week.cnt, 0) as week_count,
    COALESCE(month.cnt, 0) as month_count,
    COALESCE(total.cnt, 0) as total_count
FROM (
    SELECT COUNT(*) as cnt FROM orders WHERE create_time >= CURDATE()
) today
LEFT JOIN (
    SELECT COUNT(*) as cnt FROM orders 
    WHERE create_time >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
) week ON 1=1
LEFT JOIN (
    SELECT COUNT(*) as cnt FROM orders 
    WHERE create_time >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
) month ON 1=1
LEFT JOIN (
    SELECT COUNT(*) as cnt FROM orders
) total ON 1=1;
```

### 最佳方案：预计算表

```sql
-- 创建每日统计表
CREATE TABLE order_daily_stats (
    stat_date DATE PRIMARY KEY,
    order_count BIGINT DEFAULT 0,
    order_amount DECIMAL(15, 2) DEFAULT 0,
    user_count BIGINT DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 定时任务每天凌晨更新
INSERT INTO order_daily_stats (stat_date, order_count, order_amount, user_count)
SELECT CURDATE(), COUNT(*), SUM(amount), COUNT(DISTINCT user_id)
FROM orders
WHERE DATE(create_time) = CURDATE()
ON DUPLICATE KEY UPDATE
    order_count = VALUES(order_count),
    order_amount = VALUES(order_amount),
    user_count = VALUES(user_count);

-- 查询变成 O(1)
SELECT * FROM order_daily_stats WHERE stat_date = CURDATE();
```

---

## 总结与思考

COUNT(*) 优化的核心是**减少扫描行数**：

1. 善用辅助索引（比主键索引小）
2. 分区表隔离数据范围
3. 缓存计算结果
4. 预计算统计表

> 飞龙表不是银弹，但确实是应对超大数据量的有效手段。

---

## 留给你的问题

1. COUNT(*) 和 COUNT(1) 到底有没有性能差异？MySQL 内部是如何优化它们的？

2. 飞龙表设计有什么缺点？如果订单需要按 ID 关联查询历史订单，飞龙表怎么设计更合理？

3. 假设一张表有 1 亿数据，COUNT(*) 需要 30 秒，有哪些方法可以加速到 1 秒以内？
