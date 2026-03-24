# KubeSphere 安装部署：All-in-One 与多节点模式

「KubeSphere 怎么装？」——两种模式，看你是什么场景。

KubeSphere 的安装非常友好，官方提供了两种主要安装方式：**All-in-One**（单节点体验）和**多节点生产部署**。从下载到跑起来，30 分钟足够。

## 前提条件

### All-in-One 模式

```
最低配置：
- CPU：2 核
- 内存：4 GB
- 磁盘：40 GB
- 系统：Ubuntu 16.04 / 18.04 / 20.04，CentOS 7.x / 8.x
- 内核：4.x +

推荐配置（生产体验）：
- CPU：4 核
- 内存：8 GB
- 磁盘：100 GB SSD
```

### 多节点模式

```
所有节点：
- CPU：4 核+
- 内存：8 GB+
- 磁盘：100 GB SSD+
- 系统：Ubuntu 16.04 / 18.04 / 20.04，CentOS 7.x / 8.x

网络：
- 节点之间网络互通
- 可访问外网（下载镜像）或准备离线镜像

存储：
- 每个节点有可用的存储类（StorageClass）
- 推荐：LocalPV、NFS、 ceph CSI 等
```

## 方式一：All-in-One 部署

适合场景：体验 KubeSphere 功能、个人学习、小规模开发环境。

### 前置条件

```bash
# 1. 确保 Docker 已安装
docker --version

# 2. 确保 kubectl 已安装
kubectl version --client

# 3. 确保 Helm 已安装（可选，用于安装存储类）
helm version

# 4. 确认网络通畅
ping api.kubesphere.io
```

### 一键部署

```bash
# 推荐：使用 KubeKey 安装（最新方式）
# 方式 A：在线安装（需要访问 GitHub）
export KKZONE=cn
curl -sfL https://get-kk.kubesphere.io | sh -

# 方式 B：指定版本安装
export KKZONE=cn
curl -sfL https://get-kk.kubesphere.io | sh -s v4.1.0

# 创建包含 KubeSphere 的集群配置
./kk create config --with-kubesphere v4.1.0

# 编辑配置文件
vim config.yaml

# 一键部署
./kk create cluster -f config.yaml

# 等待安装完成（约 20-30 分钟）
kubectl logs -n kubesphere-system $(kubectl get pod -n kubesphere-system -l 'app=ks-install' -o jsonpath='{.items[0].metadata.name}') -f
```

### config.yaml 配置示例

```yaml
# config.yaml
spec:
  hosts:
    # 单节点配置
    - {name: master, address: 192.168.1.10, internalAddress: 192.168.1.10, user: root, password: "your-password"}
  roleGroups:
    etcd:
      - master
    control-plane:
      - master
    worker:
      - master
  kubernetes:
    version: v1.28.0
    masquerade: true
  network:
    plugin: calico
    kubePodsCIDR: 10.233.64.0/18
    kubeServiceCIDR: 10.233.0.0/18
  storage:
    localVolume:
      master:
        - path: /var/local/storage
  addons:
    - name: kubesphere
      version: v4.1.0
      sources:
        chart: https://charts.kubesphere.io/main
      namespace: kubesphere-system
      interval: 10s
      values: |
        monitoring:
          prometheusReplicas: 1
        openldap:
          enabled: true
        etcd:
          monitoring: true
          endpointIps: 192.168.1.10
          port: 2379
        common:
          storageClass:
            storageClassName: local-volume
        alert:
          enabled: true
```

## 方式二：多节点集群部署

适合场景：生产环境、需要高可用、需要多租户隔离。

### 步骤 1：准备节点

```bash
# 在所有节点上执行
# 1. 设置主机名
hostnamectl set-hostname k8s-master-01

# 2. 设置 /etc/hosts（所有节点）
cat >> /etc/hosts << EOF
192.168.1.10  k8s-master-01
192.168.1.11  k8s-master-02
192.168.1.12  k8s-master-03
192.168.1.20  k8s-node-01
192.168.1.21  k8s-node-02
EOF

# 3. 关闭防火墙
systemctl stop firewalld
systemctl disable firewalld

# 4. 关闭 Swap
swapoff -a
sed -i '/ swap / s/^\(.*\)$/#\1/' /etc/fstab

# 5. 配置内核参数
cat > /etc/sysctl.d/k8s.conf << EOF
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sysctl --system

# 6. 安装 Docker（所有节点）
curl -fsSL https://get.docker.com | sh -
systemctl enable docker
systemctl start docker
```

### 步骤 2：配置文件

```yaml
# config-multi-node.yaml
spec:
  hosts:
    # Master 节点（3 台，用于高可用 etcd）
    - {name: master-01, address: 192.168.1.10, internalAddress: 192.168.1.10, user: root, password: "pass"}
    - {name: master-02, address: 192.168.1.11, internalAddress: 192.168.1.11, user: root, password: "pass"}
    - {name: master-03, address: 192.168.1.12, internalAddress: 192.168.1.12, user: root, password: "pass"}
    # Worker 节点
    - {name: node-01, address: 192.168.1.20, internalAddress: 192.168.1.20, user: root, password: "pass"}
    - {name: node-02, address: 192.168.1.21, internalAddress: 192.168.1.21, user: root, password: "pass"}

  roleGroups:
    etcd:
      - master-01
      - master-02
      - master-03
    control-plane:
      - master-01
      - master-02
      - master-03
    worker:
      - node-01
      - node-02

  kubernetes:
    version: v1.28.0
    loadBalancer:
      type: metallb
      addressPool:
        - 192.168.1.100-192.168.1.150

  network:
    plugin: calico
    kubePodsCIDR: 10.233.64.0/18
    kubeServiceCIDR: 10.233.0.0/18

  storage:
    nfsServer: 192.168.1.200
    nfsPath: /data/nfs

  addons:
    - name: kubesphere
      version: v4.1.0
      sources:
        chart: https://charts.kubesphere.io/main
      namespace: kubesphere-system
      values: |
        etcd:
          monitoring: true
          endpointIps: 192.168.1.10,192.168.1.11,192.168.1.12
          port: 2379
          tlsEnable: true
        common:
          storageClass:
            storageClassName: nfs-client
        monitoring:
          prometheusReplicas: 3
        alert:
          enabled: true
        devops:
          enabled: true
        logging:
          enabled: true
        serviceMesh:
          enabled: true
```

