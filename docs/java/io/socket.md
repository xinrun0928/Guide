# Socket 通信与三次握手

你有没有想过，当你打开一个网页时，数据是怎么从服务器「飞」到你电脑的？

是直接「嗖」一下传过来吗？

当然不是。

背后是一整套复杂的网络协议在运转，而 TCP 三次握手是这一切的起点。

今天，我们来深入理解 Socket 通信和三次握手。

---

## 从 Socket 到三次握手

### Socket 是什么？

Socket（套接字）是网络通信的端点，应用程序通过 Socket 向网络发送或读取数据。

```
应用程序 A                              应用程序 B
┌─────────────┐                        ┌─────────────┐
│   Socket    │ ←─────── 网络 ───────→ │   Socket    │
│  192.168.1.1 │                        │  192.168.1.2 │
│    :8080     │                        │    :54321   │
└─────────────┘                        └─────────────┘
```

每个 Socket 有一个 IP 地址和端口号的组合：
- `192.168.1.1:8080` 标识服务器上的一个 Socket
- `192.168.1.2:54321` 标识客户端上的一个 Socket

### Java Socket 编程

```java
// 服务端
ServerSocket server = new ServerSocket(8080);
Socket client = server.accept();  // 阻塞等待连接
InputStream in = client.getInputStream();
OutputStream out = client.getOutputStream();

// 客户端
Socket socket = new Socket("localhost", 8080);
OutputStream out = socket.getOutputStream();
InputStream in = socket.getInputStream();
```

---

## TCP 三次握手：建立连接

### 为什么需要握手？

TCP 是**面向连接**的协议，数据传输前必须建立连接。

为什么要建立连接？

因为 TCP 要保证**可靠传输**——发送的数据必须**不丢失、不重复、顺序正确**。

为了做到这一点，双方需要先「认识」一下，确认彼此的「发报能力」和「收报能力」。

### 三次握手详解

```
客户端                                      服务端
    │                                          │
    │ ─────── SYN (seq=x) ──────────────→     │  1. 客户端发送 SYN
    │          SYN_SENT                        │
    │                                          │
    │ ←────── SYN+ACK (seq=y, ack=x+1) ────  │  2. 服务端发送 SYN+ACK
    │          SYN_RCVD                       │
    │                                          │
    │ ─────── ACK (ack=y+1) ──────────────→   │  3. 客户端发送 ACK
    │          ESTABLISHED                     │
    │                                          │
    │                                          │  ESTABLISHED
    │                                          │
```

### 每一步在做什么？

**第一次握手（SYN）**：
- 客户端：发送 SYN 包（seq=x），进入 `SYN_SENT` 状态
- 目的：告诉服务端「我要发数据了，我的起始序号是 x」

**第二次握手（SYN+ACK）**：
- 服务端：发送 SYN+ACK 包（seq=y, ack=x+1），进入 `SYN_RCVD` 状态
- 目的：告诉客户端「我收到了，你的序号 x 我确认了；我也要发数据了，我的起始序号是 y」

**第三次握手（ACK）**：
- 客户端：发送 ACK 包（ack=y+1），进入 `ESTABLISHED` 状态
- 服务端：收到 ACK，进入 `ESTABLISHED` 状态
- 目的：告诉服务端「我收到了，你的序号 y 我确认了」

### 为什么是三次？

核心原因：**双方都需要确认自己「能发」和「能收」**。

```
客户端 ──→ 服务端：客户端能发，服务端能收 ✓
客户端 ←── 服务端：服务端能发，客户端能收 ✓
```

- **第一次握手**：客户端证明自己能发、服务端能收
- **第二次握手**：服务端证明自己能发、客户端能收
- **第三次握手**：客户端确认服务端能发（否则服务端不会收到 ACK）

**两次不够，四次浪费**。

---

## TCP 四次挥手：断开连接

### 为什么是四次？

TCP 是全双工通信，两个方向都能发送数据。

断开连接需要**双向关闭**：

1. 客户端告诉服务端「我不发了」
2. 服务端告诉客户端「好的，我知道你不发了」
3. 服务端告诉客户端「我也不发了」
4. 客户端告诉服务端「好的，我知道你不发了，再见」

### 四次挥手详解

