# PromQL：Prometheus 的查询魔法

PromQL 是 Prometheus 的查询语言。

学会了 PromQL，监控数据就能玩出花来。

今天我们从基础到高级，彻底掌握 PromQL。

---

## 基础查询

### 即时查询

```promql
# 查询当前值
http_requests_total

# 带 Label 过滤
http_requests_total{method="GET", status="200"}

# 带 Label 匹配
http_requests_total{method!="DELETE"}
http_requests_total{status=~"2.."}  # 正则匹配
http_requests_total{status!~"2.."}  # 正则不匹配
```

### 区间查询

```promql
# 查询一段时间的数据（返回向量）
http_requests_total[5m]    # 最近 5 分钟
http_requests_total[1h]    # 最近 1 小时
http_requests_total[1d]    # 最近 1 天
```

---

## 聚合操作

### 聚合函数

```promql
# 求和
sum(http_requests_total)

# 平均值
avg(http_requests_total)

# 最大/最小
max(http_requests_total)
min(http_requests_total)

# 计数
count(http_requests_total)

# 标准差
stddev(http_requests_total)

# 变异系数（标准差/平均值）
stdvar(http_requests_total)
```

### 分组聚合

```promql
# 按 Label 分组
sum(http_requests_total) by (method)
sum(http_requests_total) by (status)

# 排除某些 Label
sum(http_requests_total) without (path)

# 只保留某些 Label
sum(http_requests_total) by (job)
```

### 实战：计算请求成功率

```promql
# 成功的请求数 / 总请求数
sum(rate(http_requests_total{status=~"2.."}[5m]))
/
sum(rate(http_requests_total[5m]))
```

---

## Rate 函数：计算增长率

这是 PromQL 最核心的函数家族。

### rate()：平均增长率

```promql
# 5 分钟内的平均每秒请求数
rate(http_requests_total[5m])

# 按 job 分组
sum(rate(http_requests_total[5m])) by (job)
```

### increase()：增长量

```promql
# 5 分钟内的总增长量
increase(http_requests_total[5m])
```

### irate()：瞬时增长率

```promql
# 最后两个数据点的瞬时增长率
irate(http_requests_total[5m])
```

**什么时候用哪个？**

| 函数 | 适用场景 |
|-----|---------|
| rate() | 大多数场景，告警、仪表盘 |
| increase() | 需要计算总量的场景 |
| irate() | 快速变化的指标，尖峰检测 |

---

## 标签操作

### label_replace()

```promql
# 给结果添加/修改标签
label_replace(http_requests_total, "service", "$1", "path", "/api/(.*)")

# 原始: http_requests_total{path="/api/users"}
# 结果: http_requests_total{path="/api/users", service="users"}
```

### label_join()

```promql
# 合并多个标签
label_join(http_requests_total, "endpoint", "-", "method", "path")
```

---

## 时间偏移

```promql
# 查询 5 分钟前的数据
http_requests_total offset 5m

# 昨天同一时刻
http_requests_total offset 1d

# 环比增长率
(http_requests_total - http_requests_total offset 1d)
/
http_requests_total offset 1d
```

---

## 条件过滤

### having / without

```promql
# 只保留 http_requests_total > 100 的 Series
http_requests_total > 100

# 过滤极端值
http_requests_total > on(method, path) group_left
  quantile_over_time(0.95, http_requests_total[5m]) > 100
```

---

## 高级函数

### histogram_quantile()

```promql
# 计算延迟的 95 百分位数
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# 按 path 分开计算
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) by (path, le)
```

### predict_linear()

```promql
# 预测 1 小时后的值
predict_linear(node_filesystem_free_bytes[5m], 3600)
```

### absent()

```promql
# 如果没有数据，返回 1
# 用于检测服务是否下线
absent(up{job="api"})
```

---

## Java 中的 PromQL 查询

### 使用 Prometheus HTTP API

