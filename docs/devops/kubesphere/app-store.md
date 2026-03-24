# KubeSphere 应用管理：基于 OpenPitrix 的应用商店

「KubeSphere 的应用商店是什么？」——一个可以一键部署复杂应用的 Helm Chart 市场。

KubeSphere 的应用商店基于 OpenPitrix 构建，提供企业级的应用生命周期管理。从上传 Helm Chart，到应用审核，到一键部署，再到版本升级，整个流程都可以在图形化界面中完成。

## 应用商店架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    KubeSphere 应用商店架构                           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    应用商店（App Store）                      │   │
│  │                                                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │   │
│  │  │ Nginx   │  │ MySQL   │  │ Kafka   │  │ Prometheus│ │   │
│  │  │ v1.2.0  │  │ v8.0    │  │ v3.5    │  │ v2.40   │ │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │   │
│  │                                                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐              │   │
│  │  │ Redis   │  │ MinIO   │  │ Jenkins │              │   │
│  │  │ v7.0    │  │ v2023   │  │ v2.426  │              │   │
│  │  └──────────┘  └──────────┘  └──────────┘              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                      │
│         ┌────────────────────┼────────────────────┐               │
│         ▼                    ▼                    ▼               │
│  ┌────────────┐       ┌────────────┐       ┌────────────┐        │
│  │ Workspace A │       │ Workspace B │       │ Workspace C │        │
│  │ Project X   │       │ Project Y   │       │ Project Z   │        │
│  │ app:v1.2.0 │       │ app:v1.1.0 │       │ app:v1.2.0 │        │
│  └────────────┘       └────────────┘       └────────────┘        │
│                                                                  │
│  OpenPitrix 后端                                                   │
│  - App Version 管理                                              │
│  - Review Workflow（审核流程）                                   │
│  - Runtime 运行时配置                                            │
└─────────────────────────────────────────────────────────────────┘
```

## 应用模板类型

KubeSphere 支持两种应用模板：

```
┌─────────────────────────────────────────────────────────────────┐
│                    应用模板类型对比                                │
│                                                                  │
│  Helm Chart 模板                                                │
│  ├── 通用格式，K8s 生态标准                                       │
│  ├── values.yaml 定义配置项                                      │
│  ├── 支持 KubeSphere 扩展（多租户隔离）                          │
│  └── 通过 kubectl helm install 或 KubeSphere 界面部署             │
│                                                                  │
│  OpenPitrix 扩展模板                                             │
│  ├── 基于 Helm Chart，增加审核流程                                │
│  ├── 支持应用多版本管理                                          │
│  ├── 支持应用分类、标签                                          │
│  └── 支持应用评分、评论（企业版）                                │
└─────────────────────────────────────────────────────────────────┘
```

## 部署应用

### 通过图形界面部署

```
部署步骤：
1. 进入应用管理 → 应用商店
2. 找到目标应用（如 MySQL）
3. 点击「部署应用」
4. 选择目标 Workspace 和 Project
5. 配置应用参数（副本数、存储、密码等）
6. 点击「部署」
7. 查看应用状态
```

### 通过命令行部署

```bash
# 方式一：使用 helm 命令
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
helm install my-mysql bitnami/mysql -n my-project

# 方式二：使用 kubectl
kubectl get app -n kubesphere-system
# 应用商店中的应用通过 App CR 部署
apiVersion: app.kubesphere.io/v1alpha1
kind: App
metadata:
  name: myapp
  namespace: my-project
spec:
  name: my-chart
  version: "1.0.0"
  repo: https://charts.example.com
  values:
    replicaCount: 2
    image:
      repository: myapp
      tag: "latest"
```

## 应用版本管理

### 版本控制

```bash
# 查看应用版本
# 在应用商店中，每个应用可以有多个版本
# 例如 Nginx：
# - 1.0.0（基础版）
# - 1.2.0（增加 TLS 支持）
# - 2.0.0（重大版本升级）

# 升级应用
# 在 KubeSphere 控制台：
# 应用 → 选择应用 → 版本升级 → 选择新版本 → 确认

# 回滚应用
# 应用 → 选择应用 → 回滚 → 选择历史版本
```

### 升级策略

```yaml
# 在 Helm values 中配置升级策略
# values.yaml
spec:
  upgradeStrategy:
    # 滚动更新
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
    # 蓝绿部署
    # type: BlueGreen
    # 蓝绿部署需要预先准备新版本，然后切换流量
