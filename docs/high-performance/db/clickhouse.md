# ClickHouse 高性能查询原理

凌晨 3 点，你的报表系统突然崩溃。

用户抱怨：「查询一个月的销售数据，等了 30 秒还没出来。」

你检查了 MySQL：索引正常，表结构正常。**问题是 MySQL 根本不适合分析型查询。**

MySQL 是 OLTP 数据库，适合事务处理；ClickHouse 是 OLAP 数据库，天生为分析而生。

同样 1 亿条数据，MySQL 可能需要 30 秒，ClickHouse 只需要 0.5 秒。

**ClickHouse 凭什么这么快？**

## ClickHouse 的核心架构

### 列式存储

ClickHouse 是真正的列式存储数据库。与行式存储对比：

```
行式存储（MySQL）：
[ID, Name, Age, City, Salary] [1, "Tom", 25, "BJ", 8000]
[ID, Name, Age, City, Salary] [2, "Jane", 30, "SH", 10000]

列式存储（ClickHouse）：
ID: [1, 2]
Name: ["Tom", "Jane"]
Age: [25, 30]
City: ["BJ", "SH"]
Salary: [8000, 10000]
```

**优势**：

1. **只读取需要的列**：查询 Age 和 Salary 时，只读取这两列
2. **列压缩效率高**：同一列的数据类型相同，压缩率高
3. **向量引擎**：一次处理一列数据，利用 CPU SIMD 指令

### 向量化执行

ClickHouse 使用向量化执行引擎，将数据组织成列块（Column Chunk），一次处理多个值：

```java
// 伪代码：向量化执行
// 一次处理 1024 行数据
int64_t* salary = column_salary.data();
int64_t* result = output_column.data();

for (size_t i = 0; i < batch_size; i += 1024) {
    // SIMD 指令批量处理
    for (int j = 0; j < 1024; j++) {
        result[i + j] = salary[i + j] * 1.1;  // 涨薪 10%
    }
}
```

### 多线程并行处理

ClickHouse 充分利用多核 CPU：

```sql
-- 查询自动并行化
SELECT 
    date,
    sum(revenue) as total_revenue
FROM sales
WHERE date >= '2024-01-01'
GROUP BY date
ORDER BY total_revenue DESC
LIMIT 10
```

ClickHouse 会：

1. 将数据分成多个 part
2. 每个 part 分配一个线程处理
3. 最后合并结果

## 核心优化技术

### 1. MergeTree 表引擎

ClickHouse 最常用的表引擎是 MergeTree：

```sql
CREATE TABLE sales (
    id UInt64,
    date Date,
    product_id UInt32,
    category String,
    revenue Decimal(10, 2),
    quantity UInt32
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, product_id)
SETTINGS index_granularity = 8192;
```

**关键概念**：
- **PARTITION BY**：分区字段，按月分区
- **ORDER BY**：排序键（主键），用于索引
- **index_granularity**：索引粒度，每 8192 行生成一条稀疏索引

### 2. 稀疏索引

ClickHouse 的索引是稀疏索引，只记录每段的起始值：

```
数据（每 8192 行一个标记）：
Row 0: date=2024-01-01, product_id=100
Row 1: date=2024-01-01, product_id=101
...
Row 8192: date=2024-01-03, product_id=200  ← 索引点

查询：WHERE date = '2024-01-03'
ClickHouse 通过索引找到 Row 8192，然后读取这个 granule 的数据
```

**优势**：索引文件极小（几 MB），可以完全加载到内存

### 3. 数据压缩

```sql
-- ClickHouse 自动选择最优压缩算法
-- 数字类型：Delta、LZ4、ZSTD
-- 字符串类型：LZ4、ZSTD

-- 可以手动指定
ALTER TABLE sales MODIFY COLUMN
    category String CODEC(ZSTD(3));
```

**压缩效果示例**：

| 数据类型 | 原始大小 | 压缩后 |
|---|---|---|
| Int32 | 100GB | 15GB |
| String | 100GB | 8GB |
| Date | 100GB | 2GB |

### 4. Materialized View（物化视图）

预计算聚合结果，避免重复计算：

```sql
-- 创建物化视图
CREATE MATERIALIZED VIEW sales_by_month
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, category)
AS
SELECT 
    toStartOfMonth(date) as date,
    category,
    sum(revenue) as total_revenue,
    sum(quantity) as total_quantity
FROM sales
GROUP BY date, category;

-- 查询物化视图
SELECT * FROM sales_by_month WHERE date = '2024-01-01';
```

### 5. TTL（数据生命周期）

自动删除过期数据，减少存储：

```sql
CREATE TABLE events (
    id UInt64,
    event_type String,
    event_time DateTime,
    data String
)
ENGINE = MergeTree()
ORDER BY (event_type, event_time)
TTL event_time + INTERVAL 90 DAY;

-- 查看 TTL
ALTER TABLE events MODIFY TTL event_time + INTERVAL 90 DAY;
```

