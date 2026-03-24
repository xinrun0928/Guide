# KubeSphere 二进制制品仓库与镜像仓库集成

「构建产物放哪里？」——制品仓库和镜像仓库是 CI/CD 的最后一环。

KubeSphere 的 DevOps 模块内置了对制品仓库（Artifactory/Nexus）和镜像仓库（Harbor）的集成支持。从代码构建到制品存储，再到镜像推送，整个过程都可以在流水线中自动化完成。

## 制品仓库概述

```
┌─────────────────────────────────────────────────────────────────┐
│                    制品仓库生态                                    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    制品仓库（Artifact Repository）              │   │
│  │                                                          │   │
│  │  Maven 仓库（Java）                                       │   │
│  │  - snapshots（快照版本）                                  │   │
│  │  - releases（正式版本）                                    │   │
│  │                                                          │   │
│  │  npm 仓库（Node.js）                                      │   │
│  │  PyPI 仓库（Python）                                      │   │
│  │  Docker 仓库（镜像）                                      │   │
│  │  Helm 仓库（Chart）                                       │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │              Nexus / JFrog Artifactory              │   │   │
│  │  │  - Maven-hosted                                    │   │   │
│  │  │  - npm-proxy（缓存 npmjs.org）                    │   │   │
│  │  │  - Docker-hosted                                   │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                │                                      │
│  ┌─────────────────────────────┴──────────────────────────────┐   │
│  │                    镜像仓库（Image Registry）                 │   │
│  │                                                          │   │
│  │  Harbor                                                │   │
│  │  - 镜像存储                                             │   │
│  │  - 镜像扫描（Trivy/Clair）                              │   │
│  │  - 镜像复制（多站点同步）                                 │   │
│  │  - 镜像签名                                              │   │
│  │                                                          │   │
│  │  Docker Hub / AWS ECR / 阿里云 ACR                      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 镜像仓库集成

### Harbor 集成

```bash
# Harbor 是企业级镜像仓库的事实标准
# KubeSphere 支持两种镜像仓库集成方式

# 方式一：通过 KubeSphere 控制台配置
# 步骤：
# 1. 进入 DevOps Project → 设置 → 制品库
# 2. 添加 Harbor 配置
#    - 名称：harbor-demo
#    - 类型：Harbor
#    - URL：https://harbor.example.com
#    - 用户名：admin
#    - 密码：Harbor12345
# 3. 测试连接
# 4. 保存配置

# 方式二：在流水线中直接使用凭证
# 通过 KubeSphere 凭证管理添加 Harbor 凭证
# 凭证类型：用户名密码
# 在 Jenkinsfile 中引用
```

### 镜像构建与推送

```groovy
// Jenkinsfile 中的镜像构建和推送
pipeline {
    agent {
        kubernetes {
            label 'docker-agent'
            defaultContainer 'docker'
        }
    }

    environment {
        DOCKER_REGISTRY = 'harbor.example.com'
        APP_NAME = 'order-service'
        // 从 KubeSphere 凭证中获取
        REGISTRY_CREDS = credentials('harbor-credential')
    }

    stages {
        stage('构建镜像') {
            steps {
                container('docker') {
                    sh """
                        # 登录镜像仓库
                        echo \${REGISTRY_CREDS} | docker login ${DOCKER_REGISTRY} -u \${REGISTRY_CREDS_USR} --password-stdin

                        # 构建镜像
                        docker build \
                            --tag ${DOCKER_REGISTRY}/project-a/${APP_NAME}:${BUILD_NUMBER} \
                            --tag ${DOCKER_REGISTRY}/project-a/${APP_NAME}:latest \
                            --build-arg VERSION=${BUILD_NUMBER} \
                            .

                        # 推送镜像
                        docker push ${DOCKER_REGISTRY}/project-a/${APP_NAME}:${BUILD_NUMBER}
                        docker push ${DOCKER_REGISTRY}/project-a/${APP_NAME}:latest

                        # 登出
                        docker logout ${DOCKER_REGISTRY}
                    """
                }
            }
        }

        stage('镜像安全扫描') {
            steps {
                container('docker') {
                    sh """
                        # 使用 Trivy 扫描镜像漏洞
                        trivy image \
                            --exit-code 0 \
                            --severity HIGH,CRITICAL \
                            --no-progress \
                            ${DOCKER_REGISTRY}/project-a/${APP_NAME}:${BUILD_NUMBER}
                    """
                }
            }
        }
    }
}
```

### Harbor 项目配置

```bash
# Harbor 中的项目规划
# 建议的项目结构

