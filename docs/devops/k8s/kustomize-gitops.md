# Kustomize vs Helm vs GitOps（ArgoCD）

「应用配置怎么管理？」——这是 K8s 落地中最现实的问题之一。

一个应用有 development、staging、production 三个环境，每个环境有自己的配置（副本数、资源限制、环境变量）。是复制三份 YAML 还是用模板引擎？Helm 和 Kustomize 是两条主流路线，GitOps 则定义了配置管理的最佳工作方式。

## 三者的定位

```
Helm：包管理器
  ├── 把应用打包成一个 Chart（可分发、可版本化）
  ├── template + values → 渲染成 K8s YAML
  └── 适合分发给第三方或作为产品交付

Kustomize：配置管理
  ├── 基于 Overlay 的差异化配置
  ├── base + overlay（patch）→ 直接合并成 K8s YAML
  └── 适合管理同一应用的多个环境

GitOps：工作流
  ├── 所有配置存储在 Git 中
  ├── Git 是唯一的真相来源
  ├── ArgoCD / Flux 自动同步 Git 到集群
  └── 和 Helm / Kustomize 配合使用
```

## Kustomize：Overlay 模式

### 工作原理

Kustomize 的核心理念是**不修改原始配置，只描述差异**。它维护一个 `base` 配置和多个 `overlay`，overlay 只描述相对于 base 的变更。

```
myapp/
├── base/
│   ├── kustomization.yaml   # 基础配置引用
│   ├── deployment.yaml       # 通用 Deployment（不含 replica 数）
│   ├── service.yaml          # 通用 Service
│   └── configmap.yaml        # 通用 ConfigMap
├── overlays/
│   ├── development/
│   │   ├── kustomization.yaml  # base + 开发环境 patch
│   │   └── replicas.yaml        # replica: 1
│   ├── staging/
│   │   ├── kustomization.yaml  # base + 预发布环境 patch
│   │   └── replicas.yaml        # replica: 2
│   └── production/
│       ├── kustomization.yaml  # base + 生产环境 patch
│       ├── replicas.yaml        # replica: 10
│       └── resources.yaml        # 高资源配置
```

### 核心配置

```yaml
# base/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
  - configmap.yaml
commonLabels:
  app: myapp
```

```yaml
# base/deployment.yaml（通用配置）
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
        - name: myapp
          image: myapp:v1.0
          ports:
            - containerPort: 8080
          resources: {}  # 由 overlay 指定资源限制
```

```yaml
# overlays/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: production
bases:
  - ../../base
replicas:
  - name: myapp
    count: 10
commonLabels:
  environment: production
patches:
  - path: resources.yaml   # 注入生产资源限制
images:
  - name: myapp:v1.0
    newName: myregistry.com/myapp
    newTag: v1.0.3        # 修改镜像版本
```

### 命令行使用

```bash
# 本地渲染（不部署）
kubectl kustomize overlays/production

# 应用到集群
kubectl apply -k overlays/production

# 预览差异
kubectl diff -k overlays/production
```

## Helm：Chart 包管理

### 工作原理

Helm 把 K8s 应用打包成一个 **Chart**，Chart 包含模板（Templates）和默认值（Values）。用户通过 `values.yaml` 自定义配置，Helm 渲染出最终的 K8s 资源。

```
myapp/
├── Chart.yaml           # Chart 元信息
├── values.yaml          # 默认配置
├── values-production.yaml  # 生产环境覆盖
├── templates/           # Go 模板文件
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── configmap.yaml
│   └── NOTES.txt        # 安装后显示的说明
└── charts/              # 依赖的子 Chart
```

### values.yaml

```yaml
# values.yaml
replicaCount: 1
image:
  repository: myapp
  tag: "v1.0"
  pullPolicy: IfNotPresent
service:
  type: ClusterIP
  port: 80
resources:
  limits:
    cpu: 100m
    memory: 128Mi
  requests:
    cpu: 50m
    memory: 64Mi
```

### 生产环境 values

```yaml
# values-production.yaml
replicaCount: 10
image:
  tag: "v1.0.3"
resources:
  limits:
    cpu: "2"
    memory: 2Gi
  requests:
    cpu: 500m
    memory: 512Mi
autoscaling:
  enabled: true
  minReplicas: 5
  maxReplicas: 20
  targetCPUUtilizationPercentage: 70
```

### 命令行使用

