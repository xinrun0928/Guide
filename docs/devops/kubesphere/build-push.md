# KubeSphere 自动化构建与镜像推送流程

「代码提交后，镜像是怎么炼成的？」——从 Git 到 Docker 镜像的全链路自动化。

KubeSphere 的 DevOps 流水线将代码构建、测试、安全扫描、镜像构建和推送串联成一条自动化链路。开发者提交代码后，一切自动化完成，无需人工干预。

## 完整流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    自动化构建流程                                  │
│                                                                  │
│  代码提交                                                       │
│     │                                                          │
│     ▼                                                          │
│  Git Hook 触发（可选：commit-msg、pre-push）                    │
│     │                                                          │
│     ▼                                                          │
│  流水线启动                                                     │
│     │                                                          │
│     ├─── 拉取代码 ──── checkout scm ────────────────────────┐   │
│     │                                                          │   │
│     ├─── Maven/Gradle 构建 ──── mvn package ───────────┐   │   │
│     │                                                       │   │   │
│     ├─── 单元测试 ──── mvn test ─────────────────────┐  │   │   │
│     │                                                       │  │   │   │
│     ├─── SonarQube ──── mvn sonar:sonar ───────────┐  │  │  │   │
│     │                                                       │  │  │  │   │
│     ├─── 安全扫描 ──── Trivy / Snyk ────────────┐  │  │  │  │   │   │
│     │                                                       │  │  │  │   │   │
│     ├─── Docker 构建 ──── docker build ────────┐  │  │  │  │  │   │   │
│     │                                                       │  │  │  │  │   │   │
│     ├─── 镜像推送 ──── docker push ────────────┐  │  │  │  │  │  │   │   │
│     │                                                       │  │  │  │  │  │   │   │
│     └─── 部署 ──── kubectl apply ─────────────────┘  │  │  │  │  │   │   │
│                                                             │  │  │  │  │   │
│  构建成功 ── 通知（钉钉/邮件） ── 流水线结束              │  │  │  │  │   │
│                                                             │  │  │  │  │   │
│  构建失败 ── 通知 ── 开发者修复 ── 重新提交              └───┘  │  │  │  │   │
│                                                               └───┘  │  │   │
│                                                                 └───┘  │   │
│                                                                   └───┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 镜像构建配置

### Dockerfile 规范

