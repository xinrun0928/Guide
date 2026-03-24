# Jenkinsfile 声明式流水线语法

「Jenkins 流水线怎么写？」——Jenkinsfile 是答案。

Jenkinsfile 是用 Groovy DSL 编写的流水线配置文件，它把 CI/CD 流程代码化、版本化，和代码一起存储在 Git 中。声明式流水线比脚本式更易读、更安全，是现代 Jenkins 实践的主流选择。

## 声明式流水线基础结构

```groovy
// Jenkinsfile
pipeline {
    // 任何可用代理
    agent any

    // 环境变量（全局）
    environment {
        REGISTRY = 'registry.example.com'
        APP_NAME = 'my-service'
    }

    options {
        // 流水线级别的配置
        buildDiscarder(logRotator(numToKeepStr: '30'))
        timeout(time: 1, unit: 'HOURS')
        disableConcurrentBuilds()
    }

    stages {
        stage('Checkout') {
            steps {
                echo 'Checking out source code...'
                checkout scm
            }
        }

        stage('Build') {
            steps {
                echo 'Building application...'
                sh './gradlew build'
            }
        }

        stage('Test') {
            steps {
                echo 'Running tests...'
                sh './gradlew test'
            }
        }

        stage('Docker Build') {
            steps {
                echo 'Building Docker image...'
                sh '''
                    docker build -t ${REGISTRY}/${APP_NAME}:${BUILD_NUMBER} .
                    docker tag ${REGISTRY}/${APP_NAME}:${BUILD_NUMBER} ${REGISTRY}/${APP_NAME}:latest
                '''
            }
        }

        stage('Deploy') {
            when {
                branch 'main'
            }
            steps {
                echo 'Deploying to production...'
                sh 'kubectl apply -f k8s/'
            }
        }
    }

    post {
        always {
            echo 'Cleaning up...'
            cleanWs()
        }
        success {
            echo 'Build succeeded!'
            emailext(
                subject: "SUCCESS: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
                body: "Build ${env.BUILD_NUMBER} succeeded.",
                to: 'team@example.com'
            )
        }
        failure {
            echo 'Build failed!'
            emailext(
                subject: "FAILED: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
                body: "Build ${env.BUILD_NUMBER} failed. Check logs: ${env.BUILD_URL}",
                to: 'team@example.com'
            )
        }
    }
}
```

## agent 指令详解

agent 定义了流水线在哪里执行：

```groovy
// 任何可用节点
agent any

// 指定标签的节点
agent { label 'docker && linux' }

// 不分配节点（适合只有 stage-level agent 的流水线）
agent none

// Kubernetes Pod 内运行
agent {
    kubernetes {
        label 'java-builder'
        defaultContainer 'maven'
        yamlFile 'build-pod.yaml'
    }
}

// Docker 容器内运行
agent {
    docker {
        image 'maven:3.9-eclipse-temurin-17'
        args '-v $HOME/.m2:/root/.m2'
    }
}

// Docker 容器内运行，每次新容器
agent {
    dockerfile {
        filename 'Dockerfile.build'
        dir 'build-context'
        label 'docker'
    }
}
```

## stages 与 stage

```groovy
stages {
    // stage 是流水线的核心单元
    stage('Build') {
        steps {
            // steps 内写具体操作
            sh 'mvn clean package'
        }
    }

    stage('Test') {
        steps {
            sh 'mvn test'
        }
    }

    // stage 也可以嵌套 stages（不推荐，复杂）
    stage('CI') {
        stages {
            stage('Unit Tests') { steps { sh 'npm test' } }
            stage('Integration Tests') { steps { sh 'npm run test:integration' } }
        }
    }
}
```

## steps 常用指令

```groovy
// Shell 命令
steps {
    sh 'echo Hello'
    sh 'mvn clean package'
    sh '''
        echo "Multi-line script"
        docker build -t myapp .
    '''
}

// 输出日志
steps {
    echo 'Info message'
    echo "Variable: ${env.BUILD_NUMBER}"
}

// 读取文件
steps {
    script {
        def content = readFile 'config.properties'
        echo "Config: ${content}"
    }
}

// 创建文件
steps {
    writeFile file: 'output.txt', text: 'Hello World'
}

// 发送 HTTP 请求
steps {
    httpRequest 'http://example.com/api'
}

// Git 检出
steps {
    git branch: 'main',
         credentialsId: 'github-ssh-key',
         url: 'git@github.com:org/repo.git'
}

// 归档文件
steps {
    archiveArtifacts artifacts: 'target/*.jar', fingerprint: true
    archiveArtifacts 'dist/**, build/**, !dist/**/node_modules/**'
}
```

## when 条件判断

