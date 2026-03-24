# KubeSphere 流水线语法：Jenkinsfile in SCM vs 图形化编辑

「Jenkinsfile 怎么写？」——两种方式，看你熟悉哪个。

KubeSphere 支持两种流水线创建方式：图形化编辑和 Jenkinsfile in SCM。图形化编辑门槛低，Jenkinsfile in SCM 灵活度高。理解两种方式的适用场景，才能在实践中做出正确选择。

## 两种方式对比

```
┌─────────────────────────────────────────────────────────────────┐
│                    流水线创建方式对比                               │
│                                                                  │
│  图形化编辑                                                      │
│  ├── 门槛低：拖拽即可创建流水线                                   │
│  ├── 不需要懂 Jenkins 语法                                       │
│  ├── 自动生成 Jenkinsfile                                       │
│  ├── 适合：快速创建简单流水线                                     │
│  └── 局限：复杂逻辑（嵌套条件、多分支）表达能力有限               │
│                                                                  │
│  Jenkinsfile in SCM                                             │
│  ├── 完整 Jenkins 语法支持                                       │
│  ├── 版本化管理（和代码一起管理）                                │
│  ├── 适合：复杂流水线、团队协作                                 │
│  ├── 适合：需要 Code Review 的流水线                            │
│  └── 局限：需要懂 Jenkins 语法                                   │
└─────────────────────────────────────────────────────────────────┘
```

## 图形化编辑

### 创建流程

```
步骤：
1. 进入 DevOps Project → 流水线 → 创建流水线
2. 填写基本信息（名称、描述、代码仓库）
3. 添加构建参数（可选）
4. 图形化编辑阶段和步骤
5. 保存 → 自动生成 Jenkinsfile
```

### 常用图形化组件

```
┌─────────────────────────────────────────────────────────────────┐
│                    常用图形化组件                                  │
│                                                                  │
│  阶段（Stage）                                                  │
│  - 将流水线分成多个阶段                                         │
│  - 每个阶段可包含多个步骤                                        │
│  - 可视化展示执行进度                                            │
│                                                                  │
│  拉取代码（Git）                                               │
│  - 配置代码仓库 URL                                             │
│  - 配置分支                                                     │
│  - 配置凭证                                                     │
│                                                                  │
│  构建制品（Maven / Gradle / npm）                              │
│  - 指定构建命令                                                 │
│  - 指定工作目录                                                 │
│                                                                  │
│  构建镜像（Docker）                                            │
│  - Dockerfile 路径                                              │
│  - 镜像名称和标签                                               │
│  - 推送目标仓库                                                 │
│                                                                  │
│  质量检查（SonarQube）                                         │
│  - SonarQube 服务器                                            │
│  - 项目 Key                                                     │
│  - 质量门设置                                                  │
│                                                                  │
│  部署到 Kubernetes                                             │
│  - 选择 K8s 凭证                                               │
│  - 指定部署命令                                                 │
│                                                                  │
│  人工确认（Input）                                             │
│  - 暂停流水线等待人工确认                                        │
│  - 配置确认消息和选项                                            │
└─────────────────────────────────────────────────────────────────┘
```

## Jenkinsfile in SCM

### 创建流程

```
步骤：
1. 在代码仓库根目录创建 Jenkinsfile
2. 将 Jenkinsfile 提交到 Git 仓库
3. 在 KubeSphere 中创建流水线时，选择「从代码仓库创建」
4. KubeSphere 自动从 Git 拉取 Jenkinsfile 并执行
```

### Jenkinsfile 语法

