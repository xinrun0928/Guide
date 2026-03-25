# Netty 核心组件与线程模型

你在简历上写了「精通 Netty」。

面试官问：用 Netty 实现一个聊天室，后端需要几个线程？它们分别干什么？

你：...

这个图你能画出来吗？

如果不能，今天这篇文章就是为你准备的。

---

## Netty 是什么？

Netty 是一个**基于 NIO 的高性能网络应用框架**，由 JBOSS 于 2004 年开源。

- JDK 原生 NIO 的复杂度让很多人望而却步
- 直接使用 NIO 实现一个聊天室，光是处理半包粘包就够喝一壶的
- Netty 封装了这些细节，让你专注于业务逻辑

```
JDK NIO          Netty
┌────────┐      ┌────────┐
│ 繁琐的 │      │ 简洁的 │
│ Selector│ ──→ │  Channel│
│  零拷贝 │      │  Pipeline│
│  半包粘包│      │  ByteBuf│
└────────┘      └────────┘
```

Netty 被广泛应用于：
- RPC 框架：Dubbo、gRPC
- 消息队列：RocketMQ
- 游戏服务器：很多 MMORPG 后端
- HTTP 服务器：Netty 自带 HTTP 编解码器

---

## 核心组件

### Channel：网络操作的抽象

Channel 是 Java NIO 的升级版，代表**网络操作的抽象**。

```java
// JDK NIO：SocketChannel
SocketChannel channel = SocketChannel.open();
channel.connect(new InetSocketAddress("localhost", 8080));

// Netty：Channel
Channel ch = ...;
ch.write(msg);       // 异步写
ch.flush();          // 刷新发送
ch.close();          // 关闭连接
```

**Channel 提供的方法**：

```java
ch.write(msg);              // 异步写
ch.flush();                 // 刷新，立即发送
ch.writeAndFlush(msg);      // 写并刷新
ch.close();                 // 关闭连接
ch.connect(endpoint);       // 连接
ch.bind(localAddress);      // 绑定地址
ch.read();                  // 触发读事件
```

### EventLoop：处理 IO 事件

EventLoop 是 Netty 的线程模型核心，每个 EventLoop 绑定一个线程，持续处理 IO 事件。

```java
// EventLoop 处理读写
public class MyChannelHandler extends ChannelInboundHandlerAdapter {
    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) {
        // 每条消息在这里处理，由 EventLoop 线程执行
        ByteBuf buf = (ByteBuf) msg;
        System.out.println(buf.toString(StandardCharsets.UTF_8));
    }
}
```

EventLoop 是单线程的，一个 EventLoop 可以绑定多个 Channel（共享同一个线程）。

### EventLoopGroup：一组 EventLoop

EventLoopGroup 是多个 EventLoop 的集合。

```java
// 创建两个 EventLoopGroup
EventLoopGroup bossGroup = new NioEventLoopGroup(1);     // 1 个线程处理连接
EventLoopGroup workerGroup = new NioEventLoopGroup();    // 默认 CPU*2 个线程处理读写
```

### ChannelHandler：处理 IO 事件

ChannelHandler 是业务逻辑的核心，负责处理入站和出站事件。

```java
// 入站处理器：处理读事件
public class MyInboundHandler extends ChannelInboundHandlerAdapter {
    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) {
        // 处理读取的数据
        ByteBuf buf = (ByteBuf) msg;
        System.out.println(buf.toString(StandardCharsets.UTF_8));
        // 继续传递给下一个处理器
        ctx.fireChannelRead(buf);
    }
}

// 出站处理器：处理写事件
public class MyOutboundHandler extends ChannelOutboundHandlerAdapter {
    @Override
    public void write(ChannelHandlerContext ctx, Object msg, ChannelPromise promise) {
        // 处理写操作
        ctx.write(msg, promise);
    }
}
```

### ChannelPipeline：处理链

ChannelPipeline 是一个双向链表，装着各种 ChannelHandler 来处理入站和出站数据。

```
InboundHandler1 → InboundHandler2 → InboundHandler3
       ↑                                  ↓
       └────── OutboundHandler3 ←──────┘
                      ↑
       OutboundHandler2 ←──── OutboundHandler1
```

入站事件按顺序执行每个 InboundHandler，出站事件反向执行每个 OutboundHandler。

### ChannelFuture：异步操作结果

Netty 的所有 IO 操作都是异步的，返回的 ChannelFuture 用来获取操作结果。

```java
Channel ch = ...;
ChannelFuture future = ch.writeAndFlush(msg);

// 添加监听器
future.addListener((ChannelFutureListener) f -> {
    if (f.isSuccess()) {
        System.out.println("发送成功");
    } else {
        System.out.println("发送失败：" + f.cause());
    }
});
```

