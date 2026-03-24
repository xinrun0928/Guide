# ArgoCD 实战指南

想象一下：每次代码提交后，K8s 集群里的服务自动更新了——不需要手动 `kubectl apply`，不需要登录服务器，流水线跑完，应用就上线了。

这就是 GitOps，而 ArgoCD 是 GitOps 的标杆实现。

## GitOps 是什么？

```
┌─────────────────────────────────────────────────────────────┐
│                        GitOps 流程                           │
│                                                              │
│  ┌──────────┐     ┌──────────┐     ┌──────────────┐        │
│  │  代码提交 │────►│ Git Repo │────►│  ArgoCD      │        │
│  │          │     │ (声明式)  │     │  检测差异      │        │
│  └──────────┘     └──────────┘     └──────┬───────┘        │
│                                           │                  │
│  ┌──────────┐                            ▼                  │
│  │  K8s     │◄───────────────────── 自动同步               │
│  │  集群    │                                                   │
│  └──────────┘                                                   │
└─────────────────────────────────────────────────────────────┘
```

**核心思想**：把 K8s 的 YAML 配置放在 Git 里，用 ArgoCD 监控 Git 和集群的状态差异，自动同步。

## 核心概念

```
┌───────────────────────────────────────────────────────┐
│                  ArgoCD 核心对象                        │
│                                                        │
│  Application (应用)                                     │
│  ├── name: my-app                                     │
│  ├── spec.source.repoURL: git@github.com:user/repo    │
│  ├── spec.source.path: k8s/                           │
│  ├── spec.source.targetRevision: HEAD                 │
│  └── spec.destination.server: https://kubernetes.default.svc │
│                                                        │
│  ApplicationSet (应用集) — 批量创建 Application         │
│  ├── generators: [list, git, matrix, ...]              │
│  └── template: (应用模板)                               │
│                                                        │
│  Project (项目) — 隔离和权限控制                        │
│  ├── spec.sourceRepos: [*]                            │
│  ├── spec.destinations: [*]                           │
│  └── spec.roles: [...]                                │
└───────────────────────────────────────────────────────┘
```

## ArgoCD 安装

```bash
# 方式一：kubectl 安装
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# 方式二：Helm 安装（生产推荐）
helm repo add argo https://argoproj.github.io/argo-helm
helm install argocd argo/argo-cd \
  --namespace argocd \
  --create-namespace \
  --set server ingress.enabled=true \
  --values values.yaml
```

### CLI 工具

```bash
# 下载 ArgoCD CLI
brew install argocd

# 登录 ArgoCD（获取初始密码）
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" | base64 -d
argocd login localhost:8080  # 或 argocd login <your-argocd-server>

# 集群配置（让 ArgoCD 管理另一个集群）
argocd cluster add <context-name> --name <cluster-alias>
```

## Application 定义

### 基本用法

```yaml
# my-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  project: default

  source:
    repoURL: https://github.com/my-org/k8s-manifests.git
    targetRevision: HEAD
    path: apps/my-app/overlays/production
    # 或指定 Helm values
    helm:
      valueFiles:
        - values-prod.yaml
      parameters:
        - name: image.tag
          value: latest

  destination:
    server: https://kubernetes.default.svc
    namespace: production

  syncPolicy:
    automated:
      prune: true           # 自动删除集群里有但 Git 里没有的资源
      selfHeal: true        # 自动修复手动修改的资源
      allowEmpty: false
    syncOptions:
      - CreateNamespace=true
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
```

### 部署多个环境

```yaml
# apps/project-a/values.yaml
environments:
  staging:
    replicas: 2
    imageTag: "staging-latest"
  production:
    replicas: 5
    imageTag: "stable"
```

```bash
argocd app create project-a-staging \
  --repo https://github.com/my-org/k8s-manifests.git \
  --path "apps/project-a" \
  --dest-server https://kubernetes.default.svc \
  --dest-namespace staging \
  --helm-set environment=staging

argocd app create project-a-production \
  --repo https://github.com/my-org/k8s-manifests.git \
  --path "apps/project-a" \
  --dest-server https://kubernetes.default.svc \
  --dest-namespace production \
  --helm-set environment=production
```

## ApplicationSet：批量部署

```yaml
apiVersion: argoproj.io/v1alpha1
kind: ApplicationSet
metadata:
  name: microservice-set
  namespace: argocd
spec:
  generators:
    # 从 Git 目录列表读取
    - git:
        repoURL: https://github.com/my-org/microservices.git
        revision: HEAD
        directories:
          - path: services/*
    # 或从集群列表生成
    - clusters:
        selector:
          matchLabels:
            environment: production

  template:
    metadata:
      name: '{{path.basename}}'
    spec:
      project: default
      source:
        repoURL: https://github.com/my-org/microservices.git
        path: 'services/{{path.basename}}'
        targetRevision: HEAD
      destination:
        server: '{{server}}'
        namespace: microservices
      syncPolicy:
        automated:
          prune: true
          selfHeal: true
```

## Project 隔离

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: backend
  namespace: argocd
