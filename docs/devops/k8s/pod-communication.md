# Pod 网络通信：同一 Node 内与跨 Node 通信

「两个 Pod 之间是怎么通信的？」——表面上这是一个简单问题，但背后涉及网络命名空间、veth-pair、网桥、路由表、封包解包等多个层面的知识。

这一篇，我们从数据包在 K8s 集群中的完整旅程出发，拆解 Pod 网络通信的每一个环节。

## 同一 Node 内 Pod 通信

### 关键概念：veth-pair

每个 Pod 都有自己独立的网络命名空间（network namespace）。Pod 和宿主机之间通过 **veth-pair**（Virtual Ethernet Pair）连接——就像一根虚拟网线，一端在 Pod 里，一端在宿主机上。

```
┌──────────────────────────────────────────────┐
│                  Node 1                      │
│                                              │
│  ┌─────────────────┐     ┌──────────────┐  │
│  │   Pod A          │     │  Pod B        │  │
│  │  eth0            │     │  eth0         │  │
│  │  10.244.1.15     │     │  10.244.1.16  │  │
│  └───────┬─────────┘     └──────┬───────┘  │
│          │ veth-pair-A           │ veth-pair-B
│          │                       │          │
│          ▼                       ▼          │
│      docker0 / cni0 (bridge)               │
│      10.244.1.1                               │
│          │                                    │
│          │  ARP: who has 10.244.1.16?        │
│          ◄───────────────────────────────────►
│                                              │
└──────────────────────────────────────────────┘
```

### 通信流程

1. Pod A 想发包给 Pod B（目标 IP：10.244.1.16）
2. Pod A 查看本地路由，发现目标在同一网段，通过 eth0 发出
3. 数据包通过 veth-pair 到达宿主机 bridge（cni0）
4. Bridge 上有 ARP 表，知道 10.244.1.16 对应 veth-pair-B
5. 数据包通过 veth-pair-B 到达 Pod B

整个过程在二层（数据链路层）完成，通过 ARP 解析 MAC 地址，Bridge 负责转发，无需出节点。

## 跨 Node Pod 通信

### 场景描述

Pod A 在 Node 1（10.244.1.15），Pod B 在 Node 2（10.244.2.20）。跨节点通信是更复杂的情况，实现方式取决于 CNI 插件。

### 方式一：Flannel（VXLAN Overlay）

```
Node 1 (IP: 192.168.1.10)              Node 2 (IP: 192.168.1.20)
┌───────────────────────┐            ┌───────────────────────┐
│ Pod A: 10.244.1.15   │            │ Pod B: 10.244.2.20   │
│         │            │            │         │            │
│         ▼            │            │         ▼            │
│     veth-A           │            │     veth-B           │
│         │            │            │         │            │
│    cni0 bridge        │◄── VXLAN ──►   cni0 bridge        │
│         │            │   tunnel   │         │            │
└─────────┼────────────┘            └─────────┼────────────┘
          │                                  │
          └──────────► 物理网络 ◄───────────┘
```

**封装过程（Node 1 发送）**：
1. Pod A 发送原始数据包：`Src=10.244.1.15, Dst=10.244.2.20`
2. cni0 发现目标不在本地子网，交给 Flannel 处理
3. Flannel 查询 etcd，找到目标 Pod 所在节点的公网 IP（192.168.1.20）
4. 在原包外再封一层头：`Outer Src=192.168.1.10, Outer Dst=192.168.1.20`
5. 通过物理网络发送到 Node 2

**解封装过程（Node 2 接收）**：
1. Node 2 收到 VXLAN 封包，kernel 识别为 VXLAN 流量
2. 去掉外层头，还原原始数据包
3. 根据目标 IP（10.244.2.20）通过 ARP 找到对应 veth-pair
4. 数据包通过 veth-pair 到达 Pod B

### 方式二：Calico（路由模式）

Calico 不用封包，直接在物理网络上路由。关键依赖是 **BGP（Border Gateway Protocol）**：

```bash
# Node 1 上的路由表示例
# 目的网络              网关              接口
10.244.2.0/24      via 192.168.1.20    eth0
```

