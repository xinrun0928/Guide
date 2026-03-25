# CompletableFuture 性能调优：自定义线程池

你有没有遇到过这种情况：

代码用 CompletableFuture 写的，异步执行，看起来很美好。

但上线后发现：并发性能不升反降，线程池打满，CPU 打满。

问题在哪？

**默认线程池是罪魁祸首。**

---

## 默认线程池的问题

### ForkJoinPool.commonPool() 的限制

```java
// 隐式使用 commonPool
CompletableFuture.supplyAsync(() -> doTask());
// 等价于
ForkJoinPool.commonPool().submit(() -> doTask());
```

| CPU 核心数 | commonPool 并行度 | 适合场景 |
|-----------|-----------------|---------|
| 4 核 | 3 | CPU 密集 |
| 8 核 | 7 | CPU 密集 |
| 16 核 | 15 | CPU 密集 |

**问题**：commonPool 的并行度 = CPU 核心数 - 1

如果你的任务是 IO 密集型（网络请求、数据库查询），7 个线程根本不够用！

### 实测：IO 任务性能对比

```java
// 测试：100 个 HTTP 请求，每个耗时 200ms
// 机器：8 核 CPU

// commonPool（7 线程）
CompletableFuture.supplyAsync(() -> httpCall());
// 耗时：100 × 200ms / 7 ≈ 2.86 秒

// 自定义线程池（50 线程）
ExecutorService executor = newFixedThreadPool(50);
CompletableFuture.supplyAsync(() -> httpCall(), executor);
// 耗时：100 × 200ms / 50 = 400ms

// 性能差距：7 倍！
```

---

## 何时需要自定义线程池

### IO 密集型任务：必须自定义

```java
// ❌ 错误：IO 任务用 commonPool
CompletableFuture.supplyAsync(() -> {
    return httpClient.get(url);  // 网络 IO
});

// ✅ 正确：IO 任务用大线程池
ExecutorService ioExecutor = new ThreadPoolExecutor(
    50, 100, 60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(1000)
);
CompletableFuture.supplyAsync(() -> {
    return httpClient.get(url);
}, ioExecutor);
```

### CPU 密集型任务：可以用 commonPool

```java
// ✅ 可以：CPU 密集型任务用 commonPool
CompletableFuture.supplyAsync(() -> {
    return computeHash(data);  // 纯 CPU 计算
});
```

### 混合任务：分离线程池

```java
// CPU 密集型：commonPool
ExecutorService cpuPool = ForkJoinPool.commonPool();

// IO 密集型：自定义线程池
ExecutorService ioPool = new ThreadPoolExecutor(50, 100, 60L, ...);

// 分别使用
CompletableFuture.supplyAsync(() -> computeCPU(), cpuPool);
CompletableFuture.supplyAsync(() -> queryDB(), ioPool);
```

---

## 线程池配置公式

### 线程数计算

```
IO 密集型：线程数 = CPU 核心数 × (1 + IO 时间 / CPU 时间)
```

假设：
- CPU 计算时间：10ms
- 网络等待时间：90ms
- IO 时间 / CPU 时间 = 9

```
线程数 = CPU 核心数 × (1 + 9) = CPU 核心数 × 10
8 核机器 → 80 个线程
```

### 配置参考

| 任务类型 | CPU 核心利用率 | 线程数建议（8 核） |
|---------|---------------|-----------------|
| CPU 密集型 | 100% | 8-9 |
| IO 密集型（轻） | < 50% | 20-30 |
| IO 密集型（重） | < 20% | 50-100 |
| 混合型 | 取决于比例 | 根据比例计算 |

---

## 最佳实践

### 1. 按业务隔离线程池

```java
public class AppExecutors {
    
    // HTTP 请求专用
    private static final ExecutorService HTTP_EXECUTOR = new ThreadPoolExecutor(
        50, 100, 60L, TimeUnit.SECONDS,
        new LinkedBlockingQueue<>(500),
        new ThreadFactoryBuilder().setNameFormat("http-%d").build(),
        new ThreadPoolExecutor.CallerRunsPolicy()
    );
    
    // 数据库查询专用
    private static final ExecutorService DB_EXECUTOR = new ThreadPoolExecutor(
        20, 50, 60L, TimeUnit.SECONDS,
        new LinkedBlockingQueue<>(200),
        new ThreadFactoryBuilder().setNameFormat("db-%d").build(),
        new ThreadPoolExecutor.AbortPolicy()
    );
    
    // 计算任务专用
    private static final ExecutorService COMPUTE_EXECUTOR = new ThreadPoolExecutor(
        Runtime.getRuntime().availableProcessors(),
        Runtime.getRuntime().availableProcessors() + 1,
        0L, TimeUnit.MILLISECONDS,
        new LinkedBlockingQueue<>(),
        new ThreadFactoryBuilder().setNameFormat("compute-%d").build()
    );
    
    // HTTP 调用
    public static <T> CompletableFuture<T> http(Supplier<T> supplier) {
        return CompletableFuture.supplyAsync(supplier, HTTP_EXECUTOR);
    }
    
    // 数据库查询
    public static <T> CompletableFuture<T> db(Supplier<T> supplier) {
        return CompletableFuture.supplyAsync(supplier, DB_EXECUTOR);
    }
    
    // 计算任务
    public static <T> CompletableFuture<T> compute(Supplier<T> supplier) {
        return CompletableFuture.supplyAsync(supplier, COMPUTE_EXECUTOR);
    }
}

// 使用
AppExecutors.http(() -> httpClient.get(url))
    .thenCompose(result -> AppExecutors.db(() -> cache.save(result)))
    .thenApply(result -> AppExecutors.compute(() -> processData(result)));
```

