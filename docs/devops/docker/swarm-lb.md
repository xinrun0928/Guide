# Docker Swarm 负载均衡与 DNS 服务发现

一个服务有 3 个副本，请求是怎么被分发的？容器之间是怎么通过名字相互访问的？

Docker Swarm 内置了服务发现和负载均衡机制，让多副本服务协同工作变得简单。

这篇文章，聊聊 Docker Swarm 的网络和服务发现。

## 服务发现原理

Docker Swarm 使用嵌入式 DNS 服务器为每个服务提供 DNS 解析。

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Swarm DNS                         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                    DNS Server                        │  │
│  │                                                       │  │
│  │  Service A (3 replicas)                               │  │
│  │  └─ DNS: service-a.swarm → [IP1, IP2, IP3]           │  │
│  │                                                       │  │
│  │  Service B                                            │  │
│  │  └─ DNS: service-b.swarm → [IP4]                     │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │  Task A1 │  │  Task A2 │  │  Task A3 │                   │
│  │ Container│  │ Container│  │ Container│                   │
│  └──────────┘  └──────────┘  └──────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

### DNS 工作机制

```bash
# 容器内执行 nslookup
docker exec <container-id> nslookup myapp

# 输出：
# Server:    127.0.0.11
# Address:   127.0.0.11#53
#
# Name:      myapp
# Address:   10.0.0.5
# Aliases:   myapp.default.svc.cluster.local
```

### DNS 解析流程

```
客户端容器请求 myapp：

1. 发送 DNS 查询到内置 DNS 服务器 (127.0.0.11)
      ↓
2. DNS 服务器查询 Swarm 内部状态
      ↓
3. 发现 myapp 有 3 个副本
      ↓
4. 返回 VIP（Virtual IP）或所有容器 IP
      ↓
5. 客户端收到 IP 地址
```

## VIP（Virtual IP）模式

默认情况下，Swarm 为每个服务分配一个 VIP，客户端通过 VIP 访问服务。

```
┌─────────────────────────────────────────────────────────────┐
│                    VIP 负载均衡                             │
│                                                             │
│  ┌─────────┐                                               │
│  │  Client │                                               │
│  └────┬────┘                                               │
│       │ VIP: 10.0.0.5                                       │
│       ↓                                                     │
│  ┌────────────┐                                             │
│  │ Load Balancer │ ← Swarm 内置                             │
│  └────┬───────┘                                             │
│       │                                                     │
│       ├──────────────┬──────────────┐                       │
│       ↓              ↓              ↓                       │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐                   │
│  │ Task A1 │   │ Task A2 │   │ Task A3 │                   │
│  │ 10.0.0.6│   │ 10.0.0.7│   │ 10.0.0.8│                   │
│  └─────────┘   └─────────┘   └─────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

### VIP 特点

- 客户端解析服务名得到 VIP
- 请求发送到 VIP
- Swarm 内置负载均衡器分发到容器
- 即使容器 IP 变化，VIP 保持不变

### 查看 VIP

```bash
# 查看服务 VIP
docker service inspect --pretty myapp | grep -A 5 "Virtual IPs"

# 输出：
# Virtual IPs:
#  10.0.0.5/24
```

## DNSRR（DNS Round Robin）模式

DNSRR 模式下，DNS 直接返回所有容器 IP：

```bash
# 创建使用 DNSRR 的服务
docker service create \
    --name myapp \
    --endpoint-mode dnsrr \
    --replicas 3 \
    nginx:alpine
```

### DNSRR 特点

```
┌─────────────────────────────────────────────────────────────┐
│                    DNSRR 模式                               │
│                                                             │
│  ┌─────────┐                                               │
│  │  Client │                                               │
│  └────┬────┘                                               │
│       │ DNS 查询                                            │
│       ↓                                                     │
│  ┌────────────┐                                             │
│  │ DNS Server │                                             │
│  └────┬───────┘                                             │
│       │                                                     │
│       ├──────────────┬──────────────┐                       │
│       ↓              ↓              ↓                       │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐                   │
│  │ IP: 10.0│   │ IP: 10.0│   │ IP: 10.0│                   │
│  │   .0.6  │   │   .0.7  │   │   .0.8  │                   │
│  └─────────┘   └─────────┘   └─────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

### VIP vs DNSRR

| 模式 | VIP | DNSRR |
|------|-----|-------|
| DNS 响应 | 返回单个 VIP | 返回所有容器 IP |
| 负载均衡位置 | Swarm 内置 LB | 客户端 |
| 适用场景 | 通用场景 | 高性能/特殊需求 |
| 粘性会话 | 支持 | 不支持 |

## 外部访问（Ingress）

### Published Port 原理

```bash
# 创建服务并发布端口
docker service create \
    --name myapp \
    --publish 8080:80 \
    --replicas 3 \
    nginx:alpine
```

