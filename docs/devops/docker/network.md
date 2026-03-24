# Docker 网络模式：bridge、host、container、none、自定义网络

容器之间是怎么通信的？容器怎么访问外网？外网怎么访问容器？容器间怎么实现网络隔离？

这些问题的答案，都藏在 Docker 的网络模式里。

## Docker 网络模式概览

Docker 提供了 5 种网络模式：

```bash
# 查看 Docker 网络
docker network ls

NETWORK ID     NAME        DRIVER    SCOPE
87a...         bridge      bridge    local
6f5...         host        host      local
1b9...         none        null      local
```

| 模式 | 说明 | 典型场景 |
|------|------|---------|
| `bridge` | 默认模式，容器连接到 bridge 网桥 | 绝大多数场景 |
| `host` | 容器使用宿主机网络 | 性能敏感场景 |
| `container` | 容器与另一个容器共享网络栈 | 容器间通信 |
| `none` | 容器无网络 | 完全隔离 |
| `自定义网络` | 用户创建的 bridge 或 overlay | 容器隔离、跨主机通信 |

## bridge（默认模式）

Bridge 是 Docker 默认的网络模式。容器连接到 Docker 虚拟的 `docker0` 网桥。

### 工作原理

```
                    宿主机
┌─────────────────────────────────────────────────────┐
│  eth0 (物理网络)                                      │
│       ↑                                              │
│  NAT/路由                                            │
│       ↑                                              │
│  docker0 (172.17.0.1) ─── veth-pair ─── 容器 A (172.17.0.2)
│       │                                        │
│       └── veth-pair ─── 容器 B (172.17.0.3)         │
└─────────────────────────────────────────────────────┘

容器 A ↔ 容器 B：通过 docker0 通信
容器 → 外网：通过 NAT 转换
外网 → 容器：需要端口映射
```

### 默认 bridge 的限制

默认 bridge 有一个问题：**容器之间只能通过 IP 地址通信，不能通过容器名通信**。

```bash
# 创建两个容器
docker run -d --name web nginx:alpine
docker run -d --name db redis:alpine

# 尝试通过容器名访问
docker exec web ping db
# ping: bad address 'db'     ← 默认 bridge 不支持 DNS

# 只能通过 IP 访问
docker exec web ping 172.17.0.3   # 需要知道 IP
```

### 端口映射

默认 bridge 模式下，容器默认不能从宿主机外部直接访问，需要通过 `-p` 参数映射端口：

```bash
# 将宿主机的 8080 端口映射到容器的 80 端口
docker run -d -p 8080:80 --name web nginx:alpine

# 宿主机访问
curl http://localhost:8080

# 端口映射的几种形式
-p 8080:80              # 宿主机端口:容器端口
-p 127.0.0.1:8080:80    # 限定只能从本机访问
-p 8080:80/udp         # 映射 UDP 端口
-p 8080-8085:80         # 端口范围映射
```

## host（主机模式）

Host 模式下，容器直接使用宿主机的网络栈，不进行网络隔离。

```bash
# 启动一个使用 host 网络的 Nginx
docker run -d --network host --name web nginx:alpine

# Nginx 直接监听宿主机的 80 端口
# 不需要 -p 参数
curl http://localhost:80
```

### host 模式的特点

| 特点 | 说明 |
|------|------|
| **性能更好** | 无 NAT 转换，无 iptables 规则 |
| **端口冲突** | 同一台宿主机只能运行一个监听 80 端口的容器 |
| **无网络隔离** | 容器的网络和宿主机完全一致 |

### 适用场景

```bash
# 场景1：高性能网络服务（如负载均衡器）
docker run -d --network host my-loadbalancer

# 场景2：需要绑定宿主机特定端口的工具
docker run -d --network host my-network-tool

# 场景3：Kubernetes Node 进程（kubelet、kube-proxy）
```

## container（容器模式）

Container 模式让容器共享另一个容器的网络栈。

```bash
# 启动一个基础容器
docker run -d --name web nginx:alpine

# 启动另一个容器，共享 web 的网络
docker run -d --network container:web --name web-debug alpine

# web-debug 和 web 共享网络栈
# web-debug 可以直接访问 web 的端口
docker exec web-debug curl localhost:80
```

### 典型用途：Sidecar 模式

```bash
# 场景：应用容器 + 日志收集容器
docker run -d --name app myapp:latest
docker run -d \
  --network container:app \
  --name log-collector \
  my-log-collector

# log-collector 和 app 共享网络，log-collector 可以拦截 app 的日志
```

## none（无网络模式）

None 模式下，容器有自己的网络命名空间，但没有网络接口（除了 loopback）。

```bash
# 创建无网络容器
docker run -d --network none --name isolated alpine

# 进入容器查看网络
docker exec isolated ip addr

# 输出：
# 1: lo: <LOOPBACK> ...  ← 只有 loopback，没有 eth0
```

### 适用场景

- 纯计算任务，不需要网络
- 批处理作业
- 完全隔离的测试环境

## 自定义网络

