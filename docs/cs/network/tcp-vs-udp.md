# TCP 与 UDP 对比与适用场景

面试中最常见的问题之一：「什么时候用 TCP？什么时候用 UDP？」

很多人会说「TCP 可靠，UDP 不可靠」。但这个答案只对了一半。

理解两者真正的区别和各自的适用场景，才能在设计中做出正确的选择。

## 先说本质区别

```
┌─────────────────────────────────────────────────────────────┐
│                     TCP vs UDP 本质区别                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  TCP：面向连接的可靠字节流服务                                │
│       - 先建立连接，再传输数据                                 │
│       - 保证数据按序、完整、不重复                            │
│       - 有拥塞控制，不会把网络堵死                           │
│                                                             │
│  UDP：无连接的不可靠数据报服务                               │
│       - 直接发送数据，不需要连接                             │
│       - 不保证交付、不保证顺序、不保证不重复                  │
│       - 没有拥塞控制，发送方全速发                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 详细对比

| 特性 | TCP | UDP |
|------|-----|-----|
| 连接性 | 面向连接 | 无连接 |
| 可靠性 | 可靠交付 | 不可靠交付 |
| 有序性 | 按序交付 | 不保证顺序 |
| 速度 | 较慢（开销大） | 较快（开销小） |
| 流量控制 | 有 | 无 |
| 拥塞控制 | 有 | 无 |
| 首部大小 | 20-60 字节 | 8 字节 |
| 数据边界 | 无（字节流） | 有（数据报） |
| 场景 | 文件传输、网页、邮件 | 视频、语音、游戏 |

## TCP 头部 vs UDP 头部

### TCP 头部（20 字节 + 可选选项）

```
┌──────────────────────────────────────────────────────────────┐
│  源端口 (16)  │           目的端口 (16)                      │
├──────────────────────────────────────────────────────────────┤
│                      序号 (32)                               │
├──────────────────────────────────────────────────────────────┤
│                      确认号 (32)                             │
├────────┬────────┬────────┬────────┬────────┬────────────────┤
│ 数据偏移│  保留  │NS │CWR│ECE│URG│ACK│PSH│RST│SYN│FIN│ 窗口 │
├────────┴────────┴────────┴────────┴────────┴────────────────┤
│                     校验和  │        紧急指针                  │
├──────────────────────────────────────────────────────────────┤
│                    选项（可变长度）                           │
└──────────────────────────────────────────────────────────────┘
                         最小 20 字节
```

### UDP 头部（固定 8 字节）

```
┌──────────────────────────────────────────────────────────────┐
│  源端口 (16)  │           目的端口 (16)                      │
├──────────────────────────────────────────────────────────────┤
│  长度 (16)    │           校验和 (16)                        │
└──────────────────────────────────────────────────────────────┘
                         固定 8 字节
```

**UDP 的简洁性**：UDP 只有 4 个字段，每个 2 字节。而 TCP 光序号和确认号就占 8 字节。

## 为什么 TCP 慢？

### 三次握手 + 四次挥手

```
连接建立：
客户端 ──── SYN ────> 服务端（1 RTT）
              <── SYN+ACK ──── 服务端（1 RTT）
客户端 ──── ACK ────> 服务端（0.5 RTT）

总计：1.5 - 2 RTT 才能开始传输
```

UDP 没有这些开销，直接发数据。

### 确认与重传

```
TCP：
发送 ──── 数据 ────> 等待 ACK ────> 如果没收到，重传

UDP：
发送 ──── 数据 ────> 发完就走，不管收没收到
```

### 拥塞控制

```
TCP 会主动控制发送速度：
- 丢包时减小窗口
- 网络空闲时慢慢增大窗口

UDP 不管这些，全速发送
```

### 可靠性 vs 性能

```
TCP 为了可靠性付出的代价：
1. 序号和确认号（8 字节）
2. 校验和（2 字节）
3. 流量控制（滑动窗口）
4. 拥塞控制（慢启动、拥塞避免）
5. 状态维护（连接状态机）

UDP 什么都没有，只有 8 字节头部
```

## 什么时候用 TCP？

### 适合 TCP 的场景

```
1. 需要可靠传输
   - 文件传输（FTP、HTTP 文件下载）
   - 邮件（SMTP、POP3、IMAP）
   - 金融交易（HTTPS、SFTP）

2. 需要数据完整
   - 数据库复制
   - 远程桌面
   - 配置同步

3. 发送连续数据流
   - HTTP/HTTPS
   - SSH
   - WebSocket

4. 不在意轻微延迟
   - 电子邮件
   - 网页浏览
   - API 调用
```

### 不适合 TCP 的场景

```
1. 实时性要求高
   - 视频会议（容忍少量丢包，不能容忍延迟）
   - 在线游戏（每一帧都重要）
   - VoIP 语音通话

2. 一对多广播
   - 直播推流
   - DNS 查询
   - 多播通信

3. 简单请求-响应
   - DNS 查询（可以用 TCP，但 UDP 更高效）
   - SNMP 监控
```

## 什么时候用 UDP？

### 适合 UDP 的场景

```
1. 实时应用
   - 视频流（RTMP、HLS）
   - VoIP 语音
   - 游戏状态同步

2. 高速传输（可容忍少量丢包）
   - 视频会议
   - 在线游戏
   - 直播

3. 广播/多播
   - 服务发现（mDNS）
   - 路由协议（RIP）
   - 流媒体

