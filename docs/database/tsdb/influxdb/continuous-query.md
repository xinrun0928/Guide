# InfluxDB 连续查询：自动聚合的艺术

你的监控系统每秒写入 100 万条数据。

现在老板问：「过去一个月的平均 CPU 是多少？」

你一查：历史数据还在，但查询要跑 10 分钟——因为要扫描几亿条原始数据。

这就是**连续查询（Continuous Query）** 要解决的问题。

---

## 连续查询是什么？

连续查询是 InfluxDB 自动执行的预聚合查询：

```
原始数据（每秒 100万条）
    │
    │ 连续查询（每分钟执行一次）
    ↓
预聚合数据（每分钟 1条）
    │
    │ 连续查询（每小时执行一次）
    ↓
高压缩数据（每小时 1条）
```

**核心思想**：把计算提前做，查询时直接拿结果。

---

## 创建连续查询

### 基本语法

```sql
CREATE CONTINUOUS QUERY <query_name> ON <database>
BEGIN
    SELECT <function>(<field>) INTO <target_measurement>
    FROM <source_measurement>
    WHERE <condition>
    GROUP BY time(<interval>), <tags>
END
```

### 示例：每分钟聚合

```sql
-- 每分钟计算一次平均值，写入 cpu_1m 表
CREATE CONTINUOUS QUERY "cq_cpu_avg" ON "monitoring"
BEGIN
    SELECT MEAN(usage_user) AS usage_user_avg,
           MEAN(usage_system) AS usage_system_avg
    INTO "cpu_1m"
    FROM "cpu"
    GROUP BY time(1m), *
END
```

**注意**：`GROUP BY *` 会保留所有 Tag。

---

## 常见连续查询模式

### 1. 聚合聚合再聚合

```sql
-- 第一层：每秒数据 → 每分钟聚合
CREATE CONTINUOUS QUERY "cq_1m" ON "monitoring"
BEGIN
    SELECT MEAN(*) INTO "metrics_1m"
    FROM "metrics"
    GROUP BY time(1m), *
END

-- 第二层：每分钟数据 → 每小时聚合
CREATE CONTINUOUS QUERY "cq_1h" ON "monitoring"
BEGIN
    SELECT MEAN(*) INTO "metrics_1h"
    FROM "metrics_1m"
    GROUP BY time(1h), *
END

-- 第三层：每小时数据 → 每天聚合
CREATE CONTINUOUS QUERY "cq_1d" ON "monitoring"
BEGIN
    SELECT MEAN(*) INTO "metrics_1d"
    FROM "metrics_1h"
    GROUP BY time(1d), *
END
```

### 2. 百分位数

```sql
-- 计算 95 百分位数
CREATE CONTINUOUS QUERY "cq_p95" ON "monitoring"
BEGIN
    SELECT PERCENTILE(usage_user, 95) AS p95
    INTO "cpu_p95_1m"
    FROM "cpu"
    GROUP BY time(1m), *
END
```

### 3. 保留策略联动

```sql
-- 数据写入带 RP
CREATE CONTINUOUS QUERY "cq_for_30d" ON "monitoring"
BEGIN
    SELECT MEAN(*) INTO "monitoring"."30d"."cpu_1m"
    FROM "monitoring"."autogen"."cpu"
    GROUP BY time(1m), *
END
```

---

## Java 代码实现

### 基础操作

```java
import org.influxdb.dto.Query;
import org.influxdb.InfluxDB;

public class ContinuousQueryManager {
    private final InfluxDB influxDB;

    // 创建连续查询
    public void createCQ(String db, String cqName, String query) {
        String sql = "CREATE CONTINUOUS QUERY \"" + cqName + "\" ON \"" + db + "\" " +
                     "BEGIN " + query + " END";
        influxDB.query(new Query(sql, db));
    }

    // 示例：创建 CPU 聚合 CQ
    public void createCpuAggregationCQ() {
        String query = """
            SELECT MEAN(usage_user) AS usage_user_avg,
                   MEAN(usage_system) AS usage_system_avg
            INTO "cpu_1m"
            FROM "cpu"
            GROUP BY time(1m), *
            """;
        createCQ("monitoring", "cq_cpu_avg", query);
    }

    // 查看所有连续查询
    public List&lt;String&gt; showCQs(String db) {
        Query query = new Query("SHOW CONTINUOUS QUERIES", db);
        QueryResult result = influxDB.query(query);
        // 解析结果...
        return new ArrayList&lt;&gt;();
    }

    // 删除连续查询
    public void dropCQ(String db, String cqName) {
        String sql = "DROP CONTINUOUS QUERY \"" + cqName + "\" ON \"" + db + "\"";
        influxDB.query(new Query(sql, db));
    }
}
```

