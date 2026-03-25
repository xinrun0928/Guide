# 线程池拒绝策略对比

线程池满了，队列也满了，新任务怎么办？

**拒绝策略**就是来处理这个问题的。

---

## 四种内置策略

### 1. AbortPolicy（默认）

**策略**：抛出 `RejectedExecutionException`。

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    2, 4, 60L, TimeUnit.SECONDS,
    new ArrayBlockingQueue&lt;&gt;(2),
    new ThreadPoolExecutor.AbortPolicy()
);

for (int i = 0; i &lt; 10; i++) {
    try {
        executor.execute(() -&gt; {
            System.out.println("执行任务");
        });
    } catch (RejectedExecutionException e) {
        System.out.println("任务被拒绝: " + e.getMessage());
    }
}
```

**输出**：
```
执行任务
执行任务
...
RejectedExecutionException: Task java.util.concurrent.FutureTask@xxx rejected from java.util.concurrent.ThreadPoolExecutor@xxx[Running, pool size = 4, active tasks = 4, queued tasks = 2, completed tasks = 0]
```

**适用场景**：需要明确知道任务被拒绝的场合。

---

### 2. CallerRunsPolicy

**策略**：由调用线程执行被拒绝的任务。

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    2, 4, 60L, TimeUnit.SECONDS,
    new ArrayBlockingQueue&lt;&gt;(2),
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

**效果**：

```
主线程提交任务
  ↓
线程池满了，队列满了
  ↓
CallerRunsPolicy 生效
  ↓
主线程自己执行这个任务
  ↓
主线程执行完后，继续提交下一个任务
```

**代码验证**：

```java
public class CallerRunsPolicyDemo {
    public static void main(String[] args) {
        ThreadPoolExecutor executor = new ThreadPoolExecutor(
            1, 2, 0L, TimeUnit.SECONDS,
            new ArrayBlockingQueue&lt;&gt;(1),
            new ThreadPoolExecutor.CallerRunsPolicy()
        );

        AtomicInteger counter = new AtomicInteger(0);

        for (int i = 0; i &lt; 5; i++) {
            int taskId = i;
            executor.execute(() -&gt; {
                String threadName = Thread.currentThread().getName();
                System.out.println("任务" + taskId + " 由 " + threadName + " 执行");
                counter.incrementAndGet();
            });
        }

        executor.shutdown();
    }
}
```

**可能的输出**：
```
任务0 由 pool-1-thread-1 执行
任务1 由 pool-1-thread-1 执行（队列中）
任务2 由 pool-1-thread-1 执行（队列中）
任务3 由 main 执行（CallerRunsPolicy 触发）
任务4 由 main 执行（CallerRunsPolicy 触发）
```

**适用场景**：
- 不想丢失任务
- 愿意用调用者线程执行
- 任务过多时降低提交速度

---

### 3. DiscardPolicy

**策略**：静默丢弃，不抛异常，不通知。

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    2, 4, 60L, TimeUnit.SECONDS,
    new ArrayBlockingQueue&lt;&gt;(2),
    new ThreadPoolExecutor.DiscardPolicy()
);

for (int i = 0; i &lt; 10; i++) {
    executor.execute(() -&gt; {
        System.out.println("执行任务");
    });
}
// 被拒绝的任务悄无声息地消失了
```

**适用场景**：
- 任务可以被丢弃
- 不重要的日志、统计等

---

### 4. DiscardOldestPolicy

**策略**：丢弃队列中最老的任务，然后尝试重新提交当前任务。

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    2, 4, 60L, TimeUnit.SECONDS,
    new ArrayBlockingQueue&lt;&gt;(2),
    new ThreadPoolExecutor.DiscardOldestPolicy()
);
```

**流程**：

```
队列状态：[任务A, 任务B]
新任务C来，队列满

DiscardOldestPolicy:
1. 丢弃任务A（最老的）
2. 任务C进入队列
3. 最终队列：[任务B, 任务C]
```

**适用场景**：
- 队列中的任务可以过期
- 优先执行新任务
- 如监控系统，优先保留最新数据

---

## 对比总结

| 策略 | 异常 | 执行者 | 任务丢失 |
|------|-----|-------|---------|
| AbortPolicy | 抛异常 | 无 | 全部保留（但抛异常） |
| CallerRunsPolicy | 不抛 | 调用者线程 | 全部执行（可能阻塞） |
| DiscardPolicy | 不抛 | 无 | 丢弃新的 |
| DiscardOldestPolicy | 不抛 | 无 | 丢弃老的 |

---

## 自定义拒绝策略

### 场景一：记录日志 + 降级处理

```java
public class LoggingRejectPolicy implements RejectedExecutionHandler {
    private final Logger log = LoggerFactory.getLogger(getClass());
    private final BlockingQueue&lt;Runnable&gt; fallbackQueue;

