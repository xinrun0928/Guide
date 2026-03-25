# CountDownLatch：线程倒计时协调

想象运动会的场景：

> 100米赛跑，8名选手准备就绪。
> 发令枪响 → 8名选手同时起跑。
> 最后一名冲过终点 → 比赛结束计时。

**CountDownLatch** 就是这个「发令枪」——让一个或多个线程等待，直到倒计时归零。

---

## 核心概念

```
CountDownLatch 核心机制：
- 初始化时设置计数 N
- 每调用一次 countDown()，计数 -1
- await() 的线程阻塞，直到计数为 0
- 计数归零后，不会重置（一次性）
```

---

## 基本用法

### 场景：等待所有子任务完成

```java
public class 任务汇总 {
    private final CountDownLatch latch;

    public 任务汇总(int taskCount) {
        // 初始化计数
        this.latch = new CountDownLatch(taskCount);
    }

    public void doTasks() throws InterruptedException {
        ExecutorService executor = Executors.newFixedThreadPool(5);

        for (int i = 0; i &lt; 10; i++) {
            final int taskId = i;
            executor.submit(() -&gt; {
                try {
                    System.out.println("任务 " + taskId + " 执行中...");
                    Thread.sleep((long) (Math.random() * 1000));
                    System.out.println("任务 " + taskId + " 完成");
                } finally {
                    // 必须调用，即使异常也要
                    latch.countDown();
                }
            });
        }

        // 等待所有任务完成
        System.out.println("等待所有任务完成...");
        latch.await(); // 阻塞在这里
        System.out.println("所有任务已完成！开始汇总...");

        executor.shutdown();
    }
}
```

### 场景：模拟并发请求

```java
public class 并发测试 {
    public static void main(String[] args) throws InterruptedException {
        int concurrentUsers = 100;
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch endLatch = new CountDownLatch(concurrentUsers);

        ExecutorService executor = Executors.newFixedThreadPool(concurrentUsers);

        for (int i = 0; i &lt; concurrentUsers; i++) {
            executor.submit(() -&gt; {
                try {
                    // 等待发令枪
                    startLatch.await();
                    // 执行请求
                    doRequest();
                } finally {
                    endLatch.countDown();
                }
            });
        }

        System.out.println("准备开始并发测试");
        Thread.sleep(1000); // 准备时间
        System.out.println("发令枪响！");
        startLatch.countDown(); // 所有人都开始

        endLatch.await(); // 等待所有人完成
        System.out.println("测试完成");
        executor.shutdown();
    }

    private static void doRequest() {
        // 模拟HTTP请求
    }
}
```

**应用场景**：压测工具，确保所有线程「同时」发起请求。

---

## 原理分析

### 基于 AQS 实现

```java
// 简化版原理
public class CountDownLatch {
    private final Sync sync;

    private static final class Sync extends AbstractQueuedSynchronizer {
        protected int tryAcquireShared(int acquires) {
            // 计数为0才能获取成功
            return getState() == 0 ? 1 : -1;
        }

        protected boolean tryReleaseShared(int releases) {
            // 计数减1
            for (;;) {
                int c = getState();
                if (c == 0) return false;
                int next = c - 1;
                if (compareAndSetState(c, next)) {
                    return next == 0; // 归零时唤醒等待线程
                }
            }
        }
    }

    public void await() throws InterruptedException {
        sync.acquireSharedInterruptibly(1);
    }

    public void countDown() {
        sync.releaseShared(0);
    }
}
```

---

## 适用场景

### 场景1：多线程数据汇总

```java
public class 数据汇总 {
    private final CountDownLatch latch;
    private final Map&lt;String, Integer&gt; results = new ConcurrentHashMap&lt;&gt;();

    public 数据汇总(int departmentCount) {
        this.latch = new CountDownLatch(departmentCount);
    }

    public int getTotalSales() throws InterruptedException {
        // 并行查询各地区数据
        String[] regions = {"华北", "华东", "华南", "西南"};
        for (String region : regions) {
            new Thread(() -&gt; {
                int sales = querySales(region);
                results.put(region, sales);
                latch.countDown();
            }).start();
        }

        latch.await();
        return results.values().stream().mapToInt(Integer::intValue).sum();
    }

    private int querySales(String region) {
        return 100; // 模拟查询
    }
}
```

### 场景2：线程依赖协调

```java
// 场景：主线程等待所有初始化完成
public class 应用初始化 {
    private final CountDownLatch initLatch = new CountDownLatch(3);

    public void init() throws InterruptedException {
        new Thread(() -&gt; { loadConfig(); initLatch.countDown(); }).start();
        new Thread(() -&gt; { connectDB(); initLatch.countDown(); }).start();
        new Thread(() -&gt; { initCache(); initLatch.countDown(); }).start();

        initLatch.await(); // 等待所有初始化完成
        System.out.println("应用启动完成");
    }
}
```

---

## 常见陷阱

### 陷阱1：计数设置错误

```java
// 错误：10个任务，9个 countDown
for (int i = 0; i &lt; 10; i++) {
    executor.submit(() -&gt; {
        // 忘记某个任务没有调用
        if (i == 5) return; // 直接退出，没有 countDown
        latch.countDown();
    });
}
latch.await(); // 永远阻塞
```

### 陷阱2：await() 在 countDown() 之后

```java
// 错误：主线程太快
latch.countDown(); // 另一个线程还没开始
latch.await(); // 此时计数可能还没减
```

### 陷阱3：不能重置

```java
CountDownLatch latch = new CountDownLatch(1);
latch.countDown();
// latch.countDown(); 多次调用只有第一次有效
// 想要重置？用 CyclicBarrier
```

---

## CountDownLatch vs CyclicBarrier

| 特性 | CountDownLatch | CyclicBarrier |
|------|---------------|---------------|
| 计数方向 | 只减 | 可加减 |
| 能否重置 | 不能（一次性） | 能（循环使用） |
| 等待者 | 调用 await() 等待 | 调用 await() 等待 |
| 唤醒时机 | 计数为0时唤醒等待者 | 所有线程都到达后唤醒 |
| 典型场景 | 等待N个任务完成 | N个线程相互等待 |

**记忆技巧**：
- CountDownLatch = 倒计时 → 发射火箭
- CyclicBarrier = 循环栅栏 → 组队打副本

---

## 面试追问方向

1. **CountDownLatch 能否重置？**
   不能。CountDownLatch 是**一次性**的，计数归零后不可恢复。如果需要重置，用 CyclicBarrier。

2. **countDown() 调用多次会怎样？**
   只有第一次有效，后续调用无效。如果需要累加，用 CyclicBarrier 或自己维护计数器。

3. **await() 能否设置超时？**
   可以。用 `await(long timeout, TimeUnit unit)`，超时返回 false。

4. **CountDownLatch 的底层实现？**
   基于 AQS（AbstractQueuedSynchronizer）。使用共享模式，多个线程等待同一把锁。

5. **如果 countDown() 在 await() 之前调用？**
   计数已经为0，await() 不会阻塞，立即返回。这是合法的。

6. **什么场景用 CountDownLatch 而不是 Thread.join()？**
   - 需要等待**多个**任务完成
   - 需要**统一汇合点**
   - 需要**超时控制**
