# K3s：轻量级 Kubernetes 发行版

「资源不够跑 K8s？」——K3s 是答案。

K3s 是 Rancher（现 SUSE）出品的 Kubernetes 发行版，将所有 K8s 组件打包成单个二进制（< 100MB），对硬件要求极低，安装仅需 5 分钟。它不是 K8s 的阉割版，而是 K8s 的轻量化部署方式。

## K3s vs 标准 K8s

```
┌─────────────────────────────────────────────────────────────────┐
│                 K3s vs Kubernetes                             │
│                                                                  │
│  K3s                                                         │
│  ├── 单二进制 < 100MB                                          │
│  ├── 内存需求：512MB（Master）、200MB（Agent）                 │
│  ├── SQLite（默认）替代 etcd                                  │
│  ├── 内置 K8s、Docker、Containerd、Flannel CNI                │
│  ├── 原生支持 ARM64/ARMv7                                      │
│  └── 安装：curl -sfL k3sup.sh | sh                            │
│                                                                  │
│  标准 Kubernetes                                              │
│  ├── etcd + API Server + Controller + Scheduler + 多组件       │
│  ├── 内存需求：至少 2GB（Master）                            │
│  ├── 需要额外的 CNI、存储、Ingress 配置                        │
│  └── 安装：kubeadm / kops / eksctl 等                         │
└─────────────────────────────────────────────────────────────────┘
```

| 维度 | K3s | 标准 K8s |
|------|-----|--------|
| 二进制大小 | < 100MB | > 200MB |
| 内存需求 | 512MB+ | 2GB+ |
| 安装时间 | < 5 分钟 | 30 分钟+ |
| 存储后端 | SQLite / etcd | etcd |
| ARM 支持 | 优秀 | 一般 |
| 适用场景 | 边缘、IoT、开发测试 | 生产环境 |
| API 兼容性 | 100% | 基准 |
| 高可用 | K3s HA 模式 | 原生支持 |
| 离线安装 | 优秀 | 需要配置 |

## 安装部署

### 单节点安装

```bash
# 方式一：官方安装脚本（推荐开发环境）
curl -sfL https://get.k3s.io | sh -

# 方式二：指定版本
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=v1.28.0-rc1+k3s1 sh -

# 方式三：手动安装二进制
wget https://github.com/k3s-io/k3s/releases/latest/download/k3s
chmod +x k3s
sudo mv k3s /usr/local/bin/

# 启动 K3s
sudo k3s server &
# 或使用 systemd
sudo systemctl enable k3s
sudo systemctl start k3s

# 获取 kubeconfig
cat /etc/rancher/k3s/k3s.yaml

# 验证
kubectl get nodes
kubectl get pods -A
```

### 高可用安装（K3s HA）

```bash
# 1. 准备数据库（内嵌 SQLite 不支持 HA，需要外部数据库）
# 使用嵌入式 etcd（3 个 Server 节点）

# 2. 在第一个 Server 节点安装
curl -sfL https://get.k3s.io | sh -s - server \
  --cluster-init \
  --token=<CLUSTER_TOKEN>

# 3. 在其他 Server 节点安装
curl -sfL https://get.k3s.io | sh -s - server \
  --server https://<first-server-ip>:6443 \
  --token=<CLUSTER_TOKEN>

# 4. 添加 Agent 节点
curl -sfL https://get.k3s.io | K3S_URL=https://<server-ip>:6443 \
  K3S_TOKEN=<CLUSTER_TOKEN> sh -
```

### Kubeconfig 配置

```bash
# 在外部机器访问 K3s
scp user@k3s-server:/etc/rancher/k3s/k3s.yaml ~/.kube/config
# 修改 server 地址为 K3s 服务器 IP
sed -i '' 's/127.0.0.1/<k3s-server-ip>/g' ~/.kube/config

# 使用 kubectl
kubectl get nodes
```

## K3s 配置与调优

### 配置文件

```bash
# /etc/rancher/k3s/k3sserver # 或 k3s-agent
# K3s 配置文件（YAML 或flags）
# /etc/rancher/k3s/config.yaml
```

```yaml
# /etc/rancher/k3s/config.yaml
# Server 配置
# kube-apiserver 配置
kube-apiserver-arg:
  - "max-requests-inflight=500"
  - "endpoint-reconciler-type=lease"

# kubelet 配置
kubelet-arg:
  - "max-pods=100"
  - "eviction-hard=memory.available<100Mi"
  - "image-gc-high-threshold=80"
  - "image-gc-low-threshold=60"

# containerd 配置
snapshotter: overlayfs
registry: |
  mirrors:
    "docker.io":
      endpoint:
        - "https://registry.example.com"
```

### 内置组件

K3s 默认包含以下组件，无需额外安装：

```bash
# Container runtime: containerd + ctr
kubectl exec -it nginx -- ctr -n k8s.io images ls

# CoreDNS（服务发现）
kubectl get pods -n kube-system -l k8s-app=kube-dns

# Klipper-LB（负载均衡器，替代 MetalLB）
# 内置于 K3s，通过 type=LoadBalancer 的 Service 自动暴露

# Traefik（Ingress Controller）
kubectl get pods -n kube-system -l app.kubernetes.io/name=traefik

# ServiceLB（内嵌负载均衡）
kubectl get pods -n kube-system -l app=svc负载均衡

# metrics-server（HPA 依赖）
kubectl get pods -n kube-system -l k8s-app=metrics-server
```