```
客户端                                      服务端
    │                                          │
    │ ─────── FIN (seq=u) ──────────────→     │  1. 客户端发送 FIN
    │          FIN_WAIT_1                     │
    │                                          │
    │ ←────── ACK (ack=u+1) ──────────────    │  2. 服务端发送 ACK
    │          FIN_WAIT_2 ←── CLOSE_WAIT      │
    │                                          │
    │            ... 等待 ...                  │
    │                                          │
    │ ←────── FIN (seq=w) ────────────────   │  3. 服务端发送 FIN
    │          LAST_ACK                       │
    │                                          │
    │ ─────── ACK (ack=w+1) ──────────────→   │  4. 客户端发送 ACK
    │          TIME_WAIT (等待 2MSL)           │
    │                                          │
    │                  CLOSED                  │  CLOSED
    │                                          │
```

### 各状态含义

| 状态 | 含义 |
|-----|------|
| FIN_WAIT_1 | 主动关闭方：已发送 FIN，等待对方 ACK |
| CLOSE_WAIT | 被动关闭方：收到 FIN，等待本地应用关闭 |
| FIN_WAIT_2 | 主动关闭方：收到 ACK，等待对方 FIN |
| LAST_ACK | 被动关闭方：等待对方 ACK |
| TIME_WAIT | 主动关闭方：等待 2MSL，确保对方收到最后的 ACK |

### TIME_WAIT：为什么等待 2MSL？

MSL（Maximum Segment Lifetime）是报文最大生存时间，通常是 60 秒。

等待 2MSL 的原因：

1. **确保最后的 ACK 能到达**：如果 ACK 丢了，服务端会重发 FIN，客户端需要再次发送 ACK
2. **让本连接的所有报文在网络中消失**：避免影响新建立的连接

```
TIME_WAIT 的危害：
- 端口被占用，无法立即重启服务
- 大量 TIME_WAIT 连接占用内存
```

**优化方案**：

```bash
# Linux 内核参数
net.ipv4.tcp_tw_reuse = 1       # 复用 TIME_WAIT 连接
net.ipv4.tcp_tw_recycle = 1     # 快速回收（已废弃）
net.ipv4.ip_local_port_range = 10000 65000  # 扩大端口范围
```

### CLOSE_WAIT：被动关闭方的坑

如果服务端有大量 CLOSE_WAIT 状态，说明**服务端没有正确关闭连接**。

常见原因：

1. **代码问题**：忘记调用 `socket.close()`
2. **资源泄漏**：数据库连接、文件句柄未释放
3. **业务逻辑阻塞**：某个 Handler 阻塞，导致连接无法关闭

```java
// 正确的资源关闭
try (Socket socket = new Socket("localhost", 8080)) {
    // 使用 socket
} // 自动关闭
```

---

## Socket 编程进阶

### 完整服务端示例

```java
public class SocketServer {
    public static void main(String[] args) throws IOException {
        ServerSocket server = new ServerSocket(8080);
        System.out.println("服务器启动，监听端口 8080...");

        while (true) {
            Socket client = server.accept();  // 阻塞
            // 每个连接一个线程
            new Thread(() -> handleClient(client)).start();
        }
    }

    private static void handleClient(Socket client) {
        try (client) {
            System.out.println("客户端连接：" + client.getRemoteSocketAddress());

            BufferedReader reader = new BufferedReader(
                new InputStreamReader(client.getInputStream())
            );
            PrintWriter writer = new PrintWriter(
                client.getOutputStream(), true
            );

            String request;
            while ((request = reader.readLine()) != null) {
                System.out.println("收到：" + request);
                writer.println("响应：" + request);
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
```

### 完整客户端示例

```java
public class SocketClient {
    public static void main(String[] args) throws IOException {
        try (Socket socket = new Socket("localhost", 8080)) {
            PrintWriter writer = new PrintWriter(
                socket.getOutputStream(), true
            );
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(socket.getInputStream())
            );

            writer.println("Hello Server");
            String response = reader.readLine();
            System.out.println("收到：" + response);
        }
    }
}
```

---

## Socket 常用参数

### 设置超时时间

```java
// SO_TIMEOUT：读取数据超时
socket.setSoTimeout(3000);  // 3 秒没数据则抛出 SocketTimeoutException

// connectionTimeout：连接超时
SocketAddress addr = new InetSocketAddress("localhost", 8080);
socket.connect(addr, 3000);  // 3 秒连不上则抛出异常
```

