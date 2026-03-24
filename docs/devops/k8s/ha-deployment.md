# Kubernetes 集群高可用部署方案

「Control Plane 挂了怎么办？」——这是每个生产 K8s 集群必须回答的问题。

Kubernetes 的高可用（HA）不是可选的，是生产级部署的必修课。Control Plane 任何一个组件（etcd、kube-apiserver、kube-controller-manager、kube-scheduler）单点故障，都会导致集群不可用。这一篇讲解 K8s HA 的架构设计、实现方式和注意事项。

## 高可用的核心原则

K8s HA 集群的核心是 **冗余 + 无状态化**：

1. **etcd**：数据存储，必须是奇数节点（推荐 3 或 5 个），使用 Raft 共识协议
2. **kube-apiserver**：无状态 API 服务器，可以水平扩展，节点数通常为 2n+1
3. **Controller Manager 和 Scheduler**：Leader Election 机制确保同一时间只有一个活跃实例

## HA 架构图

```
                    ┌─────────────────────────────────────────┐
                    │          负载均衡器（LB）                │
                    │     (云厂商 NLB / kube-vip / HAProxy)   │
                    └───────────────┬─────────────────────────┘
                                      │ VIP / DNS
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
              ┌───────────┐    ┌───────────┐    ┌───────────┐
              │ apiserver │    │ apiserver │    │ apiserver │
              │  node-1   │    │  node-2   │    │  node-3   │
              └─────┬─────┘    └─────┬─────┘    └─────┬─────┘
                    │                 │                 │
              ┌─────┴─────────────────┴─────────────────┴─────┐
              │                   etcd 集群                    │
              │     (node-1, node-2, node-3 共同组成)         │
              │           Raft 共识，3 节点容忍 1 节点故障    │
              └─────────────────────────────────────────────┘
```

## etcd 的高可用

### 为什么 etcd 必须是奇数节点？

奇数节点的 etcd 可以用更少的节点数容忍更多的故障：

| 节点数 | 容忍故障节点数 | 所需资源 |
|-------|--------------|---------|
| 1 | 0 | 最低 |
| 2 | 0（无多数派） | ✗ 不推荐 |
| 3 | 1 | 推荐 |
| 4 | 1 | 浪费 |
| 5 | 2 | 推荐 |
| 7 | 3 | 大规模集群 |

3 节点 etcd 集群：任何 1 个节点故障，其余 2 个节点仍构成多数派（> 50%），集群继续运行。
4 节点 etcd 集群：任何 1 个节点故障，剩余 3 个构成多数派——和 3 节点完全一样的容错能力，但多用了 1 个节点。

### etcd 数据备份

```bash
# 定时任务：每小时备份一次
0 */1 * * * kubectl exec -n kube-system etcd-node-0 -- etcdctl \
  --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key \
  snapshot save /var/backups/etcd-snapshot-$(date +%Y%m%d-%H%M%S).db

# 将快照上传到对象存储（S3/MinIO）
# ... 备份脚本 ...

# 恢复 etcd
kubectl exec -it etcd-node-0 -- bash
etcdctl snapshot restore /var/backups/etcd-snapshot.db \
  --name=etcd-node-0 \
  --initial-cluster="etcd-node-0=https://etcd-node-0:2380,etcd-node-1=https://etcd-node-1:2380,etcd-node-2=https://etcd-node-2:2380" \
  --data-dir=/var/lib/etcd
```

### etcd 性能监控

```bash
# 监控 etcd 写入延迟（生产环境应 < 10ms）
etcdctl endpoint health
etcdctl endpoint status

# Prometheus 指标（需要开启 --metrics）
curl http://localhost:2379/metrics | grep etcd_server_has_leader
```

## kube-apiserver 的高可用

### 无状态设计

apiserver 是无状态的，所有状态存储在 etcd 中。这意味着可以水平扩展多个 apiserver 实例：

```bash
# 3 个 apiserver 实例
kubectl get pods -n kube-system -l component=kube-apiserver
```

所有 kubelet、kube-proxy、其他 K8s 客户端都通过**负载均衡器**访问 apiserver：

