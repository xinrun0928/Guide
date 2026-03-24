# Prometheus 数据模型与指标类型

「Prometheus 怎么存储指标？」——四类指标，四种用途。

Prometheus 的数据模型看似简单——时序数据，但理解 Counter、Gauge、Histogram、Summary 的区别，是用好 Prometheus 的前提。用错了指标类型，查询结果会让人困惑。

## 数据模型

```
┌─────────────────────────────────────────────────────────────────┐
│                 Prometheus 时间序列（Time Series）                   │
│                                                                  │
│  指标名 + 标签集 = 时间序列标识符                                │
│                                                                  │
│  api_http_requests_total{method="GET", status="200", service="order"}│
│         │                              │                           │
│    指标名                         标签（Label）                    │
│                                                                  │
│  样本（Sample）                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  timestamp: 1700000000.123                                 │  │
│  │  value: 1234567.89                                         │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 指标名称规范

```
# 格式：<metric_name>{<label_name>="<label_value>", ...}

# 命名规则：
# 1. 必须匹配 [a-zA-Z_:][a-zA-Z0-9_:]*
# 2. 建议格式：<namespace>_<name>[_<unit>]
# 3. 单位用后缀：_seconds、_bytes、_total（速率基数）

# 好命名
api_http_requests_total{method="GET"}
node_memory_Bytes_total
container_cpu_usage_seconds_total

# 差命名
APILatency (大写、缩写)
latency_in_milliseconds_double (单位重复)
```

### 标签的学问

```
# 标签决定查询维度
# 但高基数（Cardinality）标签会毁掉 Prometheus！

# 差：高基数标签
{user_id="12345"}      # 百万级用户 = 百万个时间序列
{session_id="abc"}     # 会话 ID
{request_id="xyz"}     # 请求 ID

# 好：低基数标签
{method="GET", status="200", service="order"}
{env="prod", region="us-east-1"}
{namespace="production", app="order-service"}
```

## 四种指标类型

### Counter（计数器）

```
┌─────────────────────────────────────────────────────────────────┐
│                    Counter 特点                                    │
│                                                                  │
│  只增不减                                                      │
│  用于：请求总数、错误总数、安装次数                              │
│                                                                  │
│  1700000000: 1000                                              │
│  1700000005: 1005  ────► +5（5 秒内新增 5 个请求）              │
│  1700000010: 1012                                              │
│                                                                  │
│  查询：rate(api_http_requests_total[5m])                        │
│  rate() 计算每秒增长率                                          │
└─────────────────────────────────────────────────────────────────┘
```

```promql
# 示例：HTTP 请求总数
api_http_requests_total{method="GET", status="200"}

# 速率查询
# 每秒请求数
rate(api_http_requests_total[5m])
# 5 分钟内的请求总数
increase(api_http_requests_total[5m])

# 错误率
rate(http_requests_total{status=~"5.."}[5m])
  / rate(http_requests_total[5m]) * 100
```

### Gauge（仪表盘）

```
┌─────────────────────────────────────────────────────────────────┐
│                    Gauge 特点                                     │
│                                                                  │
│  可增可减                                                      │
│  用于：当前 CPU 使用率、内存使用量、在线人数                      │
│                                                                  │
│  时间 ────►                                                   │
│  │                                                            │
│  80% ───────┐                                                │
│  65% ───┐    │    波动：增加后减少                           │
│  70% ───┴────┘                                                │
│  55% ─────────────                                            │
│  50% ────────────                                              │
└─────────────────────────────────────────────────────────────────┘
```

```promql
# 示例：当前在线用户数
current_users_online

# 查询当前值
current_users_online{service="order"}

# CPU 使用率
100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100

# 内存使用率
100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))
```

### Histogram（直方图）

```
┌─────────────────────────────────────────────────────────────────┐
│                 Histogram：服务端分位数计算                        │
│                                                                  │
│  请求延迟分布：                                                │
│                                                                  │
│  请求桶（cumulative counter）：                                    │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ le (≤ latency) │ count (累积请求数)                       │  │
│  ├───────────────┼───────────────┤                             │
│  │ ≤ 0.1s        │ 8500           │                             │
│  │ ≤ 0.5s        │ 9800           │                             │
│  │ ≤ 1s          │ 9950           │                             │
│  │ ≤ 5s          │ 9990           │                             │
│  │ ≤ +∞          │ 10000 (总计)    │                             │
│  └───────────────┴───────────────┘                             │
│                                                                  │
│  Prometheus 在服务端聚合，跨实例计算分位数                         │
└─────────────────────────────────────────────────────────────────┘
```

```promql
# 分位数查询
# P50 (中位数)
histogram_quantile(0.5,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le))

# P99
histogram_quantile(0.99,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le))

# P999
histogram_quantile(0.999,
  sum(rate(http_request_duration_seconds_bucket[5m])) by (le))
```

```java
// Java 代码中暴露 Histogram
// Micrometer / OpenTelemetry
http_request_duration_seconds
  .record(Duration.ofMillis(latencyMs));
