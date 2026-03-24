# TCP 四次挥手：流程与状态变化

连接建立需要握手，那断开连接呢？

很多人以为断开连接也需要三次握手那样的过程，但 TCP 的断开叫做**四次挥手**——听起来差不多，背后的逻辑却完全不同。

理解四次挥手，是理解 TCP 连接生命周期完整图景的关键。

## 为什么是四次挥手？

TCP 是全双工通信，两个方向可以独立关闭。

打个比方：你和朋友打电话，你说完「再见」挂断了，但朋友可能还没说完最后的叮嘱。所以你挂电话后，朋友还要说最后一句话，然后才挂断。

TCP 也是这样：
- 客户端告诉服务端「我的数据发完了」
- 服务端回复「收到」
- 服务端告诉客户端「我的数据也发完了」
- 客户端回复「收到，再见」

每个方向都是一次 FIN + ACK 的过程，所以是四次。

## 四次挥手流程

### 完整图解

```
客户端                                      服务端
   │                                          │
   │           数据传输中...                    │
   │                                          │
   │  ────── FIN (seq=u) ────────────────> │  第一次挥手
   │                                          │
   │  客户端 → 服务端：我的数据发完了，但我还能收数据
   │                                          │
   │  状态：ESTABLISHED ──> FIN_WAIT_1        │
   │                                          │
   │  <────── ACK (ack=u+1) ───────────────── │  第二次挥手
   │                                          │
   │  服务端 → 客户端：收到，但我可能还有数据要发
   │                                          │
   │  状态：FIN_WAIT_1 ──> FIN_WAIT_2         │
   │                                          │
   │            （服务端可能还在发送数据）        │
   │  <────── 数据 (seq=v) ────────────────── │
   │  <────── FIN (seq=w) ────────────────── │  第三次挥手
   │                                          │
   │  服务端 → 客户端：我的数据也发完了
   │                                          │
   │  状态：CLOSE_WAIT                        │
   │                                          │
   │  ────── ACK (ack=w+1) ────────────────> │  第四次挥手
   │                                          │
   │  客户端 → 服务端：收到，服务端可以关闭了
   │                                          │
   │  状态：TIME_WAIT                         │
   │                                    状态：CLOSED
   │                                          │
   │  等待 2MSL                               │
   │                                          │
   │  状态：TIME_WAIT ──> CLOSED             │
   │                                          │
```

### 状态变化详解

**客户端状态变化**：

```
ESTABLISHED ──> FIN_WAIT_1 ──> FIN_WAIT_2 ──> TIME_WAIT ──> CLOSED
    │              │             │              │
    │         发送 FIN      收到 ACK      等待 2MSL    │
    │                            │         彻底关闭      │
    │                      收到服务端 FIN                │
    │                         发送 ACK                   │
```

**服务端状态变化**：

```
ESTABLISHED ──> CLOSE_WAIT ──> LAST_ACK ──> CLOSED
    │              │             │
    │         收到 FIN       发送自己的 FIN    │
    │         发送 ACK       等待最后的 ACK    │
    │                                           │
    │                                  收到 ACK │
```

### 为什么是 2MSL？

MSL（Maximum Segment Lifetime）是报文最大生存时间，通常是 60 秒。

2MSL 的目的是：

1. **保证最后的 ACK 能到达服务端**：如果第四次挥手的 ACK 丢失，服务端会重发 FIN，客户端需要在这段时间内能响应
2. **让旧连接的报文在网络中完全消失**：防止新连接收到旧连接的延迟报文

```
场景：第四次挥手 ACK 丢失

客户端                                           服务端
   │                                                │
   │  ──────── ACK ────────────────────────────>  │  第四次挥手
   │       （ACK 丢失）                              │
   │                                                │
   │                  <─────── FIN （重发） ───────│
   │                                                │
   │  客户端必须还在，能响应这个重发的 FIN            │
   │  否则服务端会一直处于 LAST_ACK，无法关闭         │
```

### TIME_WAIT 的危害

在高并发服务器上，如果短时间内有大量连接关闭，会产生大量 TIME_WAIT 状态的连接：

```
问题：
1. 占用端口资源（每个 TIME_WAIT 连接占用一个端口）
2. 占用内存
3. 可能导致端口耗尽，无法建立新连接

现象：
java.net.BindException: Address already in use: JVM_Bind
```

## 优化 TIME_WAIT

### 方法一：复用端口

Linux 允许在 TIME_WAIT 状态下重用相同端口：

```bash
# 开启 tcp_tw_reuse（客户端推荐）
echo 1 > /proc/sys/net/ipv4/tcp_tw_reuse

# 设置 fin_timeout（减少 TIME_WAIT 超时时间）
echo 30 > /proc/sys/net/ipv4/tcp_fin_timeout
```

### 方法二：使用 SO_REUSEADDR

服务端套接字启用端口复用选项：

```java
ServerSocket serverSocket = new ServerSocket();
serverSocket.setReuseAddress(true);  // 允许复用 TIME_WAIT 状态的端口
serverSocket.bind(new InetSocketAddress(8080));
```

### 方法三：调整 MSL

```bash
# 查看当前 MSL
cat /proc/sys/net/ipv4/tcp_fin_timeout

# 修改 MSL（不推荐，可能影响正常连接）
echo 30 > /proc/sys/net/ipv4/ip_default_ttl
```

