# Kubernetes Dashboard 与 Lens 可视化工具

「有没有图形化的方式管理 K8s 集群？」——当然有。

kubectl 命令行强大，但对于日常浏览和快速操作，图形化界面效率更高。Kubernetes Dashboard 和 Lens 是两种定位不同的可视化工具：前者是 K8s 官方维护的 Web UI，后者是专为开发者设计的本地 IDE 插件。

## Kubernetes Dashboard

### 部署

```bash
# 官方推荐方式（K8s 1.22+ 使用新版本）
kubectl apply -f https://raw.githubusercontent.com/kubernetes/dashboard/v2.7.0/aio/deploy/recommended.yaml

# 查看 dashboard 运行状态
kubectl get pods -n kubernetes-dashboard

# 本地代理访问（http://localhost:8001/api/v1/namespaces/kubernetes-dashboard/services/https:kubernetes-dashboard:/proxy/）
kubectl proxy
```

### 认证方式

Dashboard 默认不允许以 ServiceAccount 身份登录，需要创建令牌：

```bash
# 创建 admin-user ServiceAccount 和 token
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ServiceAccount
metadata:
  name: admin-user
  namespace: kubernetes-dashboard
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: admin-user
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
  - kind: ServiceAccount
    name: admin-user
    namespace: kubernetes-dashboard
EOF

# 获取登录 token
kubectl -n kubernetes-dashboard create token admin-user
```

### 功能特点

- **Web 界面**：浏览器访问，无需安装额外软件
- **集群概览**：节点、Pod、资源使用率一目了然
- **CRUD 操作**：创建、编辑、删除资源
- **日志查看**：直接查看 Pod 日志
- **监控集成**：配合 metrics-server 显示资源使用

### 适用场景

- 运维人员在办公电脑上查看集群状态
- 快速排查问题（比 kubectl describe 更直观）
- 轻量级操作（不需要 IDE）

### 安全注意事项

Dashboard 存在多个历史安全漏洞，生产环境使用需要注意：
- **禁止公网暴露**：Dashboard 默认不需要认证，暴露公网极其危险
- **使用 RBAC**：只授予必要权限，不用 cluster-admin
- **HTTPS**：生产环境应启用 HTTPS
- **网络策略**：通过 NetworkPolicy 限制 Dashboard 的访问来源

## Lens：Kubernetes IDE

Lens 是 Mirantis 出品的免费 K8s 桌面客户端，定位是「K8s 开发的 IDE」，功能远比 Dashboard 丰富。

### 安装

下载地址：https://k8slens.dev/

支持 macOS、Windows、Linux，安装后添加集群：

```bash
# 获取集群 kubeconfig
kubectl config view --flatten > ~/clusters/prod-cluster.yaml
# 在 Lens 中导入该文件即可
```

### 核心功能

#### 1. 多集群管理

Lens 支持同时管理多个 K8s 集群，每个集群在左侧边栏独立显示：

```
Clusters
├── production (current)
├── staging
├── development
└── minikube
```

#### 2. 资源浏览器

点击任意资源类型，右侧显示资源列表和详情：

```
Pods
├── nginx-7d7b8c4f-abc12 (Running) [nginx]
├── redis-6d8f4b9d-def34 (Running) [redis]
└── api-8c7f9d5e-fgh56 (CrashLoopBackOff) [api]
    └── Events
    └── Logs
    └── Terminal
```

#### 3. 内置终端

在 Lens 内直接打开 Pod 的终端，无需另开终端：

```
kubectl exec -it nginx-7d7b8c4f-abc12 -- sh
```

#### 4. YAML 编辑器

Lens 内置 YAML 编辑器，支持语法高亮和 K8s schema 验证。修改后直接 Apply。

#### 5. Prometheus 集成

Lens 内置了 Prometheus 查询功能，可以直接在界面上写 PromQL 并可视化结果，无需另开 Grafana。

```promql
# 在 Lens 中直接查询
sum(rate(container_cpu_usage_seconds_total{namespace="production"}[5m])) by (pod)
```

#### 6. 日志聚合

Lens 提供了 Pod 日志的聚合视图，可以同时查看多个 Pod 的日志，支持全文搜索。

### 资源对比

| 特性 | Kubernetes Dashboard | Lens |
|------|---------------------|------|
| 安装方式 | Web 应用（集群内） | 桌面客户端 |
| 多集群支持 | 需多次登录切换 | 同时管理多个集群 |
| 本地终端 | 无 | 内置 Pod Terminal |
| YAML 编辑 | 基本 | 带 schema 验证 |
| 日志查看 | 单 Pod | 多 Pod 聚合 |
| Prometheus 查询 | 需 Grafana | 内置 |
| 离线能力 | 无（需要网络） | 完全离线可用 |
| 资源占用 | 集群内资源 | 本地资源 |
| 适用用户 | 运维 / 轻量级查看 | 开发者 / 深度使用 |

## kubectl lens 插件生态

Lens 基于 kube-openapi 提供 schema 验证，同时支持安装插件扩展功能：

```bash
# 通过 Lens 的 "Catalog" 安装插件
# 常用插件：
# - VPA (Vertical Pod Autoscaler) 可视化
# - Image Scanner（镜像漏洞扫描）
# - HPA 管理界面
# - Resource Map（资源依赖图）
```

## 实践建议

```
什么场景用什么工具？
    │
    ├── 快速查看集群状态 / 分享给非技术人员 ──► Kubernetes Dashboard
    ├── 日常开发调试 / 多集群切换 ──► Lens
    ├── CI/CD 环境中查看状态 ──► kubectl 命令行
    └── 生产环境故障排查 ──► kubectl describe + 日志
```

## 面试追问方向

- Kubernetes Dashboard 有哪些安全风险？生产环境应该怎么安全地暴露它？
- Lens 连接集群的原理是什么？它和 kubectl 有什么关系？
- 为什么说 Dashboard 不是给开发者用的？它的设计定位是什么？

> 可视化工具是命令行工具的补充，不是替代。理解每个工具的适用场景，才能在日常工作中选择最合适的武器。
