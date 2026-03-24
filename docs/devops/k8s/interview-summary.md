# Kubernetes 面试高频问题汇总

K8s 是云原生时代的基础设施核心，也是面试中的高频考察点。这篇汇总了最常被问到的 K8s 面试题，按难度分层，附带回答思路和追问方向。

## 基础层：会用

### Q1：Pod 的生命周期状态有哪些？

Pod 的 `status.phase` 字段表示 Pod 的总体状态：

| 状态 | 说明 |
|------|------|
| Pending | Pod 已被 K8s 系统接受，但镜像还未拉取或容器未启动 |
| Running | Pod 已绑定到节点，所有容器已创建，至少有一个在运行 |
| Succeeded | 所有容器正常终止，不会重启（Job 类型的 Pod） |
| Failed | 所有容器都终止，至少有一个非正常退出（exit code != 0） |
| Unknown | 无法获取 Pod 状态（通常是节点通信问题） |

注意：Pod 内部的容器各自有自己的状态，通过 `containerStatuses` 查看。

### Q2：Deployment 和 StatefulSet 的区别是什么？

| 维度 | Deployment | StatefulSet |
|------|-----------|------------|
| Pod 标识 | 随机后缀（nginx-7d9b8c4f-abc12） | 稳定序号（web-0, web-1, web-2） |
| DNS | 无稳定标识 | 有（web-0.nginx.default.svc.cluster.local） |
| 扩缩容 | 任意顺序 | 按序号顺序创建/删除 |
| 存储 | 共享存储（VolumeClaimTemplate 各不相关） | 每个 Pod 有独立 PVC（序号绑定） |
| 适用场景 | 无状态应用 | 有状态应用（数据库、消息队列） |

### Q3：Pod 的资源限制（requests 和 limits）有什么区别？

- **requests**：调度的依据。调度器根据 requests 和节点的可用资源来决定 Pod 应该调度到哪个节点。
- **limits**：运行时上限。容器实际使用的资源不能超过 limits，否则被限制（CPU）或被杀掉（内存）。

```yaml
resources:
  requests:
    cpu: 200m
    memory: 256Mi
  limits:
    cpu: 500m
    memory: 512Mi
```

### Q4：Liveness Probe 和 Readiness Probe 的区别？

| 探测类型 | 探测失败后果 | 适用场景 |
|---------|-----------|---------|
| Liveness Probe | 容器被杀死并重启 | 进程僵死、内存泄漏等不可恢复问题 |
| Readiness Probe | 从 Service 端点中移除（不接收流量） | 启动中、依赖未就绪、负载过高 |

## 进阶层：理解原理

### Q5：K8s 调度的过程是什么？

```
1. 调度器监听未调度的 Pod（Pod.spec.nodeName == ""）
2. 为 Pod 选择一个最优节点：
   a. Predicates（过滤）：排除不满足条件的节点
      - 不满足资源需求的
      - 有污点但无容忍的
      - Port/Label/Hostname 冲突的
   b. Priorities（打分）：对剩余节点排序
      - 最低负载节点得分高
      - 亲和性/反亲和性
      - 数据本地性（Volume 所在节点）
3. 绑定 Pod 到节点（Bind）：
   - kube-apiserver 更新 Pod.spec.nodeName
   - kubelet 收到通知，开始创建 Pod
```

### Q6：Service 的 ClusterIP 是怎么工作的？

kube-proxy 监听 Service 和 Endpoints 的变化，在每个节点上维护 iptables/IPVS 规则。当流量到达 ClusterIP 时，iptables/IPVS 规则将其 DNAT 转发到后端 Pod IP。

### Q7：描述 Pod 网络通信的完整路径（同节点和跨节点）

- **同节点**：Pod A eth0 → veth-pair → cni0 bridge → veth-pair → Pod B eth0（ARP 解析 MAC 地址）
- **跨节点（Flannel）**：原始包 + VXLAN 封装 → 物理网络 → 解封装 → Pod
- **跨节点（Calico）**：Pod IP 直接在物理网上路由（BGP 分发路由）

### Q8：ConfigMap/Secret 怎么实现热更新？

挂载为文件形式（非 subPath）时，kubelet 定期同步 ConfigMap 内容，容器内的文件会自动更新（通常在 60 秒内）。subPath 挂载的不会热更新。

## 高级层：生产经验

### Q9：Pod 被驱逐（Evicted）的原因有哪些？

