# 线程池调优：核心参数与业务场景匹配

线程池用错，轻则系统卡顿，重则 OOM 宕机。

这不是危言耸听。我在生产环境见过太多这样的案例：核心系统突然无响应，堆栈信息清一色是 `RejectedExecutionException`；或者线程数暴涨，CPU 打满，最终触发 Full GC。

问题往往不在代码逻辑，而在于线程池参数「随手一配」。`newFixedThreadPool(10)`、`Executors.newCachedThreadPool()` —— 这些默认配置在压测环境可能没问题，到了生产环境就原形毕露。

今天，我们来聊聊如何给线程池「量体裁衣」。

## 线程池的七大核心参数

JDK 提供了 `ThreadPoolExecutor`，理解它是线程池调优的基础：

```java
public ThreadPoolExecutor(
    int corePoolSize,      // 核心线程数
    int maximumPoolSize,   // 最大线程数
    long keepAliveTime,    // 空闲线程存活时间
    TimeUnit unit,         // 时间单位
    BlockingQueue&lt;Runnable&gt; workQueue,      // 任务队列
    ThreadFactory threadFactory,           // 线程工厂
    RejectedExecutionHandler handler      // 拒绝策略
)
```

每个参数都是一道选择题，选对了性能倍增，选错了后患无穷。

## 核心线程数：CPU 密集型 vs IO 密集型

核心线程数 `corePoolSize` 是最关键的参数，但也是最容易配错的。

**CPU 密集型任务**（计算、加密、压缩）：核心线程数 = CPU 核心数 + 1

```java
// 获取 CPU 核心数
int cpuCores = Runtime.getRuntime().availableProcessors();
// CPU 密集型：核心线程数 = 核心数 + 1
int corePoolSize = cpuCores + 1;
```

为什么加 1？因为 CPU 密集型任务会一直占用 CPU，偶尔的内存访问、缓存失效会导致短时阻塞，加一个线程可以更好地利用 CPU 等待时间。

**IO 密集型任务**（数据库查询、网络请求、文件读写）：核心线程数 = CPU 核心数 × 2

```java
int cpuCores = Runtime.getRuntime().availableProcessors();
// IO 密集型：核心线程数 = 核心数 × 2
int corePoolSize = cpuCores * 2;
```

IO 密集型任务大部分时间在等待，CPU 处于空闲状态，所以需要更多线程来「填满」这些空闲时间。

**混合型任务**：如果你的业务既有 CPU 计算又有 IO 操作，可以用公式估算：

```
最佳线程数 = CPU 核心数 × (1 + IO 等待时间 / CPU 计算时间)
```

## 最大线程数：不是越大越好

很多人觉得「线程池线程数越大越好」，这是典型的认知误区。

线程是有代价的：
- 每个线程约占用 1MB 栈空间
- 线程切换有上下文切换成本（约 1-5 微秒）
- 过多线程反而导致 CPU 调度开销大于并行收益

**合理的配置策略**：

```java
// CPU 密集型：最大线程数 = 核心数 + 1
int maxPoolSize = cpuCores + 1;

// IO 密集型：最大线程数可以设得更大
int maxPoolSize = cpuCores * 4; // 保守一点可以 × 2，激进一点可以 × 4
```

## 任务队列：隐藏的性能杀手

线程池的任务队列往往是性能瓶颈的罪魁祸首。

`LinkedBlockingQueue` 是无界队列，如果任务生产速度大于消费速度，队列会无限膨胀，最终 OOM：

```java
// 危险：无界队列，可能导致 OOM
new ThreadPoolExecutor(
    10, 20, 60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue&lt;&gt;()  // 无界队列！
);
```

**推荐使用有界队列**，并设置合理的队列容量：

```java
// 合理：有界队列
new ThreadPoolExecutor(
    10, 20, 60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue&lt;&gt;(1000)  // 队列容量 1000
);
```

但队列太大可能造成请求堆积、延迟增大；队列太小容易触发拒绝策略。需要根据业务 SLA 和任务特性权衡。

**队列选型对比**：

| 队列类型 | 特性 | 适用场景 |
|---------|------|---------|
| LinkedBlockingQueue | 无界/有界可选，FIFO | 任务量可控的场景 |
| ArrayBlockingQueue | 有界，FIFO，性能高 | 需要严格流量控制 |
| SynchronousQueue | 不存储任务，直接移交 | 线程数固定，不接受堆积 |
| PriorityBlockingQueue | 支持优先级 | 需要任务优先级的场景 |

## 拒绝策略：最后的安全网

当线程池和队列都满了，新的任务会触发拒绝策略。JDK 提供了四种默认策略：

