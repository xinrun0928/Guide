# Ingress：HTTP/HTTPS 路由与七层负载均衡

「我有几十个微服务，每个都配一个 LoadBalancer？」——这显然不是生产级的做法。

Ingress 才是 K8s 中处理 HTTP/HTTPS 流量的标准方案。它基于七层（应用层）协议工作，根据域名、路径、请求头等条件，将流量路由到不同的后端 Service，实现了一个集群级别的「反向代理 + 负载均衡器」。

## Ingress 的工作原理

Ingress 本身只是一个 API 对象，具体的流量处理由 **Ingress Controller** 实现。K8s 不会自带 Ingress Controller，需要额外安装。

```
客户端请求: https://api.example.com/users/123
        │
        ▼
┌─────────────────────────────────────────┐
│           Ingress Controller            │
│         (Nginx / Traefik / Gateway)     │
│                                         │
│  api.example.com/*    → backend-svc    │
│  web.example.com/*    → frontend-svc   │
│  admin.example.com/*  → admin-svc      │
└─────────────────────────────────────────┘
        │
        ▼
    后端 Service → Pod
```

主流 Ingress Controller：

- **Nginx Ingress Controller**：功能最丰富，生产最常用
- **Traefik**：云原生，支持动态配置
- **Kong Ingress Controller**：API Gateway 能力
- **云厂商 Gateway API**：AWS ALB Ingress Controller、GKE Ingress 等

## 基础 Ingress 配置

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /$1
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: backend-svc
                port:
                  number: 8080
          - path: /admin
            pathType: Prefix
            backend:
              service:
                name: admin-svc
                port:
                  number: 8080
    - host: web.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend-svc
                port:
                  number: 80
```

### pathType 的三种模式

```yaml
# Exact：精确匹配（区分大小写）
pathType: Exact
path: /api/users

# Prefix：前缀匹配（/api 匹配 /api 和 /api/anything）
pathType: Prefix
path: /api

# ImplementationSpecific：取决于 IngressClass 实现
pathType: ImplementationSpecific
```

## HTTPS 配置

### 使用 TLS 证书

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: tls-ingress
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - api.example.com
        - web.example.com
      secretName: example-tls  # 引用存储了证书的 Secret
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: backend-svc
                port:
                  number: 8080
```

证书 Secret 的创建：

```bash
# 通过 kubectl 创建 TLS Secret
kubectl create secret tls example-tls \
  --cert=path/to/cert.pem \
  --key=path/to/key.pem

# 或者通过 cert-manager 自动管理（推荐生产环境）
```

### 常用 annotation

Ingress Controller 支持大量自定义 annotation：

```yaml
annotations:
  # Nginx Ingress 常用配置
  nginx.ingress.kubernetes.io/ssl-redirect: "true"        # 自动跳转 HTTPS
  nginx.ingress.kubernetes.io/proxy-body-size: "50m"     # 上传文件大小限制
  nginx.ingress.kubernetes.io/proxy-read-timeout: "300"   # 后端超时时间
  nginx.ingress.kubernetes.io/limit-rps: "100"            # 限速
  nginx.ingress.kubernetes.io/limit-connections: "10"     # 限制并发连接数
  nginx.ingress.kubernetes.io/cors-allow-origin: "*"      # CORS 配置
  nginx.ingress.kubernetes.io/canary: "true"              # 开启金丝雀发布
  nginx.ingress.kubernetes.io/canary-weight: "50"          # 金丝雀流量权重
```

### 使用 cert-manager 自动签发证书

cert-manager 是 K8s 原生的证书管理方案，自动从 Let's Encrypt 等签发机构获取 TLS 证书：

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-ingress
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - api.example.com
      secretName: example-tls
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: backend-svc
                port:
                  number: 8080
```

cert-manager 会自动创建 Certificate 资源，向 Let's Encrypt 发起认证，验证通过后自动存储证书到 Secret。

## 金丝雀发布（Canary Release）

Nginx Ingress Controller 支持基于权重的金丝雀流量分发：

```yaml
# 主版本 Ingress
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-v1
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: backend-v1
                port:
                  number: 8080
---
# 金丝雀 Ingress（只引 10% 流量）
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-v2-canary
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "10"
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: backend-v2
                port:
                  number: 8080
```

### 三种金丝雀路由策略

```yaml
# 基于 Header 的金丝雀（测试人员内测）
nginx.ingress.kubernetes.io/canary-header: "X-Canary"
nginx.ingress.kubernetes.io/canary-header-value: "always"

# 基于 Cookie 的金丝雀（特定用户群体）
nginx.ingress.kubernetes.io/canary-cookie: "canary"
nginx.ingress.kubernetes.io/canary-cookie-value: "always"

# 基于权重的金丝雀（流量百分比）
nginx.ingress.kubernetes.io/canary-weight: "50"
```

## Ingress 和 API Gateway 的区别

| 特性 | Ingress | API Gateway |
|------|---------|------------|
| 工作层 | L7（HTTP/HTTPS） | L7 + 可扩展 |
| 功能范围 | 路由为主 | 路由 + 认证 + 限流 + 协议转换 |
| 适用场景 | 简单路由 | 复杂微服务治理 |
| 代表方案 | Nginx Ingress | Kong、Ambassador |
| 复杂度 | 低 | 高 |
| 成本 | 开源免费 | 部分商业 |

在大多数场景下，Nginx Ingress Controller + cert-manager 的组合已经足够满足 HTTP/HTTPS 路由需求。如果需要 API 认证、OAuth2、协议转换等更高级能力，再考虑引入 API Gateway。

## 面试追问方向

- Ingress Controller 是怎么实现配置热更新的？为什么不用 reload？
- 为什么生产环境推荐用 Ingress 而不是多个 NodePort/LoadBalancer？
- TLS termination 发生在哪一层？集群内 Pod 之间的通信需要 TLS 吗？
- cert-manager 是怎么证明你对域名的所有权的？HTTP01 和 DNS01 有什么区别？

> Ingress 是 K8s 集群的 HTTP/HTTPS 统一入口。掌握 Ingress + cert-manager 的组合，是生产环境 HTTPS 化的事实标准。
