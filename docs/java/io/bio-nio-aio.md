# BIO、NIO、AIO：一场同步与异步的世纪之战

写 Java 网络代码，你一定绕不开这三个概念：BIO、NIO、AIO。

面试必问，项目必用，但你真的搞清楚它们的区别了吗？

很多人在简历上写「精通 NIO」，结果面试官一问：

> "NIO 是同步还是异步？"

就卡住了。

今天，我们把这个坑彻底填上。

---

## 先厘清两个维度：同步 vs 异步，阻塞 vs 非阻塞

在进入正题之前，必须先把这四个概念搞清楚。

**同步 vs 异步**：谁来等数据？

- **同步**：进程自己动手——问内核"数据好了没"，或者干等着。
- **异步**：进程当甩手掌柜——告诉内核"你搞定叫我"，然后继续摸鱼。

**阻塞 vs 非阻塞**：进程在等什么？

- **阻塞**：进程被挂起，CPU 时间片都不给你，睡觉去。
- **非阻塞**：进程继续执行，内核说"没好"，返回个错误码让你重试。

这两个维度可以自由组合：

- **同步阻塞**：老老实实等着，阻塞 IO
- **同步非阻塞**：自己轮询问，内核说没好就返回
- **异步阻塞**：这个组合很少见，等通知但进程还是挂起
- **异步非阻塞**：内核全包了，完成后通知进程

---

## BIO：最老实的方式

### 什么是 BIO？

Blocking IO，同步阻塞 IO。

**每个连接一个线程**——客户端连上来，服务器就新建一个线程专门伺候它。

```java
public class BioServer {
    public static void main(String[] args) throws IOException {
        ServerSocket serverSocket = new ServerSocket(8080);
        System.out.println("服务器启动，监听端口 8080...");

        while (true) {
            // 阻塞：等待客户端连接
            Socket socket = serverSocket.accept();
            // 客户端连上了，为它分配一个线程
            new Thread(() -> {
                try {
                    // 阻塞：等待客户端发数据
                    InputStream in = socket.getInputStream();
                    byte[] buf = new byte[1024];
                    int len = in.read(buf);  // 阻塞

                    // 处理数据...
                    String request = new String(buf, 0, len);
                    System.out.println("收到：" + request);

                    // 响应
                    socket.getOutputStream().write("Hello".getBytes());
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }).start();
        }
    }
}
```

### BIO 的特点

**优点**：
- 编程模型简单，逻辑清晰
- 每个连接互不干扰，一个挂了不影响其他
- 适合连接数少、数据传输量大的场景

**缺点**：
- 线程开销大——每个连接一个线程，10000 个连接就是 10000 个线程
- 线程栈占用内存——默认 1MB，1 万线程 = 10GB 内存
- 上下文切换开销——线程切换需要保存/恢复寄存器、切换内核态

**适用场景**：
- 小型系统，连接数固定且有限
- 传统的企业内部系统
- 数据库连接池（JDBC 操作）

---

## NIO：单兵作战的高手

### 什么是 NIO？

New IO / Non-blocking IO，同步非阻塞 IO。

核心思想：**一个线程处理多个连接**。

怎么做到的？靠三个组件：
- **Channel**：通道，类似流但可以异步读写
- **Buffer**：缓冲区，数据先放这里
- **Selector**：选择器，监听多个 Channel 的事件

```java
public class NioServer {
    public static void main(String[] args) throws IOException {
        ServerSocketChannel serverChannel = ServerSocketChannel.open();
        serverChannel.socket().bind(new InetSocketAddress(8080));
        // 设置为非阻塞模式
        serverChannel.configureBlocking(false);

        Selector selector = Selector.open();
        // 注册监听 accept 事件
        serverChannel.register(selector, SelectionKey.OP_ACCEPT);

        System.out.println("服务器启动，监听端口 8080...");

        while (true) {
            // 阻塞：等待就绪的 Channel
            selector.select();

            // 获取所有就绪的事件
            Set&lt;SelectionKey&gt; keys = selector.selectedKeys();
            Iterator&lt;SelectionKey&gt; it = keys.iterator();

            while (it.hasNext()) {
                SelectionKey key = it.next();
                it.remove();

                if (key.isAcceptable()) {
                    // 有新的连接
                    ServerSocketChannel server = (ServerSocketChannel) key.channel();
                    SocketChannel client = server.accept();
                    client.configureBlocking(false);
                    // 注册监听 read 事件
                    client.register(selector, SelectionKey.OP_READ);
                    System.out.println("新连接：" + client);
                } else if (key.isReadable()) {
                    // 有数据可读
                    SocketChannel client = (SocketChannel) key.channel();
                    ByteBuffer buf = ByteBuffer.allocate(1024);
                    int len = client.read(buf);
                    if (len > 0) {
                        buf.flip();
                        String request = new String(buf.array(), 0, buf.limit());
                        System.out.println("收到：" + request);
                        // 响应
                        client.write(ByteBuffer.wrap("Hello".getBytes()));
                    }
                }
            }
        }
    }
}
```

### NIO 的特点

**优点**：
- 单线程处理多个连接，资源占用少
- 适合连接数多、但每个连接数据量不大的场景
- 非阻塞 IO，不用等待

**缺点**：
- 编程复杂度高——需要处理半包、粘包、心跳等
- 调试困难——异步流程，不连贯
- 代码量大——相比 BIO，需要写更多底层逻辑

**适用场景**：
- 高并发短连接服务（如聊天服务器、推送服务）
- RPC 框架底层
- 网络游戏服务器

---

## AIO：真正的异步王者

### 什么是 AIO？

Asynchronous IO，异步非阻塞 IO。

JDK 7 引入，也叫 NIO.2。

核心思想：**你告诉我要干啥，干完了叫我**。全程不阻塞。

