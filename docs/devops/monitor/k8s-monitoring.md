# Kubernetes 监控：kube-state-metrics、cAdvisor、Prometheus Operator

「K8s 怎么监控 K8s 自身？」——三层采集，缺一不可。

监控 Kubernetes 和监控传统虚拟机完全不同：Pod 会漂移、Deployment 会滚动更新、Service 只是逻辑概念。你需要的不是「监控 IP」，而是「监控资源对象」。kube-state-metrics、cAdvisor、Prometheus Operator 是 K8s 监控的三驾马车。

## K8s 监控架构

```
┌─────────────────────────────────────────────────────────────────┐
│                 Kubernetes 监控三层架构                           │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    第一层：基础设施层                          │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │  │
│  │  │ node-exporter│ │ kubelet     │  │ cAdvisor    │           │  │
│  │  │ (主机)      │  │ (kubelet)   │  │ (容器)      │           │  │
│  │  │ port: 9100  │  │ port: 10250 │  │ kubelet 内置 │           │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘           │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    第二层：K8s 对象层                         │  │
│  │  ┌─────────────────────────────────────────────────────────┐│  │
│  │  │              kube-state-metrics                         ││  │
│  │  │  采集 K8s 对象状态：Deployment、Pod、Service...          ││  │
│  │  │  port: 8080                                             ││  │
│  │  └─────────────────────────────────────────────────────────┘│  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    第三层：应用层                             │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │  │
│  │  │ 业务 Exporter│ │ APM Agent  │  │ OpenTelemetry│           │  │
│  │  │             │  │ (APM)      │  │             │           │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘           │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │               Prometheus Operator（统一管理）                 │  │
│  │  CRD: Prometheus / ServiceMonitor / PodMonitor / Alertmanager│  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## kube-state-metrics

### 功能定位

```
┌─────────────────────────────────────────────────────────────────┐
│              kube-state-metrics vs node-exporter                 │
│                                                                  │
│  node-exporter: 监控「机器」                                      │
│  - CPU、内存、磁盘、网络（资源层面）                              │
│  - 节点 IP、节点名（物理层面）                                    │
│                                                                  │
│  kube-state-metrics: 监控「K8s 对象」                            │
│  - Deployment 有多少个 Pod？（期望 vs 实际）                      │
│  - Pod 当前状态是什么？（Running、Pending、Failed）               │
│  - Service 是否有匹配的 Endpoint？                                │
│  - HPA 是否触发了扩容？                                          │
└─────────────────────────────────────────────────────────────────┘
```

### 安装

```bash
# 通过 KubeStateMetrics Operator 或直接部署
kubectl apply -f https://raw.githubusercontent.com/kubernetes/kube-state-metrics/v2.11.0/kubernetes.yaml

# 或 Helm 安装
helm install kube-state-metrics prometheus-community/kube-state-metrics \
    --namespace monitoring \
    --create-namespace
```

### 核心指标

```promql
# Deployment 状态
kube_deployment_status_replicas_available  # 可用副本数
kube_deployment_status_replicas_unavailable  # 不可用副本数
kube_deployment_spec_replicas  # 期望副本数
kube_deployment_metadata_generation  # 期望代际（用于判断是否更新）

# Pod 状态
kube_pod_status_phase{phase="Running"}  # Running 状态的 Pod
kube_pod_status_phase{phase="Pending"}  # Pending（调度中或资源不足）
kube_pod_status_phase{phase="Failed"}  # 失败
kube_pod_status_phase{phase="Unknown"}  # 失联（节点问题）

# Pod 重启
kube_pod_container_status_restarts_total  # 容器重启次数
increase(kube_pod_container_status_restarts_total[1h])  # 1 小时内重启次数

# Pod 资源请求/限制
kube_pod_container_resource_requests_cpu_cores  # CPU 请求
kube_pod_container_resource_limits_cpu_cores  # CPU 限制
kube_pod_container_resource_requests_memory_bytes  # 内存请求
kube_pod_container_resource_limits_memory_bytes  # 内存限制

