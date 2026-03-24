# Docker 核心概念：镜像、容器、仓库

如果你是 Docker 新手，第一个困惑大概是：**镜像（Image）和容器（Container）到底有什么区别？仓库（Registry）又是干什么的？**

用一个不精确但形象的比喻：

- **镜像** = 程序的「基因」
- **容器** = 基因表达后的「生命体」
- **仓库** = 保存基因的「图书馆」

## 镜像：应用程序的只读模板

镜像是一个只读的模板，包含了运行应用程序所需的一切：

- 应用程序本身
- 应用程序的依赖（操作系统库、运行时环境）
- 配置文件
- 启动命令

镜像的分层结构是 Docker 最核心的设计之一（后面会单独讲）。

### 镜像的标识

一个镜像通常有三种标识方式：

```bash
# 1. 使用标签（推荐）
nginx:latest
nginx:1.21-alpine

# 2. 使用 SHA256 摘要（精确，唯一）
sha256:a53e4e2ef7...4d2b9

# 3. 使用镜像 ID（完整或缩写）
f652ca387e0a
f652ca3
```

镜像名由 registry、repository、tag 三部分组成：

```bash
# 格式：[registry/]repository[:tag]
# 例如：
docker.io/library/nginx:latest
# │       │        │    │
# │       │        │    └── tag（版本标签）
# │       │        └──────── repository（仓库名）
# │       └───────────────── 默认 registry（Docker Hub）
# └────────────────────────── registry 地址
```

如果你拉取的镜像是 `nginx:latest`，实际访问的是 `docker.io/library/nginx:latest`——默认 registry 是 Docker Hub，默认 repository 前缀是 `library`。

### 常用镜像操作

```bash
# 拉取镜像
docker pull nginx:1.21-alpine

# 查看本地镜像
docker images
docker image ls

# 查看镜像详情（包含分层信息）
docker image inspect nginx:latest

# 删除镜像
docker rmi nginx:latest

# 给镜像打标签
docker tag nginx:latest myregistry.com/myapp:1.0

# 推送镜像到仓库
docker push myregistry.com/myapp:1.0
```

## 容器：镜像的运行实例

容器是镜像的运行实例。如果把镜像比作「图纸」，那么容器就是「按照图纸建造出来的房子」。

同一个镜像可以创建多个容器，每个容器都是独立的：

```bash
# 从镜像创建容器（不自动启动）
docker create nginx:1.21-alpine

# 从镜像创建并启动容器
docker run -d --name my-nginx nginx:1.21-alpine

# 查看运行中的容器
docker ps

# 查看所有容器（包括已停止的）
docker ps -a

# 停止/启动/重启容器
docker stop my-nginx
docker start my-nginx
docker restart my-nginx

# 进入容器内部（获得 shell）
docker exec -it my-nginx /bin/sh

# 删除容器（必须先停止）
docker rm my-nginx

# 查看容器日志
docker logs my-nginx -f
```

### 容器与进程

容器本质上就是一个进程，但它通过 Linux 命名空间获得了「独立的视角」：

- **PID Namespace**：容器内的进程有自己独立的 PID 序列（1, 2, 3...），宿主机上看到的是另一个 PID
- **Network Namespace**：容器有自己的网络栈（IP 地址、端口、路由表）
- **Mount Namespace**：容器有自己的文件系统视图
- **UTS Namespace**：容器有自己独立的主机名和域名
- **IPC Namespace**：容器有自己独立的共享内存和信号量
- **User Namespace**：容器内的用户可以映射到宿主机上的不同用户

这就是 Docker 实现隔离的核心机制。

### 容器生命周期

```
创建（create） → 启动（start） → 运行（running）
                     ↑              │
                     │              ↓
                 重启（restart）  停止（stop）
                     ↑              │
                     │              ↓
                 删除（rm）     暂停（pause）
```

## 仓库：镜像的分发中心

镜像仓库（Registry）是存储和分发镜像的服务。

### 公共仓库 vs 私有仓库

| 类型 | 代表 | 特点 |
|------|------|------|
| **公共仓库** | Docker Hub、Quay | 社区共享，下载快，但可能存在安全风险 |
| **私有仓库** | Harbor、Docker Registry | 企业自建，安全性高，可控性强 |
| **云厂商托管** | AWS ECR、阿里云 ACR | 集成云厂商生态，免运维 |

### Docker Hub 常用操作

```bash
# 搜索镜像
docker search nginx

# 登录 Docker Hub
docker login

# 拉取官方镜像
docker pull nginx

# 登录私有仓库
docker login myregistry.com -u username

# 推送镜像
docker push myregistry.com/myapp:1.0
```

### 搭建私有仓库

对于企业内部，搭建私有仓库是常见需求：

```bash
# 启动一个最简 Registry 服务
docker run -d \
  -p 5000:5000 \
  --name registry \
  -v registry-data:/var/lib/registry \
  registry:2

# 推送镜像到私有仓库
docker tag myapp:1.0 localhost:5000/myapp:1.0
docker push localhost:5000/myapp:1.0

# 从私有仓库拉取
docker pull localhost:5000/myapp:1.0
```

生产环境中推荐使用 Harbor，它提供更完善的功能：镜像复制、镜像扫描、访问控制、Web UI 等。

## 三者关系图

```
┌─────────────────────────────────────────────────────────┐
│                    仓库（Registry）                      │
│                                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  │
│  │ myapp:1 │  │myapp:2  │  │ nginx:1 │  │ redis:6 │  │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  │
└─────────────────────────────────────────────────────────┘
            ↑ pull                        ↑ pull
            │                             │
            └───────────┬─────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│                  镜像（Image）— 只读模板                  │
│                                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  │
│  │ myapp:1 │  │myapp:2  │  │ nginx:1 │  │ redis:6 │  │
│  │  (层)   │  │  (层)   │  │  (层)   │  │  (层)   │  │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  │
└─────────────────────────────────────────────────────────┘
                        ↑ create/run
                        │
┌─────────────────────────────────────────────────────────┐
│                 容器（Container）— 运行实例               │
│                                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐               │
│  │容器 myapp│  │容器 nginx│  │容器 redis│               │
│  │ (读写层) │  │ (读写层) │  │ (读写层) │               │
│  └─────────┘  └─────────┘  └─────────┘               │
└─────────────────────────────────────────────────────────┘
```

## 常见面试问题

### Q1: 镜像和容器的关系是什么？

镜像是一个静态的只读模板，容器是镜像的运行实例。多个容器可以由同一个镜像创建，每个容器有自己独立的读写层（Copy-on-Write）。

### Q2: 删除容器会删除镜像吗？

不会。容器是镜像的实例，删除容器就像「销毁一个房子」，而镜像（图纸）还在。只有删除镜像，图纸才真正消失。

### Q3: 容器和虚拟机的本质区别是什么？

虚拟机通过 Hypervisor 虚拟化硬件，每个虚拟机运行独立的操作系统；容器通过 Linux Namespace 和 Cgroup 实现进程级隔离，共享宿主机内核。

> "理解镜像、容器、仓库的关系，是掌握 Docker 的第一步。建议动手实践：用 Dockerfile 构建一个自己的镜像，推送到私有仓库，再拉取到另一台机器运行。"