### 2. thenApply vs thenApplyAsync：避免不必要的线程切换

```java
// ❌ 问题：每个操作都切换线程
CompletableFuture.supplyAsync(() -> queryA(), ioPool)       // ioPool 线程
    .thenApply(this::transform)                             // main 线程
    .thenApplyAsync(this::enrich, ioPool)                   // ioPool 线程
    .thenApply(this::format)                                // main 线程
    .thenAcceptAsync(this::save, ioPool);                   // ioPool 线程

// ✅ 优化：同类型操作在同一个线程池
CompletableFuture.supplyAsync(() -> queryA(), ioPool)
    .thenApplyAsync(this::transform, ioPool)               // 同 ioPool 线程
    .thenApplyAsync(this::enrich, ioPool)                  // 同 ioPool 线程
    .thenApplyAsync(this::format, ioPool)                  // 同 ioPool 线程
    .thenAcceptAsync(this::save, ioPool);                  // 同 ioPool 线程
```

### 3. 合理设置队列容量

```java
// ❌ 无界队列：任务堆积过多导致 OOM
new ThreadPoolExecutor(50, 50, 0L, TimeUnit.MILLISECONDS,
    new LinkedBlockingQueue<>());  // Integer.MAX_VALUE

// ✅ 有界队列 + 拒绝策略
new ThreadPoolExecutor(50, 100, 60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(1000),  // 队列容量
    new ThreadPoolExecutor.CallerRunsPolicy());  // 队列满时调用者执行
```

---

## 性能监控

### 监控指标

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(...);

// 暴露 metrics
public ThreadPoolMetrics getMetrics() {
    return new ThreadPoolMetrics(
        executor.getActiveCount(),      // 活跃线程数
        executor.getPoolSize(),          // 当前线程数
        executor.getQueue().size(),      // 队列长度
        executor.getCompletedTaskCount() // 已完成任务数
    );
}

// 定期检查
ScheduledExecutorService monitor = Executors.newSingleThreadScheduledExecutor();
monitor.scheduleAtFixedRate(() -> {
    ThreadPoolMetrics m = getMetrics();
    log.info("线程池状态: 活跃={}, 当前={}, 队列={}", 
        m.activeCount, m.poolSize, m.queueSize);
    
    // 告警
    if (m.activeCount >= executor.getMaximumPoolSize()) {
        alert("线程池饱和！");
    }
}, 0, 10, TimeUnit.SECONDS);
```

### 线程池调优检查清单

- [ ] 线程数是否与任务类型匹配？
- [ ] 队列容量是否设置？
- [ ] 拒绝策略是否合理？
- [ ] 线程工厂是否命名清晰？
- [ ] 是否按业务隔离线程池？
- [ ] 是否监控关键指标？

---

## 常见错误

### 错误一：线程池泄露

```java
// ❌ 错误：每次都创建新线程池
public CompletableFuture<String> getData() {
    ExecutorService executor = Executors.newFixedThreadPool(50);  // 不关闭！
    return CompletableFuture.supplyAsync(() -> query(), executor);
}

// ✅ 正确：使用单例或池化
private static final ExecutorService executor = 
    new ThreadPoolExecutor(...);

// 或使用依赖注入
public CompletableFuture<String> getData(ExecutorService executor) {
    return CompletableFuture.supplyAsync(() -> query(), executor);
}
```

### 错误二：幽灵线程池

```java
// ❌ 错误：主线程结束，线程池还在运行
CompletableFuture.supplyAsync(() -> longRunningTask());
System.exit(0);  // 线程池被强制终止

// ✅ 正确：等待任务完成或显式关闭
CompletableFuture.supplyAsync(() -> longRunningTask())
    .thenRun(() -> System.exit(0));
```

### 错误三：过度并行

```java
// ❌ 错误：10000 个任务同时提交，内存爆炸
List<CompletableFuture> futures = IntStream.range(0, 10000)
    .mapToObj(i -> supplyAsync(() -> task(i)))
    .collect(Collectors.toList());

// ✅ 正确：分批处理
for (List<Integer> batch : partition(0, 10000, 100)) {
    List<CompletableFuture> futures = batch.stream()
        .map(i -> supplyAsync(() -> task(i)))
        .collect(Collectors.toList());
    allOf(futures.toArray(new CompletableFuture[0])).join();
}
```

---

## 面试追问方向

**Q1：如何确定线程池大小？**

根据任务类型和硬件配置。对于 CPU 密集型：线程数 ≈ CPU 核心数 + 1。对于 IO 密集型：线程数 ≈ CPU 核心数 × (1 + IO 时间 / CPU 时间)。建议实际压测后确定。

**Q2：CompletableFuture 的 thenApplyAsync 一定用新线程吗？**

不一定。`thenApplyAsync` 默认使用 commonPool，但可以指定 Executor。如果上游任务在指定线程池执行，使用相同线程池的 `thenApplyAsync` 会复用线程，避免切换。

**Q3：如何避免线程池耗尽？**

1. 合理设置队列容量 + 拒绝策略
2. 使用监控告警提前发现
3. 关键场景设置超时
4. 分离不同业务的线程池，避免相互影响
