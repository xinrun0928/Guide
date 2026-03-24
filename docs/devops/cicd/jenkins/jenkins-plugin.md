# Jenkins 插件生态与常用插件

「Jenkins 最强大的能力是什么？」——插件生态。

Jenkins 的核心只是一个调度引擎，真正让它成为 CI/CD 平台的是超过 1800 个插件。从 Git 集成到 Kubernetes 部署，从 SonarQube 到 Slack 通知，Jenkins 几乎可以通过插件覆盖所有 CI/CD 场景。

## 插件管理

```bash
# 通过 Web UI：Manage Jenkins → Manage Plugins
# 通过 CLI 安装
jenkins-cli.jar 安装插件：
java -jar jenkins-cli.jar -s http://localhost:8080 install-plugin git parameter-trigger

# 必需的插件列表
# 1. Pipeline 相关
pipeline-stage-step
workflow-aggregator
groovy

# 2. Git 集成
git
git-client

# 3. 容器集成
docker-workflow
kubernetes

# 4. 通知集成
email-ext
slack

# 5. 安全扫描
 Warnings-NG
```

## 按功能分类的常用插件

### 源码管理

| 插件 | 说明 | 常用场景 |
|------|------|---------|
| Git | Git 源码管理 | 几乎所有项目 |
| Subversion | SVN 支持 | 遗留项目 |
| CVS | CVS 支持 | 遗留项目 |
| GitHub Integration | GitHub PR/Status | GitHub 协作 |
| GitLab Hook | GitLab Webhook | GitLab 协作 |
| Bitbucket | Bitbucket Server | Bitbucket 协作 |

### 构建工具集成

| 插件 | 说明 | 常用场景 |
|------|------|---------|
| Maven Integration | Maven 构建 | Java 项目 |
| Gradle | Gradle 构建 | Java/Kotlin 项目 |
| NodeJS | Node.js 构建 | 前端项目 |
| Python | Python 构建 | Python 项目 |
| Go | Go 构建 | Go 项目 |

### 容器与 K8s

| 插件 | 说明 | 常用场景 |
|------|------|---------|
| Docker | Docker 构建/推送 | 镜像构建 |
| Kubernetes | K8s 动态 Agent | 云原生 CI/CD |
| kubectl | kubectl 客户端 | K8s 部署 |
| Helm | Helm 包管理 | Helm Chart 部署 |

### 代码质量

| 插件 | 说明 | 常用场景 |
|------|------|---------|
| SonarQube Scanner | SonarQube 集成 | 代码质量检查 |
| Checkstyle | Java 代码风格 | 代码规范 |
| PMD | 代码静态分析 | 代码质量 |
| FindBugs | Bug 检测 | Java 代码检查 |
| Warnings-NG | 编译器警告聚合 | 多语言警告 |

### 安全扫描

| 插件 | 说明 | 常用场景 |
|------|------|---------|
| Trivy | 容器镜像扫描 | 镜像安全 |
| Aqua MicroScanner | 容器安全扫描 | 镜像安全 |
| Snyk | 依赖漏洞扫描 | 开源组件安全 |
| OWASP Dependency-Check | 依赖漏洞检查 | Java/.NET |

### 通知与协作

| 插件 | 说明 | 常用场景 |
|------|------|---------|
| Email Extension | 增强邮件通知 | 构建通知 |
| Slack Notification | Slack 通知 | 团队通知 |
| DingTalk | 钉钉通知 | 团队通知 |
| Microsoft Teams | Teams 通知 | 企业协作 |
| Discord | Discord 通知 | 开源社区 |

### 部署与环境

| 插件 | 说明 | 常用场景 |
|------|------|---------|
| SSH Agent | SSH 执行远程命令 | 远程部署 |
| Publish Over SSH | SSH 文件传输 | 部署到服务器 |
| Ansible | Ansible 集成 | 配置管理 |
| Terraform | Terraform 集成 | IaC 部署 |
| Helm | Helm Chart 部署 | K8s 应用部署 |

## 插件使用示例

### SonarQube 集成

```groovy
pipeline {
    agent any

    environment {
        SCANNER_HOME = tool 'SonarQube-Scanner'
    }

    stages {
        stage('SonarQube Analysis') {
            steps {
                withSonarQubeEnv('SonarQube-Server') {
                    sh '''
                        ${SCANNER_HOME}/bin/sonar-scanner \
                            -Dsonar.projectKey=my-app \
                            -Dsonar.sources=src \
                            -Dsonar.java.binaries=target/classes
                    '''
                }
            }
        }

        stage('Quality Gate') {
            steps {
                timeout(time: 1, unit: 'HOURS') {
                    waitForQualityGate abortPipeline: true
                }
            }
        }
    }
}
```