Docker 允许创建自定义网络，提供更强大的功能：

### 创建自定义 bridge 网络

```bash
# 创建自定义 bridge 网络
docker network create --driver bridge my-network

# 创建时指定子网
docker network create \
  --driver bridge \
  --subnet=172.20.0.0/16 \
  --ip-range=172.20.5.0/24 \
  my-network

# 查看网络详情
docker network inspect my-network
```

### 自定义网络的 DNS 功能

自定义 bridge 网络支持容器间通过名称相互访问：

```bash
# 创建网络
docker network create my-network

# 启动容器
docker run -d --network my-network --name web nginx:alpine
docker run -d --network my-network --name db redis:alpine

# 容器间通过名称通信
docker exec web ping db -c 1
# PING db (172.20.5.2): 56 data bytes
# 64 bytes from db: seq=0 ttl=64 time=0.100 ms

# 自动获得 DNS 解析
docker exec web nc -zv db 6379
# Connection to db 6379 port [tcp/*] succeeded!
```

### 网络隔离

```bash
# 创建两个隔离的网络
docker network create frontend
docker network create backend

# 启动服务
docker run -d --network frontend --name gateway nginx:alpine
docker run -d --network backend --name database mysql:8

# gateway 无法直接访问 database
docker exec gateway ping database
# ping: bad address 'database'

# 但 database 可以同时加入 frontend 网络
docker network connect backend gateway
docker exec gateway ping database
# PING database (172.18.0.2): 56 data bytes
```

### 网络驱动类型

```bash
# bridge：单主机 bridge 网络（默认）
docker network create --driver bridge my-bridge

# overlay：跨主机网络（Swarm 模式）
docker network create --driver overlay my-overlay

# macvlan：给容器分配 MAC 地址（直接连接物理网络）
docker network create \
  --driver macvlan \
  --subnet=192.168.1.0/24 \
  --gateway=192.168.1.1 \
  -o parent=eth0 \
  my-macvlan
```

## 容器间通信原理

理解 Docker 网络的关键是理解 `veth-pair` 和 `docker0`：

### veth-pair

veth-pair（Virtual Ethernet Pair）是一对虚拟网络设备，数据从一端进入，从另一端出来。它们像一根「网线」连接容器和网桥。

```bash
# 在宿主机上查看
ip link show | grep veth

# 输出类似：
# veth1234abc: ... master docker0 ...
# veth5678def: ... master docker0 ...

# 在容器内查看
docker exec web ip link

# 输出：
# eth0@if5: ...  ← 对应宿主机的 veth1234abc
```

### 通信流程

```
容器 A（172.17.0.2）访问容器 B（172.17.0.3）：

1. 容器 A 发送数据包到 eth0
2. 数据包通过 veth-pair 到达 docker0
3. docker0 查找 ARP 表，找到容器 B 的 veth 接口
4. 数据包通过 veth-pair 到达容器 B

容器 A 访问外网（8.8.8.8）：

1. 容器 A 发送数据包到 eth0
2. 数据包通过 veth-pair 到达 docker0
3. docker0 将数据包发送给宿主机 eth0
4. NAT 转换后发送到外网
5. 响应包原路返回
```

## 实战：MySQL + 应用容器通信

```bash
# 1. 创建专用网络
docker network create app-network

# 2. 启动 MySQL
docker run -d \
  --network app-network \
  --name mysql \
  -e MYSQL_ROOT_PASSWORD=secret \
  -e MYSQL_DATABASE=myapp \
  mysql:8.0

# 3. 启动应用（连接 MySQL）
docker run -d \
  --network app-network \
  --name myapp \
  -e DB_HOST=mysql \
  -e DB_PASSWORD=secret \
  myapp:latest

# 4. 验证连接
docker exec myapp nc -zv mysql 3306
# Connection to mysql 3306 port [tcp/mysql] succeeded!
```

### docker-compose 方式

```yaml
version: '3.8'
services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: secret
      MYSQL_DATABASE: myapp
    networks:
      - app-network
    volumes:
      - mysql-data:/var/lib/mysql

  myapp:
    image: myapp:latest
    environment:
      DB_HOST: mysql
      DB_PASSWORD: secret
    depends_on:
      - mysql
    networks:
      - app-network
    ports:
      - "8080:8080"

networks:
  app-network:
    driver: bridge

volumes:
  mysql-data:
```

## 面试追问

1. **Docker 的 bridge 网络和宿主机网络是怎么通信的？NAT 转换在哪里发生？**
2. **默认 bridge 和自定义 bridge 的区别是什么？**
3. **veth-pair 是什么？它在整个网络架构中扮演什么角色？**
4. **容器暴露端口有哪几种方式？各自的优缺点是什么？**
5. **Docker 网络的性能损耗主要来自哪里？什么场景下需要用 host 网络？**

> "Docker 网络看似简单，底层却是 Linux 网络命名空间、veth-pair、网桥、iptables 等技术的组合。理解这些原理，才能在遇到网络问题时快速定位。"
