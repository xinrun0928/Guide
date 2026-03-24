# 容器通信原理：veth-pair、docker0 网桥、iptables

你有没有想过这个问题：**容器 A 和容器 B 在同一台宿主机上，它们之间是怎么「喊话」的？**

表面上看，是 `docker exec container_a ping container_b` 这么简单。但背后，是 Linux 内核网络栈里 veth-pair、网桥、iptables 的一场「接力赛」。

理解这套机制，是排查 Docker 网络问题的前提。

## 容器网络命名空间

在深入原理之前，先理解一个概念：**网络命名空间（Network Namespace）**。

Linux 的网络命名空间是内核级别的隔离机制。每个容器都有自己独立的网络命名空间：

```bash
# 查看宿主机的网络命名空间
ip netns list

# 查看某个容器的网络命名空间
docker exec container_a ls -la /var/run/netns

# 进入容器的网络命名空间（需要 nsenter）
nsenter --net=/var/run/docker/netns/xxx ip addr
```

网络命名空间包含：
- 网络接口（eth0、lo）
- 路由表（Routing Table）
- iptables 规则
- ARP 表
- 端口绑定信息

每个容器都有自己独立的「网络视角」，这是容器网络隔离的基础。

## veth-pair：容器与宿主机之间的「网线」

veth-pair（Virtual Ethernet Pair）是一对虚拟网络接口，数据从一端进入，从另一端原样出来。它们就像一根「网线」，连接容器和网络命名空间。

```bash
# 查看宿主机的 veth 接口
ip link show | grep veth

# 输出类似：
# 5: veth1234abc@if3: ... state UP ...
# 6: veth5678def@if5: ... state UP ...

# @if3 表示另一端在 eth3 所在的命名空间
```

### 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                        宿主机                                │
│                                                             │
│  eth0 ──────→ NAT ──────→ docker0 ──→ veth-xxx ──→ eth0   │
│  (物理网卡)                (网桥)          (成对)     (容器内)  │
└─────────────────────────────────────────────────────────────┘
```

当容器创建时，Docker 会创建一对 veth 接口：
- 一端留在宿主机，挂在 docker0 网桥上
- 另一端放进容器的网络命名空间，通常命名为 eth0

```bash
# 在宿主机上查看
ip link show
# veth1234abc: ... master docker0 ...   ← 挂在 docker0 上

# 在容器内查看
docker exec container_a ip link
# eth0@if5: ...                        ← @if5 对应宿主机的 veth1234abc
```

## docker0 网桥

docker0 是 Docker 自动创建的虚拟网桥，类似于物理网络中的交换机。

### 网桥的工作方式

网桥维护一张 MAC 地址表（CAM 表），记录哪个 MAC 地址在哪个端口上：

```bash
# 查看 docker0 网桥信息
ip link show docker0

# 查看网桥的 MAC 表
bridge fdb show dev docker0
```

### 数据包转发流程

```
容器 A 访问容器 B（假设在同一台宿主机上）：

1. 容器 A 发送数据包到 eth0
   - 源 MAC: container_A_MAC
   - 目标 MAC: ? (容器 B 的 MAC 未知)

2. 容器 A 先发送 ARP 请求
   - 「谁有容器 B 的 IP？」（广播）

3. ARP 请求通过 veth-pair 到达 docker0

4. docker0 广播给所有端口（排除入口）

5. 容器 B 收到 ARP 请求，回复
   - 「我就是容器 B，MAC 是 container_B_MAC」

6. 容器 A 收到 ARP 响应，更新 ARP 表

7. 容器 A 发送数据包
   - 源 MAC: container_A_MAC
   - 目标 MAC: container_B_MAC

8. docker0 查 MAC 表，找到容器 B 所在的端口
   - 通过 veth-pair 转发到容器 B
```

### 跨网桥通信

如果容器在不同网桥上：

```
容器 A (172.17.0.2/16) 访问容器 B (172.18.0.2/16)：

1. 容器 A 发现目标 IP 和自己在同一网段（172.18.0.2）
   - 直接 ARP 广播

2. ARP 请求到达 docker0，但 docker0 上没有 172.18.0.0/16 的网段
   - 查路由表

3. docker0 没有路由，交给 eth0 处理

4. eth0 有 NAT 规则
   - SNAT（源地址转换）: 172.17.0.2 → 宿主机 IP
   - DNAT（目标地址转换）: 宿主机 IP → 172.18.0.2

5. 如果是同一台宿主机不同网桥，需要宿主机开启 IP 转发
```

## iptables：NAT 和网络过滤

Docker 大量使用 iptables 来管理容器网络，包括 NAT、端口映射、网络隔离等。

### 查看 Docker 的 iptables 规则

```bash
# 查看 Docker 添加的 iptables 规则
sudo iptables -t nat -L -n
sudo iptables -t filter -L -n

# 查看 Docker 的 NAT 规则
sudo iptables -t nat -L DOCKER -n
```

### 端口映射原理

```bash
# 启动容器时指定端口映射
docker run -d -p 8080:80 nginx:alpine

