# TCP 三次握手：流程与状态变化

面试中最经典的问题：「TCP 为什么需要三次握手？」

这个问题难倒了无数候选人——因为它考察的不仅是「是什么」，更是「为什么」。

三次握手是 TCP 可靠连接建立的基础，理解它，你才能理解整个传输层。

## 为什么需要握手？

TCP 是一种**面向连接**的协议。在传输数据之前，发送方和接收方需要确认彼此的存在，并且协商好通信的参数。

打个比方：你想给远方的朋友打电话，总得先拨号、等对方接通、确认「喂，能听到吗」——这个「确认」的过程，就是握手。

如果跳过握手直接发数据，就像对着空气喊话：你根本不知道对方在不在，也不知道对方能不能听到。

## 三次握手流程

### 完整图解

```
客户端                                      服务端
   │                                          │
   │  ────── SYN (seq=x) ──────────────────> │  第一次握手
   │                                          │
   │  客户端 → 服务端：我想建立连接，我的起始序号是 x
   │                                          │
   │  状态：CLOSED ──> SYN_SENT              │
   │                                          │
   │  <────── SYN+ACK (seq=y, ack=x+1) ──── │  第二次握手
   │                                          │
   │  服务端 → 客户端：我同意连接，我的起始序号是 y，确认收到 x
   │                                          │
   │  状态：LISTEN                             │
   │                                          │
   │  ────── ACK (ack=y+1) ────────────────> │  第三次握手
   │                                          │
   │  客户端 → 服务端：确认收到 y，连接建立成功
   │                                          │
   │  状态：ESTABLISHED                        │
   │                                          │
   │                                    状态：ESTABLISHED
   │                                          │
   │           数据传输开始...                  │
```

### 三次握手的本质

**第一次握手**：客户端发送 SYN，告诉服务端「我要发起连接，我的序号是从 x 开始的」

**第二次握手**：服务端发送 SYN+ACK，告诉客户端「我收到了你的序号 x，我同意连接，我的序号是从 y 开始的」

**第三次握手**：客户端发送 ACK，告诉服务端「我收到了你的序号 y，连接正式建立」

### TCP 头部中的关键字段

```
┌──────────────────────────────────────────────────────────────┐
│  源端口 (16)  │           目的端口 (16)                       │
├──────────────────────────────────────────────────────────────┤
│                      序号 (32)                               │
│                        seq = x（客户端随机生成）               │
├──────────────────────────────────────────────────────────────┤
│                      确认号 (32)                             │
│                        ack = x + 1                           │
├────────┬────────┬────────┬────────┬────────┬────────────────┤
│ 偏移量 │ 保留   │ NS │CWR│ECE│URG│ACK│PSH│RST│SYN│FIN│      │
├────────┴────────┴────────┴────────┴────────┴────────────────┤
│                     窗口大小 (16)                             │
├──────────────────────────────────────────────────────────────┤
│                     校验和 (16)  │        紧急指针 (16)       │
├──────────────────────────────────────────────────────────────┤
│                    选项（可变长度）                           │
│              MSS（最大报文段长度）、窗口扩大因子等               │
└──────────────────────────────────────────────────────────────┘
```

## 状态变化详解

### 客户端状态变化

```
CLOSED ──────> SYN_SENT ──────> ESTABLISHED
  │                               │
  │    发送 SYN                   │    收到 ACK
  │                               │
  └─────────────── RST ───────────┘
                       （连接失败）
```

- **CLOSED**：初始状态，没有连接
- **SYN_SENT**：已发送 SYN，等待确认
- **ESTABLISHED**：连接已建立，可以传输数据

### 服务端状态变化

```
CLOSED ──────> LISTEN ──────> SYN_RECEIVED ──────> ESTABLISHED
  │               │              │                    │
  │         创建监听套接字   │  收到 SYN        │  收到 ACK
  │               │         发送 SYN+ACK       │
  │               │              │               │
  │               │         （半连接队列）        │
  └───────────────┴──────────────────────────────┘
                           RST（拒绝连接）
```

- **CLOSED**：初始状态
- **LISTEN**：服务端正在监听端口，等待连接
- **SYN_RECEIVED**：收到 SYN，已发送 SYN+ACK，等待最后的 ACK
- **ESTABLISHED**：连接已建立

### 半连接队列与全连接队列

服务端有两个重要的队列：

