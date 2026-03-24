# Kubernetes 核心概念：Pod、ReplicaSet、Deployment、StatefulSet、DaemonSet

学习 Kubernetes，你一定被这些概念搞晕过：Pod、ReplicaSet、Deployment、StatefulSet、DaemonSet……它们之间的关系是什么？为什么有这么多概念？

用一个生活化的比喻：

```
想象你在开一家餐厅：

- Pod = 一个厨师（厨师 + 锅 + 灶台 = 完整的做菜单元）
- ReplicaSet = 厨师的数量管理器（保证始终有 N 个厨师）
- Deployment = 餐厅的菜品更新流程（版本管理 + 滚动更新）
- StatefulSet = 有特殊要求的厨师（比如必须用自己的锅）
- DaemonSet = 必须每个分店都有的厨师（比如必须有人收银）
```

## Pod：最小的调度单元

Pod 是 K8s 中最小的调度单元，它封装了一个或多个容器。

### 为什么需要 Pod？

```
┌─────────────────────────────────────────────────────────────┐
│                         Pod                                  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                    共享网络命名空间                      │  │
│  │  ┌─────────────┐  ┌─────────────┐                    │  │
│  │  │   Container │  │   Container │  ← localhost 互通  │  │
│  │  │     A       │  │     B       │  ← 共享端口空间    │  │
│  │  └─────────────┘  └─────────────┘                    │  │
│  │                                                         │  │
│  │                    共享存储卷                            │  │
│  │  ┌─────────────────────────────────────────────┐    │  │
│  │  │                   Volume                     │    │  │
│  │  └─────────────────────────────────────────────┘    │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Pod 的特点

- **共享网络**：同一 Pod 内的容器共享 `localhost`，容器 A 可以用 `localhost:8080` 访问容器 B
- **共享存储**：同一 Pod 内的容器可以挂载同一个 Volume
- **原子调度**：Pod 内的容器总是在同一个节点上调度
- **最小单位**：K8s 不调度容器，只调度 Pod

### Pod 的生命周期

```
Pod Status:
├── Pending      # Pod 已被 Kubernetes 系统接受，但容器镜像尚未创建
├── Running      # Pod 已绑定到节点，所有容器已创建，至少有一个容器在运行
├── Succeeded    # Pod 中所有容器已成功终止，不会重启
├── Failed       # Pod 中所有容器已终止，至少有一个容器以失败终止
└── Unknown      # 无法获取 Pod 状态
```

### Pod 创建示例

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx-pod
  labels:
    app: nginx
    version: v1
spec:
  containers:
    - name: nginx
      image: nginx:1.21-alpine
      ports:
        - containerPort: 80
      resources:
        requests:
          memory: "64Mi"
          cpu: "250m"
        limits:
          memory: "128Mi"
          cpu: "500m"
      livenessProbe:
        httpGet:
          path: /
          port: 80
        initialDelaySeconds: 5
        periodSeconds: 10
```

```bash
# 创建 Pod
kubectl apply -f nginx-pod.yaml

# 查看 Pod 状态
kubectl get pods
kubectl get pods -o wide
kubectl describe pod nginx-pod

# 进入 Pod 调试
kubectl exec -it nginx-pod -- /bin/sh

# 查看 Pod 日志
kubectl logs nginx-pod
kubectl logs nginx-pod -c container-name  # 多容器时

# 删除 Pod
kubectl delete pod nginx-pod
```

### 多容器 Pod

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: web-and-logger
spec:
  containers:
    - name: web
      image: nginx:alpine
      ports:
        - containerPort: 80
    - name: logger
      image: busybox
      args: [/bin/sh, -c, 'while true; do sleep 10; done']
      volumeMounts:
        - name: shared-logs
          mountPath: /var/log/nginx
  volumes:
    - name: shared-logs
      emptyDir: {}
```

## ReplicaSet：保证 Pod 副本数

ReplicaSet 确保指定数量的 Pod 副本始终在运行。

```yaml
apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: nginx-rs
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:alpine
```

```bash
# 查看 ReplicaSet
kubectl get rs

