# TCP 状态转换图与 TIME_WAIT 问题

理解 TCP 的状态转换，是理解整个 TCP 协议生命周期的基础。

当你排查网络问题时，状态转换图能帮你快速定位问题所在。

## TCP 状态转换全景图

```
                          ┌─────────┐
                          │ CLOSED  │
                          └────┬────┘
                               │
            主动打开             │            被动打开
           ┌────────────────────┼────────────────────┐
           │                    │                    │
           ▼                    │                    ▼
    ┌────────────┐              │            ┌────────────┐
    │  SYN_SENT  │              │            │   LISTEN  │
    └──────┬─────┘              │            └──────┬─────┘
           │                    │                   │
           │ 收到 SYN+ACK        │          收到 SYN │
           │ 发送 ACK           │          发送 SYN+ACK
           ▼                    │                   │
    ┌────────────┐              │            ┌──────┴─────┐
    │ESTABLISHED │◄─────────────┼────────────►│ SYN_RCVD  │
    └──────┬─────┘              │            └──────┬─────┘
           │                    │                   │
           │ 主动关闭            │          被动关闭 │
           │ 发送 FIN           │          收到 FIN │
           ▼                    │          发送 ACK  │
    ┌────────────┐              │                   │
    │ FIN_WAIT_1 │              │            ┌─────┴─────┐
    └──────┬─────┘              │            │CLOSE_WAIT │
           │ 收到 ACK           │            └─────┬─────┘
           │ 不等对方 FIN        │                  │
           ▼                    │          发送 FIN │
    ┌────────────┐              │                  │
    │ FIN_WAIT_2 │              │                  ▼
    └──────┬─────┘              │           ┌─────────┐
           │ 收到对方 FIN       │           │LAST_ACK │
           │ 发送 ACK           │           └────┬────┘
           ▼                    │                │
    ┌────────────┐              │                │ 收到 ACK
    │ TIME_WAIT  │              │                ▼
    └──────┬─────┘              │           ┌─────────┐
           │                    │           │ CLOSED  │
           │ 2MSL 超时          │                │
           ▼                    │                │
    ┌────────────┐              │                │
    │  CLOSED    │              │                │
    └────────────┘              │                │
                                │                │
                      收到 FIN  │  发送 ACK      │
           ┌────────────────────┼────────────────┘
           │                    │
           ▼                    ▼
    ┌────────────┐       ┌────────────┐
    │  CLOSING   │       │  CLOSING   │
    └──────┬─────┘       └─────┬──────┘
           │ 收到 ACK          │ 收到 ACK
           ▼                   ▼
    ┌────────────┐       ┌────────────┐
    │ TIME_WAIT  │       │ TIME_WAIT  │
    └────────────┘       └────────────┘
```

## 各状态详解

### 客户端可能的状态

| 状态 | 含义 | 何时进入 |
|------|------|----------|
| CLOSED | 无连接 | 初始状态，或连接完全关闭后 |
| SYN_SENT | 已发送 SYN | 调用 connect() 后 |
| ESTABLISHED | 连接已建立 | 三次握手完成后 |
| FIN_WAIT_1 | 已发送 FIN | 调用 close() 后，等待 ACK |
| FIN_WAIT_2 | 收到 ACK | 收到 ACK，等待对方 FIN |
| TIME_WAIT | 等待 2MSL | 收到对方 FIN+ACK 后 |
| CLOSING | 同时关闭 | 发送 FIN 后收到 FIN |

### 服务端可能的状态

| 状态 | 含义 | 何时进入 |
|------|------|----------|
| CLOSED | 无连接 | 初始状态 |
| LISTEN | 监听中 | 调用 listen() 后 |
| SYN_RCVD | 收到 SYN | 收到 SYN，发送 SYN+ACK 后 |
| ESTABLISHED | 连接已建立 | 三次握手完成后 |
| CLOSE_WAIT | 收到 FIN，等待关闭 | 收到 FIN，发送 ACK 后 |
| LAST_ACK | 最后确认 | 发送 FIN 后，等待最后的 ACK |

## TIME_WAIT：最重要的状态

### 为什么需要 TIME_WAIT？

TIME_WAIT 是 TCP 设计的精华之一，它解决了两个问题：

**1. 保证最后的 ACK 能到达**

```
客户端 ─── ACK ───────────────────────────────> 服务端
               （ACK 丢失）

客户端 <── FIN（重发） ─────────────────────── 服务端
               （如果客户端已关闭，就收不到了）
```

如果客户端在发送 ACK 后立即关闭，服务端重发的 FIN 将无人响应，导致服务端一直处于 LAST_ACK 状态。

**2. 让旧连接的报文消失**

```
旧连接：seq=1000-2000
新连接：seq=1000-2000

如果没有 TIME_WAIT：
旧连接关闭后立即建立新连接
旧连接的延迟数据包可能到达新连接
被错误地当作新连接的数据接收
```

TIME_WAIT = 2MSL，确保旧连接的报文在网络中完全消失。

### MSL 是多少？

MSL（Maximum Segment Lifetime）是报文最大生存时间，在网络上约等于 60 秒。

所以 TIME_WAIT = 2MSL ≈ 2 分钟（Linux 可通过 tcp_fin_timeout 调整）。

### Linux 查看和调整 TIME_WAIT

