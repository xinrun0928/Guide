# Kubernetes 架构：Control Plane 与 Worker Node

你知道为什么 Kubernetes 能够自动把 Pod 调度到合适的节点吗？为什么一个节点挂了，Pod 能自动迁移到其他节点？

答案在于 Kubernetes 的架构设计。理解 K8s 的架构，是掌握它的第一步。

## 整体架构

Kubernetes 遵循「控制平面 + 工作节点」的设计模式：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Kubernetes 集群                                 │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      Control Plane（控制平面）                      │  │
│  │                                                                  │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐│  │
│  │  │    kube-   │  │   kube-     │  │  kube-      │  │   etcd  ││  │
│  │  │  apiserver  │←→│ scheduler  │  │ controller  │  │         ││  │
│  │  │   (API)     │  │  (调度)     │  │  (控制)     │  │  (存储) ││  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────┘│  │
│  │                                                                  │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │                    cloud-controller-manager                  │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              ↑                                          │
│                     状态同步 / 指令下发                                   │
│                              ↓                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                       Worker Node 1                               │  │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌─────────────┐  │  │
│  │  │  kubelet  │  │  kube-   │  │ container │  │    Pod     │  │  │
│  │  │           │  │  proxy    │  │ runtime   │  │            │  │  │
│  │  │ (节点代理) │  │ (网络代理) │  │ (Docker)  │  │            │  │  │
│  │  └───────────┘  └───────────┘  └───────────┘  └─────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                       Worker Node 2                               │  │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌─────────────┐  │  │
│  │  │  kubelet  │  │  kube-   │  │ container │  │    Pod     │  │  │
│  │  │           │  │  proxy    │  │ runtime   │  │            │  │  │
│  │  └───────────┘  └───────────┘  └───────────┘  └─────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Control Plane 组件

Control Plane 是 Kubernetes 的大脑，负责整个集群的管理和控制。

### kube-apiserver

API Server 是 K8s 的前端，所有操作都通过它进行：

```bash
# API Server 暴露的 API
https://master:6443/api/v1
https://master:6443/apis/apps/v1
https://master:6443/apis/networking.k8s.io/v1
https://master:6443/healthz

# 通过 kubectl 访问 API Server
kubectl get pods
# 等价于
curl -k https://master:6443/api/v1/namespaces/default/pods
```

**核心职责**：
- 处理所有 RESTful API 请求
- 验证请求合法性
- 数据持久化到 etcd
- 是唯一与 etcd 通信的组件

**高可用配置**：
```
┌─────────────────────────────────────────┐
│            负载均衡器                      │
└────────────────┬────────────────────────┘
                 │
    ┌────────────┼────────────┐
    ↓            ↓            ↓
┌────────┐  ┌────────┐  ┌────────┐
│API Srv │  │API Srv │  │API Srv │
│ Node 1 │  │ Node 2 │  │ Node 3 │
└────────┘  └────────┘  └────────┘
```

### etcd

etcd 是 K8s 的持久化存储，保存集群所有状态：

```bash
# etcd 默认端口
# 2379: 客户端通信
# 2380: 节点间通信

# 查看 etcd 状态
kubectl exec -n kube-system etcd-<node-name> -- etcdctl endpoint health

# 备份 etcd
ETCDCTL_API=3 etcdctl snapshot save snapshot.db \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key
```

**重要特性**：
- 使用 Raft 共识协议保证一致性
- 所有集群数据存储于此
- 定期备份是运维的核心工作

### kube-scheduler

Scheduler 负责 Pod 的调度，选择最合适的节点运行 Pod：

```bash
# Pod 调度决策过程
1. 预选（Filtering）：过滤不符合条件的节点
2. 优选（Scoring）：对符合条件的节点打分
3. 选择（Selection）：选择得分最高的节点

# 影响调度的因素
- 资源请求量（CPU/内存）
- 亲和性/反亲和性规则
- 污点和容忍
- 拓扑位置（拓扑域约束）
- taints（污点）

# 查看 Pod 调度决策
kubectl describe pod <pod-name> | grep -A 5 "Events"

# 强制调度到指定节点
kubectl get node <node-name>
kubectl label node <node-name> disktype=ssd
```

### kube-controller-manager

Controller Manager 运行所有控制器进程：

```
┌─────────────────────────────────────────────────────────────┐
│                kube-controller-manager                        │
│                                                             │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐ │
│  │    Node      │  │   Replica     │  │   Endpoint    │ │
│  │  Controller  │  │  Controller   │  │  Controller   │ │
│  │  (节点控制)  │  │ (副本控制)   │  │ (端点控制)   │ │
│  └───────────────┘  └───────────────┘  └───────────────┘ │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐ │
│  │    Job       │  │   Service     │  │    PV        │ │
│  │  Controller  │  │  Controller   │  │  Controller   │ │
│  │  (任务控制)  │  │ (服务控制)   │  │ (存储控制)   │ │
│  └───────────────┘  └───────────────┘  └───────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**控制器类型**：
- **Node Controller**：监控节点状态，标记不可用节点
- **Replication Controller**：确保 Pod 副本数符合预期
- **Deployment Controller**：管理 Deployment 的部署和更新
- **StatefulSet Controller**：管理有状态应用
- **DaemonSet Controller**：确保每个节点运行一个 Pod
- **Endpoint Controller**：维护 Service 和 Pod 的对应关系
- **Service Account Controller**：管理 ServiceAccount

### cloud-controller-manager

云厂商特定控制器，处理云平台集成：

```
┌─────────────────────────────────────────────────────────────┐
│              cloud-controller-manager                         │
│                                                             │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐ │
│  │     Node     │  │    Route      │  │   Service    │ │
│  │  Controller  │  │  Controller   │  │  Controller   │ │
│  │  (节点控制)  │  │  (路由控制)  │  │  (服务控制)  │ │
│  └───────────────┘  └───────────────┘  └───────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Worker Node 组件

