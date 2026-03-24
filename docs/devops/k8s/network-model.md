# Kubernetes 网络模型：Pod IP 与 Service IP

「每个 Pod 都有独立 IP」——这是 K8s 网络模型最核心的设计，也是理解整个集群通信的起点。

你有没有想过：Pod 重启后 IP 变了，Service 怎么还能找到它？为什么 K8s 要给每个 Pod 分配一个独立的 IP，而不是像 Docker 默认的 NAT 模式那样？

这一篇，我们来搞清楚 K8s 网络模型的设计哲学。

## K8s 网络模型的核心原则

K8s 对网络模型做了三条强制约束，任何 CNI 插件都必须遵守：

### 原则一：每个 Pod 有独立 IP

集群中的每个 Pod 都拥有一个唯一的 IP 地址，不同 Pod 之间可以直接通信，无需 NAT。

这和 Docker 默认的 `bridge` 网络模式有本质区别。Docker 默认模式下，容器通过 NAT 访问外部网络，容器 IP 是对外部隐藏的。而 K8s 要求 **Pod IP 在整个集群内可见且可路由**。

```bash
# 在 Pod 内查看自己的 IP
kubectl exec -it nginx-pod -- ip addr show eth0
# 输出类似：inet 10.244.1.15/32 scope global eth0
```

### 原则二：节点上的 Pod 可以和任意节点上的 Pod 通信

无论 Pod 运行在哪个节点上，它们都应该能够直接通信，无需经过 NAT 转换。

这意味着整个集群形成一个扁平的三层网络（IP 层），Pod 之间是 peer-to-peer 关系。

### 原则三：Agent 可以和集群内所有 Pod 通信

节点上的 kubelet、system daemons，以及 Control Plane 组件（如 kube-proxy），能够直接和集群内的任意 Pod 通信。

## Pod IP 的生命周期

Pod IP 不是永久的——它是绑定到 Pod 的生命周期上的：

- Pod 被删除 → IP 被回收
- Pod 被调度到新节点 → IP 变化
- Pod 被 HPA 扩容出来 → 新 IP
- Pod 滚动更新 → 新旧 Pod 同时存在，各有各的 IP

这就引出了一个问题：**客户端怎么能不依赖 IP 变化？** 答案是 Service。

## Service IP vs Pod IP

Service 拥有的是一个 **ClusterIP**，这是一个虚拟 IP，不绑定在任何网卡上。它存在于 kube-proxy 维护的 iptables/IPVS 规则中。

```
┌─────────────────────────────────────────────────────┐
│                  Kubernetes Cluster                 │
│                                                     │
│  Service (ClusterIP: 10.96.0.100)                   │
│    └── selector: app=nginx                          │
│                                                     │
│  ┌──────────────────┐   ┌──────────────────┐        │
│  │  Pod (10.244.1.15)│   │  Pod (10.244.2.8) │        │
│  │  nginx replica-1  │   │  nginx replica-2  │        │
│  └──────────────────┘   └──────────────────┘        │
│       Node 1                  Node 2                │
└─────────────────────────────────────────────────────┘
```

Service 的路由规则由 kube-proxy 管理，客户端只需要知道 Service 的 ClusterIP 即可，不用关心后端 Pod 的具体 IP。

## 两种 IP 的对比

| 特性 | Pod IP | Service ClusterIP |
|------|--------|-------------------|
| 本质 | 分配在 Pod 的网卡上 | 虚拟 IP，不绑定网卡 |
| 生命周期 | 跟随 Pod | 跟随 Service |
| 变化频率 | Pod 调度/重启时变化 | 通常不变 |
| 通信方式 | Pod-to-Pod 直接路由 | 走 kube-proxy 规则转发 |
| 负载均衡 | 无 | 有（iptables/IPVS） |
| 可达性 | 集群内任意节点 | 集群内任意 Pod |
| Headless Service | 直接返回 Pod IP 列表 | 无 ClusterIP |

## ClusterIP 的分配机制

ClusterIP 的分配由 kube-apiserver 配合 etcd 管理。默认情况下，Service ClusterIP 从 Service Cluster IP Range（`--service-cluster-ip-range`，默认 `10.96.0.0/12`）中分配。

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-svc
spec:
  selector:
    app: nginx
  ports:
    - port: 80          # Service 暴露的端口
      targetPort: 8080  # 后端 Pod 监听的端口
  clusterIP: 10.96.0.200  # 可选，指定固定 ClusterIP
```

你也可以声明 `clusterIP: None` 创建一个 Headless Service，此时 DNS 直接返回后端 Pod 的 IP 列表，适用于有状态应用的直接发现。

## 网络模型的实现：CNI

K8s 本身不实现网络，它只定义规则，实际的网络通信由 **CNI（Container Network Interface）插件** 实现。常见的 CNI 插件有：

- **Flannel**：简单-overlay，VXLAN 后端
- **Calico**：高性能，支持 NetworkPolicy
- **Cilium**：基于 eBPF，深度可观测性
- **Kube-router**：轻量，集成 IPVS

不同 CNI 插件实现 Pod 网络的方式不同，但它们都遵循 K8s 的三条网络原则。

## 为什么这样设计？

K8s 网络模型的设计背后有一个核心理念：**网络应该是透明的**。

应用开发者不需要关心网络拓扑，不需要关心 Pod 调度到哪里。Service 提供了稳定的接入点，Pod 可以自由调度，网络插件负责把「找到正确的 Pod」这件事做好。

这种设计让 K8s 天然支持：
- **Pod 的任意扩缩容**：新 Pod 自动被 Service 纳入负载均衡
- **Pod 的任意迁移**：只要 Service 在，客户端无感知
- **滚动更新**：新旧 Pod 同时存在，流量自动切换

## 面试追问方向

- Service 的 ClusterIP 是怎么工作的？kube-proxy 用的是什么机制？
- 跨节点的 Pod 通信，数据包是怎么路由的？
- Pod 和 Service 的 DNS 记录分别是什么格式？

> K8s 网络模型的本质是「扁平 + 可路由」。理解了这一点，你就理解了集群内所有通信的底层逻辑。
