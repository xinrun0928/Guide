# K0s 与 MicroK8s

「除了 K3s，还有哪些轻量 K8s？」——K0s 和 MicroK8s 各有特色。

K0s（Mircus 公司）和 MicroK8s（Canonical/Ubuntu）都是 K8s 的轻量发行版，和 K3s 一起构成了「小而美」K8s 家族。它们各有设计哲学和使用场景。

## 三大轻量 K8s 对比

```
┌─────────────────────────────────────────────────────────────────┐
│              K3s vs K0s vs MicroK8s                            │
│                                                                  │
│  K3s (Rancher/SUSE)                                           │
│  ├── 单二进制 < 100MB                                           │
│  ├── 嵌入式 etcd / SQLite                                      │
│  ├── 默认 Traefik + Flannel                                    │
│  └── ARM 优化最好                                               │
│                                                                  │
│  K0s (K0sproject)                                            │
│  ├── 单二进制 < 200MB                                           │
│  ├── 可插拔架构（任意 CNI/存储）                                │
│  ├── 无固执默认，灵活度高                                       │
│  └── CNCF 认证                                                  │
│                                                                  │
│  MicroK8s (Canonical)                                         │
│  ├── Snap 安装                                                 │
│  ├── 高度封装，开箱即用                                         │
│  ├── 严格遵循 K8s upstream                                     │
│  └── Ubuntu 生态集成最佳                                        │
└─────────────────────────────────────────────────────────────────┘
```

| 维度 | K3s | K0s | MicroK8s |
|------|-----|------|--------|
| 二进制大小 | < 100MB | < 200MB | ~500MB |
| 最低内存 | 512MB | 1GB | 2GB |
| 默认存储 | SQLite | etcd | etcd-snap |
| 默认 CNI | Flannel | Konnectivity | Calico |
| 默认 Ingress | Traefik | 无（可插拔） | 无 |
| 许可证 | Apache 2.0 | Apache 2.0 | GPL/SSPL |
| HA 支持 | ✓ (embedded etcd) | ✓ | ✓ |
| ARM 支持 | 优秀 | 好 | 一般 |
| 安装方式 | 脚本 | 脚本/helm/ansible | snap |
| 离线安装 | 优秀 | 优秀 | 一般 |

## K0s

### 安装

```bash
# 方式一：官方安装脚本
curl -sfL https://get.k0s.sh | sudo sh

# 方式二：直接下载二进制
wget https://github.com/k0sproject/k0s/releases/latest/download/k0s
chmod +x k0s && sudo mv k0s /usr/local/bin/

# 初始化集群
sudo k0s install controller --single
sudo k0s start

# 获取 kubeconfig
sudo k0s kubeconfig admin > ~/.kube/config

# 验证
kubectl get nodes
```

### 高可用模式

```bash
# 创建 HA 配置
cat > k0s.yaml <<EOF
spec:
  api:
    sans:
      - "10.0.0.1"
      - "k8s-api.example.com"
  storage:
    type: kine
    kine:
      datasource: postgres://user:pass@host:5432/k0s?sslmode=require
  telemetry:
    enabled: false
EOF

# 启动多个 Controller
k0s start
```

### 可插拔架构

K0s 的核心理念：默认最小化，可按需扩展。

```bash
# 安装时指定组件
k0s install controller \
  --enable-worker \
  --k0sflags "--clustercidr=10.244.0.0/16"

# 使用不同的 CNI
# Calico
k0s install worker --labels="cni=calico" --cri=none

# Cilium
# 需要额外配置
```

## MicroK8s

### 安装

```bash
# Ubuntu/Debian
sudo snap install microk8s --classic

# macOS (需要 multipass)
brew install --cask multipass
multipass launch --name k8s --mem 4G --disk 40G
multipass exec k8s -- snap install microk8s --classic

# Windows (需要 multipass)
# 同 macOS

# 添加别名（避免和 kubectl 冲突）
sudo snap alias microk8s.kubectl kubectl
```

### MicroK8s 插件系统

```bash
# 查看可用插件
microk8s status

# 启用常用插件
microk8s enable dns
microk8s enable ingress
microk8s enable helm3
microk8s enable storage
microk8s enable prometheus
microk8s enable jaeger
microk8s enable metallb
microk8s enable gpu
microk8s enable registry

# 禁用插件
microk8s disable ingress

# 查看运行中的插件
microk8s status --format yaml | grep -A20 enabled

# Helm 3 集成
microk8s helm3 repo add stable https://charts.helm.sh/stable
microk8s helm3 install nginx stable/nginx-ingress

# 内置 registry（本地镜像仓库）
microk8s enable registry
docker tag myapp:latest localhost:32000/myapp:latest
docker push localhost:32000/myapp:latest
```

### 集群模式

```bash
# 添加节点到集群
# 在主节点
microk8s add-node

# 在工作节点执行输出中的命令
microk8s join <master-ip>:<port>/<token>

# 查看节点
microk8s kubectl get nodes
```

### dashboard

```bash
# 启用 Kubernetes Dashboard
microk8s enable dashboard

# 获取 Token
token=$(microk8s kubectl get token -n kube-system -o jsonpath='{.items[0].data.token}' | base64 -d)
echo $token

# 代理访问
microk8s kubectl proxy
# 访问 http://localhost:8001/api/v1/namespaces/kube-system/services/https:kubernetes-dashboard:/proxy/
```

## 快速对比总结

```
┌─────────────────────────────────────────────────────────────────┐
│                    选择指南                                       │
│                                                                  │
│  选 K3s 如果：                                                 │
│  ├── 资源极其受限（512MB RAM）                                  │
│  ├── 需要 ARM 边缘部署                                          │
│  ├── 团队熟悉 Rancher 生态                                     │
│  └── 追求极简安装体验                                          │
│                                                                  │
│  选 K0s 如果：                                                 │
│  ├── 需要灵活插拔组件（自定义 CNI/存储）                        │
│  ├── 追求「K8s upstream 原生体验」                             │
│  ├── 需要 CNCF 认证的轻量发行版                                │
│  └── 需要 Terraform/Puppet 等自动化管理                         │
│                                                                  │
│  选 MicroK8s 如果：                                           │
│  ├── 已在 Ubuntu 生态                                          │
│  ├── 需要丰富的插件生态（Dashboard/Registry/GPU 等开箱即用）   │
│  ├── 需要严格跟随 K8s upstream 版本                             │
│  └── 开发环境需要快速迭代                                      │
└──────────────────────────────────────────────────────────────── ┘
```

## 面试追问方向

1. **K0s 和 K3s 的架构区别是什么？**
   答：K3s 将所有组件编译进一个二进制，K0s 采用模块化设计（kine、containerd、CNI 均可替换）。K3s 默认集成更多（Traefik、Flannel），K0s 默认最小化（可插拔）。K0s 使用 kube-router 作为可选 CNI 时性能更好。

2. **MicroK8s 为什么用 Snap 安装？**
   答：Snap 是 Canonical 的包管理工具，MicroK8s 使用 Snap 是因为它能自动处理依赖和更新。但 Snap 有争议（启动慢、权限复杂），Canonical 也提供了 debs 和 tarball 安装方式。

3. **这三个发行版在生产环境中怎么选？**
   答：大规模生产用标准 K8s（EKS/GKE/AKS）；边缘/IoT 用 K3s；需要灵活定制用 K0s；Ubuntu 开发环境用 MicroK8s。对于生产边缘节点集群，K3s 的 ARM 优化和离线包支持最成熟。

轻量 K8s 的存在，让 Kubernetes 从「只有大公司才能玩得起」，变成了「每个人都能跑起来」。
