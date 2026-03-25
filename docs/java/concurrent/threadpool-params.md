# ThreadPoolExecutor 七大参数详解

ThreadPoolExecutor 是 Java 线程池的核心类。

```java
new ThreadPoolExecutor(
    corePoolSize,        // 参数1：核心线程数
    maximumPoolSize,    // 参数2：最大线程数
    keepAliveTime,       // 参数3：非核心线程空闲存活时间
    unit,                // 参数4：时间单位
    workQueue,           // 参数5：任务队列
    threadFactory,       // 参数6：线程工厂
    handler              // 参数7：拒绝策略
);
```

七个参数，缺一不可。

---

## 参数一：corePoolSize（核心线程数）

### 概念

核心线程数 = **一直保持存活的线程数量**。

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    10,  // 核心线程数：即使空闲也不回收
    20,  // 最大线程数
    ...
);
```

### 关键特性

```java
// 1. 核心线程默认不会超时回收
// 即使空闲，核心线程也不会被销毁

// 2. 可以设置核心线程超时回收
executor.allowCoreThreadTimeOut(true);
// 设置后，核心线程也会在 keepAliveTime 后被回收
```

### 设置建议

| 场景 | 建议 corePoolSize |
|------|------------------|
| CPU 密集型 | CPU 核心数 + 1 |
| IO 密集型 | CPU 核心数 × 2（或更多） |
| 混合型 | CPU 核心数 × (1 + 等待时间/计算时间) |

---

## 参数二：maximumPoolSize（最大线程数）

### 概念

最大线程数 = **线程池能容纳的最大线程数量**。

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    10,   // 核心线程
    50,   // 最大线程（紧急扩容上限）
    60L, TimeUnit.SECONDS,
    ...
);
```

### 扩容时机

```
任务来了
  ↓
核心线程空闲？→ 是 → 直接执行
  ↓（核心线程都在忙）
  ↓
队列满了？
  ↓（没满）
加入队列等待
  ↓（满了）
扩容到最大线程数
  ↓
扩容到 maximumPoolSize？
  ↓（已经最大）
触发拒绝策略
```

---

## 参数三：keepAliveTime（非核心线程空闲存活时间）

### 概念

非核心线程空闲多长时间后被回收。

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    10, 50,
    60L, TimeUnit.SECONDS,  // 非核心线程空闲60秒后回收
    ...
);
```

### 工作机制

```
时间线：
T0: 50个任务同时来 → 50个线程创建
T1: 任务完成 → 50个线程空闲
T2: T1 + 60秒 → 40个线程被回收，保留10个核心线程
T3: 新任务来了 → 使用保留的核心线程
```

### allowCoreThreadTimeOut()

```java
// 默认：核心线程不会超时回收
executor.allowCoreThreadTimeOut(false);

// 开启后：核心线程也会超时回收
executor.allowCoreThreadTimeOut(true);
// 10个核心线程空闲60秒后，也会被回收
// 变成 0 个线程（直到新任务来才创建）
```

---

## 参数四：unit（时间单位）

时间单位的枚举：

```java
TimeUnit.DAYS;           // 天
TimeUnit.HOURS;          // 小时
TimeUnit.MINUTES;        // 分钟
TimeUnit.SECONDS;        // 秒
TimeUnit.MILLISECONDS;   // 毫秒
TimeUnit.MICROSECONDS;   // 微秒
TimeUnit.NANOSECONDS;    // 纳秒
```

常用组合：

```java
// 60秒
new LinkedBlockingQueue&lt;&gt;(1000)

// 5分钟
TimeUnit.MINUTES.toSeconds(5)

// 500毫秒
TimeUnit.MILLISECONDS.toMillis(500)
```

---

## 参数五：workQueue（任务队列）

### 队列类型对比

| 队列类型 | 说明 | 特点 |
|---------|------|------|
| LinkedBlockingQueue | 无界队列 | 默认无界，可能 OOM |
| ArrayBlockingQueue | 有界队列 | 固定容量，需设置大小 |
| SynchronousQueue | 不存储元素 | 每个插入必须等一个删除 |
| DelayedWorkQueue | 延迟队列 | 用于定时线程池 |

### 代码示例

```java
// 无界队列（危险！）
BlockingQueue&lt;Runnable&gt; unbounded = new LinkedBlockingQueue&lt;&gt;();
// 队列可以无限增长，可能导致 OOM

// 有界队列（推荐）
BlockingQueue&lt;Runnable&gt; bounded = new ArrayBlockingQueue&lt;&gt;(1000);
// 队列满了会触发扩容或拒绝策略

