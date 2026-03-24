# KubeSphere 流水线：基于 Jenkins 的 CI/CD

「KubeSphere 的流水线是怎么跑起来的？」——图形化 Jenkins，不需要懂 Jenkins 也能用。

KubeSphere 的 DevOps 模块基于 Jenkins 和 Jenkins Kubernetes Plugin，提供图形化的流水线编辑能力。开发者可以在 Web 界面中拖拽创建 CI/CD 流水线，不需要写 Jenkinsfile，也不需要懂 Jenkins 的内部原理。

## 流水线架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    KubeSphere DevOps 架构                         │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              KubeSphere Console（图形化编辑）               │   │
│  │                                                          │   │
│  │  ┌────────────────────────────────────────────────────┐ │   │
│  │  │              Jenkins Kubernetes Plugin               │ │   │
│  │  │                                                      │ │   │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐         │ │   │
│  │  │  │ Stage 1  │→│ Stage 2  │→│ Stage 3  │         │ │   │
│  │  │  │ Build    │  │ Test    │  │ Deploy   │         │ │   │
│  │  │  └──────────┘  └──────────┘  └──────────┘         │ │   │
│  │  └────────────────────────────────────────────────────┘ │   │
│  │                         │                              │   │
│  │  ┌──────────────────────┴──────────────────────────┐   │   │
│  │  │              Jenkins Master（Pod）                  │   │   │
│  │  │  - 调度流水线执行                                    │   │   │
│  │  │  - 存储流水线定义                                   │   │   │
│  │  │  - 管理 Agent                                       │   │   │
│  │  └──────────────────────┬──────────────────────────┘   │   │
│  └─────────────────────────┼──────────────────────────────┘   │
│                             │ Jenkins Agent (按需创建)           │
│         ┌───────────────────┼───────────────────┐               │
│         ▼                   ▼                   ▼               │
│  ┌────────────┐       ┌────────────┐       ┌────────────┐        │
│  │  Agent 1   │       │  Agent 2   │       │  Agent N   │        │
│  │ (maven)    │       │ (nodejs)   │       │ (docker)   │        │
│  │ (构建 JDK) │       │ (构建前端) │       │ (构建镜像) │        │
│  └────────────┘       └────────────┘       └────────────┘        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    集成服务                               │   │
│  │  SonarQube（代码质量）| Harbor（镜像仓库）| 制品库（Binary）│   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 流水线创建流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    流水线创建步骤                                 │
│                                                                  │
│  1. 准备阶段                                                     │
│     → 创建 DevOps Project                                        │
│     → 关联代码仓库（Git/GitHub/GitLab）                         │
│     → 配置凭证（用户名密码/SSH Key/Token）                       │
│                                                                  │
│  2. 创建阶段                                                     │
│     → 新建流水线 → 填写基本信息                                 │
│     → 添加构建片段（图形化或 Jenkinsfile）                       │
│     → 配置构建参数（可选）                                       │
│                                                                  │
│  3. 执行阶段                                                     │
│     → 运行流水线 → 查看构建日志                                   │
│     → 质量门槛检查 → 自动部署（可选）                             │
│                                                                  │
│  4. 运维阶段                                                     │
│     → 查看历史记录 → 分析失败原因                                │
│     → 重新运行 → 回滚                                            │
└─────────────────────────────────────────────────────────────────┘
```

## 图形化流水线配置

### 阶段与步骤

```yaml
# KubeSphere 图形化流水线会生成 Jenkinsfile
# 以下是生成的 Jenkinsfile 示例

