# KubeSphere 运维常用工具与故障排查

「KubeSphere 出问题了怎么办？」——从平台层到 K8s 层，逐层定位。

KubeSphere 封装了 Kubernetes 的复杂性，但问题排查的思路仍然是「逐层深入」。本文覆盖常见故障场景、排查工具和解决思路，帮助你在最短时间内定位问题。

## 排查分层模型

```
┌─────────────────────────────────────────────────────────────────┐
│                    KubeSphere 故障排查分层                          │
│                                                                  │
│  L1 应用层                                                       │
│  └── Pod 日志、健康检查、资源限制 → kubectl logs / describe      │
│                                                                  │
│  L2 平台层（KubeSphere 特有）                                      │
│  └── 多租户、流水线、存储卷、应用商店 → KubeSphere 控制台 + ks-console │
│                                                                  │
│  L3 Kubernetes 层                                                │
│  └── 网络、调度、存储、RBAC → kubectl / Lens                      │
│                                                                  │
│  L4 基础设施层                                                    │
│  └── 节点资源、etcd、网络插件 → ssh / etcdctl                     │
└─────────────────────────────────────────────────────────────────┘
```

## 常用排查工具

### kubectl 基础排查

```bash
# 查看 Pod 状态（所有命名空间）
kubectl get pods -A | grep -v Running | grep -v Completed

# 查看 Pod 详细事件
kubectl describe pod <pod-name> -n <namespace>

# 查看 Pod 日志
kubectl logs <pod-name> -n <namespace> --previous  # 上一个容器实例
kubectl logs <pod-name> -n <namespace> --tail=200   # 最近 200 行

# 查看 Deployment 状态
kubectl get deploy -A
kubectl rollout status deploy/<name> -n <namespace>

# 查看资源使用情况
kubectl top pods -n <namespace>
kubectl top nodes
```

### KubeSphere 控制台排查

```bash
# Web 控制台访问
# 地址：http://<node-ip>:30880
# 默认账号：admin / P@ssw0rd

# 查看 KubeSphere 组件状态
kubectl get pods -n kubesphere-system
kubectl get pods -n kubesphere-controls-system

# 查看 KS-Console（控制台前端）
kubectl get pods -n kubesphere-system -l app=ks-console

# 查看 KS-Apiserver（API 网关）
kubectl get pods -n kubesphere-system -l app=ks-apiserver
```

### Lens 图形化排查

Lens 是 Kubernetes 官方推荐的桌面客户端，相比 `kubectl`，它提供：

```bash
# 安装 Lens
# 下载地址：https://k8slens.dev/

# Lens 的优势
# - 可视化查看 Pod 日志（多容器切换）
# - 实时资源监控（CPU/内存）
# - 快速进入容器终端
# - 服务拓扑图查看
# - 支持多集群管理
```

## 常见故障场景

### 场景一：Pod 无法启动

**症状**：Pod 处于 `Pending`、`CrashLoopBackOff` 或 `ImagePullBackOff` 状态。

**排查步骤**：

```bash
# 1. 查看 Pod 详细事件
kubectl describe pod <pod-name> -n <namespace>

# 2. 常见原因及判断
# - Pending：资源不足（内存/CPU 不够）→ 检查节点资源
kubectl describe node
kubectl top nodes

# - ImagePullBackOff：镜像拉取失败
# → 检查镜像地址是否正确
# → 检查镜像仓库凭证是否配置（Secret）
kubectl get secrets -n <namespace>

# - CrashLoopBackOff：容器启动后崩溃
# → 查看容器日志
kubectl logs <pod-name> -n <namespace> --previous

# - CreateContainerConfigError：配置错误
# → 检查 ConfigMap / Secret 是否存在
# → 检查环境变量引用是否正确
```

**案例**：

