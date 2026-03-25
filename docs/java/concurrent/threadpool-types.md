# 4 种常用线程池：Fixed、Cached、Single、Scheduled

Executors 是线程池的工厂类，提供四种常用线程池。

但阿里 Java 规范说「慎用」，为什么？

---

## 1. newFixedThreadPool：固定大小线程池

### 创建方式

```java
ExecutorService executor = Executors.newFixedThreadPool(10);
```

### 内部实现

```java
public static ExecutorService newFixedThreadPool(int nThreads) {
    return new ThreadPoolExecutor(
        nThreads,          // 核心线程数 = 最大线程数
        nThreads,          // 最大线程数
        0L,                // keepAliveTime（无用）
        TimeUnit.MILLISECONDS,
        new LinkedBlockingQueue&lt;Runnable&gt;()  // 无界队列
    );
}
```

### 特点

```
┌─────────────────────────────────────────────────────────────┐
│                     FixedThreadPool                         │
├─────────────────────────────────────────────────────────────┤
│  线程数：固定 N 个                                           │
│  队列：无界 LinkedBlockingQueue                              │
│  扩容：不扩容，线程数恒定                                     │
└─────────────────────────────────────────────────────────────┘
```

### 使用示例

```java
public class FixedThreadPoolDemo {
    public static void main(String[] args) {
        ExecutorService executor = Executors.newFixedThreadPool(5);

        for (int i = 0; i &lt; 100; i++) {
            final int taskId = i;
            executor.execute(() -&gt; {
                System.out.println("任务" + taskId + " 由 " +
                    Thread.currentThread().getName() + " 执行");
                try {
                    Thread.sleep(500);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
        }

        executor.shutdown();
    }
}
```

### 问题

```java
// 潜在风险
ExecutorService executor = Executors.newFixedThreadPool(10);

// 提交 10000 个任务
for (int i = 0; i &lt; 10000; i++) {
    executor.execute(() -&gt; process());
}

// LinkedBlockingQueue 默认容量 Integer.MAX_VALUE
// 10000 个任务全部进入队列
// 内存占用 = 10000 × 每个任务对象大小
// 可能导致 OOM
```

---

## 2. newCachedThreadPool：缓存线程池

### 创建方式

```java
ExecutorService executor = Executors.newCachedThreadPool();
```

### 内部实现

```java
public static ExecutorService newCachedThreadPool() {
    return new ThreadPoolExecutor(
        0,                          // 核心线程数 = 0
        Integer.MAX_VALUE,          // 最大线程数 = 无上限！
        60L, TimeUnit.SECONDS,      // 空闲存活时间 60 秒
        new SynchronousQueue&lt;Runnable&gt;()  // 同步队列
    );
}
```

### 特点

```
┌─────────────────────────────────────────────────────────────┐
│                     CachedThreadPool                        │
├─────────────────────────────────────────────────────────────┤
│  线程数：0 ~ Integer.MAX_VALUE（自动扩容）                   │
│  队列：SynchronousQueue（不存储元素）                        │
│  扩容：任务来一个，创建线程执行一个                            │
│  回收：60秒空闲后回收                                        │
└─────────────────────────────────────────────────────────────┘
```

### 使用示例

```java
public class CachedThreadPoolDemo {
    public static void main(String[] args) {
        ExecutorService executor = Executors.newCachedThreadPool();

        for (int i = 0; i &lt; 100; i++) {
            final int taskId = i;
            executor.execute(() -&gt; {
                System.out.println("任务" + taskId + " 由 " +
                    Thread.currentThread().getName() + " 执行");
            });
        }

        executor.shutdown();
    }
}
```

### 问题

```java
// 危险场景
ExecutorService executor = Executors.newCachedThreadPool();

// 如果任务里有阻塞操作...
for (int i = 0; i &lt; 10000; i++) {
    executor.execute(() -&gt; {
        // 假设每个任务阻塞 10 秒
        Thread.sleep(10000);
    });
}

// 10000 个线程创建 → 疯狂！
// 每个线程 1MB 栈内存 → 10GB 内存 → OOM
```

---

## 3. newSingleThreadExecutor：单线程池

### 创建方式

```java
ExecutorService executor = Executors.newSingleThreadExecutor();
```

### 内部实现

```java
public static ExecutorService newSingleThreadExecutor() {
    return new FinalizableDelegatedExecutorService(
        new ThreadPoolExecutor(
            1,                          // 核心线程数 = 1
            1,                          // 最大线程数 = 1
            0L, TimeUnit.MILLISECONDS,
            new LinkedBlockingQueue&lt;Runnable&gt;()  // 无界队列
        )
    );
}
```

### 特点

```
┌─────────────────────────────────────────────────────────────┐
│                     SingleThreadExecutor                    │
├─────────────────────────────────────────────────────────────┤
│  线程数：固定 1 个                                           │
│  队列：无界 LinkedBlockingQueue                              │
│  保证：任务串行执行                                           │
└─────────────────────────────────────────────────────────────┘
```

### 使用示例

```java
public class SingleThreadExecutorDemo {
    public static void main(String[] args) {
        ExecutorService executor = Executors.newSingleThreadExecutor();

        for (int i = 0; i &lt; 100; i++) {
            final int taskId = i;
            executor.execute(() -&gt; {
                System.out.println("任务" + taskId + " 由 " +
                    Thread.currentThread().getName() + " 执行");
            });
        }

        executor.shutdown();
    }
}
```

