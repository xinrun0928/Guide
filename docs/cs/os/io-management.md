# I/O管理：从键盘到磁盘的旅程

你知道当Java程序读写文件时，数据经历了怎样的旅程吗？
从用户程序到磁盘，可能经过了无数次复制和等待。

I/O管理，就是让这趟旅程高效可靠。


## I/O设备的分类

```
┌─────────────────────────────────────────────────────────────┐
│                        I/O设备分类                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 字符设备（Character Device）                              │
│     - 按字节流交互                                            │
│     - 键盘、鼠标、终端、串口                                  │
│                                                             │
│  2. 块设备（Block Device）                                    │
│     - 按固定大小的块读写                                      │
│     - 磁盘、SSD、磁带                                        │
│                                                             │
│  3. 网络设备（Network Device）                                │
│     - 数据包交互                                             │
│     - 网卡、无线网卡                                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```


## I/O控制方式演进

### 1. 程序控制I/O（轮询）

**最原始的方式——CPU不断询问设备是否就绪。**

```
CPU: "设备准备好了吗？"
设备: "没"
CPU: "准备好了吗？"
设备: "没"
CPU: "准备好了吗？"
设备: "没"
...
CPU: "准备好了吗？"
设备: "好了！"
CPU: "读取数据"
CPU: "准备好下一个了吗？"
...
```

**问题**：CPU在等待期间完全空闲，浪费严重！

```java
// 伪代码：程序控制I/O
public void readFromDevice(Device device, byte[] buffer) {
    for (int i = 0; i < buffer.length; i++) {
        // 忙等待
        while (!device.isReady()) {
            // CPU空转！
        }
        buffer[i] = device.readByte();
    }
}
```

### 2. 中断驱动I/O

**设备就绪后主动通知CPU。**

```
CPU: 开始I/O操作
设备: 开始处理...
CPU: 去干其他事
设备: 处理完成，发送中断
CPU: 响应中断，处理数据
```

**优点**：CPU不必忙等待，可以做其他事
**缺点**：每个字节/小块数据都产生一次中断，开销仍然较大

```java
// 伪代码：中断驱动I/O
public class InterruptDrivenIO {
    private byte[] buffer;
    private int position;
    private Device device;

    public void startRead(Device device, byte[] buffer) {
        this.buffer = buffer;
        this.position = 0;
        this.device = device;

        // 启动设备，CPU可以去做其他事
        device.startAsyncRead(buffer);
    }

    // 中断处理程序
    public void onInterrupt() {
        // 设备数据已准备好
        int bytesRead = device.getData(buffer, position);
        position += bytesRead;

        if (position < buffer.length) {
            device.startAsyncRead(buffer);  // 继续读
        } else {
            // 完成，通知等待的线程
            notifyCompletion();
        }
    }
}
```

### 3. DMA（直接内存访问）

**DMA控制器代替CPU搬运数据。**

```
┌─────────────────────────────────────────────────────────────┐
│                    DMA工作原理                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  无DMA：                                                    │
│  CPU: 读取字节 → 写入内存 → 读取字节 → 写入内存 → ...        │
│  每次传输都需要CPU参与！                                     │
│                                                             │
│  有DMA：                                                    │
│  CPU: "DMA，帮我从磁盘读1MB数据到内存0x1000处"              │
│  DMA: "好的，我去处理"                                        │
│  CPU: "那我先去干别的"                                        │
│  DMA: "完成！给你"                                            │
│  CPU: "收到"                                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

```c
// DMA传输过程
void dma_transfer(DMADevice dma, void* dest, void* src, size_t len) {
    // 1. CPU设置DMA控制器
    dma->addr = dest;              // 目标地址
    dma->count = len;              // 传输长度
    dma->command = READ;           // 读命令

    // 2. 启动DMA
    dma->control = START;

    // 3. DMA控制器与设备交互，自动搬运数据
    //    设备 → DMA → 内存（无需CPU介入）

    // 4. 传输完成后，DMA发送中断通知CPU
    //    CPU收到中断，知道传输完成
}
```

**DMA的优点**：
- 大幅减少CPU参与
- 提高系统并行度
- 适合大量数据传输


## 缓冲区管理

**缓冲区是内存中的一块区域，用于临时存放I/O数据。**

### 单缓冲

```
┌─────────────────────────────────────────────────────────────┐
│                    单缓冲工作原理                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  用户程序 ──→ [缓冲区] ──→ 设备                             │
│                                                             │
│  优点：允许设备处理和用户程序重叠执行                          │
│  缺点：缓冲区只有一个，处理时间受限于最慢的步骤                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 双缓冲（循环缓冲）

```
┌─────────────────────────────────────────────────────────────┐
│                    双缓冲工作原理                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  用户程序 ←── [缓冲区A]  [缓冲区B] ←── 设备                 │
│                    ↑          ↓                             │
│                  填充中      填充中                          │
│                    ↑          ↓                             │
│                  消费中      消费中                          │
│                                                             │
│  优点：生产和消费可以并行进行                                  │
│  缺点：设备或程序太快时可能阻塞                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 缓冲池

```java
// 简化的缓冲池实现
public class BufferPool {
    private final Queue<Buffer> available = new LinkedList<>();
    private final int poolSize;

