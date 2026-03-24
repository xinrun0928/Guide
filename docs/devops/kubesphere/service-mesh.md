# KubeSphere 服务网格：基于 Istio 的可视化治理

「服务网格是什么？」——让微服务之间的通信管理变得可视化。

KubeSphere 的服务网格基于 Istio 构建，提供了微服务治理的可视化能力。不需要写复杂的 Istio YAML 配置文件，在图形化界面中就能配置流量管理、熔断、金丝雀发布等高级功能。

## 服务网格架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    KubeSphere 服务网格架构                           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Control Plane（Istiod）                   │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │              Istiod（Pilot + Citadel + Galley）      │   │   │
│  │  │                                                      │   │   │
│  │  │  - 配置分发：下发流量规则到 Sidecar                 │   │   │
│  │  │  - 证书管理：自动签发 mTLS 证书                     │   │   │
│  │  │  - 策略管理：金丝雀、熔断、限流策略                 │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                │                                      │
│  ┌─────────────────────────────┴──────────────────────────────┐   │
│  │                    Data Plane（Envoy Sidecar）                │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │                    应用 Pod                             │   │   │
│  │  │  ┌──────────┐    ┌──────────────────────────┐   │   │   │
│  │  │  │ App     │←──→│ Envoy Proxy (Sidecar)    │   │   │   │
│  │  │  │ Container│    │                          │   │   │   │
│  │  │  │         │←──→│ - 流量拦截                │   │   │   │
│  │  │  └──────────┘    │ - mTLS 加密             │   │   │   │
│  │  │                  │ - 指标采集               │   │   │   │
│  │  │                  │ - 链路追踪               │   │   │   │
│  │  │                  └──────────────────────────┘   │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    可观测性层                                 │   │
│  │  Jaeger（链路追踪）| Prometheus（指标）| Grafana（可视化）   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 流量管理

### 流量治理类型

```
┌─────────────────────────────────────────────────────────────────┐
│                    Istio 流量管理能力                              │
│                                                                  │
│  流量拆分（金丝雀发布）                                           │
│  - v1: 80% → v2: 20%                                          │
│  - 基于权重、Header、Cookie 的流量分配                           │
│                                                                  │
│  流量镜像                                                        │
│  - 真实流量同时发送到 v1 和 v2（v2 响应被丢弃）                  │
│  - 用于生产环境下的测试验证                                      │
│                                                                  │
│  熔断器                                                          │
│  - 熔断器模式（Circuit Breaker）                                │
│  - 连接池管理（Connection Pool）                                 │
│  - 异常点检测（Outlier Detection）                               │
│                                                                  │
│  限流                                                          │
│  - 请求速率限制（Rate Limiting）                                 │
│  - 并发连接数限制                                               │
│  - 基于来源的限流                                               │
│                                                                  │
│  超时控制                                                        │
│  - HTTP 请求超时                                                 │
│  - 重试策略                                                     │
│  - 熔断超时                                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 金丝雀发布配置

```yaml
# KubeSphere 图形化配置会生成以下 VirtualService 和 DestinationRule
# 金丝雀发布示例：v1 接收 80%，v2 接收 20%
apiVersion: networking.istio.io/v1alpha3
kind: DestinationRule
metadata:
  name: myapp
  namespace: my-project
spec:
  host: myapp
  subsets:
    - name: v1
      labels:
        version: v1
    - name: v2
      labels:
        version: v2
---
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: myapp
  namespace: my-project
spec:
  hosts:
    - myapp
  http:
    - route:
        - destination:
            host: myapp
            subset: v1
          weight: 80
        - destination:
            host: myapp
            subset: v2
          weight: 20
```

### 基于 Header 的流量控制

```yaml
# 基于 HTTP Header 的金丝雀发布
# Header 中带有 `x-user-type: internal` 的请求发送到 v2
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: myapp
spec:
  hosts:
    - myapp
  http:
    - match:
        - headers:
            x-user-type:
              exact: internal
      route:
        - destination:
            host: myapp
            subset: v2
    - route:
        - destination:
            host: myapp
            subset: v1
```

## 熔断配置

```yaml
# 熔断器配置示例
apiVersion: networking.istio.io/v1alpha3
kind: DestinationRule
metadata:
  name: myapp
spec:
  host: myapp
  trafficPolicy:
    outlierDetection:
      consecutiveGatewayErrors: 5    # 连续 5 次 502/503/504 错误
      interval: 30s                 # 检测间隔
      baseEjectionTime: 30s         # 基础驱逐时间
      maxEjectionPercent: 50       # 最多驱逐 50% 的后端实例
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        h2UpgradePolicy: UPGRADE
        http1MaxPendingRequests: 100
        http2MaxRequests: 1000
        maxRequestsPerConnection: 100
