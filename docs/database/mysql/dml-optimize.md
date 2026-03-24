# DML 优化：INSERT、UPDATE、DELETE 的性能提升

很多人只关注 SELECT 的性能，却忽略了 DML（INSERT、UPDATE、DELETE）的优化。

其实 DML 同样重要——批量插入 100 万条数据，你是等 5 分钟还是 30 秒，差别巨大。

---

## INSERT 优化

### 批量插入

```sql
-- 逐条插入（慢）
INSERT INTO orders (order_no, amount) VALUES ('A001', 100);
INSERT INTO orders (order_no, amount) VALUES ('A002', 200);
INSERT INTO orders (order_no, amount) VALUES ('A003', 300);

-- 批量插入（快）
INSERT INTO orders (order_no, amount) VALUES
('A001', 100),
('A002', 200),
('A003', 300);
```

**原理**：一条 INSERT 语句比多条独立的 INSERT 快得多，因为：
- 减少了网络往返次数
- 减少了事务提交次数
- 索引只维护一次

### 批量插入的性能对比

| 方式 | 1 万条记录耗时 |
|------|---------------|
| 逐条 INSERT | ~10 秒 |
| 500 条一批 | ~2 秒 |
| 1000 条一批 | ~1 秒 |
| 事务 + 批量 | ~0.5 秒 |

### Java 代码批量插入

```java
@Service
public class OrderBatchInsert {
    private final OrderMapper orderMapper;

    /**
     * 批量插入订单
     */
    public int batchInsert(List&lt;Order&gt; orders) {
        // MyBatis-Plus 的批量插入
        return orderMapper.insertBatch(orders, 500);  // 每批 500 条
    }
}

@Mapper
public interface OrderMapper {
    @Insert("<script>" +
        "INSERT INTO orders (order_no, amount, user_id, created_at) VALUES " +
        "<foreach collection='orders' item='o' separator=','>" +
        "(#{o.orderNo}, #{o.amount}, #{o.userId}, #{o.createdAt})" +
        "</foreach>" +
        "</script>")
    int insertBatch(@Param("orders") List&lt;Order&gt; orders);
}
```

### 关闭自动提交

```sql
-- 默认每条 INSERT 自动提交
-- 批量插入时，先关闭自动提交，最后手动提交
SET autocommit = 0;
INSERT INTO orders ...;  -- 批量插入
INSERT INTO orders ...;
COMMIT;
SET autocommit = 1;
```

### LOAD DATA INFILE

这是最快的导入方式。

```sql
-- 导出数据到文件
SELECT * FROM orders INTO OUTFILE '/tmp/orders.csv';

-- 从文件导入（比 INSERT 快 10-20 倍）
LOAD DATA INFILE '/tmp/orders.csv'
INTO TABLE orders
FIELDS TERMINATED BY ','
LINES TERMINATED BY '\n';
```

### 禁用索引和约束

导入大量数据前，可以先禁用索引。

```sql
-- 禁用唯一检查
SET unique_checks = 0;
-- 禁用外键检查
SET foreign_key_checks = 0;

-- 导入数据
LOAD DATA INFILE '/tmp/orders.csv' INTO TABLE orders;

-- 重新启用
SET unique_checks = 1;
SET foreign_key_checks = 1;
```

---

## UPDATE 优化

### 批量更新

```sql
-- 逐条更新（慢）
UPDATE orders SET status = 'paid' WHERE id = 1;
UPDATE orders SET status = 'paid' WHERE id = 2;
UPDATE orders SET status = 'paid' WHERE id = 3;

-- 批量更新（快）
UPDATE orders SET status = 'paid' WHERE id IN (1, 2, 3);
```

### CASE WHEN 批量更新

```sql
-- 根据不同条件更新不同值
UPDATE orders
SET amount = CASE
    WHEN status = 'pending' THEN amount * 0.9
    WHEN status = 'paid' THEN amount
    ELSE amount * 0.8
END,
status = CASE
    WHEN amount > 1000 THEN 'vip'
    ELSE status
END
WHERE created_at > '2024-01-01';
```

### 减少锁竞争

