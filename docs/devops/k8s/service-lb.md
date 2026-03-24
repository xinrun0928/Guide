# Service 负载均衡实现：iptables vs IPVS

「Service 是怎么做负载均衡的？」——这是 K8s 面试里的高频问题，也是理解集群网络的关键。

kube-proxy 是这个故事的男主角。它运行在每个节点上，负责维护 Service 的网络规则。iptables 和 IPVS 是它维护规则所使用的两种后端实现。两者都能工作，但原理和性能差异巨大。

## kube-proxy 的职责

kube-proxy 监听 kube-apiserver 中 Service 和 Endpoints 的变化，实时更新节点上的网络转发规则，使得：

1. 访问 Service ClusterIP 的流量，被正确转发到后端 Pod
2. 负载均衡在多个后端 Pod 之间分发流量
3. Service 变化时（Pod 扩缩容、上线），规则自动更新

kube-proxy 有三种工作模式，iptables 和 IPVS 只是其中两种：

| 模式 | 稳定性 | 性能 | 负载均衡算法 |
|------|--------|------|-------------|
| userspace | 古老，已废弃 | 差 | 轮询 |
| iptables | 成熟稳定 | 中等 | 概率转发 |
| IPVS | K8s 1.11+ | 高 | 多种算法 |
| kernelspace | Windows 专属 | 高 | - |

## iptables 模式

### 工作原理

kube-proxy 在 iptables 中为每个 Service 插入一条 DNAT 规则。当数据包到达节点时，iptables 决定它应该被转发到哪里：

```
客户端请求 (10.244.1.10) → ClusterIP (10.96.0.100)
        │
        ▼
iptables PREROUTING / OUTPUT chain
        │
        ▼
匹配 Service 规则 ──► DNAT ──► 后端 Pod IP (随机选择)
```

### 负载均衡算法

iptables 模式下，kube-proxy 通过 ` statistic ` 模块实现概率性负载均衡：

```bash
# iptables 规则示例（简化）
-A KUBE-SVC-XXXX -m statistic --mode random --probability 0.33333333 -j KUBE-SEP-AAAA
-A KUBE-SVC-XXXX -m statistic --mode random --probability 0.50000000 -j KUBE-SEP-BBBB
-A KUBE-SVC-XXXX -j KUBE-SEP-CCCC
```

如果有 3 个后端 Pod，第一条规则有 33.3% 概率命中 Pod1，剩余流量中第二条有 50% 命中 Pod2，剩下的走 Pod3。

**注意**：这是概率转发，不是严格的比例负载均衡。在小规模请求量下，分布可能不均匀。

### iptables 的问题

1. **规则数量爆炸**：每个 Service 对应一组规则，每个 Endpoints 也对应一组规则。1000 个 Service × 10 个 Pod = 10000+ 条规则。

2. **查找复杂度**：iptables 按顺序遍历匹配，最坏情况 O(n)。规则越多，查找越慢。

3. **更新延迟**：大规模规则更新时，可能导致短暂的连接中断。

```bash
# 查看节点上的 iptables 规则数量
iptables -L -n | wc -l

# 典型生产环境可能有数万条规则
```

## IPVS 模式

### 工作原理

IPVS（IP Virtual Server）是 Linux 内核层面的四层负载均衡器，工作在 Netfilter 之上。kube-proxy 使用 IPVS 作为后端，配置内核中的 IPVS 规则：

```bash
# IPVS 规则示例
IP Virtual Server version 1.2.1 (size=4096)
Prot LocalAddress:Port Scheduler Flags
  -> RemoteAddress:Port           Forward  ActiveConn InActConn
TCP  10.96.0.100:80 rr
  -> 10.244.1.15:8080             Masq    0          0
  -> 10.244.2.8:8080              Masq    0          0
  -> 10.244.1.23:8080             Masq    0          0
```

### 负载均衡算法

IPVS 支持多种负载均衡算法，比 iptables 丰富得多：

| 算法 | 说明 |
|------|------|
| `rr`（轮询） | 依次分配到每个后端 |
| `wrr`（加权轮询） | 按权重比例分配 |
| `lc`（最小连接） | 分配给活跃连接数最少的 |
| `wlc`（加权最小连接） | 结合权重和连接数 |
| `sh`（源哈希） | 相同来源分配到相同后端 |
| `dh`（目标哈希） | 按目标 IP 哈希 |

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-svc
spec:
  sessionAffinity: ClientIP  # 启用源 IP 亲和性
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 10800
```

### IPVS 的优势

1. **O(1) 查找**：基于哈希表，无论规则多少，查找时间恒定
2. **内核级性能**：数据包处理在内核完成，无需遍历用户态规则
3. **更多算法**：支持 8 种负载均衡策略
4. **连接复用**：TCP 连接复用（-p tcp 参数）减少后端压力

## 模式对比

| 对比维度 | iptables | IPVS |
|---------|---------|------|
| 规则存储 | 线性链表 | 哈希表 |
| 查找复杂度 | O(n) | O(1) |
| 负载均衡算法 | 概率转发 | 8 种算法 |
| 最大 Service 数 | ~5000（性能明显下降） | ~10000+ |
| 更新方式 | 整体替换 | 增量更新 |
| 复杂度 | 简单 | 稍复杂 |
| 生产推荐 | 小规模集群 | 大规模集群 |

## 如何选择

```bash
# 查看当前 kube-proxy 模式
kubectl get configmap kube-proxy -n kube-system -o yaml
```

```yaml
# 修改 kube-proxy 模式为 IPVS（需要预先加载 ipvs 内核模块）
apiVersion: kubeproxy.config.k8s.io/v1alpha1
kind: KubeProxyConfiguration
mode: IPVS
ipvs:
  scheduler: "wrr"  # 加权轮询
  excludeCIDRs:
    - "10.96.0.1/32"  # 排除 kube-apiserver 的 CIDR
```

**注意**：从 iptables 切换到 IPVS 时，需要确保所有节点加载了 `ip_vs`、`ip_vs_rr`、`ip_vs_wrr`、`ip_vs_sh`、`nf_conntrack_ipv4` 等内核模块。

## 常见问题

### 为什么 Endpoints 变化时连接会断？

iptables 模式下，kube-proxy 替换整条 Service 链的规则，替换期间可能有数据包走旧规则、新数据包走新规则，导致短暂的不一致。

IPVS 的增量更新机制更平滑。

### sessionAffinity 为什么重要？

对于有状态的 HTTP 服务（如需要登录态的 WebSocket），需要同一客户端的请求路由到同一个后端 Pod：

- `sessionAffinity: None`（默认）：无亲和性
- `sessionAffinity: ClientIP`：基于源 IP 亲和
- IPVS 的 `sh` 算法天然支持源 IP 哈希

## 面试追问方向

- kube-proxy 的三种模式中，userspace 模式为什么被废弃了？
- iptables 规则数量过多会导致什么问题？怎么监控？
- IPVS 的「连接复用」具体是怎么工作的？
- Service 变化时，iptables 和 IPVS 的更新机制有什么不同？哪个更平滑？
- IPVS 如何处理「最后一个后端 Pod 被删除」的边界情况？

> 理解 kube-proxy 的两种后端模式，是理解 K8s Service 网络的必备知识点。面试中能说清楚「为什么大规模集群要用 IPVS」，说明你对系统底层有真实的理解。
