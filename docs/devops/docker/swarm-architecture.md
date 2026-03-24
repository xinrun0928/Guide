# Docker Swarm 架构：Manager 节点与 Worker 节点

当你需要运行多个 Docker 容器，并希望它们协同工作时，单机 Docker 就不够用了。Docker Swarm 就是 Docker 官方提供的原生集群管理和编排解决方案。

这篇文章，聊聊 Docker Swarm 的架构设计。

## Docker Swarm 是什么？

Docker Swarm 是 Docker 内置的容器编排工具，将多个 Docker 主机整合成一个虚拟的 Docker 主机。

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Swarm 集群                         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                   Manager 节点（Leader）              │  │
│  │                                                       │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐           │  │
│  │  │  API     │  │  Orchestrator│  Allocator │          │  │
│  │  │  (外部)  │  │           │           │           │  │
│  │  └──────────┘  └──────────┘  └──────────┘           │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐           │  │
│  │  │ Scheduler│  │  Dispatcher│  Collector │          │  │
│  │  │          │  │           │           │           │  │
│  │  └──────────┘  └──────────┘  └──────────┘           │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                    Worker 节点                       │  │
│  │                                                       │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐              │  │
│  │  │ 容器 A  │  │ 容器 B  │  │ 容器 C  │              │  │
│  │  └─────────┘  └─────────┘  └─────────┘              │  │
│  │                     ↑                                 │  │
│  │              Task 执行器                             │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Swarm 集群初始化

### 初始化 Swarm

```bash
# 初始化 Swarm（成为 Manager）
docker swarm init --advertise-addr 192.168.1.100

# 输出：
# Swarm initialized: current node (abc123...) is now a manager.
#
# To add a worker to this swarm, run the following command:
# docker swarm join --token SWMTKN-1-xxxxx 192.168.1.100:2377
#
# To add a manager to this swarm, run:
# docker swarm join-token manager
```

### 加入集群

```bash
# Worker 节点加入
docker swarm join --token SWMTKN-1-xxxxx 192.168.1.100:2377

# Manager 节点加入
docker swarm join --token SWMTKN-1-xxxxx-manager 192.168.1.100:2377
```

### 查看集群状态

```bash
# 查看节点列表
docker node ls

# 输出：
# ID                            HOSTNAME   STATUS    AVAILABILITY   MANAGER STATUS
# abc123... *                   manager1   Ready     Active        Leader
# def456...                     worker1   Ready     Active
# ghi789...                     worker2   Ready     Active

# 查看节点详细信息
docker node inspect manager1
```

## Manager 节点职责

Manager 节点是集群的控制平面，负责：

- **API**：接收 Docker CLI 请求，提供集群 API
- **Orchestrator**：编排服务，创建/更新/删除任务
- **Allocator**：分配 IP 地址给服务
- **Dispatcher**：调度任务到节点
- **Scheduler**：决定任务应该在哪个节点运行
- **Cluster Store**：存储集群状态（使用 etcd）

### Raft 共识协议

Docker Swarm 使用 Raft 共识协议保证集群一致性：

```
┌─────────────────────────────────────────────────────────────┐
│                    Raft 共识组                               │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Manager 1  │  │   Manager 2  │  │   Manager 3  │      │
│  │   (Leader)   │←→│  (Follower) │←→│  (Follower) │      │
│  │              │  │              │  │              │      │
│  │  处理请求     │  │  复制日志     │  │  复制日志     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│         ↑                                                      │
│    所有写请求通过 Leader                                       │
└─────────────────────────────────────────────────────────────┘
```

### 节点状态

```bash
# 节点可用性
docker node update --availability drain manager1
# Active: 接受新任务
# Pause: 不接受新任务，保持现有任务
# Drain: 不接受新任务，驱逐现有任务

# 节点角色提升
docker node promote worker1
# Worker → Manager

# 节点角色降级
docker node demote manager2
# Manager → Worker
```

## Worker 节点职责

Worker 节点运行容器任务，接收 Manager 分发的任务并执行：

```
┌─────────────────────────────────────────────────────────────┐
│                    Worker 节点                              │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                   Task Executor                      │  │
│  │                                                       │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐              │  │
│  │  │  Task 1 │  │  Task 2 │  │  Task 3 │              │  │
│  │  │ (容器)  │  │ (容器)  │  │ (容器)  │              │  │
│  │  └─────────┘  └─────────┘  └─────────┘              │  │
│  │                                                       │  │
│  │  ┌─────────┐  ┌─────────┐                           │  │
│  │  │  Task 4 │  │  Task 5 │                           │  │
│  │  │ (容器)  │  │ (容器)  │                           │  │
│  │  └─────────┘  └─────────┘                           │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                   Container Agent                     │  │
│  │           接收 Manager 指令，管理容器                │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Worker 节点操作

```bash
# 查看 Worker 详细信息
docker node inspect worker1

