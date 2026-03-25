# CompletableFuture 默认线程池

你有没有想过这个问题：

```java
CompletableFuture.supplyAsync(() -> doSomething());
```

这行代码，用的是什么线程池？

答案是：**ForkJoinPool.commonPool()**。

这个线程池隐藏了太多细节，稍不注意就会踩坑。

---

## ForkJoinPool.commonPool() 是什么？

Java 7 引入了 Fork/Join 框架，JDK 8 在其基础上增加了一个**全局共享的线程池**。

```java
public static ForkJoinPool commonPool() {
    // 懒加载单例模式
    return common;
}
```

### 默认并行度

```
并行度 = max(可用CPU核心数 - 1, 1)
```

| CPU 核心数 | 并行度 |
|----------|--------|
| 4 核 | 3 |
| 8 核 | 7 |
| 16 核 | 15 |
| 32 核 | 31 |

对于 8 核机器，commonPool 只有 **7 个线程**。

---

## 7 个线程够用吗？

**这取决于你的任务类型。**

### CPU 密集型任务：刚好合适

如果是 CPU 密集型任务（比如计算、加密、压缩）：

```java
CompletableFuture.supplyAsync(() -> {
    // 纯计算，不涉及 IO
    return computePi();
});
```

CPU 密集型任务需要大量 CPU 时间，线程数和 CPU 核心数成正比。

> CPU 密集型任务：线程数 ≈ CPU 核心数
>
> IO 密集型任务：线程数 ≈ CPU 核心数 × (1 + IO等待时间/CPU时间)

7 个线程对于 8 核 CPU 的计算任务来说是合适的。

### IO 密集型任务：严重不足

但如果是 IO 密集型任务（比如数据库查询、HTTP 调用）：

```java
CompletableFuture.supplyAsync(() -> {
    // 等待数据库返回，可能阻塞 100ms+
    return queryFromDatabase();
});
```

7 个线程根本不够用。假设每个请求阻塞 100ms：

- 7 个线程：最多支持 70 QPS
- 700 个线程：可以支持 7000 QPS

**这就是很多人遇到「并发性能差」的根源。**

---

## commonPool 的特点

### 1. 所有 CompletableFuture 共享

```java
// 这两个 Future 共享同一个线程池
CompletableFuture.supplyAsync(() -> task1());
CompletableFuture.supplyAsync(() -> task2());
```

这意味着你的任务可能会被别人的任务挤占。

### 2. 非守护线程

commonPool 的线程是**非守护线程**，这意味着：

```java
// JVM 不会因为所有用户线程结束而自动终止 commonPool
// 即使 main 方法结束了，commonPool 的线程可能还在运行
```

### 3. 线程复用

ForkJoinPool 的核心设计是**工作窃取（Work-Stealing）**：

- 每个线程有自己的任务队列
- 线程忙完自己的队列后，会去偷其他线程的队列任务
- 保证负载均衡，最大化 CPU 利用率

```
线程1: [TaskA] [TaskB]        线程2: [TaskC] [TaskD]
         ↓ 空闲时偷                   ↓ 空闲时偷
线程1: [TaskC]                 线程2: [TaskB]
```

---

## 为什么会出问题？

### 场景：100 个并发 HTTP 请求

```java
// 100 个请求同时发起
List<CompletableFuture<String>> futures = IntStream.range(0, 100)
    .mapToObj(i -> CompletableFuture.supplyAsync(() -> httpCall(i)))
    .collect(Collectors.toList());

CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
```

问题：

1. 只有 7 个线程处理 100 个请求
2. 每个请求耗时 200ms（IO 等待）
3. 100 个请求需要：100 × 200ms / 7 ≈ 2.86 秒

如果用 100 个线程的线程池：

1. 100 个线程同时处理
2. 100 个请求耗时：200ms

**性能差距：14 倍！**

---

## 解决方案：自定义线程池

