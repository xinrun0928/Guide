# PromQL 进阶：聚合、子查询、记录规则

「PromQL 怎么写出高效查询？」——学会这三种技巧，告别复杂查询。

基础 PromQL 你可能已经会了：`rate(http_requests_total[5m])`。但当指标数量爆炸、查询超时告警频发时，你需要进阶技巧：聚合运算符、子查询、记录规则。掌握它们，让你的 Prometheus 查询从「能跑」到「跑得快」。

## 聚合运算符

### 基本聚合

```promql
# 基础聚合函数
sum(http_requests_total)                    # 求和
min(http_requests_total)                    # 最小值
max(http_requests_total)                     # 最大值
avg(http_requests_total)                     # 平均值
stddev(http_requests_total)                  # 标准差（评估稳定性）
stdvar(http_requests_total)                  # 方差

# 计数
count(http_requests_total)                   # 计数（多少条时间序列）
count_values("value", http_requests_total)   # 统计相同值的数量

# 分位数
quantile(0.95, http_request_duration_seconds_bucket)
```

### 按标签分组（by）

```promql
# 按 service 标签求和
sum by (service) (http_requests_total)
# 结果：{service="order"} 10000, {service="payment"} 5000

# 按 service 和 method 求和
sum by (service, method) (http_requests_total)
# 结果：{service="order", method="GET"} 8000, {service="order", method="POST"} 2000

# 包含 labels 求和（不含的标签被忽略）
sum by (service) (http_requests_total)
```

### 排除标签（without）

```promql
# 求和，但排除 instance 标签（只看总量，不区分实例）
sum without (instance) (http_requests_total)
# 等价于 sum by (service, method, status, ...) (http_requests_total)

# without 通常比 by 更简洁，因为排除的标签往往是无关的
```

### 保留标签（keep/cut）

```promql
# 保留标签（Prometheus 2.x 不支持，是 VictoriaMetrics 扩展）
# topk / bottomk 自动保留标签
topk(5, http_requests_total)          # 取 Top 5，保留所有标签
bottomk(3, http_requests_total)       # 取 Bottom 3

# 使用 on/ignoring 修饰符做连接
# 忽略某个标签后再做聚合
```

### 进阶：count_values

```promql
# 统计各状态码出现次数
count_values("status_code", http_requests_total{status=~"2.."})
# 结果：{status_code="200"} 9500, {status_code="201"} 500

# 统计各版本实例数量
count_values("version", up{job="order-service"})
# 结果：{version="v1.0"} 3, {version="v1.1"} 5, {version="v1.2"} 2
```

## 向量匹配

### 一对一匹配（默认）

```promql
# 两个向量中完全匹配的样本配对
# 只返回标签完全相同的样本
http_requests_total{instance=~".*"}
  /
scrape_duration_seconds{instance=~".*"}
```

### 一对多 / 多对一（group_left / group_right）

```promql
# 场景：Pod CPU 使用率 = Pod CPU / Node CPU
# Pod CPU 是多实例，Node CPU 是单实例
# Pod CPU 需要「复制」Node CPU 的值

# 错误写法：维度不匹配，无法除
# pod_cpu_usage_seconds_total / node_cpu_usage_seconds_total

# 正确写法：Pod 维度向 Node 维度扩展
sum by (pod, namespace) (rate(container_cpu_usage_seconds_total{container!=""}[5m]))
  /
on(node) group_left()
sum by (node) (rate(node_cpu_usage_seconds_total[5m]))
#              ▲           ▲
#         匹配 key         Pod 标签是 group_left（多）
#                              Node 标签是 group_right（单）
```

### ignoring / on 修饰符

```promql
# ignoring：连接前忽略某些标签
# on：只使用指定标签做连接

# 忽略 version 标签后连接
http_requests_total{version=~".*"}
  ignoring(version)
  / app_info{version=~".*"}

# 只使用 service 和 method 标签做连接
sum by (service) (http_requests_total)
  on(service)
  sum by (service) (app_errors_total)
```

## 子查询

### 基本语法

