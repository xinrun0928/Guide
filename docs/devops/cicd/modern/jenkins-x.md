# Jenkins X：Kubernetes 原生 CI/CD

「Jenkins X 是什么？」——基于 Jenkins 的 Kubernetes 原生 CI/CD 平台，GitOps 驱动，开箱即用。

Jenkins X 最初是 Jenkins 社区为 Kubernetes 打造的扩展，后来从 Jenkins 独立出来，演变成了独立的开源项目jx。它的目标是：一条命令，在 K8s 上搭建完整的 CI/CD 环境。

## 核心概念

```
┌─────────────────────────────────────────────────────────────────┐
│                    Jenkins X 架构                                 │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  jx CLI      │  │  GitOps Repo │  │  Boot        │         │
│  │  (命令行)    │──►│  (配置仓库)  │──►│  (安装器)    │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                            │                                     │
│         ┌──────────────────┼──────────────────┐                  │
│         ▼                  ▼                  ▼                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Nexus /     │  │  ChartMuse  │  │  Lighthouse  │         │
│  │  Harbor      │  │  (Helm Repo) │  │  (Webhooks)  │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │              Kubernetes (Jenkins, Tekton, Vault)            ││
│  └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## 安装 Jenkins X

```bash
# 前提：已有 Kubernetes 集群和 Helm 3
brew install jx

# 创建新的 Jenkins X 集群
jx boot --provider=kubernetes

# 或者使用 jx create cluster（已废弃，推荐 boot 方式）
```

### 配置 Jenkins X Boot

```yaml
# jx-requirements.yaml
apiVersion: core.jenkins-x.io/v4beta1
kind: Requirements
spec:
  autoUpdate:
    enabled: true
    schedule: "0 */4 * * *"
  cluster:
    chartRepository: http://jenkins-x-chartmuseum:8080
    clusterName: my-cluster
    environmentGitOwner: my-org
    gitops: true
    provider: kubernetes
  environments:
    - key: dev
      owner: my-org
      repository: my-org-environment-dev
    - key: staging
      owner: my-org
      repository: my-org-environment-staging
    - key: production
      owner: my-org
      repository: my-org-environment-production
  ingress:
    domain: jenkinsx.example.com
    externalDNS: true
    tls:
      email: "admin@jenkinsx.example.com"
      enabled: true
  pipelineUser:
    username: "jenkins-x-pipeline"
  secretStorage: vault
  storage:
    logs:
      enabled: true
      url: gs://jx-logs
    reports:
      enabled: true
      url: gs://jx-reports
    repository:
      enabled: true
      url: gs://jx-repository
  vault: {}
  versionStream:
    ref: master
    url: https://github.com/jenkins-x/jenkins-x-boot-config
```

## 创建应用

```bash
# 使用 Spring Boot 模板创建应用
jx create spring -d web -d actuator

# 查看创建的应用
jx get applications

# 查看流水线
jx get pipelines
```

### 项目结构

```bash
my-app/
├── Jenkinsfile          # 流水线定义
├── README.md
├── mvnw
├── pom.xml
└── src/
    └── main/
        ├── java/
        └── resources/
```

```groovy
// Jenkinsfile（由 jx 自动生成）
pipeline {
  agent {
    label "jenkins-maven"
  }
  environment {
    DEPLOYMENT_NAME = "my-app"
    APP_NAME = "my-app"
  }
  stages {
    stage('CI Build and Test') {
      steps {
        container('maven') {
          sh "mvn clean deploy"
        }
      }
    }
    stage('Build Release') {
      steps {
        container('maven') {
          sh "jx step changelog --version v\${VERSION}"
          sh "jx step helm release"
        }
      }
    }
    stage('Promote to Environments') {
      steps {
        dir('charts/my-app') {
          script {
            def environments = ['dev', 'staging', 'production']
            environments.each { env ->
              sh "jx promote --version \${VERSION} --env ${env} --no-git-operator"
            }
          }
        }
      }
    }
  }
}
```

## GitOps 流程

Jenkins X 的核心是 GitOps。每个环境对应一个 Git 仓库：

```
my-org/
├── my-app/                    # 应用代码仓库
│   └── Jenkinsfile
├── my-org-environment-dev/    # 开发环境配置
│   ├── README.md
│   └── env/
│       ├── Chart.yaml
│       ├── requirements.yaml
│       └── values.yaml
├── my-org-environment-staging/ # 预发环境配置
└── my-org-environment-prod/   # 生产环境配置
```

### 环境 promotion

```bash
# 手动 promote
jx promote my-app --version 1.2.3 --env staging

# 查看 promotion 状态
jx get promotion
```

### 自动 promotion 策略

```yaml
# env/requirements.yaml (staging 环境)
dependencies:
  - alias: my-app
    name: my-app
    repository: http://jenkins-x-chartmuseum:8080
    version: 1.2.3
```

## 环境配置

```bash
# 创建新环境
jx create env staging \
  --git-server=https://github.com \
  --git-token=xxx

# 查看所有环境
jx get env
```

## 与其他 CI/CD 工具对比

| 维度 | Jenkins X | Tekton | ArgoCD | GitLab CI |
|------|-----------|--------|--------|-----------|
| 定位 | 平台型 | 框架型 | 工具型 | 工具型 |
| 安装难度 | 中 | 低 | 低 | 中 |
| GitOps | 原生 | 支持 | 核心 | 支持 |
| UI | 有 | 需 Dashboard | 优秀 | 优秀 |
| 扩展性 | 依赖 Jenkins | 依赖 Tekton CRD | 扩展 CRD | 插件 |
| 适用规模 | 中大型 | 任意 | 任意 | 任意 |
| 维护成本 | 中 | 低 | 低 | 中 |
| 新项目推荐 | 一般 | 是 | 是 | 是 |

## 常见操作

```bash
# 导入现有应用到 Jenkins X
jx import

# 创建 quickstart 项目
jx create quickstart

# 查看流水线日志
jx get build logs my-org/my-app/main

# 更新平台版本
jx upgrade platform

# 查看版本流（依赖版本）
jx get version-stream
```

## 面试追问方向

1. **Jenkins X 和传统 Jenkins 的本质区别是什么？**
   答：Jenkins X 把流水线跑在 K8s Pod 里（动态 Agent），通过 GitOps 管理环境配置，使用 Jenkinsfile Pipeline 语法，但底层可以是 Tekton。传统 Jenkins 通过 JNLP 或 SSH 连接外部节点。

2. **Jenkins X 的 GitOps 是怎么工作的？**
   答：每个环境对应一个 Git 仓库（Environment Repo）。应用发布时，Jenkins X 修改对应环境的 Git 仓库，ArgoCD 或 Tiller 检测到变更后自动同步到 K8s。

3. **Jenkins X 使用什么作为执行引擎？**
   答：新版本（Jenkins X 3.x）使用 Tekton 作为执行引擎。旧版本（2.x）使用 Jenkins Master-Slave 模型。

4. **什么时候选择 Jenkins X 而不是 Tekton 或 ArgoCD？**
   答：当你需要一个开箱即用的平台，不需要从零搭建流水线、配置环境时，Jenkins X 是一个选择。但它的生态相对小众，对于 K8s 原生项目，Tekton + ArgoCD 的组合更主流。

Jenkins X 的价值在于「一键搭建完整 CI/CD」，但随着 Tekton 和 ArgoCD 生态的成熟，它的独特优势在缩小。对于新项目，建议直接用 Tekton + ArgoCD。
