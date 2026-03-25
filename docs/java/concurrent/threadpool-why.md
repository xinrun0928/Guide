# 为什么要用线程池？

先问一个问题：为什么需要线程池？

你可能会说「复用线程」「减少创建销毁开销」。没错，但这是表面原因。

**深层问题是：没有线程池，你的系统可能随时崩溃。**

---

## 直接 new Thread 的问题

### 问题一：资源耗尽

```java
// 危险代码
public class 危险场景 {
    public void processRequests(List&lt;Request&gt; requests) {
        for (Request request : requests) {
            // 每个请求创建一个线程
            new Thread(() -&gt; handle(request)).start();
        }
    }
}

// 如果 requests 有 10000 个？
// 创建 10000 个线程 → 直接 OOM
```

**一个线程默认占用 1MB 栈内存，10000 个线程 = 10GB 内存。**

### 问题二：频繁创建销毁开销大

```java
// 创建线程的开销
Thread t = new Thread(() -&gt; {
    // 任务可能只执行 10ms
});

// 但创建线程本身可能需要 50ms
// 销毁线程也需要 10ms
// 实际任务只执行了 10ms
// 80% 的时间浪费在创建/销毁上
```

### 问题三：无法管理

- 线程数量不可控
- 无法统一监控
- 无法限流
- 无法复用

---

## 线程池解决的问题

### 1. 复用线程，减少开销

```
不用线程池：
任务1 → 创建线程 → 执行 → 销毁线程
任务2 → 创建线程 → 执行 → 销毁线程
...

用线程池：
任务1 → 从池中取线程 → 执行 → 归还线程
任务2 → 从池中取线程 → 执行 → 归还线程
...
```

线程创建一次，循环使用。

### 2. 控制并发数量

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    10,  // 核心线程数
    20,  // 最大线程数
    60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue&lt;&gt;(100)  // 队列容量
);

// 最多同时处理 20 + 100 = 120 个任务
// 超出则触发拒绝策略
```

### 3. 统一管理

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(...);

// 监控
int activeCount = executor.getActiveCount();   // 活跃线程数
long completedTaskCount = executor.getCompletedTaskCount(); // 完成任务数
int queueSize = executor.getQueue().size();    // 队列大小

// 关闭
executor.shutdown(); // 优雅关闭
executor.shutdownNow(); // 强制关闭
```

---

## 线程池的核心优势

### 优势一：提高响应速度

```
不用线程池：
主线程 → 创建线程(50ms) → 执行(10ms) → 总共60ms

用线程池（线程已创建）：
主线程 → 取线程(1ms) → 执行(10ms) → 总共11ms
```

核心线程预先创建，任务来了直接执行。

### 优势二：提高线程可管理性

| 功能 | 说明 |
|------|------|
| 限流 | 控制同时执行的任务数 |
| 复用 | 减少线程创建销毁开销 |
| 监控 | 了解线程运行状态 |
| 隔离 | 不同的业务用不同的池 |

### 优势三：提供额外能力

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(...);

// 1. 任务调度
ScheduledFuture&lt;?&gt; future = scheduledExecutor.schedule(
    () -&gt; task(), 3, TimeUnit.SECONDS);

// 2. 批量执行
List&lt;Callable&lt;Result&gt;&gt; tasks = Arrays.asList(
    () -&gt; query1(),
    () -&gt; query2(),
    () -&gt; query3()
);
List&lt;Future&lt;Result&gt;&gt; futures = executor.invokeAll(tasks);

// 3. 任意一个完成
Future&lt;T&gt; future = executor.submit(task);
```

---

## 实际场景对比

### 场景：处理 10000 个订单

```java
// 不用线程池
public class BadOrderProcessor {
    public void process(List&lt;Order&gt; orders) {
        for (Order order : orders) {
            new Thread(() -&gt; processOrder(order)).start();
        }
    }
}
// 结果：创建 10000 个线程 → OOM 或系统卡死

// 用线程池
public class GoodOrderProcessor {
    private final ThreadPoolExecutor executor;

    public GoodOrderProcessor() {
        executor = new ThreadPoolExecutor(
            10, 50, 60L, TimeUnit.SECONDS,
            new LinkedBlockingQueue&lt;&gt;(200),
            new ThreadPoolExecutor.CallerRunsPolicy()
        );
    }

    public void process(List&lt;Order&gt; orders) {
        for (Order order : orders) {
            executor.execute(() -&gt; processOrder(order));
        }
        executor.shutdown();
        try {
            executor.awaitTermination(1, TimeUnit.HOURS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
// 结果：最多 50 个线程并发处理 + 200 个在队列，稳如老狗
```

---

## 线程池 vs 进程池 vs 连接池

```
进程池：复用进程（如 Nginx 的 worker 进程）
线程池：复用线程
连接池：复用数据库连接、HTTP 连接

本质相同：预创建 + 复用 + 归还
```

---

## 什么时候不用线程池？

| 场景 | 原因 |
|------|------|
| 任务非常轻量 | 创建线程的开销可能大于任务本身 |
| 任务阻塞时间长 | 占用线程资源，可以考虑异步 |
| 任务数量极少 | 几秒钟才一个任务，不需要池 |
| 需要实时响应 | 线程池调度有延迟，直接创建更快 |

---

## 面试追问方向

1. **线程池和进程池的区别？**
   线程是轻量级的，共享进程资源（内存、文件句柄）；进程是隔离的。线程创建开销比进程小。

2. **线程池能无限创建线程吗？**
   不能。有 maximumPoolSize 限制，队列满后触发拒绝策略。

3. **为什么线程创建/销毁开销大？**
   - 需要分配栈内存（约 1MB）
   - 需要调用 OS 创建线程
   - 需要初始化线程本地存储、安全参数等
   - GC 需要管理线程对象

4. **核心线程数和最大线程数的关系？**
   核心线程 = 一直保持的线程；最大线程 = 紧急扩容上限。当队列满了，可以扩容到最大线程数。

5. **keepAliveTime 的作用？**
   非核心线程的空闲存活时间。超时后回收多余线程，节省资源。
