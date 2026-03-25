# Virtual Thread 虚拟线程

10 万并发连接，你会怎么设计？

传统方案：10 万个线程，每个线程 1MB 栈 = 100GB 内存。

这显然不可接受。

2018 年，Project Loom 启动，目标就是解决这个问题。

2023 年，JDK 21 发布，Virtual Thread 正式成为 Java 的正式特性。

今天，我们彻底理解虚拟线程。

---

## 线程的困境

### 传统线程模型

```java
// Tomcat 默认 200 线程
// 10 万并发 = 10 万线程？
// 10 万 × 1MB = 100GB 内存
```

问题：
- 每个线程默认 1MB 栈空间
- 线程创建、销毁、切换都有开销
- 大量线程导致 OOM

### 异步方案

为了解决线程瓶颈，社区发展出了异步方案：

```java
// 异步代码
CompletableFuture.supplyAsync(() -> callService())
    .thenApply(this::processResult)
    .exceptionally(this::handleError);
```

**但异步有几个问题**：
1. 代码不直观，到处是回调
2. 调试困难，堆栈不连续
3. 与同步代码集成复杂

**能不能既有同步的写法，又有异步的性能？**

这就是虚拟线程要解决的问题。

---

## 虚拟线程是什么？

### 概念

**虚拟线程（Virtual Thread）** 是 JDK 21 引入的轻量级线程，由 JVM 管理，不直接绑定 OS 线程。

```
┌─────────────────────────────────────────────┐
│                 JVM                          │
│  ┌────────────────────────────────────────┐ │
│  │        Virtual Thread 1                  │ │
│  │        Virtual Thread 2                  │ │
│  │        ...                              │ │
│  │        Virtual Thread 100000             │ │
│  └────────────────────────────────────────┘ │
│                      │                       │
│                      ▼                       │
│  ┌────────────────────────────────────────┐ │
│  │        Carrier Thread Pool (16 线程)    │ │
│  │  [Thread] [Thread] [Thread] ... [Thread]│ │
│  └────────────────────────────────────────┘ │
│                      │                       │
│                      ▼                       │
│           ┌─────────────────┐               │
│           │   OS Thread     │               │
│           │   (平台线程)      │               │
│           └─────────────────┘               │
└─────────────────────────────────────────────┘
```

### 关键特性

| 特性 | 平台线程 | 虚拟线程 |
|-----|---------|---------|
| 创建成本 | 高（1-2MB 栈） | 极低（几百字节） |
| 数量限制 | 数千个 | 数百万个 |
| 阻塞行为 | 阻塞 OS 线程 | 挂起虚拟线程，释放 carrier thread |
| 使用方式 | 必须池化 | **不要池化** |

---

## 虚拟线程使用

### 创建方式

```java
// 方式一：Thread.ofVirtual()
Thread vt = Thread.ofVirtual()
    .name("my-vt")
    .start(() -> System.out.println("Running in virtual thread"));

vt.join();

// 方式二：Executors.newVirtualThreadPerTaskExecutor()
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future&lt;String&gt; future = executor.submit(() -> {
        Thread.sleep(Duration.ofSeconds(1));
        return "Done!";
    });
    String result = future.get();
}

// 方式三：Executors.newSingleThreadExecutor() 返回的是平台线程
// 注意区分
ExecutorService single = Executors.newSingleThreadExecutor();  // 平台线程
ExecutorService virtual = Executors.newSingleThreadVirtualThreadExecutor();  // 虚拟线程
```

### 对比：同步写法 + 异步性能

```java
// 传统方案：200 线程处理 10 万请求
@RestController
public class OrderController {
    @Autowired
    private OrderService orderService;

    @GetMapping("/order/{id}")
    public Order getOrder(@PathVariable Long id) {
        // 这个线程在等待 IO 期间什么都做不了
        return orderService.getOrder(id);  // 假设耗时 100ms（DB + 远程调用）
    }
}
```

```java
// 虚拟线程方案：10 万虚拟线程处理 10 万请求
@RestController
public class OrderController {
    @Autowired
    private OrderService orderService;

    @GetMapping("/order/{id}")
    public Order getOrder(@PathVariable Long id) {
        // 阻塞时虚拟线程会被挂起，carrier thread 去处理其他虚拟线程
        return orderService.getOrder(id);
    }
}
```