### 步骤 3：执行部署

```bash
# 创建集群
./kk create cluster -f config-multi-node.yaml

# 查看进度
kubectl get pods -n kubesphere-system

# 等待所有组件就绪
kubectl get pod -n kubesphere-system | grep -v Running

# 查看 KubeSphere 安装日志
kubectl logs -n kubesphere-system \
  $(kubectl get pod -n kubesphere-system -l 'app=ks-install' -o jsonpath='{.items[0].metadata.name}') -f
```

## 安装后的验证

### 检查 KubeSphere 组件状态

```bash
# 检查所有 KubeSphere 组件
kubectl get pod -n kubesphere-system
kubectl get pod -n kubesphere-monitoring-system
kubectl get pod -n kubesphere-logging-system
kubectl get pod -n kubesphere-devops-worker

# 检查各模块状态（通过 KubeSphere API）
kubectl get clusterconfiguration -n kubesphere-system
```

### 访问 KubeSphere 控制台

```bash
# All-in-One 访问
# 默认地址：http://IP:30880

# 多节点访问（通过 Ingress 或 NodePort）
# 访问：http://任意节点IP:30880

# 默认账号密码
# 用户名：admin
# 密码：P@88w0rd（首次登录需修改）

# 获取 admin token（通过 kubectl）
kubectl describe secret -n kubesphere-system \
  $(kubectl get secret -n kubesphere-system -l app=kubesphere -o jsonpath='{.items[0].metadata.name}') \
  | grep -E '^token' | awk '{print $2}'
```

### 启用可选模块

```bash
# KubeSphere 默认安装基础组件，可选模块需要手动启用
# 通过编辑 cluster-configuration 启用

kubectl edit clusterconfiguration -n kubesphere-system ks-installer

# 启用 DevOps
kubectl edit clusterconfiguration -n kubesphere-system ks-installer
# 将以下值改为 true
spec:
  devops:
    enabled: true
    jenkinsMemoryLim: 2Gi
    jenkinsMemoryReq: 1500Mi

# 启用服务网格
spec:
  servicemesh:
    enabled: true

# 启用日志
spec:
  logging:
    enabled: true
    elasticsearchVolumeSize: 20Gi

# 重新应用配置
kubectl apply -f - << EOF
apiVersion: installer.kubesphere.io/v1alpha1
kind: ClusterConfiguration
metadata:
  name: ks-installer
  namespace: kubesphere-system
  labels:
    version: v4.1.0
spec:
  devops:
    enabled: true
EOF
```

## 常见问题

```
问题一：安装卡在 "Waiting for kube-apiserver"
原因：节点之间网络不通 / Docker 未启动 / 端口被占用
解决：
  - 检查各节点防火墙是否关闭
  - 检查 API Server 端口（6443）是否通
  - 查看具体日志：kubectl logs -n kubesphere-system ks-apiserver-xxx

问题二：安装完成后监控组件 Pod 无法调度
原因：节点内存不足（Prometheus 默认需要较大内存）
解决：
  - 降低 Prometheus 副本数和资源限制
  - 增加节点内存
  - 使用 LocalPV 替代网络存储

问题三：无法登录控制台
原因：admin 密码错误 / Ingress 未就绪
解决：
  - 重置 admin 密码
  - 检查 Ingress Controller 是否运行
  - 检查 NodePort 30880 是否可达
```

## 面试追问方向

1. **KubeSphere 的安装组件是怎么选择的？**
   答：KubeSphere 使用 KubeKey（自研安装工具）进行安装，它在底层使用 kubeadm 部署 K8s，然后在 K8s 上以容器形式部署 KubeSphere 各组件。安装时通过 `cluster-configuration`（ClusterConfiguration CRD）控制启用哪些可选模块（DevOps、日志、监控、服务网格）。

2. **KubeSphere 的存储推荐用哪种？**
   答：生产环境推荐 NFS CSI、Ceph CSI 或云厂商的块存储。All-in-One 体验可以用 LocalPV（简单但不支持动态供给）。关键考量是 Elasticsearch（存储日志）需要稳定的读写性能，建议使用 SSD 存储。

3. **多节点部署时 etcd 如何保证高可用？**
   答：KubeKey 默认将 etcd 部署在 control-plane 节点上（奇数个，建议 3 个）。生产环境强烈建议使用外部 etcd 集群（独立于 K8s 节点），以获得更好的性能和故障隔离。外部 etcd 需要在 config.yaml 中额外配置。

> "KubeSphere 的安装体验，在所有 K8s 管理平台中是数一数二的友好。All-in-One 模式 30 分钟跑起来，多节点模式也有清晰的配置模板。最难的不是安装本身，而是安装前的网络和存储规划。"
