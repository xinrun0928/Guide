# Kubernetes DNS 服务发现原理

「Pod 之间怎么找到彼此？」——在传统架构里，我们用注册中心；K8s 里，这个角色由 DNS 担当。

你有没有想过：一个 Pod 怎么通过 `http://backend-svc.default.svc.cluster.local` 这个名字，访问到另一个 Pod 的？DNS 记录是什么时候创建的？Pod 里的 DNS 解析配置又是从哪来的？

这一篇，我们把 K8s DNS 的来龙去脉讲清楚。

## K8s DNS 的演进

K8s 最早使用 SkyDNS，后来演进到 CoreDNS。CoreDNS 于 K8s 1.11 成为默认 DNS 服务器，目前是主流选择。

CoreDNS 是一个用 Go 编写的插件式 DNS 服务器，每个插件实现一个功能（如 kubernetes 插件处理集群内查询，forward 插件处理集群外查询）。

## DNS 服务器的部署

CoreDNS 以 Deployment 的形式运行在 `kube-system` 命名空间中：

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
# NAME                       READY   STATUS    RESTARTS   AGE
# coredns-7bbd98d8f9-hj2kx   1/1     Running   0          30d
# coredns-7bbd98d8f9-k8mnp   1/1     Running   0          30d
```

CoreDNS 的副本数通常等于集群节点数或 2 个（取决于集群规模），通过 DaemonSet 或副本数为节点数来保证高可用。

## DNS 记录的格式

K8s 为每个 Service 和 Pod 都创建 DNS 记录，但格式不同：

### Service 的 DNS 记录

```bash
# 完整格式（FQDN）
<service-name>.<namespace>.svc.<cluster-domain>

# 集群默认 domain 为 cluster.local
# 例如：一个 default 命名空间下的 nginx-svc 服务
nginx-svc.default.svc.cluster.local

# 简化格式（同一命名空间内可省略）
nginx-svc.default.svc
nginx-svc.default

# 同一命名空间内（最简）
nginx-svc
```

### Pod 的 DNS 记录

Pod 的 DNS 记录格式基于 Pod 的 IP 地址，将点分十进制转为点分十进制的冒号分隔格式：

```bash
# Pod IP: 10.244.1.15
# DNS 记录格式：
10-244-1-15.default.pod.cluster.local

# 注意：Pod 必须设置 pod.spec.hostname 和 pod.spec.subdomain 才会生成 DNS 记录
# 如果未设置，Pod 只有自动生成的节点级别 DNS 记录
```

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx
  namespace: default
spec:
  hostname: nginx
  subdomain: my-svc
  containers:
    - name: nginx
      image: nginx
---
apiVersion: v1
kind: Service
metadata:
  name: my-svc
  namespace: default
spec:
  clusterIP: None  # Headless Service
  selector:
    app: nginx
  # Pod 的完整 DNS 为：nginx.my-svc.default.svc.cluster.local
```

## DNS 解析配置：resolv.conf

Pod 内的 DNS 解析配置来自 `/etc/resolv.conf`，这个文件由 kubelet 管理，内容大致如下：

```bash
# Pod 内的 /etc/resolv.conf
nameserver 10.96.0.10       # CoreDNS Service 的 ClusterIP
search <namespace>.svc.cluster.local svc.cluster.local cluster.local
options ndots:5
```

关键配置说明：

- **nameserver**：CoreDNS 的 ClusterIP，所有 DNS 查询都发到这里
- **search**：搜索域后缀列表，K8s 自动添加命名空间和集群域
- **ndots**：`5` 表示如果查询的域名中点号数量少于 5，就在查询前加上 search 后缀

`ndots:5` 是一个容易踩坑的配置。如果设置为 `5`，那么访问 `db` 这个短名称时，DNS 实际查询顺序为：

```
db.default.svc.cluster.local  ✗
db.svc.cluster.local           ✗
db.cluster.local               ✗
cluster.local                  ✗
cluster.local（根域名服务器查询） ✗
db（原始域名）                  ✓
```

每次不匹配的 DNS 查询都会增加延迟，可以通过 `pod.spec.dnsPolicy` 和 `dnsConfig` 自定义策略。

## dnsPolicy 选项

```yaml
spec:
  dnsPolicy: ClusterFirst    # 默认：优先使用集群 DNS，不行再走节点的 resolv.conf
  # dnsPolicy: Default        # 直接使用节点的 resolv.conf，不经过 CoreDNS
  # dnsPolicy: ClusterFirstWithHostNet  # Pod 使用 hostNetwork 时需要这个
  # dnsPolicy: None          # 完全自定义，使用下面的 dnsConfig
  dnsConfig:
    nameservers:
      - 8.8.8.8
    searches:
      - custom.search.suffix
    options:
      - name: ndots
        value: "2"
```

## CoreDNS 的查询流程

当一个 Pod 查询 `nginx-svc.default.svc.cluster.local` 时，DNS 请求的流转如下：

```
Pod (10.244.1.15)
  │
  │ DNS Query: nginx-svc.default.svc.cluster.local
  │ UDP/TCP Port 53
  ▼
kube-proxy / iptables rules
  │
  │ 路由到 CoreDNS Service
  ▼
CoreDNS Pod (10.96.0.10)
  │
  │ kubernetes 插件查询 kube-apiserver
  ▼
kube-apiserver → etcd
  │
  │ 返回 nginx-svc 后端的 Pod IP 列表
  ▼
CoreDNS 响应：10.244.1.15, 10.244.2.8
  │
  ▼
Pod 获取到目标 IP，建立连接
```

## 常见问题

### 跨命名空间访问

跨命名空间访问时，必须使用完整格式：

```bash
# default 命名空间的 Pod 访问 production 命名空间的 db-svc
curl http://db-svc.production.svc.cluster.local:5432
```

### Headless Service 的 DNS 负载均衡

Headless Service（clusterIP: None）返回后端 Pod 的真实 IP 列表，而不是 ClusterIP。客户端可以直接和 Pod IP 通信，适用于：

- 有状态应用（MySQL 集群主从）
- 客户端需要做负载均衡的场景
- 需要知道每个 Pod 具体 IP 的场景

### DNS 缓存

K8s 默认不使用 DNS 缓存（CoreDNS 本身有缓存，但 Pod 层面没有）。对于频繁解析的场景，可以引入 `nodelocaldns`（NodeLocal DNSCache）来减少 DNS 延迟。

## 面试追问方向

- CoreDNS 和 kube-dns（SkyDNS 时期）有什么区别？为什么做了这个切换？
- 跨命名空间的 Service 访问有什么需要注意的？
- `ndots` 配置过高会导致什么问题？如何优化？
- Pod 的 DNS 记录是怎么注册到 CoreDNS 的？kube-apiserver 扮演什么角色？

> DNS 是 K8s 服务发现的基础。理解 DNS 记录的格式、查询路径和常见坑，是排查「Pod 之间互访不通」问题的前提。
