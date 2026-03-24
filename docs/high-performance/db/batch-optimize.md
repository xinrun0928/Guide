# 批量插入与数据更新优化

导入 100 万条数据，跑了 2 小时还没完。

 DBA 发来警告：「数据库快撑不住了。」

 你知道问题在哪吗？大概率是 SQL 写法的问题。

 100 万条数据，用对了方法，10 分钟就能搞定。

---

## 单条插入 vs 批量插入

### 问题出在哪？

```sql
-- 低效：逐条插入（10 万条数据）
for (Order order : orders) {
    INSERT INTO orders (id, user_id, amount) VALUES (?, ?, ?);
}
```

MySQL 每执行一条 INSERT，都需要：

```
1. 解析 SQL（固定开销）
2. 开启事务（如果自动提交）
3. 获取表锁
4. 写入数据
5. 提交事务
6. 关闭连接

每条 1ms，10 万条 = 100 秒
```

### 批量插入的威力

```sql
-- 高效：批量插入
INSERT INTO orders (id, user_id, amount) VALUES
(1, 100, 199.00),
(2, 101, 299.00),
(3, 102, 399.00),
-- 一次插入 1000-5000 条
(1000, 199, 999.00);
```

> 批量插入将 100 次网络往返合并为 1 次，开销降低 99%。

---

## 批量插入最佳实践

### 1. 控制批量大小

```java
public void batchInsert(List&lt;Order&gt; orders) {
    int batchSize = 1000;  // 每批 1000 条
    for (int i = 0; i &lt; orders.size(); i += batchSize) {
        List&lt;Order&gt; batch = orders.subList(i, 
            Math.min(i + batchSize, orders.size()));
        orderMapper.batchInsert(batch);
    }
}
```

### 2. 使用 Multi-Values INSERT

```xml
&lt;insert id="batchInsert"&gt;
    INSERT INTO orders (id, user_id, amount, create_time) VALUES
    &lt;foreach collection="list" item="item" separator=","&gt;
        (#{item.id}, #{item.userId}, #{item.amount}, #{item.createTime})
    &lt;/foreach&gt;
&lt;/insert&gt;
```

生成 SQL：

```sql
INSERT INTO orders (id, user_id, amount, create_time) VALUES
(1, 100, 199.00, '2024-01-15 10:00:00'),
(2, 101, 299.00, '2024-01-15 10:00:01'),
...
(1000, 199, 999.00, '2024-01-15 10:16:40');
```

### 3. 关闭自动提交，手动管理事务

```java
@Service
public class OrderImportService {
    
    @Autowired
    private DataSource dataSource;
    
    public void importOrders(List&lt;Order&gt; orders) {
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);  // 关闭自动提交
            
            String sql = "INSERT INTO orders (id, user_id, amount) VALUES (?, ?, ?)";
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                for (Order order : orders) {
                    ps.setLong(1, order.getId());
                    ps.setLong(2, order.getUserId());
                    ps.setBigDecimal(3, order.getAmount());
                    ps.addBatch();  // 添加到批次
                    
                    // 每 1000 条执行一次
                    if (order.getId() % 1000 == 0) {
                        ps.executeBatch();
                        conn.commit();  // 每批提交一次
                    }
                }
                ps.executeBatch();  // 执行剩余的
                conn.commit();
            }
        } catch (SQLException e) {
            // 处理异常，回滚事务
            throw new RuntimeException("导入失败", e);
        }
    }
}
```

---

## LOAD DATA INFILE：极限性能

如果性能还不够？用 LOAD DATA INFILE。

### 原理

```
传统 INSERT：SQL 解析 → 写入 → 索引更新 → ...（逐行）
LOAD DATA：  直接读取文件 → 批量写入 → 批量索引（极快）
```

### 使用方法

**第一步：导出数据到文件**

```java
// 生成 CSV 文件
try (BufferedWriter writer = new BufferedWriter(
        new FileWriter("/tmp/orders.csv"))) {
    for (Order order : orders) {
        writer.write(String.format("%d,%d,%.2f,%s\n",
            order.getId(),
            order.getUserId(),
            order.getAmount(),
            order.getCreateTime()));
    }
}
```