    public LoggingRejectPolicy(BlockingQueue&lt;Runnable&gt; fallbackQueue) {
        this.fallbackQueue = fallbackQueue;
    }

    @Override
    public void rejectedExecution(Runnable r, ThreadPoolExecutor executor) {
        // 1. 记录日志
        log.warn("任务被拒绝，poolSize={}, active={}, queueSize={}",
            executor.getPoolSize(),
            executor.getActiveCount(),
            executor.getQueue().size());

        // 2. 尝试存入降级队列
        if (!fallbackQueue.offer(r)) {
            log.error("降级队列也满了，任务彻底丢失: {}", r);
        }
    }
}

// 使用
BlockingQueue&lt;Runnable&gt; fallbackQueue = new LinkedBlockingQueue&lt;&gt;(1000);
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    2, 4, 60L, TimeUnit.SECONDS,
    new ArrayBlockingQueue&lt;&gt;(100),
    new LoggingRejectPolicy(fallbackQueue)
);
```

### 场景二：指数退避重试

```java
public class BackoffRetryPolicy implements RejectedExecutionHandler {
    private final int maxRetries;
    private final long initialDelayMs;

    public BackoffRetryPolicy(int maxRetries, long initialDelayMs) {
        this.maxRetries = maxRetries;
        this.initialDelayMs = initialDelayMs;
    }

    @Override
    public void rejectedExecution(Runnable r, ThreadPoolExecutor executor) {
        for (int i = 0; i &lt; maxRetries; i++) {
            try {
                long delay = initialDelayMs * (long) Math.pow(2, i);
                Thread.sleep(delay);
                executor.execute(r);
                return;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (RejectedExecutionException e) {
                // 还是满了，继续重试
            }
        }
        throw new RejectedExecutionException("重试" + maxRetries + "次后仍失败");
    }
}
```

### 场景三：优先级策略

```java
public class PriorityRejectPolicy implements RejectedExecutionHandler {
    @Override
    public void rejectedExecution(Runnable r, ThreadPoolExecutor executor) {
        if (r instanceof PriorityRunnable) {
            // 高优先级任务：抛异常
            throw new RejectedExecutionException("高优先级任务被拒绝");
        } else {
            // 低优先级任务：静默丢弃
            // 或者用 DiscardOldestPolicy
        }
    }
}
```

---

## 策略选择指南

### 选择建议

```
任务不能丢 + 愿意牺牲速度
  → CallerRunsPolicy（让调用者帮忙消化）

任务可以丢新的 + 不能丢老的
  → DiscardOldestPolicy

任务可以丢 + 不关心
  → DiscardPolicy

需要精确控制
  → AbortPolicy + try-catch

需要额外处理
  → 自定义策略
```

### 常见场景

| 场景 | 推荐策略 |
|------|---------|
| 银行转账 | CallerRunsPolicy（不丢任务） |
| 日志收集 | DiscardPolicy（可丢） |
| 监控系统 | DiscardOldestPolicy（保留最新） |
| API 调用 | CallerRunsPolicy（限流效果） |
| 批量任务 | AbortPolicy（显式处理） |

---

## 面试追问方向

1. **为什么 CallerRunsPolicy 能限流？**
   因为调用者线程被占用执行任务时，无法继续提交新任务。从而降低任务提交速度。

2. **AbortPolicy 抛出的异常会被谁捕获？**
   调用方需要 try-catch 捕获 `RejectedExecutionException`。如果没捕获，异常会向上传播。

3. **DiscardOldestPolicy 会不会导致线程饥饿？**
   可能。如果新任务不断来，老任务不断被丢弃，最老的任务可能永远执行不到。

4. **能否组合多种策略？**
   不能内置支持，但可以自定义策略模拟。如先日志再重试再丢弃。

5. **JDK 9 的新 API？**
   JDK 9 引入了 `Executor.Builder`，可以更流畅地构建线程池，但拒绝策略机制不变。
