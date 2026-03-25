# ScheduledThreadPoolExecutor 定时任务原理

普通的线程池只能执行「立即执行」的任务。

但实际场景中，我们经常需要：

- 「3 秒后执行」
- 「每 5 秒执行一次」
- 「任务完成后，延迟 2 秒再执行」

**ScheduledThreadPoolExecutor** 就是来解决这个问题的。

---

## 基本使用

### 四种调度方法

```java
ScheduledExecutorService executor = Executors.newScheduledThreadPool(5);

// 1. 延迟执行一次
ScheduledFuture&lt;?&gt; future1 = executor.schedule(
    () -&gt; System.out.println("3秒后执行"),
    3, TimeUnit.SECONDS
);

// 2. 固定频率（任务开始时间间隔固定）
ScheduledFuture&lt;?&gt; future2 = executor.scheduleAtFixedRate(
    () -&gt; System.out.println("每2秒执行"),
    1,   // 初始延迟
    2,   // 间隔
    TimeUnit.SECONDS
);

// 3. 固定间隔（任务结束到开始间隔固定）
ScheduledFuture&lt;?&gt; future3 = executor.scheduleWithFixedDelay(
    () -&gt; System.out.println("执行完成后等2秒"),
    0,   // 初始延迟
    2,   // 间隔
    TimeUnit.SECONDS
);

// 4. 取消任务
future1.cancel(false);
future2.cancel(true);
```

### scheduleAtFixedRate vs scheduleWithFixedDelay

```
scheduleAtFixedRate（固定频率）：
  T0: 任务A开始 ──────────── T5: 任务A结束
                                   T5: 任务B开始 ──────────── T10: 任务B结束
  ↑              ↑
  间隔2秒       间隔2秒（从开始时间算）

scheduleWithFixedDelay（固定间隔）：
  T0: 任务A开始 ──────────── T5: 任务A结束
                                        T7: 任务B开始 ──────────── T12: 任务B结束
  ↑              ↑                     ↑
  任务结束      延迟2秒                 延迟2秒
```

**哪个更好？**

| 方法 | 适用场景 | 问题 |
|------|---------|------|
| scheduleAtFixedRate | 任务执行时间稳定 | 如果任务超时，可能堆积 |
| scheduleWithFixedDelay | 任务执行时间不稳定 | 总间隔可能变长 |

---

## 内部原理

### DelayedWorkQueue：基于堆的延迟队列

```java
public class ScheduledThreadPoolExecutor extends ThreadPoolExecutor {
    // 使用延迟队列
    public ScheduledThreadPoolExecutor(int corePoolSize) {
        super(corePoolSize, Integer.MAX_VALUE, 0, NANOSECONDS,
              new DelayedWorkQueue());
    }
}
```

### 堆结构

```java
// DelayedWorkQueue 内部是最小堆（按延迟时间排序）
//        时间最小的在堆顶（最先被执行）

// 示例：任务A延迟3秒，任务B延迟5秒，任务C延迟1秒
//              [C:1s]
//             /        \
//         [A:3s]     [B:5s]
```

### 入队操作（offer）

```java
public boolean offer(Runnable x) {
    ScheduledFutureTask&lt;?&gt; task = (ScheduledFutureTask&lt;?&gt;) x;
    // ... 省略部分代码

    // 插入堆中
    siftUp(heapIndex, task);

    // 如果是新加入的最早任务，可能需要调整
    if (heapIndex == 0) {
        setIndex(heap, -1);  // 标记为队列头
    }
    return true;
}
```

### 出队操作（take）

```java
public RunnableScheduledFuture&lt;?&gt; take() throws InterruptedException {
    final ReentrantLock lock = this.lock;
    lock.lockInterruptibly();

    try {
        for (;;) {
            RunnableScheduledFuture&lt;?&gt; first = queue[0];

            if (first == null) {
                // 队列空，等待
                available.await();
            } else {
                long delay = first.getDelay(NANOSECONDS);

                if (delay &lt;= 0) {
                    // 延迟到了，取出执行
                    return finishPoll(first);
                }

                // 没到时间，继续等
                // leader 线程负责等待，其他人进入条件队列
                first.await(delay);
            }
        }
    } finally {
        lock.unlock();
    }
}
```

---

## ScheduledFutureTask

### 任务结构

```java
private class ScheduledFutureTask&lt;V&gt;
        extends FutureTask&lt;V&gt; implements RunnableScheduledFuture&lt;V&gt; {

    // 任务编号（用于FIFO排序）
    private final long sequenceNumber;

    // 任务执行时间（纳秒）
    private long time;

    // 重复间隔（纳秒）
    private final long period;

    // 任务被包装进堆的索引
    private int heapIndex;

    ScheduledFutureTask(Runnable r, V result, long triggerTime, long period) {
        super(r, result);
        this.time = triggerTime;
        this.period = period;
        this.sequenceNumber = sequencer.getAndIncrement();
    }

    // 比较：按时间排序
    public int compareTo(Delayed other) {
        if (other == this)
            return 0;
        if (other instanceof ScheduledFutureTask) {
            ScheduledFutureTask&lt;?&gt; x = (ScheduledFutureTask&lt;?&gt;) other;
            if (time &lt; x.time)
                return -1;
            if (time &gt; x.time)
                return 1;
            if (sequenceNumber &lt; x.sequenceNumber)
                return -1;
            return 1;
        }
        long diff = getDelay(NANOSECONDS) - other.getDelay(NANOSECONDS);
        return (diff &lt; 0) ? -1 : (diff &gt; 0) ? 1 : 0;
    }
}
```

