# KubeSphere 集群升级与版本管理

「KubeSphere 能不能热升级？」——能，但有完整的版本路径需要遵循。

KubeSphere 升级是生产环境运维中最重要的操作之一。升级涉及 K8s 版本、KubeSphere 版本和存储插件等多个组件的协同，必须按正确的顺序操作才能保证业务连续性。

## 升级原则

### 永远不要跨版本跳跃

KubeSphere 的版本兼容性策略是 **N-1**：只保证当前版本和上一个版本的兼容性。

| 当前版本 | 可直接升级到 |
|---------|------------|
| 3.3.x | 3.4.x |
| 3.4.x | 4.1.x |
| 4.1.x | 4.2.x / 4.3.x |
| 4.2.x | 4.3.x |
| 4.3.x | 4.4.x |

> 如果你的版本跨度超过一个大版本，必须**逐版本升级**，不能跳过。

### 升级顺序：先备份，再升级，最后验证

```
备份阶段
├── etcd 数据快照
├── KubeSphere 数据库备份
└── 所有持久化数据（PVC）

升级阶段
├── 升级 Kubernetes（如需）
├── 升级 KubeSphere 核心组件
└── 升级 KS-Addon（可选组件）

验证阶段
├── 控制台功能验证
├── 流水线验证
└── 业务 Pod 状态检查
```

## 升级前的准备工作

### 1. 检查当前版本

```bash
# 查看 KubeSphere 版本
kubectl logs -n kubesphere-system \
  $(kubectl get pods -n kubesphere-system -l app=ks-apiserver -o jsonpath='{.items[0].metadata.name}') \
  2>&1 | head -20

# 或通过控制台 → 平台管理 → 系统状态查看

# 查看 Kubernetes 版本
kubectl version --short
kubectl get nodes
```

### 2. 备份 etcd 数据

```bash
# 备份 etcd（关键步骤！）
# 在所有 etcd 节点执行备份

ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot save /var/backups/etcd-snapshot-$(date +%Y%m%d).db

# 验证备份
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot status /var/backups/etcd-snapshot-$(date +%Y%m%d).db -w table

# 将备份文件拷贝到安全位置
scp /var/backups/etcd-snapshot-*.db user@backup-server:/path/to/backups/
```

### 3. 备份 KubeSphere 配置

```bash
# 备份 KubeSphere 命名空间的所有资源
kubectl get all -n kubesphere-system -o yaml > kubesphere-resources-backup.yaml

# 备份 KubeSphere 数据库（如果使用外部数据库）
# 以 PostgreSQL 为例
pg_dump -h <postgres-host> -U <user> -d <database> -F c -f ks-db-backup.dump

# 备份 KS-Addon CRD（如有多集群插件）
kubectl get crd -A -o yaml > kubesphere-crd-backup.yaml
```

### 4. 确认磁盘空间

```bash
# 检查 etcd 节点磁盘空间（至少 20% 可用）
df -h /var/lib/etcd

# 检查 /var/lib/docker 或 /var/lib/containerd 磁盘空间
df -h /var/lib
```

## 使用 KubeKey 升级

KubeKey 是 KubeSphere 官方推荐的集群管理工具，也是安装和升级的官方方式。

### 升级 KubeSphere 组件

```bash
# 1. 下载最新版 KubeKey
curl -sfL https://get-kk.kubesphere.io | VERSION=v3.1.1 sh -

# 2. 导出集群信息
export KKZONE=cn  # 如果使用极狐GitLab等国内源
./kk upgrade --with-kubesphere v4.1.0

# 3. 如果只升级 KubeSphere 版本
./kk upgrade --with-kubesphere v4.3.0 -f config-sample.yaml

# 4. 升级完成后验证
kubectl get pods -n kubesphere-system
kubectl get pods -n kubesphere-controls-system
```

### 升级 Kubernetes

```bash
# 查看支持的 K8s 版本
./kk version --show-supported-k8s

# 升级 Kubernetes（同时保持 KubeSphere 版本）
./kk upgrade --with-kubernetes v1.26.0 -f config-sample.yaml

# 升级后检查节点状态
kubectl get nodes
kubectl get pods -n kube-system
```

### 滚动升级 Worker 节点

```bash
# 在不中断业务的前提下，逐节点升级

# 1. 驱逐待升级节点的 Pod
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data --force

# 2. 在该节点上执行升级
./kk upgrade --with-kubernetes v1.26.0 -f config-sample.yaml

# 3. 解除节点封锁
kubectl uncordon <node-name>

# 4. 验证 Pod 恢复
kubectl get pods -A | grep <node-name>

# 5. 重复以上步骤，直到所有节点升级完成
```

## 不同部署方式的升级

### All-in-One 模式升级

```bash
# 适用于开发测试环境，最简单的方式

# 1. 备份（如上）

# 2. 升级
./kk upgrade --with-kubesphere v4.3.0

# 3. 验证
kubectl get pods -n kubesphere-system
# 访问 http://<node-ip>:30880 验证控制台
```

### 多节点集群升级

```bash
# 适用于生产环境，需要分阶段操作

# 1. 先升级 Control Plane 节点
# 在第一个 Master 节点执行
./kk upgrade --with-kubesphere v4.3.0 -f config-sample.yaml

# 2. 验证 Control Plane 健康
kubectl get componentstatuses    # CSRs 是否正常
kubectl get nodes -w            # 观察节点状态

# 3. 再升级 Worker 节点（逐个）
kubectl drain <worker-node> --ignore-daemonsets
./kk upgrade --with-kubernetes v1.26.0 -f config-sample.yaml
kubectl uncordon <worker-node>

# 4. 全部完成后验证
kubectl get nodes
kubectl top nodes
```