spec:
  description: Backend Services Project

  sourceRepos:
    - 'https://github.com/my-org/backend-*'
    - 'git@github.com:my-org/shared-lib.git'

  destinations:
    - server: https://kubernetes.default.svc
      namespace: backend
    - server: https://eks-cluster.example.com
      namespace: backend

  # 禁止部署危险的资源类型
  deniedNamespaces: [*]
  clusterResourceWhitelist:
    - group: ""
      kind: Namespace
    - group: ""
      kind: ResourceQuota

  roles:
    - name: developer
      description: Deploy to staging
      groups:
        - my-org:developers
      policies:
        - p, proj:backend:developer, applications, *, backend/*, allow
```

## 同步策略

### 手动同步

```yaml
spec:
  syncPolicy:
    automated: null  # 禁用自动同步
```

### 蓝绿部署

```yaml
spec:
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
  postSync:
    hooks:
      - name: smoke-test
        type: Exec
        exec:
          command:
            - kubectl
            - -n
            - production
            - exec
            - deploy/my-app
            - --curl
            - http://localhost:8080/health
        timeout:
          duration: 5m
```

### 多集群同步

```bash
# 添加外部集群
argocd cluster add eks-prod --name prod-cluster
argocd cluster add eks-staging --name staging-cluster

# 在 ArgoCD 中查看所有注册的集群
argocd cluster list
```

## 访问控制：RBAC

```yaml
# argocd-rbac-cm ConfigMap
apiVersion: v1
kind: ConfigMap
metadata:
  name: argocd-rbac-cm
  namespace: argocd
data:
  # 默认为 strict mode（无匿名访问）
  policy.default: role:readonly

  # 定义策略
  policy.csv: |
    p, role:developer, applications, get, my-org/*, allow
    p, role:developer, applications, sync, my-org/*, allow
    p, role:developer, applications, action/custom-action, my-org/*, allow

    g, my-org:developers, role:developer
    g, my-org:admins, role:admin
```

## CI/CD 集成

### GitHub Actions + ArgoCD

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Update image tag
        run: |
          # 更新 kustomization.yaml 中的镜像版本
          yq e '.images[0].newTag = "${{ github.sha }}"' -i k8s/production/kustomization.yaml

      - name: Commit and push
        run: |
          git config user.name "GitHub Actions"
          git add .
          git commit -m "Update image to ${{ github.sha }}"
          git push

      # ArgoCD 检测到 Git 变更后会自动同步
```

### GitLab CI + ArgoCD

```yaml
# .gitlab-ci.yml
deploy-production:
  stage: deploy
  image: bitnami/kubectl:latest
  before_script:
    - argocd login argocd.example.com --username $ARGOCD_USER --password $ARGOCD_PASS --insecure
  script:
    - argocd app set my-app --helm-set image.tag=$CI_COMMIT_SHA
    - argocd app sync my-app --force
  only:
    - main
```

## 日常操作

```bash
# CLI 操作
argocd app list                    # 查看所有应用
argocd app get my-app              # 查看应用详情
argocd app sync my-app             # 手动同步
argocd app rollback my-app v12     # 回滚到某个版本
argocd app history my-app          # 查看同步历史

# 查看同步状态
argocd app wait my-app --sync      # 等待同步完成
argocd app status my-app           # 查看详细状态

# 删除应用（保留集群资源）
argocd app delete my-app --cascade=false
```

## ArgoCD vs Flux vs Argo Rollouts

| 维度 | ArgoCD | Flux | Argo Rollouts |
|------|--------|------|---------------|
| 厂商 | Akuity (商业) | Weaveworks (商业) | Akuity |
| 声明式 | 原生支持 | 原生支持 | 扩展 CRD |
| UI | 优秀 | 一般 | 需要配合 ArgoCD |
| 多集群 | 优秀 | 好 | 优秀 |
| 自动回滚 | 支持 | 支持 | 支持（高级策略） |
| 金丝雀发布 | 需要配合 Argo Rollouts | 需要配合 Flagger | 原生支持 |

## 常见问题

### ArgoCD 检测不到 Git 变更

检查 webhook 是否配置：
```bash
argocd repo add https://github.com/my-org/repo --type git --name my-repo
```

### Sync 卡住

```bash
# 查看 pod 状态
kubectl get pods -n argocd | grep application-controller

# 查看日志
kubectl logs -n argocd -l app.kubernetes.io/name=argocd-application-controller --tail=100

# 强制同步
argocd app sync my-app --force
```

### RBAC 权限问题

确保 `argocd-rbac-cm` 中的策略正确加载，测试：

```bash
argocd account can-i get applications/my-app
```

## 面试追问方向

1. **GitOps 的核心优势是什么？**
   答：环境一致性、可审计性、快速回滚、自助部署。Git 是单一真相来源，任何变更都有记录。

2. **ArgoCD 和 Flux 的区别？**
   答：ArgoCD 有更成熟的 UI，多集群管理更方便；Flux 和 GitOps 理念结合更紧密，支持 Kustomize 和 Helm 更原生。

3. **如何实现金丝雀发布？**
   答：需要 Argo Rollouts 或 Flagger。它会根据流量百分比逐步调整权重，观察指标（错误率、延迟）后决定是否全量升级。

4. **ArgoCD 如何处理密钥？**
   答：ArgoCD 支持集成 Vault、AWS Secrets Manager、Azure Key Vault 等外部密钥管理工具，也可以在 Git 中加密存储。

GitOps 彻底改变了部署方式——从「人指挥机器」，变成「机器跟随 Git」。ArgoCD 是这个理念最成熟的开源实现。