```groovy
stages {
    stage('Deploy Production') {
        when {
            // 只在 main 分支执行
            branch 'main'
        }
        steps {
            echo 'Deploying to production...'
        }
    }

    stage('Deploy Staging') {
        when {
            // main 或 release/* 分支
            anyOf {
                branch 'main'
                branch 'release/*'
            }
        }
        steps {
            echo 'Deploying to staging...'
        }
    }

    stage('Security Scan') {
        when {
            // NOT development 分支
            not { branch 'development' }
        }
        steps {
            echo 'Running security scan...'
            sh 'trivy image myapp:latest'
        }
    }

    stage('Deploy') {
        when {
            // 环境变量条件
            expression { env.ENABLE_DEPLOY == 'true' }
            // 提交信息包含特定内容
            changeRequest()
            // 文件变更检测
            changeset pattern: 'src/.*'
        }
        steps {
            echo 'Deploying...'
        }
    }
}
```

## environment 环境变量

```groovy
pipeline {
    environment {
        APP_VERSION = '1.0.0'
        DB_HOST = credentials('db-host')
        DB_PASSWORD = credentials('db-password')
    }

    stages {
        stage('Build') {
            environment {
                // stage 级别覆盖
                APP_VERSION = "${env.BUILD_NUMBER}.${env.GIT_COMMIT[0..7]}"
            }
            steps {
                echo "Building version: ${APP_VERSION}"
                sh 'echo $DB_PASSWORD | nc -w 1 db.example.com 3306'
            }
        }
    }
}
```

## credentials 凭证管理

```groovy
pipeline {
    environment {
        // 文本凭证
        API_TOKEN = credentials('api-token-secret')
        // 用户名密码凭证
        DOCKER_CREDS = credentials('dockerhub-credentials')
        // SSH 密钥
        SSH_KEY = credentials('deploy-ssh-key')
    }

    stages {
        stage('Push Image') {
            steps {
                sh '''
                    echo ${DOCKER_CREDS} | docker login -u USERNAME --password-stdin
                    docker push myapp:latest
                '''
            }
        }

        stage('Deploy via SSH') {
            steps {
                sh '''
                    ssh -i ${SSH_KEY} user@server "kubectl apply -f deployment.yaml"
                '''
            }
        }
    }
}
```

## parallel 并行执行

```groovy
stages {
    stage('Test') {
        parallel {
            stage('Unit Tests') {
                steps { sh 'npm run test:unit' }
            }
            stage('Integration Tests') {
                steps { sh 'npm run test:integration' }
            }
            stage('E2E Tests') {
                steps { sh 'npm run test:e2e' }
            }
            stage('Security Scan') {
                steps { sh 'trivy image myapp:latest' }
            }
        }
    }

    stage('Build') {
        parallel {
            stage('Build Frontend') {
                agent { label 'nodejs' }
                steps { sh 'cd frontend && npm run build' }
            }
            stage('Build Backend') {
                agent { label 'java' }
                steps { sh 'cd backend && ./gradlew build' }
            }
        }
    }
}
```

## 错误处理与重试

```groovy
pipeline {
    options {
        // 构建失败后重试 3 次
        retry(3)
    }

    stages {
        stage('Deploy') {
            steps {
                script {
                    def maxRetries = 3
                    def retryCount = 0
                    while (retryCount < maxRetries) {
                        try {
                            sh 'kubectl rollout status deployment/myapp'
                            break
                        } catch (Exception e) {
                            retryCount++
                            if (retryCount >= maxRetries) {
                                throw e
                            }
                            echo "Deployment failed, retrying (${retryCount}/${maxRetries})..."
                            sleep(time: 10, unit: 'SECONDS')
                        }
                    }
                }
            }
        }
    }

    post {
        always {
            // 即使失败也要清理
            cleanWs()
        }
    }
}
```

## 矩阵式构建（Matrix）

```groovy
pipeline {
    agent none
    stages {
        stage('Test on Multiple Platforms') {
            matrix {
                axes {
                    axis {
                        name 'PLATFORM'
                        values 'linux', 'windows', 'macos'
                    }
                    axis {
                        name 'JDK_VERSION'
                        values '11', '17', '21'
                    }
                }
                agent { label PLATFORM }
                stages {
                    stage('Test') {
                        steps {
                            echo "Testing on ${PLATFORM} with JDK ${JDK_VERSION}"
                            sh "make test JDK=${JDK_VERSION}"
                        }
                    }
                }
            }
        }
    }
}
```

## 面试追问方向

- 声明式流水线和脚本式流水线的核心区别是什么？什么时候用脚本式？
- Jenkinsfile 中的 `when` 条件可以实现哪些复杂的触发逻辑？
- 如何实现流水线步骤之间的数据传递？（如 Build stage 产出的 JAR 包路径）
- `post` 块的各种条件（always、success、failure、unstable）各在什么场景下使用？

> Jenkinsfile 把 CI/CD 流程代码化——每一次变更都记录在 Git 历史中，可以 review、可以回滚、可以复用。这是 Jenkins 从 CI 工具走向 CI/CD 平台的关键一步。