    public BufferPool(int size) {
        this.poolSize = size;
        for (int i = 0; i < size; i++) {
            available.add(new Buffer(BUFFER_SIZE));
        }
    }

    public Buffer acquire() throws InterruptedException {
        synchronized (this) {
            while (available.isEmpty()) {
                wait();  // 等待空闲缓冲区
            }
            return available.poll();
        }
    }

    public void release(Buffer buffer) {
        buffer.clear();  // 清空缓冲区
        synchronized (this) {
            available.add(buffer);
            notifyAll();  // 通知等待的线程
        }
    }
}
```


## 实际案例：Java的I/O模型

### 阻塞I/O（BIO）

```java
public class BlockingIO {
    public static void main(String[] args) throws IOException {
        ServerSocket server = new ServerSocket(8080);

        while (true) {
            // 阻塞等待连接
            Socket client = server.accept();

            // 每个连接一个线程
            new Thread(() -> handle(client)).start();
        }
    }

    // 问题：连接多时，线程数爆炸
    // 解决：线程池
}
```

### 非阻塞I/O（NIO）

```java
public class NonBlockingIO {
    public static void main(String[] args) throws IOException {
        ServerSocketChannel server = ServerSocketChannel.open();
        server.socket().bind(new InetSocketAddress(8080));
        server.configureBlocking(false);  // 非阻塞模式

        Selector selector = Selector.open();
        server.register(selector, SelectionKey.OP_ACCEPT);

        while (true) {
            //  selector.select() 阻塞，但可以同时等待多个事件
            selector.select();

            for (SelectionKey key : selector.selectedKeys()) {
                if (key.isAcceptable()) {
                    // 处理新连接
                } else if (key.isReadable()) {
                    // 处理读事件
                } else if (key.isWritable()) {
                    // 处理写事件
                }
            }
        }
    }
}
```

### 异步I/O（AIO）

```java
public class AsyncIO {
    public static void main(String[] args) throws IOException {
        AsynchronousServerSocketChannel server =
            AsynchronousServerSocketChannel.open();

        server.bind(new InetSocketAddress(8080));

        server.accept(null, new CompletionHandler<AsynchronousSocketChannel, Void>() {
            @Override
            public void completed(AsynchronousSocketChannel client, Void attachment) {
                // 新的连接到达
                server.accept(null, this);  // 继续接受

                ByteBuffer buffer = ByteBuffer.allocate(1024);

                // 异步读取
                client.read(buffer, buffer, new CompletionHandler<Integer, ByteBuffer>() {
                    @Override
                    public void completed(Integer result, ByteBuffer buffer) {
                        // 读取完成，处理数据
                        buffer.flip();
                        client.write(buffer);
                    }

                    @Override
                    public void failed(Throwable exc, ByteBuffer buffer) {
                        // 处理失败
                    }
                });
            }

            @Override
            public void failed(Throwable exc, Void attachment) {
                // 处理失败
            }
        });
    }
}
```

### I/O模型对比

| 模型 | 阻塞 | 同步 | 异步 | 复杂度 |
|-----|------|------|------|-------|
| BIO | ✅ | ✅ | ❌ | 低 |
| NIO | ❌ | ✅ | ❌ | 中 |
| 多路复用 | ❌ | ✅ | ❌ | 中 |
| AIO | ❌ | ❌ | ✅ | 高 |


## 磁盘I/O优化

```java
public class DiskIOOptimization {
    // 1. 顺序访问优于随机访问
    // 2. 批量读写减少I/O次数
    // 3. 使用缓冲减少系统调用
    // 4. 内存映射文件减少复制

    public void badPattern() {
        // 每个字符都触发I/O
        FileWriter fw = new FileWriter("test.txt");
        for (int i = 0; i < 10000; i++) {
            fw.write("a");  // 非常慢！
        }
        fw.close();
    }

    public void goodPattern() {
        // 使用缓冲
        BufferedWriter bw = new BufferedWriter(new FileWriter("test.txt"));
        for (int i = 0; i < 10000; i++) {
            bw.write("a");
        }
        bw.close();
    }

    public void bestPattern() {
        // 一次性写入
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 10000; i++) {
            sb.append("a");
        }
        Files.write(Paths.get("test.txt"), sb.toString().getBytes());
    }
}
```


## 面试追问方向

- **DMA和中断驱动I/O的区别是什么？什么时候用DMA？**
  提示：DMA减少CPU参与，适合大量数据传输。
- **同步I/O和异步I/O的区别是什么？各有什么优缺点？**
  提示：是否阻塞等待结果。
- **什么是缓冲？单缓冲、双缓冲、循环缓冲各有什么特点？**
  提示：生产者和消费者模型。
- **Java中的NIO和传统I/O相比，有什么优势？**
  提示：多路复用、零拷贝、缓冲区。
