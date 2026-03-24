# KubeSphere GitOps 工作流集成

「Git 是唯一的事实来源」——GitOps 让部署声明式、可审计、可回滚。

GitOps 是 KubeSphere DevOps 的进阶形态。区别于传统的「CI 推送镜像后手动部署」，GitOps 实现了「代码提交 → 自动同步 → 自动部署」的全链路自动化，且部署状态始终与 Git 仓库保持一致。

## GitOps 核心理念

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitOps 核心思想                                  │
│                                                                  │
│  传统 CI/CD                                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  代码提交 → CI 构建镜像 → Push 镜像 → kubectl apply   │   │
│  └──────────────────────────────────────────────────────────┘   │
│  问题：部署状态由 CI 系统控制，Git 不是唯一事实来源              │
│                                                                  │
│  GitOps                                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  代码提交 → CI 构建镜像 → Push 镜像                    │   │
│  │                                    ↓                     │   │
│  │  Git 仓库（镜像 Tag）←────────────────── ArgoCD 监听  │   │
│  │                                    ↓                     │   │
│  │                              K8s 自动同步部署            │   │
│  └──────────────────────────────────────────────────────────┘   │
│  优势：部署状态始终等于 Git 状态，一键回滚到任意版本            │
└─────────────────────────────────────────────────────────────────┘
```

## GitOps 工作流

```
┌─────────────────────────────────────────────────────────────────┐
│                    KubeSphere GitOps 流程                          │
│                                                                  │
│  开发者提交代码                                                 │
│     │                                                          │
│     ▼                                                          │
│  Git 仓库（代码）                                              │
│     │                                                          │
│     ├─── GitHub Actions / KubeSphere 流水线 ──────────────┐   │
│     │                                                          │
│     ├─── 构建镜像 ──── docker build ──── push to Harbor ──┘   │
│     │                                                          │
│     ▼                                                          │
│  Git 仓库（部署配置：kustomize/helm values）                  │
│     │                                                          │
│     │   更新镜像 Tag                                            │
│     │   image: harbor.example.com/project-a/app:v2.0.0        │
│     │                                                          │
│     ▼                                                          │
│  ArgoCD / Flux 监听 Git 变化                                   │
│     │                                                          │
│     ▼                                                          │
│  自动同步到 K8s 集群                                           │
│     │                                                          │
│     ▼                                                          │
│  KubeSphere 展示部署状态                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Git 状态 ✅  ←→  集群状态 ✅   同步中...                  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## KubeSphere + ArgoCD 集成

### ArgoCD 安装

```yaml
# 在 KubeSphere 中通过 YAML 安装 ArgoCD
apiVersion: v1
kind: Namespace
metadata:
  name: argocd
---
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp-gitops
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/myapp-deploy.git
    targetRevision: main
    path: overlays/production
    kustomize:
      images:
        # Kustomize 自动替换镜像版本
        - myapp=harbor.example.com/project-a/myapp:v2.0.0
  destination:
    server: https://kubernetes.default.svc
    namespace: my-project
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

### 部署配置结构

```bash
# GitOps 仓库结构
# myorg/myapp-deploy/
#
# ├── base/
# │   ├── deployment.yaml     # 基础 Deployment（镜像占位符）
# │   ├── service.yaml
# │   ├── ingress.yaml
# │   └── kustomization.yaml
# │
# ├── overlays/
# │   ├── dev/
# │   │   ├── kustomization.yaml   # dev 环境配置
# │   │   └── patches.yaml        # dev 专用配置
# │   ├── test/
# │   │   ├── kustomization.yaml
# │   │   └── patches.yaml
# │   └── production/
# │       ├── kustomization.yaml   # production 环境配置
# │       └── patches.yaml
# │
# └── README.md
```

### Kustomization 配置

```yaml
# overlays/production/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: my-project

resources:
  - ../../base/deployment.yaml
  - ../../base/service.yaml
  - ../../base/ingress.yaml

