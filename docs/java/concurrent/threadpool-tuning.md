# 线程池参数配置与调优

「线程池参数怎么设置？」

这是面试中的经典问题。但标准答案往往是错的——**没有万能公式，只有具体场景分析**。

---

## 调优原则

### CPU 密集型 vs IO 密集型

```
CPU 密集型：线程主要在执行计算（CPU busy）
  → 线程数 ≈ CPU 核心数

IO 密集型：线程主要在等待 IO（CPU idle）
  → 线程数 > CPU 核心数（因为 IO 期间 CPU 空闲）
```

### 计算公式

```
最佳线程数 = CPU 核心数 × (1 + IO等待时间 / CPU计算时间)

例如：
- CPU 计算耗时：10ms
- IO 等待耗时：90ms
- CPU 核心数：4
- 最佳线程数 = 4 × (1 + 90/10) = 40
```

---

## CPU 密集型配置

### 特点

- 线程大部分时间在执行计算
- CPU 利用率高
- 线程切换开销是主要成本

### 推荐配置

```java
int cpuCores = Runtime.getRuntime().availableProcessors();

ThreadPoolExecutor executor = new ThreadPoolExecutor(
    cpuCores + 1,     // 核心线程数
    cpuCores + 1,     // 最大线程数（不需要扩容）
    0L, TimeUnit.MILLISECONDS,
    new LinkedBlockingQueue&lt;&gt;(100),
    new ThreadPoolExecutor.AbortPolicy()
);
```

**为什么 + 1？**

线程 A 在等待 GC（STW）时，其他线程可以继续执行。多一个线程可以提高 CPU 利用率。

### 场景示例

```java
// CPU 密集型场景：图像处理、数据计算、加密解密
public class CpuIntensiveTask {
    public void process() {
        int cores = Runtime.getRuntime().availableProcessors();
        ExecutorService executor = new ThreadPoolExecutor(
            cores + 1,
            cores + 1,
            0L, TimeUnit.MILLISECONDS,
            new LinkedBlockingQueue&lt;&gt;(200)
        );

        // 图像滤镜处理
        for (Bitmap bitmap : bitmaps) {
            executor.submit(() -&gt; applyFilter(bitmap));
        }
    }
}
```

---

## IO 密集型配置

### 特点

- 线程大部分时间在等待（网络、磁盘、数据库）
- CPU 利用率低
- 可以增加更多线程利用 CPU

### 推荐配置

```java
int cpuCores = Runtime.getRuntime().availableProcessors();

ThreadPoolExecutor executor = new ThreadPoolExecutor(
    cpuCores * 2,           // 核心线程数
    cpuCores * 8,           // 最大线程数（IO 等待时其他线程可工作）
    60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue&lt;&gt;(100),
    new ThreadPoolExecutor.AbortPolicy()
);
```

### 场景示例

```java
// IO 密集型场景：HTTP 请求、数据库查询、文件读写
public class IoIntensiveTask {
    public void process() {
        int cores = Runtime.getRuntime().availableProcessors();
        ExecutorService executor = new ThreadPoolExecutor(
            cores * 2,     // 数据库连接池常用配置
            cores * 4,
            60L, TimeUnit.SECONDS,
            new LinkedBlockingQueue&lt;&gt;(1000)
        );

        // 批量发送 HTTP 请求
        for (String url : urls) {
            executor.submit(() -&gt; httpGet(url));
        }
    }
}
```

---

## 队列配置

### 有界队列 vs 无界队列

```java
// 无界队列（危险）
new LinkedBlockingQueue&lt;&gt;();  // 默认 Integer.MAX_VALUE

// 有界队列（推荐）
new ArrayBlockingQueue&lt;&gt;(1000);

// 队列大小怎么定？
// 公式：队列大小 ≈ 期望任务数 / 线程数
// 例如：每秒 1000 任务，20 线程 → 队列 50
```

### 队列大小计算

```
设计目标：
- 最大并发数：50
- 期望队列积压：1000
- 队列大小 = 1000 / 50 = 20

配置：
corePoolSize = 10
maximumPoolSize = 50
queueCapacity = 20
```

---

## 监控指标

### 常用方法

```java
ThreadPoolExecutor executor = new ThreadPoolExecutor(...);

public void monitor() {
    // 1. 活跃线程数（正在执行任务的线程）
    int activeCount = executor.getActiveCount();

    // 2. 当前线程池大小
    int poolSize = executor.getPoolSize();

    // 3. 队列中的任务数
    int queueSize = executor.getQueue().size();

    // 4. 完成任务数（历史累计）
    long completedTaskCount = executor.getCompletedTaskCount();

    // 5. 历史任务总数
    long taskCount = executor.getTaskCount();

    // 6. 队列剩余容量
    int remainingCapacity = executor.getQueue().remainingCapacity();

    System.out.printf("pool=%d, active=%d, queue=%d, completed=%d%n",
        poolSize, activeCount, queueSize, completedTaskCount);
}
```

