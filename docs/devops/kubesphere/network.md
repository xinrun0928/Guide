# KubeSphere 网络管理：Porter 与负载均衡器

「集群内的服务怎么暴露给外部？」——KubeSphere 的网络层帮你理清流量入口。

KubeSphere 的网络管理涉及两个方面：集群内部网络（Pod 通信、Service 发现）和集群外部访问（Ingress、负载均衡）。KubeSphere 通过 Porter 和 Ingress Controller 提供企业级的网络出口方案。

## 网络模型

```
┌─────────────────────────────────────────────────────────────────┐
│                    KubeSphere 网络层次                            │
│                                                                  │
│  Pod 网络                                                        │
│  ├── 每个 Pod 有唯一 IP（K8s CNI 分配）                         │
│  ├── Pod 之间可以直接通信（跨节点也行）                           │
│  └── 典型 CNI：Calico、Flannel、Cilium                          │
│                                                                  │
│  Service 网络                                                    │
│  ├── ClusterIP：集群内部可访问，外部不可访问                    │
│  ├── NodePort：每个节点暴露一个端口（30000-32767）              │
│  ├── LoadBalancer：云厂商负载均衡器（依赖云厂商插件）            │
│  └── ExternalName：DNS 别名                                     │
│                                                                  │
│  Ingress 网络                                                   │
│  ├── HTTP/HTTPS 七层路由                                      │
│  ├── 基于域名分发流量                                           │
│  └── 需要 Ingress Controller（如 Nginx Ingress）               │
└─────────────────────────────────────────────────────────────────┘
```

## Ingress 管理

### Ingress 配置

```yaml
# KubeSphere 图形化创建 Ingress 会生成以下 YAML
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-ingress
  namespace: my-project
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
    nginx.ingress.kubernetes.io/proxy-connect-timeout: "30"
spec:
  ingressClassName: nginx
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: myapp-service
                port:
                  number: 80
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: myapp-api-service
                port:
                  number: 8080
  tls:
    - hosts:
        - myapp.example.com
      secretName: myapp-tls-secret
```

### TLS 配置

```yaml
# 自动 TLS（使用 Let's Encrypt）
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-ingress
  namespace: my-project
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - myapp.example.com
      secretName: myapp-tls
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: myapp-service
                port:
                  number: 80

---
# Certificate CRD（cert-manager 自动签发证书）
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: myapp-cert
  namespace: my-project
spec:
  secretName: myapp-tls
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
    - myapp.example.com
```

## Porter LB（物理机房负载均衡）

### Porter 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Porter LB 架构（物理机房场景）                    │
│                                                                  │
│  外部网络                                                        │
│     │                                                          │
│     ▼                                                          │
│  ┌────────────────┐                                            │
│  │  物理负载均衡器  │                                            │
│  │  （交换机 VIP） │                                            │
│  └────────┬───────┘                                            │
│           │                                                      │
│     ┌─────┴──────┐                                            │
│     │  BGP 路由   │                                            │
│     └─────┬──────┘                                            │
│           │                                                      │
│     ┌─────┴──────┐                                            │
│     │ Porter LB  │                                            │
│     │ (DaemonSet) │                                            │
│     └─────┬──────┘                                            │
│           │                                                      │
│     ┌─────┴──────┐                                            │
│     │ Service    │                                            │
│     │ (LoadBalancer) │                                       │
│     └────────────┘                                            │
└─────────────────────────────────────────────────────────────────┘
```

### Porter 配置

```yaml
# 启用 Porter LB（KubeSphere 可选模块）
# 安装后 Porter 以 DaemonSet 形式运行在每个节点
apiVersion: v1
kind: Service
metadata:
  name: myapp-lb
  namespace: my-project
  annotations:
    # 指定使用 Porter LB
    lb.kubesphere.io/v1alpha1: porter
    # 指定 EIP（外部 IP）
    eip.porter.kubesphere.io/v1alpha2: my-eip
spec:
  type: LoadBalancer
  selector:
    app: myapp
  ports:
    - protocol: TCP
      port: 80
      targetPort: 8080
```

## 网络策略

### Project 网络隔离

```yaml
# 默认情况下，同一集群内不同 Namespace 的 Pod 可以互相通信
# 通过 NetworkPolicy 实现隔离
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: myproject-isolation
  namespace: my-project
spec:
  podSelector: {}    # 选择所有 Pod
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # 只允许带有 app=frontend 标签的 Pod 访问
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8080
    # 允许 Ingress Controller 流量
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/ingress-backend: nginx
  egress:
    # 只允许访问特定服务
    - to:
        - podSelector:
            matchLabels:
              app: database
      ports:
        - protocol: TCP
          port: 5432
    # 允许 DNS
    - to:
        - namespace: kube-system
      ports:
        - protocol: UDP
          port: 53
```

## DNS 服务发现

```bash
# KubeSphere 使用 CoreDNS 做集群内 DNS
# 常见 DNS 访问模式
# 集群内部
# myapp.my-project.svc.cluster.local
# 简写：myapp.my-project

# 集群外部（通过 Ingress）
# https://myapp.example.com

# DNS 记录类型
# A 记录：Pod IP（如 10.233.1.100）
# SRV 记录：服务端口（如 _http._tcp.myapp.my-project.svc.cluster.local）
# CNAME 记录：ExternalName 服务

# DNS 缓存
# KubeSphere 支持 NodeLocal DNSCache
# 每个节点运行一个 DNS 缓存，减少 DNS 查询延迟
```

## 面试追问方向

1. **NodePort vs LoadBalancer vs Ingress，应该怎么选？**
   答：NodePort 适合测试环境或简单场景（端口固定在 30000-32767）。LoadBalancer 适合需要固定入口的生产环境，但需要云厂商支持或 Porter/MetaLB。Ingress 适合 HTTP/HTTPS 场景（基于域名路由），是生产环境 Web 服务的标准入口。

2. **Service 的 ClusterIP 是怎么分配的？**
   答：Service ClusterIP 从 `kube-service-ip-range`（默认 10.233.0.0/16）分配，由 kube-apiserver 动态分配。ClusterIP 无法 ping 通（是虚拟 IP），只有通过 iptables/IPVS 规则转发到后端 Pod 才有效。

3. **KubeSphere 的网络策略和 Pod 网络隔离是什么关系？**
   答：KubeSphere 默认创建 Workspace 级别的网络隔离（不同 Workspace 的 Pod 默认不通）。在同一 Workspace 内，不同 Project（Namespace）的 Pod 默认可以互通（K8s 默认行为）。如果需要 Project 级别的隔离，在 KubeSphere 控制台中为 Project 开启网络隔离策略，会自动生成 NetworkPolicy。

> "网络是 K8s 中最复杂也是最重要的子系统。好的网络规划，是服务发现、流量治理和安全隔离的基础。把 Ingress 配好、把网络策略写清楚，网络问题就少了一半。"
