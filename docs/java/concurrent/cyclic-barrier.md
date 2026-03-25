# CyclicBarrier：循环栅栏

想象组队打副本的场景：

> 5人副本，需要所有人到齐才能开打。
> 有人迟到，其他人等着。
> 打完一波，下一波继续等所有人到齐。

**CyclicBarrier** 就是这个「组队机制」——让一组线程相互等待，所有人都到齐后一起继续。

---

## 核心概念

```
CyclicBarrier 核心机制：
- 初始化时设置 parties = N（参与线程数）
- 每个线程调用 await() 表示「我到了」
- 当 N 个线程都调用了 await()，栅栏打开
- 栅栏可重置，继续下一轮（cyclic = 循环）
```

---

## 基本用法

### 场景：多线程分步计算

```java
public class 分步计算 {
    private final CyclicBarrier barrier;
    private final double[] data = new double[1000];

    public 分步计算() {
        // 4个线程参与
        barrier = new CyclicBarrier(4, () -&gt; {
            // 栅栏打开时执行（可选）
            System.out.println("所有线程完成，准备下一步");
        });
    }

    public void process() throws InterruptedException {
        ExecutorService executor = Executors.newFixedThreadPool(4);

        for (int i = 0; i &lt; 4; i++) {
            final int threadId = i;
            executor.submit(() -&gt; {
                try {
                    // 第一步：加载数据
                    loadData(threadId);
                    barrier.await(); // 等待所有人

                    // 第二步：计算
                    calculate(threadId);
                    barrier.await(); // 等待所有人

                    // 第三步：汇总
                    summarize(threadId);
                    barrier.await(); // 等待所有人

                } catch (InterruptedException | BrokenBarrierException e) {
                    e.printStackTrace();
                }
            });
        }

        executor.shutdown();
    }

    private void loadData(int id) throws InterruptedException {
        System.out.println("线程" + id + " 加载数据");
        Thread.sleep(100);
    }

    private void calculate(int id) throws InterruptedException {
        System.out.println("线程" + id + " 计算");
        Thread.sleep(100);
    }

    private void summarize(int id) throws InterruptedException {
        System.out.println("线程" + id + " 汇总");
        Thread.sleep(100);
    }
}
```

**输出示例**：

```
线程0 加载数据
线程1 加载数据
线程2 加载数据
线程3 加载数据
所有线程完成，准备下一步
线程2 计算
线程1 计算
线程3 计算
线程0 计算
所有线程完成，准备下一步
线程0 汇总
...
```

---

## 与 CountDownLatch 的区别

| 特性 | CountDownLatch | CyclicBarrier |
|------|---------------|---------------|
| 用途 | 一个线程等N个线程 | N个线程相互等 |
| 计数方向 | 只减 | 可重置（循环） |
| 能否重置 | 不能 | 能 |
| 等待者 | 主线程等待 | 所有线程互相等 |
| 典型场景 | 火箭发射 | 组队打副本 |

```java
// CountDownLatch：等火箭准备好
new CountDownLatch(1).await();

// CyclicBarrier：等人到齐
new CyclicBarrier(5).await();
```

---

## 实战：多线程排序

```java
public class 并行排序 {
    private final int[] array;
    private final CyclicBarrier barrier;

    public 并行排序(int[] array, int threadCount) {
        this.array = array;
        this.barrier = new CyclicBarrier(threadCount, this::onComplete);
    }

    public void sort() throws InterruptedException {
        int segmentSize = array.length / threadCount;
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);

        for (int i = 0; i &lt; threadCount; i++) {
            final int start = i * segmentSize;
            final int end = (i == threadCount - 1) ? array.length : start + segmentSize;
            executor.submit(() -&gt; Arrays.sort(array, start, end));
        }

        barrier.await(); // 等待所有段排序完成
        executor.shutdown();

        // 合并各段有序数组
        mergeSort();
    }

    private void onComplete() {
        System.out.println("所有段排序完成，开始合并");
    }

    private void mergeSort() {
        // 实际合并逻辑
    }
}
```

---

## 原理分析

### 内部结构

