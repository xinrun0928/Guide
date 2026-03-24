# UDP 报文结构与特点

UDP（User Datagram Protocol）是传输层协议中最简洁的一个。

它没有三次握手，没有确认重传，没有流量控制——它只是把数据从应用层扔给网络层，至于能不能到达、什么时候到达，UDP 不管。

这种「简单粗暴」的设计，让 UDP 在某些场景下反而是最佳选择。

## UDP 的设计哲学

TCP 的设计哲学是：**我要确保你收到我的数据**。

UDP 的设计哲学是：**我只负责发，收不收是你的事**。

```
TCP：可靠的邮局
       发信 ────> 确认 ────> 重试（如果没确认）
       
UDP：快递柜
       扔进去 ────> 走人
       （收件人自己去取）
```

## UDP 报文结构

### 首部格式（固定 8 字节）

```
┌─────────────────────────────────────────────────────────────┐
│  源端口 (16 位)           │        目的端口 (16 位)          │
├─────────────────────────────────────────────────────────────┤
│  长度 (16 位)             │        校验和 (16 位)             │
├─────────────────────────────────────────────────────────────┤
│                        数据部分                              │
│                    （可变长度）                              │
└─────────────────────────────────────────────────────────────┘
```

### 各字段详解

```
1. 源端口（Source Port）
   - 可选字段，发送端可以设为 0（如果不需要回复）
   - 用于标识发送数据的应用

2. 目的端口（Destination Port）
   - 必填字段，指定接收端的应用
   - DNS: 53, DHCP: 67/68, SNMP: 161

3. 长度（Length）
   - UDP 头 + 数据的总长度
   - 最小值：8 字节（只有头部）
   - 最大值：65535 字节（IP 包最大 65535，头部最少 20 字节）

4. 校验和（Checksum）
   - 可选（IPv4），IPv6 必须使用
   - 计算范围：伪首部 + UDP 头部 + 数据
```

### 伪首部（计算校验和时使用）

```
┌─────────────────────────────────────────────────────────────┐
│                    伪首部（仅用于校验和计算）                  │
├─────────────────────────────────────────────────────────────┤
│  源 IP 地址 (32 位)                                          │
├─────────────────────────────────────────────────────────────┤
│  目的 IP 地址 (32 位)                                        │
├──────────┬──────────┬──────────────────────────────────────┤
│  全零    │  协议    │           UDP 长度                     │
│  (8 位)  │  (17)    │           (16 位)                      │
├──────────┴──────────┴──────────────────────────────────────┤
│                       UDP 头部 + 数据                         │
└─────────────────────────────────────────────────────────────┘
```

伪首部用于验证 UDP 包是否送达了正确的 IP 地址。

## UDP 的特点

### 优点

```
1. 简单高效
   - 无连接建立延迟
   - 无状态维护
   - 首部开销小（8 字节 vs TCP 20+ 字节）

2. 无拥塞控制
   - 发送方全速发送
   - 适合实时应用

3. 数据边界完整
   - 每个 UDP 数据报都是独立的
   - 不会粘包

4. 支持多播/广播
   - 可以一对多发送
   - TCP 不支持
```

### 缺点

```
1. 不可靠
   - 可能丢包
   - 可能乱序
   - 可能重复

2. 无流量控制
   - 发送方可能超过接收方处理能力

3. 无拥塞控制
   - 可能加剧网络拥塞

4. 传输距离有限
   - 适用于局域网或低延迟网络
```

## UDP 的应用场景

### 1. DNS 查询

```
DNS 查询特点：
- 请求和响应通常一个包就能完成
- 丢包了客户端会重试
- 实时性比可靠性更重要

DNS 查询：
客户端 ──── UDP (DNS 查询) ────────────────> DNS 服务器
客户端 <─── UDP (DNS 响应) ──────────────── DNS 服务器

TCP 作为备选：
- 响应数据太大（超过 512 字节）
- 区域传输（Zone Transfer）
```

### 2. 视频流/直播

```
视频流特点：
- 容忍少量丢包
- 实时性 > 可靠性
- 丢了当前帧，用户可能感觉不到

解决方案：
- 前向纠错（FEC）：发送冗余数据，恢复丢失的包
- 丢包隐藏：丢弃帧不重传，播放下一个关键帧
- 应用层重传：选择性重传关键数据
```

### 3. VoIP 语音通话

```
语音通话特点：
- 实时性要求极高（< 150ms 延迟）
- 少量丢包可以容忍
- 重传反而增加延迟

解决方案：
- 使用 UDP 减少延迟
- 抖动缓冲（Jitter Buffer）：临时存储数据，补偿延迟变化
- FEC：发送冗余音频数据
- PLC（Packet Loss Concealment）：丢包填充
```

### 4. 在线游戏

```
游戏特点：
- 高频率状态同步
- 延迟是致命的
- 少量丢包可以容忍

解决方案：
- UDP 发送位置/状态更新
- 客户端预测：假设继续当前状态
- 服务器校正：如果预测错误，发送正确状态
- 帧同步 vs 状态同步：帧同步对网络要求更高
```

### 5. DHCP

```
DHCP 特点：
- 客户端刚接入网络，不知道 IP
- 需要自动获取 IP 地址
- UDP 广播可以发现服务器

DHCP 过程：
客户端 ──── UDP (广播 Discover) ──────────> 服务器
客户端 <─── UDP (广播 Offer) ──────────── 服务器
客户端 ──── UDP (广播 Request) ───────────> 服务器
客户端 <─── UDP (广播 ACK) ────────────── 服务器
```

### 6. SNMP（网络管理）