```bash
# 事件显示：Warning  FailedScheduling  pod/xxx  0/3 nodes are available: 1 Insufficient memory
# 原因：节点内存不足
# 解决：
# 1. 增加节点或清理现有 Pod
kubectl delete pod <unused-pod> -n <namespace>
# 2. 或者调整 Deployment 的资源限制
kubectl patch deploy <name> -n <namespace> \
  -p '{"spec":{"template":{"spec":{"containers":[{"name":"xxx","resources":{"limits":{"memory":"512Mi"},"requests":{"memory":"256Mi"}}}]}}}}'
```

### 场景二：Pod 无法访问（网络问题）

**症状**：Pod 之间网络不通，或者 Service 无法访问。

**排查步骤**：

```bash
# 1. 确认 Pod IP 和 Service IP
kubectl get pods -o wide -n <namespace>
kubectl get svc -n <namespace>

# 2. 进入 Pod 内部测试网络
kubectl exec -it <pod-name> -n <namespace> -- /bin/sh
# 在容器内：
nslookup <service-name>          # DNS 解析
curl http://<service-ip>:<port>  # 连通性测试
cat /etc/resolv.conf             # DNS 配置

# 3. 查看 NetworkPolicy
kubectl get networkpolicy -n <namespace>

# 4. 检查 CNI 插件状态
kubectl get pods -n kube-system -l k8s-app=kube-proxy
kubectl get pods -n kube-system -l tier=node
```

### 场景三：流水线（Pipeline）执行失败

**症状**：DevOps 项目中的流水线一直处于 Running 状态或直接失败。

**排查步骤**：

```bash
# 1. 查看 Jenkins 状态
kubectl get pods -n kubesphere-devops-system

# 2. 查看流水线 Pod
kubectl get pods -A | grep -E "jenkins|builder|runner"

# 3. 查看 Jenkins 日志
kubectl logs -n kubesphere-devops-system \
  $(kubectl get pods -n kubesphere-devops-system -l app=jenkins -o jsonpath='{.items[0].metadata.name}')

# 4. 常见失败原因
# - SonarQube 连接失败：检查 DevOps 项目中的 Sonar 配置
# - Docker 镜像推送失败：检查镜像仓库凭证
# - K8s 部署失败：检查项目配额（Project Quota）
# - RBAC 权限不足：检查 ServiceAccount 是否绑定正确角色
```

```bash
# 流水线调试技巧
# 1. 在流水线中增加调试步骤
steps {
    script {
        sh "env | sort"  // 打印所有环境变量
        sh "kubectl version --client"  // 验证 kubectl 权限
    }
}

# 2. 查看 Jenkins Agent 日志
kubectl logs <jenkins-agent-pod> -n kubesphere-devops-system
```

### 场景四：存储卷挂载失败

**症状**：Pod 启动时卡在 MountVolume 阶段，或挂载后无读写权限。

**排查步骤**：

```bash
# 1. 查看 PV/PVC 状态
kubectl get pv,pvc -A | grep <namespace>

# 2. 查看存储类
kubectl get storageclass

# 3. 查看 PVC 详情
kubectl describe pvc <pvc-name> -n <namespace>

# 4. 常见问题及解决
# - Pending：没有匹配的 StorageClass
#   → 创建 StorageClass 或使用默认存储类
#   kubectl patch storageclass <name> -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'

# - AccessMode 不匹配：Requested 与 StorageClass 不一致
#   → 检查 PVC 的 accessModes 和 StorageClass 支持的模式

# - 权限问题：挂载后无法写入
#   → 检查 fsGroup 安全上下文
#   → 检查挂载路径是否存在
```

### 场景五：多租户资源隔离失效

**症状**：用户 A 可以看到或操作用户 B 的资源。

**排查步骤**：

```bash
# 1. 查看企业空间（Workspace）的角色绑定
kubectl get rolebindings -n <workspace-namespace>

# 2. 检查 Workspace 层级
kubectl get workspaces.workspace.kubesphere.io

# 3. 检查用户归属
kubectl get users | grep <username>

# 4. 常见原因
# - 角色权限过大：使用了 cluster-admin 而非细粒度角色
# - 跨 Workspace 共享凭证：Secret 没有隔离
# - Workspace 管理员的误操作
```

### 场景六：KubeSphere 控制台无法访问

**症状**：Web 界面打不开或加载缓慢。

