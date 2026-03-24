# CNI 网络插件：Flannel、Calico、Cilium 对比

「选什么 CNI 插件？」——这是部署 K8s 集群时第一个要做的技术决策，也是最容易选错的。

Flannel、Calico、Cilium 是目前最主流的三个选择。它们解决的问题相同（Pod 网络），但实现方式、能力和适用场景完全不同。这一篇不做非此即彼的站队，而是把每个插件的设计哲学和实际差异讲清楚。

## 核心差异概览

| 特性 | Flannel | Calico | Cilium |
|------|---------|--------|--------|
| 网络模式 | Overlay（VXLAN） | 路由 / Overlay | eBPF |
| 网络策略 | 不支持 | 完整支持 | L7 + L3/L4 |
| 性能 | 中等（封装开销） | 高（无封装） | 最高（eBPF kernel 旁路） |
| 适用规模 | 小规模集群 | 中大规模 | 中大规模 |
| 运维复杂度 | 低 | 中 | 中 |
| BGP 支持 | 不支持 | 支持 | 支持 |
| 观测性 | 基础 | 丰富（Flow Export） | 极致（Hubble 可视化） |
| 加密 | 不支持 | WireGuard | WireGuard / IPSec |

## Flannel：简单即美

### 工作原理

Flannel 使用 Overlay 网络，在现有三层网络之上再封装一层虚拟网络。最常用的后端是 **VXLAN**（Virtual Extensible LAN）：

```
Pod A (10.244.1.10)                  Pod B (10.244.2.20)
      │                                    ▲
      │ Original Packet:                    │
      │   Src: 10.244.1.10                 │
      │   Dst: 10.244.2.20                │
      ▼                                    │
Flannel Driver (VXLAN Encapsulation)       │
      │ Encapsulated Packet:               │
      │   Outer Src: Node1 IP              │
      │   Outer Dst: Node2 IP              │
      │   Inner Src: 10.244.1.10          │
      │   Inner Dst: 10.244.2.20          │
      ▼                                    │
  物理网络转发 ──────────────────────────────┘
```

Flannel 在每个节点上维护一个子网分配表（由 etcd 管理），数据包通过 UDP/VXLAN 封装后跨节点转发。

### 优点

- **开箱即用**：安装简单，配置少
- **兼容性最好**：只要能通三层网络就能跑，不依赖特定网络环境
- **资源占用低**：纯 Go 实现，部署轻量

### 缺点

- **性能损失**：VXLAN 封装/解封装有 CPU 开销，跨节点通信额外延迟约 10-20%
- **无网络策略**：Flannel 本身不实现 NetworkPolicy
- **广播支持弱**：VXLAN 广播效率低，多播应用支持差

### 适用场景

- 开发/测试环境
- 小规模集群（< 50 节点）
- 网络环境复杂的私有化部署（不支持 BGP）
- 对性能不敏感的业务

## Calico：高性能路由 + 网络安全

### 工作原理

Calico 有两种运行模式：

**路由模式（默认）**：每个 Pod 的 IP 直接在物理网络上路由，无需封装。Calico 通过 BGP 协议将路由信息分发给节点或顶层路由器。

```
Pod A (10.244.1.10)               Pod B (10.244.2.20)
      │                                 ▲
      │  Packet:                        │
      │  Src: 10.244.1.10              │
      │  Dst: 10.244.2.20             │
      ▼                                 │
  Calico Felix (iptables rules)        │
      │ 路由到 Node2 via BGP learned route
      ▼                                 │
物理网络直传（无封装） ───────────────────────┘
```

**Overlay 模式（IPIP）**：当节点间无法直接路由时（如跨公网），Calico 自动降级到 IPIP 封装模式。

### Felix：iptables 规则的守护者

Felix 是 Calico 运行在每个节点上的 agent，负责：
- 在节点上配置 iptables 规则（实现 NetworkPolicy）
- 管理路由表（确保 Pod IP 可达）
- 报告节点状态给 etcd 或 BGP 路由反射器

### 优点

- **性能最优**：纯路由转发，无封装开销
- **NetworkPolicy 完整**：K8s NetworkPolicy 全部支持，还有 Calico 扩展策略
- **BGP 能力**：可和物理网络路由器集成，适合大规模集群
- **加密**：支持 WireGuard 透明加密