# HPA 状态
kube_horizontalpodautoscaler_status_desired_replicas  # 期望副本数
kube_horizontalpodautoscaler_status_current_replicas  # 当前副本数
kube_horizontalpodautoscaler_status_condition  # 扩容条件状态

# Node 状态
kube_node_status_condition{condition="Ready"}  # 节点 Ready 状态
kube_node_status_allocatable_cpu_cores  # 可分配 CPU
kube_node_status_allocatable_memory_bytes  # 可分配内存

# PV/PVC 状态
kube_persistentvolume_status_phase{phase="Bound"}  # Bound 的 PV
kube_persistentvolumeclaim_status_phase{phase="Bound"}  # Bound 的 PVC
```

### 实用查询

```promql
# 问题 Pod 定位（不 Running 且不 Succeeded）
count by (namespace, pod) (
  kube_pod_status_phase{phase!~"Running|Succeeded"}
  unless kube_pod_status_scheduled{condition="true"}
)

# 副本数不匹配（Deployment 问题）
kube_deployment_status_replicas_available
  <
kube_deployment_spec_replicas

# Pod 内存使用率（相对于限制）
kube_pod_container_resource_requests_memory_bytes
# / kube_pod_container_resource_limits_memory_bytes

# Pod CPU 使用率（相对于请求）
rate(kube_pod_container_resource_usage_cpu_cores[5m])
  /
kube_pod_container_resource_requests_cpu_cores
```

## cAdvisor

### 功能定位

```
┌─────────────────────────────────────────────────────────────────┐
│              cAdvisor：容器级监控                                  │
│                                                                  │
│  cAdvisor 已集成在 Kubelet 中，无需单独部署                        │
│  端点：Kubelet 的 /metrics/cadvisor                             │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  kubelet (已内置 cAdvisor)                              │    │
│  │                                                         │    │
│  │  /metrics      → node-exporter 风格的主机指标            │    │
│  │  /metrics/cadvisor → 容器指标                           │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 核心指标

```promql
# 容器 CPU 使用率
container_cpu_usage_seconds_total  # 累计 CPU 秒数
# 使用 rate 计算实际 CPU 核数
rate(container_cpu_usage_seconds_total[5m])

# 容器内存使用
container_memory_working_set_bytes  # 实际使用内存
container_memory_rss  # RSS 内存
container_memory_cache  # 缓存

# 容器网络
container_network_receive_bytes_total  # 接收字节
container_network_transmit_bytes_total  # 发送字节
container_network_receive_packets_total  # 接收包数
container_network_transmit_packets_total  # 发送包数
container_network_receive_errors_total  # 接收错误
container_network_transmit_errors_total  # 发送错误

# 容器文件系统
container_fs_reads_bytes_total  # 读取字节
container_fs_writes_bytes_total  # 写入字节
container_fs_reads_total  # 读取次数
container_fs_writes_total  # 写入次数

# 容器 OOM
container_memory_oom_events_total  # OOM 次数
container_cpu_cfs_throttled_seconds_total  # CPU 节流时间
```

### 实用查询

```promql
# 命名空间级别 CPU 使用率
sum by (namespace) (
  rate(container_cpu_usage_seconds_total[5m])
)

# Pod 级别内存使用（Working Set）
sum by (namespace, pod) (
  container_memory_working_set_bytes
)

# 容器 CPU 节流率（节流时间 / 总时间）
sum by (container, pod, namespace) (
  rate(container_cpu_cfs_throttled_seconds_total[5m])
)
/
sum by (container, pod, namespace) (
  rate(container_cpu_usage_seconds_total[5m])
)

# 网络丢包率
sum by (namespace, pod) (
  rate(container_network_receive_errors_total[5m])
  + rate(container_network_transmit_errors_total[5m])
)
/
sum by (namespace, pod) (
  rate(container_network_receive_packets_total[5m])
  + rate(container_network_transmit_packets_total[5m])
)
```

## Prometheus Operator

### 架构