```promql
# 子查询 = 外层查询(内层查询[窗口:步长])
# 外层 PromQL(内层 PromQL[内层窗口:步长])

# 语法：[start:end:step]
# start: 时间范围起点（相对于 end 的偏移）
# end: 时间范围终点（默认 now）
# step: 内层查询的步长

# 示例：最近 1 小时内，每 5 分钟查询一次，计算最大值趋势
max_over_time(
  rate(http_requests_total[5m])[1h:5m]
)
# 等价于：
# 从 now-1h 到 now，每 5 分钟执行一次 rate(http_requests_total[5m])
# 对这 12 个结果取 max
```

### 实战：计算变化率

```promql
# 计算 5 分钟内请求数的最大增长率
max_over_time(
  increase(http_requests_total[5m])[1h:5m]
)

# 计算 10 分钟窗口内的 P99 延迟
# 每 2 分钟评估一次
histogram_quantile(0.99,
  max by (le) (
    rate(http_request_duration_seconds_bucket[10m])[1h:2m]
  )
)
```

### 性能陷阱

```promql
# 陷阱：子查询不写步长，默认按外层查询的 resolution
# 这会导致内层查询非常密集，Prometheus 负担加重

# 错误
max_over_time(rate(http_requests_total[5m])[1h:])

# 正确：明确指定步长，减少内层查询次数
max_over_time(rate(http_requests_total[5m])[1h:1m])
```

## 记录规则

### 为什么需要记录规则

```
┌─────────────────────────────────────────────────────────────────┐
│              记录规则：预计算，查询快                                │
│                                                                  │
│  问题：                                                        │
│  P99 延迟查询，需要聚合 10 个实例，每个实例 100 个 bucket         │
│  查询时计算 = 10 × 100 × rate × histogram_quantile            │
│  每次 Dashboard 刷新都要重新计算 → 慢 → 超时                     │
│                                                                  │
│  解决：记录规则                                                  │
│  预先计算好 = 预聚合结果（1 条时间序列）                           │
│  查询时直接读 = 单条时间序列查询 → 快                              │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  预计算（后台，每 30s）                                  │    │
│  │  :http_request_duration_p99 = histogram_quantile(0.99,  │    │
│  │    sum by (service, le) (rate(http_request_duration_    │    │
│  │    seconds_bucket[5m]))                                │    │
│  │                                                         │    │
│  │  查询时：                                               │    │
│  │  :http_request_duration_p99{service="order"}            │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 配置记录规则

```yaml
# prometheus.yml
rule_files:
  - "/etc/prometheus/rules/*.yml"

# /etc/prometheus/rules/service-level.yml
groups:
  # 名称格式：<group>:<metric>:<aggregation-opERATION>
  - name: service-level
    interval: 30s
    rules:
      # 服务请求率（每秒请求数）
      - record: service:http_requests_total:rate5m
        expr: |
          sum by (service, method, status) (
            rate(http_requests_total[5m])
          )

      # 服务错误率
      - record: service:http_error_rate:rate5m
        expr: |
          sum by (service) (
            rate(http_requests_total{status=~"5.."}[5m])
          )
          /
          sum by (service) (
            rate(http_requests_total[5m])
          )

      # P99 延迟（聚合后计算分位数）
      - record: service:http_request_duration_seconds:p99_rate5m
        expr: |
          histogram_quantile(0.99,
            sum by (service, le) (
              rate(http_request_duration_seconds_bucket[5m])
            )
          )

      # Pod CPU 使用率（跨 Namespace 聚合）
      - record: namespace:container_cpu_usage_seconds_total:sum_rate5m
        expr: |
          sum by (namespace, pod) (
            rate(container_cpu_usage_seconds_total{container!=""}[5m])
          )
```

### 记录规则命名规范

```
# 格式：<labels>:<metric>:<aggregation-opERATION>
# labels: 分组标签（聚合维度）
# metric: 原指标名
# aggregation-opERATION: 聚合操作

service:http_requests_total:rate5m
# service = 分组维度（按 service 聚合）
# http_requests_total = 原指标名
# rate5m = 聚合操作（5m 内的 rate）