### 缺点

- **BGP 依赖**：在无法使用 BGP 的环境（如公有云 VPC）中受限
- **运维复杂度**：比 Flannel 高，需要理解 BGP 概念
- **策略数量影响性能**：大量 NetworkPolicy 时 iptables 规则激增（Felix 提供 IPset 优化）

### 适用场景

- 生产环境（特别是中大规模）
- 需要网络隔离（NetworkPolicy）
- 有 BGP 能力的网络环境
- 需要和物理网络集成的混合云

## Cilium：eBPF 原生网络

### eBPF 是什么？

eBPF（extended Berkeley Packet Filter）是 Linux 内核的一个革命性特性——它允许你在内核中运行沙盒程序，在数据包到达内核协议栈之前就进行处理。

传统 CNI 的数据路径：网卡 → 内核协议栈 → iptables → 应用
Cilium 的数据路径：网卡 → eBPF Hook → 应用

eBPF 的优势：绕过 iptables，在内核层面直接处理网络包，性能和灵活性大幅提升。

### Cilium 的能力

```bash
# Cilium 支持 L7 网络策略（HTTP 方法/路径过滤）
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: http-policy
spec:
  endpointSelector:
    matchLabels:
      app: backend
  ingress:
    - fromEndpoints:
        - matchLabels:
            app: frontend
      toPorts:
        - ports:
            - port: "8080"
              protocol: TCP
          rules:
            http:
              - method: GET
                path: "/api/v1.*"
              - method: POST
                path: "/admin.*"
```

```bash
# Cilium 的 Hubble 提供 Kubernetes 原生的可观测性
hubble observe --to-fqdn api.example.com
hubble observe --protocol HTTP --related-to identity:42
```

### 优点

- **性能最高**：eBPF 直接在内核处理，比 iptables 快 10 倍以上
- **L7 网络策略**：支持 HTTP 方法/路径过滤（其他 CNI 不支持）
- **极致可观测性**：Hubble 集成，提供服务依赖图和流量可视化
- **透明加密**：WireGuard 或 IPSec，无需修改应用
- **无 iptables 限制**：避免了 iptables 大规模规则的性能悬崖

### 缺点

- **内核要求**：需要 Linux 4.9+（eBPF 功能逐步增强，更高版本支持更多特性）
- **运维门槛**：eBPF 调试比 iptables 复杂
- **生态稍年轻**：比 Calico 社区小，但增长很快

### 适用场景

- 对性能敏感的大规模集群
- 需要 L7 网络可见性和控制（微服务 API 治理）
- 运行在支持 eBPF 的新内核上
- 高度安全的网络环境

## 选型决策树

```
你的集群规模？
    │
    ├── < 50 节点 / 开发测试 ──► Flannel（简单够用）
    │
    └── > 50 节点 / 生产环境 ──► 需要 NetworkPolicy？
                                  │
                                  ├── 否 ──► 考虑 Flannel（但 Calico 更好）
                                  │
                                  └── 是 ──► 需要 L7 策略 / 极致性能？
                                              │
                                              ├── 是 ──► Cilium
                                              │
                                              └── 否 ──► Calico（路由模式）
```

## 补充：Calico + Flannel 混合方案

有些发行版（如 Canal）使用 Flannel 提供网络、Calico 提供 NetworkPolicy。这种方案兼具 Flannel 的简单和 Calico 的安全能力，但引入了两个组件的维护负担。

## 面试追问方向

- VXLAN 和 IPIP 的封装方式有什么区别？各自的开销在哪里？
- Flannel 为什么不做网络策略？这个决策的代价是什么？
- Calico 的 Felix 和 kube-proxy 是什么关系？它们会冲突吗？
- eBPF 相比 iptables 的核心优势是什么？有什么局限性？
- Cilium 的 Hubble 和传统 K8s 网络观测工具的区别是什么？

> CNI 插件的选择不是非此即彼，而是一个权衡——Flannel 的简单、Calico 的均衡、Cilium 的极致，分别对应不同的业务需求和技术成熟度。