```groovy
// Jenkinsfile 完整语法
pipeline {
    // Agent 定义：在哪个环境执行流水线
    agent {
        kubernetes {
            label 'maven-agent'
            defaultContainer 'maven'
            yaml '''
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: maven
      image: maven:3.8-openjdk-8
      command: [cat]
      tty: true
    - name: docker
      image: docker:20.10
      command: [cat]
      tty: true
      securityContext:
        privileged: true
'''
        }
    }

    // 参数化构建
    parameters {
        string(name: 'TAG_NAME', defaultValue: 'latest', description: '镜像标签')
        choice(name: 'ENV', choices: ['dev', 'test', 'prod'], description: '部署环境')
        booleanParam(name: 'SKIP_TEST', defaultValue: false, description: '跳过测试')
    }

    // 环境变量
    environment {
        DOCKER_REGISTRY = 'harbor.example.com'
        APP_NAME = 'order-service'
        CREDENTIAL_ID = 'harbor-credential'
    }

    // 选项配置
    options {
        timestamps()
        timeout(time: 2, unit: 'HOURS')
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }

    // 阶段定义
    stages {
        stage('拉取代码') {
            steps {
                checkout scm
            }
        }

        stage('Maven 构建') {
            steps {
                container('maven') {
                    sh 'mvn clean package -DskipTests=${params.SKIP_TEST}'
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

        stage('SonarQube 分析') {
            steps {
                container('maven') {
                    withSonarQubeEnv('SonarQube') {
                        sh 'mvn sonar:sonar'
                    }
                }
            }
        }

        stage('质量门') {
            steps {
                waitForQualityGate abortPipeline: true
            }
        }

        stage('构建镜像') {
            steps {
                container('docker') {
                    sh """
                        docker build -t ${DOCKER_REGISTRY}/${APP_NAME}:${TAG_NAME} .
                        docker push ${DOCKER_REGISTRY}/${APP_NAME}:${TAG_NAME}
                    """
                }
            }
        }

        stage('部署') {
            when {
                expression { params.ENV != 'prod' }
            }
            steps {
                sh """
                    kubectl set image deployment/${APP_NAME} ${APP_NAME}=${DOCKER_REGISTRY}/${APP_NAME}:${TAG_NAME} -n ${APP_NAME}-${params.ENV}
                """
            }
        }

        stage('生产部署确认') {
            when {
                expression { params.ENV == 'prod' }
            }
            steps {
                input message: '确认部署到生产环境?',
                      ok: '确认部署',
                      submitter: 'admin,ops-team'
            }
        }
    }

    // 后置处理
    post {
        always {
            echo '流水线执行完成'
            cleanWs()
        }
        success {
            echo '流水线成功'
            // 发钉钉通知
            dingtalk (
                robot: 'devops-bot',
                type: 'MARKDOWN',
                title: '流水线成功',
                text: ["### ✅ 流水线成功\n", "项目: ${APP_NAME}\n", "环境: ${params.ENV}\n", "构建: #${BUILD_NUMBER}"]
            )
        }
        failure {
            echo '流水线失败'
            dingtalk (
                robot: 'devops-bot',
                type: 'MARKDOWN',
                title: '流水线失败',
                text: ["### ❌ 流水线失败\n", "项目: ${APP_NAME}\n", "环境: ${params.ENV}\n", "构建: #${BUILD_NUMBER}\n", "查看日志: ${RUN_DISPLAY_URL}"]
            )
        }
        cleanup {
            echo '清理资源'
        }
    }
}
```

### 常用语法详解

#### Agent 定义

```groovy
// 方式一：Kubernetes Agent（推荐）
agent {
    kubernetes {
        label 'my-agent'
        defaultContainer 'maven'
        yaml '''
kind: Pod
spec:
  containers:
    - name: maven
      image: maven:3.8-openjdk-8
      command: [cat]
      tty: true
'''
    }
}

// 方式二：节点标签
agent {
    label 'docker-builder'
}

// 方式三：任意节点
agent any
```

#### 条件执行

```groovy
// when 条件
stage('部署') {
    when {
        expression { params.ENV == 'prod' }
        expression { currentBuild.result == null }
    }
    steps {
        sh './deploy.sh'
    }
}

// 支持的条件
// - expression：表达式
// - not：取反
// - allOf：所有条件都满足
// - anyOf：任一条件满足
```

#### 并行执行

```groovy
// 并行执行多个阶段
stage('并行测试') {
    parallel {
        stage('单元测试') {
            steps {
                sh 'mvn test'
            }
        }
        stage('集成测试') {
            steps {
                sh 'mvn verify -P integration'
            }
        }
        stage('E2E 测试') {
            steps {
                sh 'npm run test:e2e'
            }
        }
    }
}
```

#### 矩阵式构建