# 项目命名规范
# project-a     → 业务线 A 的镜像
# project-b     → 业务线 B 的镜像
# library       → 公共基础镜像
# cache         → 公共缓存镜像（nginx、redis 等）

# Harbor 中的镜像命名
# harbor.example.com/project-a/order-service:v1.2.3
#        │               │        │            │
#        │               │        │            └── 镜像版本（Tag）
#        │               │        └── 镜像名称
#        │               └── Harbor 项目
#        └── Harbor 域名
```

##制品仓库集成

### Nexus 集成

```groovy
// Jenkinsfile 中使用 Nexus 作为 Maven 制品库
pipeline {
    agent any

    environment {
        NEXUS_URL = 'https://nexus.example.com'
        NEXUS_REPO = 'maven-releases'
        NEXUS_CREDS = credentials('nexus-credential')
    }

    stages {
        stage('Maven 构建') {
            steps {
                container('maven') {
                    sh """
                        # 配置 Maven settings.xml
                        cat > settings.xml << EOF
<?xml version="1.0" encoding="UTF-8"?>
<settings>
  <servers>
    <server>
      <id>nexus</id>
      <username>\${NEXUS_CREDS_USR}</username>
      <password>\${NEXUS_CREDS_PSW}</password>
    </server>
  </servers>
</settings>
EOF

                        # 构建并部署到 Nexus
                        mvn clean deploy -DskipTests -s settings.xml
                    """
                }
            }
        }

        stage('下载制品') {
            steps {
                container('maven') {
                    sh """
                        # 下载制品到本地
                        curl -u \${NEXUS_CREDS} \
                            -o myapp.jar \
                            "${NEXUS_URL}/repository/${NEXUS_REPO}/com/example/myapp/1.0.0/myapp-1.0.0.jar"
                    """
                }
            }
        }
    }
}
```

### npm 制品

```groovy
// Jenkinsfile 中使用 Nexus 作为 npm 制品库
pipeline {
    agent any

    environment {
        NPM_REGISTRY = 'https://nexus.example.com/repository/npm-hosted/'
        NPM_CREDS = credentials('npm-credential')
    }

    stages {
        stage('发布 npm 包') {
            steps {
                container('node') {
                    sh """
                        # 配置 npm registry
                        npm config set registry=${NPM_REGISTRY}

                        # 登录 npm 仓库
                        echo \${NPM_CREDS} | npm login --registry=${NPM_REGISTRY}

                        # 发布包
                        npm publish --access public

                        # 登出
                        npm logout
                    """
                }
            }
        }
    }
}
```

## 完整流水线示例

```groovy
// Java 项目的完整制品管理流水线
pipeline {
    agent {
        kubernetes {
            label 'maven-agent'
            defaultContainer 'maven'
        }
    }

    parameters {
        string(name: 'VERSION', defaultValue: '', description: '版本号（留空使用 SNAPSHOT）')
        choice(name: 'TARGET_ENV', choices: ['dev', 'test', 'prod'], description: '目标环境')
    }

    environment {
        DOCKER_REGISTRY = 'harbor.example.com'
        NEXUS_URL = 'https://nexus.example.com'
        APP_NAME = 'order-service'
        REGISTRY_CREDS = credentials('harbor-credential')
        NEXUS_CREDS = credentials('nexus-credential')
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
                    sh '''
                        mvn clean package -DskipTests
                    '''
                }
            }
        }

        stage('单元测试') {
            steps {
                container('maven') {
                    sh '''
                        mvn test
                    '''
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

        stage('部署到 Nexus（快照版）') {
            when {
                expression { params.VERSION == '' }
            }
            steps {
                container('maven') {
                    sh '''
                        mvn deploy -DskipTests
                    '''
                }
            }
        }

        stage('部署到 Nexus（正式版）') {
            when {
                expression { params.VERSION != '' }
            }
            steps {
                container('maven') {
                    sh """
                        mvn deploy -DskipTests -Drelease=${params.VERSION}
                    """
                }
            }
        }

        stage('构建 Docker 镜像') {
            steps {
                container('docker') {
                    sh """
                        IMAGE_TAG=\${params.VERSION != '' ? params.VERSION : 'SNAPSHOT-${BUILD_NUMBER}'}

                        docker build \
                            --tag ${DOCKER_REGISTRY}/project-a/${APP_NAME}:${IMAGE_TAG} \
                            --tag ${DOCKER_REGISTRY}/project-a/${APP_NAME}:latest \
                            --build-arg JAR_FILE=target/${APP_NAME}.jar \
                            .

                        echo \${REGISTRY_CREDS} | docker login ${DOCKER_REGISTRY} -u \${REGISTRY_CREDS_USR} --password-stdin

                        docker push ${DOCKER_REGISTRY}/project-a/${APP_NAME}:${IMAGE_TAG}
                        docker push ${DOCKER_REGISTRY}/project-a/${APP_NAME}:latest

                        docker logout
                    """
                }
            }
        }

        stage('镜像扫描') {
            steps {
                container('trivy') {
                    sh """
                        trivy image \
                            --exit-code 1 \
                            --severity CRITICAL \
                            --no-progress \
                            --ignore-unfixed \
                            ${DOCKER_REGISTRY}/project-a/${APP_NAME}:\${params.VERSION != '' ? params.VERSION : 'latest'}
                    """
                }
            }
        }

        stage('更新 K8s 部署') {
            when {
                expression { params.TARGET_ENV != '' }
            }
            steps {
                sh """
                    # 更新镜像版本
                    sed 's|IMAGE_TAG|${DOCKER_REGISTRY}/project-a/${APP_NAME}:\${params.VERSION != '' ? params.VERSION : 'SNAPSHOT-${BUILD_NUMBER}'}|g' \
                        k8s/${params.TARGET_ENV}/deployment.yaml | kubectl apply -f -
                """
            }
        }
    }

    post {
        success {
            echo '流水线执行成功'
        }
        failure {
            echo '流水线执行失败'
        }
    }
}
```

## 最佳实践

### 制品命名规范

```bash
# 镜像命名规范
# {registry}/{project}/{service}:{version}
# 示例：
# harbor.example.com/project-a/order-service:v1.2.3
# harbor.example.com/project-a/order-service:SNAPSHOT-1234

# 二进制制品命名规范
# {groupId}/{artifactId}/{version}/{artifactId}-{version}.{ext}
# 示例：
# com.example/order-service/1.2.3/order-service-1.2.3.jar

# Tag 命名规范
# 正式版本：v1.0.0, v1.2.3
# 快照版本：SNAPSHOT-{BUILD_NUMBER}
# Git Tag：git-{git-commit-hash}
```

### 多环境制品隔离

```bash
# 不同环境的制品存储在不同仓库
# Harbor 项目隔离
# project-dev     → 开发环境镜像
# project-test    → 测试环境镜像
# project-prod    → 生产环境镜像

# Nexus 仓库隔离
# maven-snapshots → 开发快照
# maven-releases  → 生产正式版本
# npm-snapshots   → npm 快照
# npm-releases    → npm 正式版本
```

## 面试追问方向

1. **制品仓库和镜像仓库有什么区别？**
   答：制品仓库存储构建产物（二进制 JAR、npm 包、Helm Chart 等），镜像仓库专门存储 Docker 镜像。但两者有重叠——Harbor 同时支持 Docker 镜像和 Helm Chart，Nexus 支持 Docker 镜像仓库插件。实践中，通常制品仓库存源代码编译产物，镜像仓库存容器镜像。

2. **镜像为什么要打多个 Tag？**
   答：典型做法是打两个 Tag：`latest` 和 `${BUILD_NUMBER}`（或版本号）。`latest` 始终指向最新构建，便于开发测试；`BUILD_NUMBER` 是不可变的，用于精确回溯。如果只用 `latest`，出问题时无法确定是哪个构建导致的。

3. **制品仓库的清理策略是什么？**
   答：快照版本定期清理（保留最近 N 个），正式版本永久保留。Harbor 的 GC 可以清理未引用的镜像层。Nexus 可以配置 Blob Store 的清理策略（基于最后访问时间、引用状态等）。生产环境的制品要谨慎清理，建议先确认没有其他流水线在引用。

> "制品仓库是 CI/CD 的『仓库』，镜像仓库是 K8s 的『粮仓』。两者配合，让代码从提交到部署全程可追溯、可回滚。"