| 原因 | 触发条件 | 解决方案 |
|------|---------|---------|
| 资源不足 | 节点资源耗尽，OOMKilled | 提高 requests/limits，设置 ResourceQuota |
| 污点/容忍不匹配 | 节点打上新污点，Pod 不容忍 | 添加对应 Toleration |
| Pod 优先级 | 高优先级 Pod 需要抢占资源 | 调整 PodPriority 或 PriorityClass |
| 节点压力 | 节点内存压力、磁盘压力 | 增加节点，清理磁盘 |
| 驱逐策略 | kube-controller-manager 的 eviction 策略 | 配置 kube-reserved/system-reserved |

### Q10：集群故障排查的思路是什么？

```bash
# 1. 查看节点状态
kubectl get nodes
kubectl describe node <node>

# 2. 查看 Pod 状态
kubectl get pods -A | grep -v Running
kubectl describe pod <pod> -n <ns>

# 3. 查看事件
kubectl get events -A --sort-by=.lastTimestamp | tail -50

# 4. 查看日志
kubectl logs <pod> -n <ns> --previous    # 上次运行的日志
kubectl logs <pod> -n <ns> -c <container>  # 特定容器

# 5. 查看资源状态
kubectl top nodes
kubectl top pods -A

# 6. 查看网络
kubectl run test --image=busybox --restart=Never --rm -it -- nslookup service-name
```

### Q11：如何设计一个多租户 K8s 环境？

```
┌─────────────────────────────────────────────────┐
│               Cluster（共享集群）                 │
│                                                 │
│  namespace: team-a                              │
│    ├── RBAC: RoleBinding（team-a-dev Role）     │
│    ├── ResourceQuota: CPU/Memory 上限            │
│    ├── LimitRange: 默认资源限制                 │
│    └── NetworkPolicy: 默认拒绝 + 显式放行       │
│                                                 │
│  namespace: team-b                              │
│    └── 同上结构                                 │
│                                                 │
│  Global 层面                                    │
│  ├── RBAC: ClusterRoleBinding（跨 ns 管理员）   │
│  ├── NodeRestriction（限制节点操作权限）         │
│  └── PodSecurityPolicy/PSS（安全策略）           │
└─────────────────────────────────────────────────┘
```

## 面试技巧

### 1. 用「原理 + 场景」的方式回答

不要只背答案，要说清楚「为什么这样设计」：

> 错误：Pod 是 K8s 的最小调度单位。
>
> 正确：Pod 是 K8s 的最小调度单位。因为容器本身不具备独立的调度能力，需要 Pod 来提供共享的网络（Pause 容器）、存储卷和生命周期管理。一个 Pod 内的多个容器共享同一个网络命名空间和 UTS 命名空间，所以它们可以用 localhost 互相通信，这是 Pod 设计的核心目的。

### 2. 主动暴露踩坑经验

面试官最想听的是真实经验：

> 「我们遇到过 OOMKilled 的问题。当时的情况是……排查过程是……最后的解决方案是……」

### 3. 预判追问方向

每个知识点都可能延伸出追问：

| 知识点 | 可能的追问 |
|--------|---------|
| Pod 调度 | 调度器的 Predicates/Priorities 算法细节？ |
| Service | kube-proxy 的 iptables 和 IPVS 区别？ |
| Volume | PV/PVC 的绑定过程？ |
| 网络 | CNI 插件选型？Flannel vs Calico？ |
| 安全 | RBAC 的 allow-of-check 是什么？ |
| 扩缩容 | HPA 的扩缩容算法？ |
| 升级 | etcd 的 Raft 共识协议？ |

## 面试追问方向汇总

| 类别 | 高频追问 |
|------|---------|
| Pod 调度 | 亲和性/反亲和性怎么配合使用？污点和容忍的优先级？ |
| 网络 | 为什么 Pod 和 Pod 之间不需要 NAT？CNI 插件怎么选？ |
| 存储 | 为什么云盘不支持 ReadWriteMany？怎么解决多节点共享存储？ |
| 安全 | ServiceAccount Token 和普通用户认证的区别？ |
| 运维 | etcd 备份怎么做？集群升级的顺序是什么？ |
| 可观测性 | Prometheus 的四种指标类型有什么区别？ |

> K8s 面试的核心，是把「用过」变成「理解过」。能讲清楚每个机制背后的设计意图和 Trade-off，才是真正的掌握。