```yaml
# 负载均衡器配置（以云厂商 NLB 为例）
listeners:
  - protocol: TCP
    port: 6443
    target: apiserver-node-1:6443,apiserver-node-2:6443,apiserver-node-3:6443
```

### kubelet 连接配置

 kubelet、kube-proxy 等系统组件的 kubeconfig 指向负载均衡器的地址：

```yaml
clusters:
  - cluster:
      certificate-authority-data: <CA证书>
      server: https://<LB地址>:6443   # ← 指向 LB，不直接指向单个 apiserver
```

## Controller Manager 和 Scheduler 的高可用

### Leader Election 机制

Controller Manager 和 Scheduler 同一时间只有一个活跃实例（Leader），其他实例处于待命状态。当 Leader 挂掉后，其他实例通过 Leader Election 选举新的 Leader：

```bash
# 查看 controller manager 的 leader
kubectl get endpoints kube-controller-manager -n kube-system -o yaml
# metadata:
#   annotations:
#     control-plane.alpha.kubernetes.io/leader:
#       '{"holderIdentity":"node-1","leaseDurationSeconds":15,...}'
```

原理：每个实例尝试在 kube-system 命名空间下创建一个 `configmaps` 资源（名称固定），成功者成为 Leader。Leader 通过定期更新该资源来维持 Leadership。

## Node 级别的高可用

### Worker 节点的高可用

Worker 节点本身不具备高可用——单个节点故障时，运行在其上的 Pod 会被重新调度到其他节点。Pod 的高可用由 Deployment/ReplicaSet 的副本机制保障：

```yaml
spec:
  replicas: 3   # 3 个副本分布在不同节点
  selector:
    matchLabels:
      app: api
  template:
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchLabels:
                  app: api
              topologyKey: kubernetes.io/hostname
```

`podAntiAffinity` 确保 3 个 Pod 分布在 3 个不同的节点上，避免单节点故障导致多个 Pod 同时不可用。

### 节点健康检查

配合节点污点和容忍，确保关键 Pod 不会被调度到不稳定节点：

```bash
# 自动标记不健康节点
kubectl get nodes -l node.kubernetes.io/not-ready
# 如果节点长时间不恢复，可手动驱逐并维护
kubectl drain node-1 --ignore-daemonsets --delete-emptydir-data
```

## 部署工具的选择

| 工具 | etcd 部署 | apiserver 负载均衡 | 适用场景 |
|------|---------|------------------|---------|
| kubeadm | 官方支持 | 需手动配置 | 生产标准部署 |
| kubespray | Ansible 驱动，全自动 | 自动配置 | 大规模集群 |
| kubeadm + kube-vip | 官方支持 | kube-vip 提供 VIP | 小规模 HA |
| 云厂商托管 | 全托管 | 全托管 | 不想自建 |

## 常见问题

### etcd 写入超时

```
WARN etcdserver:Slow etcd request ...
reason: "slow disk I/O"
```

解决方案：使用 SSD 存储 etcd 数据，设置 `--heartbeat-interval` 和 `--election-timeout`。

### apiserver 证书需要 SAN

扩展 apiserver 时，需要在证书中添加新节点的 IP 和 LB 的 DNS 名称：

```bash
# kubeadm 生成证书时配置
kubeadm init phase certs apiserver \
  --apiserver-cert-extra-sans=api.cluster.local,192.168.1.100
```

### 集群无法恢复的预防措施

- 定期备份 etcd（每小时一次，保留 7 天）
- 重要资源（Deployment、StatefulSet）始终有多个副本
- 定期测试故障恢复流程

## 面试追问方向

- 为什么 etcd 集群推荐 3 或 5 个节点？2 个为什么不行？
- Controller Manager 和 Scheduler 的 Leader Election 是怎么实现的？依赖什么资源？
- kube-apiserver 的无状态设计意味着什么？它真的完全无状态吗？
- 如果所有 apiserver 同时故障，集群会怎样？kubelet 还能管理 Pod 吗？

> K8s HA 的核心是 etcd HA + apiserver 水平扩展 + 组件 Leader Election。理解这三个层次的冗余设计，就理解了 K8s 高可用的全部。