```dockerfile
# 多阶段构建 Dockerfile 示例（Java 应用）
# 阶段一：构建
FROM maven:3.8-openjdk-8 AS builder
WORKDIR /build
COPY pom.xml .
RUN mvn dependency:go-offline
COPY src ./src
RUN mvn clean package -DskipTests

# 阶段二：运行
FROM openjdk:8-jre-slim
WORKDIR /app

# 从构建阶段复制产物
COPY --from=builder /build/target/myapp.jar app.jar

# 创建非 root 用户
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:8080/health || exit 1

# 暴露端口
EXPOSE 8080

# 启动命令
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### 构建优化

```dockerfile
# 优化点一：减少镜像层
# 不好：每行 RUN 创建一个层
# RUN apt-get update
# RUN apt-get install -y nginx
# RUN apt-get install -y curl
# 好：合并到一行
RUN apt-get update && apt-get install -y --no-install-recommends nginx curl && rm -rf /var/lib/apt/lists/*

# 优化点二：利用构建缓存
# 不好：COPY 整个项目，每次修改任何文件都导致依赖重新下载
# COPY . .
# 好：先复制依赖文件，构建依赖后再复制源代码
COPY pom.xml .
RUN mvn dependency:go-offline
COPY src ./src

# 优化点三：使用轻量级基础镜像
# 不好：FROM ubuntu
# 好：FROM alpine 或 distroless
FROM eclipse-temurin:8-jre-alpine

# 优化点四：多阶段构建分离构建和运行环境
# 构建阶段用完整 JDK（需要编译器）
# 运行阶段用 JRE（不需要编译器）
```

## Jenkinsfile 构建配置

```groovy
// 完整的镜像构建和推送流水线
pipeline {
    agent {
        kubernetes {
            label 'docker-agent'
            defaultContainer 'docker'
            yaml '''
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: maven
      image: maven:3.8-openjdk-8
      command: [cat]
      tty: true
      volumeMounts:
        - name: maven-cache
          mountPath: /root/.m2
    - name: docker
      image: docker:20.10
      command: [cat]
      tty: true
      securityContext:
        privileged: true
      env:
        - name: DOCKER_TLS_CERTDIR
          value: ""
    - name: trivy
      image: aquasec/trivy:latest
      command: [cat]
      tty: true
  volumes:
    - name: maven-cache
      persistentVolumeClaim:
        claimName: maven-cache-pvc
  restartPolicy: Never
'''
        }
    }

    parameters {
        string(name: 'IMAGE_TAG', defaultValue: '', description: '镜像标签（留空使用构建号）')
        string(name: 'DOCKERFILE_PATH', defaultValue: 'Dockerfile', description: 'Dockerfile 路径')
        booleanParam(name: 'PUSH_TO_REGISTRY', defaultValue: true, description: '是否推送到镜像仓库')
    }

    environment {
        DOCKER_REGISTRY = 'harbor.example.com'
        APP_NAME = 'order-service'
        REGISTRY_CREDS = credentials('harbor-credential')
        SONAR_HOST = 'http://sonarqube:9000'
        SONAR_TOKEN = credentials('sonarqube-token')
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
                    script {
                        env.IMAGE_TAG_VALUE = params.IMAGE_TAG ?: "build-${BUILD_NUMBER}"
                    }
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

        stage('SonarQube 分析') {
            steps {
                container('maven') {
                    withSonarQubeEnv('SonarQube') {
                        sh '''
                            mvn sonar:sonar \
                                -Dsonar.projectKey=${APP_NAME} \
                                -Dsonar.projectName=${APP_NAME} \
                                -Dsonar.projectVersion=${IMAGE_TAG_VALUE} \
                                -Dsonar.sourceEncoding=UTF-8 \
                                -Dsonar.sources=src \
                                -Dsonar.tests=test \
                                -Dsonar.java.binaries=target/classes \
                                -Dsonar.java.test.binaries=target/test-classes
                        '''
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
                        docker build \
                            -f ${params.DOCKERFILE_PATH} \
                            -t ${DOCKER_REGISTRY}/project-a/${APP_NAME}:${IMAGE_TAG_VALUE} \
                            -t ${DOCKER_REGISTRY}/project-a/${APP_NAME}:latest \
                            --build-arg VERSION=${IMAGE_TAG_VALUE} \
                            .
                    """
                }
            }
        }

        stage('镜像安全扫描') {
            steps {
                container('trivy') {
                    sh """
                        trivy image \
                            --exit-code 1 \
                            --severity HIGH,CRITICAL \
                            --ignore-unfixed \
                            --no-progress \
                            --format json \
                            --output /tmp/trivy-result.json \
                            ${DOCKER_REGISTRY}/project-a/${APP_NAME}:${IMAGE_TAG_VALUE}

                        # CRITICAL 漏洞超过阈值则失败
                        CRITICAL_COUNT=\$(cat /tmp/trivy-result.json | jq '[.Results[] | select(.Vulnerabilities != null) | .Vulnerabilities[] | select(.Severity=="CRITICAL")] | length')
                        if [ \$CRITICAL_COUNT -gt 0 ]; then
                            echo "发现 \$CRITICAL_COUNT 个 CRITICAL 漏洞，流水线失败"
                            exit 1
                        fi
                    """
                }
            }
        }

        stage('推送镜像') {
            when {
                expression { params.PUSH_TO_REGISTRY == true }
            }
            steps {
                container('docker') {
                    sh """
                        echo \${REGISTRY_CREDS} | docker login ${DOCKER_REGISTRY} -u \${REGISTRY_CREDS_USR} --password-stdin

                        docker push ${DOCKER_REGISTRY}/project-a/${APP_NAME}:${IMAGE_TAG_VALUE}
                        docker push ${DOCKER_REGISTRY}/project-a/${APP_NAME}:latest

                        docker logout ${DOCKER_REGISTRY}

                        echo "镜像推送成功：${DOCKER_REGISTRY}/project-a/${APP_NAME}:${IMAGE_TAG_VALUE}"
                    """
                }
            }
        }
    }

    post {
        success {
            echo '构建成功'
            dingtalk (
                robot: 'devops-bot',
                type: 'MARKDOWN',
                title: '镜像构建成功',
                text: ["### ✅ 镜像构建成功\n\n",
                       "项目: **${APP_NAME}**\n",
                       "标签: **${IMAGE_TAG_VALUE}**\n",
                       "构建号: **#${BUILD_NUMBER}**\n",
                       "构建人: **${BUILD_USER}**\n",
                       "镜像: `${DOCKER_REGISTRY}/project-a/${APP_NAME}:${IMAGE_TAG_VALUE}`"]
            )
        }
        failure {
            echo '构建失败'
            dingtalk (
                robot: 'devops-bot',
                type: 'MARKDOWN',
                title: '镜像构建失败',
                text: ["### ❌ 镜像构建失败\n\n",
                       "项目: **${APP_NAME}**\n",
                       "构建号: **#${BUILD_NUMBER}**\n",
                       "失败阶段: **${STAGE_NAME}**\n",
                       "[查看日志](${RUN_DISPLAY_URL})"]
            )
        }
    }
}
```

## Webhook 触发

### GitHub Webhook

```bash
# 在 GitHub 仓库设置 Webhook
# Settings → Webhooks → Add webhook
# Payload URL: https://kubesphere.example.com/devops-webhook/gittrigger
# Content type: application/json
# Events: Push events, Pull request events
# Secret: （和 KubeSphere 中配置的 Secret 一致）

# Webhook 配置在 KubeSphere 中
# 流水线 → 配置 → 构建触发器
# - GitHub Webhook
# - GitLab Webhook
# - Bitbucket Webhook
# - Generic Webhook
```

### Generic Webhook

```bash
# 通用 Webhook 触发流水线
# KubeSphere 生成 Webhook URL
# https://kubesphere.example.com/devops-webhook/generic倩/UUID

# 触发方式
curl -X POST https://kubesphere.example.com/devops-webhook/generic倩/UUID \
  -H 'Content-Type: application/json' \
  -d '{"ref": "refs/heads/main", "commits": [...]}'
```

## 镜像版本管理策略

```bash
# 镜像 Tag 策略
# 1. Git Commit Hash（最精确）
# harbor.example.com/project-a/myapp:git-a1b2c3d
# 优点：精确对应代码版本
# 缺点：Tag 较长，不易读

# 2. 构建号
# harbor.example.com/project-a/myapp:build-1234
# 优点：唯一、递增
# 缺点：不直观，不知道对应哪个版本

# 3. SemVer（推荐）
# harbor.example.com/project-a/myapp:v1.2.3
# harbor.example.com/project-a/myapp:v1.2.3-rc1
# harbor.example.com/project-a/myapp:v1.2.3-alpha.1
# 优点：语义明确（主版本.次版本.修订版）
# 缺点：需要版本规划

# 4. 混合策略（最佳）
# latest                     → 最新构建（总是可用的开发版本）
# build-1234                → 构建号（精确）
# v1.2.3                    → 正式版本
# v1.2.3-SNAPSHOT           → 快照版本（开发中）
# git-main-a1b2c3d          → Git 分支 + Hash（开发分支）
```

## 最佳实践

### 构建缓存优化

```groovy
// 使用 Maven 本地缓存加速构建
pipeline {
    agent {
        kubernetes {
            label 'maven-agent'
            defaultContainer 'maven'
            yaml '''
spec:
  volumes:
    - name: maven-cache
      persistentVolumeClaim:
        claimName: maven-cache-pvc
  containers:
    - name: maven
      volumeMounts:
        - name: maven-cache
          mountPath: /root/.m2
'''
        }
    }
    // Maven 会自动使用 ~/.m2/repository 作为缓存
    // 下次构建时，依赖直接从本地缓存读取，无需重新下载
}
```

### 并行构建

```groovy
// 如果有多个微服务，可以并行构建
stage('并行构建镜像') {
    parallel {
        stage('构建 order-service') {
            steps {
                sh 'docker build -t order-service:${TAG} ./order-service'
            }
        }
        stage('构建 user-service') {
            steps {
                sh 'docker build -t user-service:${TAG} ./user-service'
            }
        }
        stage('构建 payment-service') {
            steps {
                sh 'docker build -t payment-service:${TAG} ./payment-service'
            }
        }
    }
}
```

## 面试追问方向

1. **多阶段构建的优势是什么？**
   答：多阶段构建允许在构建阶段使用完整工具链（带编译器的 JDK、Maven），在运行阶段只复制最终产物（运行时的 JRE、编译后的 JAR）。最终镜像只包含运行时需要的文件，不包含源代码和构建工具，镜像体积大幅减小（可能从 800MB 降到 200MB），也减少了安全攻击面。

2. **构建缓存失效了怎么办？**
   答：Docker 的构建缓存依赖层不变。常见导致缓存失效的原因：修改了 Dockerfile 中靠前的指令（如 `RUN apt-get install`）。解决方案：1) 把频繁修改的指令放在 Dockerfile 后面（`COPY src` 放在 `COPY pom.xml` 之后）；2) 利用 `COPY --from=builder` 从构建阶段复制产物，避免在镜像中留下构建工具；3) 使用 BuildKit 的并行构建和远程缓存。

3. **如何保证镜像的供应链安全？**
   答：从三个方面入手：1) 构建阶段：使用可信基础镜像（官方镜像或经过签名验证的镜像）；2) 交付阶段：镜像签名（Harbor 支持 Notary 签名），验证镜像来源；3) 运行阶段：镜像扫描（Trivy/Clair），阻断有已知漏洞的镜像部署到生产环境。

> "好的镜像构建，是把构建过程『固化』在 Dockerfile 里。代码在变、环境在变，但构建过程永远是可复现的。一个 Dockerfile 走天下，这才是 DevOps 应该有的样子。"