Worker Node 是实际运行 Pod 的地方。

### kubelet

kubelet 是节点上的 agent，负责管理 Pod 的生命周期：

```bash
# kubelet 的核心职责
1. 向 API Server 注册节点
2. 监听 Pod 分配指令
3. 启动/停止容器
4. 监控容器状态
5. 上报节点状态

# kubelet 不做的事情
- 不直接创建容器（委托给 container runtime）
- 不管理非 K8s 创建的容器

# 查看 kubelet 状态
systemctl status kubelet
journalctl -u kubelet -f
```

### kube-proxy

kube-proxy 是节点上的网络代理，负责 Service 的负载均衡：

```bash
# kube-proxy 的工作模式

# 1. userspace 模式（早期，已废弃）
# kube-proxy 作为代理，处理所有 Service 流量

# 2. iptables 模式（默认）
# 通过 iptables 规则实现负载均衡
iptables -t nat -L KUBE-SERVICES

# 3. IPVS 模式（高性能）
# 使用 IPVS 实现负载均衡
ipvsadm -L -n
```

```bash
# 查看 kube-proxy 模式
kubectl get configmap -n kube-system kube-proxy -o yaml

# 切换模式（需要重启 kube-proxy）
kubectl edit configmap kube-proxy -n kube-system
# 修改 mode: "ipvs"
```

### Container Runtime

容器运行时执行容器操作：

```bash
# 支持的容器运行时
├── containerd       # K8s 默认推荐
├── CRI-O           # 轻量级，专为 K8s 设计
├── Docker          # 通过 dockershim（已废弃）
└── 其他 CRI 实现

# 查看节点容器运行时
kubectl get node <node-name> -o wide
```

## 数据流

```
用户请求流程：

1. kubectl 发送请求
       ↓
2. kube-apiserver 认证/授权/准入
       ↓
3. 数据写入 etcd
       ↓
4. kube-controller-manager 响应变化
       ↓
5. kubelet 收到通知
       ↓
6. kubelet 调用 container runtime
       ↓
7. 容器启动完成，状态上报 apiserver
       ↓
8. etcd 更新状态
```

## 高可用架构

生产环境推荐高可用部署：

```
┌─────────────────────────────────────────────────────────────────────┐
│                         负载均衡器                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ↓                        ↓                        ↓
┌───────────────┐       ┌───────────────┐       ┌───────────────┐
│ Control Plane │       │ Control Plane │       │ Control Plane │
│    Node 1      │       │    Node 2      │       │    Node 3      │
│               │       │               │       │               │
│ ┌───────────┐ │       │ ┌───────────┐ │       │ ┌───────────┐ │
│ │apiserver  │ │       │ │apiserver  │ │       │ │apiserver  │ │
│ └───────────┘ │       │ └───────────┘ │       │ └───────────┘ │
│ ┌───────────┐ │       │ ┌───────────┐ │       │ ┌───────────┐ │
│ │scheduler  │ │       │ │scheduler  │ │       │ │scheduler  │ │
│ └───────────┘ │       │ └───────────┘ │       │ └───────────┘ │
│ ┌───────────┐ │       │ ┌───────────┐ │       │ ┌───────────┐ │
│ │controller │ │       │ │controller │ │       │ │controller │ │
│ └───────────┘ │       │ └───────────┘ │       │ └───────────┘ │
│      ↓        │       │      ↓        │       │      ↓        │
│ ┌───────────┐ │       │ ┌───────────┐ │       │ ┌───────────┐ │
│ │   etcd    │←───────→│ │   etcd    │←───────→│ │   etcd    │ │
│ │  (成员1)  │         │ │  (成员2)  │         │ │  (成员3)  │ │
│ └───────────┘ │       │ └───────────┘ │       │ └───────────┘ │
└───────────────┘       └───────────────┘       └───────────────┘
                                 ↑
                                 ↓
┌─────────────────────────────────────────────────────────────────────┐
│                         Worker Nodes                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐│
│  │   Node 1    │  │   Node 2    │  │   Node 3    │  │   Node 4    ││
│  │  kubelet    │  │  kubelet    │  │  kubelet    │  │  kubelet    ││
│  │ kube-proxy  │  │ kube-proxy  │  │ kube-proxy  │  │ kube-proxy  ││
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

## 集群搭建方式对比

| 方式 | 难度 | 适用场景 | 代表工具 |
|------|------|----------|----------|
| kubeadm | 中 | 生产环境推荐 | kubeadm |
| 二进制 | 高 | 需要完全自定义 | 手动部署 |
| kops | 低 | AWS/GCE | kops |
| k3s | 低 | 边缘/轻量级 | k3s |
| Rancher | 低 | 企业管理 | Rancher |
| 托管服务 | 极低 | 不在乎成本 | GKE/EKS/ACK |

## 面试追问

1. **kube-apiserver 的认证机制有哪些？**
2. **etcd 的 Raft 协议是怎么工作的？为什么生产环境需要奇数个 etcd 节点？**
3. **kube-scheduler 的调度流程是什么？有哪些调度策略？**
4. **kubelet 和 container runtime 之间的关系是什么？什么是 CRI？**
5. **kube-proxy 的 iptables 和 IPVS 模式有什么区别？**

> "理解 Kubernetes 架构，不是为了背诵面试题，而是为了在遇到问题时知道从哪个组件入手。Control Plane 出问题，整个集群受影响；Worker Node 出问题，只影响部分 Pod。"
