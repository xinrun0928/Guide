# Prometheus + Grafana 监控体系

「我的集群到底健不健康？」——Prometheus 负责回答这个问题，Grafana 负责把这个答案可视化。

监控是 K8s 运维的眼睛。没有监控，你不知道集群是否健康；没有告警，你不知道问题什么时候发生的；没有趋势分析，你不知道容量什么时候会耗尽。Prometheus + Grafana 是 K8s 监控的事实标准。

## Prometheus 的数据模型

Prometheus 采集的是**时间序列数据（Time Series）**，每条数据由四部分组成：

```
指标名称{标签键=标签值, ...}  采样值  采样时间戳

# 示例
kube_pod_container_resource_requests{node="node-1", namespace="production", resource="cpu", unit="core"} 0.5 1704067200000
kube_pod_container_resource_limits{node="node-1", namespace="production", resource="memory", unit="byte"} 1.073741824e+09
```

### 四种指标类型

| 类型 | 说明 | 典型应用 |
|------|------|---------|
| Counter | 只增不减的计数器 | 请求总数、错误总数 |
| Gauge | 可增可减的仪表值 | CPU 使用率、内存占用、当前连接数 |
| Histogram | 统计分布直方图 | 请求延迟、响应大小 |
| Summary | 统计摘要 | 同 Histogram，但直接输出分位数 |

```java
// Histogram 示例（Java 应用暴露请求延迟）
// Prometheus 会自动生成以下指标：
// http_request_duration_seconds_bucket{le="0.1"}  1000   // 延迟 <= 0.1s 的请求数
// http_request_duration_seconds_bucket{le="0.5"}  2000  // 延迟 <= 0.5s 的请求数
// http_request_duration_seconds_bucket{le="1.0"}  2500
// http_request_duration_seconds_bucket{le="+Inf"} 3000  // 总请求数
// http_request_duration_seconds_sum                  // 延迟总和
// http_request_duration_seconds_count                // 请求计数
Histogram httpRequestLatency = Histogram.build()
    .name("http_request_duration_seconds")
    .help("HTTP request latency in seconds")
    .labelNames("method", "endpoint", "status")
    .buckets(0.01, 0.05, 0.1, 0.5, 1.0, 5.0)
    .register();
```

## Prometheus 架构

```
┌──────────────────────────────────────────────────────────┐
│                    Prometheus Server                      │
│                                                          │
│  ┌──────────────┐    ┌────────────────┐                  │
│  │  Retrieval   │───►│   TSDB         │                  │
│  │  (抓取组件)   │    │  (时序数据库)   │                  │
│  └──────┬───────┘    └────────────────┘                  │
│         │                    ▲                           │
│         ▼                    │                           │
│  ┌──────────────┐    ┌────────────────┐                  │
│  │ HTTP Server  │◄───│  Alertmanager  │                  │
│  │ (查询接口)    │    │  (告警管理)    │                  │
│  └──────┬───────┘    └────────────────┘                  │
└─────────┼─────────────────────────────────────────────────┘
          │
    ┌─────┴─────────────────────────────────────────────┐
    │                      Targets                       │
    │                                                      │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
    │  │ kube-state- │  │  node-      │  │  Application│ │
    │  │ metrics     │  │  exporter   │  │  Pods       │ │
    │  │ (K8s 资源)  │  │ (节点资源)  │  │ (自定义指标) │ │
    │  └─────────────┘  └─────────────┘  └─────────────┘ │
    └─────────────────────────────────────────────────────┘
```

### 核心组件

| 组件 | 作用 |
|------|------|
| Retrieval | 定期从 targets 抓取指标（默认 15s） |
| TSDB | 时序数据库，存储指标数据（默认 15 天保留） |
| HTTP Server | 提供 PromQL 查询接口和 UI |
| Alertmanager | 接收告警，分组、去重、路由、发送 |

## 在 K8s 中部署 Prometheus

### 方式一：kube-prometheus-stack（推荐）

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  --set prometheus.prometheusSpec.retention=30d \
  --set prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.resources.requests.storage=100Gi \
  --set grafana.persistence.enabled=true \
  --set grafana.persistence.size=10Gi
```

### 方式二：Prometheus Operator（手动管理）

```yaml
# 核心 CRD
apiVersion: monitoring.coreos.com/v1
kind: Prometheus
metadata:
  name: k8s
  namespace: monitoring
spec:
  replicas: 2
  retention: 30d
  serviceAccountName: prometheus
  serviceMonitorSelector:
    matchLabels:
      team: platform
  ruleSelector:
    matchLabels:
      role: alert-rules
---
# ServiceMonitor：定义抓取哪些服务的指标
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: api-backend
  namespace: monitoring
  labels:
    team: platform
spec:
  selector:
    matchLabels:
      app: api-backend
  endpoints:
    - port: metrics
      path: /metrics
      interval: 15s
```

## PromQL 常用查询

```promql
# CPU 使用率
sum(rate(container_cpu_usage_seconds_total{namespace="production"}[5m])) by (pod)
  /
