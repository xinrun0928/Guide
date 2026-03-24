# Prometheus 服务发现：K8s、Consul、文件

「Prometheus 怎么找到要监控的目标？」——服务发现是关键。

没有服务发现，你需要在配置里写死所有目标 IP。服务扩容时，你得手动改配置。Prometheus 的服务发现机制，让监控目标自动注册、自动下线，你只需要关注「监控什么」，而不是「目标在哪」。

## 服务发现核心概念

```
┌─────────────────────────────────────────────────────────────────┐
│                    Prometheus 服务发现流程                        │
│                                                                  │
│  ┌───────────────┐     ┌───────────────┐     ┌───────────────┐   │
│  │  SD Provider │────►│  Relabel     │────►│  监控目标    │   │
│  │  (发现源)    │     │  (标签处理)   │     │  (Targets)   │   │
│  └───────────────┘     └───────────────┘     └───────────────┘   │
│                                                                  │
│  ┌───────────────┐                                               │
│  │  kubernetes_sd_configs  │ Kubernetes API                       │
│  │  consul_sd_configs     │ Consul 注册中心                      │
│  │  file_sd_configs      │ 静态文件                            │
│  │  dns_sd_configs        │ DNS 记录                            │
│  │  ec2_sd_configs       │ AWS EC2                             │
│  │  azure_sd_configs     │ Azure VM                            │
│  │  gce_sd_configs       │ GCP GCE                            │
│  │  openstack_sd_configs │ OpenStack                          │
│  │  triton_sd_configs     │ Joyent Triton                       │
│  │  digitalocean_sd_configs│ DigitalOcean                       │
│  └───────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
```

## Kubernetes 服务发现

### Pod 发现

```yaml
scrape_configs:
  - job_name: 'kubernetes-pods'
    kubernetes_sd_configs:
      - role: pod
        namespaces:
          names:
            - production
            - staging
        # 选择特定节点上的 Pod
        selectors:
          - role: "pod"
            label: "app"
    relabel_configs:
      # 只保留需要监控的 Pod（通过注解）
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        regex: "true"
        action: keep

      # 从 Pod 注解中读取端口
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_port]
        regex: "(.*)"
        target_label: __param_target_port
        replacement: "${1}"

      # 从注解读取路径
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
        regex: "(.*)"
        target_label: __metrics_path__
        replacement: "${1}"

      # 添加服务标签
      - source_labels: [__meta_kubernetes_namespace]
        target_label: namespace

      - source_labels: [__meta_kubernetes_pod_name]
        target_label: pod

      - source_labels: [__meta_kubernetes_pod_label_app]
        target_label: app

      # 清理前缀
      - regex: __meta_kubernetes_pod_label_(.+)
        action: labelmap
        replacement: "${1}"
```

### Node 发现

```yaml
  - job_name: 'kubernetes-nodes'
    kubernetes_sd_configs:
      - role: node
    relabel_configs:
      # 使用节点内网 IP
      - source_labels: [__meta_kubernetes_node_address_InternalIP]
        target_label: instance
        replacement: "${1}"

      - source_labels: [__meta_kubernetes_node_name]
        target_label: node
        replacement: "${1}"
```

### Service / Endpoints 发现

```yaml
  - job_name: 'kubernetes-services'
    kubernetes_sd_configs:
      - role: service
    relabel_configs:
      - source_labels: [__meta_kubernetes_service_name]
        target_label: service

      - source_labels: [__meta_kubernetes_service_annotation_prometheus_io_port]
        regex: "(.*)"
        target_label: __param_port

      # 通过 Service 注解启用监控
      - source_labels: [__meta_kubernetes_service_annotation_prometheus_io_scrape]
        regex: "true"
        action: keep
```

### 最佳实践：标准注解

```yaml
# Pod 标准注解
metadata:
  annotations:
    prometheus.io/scrape: "true"           # 是否监控
    prometheus.io/port: "8080"             # 端口
    prometheus.io/path: "/actuator/prometheus" # 路径
    prometheus.io/scheme: "http"           # http 或 https
```

```yaml
# 示例：Spring Boot 应用
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: production
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/port: "8080"
    prometheus.io/path: "/actuator/prometheus"
spec:
  replicas: 3
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8080"
        prometheus.io/path: "/actuator/prometheus"
    spec:
      containers:
        - name: order-service
          image: myregistry/order-service:v1
          ports:
            - containerPort: 8080
```

## Consul 服务发现

```yaml
scrape_configs:
  - job_name: 'consul-services'
    consul_sd_configs:
      - server: 'consul.service.consul:8500'
        datacenter: dc1
        services:
          names:
            - order-service
            - payment-service
        tags:
          - prometheus
        scheme: https  # Consul 启用 TLS
        basic_auth:
          username: xxx
          password: xxx
    relabel_configs:
      # 从 Consul 服务元数据提取标签
      - source_labels: [__meta_consul_tags]
        regex: "(.*)"
        target_label: tags
        replacement: "${1}"

      # 使用服务地址
      - source_labels: [__meta_consul_address]
        target_label: instance
        replacement: "${1}:${__meta_consul_service_port}"

      # 按标签过滤
      - source_labels: [__meta_consul_service_metadata_env]
        regex: "(prod|staging)"
        action: keep
```

