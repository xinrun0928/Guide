# Prometheus 与 Grafana 监控体系

「K8s 集群的监控怎么做？」——Prometheus + Grafana 是云原生监控的标准组合。

监控是生产环境的眼睛。没有监控，你永远不知道系统是否健康，不知道性能瓶颈在哪，不知道故障是什么时候开始的。Prometheus 负责采集和存储指标，Grafana 负责可视化——这套组合几乎统治了整个云原生监控领域。

## Prometheus 核心概念

```
┌─────────────────────────────────────────────────────────────────┐
│                    Prometheus 架构                                │
│                                                                  │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐  ┌──────────┐ │
│  │  Exporter│────►│Prometheus│────►│  TSDB   │──►│  Grafana │ │
│  │ (指标暴露)│     │ (采集+存储)│     │ (时序数据库)│  │  (可视化) │ │
│  └──────────┘     └──────────┘     └──────────┘  └──────────┘ │
│       │                │                                       │
│  ┌──────────┐    ┌──────────┐                                 │
│  │  应用    │    │ ServiceDisc│                                │
│  │ (内置)  │    │ (自动发现) │                                 │
│  └──────────┘    └──────────┘                                 │
└─────────────────────────────────────────────────────────────────┘

Pull 模型：Prometheus 主动从 Exporter 拉取指标，而非 Exporter 推送
```

## Prometheus 数据模型

```
┌─────────────────────────────────────────────────────────────────┐
│                    Prometheus 指标模型                            │
│                                                                  │
│ 指标名:     │ 请求速率                                          │
│ 标签:       │ {method="GET", status="200", handler="/api"}     │
│ 样本值:     │ 1234.56 (浮点数)                                  │
│ 时间戳:     │ 1700000000.123 (Unix 时间戳)                       │
│                                                                  │
│ 完整格式:                                                  │
│ api_http_requests_total{method="GET",status="200",handler="/api"} │
│   1234.56 1700000000.123                                        │
└─────────────────────────────────────────────────────────────────┘
```

## 指标类型

```promql
# 1. Counter（计数器）——只增不减
# 用于：请求总数、错误总数、安装次数
api_http_requests_total{method="GET", handler="/api"}

# PromQL 查询
# 获取请求速率（每秒）
rate(api_http_requests_total[5m])

# 获取错误率
rate(api_http_requests_total{status=~"5.."}[5m])
  / rate(api_http_requests_total[5m]) * 100

# 2. Gauge（仪表盘）——可增可减
# 用于：当前 CPU 使用率、内存使用量、连接数
node_memory_MemAvailable_bytes
go_goroutines{service="api"}

# PromQL
# 获取当前值
node_memory_MemAvailable_bytes{instance="node-1"}

# 获取 CPU 使用率变化
delta(node_cpu_seconds_total{mode="idle"}[5m])

# 3. Histogram（直方图）——服务端延迟分布
# 用于：请求延迟分布、响应大小分布
# 预定义的 buckets: 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10
http_request_duration_seconds_bucket{le="0.1"}
http_request_duration_seconds_bucket{le="0.5"}
http_request_duration_seconds_bucket{le="1"}

# PromQL
# Histogram 平均值
histogram_quantile(0.99, http_request_duration_seconds_bucket)

# Histogram 总和
sum(increase(http_request_duration_seconds_sum[5m]))

# Histogram 计数
sum(increase(http_request_duration_seconds_count[5m]))

# 4. Summary（摘要）——客户端计算的分位数
# 用于：不想在服务端计算分位数时
# 与 Histogram 的区别：Histogram 在服务端聚合，Summary 在客户端计算
http_request_duration_seconds{quantile="0.99"}
http_request_duration_seconds{quantile="0.999"}
```

## Prometheus 部署

### 简单部署

```bash
# Docker 单机部署
docker run -d \
  --name prometheus \
  -p 9090:9090 \
  -v /path/to/prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus:latest
```

### Kubernetes 部署（Operator 方式，推荐）

```yaml
# prometheus-operator.yaml
apiVersion: monitoring.coreos.com/v1
kind: Prometheus
metadata:
  name: prometheus
  namespace: monitoring
spec:
  replicas: 2
  retention: 15d
  retentionSize: 50GB
  serviceAccountName: prometheus
  serviceMonitorSelector:
    matchLabels:
      team: frontend
  ruleSelector:
    matchLabels:
      role: alert-rules
  resources:
    requests:
      cpu: 500m
      memory: 1Gi
    limits:
      cpu: 2000m
      memory: 4Gi
  storage:
    volumeClaimTemplate:
      spec:
        storageClassName: ssd
        resources:
          requests:
            storage: 100Gi

---
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: api-service-monitor
  namespace: monitoring
  labels:
    team: frontend
spec:
  selector:
    matchLabels:
      app: api
  namespaceSelector:
    matchNames:
      - production
  endpoints:
    - port: metrics
      interval: 15s
      path: /metrics
```

## Prometheus 配置

### prometheus.yml

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    cluster: production
    env: prod

alerting:
  alertmanagers:
    - static_configs:
        - targets:
            - alertmanager:9093

