# VPA（垂直 Pod 自动扩缩容）与 CronJob HPA

「水平扩容（HPA）解决了 Pod 数量的问题，但 Pod 规格本身不合理怎么办？」——VPA 和 CronJob HPA 各有应对。

HPA 是水平扩缩（改变 Pod 数量），VPA 是垂直扩缩（改变 Pod 的资源 requests/limits），CronJob HPA 则解决可预期的负载峰值。三者不是替代关系，而是互补。

## VPA：垂直 Pod 自动扩缩容

### 解决的问题

很多应用的资源需求是**相对稳定的**，但初始配置往往不准确：
- requests.cpu 设大了 → 资源浪费，调度效率低
- requests.cpu 设小了 → 资源不足，OOMKilled

VPA 通过分析 Pod 的历史资源使用，自动推荐或直接应用更合理的资源配置。

### VPA 的四种模式

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: api-vpa
  namespace: production
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-backend
  updatePolicy:
    updateMode: "Auto"   # 四种模式，见下表
  resourcePolicy:
    containerPolicies:
      - containerName: api
        minAllowed:
          cpu: 100m
          memory: 128Mi
        maxAllowed:
          cpu: 4
          memory: 8Gi
        controlledResources: ["cpu", "memory"]  # 只控制 CPU 和内存
```

| updateMode | 行为 | 对 Running Pod 的影响 | 适用场景 |
|-----------|------|---------------------|---------|
| Off | 只推荐，不应用 | 无 | 获取建议后再决定 |
| Initial | 只在新 Pod 创建时应用 | 无 | 不想影响现有 Pod |
| Recreate | 更新推荐值并重启 Pod | 立即重启 Pod | 允许中断的批次处理 |
| Auto | 更新推荐值并重启 Pod | 冷却后重启 | 生产环境推荐 |

### VPA 和 HPA 的冲突

**重要**：VPA 和 HPA 不能同时作用于同一个 Deployment。VPA 会修改 Pod 的 requests，从而影响 HPA 的计算基准。

```
错误配置示例：
Deployment (replicas=3)
  ├── HPA (scaleTargetRef → Deployment)
  └── VPA (targetRef → Deployment)  ← 冲突！
```

正确做法：
- 有状态应用：只用 VPA（副本数固定，由 Deployment 管理）
- 无状态应用：只用 HPA（副本数动态，资源 requests 固定）
- 中间路线：HPA 管理副本数，VPA 设置初始值，之后手动调整

### 推荐的 Workaround：VPA 做推荐，HPA 做扩缩

```yaml
# VPA 只做推荐，不自动应用
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: api-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-backend
  updatePolicy:
    updateMode: "Off"  # 只推荐，不修改
---
# HPA 负责副本数管理
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-backend
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

查看 VPA 推荐：

```bash
kubectl describe vpa api-vpa -n production
# Recommendation:
#   Container Recommendations:
#     Container Name:  api
#     Lower Bound:     CPU:    150m  Memory:  200Mi
#     Target:          CPU:    500m  Memory:  512Mi
#     Uncapped Target: CPU:    800m  Memory:  800Mi
#     Upper Bound:     CPU:   2000m  Memory: 2048Mi
```

## CronJob HPA：可预测峰值的应对方案

### 解决的问题

VPA 和 HPA 都是**响应式**的——等指标变化了才扩缩容。但有些负载是可预测的：

- 每天早上 9 点的业务高峰
- 每周一凌晨的批处理任务
- 每月末的报表生成

在这些场景下，HPA 的冷启动延迟（Pod 启动需要 30-60 秒）可能是不可接受的。CronJob HPA 通过定时扩容，在负载到来前就准备好资源。

### 使用 CronHPA

```bash
# 安装 cronhpa
helm install cronhpa cronhpa/cronhpa

# 配置定时扩缩容规则
apiVersion: autoscaling.cronhpa.io/v1
kind: CronHPA
metadata:
  name: api-cronhpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-backend
  cronJobs:
    # 工作日早上 8:30 开始扩容（9 点业务高峰）
    - name: weekday-morning
      schedule: "30 8 * * 1-5"    # 周一到周五 8:30
      targetReplicas: 10           # 扩容到 10 个副本
    # 周末缩容
    - name: weekend-scale
      schedule: "0 10 * * 6,7"   # 周六、周日 10:00
      targetReplicas: 2
    # 月末批处理
    - name: month-end-batch
      schedule: "0 1 28-31 * *"  # 每月 28-31 日凌晨 1:00
      targetReplicas: 20
    # 活动促销（如双11）
    - name: promotion-scale
      schedule: "0 0 11 11 *"    # 每年 11 月 11 日零点
      targetReplicas: 30
```

### HPA + CronJob HPA 配合

```yaml
# CronHPA 设置「最小水位」，HPA 设置「最大弹性」
# 例如：
# - CronHPA 保证工作日至少 10 个副本
# - HPA 在 10-30 个副本之间根据实际负载动态调整

# CronHPA 配置
spec:
  scaleTargetRef:
    kind: Deployment
    name: api-backend
  minReplicas: 10     # CronHPA 保证的下限

# HPA 配置
spec:
  minReplicas: 10      # HPA 的下限
  maxReplicas: 30
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

这种组合的好处：
- **CronHPA**：消除冷启动延迟，提前准备好资源
- **HPA**：处理不可预测的流量峰值
- **互补**：CronHPA 设下限，HPA 设弹性上限

## 三种扩缩容策略对比

| 维度 | HPA | VPA | CronJob HPA |
|------|-----|-----|------------|
| 扩缩方向 | 水平（副本数） | 垂直（资源规格） | 水平（副本数） |
| 触发方式 | 实时指标 | 历史使用分析 | 定时 |
| 响应时间 | 取决于 Pod 启动时间 | 取决于 Pod 重启时间 | 零（已预热） |
| 适用场景 | 不可预测的负载 | 资源规格不合理的应用 | 可预测的负载峰值 |
| 和其他方案共存 | 可同时用 VPA（设 Off） | 和 HPA 冲突 | 可同时用 HPA |

## 面试追问方向

- VPA 和 HPA 为什么不能同时自动作用于同一个 Deployment？
- VPA 的「冷启动」问题怎么解决？为什么 VPA 需要重启 Pod？
- CronJob HPA 和 HPA 的 `stabilizationWindowSeconds` 有什么区别？各自解决什么问题？
- 在 VPA 的四种 updateMode 中，哪个最适合生产环境的无状态服务？为什么？

> 扩缩容不是单一工具能解决的问题。HPA 负责弹性，VPA 负责规格合理化，CronJob HPA 负责消除冷启动——三种武器配合，才能构建真正智能的弹性伸缩体系。
