# Linux网络协议栈：数据包的一生

你知道当你执行`curl example.com`时，数据包经历了怎样的旅程吗？
从用户空间的curl，到网卡的DMA，再到对端服务器，然后原路返回。

这条复杂的路径，就是Linux网络协议栈。


## 网络协议栈架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Linux网络协议栈                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  用户空间                                                   │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  curl, nginx, Redis, 应用进程...                       │ │
│  └──────────────────────────────────────────────────────┘ │
│                           ↓ socket API                      │
│  ┌──────────────────────────────────────────────────────┐ │
│  │                      BSD Socket层                     │ │
│  │              (socket, bind, listen, accept...)         │ │
│  └──────────────────────────────────────────────────────┘ │
│                           ↓                                │
│  ┌──────────────────────────────────────────────────────┐ │
│  │                     传输层（TCP/UDP）                   │ │
│  │            TCP: 可靠传输、流量控制、拥塞控制            │ │
│  │            UDP: 无连接、快速传输                       │ │
│  └──────────────────────────────────────────────────────┘ │
│                           ↓                                │
│  ┌──────────────────────────────────────────────────────┐ │
│  │                      网络层（IP）                      │ │
│  │           路由、IP分片与重组、ICMP                    │ │
│  └──────────────────────────────────────────────────────┘ │
│                           ↓                                │
│  ┌──────────────────────────────────────────────────────┐ │
│  │                    链路层（Ethernet）                  │ │
│  │              ARP、MAC地址、帧封装                     │ │
│  └──────────────────────────────────────────────────────┘ │
│                           ↓                                │
│  ┌──────────────────────────────────────────────────────┐ │
│  │                      设备驱动层                       │ │
│  │                  网卡驱动、DMA                         │ │
│  └──────────────────────────────────────────────────────┘ │
│                           ↓                                │
│                         网卡                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```


## socket编程

### 创建socket

```c
#include <sys/socket.h>
#include <netinet/in.h>

int main() {
    // 创建TCP socket
    int sock = socket(AF_INET, SOCK_STREAM, 0);

    // 创建UDP socket
    int udp_sock = socket(AF_INET, SOCK_DGRAM, 0);

    // socket类型：
    // - SOCK_STREAM: TCP，流式socket
    // - SOCK_DGRAM: UDP，数据报socket
    // - SOCK_RAW: 原始socket，可直接操作IP层

    return 0;
}
```

### TCP服务器

```c
int main() {
    int server_fd, client_fd;
    struct sockaddr_in address;
    int opt = 1;
    int addrlen = sizeof(address);

    // 1. 创建socket
    server_fd = socket(AF_INET, SOCK_STREAM, 0);

    // 2. 设置socket选项（重用地址）
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    // 3. 绑定地址
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(8080);
    bind(server_fd, (struct sockaddr*)&address, sizeof(address));

    // 4. 监听
    listen(server_fd, 128);

    // 5. 接受连接
    client_fd = accept(server_fd, (struct sockaddr*)&address, &addrlen);

    // 6. 处理请求
    char buffer[1024];
    read(client_fd, buffer, 1024);
    // ...
    write(client_fd, "HTTP/1.1 200 OK\r\n", 17);

    close(client_fd);
    close(server_fd);

    return 0;
}
```


## 数据包发送流程

```
┌─────────────────────────────────────────────────────────────┐
│                    数据包发送流程（TCP）                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  应用层:  send(socket, data, len, 0)                       │
│            ↓                                                │
│  Socket层: 创建sk_buff，复制数据                              │
│            ↓                                                │
│  TCP层:    计算校验和、分段、添加TCP头                        │
│            ↓                                                │
│  IP层:     路由查找、TTL、添加IP头                           │
│            ↓                                                │
│  Netfilter: 遍历iptables规则（POSTROUTING）                  │
│            ↓                                                │
│  邻居系统: ARP查找MAC地址                                     │
│            ↓                                                │
│  网卡驱动: 添加Ethernet头，交给网卡                          │
│            ↓                                                │
│  网卡:     DMA发送，硬件计算以太网校验和                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### sk_buff结构

```c
// socket buffer: Linux网络栈的核心数据结构
struct sk_buff {
    struct sk_buff *next;        // 下一个skb（用于skb链表）
    struct sk_buff *prev;        // 前一个skb

    struct sock *sk;             // 所属socket
    struct net_device *dev;      // 网络设备

    // 数据区域
    unsigned char *head;          // 缓冲区头部
    unsigned char *data;         // 数据起始
    unsigned char *tail;         // 数据结束
    unsigned char *end;          // 缓冲区尾部

    // 协议头指针（用于快速访问）
    struct ethhdr *mac_header;   // MAC头
    struct iphdr *ip_header;     // IP头
    struct tcphdr *tcp_header;   // TCP头
    // ...
};
```


## 数据包接收流程

