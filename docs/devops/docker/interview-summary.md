# Docker 面试高频问题汇总

Docker 是现代 DevOps 的基础，也是面试中的常客。但面试官问 Docker，往往不只是问「怎么用」，更是问「为什么」和「怎么实现」。

这篇文章，汇总 Docker 面试的高频问题，按模块分类，帮你系统性地复习。

## 核心概念

### Q1: 镜像和容器的区别是什么？

**标准答案**：

镜像是一个静态的只读模板，包含了运行应用程序所需的一切（代码、依赖、系统库、配置）。

容器是镜像的运行实例。如果把镜像比作「图纸」，容器就是「按照图纸建造出来的房子」。

**追问**：

- 同一个镜像可以创建多个容器吗？可以的，每个容器有独立的可写层。
- 删除容器会删除镜像吗？不会，容器是实例，镜像是模板。

### Q2: 容器和虚拟机的本质区别是什么？

**标准答案**：

虚拟机通过 Hypervisor 虚拟化硬件，每个虚拟机运行完整的操作系统（Guest OS）。

容器直接运行在 Docker Engine 上，共享宿主机的内核。容器通过 Linux 命名空间（Namespace）和控制组（Cgroup）实现隔离。

**核心对比**：

| 对比维度 | 虚拟机 | Docker 容器 |
|---------|--------|------------|
| 启动时间 | 分钟级 | 秒级 |
| 资源占用 | GB 级 | MB 级 |
| 隔离性 | 硬件级隔离 | 内核级隔离 |
| 密度 | 低（10-20/宿主机） | 高（100+/宿主机） |

### Q3: Docker 为什么启动这么快？

**标准答案**：

省掉了 OS 引导。虚拟机启动需要经历完整的开机流程：BIOS → Boot Loader → 内核加载 → 系统服务启动。容器只是启动一个进程，内核已经在那儿了。

## 镜像与构建

### Q4: 镜像分层的原理是什么？

**标准答案**：

Docker 镜像由多个只读层组成，每条 Dockerfile 指令（除了 FROM）都会创建新的一层。

**追问**：

- 层共享节省了什么？存储空间和拉取时间。
- 删除容器后，镜像层会删除吗？不会。

### Q5: 什么是 Copy-on-Write？

**标准答案**：

当容器修改文件时，Docker 将文件从只读层复制到可写层，然后修改。读取时从上往下查找（可写层 → 只读层）。

**作用**：
1. 保持镜像不变（不可变基础设施）
2. 延迟复制，最小化 I/O 开销

### Q6: 多阶段构建解决了什么问题？

**标准答案**：

分离构建环境和运行环境，减少最终镜像体积。

```dockerfile
# 构建阶段
FROM maven:3.9-eclipse-temurin-17 AS builder
RUN mvn package

# 运行阶段
FROM eclipse-temurin:17-jre-alpine
COPY --from=builder /app/target/*.jar app.jar
```

结果：镜像从 ~800MB 降到 ~120MB。

### Q7: CMD 和 ENTRYPOINT 的区别是什么？

**标准答案**：

`CMD` 提供默认命令，可被 `docker run` 参数覆盖。

`ENTRYPOINT` 让容器表现得像一个可执行程序，`CMD` 作为默认参数。

```dockerfile
# CMD 例子
CMD ["java", "-jar", "app.jar"]
docker run myapp                           # 使用 CMD
docker run myapp --spring.profiles=prod    # 覆盖 CMD

# ENTRYPOINT 例子
ENTRYPOINT ["java", "-jar", "app.jar"]
CMD ["--spring.profiles=dev"]
docker run myapp                           # java -jar app.jar --spring.profiles=dev
docker run myapp --spring.profiles=prod    # java -jar app.jar --spring.profiles=prod
```

## 网络

### Q8: Docker 的网络模式有哪些？

**标准答案**：

| 模式 | 说明 |
|------|------|
| bridge | 默认模式，连接到 docker0 网桥 |
| host | 使用宿主机网络 |
| container | 共享另一个容器的网络栈 |
| none | 无网络 |
| overlay | 跨主机网络（Swarm） |

### Q9: 容器之间是怎么通信的？

**标准答案**：

同宿主机：通过 veth-pair 连接 docker0 网桥，利用 ARP 协议发现对方。

跨宿主机：通过 overlay 网络（Swarm）或 CNI 插件。

### Q10: veth-pair 是什么？

**标准答案**：

veth-pair（Virtual Ethernet Pair）是一对虚拟网络接口，像一根「网线」连接容器和宿主机网桥。

```
容器 eth0 ←→ veth-pair ←→ docker0
```

### Q11: 端口映射的原理是什么？

**标准答案**：

通过 iptables 的 NAT 表实现。`docker run -p 8080:80` 会添加 DNAT 规则，将宿主机 8080 端口的流量转发到容器 80 端口。

## 存储

### Q12: Docker 有哪些数据持久化方式？

**标准答案**：

| 方式 | 说明 |
|------|------|
| Volume | Docker 管理的卷，最推荐 |
| Bind Mount | 挂载宿主机目录 |
| tmpfs | 内存文件系统 |

### Q13: Volume 和 Bind Mount 的区别是什么？

**标准答案**：

- **Volume**：Docker 管理，存储在 `/var/lib/docker/volumes`，跨容器共享容易
- **Bind Mount**：挂载宿主机任意目录，直接访问宿主机文件系统

### Q14: 容器删除了，Volume 会删除吗？

**标准答案**：

不会。匿名卷会保留，命名卷需要手动 `docker volume rm` 删除。

## 资源限制

