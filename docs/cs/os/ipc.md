# 进程间通信：进程如何「对话」

你有没有想过：两个独立的进程，它们各自有独立的内存空间，那它们之间怎么传递数据？

这就是**进程间通信（IPC - Inter-Process Communication）**要解决的问题。


## 为什么进程需要通信？

```
┌─────────────┐                    ┌─────────────┐
│   进程A     │                    │   进程B     │
│  (浏览器)   │                    │  (播放器)   │
│             │                    │             │
│  独立内存    │ ←──通信？──→       │  独立内存    │
└─────────────┘                    └─────────────┘
        │                                  │
        └──────────────┬───────────────────┘
                       │
              操作系统内核空间
```

**典型场景：**
1. **浏览器进程和插件进程** - 需要共享页面数据
2. **服务端和客户端进程** - 网络通信的基础
3. **生产者进程和消费者进程** - 管道通信


## 六种经典IPC方式

### 1. 管道（Pipe）

**管道是最早的IPC机制，只能用于亲缘进程之间的通信。**

```
进程A ──写入──► [内核缓冲区] ──读取──► 进程B
                 (单向数据传输)
```

```bash
# Linux中的管道
$ ps aux | grep java
# ps的输出通过管道传给grep作为输入
```

```c
// C语言创建管道
int pipe(int fd[2]);
// fd[0]: 读端
// fd[1]: 写端

// 创建子进程后关闭不需要的端
pipe(fd);
if (fork() == 0) {
    close(fd[0]);           // 子进程关闭读端
    write(fd[1], "hello", 5);  // 写入数据
    close(fd[1]);
} else {
    close(fd[1]);           // 父进程关闭写端
    read(fd[0], buf, 100);   // 读取数据
    close(fd[0]);
}
```

**特点：**
- 半双工（单向）
- 只能在有血缘关系的进程间使用（父子、兄弟）
- 面向字节流
- 无格式，需要应用层自己解析

### 2. 命名管道（FIFO）

**命名管道解决了管道只能亲缘进程使用的问题。**

```bash
# 创建命名管道
$ mkfifo /tmp/myfifo

# 进程A写入
$ echo "hello" > /tmp/myfifo &

# 进程B读取
$ cat /tmp/myfifo
```

```c
// C语言创建命名管道
#include <sys/stat.h>
mkfifo("/tmp/myfifo", 0666);

// 以文件方式打开，可用于任意进程
int fd = open("/tmp/myfifo", O_RDONLY);
read(fd, buf, 100);
```

### 3. 消息队列（Message Queue）

**消息队列解决了管道无格式的问题，支持消息的概念。**

```
进程A ──消息1──► [消息队列] ◄──消息2── 进程B
                 │
                 └──► 进程C（也能接收）
```

```java
// Java中的消息队列（简化模拟）
public class MessageQueueDemo {
    public static void main(String[] args) {
        // 模拟消息队列
        BlockingQueue<String> queue = new LinkedBlockingQueue<>();

        // 生产者线程
        Thread producer = new Thread(() -> {
            for (int i = 0; i < 100; i++) {
                try {
                    queue.put("message-" + i);  // 阻塞直到队列有空间
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        });

        // 消费者线程
        Thread consumer = new Thread(() -> {
            while (true) {
                try {
                    String msg = queue.take();  // 阻塞直到队列有消息
                    System.out.println("收到: " + msg);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        });

        producer.start();
        consumer.start();
    }
}
```

**消息队列 vs 管道：**

| 特性 | 管道 | 消息队列 |
|-----|------|---------|
| 面向 | 字节流 | 消息（带类型） |
| 生命周期 | 随进程 | 随内核，可独立存在 |
| 进程关系 | 需血缘 | 任意进程 |
| 读取方式 | 顺序读取 | 可按类型读取 |

### 4. 共享内存（Shared Memory）

**最快的IPC方式——直接读写同一块内存。**

```
进程A                              进程B
┌─────────┐                       ┌─────────┐
│ 进程虚拟 │                       │ 进程虚拟 │
│ 地址空间  │                       │ 地址空间  │
│          │                       │          │
│ 虚拟地址1 │◄──────物理内存──────►│ 虚拟地址2 │
│ (映射到)  │      同一块物理内存    │ (映射到)  │
└─────────┘                       └─────────┘
```

```c
// Linux共享内存
#include <sys/shm.h>

// 创建共享内存
int shmid = shmget(IPC_PRIVATE, 4096, IPC_CREAT | 0666);

// 附加到进程地址空间
void* addr = shmat(shmid, NULL, 0);

// 写入数据
strcpy((char*)addr, "Hello from process A");

// 分离
shmdt(addr);
```