### Trivy 镜像扫描

```groovy
pipeline {
    agent { label 'docker' }

    stages {
        stage('Build & Scan') {
            steps {
                sh '''
                    docker build -t myapp:${BUILD_NUMBER} .
                    trivy image --exit-code 0 --severity HIGH,CRITICAL myapp:${BUILD_NUMBER}
                '''
            }
        }

        post {
            always {
                archiveArtifacts artifacts: 'trivy-report.html', allowEmptyArchive: true
            }
        }
    }
}
```

### Kubernetes 动态部署

```groovy
pipeline {
    agent {
        kubernetes {
            label 'k8s-deploy'
            defaultContainer 'kubectl'
            yaml '''
                apiVersion: v1
                kind: Pod
                spec:
                    serviceAccountName: jenkins-deploy
                    containers:
                        - name: kubectl
                          image: bitnami/kubectl
                          command: ["sleep"]
                          args: ["infinity"]
            '''
        }
    }

    stages {
        stage('Deploy to K8s') {
            steps {
                sh '''
                    kubectl set image deployment/myapp \
                        myapp=myrepo/myapp:${BUILD_NUMBER}
                    kubectl rollout status deployment/myapp --timeout=300s
                '''
            }
        }
    }
}
```

### Slack 通知

```groovy
pipeline {
    stages {
        stage('Build') {
            steps {
                echo 'Building...'
            }
        }
    }

    post {
        success {
            slackSend(
                channel: '#ci-cd',
                color: 'good',
                message: "SUCCESS: ${env.JOB_NAME} #${env.BUILD_NUMBER} - ${env.BUILD_URL}"
            )
        }
        failure {
            slackSend(
                channel: '#ci-cd',
                color: 'danger',
                message: "FAILED: ${env.JOB_NAME} #${env.BUILD_NUMBER} - ${env.BUILD_URL}"
            )
        }
    }
}
```

## 插件依赖管理

### 插件版本矩阵

Jenkins 插件有版本依赖关系，升级时需要注意兼容性：

```bash
# 查看已安装插件及其依赖
# Manage Jenkins → Manage Plugins → Installed

# 推荐的插件升级顺序：
# 1. 先升级核心插件（Git、Pipeline 相关）
# 2. 再升级业务插件
# 3. 每次升级后测试流水线
```

### 插件安全

```bash
# Jenkins 安全建议：
# 1. 定期更新插件（Jenkins 会标记已知漏洞的插件）
# 2. 启用插件签名验证
# 3. 只安装必要的插件（减少攻击面）
# 4. 审核第三方插件的权限请求

# 查看插件安全公告
# https://www.jenkins.io/security/
```

## 插件管理最佳实践

### 1. 使用插件配置即代码

将插件配置存储在 Git 中：

```bash
# 通过 Configuration as Code Plugin (JCasC)
# 将 Jenkins 配置导出为 YAML
# Manage Jenkins → Configuration as Code → Export Configuration
```

### 2. 限制插件更新影响

```bash
# 在测试 Jenkins 中先测试插件升级
# 1. 搭建测试 Jenkins 实例
# 2. 在测试环境升级插件
# 3. 验证流水线功能
# 4. 确认无误后再升级生产环境
```

### 3. 记录插件清单

```bash
# 定期导出已安装插件清单
curl -s http://localhost:8080/pluginManager/api/json?tree=plugins[shortName,version] \
    | jq '.plugins[] | "\(.shortName): \(.version)"'
```

## 面试追问方向

- Jenkins 的插件安全模型是什么？插件请求的权限如何控制？
- 如何排查「流水线突然失败，但代码没变」——很可能是某个插件自动更新导致的？
- 哪些插件是 Jenkins 流水线中的「事实标准」？哪些是可选的？
- 如果一个插件不再维护（abandoned），应该怎么处理？

> Jenkins 的插件生态既是它的最大优势，也是最大风险。丰富的插件让 Jenkins 能做几乎任何事，但每个插件都是潜在的安全和维护风险点。精简插件列表、定期更新、做好测试，是使用 Jenkins 的正确姿势。
