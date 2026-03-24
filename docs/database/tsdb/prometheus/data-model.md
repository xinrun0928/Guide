# Prometheus 数据模型：理解 Labels 的艺术

很多人学 Prometheus，第一步就被 Label 搞懵了。

为什么同一个指标要加那么多 Label？Label 多了有什么问题？

今天，我们把这些讲清楚。

---

## Prometheus 的数据模型

Prometheus 使用的是**时序数据模型**，但它和 InfluxDB 完全不同：

```
┌─────────────────────────────────────────────────────────────┐
│                 Metric Family (指标族)                        │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ http_requests_total                                  │  │
│  │                                                     │  │
│  │ Labels: {method="GET", status="200", job="api"}     │  │
│  │                                                     │  │
│  │ Time Series:                                         │  │
│  │ ┌─────────────────────────────────────────────┐   │  │
│  │ │ http_requests_total{method="GET",...}        │   │  │
│  │ │ 2024-01-01 10:00:00  1234                   │   │  │
│  │ │ 2024-01-01 10:01:00  1256                   │   │  │
│  │ │ 2024-01-01 10:02:00  1278                   │   │  │
│  │ └─────────────────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**核心概念**：

- **Metric Name**：指标名称，如 `http_requests_total`
- **Labels**：键值对，用于区分同一指标的不同维度
- **Value**：指标值
- **Timestamp**：时间戳（可选，不提供时自动生成）

---

## Label 的格式

```
{label_name="label_value", label_name2="label_value2"}
```

示例：

```
http_requests_total{method="GET", status="200", job="api"}
http_requests_total{method="POST", status="201", job="api"}
http_requests_total{method="GET", status="404", job="web"}
```

**同一个指标，不同 Label 组合 = 不同的时序**

---

## Metric 类型

Prometheus 有四种指标类型：

### 1. Counter（计数器）

```java
// 只能增不能减，用于累计值
// 示例：请求总数、错误总数、访问次数

public class CounterExample {
    // 错误：把 Counter 当成 Gauge 用
    // counter.inc()  // 会一直累加

    // 正确：用 Counter 记录累计值
    private final Counter requestsTotal = Counter.builder()
        .name("http_requests_total")
        .help("Total HTTP requests")
        .labelNames("method", "status", "path")
        .register();

    public void recordRequest(String method, int status, String path) {
        // 每次请求 +1
        requestsTotal.labels(method, String.valueOf(status), path).inc();
    }
}
```

### 2. Gauge（仪表盘）

```java
// 可增可减，用于瞬时值
// 示例：CPU 使用率、内存占用、在线人数

public class GaugeExample {
    private final Gauge cpuUsage = Gauge.builder()
        .name("cpu_usage_percent")
        .help("CPU usage percentage")
        .labelNames("host")
        .register();

    public void recordCpuUsage(String host, double usage) {
        // 直接设置当前值
        cpuUsage.labels(host).set(usage);
    }

    public void incrementOnlineUsers() {
        onlineUsers.inc();
    }

    public void decrementOnlineUsers() {
        onlineUsers.dec();
    }
}
```

### 3. Histogram（直方图）

```java
// 用于记录分布，用于计算百分位数
// 示例：请求延迟、响应时间

public class HistogramExample {
    private final Histogram requestDuration = Histogram.builder()
        .name("http_request_duration_seconds")
        .help("HTTP request duration in seconds")
        .labelNames("method", "path")
        .buckets(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10)
        .register();

    public void recordDuration(String method, String path, double durationSeconds) {
        requestDuration.labels(method, path).observe(durationSeconds);
    }
}
```

### 4. Summary（摘要）

```java
// 类似 Histogram，但直接在客户端计算百分位数
// 注意：服务端聚合能力弱，不推荐

public class SummaryExample {
    private final Summary requestLatency = Summary.builder()
        .name("http_request_latency_seconds")
        .help("Request latency")
        .quantile(0.5, 0.05)   // p50，允许 ±5% 误差
        .quantile(0.9, 0.01)  // p90
        .quantile(0.99, 0.001) // p99
        .register();
}
```

---

## Label 的最佳实践

### 什么时候加 Label？

```java
// 1. 需要按某个维度区分时
// 正确：按 method 区分
http_requests_total{method="GET"}
http_requests_total{method="POST"}

// 2. 需要聚合时
// 正确：可以聚合
api_requests_total{job="api"}
web_requests_total{job="web"}

// 3. 需要过滤时
// 正确：可以过滤
payment_requests_total{service="payment"}
```

### Label 过多的问题

```java
// 错误：Label 太多会导致 Series 爆炸
http_requests_total{
    method="GET",           // 5 种
    status="200",           // 20 种
    path="/api/v1/users",   // 100 种
    service="api",          // 10 种
    region="us-east"        // 5 种
}
// = 5 * 20 * 100 * 10 * 5 = 500,000 个 Series！
```

**Prometheus 的 Series 数量有限制！**

### 正确做法：高基数 Label 放 Value

```java
// 错误：高基数 Label 导致 Series 爆炸
http_requests_total{user_id="12345"}
http_requests_total{user_id="67890"}
// user_id 有几百万个 = 几百万个 Series

// 正确：用 Histogram 或普通 Label
// 把 user_id 作为 Histogram 的一个观测值记录
request_latency{user_id="12345"}

// 或者：用 cardinality 低的 Label
http_requests_total{service="user-api", operation="getUser"}
```

---

## Java 中的 Prometheus 指标

### Micrometer + Prometheus

```java
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.Timer;

public class PrometheusMetrics {
    private final MeterRegistry registry;
    private final Counter requestsTotal;
    private final Timer requestDuration;

    public PrometheusMetrics(MeterRegistry registry) {
        this.registry = registry;

        // Counter
        this.requestsTotal = Counter.builder("http_requests_total")
            .description("Total HTTP requests")
            .tag("service", "api")
            .register(registry);

        // Timer (Histogram)
        this.requestDuration = Timer.builder("http_request_duration")
            .description("Request duration")
            .publishPercentiles(0.5, 0.9, 0.95, 0.99)
            .register(registry);
    }

    public void recordRequest(String method, String path, long durationMs) {
        // 增加计数
        registry.counter("http_requests_total",
            "method", method,
            "path", normalizePath(path)
        ).increment();

        // 记录延迟
        requestDuration.record(durationMs, TimeUnit.MILLISECONDS);
    }

    private String normalizePath(String path) {
        // 路径参数化，避免高基数
        return path.replaceAll("/users/\\d+", "/users/{id}")
                   .replaceAll("/orders/\\d+", "/orders/{id}");
    }
}
```

---

## 面试追问方向

- Prometheus 的 Label 和 InfluxDB 的 Tag 有什么区别？
- 如何避免 Prometheus 的 Series 爆炸？

下一节，我们来了解 Prometheus 的 Pull vs Push 模式。
