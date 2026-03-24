# Pod 调度机制：NodeSelector、Affinity、Taint 与 Toleration

为什么 Pod 总是被调度到某些节点？为什么某些节点从来不跑 Pod？为什么数据库 Pod 被调度到了没有 SSD 的节点？

答案在于 Kubernetes 的调度机制。

## 调度流程概述

Kubernetes 的调度分为三个阶段：

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Pod 调度流程                                   │
│                                                                     │
│  1. 预选（Filtering）                                              │
│     找出所有满足条件的节点                                           │
│     - 资源是否足够？                                               │
│     - 端口是否冲突？                                               │
│     - 节点是否被标记为不可调度？                                      │
│     - 污点/容忍是否匹配？                                          │
│                                                                     │
│  2. 优选（Scoring）                                                │
│     对通过的节点进行评分                                            │
│     - 资源使用率                                                   │
│     - 亲和性优先级                                                 │
│     - 拓扑距离                                                     │
│                                                                     │
│  3. 选定（Selection）                                              │
│     选择得分最高的节点                                              │
│     如果有多个同分，随机选择                                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## NodeSelector：最简单的调度方式

NodeSelector 通过节点标签选择目标节点：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx
spec:
  nodeSelector:
    disktype: ssd          # 选择标签为 disktype=ssd 的节点
    region: us-east-1
  containers:
    - name: nginx
      image: nginx:alpine
```

```bash
# 给节点打标签
kubectl label node node-1 disktype=ssd
kubectl label node node-2 disktype=HDD
kubectl label node node-1 region=us-east-1

# 查看节点标签
kubectl get nodes --show-labels

# 删除标签
kubectl label node node-1 disktype-

# 调度失败排查
kubectl describe pod nginx | grep -A 5 "Events"
# Warning  FailedScheduling  ... no suitable node for selector
```

### NodeSelector 局限性

NodeSelector 只能做简单的「匹配/不匹配」，无法处理更复杂的逻辑。

## 节点亲和性与反亲和性

Affinity/Anti-Affinity 提供了更强大的选择能力：

### 节点亲和性（Node Affinity）

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx
spec:
  affinity:
    nodeAffinity:
      # 必须满足的条件（硬限制）
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: disktype
                operator: In
                values:
                  - ssd
              - key: memory
                operator: Gt
                values:
                  - "8Gi"
      # 优先满足的条件（软限制）
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 1
          preference:
            matchExpressions:
              - key: zone
                operator: In
                values:
                  - us-east-1a
        - weight: 2
          preference:
            matchExpressions:
              - key: zone
                operator: In
                values:
                  - us-east-1b
  containers:
    - name: nginx
      image: nginx:alpine
```

### 操作符说明

```yaml
# In: 值在列表中
operator: In
values: [value1, value2]

# NotIn: 值不在列表中
operator: NotIn
values: [value1]

# Exists: 键存在（不关心值）
operator: Exists

# DoesNotExist: 键不存在
operator: DoesNotExist

# Gt: 值大于（字符串比较）
operator: Gt
values: ["8Gi"]

# Lt: 值小于
operator: Lt
values: ["8Gi"]
```

## Pod 亲和性与反亲和性

### Pod 反亲和性（避免调度到同一节点）

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    spec:
      affinity:
        # 避免同一区域的 Pod 调度到同一节点
        podAntiAffinity:
          # 必须满足
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchExpressions:
                  - key: app
                    operator: In
                    values:
                      - nginx
              topologyKey: topology.kubernetes.io/zone
      containers:
        - name: nginx
          image: nginx:alpine
```

### Pod 亲和性（倾向于调度到同一拓扑）

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: frontend
  template:
    spec:
      affinity:
        # 希望 frontend 和 backend 调度到同一区域
        podAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchLabels:
                    app: backend
                topologyKey: topology.kubernetes.io/zone
      containers:
        - name: nginx
          image: nginx:alpine
```

### 拓扑键（topologyKey）

```yaml
# 常用拓扑键
topologyKey: kubernetes.io/hostname        # 同一主机
topologyKey: topology.kubernetes.io/zone    # 同一可用区
topologyKey: topology.kubernetes.io/region  # 同一地域
topologyKey: topology.example.com/rack       # 自定义拓扑
```

## Taint 与 Toleration：节点驱赶 Pod

Taint 让节点「排斥」Pod，Toleration 让 Pod「容忍」这些排斥。

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Taint 与 Toleration 机制                            │
│                                                                     │
│  节点（Node）：                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Taint: "only-databases"                                   │  │
│  │  Effect: NoSchedule                                        │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Pod：                                                             │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Toleration: "only-databases"                               │  │
│  │  Operator: Exists                                           │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  结果：数据库 Pod 可以调度到带有 taint 的节点                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 污点效果（Effect）