**第二步：导入数据**

```sql
-- 方式一：命令行
mysql -u root -p database_name
LOAD DATA INFILE '/tmp/orders.csv'
INTO TABLE orders
FIELDS TERMINATED BY ','
LINES TERMINATED BY '\n'
(id, user_id, amount, create_time);

-- 方式二：MySQL 客户端
mysqlimport -u root -p database_name /tmp/orders.csv
--fields-terminated-by=,
--lines-terminated-by=\n
orders
```

### 性能对比

| 方法 | 10 万条 | 100 万条 |
|---|---|---|
| 单条 INSERT | 100 秒 | 1000 秒 |
| 批量 INSERT (1000/批) | 10 秒 | 100 秒 |
| LOAD DATA INFILE | 1 秒 | 10 秒 |

> LOAD DATA INFILE 比批量 INSERT 快 10-100 倍。

---

## 批量更新优化

### 低效写法

```sql
-- 逐条更新（1000 次数据库交互）
UPDATE orders SET amount = 199.00 WHERE id = 1;
UPDATE orders SET amount = 299.00 WHERE id = 2;
UPDATE orders SET amount = 399.00 WHERE id = 3;
...
```

### 高效写法一：CASE WHEN

```sql
UPDATE orders SET amount = CASE id
    WHEN 1 THEN 199.00
    WHEN 2 THEN 299.00
    WHEN 3 THEN 399.00
    ...
END
WHERE id IN (1, 2, 3, ...);
```

```java
@Update("&lt;script&gt;" +
        "UPDATE orders SET amount = CASE id " +
        "&lt;foreach collection='list' item='item'&gt;" +
        "WHEN #{item.id} THEN #{item.amount} " +
        "&lt;/foreach&gt;" +
        "END WHERE id IN " +
        "&lt;foreach collection='list' item='item' open='(' separator=',' close=')'&gt;" +
        "#{item.id}" +
        "&lt;/foreach&gt;" +
        "&lt;/script&gt;")
int batchUpdateAmount(List&lt;Order&gt; orders);
```

### 高效写法二：临时表 + JOIN

```sql
-- 创建临时表
CREATE TEMPORARY TABLE temp_amounts (
    id BIGINT PRIMARY KEY,
    amount DECIMAL(10, 2)
);

-- 批量插入数据
INSERT INTO temp_amounts (id, amount) VALUES
(1, 199.00),
(2, 299.00),
(3, 399.00);

-- 批量更新
UPDATE orders o
JOIN temp_amounts t ON o.id = t.id
SET o.amount = t.amount;

-- 删除临时表
DROP TEMPORARY TABLE temp_amounts;
```

### 高效写法三：按主键区间更新

```sql
-- 按 ID 区间批量更新，避免锁竞争
UPDATE orders SET status = 'completed' 
WHERE id BETWEEN 1 AND 10000;

UPDATE orders SET status = 'completed' 
WHERE id BETWEEN 10001 AND 20000;
```

---

## 事务与锁的考量

### 事务大小控制

```java
// 每 1000 条提交一次，避免长事务
int batchSize = 1000;
int totalCommit = 0;

for (int i = 0; i &lt; orders.size(); i++) {
    // 执行插入
    executeInsert(orders.get(i));
    totalCommit++;
    
    if (totalCommit % batchSize == 0) {
        connection.commit();  // 定期提交
    }
}

connection.commit();  // 提交剩余的
```

### 锁等待与死锁

批量操作容易触发锁等待和死锁：

```sql
-- 会话 A：先锁 order 100，再锁 order 101
UPDATE orders SET status = 'paid' WHERE id = 100;
UPDATE orders SET status = 'paid' WHERE id = 101;

-- 会话 B：先锁 order 101，再锁 order 100（死锁！）
UPDATE orders SET status = 'paid' WHERE id = 101;
UPDATE orders SET status = 'paid' WHERE id = 100;
```