### 周期性任务的处理

```java
protected void done() {
    // 任务完成后，检查是否需要重复执行
    if (period != 0) {
        if (period &gt; 0) {
            // scheduleAtFixedRate：按固定频率
            // 下次执行时间 = 当前时间 + period
            time += period;
        } else {
            // scheduleWithFixedDelay：按固定间隔
            // 下次执行时间 = 当前时间 - period（-period 就是延迟时间）
            time = TriggeringTimeNanos.now() - period;
        }
        // 重新放回队列
        scheduledExecute(reRunnable);
    }
}
```

---

## 性能分析

### 时间复杂度

| 操作 | 时间复杂度 |
|------|-----------|
| 入队（offer） | O(log n) |
| 出队（take/poll） | O(log n) |
| 获取最近任务（peek） | O(1) |

### 为什么不直接用 Timer？

```java
// Timer 的问题
Timer timer = new Timer();
// 1. 单线程，一个任务异常会导致所有任务失败
// 2. 不捕获任务异常
// 3. 不支持固定间隔（只有固定频率）
// 4. 任务顺序依赖系统时间，可能不准

// ScheduledThreadPoolExecutor 的优势
ScheduledExecutorService executor = Executors.newScheduledThreadPool(5);
// 1. 多线程，一个任务异常不影响其他
// 2. 线程被复用，效率更高
// 3. 支持 scheduleAtFixedRate 和 scheduleWithFixedDelay
// 4. 使用纳秒时间，更精确
```

---

## 常见陷阱

### 陷阱一：scheduleAtFixedRate 任务堆积

```java
// 危险示例
executor.scheduleAtFixedRate(() -&gt; {
    // 任务执行需要 10 秒
    Thread.sleep(10000);
}, 1, 2, TimeUnit.SECONDS);

// 期望：1s后开始，每2s执行一次
// 实际：1s后开始，10s后结束，11s后再次开始
// 因为下一次必须等上一次完成
```

**正确做法**：使用 scheduleWithFixedDelay

```java
executor.scheduleWithFixedDelay(() -&gt; {
    Thread.sleep(10000);
}, 1, 2, TimeUnit.SECONDS);
// 任务完成后，延迟2秒再执行
```

### 陷阱二：忘记取消任务

```java
ScheduledFuture&lt;?&gt; future = executor.scheduleAtFixedRate(...);

// 业务结束时忘记取消
future.cancel(true);  // 需要手动取消

// 或者用容器管理
Map&lt;String, ScheduledFuture&lt;?&gt;&gt; tasks = new ConcurrentHashMap&lt;&gt;();
```

### 陷阱三：关闭线程池时任务丢失

```java
ScheduledExecutorService executor = Executors.newScheduledThreadPool(5);

// 提交任务
executor.schedule(...);

// 关闭
executor.shutdown();  // 队列中的周期性任务会被丢弃

// 正确做法：等待任务完成
executor.shutdown();
executor.awaitTermination(1, TimeUnit.MINUTES);
```

---

## 适用场景

### 场景一：心跳检测

```java
public class 心跳检测 {
    private final ScheduledExecutorService executor = Executors.newScheduledThreadPool(2);

    public void startHeartbeat() {
        executor.scheduleAtFixedRate(() -&gt; {
            try {
                boolean alive = checkServerHealth();
                if (!alive) {
                    reconnect();
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        }, 0, 5, TimeUnit.SECONDS);
    }

    private boolean checkServerHealth() {
        return true;
    }

    private void reconnect() {
    }
}
```

### 场景二：缓存过期

```java
public class 缓存过期清理 {
    private final ScheduledExecutorService executor = Executors.newScheduledThreadPool(1);
    private final Map&lt;String, CacheEntry&gt; cache = new ConcurrentHashMap&lt;&gt;();

    public ScheduledFuture&lt;?&gt; put(String key, Object value, long ttlSeconds) {
        cache.put(key, new CacheEntry(value, ttlSeconds));
        // 延迟清理
        return executor.schedule(() -&gt; cache.remove(key), ttlSeconds, TimeUnit.SECONDS);
    }
}
```

---

## 面试追问方向

1. **ScheduledThreadPoolExecutor 用的是什么队列？**
   DelayedWorkQueue，一个基于最小堆实现的延迟队列。堆顶是最近要执行的任务。

2. **scheduleAtFixedRate 和 scheduleWithFixedDelay 的区别？**
   scheduleAtFixedRate 按固定频率，下一次任务的开始时间 = 上一次开始时间 + 间隔；scheduleWithFixedDelay 按固定间隔，下一次任务的开始时间 = 上一次结束时间 + 间隔。

3. **为什么 ScheduledThreadPoolExecutor 可以创建 Integer.MAX_VALUE 个线程？**
   定时任务的特性是延迟执行，不会同时执行很多线程。但这个设计有 OOM 风险，阿里规范建议使用有界队列。

4. **DelayedWorkQueue 为什么用堆而不是队列？**
   因为需要快速找到最近要执行的任务。堆的插入和删除都是 O(log n)，获取堆顶是 O(1)。

5. **定时任务不准怎么办？**
   - 使用 scheduleWithFixedDelay 而不是 scheduleAtFixedRate
   - 任务本身要快速完成
   - 增加线程池大小
   - 考虑使用 Quartz 等专业调度框架