**排查步骤**：

```bash
# 1. 检查 ks-console 和 ks-apiserver 状态
kubectl get pods -n kubesphere-system -l app=ks-console
kubectl get pods -n kubesphere-system -l app=ks-apiserver

# 2. 检查 Ingress 状态
kubectl get ingress -n kubesphere-system

# 3. 检查 NodePort 服务
kubectl get svc -n kubesphere-system | grep NodePort

# 4. 检查节点端口是否被占用
ss -tlnp | grep 30880
netstat -tlnp | grep 30880

# 5. 查看 ks-console 日志
kubectl logs -n kubesphere-system \
  $(kubectl get pods -n kubesphere-system -l app=ks-console -o jsonpath='{.items[0].metadata.name}') \
  -f
```

### 场景七：告警通知没有收到

**症状**：配置了告警规则，但邮件/钉钉通知没有收到。

**排查步骤**：

```bash
# 1. 检查 AlertManager 状态
kubectl get pods -n kubesphere-monitoring-system

# 2. 查看通知配置
kubectl get secret alerting-ad-secret -n kubesphere-monitoring-system -o yaml

# 3. 检查告警历史
# 在 KubeSphere 控制台 → 监控告警 → 告警历史

# 4. 测试通知通道
# 控制台 → 通知管理 → 添加通知接收人 → 点击「测试」

# 5. 常见原因
# - 邮件 SMTP 配置错误：检查是否使用 TLS/SSL
# - 钉钉机器人 Webhook 过期或被删除
# - 告警规则的条件表达式有问题
# - 通知被静默（Silence）
```

## 日志分析方法

### 平台组件日志

```bash
# KubeSphere 系统组件日志
kubectl logs -n kubesphere-system ks-apiserver-<pod-name> --tail=100
kubectl logs -n kubesphere-system ks-console-<pod-name> --tail=100

# 核心组件日志
kubectl logs -n kubesphere-system sentinel-<pod-name> --tail=100
kubectl logs -n kubesphere-system redis-<pod-name> --tail=100

# 使用 stern 实时查看多容器日志
stern <pod-pattern> -n <namespace> --since=10m
```

### 应用日志收集

```bash
# 查看 Fluent Bit 日志收集状态
kubectl get pods -n kubesphere-logging-system
kubectl logs -n kubesphere-logging-system fluent-bit-xxx --tail=50

# 查看 Elasticsearch 日志存储
kubectl get pods -n kubesphere-logging-system -l app=elasticsearch
```

## 性能调优建议

```bash
# 1. 节点级别：监控资源使用
kubectl top nodes

# 2. 控制平面组件资源调整
# 修改 kube-apiserver 资源限制
kubectl edit deploy kube-apiserver -n kube-system

# 3. etcd 性能检查
# etcd 磁盘延迟应 < 10ms
etcdctl check perf --endpoints=https://127.0.0.1:2379 \
  --cacert=/etc/kubernetes/pki/etcd/ca.crt \
  --cert=/etc/kubernetes/pki/etcd/server.crt \
  --key=/etc/kubernetes/pki/etcd/server.key

# 4. 启用 KubeSphere 事件查询
# 控制台 → 日志查询 → 选择「事件」类型
```

## 故障排查清单

遇到问题时，按这个顺序检查：

| 步骤 | 检查项 | 命令 |
|------|--------|------|
| 1 | Pod 状态 | `kubectl get pods -A` |
| 2 | Pod 事件 | `kubectl describe pod` |
| 3 | Pod 日志 | `kubectl logs` |
| 4 | 资源配额 | `kubectl describe resourcequota -n <ns>` |
| 5 | 网络策略 | `kubectl get networkpolicy -n <ns>` |
| 6 | 存储卷 | `kubectl get pvc -n <ns>` |
| 7 | 节点状态 | `kubectl get nodes` |
| 8 | 平台组件 | `kubectl get pods -n kubesphere-system` |

> "故障排查的本质是『假设—验证—排除』的循环。最快的定位方式是从症状出发，而不是从架构出发。"
