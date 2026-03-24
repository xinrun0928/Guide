# 分区表：让千万级数据查询如丝般顺滑

你有没有被一张几千万行的表折磨过？

查询一个月的订单数据，要扫描全表 10 分钟。增加硬件、加索引都收效甚微。

这是因为你掉进了「单表天花板」的坑。而分区表，就是破局的关键。

## 分区表的本质：分而治之

分区表把一张大表拆成多个小表，查询时只扫描相关的分区，而不是全表。

```
普通表：orders (1亿条记录)
分区表：orders (按月分成 12 个分区，每个分区 ~800万条)

查询 2024年3月的数据：
- 普通表：扫描 1 亿条，逐一过滤
- 分区表：只扫描 2024年3月那个分区，~800万条
```

## 达梦数据库的分区类型

### 范围分区（Range Partitioning）：按区间划分

最适合时间序列数据。

```sql
-- 按订单日期分区
CREATE TABLE orders (
    order_id BIGINT PRIMARY KEY,
    order_date DATE NOT NULL,
    customer_id BIGINT,
    amount DECIMAL(10,2)
)
PARTITION BY RANGE(order_date) (
    PARTITION p2023 VALUES LESS THAN ('2024-01-01'),
    PARTITION p2024_q1 VALUES LESS THAN ('2024-04-01'),
    PARTITION p2024_q2 VALUES LESS THAN ('2024-07-01'),
    PARTITION p2024_q3 VALUES LESS THAN ('2024-10-01'),
    PARTITION p2024_q4 VALUES LESS THAN ('2025-01-01'),
    PARTITION p_future VALUES LESS THAN (MAXVALUE)
);
```

### 列表分区（List Partitioning）：按枚举值划分

适合有明显类别的数据。

```sql
-- 按地区分区
CREATE TABLE sales (
    sale_id BIGINT PRIMARY KEY,
    region VARCHAR(20),
    amount DECIMAL(10,2)
)
PARTITION BY LIST(region) (
    PARTITION p_east VALUES ('北京', '天津', '河北'),
    PARTITION p_west VALUES ('四川', '云南', '贵州'),
    PARTITION p_others VALUES (DEFAULT)
);
```

### 哈希分区（Hash Partitioning）：均匀分布

让数据均匀分布在多个分区，适合没有明显分区键的场景。

```sql
-- 按用户ID哈希分区
CREATE TABLE user_logs (
    log_id BIGINT PRIMARY KEY,
    user_id BIGINT,
    log_content VARCHAR(500)
)
PARTITION BY HASH(user_id) PARTITIONS 16;
```

### 复合分区：组合拳

范围分区 + 列表分区，或者范围分区 + 哈希分区。

```sql
-- 先按年分区，再按地区列表分区
CREATE TABLE sales_report (
    id BIGINT PRIMARY KEY,
    sale_date DATE,
    region VARCHAR(20),
    amount DECIMAL(10,2)
)
PARTITION BY RANGE(sale_date)
SUBPARTITION BY LIST(region) (
    PARTITION p2024 VALUES LESS THAN ('2025-01-01') (
        SUBPARTITION p2024_east VALUES ('北京', '天津', '河北'),
        SUBPARTITION p2024_west VALUES ('四川', '云南', '贵州')
    )
);
```

## 分区表的查询优化

分区表的优势，只有在查询**带上分区键**时才能体现。

```java
// 分区表查询示例
public class PartitionQueryDemo {

    public void queryExamples() {
        // ✅ 带上分区键：利用分区裁剪，只扫描一个分区
        String sql1 = "SELECT * FROM orders WHERE order_date = '2024-03-15'";

        // ✅ 范围查询：利用分区裁剪，扫描连续的几个分区
        String sql2 = "SELECT * FROM orders WHERE order_date BETWEEN '2024-01-01' AND '2024-03-31'";

        // ❌ 不带分区键：全表扫描，所有分区都跑不掉
        String sql3 = "SELECT * FROM orders WHERE customer_id = 12345";

        // ✅ 如果必须按非分区键查询，考虑创建本地索引
        String sql4 = "SELECT * FROM orders PARTITION (p2024_q1) WHERE customer_id = 12345";
    }
}
```

**关键点：分区键一定要出现在 WHERE 条件里！**

## 分区表的维护操作

### 添加新分区

```sql
-- 为范围分区添加新分区
ALTER TABLE orders ADD PARTITION p2025_q1 VALUES LESS THAN ('2025-04-01');
```

### 删除旧分区（快速清理历史数据）

```sql
-- 删除历史分区（比 DELETE 快百倍）
ALTER TABLE orders DROP PARTITION p2023;

-- 或者截断分区（保留表结构，清空数据）
ALTER TABLE orders TRUNCATE PARTITION p2023;
```

### 拆分分区

```sql
-- 将一个大分区拆成两个小分区
ALTER TABLE orders SPLIT PARTITION p2024_q1 AT ('2024-02-01')
INTO (PARTITION p2024_jan, PARTITION p2024_feb);
```

## 分区索引：分区表的好搭档

分区表上可以创建**全局索引**或**本地索引**。

```sql
-- 本地索引：索引与数据分区一一对应
CREATE INDEX idx_order_date ON orders(order_date) LOCAL;

-- 全局索引：索引不分区，全局唯一
CREATE INDEX idx_customer ON orders(customer_id) GLOBAL;
```

**本地索引 vs 全局索引：**

| 特性 | 本地索引 | 全局索引 |
|-----|---------|---------|
| 分区独立性 | 每个分区独立管理 | 统一管理 |
| 维护代价 | 分区操作时自动维护 | 分区操作时需要重建 |
| 查询性能 | 受限于单个分区 | 全局范围查询更快 |
| 推荐场景 | 范围分区、时间数据 | 点查询、唯一约束 |

## 分区表使用注意事项

**分区键选择原则：**

1. 高选择性的字段（每个分区数据量均衡）
2. 经常作为查询条件的字段
3. 更新频率低的字段（更新分区键代价高）

**分区数量控制：**

- 分区过多会增加元数据开销
- 建议单表分区数不超过 1000 个
- 每个分区数据量建议在 100 万- 1000 万之间

## 面试追问方向

- 分区表和分库分表有什么区别？各自适用什么场景？
- 如果分区键的值超出预设范围会怎样？
- 分区表的主键应该怎么设计？

---

## 一句话总结

分区表是大数据量的救世主：分区键选对了，1 亿条数据查起来像 100 万条；分区键选错了，还不如不分区。记住，查询不带分区键，等于白分。