```

## 可观测性

### 链路追踪

```bash
# Jaeger 链路追踪
# KubeSphere 内置 Jaeger，追踪请求在微服务之间的调用路径
# 链路追踪字段
# - Trace ID：整个请求链路的唯一标识
# - Span：单个服务的处理单元
# - Span Parent：父 Span ID
# - 操作名称（Operation Name）
# - 开始时间 / 耗时
# - 标签（Tags）：HTTP 方法、状态码、URL
# 链路追踪界面
# KubeSphere → 服务网格 → 追踪 → 选择服务 → 查看链路
```

### 拓扑图

```bash
# 服务拓扑图
# KubeSphere 自动根据流量数据生成服务拓扑图
# 拓扑图包含：
# - 服务节点（圆圈）
# - 调用关系（箭头）
# - 流量大小（线条粗细）
# - 健康状态（颜色：绿/黄/红）
# - 请求成功率（节点上显示）
# - P99 延迟（节点上显示）
```

## 流量镜像

```yaml
# 流量镜像配置
# 将生产流量的副本发送到 v2（新版本）进行测试
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: myapp
spec:
  hosts:
    - myapp
  http:
    - route:
        - destination:
            host: myapp
            subset: v1
          weight: 100
      mirror:
        host: myapp
        subset: v2
      mirrorPercent: 100     # 镜像 100% 的流量到 v2
```

## 服务网格治理策略

### 限流配置

```yaml
# 请求限流（需要 Mixer 或 Wasm 扩展）
apiVersion: networking.istio.io/v1alpha3
kind: EnvoyFilter
metadata:
  name: myapp-rate-limit
  namespace: my-project
spec:
  workloadSelector:
    labels:
      app: myapp
  configPatches:
    - applyTo: CLUSTER
      patch:
        operation: MERGE
        value:
          circuit_breakers:
            thresholds:
              - max_connections: 100
                max_pending_requests: 100
                max_requests: 100
```

### mTLS 双向认证

```yaml
# KubeSphere 默认开启 mTLS
# 所有服务间通信加密
# PeerAuthentication 配置
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: myapp-mtls
  namespace: my-project
spec:
  mtls:
    mode: STRICT   # STRICT = 必须 mTLS，PERMISSIVE = 允许混合
---
# 命名空间级别 mTLS
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: default
  namespace: my-project
spec:
  mtls:
    mode: STRICT
```

## 最佳实践

### 服务网格启用流程

```
步骤：
1. 在 KubeSphere 控制台启用服务网格模块
2. 为需要加入服务网格的命名空间启用 Sidecar 自动注入
   kubectl label namespace my-project istio-injection=enabled
3. 重新部署应用（Sidecar 会自动注入）
4. 查看服务拓扑图和链路追踪
5. 配置流量管理策略
```

### Sidecar 注入控制

```bash
# 启用命名空间级别的 Sidecar 自动注入
kubectl label namespace my-project istio-injection=enabled

# 禁用特定工作负载的 Sidecar 注入
apiVersion: v1
kind: Deployment
metadata:
  name: no-sidecar-job
spec:
  template:
    metadata:
      annotations:
        sidecar.istio.io/inject: "false"
    spec:
      containers:
        - name: job
          image: myjob:latest
```

## 面试追问方向

1. **Sidecar 注入对应用有什么影响？**
   答：Sidecar 会拦截所有进出容器的流量（通过 iptables 规则），在请求前后做额外处理（mTLS 加密、指标采集、链路追踪）。主要影响：1) 额外的资源消耗（每个 Pod 增加约 50-100MB 内存）；2) 网络延迟略微增加（通常 1-3ms）；3) 故障排查时要区分是应用问题还是 Sidecar 问题。

2. **服务网格和 Spring Cloud Feign/Hystrix 有什么区别？**
   答：Spring Cloud 的服务治理是代码级别的（需要在业务代码中引入依赖），K8s 原生的是网络级别的（不需要改代码）。服务网格的优势：与语言无关（Java/Go/Python 都能用）、集中治理（所有服务统一配置）、透明代理（业务代码无感知）。但服务网格有额外的资源开销和学习成本。

3. **KubeSphere 服务网格的链路追踪是怎么做的？**
   答：通过 Envoy Sidecar 的 Access Log 记录请求信息，结合 B3 或 W3C TraceContext 规范传递 TraceID。当请求进入系统时，第一个服务生成 TraceID，后续服务通过 HTTP Header 传递。Jaeger 收集这些数据后聚合展示完整调用链。

> "服务网格是把『微服务治理』从代码层搬到了基础设施层。业务代码不需要关心 mTLS、熔断、重试，这些由 Sidecar 代理处理。但这不意味着不需要理解它——出了问题，你还是得知道流量是怎么走的。"