### HA 集群升级

```bash
# 高可用模式：3 个 Master + N 个 Worker

# 1. 升级第一个 Master（不执行最后的组件升级）
./kk upgrade --with-kubesphere v4.3.0 -f config-sample.yaml

# 2. 逐个升级其他 Master 节点
for node in master-2 master-3; do
  ssh $node "kubectl drain $node --ignore-daemonsets"
  ./kk upgrade --with-kubesphere v4.3.0 -f config-sample.yaml
  ssh $node "kubectl uncordon $node"
done

# 3. 最后升级所有 Worker 节点
```

## 升级后的验证

### 组件健康检查

```bash
# 1. 检查 KubeSphere 核心组件
kubectl get pods -n kubesphere-system
kubectl get pods -n kubesphere-controls-system

# 2. 检查关键组件状态
# ks-apiserver, ks-console, sentinel, redis
for pod in $(kubectl get pods -n kubesphere-system -o jsonpath='{.items[*].metadata.name}'); do
  status=$(kubectl get pod $pod -n kubesphere-system -o jsonpath='{.status.phase}')
  echo "$pod: $status"
done

# 3. 检查 API 连通性
curl -k https://localhost:6443/api/v1/namespaces/kubesphere-system/pods 2>/dev/null | head -100
```

### 功能验证

```
控制台验证清单：
✅ 登录页面可访问
✅ 平台管理 → 账户管理 → 用户列表显示正常
✅ 企业空间 → 项目列表显示正常
✅ DevOps → 流水线列表显示正常
✅ 应用管理 → 应用商店显示正常
✅ 监控告警 → 仪表盘显示正常
✅ 日志系统 → 日志查询可用
```

### 业务 Pod 状态

```bash
# 检查所有命名空间的 Pod 状态
kubectl get pods -A | grep -v Running | grep -v Completed

# 检查是否有 Pod 重启次数异常
kubectl get pods -A -o wide | awk '{if ($4 > 0) print}'

# 检查 PVC 挂载状态
kubectl get pvc -A
kubectl get pv | grep -v Bound
```

## 回滚方案

如果升级后出现问题，可以回滚：

```bash
# 方案一：回滚到升级前的 etcd 快照
# 1. 停止所有 KubeSphere 组件
# 2. 在每个 etcd 节点恢复快照
systemctl stop etcd
mv /var/lib/etcd/member /var/lib/etcd/member.bak
ETCDCTL_API=3 etcdctl snapshot restore /var/backups/etcd-snapshot-YYYYMMDD.db \
  --name etcd-1 \
  --initial-cluster etcd-1=https://192.168.1.10:2380,etcd-2=https://192.168.1.11:2380,etcd-3=https://192.168.1.12:2380 \
  --initial-cluster-token etcd-cluster \
  --initial-advertise-peer-urls https://192.168.1.10:2380
systemctl start etcd
# 3. 恢复后降级 KubeSphere（通过修改 config.yaml）

# 方案二：使用 Velero 备份恢复（如果升级前配置了 Velero）
velero restore create --from-backup <backup-name>
```

## 常见问题

### 问题一：升级后控制台无法访问

```bash
# 检查 ks-console 和 ks-apiserver 状态
kubectl get pods -n kubesphere-system -l app=ks-console
kubectl describe pod -n kubesphere-system -l app=ks-console

# 检查 NodePort 端口
ss -tlnp | grep 30880

# 检查 Ingress
kubectl get ingress -n kubesphere-system
```

### 问题二：流水线（Jenkins）升级后无法工作

```bash
# Jenkins 数据通常存储在 PVC 中
# 检查 Jenkins 状态
kubectl get pods -n kubesphere-devops-system

# 如果 Jenkins 配置丢失，可能是因为：
# 1. PVC 没有正确挂载
kubectl describe pvc -n kubesphere-devops-system

# 2. Jenkins 插件兼容性问题
# 重新安装兼容版本的插件
```

### 问题三：etcd 升级失败

```bash
# etcd 升级是最危险的步骤
# 如果 etcd 升级后集群不可用：
# 1. 立即停止升级
# 2. 使用 etcd 快照恢复
# 3. 检查 etcd 日志
journalctl -u etcd -n 50
```

## 升级检查清单

| 步骤 | 检查项 | 命令 |
|------|--------|------|
| 备份 | etcd 快照已创建 | `etcdctl snapshot status` |
| 备份 | KubeSphere 资源已导出 | `kubectl get all -n kubesphere-system -o yaml` |
| 备份 | PVC 数据已检查 | `kubectl get pvc -A` |
| 备份 | 备份文件已拷贝到安全位置 | `scp` |
| 升级前 | 所有节点磁盘空间充足 | `df -h` |
| 升级前 | 确认当前版本 | `kubectl version` |
| 升级后 | 核心组件运行正常 | `kubectl get pods -n kubesphere-system` |
| 升级后 | 控制台可访问 | Web UI 登录 |
| 升级后 | 业务 Pod 正常运行 | `kubectl get pods -A` |

> "KubeSphere 升级的本质是 Kubernetes 升级 + 平台组件升级。K8s 升级决定集群能力上限，平台组件升级决定功能体验。两者配合好，业务零中断；两者搞砸了，集群重建。"
