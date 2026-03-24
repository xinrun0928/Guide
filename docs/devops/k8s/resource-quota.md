# 资源配额：ResourceQuota、LimitRange

「如何防止某个团队把集群资源耗尽？」——ResourceQuota 和 LimitRange 是 K8s 的资源管控双雄。

多租户 K8s 集群中，不同团队、不同项目共用一个集群是常态。如果某个团队的 Deployment 把所有 CPU 和内存都占用了，其他团队的应用就只能「排队等资源」。ResourceQuota 和 LimitRange 分别从**集群级**和**Namespace 级**两个维度解决这个问题的。

## ResourceQuota：命名空间级别的资源天花板

ResourceQuota 限制一个 Namespace 内的**资源总量**。

### 基本配置

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: production-quota
  namespace: production
spec:
  hard:
    # 计算资源
    requests.cpu: "20"
    requests.memory: 40Gi
    limits.cpu: "40"
    limits.memory: 80Gi
    # 对象数量
    pods: "100"
    services: "20"
    secrets: "10"
    configmaps: "20"
    persistentvolumeclaims: "10"
    # 存储总量
    requests.storage: 500Gi
    # 特定 StorageClass 限制
    gold.storageclass.storage.k8s.io/requests.storage: 100Gi
    silver.storageclass.storage.k8s.io/requests.storage: 300Gi
```

### 作用域（Scope）

ResourceQuota 可以针对特定 Pod 集合设置不同的配额：

```yaml
spec:
  scopes:
    - Terminating    # 匹配 .spec.activeDeadlineSeconds >= 0 的 Pod（Job/Deployment 有截止时间）
    - NotTerminating # 匹配 .spec.activeDeadlineSeconds == nil 的 Pod（无截止时间的长期运行 Pod）
    - BestEffort    # 匹配 QoS 为 BestEffort 的 Pod（无资源 requests/limits）
    - NotBestEffort # 匹配 QoS 为 Burstable 或 Guaranteed 的 Pod
  hard:
    pods: "50"    # 只限制 BestEffort Pod
```

### 配额作用域示例

```yaml
# 限制长期运行的 Pod（无截止时间）
apiVersion: v1
kind: ResourceQuota
metadata:
  name: long-running-quota
  namespace: production
spec:
  scopes:
    - NotTerminating
  hard:
    pods: "80"
    requests.cpu: "16"
    limits.cpu: "32"
---
# 限制短期 Job（带截止时间）
apiVersion: v1
kind: ResourceQuota
metadata:
  name: batch-quota
  namespace: production
spec:
  scopes:
    - Terminating
  hard:
    pods: "200"    # 允许更多短期 Job Pod
```

### 查看配额使用情况

```bash
kubectl describe resourcequota -n production
# Name:            production-quota
# Namespace:       production
# Resource         Used    Hard
# --------         ---    ---
# limits.cpu       8       40
# limits.memory    16Gi    80Gi
# pods             45       100
# requests.cpu     4       20
# requests.memory  8Gi     40Gi
```

## LimitRange：单个 Pod/容器的资源边界

LimitRange 限制 Namespace 内**单个 Pod 或容器**的资源大小。它有两个作用：
1. **设置默认值**：如果 Pod 未指定资源 limits/requests，LimitRange 自动注入默认值
2. **设置上下限**：即使 Pod 指定了资源，也必须落在 LimitRange 规定的范围内

### 默认值配置

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: production
spec:
  limits:
    # 默认容器级别的 limits
    - type: Container
      default:
        cpu: 500m
        memory: 256Mi
      defaultRequest:
        cpu: 200m
        memory: 128Mi
      max:
        cpu: "4"
        memory: 4Gi
      min:
        cpu: 50m
        memory: 64Mi
      maxLimitRequestRatio:
        cpu: "10"      # limits.cpu / requests.cpu <= 10
        memory: "4"    # limits.memory / requests.memory <= 4
    # Pod 级别限制
    - type: Pod
      max:
        cpu: "8"
        memory: 16Gi
      min:
        cpu: 100m
        memory: 128Mi
    # PVC 级别限制
    - type: PersistentVolumeClaim
      max:
        storage: 100Gi
      min:
        storage: 1Gi
```