```java
// Java中的共享内存（通过MappedByteBuffer）
public class SharedMemoryDemo {
    public static void main(String[] args) throws Exception {
        // 创建文件映射
        RandomAccessFile file = new RandomAccessFile("shared.dat", "rw");
        FileChannel channel = file.getChannel();

        // 内存映射模式
        MappedByteBuffer buffer = channel.map(
            FileChannel.MapMode.READ_WRITE,
            0,
            4096
        );

        // 直接写入，进程B可以看到
        buffer.put("Hello".getBytes());
    }
}
```

> **共享内存是最快的IPC方式**，因为不需要内核介入。但需要自己处理同步问题！

### 5. 信号量（Semaphore）

**信号量本身不是通信方式，而是用于同步的机制，常配合共享内存使用。**

```java
// Java信号量
public class SemaphoreDemo {
    public static void main(String[] args) {
        Semaphore semaphore = new Semaphore(1);  // 互斥信号量

        // 进程A
        new Thread(() -> {
            try {
                semaphore.acquire();  // 获取信号量
                // 访问共享资源
                System.out.println("进程A正在访问共享资源");
                Thread.sleep(1000);
                semaphore.release();  // 释放信号量
            } catch (InterruptedException e) {}
        }).start();

        // 进程B
        new Thread(() -> {
            try {
                semaphore.acquire();
                System.out.println("进程B正在访问共享资源");
                semaphore.release();
            } catch (InterruptedException e) {}
        }).start();
    }
}
```

### 6. 套接字（Socket）

**最通用的IPC方式，支持跨主机通信，是网络编程的基础。**

```java
// Socket通信（Unix域Socket，本地通信）
public class SocketDemo {
    // 服务端
    static class Server {
        public static void main(String[] args) throws IOException {
            ServerSocket server = new ServerSocket("/tmp/server.sock");

            while (true) {
                Socket client = server.accept();
                BufferedReader reader = new BufferedReader(
                    new InputStreamReader(client.getInputStream()));
                System.out.println("收到: " + reader.readLine());

                PrintWriter writer = new PrintWriter(
                    client.getOutputStream(), true);
                writer.println("ACK");
            }
        }
    }

    // 客户端
    static class Client {
        public static void main(String[] args) throws IOException {
            Socket client = new Socket("/tmp/server.sock");
            PrintWriter writer = new PrintWriter(
                client.getOutputStream(), true);
            writer.println("Hello");

            BufferedReader reader = new BufferedReader(
                new InputStreamReader(client.getInputStream()));
            System.out.println("收到: " + reader.readLine());
        }
    }
}
```


## IPC方式对比

| 方式 | 速度 | 复杂度 | 通信范围 | 特点 |
|-----|------|-------|---------|-----|
| 管道 | 快 | 简单 | 亲缘进程 | 单向、字节流 |
| FIFO | 快 | 简单 | 任意进程 | 单向、字节流 |
| 消息队列 | 中等 | 中等 | 任意进程 | 消息、按类型 |
| 共享内存 | 最快 | 复杂 | 任意进程 | 需同步 |
| 信号量 | - | 中等 | 任意进程 | 同步，非通信 |
| Socket | 慢 | 复杂 | 任意进程/主机 | 通用、可靠 |


## 实战：进程通信模式

### 生产者-消费者模式

```java
public class ProducerConsumer {
    private static final int BUFFER_SIZE = 100;
    private static BlockingQueue<Integer> queue =
        new LinkedBlockingQueue<>(BUFFER_SIZE);

    // 生产者
    static class Producer implements Runnable {
        private int id;
        public Producer(int id) { this.id = id; }

        @Override
        public void run() {
            for (int i = 0; i < 1000; i++) {
                try {
                    queue.put(i);  // 队列满则阻塞
                    if (i % 100 == 0) {
                        System.out.println("Producer " + id + " produced " + i);
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }
    }

    // 消费者
    static class Consumer implements Runnable {
        private int id;
        public Consumer(int id) { this.id = id; }

        @Override
        public void run() {
            while (true) {
                try {
                    Integer item = queue.take();  // 队列空则阻塞
                    process(item);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }

        private void process(Integer item) {
            // 处理数据
        }
    }

    public static void main(String[] args) {
        // 创建多个生产者和消费者
        ExecutorService producers = Executors.newFixedThreadPool(3);
        ExecutorService consumers = Executors.newFixedThreadPool(5);

        for (int i = 0; i < 3; i++) {
            producers.submit(new Producer(i));
        }
        for (int i = 0; i < 5; i++) {
            consumers.submit(new Consumer(i));
        }
    }
}
```


## 面试追问方向

- **管道和消息队列的区别是什么？**
  提示：是否面向消息、生命周期、是否能无血缘关系进程通信。
- **共享内存为什么是最快的IPC方式？但为什么还需要信号量？**
  提示：共享内存快是因为不需要内核中转，但多个进程同时访问需要同步。
- **Linux下如何查看当前系统的IPC资源？**
  提示：`ipcs` 命令。
- **Java中有哪些方式可以实现进程间通信？**
  提示：Socket、File、管道（Pipe类）、共享内存（MappedByteBuffer）。