pipeline {
  agent {
    kubernetes {
      label 'maven-agent'
      defaultContainer 'maven'
    }
  }

  environment {
    DOCKER_REGISTRY = 'harbor.example.com'
    APP_NAME = 'myapp'
    REGISTRY_CREDENTIAL = 'harbor-credential'
  }

  stages {
    stage('Checkout') {
      steps {
        container('maven') {
          checkout scm
        }
      }
    }

    stage('Build') {
      steps {
        container('maven') {
          sh 'mvn clean package -DskipTests'
        }
      }
    }

    stage('Test') {
      steps {
        container('maven') {
          sh 'mvn test'
        }
      }
    }

    stage('SonarQube') {
      steps {
        container('maven') {
          withSonarQubeEnv('SonarQube') {
            sh 'mvn sonar:sonar'
          }
        }
      }
    }

    stage('Build Image') {
      steps {
        container('maven') {
          sh """
            docker build -t ${DOCKER_REGISTRY}/${APP_NAME}:${BUILD_NUMBER} .
            docker push ${DOCKER_REGISTRY}/${APP_NAME}:${BUILD_NUMBER}
          """
        }
      }
    }

    stage('Deploy to Dev') {
      steps {
        sh """
          sed 's|IMAGE_TAG|${BUILD_NUMBER}|g' deploy/dev/deployment.yaml | kubectl apply -f -
        """
      }
    }
  }

  post {
    always {
      cleanWs()
    }
    failure {
      echo 'Pipeline failed. Check logs.'
    }
  }
}
```

### 常用构建片段

```
┌─────────────────────────────────────────────────────────────────┐
│                    常用构建片段                                    │
│                                                                  │
│  Git 拉取                                                        │
│  - 从代码仓库拉取代码                                             │
│  - 支持 GitHub、GitLab、SVN                                      │
│                                                                  │
│  Maven 构建                                                      │
│  - mvn clean package                                             │
│  - mvn test                                                      │
│  - mvn deploy                                                    │
│                                                                  │
│  Docker 构建                                                     │
│  - 构建镜像                                                      │
│  - 推送到镜像仓库                                                │
│                                                                  │
│  SonarQube 扫描                                                  │
│  - 代码质量检查                                                  │
│  - 质量门槛验证                                                  │
│                                                                  │
│  部署到 Kubernetes                                              │
│  - kubectl apply                                                 │
│  - kubectl set image                                            │
│                                                                  │
│  二进制制品上传                                                  │
│  - 上传到 JFrog Artifactory                                      │
│  - 下载特定版本制品                                              │
└─────────────────────────────────────────────────────────────────┘
```

## 凭证管理

KubeSphere 支持多种凭证类型：

```bash
# 1. 用户名密码
# 用途：Git 仓库登录、镜像仓库登录
username: git-user
password: git-password

# 2. SSH Key
# 用途：Git SSH 方式拉取代码
privateKey: |
  -----BEGIN RSA PRIVATE KEY-----
  ... (SSH 私钥内容)
  -----END RSA PRIVATE KEY-----

# 3. Access Token
# 用途：GitHub/GitLab Personal Access Token
accessToken: ghp_xxxxxxxxxxxxx

# 4. Kubernetes Config
# 用途：部署到 K8s 的凭证
kubeconfig: |
  -----BEGIN KUBECONFIG-----
  ... (kubeconfig 内容)
  -----END KUBECONFIG-----
