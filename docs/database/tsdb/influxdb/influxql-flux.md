# InfluxQL vs Flux：两种查询语言的对比

InfluxDB 有两种查询语言：

- **InfluxQL**：类似 SQL，简单易学
- **Flux**：函数式查询语言，功能更强大

InfluxDB 1.x 两者都支持，InfluxDB 2.x 全面转向 Flux。

今天我们来对比这两者。

---

## 基础对比

| 特性 | InfluxQL | Flux |
|-----|----------|------|
| 风格 | SQL 风格 | 函数式编程 |
| 学习曲线 | 低 | 较高 |
| 表达能力 | 一般 | 强大 |
| 时间范围 | WHERE 子句 | range() 函数 |
| Join | 不支持跨 Measurement | 原生支持 |
| 适用版本 | 1.x, 2.x | 2.x 推荐 |

---

## InfluxQL：经典 SQL 风格

### 基本查询

```sql
-- 基础查询
SELECT * FROM cpu WHERE time > now() - 1h

-- 聚合查询
SELECT MEAN(cpu) FROM cpu WHERE time > now() - 1d GROUP BY time(1h), host

-- 多个 Field
SELECT MEAN(cpu_user), MEAN(cpu_system), MEAN(cpu_idle)
FROM cpu WHERE time > now() - 1h GROUP BY host
```

### Java 代码

```java
import org.influxdb.dto.Query;
import org.influxdb.InfluxDB;
import org.influxdb.dto.QueryResult;

public class InfluxQLExample {
    private final InfluxDB influxDB;

    public List&lt;CpuMetric&gt; queryCpuMetrics() {
        String sql = "SELECT MEAN(usage_user) as avg_cpu " +
                     "FROM cpu " +
                     "WHERE time > now() - 1h " +
                     "GROUP BY time(1m), host";

        Query query = new Query(sql, "monitoring");
        QueryResult result = influxDB.query(query);

        return parseResult(result);
    }

    private List&lt;CpuMetric&gt; parseResult(QueryResult result) {
        List&lt;CpuMetric&gt; metrics = new ArrayList&lt;&gt;();

        for (QueryResult.Series series : result.getResults().get(0).getSeries()) {
            String host = series.getTags().get("host");

            for (List&lt;Object&gt; row : series.getValues()) {
                // row[0] = time, row[1] = avg_cpu
                long timestamp = parseTimestamp(row.get(0));
                double avgCpu = ((Number) row.get(1)).doubleValue();

                metrics.add(new CpuMetric(host, timestamp, avgCpu));
            }
        }

        return metrics;
    }
}
```

---

## Flux：函数式新选择

### 基本查询

```flux
from(bucket: "monitoring")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "cpu")
    |> filter(fn: (r) => r._field == "usage_user")
    |> mean()
```

### Flux 核心概念

```
Flux 查询 = 数据源 + 转换函数链

┌──────────────────────────────────────────────────────────────┐
│ from(bucket: "monitoring")                                   │
│     ↓                                                         │
│ range(start: -1h)                                            │
│     ↓                                                         │
│ filter(fn: (r) => r._measurement == "cpu")                   │
│     ↓                                                         │
│ filter(fn: (r) => r._field == "usage_user")                  │
│     ↓                                                         │
│ mean()                                                        │
└──────────────────────────────────────────────────────────────┘
```

### 复杂查询

```flux
// 多表 Join
data1 = from(bucket: "monitoring")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "cpu")

data2 = from(bucket: "monitoring")
    |> range(start: -1h)
    |> filter(fn: (r) => r._measurement == "memory")

join(tables: {cpu: data1, memory: data2}, on: ["host", "_time"])
    |> map(fn: (r) => ({
        host: r.host,
        time: r._time,
        cpu: r._value_cpu,
        memory: r._value_memory
    }))
```

### Java + Flux API

```java
import com.influxdb.client.InfluxQLClient;
import com.influxdb.client.domain.InfluxQL;
import com.influxdb.client.domain.InfluxQLQuery;
import com.influxdb.client.domain.InfluxQLQueryResult;

public class FluxExample {
    private final InfluxQLClient fluxClient;

    // Flux 查询
    public List&lt;Metric&gt; queryWithFlux() {
        String flux = """
            from(bucket: "monitoring")
                |> range(start: -1h)
                |> filter(fn: (r) => r._measurement == "cpu")
                |> filter(fn: (r) => r._field == "usage_user")
                |> mean()
            """;

        InfluxQLQuery query = InfluxQLQuery.builder()
            .flux(flux)
            .organization("myorg")
            .build();

        InfluxQLQueryResult result = fluxClient.query(query);

        return parseFluxResult(result);
    }
}
```

---

## 横向对比

### 1. 时间范围

```sql
-- InfluxQL: WHERE 子句
SELECT * FROM cpu
WHERE time > '2024-01-01T00:00:00Z' AND time < '2024-01-02T00:00:00Z'

-- Flux: range() 函数
from(bucket: "monitoring")
    |> range(start: 2024-01-01T00:00:00Z, stop: 2024-01-02T00:00:00Z)
```

### 2. 聚合

```sql
-- InfluxQL: GROUP BY time
SELECT MEAN(cpu) FROM cpu
WHERE time > now() - 1d
GROUP BY time(1h), host

-- Flux: window() + reduce/mean
from(bucket: "monitoring")
    |> range(start: -1d)
    |> filter(fn: (r) => r._measurement == "cpu")
    |> window(every: 1h)
    |> mean()
```

### 3. Join

```sql
-- InfluxQL: 不支持跨 Measurement Join
-- 需要在应用层处理

-- Flux: 原生支持
data1 = from(bucket: "monitoring") |> range(start: -1h) |> filter(...)
data2 = from(bucket: "monitoring") |> range(start: -1h) |> filter(...)

join(tables: {cpu: data1, memory: data2}, on: ["host", "_time"])
```

### 4. 条件逻辑

```sql
-- InfluxQL: CASE WHEN
SELECT
    CASE
        WHEN cpu > 90 THEN 'critical'
        WHEN cpu > 70 THEN 'warning'
        ELSE 'normal'
    END AS status
FROM cpu

-- Flux: map() + if-else
|> map(fn: (r) => ({
    r with status:
        if r._value > 90 then "critical"
        else if r._value > 70 then "warning"
        else "normal"
}))
```

### 5. 窗口类型

```sql
-- InfluxQL: 固定窗口
GROUP BY time(5m)

-- Flux: 更多窗口类型
|> window(every: 5m)                    // 固定窗口
|> window(every: 5m, period: 10m)     // 跳跃窗口
|> window(every: 5m, createEmpty: true) // 保留空窗口
```

---

## 选择建议

### 用 InfluxQL 的场景

- 快速原型开发
- 简单查询为主
- 从其他 SQL 数据库迁移
- 需要兼容 InfluxDB 1.x

### 用 Flux 的场景

- 需要跨 Measurement Join
- 复杂的数据转换
- 需要流式处理
- InfluxDB 2.x 项目

---

## 面试追问方向

- InfluxQL 和 Flux 的核心设计理念有什么区别？
- 为什么 InfluxDB 2.0 推荐使用 Flux？

下一节，我们来了解 Telegraf 数据采集器。