```
┌─────────────────────────────────────────────────────────────────┐
│              Prometheus Operator 架构                             │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    Kubernetes API                             │  │
│  └─────────────────────────┬───────────────────────────────────┘  │
│                            │                                       │
│  ┌─────────────────────────┴───────────────────────────────────┐  │
│  │                 Prometheus Operator                           │  │
│  │                                                         │     │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌─────────┐ │     │
│  │  │ Operator  │  │ RBAC     │  │ Webhook   │  │ Informer│ │     │
│  │  │ (控制器)  │  │          │  │ (校验)    │  │ (监听)  │ │     │
│  │  └─────┬─────┘  └───────────┘  └───────────┘  └────┬────┘ │     │
│  └────────┼────────────────────────────────────────────┼──────┘  │
│           │                                            │          │
│  ┌────────┴────────────────────────────────────────────┴──────┐  │
│  │               CRD (Custom Resource Definitions)              │  │
│  │                                                              │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │  │
│  │  │ Prometheus  │  │ServiceMonitor│ │PodMonitor  │           │  │
│  │  │             │  │             │  │             │           │  │
│  │  │ 定义采集配置 │  │ 定义抓取目标 │  │ 定义 Pod 目标│           │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘           │  │
│  │                                                              │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │  │
│  │  │ Alertmanager│  │ PrometheusRule│ │ ThanosRuler│           │  │
│  │  │             │  │             │  │             │           │  │
│  │  │ 定义告警配置 │  │ 定义告警规则 │  │ 查询规则    │           │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘           │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                            │                                       │
│  ┌─────────────────────────┴───────────────────────────────────┐  │
│  │               Prometheus Server (自动管理)                      │  │
│  │  Operator 根据 CRD 生成配置，挂载到 Prometheus Pod 中            │  │
│  └────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 安装

```bash
# Helm 安装（推荐）
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

helm install prometheus prometheus-community/kube-prometheus-stack \
    --namespace monitoring \
    --create-namespace \
    --set prometheus.prometheusSpec.retention=30d \
    --set prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.resources.requests.storage=100Gi
```

### ServiceMonitor（服务发现）

```yaml
# service-monitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: order-service
  namespace: monitoring
  labels:
    app: order-service
    release: prometheus  # 必须匹配 Prometheus 的 serviceMonitorSelector
spec:
  jobLabel: order-service
  selector:
    matchLabels:
      app: order-service  # 匹配的 Service 标签
  namespaceSelector:
    matchNames:
      - production
  endpoints:
    - port: metrics
      path: /actuator/prometheus
      interval: 15s
      scrapeTimeout: 10s
      tlsConfig:
        insecureSkipVerify: true
      relabelings:
        - sourceLabels: [__meta_kubernetes_endpoint_node_name]
          targetLabel: node
        - sourceLabels: [__meta_kubernetes_endpoint_pod_name]
          targetLabel: pod
  podTargetLabels:
    - app
    - version
    - environment
```

### PodMonitor（Pod 发现）

```yaml
# pod-monitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: PodMonitor
metadata:
  name: order-service
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: order-service
  namespaceSelector:
    matchNames:
      - production
  podMetricsEndpoints:
    - port: metrics
      path: /metrics
      interval: 15s
      scrapeTimeout: 10s
      # 从 Pod 注解读取端口（灵活）
      relabelings:
        - sourceLabels: [__meta_kubernetes_pod_annotation_prometheus_io_port]
          regex: "(.*)"
          action: replace
          targetLabel: port
```

### PrometheusRule（告警规则）

```yaml
# prometheus-rule.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: order-service-alerts
  labels:
    app: order-service
    release: prometheus
spec:
  groups:
    - name: order-service
      interval: 30s
      rules:
        - alert: OrderServiceDown
          expr: |
            sum by (namespace, service) (
              up{job="order-service"} == 0
            )
          for: 1m
          labels:
            severity: critical
          annotations:
            summary: "Order Service is down"
            description: "{{ $labels.namespace }}/{{ $labels.service }} has been down for 1m"

        - alert: HighErrorRate
          expr: |
            sum by (namespace, service) (
              rate(http_server_requests_seconds_count{status=~"5.."}[5m])
            )
            /
            sum by (namespace, service) (
              rate(http_server_requests_seconds_count[5m])
            ) > 0.05
          for: 3m
          labels:
            severity: warning
          annotations:
            summary: "Error rate above 5%"
            description: "{{ $labels.service }} error rate is {{ $value | humanizePercentage }}"