---

## ByteBuf：Netty 的缓冲区

JDK 的 ByteBuffer 有很多限制，Netty 重新实现了一个更强大的 ByteBuf。

### ByteBuf vs ByteBuffer

| 特性 | JDK ByteBuffer | Netty ByteBuf |
|-----|---------------|---------------|
| 索引 | 只有一个 position | 分开 readerIndex 和 writerIndex |
| 模式 | 需要 flip() 切换 | 不需要，读写分开 |
| 容量 | 固定 | 可自动扩容 |
| 引用计数 | 无 | 有，支持对象池化 |
| 零拷贝 | 不支持 | 支持 slice、duplicate、CompositeByteBuf |

### ByteBuf 基本使用

```java
ByteBuf buf = UnpooledByteBufAllocator.DEFAULT.buffer(1024);

// 写入数据
buf.writeBytes("Hello".getBytes());

// 读取数据
byte b = buf.readByte();
ByteBuf slice = buf.readSlice(5);
```

### 引用计数与释放

ByteBuf 使用引用计数来管理内存，通过 ReferenceCounted 接口实现。

```java
public class MyHandler extends ChannelInboundHandlerAdapter {
    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) {
        ByteBuf buf = (ByteBuf) msg;
        try {
            // 处理数据
            System.out.println(buf.toString(StandardCharsets.UTF_8));
        } finally {
            // 重要：必须释放，否则内存泄漏
            buf.release();
        }
    }
}
```

> **注意**：处理器收到 ByteBuf 后必须负责释放，否则会导致内存泄漏。

---

## Netty 线程模型：主从 Reactor

Netty 使用 Reactor 模式，通过 BossGroup 处理连接请求，WorkerGroup 处理读写 IO。

```
                BossGroup（NioEventLoop × 1）
                      ↓
        [ServerSocketChannel.accept()]
                      ↓
                WorkerGroup（NioEventLoop × N）
                      ↓
        [SocketChannel 的读写事件]
                      ↓
                ChannelPipeline
                      ↓
                ChannelHandler
```

### BossGroup 和 WorkerGroup

**BossGroup 负责处理新连接**，通常只用一个线程：

```java
EventLoopGroup bossGroup = new NioEventLoopGroup(1);  // 1 个线程
EventLoopGroup workerGroup = new NioEventLoopGroup();   // 默认 CPU*2 个线程
```

**WorkerGroup 处理已连接 Channel 的 IO 事件和 Handler 逻辑**。

### 完整示例

```java
public class NettyServer {
    public static void main(String[] args) throws Exception {
        EventLoopGroup bossGroup = new NioEventLoopGroup(1);
        EventLoopGroup workerGroup = new NioEventLoopGroup();

        try {
            ServerBootstrap b = new ServerBootstrap();
            b.group(bossGroup, workerGroup)
             .channel(NioServerSocketChannel.class)
             .childHandler(new ChannelInitializer<SocketChannel>() {
                 @Override
                 public void initChannel(SocketChannel ch) {
                     // 添加处理器到 Pipeline
                     ch.pipeline().addLast(new MyCodec());
                     ch.pipeline().addLast(new MyBusinessHandler());
                 }
             })
             .option(ChannelOption.SO_BACKLOG, 128)
             .childOption(ChannelOption.SO_KEEPALIVE, true);

            ChannelFuture f = b.bind(8080).sync();
            f.channel().closeFuture().sync();
        } finally {
            bossGroup.shutdownGracefully();
            workerGroup.shutdownGracefully();
        }
    }
}
```

### 线程数配置

| 场景 | BossGroup | WorkerGroup |
|-----|----------|------------|
| 简单场景 | 1 | CPU × 2 |
| 高并发短连接 | 1 | CPU × 2 或更多 |
| 连接时间长、并发大 | 1 | CPU × 2 × 请求处理时间比 |

```java
// 固定线程数
EventLoopGroup workerGroup = new NioEventLoopGroup(16);

// 根据 CPU 核心数动态调整
EventLoopGroup workerGroup = new NioEventLoopGroup(
    Math.max(1, Runtime.getRuntime().availableProcessors() * 2)
);
```

### Pipeline 和 Handler 的执行

Handler 在 WorkerGroup 的 EventLoop 线程中执行。

**如果某个 Handler 处理很慢，会阻塞其他 Channel 的处理**。

解决方案：

