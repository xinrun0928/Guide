# NetworkPolicy：Pod 网络隔离策略

「我能不能让 db Pod 只接受来自 api Pod 的流量，拒绝其他 Pod 的访问？」——在 K8s 的默认网络模型里，所有 Pod 之间都可以自由通信，这在安全上是一个巨大的隐患。

NetworkPolicy 是 K8s 提供的网络隔离机制，它定义了一组 Pod 之间「谁能连谁」的规则，就像 Kubernetes 里的「防火墙」。

## 默认行为：全通

首先理解一个关键点：**K8s 默认的网络策略是「全通」**。如果你不声明任何 NetworkPolicy，所有 Pod 都可以互相访问。

这意味着：
- 攻击者只要拿下任意一个 Pod，就能扫描并连接集群内的所有其他 Pod
- 有漏洞的微服务可能成为内网横向渗透的跳板

NetworkPolicy 的目标是改变这个默认行为，实现「白名单式」的访问控制。

## NetworkPolicy 的基本结构

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-db-policy
  namespace: default
spec:
  podSelector:
    matchLabels:
      app: db          # 目标 Pod：标签为 app=db 的 Pod
  policyTypes:
    - Ingress          # 声明入站策略类型
    - Egress           # 声明出站策略类型
  ingress:             # 入站规则（谁可以连接这个 Pod）
    - from:
        - podSelector:
            matchLabels:
              app: api # 只允许 app=api 的 Pod 连进来
      ports:
        - protocol: TCP
          port: 5432   # PostgreSQL 端口
  egress:              # 出站规则（这个 Pod 可以连到哪里）
    - to:
        - podSelector:
            matchLabels:
              app: cache
      ports:
        - protocol: TCP
          port: 6379
```

## 关键概念：隔离 vs 未隔离

NetworkPolicy 是 **Pod 级别**的隔离机制。当你为一个 Pod 设置了 NetworkPolicy：

- **Ingress 未隔离**（无 policyTypes/Ingress）：该 Pod 接受来自任意来源的入站流量
- **Ingress 隔离**：只有规则中明确允许的流量可以进入

同样逻辑适用于 Egress。

这意味着：**一旦你在某个 Pod 上声明了 Ingress 策略，就必须把所有合法的入站来源都写进去**。漏写任何一条，都会导致该来源无法访问。

## 常见场景

### 场景一：只允许前端访问后端 API

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend-allow-frontend
spec:
  podSelector:
    matchLabels:
      tier: backend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              tier: frontend
      ports:
        - protocol: TCP
          port: 8080
```

### 场景二：DB 只允许来自 App 层，App 只允许来自 API 层

```yaml
# DB 隔离：只接受 App 层流量
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: db-network-policy
spec:
  podSelector:
    matchLabels:
      component: database
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              component: app
      ports:
        - protocol: TCP
          port: 3306
---
# App 层隔离：只接受 API 层和 DB 层出站
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: app-network-policy
spec:
  podSelector:
    matchLabels:
      component: app
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              component: api
      ports:
        - protocol: TCP
          port: 8080
  egress:
    - to:
        - podSelector:
            matchLabels:
              component: database
      ports:
        - protocol: TCP
          port: 3306
```

### 场景三：Namespace 级别的隔离

```yaml
spec:
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: production  # 只允许 production 命名空间的 Pod
          podSelector:
            matchLabels:
              role: frontend    # 且标签为 role=frontend
```

### 场景四：限制对外部网络的出站流量

```yaml
spec:
  podSelector:
    matchLabels:
      app: sensitive-app
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector: {}  # 允许访问集群内所有 Pod
      ports:
        - protocol: TCP
          port: 53
        - protocol: UDP
          port: 53
    - to:
        - ipBlock:
            cidr: 10.0.0.0/8     # 允许访问内部网络段
    # 隐式拒绝其他所有出站流量
```

## NetworkPolicy 和 CNI 插件的关系

这是一个非常容易混淆的点：**NetworkPolicy 是 K8s 提供的 API 对象，但它的实际实现完全依赖于 CNI 插件。**

| CNI 插件 | NetworkPolicy 支持情况 |
|---------|----------------------|
| Calico | 完整支持（L7 应用策略需 Enterprise 版） |
| Cilium | 完整支持，且支持 L7 策略（HTTP） |
| Flannel | 不支持 NetworkPolicy |
| Kube-router | 支持 |
| Weave Net | 支持 |
| Canal (Flannel + Canal) | 支持基础策略 |

如果你需要 NetworkPolicy，必须确保集群使用的是支持它的 CNI 插件。生产环境中，**Calico** 是最常见的选择——它既是最广泛使用的 CNI 插件，又有成熟的 NetworkPolicy 实现。

## Calico 的 NetworkPolicy 扩展

Calico 在 K8s NetworkPolicy 基础上做了扩展，提供了更多能力：

```yaml
apiVersion: projectcalico.org/v3
kind: NetworkPolicy
metadata:
  name: advanced-policy
  namespace: production
spec:
  selector: app == "payment"
  types:
    - Ingress
    - Egress
  ingress:
    - action: Allow
      protocol: TCP
      source:
        selector: app == "api-gateway"
      destination:
        ports:
          - 8080
    - action: Log   # 记录但不拒绝（监控用）
      source: {}
  egress:
    - action: Allow
      protocol: TCP
      destination:
        ports:
          - 53    # DNS
        selector: k8s-app == "kube-dns"
    - action: Deny  # 显式拒绝所有其他出站
      destination: {}
```

## 实践建议

1. **从全通到白名单**：先搞清楚所有合法的流量路径，再写 NetworkPolicy
2. **分层设计**：按 Tier（前端 / API / App / DB）分层，每层只信任上游
3. **命名空间隔离 + Pod 隔离结合**：先用 Namespace 级别策略做粗粒度隔离，再用 Pod 级别策略做细粒度控制
4. **测试验证**：NetworkPolicy 写错了可能导致服务互相访问不了，用 `kubectl get networkpolicy` 和日志排查

## 面试追问方向

- 如果 CNI 插件不支持 NetworkPolicy，流量还能被控制吗？
- `podSelector: {}` 和 `namespaceSelector: {}` 有什么区别？
- Egress 策略中如果不写 DNS 规则会怎样？
- Calico 的 GlobalNetworkPolicy 和 NetworkPolicy 有什么区别？

> NetworkPolicy 是 K8s 网络安全的基石。在一个合规的生产环境中，所有暴露给外部的微服务，都应该配置相应的网络隔离策略。