# Docker 添加的 iptables 规则（简化）
# PREROUTING: 外部流量进入前
iptables -t nat -A PREROUTING \
    -m addrtype --dst-type LOCAL \
    -p tcp --dport 8080 \
    -j DNAT --to-destination 172.17.0.2:80

# OUTPUT: 本机进程访问本机端口时
iptables -t nat -A OUTPUT \
    -m addrtype --dst-type LOCAL \
    -p tcp --dport 8080 \
    -j DNAT --to-destination 172.17.0.2:80

# FORWARD: 允许转发到容器
iptables -t filter -A FORWARD \
    -i docker0 -o eth0 -j ACCEPT
```

### 网络隔离原理

Docker 通过 iptables 实现容器之间的网络隔离：

```bash
# 默认情况下，同一自定义网络内的容器可以互相通信
# Docker 添加的规则
iptables -t filter -A FORWARD \
    -i custom_bridge -o custom_bridge -j ACCEPT

# 不同网络之间的通信被禁止（除非显式连接）
```

### 流量控制

```bash
# Docker 支持通过 iptables 做流量控制
# 例如：限制容器带宽
docker run -d \
    --network-alias myapp \
    --quota 100m \
    myapp:latest
```

## 容器访问外网的完整流程

```
容器 A 访问外网（假设访问 8.8.8.8）：

1. 容器 A 发送数据包
   - 源 IP: 172.17.0.2（容器 A）
   - 目标 IP: 8.8.8.8
   - 源 MAC: container_A_MAC
   - 目标 MAC: docker0 的 MAC

2. docker0 收到数据包
   - 查路由表，目标 IP 不在 172.17.0.0/16
   - 交给 eth0 处理

3. eth0 应用 NAT 规则（POSTROUTING）
   - SNAT: 172.17.0.2:随机端口 → 宿主机IP:随机端口
   - 数据包从 eth0 发出

4. 外网服务器收到请求
   - 看到的是宿主机 IP，不是容器 IP

5. 响应包回来
   - 宿主机 eth0 收到响应
   - 查 NAT 表，找到对应的容器
   - DNAT: 宿主机IP:端口 → 172.17.0.2:端口
   - 发送到 docker0

6. docker0 发送到容器 A
   - 数据包通过 veth-pair 到达容器 A
```

## 同一台宿主机 vs 不同宿主机

### 同宿主机容器通信

```
容器 A → 容器 B（同宿主机）：
1. 容器 A 发 ARP 请求
2. 通过 veth-pair 到 docker0
3. docker0 广播
4. 容器 B 回复 ARP
5. 数据包直接通过 docker0 转发
6. 延迟：~0.1ms
```

### 跨宿主机容器通信

```
宿主机 A 的容器 A → 宿主机 B 的容器 B：

1. 容器 A 发数据包
2. docker0 → eth0
3. NAT 转换
4. 通过物理网络到达宿主机 B
5. 宿主机 B 的 eth0 收到
6. NAT 反向转换
7. docker0 → veth-pair → 容器 B
8. 延迟：~1-5ms（取决于网络）
```

对于跨主机通信，需要 overlay 网络（如 Docker Swarm 的 overlay 驱动）或者 CNI 插件（如 Flannel、Calico）。

## 实战：排查容器网络问题

### 容器无法访问外网

```bash
# 1. 检查宿主机是否能访问外网
ping 8.8.8.8

# 2. 检查 NAT 是否生效
iptables -t nat -L POSTROUTING -n

# 3. 检查 IP 转发是否开启
cat /proc/sys/net/ipv4/ip_forward
# 应该输出 1

# 4. 检查 DNS 配置
docker exec container_a cat /etc/resolv.conf
```

### 容器之间无法通信

```bash
# 1. 检查是否在同一网络
docker network inspect bridge

# 2. 检查 IP 地址
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' container_a
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' container_b

# 3. 测试连通性
docker exec container_a ping -c 1 container_b_ip

# 4. 检查 iptables 规则
iptables -t filter -L FORWARD -n
```

### 端口映射失败

```bash
# 1. 检查宿主机端口是否被占用
sudo netstat -tlnp | grep 8080

# 2. 检查 iptables 规则
sudo iptables -t nat -L DOCKER -n

# 3. 检查容器内服务是否正常
docker exec container_a curl localhost:80

# 4. 检查 Docker 服务日志
sudo journalctl -u docker -f
```

## 面试追问

1. **veth-pair 是什么？为什么容器需要它？**
2. **docker0 网桥和物理交换机有什么相似和不同？**
3. **容器访问外网时，NAT 转换是在哪里发生的？**
4. **为什么自定义 bridge 网络支持容器名解析，而默认 bridge 不支持？**
5. **如何排查「容器能 ping 通 IP 但 ping 不通域名」的问题？**

> "理解 Docker 网络原理，不是为了背诵面试题，而是为了在遇到网络问题时不再束手无策。容器网络的问题，80% 都出在 iptables 规则上。"
