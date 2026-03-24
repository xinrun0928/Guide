# Pod 资源配置：Limit 与 Request

你的 Pod 应该申请多少 CPU 和内存？如果申请太多，资源会浪费；如果申请太少，Pod 可能被 OOM Kill。

理解 Kubernetes 的资源模型，是合理分配资源的前提。

## 基本概念

Kubernetes 使用 **Request（请求）** 和 **Limit（限制）** 来管理资源：

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: nginx
      image: nginx:alpine
      resources:
        requests:
          memory: "128Mi"
          cpu: "100m"
        limits:
          memory: "256Mi"
          cpu: "500m"
```

### Request vs Limit

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Request 和 Limit 的区别                           │
│                                                                     │
│  Request（请求）：                                                  │
│  - Pod 启动时需要的最小资源                                          │
│  - Kubernetes 调度器根据 Request 做调度决策                          │
│  - 保证 Pod 至少能获得 Request 指定的资源                             │
│                                                                     │
│  Limit（限制）：                                                    │
│  - Pod 最多能使用的资源上限                                          │
│  - 超过 Limit 会触发限制（CPU 节流/内存 OOM）                        │
│  - 用于防止单个 Pod 耗尽节点资源                                     │
│                                                                     │
│  节点资源分配：                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  节点总资源 = Allocated (Pod Request) + System Reserved     │  │
│  │                                                              │  │
│  │  调度时：Pod Request ≤ 节点可用资源                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 资源单位

```bash
# CPU 单位
cpu: "0.1"      # 0.1 CPU = 100m（millicores）
cpu: "100m"     # 100 millicores = 0.1 CPU
cpu: "1"        # 1 CPU（等于一个 CPU 核心）

# 内存单位
memory: "128Mi"    # 128 Mebibytes
memory: "128Mi"    # 常用
memory: "1Gi"      # 1 Gibibyte
memory: "1G"       # 1 Gigabyte（近似值，不推荐）
memory: "1048576Ki" # KiB
```

## 调度原理

### Request 与调度

```bash
# 调度器根据 Request 做调度决策
# 节点可分配资源 = 节点总量 - 已调度 Pod 的 Request - 系统预留

# 示例：节点有 4 核 CPU
kubectl describe node node-1

# 输出：
# Allocated resources:
#   Resource           Requests      Limits
#   cpu                2000m (50%)   0 (0%)
#   memory             1Gi (25%)     0 (0%)

# 如果一个 Pod 申请 500m CPU
# 调度器会检查：节点是否有 500m 可用 CPU
# 有 → Pod 可能调度到此节点
# 无 → Pod 进入 Pending
```

### Limit Range 限制

可以为 Namespace 设置默认的 Request 和 Limit：

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limit
  namespace: myapp
spec:
  limits:
    - type: Container
      default:
        memory: 256Mi
        cpu: 200m
      defaultRequest:
        memory: 128Mi
        cpu: 100m
      max:
        memory: 1Gi
        cpu: 1
      min:
        memory: 64Mi
        cpu: 50m
```

```bash
# Pod 未指定 resources 时，自动使用 LimitRange 的 default 值
kubectl apply -f limit-range.yaml

# 查看 LimitRange
kubectl get limitrange -n myapp
kubectl describe limitrange default-limit -n myapp
```

## CPU 限制

### CPU 如何节流

```bash
# CPU 是可压缩资源
# Pod 使用超过 Request 但不超过 Limit 时，会被节流（throttled）
# Pod 使用超过 Limit 时，被强制节流到 Limit

# 示例：
resources:
  requests:
    cpu: 100m
  limits:
    cpu: 500m

# Pod 行为：
# - 正常使用：获得 100m CPU
# - 高负载：可以获得最多 500m CPU
# - 超过 500m：被节流到 500m
```

### CPU 节流示例

```java
// Java 应用 CPU 节流表现
public class CPUIntensiveTask {
    public static void main(String[] args) {
        while (true) {
            // 如果容器 CPU limit 是 500m
            // 这个循环会被 Kubernetes 节流
            doWork();
        }
    }
}
```

## 内存限制

### 内存 OOM

```bash
# 内存是不可压缩资源
# Pod 使用超过 Limit，会触发 OOM Kill
# 容器被杀死，restartCount 增加

# 查看 OOM 状态
kubectl describe pod myapp | grep -A 5 "Last State"

# 输出：
# Last State:     Terminated
#   Reason:       OOMKilled
#   Exit Code:    137
#   Started:      Mon, 01 Jan 2024 09:00:00 +0000
#   Finished:     Mon, 01 Jan 2024 09:30:00 +0000
```

### OOM 优先级

```bash
# 内存不足时，Kubernetes 按以下顺序杀 Pod：
# 1. BestEffort Pod（未设置 resources）
# 2. Burstable Pod（Request < Limit）
# 3. Guaranteed Pod（Request == Limit）

# QoS 等级
kubectl get pod myapp -o jsonpath='{.status.qosClass}'

# Guaranteed Pod（最高优先级，不会被杀）
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "128Mi"
    cpu: "100m"  # request == limit
```

