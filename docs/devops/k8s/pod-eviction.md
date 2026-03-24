# Pod 驱逐策略与优先级

你的集群内存不足了，谁的 Pod 会被驱逐？为什么某些关键服务总是「运气好」不会被驱逐？

理解 Pod 驱逐机制，是保障集群稳定运行的关键。

## Kubernetes 如何决定驱逐顺序

当节点资源紧张时，Kubernetes 按照以下顺序决定驱逐优先级：

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Pod 驱逐优先级                                    │
│                                                                     │
│  优先级从低到高：                                                   │
│                                                                     │
│  1. BestEffort（最低优先级）                                       │
│     - 未设置 resources 的 Pod                                       │
│     - QoS 等级：BestEffort                                         │
│                                                                     │
│  2. Burstable                                                      │
│     - 设置了 resources，但 request != limit                        │
│     - QoS 等级：Burstable                                          │
│                                                                     │
│  3. Guaranteed（最高优先级）                                        │
│     - resources 的 request == limit                                │
│     - QoS 等级：Guaranteed                                         │
│                                                                     │
│  同优先级 Pod：随机选择                                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### QoS 等级判定

```bash
# Guaranteed Pod
# 条件：所有容器都设置了 resources，且 request == limit
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "128Mi"
    cpu: "100m"  # request == limit

# Burstable Pod
# 条件：至少一个容器设置了 resources，但不完全满足 Guaranteed
resources:
  requests:
    memory: "64Mi"
    cpu: "50m"
  limits:
    memory: "128Mi"
    cpu: "100m"  # request != limit

# BestEffort Pod
# 条件：所有容器都未设置 resources
# 无任何 resources 配置
```

## 资源不足时的驱逐场景

### 内存压力（Memory Pressure）

```bash
# 节点内存不足时的驱逐顺序
kubectl describe node <node-name> | grep -A 10 "Conditions"

# 输出：
# Type                 Status
# MemoryPressure       True    ← 内存压力
# DiskPressure         False
# PIDPressure          False
# NetworkUnavailable    False

# 节点状态为 MemoryPressure 时，kubelet 开始驱逐 Pod
```

### 磁盘压力（Disk Pressure）

```bash
# 磁盘空间不足
# - 镜像层占满磁盘
# - 日志文件过多
# - emptyDir 空间耗尽

# 排查
kubectl describe node <node-name> | grep "Conditions"
df -h
docker system df
```

### PID 压力（PID Pressure）

```bash
# 进程数过多
# 防止 fork 炸弹攻击
# 建议为 Pod 设置 pids limit

kubectl describe node <node-name> | grep "Conditions"
# Type            Status
# PIDPressure      True

# 解决方案
# 1. 限制 Pod 的 PID 数量
# 2. 排查异常进程
```

## Pod 优先级（Priority）

### PriorityClass

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-priority
value: 10000              # 优先级值，越大越高
globalDefault: false      # 是否作为默认优先级
description: "生产环境关键服务"
```

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: medium-priority
value: 5000
description: "普通服务"
```

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: low-priority
value: 1000
description: "测试环境服务"
```

### 使用优先级

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: critical-service
spec:
  priorityClassName: high-priority
  containers:
    - name: nginx
      image: nginx:alpine
```

### 优先级对调度的影响

```bash
# 高优先级 Pod 可以「抢占」低优先级 Pod 的资源
# 当集群资源不足时：
# 1. 高优先级 Pod 无法调度
# 2. 系统驱逐低优先级 Pod
# 3. 高优先级 Pod 调度成功

# 查看抢占决策
kubectl describe pod high-priority-pod | grep -A 10 "Events"
# Warning  FailedScheduling ... Pod was rejected, pod is pending but cluster has insufficient free resource
```

### 抢占调度（Preemption）

```bash
# 抢占调度的工作流程
# 1. 高优先级 Pod 调度失败（Pending）
# 2. Scheduler 寻找可以驱逐低优先级 Pod 的节点
# 3. 驱逐低优先级 Pod
# 4. 高优先级 Pod 调度成功

# 查看被抢占的 Pod
kubectl get events --field-selector reason=Preemption

# 查看抢占后被驱逐的 Pod
kubectl get events --field-selector reason=Preempted
```

## 优雅驱逐配置

### tolerationSeconds

```yaml
apiVersion: v1
kind: Pod
spec:
  tolerations:
    - key: dedicated
      operator: Exists
      effect: NoExecute
      tolerationSeconds: 3600  # 节点被标记 NoExecute 后，3600 秒后才开始驱逐
```

### 节点压力驱逐延迟

```yaml
# kubelet 配置
# --eviction-pressure-transition-period 默认 5 分钟
# 节点进入压力状态后，等待一段时间才触发驱逐
# 给 Pod 足够时间响应 SIGTERM

# 调整 kubelet 配置
kubectl edit configmap kubelet-config -n kube-system
```

## Pod 中断预算（PDB）

