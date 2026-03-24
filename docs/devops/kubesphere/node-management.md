# KubeSphere 节点管理：添加、角色设置、污点管理

「节点不够用了怎么办？」——KubeSphere 的节点管理让集群扩容变得简单。

KubeSphere 基于原生 K8s 的节点管理能力，提供了图形化的节点管理界面。同时支持节点角色设置（Master/Worker）和污点（Taint）管理，是生产环境运维的必备工具。

## 节点角色

```
┌─────────────────────────────────────────────────────────────────┐
│                    Kubernetes 节点角色                              │
│                                                                  │
│  Master 节点（Control Plane）                                    │
│  ├── 运行 K8s 控制平面组件                                        │
│  ├── kube-apiserver / etcd / scheduler / controller-manager    │
│  ├── 默认不调度业务 Pod（除非打了特定 Label）                     │
│  └── 推荐 3 台奇数节点（高可用 etcd）                           │
│                                                                  │
│  Worker 节点                                                    │
│  ├── 运行业务 Pod                                                │
│  ├── 可通过 Taint 控制是否调度特定 Pod                          │
│  └── 根据业务需求可随时扩容                                       │
│                                                                  │
│  专用节点                                                        │
│  ├── GPU 节点（运行 AI/ML 工作负载）                           │
│  ├── 存储节点（运行 Ceph/Longhorn 等存储组件）                   │
│  └── 无干扰节点（运行需要隔离的工作负载）                        │
└─────────────────────────────────────────────────────────────────┘
```

## 节点管理

### 添加节点

```bash
# KubeKey 安装时会自动发现并添加节点
# 如果需要手动添加已有节点到集群：

# 方式一：在 KubeSphere 控制台操作
# 集群管理 → 节点 → 添加节点 → 选择节点类型 → 复制安装命令

# 方式二：通过 KubeKey 追加节点
./kk add nodes --cluster-config config.yaml -n new-node-01

# 方式三：手动将节点加入集群
# 在新节点上执行
# kubeadm join <api-server-endpoint> --token <token> --discovery-token-ca-cert-hash <ca-cert-hash>
```

### 节点标签

```bash
# 为节点添加标签（用于 Pod 调度）
kubectl label node node-01 node-role.kubernetes.io/worker=
kubectl label node node-01 disktype=ssd
kubectl label node node-01 gpu=nvidia-t4
kubectl label node node-01 zone=cn-east-1a

# 查看节点标签
kubectl get node node-01 --show-labels

# 删除标签
kubectl label node node-01 disktype-
```

### 节点调度控制

```bash
# 禁止调度新 Pod（但不影响已有 Pod）
kubectl cordon node-01

# 允许调度新 Pod
kubectl uncordon node-01

# 驱逐所有 Pod（优雅驱逐，会尊重 PodDisruptionBudget）
kubectl drain node-01 --ignore-daemonsets --delete-emptydir-data

# 强制驱逐（忽略 PDB）
kubectl drain node-01 --ignore-daemonsets --force

# 查看节点状态
kubectl get nodes
kubectl describe node node-01 | grep -E "Conditions|Allocated"
```

## 污点管理

### 污点（Taint）概述

```
┌─────────────────────────────────────────────────────────────────┐
│                    污点与容忍机制                                   │
│                                                                  │
│  污点（Taint）：节点上的「排斥标记」                               │
│  效果：NoSchedule / PreferNoSchedule / NoExecute                   │
│                                                                  │
│  容忍（Toleration）：Pod 对污点的「接受」                         │
│  含义：如果 Pod 容忍了某个污点，就可以被调度到对应节点            │
│                                                                  │
│  常见场景：                                                      │
│  1. Master 节点不打业务 Pod（自动设置 Taint）                    │
│  2. 专用 GPU 节点只跑 AI 工作负载                               │
│  3. 维护中的节点驱逐所有 Pod                                     │
│  4. Spot 实例不想跑关键业务 Pod                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 添加污点

```bash
# 方式一：kubectl 命令
# 节点不可调度（NoSchedule）
kubectl taint node node-01 dedicated=gpu:NoSchedule

# 节点不可调度，且已有 Pod 会被驱逐（NoExecute）
kubectl taint node node-01 node.kubernetes.io/maintenance: true:NoExecute

# 方式二：通过 KubeSphere 控制台
# 节点详情 → 污点管理 → 添加污点
```

### Pod 容忍污点

```yaml
# Pod spec 中的 tolerations
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gpu-app
  namespace: ai-workloads
spec:
  replicas: 1
  selector:
    matchLabels:
      app: gpu-app
  template:
    metadata:
      labels:
        app: gpu-app
    spec:
      # GPU 节点容忍
      tolerations:
        - key: "dedicated"
          operator: "Exists"
          effect: "NoSchedule"
        - key: "dedicated"
          operator: "Exists"
          effect: "NoExecute"
          tolerationSeconds: 300   # 5 分钟后才驱逐

      # 也可以用精确匹配
      tolerations:
        - key: "dedicated"
          operator: "Equal"
          value: "gpu"
          effect: "NoSchedule"

      containers:
        - name: gpu-app
          image: tensorflow/tensorflow:2.12.0-gpu
          resources:
            limits:
              nvidia.com/gpu: 1
