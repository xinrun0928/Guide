# WebSocket：全双工通信原理

你有没有想过：网页上为什么能收到实时推送？

传统的 HTTP 是「请求-响应」模式：客户端发请求，服务器返回响应，然后连接关闭。

但有些场景需要**服务器主动发消息**给客户端：股票行情、聊天消息、游戏状态、在线协作...

这就是 **WebSocket** 的用武之地。

## HTTP 的局限性

### 请求-响应模式

```
HTTP 请求流程：

客户端 ──── GET /data ─────────────────────────> 服务器
客户端 <─── 200 OK {data} ────────────────────── 服务器

问题：
- 只有客户端能发起请求
- 服务器有新数据，只能等客户端下次请求
```

### 轮询的问题

```
轮询（P polling）：
客户端 ──── GET /data ────> 服务器（无新数据）
客户端 <─── 200 OK ─────── 服务器

客户端 ──── GET /data ────> 服务器（无新数据）
客户端 <─── 200 OK ─────── 服务器

客户端 ──── GET /data ────> 服务器（新数据！）
客户端 <─── 200 OK {data} ─────── 服务器

问题：
- 延迟：最多等待一个轮询间隔
- 浪费：大部分请求都是空的
- 频繁：占用服务器资源
```

## WebSocket 是什么？

WebSocket 是一种**全双工**通信协议，允许服务器主动向客户端推送数据。

```
HTTP：只能客户端发请求
WebSocket：客户端和服务器都能随时发消息
```

### 与 HTTP 的对比

```
┌─────────────────────────────────────────────────────────────┐
│                    HTTP vs WebSocket                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  HTTP：                                                     │
│  客户端 ──── 请求 ─────────────> 服务器                    │
│  客户端 <─── 响应 ───────────── 服务器                      │
│                                                             │
│  WebSocket：                                                │
│  客户端 ◄─── 推送 ───────────── 服务器（主动）              │
│  客户端 ──── 推送 ────────────► 服务器（主动）              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## WebSocket 连接过程

### 握手：HTTP 升级

WebSocket 始于 HTTP，通过「协议升级」变成 WebSocket：

```
┌─────────────────────────────────────────────────────────────┐
│                    WebSocket 握手                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 客户端发送 HTTP 请求（升级协议）                        │
│                                                             │
│  GET /ws HTTP/1.1                                        │
│  Host: example.com                                         │
│  Upgrade: websocket                                       │
│  Connection: Upgrade                                       │
│  Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==              │
│  Sec-WebSocket-Version: 13                                │
│                                                             │
│  2. 服务器确认升级                                          │
│                                                             │
│  HTTP/1.1 101 Switching Protocols                         │
│  Upgrade: websocket                                       │
│  Connection: Upgrade                                      │
│  Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYG3hQbZ4rS8=        │
│                                                             │
│  3. 握手完成，连接变成 WebSocket                           │
│                                                             │
│  客户端 ◄──── 双向通信 ───────► 服务器                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Sec-WebSocket-Key 的作用

```
客户端生成随机字符串（Base64 编码）
服务端用固定字符串 + 这个 key，生成 hash
服务端返回 hash，客户端验证

目的：防止意外升级 WebSocket
```

## WebSocket 帧结构

### 帧格式

```
┌─────────────────────────────────────────────────────────────┐
│                    WebSocket 帧                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┬──────────┬──────────┬───────────────┐     │
│  │ FIN(1)  │ RSV1-3(3)│ Opcode   │               │     │
│  ├──────────┴──────────┴──────────┴───────────────┤     │
│  │ MASK(1) │            Payload Len (7/7+16/64)      │     │
│  ├──────────┴───────────────────────────────────────┤     │
│  │                   Masking-Key (0/32)              │     │
│  ├───────────────────────────────────────────────────┤     │
│  │                   Payload Data                     │     │
│  └───────────────────────────────────────────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 关键字段

```
FIN (1 bit)：
- 1 = 这是消息的最后一个帧
- 0 = 还有后续帧

Opcode (4 bits)：
- 0x0：延续帧
- 0x1：文本帧
- 0x2：二进制帧
- 0x8：关闭连接
- 0x9：Ping
- 0xA：Pong

MASK (1 bit)：
- 1 = 数据被掩码（客户端发送）
- 0 = 数据未掩码（服务器发送）

Payload Length：
- 0-125：直接表示长度
- 126：后 16 位表示长度
- 127：后 64 位表示长度
```

## JavaScript 客户端

### 基本用法

```javascript
// 创建 WebSocket 连接
const ws = new WebSocket('wss://example.com/ws');

// 连接打开
ws.onopen = function() {
    console.log('连接已建立');
    // 发送消息
    ws.send('Hello Server!');
};

// 收到消息
ws.onmessage = function(event) {
    console.log('收到消息:', event.data);
    // event.data 是字符串或 Blob/ArrayBuffer
};

// 连接关闭
ws.onclose = function(event) {
    console.log('连接已关闭', event.code, event.reason);
};

// 发生错误
ws.onerror = function(error) {
    console.error('WebSocket 错误:', error);
};
```

### 发送不同类型数据

```javascript
// 发送文本
ws.send(JSON.stringify({ type: 'message', content: 'Hello' }));

// 发送二进制
const buffer = new ArrayBuffer(8);
const view = new DataView(buffer);
view.setFloat64(0, 3.14159);
ws.send(buffer);

// 发送 JSON
const data = { user: '张三', message: '你好' };
ws.send(JSON.stringify(data));
```

### 心跳保活

```javascript
const ws = new WebSocket('wss://example.com/ws');
let heartbeatTimer;

// 连接成功时启动心跳
ws.onopen = function() {
    heartbeatTimer = setInterval(function() {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
        }
    }, 30000);
};