rule_files:
  - "/etc/prometheus/rules/*.yml"

scrape_configs:
  # Prometheus 自身监控
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
    metrics_path: /metrics

  # Kubernetes 服务发现
  - job_name: 'kubernetes-nodes'
    kubernetes_sd_configs:
      - role: node
    relabel_configs:
      - source_labels: [__meta_kubernetes_node_name]
        regex: (.+)
        target_label: instance
        replacement: ${1}

  - job_name: 'kubernetes-pods'
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
      - source_labels: [__meta_kubernetes_pod_name]
        action: replace
        target_label: pod

  # ServiceMonitor 自动发现
  - job_name: 'service-monitor'
    scrape_interval: 15s
    kubernetes_sd_configs:
      - role: endpoints
    relabel_configs:
      - source_labels: [__meta_kubernetes_service_name]
        action: keep
        regex: (.+)

  # 静态配置
  - job_name: 'static-targets'
    static_configs:
      - targets:
          - 'host1:9100'
          - 'host2:9100'
        labels:
          group: 'node-exporter'
```

### 常用 Exporter

| Exporter | 用途 | 端口 |
|---------|------|------|
| node-exporter | 主机硬件和系统指标 | 9100 |
| cadvisor | 容器指标 | 8080 |
| kube-state-metrics | K8s 对象状态 | 8080 |
| blackbox-exporter | 黑盒探测 | 9115 |
| mysql-exporter | MySQL 监控 | 9104 |
| redis-exporter | Redis 监控 | 9121 |
| alertmanager | 告警管理 | 9093 |

## Alertmanager 配置

```yaml
# alertmanager.yml
global:
  smtp_smarthost: 'smtp.example.com:587'
  smtp_from: 'alertmanager@example.com'
  smtp_auth_username: 'alertmanager'
  smtp_auth_password: 'password'

route:
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 12h
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: 'critical-alerts'
      continue: true
    - match:
        severity: warning
      receiver: 'warning-alerts'

receivers:
  - name: 'default'
    webhook_configs:
      - url: 'http://webhook-server:5000/alerts'

  - name: 'critical-alerts'
    email_configs:
      - to: 'oncall@example.com'
        headers:
          subject: '[CRITICAL] {{ .GroupLabels.alertname }}'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/xxx'
        channel: '#critical-alerts'
        title: '[CRITICAL] {{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}{{ end }}'
    pagerduty_configs:
      - service_key: 'pagerduty-service-key'
        severity: critical

  - name: 'warning-alerts'
    email_configs:
      - to: 'team@example.com'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/xxx'
        channel: '#warnings'

inhibit_rules:
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['alertname', 'cluster', 'service']
```

## 告警规则

```yaml
# prometheus-rules.yml
groups:
  - name: kubernetes-apps
    interval: 30s
    rules:
      # Pod 内存使用率超过 90%
      - alert: K8sPodMemoryUsageHigh
        expr: |
          (sum(container_memory_working_set_bytes{container!=""}) by (namespace, pod)
          / sum(container_spec_memory_limit_bytes{container!=""}) by (namespace, pod)) > 0.9
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Pod {{ $labels.namespace }}/{{ $labels.pod }} 内存使用率超过 90%"
          description: "内存使用率: {{ $value | humanizePercentage }}"

      # Deployment replicas 不足
      - alert: K8sDeploymentReplicasUnavailable
        expr: |
          (kube_deployment_spec_replicas{namespace=~".+"}
          - kube_deployment_status_replicas_available{namespace=~".+"}) > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Deployment {{ $labels.namespace }}/{{ $labels.deployment }} 副本不足"
          description: "{{ $value }} 个副本不可用"

      # 容器重启次数过多
      - alert: K8sContainerRestartingTooMuch
        expr: |
          increase(kube_pod_container_status_restarts_total[1h]) > 3
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "容器 {{ $labels.namespace }}/{{ $labels.pod }}/{{ $labels.container }} 重启次数过多"
          description: "过去 1 小时重启了 {{ $value }} 次"

      # API Server 延迟高
      - alert: K8sAPIServerLatencyHigh
        expr: |
          histogram_quantile(0.99, sum(rate(apiserver_request_duration_seconds_bucket[5m])) by (le))
          > 1
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "API Server 延迟过高"
          description: "P99 延迟: {{ $value }}s"

      # 节点 NotReady
      - alert: K8sNodeNotReady
        expr: |
          kube_node_status_condition{condition="Ready",status="true"} == 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "节点 {{ $labels.node }} NotReady"
          description: "节点已经处于 NotReady 状态超过 5 分钟"
```

## Grafana 部署

```yaml
# grafana-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: grafana
  namespace: monitoring
