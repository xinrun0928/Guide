# KubeSphere 多租户监控：MetricsServer 与自定义监控

「每个团队能看到多少监控数据？」——多租户监控帮你划清边界。

KubeSphere 的监控体系基于 Prometheus + Grafana 构建，但做了多租户隔离增强。每个 Workspace、每个 Project 的用户只能看到自己权限范围内的监控数据，既保证了数据安全，又避免了相互干扰。

## 监控架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    KubeSphere 监控架构                             │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Prometheus Stack                          │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │              Prometheus Server                        │   │   │
│  │  │                                                      │   │   │
│  │  │  ServiceMonitor（K8s 原生服务发现）                   │   │   │
│  │  │  PodMonitor（Pod 级别指标）                           │   │   │
│  │  │  NodeExporter（节点指标）                            │   │   │
│  │  │  kube-state-metrics（K8s 对象状态）                 │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │              Alertmanager                              │   │   │
│  │  │  告警聚合 → 抑制 → 静默 → 通知                      │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                │                                      │
│  ┌─────────────────────────────┴──────────────────────────────┐   │
│  │                    KubeSphere 监控视图                        │   │
│  │                                                          │   │
│  │  Workspace A → Project A → 只能看 myapp 的指标              │   │
│  │  Workspace B → Project B → 只能看 payment 的指标           │   │
│  │  平台管理员 → 全局 → 看到所有服务的指标                      │   │
│  │                                                          │   │
│  │  Grafana Dashboard（多租户视图）                            │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 监控数据类型

### 集群级指标

```bash
# 节点指标
# - CPU 使用率 / 负载
# - 内存使用率
# - 磁盘使用率 / IO
# - 网络流量
# - 进程数
# PromQL 示例
# 节点 CPU 使用率
100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)
# 节点内存使用率
100 - (avg by (instance) (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100)

# Kubernetes 组件指标
# - etcd 延迟和吞吐量
# - API Server 请求 QPS
# - Scheduler 调度延迟
# - Controller Manager 工作队列深度
# PromQL 示例
# etcd 读延迟 P99
histogram_quantile(0.99, rate(etcd_disk_wal_fsync_duration_seconds_bucket[5m]))
```

### 工作负载级指标

```bash
# Deployment / StatefulSet / DaemonSet 指标
# - Pod 数量（期望/实际）
# - CPU 使用率
# - 内存使用率
# - 网络流量
# - 重启次数
# PromQL 示例
# 某 Deployment 的 CPU 使用率
sum(rate(container_cpu_usage_seconds_total{
  namespace="my-project",
  pod=~"myapp-.*"
}[5m])) by (pod) * 1000   # 转换为 millicores
# 某 Deployment 的内存使用率
sum(container_memory_usage_bytes{
  namespace="my-project",
  pod=~"myapp-.*"
}) by (pod)

# Pod 级指标
# - 每个容器的 CPU / 内存
# - 网络收发字节数
# - 文件系统使用
# - 资源限制实际使用
```

### 服务级指标

```bash
# Service 级别（通过 Ingress / Gateway）
# - 请求 QPS
# - 请求延迟（P50 / P95 / P99）
# - 错误率（4xx / 5xx）
# - 并发连接数
# PromQL 示例
# Ingress 请求 QPS
sum(rate(nginx_ingress_controller_requests[5m])) by (ingress)
# 请求延迟 P99
histogram_quantile(0.99,
  sum(rate(nginx_ingress_controller_request_duration_seconds_bucket[5m])) by (le)
)
```

## 自定义监控

### 快速指标

KubeSphere 提供了「快速指标」功能，可以一键为工作负载添加常用监控指标：

```
┌─────────────────────────────────────────────────────────────────┐
│                    快速指标                                        │
│                                                                  │
│  CPU 类                                                        │
│  - CPU 使用量（cores）                                          │
│  - CPU 使用率（%）                                              │
│                                                                  │
│  内存类                                                        │
│  - 内存使用量（bytes）                                         │
│  - 内存使用率（%）                                             │
│                                                                  │
│  网络类                                                        │
│  - 网络发送字节数                                               │
│  - 网络接收字节数                                               │
│                                                                  │
│  存储类                                                        │
│  - 存储使用量                                                  │
│  - 存储使用率                                                  │
│                                                                  │
│  点击即用，自动生成 Grafana Dashboard                           │
└─────────────────────────────────────────────────────────────────┘
```

### 自定义指标面板

```yaml
# 如果应用暴露了自定义指标（如业务指标）
# 需要先部署 Prometheus Operator 的 ServiceMonitor

# 方式一：使用 KubeSphere 控制台图形化创建
# 监控 → 自定义监控 → 新建监控面板

# 方式二：通过 YAML 创建 ServiceMonitor
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: myapp-metrics
  namespace: my-project
  labels:
    kubesphere.io/workload: myapp
    servicemonitor.kubesphere.io/rbac: "true"
spec:
  selector:
    matchLabels:
      app: myapp
  endpoints:
    - port: metrics
      path: /metrics
      interval: 15s
  namespaceSelector:
    matchNames:
      - my-project
```

### 自定义 Dashboard