## 资源配额

### ResourceQuota

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: my-quota
  namespace: myapp
spec:
  hard:
    # 资源总量
    requests.cpu: "4"
    requests.memory: "8Gi"
    limits.cpu: "8"
    limits.memory: "16Gi"
    # Pod 数量
    pods: "10"
    # PVC 数量
    persistentvolumeclaims: "5"
```

```bash
# 查看配额使用情况
kubectl get resourcequota -n myapp
kubectl describe resourcequota my-quota -n myapp

# 输出：
# Namespace: myapp
# Resource            Used    Hard
# --------            ----    ----
# cpu                 2       4
# memory              4Gi     8Gi
# pods                6       10
```

## 资源设置最佳实践

### 设置 Request 和 Limit

```yaml
# 推荐：同时设置 Request 和 Limit
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "256Mi"
    cpu: "500m"
```

### JVM 应用配置

```yaml
# Java 应用需要特殊考虑
# JVM 默认会使用宿主机全部内存，需要配置
resources:
  requests:
    memory: "512Mi"
    cpu: "500m"
  limits:
    memory: "512Mi"
    cpu: "1"
env:
  - name: JAVA_OPTS
    value: "-Xmx384m -Xms256m -XX:+UseContainerSupport"
# JAVA_OPTS 说明：
# -Xmx: 最大堆内存（建议为 limit 的 75%）
# -Xms: 初始堆内存
# -XX:+UseContainerSupport: 让 JVM 感知容器限制
```

### Nginx 配置

```yaml
# Nginx 默认启动多个 worker 进程
# 需要限制 worker 进程数
resources:
  requests:
    memory: "64Mi"
    cpu: "50m"
  limits:
    memory: "128Mi"
    cpu: "200m"
env:
  - name: NGINX_WORKER_PROCESSES
    value: "1"
  - name: NGINX_WORKER_CONNECTIONS
    value: "1024"
```

### 常见语言配置

```yaml
# Node.js
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "256Mi"
    cpu: "500m"
env:
  - name: NODE_OPTIONS
    value: "--max-old-space-size=200"
  - name: NODE_ENV
    value: "production"

# Python
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "256Mi"
    cpu: "500m"
```

## 监控资源使用

```bash
# 查看 Pod 资源使用
kubectl top pod

# 按命名空间查看
kubectl top pod -n myapp

# 查看节点资源
kubectl top node

# 查看 Pod 资源请求 vs 实际使用
kubectl describe node node-1 | grep -A 10 "Allocated resources"
```

## 常见问题

### Pod 处于 Pending

```bash
# 原因：没有节点能满足 Pod 的 Request
kubectl describe pod myapp | grep -A 10 "Events"

# 解决方案：
# 1. 增加节点
# 2. 减少 Pod 的 Request
# 3. 清理不必要的 Pod
```

### 容器被 OOM Kill

```bash
# 查看是否被 OOM Kill
kubectl describe pod myapp | grep -A 5 "Last State"
# Reason: OOMKilled

# 解决方案：
# 1. 增加 memory limit
# 2. 优化应用内存使用
# 3. JVM 应用配置 -Xmx
```

### CPU 被节流

```bash
# CPU 节流查看
# Prometheus 查询
# rate(container_cpu_cfs_throttled_seconds_total[5m])

# 解决方案：
# 1. 增加 CPU limit
# 2. 使用更高效的算法
```

## 资源设置检查表

```markdown
# 部署前检查清单

## Request 设置
- [ ] 应用正常运行需要多少 CPU？
- [ ] 应用正常运行需要多少内存？
- [ ] 是否考虑了突发流量？

## Limit 设置
- [ ] 内存限制是否足够避免 OOM？
- [ ] CPU 限制是否考虑正常峰值？
- [ ] Limit 和 Request 的比例是否合理？

## JVM 应用
- [ ] JAVA_OPTS 是否配置了 -Xmx？
- [ ] 是否使用了 -XX:+UseContainerSupport？
- [ ] -Xmx 是否设置为 limit 的 75% 左右？

## 监控
- [ ] 是否设置了资源监控？
- [ ] 是否设置了资源告警？
- [ ] 是否定期审查资源使用情况？
```

## 面试追问

1. **Request 和 Limit 的区别是什么？调度器用哪个做决策？**
2. **如果一个节点只剩 500m CPU 可用，两个都需要 500m CPU 的 Pod 能调度吗？**
3. **CPU 和内存在资源管理上有什么区别？**
4. **什么是 QoS？Guaranteed、Burstable、BestEffort 的区别是什么？**
5. **JVM 应用在容器中运行时，为什么需要特殊配置？**

> "合理的资源设置是保证应用稳定运行的基础。太紧会导致 OOM 和节流，太松会浪费资源。最佳实践是：观察 → 设置 Request → 设置 Limit → 持续调优。"
