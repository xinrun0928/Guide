# Service Mesh：Istio、Linkerd、Envoy 架构

「服务间通信的基础设施，能不能不要我自己写代码处理？」——Service Mesh 把服务通信的关注点从应用层下沉到基础设施层。

在微服务架构中，服务间通信涉及重试、超时、熔断、流量控制、mTLS 加密……这些逻辑如果放在业务代码里，既是重复劳动，也是潜在的 bug 来源。Service Mesh 的思路是：**让基础设施来处理这些横切关注点，业务代码专注业务逻辑。**

## Service Mesh 的本质

Service Mesh 是一个专用基础设施层，**透明地**处理服务间通信。它的核心特征是「透明」——应用不需要感知它的存在，业务代码中不需要写任何服务网格相关的代码。

```
传统架构：
┌────────────────────────────────────────────┐
│  Service A                                 │
│  ┌────────────────┐  ┌────────────────┐   │
│  │ 业务代码        │  │ 通信逻辑        │   │
│  │  + 重试/超时    │  │  + 限流/熔断   │   │
│  │  + mTLS        │  │  + 链路追踪    │   │
│  └────────────────┘  └────────────────┘   │
└────────────────────────────────────────────┘

Service Mesh 架构：
┌────────────────────────────────────────────┐
│  Service A                                 │
│  ┌────────────────┐  ┌────────────────┐   │
│  │ 业务代码        │  │  Sidecar Proxy │   │ ← Envoy
│  │ (无需感知网格)  │  │  (基础设施处理) │   │
│  └────────────────┘  └────────────────┘   │
└────────────────────────────────────────────┘
         │
         │  所有流量都经过 Sidecar Proxy
         │  控制面（Control Plane）下发配置
         ▼
┌────────────────────────────────────────────┐
│           Service Mesh Data Plane          │
│  ┌──────┐   ┌──────┐   ┌──────┐        │
│  │proxy │───│proxy │───│proxy │        │
│  └──────┘   └──────┘   └──────┘        │
│  mTLS + 重试 + 超时 + 限流 + 追踪          │
└────────────────────────────────────────────┘
```

## Envoy：Service Mesh 的数据平面

Envoy 是目前最流行的 Service Mesh 数据平面代理，也是 Istio 的默认 Sidecar。

### Envoy 的核心能力

Envoy 作为 Sidecar 代理，每个 Pod 都有一个 Envoy 容器作为中间层：

- **L4/L7 代理**：在网络层和应用层处理流量
- **动态配置**：从 Control Plane 获取配置，实时生效（无需重启）
- **可观测性**：自动生成指标、日志、追踪数据
- **负载均衡**：支持多种算法（轮询、加权、最少连接、哈希）

```yaml
# Envoy 的工作方式（以 Kubernetes 为例）
# Pod 内有两个容器：
# 1. App Container：业务代码
# 2. Envoy Proxy Container：基础设施代理

# 应用发出请求（以 localhost:15001 为出口）
curl http://localhost:15001/api/v1/users
#         ↑
#         Envoy 拦截所有出站流量
#           - 读取目标服务名
#           - 应用负载均衡策略
#           - 追加追踪头
#           - 加密（mTLS）
#           - 转发到目标服务
```

### Envoy 的关键特性

```yaml
# 流量管理配置（通过 xDS API 动态下发）
static_resources:
  listeners:
    - address:
        socket_address:
          address: 0.0.0.0
          port_value: 15001
      filter_chains:
        - filters:
            - name: envoy.filters.network.http_connection_manager
              typed_config:
                "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
                codec_type: AUTO
                route_config:
                  virtual_hosts:
                    - name: service
                      domains: ["*"]
                      routes:
                        - match: { prefix: "/" }
                          route:
                            cluster: original_dst
                http_filters:
                  - name: envoy.filters.http.router
clusters:
  - name: original_dst
    type: ORIGINAL_DST
    lb_policy: ORIGINAL_DST_LB
```

## Istio：完整的企业级 Service Mesh

### 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Istiod（Control Plane）                   │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │    Pilot     │  │   Citadel    │  │   Galley     │    │
│  │  (流量管理)   │  │  (身份+证书)  │  │  (配置验证)   │    │
│  │  下发 xDS   │  │  自动 mTLS   │  │  配置验证    │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                        xDS API
                              │