```java
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

public class PromQLClient {
    private final HttpClient httpClient;
    private final String prometheusUrl;

    public PromQLClient(String prometheusUrl) {
        this.prometheusUrl = prometheusUrl;
        this.httpClient = HttpClient.newHttpClient();
    }

    // 即时查询
    public List&lt;QueryResult&gt; query(String promql) throws Exception {
        String url = prometheusUrl + "/api/v1/query?" +
            "query=" + URLEncoder.encode(promql, StandardCharsets.UTF_8);

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .timeout(Duration.ofSeconds(30))
            .GET()
            .build();

        HttpResponse&lt;String&gt; response = httpClient.send(request,
            HttpResponse.BodyHandlers.ofString());

        return parseResponse(response.body());
    }

    // 范围查询
    public List&lt;RangeQueryResult&gt; queryRange(String promql,
            long start, long end, long step) throws Exception {

        String url = prometheusUrl + "/api/v1/query_range?" +
            "query=" + URLEncoder.encode(promql, StandardCharsets.UTF_8) +
            "&start=" + start +
            "&end=" + end +
            "&step=" + step;

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .GET()
            .build();

        HttpResponse&lt;String&gt; response = httpClient.send(request,
            HttpResponse.BodyHandlers.ofString());

        return parseRangeResponse(response.body());
    }
}
```

### 常用查询封装

```java
public class MetricQueries {
    private final PromQLClient client;

    // 计算 QPS
    public double calculateQPS(String job) throws Exception {
        String promql = String.format(
            "sum(rate(http_requests_total{job=\"%s\"}[5m]))",
            job
        );

        List&lt;QueryResult&gt; results = client.query(promql);
        if (results.isEmpty()) {
            return 0.0;
        }
        return Double.parseDouble(results.get(0).getValue());
    }

    // 计算 P99 延迟
    public double calculateP99Latency(String job, String path) throws Exception {
        String promql = String.format(
            "histogram_quantile(0.99, " +
            "  sum(rate(http_request_duration_seconds_bucket{job=\"%s\", path=\"%s\"}[5m])) by (le)" +
            ")",
            job, path
        );

        List&lt;QueryResult&gt; results = client.query(promql);
        if (results.isEmpty()) {
            return 0.0;
        }
        return Double.parseDouble(results.get(0).getValue());
    }

    // 计算成功率
    public double calculateSuccessRate(String job) throws Exception {
        String promql = String.format(
            "sum(rate(http_requests_total{job=\"%s\", status=~\"2..\"}[5m])) / " +
            "sum(rate(http_requests_total{job=\"%s\"}[5m]))",
            job, job
        );

        List&lt;QueryResult&gt; results = client.query(promql);
        if (results.isEmpty()) {
            return 0.0;
        }
        return Double.parseDouble(results.get(0).getValue()) * 100;
    }

    // 获取 Top N
    public List&lt;String&gt; getTopCPUUsers(int n) throws Exception {
        String promql = "topk(" + n + ", sum by (user) (rate(process_cpu_seconds_total[5m])))";

        List&lt;QueryResult&gt; results = client.query(promql);
        return results.stream()
            .map(r -> r.getMetric().get("user") + ": " + r.getValue())
            .collect(Collectors.toList());
    }
}
```

---

## Grafana 集成

```java
// Grafana API 查询（通过 Prometheus 数据源）
public class GrafanaDashboard {
    private final String grafanaUrl;
    private final String grafanaToken;

    public Map&lt;String, Object&gt; executeDashboardQuery(
            String panelId, long from, long to) throws Exception {

        String json = String.format("""
            {
                "queries": [
                    {
                        "refId": "A",
                        "expr": "rate(http_requests_total[5m])",
                        "datasourceId": 1
                    }
                ],
                "from": "%d",
                "to": "%d"
            }
            """, from, to);

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(grafanaUrl + "/api/ds/query"))
            .header("Authorization", "Bearer " + grafanaToken)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(json))
            .build();

        HttpResponse&lt;String&gt; response = httpClient.send(request,
            HttpResponse.BodyHandlers.ofString());

        return parseGrafanaResponse(response.body());
    }
}
```

---

## 面试追问方向

- rate() 和 increase() 有什么区别？什么时候用哪个？
- PromQL 支持子查询吗？如何优化复杂查询？

下一节，我们来了解 Prometheus 的告警机制。