**关键点**：代码写法完全一样，但性能天差地别。

---

## 虚拟线程原理

### 挂起与恢复

虚拟线程的「魔法」在于**挂起（park）**：

```java
// 当虚拟线程执行这段代码时
Thread.sleep(Duration.ofSeconds(1));

// JVM 内部发生了什么：
// 1. 虚拟线程调用 park()
// 2. JVM 将虚拟线程从 carrier thread 分离
// 3. carrier thread 空闲，去执行其他虚拟线程
// 4. 1 秒后，虚拟线程被恢复（unpark）
// 5. 虚拟线程重新绑定到一个 carrier thread 继续执行
```

### 挂起点（Park Points）

以下操作会挂起虚拟线程：

| 操作 | 说明 |
|-----|------|
| `Thread.sleep()` | 睡眠 |
| `Object.wait()` | 对象等待 |
| `LockSupport.parkNanos()` | 显式挂起 |
| `BlockingQueue.take()` | 阻塞获取 |
| 文件/网络 IO | 阻塞 IO |

### Carrier Thread

- 虚拟线程不直接绑定 OS 线程
- 虚拟线程挂起时，carrier thread 被释放
- 虚拟线程恢复时，可能绑定到不同的 carrier thread

```java
// 同一个虚拟线程，可能经历这样的旅程：
VirtualThread-1 @ CarrierThread-1  →  sleep()
                                    →  分离 CarrierThread-1
VirtualThread-1 @ ???              →  等待恢复
                                    →  绑定 CarrierThread-4
VirtualThread-1 @ CarrierThread-4  →  继续执行
```

---

## 适用场景

### 最适合：IO 密集型

```java
// HTTP 服务调用
public String fetchData(String url) {
    // 大量时间在等待网络响应
    HttpResponse&lt;String&gt; response = HttpClient.newHttpClient()
        .send(HttpRequest.newBuilder(URI.create(url)).build(),
              HttpResponse.BodyHandlers.ofString());
    return response.body();
}

// 10000 个请求
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (int i = 0; i < 10000; i++) {
        final int id = i;
        executor.submit(() -> fetchData("http://api.example.com/data/" + id));
    }
}
```

### 适合：高并发微服务

```java
// Spring Boot + 虚拟线程
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        // Tomcat 默认使用虚拟线程（需要 JDK 21+ 和配置）
        SpringApplication.run(Application.class, args);
    }
}

// application.properties
server.tomcat虚拟线程.enabled=true
```

### 适合：消息队列消费者

```java
// Kafka 消费者
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    while (running) {
        ConsumerRecords&lt;String, String&gt; records = consumer.poll(Duration.ofSeconds(1));
        for (ConsumerRecord&lt;String, String&gt; record : records) {
            executor.submit(() -> processMessage(record));
        }
    }
}
```

---

## 不适用场景

### CPU 密集型

```java
// 不适合虚拟线程
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
executor.submit(() -> {
    // 计算密集：虚拟线程被挂起，carrier thread 也在等
    long sum = 0;
    for (long i = 0; i &lt; 1_000_000_000; i++) {
        sum += i;
    }
    return sum;
});
```

**原因**：CPU 密集型任务本来就需要占用 CPU，虚拟线程的挂起能力无法发挥作用。

### ThreadLocal 密集使用

```java
// 问题：每个虚拟线程都有独立的 ThreadLocal
ThreadLocal&lt;String&gt; userContext = new ThreadLocal&lt;&gt;();

Runnable task = () -> {
    userContext.set("user-" + Thread.currentThread().getId());
    // ... 处理请求
    String user = userContext.get();  // 正确
    userContext.remove();  // 重要：必须清理
};

try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    // 10000 个虚拟线程，10000 份 ThreadLocal 副本
    for (int i = 0; i &lt; 10000; i++) {
        executor.submit(task);
    }
}
```

**建议**：
- 使用 `Thread.ofVirtual().start()` 时，每次都要 `remove()` ThreadLocal
- 或者使用框架提供的自动清理机制

### 长生命周期的后台任务