// 收到 Pong
ws.onmessage = function(event) {
    const data = JSON.parse(event.data);
    if (data.type === 'pong') {
        console.log('服务器存活');
    }
};

// 关闭时清除心跳
ws.onclose = function() {
    clearInterval(heartbeatTimer);
};
```

## Java 服务端

### 使用 Spring WebSocket

```java
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.context.annotation.Configuration;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(myHandler(), "/ws")
                .setAllowedOrigins("*");
    }

    @Bean
    public WebSocketHandler myHandler() {
        return new MyWebSocketHandler();
    }
}

@Component
public class MyWebSocketHandler extends TextWebSocketHandler {

    // 在线用户列表
    private final CopyOnWriteArrayList<WebSocketSession> sessions =
        new CopyOnWriteArrayList<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.add(session);
        System.out.println("用户连接: " + session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session,
                                    TextMessage message) {
        // 处理收到的消息
        String payload = message.getPayload();
        System.out.println("收到消息: " + payload);

        // 广播给所有用户
        for (WebSocketSession s : sessions) {
            try {
                s.sendMessage(new TextMessage("广播: " + payload));
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session,
                                     CloseStatus status) {
        sessions.remove(session);
        System.out.println("用户断开: " + session.getId());
    }
}
```

### 使用 Netty

```java
import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.*;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.codec.http.*;
import io.netty.handler.codec.http.websocketx.*;

public class WebSocketServer {
    public static void main(String[] args) throws Exception {
        EventLoopGroup bossGroup = new NioEventLoopGroup(1);
        EventLoopGroup workerGroup = new NioEventLoopGroup();

        ServerBootstrap bootstrap = new ServerBootstrap();
        bootstrap.group(bossGroup, workerGroup)
            .channel(NioServerSocketChannel.class)
            .childHandler(new ChannelInitializer<SocketChannel>() {
                @Override
                protected void initChannel(SocketChannel ch) {
                    ChannelPipeline pipeline = ch.pipeline();
                    pipeline.addLast(new HttpServerCodec());
                    pipeline.addLast(new HttpObjectAggregator(65536));
                    pipeline.addLast(new WebSocketServerProtocolHandler("/ws"));
                    pipeline.addLast(new TextWebSocketFrameHandler());
                }
            });

        ChannelFuture f = bootstrap.bind(8080).sync();
        System.out.println("WebSocket 服务器启动");
        f.channel().closeFuture().sync();
    }

    static class TextWebSocketFrameHandler
            extends SimpleChannelInboundHandler<TextWebSocketFrame> {
        @Override
        protected void channelRead0(ChannelHandlerContext ctx,
                                    TextWebSocketFrame msg) {
            System.out.println("收到: " + msg.text());
            // 广播消息
            ctx.channel().writeAndFlush(
                new TextWebSocketFrame("收到: " + msg.text()));
        }
    }
}
```

## WebSocket 与 HTTP/2 对比

### WebSocket 特点

```
优点：
- 全双工通信
- 连接建立后无需重连
- 服务器主动推送
- 数据开销小（帧格式简单）

缺点：
- 需要特殊服务器
- 不支持 HTTP/2 多路复用
- 负载均衡复杂
```

### HTTP/2 Server Push

```
HTTP/2 也有服务器推送：
- 只能在同一个 TCP 连接上
- 需要浏览器发起请求
- 用于推送资源（CSS/JS/图片）

不如 WebSocket 灵活
```

### 选择建议

```
适合用 WebSocket：
- 聊天应用
- 实时协作（如在线文档）
- 游戏
- 实时监控
- 股票/外汇行情

适合用 HTTP/2 Server Push：
- 资源预加载
- 服务端渲染的页面
- 不需要双向通信的场景
```

## 常见问题

### 如何通过代理？

```
问题：Nginx/代理可能不支持 WebSocket

解决：配置代理支持 WebSocket
```

```nginx
location /ws {
    proxy_pass http://backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;
}
```

### 如何处理断线？

```javascript
const ws = new WebSocket('wss://example.com/ws');

// 断线重连
ws.onclose = function() {
    console.log('连接断开，5秒后重连...');
    setTimeout(function() {
        ws = new WebSocket('wss://example.com/ws');
    }, 5000);
};

// 自动重连（带最大重试）
```

### 如何保证消息可靠性？

```
WebSocket 不保证消息可靠性：
- 连接断开时消息可能丢失

解决：
1. 应用层确认机制
2. 消息队列
3. 重发机制
```

## 安全考虑

### WSS（WebSocket Secure）

```
ws:// → wss://
使用 TLS 加密

原因：
1. 防止中间人攻击
2. 防止内容被篡改
```

### 鉴权

```javascript
// 方式 1：URL 参数
const ws = new WebSocket('wss://example.com/ws?token=xxx');

// 方式 2：握手后立即认证
ws.onopen = function() {
    ws.send(JSON.stringify({ type: 'auth', token: 'xxx' }));
};
```

### 防止攻击

```
常见攻击：
1. WebSocket 劫持（CSWSH）
   防范：验证 Origin 头

2. 内存耗尽
   防范：限制消息大小

3. 恶意输入
   防范：输入验证
```

## 面试追问方向

- WebSocket 和 HTTP 的区别是什么？
- WebSocket 握手的原理是什么？
- Sec-WebSocket-Key 的作用是什么？
- WebSocket 帧结构是怎样的？
- 如何实现心跳保活？
- WebSocket 断开后如何重连？
- WebSocket 如何通过 Nginx 代理？
- WebSocket 和 HTTP/2 Server Push 有什么区别？
- WebSocket 如何保证安全性？
- 如何处理 WebSocket 消息的可靠性？
