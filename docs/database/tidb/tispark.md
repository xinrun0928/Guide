# TiSpark：大数据生态的桥梁

你的数据工程师熟悉 Spark，想用 Spark 处理 TiDB 的数据。

你的数据分析团队有现成的 Spark 作业，想让它直接读取 TiDB。

怎么办？

**TiSpark 让 Spark 可以直接读写 TiDB，无需额外的数据同步。**

## TiSpark 是什么？

TiSpark 是 TiDB 的 Spark 连接器，让 Spark 可以直接访问 TiKV 存储层。

```
┌─────────────────────────────────────────────────────────┐
│                    Spark 生态系统                        │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │                    Spark SQL                     │   │
│  │                 Spark DataFrame                  │   │
│  └─────────────────────────────────────────────────┘   │
│                         ▲                              │
│                         │                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │                    TiSpark                       │   │
│  │  - SQL 层下推                                    │   │
│  │  - 索引支持                                      │   │
│  │  - 分布式读取                                    │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                     TiKV 存储层                         │
│                                                         │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐             │
│  │ TiKV 1  │    │ TiKV 2  │    │ TiKV 3  │             │
│  └─────────┘    └─────────┘    └─────────┘             │
└─────────────────────────────────────────────────────────┘
```

**关键点：TiSpark 不是把数据导出到 Hive，而是直接读取 TiKV。**

## TiSpark vs 传统方案

| 方案 | 数据同步 | 查询延迟 | 一致性 | 运维复杂度 |
|-----|---------|---------|-------|-----------|
| TiSpark | 无需同步 | 低（直接读） | 强一致 | 低 |
| Spark + Hive | 需要 ETL | 中等 | 最终一致 | 高 |
| Spark + Parquet | 需要导出 | 中等 | 最终一致 | 高 |
| TiDB 直接查询 | 无 | 视数据量 | 强一致 | 低 |

## TiSpark 使用

### 依赖配置

```xml
<!-- Spark 2.4 -->
<dependency>
    <groupId>com.pingcap.tispark</groupId>
    <artifactId>tispark-core</artifactId>
    <version>2.4.1</version>
</dependency>

<!-- Spark 3.0+ -->
<dependency>
    <groupId>com.pingcap.tispark</groupId>
    <artifactId>tispark-spark3</artifactId>
    <version>3.0.1</version>
</dependency>
```

### Spark Shell 使用

```scala
// 启动 Spark Shell
spark-shell --jars tispark-spark3-3.0.1.jar

// 读取 TiDB 表
val df = spark.sql("SELECT * FROM myapp.orders WHERE created_at >= '2024-01-01'")

// 使用 DataFrame API
val result = df
    .filter($"amount" > 1000)
    .groupBy("status")
    .agg(sum("amount").as("total_amount"), count("*").as("order_count"))
    .orderBy($"total_amount".desc)

// 写入 TiDB 表
result.write
    .format("tidb")
    .option("tidb.addr", "192.168.1.1")
    .option("tidb.port", "4000")
    .option("tidb.user", "root")
    .option("database", "myapp")
    .option("table", "order_summary")
    .mode("overwrite")
    .save()
```

### PySpark 使用

```python
from pyspark.sql import SparkSession

# 创建 Spark Session
spark = SparkSession.builder \
    .appName("TiDB Analysis") \
    .config("spark.sql.extensions", "org.apache.spark.sql TidbSparkSessionExtensions") \
    .config("spark.tispark.pd.addresses", "192.168.1.1:2379") \
    .getOrCreate()

# 读取数据
df = spark.sql("SELECT * FROM myapp.orders WHERE created_at >= '2024-01-01'")

# DataFrame 操作
result = df.groupBy("status").agg(
    f.sum("amount").alias("total_amount"),
    f.count("*").alias("order_count")
)

# 写入 TiDB
result.write \
    .format("tidb") \
    .option("database", "myapp") \
    .option("table", "order_summary") \
    .mode("overwrite") \
    .save()
```

## TiSpark 架构原理

```java
// TiSpark 核心组件
public class TiSparkArchitecture {
    // 1. TiContext
    // Spark 与 TiDB 的连接上下文
    // 管理 PD 地址、连接池
    // 2. TiStrategy
    // Spark 查询优化策略
    // 将 Spark Logical Plan 转换为 TiDB 执行计划
    // 3. TiRDD
    // TiSpark 的分布式数据结构
    // 直接读取 TiKV 数据
    // 4. TiPartition
    // TiSpark 的分区
    // 与 TiKV Region 对应
}

// TiSpark 查询流程
public class TiSparkQueryFlow {
    public Dataset query(String sql) {
        // 1. Spark SQL 解析
        LogicalPlan plan = sqlParser.parse(sql);

        // 2. TiStrategy 下推
        // 尽可能将 Filter、Aggregation 下推到 TiKV
        LogicalPlan pushedPlan = pushDownOptimizations(plan);

        // 3. 生成 TiDB 执行计划
        TiPlan tiPlan = converter.toTiPlan(pushedPlan);

        // 4. 分布式读取 TiKV
        TiRDD rdd = new TiRDD(tiPlan);

        // 5. Spark 计算
        return rdd.toDataFrame();
    }
}
```

## SQL 下推

TiSpark 的核心能力是**下推**——把尽可能多的计算推到 TiDB 层执行。