// 同步队列（用于立即执行）
BlockingQueue&lt;Runnable&gt; sync = new SynchronousQueue&lt;&gt;();
// 不存储元素，put 必须等 take
```

### 队列选择原则

```
队列 + 线程数的关系：

核心线程满 + 队列满 → 扩容到最大线程数

如果队列无界 → 线程数永远不会超过核心线程数
如果队列有界 → 队列满后扩容
```

---

## 参数六：threadFactory（线程工厂）

### 默认实现

```java
// 默认线程工厂
ThreadFactory factory = Executors.defaultThreadFactory();

// 创建的线程命名格式：pool-N-thread-M
// 如 pool-1-thread-1, pool-1-thread-2
```

### 自定义线程工厂

```java
ThreadFactory customFactory = new ThreadFactory() {
    private int count = 0;

    @Override
    public Thread newThread(Runnable r) {
        Thread thread = new Thread(r);
        thread.setName("MyPool-Worker-" + count++);
        thread.setDaemon(false);  // 用户线程（非守护线程）
        thread.setPriority(Thread.NORM_PRIORITY);
        return thread;
    }
};
```

### 应用场景

```java
// 1. 设置线程名（方便排查问题）
// 2. 设置守护线程
// 3. 设置线程优先级
// 4. 记录线程创建日志
// 5. 给线程设置上下文类加载器
```

---

## 参数七：handler（拒绝策略）

### 四种内置策略

```java
// 1. AbortPolicy（默认）：抛异常
new ThreadPoolExecutor.AbortPolicy();

// 2. CallerRunsPolicy：由调用线程执行
new ThreadPoolExecutor.CallerRunsPolicy();

// 3. DiscardPolicy：静默丢弃
new ThreadPoolExecutor.DiscardPolicy();

// 4. DiscardOldestPolicy：丢弃队列中最老的
new ThreadPoolExecutor.DiscardOldestPolicy();
```

### 代码示例

```java
// 场景：队列满 + 线程数达上限
RejectedExecutionHandler handler = new ThreadPoolExecutor.CallerRunsPolicy();

ThreadPoolExecutor executor = new ThreadPoolExecutor(
    10, 50, 60L, TimeUnit.SECONDS,
    new ArrayBlockingQueue&lt;&gt;(1000),
    customFactory,
    handler  // 这里
);
```

### 自定义拒绝策略

```java
RejectedExecutionHandler customHandler = (r, executor) -&gt; {
    // 记录日志
    log.error("任务被拒绝，数量: {}", executor.getTaskCount());

    // 可以尝试本地执行
    r.run();

    // 或者存入降级队列
    fallbackQueue.offer(r);
};
```

---

## 完整示例

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    10,                          // 核心线程数
    50,                          // 最大线程数
    60L,                         // 空闲存活时间
    TimeUnit.SECONDS,            // 时间单位：秒
    new ArrayBlockingQueue&lt;&gt;(1000), // 有界队列
    new ThreadFactory() {        // 自定义线程工厂
        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r);
            t.setName("Business-Pool-" + t.getId());
            return t;
        }
    },
    new ThreadPoolExecutor.CallerRunsPolicy() // 拒绝策略
);

// 使用
executor.execute(() -&gt; {
    System.out.println("任务执行中");
});

// 关闭
executor.shutdown();
```

---

## 面试追问方向

1. **corePoolSize 和 maximumPoolSize 可以相等吗？**
   可以。相等时线程池大小固定，不会有扩容。`new FixedThreadPool` 就是这样实现的。

2. **为什么阿里 Java 规范不建议用 Executors 创建线程池？**
   `newFixedThreadPool` 和 `newSingleThreadExecutor` 用无界队列，可能导致 OOM；`newCachedThreadPool` 和 `newScheduledThreadPool` 最大线程数是 Integer.MAX_VALUE，也有风险。

3. **keepAliveTime = 0 是什么意思？**
   非核心线程空闲立即回收。但实际代码中，如果 corePoolSize == maximumPoolSize，即使 allowCoreThreadTimeOut=true 也不会回收。

4. **SynchronousQueue 为什么不存储元素？**
   它的每个 put() 必须等待一个 take()，才能完成。适合需要立即执行任务的场景，如 `newCachedThreadPool`。

5. **workQueue 用 LinkedBlockingQueue 好还是 ArrayBlockingQueue 好？**
   - LinkedBlockingQueue：无界（需注意 OOM），性能稍好（两把锁 vs 一把锁）
   - ArrayBlockingQueue：有界，更安全，内存可控