```bash
# NoSchedule：不允许调度新的 Pod，不影响已有的
kubectl taint node node-1 dedicated=database:NoSchedule

# PreferNoSchedule：尽量不调度，不保证
kubectl taint node node-1 dedicated=database:PreferNoSchedule

# NoExecute：不允许调度，并且驱逐已有的 Pod
kubectl taint node node-1 dedicated=database:NoExecute
```

### 定义 Toleration

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: mysql
spec:
  tolerations:
    # 匹配污点 dedicated=database:NoSchedule
    - key: dedicated
      operator: Equal
      value: database
      effect: NoSchedule

    # 匹配任意值的 dedicated 污点
    - key: dedicated
      operator: Exists
      effect: NoSchedule

    # 匹配任意 key，任意 value，任意 effect
    - key: dedicated
      operator: Exists

    # 容忍所有 NoExecute 污点（带过期时间）
    - key: dedicated
      operator: Exists
      effect: NoExecute
      tolerationSeconds: 3600  # 3600 秒后被驱逐
  containers:
    - name: mysql
      image: mysql:8.0
```

### 常见场景

```bash
# 场景1：专用节点（只运行数据库）
kubectl taint node db-node dedicated=database:NoSchedule
# 数据库 Pod 需要添加对应 toleration

# 场景2：节点维护（驱逐 Pod）
kubectl taint node node-1 maintenance=true:NoExecute
# Pod 会被驱逐到其他节点

# 场景3：GPU 节点
kubectl taint node gpu-node gpu=true:NoSchedule
# 只有需要 GPU 的 Pod 才能调度

# 场景4：临时维护
kubectl taint node node-1 maintenance=true:NoExecute --overwrite
# 完成后移除污点
kubectl taint node node-1 maintenance-
```

### 内置污点

```bash
# 节点不可用
kubectl taint nodes node-1 node.kubernetes.io/not-ready:NoExecute

# 节点网络不可用
kubectl taint nodes node-1 node.kubernetes.io/network-unavailable:NoExecute

# 节点磁盘空间不足
kubectl taint nodes node-1 node.kubernetes.io/disk-pressure:NoExecute

# 节点内存不足
kubectl taint nodes node-1 node.kubernetes.io/memory-pressure:NoExecute
```

## 调度策略组合

### 场景1：Web 服务高可用

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
  selector:
    matchLabels:
      app: web
  template:
    spec:
      affinity:
        # 反亲和性：Pod 不在同一节点
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchLabels:
                  app: web
              topologyKey: kubernetes.io/hostname
      containers:
        - name: web
          image: nginx:alpine
```

### 场景2：数据库主从分离

```yaml
# 主库节点
kubectl taint node db-node-1 role=db-master:NoSchedule
# 从库节点
kubectl taint node db-node-2 role=db-slave:NoSchedule
```

```yaml
# 主库 Pod
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
spec:
  selector:
    matchLabels:
      app: mysql
  template:
    spec:
      tolerations:
        - key: role
          operator: Equal
          value: db-master
          effect: NoSchedule
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: role
                    operator: Equal
                    values:
                      - db-master
```

### 场景3：优先调度到低负载节点

```yaml
apiVersion: apps/v1
kind: Pod
spec:
  affinity:
    nodeAffinity:
      # 尽量选择资源充足的节点
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 100
          preference:
            matchExpressions:
              - key: memory-availability
                operator: In
                values:
                  - high
        - weight: 50
          preference:
            matchExpressions:
              - key: zone
                operator: In
                values:
                  - us-east-1a
```

## 调度优先级

可以通过 PriorityClass 控制 Pod 调度优先级：

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-priority
value: 10000
globalDefault: false
description: "This priority class should be used for critical pods"
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: critical-nginx
spec:
  priorityClassName: high-priority
  containers:
    - name: nginx
      image: nginx:alpine
```

## 调试调度问题

```bash
# 查看 Pod 调度详情
kubectl describe pod <pod-name> | grep -A 10 "Events"

# 查看节点详情
kubectl describe node <node-name>

# 查看调度器日志
kubectl logs -n kube-system kube-scheduler-<node-name>

# 测试调度（不实际创建 Pod）
kubectl debug <pod-name> --image=busybox --dry-run=client -o yaml > pod.yaml

# 查看调度决策原因
kubectl get pod <pod-name> -o yaml | grep -A 5 "conditions"
```

## 面试追问

1. **NodeSelector、Affinity、Taint 三种调度方式有什么区别？各自适合什么场景？**
2. **Taint 的三种 Effect（NoSchedule、PreferNoSchedule、NoExecute）有什么区别？**
3. **Pod 反亲和性是怎么实现高可用的？**
4. **如果一个节点被打上了 NoExecute 污点，Pod 会被驱逐吗？驱逐的时间可以控制吗？**
5. **Toleration 的 operator 有哪些？Exists 和 Equal 有什么区别？**

> "调度的本质是『把合适的 Pod 放到合适的节点上』。理解 NodeSelector 做简单选择、Affinity 做偏好选择、Taint/Toleration 做主动排斥，三者结合使用才能实现复杂的调度需求。"
