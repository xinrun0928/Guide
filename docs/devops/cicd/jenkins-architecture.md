# Jenkins 架构：Master-Slave 分布式构建

「Jenkins 怎么支撑大规模 CI/CD？」——Master-Slave 架构是答案。

Jenkins 是 CI/CD 领域的老牌工具，尽管现代云原生 CI/CD 工具崛起，Jenkins 仍然是很多企业的核心构建系统。理解它的分布式架构，是用好 Jenkins 的基础。

## Jenkins 架构概述

```
┌──────────────────────────────────────────────────────────────┐
│                     Jenkins Master                            │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Web UI       │  │  Build Queue  │  │  Plugin     │    │
│  │ (管理界面)    │  │  (任务调度)   │  │  Manager    │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                              │
│  核心职责：                                                  │
│  - 管理配置（Job 定义、节点配置）                             │
│  - 调度构建（接收构建请求，分发到 Agent）                    │
│  - 存储构建历史和产物                                       │
│  - 提供 Web UI 和 API                                       │
│  - 管理插件                                                 │
└──────────────────────────────────────────────────────────────┘
           │
           │  JNLP / SSH / Kubernetes Plugin
           ▼
┌──────────────────────────────────────────────────────────────┐
│                   Jenkins Agent（工作节点）                    │
│                                                              │
│  ┌────────────────┐   ┌────────────────┐                    │
│  │  Agent 1         │   │  Agent 2         │                │
│  │  (构建节点)      │   │  (构建节点)      │                │
│  │  ┌──────────┐  │   │  ┌──────────┐  │               │
│  │  │  Job 1    │  │   │  │  Job 2    │  │               │
│  │  └──────────┘  │   │  └──────────┘  │               │
│  └────────────────┘   └────────────────┘                    │
│                                                              │
│  Agent 可以是物理机、虚拟机、容器，甚至 Kubernetes Pod       │
└──────────────────────────────────────────────────────────────┘
```

## Master 节点职责

Jenkins Master 是整个系统的核心：

| 职责 | 说明 |
|------|------|
| 任务配置管理 | 创建、编辑、删除 Job 配置 |
| 用户认证授权 | 管理用户、角色、权限 |
| 构建调度 | 决定哪个 Agent 执行哪个构建 |
| 插件管理 | 安装、更新、卸载插件 |
| 构建历史存储 | 存储每个构建的日志和产物 |
| Web UI / API | 提供人机交互界面 |
| 数据持久化 | 所有配置存储在 `JENKINS_HOME` 目录 |

**Jenkins Master 不应该运行构建任务**，应该只做调度和管理。所有构建都应该分发到 Agent 节点。

## Agent 节点连接方式

### 方式一：JNLP（Java Web Start）

通过 Java Web Start 协议，Agent 从 Master 下载 JNLP 文件并启动：

```bash
# 在 Agent 机器上下载 agent.jar
wget http://<master>:8080/jnlpJars/agent.jar

# 启动 Agent
java -jar agent.jar \
  -jnlpUrl http://<master>:8080/computer/<agent-name>/slave-agent.jnlp \
  -secret <secret-key> \
  -workDir "/var/jenkins_agent"
```

适合场景：Agent 在防火墙后，无法直接 SSH 到 Master。

### 方式二：SSH

Master 通过 SSH 连接到 Agent 机器：

```bash
# 在 Master 上配置 SSH 凭证
# Manage Jenkins → Manage Nodes → New Node
# Launch method: via SSH
# Host: agent-node-1.example.com
# Credentials: SSH username with private key
```

适合场景：Agent 可以从 Master SSH 访问。

### 方式三：Kubernetes Plugin（推荐）

在容器化环境中，使用 Kubernetes Plugin 让 Jenkins 在 K8s Pod 中运行构建：

```groovy
// Jenkinsfile 中配置 Kubernetes Pod Template
podTemplate(
  label: 'java-builder',
  cloud: 'kubernetes',
  containers: [
    containerTemplate(
      name: 'maven',
      image: 'maven:3.9-eclipse-temurin-17',
      ttyEnabled: true,
      command: ''
    ),
    containerTemplate(
      name: 'docker',
      image: 'docker:24-dind',
      ttyEnabled: true,
      command: '',
      privileged: true
    )
  ],
  volumes: [
    hostPathVolume(hostPath: '/var/run/docker.sock', mountPath: '/var/run/docker.sock')
  ]
) {
  node('java-builder') {
    container('maven') {
      stage('Build') {
        sh 'mvn clean package'
      }
      container('docker') {
        sh 'docker build -t myapp:${BUILD_NUMBER} .'
      }
    }
  }
}
```