```java
// 简化版 CyclicBarrier 实现
public class CyclicBarrier {
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition trip = lock.newCondition();
    private final int parties; // 参与线程数
    private int count; // 剩余等待数
    private Generation generation = new Generation();

    public CyclicBarrier(int parties) {
        this(parties, null);
    }

    public CyclicBarrier(int parties, Runnable barrierAction) {
        this.parties = parties;
        this.count = parties;
        this.barrierCommand = barrierAction;
    }

    public int await() throws InterruptedException, BrokenBarrierException {
        lock.lock();
        try {
            int index = --count;
            if (index == 0) {
                // 所有线程到达，执行 barrierCommand
                nextGeneration();
                return 0;
            }
            // 否则等待
            for (;;) {
                try {
                    trip.await();
                    return index;
                } catch (InterruptedException e) {
                    if (generation.broken) throw e;
                }
            }
        } finally {
            lock.unlock();
        }
    }

    private void nextGeneration() {
        trip.signalAll(); // 唤醒所有等待线程
        count = parties; // 重置计数
        generation = new Generation();
    }
}
```

---

## BrokenBarrierException

如果某个线程在等待期间被中断，或者栅栏被重置，会抛出 BrokenBarrierException：

```java
public class 异常处理 {
    public static void main(String[] args) {
        CyclicBarrier barrier = new CyclicBarrier(3);

        Thread t1 = new Thread(() -&gt; {
            try {
                barrier.await();
            } catch (Exception e) {
                System.out.println("线程1发现栅栏坏了");
            }
        });

        Thread t2 = new Thread(() -&gt; {
            try {
                barrier.await();
            } catch (Exception e) {
                System.out.println("线程2发现栅栏坏了");
            }
        });

        t1.start();
        t2.start();

        // 模拟超时或重置
        try { Thread.sleep(100); } catch (InterruptedException e) {}
        barrier.reset(); // 重置会触发 BrokenBarrierException

        t1.join();
        t2.join();
    }
}
```

---

## reset() 方法

```java
CyclicBarrier barrier = new CyclicBarrier(3);

barrier.reset(); // 重置栅栏
// 会导致所有正在 await() 的线程收到 BrokenBarrierException
```

**什么时候用 reset()**：
- 定时任务超时
- 某个任务失败，需要重试
- 超时后重新开始下一轮

---

## 常见陷阱

### 陷阱1：线程数不匹配

```java
CyclicBarrier barrier = new CyclicBarrier(5);

// 只有4个线程来
// 会一直等待，永远无法通过
```

### 陷阱2：在 barrierAction 中抛异常

```java
CyclicBarrier barrier = new CyclicBarrier(3, () -&gt; {
    throw new RuntimeException("初始化失败");
});

// barrierAction 失败会破坏栅栏
// 后续 await() 都会失败
```

### 陷阱3：忘记异常处理

```java
// 错误
barrier.await();

// 正确
try {
    barrier.await();
} catch (InterruptedException | BrokenBarrierException e) {
    // 处理
}
```

---

## 适用场景

### 适合

- **多线程分步计算**：每步需要所有人完成
- **组队任务**：如游戏副本、批量处理
- **压力测试**：模拟同时发起请求
- **定期同步点**：如定期数据刷新

### 不适合

- 只需要等待 N 个任务完成（用 CountDownLatch）
- 需要单个线程控制（用信号量）
- 需要超时退出（用 CompletableFuture）

---

## 面试追问方向

1. **CyclicBarrier 为什么叫「循环」？**
   因为 reset() 后可以重复使用。每次等满 N 个线程后，会自动重置计数。

2. **CyclicBarrier 和 CountDownLatch 的核心区别？**
   CountDownLatch：主线程等子线程，一次性。
   CyclicBarrier：子线程互相等，可循环。

3. **BrokenBarrierException 什么时候发生？**
   - 另一个线程调用 reset()
   - 另一个线程等待时被中断
   - barrierAction 抛异常

4. **CyclicBarrier 的 barrierAction 有什么用？**
   所有线程到达后执行，常用于汇总计算结果、记录日志等。

5. **CyclicBarrier 能否只等待部分线程？**
   不能。必须所有 parties 都到达才会通过。如果需要部分等待，用 Semaphore。