### 保活机制

```java
// SO_KEEPALIVE：检测对端是否存活
socket.setKeepAlive(true);  // 2 小时无数据则发送探测包
```

### Nagle 算法

```java
// TCP_NODELAY：禁用 Nagle 算法（立即发送，不等待合并小数据包）
socket.setTcpNoDelay(true);
```

### 缓冲区大小

```java
// SO_SNDBUF：发送缓冲区大小
socket.setSendBufferSize(64 * 1024);

// SO_RCVBUF：接收缓冲区大小
socket.setReceiveBufferSize(64 * 1024);
```

### 参数总结

| 参数 | 作用 | 建议值 |
|-----|------|-------|
| SO_TIMEOUT | 读取超时 | 根据业务调整 |
| SO_KEEPALIVE | 连接保活 | 长连接开启 |
| TCP_NODELAY | 禁用 Nagle | 实时通信开启 |
| SO_SNDBUF | 发送缓冲 | 大文件调大 |
| SO_RCVBUF | 接收缓冲 | 吞吐量调大 |

---

## 半关闭与全关闭

### 半关闭：shutdownOutput()

只关闭输出流，保留输入流。

```java
// 发送完数据后通知对方
socket.shutdownOutput();  // 发送 FIN，但还能接收数据

// 对方可能还在发送数据...
String response = reader.readLine();
```

**使用场景**：HTTP 请求/响应模型，先发请求，再收响应。

### 全关闭：close()

关闭整个 Socket，输出流和输入流都关闭。

```java
socket.close();  // 双方都收到 FIN
```

---

## 面试追问方向

### 追问一：TCP 和 UDP 的区别？

| 特性 | TCP | UDP |
|-----|-----|-----|
| 连接 | 面向连接 | 无连接 |
| 可靠性 | 可靠 | 不可靠 |
| 有序性 | 有序 | 无序 |
| 速度 | 慢 | 快 |
| 头部 | 20-60 字节 | 8 字节 |
| 场景 | 文件传输、HTTP | 视频、直播、DNS |

### 追问二：为什么 TCP 握手是三次，不是两次或四次？

**两次不够**：

```
客户端 ──→ 服务端：发送 SYN（客户端能发）
客户端 ←── 服务端：收到 SYN（服务端能收）
```

此时客户端知道「我能发、服务端能收」，但**服务端不知道「自己能发、客户端能收」**。

**四次多余**：

```
客户端 ──→ 服务端：发送 SYN
客户端 ←── 服务端：收到 SYN，发送 ACK
客户端 ──→ 服务端：收到 ACK，发送 ACK（多余）
```

第三次 ACK 和第一次 SYN 方向相同，可以合并。

### 追问三：SYN 攻击是什么？

攻击者发送大量 SYN 包，但不完成三次握手。

服务端收到 SYN 后进入 `SYN_RCVD` 状态，等待客户端的 ACK。

如果大量连接停留在这个状态，服务端资源耗尽。

**防御措施**：

```bash
# Linux 内核参数
net.ipv4.tcp_syncookies = 1          # SYN Cookie
net.ipv4.tcp_syn_retries = 2          # SYN 重试次数
net.ipv4.tcp_max_syn_backlog = 16384  # SYN 队列长度
```

### 追问四：TIME_WAIT 状态过多怎么办？

1. **调高端口范围**：`net.ipv4.ip_local_port_range`
2. **开启复用**：`net.ipv4.tcp_tw_reuse = 1`
3. **缩短 MSL**：`net.ipv4.tcp_fin_timeout`
4. **使用 SO_LINGER**：强制关闭，不进入 TIME_WAIT

---

## 留给你的思考题

我们讲了三次握手、四次挥手，以及 Socket 编程。

但还有一个问题：

**HTTP/1.0 和 HTTP/1.1 在连接管理上有什么区别？**

- HTTP/1.0：默认短连接，每次请求都新建 TCP 连接
- HTTP/1.1：默认长连接（keep-alive），多个请求复用同一个连接

但 HTTP/1.1 的长连接是「**串行**」的——一个请求完成前，下一个请求必须等待。

**HTTP/2 是怎么解决这个问题的？**

> 提示：多路复用（Multiplexing）、Stream、帧（Frame）……
