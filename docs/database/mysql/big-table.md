# 大表优化：分库分表、分区表、历史数据归档

你的单表数据量突破 1 亿。

查询越来越慢，索引失效，数据库快撑不住了。

怎么办？

今天，彻底搞清楚大表优化的各种方案。

---

## 大表的危害

### 性能问题

```sql
-- 问题：
-- 1. 索引变大，查询变慢
-- 2. 全表扫描成本高
-- 3. COUNT(*) 很慢
-- 4. 备份时间长
```

### 运维问题

```sql
-- 问题：
-- 1. 备份恢复耗时
-- 2. DDL 操作风险大
-- 3. 磁盘空间不足
-- 4. 主从复制延迟
```

---

## 优化方案

### 方案一：优化 SQL

```sql
-- 检查是否有全表扫描
EXPLAIN SELECT * FROM orders WHERE status = 'paid';

-- 优化：
-- 1. 添加合适索引
-- 2. 避免 SELECT *
-- 3. 减少深度分页
```

### 方案二：分区表

```sql
-- 分区表：一张逻辑表，多个物理分区

-- 按时间分区：
CREATE TABLE orders (
    id BIGINT,
    user_id INT,
    total_amount DECIMAL(10,2),
    create_time DATETIME
) PARTITION BY RANGE (YEAR(create_time)) (
    PARTITION p2022 VALUES LESS THAN (2023),
    PARTITION p2023 VALUES LESS THAN (2024),
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);
```

### 方案三：分库分表

```sql
-- 分库分表：数据分散到多个表或库

-- 示例：
-- orders_0, orders_1, orders_2, orders_3
-- 按 user_id % 4 分片
```

### 方案四：历史数据归档

```sql
-- 把历史数据迁移到归档表

-- 方案：
-- 1. 定时归档（每日/每周）
-- 2. 归档到冷数据表
-- 3. 归档到 ES
```

---

## 分区表详解

### 分区类型

```sql
-- RANGE 分区：按范围
PARTITION BY RANGE (id) (
    PARTITION p0 VALUES LESS THAN (1000000),
    PARTITION p1 VALUES LESS THAN (2000000),
    PARTITION p2 VALUES LESS THAN MAXVALUE
);

-- LIST 分区：按枚举值
PARTITION BY LIST (status) (
    PARTITION p_pending VALUES IN (0),
    PARTITION p_paid VALUES IN (1),
    PARTITION p_closed VALUES IN (2)
);

-- HASH 分区：按 Hash
PARTITION BY HASH (user_id)
PARTITIONS 4;

-- KEY 分区：按主键 Hash
PARTITION BY KEY (id)
PARTITIONS 4;
```

### 分区表查询

```sql
-- 查询会自动定位到对应分区
SELECT * FROM orders WHERE create_time BETWEEN '2024-01-01' AND '2024-01-31';

-- 查看执行计划
EXPLAIN SELECT * FROM orders WHERE create_time BETWEEN '2024-01-01' AND '2024-01-31';

-- 结果：
-- partitions: p2024  -- 只扫描 p2024 分区
```

### 分区表注意事项

```sql
-- 1. 分区字段必须包含在主键中（MySQL 5.7）
-- 2. 分区数量不宜过多（建议不超过 1024）
-- 3. 分区表不支持外键
-- 4. 全局索引需要额外维护
```

---

## 分库分表

### 分库分表 vs 分区表

```sql
-- 分区表：
-- 适用：单表数据量大，但业务不需要分布式
-- 优点：SQL 改动小
-- 缺点：单节点存储

-- 分库分表：
-- 适用：单表数据量极大，需要分布式
-- 优点：可扩展性强
-- 缺点：SQL 改动大，跨节点查询复杂
```

### 分片策略

```sql
-- 按时间分片：适合日志、订单
-- 按用户分片：适合用户相关表
-- 按地域分片：适合地区业务
-- Hash 分片：数据均匀
```

---

## 历史数据归档

### 归档策略

```sql
-- 归档条件：
-- 1. 时间超过 N 个月
-- 2. 状态为已完成
-- 3. 不是最近活跃用户

-- 归档位置：
-- 1. 归档表（同库）
-- 2. 归档库（不同库）
-- 3. ES（搜索库）
-- 4. HDFS（数据湖）
```

### 归档实现

```sql
-- 方案一：定时任务归档
-- 每天凌晨 2 点归档历史数据

-- 方案二：删除归档
-- 归档后删除原表数据

-- 方案三：双写
-- 新数据写主表，旧数据异步同步到归档表
```

### Java 实现归档

```java
@Service
public class DataArchiveService {
    
    @Autowired
    private JdbcTemplate jdbcTemplate;
    
    // 归档三个月前的订单
    public void archiveOrders() {
        LocalDateTime threeMonthsAgo = LocalDateTime.now().minusMonths(3);
        
        // 1. 导出数据到归档表
        String sql = """
            INSERT INTO orders_archive 
            SELECT * FROM orders 
            WHERE create_time < ? AND status = 'completed'
            """;
        jdbcTemplate.update(sql, threeMonthsAgo);
        
        // 2. 删除原表数据
        String deleteSql = """
            DELETE FROM orders 
            WHERE create_time < ? AND status = 'completed'
            """;
        jdbcTemplate.update(deleteSql, threeMonthsAgo);
    }
}
```

---

## 面试高频追问

### Q1：分区表和分库分表区别？

```sql
-- 分区表：
-- 1. 一张逻辑表，多个物理分区
-- 2. 单节点
-- 3. SQL 改动小
-- 4. 不支持外键

-- 分库分表：
-- 1. 多张物理表
-- 2. 可分布式
-- 3. SQL 改动大
-- 4. 跨节点查询复杂
```

### Q2：分区表有哪些限制？

```sql
-- 限制：
-- 1. 主键必须包含分区字段
-- 2. 分区数量有限制
-- 3. 不支持外键
-- 4. 全局索引需要额外维护
```

### Q3：什么时候选择分库分表？

```sql
-- 时机：
-- 1. 单表数据超过 5000 万
-- 2. 单库磁盘空间不足
-- 3. 垂直拆分解决不了问题
-- 4. 需要水平扩展能力

-- 注意：分库分表是最后手段
```

---

## 总结

| 方案 | 适用场景 | 优点 | 缺点 |
|-----|---------|-----|-----|
| 优化 SQL | 通用 | 简单 | 有极限 |
| 分区表 | 单表大 | SQL 改动小 | 单节点 |
| 分库分表 | 超大表 | 可扩展 | 复杂 |
| 归档 | 历史数据 | 减小主表 | 查询受限 |

**记住：大表优化顺序：优化 SQL → 分区表 → 分库分表 → 历史归档。**