# 镜像配置
images:
  - name: myapp
    newName: harbor.example.com/project-a/myapp
    newTag: v1.0.0  # ArgoCD 会自动更新此 Tag

# patches 调整配置
patches:
  - patch: |-
      apiVersion: apps/v1
      kind: Deployment
      metadata:
        name: myapp
      spec:
        replicas: 3
    target:
      kind: Deployment

# commonLabels 确保所有资源带有环境标签
commonLabels:
  environment: production
  managed-by: argocd
```

## 自动镜像更新

### Renovate Bot

```json
// renovate.json 配置
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "config:base"
  ],
  "packageRules": [
    {
      "matchDatasources": ["docker"],
      "groupName": "docker images",
      "schedule": ["every 2 hours"]
    }
  ],
  "kustomize": {
    "enabled": true
  },
  "commitMessageAction": "Update",
  "commitMessagePrefix": "[KubeSphere]",
  "prTitle": "Chore: Update Docker images",
  "automerge": false
}
```

### Image Updater

```yaml
# ArgoCD Image Updater 配置
apiVersion: argoproj.io/v1alpha1
kind: ArgoCD
metadata:
  name: argocd
  namespace: argocd
spec:
  imageUpdater:
    enabled: true
    registries:
      - name: Harbor
        api: https://harbor.example.com/v2
        credentials: pullsecret:harbor/harbor-secret
        defaultns: project-a
```

## 流水线中的 GitOps

```groovy
// KubeSphere 流水线触发 ArgoCD 自动部署
pipeline {
    agent any

    environment {
        DEPLOY_REPO = 'https://github.com/myorg/myapp-deploy.git'
        DEPLOY_BRANCH = 'main'
        APP_NAME = 'myapp'
        IMAGE_REGISTRY = 'harbor.example.com/project-a'
        GIT_TOKEN = credentials('github-token')
    }

    stages {
        stage('拉取代码') {
            steps {
                checkout scm
            }
        }

        stage('Maven 构建') {
            steps {
                container('maven') {
                    sh 'mvn clean package -DskipTests'
                }
            }
        }

        stage('构建并推送镜像') {
            steps {
                container('docker') {
                    script {
                        env.IMAGE_TAG = "v${BUILD_NUMBER}"
                    }
                    sh """
                        docker build -t ${IMAGE_REGISTRY}/${APP_NAME}:${IMAGE_TAG} .
                        docker push ${IMAGE_REGISTRY}/${APP_NAME}:${IMAGE_TAG}
                    """
                }
            }
        }

        stage('更新 GitOps 仓库') {
            steps {
                sh """
                    # 克隆部署配置仓库
                    git clone ${DEPLOY_REPO} deploy-repo
                    cd deploy-repo

                    # 切换到目标分支
                    git config user.email "ci@kubesphere"
                    git config user.name "CI Bot"

                    # 更新 Kustomize 镜像版本
                    # 方式一：使用 yq 修改
                    yq -i '.images[0].newTag = "${IMAGE_TAG}"' overlays/production/kustomization.yaml

                    # 方式二：使用 sed 修改
                    sed -i 's/newTag: v.*/newTag: ${IMAGE_TAG}/' overlays/production/kustomization.yaml

                    # 提交并推送
                    git add .
                    git commit -m "Chore: Update ${APP_NAME} to ${IMAGE_TAG} [skip ci]"
                    git push origin ${DEPLOY_BRANCH}
                """
            }
        }
    }

    post {
        success {
            echo 'GitOps 流程完成，ArgoCD 将自动同步部署'
        }
    }
}
```

## ArgoCD 同步策略

```yaml
# ArgoCD Application 的高级同步策略
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp
  namespace: argocd
