# NIO 核心组件：Channel、Buffer、Selector

你用过 NIO，但有没有想过这三个组件是怎么配合工作的？

```
客户端发送数据 → Channel 接收 → Buffer 中转 → Selector 通知
```

缺了任何一个，NIO 都跑不起来。

今天，我们把这三个核心组件彻底拆开来看。

---

## Channel：数据的高速公路

### Channel 是什么？

Channel（通道）是连接节点和缓冲区的桥梁。

你可以把它想象成**双向八车道的高速公路**——数据可以从网卡到内存（read），也可以从内存到网卡（write）。

对比一下传统的 Stream：

| 特性 | Stream | Channel |
|-----|--------|---------|
| 方向 | 单向（InputStream/OutputStream） | 双向（既能读也能写） |
| 阻塞 | 阻塞式 | 非阻塞式 |
| 读数据 | 被动等待 | 可以异步 |
| 基础 | 无 | 基于缓冲区（Buffer） |

### 四种 Channel

```java
// 1. FileChannel：文件操作，阻塞式
FileChannel fileChannel = new FileInputStream("test.txt").getChannel();

// 2. SocketChannel：TCP 客户端连接
SocketChannel socketChannel = SocketChannel.open();
socketChannel.connect(new InetSocketAddress("localhost", 8080));

// 3. ServerSocketChannel：TCP 服务端监听
ServerSocketChannel serverChannel = ServerSocketChannel.open();
serverChannel.socket().bind(new InetSocketAddress(8080));

// 4. DatagramChannel：UDP 数据报
DatagramChannel datagramChannel = DatagramChannel.open();
datagramChannel.socket().bind(new InetSocketAddress(8080));
```

**FileChannel 特别说明**：

- 永远是阻塞式的，不支持非阻塞模式
- 支持文件锁定、内存映射（mmap）、TransferTo（零拷贝）

```java
// 文件锁，防止多进程并发写入
FileLock lock = fileChannel.lock();  // 阻塞直到获取锁
// ... 处理文件
lock.release();

// 零拷贝：直接传输到另一个 Channel
fileChannel.transferTo(position, count, destChannel);

// 内存映射：将文件直接映射到内存
MappedByteBuffer map = fileChannel.map(FileChannel.MapMode.READ_ONLY, 0, size);
```

---

## Buffer：数据的临时仓库

### Buffer 是什么？

Buffer（缓冲区）是读写数据的容器，本质上是一个**数组**。

但它不是一个普通数组——它自带「游标」，记录读写位置。

Java 提供了一系列 Buffer 实现：

```java
ByteBuffer    // 最常用，字节缓冲区
CharBuffer    // 字符缓冲区
ShortBuffer   // 短整型缓冲区
IntBuffer     // 整型缓冲区
LongBuffer    // 长整型缓冲区
FloatBuffer   // 浮点型缓冲区
DoubleBuffer  // 双精度浮点型缓冲区
MappedByteBuffer  // 内存映射文件缓冲区
```

### Buffer 的三个核心属性

```
capacity: [0 ------------------ max]
position:     ↑  (当前读写位置)
limit:        ↑  (有效数据边界)
```

- **capacity（容量）**：缓冲区的最大容量，创建后不可变
- **position（位置）**：下一个读写操作的索引
- **limit（限制）**：第一个不可读/写的元素位置

### Buffer 的创建与使用

```java
// 方式一：allocate - 在堆内存创建（常用）
ByteBuffer heapBuffer = ByteBuffer.allocate(1024);

// 方式二：allocateDirect - 直接内存（堆外）
ByteBuffer directBuffer = ByteBuffer.allocateDirect(1024);

// 方式三：wrap - 包装已有数组
byte[] array = new byte[1024];
ByteBuffer wrappedBuffer = ByteBuffer.wrap(array);
```

**读写流程**：

```java
ByteBuffer buffer = ByteBuffer.allocate(1024);

// 写入数据（切换到写模式）
buffer.put((byte) 1);
buffer.put((byte) 2);
buffer.put((byte) 3);

// 切换到读模式（关键步骤！）
buffer.flip();

// 读取数据
while (buffer.hasRemaining()) {
    byte b = buffer.get();
    System.out.println(b);
}

// 清空缓冲区，准备再次写入
buffer.clear();
```

### flip()、clear()、compact() 三个方法

这是 Buffer 最容易搞混的三个方法：

```
初始状态（空缓冲区）:
capacity: [                    ]
position: 0
limit:    1024

写入 3 字节后:
capacity: [123                ]
position: 3
limit:    1024

flip() 后（准备读取）:
capacity: [123                ]
position: 0
limit:    3      ← position 移动到这里

读取 2 字节后:
capacity: [123                ]
position: 2
limit:    3

compact() 后（压缩，保留未读数据）:
capacity: [3   123            ]
position: 1   ← 移动到未读数据之后
limit:    1024

clear() 后（清空，准备重新写入）:
capacity: [                    ]
position: 0
limit:    1024
```