## Agent 标签与任务分发

给 Agent 打标签，实现任务按需分发：

```bash
# 在 Agent 节点配置中设置标签
# Node Properties → Labels
# 标签：docker, linux, maven, nodejs
```

```groovy
// Jenkinsfile 中指定在特定标签的 Agent 上运行
pipeline {
  agent {
    label 'docker && linux'
  }
  stages {
    stage('Build') {
      steps {
        echo "Running on Docker-enabled Linux node"
      }
    }
  }
}
```

### 标签使用策略

| 标签 | Agent 能力 | 用途 |
|------|-----------|------|
| `docker` | 安装了 Docker | 需要构建镜像的 Job |
| `linux` | Linux 系统 | Linux 特定任务 |
| `windows` | Windows 系统 | Windows 特定任务 |
| `high-memory` | 大内存机器 | 内存密集型构建 |
| `macos` | macOS 系统 | Apple 平台构建 |
| `k8s` | K8s 集群 | K8s 部署任务 |

## 分布式构建的配置

### 矩阵式权限控制（Role-based）

Jenkins 支持基于项目和 Agent 的权限控制：

```groovy
// 在 Jenkinsfile 中使用 when 条件
pipeline {
  agent any
  stages {
    stage('Build') {
      when {
        expression { env.BRANCH_NAME == 'main' }
      }
      steps {
        echo "Building main branch"
      }
    }
  }
}
```

### 并行构建

```groovy
pipeline {
  agent any
  stages {
    stage('Parallel Builds') {
      parallel {
        stage('Build Frontend') {
          agent { label 'nodejs' }
          steps {
            echo "Building frontend..."
            sh 'npm run build'
          }
        }
        stage('Build Backend') {
          agent { label 'maven' }
          steps {
            echo "Building backend..."
            sh 'mvn clean package'
          }
        }
        stage('Build Mobile') {
          agent { label 'macos' }
          steps {
            echo "Building mobile app..."
            sh './build-mobile.sh'
          }
        }
      }
    }
  }
}
```

## 架构选型建议

| 规模 | Agent 数量 | 推荐架构 |
|------|-----------|---------|
| 小团队（< 10 人） | 2-3 个 | Master + 物理机 Agent |
| 中型团队（10-50 人） | 5-10 个 | Master + VM Agent + Kubernetes |
| 大型团队（50+ 人） | 数十到数百 | Kubernetes Plugin + 动态 Agent |

## 常见问题

### Master 节点负载过高

```bash
# 将所有构建任务迁移到 Agent
# Manage Jenkins → Manage Nodes → Configure
# ✓ Only build jobs with label expressions matching this node → 取消勾选允许 Master 运行构建

# 设置 Master 只运行特定任务
# 在 Master 节点设置标签为 "master-only"
# 只将管理类任务分配给它
```

### Agent 频繁断开

```bash
# 检查 Agent 的 "Keep this agent online" 设置
# 默认 5 分钟无活动后会自动断开

# 调整 Keep alive strategy
# Managed files → Add → Slave Setup → Ping

# 检查网络问题
# telnet <master-ip> <master-port>
```

### Kubernetes Agent 启动慢

```yaml
# 优化 Pod 启动时间
# 1. 使用较小的基础镜像
# 2. 预热常用镜像（通过 Pod Template 的 instanceCap 配置）

# 3. 配置 Pod 保留策略（构建完成后不立即销毁）
podTemplate(
  label: 'builder',
  cloud: 'kubernetes',
  activeDeadlineSeconds: 3600,
  yaml: '''
    spec:
      terminationGracePeriodSeconds: 30
  '''
) {
  // ...
}
```

## 面试追问方向

- Jenkins Master 为什么不应该跑构建任务？
- Kubernetes Plugin 的 Agent 是怎么工作的？为什么说它是云原生 CI/CD 的好选择？
- Jenkins 的分布式架构和现代 CI/CD 工具（如 GitHub Actions、Tekton）的架构有什么区别？
- 如何设计一个支持数百个并发构建的 Jenkins 集群？

> Jenkins 的 Master-Slave 架构本质上是集中式调度 + 分布式执行。理解了这个模型，就能理解它的扩展瓶颈和优化方向。