```

### 污点操作场景

```bash
# 场景一：节点维护
# 1. 添加 NoExecute 污点（驱逐已有 Pod）
kubectl taint node node-01 maintenance=true:NoExecute

# 2. 等待 Pod 被驱逐到其他节点
kubectl get pods -w

# 3. 执行维护操作
# kubectl cordon node-01
# apt update && apt upgrade -y

# 4. 维护完成后，移除污点
kubectl taint node node-01 maintenance-

# 5. 允许调度
kubectl uncordon node-01

# 场景二：Spot 实例不想跑关键 Pod
# Spot 实例标记
kubectl label node spot-node-01 instance-type=spot
kubectl taint node spot-node-01 instance-type=spot:NoSchedule

# 只有标记了 Spot 容忍的 Pod 才能调度上去
```

## 资源配额与调度

### 节点资源查看

```bash
# 查看节点资源分配情况
kubectl describe node node-01 | grep -A 10 "Allocated resources"

# 输出示例
# Allocated resources:
#   Resource                    Requests     Limits
#   cpu                         2 (25%)     8 (100%)
#   memory                      4Gi (50%)    8Gi (100%)
#   nvidia.com/gpu              0            0

# 软配额（requests）
kubectl describe node node-01 | grep -A 20 "Capacity"
# Capacity:
# cpu: 8
# memory: 16Gi
# nvidia.com/gpu: 2
# pods: 110
```

### 节点亲和性

```yaml
# Pod 调度到特定节点（节点亲和性）
apiVersion: apps/v1
kind: Deployment
metadata:
  name: latency-sensitive-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: latency-app
  template:
    metadata:
      labels:
        app: latency-app
    spec:
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: "zone"
                    operator: In
                    values:
                      - cn-east-1a
                      - cn-east-1b
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              preference:
                matchExpressions:
                  - key: "disktype"
                    operator: In
                    values:
                      - ssd
      containers:
        - name: latency-app
          image: myapp:v1.0.0
```

## 节点池管理

```yaml
# KubeSphere 支持节点池概念（基于 K8s NodePool）
# 创建节点池
apiVersion: cluster.kubesphere.io/v1alpha1
kind: NodePool
metadata:
  name: pool-gpu
  namespace: default
spec:
  clusterName: default
  template:
    metadata:
      labels:
        node.pool: gpu
    spec:
      taints:
        - key: dedicated
          value: gpu
          effect: NoSchedule
  # 节点池配置
  type: Linux
  # 自动扩缩容配置（配合 Cluster Autoscaler）
  autoscaling:
    enabled: true
    min: 1
    max: 5
```

## 常见问题

```
问题一：节点 Ready 但 NotReady
原因：Kubelet 状态上报异常 / 网络插件问题
解决：
  kubectl describe node <node-name> | grep Conditions
  systemctl status kubelet
  journalctl -u kubelet -f

问题二：Pod 卡在 Pending
原因：资源不足 / 调度失败 / 污点不匹配
解决：
  kubectl describe pod <pod-name>
  kubectl describe node <node-name> | grep taints
  检查 CPU/内存 requests 是否合理

问题三：驱逐失败（Evicted）
原因：PodDisruptionBudget 限制 / 资源不足
解决：
  kubectl get pdb -A
  kubectl describe pdb <pdb-name>
```

## 面试追问方向

1. **为什么 etcd 推荐用奇数个节点？**
   答：etcd 使用 Raft 共识协议，需要多数节点（n/2+1）才能正常工作。3 节点集群容忍 1 节点故障，5 节点集群容忍 2 节点故障。用 4 节点只能容忍 1 节点故障（和 3 节点一样），但多了一台机器的成本，所以选奇数不用偶数。

2. **污点（NoSchedule）和污点（NoExecute）有什么区别？**
   答：`NoSchedule` 只影响新 Pod 的调度，已有 Pod 不受影响。`NoExecute` 更严格，不仅阻止新 Pod 调度，还会驱逐已有 Pod（除非 Pod 配置了 `tolerationSeconds`）。日常运维用 `NoSchedule`，紧急维护用 `NoExecute`。

3. **如何实现节点的优雅下线？**
   答：步骤：1) `kubectl cordon` 标记不可调度；2) `kubectl drain` 驱逐 Pod（尊重 PDB）；3) 执行维护操作；4) `kubectl uncordon` 恢复调度。关键点：drain 时要加 `--ignore-daemonsets`（忽略 DaemonSet Pod）和 `--delete-emptydir-data`（清理 EmptyDir 数据）。

> "节点管理是 K8s 运维的基本功。理解污点和容忍的机制，就理解了 Pod 调度的最后一环。好的节点管理，不是把 Pod 赶走，而是让 Pod 优雅地『搬家』。"
