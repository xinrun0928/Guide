# Prometheus 与 Kubernetes：原生服务发现

Prometheus 最强大的功能之一，是和 Kubernetes 的深度集成。

不需要手动配置每个监控目标，Prometheus 自动发现集群中的所有服务。

今天我们来看看这是怎么工作的。

---

## 服务发现架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Kubernetes Service Discovery               │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                    API Server                        │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐             │  │
│  │  │ Pods    │  │Services │  │Nodes    │             │  │
│  │  └────┬────┘  └────┬────┘  └────┬────┘             │  │
│  │       │            │            │                   │  │
│  └───────┼────────────┼────────────┼───────────────────┘  │
│          ↓            ↓            ↓                       │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                   Prometheus                          │  │
│  │                                                      │  │
│  │  ┌─────────────────────────────────────────────────┐│  │
│  │  │              SD Config                           ││  │
│  │  │  kubernetes_sd_configs:                         ││  │
│  │  │    - role: pod                                 ││  │
│  │  │    - role: service                            ││  │
│  │  │    - role: endpoints                           ││  │
│  │  └─────────────────────────────────────────────────┘│  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 角色类型

| 角色 | 发现内容 | 生成的 Target |
|-----|---------|--------------|
| node | Kubernetes Node | NodeExporter |
| pod | 所有 Pod | Pod 的 /metrics |
| service | ClusterIP Service | 不常用 |
| endpoints | Service 的 Endpoints | Pod 的 /metrics |
| ingress | Ingress 规则 | 不常用 |

---

## 基础配置

### Pod 监控

```yaml
# prometheus.yml
scrape_configs:
  # 监控所有 Pod（需要注解启用）
  - job_name: 'kubernetes-pods'
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      # 只监控带有 prometheus.io/scrape: "true" 注解的 Pod
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true

      # 保留 Pod 名称作为 label
      - source_labels: [__meta_kubernetes_pod_container_name]
        target_label: container

      # 从注解读取端口
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_port]
        action: keep
        regex: (\d+)
        target_label: __param_target_port
        replacement: $\{1}

      # 保留 namespace 和 pod name
      - source_labels: [__meta_kubernetes_namespace,
                        __meta_kubernetes_pod_name]
        action: replace
        target_label: pod
        separator: '/'
```

### Endpoints 监控（推荐）

```yaml
# 监控所有 Service 的 Endpoints
- job_name: 'kubernetes-endpoints'
  kubernetes_sd_configs:
    - role: endpoints
  relabel_configs:
    # 只监控带有 prometheus.io/scrape 注解的 Endpoints
    - source_labels: [__meta_kubernetes_service_annotation_prometheus_io_scrape]
      action: keep
      regex: true

    # 保留 service name 作为 label
    - source_labels: [__meta_kubernetes_namespace,
                      __meta_kubernetes_service_name]
        action: replace
        target_label: service
        separator: '/'
```

### NodeExporter 监控

```yaml
# 监控所有 Node（运行 NodeExporter DaemonSet）
- job_name: 'kubernetes-nodes'
  kubernetes_sd_configs:
    - role: node
  relabel_configs:
    # NodeExporter 通常在 9100 端口
    - target_label: __address__
      replacement: $\{1}:9100
```

---

## Relabel 魔法

Relabel 是 Prometheus 服务发现的核心。

```
┌─────────────────────────────────────────────────────────────┐
│                    Relabel 流程                               │
│                                                             │
│  Target 发现 ──→ Pre-relabel ──→ Target ──→ Post-relabel ──→ Final │
│                    (元数据)          (地址)      (元数据)       │
└─────────────────────────────────────────────────────────────┘
```

### 常见 Relabel 用法

```yaml
relabel_configs:
  # 1. Keep: 只保留匹配的
  - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
    action: keep
    regex: true

  # 2. Drop: 丢弃匹配的
  - source_labels: [__meta_kubernetes_namespace]
    action: drop
    regex: (kube-system|kube-public)

  # 3. Replace: 替换/添加 label
  - source_labels: [__meta_kubernetes_namespace]
    target_label: namespace

  # 4. LabelMap: 从元数据批量生成 labels
  - action: labelmap
    regex: __meta_kubernetes_pod_label_(.+)

  # 5. LabelDrop: 删除 label
  - action: labeldrop
    regex: __meta_kubernetes_pod_label_(.+)

  # 6. HashMod: 对 label 值做 hash（用于分片）
  - source_labels: [__address__]
    target_label: __hash_total
    modulus: 4
    action: hashmod
```