```json
{
  "title": "我的业务监控",
  "panels": [
    {
      "title": "订单创建 QPS",
      "type": "graph",
      "targets": [
        {
          "expr": "sum(rate(order_created_total[5m])) by (service)",
          "legendFormat": "{{service}}"
        }
      ],
      "gridPos": {"x": 0, "y": 0, "w": 12, "h": 8}
    },
    {
      "title": "订单创建延迟 P99",
      "type": "graph",
      "targets": [
        {
          "expr": "histogram_quantile(0.99, sum(rate(order_create_duration_seconds_bucket[5m])) by (le, service))",
          "legendFormat": "{{service}} P99"
        }
      ],
      "gridPos": {"x": 12, "y": 0, "w": 12, "h": 8}
    },
    {
      "title": "当前在线用户数",
      "type": "stat",
      "targets": [
        {
          "expr": "sum(active_users_total)"
        }
      ],
      "gridPos": {"x": 0, "y": 8, "w": 6, "h": 4}
    }
  ]
}
```

## 应用指标暴露

### Java 应用（Micrometer + Prometheus）

```java
// Spring Boot 应用暴露 Prometheus 指标
// 依赖：micrometer-registry-prometheus

// application.yml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus,metrics
  endpoint:
    health:
      show-details: always
  metrics:
    export:
      prometheus:
        enabled: true
    tags:
      application: ${spring.application.name}

// 自定义指标
@Service
public class OrderService {
    private final Counter orderCreatedCounter;
    private final Timer orderCreateTimer;

    public OrderService(MeterRegistry registry) {
        this.orderCreatedCounter = Counter.builder("order_created_total")
            .description("Total number of orders created")
            .tag("service", "order-service")
            .register(registry);
        this.orderCreateTimer = Timer.builder("order_create_duration_seconds")
            .description("Order creation duration")
            .register(registry);
    }

    public void createOrder(Order order) {
        Timer.Sample sample = Timer.start();
        try {
            // 业务逻辑
            orderCreatedCounter.increment();
        } finally {
            sample.stop(orderCreateTimer);
        }
    }
}
```

### Go 应用（Prometheus client）

```go
// Go 应用暴露 Prometheus 指标
package main

import (
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
    "net/http"
)

var (
    ordersCreated = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "order_created_total",
            Help: "Total number of orders created",
        },
        []string{"service"},
    )

    orderDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "order_create_duration_seconds",
            Help:    "Order creation duration",
            Buckets: []float64{0.01, 0.05, 0.1, 0.5, 1, 5},
        },
        []string{"service"},
    )
)

func init() {
    prometheus.MustRegister(ordersCreated)
    prometheus.MustRegister(orderDuration)
}

func main() {
    http.Handle("/metrics", promhttp.Handler())
    http.ListenAndServe(":8080", nil)
}
```

## 多租户监控隔离

```bash
# KubeSphere 监控的租户隔离通过 Prometheus Label 实现
# 每个工作负载的指标自动带有以下 Label：
# - namespace：命名空间
# - pod：Pod 名称
# - workspace：工作空间名称（KubeSphere 自动添加）
# - service：服务名称

# 查询时的租户隔离
# Workspace A 的成员查询时
# → 自动加上 workspace="workspace-a" 过滤条件
# → 只能看到 workspace-a 的指标

# Prometheus 查询隔离（通过 Grafana Variable 实现）
# Grafana 数据源查询时注入租户变量
# namespace=~"$namespace"
# workspace=~"$workspace"
```

## 告警规则

```yaml
# 在 KubeSphere 中创建告警规则
apiVersion: monitoring.kubesphere.io/v1alpha1
kind: PrometheusRule
metadata:
  name: myapp-alerts
  namespace: my-project
spec:
  groups:
    - name: myapp.rules
      rules:
        # CPU 使用率告警
        - alert: HighCPU
          expr: |
            sum(rate(container_cpu_usage_seconds_total{
              namespace="my-project",
              pod=~"myapp-.*"
            }[5m])) by (pod) > 2   # CPU > 2 cores
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "Pod {{ $labels.pod }} CPU 使用率过高"
            description: "当前 CPU 使用 {{ $value }} cores，超过 2 cores 阈值"
```

## 面试追问方向

1. **KubeSphere 的监控和原生 Prometheus + Grafana 有什么区别？**
   答：核心没有区别，都是 Prometheus + Grafana。KubeSphere 在此基础上做了增强：1) 多租户视图（不同用户只能看到自己 Workspace 的数据）；2) 快速指标（不用写 PromQL 一键添加）；3) 内置 Dashboard 模板（常用的 K8s 监控面板开箱即用）；4) 告警集成（告警规则和通知渠道在平台层面统一管理）。

2. **如何为自定义应用添加监控指标？**
   答：1) 在应用中引入 Prometheus Client 库（各语言都有）；2) 暴露 `/metrics` 端点；3) 创建 ServiceMonitor（或者让 KubeSphere 自动发现）；4) 在 KubeSphere 控制台创建自定义监控面板。关键指标包括：请求 QPS、延迟分布、错误率、业务自定义指标（如订单数、活跃用户数）。

3. **Prometheus 的数据存储容量如何规划？**
   答：主要看三个因素：指标数量、采集间隔、保留时间。估算公式：存储 = 指标数 × 采集间隔的倒数 × 保留时间 × 副本数 × 每个样本大小（约 1-2KB）。比如 10 万指标、15 秒采集间隔、30 天保留、1 副本，约需要 10 万 × (86400/15) × 30 × 2KB ≈ 35GB。生产环境建议使用 Thanos 或 M3DB 做长期存储和全局视图。

> "监控不是摆好看的，是要在出问题时第一时间告诉你『哪个服务怎么了』。好的监控体系，是运维的『眼睛』——看不到的地方，管不到。"