```groovy
// 矩阵式构建：多个版本 × 多个平台
stage('多平台构建') {
    matrix {
        axes {
            axis {
                name 'PLATFORM'
                values 'linux/amd64', 'linux/arm64'
            }
            axis {
                name 'VERSION'
                values 'v1', 'v2', 'v3'
            }
        }
        stages {
            stage('构建') {
                steps {
                    sh 'docker build --platform ${PLATFORM} -t myapp:${VERSION}-${PLATFORM} .'
                }
            }
        }
    }
}
```

## 凭证使用

```groovy
// 在 Jenkinsfile 中引用凭证
pipeline {
    environment {
        // 用户名密码凭证
        HARBOR_CREDS = credentials('harbor-credential')
        // SSH Key 凭证
        GIT_SSH_KEY = credentials('git-ssh-key')
    }

    stages {
        stage('构建镜像') {
            steps {
                container('docker') {
                    sh """
                        echo ${HARBOR_CREDS} | docker login ${DOCKER_REGISTRY} -u ${HARBOR_CREDS_USR} --password-stdin
                        docker build -t ${DOCKER_REGISTRY}/${APP_NAME}:${TAG_NAME} .
                        docker push ${DOCKER_REGISTRY}/${APP_NAME}:${TAG_NAME}
                    """
                }
            }
        }
    }
}
```

## 最佳实践

### 流水线设计原则

```
┌─────────────────────────────────────────────────────────────────┐
│                    流水线设计原则                                  │
│                                                                  │
│  1. 阶段划分清晰                                                │
│     代码拉取 → 构建 → 测试 → 安全扫描 → 镜像构建 → 部署          │
│                                                                  │
│  2. 快速反馈                                                    │
│     把耗时长的步骤放后面，先跑快速测试（单元测试先于集成测试）     │
│                                                                  │
│  3. 失败即停                                                    │
│     测试失败不要继续构建镜像，避免浪费资源                        │
│                                                                  │
│  4. 参数化驱动                                                  │
│     环境、版本、是否跳过测试等都做成参数，不要写死                │
│                                                                  │
│  5. 制品化                                                      │
│     构建产物命名规范：镜像名:版本-构建号                         │
│                                                                  │
│  6. 审批门控                                                    │
│     生产部署前必须有人工审批                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 流水线版本管理

```bash
# Jenkinsfile 和代码一起版本化
# 仓库结构
# my-repo/
# ├── src/
# │   └── main/java/
# ├── Jenkinsfile          # 流水线定义
# ├── Jenkinsfile.test     # 测试环境流水线
# ├── Jenkinsfile.prod     # 生产环境流水线
# ├── Dockerfile
# └── k8s/
#     ├── deployment.yaml
#     └── service.yaml
# 提交规范
# - Jenkinsfile 变更随代码变更一起提交
# - 流水线修改需要 Code Review
# - 使用 Tag 管理流水线版本
```

## 面试追问方向

1. **图形化编辑和 Jenkinsfile in SCM 各自适合什么场景？**
   答：图形化适合简单流水线（Build → Test → Deploy）和快速验证；Jenkinsfile in SCM 适合复杂流水线（多分支、条件执行、并行阶段）和团队协作（需要 Code Review）。生产环境建议两者结合：简单流水线用图形化，复杂流水线用 Jenkinsfile in SCM。

2. **Jenkinsfile 中的 `agent any` 和 `agent { kubernetes {} }` 有什么区别？**
   答：`agent any` 在任意可用的 Jenkins Agent 上执行（可能是物理机或虚拟机）。`agent { kubernetes {} }` 在 K8s 中动态创建 Pod 作为 Agent，执行完成后 Pod 被销毁。K8s Agent 的优势：隔离性好（每次构建环境干净）、资源弹性（按需创建）、成本优化（空闲时不占用资源）。

3. **如何保证 Jenkinsfile 的安全性？**
   答：1) Jenkinsfile 放在代码仓库中，通过 Code Review 机制审批；2) 敏感凭证不要写在 Jenkinsfile 中，使用 KubeSphere 的凭证管理；3) Pipeline 权限控制（只有特定角色可以创建/修改流水线）；4) 定期审计 Jenkins 操作日志。

> "好的流水线设计，是让开发者的代码从提交到上线，全程自动化、透明化。Jenkinsfile 写得好不好，就看它能不能让开发者『提交代码后就去喝咖啡』。"