# 输出：
# NAME       DESIRED   CURRENT   READY   AGE
# nginx-rs   3         3         3       10s
```

**注意**：虽然可以直接创建 ReplicaSet，但通常通过 Deployment 来管理。

## Deployment：应用管理

Deployment 是更高层的抽象，管理 ReplicaSet，支持滚动更新和回滚。

### 为什么需要 Deployment？

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Deployment                                   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                      ReplicaSet (v1)                          │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │  │
│  │  │  Pod    │  │  Pod    │  │  Pod    │  │  Pod    │        │  │
│  │  │ nginx   │  │ nginx   │  │ nginx   │  │ nginx   │        │  │
│  │  │  v1.0   │  │  v1.0   │  │  v1.0   │  │  v1.0   │        │  │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘        │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              ↓                                       │
│                              滚动更新                                 │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                      ReplicaSet (v2)                          │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐                       │  │
│  │  │  Pod    │  │  Pod    │  │  Pod    │                       │  │
│  │  │ nginx   │  │ nginx   │  │ nginx   │                       │  │
│  │  │  v2.0   │  │  v2.0   │  │  v2.0   │                       │  │
│  │  └─────────┘  └─────────┘  └─────────┘                       │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Deployment 示例

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
  labels:
    app: nginx
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
        version: v1
    spec:
      containers:
        - name: nginx
          image: nginx:1.21-alpine
          ports:
            - containerPort: 80
          resources:
            requests:
              memory: "64Mi"
              cpu: "100m"
            limits:
              memory: "128Mi"
              cpu: "200m"
```

```bash
# 创建 Deployment
kubectl apply -f nginx-deployment.yaml

# 查看 Deployment
kubectl get deployment
kubectl get deployment -o wide

# 查看 ReplicaSet（Deployment 自动创建）
kubectl get rs

# 查看 Pod
kubectl get pods --show-labels

# 更新镜像
kubectl set image deployment/nginx-deployment nginx=nginx:1.22-alpine

# 查看更新状态
kubectl rollout status deployment/nginx-deployment

# 查看历史版本
kubectl rollout history deployment/nginx-deployment

# 回滚到上一版本
kubectl rollout undo deployment/nginx-deployment

# 回滚到指定版本
kubectl rollout undo deployment/nginx-deployment --to-revision=2
```

### 更新策略

```yaml
spec:
  strategy:
    # 滚动更新（默认）
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1          # 最多超出期望副本数
      maxUnavailable: 0    # 最少可用副本数

    # 替换更新（删除旧的，再创建新的）
    # type: Recreate
```

**滚动更新流程**（replicas=3, maxSurge=1, maxUnavailable=0）：
```
T0: [v1][v1][v1]           三个 v1 版本运行
T1: [v2][v1][v1]           启动一个新 v2
T2: [v2][v2][v1]           第二个 v2 启动
T3: [v2][v2][v2]           第三个 v2 启动，旧 v1 终止
```

## StatefulSet：有状态应用管理

StatefulSet 用于管理有状态应用，每个实例都有稳定的网络标识和持久存储。

### StatefulSet 的特点

- **稳定的网络标识**：Pod 名称固定，顺序确定
- **稳定的持久存储**：每个 Pod 有独立的 PVC
- **有序部署/扩缩容**：按顺序进行
- **有序更新**：按反向顺序更新

### StatefulSet 示例

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
spec:
  serviceName: mysql-headless  # 必须是已存在的 Headless Service
  replicas: 3
  selector:
    matchLabels:
      app: mysql
  template:
    metadata:
      labels:
        app: mysql
    spec:
      containers:
        - name: mysql
          image: mysql:8.0
          ports:
            - containerPort: 3306
          env:
            - name: MYSQL_ROOT_PASSWORD
              value: "password"
          volumeMounts:
            - name: data
              mountPath: /var/lib/mysql
  volumeClaimTemplates:  # 自动创建 PVC
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 10Gi
```

```bash
# StatefulSet 创建的 Pod 有固定命名
kubectl get pods -l app=mysql

# 输出：
# NAME    READY   STATUS    RESTARTS   AGE
# mysql-0 1/1     Running   0          2m
# mysql-1 1/1     Running   0          1m
# mysql-2 1/1     Running   0          30s