**解决方案：按主键顺序更新**

```java
// 按 ID 排序后更新，避免死锁
orders.sort(Comparator.comparing(Order::getId));
for (Order order : orders) {
    // 更新逻辑
}
```

### 调整锁等待超时

```sql
-- 查看当前配置
SHOW VARIABLES LIKE 'innodb_lock_wait_timeout';

-- 临时调整（适当延长）
SET GLOBAL innodb_lock_wait_timeout = 50;
```

---

## 性能参数调优

### 关键参数

```ini
[mysqld]
# 批量插入缓冲区
bulk_insert_buffer_size = 256M

# 插入缓冲
innodb_buffer_pool_size = 4G

# 关闭唯一检查（导入时）
unique_checks = 0

# 关闭外键检查（导入时）
foreign_key_checks = 0
```

### 导入前后的 SQL

```sql
-- 导入前：关闭检查
SET unique_checks = 0;
SET foreign_key_checks = 0;

-- 执行导入
LOAD DATA INFILE '/tmp/orders.csv' INTO TABLE orders;

-- 导入后：恢复检查
SET unique_checks = 1;
SET foreign_key_checks = 1;

-- 验证数据完整性
CHECK TABLE orders;
```

---

## 实战：百万级数据导入方案

### 需求

将 CSV 文件中的 100 万条订单数据导入 MySQL。

### 方案设计

```
1. 读取 CSV 文件（流式读取，避免 OOM）
2. 每 5000 条打包一次
3. 使用 LOAD DATA INFILE
4. 监控进度和错误
```

### Java 实现

```java
public class BigDataImporter {
    
    private static final int BATCH_SIZE = 5000;
    private static final String CSV_PATH = "/data/orders.csv";
    private static final String TABLE_NAME = "orders";
    
    public void importData() {
        long startTime = System.currentTimeMillis();
        long totalRows = 0;
        
        try (Connection conn = getConnection()) {
            conn.setAutoCommit(false);
            
            // 生成临时文件
            String tempFile = createTempCsv();
            
            // 关闭检查提升性能
            executeSql(conn, "SET unique_checks = 0");
            executeSql(conn, "SET foreign_key_checks = 0");
            
            // 执行 LOAD DATA
            String loadSql = String.format(
                "LOAD DATA INFILE '%s' INTO TABLE %s " +
                "FIELDS TERMINATED BY ',' LINES TERMINATED BY '\\n'",
                tempFile, TABLE_NAME);
            
            try (Statement stmt = conn.createStatement()) {
                stmt.execute(loadSql);
            }
            
            conn.commit();
            
            // 恢复检查
            executeSql(conn, "SET unique_checks = 1");
            executeSql(conn, "SET foreign_key_checks = 1");
            
        } catch (Exception e) {
            throw new RuntimeException("导入失败", e);
        }
        
        long cost = System.currentTimeMillis() - startTime;
        System.out.println("导入完成，耗时：" + (cost / 1000) + "秒");
    }
}
```

### 性能结果

| 指标 | 数值 |
|---|---|
| 数据量 | 100 万条 |
| 文件大小 | 200 MB |
| 导入时间 | 45 秒 |
| 平均速度 | 2.2 万条/秒 |

---

## 总结与思考

批量操作的性能优化核心：

1. **减少网络往返**：多条 SQL 合并执行
2. **减少事务开销**：批量提交，减少 fsync
3. **利用 LOAD DATA**：文件级导入，极限性能
4. **关闭不必要检查**：unique_checks、foreign_key_checks

> 没有银弹，组合使用才是王道。

---

## 留给你的问题

1. LOAD DATA INFILE 为什么比 INSERT 快这么多？它绕过了 MySQL 的哪些机制？

2. 如果导入过程中断，如何实现断点续传？需要记录哪些状态？

3. 批量更新时，CASE WHEN 和临时表 JOIN 哪个更快？考虑数据量和字段数。
