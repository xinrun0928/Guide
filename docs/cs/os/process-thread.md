# 进程、线程、协程：并发三剑客的本质区别

凌晨2点，你的Java服务突然CPU飙升80%。你抓了线程dump，发现一堆线程都在等锁。
你开始怀疑人生：不是说多线程能提升性能吗？怎么反而更慢了？

要回答这个问题，得先搞清楚三个基本概念：**进程、线程、协程**。


## 进程：资源的容器

**进程是资源分配的基本单位**。当你启动一个Java程序，操作系统会创建一个进程，为它分配独立的内存空间、文件句柄、信号量等资源。

```java
public class ProcessDemo {
    public static void main(String[] args) {
        // 每个运行中的 Java 程序都是一个独立的进程
        System.out.println("进程ID: " + ProcessHandle.current().pid());
        // 在 Linux 上，可以用 ps aux | grep java 查看这个进程
    }
}
```

**进程的特点：**
- 拥有独立的地址空间（进程A崩溃不会影响进程B）
- 进程间通信需要额外的机制（IPC）
- 创建和切换开销大（需要切换独立的内存空间）

> 你有没有想过，为什么JVM崩溃了，你的IDE还能正常运行？因为它们是不同的进程。


## 线程：调度的单位

**线程是CPU调度的基本单位**。一个进程可以包含多个线程，这些线程共享进程的地址空间和资源。

```java
public class ThreadDemo {
    public static void main(String[] args) {
        // main 方法运行在 main 线程中
        System.out.println("主线程: " + Thread.currentThread().getName());

        // 创建新线程
        Thread worker = new Thread(() -> {
            // 这个代码运行在新线程中
            System.out.println("工作线程: " + Thread.currentThread().getName());
        });
        worker.start();
    }
}
```

**线程 vs 进程的关键区别：**

| 特性 | 进程 | 线程 |
|-----|-----|-----|
| 资源分配 | 独立地址空间 | 共享进程资源 |
| 开销 | 创建/切换开销大 | 创建/切换开销小 |
| 通信 | 需要IPC机制 | 直接读写共享内存 |
| 隔离性 | 进程间隔离 | 线程间共享（注意线程安全） |

```java
// 线程共享进程的哪些资源？
public class SharedResources {
    private int count = 0;  // 实例变量 - 线程间共享（注意线程安全！）

    public void increment() {
        count++;  // 多个线程同时操作，可能出问题
    }

    // 局部变量在线程栈中，每个线程有自己的副本
    public void process() {
        int localVar = 0;  // 线程私有
        // ...
    }
}
```

> 协程又是什么？为什么最近这么火？


## 协程：用户态的轻量级线程

**协程（Coroutine）是用户态的轻量级执行单元**。与线程由操作系统调度不同，协程由程序自身控制切换。

```java
// Java 21 虚拟线程示例
public class VirtualThreadDemo {
    public static void main(String[] args) throws InterruptedException {
        // 创建10000个虚拟线程
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            IntStream.range(0, 10000).forEach(i -> {
                executor.submit(() -> {
                    // 虚拟线程非常轻量，可以创建海量
                    System.out.println("虚拟线程 " + i);
                    return i;
                });
            });
        }
    }
}
```

**协程 vs 线程的本质区别：**

| 特性 | 线程 | 协程 |
|-----|-----|-----|
| 调度者 | 操作系统内核 | 用户态程序 |
| 切换开销 | 涉及内核态切换 | 用户态切换，开销极小 |
| 阻塞影响 | 阻塞线程会导致内核调度 | 阻塞时主动让出，不影响其他协程 |
| 数量 | 几千个就很多了 | 可以轻松创建上百万个 |

```java
// 协程的「让出」机制 - 模拟
public class CoroutineDemo {
    public static void main(String[] args) {
        // 伪代码，展示协程的工作方式
        coroutineA = new Coroutine(() -> {
            for (int i = 0; i < 1000; i++) {
                if (i == 500) {
                    yield();  // 主动让出CPU，切换到其他协程
                }
            }
        });

        coroutineB = new Coroutine(() -> {
            // 可以和 coroutineA 交替执行
        });

        scheduler.run();  // 用户态调度器管理协程切换
    }
}
```


