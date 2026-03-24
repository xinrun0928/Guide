# HPA 进阶：自定义指标与 External Metrics

「CPU 和内存不够用了，我还想用业务指标做自动扩缩容。」——HPA v2 满足你。

基础的 HPA 只能基于 CPU 和内存扩缩容，这是远远不够的。生产环境中，你可能需要根据**队列长度、QPS、响应延迟、订单量**等业务指标来决定是否扩容。HPA 的 Custom Metrics API 和 External Metrics API 正是为此设计的。

## HPA 扩缩容的三个层次

| 层次 | 指标来源 | 使用场景 | 配置难度 |
|------|---------|---------|---------|
| 基础 HPA | metrics-server（CPU/内存） | 通用场景 | 简单 |
| Custom Metrics | Prometheus Adapter（应用自定义指标） | 业务指标 | 中等 |
| External Metrics | External Metrics Provider（外部系统指标） | 队列长度、QPS | 较复杂 |

```
┌─────────────────────────────────────────────────────────────┐
│                      HPA Controller                         │
│                                                           │
│   ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│   │ metrics-    │  │ Custom       │  │ External        │  │
│   │ server      │  │ Metrics API  │  │ Metrics API     │  │
│   └──────┬──────┘  └──────┬───────┘  └────────┬────────┘  │
│          │                │                    │            │
└──────────┼────────────────┼────────────────────┼────────────┘
           │                │                    │
     ┌─────┴─────┐    ┌─────┴──────┐    ┌────────┴────────┐
     │ kube-     │    │ Prometheus │    │ External Metrics│
     │ metrics   │    │ Adapter    │    │ Provider        │
     │ API       │    │            │    │ (如 KEDA)       │
     └───────────┘    └────────────┘    └─────────────────┘
```

## 自定义指标（Custom Metrics）

### 架构：Prometheus + Prometheus Adapter

```bash
# 安装 Prometheus Operator（或直接安装 Prometheus）
helm install prometheus prometheus-community/kube-prometheus-stack

# 安装 Prometheus Adapter（核心组件）
helm install prometheus-adapter prometheus-community/prometheus-adapter \
  --set prometheus.url=http://prometheus-server \
  --set prometheus.port=9090
```

### 配置指标映射规则

Prometheus Adapter 通过 `rules` 配置决定从 Prometheus 中提取哪些指标：

```yaml
# prometheus-adapter 的 ConfigMap 配置
apiVersion: v1
kind: ConfigMap
metadata:
  name: adapter-config
  namespace: monitoring
data:
  config.yaml: |
    rules:
      # 自定义指标：将 Prometheus 的 http_requests_total 暴露给 HPA
      - seriesQuery: 'http_requests_total{kubernetes_namespace!="",kubernetes_pod_name!=""}'
        resources:
          overrides:
            kubernetes_namespace:
              resource: namespace
            kubernetes_pod_name:
              resource: pod
        name:
          matches: "^(.*)_total"
          as: "${1}_per_second"
        metricsQuery: 'sum(rate(<<.Series>>{<<.LabelMatchers>>}[2m])) by (<<.GroupBy>>)'

      # 应用层 QPS 指标
      - seriesQuery: 'app_requests_total{service!=""}'
        resources:
          overrides:
            service:
              resource: service
        name:
          as: "requests_per_second"
        metricsQuery: 'sum(rate(<<.Series>>[5m])) by (<<.GroupBy>>)'
```

### 在 HPA 中使用自定义指标

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-backend
  minReplicas: 2
  maxReplicas: 20
  metrics:
    # CPU 指标（metrics-server）
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    # 自定义指标：每秒请求数
    - type: Pods
      pods:
        metric:
          name: requests_per_second
        target:
          type: AverageValue
          averageValue: "1000"   # 每秒 1000 QPS 时扩容
    # 对象指标：队列长度
    - type: Object
      object:
        describedObject:
          apiVersion: v1
          kind: Service
          name: task-queue
        metric:
          name: queue_depth
        target:
          type: AverageValue
          averageValue: "100"