sum(container_spec_cpu_quota{namespace="production"} / container_spec_cpu_period{namespace="production"}) by (pod)
  * 100

# 内存使用率
sum(container_memory_working_set_bytes{namespace="production"}) by (pod)
  /
sum(container_spec_memory_limit_bytes{namespace="production"}) by (pod)
  * 100

# Pod 数量（按 namespace）
count by (namespace) (kube_pod_info)

# 请求 QPS（按服务）
sum(rate(http_requests_total{service="api"}[5m])) by (service)

# P99 延迟（Histogram）
histogram_quantile(0.99,
  sum(rate(http_request_duration_seconds_bucket{service="api"}[5m])) by (le)
)

# Pod 重启次数（异常检测）
sum(delta(kube_pod_container_status_restarts_total[1h])) by (pod, namespace) > 5

# PVC 使用量
kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes * 100
```

## Grafana 仪表盘

### 推荐仪表盘 ID

Grafana 支持通过 ID 导入社区仪表盘：

| 仪表盘 | ID | 用途 |
|-------|-----|------|
| Kubernetes / Views / Global | 15757 | K8s 全局视图 |
| Kubernetes / Views / Namespaces | 15758 | Namespace 级别 |
| Kubernetes / Views / Nodes | 15759 | 节点监控 |
| Kubernetes / Views / Pods | 15760 | Pod 监控 |
| Prometheus / Stats | 2 | Prometheus 自身状态 |

```bash
# 通过 Grafana API 导入
GRAFANA_URL="http://grafana:3000"
GRAFANA_TOKEN="Bearer eyJr..."

curl -X POST "${GRAFANA_URL}/api/dashboards/import" \
  -H "Authorization: ${GRAFANA_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"id": 15757, "overwrite": true}'
```

## Alertmanager 告警配置

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: k8s-alerts
  namespace: monitoring
spec:
  groups:
    - name: k8s-resources
      interval: 30s
      rules:
        # Pod CPU 使用率 > 80%
        - alert: HighCpuUsage
          expr: |
            sum(rate(container_cpu_usage_seconds_total{namespace!="", pod!=""}[5m])) by (namespace, pod)
              / sum(container_spec_cpu_quota{namespace!=""} / container_spec_cpu_period{namespace!=""}) by (namespace, pod) * 100 > 80
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Pod {{ $labels.pod }} CPU 使用率过高"
            description: "{{ $labels.namespace }}/{{ $labels.pod }} CPU 使用率 {{ $value | printf \"%.2f\" }}%"

        # Pod OOMKilled
        - alert: PodOOMKilled
          expr: increase(kube_pod_container_status_restarts_total{reason="OOMKilled"}[1h]) > 0
          for: 0m
          labels:
            severity: critical
          annotations:
            summary: "Pod {{ $labels.pod }} 被 OOMKilled"
            description: "{{ $labels.namespace }}/{{ $labels.pod }} 过去 1 小时被 OOMKilled {{ $value }} 次"
```

### Alertmanager 路由配置

```yaml
apiVersion: monitoring.coreos.com/v1
kind: AlertmanagerConfig
metadata:
  name: alert-routing
  namespace: monitoring
spec:
  receivers:
    - name: default
      webhookConfigs:
        - url: http://alert-dingtalk:5000/dingtalk
    - name: critical
      webhookConfigs:
        - url: http://alert-dingtalk:5000/dingtalk-critical
  route:
    groupBy: ['alertname', 'namespace']
    groupWait: 30s
    groupInterval: 5m
    repeatInterval: 4h
    receiver: default
    routes:
      - match:
          severity: critical
        receiver: critical
        continue: true
```

## 常见问题

### Prometheus 存储满了

```yaml
# 定期清理旧数据（Compaction）
prometheus.prometheusSpec.retention: 15d
# 或者扩容存储
storageSpec:
  volumeClaimTemplate:
    spec:
      resources:
        requests:
          storage: 200Gi
```

### 指标采集延迟

Prometheus 默认 15 秒抓取一次，对于快速变化的指标可能不够：
```yaml
spec:
  scrapeInterval: 10s
```

### 大量 metrics endpoints 导致性能问题

Prometheus 的处理能力有限（单实例约 10 万指标），建议分片：

```yaml
spec:
  shards: 2    # 两个 Prometheus 实例，分片采集
```

## 面试追问方向

- Counter、Histogram、Summary 三种指标类型的区别是什么？什么场景下用哪个？
- Prometheus 的 `rate()` 和 `increase()` 有什么区别？各自在什么情况下使用？
- `histogram_quantile(0.99, ...)` 计算的是什么？有什么局限性？
- Alertmanager 的 `groupBy`、`groupWait`、`groupInterval` 各起什么作用？

> Prometheus + Grafana 是 K8s 可观测性的基础设施。Prometheus 负责采集和存储，Grafana 负责可视化，Alertmanager 负责告警——三者配合，构成了完整的监控闭环。