## 文件服务发现（动态配置）

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'file-sd'
    file_sd_configs:
      - files:
          - targets/*.yaml
          - targets/*.yml
          - targets/*.json
        refresh_interval: 30s  # 定期刷新

# targets/production.yml
- targets:
    - "order-service-1:9090"
    - "order-service-2:9090"
  labels:
    service: order-service
    env: production
    datacenter: dc1

# targets/services.json
[
  {
    "targets": ["payment-svc:9090"],
    "labels": {
      "service": "payment",
      "env": "prod"
    }
  }
]
```

## DNS 服务发现

```yaml
  - job_name: 'dns-sd'
    dns_sd_configs:
      - names:
          - 'prometheusTargets.prod.svc.cluster.local'
          - 'appTargets.staging.svc.cluster.local'
        type: A
        port: 9100
        refresh_interval: 30s
```

## AWS EC2 服务发现

```yaml
  - job_name: 'aws-ec2'
    ec2_sd_configs:
      - region: us-east-1
        access_key: xxx
        secret_key: xxx
        filters:
          - name: tag:Environment
            values:
              - production
          - name: tag:Team
            values:
              - backend
        port: 9100
        relabel_configs:
          # 使用实例 ID 作为标签
          - source_labels: [__meta_ec2_instance_id]
            target_label: instance

          # 从标签提取
          - source_labels: [__meta_ec2_tag_Environment]
            target_label: env

          # 只保留运行中的实例
          - source_labels: [__meta_ec2_instance_state]
            regex: running
            action: keep

          # 私有 IP
          - source_labels: [__meta_ec2_private_ip]
            target_label: instance
```

## Relabel 高级技巧

```yaml
# 1. 删除标签
relabel_configs:
  - action: labeldrop
    regex: "instance|job"

# 2. 添加常量标签
  - target_label: datacenter
    replacement: dc1

# 3. 正则替换
  - source_labels: [instance]
    regex: "(.+):(.+)"
    target_label: host
    replacement: "${1}"

# 4. 多标签合并
  - source_labels: [app_name, app_version]
    separator: "-"
    target_label: full_app_name

# 5. Keep / Drop 过滤
  - source_labels: [__meta_kubernetes_service_name]
    regex: "kube-system|istio-system"
    action: drop

# 6. labelmap（复制标签）
  - regex: __meta_kubernetes_pod_label_(.+)
    action: labelmap
    replacement: "${1}"
    # 将 __meta_kubernetes_pod_label_app 复制为 label: app
```

## 服务发现对比

| 方式 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| Kubernetes SD | K8s 集群 | 自动发现、自动标签 | 需要 Pod 注解 |
| Consul SD | 微服务注册中心 | 跨 K8s 集群 | 需要 Consul 集群 |
| File SD | 简单场景/外部服务 | 简单可控 | 需要外部触发更新 |
| DNS SD | 内部 DNS 服务发现 | 简单 | 不能自动下线 |
| EC2 SD | AWS 监控 | 自动发现 ASG | 只能发现 EC2 |
| Azure/GCE SD | 云厂商监控 | 自动发现云资源 | 云厂商绑定 |

## 面试追问方向

1. **Prometheus 如何实现 Kubernetes 自动发现？**
   答：通过 Kubernetes API 发现 Pod、Service、Node、Endpoints、Ingress 等资源。`kubernetes_sd_configs` 连接 K8s API Server，定期拉取资源列表。`relabel_configs` 处理元标签，提取 namespace、pod name、labels 等信息。Pod 的 IP 和端口通过 `__meta_kubernetes_pod_ip` 和端口容器端口映射得到。

2. **Prometheus 如何处理频繁上下线的 Pod？**
   答：Prometheus 的拉取模型天然适配动态 Pod。Pod 上线后，K8s SD 会自动发现；Pod 删除后，下一次拉取失败会自动标记为 stale。建议 `scrape_interval` 不低于 15s，避免漏采。

3. **Relabel 的执行顺序是什么？**
   答：`kubernetes_sd_configs` 的元标签先于 `relabel_configs` 生成；`relabel_configs` 按文件中的顺序执行，先执行 `keep/drop`，再执行 `labelmap/replace/keep/drop`；多个 `relabel_configs` 块按出现顺序执行。

4. **如何监控 Prometheus 自身？**
   答：Prometheus 自身暴露 `/metrics` 端点，通过 `self` 监控自己。也可以用 Prometheus Operator 的 `PrometheusAgent` 模式，让一个 Prometheus 监控另一个。

服务发现是 Prometheus 的灵魂。没有它，监控就是静态的、滞后的；有了它，监控才是动态的、实时的。
