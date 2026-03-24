# Docker

容器化技术的代名词，也是现代 DevOps 的起点。

很多人第一次接触 Docker，是被「 build once, run anywhere 」打动的。但真正用进去之后，你会发现它解决的远不止「环境一致性问题」这么简单——它改变了整个软件的交付方式：从写代码到打包、从部署到扩缩容，所有环节都被重新定义。

这篇文章系列，会从 Docker 的基础概念讲起，覆盖镜像构建、数据持久化、网络通信，再到 Docker Swarm 集群编排，以及生产环境中绕不开的镜像优化、安全加固和日志管理。无论你是刚接触容器，还是想系统性地补齐 Docker 知识体系，都能找到对应的内容。

## 模块速览

Docker 不只是一个工具，它是一套生态。从镜像构建到多容器编排，每一块都有大量细节值得深究。

| 方向 | 篇数 | 核心目标 |
|------|------|----------|
| [Docker 基础](/devops/docker/vm-vs-docker) | 10 篇 | 核心概念、镜像构建、网络存储、Compose/Registry |
| [Docker 进阶](/devops/docker/container-communication) | 8 篇 | 通信原理、存储驱动、资源限制、安全配置 |
| [Docker Swarm](/devops/docker/swarm-architecture) | 3 篇 | 集群架构、服务部署、负载均衡与服务发现 |

## 学习路径建议

```
第一阶段：入门上手（1-2 天）
→ 安装 Docker，理解镜像、容器、仓库三大概念
→ 跑通 Dockerfile，构建第一个自定义镜像
→ 用 Docker Compose 起一个多容器应用（如 WordPress）

第二阶段：生产级掌握（1 周）
→ 理解镜像分层与 Copy-on-Write 机制
→ 掌握数据持久化（Volume、Bind Mount）
→ 深入网络模式，理解容器间通信原理
→ 实践镜像优化：多阶段构建、.dockerignore、层缓存

第三阶段：集群与进阶（1 周）
→ Docker Swarm 集群部署与服务编排
→ 私有仓库搭建（Registry / Harbor）
→ 安全配置：用户命名空间、seccomp、capability
→ 日志驱动与资源限制
```

## 为什么 Docker 是 DevOps 的入口？

如果你在团队里推广过 CI/CD，大概率会遇到这个问题：「本地跑得好好的，怎么上线就挂了？」

根本原因往往是：**开发环境、测试环境、生产环境的差异**。操作系统版本不同、依赖库版本不同、甚至时区、语言环境都可能造成差异。

Docker 的核心价值，就是把这三个环境「合三为一」。你的应用连同它的所有依赖，打包成一个镜像，在任何装了 Docker 的机器上，跑出来的行为完全一致。

这也是 Kubernetes 出现之前，Docker 就已经火遍全球的原因——它解决了团队协作中最让人头疼的环境问题。

## 面试的核心逻辑

Docker 面试的核心，不在于你会不会用 `docker run`，而在于你能不能讲清楚：

1. **镜像层面**：镜像分层的原理是什么？Copy-on-Write 带来了什么优势？多阶段构建解决了什么问题？
2. **网络层面**：容器之间是怎么通信的？veth-pair 和 docker0 的作用是什么？自定义网络和默认 bridge 有什么区别？
3. **存储层面**：Volume 和 Bind Mount 的区别是什么？什么场景用 tmpfs？
4. **安全层面**：Docker 的隔离机制是怎么实现的？用户命名空间、capability、seccomp 各自解决了什么问题？
5. **编排层面**：Docker Swarm 和 Kubernetes 的定位有什么不同？

> "会 `docker build` 的人很多，能讲清楚镜像分层原理的人很少。面试比的不是命令熟练度，而是对原理的理解深度。"