```java
// 错误：长事务
@Transactional
public void batchUpdate() {
    List&lt;Order&gt; orders = orderMapper.selectAll();
    for (Order o : orders) {
        o.setStatus("paid");
        orderMapper.updateById(o);  // 每次都加锁解锁
    }
}

// 正确：分批小事务
public void batchUpdateOptimized() {
    int offset = 0;
    int batchSize = 1000;

    while (true) {
        orderMapper.updateBatchStatus(offset, batchSize);
        offset += batchSize;
        if (offset >= totalCount) break;
    }
}

@Mapper
public interface OrderMapper {
    @Update("UPDATE orders SET status = 'paid' " +
            "WHERE id BETWEEN #{offset} AND #{offset} + #{batchSize} - 1")
    int updateBatchStatus(@Param("offset") int offset, @Param("batchSize") int batchSize);
}
```

---

## DELETE 优化

### 批量删除

```sql
-- 逐条删除（慢，且产生大量事务日志）
DELETE FROM orders WHERE id = 1;
DELETE FROM orders WHERE id = 2;
DELETE FROM orders WHERE id = 3;

-- 批量删除（快）
DELETE FROM orders WHERE id IN (1, 2, 3);

-- 范围删除
DELETE FROM orders WHERE id BETWEEN 1000 AND 2000;
```

### 分批删除大表数据

删除大表数据时，不要一次性删除太多。

```sql
-- 一次删除太多会锁很久，影响其他事务
DELETE FROM orders WHERE created_at < '2023-01-01';  -- 可能删除 1000 万条，锁很久

-- 分批删除
DELETE FROM orders WHERE id BETWEEN 1 AND 1000;
DELETE FROM orders WHERE id BETWEEN 1001 AND 2000;
-- 配合 LIMIT，每批删除 1000 条
```

### 先标记再删除

```sql
-- 添加删除标记字段
ALTER TABLE orders ADD COLUMN deleted TINYINT DEFAULT 0;

-- 查询时过滤
SELECT * FROM orders WHERE deleted = 0;

-- 定期清理（低峰期执行）
DELETE FROM orders WHERE deleted = 1 LIMIT 1000;
```

### 重建表（慎用）

```sql
-- 如果表数据大部分都要删除，可以重建表
ALTER TABLE orders ENGINE = InnoDB;  -- 重建表，释放空间
OPTIMIZE TABLE orders;  -- 优化表
```

---

## DML 优化 checklist

| 操作 | 优化方法 |
|------|----------|
| INSERT 大量数据 | 批量插入、关闭索引、LOAD DATA |
| UPDATE 大量数据 | 批量更新、分批小事务 |
| DELETE 大量数据 | 分批删除、标记删除、重建表 |
| 任何 DML | 避开高峰期、减少事务大小 |

---

## Java 代码工具类

```java
@Service
public class DmlOptimizer {

    /**
     * 分批执行 DELETE
     */
    public int batchDelete(String table, String whereClause, int batchSize) {
        int totalDeleted = 0;
        while (true) {
            String sql = String.format(
                "DELETE FROM %s WHERE %s LIMIT %d",
                table, whereClause, batchSize
            );
            int deleted = jdbcTemplate.update(sql);
            totalDeleted += deleted;
            if (deleted < batchSize) break;
        }
        return totalDeleted;
    }

    /**
     * 分批执行 UPDATE
     */
    public void batchUpdate(String table, Map&lt;String, Object&gt; values,
                           String whereClause, int batchSize) {
        String setClause = values.entrySet().stream()
            .map(e -> e.getKey() + " = :" + e.getKey())
            .collect(Collectors.joining(", "));

        String sql = String.format("UPDATE %s SET %s WHERE %s",
            table, setClause, whereClause + " LIMIT " + batchSize);

        SqlParameterSource params = new MapSqlParameterSource(values);
        jdbcTemplate.update(sql, params);
    }
}
```

---

## 一句话总结

DML 优化的核心是：**批量操作、事务控制、避开高峰**。INSERT 用批量和 LOAD DATA，UPDATE 用 IN 和 CASE WHEN，DELETE 用分批和标记删除。