```

## 完整流水线示例

### Java Maven 项目

```yaml
# Java Maven 项目完整流水线
pipeline {
  agent {
    kubernetes {
      label 'maven-agent'
      defaultContainer 'maven'
    }
  }

  parameters {
    string(name: 'TAG_NAME', defaultValue: '', description: '镜像标签')
    choice(name: 'ENV', choices: ['dev', 'test', 'prod'], description: '部署环境')
  }

  environment {
    DOCKER_REGISTRY = 'harbor.example.com'
    APP_NAME = 'java-app'
    REGISTRY_CREDENTIAL = credentials('harbor-credential')
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

    stage('单元测试') {
      steps {
        container('maven') {
          sh 'mvn test'
        }
      }
    }

    stage('代码质量扫描') {
      steps {
        container('maven') {
          withSonarQubeEnv('SonarQube') {
            sh 'mvn sonar:sonar -Dsonar.projectKey=${APP_NAME}'
          }
        }
      }
    }

    stage('安全扫描') {
      steps {
        container('maven') {
          sh '''
            # Trivy 镜像安全扫描
            trivy image --exit-code 0 --severity HIGH,CRITICAL ${DOCKER_REGISTRY}/${APP_NAME}:${TAG_NAME}
          '''
        }
      }
    }

    stage('构建 Docker 镜像') {
      steps {
        container('docker') {
          sh """
            docker build -t ${DOCKER_REGISTRY}/${APP_NAME}:${TAG_NAME} .
            docker push ${DOCKER_REGISTRY}/${APP_NAME}:${TAG_NAME}
          """
        }
      }
    }

    stage('部署到开发环境') {
      when {
        expression { params.ENV == 'dev' }
      }
      steps {
        sh """
          kubectl set image deployment/${APP_NAME} ${APP_NAME}=${DOCKER_REGISTRY}/${APP_NAME}:${TAG_NAME} -n ${APP_NAME}-dev
        """
      }
    }

    stage('部署到测试环境') {
      when {
        expression { params.ENV == 'test' }
      }
      steps {
        input message: '是否部署到测试环境?', ok: '确认'
        sh """
          kubectl set image deployment/${APP_NAME} ${APP_NAME}=${DOCKER_REGISTRY}/${APP_NAME}:${TAG_NAME} -n ${APP_NAME}-test
        """
      }
    }

    stage('通知') {
      steps {
        echo "流水线执行完成"
      }
    }
  }
}
```

## 质量门槛

```yaml
# SonarQube 质量门槛配置
# 在 SonarQube 平台配置质量门
# 当以下条件不满足时，流水线会失败

# 质量门规则示例：
# - 新代码覆盖率 >= 80%
# - 严重级别 Bug = 0
# - 漏洞数 = 0
# - 代码异味（Smell） < 10 个
# - 重复行数 < 3%

# 在流水线中集成质量门
stage('SonarQube 质量门') {
  steps {
    waitForQualityGate abortPipeline: true
  }
}
```

## 常见问题

```
问题一：Agent Pod 无法启动
原因：没有足够的节点资源 / Docker in Docker 未配置
解决：
  - 检查节点资源
  - 确认 Jenkins Agent 镜像可用
  - 配置 Pod template

问题二：SonarQube 扫描失败
原因：SonarQube 服务不可达 / Token 过期
解决：
  - 检查 SonarQube 服务状态
  - 更新 SonarQube Credential
  - 确认 SonarQube 版本与 Maven 插件兼容

问题三：镜像构建超时
原因：Dockerfile 构建时间过长 / 网络问题
解决：
  - 优化 Dockerfile（减少层数、使用多阶段构建）
  - 配置更快的镜像仓库
  - 增加构建超时时间
```

## 面试追问方向

1. **KubeSphere 的图形化流水线是怎么工作的？**
   答：KubeSphere 提供图形化的 Jenkinsfile 编辑器，用户通过拖拽构建片段生成 Jenkinsfile。图形化配置会序列化为 Jenkinsfile 存储在 ConfigMap 中，Jenkins Master 读取并执行。实际上还是 Jenkins 在跑流水线，只是创建流水线的过程被图形化了。

2. **Jenkins Agent 在 KubeSphere 中是怎么运行的？**
   答：通过 Jenkins Kubernetes Plugin 实现。Jenkins Master 调度流水线时，在 K8s 中动态创建 Agent Pod（使用预设的 Pod Template），Agent Pod 中的容器执行构建步骤，执行完成后 Pod 被销毁。这种方式实现了构建环境的隔离和资源弹性。

3. **KubeSphere 的 CI/CD 和 GitLab CI 有什么区别？**
   答：KubeSphere 的 DevOps 基于 Jenkins，适合需要在 K8s 环境中运行构建、且希望有图形化流水线的团队。GitLab CI 基于 GitLab Runner，适合 GitLab 用户，配置简单但需要在 Kubernetes 中手动部署 Runner。两者都可以实现完整的 CI/CD，KubeSphere 的优势是与 K8s 平台深度集成。

> "KubeSphere 流水线的精髓，是让 Jenkins 不再是运维的专属工具。开发者自己就能创建流水线，自己配置部署环境，流水线失败了自己去查日志——这才是 DevOps 应该有的样子。"