### Q15: Docker 是如何实现资源限制的？

**标准答案**：

通过 Linux 内核的 cgroups（Control Groups）实现。

- CPU 限制：`--cpus`, `--cpuset-cpus`, `--cpu-shares`
- 内存限制：`--memory`, `--memory-swap`
- IO 限制：`--device-read-bps`, `--device-write-iops`

### Q16: 容器被 OOM 杀死是怎么回事？

**标准答案**：

容器内存使用超过 `--memory` 限制，内核 OOM Killer 杀死容器进程。

解决：合理设置内存限制、使用 `--memory-reservation` 提供软限制、设置 `--oom-kill-disable=false`。

## 安全

### Q17: 容器以 root 运行安全吗？

**标准答案**：

默认情况下容器以 root 运行，存在安全风险。推荐：

1. 创建非 root 用户运行：`USER appuser`
2. 限制 Capabilities：`--cap-drop=ALL`
3. 使用只读文件系统：`--read-only`
4. 启用 AppArmor/SELinux

### Q18: 什么是 Capabilities？

**标准答案**：

Linux Capabilities 将 root 的特权分解为多个独立单元。Docker 默认授予容器部分 Capabilities，如 `CAP_NET_BIND_SERVICE`。

生产环境应使用 `--cap-drop=ALL`，只添加必要的 Capability。

### Q19: 什么是 seccomp？

**标准答案**：

seccomp（Secure Computing Mode）限制容器可以使用的系统调用。Docker 默认阻止约 44 个危险系统调用。

## 存储驱动

### Q20: overlay2 和 devicemapper 的区别是什么？

**标准答案**：

- **overlay2**：通过目录叠加实现，性能好，兼容广
- **devicemapper**：通过 LVM 快照实现，适合块存储场景

**追问**：为什么推荐 overlay2？
- 性能更好
- 配置更简单
- 社区支持更好

## 编排

### Q21: Docker Swarm 和 Kubernetes 的区别是什么？

**标准答案**：

| 维度 | Docker Swarm | Kubernetes |
|------|-------------|-------------|
| 复杂度 | 简单 | 复杂 |
| 功能 | 基础 | 丰富 |
| 生态 | 一般 | 庞大 |
| 学习曲线 | 低 | 高 |
| 适用场景 | 中小规模 | 大规模生产环境 |

**追问**：Docker Swarm 有什么优势？
- 安装即用，无需额外配置
- 与 Docker CLI 集成
- 小规模场景足够用

## 实战问题

### Q22: 如何减小 Docker 镜像体积？

**标准答案**：

1. 使用多阶段构建
2. 使用 Alpine 或 Distroless 镜像
3. 合并 RUN 指令减少层数
4. 清理缓存和不必要文件
5. 使用 .dockerignore
6. 利用构建缓存

### Q23: 容器日志怎么管理？

**标准答案**：

1. 配置日志轮转：`--log-opt max-size=10m --log-opt max-file=3`
2. 使用统一日志收集：Fluentd、ELK
3. 应用层输出结构化日志

### Q24: 如何排查容器网络问题？

**标准答案**：

1. 检查宿主机网络：`ping 8.8.8.8`
2. 检查 NAT：`iptables -t nat -L -n`
3. 检查 DNS：`docker exec container nslookup google.com`
4. 检查连通性：`docker exec container ping other-container`
5. 查看 iptables 规则

## 面试技巧

### 回答问题的层次

面试官想看到的，不只是「会用」，而是「懂原理」：

**表面层（大部分人能答上来）**：
- Docker 是什么
- 基本命令怎么用

**原理层（优秀候选人能答上来）**：
- 镜像分层的原理
- 网络通信的机制
- 资源限制的实现

**实战层（让面试官眼前一亮的答案）**：
- 讲清楚踩过的坑和解决方案
- 能对比不同方案的优劣
- 有生产环境的经验分享

### 常见陷阱

1. **背答案不思考**：面试官会追问细节，背答案会被识破
2. **只讲命令不讲原理**：命令谁都能查，原理才是你的护城河
3. **过于理论**：要有实战经验支撑

## 总结

Docker 面试的核心考点：

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker 面试知识图谱                       │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  核心概念   │  │   镜像构建   │  │   网络通信   │        │
│  │             │  │             │  │             │        │
│  │ - 镜像 vs 容器│  │ - Dockerfile │  │ - 网络模式  │        │
│  │ - Namespace │  │ - 分层原理   │  │ - veth-pair │        │
│  │ - Cgroups   │  │ - 多阶段构建 │  │ - NAT/iptables│      │
│  │ - vm vs 容器│  │ - 构建缓存   │  │ - 服务发现   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   存储卷    │  │   资源限制   │  │   安全加固   │        │
│  │             │  │             │  │             │        │
│  │ - Volume    │  │ - CPU 限制  │  │ - User NS   │        │
│  │ - Bind Mount│ │ - 内存限制  │  │ - Capability│        │
│  │ - tmpfs    │  │ - IO 限制   │  │ - seccomp   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐                        │
│  │   编排      │  │   实战问题   │                        │
│  │             │  │             │                        │
│  │ - Swarm vs  │  │ - 镜像优化  │                        │
│  │   Kubernetes │  │ - 日志管理  │                        │
│  │ - 滚动更新  │  │ - 故障排查  │                        │
│  │ - 服务发现  │  │             │                        │
│  └─────────────┘  └─────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

> "Docker 面试的核心，不是考你会不会用，而是考你懂不懂原理。理解底层机制，才能在遇到问题时快速定位。好的面试表现 = 原理理解 + 实战经验 + 思考总结。"