namespace:container_cpu_usage_seconds_total:sum_rate5m
# namespace = 分组维度
# container_cpu_usage_seconds_total = 原指标名
# sum_rate5m = sum + 5m 窗口
```

### 记录规则 vs 告警规则

| 维度 | 记录规则 | 告警规则 |
|------|---------|---------|
| 目的 | 预计算，查询加速 | 条件触发，发送通知 |
| 评估结果 | 写入 TSDB，供查询 | 发送给 AlertManager |
| `for` 子句 | 无 | 有（持续时间） |
| labels | 自定义 | 告警标签（severity, team） |
| annotations | 无 | 有（summary, description） |

## 常用 PromQL 模板

### 服务级 SLA

```promql
# 服务可用性 = 成功请求 / 总请求
100
  - (
    sum by (service) (
      rate(http_requests_total{status=~"5.."}[5m])
    )
    /
    sum by (service) (
      rate(http_requests_total[5m])
    ) * 100
  )
```

### Pod 健康状态

```promql
# Running Pod 占比
sum by (namespace, job) (
  kube_pod_status_phase{phase="Running"}
)
/
count by (namespace, job) (
  kube_pod_status_phase
)
```

### 容量预测

```promql
# 基于过去 7 天的增长率，预测 30 天后的磁盘使用率
# 假设增长率线性
(
  # 当前磁盘使用率
  1 - (
    sum by (instance) (node_filesystem_avail_bytes{mountpoint="/"})
    /
    sum by (instance) (node_filesystem_size_bytes{mountpoint="/"})
  )
)
+
(
  # 7 天增长率 × 4（30天 ≈ 4 × 7天）
  4 * (
    (
      1 - (
        sum by (instance) (node_filesystem_avail_bytes{mountpoint="/"} offset 7d)
        /
        sum by (instance) (node_filesystem_size_bytes{mountpoint="/"})
      )
    )
    -
    (
      1 - (
        sum by (instance) (node_filesystem_avail_bytes{mountpoint="/"})
        /
        sum by (instance) (node_filesystem_size_bytes{mountpoint="/"})
      )
    )
  )
)
```

## 常见错误

```
# 错误一：忘记除以 rate，查询的是原始计数器增量
# 错误：查询了「过去 5 分钟的总请求数」而不是「每秒请求数」
sum(increase(http_requests_total[5m]))

# 正确：除以时间窗口得到速率，或直接用 rate()
rate(http_requests_total[5m])

# 错误二：高基数标签导致查询慢
# 错误：按 request_id 聚合（百万级唯一值）
count by (request_id) (http_requests_total)

# 正确：按业务标签聚合
count by (service, method) (http_requests_total)

# 错误三：子查询不指定步长
# 错误：内层查询步长太大，P99 精度差
histogram_quantile(0.99,
  sum by (le) (rate(http_request_duration_seconds_bucket[5m]))[1h:]
)

# 正确：内层查询步长 = 外层查询步长 = 1m
histogram_quantile(0.99,
  sum by (le) (rate(http_request_duration_seconds_bucket[5m]))[1h:1m]
)

# 错误四：记录规则名称不够描述性
# 错误：指标名无意义
- record: a
  expr: http_requests_total

# 正确：指标名自解释
- record: service:http_requests_total:rate5m
  expr: sum by (service) (rate(http_requests_total[5m]))
```

## 面试追问方向

1. **Prometheus 如何处理「当前时间点没有样本」的情况？**
   答：Prometheus 在查询时，会对时间戳做插值（默认使用前一个样本的值）。如果一个时间序列超过 5 分钟没有样本，会被认为是 stale，不参与聚合。可以用 `or vector(0)` 强制填充 0 值。

2. **子查询和记录规则如何选择？**
   答：子查询适合一次性探索性分析，不需要持久化；记录规则适合 Dashboard 频繁查询的复杂指标，预计算后查询更快。如果同一个查询在多个 Dashboard 中使用，就该写成记录规则。

3. **Prometheus 的查询超时如何处理？**
   答：Prometheus Server 有 `query.timeout`（默认 2 分钟）和 `query.max-samples`（默认 5 亿）限制。超过限制会返回部分结果并记录日志。解决方案：使用 recording rules 预计算；减少查询范围；优化 PromQL（先聚合再计算分位数）。

4. **`count_values` 和 `topk/bottomk` 的区别是什么？**
   答：`count_values` 统计相同值出现的次数，返回的是「值 → 频次」映射；`topk/bottomk` 返回最大/最小的 k 条时间序列，保留所有标签，适合找异常实例。两者都会增加查询时间，需要注意 Cardinality。

PromQL 是 Prometheus 的灵魂。学会这三种技巧，你的监控查询会快人一步。