```
┌─────────────────────────────────────────────────────────────┐
│                      服务端                                  │
│                                                             │
│   ┌─────────────────┐         ┌─────────────────┐         │
│   │   半连接队列      │         │   全连接队列      │         │
│   │ (SYN Queue)     │         │ (Accept Queue)  │         │
│   │                 │         │                 │         │
│   │  状态: SYN_RCVD │  ACK   │  状态: ESTAB    │ accept  │
│   │                 │ ──────> │                 │ ──────> │
│   │  收到 SYN,等待   │         │ 三次握手完成,    │         │
│   │  最后 ACK       │         │ 等待应用层取走   │         │
│   └─────────────────┘         └─────────────────┘         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

- **半连接队列（SYN Queue）**：存放收到 SYN 但未完成三次握手的连接
- **全连接队列（Accept Queue）**：存放已完成三次握手但应用层还未 accept 的连接

**常见问题**：如果应用层 accept 太慢，队列会满，导致新的连接被丢弃。

## Java 代码示例

### 客户端发起连接

```java
import java.io.*;
import java.net.*;

public class TCPClient {
    public static void main(String[] args) {
        String host = "127.0.0.1";
        int port = 8080;

        try (Socket socket = new Socket(host, port)) {
            // 三次握手在 new Socket() 时自动完成
            System.out.println("已连接到服务端，连接状态: " + socket.isConnected());

            // 获取网络相关信息
            System.out.println("本地地址: " + socket.getLocalAddress() + ":" + socket.getLocalPort());
            System.out.println("远程地址: " + socket.getRemoteSocketAddress());

            // 发送数据
            OutputStream out = socket.getOutputStream();
            out.write("Hello, Server!".getBytes());
            out.flush();

            // 接收响应
            InputStream in = socket.getInputStream();
            byte[] buffer = new byte[1024];
            int len = in.read(buffer);
            System.out.println("收到服务端响应: " + new String(buffer, 0, len));

        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
```

### 服务端接受连接

```java
import java.io.*;
import java.net.*;

public class TCPServer {
    public static void main(String[] args) {
        int port = 8080;

        try (ServerSocket serverSocket = new ServerSocket(port)) {
            System.out.println("服务端启动，监听端口: " + port);

            while (true) {
                // 等待客户端连接（会阻塞）
                Socket clientSocket = serverSocket.accept();
                System.out.println("收到客户端连接: " + clientSocket.getRemoteSocketAddress());

                // 处理客户端请求
                handleClient(clientSocket);
            }

        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    private static void handleClient(Socket clientSocket) {
        try {
            // 读取客户端数据
            InputStream in = clientSocket.getInputStream();
            byte[] buffer = new byte[1024];
            int len = in.read(buffer);
            System.out.println("收到客户端数据: " + new String(buffer, 0, len));

            // 发送响应
            OutputStream out = clientSocket.getOutputStream();
            out.write("Hello, Client!".getBytes());
            out.flush();

        } catch (IOException e) {
            e.printStackTrace();
        } finally {
            try {
                clientSocket.close();
            } catch (IOException e) {
                e.printStackTrace();
            }
        }
    }
}
```

### 查看连接状态

```bash
# Linux/Mac 查看 TCP 连接状态
netstat -an | grep :8080

# Windows
netstat -ano | findstr :8080

# 输出示例
# tcp        0      0 0.0.0.0:8080            0.0.0.0:*               LISTEN
# tcp        0      0 127.0.0.1:8080          127.0.0.1:54321         ESTABLISHED
```

## 实战问题：SYN 洪水攻击

### 原理

攻击者大量发送 SYN 请求，但不完成第三次握手，导致服务端半连接队列占满，无法响应正常请求。

```
正常客户端 ─── SYN ──> 服务端（队列中）
正常客户端 <── SYN+ACK ── 服务端
正常客户端 ─── ACK ──> 服务端（队列移除，连接建立）

攻击者 ─── SYN ──> 服务端（队列中）
攻击者 ─── SYN ──> 服务端（队列中）
攻击者 ─── SYN ──> 服务端（队列中）
...（不发送 ACK，队列占满）
正常客户端 ─── SYN ──> 服务端（被拒绝）
```

### 防御措施

1. **SYN Cookie**：不把连接放入队列，而是用 Cookie 验证
2. **减少 SYN+ACK 重试次数**：快速丢弃不完整的连接
3. **增大半连接队列**：治标不治本
4. **使用防火墙**：过滤异常的 SYN 流量

## 面试追问方向

- 为什么是三次握手而不是两次？
- 什么是 SYN Flood 攻击？如何防御？
- 半连接队列和全连接队列是什么？满了会怎样？
- TCP 头部有哪些字段？SYN、ACK、seq、ack 各自的作用是什么？
- 如果第三次握手丢失了，会发生什么？
- 什么是 SYN Cookie？它是如何工作的？
- 连接建立过程中，操作系统需要分配哪些资源？