# 每个 Pod 有独立的 PVC
kubectl get pvc

# 输出：
# NAME              STATUS   VOLUME
# data-mysql-0      Bound    pv-xxx
# data-mysql-1      Bound    pv-xxx
# data-mysql-2      Bound    pv-xxx
```

### StatefulSet vs Deployment

| 特性 | Deployment | StatefulSet |
|------|------------|-------------|
| 用途 | 无状态应用 | 有状态应用 |
| Pod 标识 | 随机后缀 | 固定序号 |
| 存储 | 共享或无 | 每个 Pod 独立 PVC |
| 扩缩容 | 任意顺序 | 按序号顺序 |
| 更新 | 并行或顺序 | 始终反向顺序 |

## DaemonSet：每个节点一个 Pod

DaemonSet 确保每个节点（或者满足条件的节点）都运行一个 Pod 副本。

### 典型用途

```yaml
# 日志收集器
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluentd
spec:
  selector:
    matchLabels:
      app: fluentd
  template:
    metadata:
      labels:
        app: fluentd
    spec:
      containers:
        - name: fluentd
          image: fluent/fluentd:v1.16
          volumeMounts:
            - name: varlog
              mountPath: /var/log
      volumes:
        - name: varlog
          hostPath:
            path: /var/log
```

### DaemonSet 特点

```bash
# DaemonSet 自动在每个节点创建 Pod
kubectl get daemonset

# 输出：
# NAME      DESIRED   CURRENT   READY   AGE
# fluentd   3         3         3       1h

# 新节点加入集群时，DaemonSet 自动部署
# 节点被删除时，DaemonSet Pod 也会被清理
```

### 常见 DaemonSet 场景

| 应用 | 说明 |
|------|------|
| 日志收集器 | fluentd、Filebeat |
| 监控代理 | node-exporter、Datadog agent |
| 网络插件 | Calico、Flannel CNI |
| 存储插件 | Ceph、GlusterFS |
| 日志聚合 | glog、Prometheus node exporter |

## 资源对比

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         K8s 工作负载资源                                 │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                         Deployment                                │  │
│  │                                                                   │  │
│  │  适用：无状态应用                                                 │  │
│  │  特点：副本数灵活、滚动更新、轻松扩缩容                              │  │
│  │  例子：Web 服务、API 服务、微服务                                   │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                        StatefulSet                               │  │
│  │                                                                   │  │
│  │  适用：有状态应用                                                 │  │
│  │  特点：稳定网络标识、独立持久存储、有序部署/更新                      │  │
│  │  例子：数据库、消息队列、有状态缓存                                  │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                         DaemonSet                                │  │
│  │                                                                   │  │
│  │  适用：节点守护进程                                               │  │
│  │  特点：每个节点一个、节点新增自动部署                                │  │
│  │  例子：日志收集、监控代理、网络插件                                  │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                            Job                                   │  │
│  │                                                                   │  │
│  │  适用：一次性任务                                                 │  │
│  │  特点：任务完成即退出、并行执行                                     │  │
│  │  例子：数据迁移、批处理、一次性计算                                  │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                          CronJob                                 │  │
│  │                                                                   │  │
│  │  适用：定时任务                                                 │  │
│  │  特点：定时执行、Job 管理                                          │  │
│  │  例子：定时备份、定时报表、定时清理                                  │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## 面试追问

1. **Pod 和容器的关系是什么？为什么 Pod 是最小调度单位而不是容器？**
2. **Deployment、ReplicaSet、Pod 三者的关系是什么？**
3. **滚动更新的 maxSurge 和 maxUnavailable 怎么设置合理？**
4. **StatefulSet 的稳定网络标识是怎么实现的？Headless Service 是什么？**
5. **DaemonSet 适合哪些场景？为什么 Kubernetes 网络插件都用 DaemonSet？**

> "理解这些核心概念，关键在于理解它们各自解决什么问题。Deployment 解决无状态应用的部署问题，StatefulSet 解决有状态应用的部署问题，DaemonSet 解决节点级别守护进程的问题。选对资源类型，K8s 才能发挥最大价值。"
