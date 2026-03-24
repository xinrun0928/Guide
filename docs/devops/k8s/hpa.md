# Deployment 扩缩容：HPA（Horizontal Pod Autoscaler）

静态的副本数无法应对动态的流量。HPA 让 Deployment 能够根据资源使用情况自动扩缩容。

## HPA 概述

```
┌─────────────────────────────────────────────────────────────────────┐
│                         HPA 工作原理                                  │
│                                                                     │
│  ┌───────────┐                                                     │
│  │   HPA    │                                                     │
│  └─────┬─────┘                                                     │
│        ↓                                                             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Metrics Server                              │  │
│  │              收集 Pod 的资源使用指标                           │  │
│  └──────────────────────────────────────────────────────────────┘  │
│        ↓                                                             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                 计算目标副本数                                  │  │
│  │                                                             │  │
│  │  目标副本数 = ceil(当前副本数 × 当前利用率 / 目标利用率)      │  │
│  │                                                             │  │
│  └──────────────────────────────────────────────────────────────┘  │
│        ↓                                                             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                 Deployment 扩缩容                              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 基本使用

### 安装 Metrics Server

```bash
# 安装 Metrics Server
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# 验证安装
kubectl get apiservices v1beta1.metrics.k8s.io

# 查看节点指标
kubectl top nodes

# 查看 Pod 指标
kubectl top pods
```

### 最小 HPA 配置

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: myapp-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp-deployment
  minReplicas: 3        # 最小副本数
  maxReplicas: 10       # 最大副本数
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70  # CPU 达到 70% 时扩容
```

```bash
# 创建 HPA
kubectl apply -f myapp-hpa.yaml

# 查看 HPA 状态
kubectl get hpa

# 输出：
# NAME        REFERENCE                      TARGETS   MINPODS   MAXPODS   REPLICAS
# myapp-hpa  Deployment/myapp-deployment   45%/70%   3         10        6
```

## 扩缩容指标

### 基于 CPU 利用率

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: myapp-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp-deployment
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

### 基于内存利用率

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: myapp-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp-deployment
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

### 基于多个指标

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: myapp-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp-deployment
  minReplicas: 2
  maxReplicas: 10
  metrics:
    # CPU 指标
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    # 内存指标
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

### 基于自定义指标（Prometheus）

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: myapp-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp-deployment
  minReplicas: 2
  maxReplicas: 10
  metrics:
    # 自定义指标：每秒请求数
    - type: Pods
      pods:
        metric:
          name: http_requests_per_second
        target:
          type: AverageValue
          averageValue: "1000"
```

## 扩缩容行为

### 配置扩缩容速率

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: myapp-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp-deployment
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300  # 缩容冷却时间
      policies:
        - type: Percent
          value: 10                   # 每次最多缩容 10%
          periodSeconds: 60
        - type: Pods
          value: 2                    # 每次最多缩容 2 个 Pod
          periodSeconds: 60
      selectPolicy: Min              # 多个策略时选择最小值
    scaleUp:
      stabilizationWindowSeconds: 0   # 扩容无需等待
      policies:
        - type: Percent
          value: 100                 # 每次最多扩容 100%
          periodSeconds: 15
        - type: Pods
          value: 4                   # 每次最多扩容 4 个 Pod
          periodSeconds: 15
      selectPolicy: Max              # 多个策略时选择最大值
```

### 扩容策略

```yaml
# 保守扩容（避免惊群效应）
behavior:
  scaleUp:
    stabilizationWindowSeconds: 60
    policies:
      - type: Percent
        value: 50                  # 每次最多扩容 50%
        periodSeconds: 60

# 激进扩容（适合突发流量）
behavior:
  scaleUp:
    stabilizationWindowSeconds: 0
    policies:
      - type: Percent
        value: 100                 # 每次最多扩容 100%
        periodSeconds: 15
```

### 缩容策略

```yaml
# 保守缩容（避免频繁抖动）
behavior:
  scaleDown:
    stabilizationWindowSeconds: 600  # 等待 10 分钟
    policies:
      - type: Pods
        value: 1                    # 每次最多缩容 1 个 Pod
        periodSeconds: 300          # 5 分钟内
```

## 扩缩容计算公式

### 目标副本数计算

```
扩缩容公式：

desiredReplicas = ceil(currentReplicas × (currentMetricValue / targetMetricValue))

示例：
- 当前副本数：5
- 当前 CPU 利用率：80%
- 目标 CPU 利用率：70%

desiredReplicas = ceil(5 × (80 / 70))
                = ceil(5 × 1.14)
                = ceil(5.7)
                = 6

结论：扩容到 6 个副本
```

### 冷却时间计算

```yaml
# stabilizationWindowSeconds 防止频繁扩缩容

# 扩容场景：
# Pod 数量从 3 → 6 需要 3 次扩容
# 每次间隔由 periodSeconds 控制

# 缩容场景：
# 等待 stabilizationWindowSeconds 后才缩容
# 防止指标短暂下降导致的误缩容
```

## Deployment 必须配置资源

HPA 需要 Deployment 配置了资源请求才能工作：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-deployment
spec:
  template:
    spec:
      containers:
        - name: myapp
          image: myapp:1.0
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
```

## 常见问题

### HPA 不生效

```bash
# 检查 Deployment 是否配置了资源请求
kubectl describe deployment myapp-deployment | grep -A 5 "Limits"

# 检查 Metrics Server 是否正常
kubectl top nodes
kubectl top pods

# 检查 HPA 配置
kubectl describe hpa myapp-hpa

# 查看 HPA 事件
kubectl get events --field-selector involvedObject.name=myapp-hpa
```

### 扩缩容过于频繁

```yaml
# 原因：
# - 目标利用率设置过低
# - 冷却时间不足

# 解决方案：配置行为策略
behavior:
  scaleDown:
    stabilizationWindowSeconds: 300  # 增加缩容冷却
  scaleUp:
    stabilizationWindowSeconds: 60    # 扩容可以更快
```

### 无法缩容到最小副本数以下

```bash
# 检查是否有 PDB（PodDisruptionBudget）
kubectl get pdb

# 检查 Pod 状态
kubectl get pods -l app=myapp
kubectl describe pod <pod-name> | grep -A 5 "Conditions"
```

## 与 VPA 和 CronJob HPA 的对比

| 特性 | HPA | VPA | CronJob HPA |
|------|-----|-----|--------------|
| **扩缩容方向** | 水平扩缩容 | 垂直扩缩容 | 定时扩缩容 |
| **资源类型** | Pod 副本数 | Pod 资源请求 | Pod 副本数 |
| **触发方式** | 指标阈值 | 指标阈值 | 定时 |
| **适用场景** | 无状态服务 | 有状态服务 | 定时任务 |

## 面试追问

1. **HPA 是怎么工作的？它依赖什么组件？**
2. **HPA 的副本数是怎么计算的？**
3. **如果 HPA 和手动扩缩容同时存在，会发生什么？**
4. **如何防止 HPA 频繁扩缩容？stabilizationWindowSeconds 是怎么工作的？**
5. **HPA 和 VPA 的区别是什么？各自适合什么场景？**

> "HPA 是 Kubernetes 实现弹性伸缩的核心机制。配置合理的指标和冷却时间，既能应对突发流量，又不会导致频繁抖动。记住：扩容要快，缩容要慢——这是保护系统的基本原则。"