spec:
  syncPolicy:
    # 自动同步
    automated:
      prune: true          # 自动删除 Git 中不存在的资源
      selfHeal: true        # 集群状态与 Git 不一致时自动修复
      allowEmpty: false     # 不允许空 Application

    # 同步选项
    syncOptions:
      - CreateNamespace=true           # 自动创建 Namespace
      - PruneLast=true                  # 最后执行清理
      - Validate=true                  # 启用验证
      - RespectIgnoreDifferences=true   # 尊重忽略差异的配置

    # 资源超时
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
```

## 多集群 GitOps

```yaml
# 多集群部署：开发、测试、生产分别在不同集群
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp-dev
  namespace: argocd
spec:
  destination:
    server: https://dev-cluster.k8s.local
    namespace: my-project-dev

---
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp-prod
  namespace: argocd
spec:
  destination:
    server: https://prod-cluster.k8s.local
    namespace: my-project-prod
  syncPolicy:
    automated:
      # 生产环境建议关闭自动同步，改为手动审批
      prune: false
      selfHeal: false
```

## 最佳实践

### GitOps 仓库隔离

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitOps 仓库规划                                  │
│                                                                  │
│  方式一：每个应用一个 GitOps 仓库（推荐）                         │
│  myorg/myapp-deploy/    →  myapp 的部署配置                    │
│  myorg/usersvc-deploy/  →  usersvc 的部署配置                  │
│                                                                  │
│  方式二：按环境隔离                                              │
│  myorg/deploy-dev/      →  所有应用的 dev 环境配置               │
│  myorg/deploy-prod/     →  所有应用的 prod 环境配置             │
│                                                                  │
│  方式三：每个环境一个 GitOps 仓库                                │
│  myorg/myapp-deploy-dev/    →  dev 专用                        │
│  myorg/myapp-deploy-prod/    →  prod 专用                       │
│                                                                  │
│  建议：方式一，每个应用的部署配置独立管理，减少相互影响            │
└─────────────────────────────────────────────────────────────────┘
```

### 审批门控

```yaml
# 生产环境的 ArgoCD 配置：禁用自动同步
spec:
  syncPolicy:
    automated: null    # 禁用自动同步
# 生产环境部署流程：
# 1. GitOps 仓库更新镜像 Tag
# 2. ArgoCD 检测到变化，状态变为 OutOfSync
# 3. 运维人员在 ArgoCD UI 中 Review 变更
# 4. 点击 Sync，手动同步部署
# 5. 观察部署结果，确认无误后完成
```

## 面试追问方向

1. **GitOps 和传统 CI/CD 的本质区别是什么？**
   答：传统 CI/CD 是「推」（Push）模式——CI 系统构建镜像后，主动推送部署到集群。GitOps 是「拉」（Pull）模式——Git 是唯一事实来源，GitOps 工具（如 ArgoCD）持续监听 Git 仓库，自动拉取并应用部署。GitOps 的优势：部署状态始终可审计、一键回滚到任意版本、集群被意外修改会自动恢复。

2. **ArgoCD 和 Flux 有什么区别？**
   答：两者都是 GitOps 工具。ArgoCD 是 CNCF 毕业项目，UI 友好、配置简单、理念直观，适合喜欢图形化管理的团队。Flux 是 GitOps 工具链（Flux v2 = FluxCD），功能更强大、定制化程度更高，适合深度集成的场景。KubeSphere 从 4.4 版本开始内置了对 ArgoCD 的支持。

3. **GitOps 如何处理敏感信息？**
   答：敏感信息（密码、密钥）不应该放在 Git 仓库中。解决方案：1) 使用 Sealed Secret 或 External Secret——将加密后的 Secret 存 Git，运行时由 Operator 解密；2) 使用 Vault——部署时从 Vault 动态注入；3) K8s 的 EncryptionConfig——对 Secret 加密存储，Git 中存加密后的内容。

> "GitOps 的本质，是把 Git 打造成部署的唯一入口。任何人想部署代码，必须走 Git——没有 Git 的变更，不允许出现在集群中。这不仅让部署变得可审计，更让『回滚到任意版本』变成了一行 git revert 的事。"