PDB 确保在集群发生变更时，关键服务的最小副本数：

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb
spec:
  # 最少保持 2 个 Pod 运行
  minAvailable: 2
  # 或者使用百分比
  # minAvailable: 50%
  selector:
    matchLabels:
      app: web
```

```yaml
# 使用 maxUnavailable
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: web-pdb
spec:
  maxUnavailable: 1   # 最多有 1 个 Pod 不可用
  selector:
    matchLabels:
      app: web
```

### PDB 工作原理

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Pod 中断预算工作原理                              │
│                                                                     │
│  Deployment 配置：replicas=5                                         │
│  PDB 配置：minAvailable=3                                            │
│                                                                     │
│  允许同时中断的 Pod 数 = 5 - 3 = 2                                 │
│                                                                     │
│  节点维护场景：                                                     │
│  - 节点 A 需要维护                                                   │
│  - 节点 A 上有 3 个 web Pod                                         │
│  - 系统最多驱逐 2 个 Pod                                            │
│  - 剩余 3 个 Pod 保证服务可用                                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 查看 PDB 状态

```bash
# 查看 PDB 状态
kubectl get pdb

# 输出：
# NAME     MINAVAILABLE   MAXUNAVAILABLE   ALLOWEDDISRUPTIONS
# web-pdb  2              N/A              3

# 查看 PDB 详情
kubectl describe pdb web-pdb

# 查看允许的中断次数
kubectl exec -it web-deployment-xxx -- kubectl get pdb
```

## 常见驱逐场景

### 场景1：节点缩容

```bash
# 缩减节点池
# 节点上的 Pod 需要重新调度

# 过程：
# 1. 节点被标记为不可调度
kubectl cordon node-1
# 或
kubectl drain node-1 --ignore-daemonsets --delete-emptydir-data

# 2. Pod 被驱逐到其他节点
# 3. 考虑 PDB 约束
# 4. 逐个驱逐，直到满足 PDB
```

### 场景2：资源不足

```bash
# 原因：
# - 节点资源不足（内存/磁盘/CPU）
# - Pod 请求的资源超过节点可用

# 表现：
# - Pod 处于 Pending
# - 现有 Pod 被驱逐

# 解决方案：
# 1. 增加节点
# 2. 降低 Pod 资源请求
# 3. 配置资源配额（ResourceQuota）
# 4. 使用 Cluster Autoscaler
```

### 场景3：节点异常

```bash
# 节点 NotReady
kubectl get nodes
# 输出：
# NAME      STATUS     ROLES           AGE
# node-1    NotReady   worker          100d

# kubelet 无法与 API Server 通信
# 节点上的 Pod 被标记为 Terminating
# Controller Manager 开始重新调度

# 等待时间（默认 40 秒）
# --pod-eviction-timeout 40s
```

## 驱逐调试

```bash
# 查看驱逐事件
kubectl get events --field-selector reason=Eviction

# 查看 Pod 被驱逐原因
kubectl describe pod <pod-name> | grep -A 10 "Events"

# 查看节点压力状态
kubectl describe node <node-name> | grep -A 10 "Conditions"

# 查看 kubelet 日志
kubectl logs -n kube-system kubelet-<node-name> --tail=100

# 查看 Pod 的 QoS 等级
kubectl get pod <pod-name> -o jsonpath='{.status.qosClass}'
```

## 最佳实践

### 1. 设置合理的资源请求

```yaml
# 推荐：为所有 Pod 设置资源请求
# 确保调度器能正确决策
# 确保 QoS 等级正确
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "256Mi"
    cpu: "500m"
```

### 2. 使用优先级类

```yaml
# 为关键服务设置高优先级
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: production-critical
value: 100000
globalDefault: false
---
apiVersion: v1
kind: Pod
spec:
  priorityClassName: production-critical
```

### 3. 配置 PDB

```yaml
# 为关键服务配置 PodDisruptionBudget
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: critical-app-pdb
spec:
  minAvailable: 2  # 始终保留至少 2 个副本
  selector:
    matchLabels:
      app: critical-app
```

### 4. 配置优雅终止

```yaml
spec:
  terminationGracePeriodSeconds: 60
  containers:
    - name: app
      lifecycle:
        preStop:
          exec:
            command: ["/bin/sh", "-c", "sleep 10"]
```

## 面试追问

1. **Kubernetes 驱逐 Pod 的顺序是什么？依据是什么？**
2. **什么是 QoS 等级？Guaranteed、Burstable、BestEffort 怎么判定？**
3. **Pod 优先级是怎么实现的？高优先级 Pod 可以抢占低优先级的吗？**
4. **PodDisruptionBudget 是怎么工作的？它能保证什么？**
5. **节点内存不足时，kubelet 是怎么决定驱逐哪些 Pod 的？**

> "Pod 驱逐看似是 Kubernetes 自动处理的，但理解其机制才能设计出稳定可靠的系统。设置合理的资源请求、使用优先级、配置 PDB——这些都是在为『万一』做准备，而 Kubernetes 生产环境，『万一』总会发生。"