```scala
// TiSpark 支持的下推操作

// 1. Filter 下推
// 在 TiKV 层过滤，减少数据传输
df.filter($"amount" > 1000)  // 下推到 TiKV

// 2. 聚合下推
// 在 TiKV 层聚合
df.groupBy("status").agg(sum("amount"))  // 下推到 TiKV

// 3. Limit 下推
// 在 TiKV 层限制返回数量
df.limit(100)  // 下推到 TiKV

// 4. TopN 下推
// 在 TiKV 层排序取 TopN
df.orderBy($"amount".desc).limit(10)  // 下推到 TiKV

// 5. 索引下推
// 使用 TiDB 索引
df.filter($"user_id" === 12345)  // 使用 idx_user_id 索引
```

### 下推规则

```java
// TiSpark 下推规则
public class PushDownRules {
    // 可以下推的条件
    // - 等值条件: =, IN
    // - 比较条件: <>, <, >, <=, >=
    // - LIKE（前缀匹配）
    // - AND, OR, NOT
    // - IS NULL, IS NOT NULL

    // 不能下推的条件
    // - LIKE %xxx%（不以通配符开头）
    // - 包含子查询
    // - 使用 Spark 特有函数
    // - 涉及非下推列的计算
}
```

## TiSpark + Hive 混合使用

TiSpark 支持在同一个 Spark Session 中同时访问 TiDB 和 Hive。

```scala
// TiDB 和 Hive 混合查询
val tidbDF = spark.sql("SELECT * FROM tidb_db.users")
val hiveDF = spark.sql("SELECT * FROM hive_db.user_features")

// JOIN 操作
val joined = tidbDF.join(hiveDF, "user_id")

// 结果写回 TiDB
joined.write
    .format("tidb")
    .option("database", "result_db")
    .option("table", "user_analysis")
    .mode("overwrite")
    .save()
```

## 性能调优

```scala
// TiSpark 配置参数

// 1. 并发数
spark.sql("SET spark.tispark.schedule.priority=60")  // 并发查询数
spark.sql("SET spark.tispark.task.max_size=10000")   // 单任务最大行数

// 2. 下推控制
spark.sql("SET spark.tispark.plan.allow.index.read=true")  // 允许使用索引
spark.sql("SET spark.tispark.plan.broadcast.threshold=100000000")  // 广播阈值

// 3. 内存控制
spark.sql("SET spark.tispark.row.adapter.max.rows=10000")  // 单批次行数

// 4. 索引选择
// TiSpark 会自动选择索引
// 也可以手动指定
df.filter("user_id = 12345 /* USE INDEX idx_user_id */")
```

### 调优建议

```java
// TiSpark 性能调优建议
public class TiSparkTuning {
    // 1. 尽量让 TiSpark 下推更多计算
    // 减少 Spark 和 TiKV 之间的数据传输

    // 2. 合理使用广播 JOIN
    // 小表广播给大表
    // 设置 broadcast threshold

    // 3. 避免全表扫描
    // 使用 WHERE 条件过滤
    // 创建合适的索引

    // 4. 批量写入
    // 多次写入可以合并为批量写入
    // 减少 TiDB 事务开销
}
```

## 适用场景

TiSpark 适合以下场景：

| 场景 | 说明 |
|-----|------|
| 数据湖分析 | 已有 Hive/Parquet 数据，需要 JOIN TiDB 数据 |
| 复杂 ETL | Spark 特有的窗口函数、复杂逻辑 |
| 机器学习 | Spark MLlib 训练数据来自 TiDB |
| 历史数据分析 | 跨时间范围分析，需要 Spark 的分布式能力 |
| 报表导出 | 将 TiDB 数据导出为 Parquet |

## TiSpark vs TiFlash

| 特性 | TiSpark | TiFlash |
|-----|---------|---------|
| 计算引擎 | Spark | TiDB 内置 MPP |
| 部署 | 独立部署 Spark | TiDB 内置 |
| 延迟 | 较高（秒级） | 较低（毫秒级） |
| 复杂计算 | 支持 | 部分支持 |
| 运维复杂度 | 高（多组件） | 低（一体化） |
| 适用场景 | 复杂 ETL、机器学习 | 实时分析、报表 |

## 面试追问

**Q: TiSpark 和直接用 TiDB SQL 查询有什么区别？**

TiDB SQL 查询适合简单到中等的分析场景。TiSpark 的优势在于：
- 可以使用 Spark 特有的 API（窗口函数、复杂 UDF）
- 可以 JOIN Hive/HDFS 等外部数据源
- 可以使用 Spark 的机器学习库

如果只是简单的分析查询，直接用 TiDB SQL 即可。

**Q: TiSpark 可以替代 TiFlash 吗？**

不能完全替代。TiFlash 是 TiDB 内置的列式存储，延迟更低，运维更简单。TiSpark 更适合复杂的 ETL 和需要 Spark 生态的场景。

**Q: TiSpark 的数据一致性如何？**

TiSpark 直接读取 TiKV，数据一致性由 TiKV 的 MVCC 保证。读取的是快照数据，不受并发写入影响。

---

## 总结

TiSpark 是 TiDB 与 Spark 生态的桥梁。它让 Spark 可以直接访问 TiDB 数据，无需 ETL，适合复杂分析和机器学习场景。

但 TiSpark 不是银弹：
- **简单分析用 TiDB SQL**
- **复杂 ETL 用 TiSpark**
- **实时分析用 TiFlash**
- **机器学习用 TiSpark + TiDB 数据**

选择合适的工具，才能事半功倍。