1. Pod A 发包：`Src=10.244.1.15, Dst=10.244.2.20`
2. cni0 发现目标不在本地子网，查路由表
3. 路由表显示下一跳是 `192.168.1.20`（Node 2 的物理 IP）
4. 直接发包到物理网络（无封装），路由到 Node 2
5. Node 2 根据路由表将包送到对应 Pod

Calico 的 BGP 路由反射器（Route Reflector）负责在节点之间传播路由信息，避免每对节点之间都建立 BGP 对等关系。

### 方式三：Cilium（eBPF）

CILIUM 跳过了 cni0 bridge，直接在 eBPF 层处理：

```
Pod A eth0
    │
    ▼
eBPF Hook (Cilium Endpoint)
    │
    ├──► 本地 Pod（同节点）：直接通过 veth 转发
    │
    └──► 远程 Pod（跨节点）：查 LXC 映射表，找对端 Node IP，通过 eth0 直接发送
                                      （VXLAN 在 eBPF 层封装，比内核更快）
```

Cilium 的关键优化：
- 绕过 cni0 bridge，避免 bridge 的 ARP 广播开销
- 通过 LXC 映射表直接找到对端节点 IP
- eBPF 在内核执行，效率远高于 iptables 规则匹配

## Service 通信的特殊性

Pod 直接通信用 Pod IP，但 Pod IP 是不稳定的——每次 Pod 重启、调度、扩缩容都可能改变。Service 提供了稳定的接入点，但它的通信路径更复杂：

```
Pod A → ClusterIP → kube-proxy（iptables/IPVS）→ DNAT → 后端 Pod B
```

这个过程中，kube-proxy 将「访问 Service IP」的数据包修改为「访问后端 Pod IP」，然后正常走 Pod 网络的路由路径。

## 关键知识点总结

| 通信类型 | 路径 | 关键技术 |
|---------|------|---------|
| 同节点 Pod 通信 | Pod A → veth → Bridge → veth → Pod B | 二层转发，ARP |
| 跨节点通信（Flannel） | 原始包 + VXLAN 封装 → 物理网络 → 解封装 → Pod | Overlay 封装 |
| 跨节点通信（Calico） | Pod IP 直接在物理网上路由 | BGP 路由分发 |
| 跨节点通信（Cilium） | eBPF 直接处理，减少内核路径 | eBPF + LXC 映射 |
| Service 通信 | Pod → ClusterIP → DNAT → Pod | iptables/IPVS |

## 常见面试问题

### 为什么 Pod 和 Pod 之间可以直接通过 IP 通信，不需要 NAT？

这是 K8s 网络模型的三条核心约束之一。不同于传统 Docker 的 NAT 模式，K8s 要求 Pod IP 在整个集群内可路由。这是为了简化网络模型，让服务发现和负载均衡更容易实现。

### veth-pair 为什么叫「pair」？

因为它是一对虚拟网卡，一端在 Pod 命名空间，一端在宿主机命名空间。数据从一端进，必然从另一端出。这种设计天然打通了容器和宿主机之间的网络通道。

### 跨节点通信中，「抓包」能看到原始 Pod IP 还是封包后的 IP？

取决于抓包的位置：
- 在 Pod 内抓包：只能看到原始包（Pod IP）
- 在 Node 上用 tcpdump 抓物理网卡：Flannel 模式下看到的是 VXLAN 封包（Outer IP），Calico 模式下看到的是原始 Pod IP

## 面试追问方向

- Flannel VXLAN 的封包/解包在哪个层面发生？对性能有什么影响？
- Calico 的 BGP Route Reflector 是怎么工作的？为什么需要它？
- Cilium 为什么比传统 CNI 快？eBPF 在其中扮演了什么角色？
- Pod 网络命名空间和宿主机之间还有哪些隔离点（UTS、PID、Mount）？

> Pod 网络通信的底层原理，是理解整个 K8s 网络体系的基础。无论是故障排查还是性能优化，都需要深入到这一层才能找到根本答案。