## ARM 与边缘计算

```bash
# 在树莓派上安装 K3s
# 1. 安装 Raspbian/Raspberry Pi OS
# 2. 安装 K3s（ARM 版本）
curl -sfL https://get.k3s.io | sh -

# 多节点 ARM 集群（边缘部署）
# Server 节点（-master）
curl -sfL https://get.k3s.io | sh -s - server \
  --cluster-init \
  --token=my-secret-token

# Agent 节点
curl -sfL https://get.k3s.io | K3S_URL=https://master:6443 \
  K3S_TOKEN=my-secret-token sh -

# Air-Gap 离线安装
# 1. 下载 K3s 二进制和镜像包
wget https://github.com/k3s-io/k3s/releases/download/v1.28.0+k3s1/k3s
wget https://github.com/k3s-io/k3s/releases/download/v1.28.0+k3s1/k3s-airgap-images-amd64.tar.gz

# 2. 将镜像包放到 /var/lib/rancher/k3s/agent/images/
sudo mkdir -p /var/lib/rancher/k3s/agent/images/
sudo cp k3s-airgap-images-*.tar.gz /var/lib/rancher/k3s/agent/images/

# 3. 安装 K3s（二进制模式，不需要网络）
sudo cp k3s /usr/local/bin/
sudo chmod +x /usr/local/bin/k3s
sudo k3s server &
```

## K3s 数据存储

```bash
# 默认使用嵌入式 SQLite
ls /var/lib/rancher/k3s/server/db/
# kns.db (SQLite 数据库)

# 切换到外部 etcd
# /etc/rancher/k3s/k3sserver
K3S_DATASTORE_ENDPOINT="mysql://user:password@tcp(host:3306)/k3s"

# 切换到外部 PostgreSQL
K3S_DATASTORE_ENDPOINT="postgres://user:password@host:5432/k3s?sslmode=require"

# 备份 SQLite
sudo cp /var/lib/rancher/k3s/server/db/kns.db /path/to/backup/
```

## 与标准 K8s 的差异

| 功能 | K3s | 标准 K8s |
|------|------|---------|
| API Server | ✓ | ✓ |
| etcd/SQLite | ✓ | etcd |
| kubelet | ✓ | ✓ |
| kube-proxy | ✓ | ✓ |
| CNI (Flannel) | ✓ | 需安装 |
| Ingress (Traefik) | ✓ | 需安装 |
| LoadBalancer (Klippper) | ✓ | 需 MetalLB |
| Storage (Local Path) | ✓ | 需安装 |
| metrics-server | ✓ | 需安装 |
| 自动垃圾回收 | ✓ | 需手动 |
| Helm | ✓ (内置) | 需安装 |

## 常见问题

### 资源不足

```bash
# 调整 kubelet 资源
# /etc/rancher/k3s/kubelet.config
# 或命令行
k3s server --kubelet-arg="memory.available=100Mi"
```

### 镜像拉取慢

```bash
# 配置私有镜像仓库
# /etc/rancher/k3s/registries.yaml
mirrors:
  "docker.io":
    endpoint:
      - "https://registry.example.com"
  "registry.k8s.io":
    endpoint:
      - "https://k8s.m.daocloud.io"
```

### 日志管理

```bash
# K3s 日志
sudo journalctl -u k3s -f

# 容器日志
sudo ctr -n k8s.io containers ls
sudo ctr -n k8s.io tasks ls
sudo ctr -n k8s.io tasks logs <container-id>
```

## 面试追问方向

1. **K3s 和 K8s 的本质区别是什么？**
   答：K3s 是 K8s 的一个发行版，不是分支或修改版。区别在于 K3s 将所有组件打包成一个二进制，使用 SQLite 作为默认存储（可选 etcd），默认集成 CNI、Ingress、LoadBalancer 等组件，适合资源受限的环境。API 完全兼容 K8s。

2. **K3s 适合在生产环境使用吗？**
   答：适合边缘计算、IoT、开发测试、CI/CD 等场景。对于大规模生产环境，标准 K8s 仍是首选。K3s 支持 HA 模式（嵌入式 etcd），但对于需要多集群管理的企业场景，Rancher 或 Kubesphere 是更好的选择。

3. **K3s 的 Klipper LoadBalancer 原理是什么？**
   答：Klipper 是 K3s 内置的负载均衡器，它在每个节点上运行一个 Pod，通过 iptables 规则将外部流量路由到 Service 的后端 Pod。对于 Cloud 环境，它直接调用云厂商 API 创建 LB；对于裸机/VM 环境，它使用 NodePort + iptables 实现。

4. **K3s 的 SQLite 存储有什么限制？**
   答：SQLite 是单文件数据库，不支持并发写入，因此 K3s 默认不支持多 Server 节点（HA）。需要 HA 时，必须切换到嵌入式 etcd 或外部数据库。SQLite 不支持 K8s 的 etcd snapshot API（备份方式不同）。

K3s 让 Kubernetes 走进了边缘、走进了开发笔记本、走进了树莓派。它的出现证明了 K8s 不一定要「大而全」，也可以「小而美」。
