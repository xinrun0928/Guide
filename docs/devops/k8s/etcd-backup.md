# etcd 备份与恢复

「etcd 挂了意味着什么？」——意味着整个 K8s 集群的状态全部丢失。

Deployment、Service、ConfigMap、Secret、PV、RBAC 规则……所有这些资源的状态都存储在 etcd 中。如果 etcd 数据损坏且没有备份，恢复成本可能是几天的重做。备份 etcd 不是可选项，是生产运营的基本责任。

## etcd 的数据模型

### 存储了什么

etcd 是一个分布式键值存储，K8s 将所有资源数据序列化后存储其中：

```
/registry/deployments/default/nginx           → Deployment YAML
/registry/pods/default/api-xxx               → Pod 对象
/registry/services/specs/default/api-svc      → Service 对象
/registry/configmaps/default/app-config       → ConfigMap 对象
/registry/secrets/default/db-creds           → Secret 对象（加密后）
/registry/persistentvolumes/pv-xxx            → PV 对象
/registry/namespaces/production               → Namespace 对象
```

### 键值示例

```bash
# 查看所有 keys（通过 etcdctl）
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  get /registry --prefix | head -100
```

## 备份

### 方式一：etcdctl snapshot save

这是最常用的备份方式，对运行中的集群无影响：

```bash
# 创建快照
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot save /var/backups/etcd-snapshot-$(date +%Y%m%d-%H%M%S).db

# 验证快照状态
ETCDCTL_API=3 etcdctl --write-out=table snapshot status /var/backups/etcd-snapshot.db
```

### 方式二：etcd 目录直接备份（离线备份）

```bash
# 停止 kube-apiserver（避免写入）
mv /var/lib/etcd /var/lib/etcd-backup-$(date +%Y%m%d)
# 直接复制目录
cp -r /var/lib/etcd /var/backups/etcd-dir-$(date +%Y%m%d)
```

### 方式三：自动化备份脚本

```bash
#!/bin/bash
# /usr/local/bin/etcd-backup.sh
# cron: 0 */1 * * * /usr/local/bin/etcd-backup.sh

BACKUP_DIR="/var/backups/etcd"
S3_BUCKET="s3://my-cluster/etcd-backups"
RETENTION_DAYS=7

DATE=$(date +%Y%m%d-%H%M%S)
SNAPSHOT_FILE="${BACKUP_DIR}/etcd-snapshot-${DATE}.db"

# 创建快照
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot save "${SNAPSHOT_FILE}"

# 上传到 S3
aws s3 cp "${SNAPSHOT_FILE}" "${S3_BUCKET}/"
aws s3 cp "${SNAPSHOT_FILE}" "${S3_BUCKET}/latest.db"

# 清理过期备份
find "${BACKUP_DIR}" -name "*.db" -mtime +${RETENTION_DAYS} -delete
echo "[$(date)] Backup completed: ${SNAPSHOT_FILE}"
```

## 恢复

### 场景一：单节点 etcd 数据损坏（推荐方式）

```bash
# 1. 停止 etcd 和 apiserver
systemctl stop kube-apiserver
systemctl stop etcd

# 2. 恢复快照
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot restore /var/backups/etcd-snapshot.db \
  --name=etcd-node-1 \
  --initial-cluster="etcd-node-1=https://etcd-node-1:2380" \
  --initial-cluster-token=etcd-cluster \
  --initial-advertise-peer-urls=https://etcd-node-1:2380 \
  --data-dir=/var/lib/etcd

# 3. 修复目录权限
chown -R etcd:etcd /var/lib/etcd

# 4. 启动 etcd 和 apiserver
systemctl start etcd
systemctl start kube-apiserver

# 5. 验证恢复
kubectl get nodes
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 endpoint health
```

### 场景二：etcd 集群多个节点故障

对于 3 节点 etcd 集群，如果 1 个节点故障，剩余 2 个节点可以继续工作，无需干预。如果 2 个或更多节点故障，需要从快照重建整个集群：

```bash
# 1. 在所有 etcd 节点上停止 etcd
systemctl stop etcd

# 2. 在每个节点上恢复快照（各自恢复）
ETCDCTL_API=3 etcdctl snapshot restore /var/backups/etcd-snapshot.db \
  --name=etcd-node-1 \
  --initial-cluster="etcd-node-1=https://etcd-node-1:2380,etcd-node-2=https://etcd-node-2:2380,etcd-node-3=https://etcd-node-3:2380" \
  --initial-cluster-token=etcd-cluster \
  --initial-advertise-peer-urls=https://etcd-node-1:2380 \
  --data-dir=/var/lib/etcd

# 对 node-2 和 node-3 同样执行（调整 --name 和 --initial-advertise-peer-urls）

# 3. 重启所有 etcd 节点
systemctl start etcd

# 4. 验证集群状态
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379,https://127.0.0.2:2379,https://127.0.0.3:2379 endpoint health
```

## 备份策略设计

### 频率

| 场景 | 备份频率 | 保留时间 | 存储位置 |
|------|---------|---------|---------|
| 生产集群 | 每小时 1 次 | 7-30 天 | 对象存储（S3） |
| 重要变更前 | 手动触发 | 长期 | 多地备份 |
| 演练恢复 | 每季度 | 测试环境 | 本地 |

### 重要变更前必须备份

```bash
# 大规模变更前的备份
kubectl exec -it etcd-node-0 -n kube-system -- \
  etcdctl snapshot save /var/backups/pre-change-$(date +%Y%m%d).db

# 或者通过 API Server 的代理端点（如果有权限）
kubectl get --raw=/apis/apps/v1/namespaces/production/deployments
```

### 备份验证

备份如果从未验证，恢复时发现损坏就晚了。建议每月做一次恢复演练（在测试环境）：

```bash
# 1. 搭建一个单节点 etcd 测试环境
# 2. 从 S3 下载最新备份
# 3. 在测试环境恢复
# 4. 验证核心资源是否存在
kubectl --kubeconfig=test-kubeconfig get deployments -A
kubectl --kubeconfig=test-kubeconfig get services -A
```

## 常见问题

### 快照恢复后 API Server 报错 "cluster is unavailable"

检查 etcd 是否正常启动，日志：

```bash
journalctl -u etcd -n 100 --no-pager
```

### etcd 数据目录不一致

```bash
# defrag 清理磁盘空间（etcd 不会自动回收空间）
ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  defrag
```

## 面试追问方向

- etcd 的 Raft 协议在网络分区时会发生什么？3 节点集群能容忍多少节点故障？
- 为什么 etcd 快照文件比实际数据目录小很多？
- etcd 的 WAL（Write-Ahead Log）和 DB 文件各有什么作用？备份时应该怎么处理？
- 如果发现 etcd 的磁盘空间快满了，除了扩容还有什么方法？

> etcd 备份是 K8s 运维的生命线。「没有测试过的备份等于没有备份」——这句话在 etcd 身上体现得淋漓尽致。