---

## 应用端配置

### Spring Boot + Micrometer

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health,info,prometheus,metrics
  metrics:
    export:
      prometheus:
        enabled: true
    tags:
      application: $\{spring.application.name}
```

```java
// 自定义 metrics
@Configuration
public class MetricsConfig {
    @Bean
    public MeterRegistry meterRegistry(MeterRegistry registry) {
        // 添加自定义标签
        Tags tags = Tags.of(
            "environment", System.getenv().getOrDefault("ENV", "dev"),
            "region", System.getenv().getOrDefault("REGION", "us-east")
        );

        return Metrics.globalRegistry.customize(
            meter -> meter(tags.and(meter.getId().getTags())));
    }
}
```

### Python 应用

```python
from prometheus_client import start_http_server, Counter, Gauge

# 暴露 /metrics 端点
# prometheus_client 会自动在 /metrics 端点返回指标

REQUESTS = Counter('http_requests_total', 'Total requests',
                   ['method', 'endpoint'])

def process_request() {
    REQUESTS.labels(method='GET', endpoint='/api').inc()
}
```

### Go 应用

```go
import "github.com/prometheus/client_golang/prometheus"
import "github.com/prometheus/client_golang/prometheus/promhttp"

var httpRequestsTotal = prometheus.NewCounterVec(
    prometheus.CounterOpts{
        Name: "http_requests_total",
        Help: "Total HTTP requests",
    },
    []string{"method", "endpoint"},
)

func init() {
    prometheus.MustRegister(httpRequestsTotal)
}

// 暴露 /metrics 端点
http.Handle("/metrics", promhttp.Handler())
```

---

## Kubernetes Operator

### Prometheus Operator

```yaml
# ServiceMonitor：定义要监控的服务
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: api-monitor
  labels:
    release: prometheus
spec:
  selector:
    matchLabels:
      app: api
  endpoints:
    - port: metrics
      interval: 15s
      path: /metrics
  namespaceSelector:
    matchNames:
      - production

---
# Prometheus：定义监控配置
apiVersion: monitoring.coreos.com/v1
kind: Prometheus
metadata:
  name: prometheus
spec:
  serviceAccountName: prometheus
  serviceMonitorSelector:
    matchLabels:
      release: prometheus
  ruleSelector:
    matchLabels:
      release: prometheus
```

### 自动服务发现

```yaml
# PodMonitor：监控 Pod（不需要 Service）
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: my-app-monitor
spec:
  selector:
    matchLabels:
      app: my-app
  podMetricsEndpoints:
    - port: metrics
      interval: 30s
```

---

## Java 中的 Kubernetes 集成

### Spring Boot Actuator

```yaml
# application.yml
management:
  prometheus:
    metrics:
      export:
        enabled: true
  endpoints:
    web:
      exposure:
        include: "*"
  metrics:
    tags:
      application: '$\{spring.application.name}'
```

### 获取 Kubernetes 元数据

```java
import io.micrometer.kubernetes.*;
import io.micrometer.core.instrument.MeterRegistry;

@Component
public class KubernetesMetrics {
    public KubernetesMetrics(MeterRegistry registry) {
        // 自动添加 Kubernetes 元数据
        // - kubernetes_namespace
        // - kubernetes_pod_name
        // - kubernetes_node_name
        // - kubernetes_container_name

        // 自定义指标可以引用这些标签
        Counter.builder("api.requests")
            .tag("pod", System.getenv().get("HOSTNAME"))
            .register(registry);
    }
}
```

---

## 面试追问方向

- Prometheus 是怎么发现 Kubernetes 中的 Pod 的？
- Relabel 和 Label 的区别是什么？

下一节，我们来了解时序数据库的面试汇总。