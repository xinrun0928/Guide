# Jenkins 与 Docker、Kubernetes 集成

「Jenkins 怎么构建 Docker 镜像？怎么部署到 K8s？」——集成是 Jenkins 的强项。

Jenkins 的价值在于它能连接各种工具链。Docker 构建、K8s 部署、Helm Chart 管理——这些都可以在 Jenkins 流水线中自动化完成。

## Docker 集成

### Docker Pipeline 插件

```groovy
pipeline {
    agent {
        docker {
            image 'maven:3.9-eclipse-temurin-17'
            args '-v $HOME/.m2:/root/.m2'
            label 'docker'
        }
    }

    stages {
        stage('Build') {
            steps {
                sh 'mvn clean package'
            }
        }
    }
}
```

### 多容器流水线

```groovy
pipeline {
    agent none

    stages {
        stage('Build & Test') {
            steps {
                script {
                    docker.withRegistry('https://registry.example.com', 'docker-registry') {
                        def image = docker.build("myapp:${env.BUILD_NUMBER}", """
                            Dockerfile
                            --build-arg VERSION=${env.BUILD_NUMBER}
                        """)

                        // 构建后立即测试
                        def testContainer = image.run('-p 8080:8080')
                        try {
                            sh 'sleep 10 && curl -f http://localhost:8080/health'
                            sh 'docker exec ${testContainer.id} mvn test'
                        } finally {
                            testContainer.stop()
                        }

                        // 推送到 registry
                        image.push()
                        image.push('latest')
                    }
                }
            }
        }
    }
}
```

### DinD（Docker-in-Docker）

在 K8s Pod 中运行 Docker-in-Docker：

```groovy
agent {
    kubernetes {
        label 'docker-build'
        yaml '''
            apiVersion: v1
            kind: Pod
            spec:
                containers:
                    - name: dind
                      image: docker:24-dind
                      securityContext:
                        privileged: true
                      volumeMounts:
                          - name: docker-graph-storage
                            mountPath: /var/lib/docker
                volumes:
                    - name: docker-graph-storage
                      emptyDir: {}
        '''
    }
}

stages {
    stage('Build Docker Image') {
        steps {
            container('dind') {
                sh '''
                    dockerd &
                    sleep 5
                    docker build -t myapp:${BUILD_NUMBER} .
                    docker push myapp:${BUILD_NUMBER}
                '''
            }
        }
    }
}
```

## Kubernetes 集成

### Kubernetes Plugin：动态 Agent

安装 `kubernetes` 插件后，Jenkins 可以自动在 K8s 集群中创建 Pod 来执行构建：

```groovy
// Jenkinsfile
pipeline {
    agent {
        kubernetes {
            label 'java-build'
            defaultContainer 'maven'
            yaml '''
                apiVersion: v1
                kind: Pod
                spec:
                    serviceAccountName: jenkins-agent
                    containers:
                        - name: maven
                          image: maven:3.9-eclipse-temurin-17
                          command: ["sleep"]
                          args: ["infinity"]
                          resources:
                            requests:
                                cpu: "1"
                                memory: "1Gi"
                            limits:
                                cpu: "2"
                                memory: "2Gi"
                          volumeMounts:
                              - name: maven-cache
                                mountPath: /root/.m2
                    volumes:
                        - name: maven-cache
                          persistentVolumeClaim:
                            claimName: maven-cache-pvc
            '''
        }
    }

    stages {
        stage('Build') {
            steps {
                container('maven') {
                    sh 'mvn clean package -DskipTests'
                }
            }
        }
    }
}
```

### K8s 部署流水线

```groovy
pipeline {
    agent any

    environment {
        REGISTRY = 'registry.example.com'
        APP_NAME = 'my-service'
        NAMESPACE = 'production'
    }

    stages {
        stage('Build Image') {
            steps {
                script {
                    def imageTag = "${env.REGISTRY}/${env.APP_NAME}:${env.BUILD_NUMBER}"
                    docker.withRegistry("https://${env.REGISTRY}", 'docker-credentials') {
                        def image = docker.build(imageTag, """
                            -f Dockerfile
                            --build-arg JAR_FILE=target/app.jar
                            .
                        """)
                        image.push()
                        image.push('latest')
                    }
                    currentBuild.displayName = "#${env.BUILD_NUMBER}"
                }
            }
        }

        stage('Deploy to K8s') {
            when {
                branch 'main'
            }
            steps {
                script {
                    def imageTag = "${env.REGISTRY}/${env.APP_NAME}:${env.BUILD_NUMBER}"
                    sh """
                        kubectl set image deployment/${env.APP_NAME} \\
                            ${env.APP_NAME}=${imageTag} \\
                            -n ${env.NAMESPACE}

                        kubectl rollout status deployment/${env.APP_NAME} \\
                            -n ${env.NAMESPACE} \\
                            --timeout=300s
                    """
                }
            }
        }

        stage('Smoke Test') {
            steps {
                script {
                    def svcUrl = "http://${env.APP_NAME}.${env.NAMESPACE}.svc.cluster.local"
                    sh """
                        sleep 10
                        curl -f "${svcUrl}/health"
                        curl -f "${svcUrl}/api/version"
                    """
                }
            }
        }
    }

    post {
        success {
            echo 'Deployment successful!'
            slackSend channel: '#ci-cd', color: 'good',
                message: "Deployed ${APP_NAME}:${BUILD_NUMBER} to ${NAMESPACE}"
        }
        failure {
            echo 'Deployment failed!'
            slackSend channel: '#ci-cd', color: 'danger',
                message: "Failed to deploy ${APP_NAME} to ${NAMESPACE}. Check ${BUILD_URL}"
        }
    }
}
```