┌─────────────────────────────────────────────────────────────┐
│                  Data Plane（每个 Pod）                     │
│                                                              │
│  Envoy Proxy (Sidecar)                                      │
│  ├── Listener: 接收入口流量 (15001)                          │
│  ├── Route: 路由规则                                         │
│  ├── Cluster: 目标服务集群                                    │
│  ├── Filter: 认证、追踪、限流                                 │
│  └── Metric: 生成 Prometheus 指标                             │
└─────────────────────────────────────────────────────────────┘
```

### 核心功能

#### 1. Traffic Management（流量管理）

```yaml
# VirtualService：路由规则
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: api-backend
spec:
  hosts:
    - api-backend
  http:
    - match:
        - headers:
            x-canary:
              exact: "always"
      route:
        - destination:
            host: api-backend
            subset: v2
          weight: 100
    - route:
        - destination:
            host: api-backend
            subset: v1
          weight: 90
        - destination:
            host: api-backend
            subset: v2
          weight: 10   # 10% 流量到 v2（金丝雀发布）
---
# DestinationRule：目标策略
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: api-backend
spec:
  host: api-backend
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        h2UpgradePolicy: UPGRADE
    loadBalancer:
      simple: LEAST_REQUEST
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
---
# PeerAuthentication：mTLS 强制
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: production
spec:
  mtls:
    mode: STRICT  # 强制 mTLS，非 mTLS 流量将被拒绝
```

#### 2. Security（安全）

Istio Citadel 自动为每个 Service Account 签发证书，实现 Pod 间的 mTLS 加密：

```yaml
# 自动证书管理
# Citadel 定期轮换证书（默认每 24 小时）
# 应用无需感知证书，因为 Envoy 自动处理 TLS 握手
```

#### 3. Observability（可观测性）

Istio 自动生成以下遥测数据：

- **Metrics**：请求成功率、延迟分位数、流量大小
- **Logs**：访问日志（通过 Envoy）
- **Traces**：分布式追踪（集成 Jaeger/Zipkin）

```bash
# 查看 Istio 自动生成的指标（Prometheus 格式）
# istio_requests_total{destination_service="api-backend", response_code="200"}
# istio_request_duration_milliseconds{destination_service="api-backend", quantile="0.99"}
```

### Istio 的缺点

- **资源开销**：每个 Pod 额外运行一个 Envoy 容器，通常增加 10-20% 资源消耗
- **运维复杂度**：Istiod、Envoy、Sidecar Injection……运维成本不低
- **延迟增加**：Sidecar 拦截带来额外的网络跳转（通常 1-3ms）
- **学习曲线**：流量管理配置（VirtualService、DestinationRule）有一定学习成本

## Linkerd：轻量级的 Service Mesh

### 设计哲学

Linkerd 的设计哲学是「简单即安全」——它只做最核心的几件事，并把它们做到极致。

| 对比维度 | Istio | Linkerd |
|---------|-------|--------|
| 复杂度 | 高 | 低 |
| 资源开销 | 较大 | 极小（约 0.5% CPU） |
| Rust 实现 | Envoy（C++） | linkerd2-proxy（Rust，更安全） |
| 功能范围 | 全功能 | 核心功能 |
| 配置复杂度 | 高（数十种 CRD） | 低（少量 CRD） |
| 适用场景 | 大型企业，复杂需求 | 追求简单可靠 |

Linkerd 默认开启 mTLS，自动收集指标，对运维人员更友好。

## 选型建议

```
选 Istio：
  - 需要细粒度的流量管理（金丝雀、蓝绿、A/B 测试）
  - 需要 L7 限流、请求重写、CORS 配置
  - 大型企业，多团队，有专人维护 Service Mesh

选 Linkerd：
  - 追求简单可靠，不想深入 Service Mesh 细节
  - 团队规模小，没有专人运维
  - 主要需求是 mTLS + 可观测性，不需要复杂流量管理

不用 Service Mesh：
  - 服务数量少（< 10），通信简单
  - 团队对 K8s 网络还不太熟悉
  - 已有 Spring Cloud 等服务治理方案
```

## 面试追问方向

- Sidecar 模式的 Envoy 是怎么工作的？流量是怎么被拦截的？
- Istiod（Pilot + Citadel + Galley）合并后，各自职责是什么？
- Service Mesh 的 mTLS 和传统 API Gateway 的 TLS Termination 有什么区别？
- Envoy 的 xDS API 是什么？它包含哪些 Discovery Services？
- Service Mesh 会增加多少延迟？什么情况下这个延迟不可接受？

> Service Mesh 把服务通信的关注点从业务代码中剥离出来，让开发者专注业务逻辑。但它的运维复杂度也是真实存在的——选择 Service Mesh 之前，先问自己：你的团队准备好了吗？