```

## 外部指标（External Metrics）

External Metrics 用于基于**集群外部系统**的指标扩缩容，比如消息队列深度、外部 API 的 QPS、云厂商负载均衡器的连接数等。

### 常用场景

| 场景 | 外部指标 | 扩缩容原因 |
|------|---------|-----------|
| 消息队列 | RabbitMQ/Kafka 队列深度 | 队列积压时扩容 worker |
| CronJob | 定时任务触发 | 任务开始前预热 |
| 外部 API | 第三方服务的 QPS | 第三方限流时控制请求量 |
| 负载均衡 | ALB/NLB 连接数 | 流量突增时自动响应 |

### 集成 KEDA

KEDA（Kubernetes Event-Driven Autoscaling）是外部指标扩缩容的最佳实践：

```bash
# 安装 KEDA
helm repo add kedacore https://kedacore.github.io/charts
helm install kedacore kedacore/keda

# 使用 KEDA 的 ScaledObject（替代 HPA）
apiVersion: keda.k8s.io/v1alpha1
kind: ScaledObject
metadata:
  name: worker-scaledobject
  namespace: production
spec:
  scaleTargetRef:
    name: task-worker
  minReplicaCount: 1
  maxReplicaCount: 10
  pollingInterval: 15    # 指标轮询间隔（秒）
  cooldownPeriod: 300   # 缩容冷却时间（秒）
  triggers:
    # 基于 RabbitMQ 队列深度
    - type: rabbitmq
      metadata:
        host: amqp://rabbitmq:5672
        queueName: task_queue
        queueLength: "100"   # 队列每积压 100 条消息扩容 1 个 Pod
```

### KEDA 支持的常见触发器

```yaml
triggers:
  # Prometheus（自定义指标）
  - type: prometheus
    metadata:
      serverAddress: http://prometheus:9090
      metricName: http_requests_per_second
      threshold: "1000"
      query: sum(rate(http_requests_total[2m]))

  # AWS CloudWatch
  - type: aws-cloudwatch
    metadata:
      namespace: AWS/EC2
      metricName: CPUUtilization
      dimensions:
        - name: InstanceId
          value: '*'
      targetMetricValue: "70"
      metricTargetType: average

  # Redis
  - type: redis
    metadata:
      address: redis-master:6379
      listName: my-list
      listLength: "1000"

  # MySQL
  - type: mysql
    metadata:
      host: mysql.default.svc.cluster.local
      username: app_user
      passwordFromEnvVar: DB_PASSWORD
      query: "SELECT COUNT(*) FROM orders WHERE status='pending'"
      metricValue: "100"
```

## 扩缩容算法

HPA 的扩缩容算法：

```
desiredReplicas = ceil(currentReplicas * (currentMetricValue / targetMetricValue))
```

但实际算法更复杂，考虑了多个因素：

```yaml
spec:
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0   # 扩容时无冷却（立即响应）
      policies:
        - type: Percent
          value: 100                   # 每次最多增加 100% 的 Pod（即翻倍）
          periodSeconds: 15
        - type: Pods
          value: 4                     # 或每次最多增加 4 个 Pod
          periodSeconds: 15
      selectPolicy: Max              # 多个策略取最激进的
    scaleDown:
      stabilizationWindowSeconds: 300  # 缩容冷却 5 分钟
      policies:
        - type: Pods
          value: 1                     # 每次最多缩容 1 个 Pod
          periodSeconds: 60
      selectPolicy: Min              # 多个策略取最保守的
```

## 最佳实践

1. **设置合理的 minReplicas**：永远保留至少 2 个副本，避免冷启动延迟
2. **设置 maxReplicas 上限**：防止失控扩容
3. **配置缩容冷却**：防止抖动导致频繁扩缩（`stabilizationWindowSeconds`）
4. **监控 HPA 行为**：记录每次扩缩的事件和原因
5. **业务指标优先于资源指标**：应用层指标比底层资源更能反映真实需求

## 面试追问方向

- Custom Metrics API 和 External Metrics API 有什么区别？分别对应什么使用场景？
- Prometheus Adapter 的 `rules` 配置中，`seriesQuery` 和 `metricsQuery` 各起什么作用？
- HPA 的 `stabilizationWindowSeconds` 在扩容和缩容时各有什么作用？
- KEDA 和原生 HPA 相比，优势在哪里？它的工作原理是什么？

> HPA 是 K8s 自动化的核心能力之一。掌握 Custom Metrics 和 External Metrics，意味着你不再受限于 CPU/内存，而是可以根据业务真实需求做精准的弹性伸缩。