```java
public class AioServer {
    public static void main(String[] args) throws Exception {
        AsynchronousServerSocketChannel serverChannel =
            AsynchronousServerSocketChannel.open().bind(new InetSocketAddress(8080));

        System.out.println("服务器启动，监听端口 8080...");

        // 注册一个回调：有客户端连接时，自动调用这个 handler
        serverChannel.accept(null, new CompletionHandler&lt;AsynchronousSocketChannel, Object&gt;() {
            @Override
            public void completed(AsynchronousSocketChannel client, Object attachment) {
                // 继续接受下一个连接
                serverChannel.accept(null, this);

                // 异步读取数据
                ByteBuffer buf = ByteBuffer.allocate(1024);
                client.read(buf, null, new CompletionHandler&lt;Integer, Object&gt;() {
                    @Override
                    public void completed(Integer len, Object attachment) {
                        if (len > 0) {
                            buf.flip();
                            String request = new String(buf.array(), 0, buf.limit());
                            System.out.println("收到：" + request);
                            // 响应
                            client.write(ByteBuffer.wrap("Hello".getBytes()));
                        }
                    }

                    @Override
                    public void failed(Throwable exc, Object attachment) {
                        exc.printStackTrace();
                    }
                });
            }

            @Override
            public void failed(Throwable exc, Object attachment) {
                exc.printStackTrace();
            }
        });

        // 主线程不能退出，否则整个程序就结束了
        Thread.sleep(Long.MAX_VALUE);
    }
}
```

### AIO 的特点

**优点**：
- 真正的异步——数据完全就绪后，才通知进程
- 编程模型比 NIO 简单——不用自己处理就绪状态
- 适合高并发、IO 密集型场景

**缺点**：
- Windows 支持较好（IOCP），Linux 下实现不成熟（JDK 7 的 AIO 底层用的是 epoll，性能优势不明显）
- 生态不如 NIO 成熟——很多框架还是基于 NIO
- 异常处理复杂——回调地狱

**适用场景**：
- Windows 高性能服务器
- 需要高性能异步 IO 的场景
- JDK 8+ Linux 环境下，可作为 NIO 的补充

---

## 三种模型对比

| 特性 | BIO | NIO | AIO |
|-----|-----|-----|-----|
| 全称 | Blocking IO | New IO / Non-blocking IO | Asynchronous IO |
| 同步/异步 | 同步 | 同步 | 异步 |
| 阻塞/非阻塞 | 阻塞 | 非阻塞 | 非阻塞 |
| 线程模型 | Thread per Request | Reactor | Proactor |
| 连接数 | 低（1:1 线程） | 高（1:N 线程） | 高 |
| 复杂度 | 低 | 高 | 中 |
| JDK 版本 | 1.0 | 1.4 | 1.7 |
| 适用场景 | 低并发、业务逻辑复杂 | 高并发、IO 密集 | 高性能异步场景 |

---

## 如何选择？一句话总结

> **BIO 是一对一的服务员，NIO 是一个服务员盯 100 桌，AIO 是扫码点餐后坐着等叫号。**

**选 BIO 的场景**：
- Tomcat 7 默认模式
- 连接数可控（几百到几千）
- 业务逻辑复杂，需要阻塞等待

**选 NIO 的场景**：
- Tomcat 8+ 默认模式
- 连接数上万
- Netty、gRPC、RocketMQ 等高性能框架的底层

**选 AIO 的场景**：
- Windows 高性能场景
- 确实需要极致异步化的场景
- JDK 7+ Linux（性能优势有限）

---

## 面试追问方向

### 追问一：Tomcat 为什么从 BIO 改成 NIO？

Tomcat 3/4/5 默认是 BIO（被称为「Standard blocking connector」）。

但随着互联网发展，并发量越来越大，BIO 的线程瓶颈暴露出来：

- 1 万连接 = 1 万线程 = 10GB+ 内存
- 线程上下文切换开销巨大

Tomcat 6 引入了 NIO connector（APR 模式），Tomcat 8+ 直接默认 NIO。

---

### 追问二：为什么大多数框架还是选择 NIO 而不是 AIO？

核心原因：**Linux AIO 不成熟**。

Windows 的 IOCP（IO Completion Ports）是真正的异步 IO，性能很强。

但 Linux AIO（JDK 7 NIO.2 底层实现）：
- 早期只支持文件 IO，不支持网络 IO
- 后来的 epoll-based 实现，与 NIO 性能差异不大
- API 复杂，回调地狱

所以 Linux 环境下，NIO + epoll 依然是主流。

---

### 追问三：Netty 用的是哪种模型？

Netty 基于 NIO（Java Selector）。

但它有自己的线程模型——**主从 Reactor 多线程模型**：

- Boss Group：处理连接请求（类似 acceptor）
- Worker Group：处理读写 IO（多个 eventLoop 并行）

后面讲到 [Netty 线程模型](/java/io/netty) 会详细展开。

---

### 追问四：NIO 有没有可能比 BIO 慢？

有可能。

如果你的场景是：
- 连接数少（< 100）
- 每个连接数据传输量大
- 需要阻塞等待的业务逻辑

那么 BIO 的简单模型反而更快——NIO 的 selector 轮询、空闲连接处理，都会带来额外开销。

**没有银弹，只有合适的场景。**

---

## 留给你的思考题

NIO 的 Selector 让我们可以单线程处理大量连接。

但你有没有想过：**如果某个 Channel 的数据处理很耗时，会发生什么？**

答案是：所有其他 Channel 都在等这一个 Channel 处理完。

这在 NIO 里叫做「**阻塞Handler**」问题。

解决这个问题，有哪些思路？

> 提示：线程池、EventLoop 分组、FastThreadLocal……Netty 是怎么解决的？
