# NetworkPolicy 网络隔离策略

「Pod 之间的流量，应该怎么管控？」——NetworkPolicy 是 K8s 的网络层防火墙。

在 K8s 默认的「全通」网络模型下，一旦某个 Pod 被攻陷，攻击者可以在集群内横向移动到任意其他 Pod。NetworkPolicy 提供了声明式的网络隔离能力，让每个命名空间和每个应用都可以定义自己的「谁可以连我」规则。

## 默认网络策略

K8s 的默认网络策略是**无限制**。没有 NetworkPolicy 资源时，所有 Pod 可以互相访问，所有 Pod 都可以访问外部网络。

这意味着：
- Pod A 攻陷 → 理论上可以探测集群内所有其他 Pod
- Pod B 被攻击者利用 → 可以连接集群外的任意目标
- 没有入站/出站控制，流量审计无从做起

NetworkPolicy 让你改变这个默认行为。

## NetworkPolicy 资源结构

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: frontend-policy
  namespace: production
spec:
  # 目标 Pod 选择器
  podSelector:
    matchLabels:
      app: frontend
  # 策略类型
  policyTypes:
    - Ingress    # 入站流量控制
    - Egress     # 出站流量控制
  # 入站规则
  ingress:
    - from:
        # 允许来自这些 Pod 的入站
        - podSelector:
            matchLabels:
              role: api-gateway
        # 或允许来自这些 Namespace 的入站
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
        # 或允许来自特定 IP 段的入站
        - ipBlock:
            cidr: 10.0.0.0/8
            except:
              - 10.0.0.0/24   # 但排除这个子网
      ports:
        - protocol: TCP
          port: 8080
  # 出站规则
  egress:
    - to:
        - podSelector:
            matchLabels:
              role: backend
      ports:
        - protocol: TCP
          port: 8080
    - to:
        - namespaceSelector: {}  # 允许访问集群内所有命名空间
      ports:
        - protocol: TCP
          port: 53
        - protocol: UDP
          port: 53
```

## 关键行为：隔离 vs 未隔离

**这是理解 NetworkPolicy 最核心的点。**

当你为一个 Pod 设置了 NetworkPolicy（声明了 policyTypes）：

- **Ingress 隔离**：该 Pod **只接受** NetworkPolicy 规则中明确允许的入站流量
- **Egress 隔离**：该 Pod **只发送** NetworkPolicy 规则中明确允许的出站流量

如果只声明了 `Ingress` 而未声明 `Egress`，则入站被隔离，出站不受限制（仍然全通）。

**这带来了一个实践中的常见坑**：一旦为某个 Pod 设置了 NetworkPolicy，就必须把该 Pod 所有合法的入站来源都写进去。漏写任何一个，都会导致该来源无法访问。

## 常见场景

### 场景一：Tiered Architecture（三层架构隔离）

```yaml
# 保护 DB 层：只接受 App 层的流量
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: database-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      tier: database
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              tier: app
      ports:
        - protocol: TCP
          port: 3306

---
# 保护 App 层：只接受 API 层的流量
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: app-policy
  namespace: production
spec:
  podSelector:
    matchLabels:
      tier: app
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              tier: api
      ports:
        - protocol: TCP
          port: 8080
```

### 场景二：命名空间级别的隔离

```yaml
# 限制 production 命名空间只能被特定命名空间访问
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: production-isolate
  namespace: production
spec:
  podSelector: {}    # 空选择器 = 选择该命名空间内所有 Pod
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              environment: trusted
```

### 场景三：限制出站到外部网络

```yaml
# 只允许访问内部网络和 DNS
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: restrict-egress
spec:
  podSelector:
    matchLabels:
      app: payment-service
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector: {}  # 所有集群内部
      ports:
        - protocol: TCP
          port: 53    # DNS
        - protocol: UDP
          port: 53
    - to:
        - ipBlock:
            cidr: 172.16.0.0/12   # VPC 内网
      ports:
        - protocol: TCP
          port: 5432
    # 隐式拒绝所有其他出站流量
```

### 场景四：Denylist（拒绝特定流量）

K8s NetworkPolicy 不直接支持「拒绝列表」模式，只能通过「白名单」模式实现。先隔离，再放行。

## 与 CNI 插件的关系

**重要**：NetworkPolicy 是一个 K8s API 对象，但它的实际执行完全依赖于 CNI 插件。

| CNI 插件 | NetworkPolicy 支持 | 备注 |
|---------|-----------------|------|
| Calico | 完整支持 | 生产首选 |
| Cilium | 完整 + L7 策略 | 支持 HTTP 层过滤 |
| Kube-router | 基础支持 | 适合轻量场景 |
| Flannel | **不支持** | 只做网络，不做策略 |
| Weave Net | 基础支持 | 功能相对简单 |

如果你需要 NetworkPolicy，确保集群 CNI 插件支持它。

## 最佳实践

### 分层隔离

```
Ingress Controller (Namespace: ingress)
        │
        ▼
API Gateway (Namespace: api-gateway)
        │
        ├──► Frontend (Namespace: production)
        │
        ├──► Backend (Namespace: production)
        │
        └──► Database (Namespace: database)
                  │
                  └──► 只允许 App 层访问，禁止对外
```

### 最小权限

每个 Pod 的 NetworkPolicy 应该只允许它**实际需要**通信的目标：
- 前端只需要访问后端 API，不应访问数据库
- 后端只需要访问数据库和缓存，不应直接暴露到外部
- 数据库只需要接受后端 App 的连接

### 命名空间隔离优先

先用命名空间级别的 NetworkPolicy 做粗粒度隔离，再用 Pod 级别做细粒度：

```yaml
# namespace-level 策略：禁止跨命名空间访问（默认）
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
spec:
  podSelector: {}
  policyTypes:
    - Ingress

# 显式放行必要的跨命名空间流量
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: frontend
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: ingress-nginx
```

## 面试追问方向

- 如果 CNI 插件不支持 NetworkPolicy，流量能被控制吗？
- `podSelector: {}`（空选择器）和不写 `podSelector` 有什么区别？
- 为什么说一旦给 Pod 声明了 NetworkPolicy，就要把所有合法来源都写进去？
- Egress DNS 规则为什么必须写？DNS 走 TCP/UDP 53 端口是 K8s 的强制要求吗？
- NetworkPolicy 和 Kubernetes 的 NetworkPolicy 资源是同一个吗？Calico 扩展了什么？

> NetworkPolicy 是 K8s 网络安全的最后一道防线。在零信任网络理念下，「从不信任，始终验证」——NetworkPolicy 正是这一理念在 K8s 中的实现。