```
┌─────────────────────────────────────────────────────────────┐
│                    数据包接收流程                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  网卡:      DMA接收，硬件中断通知CPU                         │
│            ↓                                                │
│  网卡驱动:  分配sk_buff，复制数据                           │
│            ↓                                                │
│  NAPI:      轮询模式，提高高负载性能                         │
│            ↓                                                │
│  协议栈入口: netif_rx() / netif_receive_skb()              │
│            ↓                                                │
│  Netfilter: 遍历iptables规则（PREROUTING/INPUT）            │
│            ↓                                                │
│  IP层:      验证IP头、分片重组                              │
│            ↓                                                │
│  TCP/UDP:  端口查找、校验和验证                             │
│            ↓                                                │
│  Socket层: 放入socket接收缓冲区                            │
│            ↓                                                │
│  应用层:    recv() / read() 获取数据                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```


## TCP协议实现

### TCP状态机

```bash
# 查看TCP连接状态
ss -tan
# ESTAB: 已建立连接
# LISTEN: 监听中
# TIME-WAIT: 等待超时
# SYN-SENT: 同步已发送
# SYN-RECV: 同步已接收

# 查看详细的TCP连接信息
cat /proc/net/tcp
```

### TCP滑动窗口

```
发送方滑动窗口：

┌──────────────────────────────────────────────────────────┐
│                                                          │
│  已发送并确认  │ 已发送未确认  │ 可发送  │ 不能发送      │
│                │              │        │              │
│    [已确认]────│────[窗口]────│─[可用]─│──[不可用]──│  │
│      ↓        │      ↓       │   ↓    │      ↓      │
│   ACK到达     │ 发送中...     │  发送  │              │
│                                                          │
└──────────────────────────────────────────────────────────┘
              ↑                ↑      ↑       ↑
          snd_una        snd_nxt   snd_wnd  snd_max

接收方滑动窗口：

┌──────────────────────────────────────────────────────────┐
│                                                          │
│   已确认   │   已接收   │   可接收   │   不能接收         │
│            │  待读取    │           │                   │
│            │            │           │                   │
│  [rcv_wnd]─┼─────[可读]─┼───────────┼─────[不可用]────│  │
│            │            │           │                   │
│            │   数据到达  │           │                   │
│            │   等待应用  │           │                   │
│            │   读取      │           │                   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```


## Netfilter与iptables

```bash
# 查看iptables规则
iptables -L -n -v

# iptables链：
# INPUT: 入站数据包
# OUTPUT: 出站数据包
# FORWARD: 转发数据包
# PREROUTING: 路由前
# POSTROUTING: 路由后

# 示例：阻止来自某IP的连接
iptables -A INPUT -s 192.168.1.100 -j DROP

# 示例：端口转发
iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8080
```

### Netfilter钩子点

```
┌─────────────────────────────────────────────────────────────┐
│                    Netfilter钩子点                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────┐     ┌─────┐     ┌─────┐     ┌─────┐     ┌─────┐  │
│  │PRER │────►│INPUT│────►│FORWARD│────►│OUTPUT│────►│POST │  │
│  │OUTING│   │    │    │       │    │    │   │ROUTING│  │
│  └──┬──┘     └──┬──┘     └──┬──┘     └──┬──┘   │      │  │
│     │           │           │           │        │      │  │
│     │      ┌────┴───┐       │           │───┐    │      │  │
│     │      │应用进程│       │           │   │    │      │  │
│     │      └────────┘       │           │   │    │      │  │
│     │                       │           │   │    │      │  │
│  NAT │                    │     │        │   │    │   NAT │  │
│  路由 │                 │      │        │   │路由 │      │  │
│      │                 │      │        │   │    │      │  │
│  修改 │                 │      │        │   │    │ 修改  │  │
│  DST │                 │      │        │   │    │  SRC  │  │
│      │                 │      │        │   │    │      │  │
└─────────────────────────────────────────────────────────────┘
```


## 性能优化

### 网络参数调优

```bash
# 查看网络参数
sysctl -a | grep net

# 常用优化参数：
# net.core.rmem_max: 接收缓冲区最大
# net.core.wmem_max: 发送缓冲区最大
# net.ipv4.tcp_rmem: TCP接收缓冲区（最小/默认/最大）
# net.ipv4.tcp_wmem: TCP发送缓冲区（最小/默认/最大）
# net.ipv4.tcp_tw_reuse: 复用TIME_WAIT连接

# 示例：设置TCP缓冲区
sysctl -w net.ipv4.tcp_rmem="4096 87380 6291456"
sysctl -w net.ipv4.tcp_wmem="4096 65536 6291456"
```

### 查看网络统计

```bash
# 查看网络设备统计
ip -s link

# 查看TCP统计
ss -s

# 查看网络连接
netstat -anp           # 所有连接
netstat -tulnp        # 监听端口
ss -tulnp             # 更现代的替代

# 查看路由表
ip route
route -n
```


## 面试追问方向

- **Linux网络协议栈从收到数据包到交给应用，经历了哪些层？**
  提示：网卡驱动 → IP层 → TCP/UDP层 → Socket层。
- **TCP三次握手在协议栈中是怎么实现的？**
  提示：状态转换、sk_buff处理、握手序列号。
- **什么是NAPI？为什么需要NAPI？**
  提示：中断+轮询，提高高负载性能。
- **sk_buff在网络协议栈中起什么作用？**
  提示：数据包容器、避免数据复制、支持线性化和非线性数据。