| 方法 | position | limit | 适用场景 |
|-----|----------|-------|---------|
| `flip()` | → 0 | → 原 position | 写完读之前 |
| `clear()` | → 0 | → capacity | 读完写之前（丢弃所有数据） |
| `compact()` | → 未读数据之后 | → capacity | 读完还要继续写（保留未读数据） |

---

## Selector：事件监听器

### Selector 是什么？

Selector（选择器）是 NIO 的精髓——**一个线程，监听多个 Channel 的事件**。

```
                    ┌─────────────┐
  Channel 1 ──────→ │             │
  Channel 2 ──────→ │   Selector  │ ←── 阻塞等待
  Channel 3 ──────→ │             │
  ...               └─────────────┘
                           │
                           ▼
                    返回就绪的事件
```

### Selector 的创建与使用

```java
// 1. 打开 Selector
Selector selector = Selector.open();

// 2. 将 Channel 设置为非阻塞模式
serverChannel.configureBlocking(false);

// 3. 注册 Channel 到 Selector，并指定监听的事件
SelectionKey key = serverChannel.register(selector, SelectionKey.OP_ACCEPT);

// 4. 阻塞等待就绪事件
while (true) {
    int readyCount = selector.select();  // 阻塞，直到有事件就绪
    if (readyCount == 0) continue;

    Set<SelectionKey> selectedKeys = selector.selectedKeys();
    Iterator<SelectionKey> it = selectedKeys.iterator();

    while (it.hasNext()) {
        SelectionKey key = it.next();
        it.remove();

        if (key.isAcceptable()) {
            // 处理新连接
        } else if (key.isReadable()) {
            // 处理读事件
        } else if (key.isWritable()) {
            // 处理写事件
        }
    }
}
```

### 四种事件类型

```java
SelectionKey.OP_ACCEPT   // 连接接受事件（ServerSocketChannel）
SelectionKey.OP_CONNECT  // 连接建立事件（SocketChannel，客户端）
SelectionKey.OP_READ     // 读事件（可读数据）
SelectionKey.OP_WRITE    // 写事件（可写数据）
```

可以组合监听：

```java
// 同时监听读和写
int interestOps = SelectionKey.OP_READ | SelectionKey.OP_WRITE;
channel.register(selector, interestOps);
```

---

## SelectionKey：事件的钥匙

### SelectionKey 是什么？

SelectionKey 是 Channel 和 Selector 关联的凭证。

当调用 `channel.register(selector, events)` 时，返回一个 SelectionKey：

```java
SelectionKey key = channel.register(selector, SelectionKey.OP_READ);
```

SelectionKey 保存了这些信息：

```java
// 获取关联的 Channel 和 Selector
Channel channel = key.channel();
Selector selector = key.selector();

// interestOps：关心的事件类型
int interestOps = key.interestOps();

// readyOps：已就绪的事件类型
int readyOps = key.readyOps();

// 判断事件类型
key.isAcceptable();
key.isConnectable();
key.isReadable();
key.isWritable();
```

### 动态修改监听事件

```java
// 原来监听读事件
key.interestOps(SelectionKey.OP_READ);

// 改成监听读写事件
key.interestOps(SelectionKey.OP_READ | SelectionKey.OP_WRITE);
```

### 取消监听

```java
// 临时取消监听
key.cancel();

// 下次 select() 时，会移除这个 SelectionKey
```

### attach()：附加自定义对象

SelectionKey 还可以携带业务数据：

```java
// 附加一个 User 对象
key.attach(user);

// 在事件处理时取出
User user = (User) key.attachment();
```

这个功能在业务处理中非常有用——可以用 SelectionKey 存储上下文信息。

---

## NIO 读取数据的完整流程

### 服务端代码