### LimitRange 的默认值机制

```yaml
# 一个没有设置资源 limits 的 Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  namespace: production
spec:
  template:
    spec:
      containers:
        - name: myapp
          image: myapp:v1
          # 没有设置 resources，自动从 LimitRange 继承
          # requests.cpu = 200m, limits.cpu = 500m
```

**这是 LimitRange 最重要的功能**：让所有 Pod 都有一个资源 limits，即使开发者没有主动设置。

## 两者配合使用

ResourceQuota 和 LimitRange 是互补的，配合使用才能实现完整的资源治理：

```
ResourceQuota（Namespace 总量限制）
├── 总 CPU requests: 20 核
├── 总 Memory requests: 40Gi
└── 总 Pod 数: 100
         │
         ▼
LimitRange（单个 Pod 限制）
├── 每容器 CPU requests: 100m - 4 核
├── 每容器 Memory requests: 128Mi - 4Gi
└── 每 Pod 最大 CPU: 8 核
         │
         ▼
Deployment（实际使用）
├── Pod 1: requests.cpu=500m
├── Pod 2: requests.cpu=200m
└── Pod 3: requests.cpu=1
         │
         ▼
总和不能超过 ResourceQuota 的上限
```

## 常见问题

### 配额超限导致 Pod 创建失败

```bash
kubectl describe pod myapp-xxx
# Warning  FailedCreate  ...  "exceeded quota: production-quota, requested: requests.cpu=1, used: requests.cpu=19, limited: requests.cpu=20"
# 解决：申请更多配额，或删除不需要的资源
```

### LimitRange 默认值和实际需求不符

如果 LimitRange 设置的默认值太小：

```bash
# 部署时报错
# Error creating: Pod "myapp-xxx" is invalid: spec.containers[0].resources.requests.cpu: Invalid value: "100m": must be greater than or equal to 200m

# 解决：修改 LimitRange 的 min 值，或者在 Pod spec 中明确指定更大的 requests
```

### PVC 大小限制

```yaml
# 如果应用请求的 PVC 大小超过 LimitRange 的 max，PVC 创建失败
kubectl get pvc myclaim -n production
# Error: "admission webhook \"storagequota.storage.k8s.io\" denied the request"
```

## 最佳实践

### 1. 为每个 Namespace 设置 ResourceQuota

```yaml
# production namespace
apiVersion: v1
kind: Namespace
metadata:
  name: production
---
apiVersion: v1
kind: ResourceQuota
metadata:
  name: production-quota
  namespace: production
spec:
  hard:
    requests.cpu: "32"
    requests.memory: 64Gi
    limits.cpu: "64"
    limits.memory: 128Gi
    pods: "200"
```

### 2. 设置合理的 LimitRange 默认值

默认值不能太大（浪费资源），也不能太小（Pod 跑不起来）：

```yaml
# 生产环境推荐配置
limits:
  - type: Container
    default:
      cpu: 1000m
      memory: 512Mi
    defaultRequest:
      cpu: 200m
      memory: 256Mi
    max:
      cpu: "8"
      memory: 16Gi
    min:
      cpu: 50m
      memory: 64Mi
    maxLimitRequestRatio:
      memory: "4"
```

### 3. 分层配额

对于大团队，可以按团队设置子配额：

```yaml
# 给 production 下的 team-backend 设置子配额
apiVersion: v1
kind: ResourceQuota
metadata:
  name: team-backend-quota
  namespace: production
spec:
  hard:
    requests.cpu: "10"
    requests.memory: 20Gi
    pods: "50"
```

## 面试追问方向

- ResourceQuota 和 LimitRange 的本质区别是什么？两者各解决什么问题？
- 如果 LimitRange 设置了 `maxLimitRequestRatio`，哪些情况会导致 Pod 创建失败？
- ResourceQuota 的 `pods` 计数是按什么状态的 Pod 计算的？Pending 和 Terminating 的 Pod 算吗？
- 配额超限后，Pod 会处于什么状态？kubectl get pods 显示什么？

> ResourceQuota 是 Namespace 的「天花板」，LimitRange 是单个 Pod 的「安全带」。两者配合，让多租户集群的资源分配既公平又安全。