```java
// 不适合
// 虚拟线程不适合运行「常驻线程」
Thread vt = Thread.ofVirtual().start(() -> {
    while (true) {
        // 监控任务
        monitor();
        Thread.sleep(Duration.ofMinutes(1));
    }
});
```

---

## 常见问题

### 虚拟线程需要池化吗？

**不需要！**

```java
// 错误：池化虚拟线程
ExecutorService pool = Executors.newFixedThreadPool(100);
for (int i = 0; i &lt; 10000; i++) {
    pool.submit(() -> handleRequest());  // 错误：违背了虚拟线程的目的
}

// 正确：每个任务一个虚拟线程
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (int i = 0; i &lt; 10000; i++) {
        executor.submit(() -> handleRequest());  // 每个请求一个虚拟线程
    }
}
```

**原因**：
- 虚拟线程创建成本极低（约几百字节 vs 1MB）
- 池化反而会限制并发能力

### 虚拟线程和 fiber 是什么关系？

Fiber（纤程）是 Project Loom 早期的名字，后来改名为 Virtual Thread。

两者指的是同一个概念。

### 虚拟线程可以调试吗？

**可以**。虚拟线程支持标准的线程调试：
- 断点
- Step Over/Into
- 堆栈跟踪

```java
// 虚拟线程的堆栈
"VirtualThread-1" #20 [192.168.1.1:8080]
    at com.example.OrderService.getOrder(OrderService.java:45)
    at com.example.OrderController.getOrder(OrderController.java:23)
    ...
```

---

## 与现有框架集成

### Spring Boot

```java
// Spring Boot 3.2+ 支持虚拟线程
// application.properties
spring.threads.virtual.enabled=true

// 或 Java 配置
@Bean
public TaskExecutor taskExecutor() {
    return Executors.newVirtualThreadPerTaskExecutor();
}
```

### Dubbo

```xml
<!-- dubbo.properties -->
dubbo.provider.threadpool=virtual
```

### 数据库连接池

```java
// HikariCP 配置
// 虚拟线程会自动挂起，等待连接
// 所以连接池大小可以更小
HikariConfig config = new HikariConfig();
config.setMaximumPoolSize(20);  // 比平台线程时代小很多
config.setMinimumIdle(5);
```

---

## 面试追问方向

### 追问一：虚拟线程是怎么实现的？

1. **Continuation**：虚拟线程基于Continuation实现，可以挂起和恢复
2. **Scheduler**：虚拟线程有自己的调度器，默认使用 ForkJoinPool
3. **Carrier Thread**：carrier thread 执行虚拟线程的代码
4. **栈帧管理**：虚拟线程使用「split stack」技术，需要时自动扩展

### 追问二：虚拟线程挂起时，锁的状态会丢失吗？

不会。虚拟线程挂起时，整个栈帧被保存：
- 局部变量
- 程序计数器
- 锁状态（ObjectMonitor）

恢复时完全还原。

### 追问三：synchronized 在虚拟线程中会怎样？

```java
synchronized (lock) {
    // 如果这里阻塞了...
    // 虚拟线程会挂起
    // 释放 carrier thread
    // 其他虚拟线程可以使用 carrier thread
}

// 整个过程透明，synchronized 的语义不变
```

但要注意：**如果 synchronized 中执行大量 CPU 计算，会阻塞 carrier thread**。

建议使用 `java.util.concurrent.locks.ReentrantLock` 替代，它允许更细粒度的控制。

### 追问四：为什么不要池化虚拟线程？

1. **创建成本低**：虚拟线程栈是动态增长的，从几百字节开始
2. **目的相悖**：池化是为了复用，虚拟线程是为了创建大量短生命周期线程
3. **调度更优**：JVM 的调度器比人工池化更智能

---

## 留给你的思考题

虚拟线程解决了 IO 密集型场景的问题，但引入了一个新问题：

**ThreadLocal 在虚拟线程时代怎么办？**

你有 10 万个虚拟线程，每个都有自己的 ThreadLocal。

当一个请求处理完成后，ThreadLocal 需要清理。

如果忘记清理，会发生什么？

> 提示：内存泄漏、脏数据、并发安全问题……
>
> 有什么好的解决方案？