# Worker 离开集群（主动）
docker node rm worker1

# Worker 失联后强制移除
docker node rm --force worker1
```

## 服务与任务模型

### 服务（Service）

服务定义了容器如何在集群中运行：

```bash
# 创建服务
docker service create --name myapp \
    --replicas 3 \
    --publish 8080:80 \
    nginx:alpine

# 查看服务列表
docker service ls

# 查看服务详情
docker service inspect myapp

# 查看服务运行状态
docker service ps myapp
```

### 任务（Task）

任务是调度的基本单元，每个任务运行一个容器：

```
服务创建流程：

1. Manager 创建服务
      ↓
2. Orchestrator 创建任务
      ↓
3. Allocator 分配 IP
      ↓
4. Scheduler 选择节点
      ↓
5. Dispatcher 分发任务
      ↓
6. Worker 执行任务（启动容器）
```

### 任务状态

```
NEW → PREPARING → STARTING → RUNNING → COMPLETE
                              ↓
                           FAILED
                              ↓
                        SHUTDOWN
```

## 集群高可用

### Manager 数量建议

| 集群规模 | 推荐 Manager 数 | 说明 |
|---------|----------------|------|
| 1-5 节点 | 1 | 小规模，不需要 HA |
| 5-10 节点 | 3 | 一般生产环境 |
| 10-50 节点 | 3-5 | 中等规模 |
| 50+ 节点 | 5-7 | 大规模集群 |

### 容错能力

| Manager 数量 | 容错能力 | 说明 |
|-------------|---------|------|
| 1 | 0 | 单点故障 |
| 3 | 1 | 可容忍 1 个 Manager 故障 |
| 5 | 2 | 可容忍 2 个 Manager 故障 |
| 7 | 3 | 可容忍 3 个 Manager 故障 |

### 添加 Manager

```bash
# 获取 Manager 加入令牌
docker swarm join-token manager

# 添加新的 Manager
docker swarm join \
    --token SWMTKN-1-xxxxx-manager \
    192.168.1.100:2377
```

## 网络架构

### Ingress 网络

Ingress 网络处理服务间的负载均衡：

```
┌─────────────────────────────────────────────────────────────┐
│                    Ingress Network                          │
│                                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                     │
│  │  节点 A  │  │  节点 B  │  │  节点 C  │                     │
│  │ ┌─────┐ │  │ ┌─────┐ │  │ ┌─────┐ │                     │
│  │ │容器1│ │  │ │容器2│ │  │ │容器3│ │                     │
│  │ └─────┘ │  │ └─────┘ │  │ └─────┘ │                     │
│  └────┬────┘  └────┬────┘  └────┬────┘                     │
│       │            │            │                           │
│       └────────────┼────────────┘                           │
│                    ↓                                         │
│              ┌──────────┐                                    │
│              │ Mesh DNS │                                    │
│              │ 路由层   │                                    │
│              └──────────┘                                    │
└─────────────────────────────────────────────────────────────┘
```

### Overlay 网络

```bash
# 创建 Overlay 网络（需要 Manager 节点）
docker network create \
    --driver overlay \
    --attachable \
    my-overlay-net

# 查看网络
docker network ls

# 在服务中使用
docker service create \
    --name myapp \
    --network my-overlay-net \
    nginx:alpine
```

## 配置管理

### 配置文件

```bash
# /etc/docker/daemon.json
{
    "storage-driver": "overlay2",
    "log-driver": "json-file",
    "log-opts": {
        "max-size": "10m",
        "max-file": "3"
    }
}
```

### 节点标签

```bash
# 给节点添加标签
docker node update --label-add region=us-east worker1
docker node update --label-add region=us-west worker2

# 查看标签
docker node inspect worker1 | grep Labels

# 使用标签调度
docker service create \
    --name myapp \
    --constraint 'node.labels.region==us-east' \
    nginx:alpine
```

## 监控与日志

### 查看集群日志

```bash
# 查看 Manager 日志
docker service logs myapp

# 实时查看
docker service logs -f myapp

# 查看任务日志
docker ps | grep myapp
docker logs <container-id>
```

### 查看集群资源

```bash
# 查看节点资源
docker node ls

# 查看服务资源使用
docker service ls

# 查看任务分布
docker service ps myapp
```

## 面试追问

1. **Docker Swarm 和 Kubernetes 的核心区别是什么？**
2. **Docker Swarm 的 Manager 节点是如何保证一致性的？Raft 协议在其中扮演什么角色？**
3. **为什么建议生产环境使用奇数个 Manager 节点？**
4. **Docker Swarm 的服务发现是怎么工作的？**
5. **如何在 Docker Swarm 中实现高可用？**

> "Docker Swarm 是 Docker 原生的编排方案，简单够用，适合中小规模场景。虽然 Kubernetes 已经成为容器编排的事实标准，但理解 Swarm 的架构有助于理解分布式系统的核心概念。"
