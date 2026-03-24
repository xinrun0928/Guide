# etcd 在 Kubernetes 中的应用：API Server 存储后端

你有没有想过这个问题：

Kubernetes 的 API Server 是如何保证「声明式 API」的？你执行 `kubectl apply -f deployment.yaml`，Deployment 的期望状态被写入 etcd。

但如果 etcd 集群发生脑裂（split-brain），Kubernetes 会怎样？

答案是：**Kubernetes 牺牲可用性，保证一致性**。

理解 etcd 在 K8s 中的角色，是理解 K8s 可靠性设计的核心。

## Kubernetes 的状态存储

Kubernetes 是一个「状态管理系统」——它努力让「实际状态」匹配「期望状态」。

```
期望状态：Deployment.spec.replicas = 3
实际状态：Pod 数量 = 3
Kubernetes 的工作：确保实际状态 = 期望状态
```

所有这些「状态」都存储在 etcd 中。

## etcd 在 K8s 中的位置

```
┌─────────────────────────────────────────────────────────────────┐
│                         Kubernetes                               │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐                    │
│  │ kubectl  │   │  Kubelet  │   │ Scheduler│                    │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘                    │
│       │               │               │                         │
│       └───────────────┴───────────────┘                         │
│                       │                                          │
│              ┌────────▼────────┐                               │
│              │   API Server     │                               │
│              └────────┬────────┘                               │
│                       │                                          │
│              ┌────────▼────────┐                               │
│              │     etcd        │  ← 唯一的持久化存储              │
│              └─────────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
```

**所有组件都通过 API Server 访问 etcd**，不直接连接 etcd。

## 为什么 Kubernetes 不用 ZooKeeper？

这是一个经典的面试题：「为什么 Kubernetes 不用 ZooKeeper？」

### ZooKeeper 的问题

1. **运维复杂**
   - ZooKeeper 需要额外部署 Java 服务
   - 需要管理 ZooKeeper 集群本身
   - 多语言客户端质量参差不齐

2. **API 不友好**
   - 需要学习 ZooKeeper 的数据模型
   - Watch 是一次性的，不适合 K8s 的 watch-reconnect 模式

3. **架构不匹配**
   - K8s 组件是松耦合的，通过 HTTP 通信
   - ZooKeeper 是专用协议，集成成本高

4. **版本兼容性**
   - ZooKeeper API 变化时，K8s 需要跟着升级

### etcd 的优势

1. **和 K8s 同时诞生**
   - CoreOS 团队同时开发了 K8s 和 etcd
   - 从一开始就是为 K8s 设计的

2. **HTTP/gRPC API**
   - 和 K8s 的 REST API 风格一致
   - 多语言客户端实现简单

3. **运维友好**
   - etcd 可以作为 K8s 的 Static Pod 部署
   - 一键部署，一键升级

## etcd 在 K8s 中存储什么？

### 资源对象

```bash
# 查看所有 Pod
kubectl get pods -A
# 对应的 etcd key
# /registry/pods/default/nginx-deployment-7fb96c846b-5wf4s

# 查看 Deployment
kubectl get deployments -A
# 对应的 etcd key
# /registry/deployments/default/nginx-deployment
```

### 资源对象的生命周期

```
1. kubectl 发送 POST 请求到 API Server
2. API Server 验证请求，写入 etcd
3. etcd Raft 达成共识，返回成功
4. Controller Manager 监听到变化，创建对应资源
5. Scheduler 监听到 Pod 创建，分配合适的节点
6. Kubelet 监听到 Pod 分配，创建容器
```

## K8s 高可用与 etcd

### K8s 高可用架构

```
┌──────────────────────────────────────────────────────────┐
│                      Load Balancer                        │
│                    (VIP/Cloud LB)                        │
└─────────────────────┬────────────────────────────────────┘
                      │
    ┌─────────────────┼─────────────────┐
    │                 │                 │
┌───▼───┐         ┌───▼───┐         ┌───▼───┐
│API Srv│         │API Srv│         │API Srv│
└───┬───┘         └───┬───┘         └───┬───┘
    │                 │                 │
    └─────────────────┼─────────────────┘
                      │
┌─────────────────────▼─────────────────────┐
│              etcd Cluster (3/5 nodes)       │
│        ┌────────┐  ┌────────┐  ┌────────┐ │
│        │ etcd-1 │  │ etcd-2 │  │ etcd-3 │ │
│        └────────┘  └────────┘  └────────┘ │
└────────────────────────────────────────────┘
```

K8s 控制平面至少 3 个节点，etcd 集群至少 3 个节点。

### 奇数节点原则

```
为什么 etcd 集群要用奇数节点？

- 3 节点：容忍 1 节点故障，需要 2 票达成共识
- 5 节点：容忍 2 节点故障，需要 3 票达成共识
- 4 节点：容忍 1 节点故障，需要 3 票（和 3 节点一样，但成本更高）
```

## etcd 性能与容量规划

### 官方建议

```
- 单集群节点数：建议 3、5、7（奇数）
- 单集群存储：建议不超过 8GB
- 单 key 大小：建议不超过 1MB
- 事件历史：建议保留 1000-10000 条
```

### 性能瓶颈

```
etcd 性能瓶颈：

1. 磁盘 I/O：etcd 是磁盘数据库，需要 SSD
2. 网络延迟：Raft 需要节点间通信，跨机房延迟影响性能
3. 大 value：单次写入数据越大，性能越差
4. Watch 数量：大量 Watch 会增加内存占用
```

## K8s 备份与恢复

### 备份

```bash
# 创建快照
ETCDCTL_API=3 etcdctl snapshot save snapshot.db \
    --endpoints=https://127.0.0.1:2379 \
    --cacert=/etc/kubernetes/pki/etcd/ca.crt \
    --cert=/etc/kubernetes/pki/etcd/server.crt \
    --key=/etc/kubernetes/pki/etcd/server.key
```

### 恢复

```bash
# 停止 kube-apiserver
systemctl stop kube-apiserver

# 恢复数据
ETCDCTL_API=3 etcdctl snapshot restore snapshot.db \
    --data-dir=/var/lib/etcd/restored

# 修改 etcd 服务配置使用恢复的数据
# systemctl start etcd

# 启动 etcd
systemctl start etcd

# 验证恢复
ETCDCTL_API=3 etcdctl endpoint health

# 启动 kube-apiserver
systemctl start kube-apiserver
```

## 总结

etcd 是 Kubernetes 的「定海神针」：

- **唯一存储**：所有资源对象都存在 etcd
- **高可靠**：Raft 过半写入保证一致性
- **选型原因**：API 友好 + 运维简单 + 与 K8s 同时诞生
- **容量规划**：建议不超过 8GB + SSD + 奇数节点

理解 etcd 在 K8s 中的角色，才能理解 K8s 的可靠性设计。

**面试追问方向：**
- 为什么 Kubernetes 不用 ZooKeeper？
- etcd 集群多数节点故障会怎样？
- 如何优化 etcd 的读写性能？
- Kubernetes 的 etcd 如何做备份和恢复？