### 动态 CQ 管理

```java
public class DynamicCQManager {
    private final InfluxDB influxDB;

    // 根据指标自动创建 CQ
    public void autoCreateCQs(String db, List&lt;String&gt; metrics) {
        for (String metric : metrics) {
            // 每分钟聚合
            String cqMinute = "cq_" + metric + "_1m";
            String queryMinute = String.format("""
                SELECT MEAN(*) INTO "%s_1m" FROM "%s" GROUP BY time(1m), *
                """, metric, metric);
            createCQ(db, cqMinute, queryMinute);

            // 每小时聚合
            String cqHour = "cq_" + metric + "_1h";
            String queryHour = String.format("""
                SELECT MEAN(*) INTO "%s_1h" FROM "%s_1m" GROUP BY time(1h), *
                """, metric, metric);
            createCQ(db, cqHour, queryHour);
        }
    }

    // 迁移旧 CQ 到新 RP
    public void migrateToNewRP() {
        String sql = """
            SELECT MEAN(*) INTO "monitoring"."90d"."metrics_1m"
            FROM "monitoring"."autogen"."metrics"
            GROUP BY time(1m), *
            """;
        createCQ("monitoring", "cq_migrate_90d", sql);
    }
}
```

---

## RESAMPLE 子句：控制重采样

```sql
-- 每 30 秒执行一次，写入 1 分钟的数据
CREATE CONTINUOUS QUERY "cq_resample" ON "monitoring"
RESAMPLE EVERY 30s FOR 2m
BEGIN
    SELECT MEAN(usage_user) INTO "cpu_resampled"
    FROM "cpu"
    GROUP BY time(1m), *
END
```

**参数说明**：

- `EVERY`：连续查询的执行间隔
- `FOR`：每个时间窗口的覆盖范围

```
时间线:  0m   30s   1m   90s   2m   150s  3m
        ├─────┼─────┼─────┼─────┼─────┼─────┤
EVERY 30s:     ↓         ↓         ↓
FOR 2m:    ├─────────────────┤ ├─────────────────┤
           每次查询 2 分钟的数据
```

---

## 连续查询的局限

| 局限 | 说明 |
|-----|------|
| 只能聚合到更高时间精度 | 不能 1m → 1m |
| 必须在同一个数据库 | 不能跨库聚合 |
| 不支持嵌套查询 | 不能 CQ 里套 CQ |
| 不支持子查询 | 复杂逻辑需要其他方案 |

---

## 替代方案对比

### InfluxDB 2.0 的 Tasks

```javascript
// InfluxDB 2.0 使用 Flux 语言
option task = {
    name: "cpu_aggregation",
    every: 1m,
}

from(bucket: "monitoring/autogen")
    |> range(start: -1m)
    |> filter(fn: (r) => r._measurement == "cpu")
    |> mean()
    |> to(bucket: "monitoring/30d", org: "myorg")
```

### Kapacitor 作为补充

对于更复杂的处理逻辑，可以使用 Kapacitor：

```java
// Kapacitor 配置
// kapacitor.conf
[influxdb]
  urls = ["http://localhost:8086"]

// TICKscript 脚本
stream
    |from()
        .measurement('cpu')
    |window()
        .period(1m)
        .every(1m)
    |mean('usage_user')
    |influxDBOut()
        .database('monitoring')
        .retentionPolicy('30d')
        .measurement('cpu_1m')
```

---

## 面试追问方向

- 连续查询和普通查询有什么区别？
- 如何处理连续查询失败的情况？

下一节，我们来了解 InfluxDB 的数据保留策略。
