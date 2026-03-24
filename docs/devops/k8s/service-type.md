# Service 类型：ClusterIP、NodePort、LoadBalancer、ExternalName

「怎么让集群外部访问我的应用？」——这是每个 K8s 开发者都会遇到的问题。

ClusterIP 只能在集群内部访问，NodePort 通过节点端口暴露服务，LoadBalancer 集成云厂商负载均衡器，ExternalName 把服务映射到外部域名。四个类型，四种场景，你真的分清楚了吗？

## 四种 Service 类型概览

| 类型 | 适用场景 | 集群外部访问方式 | 局限性 |
|------|---------|----------------|--------|
| ClusterIP | 内部服务间通信 | 不可直接访问 | 仅集群内 |
| NodePort | 开发测试、小规模生产 | `NodeIP:NodePort` | 端口范围 30000-32767 |
| LoadBalancer | 生产环境（配合云厂商） | 云厂商 LB 分配公网 IP | 依赖云平台 |
| ExternalName | 内部服务引用外部服务 | 不适用 | 仅做 CNAME 映射 |

## ClusterIP：默认类型

ClusterIP 是默认类型，K8s 分配一个仅集群内可访问的虚拟 IP。

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend-svc
spec:
  type: ClusterIP
  selector:
    app: backend
  ports:
    - port: 8080        # Service 暴露的端口（集群内访问用）
      targetPort: 8080  # 后端 Pod 监听的端口
      protocol: TCP
```

ClusterIP 是 K8s 内部服务间通信的基础。Service 主要用于 Pod 之间的相互发现，而不是直接给外部使用。

### Headless Service

设置 `clusterIP: None` 创建 Headless Service，此时 K8s 不分配 ClusterIP，DNS 直接返回后端 Pod 的 IP 列表：

```yaml
spec:
  clusterIP: None  # Headless
  selector:
    app: backend
```

## NodePort：在节点级别暴露服务

NodePort 在每个节点的 IP 上监听一个端口（默认 30000-32767），将流量转发到后端 Service：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: backend-nodeport
spec:
  type: NodePort
  selector:
    app: backend
  ports:
    - port: 8080
      targetPort: 8080
      nodePort: 30080  # 可选，指定固定端口；不指定则随机分配
```

访问方式：`http://<任意节点IP>:30080`

```
集群外部请求
      │
      ▼
节点 IP:30080  ──→  kube-proxy (iptables/IPVS)
                         │
                         ▼
                    ClusterIP Service
                         │
                         ▼
                    后端 Pod
```

### NodePort 的坑

1. **端口范围受限**：只能用 30000-32767，无法使用标准端口（80/443）
2. **IP 依赖节点**：如果访问的节点挂了，流量就断了（配合 L4 LB 解决）
3. **kube-proxy 性能**：大量 NodePort 规则会影响 kube-proxy 性能

## LoadBalancer：集成云厂商负载均衡器

LoadBalancer 将 Service 委托给云厂商的负载均衡器，由云厂商分配公网 IP：

```yaml
spec:
  type: LoadBalancer
  selector:
    app: backend
  ports:
    - port: 80
      targetPort: 8080
  # 公有云会自动创建对应的 LB 实例
```

```
外部请求
    │
    ▼
云厂商 LoadBalancer (公网 IP)
    │
    ├──► NodeIP:NodePort  ──► Pod A
    ├──► NodeIP:NodePort  ──► Pod B
    └──► NodeIP:NodePort  ──► Pod C
```

### MetalLB：私有环境的 LoadBalancer

在私有化环境（无云厂商 LB）中，可以使用 **MetalLB** 来提供 LoadBalancer 功能。MetalLB 有两种模式：

- **Layer 2 模式**：在一台节点上「抢占」一个 IP，通过 ARP/NDP 响应
- **BGP 模式**：和路由器建立 BGP 会话，宣告 Service IP（需要路由器支持）

```yaml
# MetalLB 的 Service 配置示例
spec:
  type: LoadBalancer
  externalTrafficPolicy: Local  # 保留客户端 IP
  loadBalancerIP: 192.168.1.100  # 指定分配的 IP
```

### externalTrafficPolicy：保留源 IP

默认情况下，kube-proxy 会做 SNAT，源 IP 变为节点 IP。如果需要保留真实客户端 IP：

```yaml
spec:
  externalTrafficPolicy: Local  # 仅转发到本机Pod，不跨节点转发
```

注意：`Local` 会导致流量只发到有对应 Pod 的节点，需要配合健康检查使用。

## ExternalName：将服务映射到外部域名

ExternalName 将 Service 映射到一个外部 DNS 名称，返回 CNAME 记录：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: mysql-external
spec:
  type: ExternalName
  externalName: mysql.prod.example.com
```

当集群内 Pod 访问 `mysql-external.default.svc.cluster.local` 时，DNS 返回 `mysql.prod.example.com` 的 CNAME，客户端直接解析外部域名。

典型用途：
- 引用集群外的数据库（遗留系统迁移过渡期）
- 统一内部服务访问路径（将来可能换回集群内服务）
- 不想让 Pod 直接依赖外部硬编码地址

## Ingress 和 Service 的关系

很多人会混淆 Ingress 和 Service 的职责：

- **Service**：四层（TCP/UDP）负载均衡，将流量从 Pod 外部导向 Pod 内部
- **Ingress**：七层（HTTP/HTTPS）反向代理，基于域名和路径路由到不同的 Service

```bash
# Ingress 将请求路由到不同的 Service
# exam.com/api/*  → backend-svc
# exam.com/web/*  → frontend-svc
# exam.com/       → default-svc
```

Ingress 是集群内统一的 HTTP/HTTPS 入口，比多个 NodePort/LoadBalancer 更适合生产环境。

## 选型决策

```
是否需要集群外部访问？
    │
    ├── 否 ──► ClusterIP（内部服务间通信）
    │
    └── 是 ──► 需要 HTTP/HTTPS 路由？
                  │
                  ├── 是 ──► Ingress + LoadBalancer/NodePort
                  │
                  └── 否 ──► 访问量小 / 开发测试？
                               │
                               ├── 是 ──► NodePort
                               │
                               └── 否 ──► LoadBalancer（+ MetalLB）
```

## 面试追问方向

- NodePort 的端口范围是怎么来的？为什么不是 0-65535？
- LoadBalancer 类型的 Service，云厂商实际创建了什么资源？
- `externalTrafficPolicy: Local` 的代价是什么？什么场景下必须用？
- Ingress 和 Service 的本质区别是什么？

> Service 是 K8s 服务发现的核心抽象。理解四种类型的适用场景，才能在不同的网络需求下做出正确选择。