## Java中的线程模型演进

Java的线程模型经历了几个阶段：

### 1. 平台线程（1.0 - 20）
传统的 `java.lang.Thread`，直接映射到操作系统的内核线程。

```java
// 传统线程模型 - 每个线程对应一个内核线程
Thread thread = new Thread(() -> {
    // 阻塞操作会阻塞整个内核线程
    try {
        Thread.sleep(1000);  // 线程阻塞，但这是OS级别的阻塞
    } catch (InterruptedException e) {}
});
thread.start();
```

> 问题：当你用Tomcat处理10000个并发请求时，需要创建10000个线程。线程的栈空间默认1MB，光栈就要10GB内存。

### 2. 线程池（Java 5+）
通过复用线程减少创建开销，但本质还是一对一映射。

```java
// 线程池 - 复用线程，减少创建开销
ExecutorService pool = Executors.newFixedThreadPool(100);
// 100个线程处理10000个请求
for (int i = 0; i < 10000; i++) {
    pool.submit(() -> handleRequest(i));
}
```

> 问题：每个请求对应一个线程，线程是稀缺资源，上限受限于内存和CPU。

### 3. 虚拟线程（Java 21+）
**里程碑式的改变**——虚拟线程由JVM管理，不直接映射内核线程。

```java
// 虚拟线程 - 百万级别的并发不再是问题
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    IntStream.range(0, 1_000_000).forEach(i -> {
        executor.submit(() -> {
            // 100万个虚拟线程轻松创建！
            // 它们在背后复用少量内核线程
            return i;
        });
    });
}
```

**虚拟线程的原理：**
```
用户视角:  [V1] [V2] [V3] ... [V1000000]  (100万个虚拟线程)
           ↓     ↓     ↓
JVM调度器:  [Carrier Thread Pool] (可能只有几百个内核线程)
           ↓     ↓     ↓
操作系统:   [K1] [K2] [K3] ... [Kn] (实际的内核线程)
```


## 实战：选择正确的并发模型

```java
public class ConcurrencyChoice {
    public static void main(String[] args) {
        // CPU密集型任务 - 用线程池，线程数 = CPU核心数
        int cpuCores = Runtime.getRuntime().availableProcessors();
        ExecutorService cpuPool = Executors.newFixedThreadPool(cpuCores);

        // IO密集型任务 - 虚拟线程更适合
        // 因为大部分时间在等待IO，协程可以让出CPU
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int i = 0; i < 10000; i++) {
                executor.submit(() -> {
                    // 模拟HTTP请求、数据库查询等IO操作
                    return fetchData();
                });
            }
        }
    }
}
```


## 总结：一张图说清楚

```
┌─────────────────────────────────────────────────────────┐
│                        进程                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │                    线程                          │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐        │    │
│  │  │ 协程1   │  │ 协程2   │  │ 协程3   │  ...   │    │
│  │  └─────────┘  └─────────┘  └─────────┘        │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘

资源隔离:   进程 > 线程 > 协程
切换开销:   进程 > 线程 > 协程
编程复杂度: 进程 > 线程 > 协程
```


## 面试追问方向

- **虚拟线程和传统线程的区别是什么？底层原理是什么？**
  提示：JVM如何实现虚拟线程的挂起和恢复？Carrier Thread是什么？
- **协程在Java中怎么实现的？除了Java 21的虚拟线程，还有哪些方案？**
  提示：Quasar、Kotlin协程、Loom项目。
- **为什么Redis/Nginx用单线程模型却能高性能？**
  提示：IO多路复用 + 非阻塞IO + 事件驱动。
- **既然协程这么好，为什么JDK 21才引入虚拟线程？之前这么多年Java程序员是怎么解决的？**
  提示：异步编程、CompletableFuture、响应式框架（Reactor）。