```

## 应用配置

### values.yaml 配置示例

```yaml
# MySQL 应用配置示例
# 在 KubeSphere 应用部署界面中填写的 values

# 基础配置
architecture: replication
auth:
  database: myapp
  username: dbuser
  password: ChangeMe123
  rootPassword: RootPass123

# 副本配置
primary:
  replicaCount: 1
  persistence:
    enabled: true
    size: 20Gi
    storageClass: nfs-client
  resources:
    limits:
      cpu: 1000m
      memory: 1Gi
    requests:
      cpu: 100m
      memory: 256Mi

secondary:
  replicaCount: 2
  persistence:
    enabled: true
    size: 20Gi
    storageClass: nfs-client
  resources:
    limits:
      cpu: 500m
      memory: 512Mi
    requests:
      cpu: 50m
      memory: 128Mi

# 服务配置
service:
  type: ClusterIP
  ports:
    mysql: 3306
```

## 应用审核流程

在多租户场景下，应用上架商店通常需要审核：

```
┌─────────────────────────────────────────────────────────────────┐
│                    应用审核流程                                    │
│                                                                  │
│  开发者上传 Chart                                               │
│         │                                                      │
│         ▼                                                      │
│  Workspace 管理员审核（可选）                                    │
│         │                                                      │
│         ▼                                                      │
│  平台管理员审核                                                 │
│         │                                                      │
│         ▼                                                      │
│  应用上架商店（所有 Workspace 可见）                              │
│         │                                                      │
│         ▼                                                      │
│  用户部署应用                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 应用生命周期

```bash
# 应用状态流转
# Created → Submitted → Passed → Active
#                ↓
#             Rejected（被拒绝，需要修改后重新提交）

# 通过 YAML 管理应用
apiVersion: app.kubesphere.io/v1alpha1
kind: App
metadata:
  name: myapp
  namespace: my-project
spec:
  name: myapp-chart
  version: "1.0.0"
  repo: https://charts.example.com
  clusterId: cluster-xxx
  workspace: my-workspace
status:
  phase: Active
```

## 最佳实践

### 应用打包规范

```bash
# 良好的 Helm Chart 应该：
# 1. 有清晰的 values.yaml 默认值
# 2. 有 README.md 说明配置项
# 3. 支持多副本部署
# 4. 支持资源限制配置
# 5. 支持存储类配置
# 6. 有健康检查探针配置

# Chart 目录结构
# myapp/
# ├── Chart.yaml
# ├── values.yaml
# ├── README.md
# ├── templates/
# │   ├── deployment.yaml
# │   ├── service.yaml
# │   ├── ingress.yaml
# │   └── configmap.yaml
# └── charts/
```

### 多环境部署

```yaml
# 通过 KubeSphere 配置不同环境的 values
# 开发环境：replicaCount=1, resources 低配
# 测试环境：replicaCount=2, resources 中配
# 生产环境：replicaCount=3, resources 高配, 高可用

# values-dev.yaml
replicaCount: 1
resources:
  limits:
    cpu: 500m
    memory: 512Mi

# values-prod.yaml
replicaCount: 3
resources:
  limits:
    cpu: 2000m
    memory: 4Gi
```

## 面试追问方向

1. **KubeSphere 的应用商店和 Helm 有什么区别？**
   答：本质都是基于 Helm Chart。KubeSphere 的应用商店在 Helm 基础上增加了：多租户隔离（不同 Workspace 只能看到被共享的应用）、审核流程（应用上架需要审核）、图形化部署界面（不需要懂 helm 命令）、版本管理（支持一键升级和回滚）。

2. **如何在 KubeSphere 中部署一个未上架商店的应用？**
   答：两种方式。方式一：将 Helm Chart 上传到 KubeSphere 的私有 Git/SVN 仓库，然后在「应用模板」中添加。方式二：直接通过 kubectl helm install 命令部署，KubeSphere 会自动识别并显示在应用列表中。

3. **应用商店中的多版本如何管理？**
   答：每个应用可以有多个版本，每个版本都是独立的 Helm Chart。用户部署时选择具体版本，升级时选择新版本。KubeSphere 支持原地升级（In-place Upgrade）和重新部署（Re-create）两种升级策略。

> "KubeSphere 的应用商店，把 Helm Chart 的力量用图形化的方式释放出来。让开发者不需要懂 Helm，也能一键部署 MySQL、Redis、Kafka 这些复杂中间件。"