```
SNMP 特点：
- 监控网络设备状态
- 周期性轮询
- 少量丢包不影响整体监控
```

## Java 中的 UDP 编程

### 发送端

```java
import java.net.*;
import java.io.*;

public class UDPSender {
    public static void main(String[] args) {
        String host = "127.0.0.1";
        int port = 8888;

        try (DatagramSocket socket = new DatagramSocket()) {
            // 设置超时（可选）
            socket.setSoTimeout(5000);

            // 要发送的数据
            String message = "Hello, UDP Server!";
            byte[] data = message.getBytes();

            // 目标地址
            InetAddress address = InetAddress.getByName(host);

            // 构造数据包
            DatagramPacket packet = new DatagramPacket(
                data, data.length, address, port);

            // 发送
            socket.send(packet);
            System.out.println("已发送: " + message);

            // 等待响应
            byte[] buffer = new byte[1024];
            DatagramPacket response = new DatagramPacket(
                buffer, buffer.length);
            socket.receive(response);

            String received = new String(
                response.getData(), 0, response.getLength());
            System.out.println("收到响应: " + received);

        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
```

### 接收端

```java
import java.net.*;
import java.io.*;

public class UDPServer {
    public static void main(String[] args) {
        int port = 8888;

        try (DatagramSocket socket = new DatagramSocket(port)) {
            System.out.println("UDP 服务器启动，监听端口: " + port);

            while (true) {
                // 准备接收数据
                byte[] buffer = new byte[1024];
                DatagramPacket packet = new DatagramPacket(
                    buffer, buffer.length);

                // 接收数据（阻塞）
                socket.receive(packet);
                System.out.println("收到数据，长度: " + packet.getLength());

                // 解析数据
                String message = new String(
                    packet.getData(), 0, packet.getLength());
                System.out.println("来自: " +
                    packet.getAddress().getHostAddress() + ":" +
                    packet.getPort() +
                    "，内容: " + message);

                // 发送响应
                String response = "ACK: " + message;
                byte[] responseData = response.getBytes();
                DatagramPacket responsePacket = new DatagramPacket(
                    responseData, responseData.length,
                    packet.getAddress(), packet.getPort());
                socket.send(responsePacket);
            }

        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
```

## UDP 广播

UDP 支持广播，可以向局域网内的所有设备发送数据：

```java
public class UDPBroadcast {
    public static void main(String[] args) {
        try (DatagramSocket socket = new DatagramSocket()) {
            // 允许广播
            socket.setBroadcast(true);

            String message = "Discovery request";
            byte[] data = message.getBytes();

            // 广播地址：255.255.255.255
            InetAddress broadcastAddress =
                InetAddress.getByName("255.255.255.255");

            DatagramPacket packet = new DatagramPacket(
                data, data.length, broadcastAddress, 9999);

            socket.send(packet);
            System.out.println("广播已发送");

        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
```

## UDP 的校验和计算

UDP 校验和是可选的（IPv4），但 IPv6 必须使用。

```java
import java.nio.ByteBuffer;

public class UdpChecksum {
    public static void main(String[] args) {
        // 构造伪首部 + UDP 头部 + 数据
        ByteBuffer buffer = ByteBuffer.allocate(28);
        buffer.put(InetAddress.getByName("192.168.1.1").getAddress()); // 源 IP
        buffer.put(InetAddress.getByName("192.168.1.255").getAddress()); // 目的 IP
        buffer.put((byte) 0);                    // 保留
        buffer.put((byte) 17);                    // 协议号 (UDP)
        buffer.putShort((short) 12);              // UDP 长度
        buffer.putShort((short) 0);               // 源端口
        buffer.putShort((short) 53);              // 目的端口
        buffer.putShort((short) 8);               // 长度
        buffer.putShort((short) 0);               // 校验和（待计算）
        buffer.put("hello".getBytes());            // 数据

        // 计算校验和
        int checksum = computeChecksum(buffer.array());
        System.out.println("校验和: " + Integer.toHexString(checksum));
    }

    public static int computeChecksum(byte[] data) {
        int sum = 0;
        for (int i = 0; i < data.length - 1; i += 2) {
            sum += ((data[i] << 8) & 0xFF00) | (data[i + 1] & 0xFF);
        }
        if ((data.length & 0x01) == 1) {
            sum += (data[data.length - 1] << 8) & 0xFF00;
        }
        while ((sum >> 16) != 0) {
            sum = (sum & 0xFFFF) + (sum >> 16);
        }
        return ~sum & 0xFFFF;
    }
}
```

## UDP vs TCP 选择指南

```
┌─────────────────────────────────────────────────────────────┐
│                    选择决策树                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  数据必须到达？                                               │
│      │                                                      │
│      ├─ 是 ──> 数据顺序重要？                                │
│      │              │                                       │
│      │              ├─ 是 ──> TCP                           │
│      │              │                                       │
│      │              └─ 否 ──> UDP + 应用层确认               │
│      │                                                      │
│      └─ 否 ──> 实时性要求高？                               │
│                    │                                       │
│                    ├─ 是 ──> UDP                            │
│                    │                                       │
│                    └─ 否 ──> 两者皆可                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 面试追问方向

- UDP 报文结构是怎样的？为什么这么设计？
- UDP 和 TCP 的本质区别是什么？
- UDP 的校验和是如何计算的？
- 什么场景适合用 UDP？
- UDP 如何实现可靠性？
- 为什么 DNS 默认用 UDP？
- 什么是伪首部？为什么要加伪首部？
- UDP 支持广播吗？TCP 支持吗？
- UDP 的最大数据包大小是多少？
- UDP 有粘包问题吗？为什么？