```java
// 为 IO 密集型任务创建专用线程池
ExecutorService ioExecutor = new ThreadPoolExecutor(
    50,                                    // 核心线程数
    100,                                   // 最大线程数
    60L, TimeUnit.SECONDS,                 // 空闲存活时间
    new LinkedBlockingQueue<>(1000),       // 队列容量
    new ThreadFactoryBuilder()
        .setNameFormat("io-task-%d")
        .build(),
    new ThreadPoolExecutor.CallerRunsPolicy() // 拒绝策略
);

// 使用自定义线程池
CompletableFuture.supplyAsync(() -> httpCall(), ioExecutor);
```

### 线程池配置参考

| 任务类型 | 线程数计算公式 | 示例（8核） |
|---------|--------------|-----------|
| CPU 密集型 | CPU核心数 + 1 | 9 |
| IO 密集型 | CPU核心数 × (1 + 平均IO时间/CPU时间) | 50-200 |
| 混合型 | 根据比例调整 | 20-50 |

---

## 最佳实践

### 1. IO 密集型任务必须用自定义线程池

```java
// 错误：IO 任务用 commonPool
CompletableFuture.supplyAsync(() -> queryDatabase());

// 正确：使用专用线程池
ExecutorService dbPool = new ThreadPoolExecutor(20, 50, ...);
CompletableFuture.supplyAsync(() -> queryDatabase(), dbPool);
```

### 2. 区分任务类型

```java
// CPU 密集型：可以用 commonPool
CompletableFuture.supplyAsync(() -> computeHash());

// IO 密集型：必须用自定义线程池
CompletableFuture.supplyAsync(() -> httpGet(), httpExecutor);
CompletableFuture.supplyAsync(() -> queryDB(), dbExecutor);
```

### 3. 统一管理线程池

```java
public class AppExecutors {
    private static final ExecutorService CPU_EXECUTOR = 
        ForkJoinPool.commonPool();
    
    private static final ExecutorService IO_EXECUTOR = 
        new ThreadPoolExecutor(50, 100, 60L, TimeUnit.SECONDS, 
            new LinkedBlockingQueue<>(1000));
    
    public static ExecutorService cpuExecutor() { return CPU_EXECUTOR; }
    public static ExecutorService ioExecutor() { return IO_EXECUTOR; }
}

// 使用
CompletableFuture.supplyAsync(() -> task(), AppExecutors.ioExecutor());
```

---

## 对比：commonPool vs 自定义线程池

| 特性 | ForkJoinPool.commonPool() | 自定义线程池 |
|-----|-------------------------|-------------|
| 并行度 | CPU核心数 - 1 | 可配置 |
| 共享性 | 全 JVM 共享 | 可隔离 |
| 任务类型 | 适合 CPU 密集型 | 可按需配置 |
| 队列 | 无界（WorkQueue） | 可配置有界/无界 |
| Work-Stealing | 支持 | 不支持（普通线程池） |
| 适用场景 | 小任务、快速任务 | IO 密集型、大并发 |

---

## 面试追问方向

**Q1：ForkJoinPool 和普通线程池有什么区别？**

普通线程池每个线程有独立的任务队列，用阻塞队列传递任务。ForkJoinPool 使用 Work-Stealing 算法，线程空闲时会窃取其他线程队列的任务，负载更均衡。ForkJoinPool 的设计更适合「分治」类任务（一个大任务拆成多个小任务并行执行）。

**Q2：commonPool 的线程数为什么是 CPU核心数 - 1？**

保留一个 CPU 核心给主线程和其他系统任务。如果 8 核 CPU 开了 8 个线程做计算，主线程几乎拿不到 CPU 时间片，会造成系统卡顿。

**Q3：如果不用 ForkJoinPool，直接用 ThreadPoolExecutor 实现 Work-Stealing 怎么做？**

Java 不提供开箱即用的 Work-Stealing 线程池。可以自己实现：每个线程维护自己的任务队列，空闲时从其他线程的队列尾部偷任务。也可以考虑使用 JetBrains 的 `kotlinx.coroutines` 或 Quasar，它们提供了协程支持的事件驱动线程池。