```bash
# 查看 TIME_WAIT 连接数
netstat -an | grep TIME_WAIT | wc -l

# 查看具体连接
netstat -an | grep TIME_WAIT

# 查看 MSL 设置
cat /proc/sys/net/ipv4/tcp_fin_timeout
# 默认：60（秒）

# 调整 MSL
echo 30 > /proc/sys/net/ipv4/tcp_fin_timeout
```

## TIME_WAIT 问题与解决方案

### 问题：高并发短连接

```
场景：Web 服务器处理大量短请求
- 每次请求建立新连接
- 请求完成后立即关闭
- 大量 TIME_WAIT 占用端口

现象：
- 端口耗尽，无法建立新连接
- 错误：Address already in use
- 服务可用连接数下降
```

### 解决方案一：tcp_tw_reuse

允许在 TIME_WAIT 状态下重用相同端口（客户端推荐）。

```bash
# 开启（默认关闭）
echo 1 > /proc/sys/net/ipv4/tcp_tw_reuse

# 验证
cat /proc/sys/net/ipv4/tcp_tw_reuse
```

**原理**：内核在选择端口时，跳过处于 TIME_WAIT 状态的端口（如果时间超过 1 秒）。

### 解决方案二：tcp_fin_timeout

减少 TIME_WAIT 超时时间。

```bash
# 调整为 30 秒（默认 60）
echo 30 > /proc/sys/net/ipv4/tcp_fin_timeout
```

### 解决方案三：SO_REUSEADDR

服务端使用端口复用。

```java
ServerSocket serverSocket = new ServerSocket();
serverSocket.setReuseAddress(true);  // 允许复用 TIME_WAIT 状态的端口
serverSocket.bind(new InetSocketAddress(8080));
```

### 解决方案四：长连接

减少连接建立/关闭的频率。

```java
// HTTP Keep-Alive
HttpClient client = HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(10))
    .build();

// 设置 keep-alive
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://example.com"))
    .header("Connection", "keep-alive")
    .build();
```

### 解决方案五：负载均衡

让多个服务端实例分担连接，避免单实例端口耗尽。

```
                    ┌─────────────┐
                    │  Load       │
                    │  Balancer   │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
    ┌────────────┐   ┌────────────┐   ┌────────────┐
    │  Server 1  │   │  Server 2  │   │  Server 3  │
    │ :8080      │   │ :8081      │   │ :8082      │
    └────────────┘   └────────────┘   └────────────┘
```

## CLOSE_WAIT 问题

### 什么是 CLOSE_WAIT？

CLOSE_WAIT 表示**收到了对方的 FIN，但本端还没有调用 close()**。

```
客户端 ─── FIN ───────────────────────────────> 服务端
               服务端收到 FIN
               服务端回复 ACK
               服务端进入 CLOSE_WAIT
               （等待应用层调用 close()）
```

### 问题原因

应用层代码没有正确关闭连接：

```java
// 错误示例
Socket socket = serverSocket.accept();
try {
    // 处理请求
    // ...
} catch (Exception e) {
    // 没有关闭连接
}
// 没有 finally 块
```

### 解决方案

```java
// 正确示例：使用 try-with-resources
try (Socket socket = serverSocket.accept()) {
    // 处理请求
} // 自动关闭连接

// 或使用 finally
Socket socket = null;
try {
    socket = serverSocket.accept();
    // 处理请求
} finally {
    if (socket != null) {
        socket.close();
    }
}
```

### 排查 CLOSE_WAIT

```bash
# 查看 CLOSE_WAIT 连接
netstat -an | grep CLOSE_WAIT

# 查看是哪个进程
lsof -i | grep CLOSE_WAIT
```

## 实际案例分析

### 案例一：服务重启报错

```bash
$ java -jar app.jar
Exception in thread "main" java.net.BindException: Address already in use: JVM_Bind
```

**原因**：有 TIME_WAIT 状态的连接占用了端口。

**解决**：
```java
ServerSocket serverSocket = new ServerSocket();
serverSocket.setReuseAddress(true);
serverSocket.bind(new InetSocketAddress(8080));
```

### 案例二：服务端假死

```bash
$ netstat -an | grep :8080
tcp        0      0 0.0.0.0:8080            0.0.0.0:*               LISTEN
tcp        1      0 192.168.1.100:8080      192.168.1.200:54321     CLOSE_WAIT
tcp        1      0 192.168.1.100:8080      192.168.1.201:54322     CLOSE_WAIT
```

**原因**：应用层没有关闭连接。

**解决**：检查并修复关闭连接的代码。

### 案例三：连接超时

```bash
$ telnet example.com 80
Trying 93.184.216.34...
Connection timeout
```

**原因**：
- SYN 包被防火墙丢弃
- 服务端队列满了
- 网络不可达

**排查**：
```bash
# 检查端口监听
netstat -an | grep :80

# 检查半连接队列
ss -s

# 检查防火墙规则
iptables -L -n
```

## 面试追问方向

- 画出 TCP 状态转换图
- TIME_WAIT 状态的作用是什么？为什么要等 2MSL？
- 如何解决 TIME_WAIT 过多的问题？
- 什么是 CLOSE_WAIT 状态？大量 CLOSE_WAIT 是什么原因？
- tcp_tw_reuse 的原理是什么？适用于什么场景？
- SO_REUSEADDR 和 SO_REUSEPORT 的区别是什么？
- 如何排查服务器上连接状态异常的问题？
- 三次握手和四次挥手过程中，分别可能出现哪些状态？
