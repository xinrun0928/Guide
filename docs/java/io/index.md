# Java I/O 与网络

I/O（输入/输出）和网络编程，是 Java 连接外部世界的桥梁。

从最底层的 Socket 通信，到经典的 BIO/NIO/AIO 模型，到高性能网络框架 Netty，再到 Tomcat 的线程模型——每一步都值得深入理解。这一模块，带你从操作系统层面理解 Java 的 I/O 机制。

---

## 模块内容

### IO 模型

理解 I/O 模型，是理解 NIO、Netty、Tomcat 的基础。

- [IO 模型：阻塞 IO vs 非阻塞 IO vs IO 多路复用 vs 异步 IO](/java/io/io-model)：★ 五种 IO 模型图解、select/poll/epoll 的区别

### 编程模型演进

Java I/O 经历了从 BIO 到 NIO 再到 AIO 的演进。

- [BIO、NIO、AIO 编程模型对比](/java/io/bio-nio-aio)：三种模型的代码写法、性能特征对比表

### NIO 核心

NIO（New I/O）是高性能网络编程的基础。

- [NIO 核心组件：Channel、Buffer、Selector](/java/io/nio-core)：Channel 的四种类型、Buffer 三大属性、Selector 事件驱动
- [ByteBuffer 分类与使用陷阱](/java/io/bytebuffer)：allocate vs allocateDirect、flip()/clear()/compact()、常见 Buffer 异常
- [直接内存（Direct Buffer）优势与限制](/java/io/direct-buffer)：零拷贝、堆外内存、PooledByteBufAllocator

### 主流框架

- [Netty 核心组件与线程模型](/java/io/netty)：EventLoop / ChannelHandler / ChannelPipeline、ByteBuf、半包粘包处理
- [Tomcat 线程模型与 NIO 处理](/java/io/tomcat)：Connector 组件、BossGroup/WorkerGroup、NIO/APR Endpoint

### 网络通信

- [Socket 通信与三次握手](/java/io/socket)：TCP 三次握手 / 四次挥手、TIME_WAIT、Socket 参数调优

---

## 面试核心考点

| 高频考点 | 关联文档 |
|---|---|
| select/poll/epoll 区别 | [IO 模型](/java/io/io-model) |
| NIO 三大组件 | [NIO 核心](/java/io/nio-core) |
| ByteBuffer 使用 | [ByteBuffer](/java/io/bytebuffer) |
| Netty 线程模型 | [Netty](/java/io/netty) |
| Tomcat NIO | [Tomcat](/java/io/tomcat) |
| TCP 三次握手四次挥手 | [Socket](/java/io/socket) |