### 问题

```java
// 虽然单线程不会 OOM
// 但无界队列在极端情况下仍可能 OOM
ExecutorService executor = Executors.newSingleThreadExecutor();

// 如果任务处理极慢，队列堆积
// 内存占用 = 队列大小 × 任务大小
```

---

## 4. newScheduledThreadPool：定时任务线程池

### 创建方式

```java
ScheduledExecutorService executor = Executors.newScheduledThreadPool(5);
```

### 内部实现

```java
public static ScheduledExecutorService newScheduledThreadPool(int corePoolSize) {
    return new ScheduledThreadPoolExecutor(corePoolSize);
}

// ScheduledThreadPoolExecutor 继承自 ThreadPoolExecutor
// 队列用 DelayedWorkQueue
```

### 特点

```
┌─────────────────────────────────────────────────────────────┐
│                   ScheduledThreadPool                       │
├─────────────────────────────────────────────────────────────┤
│  线程数：corePoolSize ~ Integer.MAX_VALUE                    │
│  队列：DelayedWorkQueue（延迟队列）                          │
│  支持：定时执行、周期性执行                                   │
└─────────────────────────────────────────────────────────────┘
```

### 使用示例

```java
public class ScheduledThreadPoolDemo {
    public static void main(String[] args) {
        ScheduledExecutorService executor = Executors.newScheduledThreadPool(5);

        // 1. 延迟 3 秒后执行
        executor.schedule(() -&gt; {
            System.out.println("3秒后执行");
        }, 3, TimeUnit.SECONDS);

        // 2. 延迟 1 秒后开始，每 2 秒执行一次（固定频率）
        executor.scheduleAtFixedRate(() -&gt; {
            System.out.println("固定频率执行");
        }, 1, 2, TimeUnit.SECONDS);

        // 3. 任务完成后，延迟 2 秒再执行（固定间隔）
        executor.scheduleWithFixedDelay(() -&gt; {
            System.out.println("固定间隔执行");
        }, 0, 2, TimeUnit.SECONDS);

        // 记得关闭
        // executor.shutdown();
    }
}
```

### scheduleAtFixedRate vs scheduleWithFixedDelay

```java
// scheduleAtFixedRate：固定频率（任务开始时间间隔固定）
// 任务A: 0s 开始 → 5s 结束
// 任务B: 5s 开始 → 10s 结束（不管任务A何时结束）

// scheduleWithFixedDelay：固定间隔（任务结束到开始间隔固定）
// 任务A: 0s 开始 → 5s 结束
// 任务B: 7s 开始 → 12s 结束（5s + 2s 延迟）
```

---

## 四种线程池对比

| 线程池 | 核心线程 | 最大线程 | 队列类型 | 适用场景 |
|-------|---------|---------|---------|---------|
| Fixed | N | N | LinkedBQ（无界） | 任务平缓、资源可控 |
| Cached | 0 | Integer.MAX_VALUE | SynchronousQ | 短任务、突发流量 |
| Single | 1 | 1 | LinkedBQ（无界） | 任务串行、需要顺序 |
| Scheduled | coreSize | Integer.MAX_VALUE | DelayedWQ | 定时任务、周期任务 |

---

## 为什么不推荐用 Executors？

### 问题总结

| 线程池 | 问题 | 风险 |
|-------|------|------|
| Fixed | 无界队列 | 任务堆积 → OOM |
| Cached | 无上限线程 | 高并发 → OOM |
| Single | 无界队列 | 任务堆积 → OOM |
| Scheduled | 无上限线程 | 高并发 → OOM |

### 正确做法

```java
// 不推荐
ExecutorService bad = Executors.newFixedThreadPool(10);

// 推荐：显式指定参数
ExecutorService good = new ThreadPoolExecutor(
    10,                     // 核心线程数
    20,                     // 最大线程数
    60L, TimeUnit.SECONDS,  // 空闲时间
    new LinkedBlockingQueue&lt;&gt;(100),  // 有界队列
    new ThreadFactory() {  // 自定义线程工厂
        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r);
            t.setName("business-pool-" + t.getId());
            return t;
        }
    },
    new ThreadPoolExecutor.AbortPolicy()  // 拒绝策略
);
```

---

## 面试追问方向

1. **SynchronousQueue 为什么不存储元素？**
   它的 `put()` 必须等 `take()` 才能完成。适合需要立即执行任务的场景（`newCachedThreadPool`）。

2. **newSingleThreadExecutor 为什么包装了一层 FinalizableDelegator？**
   为了在 GC 时确保线程池被关闭，防止内存泄漏。

3. **ScheduledThreadPool 的最大线程数为什么是 Integer.MAX_VALUE？**
   因为定时任务的特性——大量任务是延迟的，不会同时执行。但也带来了 OOM 风险。

4. **scheduleAtFixedRate 会因为任务执行时间长而堆积吗？**
   如果任务执行时间 > 间隔时间，下次任务会延迟开始（不会并发执行同一个任务）。

5. **如何安全地关闭线程池？**
   - `shutdown()`：停止接受新任务，等待队列和正在执行的任务完成
   - `shutdownNow()`：尝试停止所有正在执行的任务，不再新任务，返回等待队列中的任务