```

### Prometheus CRD

```yaml
# prometheus.yaml
apiVersion: monitoring.coreos.com/v1
kind: Prometheus
metadata:
  name: k8s
  namespace: monitoring
spec:
  replicas: 2
  retention: 30d
  serviceAccountName: prometheus-k8s
  serviceMonitorSelector:
    matchLabels:
      release: prometheus
  podMonitorSelector:
    matchLabels:
      release: prometheus
  ruleSelector:
    matchLabels:
      release: prometheus
  alertmanagerSelector:
    matchLabels:
      alertmanager: main
  resources:
    requests:
      cpu: 200m
      memory: 400Mi
    limits:
      cpu: 2
      memory: 2Gi
  storage:
    volumeClaimTemplate:
      spec:
        storageClassName: ssd
        resources:
          requests:
            storage: 100Gi
  # 持久化配置
  walCompression: true
  # Thanos Sidecar（可选）
  # thanos:
  #   version: v0.32.0
```

## 三层监控整合

```promql
# 完整的服务视图：应用 → Pod → 节点

# 应用层（业务指标）
order_service_request_duration_seconds_p99

# Pod 层（资源使用）
container_cpu_usage_seconds_total{pod=~"order-service-.*"}

# 节点层（基础设施）
node_cpu_usage_seconds_total{instance=~"$node"}

# 关联查询：Pod 所在节点
kube_pod_info{pod=~"order-service-.*"}
  + on(node) group_left()
node_cpu_usage_seconds_total
```

## 常见问题

```
# 问题一：Prometheus Operator 找不到 ServiceMonitor
# 原因：ServiceMonitor 的标签和 Prometheus 的 selector 不匹配
# 解决：ServiceMonitor 必须有 Prometheus 指定的标签（默认 release: prometheus）

# 问题二：kube-state-metrics 指标为空
# 原因：指标存在但标签不匹配查询
# 解决：用 kube_pod_info 看有哪些标签可用

# 问题三：Pod 指标丢失
# 原因：cAdvisor 指标采集需要 kubelet 开启 --enable-gathering
# 解决：检查 kubelet 配置

# 问题四：指标 Cardinality 爆炸
# 原因：Pod 数量多，每个 Pod 多个容器，多个指标
# 解决：使用 PodMonitor 而非手动采集；限制采集的指标名
```

## 面试追问方向

1. **Prometheus Operator 和直接部署 Prometheus 的区别是什么？**
   答：直接部署 Prometheus 需要手动维护 prometheus.yml 配置；Prometheus Operator 通过 CRD 管理配置，ServiceMonitor/PodMonitor 自动生成抓取目标，Pod 漂移后自动更新配置。Operator 模式更适合 K8s 环境，减少运维负担。

2. **如何监控 Kubernetes 控制平面（API Server、etcd、Controller Manager）？**
   答：API Server 自带 `/metrics` 端点；etcd 有 `/metrics`；kube-scheduler 和 kube-controller-manager 也有 `/metrics`。需要配置 `kubernetes_sd_configs` 发现这些组件，或用 static_configs 手动配置。Prometheus Operator 的 `kube-prometheus-stack` 默认包含这些监控。

3. **如何排查「Pod CPU 使用率正常但应用响应慢」的问题？**
   答：使用 `container_cpu_cfs_throttled_seconds_total` 看 CPU 节流。如果节流率高，说明 Pod 触达 CPU 限制，需要调整 `resources.limits.cpu`；也可以用 `container_cpu_period` 和 `container_cpu_quota` 看实际 CPU 配额。

4. **Kube-state-metrics 和 cAdvisor 的区别是什么？**
   答：kube-state-metrics 监控 K8s 对象状态（Deployment 有多少 Pod、Pod 为什么 Pending）；cAdvisor 监控容器资源使用（CPU、内存、磁盘、网络）。前者是「逻辑状态」，后者是「物理指标」。

监控 Kubernetes，本质上是监控资源的生命周期。理解三层架构，你就知道每个指标从哪来、到哪去了。