```
┌─────────────────────────────────────────────────────────────┐
│                    Ingress 网络                             │
│                                                             │
│  外部请求 (8080)                                            │
│       ↓                                                     │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              IPVS / iptables 负载均衡                  │  │
│  │                                                       │  │
│  │  8080 → [容器1:80, 容器2:80, 容器3:80]               │  │
│  └─────────────────────────────────────────────────────┘  │
│       ↓                                                     │
│       ├──────────────┬──────────────┐                       │
│       ↓              ↓              ↓                       │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐                   │
│  │  Node 1 │   │  Node 2 │   │  Node 3 │                   │
│  │ Container│   │ Container│   │ Container│                   │
│  └─────────┘   └─────────┘   └─────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

### 负载均衡策略

```bash
# Swarm 使用 IPVS 进行负载均衡
# 查看 ipvs 规则
ipvsadm -L -n

# 输出：
# IP Virtual Server version 1.2.1
# TCP  192.168.1.100:8080 rr
#   -> 10.0.0.6:80                Masq    1      0          0
#   -> 10.0.0.7:80                Masq    1      0          0
#   -> 10.0.0.8:80                Masq    1      0          0
```

### 路由网格（Routing Mesh）

Swarm 的路由网格让任何节点都可以接收外部请求：

```bash
# 在 Node1 上创建服务
docker service create \
    --name myapp \
    --publish 8080:80 \
    --replicas 3 \
    nginx:alpine

# 副本分布在 Node1, Node2, Node3
# 任意节点都可以访问
curl http://node1:8080  # ✓
curl http://node2:8080  # ✓
curl http://node3:8080  # ✓
```

## 内部服务间通信

### 同一网络内通信

```bash
# 创建 Overlay 网络
docker network create -d overlay my-net

# 创建服务
docker service create \
    --name frontend \
    --network my-net \
    --publish 80:80 \
    nginx:alpine

docker service create \
    --name backend \
    --network my-net \
    nginx:alpine
```

### 服务间访问

```bash
# frontend 容器内
# 访问 backend 直接使用服务名
curl http://backend:80

# 访问 frontend 自身
curl http://frontend:80
```

### 完整的服务拓扑

```
┌─────────────────────────────────────────────────────────────┐
│                    完整服务拓扑示例                          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              外部负载均衡器 / DNS                     │  │
│  └─────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   Node 1   │  │   Node 2   │  │   Node 3   │       │
│  │ ┌─────────┐│  │ ┌─────────┐│  │ ┌─────────┐│       │
│  │ │Frontend ││  │ │Frontend ││  │ │Frontend ││       │
│  │ │ (副本1) ││  │ │ (副本2) ││  │ │ (副本3) ││       │
│  │ └────┬────┘│  │ └────┬────┘│  │ └────┬────┘│       │
│  │      │     │  │      │     │  │      │     │       │
│  │      └─────┴──┴──────┴─────┴──┴──────┘     │       │
│  │             ↓                                  │       │
│  │      ┌────────────┐                           │       │
│  │      │   API GW   │                           │       │
│  │      │  (Gateway) │                           │       │
│  │      └─────┬──────┘                           │       │
│  │            │                                   │       │
│  │      ┌─────┴──────┐                           │       │
│  │      ↓            ↓                           │       │
│  │ ┌────────┐  ┌────────┐                         │       │
│  │ │Backend1│  │Backend2│                         │       │
│  │ └────────┘  └────────┘                         │       │
│  │      │            │                           │       │
│  │      └─────┬──────┘                           │       │
│  │            ↓                                   │       │
│  │      ┌────────────┐                           │       │
│  │      │  Database  │                           │       │
│  │      │  (Redis)  │                           │       │
│  │      └────────────┘                           │       │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 负载均衡配置

### 会话保持

```bash
# Swarm 默认不支持会话保持
# 应用层实现会话保持
# 1. 使用 Cookie
# 2. 使用共享 Session 存储（Redis）
```

### 健康检查与负载均衡

```bash
# 创建带健康检查的服务
docker service create \
    --name myapp \
    --publish 8080:80 \
    --health-cmd "curl -f http://localhost/health || exit 1" \
    --health-interval 30s \
    --replicas 3 \
    myapp:latest

# 健康检查失败的容器会被移出负载均衡
```

### 亲和性调度

```bash
# 将服务调度到不同节点
docker service create \
    --name myapp \
    --placement-pref 'spread=node.labels.zone' \
    --replicas 3 \
    myapp:latest
```

## 调试网络问题

### 查看网络

```bash
# 查看 Overlay 网络
docker network ls

# 查看网络详情
docker network inspect my-net
```

### 查看 DNS 解析

```bash
# 在容器内测试 DNS
docker exec <container-id> nslookup myapp
docker exec <container-id> dig myapp
```

### 查看负载均衡

```bash
# 查看服务的任务
docker service ps myapp

# 查看 IPVS 规则
docker exec <node> ipvsadm -L -n
```

## 面试追问

1. **Docker Swarm 的服务发现是怎么工作的？**
2. **VIP 和 DNSRR 模式有什么区别？各自适合什么场景？**
3. **路由网格（Routing Mesh）是什么？为什么任意节点都能接收请求？**
4. **Swarm 的负载均衡和 Kubernetes 的 Service 负载均衡有什么区别？**
5. **如何调试 Swarm 网络问题？**

> "服务发现和负载均衡是分布式系统的基石。Docker Swarm 内置的 DNS 服务发现和 IPVS 负载均衡，让多副本服务协同工作变得简单。理解这些机制，是掌握服务编排的关键。"