```java
// 方案一：使用线程池处理耗时操作
ch.pipeline().addLast(eventLoopGroup, new MyBusinessHandler());

// 方案二：ctx.fireChannelRead() 不指定线程池，会在原 EventLoop 执行
ctx.fireChannelRead(buf);

// 方案三：ctx.channel().eventLoop() 获取当前 EventLoop
ctx.channel().eventLoop().execute(() -> {
    // 在 EventLoop 中异步执行
});
```

---

## 编解码器：解决半包粘包

### 半包粘包问题

网络通信中，数据是按字节流传输的：

```
发送："Hello" + "World" + "Netty"
接收：可能收到 "HelloWorld"    （粘包）
           "Hel" + "loWorld"  （半包）
           "Hello"            （正常）
```

### Netty 的解决方案

Netty 内置了多种解码器：

```java
// 固定长度解码器
ch.pipeline().addLast(new FixedLengthFrameDecoder(100));  // 每帧固定 100 字节

// 换行符解码器
ch.pipeline().addLast(new LineBasedFrameDecoder(1024));  // 按 \n 或 \r\n 分割

// 分隔符解码器
ch.pipeline().addLast(new DelimiterBasedFrameDecoder(
    1024,
    Unpooled.copiedBuffer("&&".getBytes())
));  // 按 && 分割

// 长度域解码器（最常用）
ch.pipeline().addLast(new LengthFieldBasedFrameDecoder(
    1024,    // 最大帧长度
    0,       // 长度字段偏移量
    4,       // 长度字段长度（4字节）
    0,       // 长度字段之后要跳过的字节数
    4        // 长度字段之后要保留的字节数
));
```

### 自定义协议示例

通常自定义协议会包含：魔数、版本号、消息类型、消息长度、消息体。

```java
// 协议格式：魔数(4) + 版本(1) + 类型(1) + 长度(4) + 消息体(N)
ch.pipeline().addLast(new LengthFieldBasedFrameDecoder(1024, 4, 4, 5, 0));
ch.pipeline().addLast(new MessageDecoder());  // 自定义解码器
ch.pipeline().addLast(new MessageEncoder());   // 自定义编码器
ch.pipeline().addLast(new MyBusinessHandler());
```

---

## 面试追问方向

### 追问一：EventLoop 和线程的区别是什么？

EventLoop 本质是一个线程，但比普通线程更「专一」：

```java
// EventLoop 内部就是一个无限循环
while (!terminated) {
    // 1. 轮询就绪的 IO 事件
    // 2. 处理 IO 事件
    // 3. 处理普通任务
}
```

一个 EventLoop 可以绑定多个 Channel，共享同一个线程处理 IO。

### 追问二：Handler 之间如何传递数据？

使用 `ChannelHandlerContext` 传递：

```java
// 在 Handler 中传递数据给下一个 Handler
ctx.fireChannelRead(msg);

// 添加多个数据
ctx.channel().attr(AttributeKey.valueOf("userId")).set(userId);

// 在其他 Handler 中获取
String userId = ctx.channel().attr(AttributeKey.valueOf("userId")).get();
```

### 追问三：Netty 如何实现零拷贝？

1. **堆外内存传输**：直接内存减少 JVM 堆和系统内存之间的数据复制
2. **ByteBuf.slice()**：创建 ByteBuf 的视图，共享底层数据
3. **CompositeByteBuf**：组合多个 ByteBuf，无需拷贝
4. **FileRegion**：文件内容直接传输到 Socket

```java
// slice() 示例
ByteBuf buf = Unpooled.wrappedBuffer("HelloWorld".getBytes());
ByteBuf slice = buf.slice(0, 5);  // "Hello"，共享底层数据

// CompositeByteBuf 示例
CompositeByteBuf composite = Unpooled.compositeBuffer();
composite.addComponents(buf1, buf2, buf3);  // 无需拷贝
```

### 追问四：BossGroup 和 WorkerGroup 各分配多少线程合适？

**BossGroup**：通常 1 个线程。

因为 ServerSocketChannel 只负责 accept()，一个线程足够。

**WorkerGroup**：通常 CPU × 2 个线程。

考虑到：
- 多核 CPU 充分利用
- Handler 处理可能阻塞
- 线程切换开销

但如果业务逻辑很重（CPU 密集型），可以适当增加。

---

## 留给你的思考题

我们讲了 Netty 的核心组件和线程模型。

但还有一个问题：

**如果你的业务 Handler 需要访问数据库或调用其他服务，会发生什么？**

默认情况下，Handler 是在 EventLoop 线程中执行的。

如果 Handler 阻塞了 1 秒，所有其他 Channel 的读写都会被延迟 1 秒。

解决方案是什么？

> 提示：线程池、EventLoop 异步执行、分组隔离……