spec:
  replicas: 1
  selector:
    matchLabels:
      app: grafana
  template:
    metadata:
      labels:
        app: grafana
    spec:
      containers:
        - name: grafana
          image: grafana/grafana:10.2.0
          ports:
            - name: http
              containerPort: 3000
          env:
            - name: GF_SERVER_ROOT_URL
              value: "http://grafana.example.com"
            - name: GF_SECURITY_ADMIN_USER
              value: admin
            - name: GF_SECURITY_ADMIN_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: grafana-secret
                  key: admin-password
            - name: GF_USERS_ALLOW_SIGN_UP
              value: "false"
          resources:
            requests:
              cpu: 100m
              memory: 200Mi
            limits:
              cpu: 500m
              memory: 512Mi
          volumeMounts:
            - name: grafana-storage
              mountPath: /var/lib/grafana
            - name: grafana-datasources
              mountPath: /etc/grafana/provisioning/datasources
            - name: grafana-dashboards
              mountPath: /etc/grafana/provisioning/dashboards
      volumes:
        - name: grafana-storage
          persistentVolumeClaim:
            claimName: grafana-pvc
        - name: grafana-datasources
          configMap:
            name: grafana-datasources
        - name: grafana-dashboards
          configMap:
            name: grafana-dashboards
```

### Grafana DataSource 配置

```yaml
# grafana-datasources.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-datasources
  namespace: monitoring
data:
  prometheus.yaml: |
    apiVersion: 1
    datasources:
      - name: Prometheus
        type: prometheus
        access: proxy
        url: http://prometheus:9090
        isDefault: true
        editable: false
        jsonData:
          timeInterval: 15s
          httpMethod: POST
```

### Grafana Dashboard 配置

```yaml
# grafana-dashboards.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-dashboards
  namespace: monitoring
  labels:
    grafana_dashboard: "1"
data:
  kubernetes-cluster.json: |
    {
      "dashboard": {
        "title": "Kubernetes Cluster Overview",
        "uid": "k8s-cluster",
        "panels": [
          {
            "title": "CPU Usage",
            "type": "graph",
            "targets": [
              {
                "expr": "sum(rate(container_cpu_usage_seconds_total[5m])) by (namespace)",
                "legendFormat": "{{namespace}}"
              }
            ]
          },
          {
            "title": "Memory Usage",
            "type": "graph",
            "targets": [
              {
                "expr": "sum(container_memory_working_set_bytes) by (namespace) / 1024 / 1024 / 1024",
                "legendFormat": "{{namespace}}"
              }
            ]
          },
          {
            "title": "Pod Count",
            "type": "stat",
            "targets": [
              {
                "expr": "count(kube_pod_info)"
              }
            ]
          }
        ]
      }
    }
```

## PromQL 常用查询

```promql
# Kubernetes 集群概览
# CPU 使用率
100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# 内存使用率
100 - ((node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100)

# Pod 数量
count(kube_pod_info)

# 正在运行的 Pod
count(kube_pod_status_phase{phase="Running"})

# Deployment 副本数
kube_deployment_spec_replicas

# 实际可用副本数
kube_deployment_status_replicas_available

# API Server QPS
sum(rate(apiserver_request_total[5m]))

# Pod 重启次数
increase(kube_pod_container_status_restarts_total[1h])

# 容器 CPU 使用率
rate(container_cpu_usage_seconds_total[5m])

# 容器内存使用量
container_memory_working_set_bytes / 1024 / 1024 / 1024

# 网络流量
rate(container_network_receive_bytes_total[5m])
rate(container_network_transmit_bytes_total[5m])

# PVC 使用量
kubelet_volume_stats_used_bytes / kubelet_volume_stats_capacity_bytes * 100

# 服务延迟 P99
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))

# 错误率
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100
```

## 面试追问方向

1. **Prometheus 的 Pull 模型有什么优缺点？**
   答：优点：不需要在被监控端安装 Agent，Prometheus 完全控制采集节奏，易于测试和调试，可以本地聚合减少网络请求。缺点：需要 Prometheus 能访问到所有目标，大规模集群下拉取压力大；实时性略低于 Push 模型。对于 Kubernetes 场景，Prometheus Operator 的 ServiceMonitor 可以自动配置采集目标。

2. **Prometheus 如何处理高可用？**
   答：水平扩展：部署多个 Prometheus 实例，每个采集部分目标；联邦（Federation）：一个 Prometheus 聚合其他 Prometheus 的数据，适合多集群监控；Thanos/Cortex：基于对象存储的长期存储方案，支持全局视图和无限存储；Remote Write：实时将数据写入 Prometheus Remote Storage（如 Thanos、InfluxDB）。

3. **Prometheus 的局限性是什么？**
   答：不支持跨集群统一视图（需要 Thanos/Cortex）；不擅长处理超高基数（High Cardinality）标签（如 User ID、Session ID）；不适合日志和追踪（需要 ELK、Jaeger）；不支持告警聚合（需要 Alertmanager）；不支持动态扩缩容目标的自动发现需要精心设计。

4. **Grafana 和 Prometheus Alert 的区别是什么？**
   答：Grafana Alerting 是基于查询结果的可视化告警，适合 Dashboard 相关的告警；Prometheus Alerting 是规则驱动的告警，适合基础设施和应用的阈值告警。Grafana Alerting 可以在 Dashboard 上直接创建告警，更直观；Prometheus Alerting 更强大，支持 Alertmanager 的分组、抑制、静默等高级特性。两者可以结合使用。