```

### Summary（摘要）

```
┌─────────────────────────────────────────────────────────────────┐
│                 Summary：客户端分位数计算                         │
│                                                                  │
│  在客户端计算分位数，传输最终结果                                 │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │ 指标名                            │ 样本值                │    │
│  ├─────────────────────────────────┼───────────────────────┤    │
│  │ http_request_duration_seconds    │ 分母（总请求数）        │    │
│  │ http_request_duration_seconds_sum │ 延迟总和                │    │
│  │ http_request_duration_seconds{quantile="0.5"} │ P50 值  │    │
│  │ http_request_duration_seconds{quantile="0.99"} │ P99 值 │    │
│  └─────────────────────────────────┴───────────────────────┘    │
│                                                                  │
│  ⚠ 跨实例查询分位数时，结果是估算值！                           │
└─────────────────────────────────────────────────────────────────┘
```

```promql
# Summary 查询（注意：这是每个实例的原始分位数）
# 直接聚合 Summary 分位数是错误的！
# 错误：
sum(rate(http_request_duration_seconds{quantile="0.99"}[5m]))
# 这会返回没有意义的值

# 正确：使用 Histogram 做服务端聚合
# Summary 的 sum 和 count 用于追踪，不用于聚合
http_request_duration_seconds_sum
http_request_duration_seconds_count
```

## Histogram vs Summary：核心区别

| 维度 | Histogram | Summary |
|------|----------|---------|
| 分位数计算 | 服务端（PromQL `histogram_quantile`） | 客户端（SDK 计算） |
| 跨实例聚合 | ✓ 完美支持 | ✗ 聚合后是估算值 |
| 存储开销 | 高（每个 bucket 一个时间序列） | 低（固定几个分位数） |
| 精度 | 取决于 bucket 划分 | 精确（SDK 计算） |
| 自定义分位数 | 需要重新部署 | 只需配置 SDK |
| 适用场景 | 需要跨实例聚合 | 单实例或已知数据分布 |

```
选择原则：
1. 需要跨实例聚合分位数？ → Histogram
2. 单实例监控、精确分位数？ → Summary
3. 不确定？ → Histogram
```

## OpenTelemetry 中的指标

```java
// OpenTelemetry Metrics SDK
import io.opentelemetry.api.metrics.*;

Meter meter = meterProvider.get("order-service");

// Counter
LongCounter requestCounter = meter.counterBuilder("http.requests")
    .setDescription("HTTP 请求总数")
    .setUnit("requests")
    .build();
requestCounter.add(1,
    Attributes.builder()
        .put("method", "GET")
        .put("status", 200)
        .build());

// Histogram（推荐用于延迟）
DoubleHistogram latencyHistogram = meter.histogramBuilder("http.request.duration")
    .setDescription("HTTP 请求延迟")
    .setUnit("ms")
    .setExplicitBucketBoundariesAdvice(
        List.of(5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 500.0, 1000.0))
    .build();
latencyHistogram.record(latencyMs);

// UpDownCounter（双向 Gauge）
LongUpDownCounter activeConnections = meter.upDownCounterBuilder("http.active.connections")
    .setDescription("活跃连接数")
    .build();
activeConnections.add(1);  // 连接建立
activeConnections.add(-1); // 连接关闭
```

## 常见错误

```
# 错误一：用 Counter 记录当前值
# Counter 只能增，不能减，不能记录「当前在线人数」
# 应该用 Gauge：
current_users_online{service="order"}

# 错误二：Histogram bucket 划分不当
# bucket 划分太粗，P99 精度差
# 应该在关键阈值附近加密 bucket：
# 比如关键阈值是 500ms
0.1, 0.25, 0.5, 0.75, 1.0, 2.5, 5.0 (500ms), 7.5, 10.0
#                                     ▲ 在这里加密

# 错误三：高基数标签
# 千万级时间序列会压垮 Prometheus
# 禁止用 user_id、session_id、request_id 作为标签

# 错误四：Summary 做服务端聚合
# Summary 的 quantile 值不能直接 sum/avg
# 跨实例 P99 要用 Histogram + histogram_quantile()
```

## 面试追问方向

1. **Histogram 和 Summary 的核心区别是什么？**
   答：Histogram 在服务端通过 `histogram_quantile()` 计算分位数，可以完美跨实例聚合；Summary 在客户端计算分位数，传输到 Prometheus 后是最终值，多实例时直接聚合无意义。Histogram 适合需要跨实例聚合的场景；Summary 适合单实例或已知数据分布。

2. **Prometheus 如何处理高基数问题？**
   答：Prometheus 本身不擅长处理高基数（Cardinality）。高基数标签（user_id、session_id）会导致指标数量爆炸，影响查询性能甚至 OOM。解决方案：避免高基数标签；用 `_total` + `rate()` + `increase()` 代替记录原始值；考虑使用 `__name__` 前缀过滤。

3. **Histogram 的 bucket 划分有什么讲究？**
   答：bucket 应该在关键阈值附近加密。比如 SLA 是 200ms，则 bucket 应该在 100ms、200ms、300ms、500ms 处划分，而不是线性划分（10、20、30、40...）。这样 `histogram_quantile(0.99)` 的结果能精确反映 SLA 达标率。

4. **指标数量过多会影响 Prometheus 吗？**
   答：会。每个指标每个时间序列约占用 1KB~2KB 内存。10 万个时间序列约占用 100MB~200MB。超过 100 万个时间序列需要仔细规划查询和资源。解决方案：减少不必要的标签组合，使用 metric_relabel_configs 过滤不需要的指标。

理解四种指标类型，是 Prometheus 监控的基石。用对了，PromQL 查询清晰简洁；用错了，排查问题时会怀疑人生。