## ClickHouse SQL 特点

### 高效的聚合查询

```sql
-- 近似计算（HyperLogLog）
SELECT uniqExact(user_id) FROM events;  -- 精确去重，耗时 5s
SELECT uniqMerge(hll) FROM (SELECT uniqState(user_id) as hll FROM events);  -- 近似，耗时 0.5s

-- 采样查询
SELECT * FROM events SAMPLE 0.1;  -- 采样 10% 的数据

-- 数组函数
SELECT arrayFilter(x -> x > 0, [-1, 2, -3, 4]) as result;  -- [2, 4]
```

### 数组和 Lambda

```sql
-- 数组聚合
SELECT 
    product_id,
    groupArray(amount) as amounts,
    arraySort(x -> -x, amounts) as sorted_amounts
FROM orders
GROUP BY product_id;

-- Lambda 表达式
SELECT arrayMap(x -> x * 2, [1, 2, 3]);  -- [2, 4, 6]
```

### JOIN 优化

ClickHouse 对 JOIN 有特殊优化：

```sql
-- GLOBAL JOIN：广播小表
SELECT 
    a.product_id,
    b.product_name
FROM orders a
GLOBAL JOIN products b ON a.product_id = b.id;

-- 使用预处理表
CREATE TABLE products_broadcast AS products;
```

## Java 客户端使用

### 使用 JDBC

```java
// ClickHouse JDBC
String url = "jdbc:clickhouse://localhost:8123/default";
ClickHouseDataSource dataSource = new ClickHouseDataSource(url);

try (Connection conn = dataSource.getConnection();
     PreparedStatement stmt = conn.prepareStatement(
         "SELECT date, sum(revenue) FROM sales WHERE date = ? GROUP BY date");
     ResultSet rs = stmt.executeQuery()) {
    
    while (rs.next()) {
        System.out.println(rs.getDate(1) + ": " + rs.getDouble(2));
    }
}
```

### 使用 R2DBC

```java
// R2DBC ClickHouse
ClickHouseConnectionFactory factory = new ClickHouseConnectionFactory(
    ClickHouseEnv.builder()
        .host("localhost")
        .port(8123)
        .database("default")
        .build()
);

Mono&lt;ClickHouseRow&gt; result = factory.getConnection()
    .flatMapMany(conn -> conn.createStatement(
        "SELECT date, sum(revenue) FROM sales GROUP BY date"
    ).execute())
    .flatMap(r -> r.map((row, meta) -> 
        Row.of(row.getDate(0), row.getDouble(1))));
```

## 性能调优

### 配置文件优化

```xml
<!-- /etc/clickhouse-server/config.xml -->
<clickhouse>
    <!-- 最大内存 -->
    <max_memory_usage>10000000000</max_memory_usage>
    
    <!-- 并行查询 -->
    <max_parallel_replicas>4</max_parallel_replicas>
    
    <!-- 线程数 -->
    <max_threads>16</max_threads>
    
    <!-- 压缩 -->
    <builtin-dictionaries-reload-frequency>3600</builtin-dictionaries-reload-frequency>
</clickhouse>
```

### 查询优化建议

1. **使用分区**：减少扫描范围
2. **预聚合**：使用物化视图
3. **适当冗余**：反规范化，减少 JOIN
4. **避免 SELECT ***：只查询需要的列
5. **使用采样**：在数据探索时使用 SAMPLE

## 总结

ClickHouse 的高性能来源于：

1. **列式存储**：只读取需要的列，支持高压缩
2. **向量化执行**：利用 CPU SIMD 指令批量处理
3. **稀疏索引**：小索引文件，快速定位
4. **MergeTree**：高效的数据存储和合并
5. **物化视图**：预计算聚合，避免重复计算

---

## 留给你的问题

假设你有以下业务场景：

- 电商平台销售数据，约 100 亿条
- 需要支持各种实时分析：日销售额、订单量、客单价、TOP 商品等
- 查询延迟要求 < 2 秒

请思考：

1. ClickHouse 如何存储这 100 亿条数据？如何设计分区和排序键？
2. 如果需要查询「每天每个分类的销售额」，SQL 怎么写？ClickHouse 会如何执行？
3. 如果「TOP 100 商品」查询很慢，有什么优化手段？
4. 如果需要同时支持实时查询和历史查询，如何设计冷热分层？
5. ClickHouse 与 Elasticsearch 都可以做分析查询，在什么场景下应该选 ClickHouse，什么场景下应该选 Elasticsearch？

这道题的关键在于理解 ClickHouse 的设计理念，以及如何根据业务特点设计最优的数据模型。