### 健康状态判断

```java
public class 线程池健康检查 {
    public boolean isHealthy(ThreadPoolExecutor executor) {
        int active = executor.getActiveCount();
        int poolSize = executor.getPoolSize();
        int queueSize = executor.getQueue().size();

        // 活跃线程接近最大 → 过载
        if (active &gt;= poolSize * 0.8) {
            return false;
        }

        // 队列堆积严重
        if (queueSize &gt; 1000) {
            return false;
        }

        return true;
    }
}
```

---

## 自适应配置

### 动态调整线程数

```java
public class DynamicThreadPool {
    private final ThreadPoolExecutor executor;
    private final int coreCores;

    public DynamicThreadPool() {
        coreCores = Runtime.getRuntime().availableProcessors();
        executor = new ThreadPoolExecutor(
            coreCores, coreCores * 4,
            60L, TimeUnit.SECONDS,
            new LinkedBlockingQueue&lt;&gt;(1000)
        );
    }

    // 根据 CPU 使用率动态调整
    public void adjustPoolSize() {
        OperatingSystemMXBean os = ManagementFactory.getOperatingSystemMXBean();
        double cpuLoad = os.getSystemLoadAverage();

        if (cpuLoad &gt; 0.8) {
            // CPU 使用率高，减少线程
            executor.setCorePoolSize(coreCores);
        } else if (cpuLoad &lt; 0.3) {
            // CPU 使用率低，增加线程
            executor.setCorePoolSize(coreCores * 4);
        }
    }
}
```

### 压测调优

```java
public class 压测调优 {
    public static void main(String[] args) {
        // 不同配置压测
        int[] threadCounts = {10, 20, 50, 100};

        for (int threads : threadCounts) {
            ThreadPoolExecutor executor = new ThreadPoolExecutor(
                threads, threads,
                0L, TimeUnit.MILLISECONDS,
                new LinkedBlockingQueue&lt;&gt;(1000)
            );

            long start = System.currentTimeMillis();
            CountDownLatch latch = new CountDownLatch(10000);

            for (int i = 0; i &lt; 10000; i++) {
                executor.execute(() -&gt; {
                    // 模拟任务
                    try {
                        Thread.sleep(10);
                    } catch (InterruptedException e) {}
                    latch.countDown();
                });
            }

            try {
                latch.await();
            } catch (InterruptedException e) {}

            long duration = System.currentTimeMillis() - start;
            System.out.printf("线程数=%d, 耗时=%dms, QPS=%d%n",
                threads, duration, 10000 * 1000 / duration);

            executor.shutdown();
        }
    }
}
```

---

## 配置检查清单

### 上线前检查

```
□ 核心线程数设置合理？（CPU 密集型 +1，IO 密集型 ×2）
□ 最大线程数设置合理？（不能无上限）
□ 队列大小设置合理？（有界，防止 OOM）
□ 拒绝策略配置了？（不能静默丢弃重要任务）
□ 线程工厂配置了？（方便问题排查）
□ allowCoreThreadTimeOut 配置了？（是否需要回收核心线程）
□ keepAliveTime 设置合理？（60s 通常够用）
□ 监控告警配置了？（活跃线程数、队列堆积）
```

### 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 线程饥饿 | 队列太大，任务一直等 | 减小队列，增加线程 |
| CPU 100% | 线程太多 | 减小核心线程数 |
| 响应慢 | 线程不够用 | 增加线程或队列 |
| OOM | 无界队列 | 用有界队列 + 拒绝策略 |

---

## 面试追问方向

1. **如何确定 CPU 核心数？**
   `Runtime.getRuntime().availableProcessors()`。注意：这个值可能随容器动态调整。

2. **为什么 Tomcat 默认线程池最大 200？**
   - 经验值：太多线程会导致上下文切换开销
   - 内存限制：200 × 1MB = 200MB 栈内存
   - 连接数限制：数据库连接数通常也有限制

3. **队列大小的经验值？**
   队列大小 ≈ 预期积压任务数 / 线程数。比如预期积压 10000，线程 20，队列 500。

4. **核心线程可以超时回收吗？**
   可以。用 `allowCoreThreadTimeOut(true)` 设置，核心线程也会在 keepAliveTime 后回收。

5. **如何动态调整线程池参数？**
   ThreadPoolExecutor 提供了 `setCorePoolSize()` 和 `setMaximumPoolSize()` 方法，可以运行时调整。