### 方法四：客户端使用连接池

减少连接建立/关闭的频率，用连接池复用连接。

## 实际案例：连接关闭的坑

### 场景一：四次挥手未完成连接被强制关闭

```java
Socket socket = new Socket(host, port);
try {
    // 发送请求
    OutputStream out = socket.getOutputStream();
    out.write(request.getBytes());

    // 读取响应
    InputStream in = socket.getInputStream();
    byte[] buffer = new byte[1024];
    in.read(buffer);  // 如果数据没读完就关闭会怎样？

} finally {
    socket.close();  // 强制关闭，发送 RST
}
```

**问题**：`socket.close()` 会立即发送 FIN，但如果输入流中还有未读数据，会发送 RST 而不是 FIN。

**解决**：先关闭输出流（`socket.shutdownOutput()`），再读取剩余数据，最后关闭连接。

```java
socket.shutdownOutput();  // 关闭输出流，发送 FIN
// 读取剩余数据...
socket.close();  // 关闭连接
```

### 场景二：服务端大量 CLOSE_WAIT

```bash
$ netstat -an | grep CLOSE_WAIT
tcp        0      0 192.168.1.100:8080      192.168.1.200:54321         CLOSE_WAIT
tcp        0      0 192.168.1.100:8080      192.168.1.201:54322         CLOSE_WAIT
tcp        0      0 192.168.1.100:8080      192.168.1.202:54323         CLOSE_WAIT
```

**原因**：收到了客户端的 FIN，但应用层没有调用 `socket.close()`。

**排查**：检查代码中是否正确关闭了连接。

```java
// 错误：没有关闭连接
InputStream in = socket.getInputStream();
while ((len = in.read(buffer)) != -1) {
    // 处理数据...
}
// 没有 finally 块或 close()

// 正确：使用 try-with-resources
try (Socket socket = serverSocket.accept()) {
    // 处理请求
}  // 自动关闭连接
```

### 场景三：优雅关闭 vs 强制关闭

```java
// 优雅关闭：等待数据发送完毕再关闭
socket.close();
// 等价于
socket.shutdownOutput();  // 先关闭输出
// ... 读取响应 ...
socket.close();          // 再关闭连接

// 强制关闭：立即关闭，发送 RST
socket.setSoLinger(true, 0);  // 禁用延迟关闭
socket.close();                // 立即发送 RST
```

## Java 代码示例：模拟四次挥手

```java
import java.io.*;
import java.net.*;

public class TCPConnectionLifecycle {
    public static void main(String[] args) throws Exception {
        // 演示连接生命周期中的状态变化
        System.out.println("TCP 连接状态演示");
        System.out.println("=".repeat(50));

        // 创建监听服务
        ServerSocket serverSocket = new ServerSocket(0);  // 随机端口
        int port = serverSocket.getLocalPort();
        System.out.println("服务端监听端口: " + port);

        // 启动客户端
        Socket client = new Socket("127.0.0.1", port);
        System.out.println("客户端: 连接到服务端");

        // 接收连接
        Socket server = serverSocket.accept();
        System.out.println("服务端: 收到客户端连接");

        // 模拟数据传输
        client.getOutputStream().write("Hello".getBytes());
        client.getOutputStream().flush();

        byte[] buffer = new byte[1024];
        int len = server.getInputStream().read(buffer);
        System.out.println("服务端: 收到数据 " + new String(buffer, 0, len));

        // 关闭连接（演示四次挥手）
        System.out.println("\n开始四次挥手...");

        // 客户端主动关闭
        client.shutdownOutput();  // 发送 FIN
        System.out.println("客户端: 发送 FIN (第一次挥手)");
        System.out.println("客户端状态: ESTABLISHED -> FIN_WAIT_1");

        // 服务端回复 ACK
        server.getInputStream().read();  // 消费 FIN
        System.out.println("服务端: 收到 FIN，回复 ACK (第二次挥手)");
        System.out.println("服务端状态: ESTABLISHED -> CLOSE_WAIT");

        // 服务端关闭
        server.shutdownOutput();
        System.out.println("服务端: 发送 FIN (第三次挥手)");
        System.out.println("服务端状态: CLOSE_WAIT -> LAST_ACK");

        // 客户端最后确认
        client.getInputStream().read();  // 消费 FIN
        System.out.println("客户端: 收到 FIN，回复 ACK (第四次挥手)");
        System.out.println("客户端状态: FIN_WAIT_2 -> TIME_WAIT (等待 2MSL)");

        // 关闭连接
        client.close();
        server.close();
        serverSocket.close();

        System.out.println("\n连接已完全关闭");
    }
}
```

## 面试追问方向

- 为什么是四次挥手而不是三次？
- TIME_WAIT 状态是什么？为什么要等待 2MSL？
- TIME_WAIT 状态过多会带来什么问题？如何解决？
- 什么是 CLOSE_WAIT 状态？大量 CLOSE_WAIT 是什么原因？
- 如果第四次挥手（最后的 ACK）丢失了会怎样？
- 什么是 SO_REUSEADDR？它是如何工作的？
- 优雅关闭和强制关闭有什么区别？
- 如何排查服务器上大量连接处于 TIME_WAIT 或 CLOSE_WAIT 的问题？