4. 简单查询
   - DNS 查询
   - NTP 时间同步
```

### UDP 的问题与解决

UDP 本身不可靠，但可以通过应用层实现可靠性：

```
┌─────────────────────────────────────────────────────────────┐
│                    应用层实现可靠性                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 序列号                                                  │
│     给每个数据包编号，接收方检测丢包和乱序                    │
│                                                             │
│  2. 确认机制                                                │
│     接收方向发送方确认收到的数据包                            │
│                                                             │
│  3. 重传机制                                                │
│     超时未确认的数据包需要重传                                │
│                                                             │
│  4. 拥塞控制                                                │
│     根据网络状况调整发送速率                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 常见协议选择

```
协议              │ 传输层 │ 原因
─────────────────┼───────┼──────────────────────────────
HTTP/HTTPS       │ TCP   │ 需要可靠传输
SSH              │ TCP   │ 需要可靠传输
FTP              │ TCP   │ 需要可靠传输
邮件（SMTP/POP/IMAP）│ TCP │ 需要可靠传输
DNS              │ UDP   │ 查询快，大多数请求-响应单包完成
NTP              │ UDP   │ 时间同步，丢了无所谓
VoIP             │ UDP   │ 实时性 > 可靠性
视频流            │ UDP   │ 实时性 > 可靠性
游戏              │ UDP   │ 实时性 > 可靠性
Netflix/Hulu      │ TCP   │ 可靠 > 实时（可缓冲）
WebRTC            │ UDP   │ 实时音视频
QUIC              │ UDP   │ 应用层实现可靠性
```

## Java 代码对比

### TCP 客户端

```java
import java.io.*;
import java.net.*;

public class TCPClient {
    public static void main(String[] args) {
        String host = "example.com";
        int port = 80;

        try (Socket socket = new Socket(host, port)) {
            // TCP 需要建立连接（三次握手）
            System.out.println("TCP 连接已建立");

            // 发送数据
            String request = "GET / HTTP/1.1\r\nHost: example.com\r\n\r\n";
            OutputStream out = socket.getOutputStream();
            out.write(request.getBytes());
            out.flush();

            // 读取响应（保证顺序、完整）
            InputStream in = socket.getInputStream();
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(in));

            String line;
            while ((line = reader.readLine()) != null) {
                System.out.println(line);
            }

        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
```

### UDP 客户端

```java
import java.io.*;
import java.net.*;

public class UDPClient {
    public static void main(String[] args) {
        String host = "8.8.8.8";
        int port = 53;  // DNS

        try (DatagramSocket socket = new DatagramSocket()) {
            // UDP 不需要建立连接，直接发
            System.out.println("UDP socket 已创建");

            // 构造 DNS 查询（简化版）
            byte[] query = buildDnsQuery("example.com");
            InetAddress address = InetAddress.getByName(host);

            // 发送数据包
            DatagramPacket sendPacket = new DatagramPacket(
                query, query.length, address, port);
            socket.send(sendPacket);
            System.out.println("已发送 DNS 查询");

            // 接收响应
            byte[] buffer = new byte[512];
            DatagramPacket receivePacket = new DatagramPacket(
                buffer, buffer.length);
            socket.receive(receivePacket);

            System.out.println("收到响应，共 " +
                receivePacket.getLength() + " 字节");

        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    private static byte[] buildDnsQuery(String domain) {
        // 简化：返回空数组，实际需要构造标准 DNS 格式
        return new byte[0];
    }
}
```

### 对比总结

```java
// TCP 特点
Socket socket = new Socket(host, port);
socket.getOutputStream().write(data);  // 写入字节流
socket.getInputStream().read(buffer);  // 读取字节流
// 底层处理：确认、重传、排序、流量控制

// UDP 特点
DatagramSocket socket = new DatagramSocket();
socket.send(new DatagramPacket(data, len, addr, port));  // 发数据报
socket.receive(new DatagramPacket(buffer, len));          // 收数据报
// 底层处理：无，完全由应用层决定
```

## 混合使用：QUIC

QUIC 是 Google 提出的协议，基于 UDP，但在应用层实现了 TCP 的可靠性。

```
┌─────────────────────────────────────────────────────────────┐
│                         QUIC                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  应用层（QUIC 协议）                                        │
│    ├─ 连接建立（0-RTT 或 1-RTT）                            │
│    ├─ 可靠性保证（确认、重传）                                │
│    ├─ 流量控制                                              │
│    ├─ 拥塞控制                                              │
│    ├─ 多路复用（无 HTTP/2 的队头阻塞问题）                     │
│    └─ 连接迁移（切换网络时保持连接）                          │
│                                                             │
│  传输层：UDP                                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

这就是为什么 HTTP/3 使用 QUIC（基于 UDP）而不是继续基于 TCP。

## 面试追问方向

- TCP 和 UDP 的本质区别是什么？
- 为什么 UDP 比 TCP 快？
- 什么场景适合用 TCP？什么场景适合用 UDP？
- UDP 如何实现可靠性？
- QUIC 协议是什么？它解决了什么问题？
- DNS 为什么用 UDP 而不是 TCP？
- 视频流为什么用 UDP 而不是 TCP？
- TCP 的三次握手和四次挥手对性能有什么影响？
- 什么是队头阻塞？TCP 和 QUIC 是怎么处理的？