```java
public class NIOServer {
    public static void main(String[] args) throws IOException {
        // 1. 打开 ServerSocketChannel
        ServerSocketChannel serverChannel = ServerSocketChannel.open();
        serverChannel.socket().bind(new InetSocketAddress(8080));
        serverChannel.configureBlocking(false);  // 非阻塞模式

        // 2. 打开 Selector
        Selector selector = Selector.open();

        // 3. 注册监听 accept 事件
        serverChannel.register(selector, SelectionKey.OP_ACCEPT);
        System.out.println("服务器启动，监听 8080 端口...");

        // 4. 循环处理事件
        while (true) {
            // 阻塞等待就绪事件
            selector.select();

            // 获取所有就绪的 SelectionKey
            Set<SelectionKey> keys = selector.selectedKeys();
            Iterator<SelectionKey> iterator = keys.iterator();

            while (iterator.hasNext()) {
                SelectionKey key = iterator.next();
                iterator.remove();

                // 处理不同类型的事件
                if (key.isAcceptable()) {
                    handleAccept(key);
                } else if (key.isReadable()) {
                    handleRead(key);
                } else if (key.isWritable()) {
                    handleWrite(key);
                }
            }
        }
    }

    private static void handleAccept(SelectionKey key) throws IOException {
        ServerSocketChannel server = (ServerSocketChannel) key.channel();
        SocketChannel client = server.accept();  // 非阻塞模式下可能返回 null
        client.configureBlocking(false);
        // 注册读事件
        client.register(key.selector(), SelectionKey.OP_READ);
        System.out.println("客户端连接: " + client.getRemoteAddress());
    }

    private static void handleRead(SelectionKey key) throws IOException {
        SocketChannel client = (SocketChannel) key.channel();
        ByteBuffer buffer = ByteBuffer.allocate(1024);
        int len = client.read(buffer);

        if (len > 0) {
            buffer.flip();
            byte[] data = new byte[buffer.limit()];
            buffer.get(data);
            System.out.println("收到: " + new String(data));

            // 注册写事件，准备响应
            key.interestOps(SelectionKey.OP_WRITE);
        } else if (len == -1) {
            // 客户端关闭连接
            client.close();
            System.out.println("客户端断开: " + client.getRemoteAddress());
        }
    }

    private static void handleWrite(SelectionKey key) throws IOException {
        SocketChannel client = (SocketChannel) key.channel();
        ByteBuffer buffer = ByteBuffer.wrap("Hello".getBytes());
        client.write(buffer);
        // 写完后注册读事件
        key.interestOps(SelectionKey.OP_READ);
    }
}
```

### accept() 的非阻塞行为

ServerSocketChannel 在非阻塞模式下，`accept()` 可能返回 null：

```java
serverChannel.configureBlocking(false);
SocketChannel client = serverChannel.accept();

// 非阻塞模式：没有新连接时返回 null（不是阻塞等待）
if (client == null) {
    // 没有新连接，稍后再试
    return;
}
```

**这是新手最容易踩的坑**——在非阻塞模式下，必须处理 null 的情况。

---

## 三个组件的协作关系

```
┌─────────────────────────────────────────────────────┐
│                      Selector                        │
│  ┌─────────────────────────────────────────────────┐ │
│  │              SelectionKey                      │ │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────────────┐ │ │
│  │  │ Channel │  │interest │  │     readyOps    │ │ │
│  │  │  引用   │  │  Ops    │  │  (已就绪事件)   │ │ │
│  │  └─────────┘  └─────────┘  └─────────────────┘ │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
         │                           │
         ▼                           ▼
┌─────────────────┐        ┌─────────────────┐
│   Channel 1     │        │   Channel 2     │
│  ┌───────────┐  │        │  ┌───────────┐  │
│  │  Buffer   │  │        │  │  Buffer   │  │
│  │  (数据)   │  │        │  │  (数据)   │  │
│  └───────────┘  │        │  └───────────┘  │
│   Socket 连接   │        │   Socket 连接   │
└─────────────────┘        └─────────────────┘
```

数据流向：

1. Channel 接收数据 → Buffer
2. Selector 监听 Channel 事件
3. 事件就绪 → 业务处理

---

## 面试追问方向

### 追问一：Selector.select() 和 selectNow() 的区别？

```java
// 阻塞模式：直到有事件就绪才返回
int count = selector.select();

// 非阻塞模式：立即返回，不管有没有事件
int count = selector.selectNow();
```

| 方法 | 阻塞 | 返回值 |
|-----|-----|--------|
| `select()` | 是 | 就绪事件数量 |
| `select(long timeout)` | 是（有超时） | 就绪事件数量 |
| `selectNow()` | 否 | 就绪事件数量 |

### 追问二：SelectionKey 失效后会发生什么？

SelectionKey 被 `cancel()` 后，不会立即移除，而是在下次 `select()` 时删除。

如果 Channel 关闭，所有关联的 SelectionKey 都会自动失效。

### 追问三：NIO 中的空轮询 Bug 是什么？

在 JDK 1.4早起版本中，即使没有事件就绪，`selector.select()` 也可能返回（空轮询）。

JDK 7+ 修复了这个问题。

---

## 留给你的思考题

我们讲了 NIO 的三个核心组件：Channel、Buffer、Selector。

但还有一个问题：**NIO 是同步的，你知道它「同步」在哪里吗？**

`selector.select()` 会阻塞，`channel.read()` 也会阻塞。

真正的异步 IO，需要等数据完全准备好才通知进程——这正是 AIO 的设计理念。

但为什么大多数高性能框架（Netty、Tomcat）还是选择 NIO，而不是 AIO？