```java
// 1. AbortPolicy（默认）：抛异常
new ThreadPoolExecutor.AbortPolicy();

// 2. CallerRunsPolicy：由调用线程执行
new ThreadPoolExecutor.CallerRunsPolicy();

// 3. DiscardPolicy：直接丢弃
new ThreadPoolExecutor.DiscardPolicy();

// 4. DiscardOldestPolicy：丢弃最老的任务
new ThreadPoolExecutor.DiscardOldestPolicy();
```

**生产环境建议**使用 `CallerRunsPolicy`，让调用线程自己执行任务。这样：
- 不会丢失任务
- 调用方会因为任务堆积而降速，形成「背压」
- 给运维人员留出扩容或修复的时间

## 实战：不同场景的线程池配置

### 场景一：短平快的 HTTP 请求

```java
// 适用于 RPC 调用、HTTP 请求等 IO 密集型任务
int cores = Runtime.getRuntime().availableProcessors();
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    cores * 2,           // 核心线程
    cores * 4,           // 最大线程
    60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue&lt;&gt;(200),  // 队列容量适中
    new ThreadFactoryBuilder().setNameFormat("http-pool-%d").build(),
    new ThreadPoolExecutor.CallerRunsPolicy()  // 背压策略
);
```

### 场景二：异步批量处理

```java
// 适用于数据库批量写入、消息批量消费等
ThreadPoolExecutor batchExecutor = new ThreadPoolExecutor(
    4,                  // 核心线程数较小，避免资源竞争
    8,                  // 最大线程数
    30L, TimeUnit.MINUTES,  // 批量任务时间长，保持更多线程
    new LinkedBlockingQueue&lt;&gt;(500),
    new ThreadFactoryBuilder().setNameFormat("batch-pool-%d").build(),
    new ThreadPoolExecutor.AbortPolicy()
);
```

### 场景三：高优先级任务处理

```java
// 需要公平地处理不同优先级任务
ThreadPoolExecutor priorityExecutor = new ThreadPoolExecutor(
    4, 8, 60L, TimeUnit.SECONDS,
    new PriorityBlockingQueue&lt;&gt;(),  // 优先级队列
    new ThreadFactoryBuilder().setNameFormat("priority-pool-%d").build(),
    new ThreadPoolExecutor.CallerRunsPolicy()
);

// 任务实现 Comparable 接口以支持优先级
public class PriorityTask implements Runnable, Comparable&lt;PriorityTask&gt; {
    private final int priority;
    private final Runnable task;

    public PriorityTask(int priority, Runnable task) {
        this.priority = priority;
        this.task = task;
    }

    @Override
    public int compareTo(PriorityTask o) {
        return Integer.compare(o.priority, this.priority); // 数字越大优先级越高
    }

    @Override
    public void run() {
        task.run();
    }
}
```

## 监控：调优的闭环

配置完线程池只是开始，监控才是验证效果的唯一手段。

```java
// 在 Spring 中暴露线程池指标
@Configuration
public class ThreadPoolMetrics {
    @Bean
    public ThreadPoolExecutorMetricsBean threadPoolMetrics(ThreadPoolExecutor executor) {
        return new ThreadPoolExecutorMetricsBean(executor, "http-executor");
    }
}

// 关键监控指标
public class ThreadPoolExecutorMetricsBean {
    private final ThreadPoolExecutor executor;
    private final String name;

    public ThreadPoolExecutorMetricsBean(ThreadPoolExecutor executor, String name) {
        this.executor = executor;
        this.name = name;
    }

    public Map&lt;String, Object&gt; getMetrics() {
        return Map.of(
            "poolSize", executor.getPoolSize(),
            "activeCount", executor.getActiveCount(),
            "queueSize", executor.getQueue().size(),
            "completedTaskCount", executor.getCompletedTaskCount(),
            "largestPoolSize", executor.getLargestPoolSize()
        );
    }
}
```

需要重点关注：
- **activeCount / poolSize**：接近 1 时说明线程饱和
- **queue.size()**：持续增长说明消费速度跟不上
- **completedTaskCount**：观察吞吐量是否稳定

## 总结

线程池调优的核心是**「匹配」**：

- 线程数与任务类型匹配（CPU 密集 / IO 密集）
- 队列容量与业务承载能力匹配
- 拒绝策略与可靠性要求匹配
- 监控与持续优化匹配

没有放之四海而皆准的最优配置，只有最适合当前业务场景的配置。

---

## 留给你的问题

线程池的核心线程数，在运行过程中可以动态修改吗？如果可以，怎么做？

提示：查看 `ThreadPoolExecutor` 的 `setCorePoolSize()` 和 `setMaximumPoolSize()` 方法。
