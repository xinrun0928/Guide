# 集群升级：滚动升级与版本兼容性

「K8s 集群能不能热升级？」——能，但有讲究。

K8s 升级是生产环境运维中最需要谨慎对待的操作之一。升级顺序、版本兼容性、回滚策略，每一个环节都可能影响业务连续性。这一篇讲解 K8s 升级的正确姿势和避坑指南。

## 升级原则

### 永远不要跳过两个大版本

K8s 的版本兼容性策略是 **N-2**：只保证当前版本和最近两个次版本的兼容性。

- 当前运行 1.23 → 可以升级到 1.24 或 1.25
- 如果在 1.21，直接升级到 1.24 → **风险极大**，不推荐

### 升级顺序：先 Control Plane，后 Worker

```
升级顺序：
1. etcd（Control Plane 节点）
2. kube-apiserver（Control Plane 节点）
3. kube-controller-manager、kube-scheduler、kube-proxy（Control Plane 节点）
4. kube-proxy、kubelet（Worker 节点）
5. CNI 插件
6. 其他集群组件
```

**核心原则**：Control Plane 组件永远领先 Worker 组件一个版本，或者最多持平。

## 升级前的准备工作

### 1. 确认当前版本

```bash
kubectl version --short
kubectl get nodes
# VERSION 列显示 kubelet 版本
```

### 2. 检查 API 废弃

```bash
# 查看即将废弃的 API
kubectl api-resources -o wide | grep deprecated

# 确认是否有使用废弃 API 的资源
kubectl get all -A -o json | jq '.items[] | select(.apiVersion | contains("deprecated")) | .metadata.name'
```

### 3. 备份 etcd

```bash
# 升级前必须备份
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot save /var/backups/etcd-pre-upgrade-$(date +%Y%m%d).db
```

### 4. 检查节点资源

升级过程中新旧组件会同时运行，需要额外资源：

```bash
kubectl top nodes
# 确保每个节点有至少 30% 的空闲 CPU 和内存
```

### 5. 通知相关团队

- 升级期间 API Server 可能短暂不可用（通常 < 1 分钟）
- kubelet 重启期间 Pod 会显示 NotReady
- 确认业务有重试机制

## 升级步骤（kubeadm 为例）

### Control Plane 节点升级

```bash
# 1. 升级 kubeadm（所有 Control Plane 节点）
apt-get update && apt-get install -y kubeadm=1.28.0-*
kubeadm version

# 2. 在第一个 Control Plane 节点执行升级计划
sudo kubeadm upgrade plan v1.28.0
# 查看需要升级的组件和版本

# 3. 执行升级（第一个节点）
sudo kubeadm upgrade apply v1.28.0

# 4. 升级其他 Control Plane 节点
sudo kubeadm upgrade node experimental-control-plane

# 5. 升级 kubelet 和 kubectl（所有 Control Plane 节点）
apt-get update && apt-get install -y kubelet=1.28.0-* kubectl=1.28.0-*
sudo systemctl daemon-reload
sudo systemctl restart kubelet

# 6. 验证
kubectl get nodes
# 第一个节点变为 Ready (v1.28.0)
```

### Worker 节点升级

```bash
# 7. 升级 kubeadm（Worker 节点）
apt-get update && apt-get install -y kubeadm=1.28.0-*

# 8. 驱逐 Worker 节点上的 Pod（业务低峰期操作）
kubectl drain node-2 --ignore-daemonsets --delete-emptydir-data --force

# 9. 升级 kubelet 配置
kubeadm upgrade node

# 10. 升级 kubelet 和 kubectl
apt-get install -y kubelet=1.28.0-* kubectl=1.28.0-*
systemctl daemon-reload
systemctl restart kubelet

# 11. 恢复节点调度
kubectl uncordon node-2

# 12. 验证
kubectl get nodes
# node-2 变为 Ready (v1.28.0)
```

## 滚动升级策略

### 分批升级

不要一次性升级所有节点。建议按以下顺序：

```
第一批（1个节点）：测试升级流程，观察 2-4 小时
    │
    ▼
第二批（所有 Control Plane 剩余节点）
    │
    ▼
第三批（1个 Worker 节点）：测试驱逐和恢复
    │
    ▼
第四批（剩余 Worker 节点，3-5 个一批）
```

### 配置升级超时

```yaml
# kubeadm-config ConfigMap 中配置超时
apiVersion: v1
kind: ConfigMap
metadata:
  name: kubeadm-config
  namespace: kube-system
data:
  ClusterConfiguration: |
    upgrade:
      timeout: 10m
```

## 版本兼容性矩阵

```
组件兼容性（以升级到 1.28 为例）：

kubelet (1.27) → 可以连接 → kube-apiserver (1.28) ✓
kubelet (1.26) → 可以连接 → kube-apiserver (1.28) ✓
kubelet (1.28) → 可以连接 → kube-apiserver (1.27) ✓

kubectl (1.26) → 可以操作 → kube-apiserver (1.28) ✓（受 API 废弃影响）
kubectl (1.28) → 可以操作 → kube-apiserver (1.27) ✓

但实际生产中建议版本差 ≤ 2
```

## 回滚

### 如果升级失败

```bash
# etcd 快照在，停止集群，从快照恢复
systemctl stop kube-apiserver
systemctl stop etcd

ETCDCTL_API=3 etcdctl snapshot restore /var/backups/etcd-pre-upgrade-20240101.db \
  --data-dir=/var/lib/etcd

systemctl start etcd
systemctl start kube-apiserver

# 验证集群状态
kubectl get nodes
kubectl get pods -A
```

### Pod 的回滚

Deployment 的镜像回滚不需要升级集群：

```bash
# 升级集群后，如果业务 Pod 有问题，直接回滚镜像
kubectl rollout undo deployment/myapp -n production
kubectl rollout undo deployment/myapp --to-revision=3 -n production
```

## 升级后的检查清单

```bash
# 1. 节点状态
kubectl get nodes -o wide
kubectl top nodes

# 2. Pod 状态
kubectl get pods -A | grep -v Running
kubectl get pods -A --field-selector=status.phase!=Running

# 3. etcd 状态
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 endpoint health

# 4. API Server 可用性
kubectl get --raw=/healthz
kubectl get --raw=/healthz/etcd
kubectl get --raw=/healthz/apiserver

# 5. 核心组件日志
kubectl logs -n kube-system -l component=kube-apiserver --tail=100
kubectl logs -n kube-system -l component=kube-controller-manager --tail=100
```

## 面试追问方向

- K8s 的版本兼容性策略是什么？N-2 是什么意思？
- 为什么 Control Plane 必须先于 Worker 升级？反过来可以吗？
- kubeadm upgrade plan 输出的是什么？它根据什么判断需要升级哪些组件？
- 升级期间 API Server 和 etcd 的版本不匹配会发生什么？
- 如果升级后某个 Pod 一直无法 Running，怎么排查？

> K8s 升级是技术活，更是心理活——不慌不忙、按部就班、备份先行，是安全升级的三原则。