### Helm Chart 部署

```groovy
stage('Deploy via Helm') {
    steps {
        script {
            withCredentials([file(credentialsId: 'kubeconfig', variable: 'KUBECONFIG')]) {
                sh '''
                    helm upgrade --install myapp ./chart \
                        --namespace production \
                        --set image.tag=${BUILD_NUMBER} \
                        --set image.repository=${REGISTRY}/${APP_NAME} \
                        --wait --timeout 5m \
                        --timeout 300s

                    helm test myapp --namespace production
                '''
            }
        }
    }
}
```

## 凭证管理

### Kubeconfig 凭证

在 Jenkins 中创建 `Kubernetes configuration (kubeconfig)` 类型的凭证：

```groovy
// 使用 Kubeconfig 凭证部署
withCredentials([file(credentialsId: 'prod-kubeconfig', variable: 'KUBECONFIG')]) {
    sh '''
        kubectl --kubeconfig=$KUBECONFIG apply -f deployment.yaml
    '''
}
```

### Docker Registry 凭证

```groovy
// 登录到私有 registry
docker.withRegistry('https://registry.example.com', 'docker-registry') {
    def image = docker.build("myapp:${BUILD_NUMBER}")
    image.push()
}
```

### SSH 凭证

```groovy
// 使用 SSH 凭证
withCredentials([sshUserPrivateKey(
    credentialsId: 'deploy-ssh-key',
    keyFileVariable: 'SSH_KEY',
    passphraseVariable: '',
    usernameVariable: 'SSH_USER'
)]) {
    sh '''
        chmod 600 $SSH_KEY
        scp -i $SSH_KEY build.jar ${SSH_USER}@server:/opt/app/
        ssh -i $SSH_KEY ${SSH_USER}@server "systemctl restart myapp"
    '''
}
```

## 完整示例：Java 微服务 CI/CD

```groovy
pipeline {
    agent {
        kubernetes {
            label 'java-microservice'
            defaultContainer 'maven'
        }
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 30, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    environment {
        REGISTRY = 'registry.example.com'
        APP_NAME = 'user-service'
        NAMESPACE = 'staging'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
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
                    script {
                        def scannerHome = tool 'SonarQube'
                        withSonarQubeEnv('SonarQube') {
                            sh """
                                ${scannerHome}/bin/sonar-scanner \
                                    -Dsonar.projectKey=${APP_NAME} \
                                    -Dsonar.sources=src
                            """
                        }
                    }
                }
            }
        }

        stage('Build & Push Image') {
            steps {
                container('docker') {
                    script {
                        def imageTag = "${REGISTRY}/${APP_NAME}:${BUILD_NUMBER}"
                        def image = docker.build(imageTag, "-f Dockerfile .")
                        docker.withRegistry("https://${REGISTRY}", 'docker-credentials') {
                            image.push()
                        }
                    }
                }
            }
        }

        stage('Trivy Scan') {
            steps {
                container('trivy') {
                    sh '''
                        trivy image --exit-code 1 \
                            --severity HIGH,CRITICAL \
                            --ignore-unfixed \
                            ${REGISTRY}/${APP_NAME}:${BUILD_NUMBER}
                    '''
                }
            }
        }

        stage('Deploy to Staging') {
            steps {
                container('kubectl') {
                    sh '''
                        kubectl set image deployment/${APP_NAME} \
                            ${APP_NAME}=${REGISTRY}/${APP_NAME}:${BUILD_NUMBER} \
                            -n ${NAMESPACE}
                        kubectl rollout status deployment/${APP_NAME} -n ${NAMESPACE}
                    '''
                }
            }
        }

        stage('Smoke Test') {
            steps {
                script {
                    def baseUrl = "http://${APP_NAME}.${NAMESPACE}.svc.cluster.local"
                    sleep(15)
                    sh """
                        curl -f ${baseUrl}/actuator/health
                        curl -f ${baseUrl}/api/users
                    """
                }
            }
        }
    }

    post {
        always {
            cleanWs()
        }
        success {
            emailext(
                subject: "SUCCESS: ${APP_NAME} #${BUILD_NUMBER}",
                body: "Pipeline succeeded. Version: ${BUILD_NUMBER}",
                to: 'team@example.com'
            )
        }
    }
}
```

## 面试追问方向

- Docker-in-Docker 在 K8s 中运行时需要什么特权？有什么安全风险？
- Kubernetes Plugin 的 Agent Pod 是怎么创建的？构建完成后 Pod 会怎样？
- 如何在 Jenkins 流水线中实现「手动审批后才能部署到生产」？
- Jenkins 和 K8s 集成时，ServiceAccount 的 RBAC 权限应该怎么配置？

> Jenkins 和 Docker/K8s 的集成，是 Jenkins 从 CI 工具进化为完整 CI/CD 平台的关键。理解这些集成方式，就能构建一套完整的云原生交付流水线。