```bash
# 安装
helm install myapp ./myapp-chart -f values-production.yaml -n production

# 升级
helm upgrade myapp ./myapp-chart -f values-production.yaml -n production

# 回滚
helm rollback myapp 1 -n production

# 查看 release 状态
helm list -n production
helm status myapp -n production
helm history myapp -n production
```

### Helm 模板语法

```yaml
# templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}-{{ .Chart.Name }}
  labels:
    app: {{ .Chart.Name }}
    version: {{ .Values.image.tag }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app: {{ .Chart.Name }}
  template:
    metadata:
      labels:
        app: {{ .Chart.Name }}
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - containerPort: {{ .Values.service.port }}
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
{{- if .Values.autoscaling.enabled }}
---
# HPA 资源
{{- end }}
```

## Kustomize vs Helm：核心差异

| 维度 | Kustomize | Helm |
|------|-----------|------|
| 核心机制 | Overlay（差异化补丁） | Template（模板渲染） |
| 学习曲线 | 低（纯 YAML） | 中（需要理解 Go 模板语法） |
| 条件逻辑 | 有限（patches、generators） | 强大（if/else/loop/函数） |
| 包分发 | 不支持（直接在 Git 管理） | 支持（Chart Hub / 私有仓库） |
| 依赖管理 | 不支持 | 支持（Chart 依赖） |
| 版本管理 | 不内置 | 内置（Release History） |
| 适用场景 | 同一应用的多个环境 | 可分发的应用包 |
| 生态 | K8s 原生集成 | 最大的 K8s 应用生态 |

## GitOps 工作流

### 核心原则

GitOps 是 Weaveworks 提出的一种运维方法论，它把 Git 作为系统的唯一真相来源：

```
┌─────────────────────────────────────────────────────────────┐
│                      Git Repository                          │
│                                                             │
│  apps/myapp/                                                │
│  ├── base/deployment.yaml                                   │
│  └── overlays/production/kustomization.yaml                 │
│                                                             │
│  Git 的期望状态 ──────────────────────────────────────────►│
│                                                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     ArgoCD / Flux                            │
│                                                             │
│  持续监控 Git ──► 对比集群实际状态 ──► 自动同步差异         │
│                                                             │
│  如果 Git 更新了？自动部署到集群                              │
│  如果有人手动改了集群？ArgoCD 检测到差异，自动恢复           │
└─────────────────────────────────────────────────────────────┘
```

### ArgoCD 工作方式

```yaml
# argocd-application.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp-prod
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/myapp.git
    targetRevision: main
    path: kustomize/overlays/production
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true          # 自动删除 Git 中没有的资源
      selfHeal: true       # 自动恢复 Git 指定的期望状态
      allowEmpty: false
    syncOptions:
      - CreateNamespace=true
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
```

### ArgoCD 的优势

```
手动运维流程：
  开发者 ──► CI Pipeline ──► kubectl apply ──► 人工确认 ──► 完成

GitOps 流程：
  开发者 ──► CI Pipeline ──► git push ──► ArgoCD 自动同步到集群
                    ▲
                    │
              代码合并触发 CI
              测试通过后自动更新镜像 tag
```

1. **Audit Trail**：所有变更都有 Git 历史，who changed what，when
2. **快速回滚**：`git revert` 或 `git checkout` 到旧版本
3. **安全**：不需要给 CI/CD Pipeline 写权限给 K8s，直接推 Git
4. **自愈**：ArgoCD 持续监控，自动恢复被手动修改的集群状态

## 选型建议

```
需要分发给外部用户或客户 ──► Helm（Chart 分发生态成熟）

同一团队的多环境管理 ──► Kustomize（简单直接，YAML 直观）
  └─► 配合 ArgoCD/Flux 实现 GitOps

需要强大的条件逻辑和模板 ──► Helm
  └─► 配合 ArgoCD（ArgoCD 原生支持 Helm）

已有 Helm Chart ──► ArgoCD 直接支持，无需迁移
```

## 面试追问方向

- Kustomize 的 `patchesStrategicMerge` 和 `patchesJSON6902` 有什么区别？
- Helm 的 `values.yaml` 优先级是什么？（Chart 默认 < values 文件 < --set < CLI）
- GitOps 的 `prune` 和 `selfHeal` 各解决了什么问题？为什么这两个选项很重要？
- ArgoCD 如何处理多集群部署？一个 Application 可以同时部署到多个集群吗？

> Kustomize 和 Helm 是工具，GitOps 是方法论。理解 GitOps 的核心价值后，选择哪个工具就变得清晰了——它只是一个「把 Git 推上去，然后让 ArgoCD 自动同步」的流程。
