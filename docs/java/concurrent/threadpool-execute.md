# 线程池执行流程与状态转换

当你向线程池提交一个任务，它经历了什么？

这个问题，90% 的面试者只会背流程图。

但我想让你理解**为什么这样设计**。

---

## 任务提交流程

### 核心流程图

```
                    ┌─────────────────────────────────────────────┐
                    │              任务提交到线程池                  │
                    └─────────────────────────────────────────────┘
                                        │
                                        ▼
                    ┌─────────────────────────────────────────────┐
                    │     running &amp;&amp; poolSize &lt; corePoolSize ?     │
                    └─────────────────────────────────────────────┘
                           │                        │
                          是                        否
                           ▼                        │
           ┌──────────────────────────┐              │
           │   创建核心线程执行任务    │              │
           └──────────────────────────┘              │
                           │                        │
                           │                        ▼
                           │    ┌─────────────────────────────────────────┐
                           │    │           加入阻塞队列                    │
                           │    └─────────────────────────────────────────┘
                           │                        │
                           │                        ▼
                           │    ┌─────────────────────────────────────────┐
                           │    │       队列满 &amp;&amp; poolSize &lt; max ?      │
                           │    └─────────────────────────────────────────┘
                           │           │                    │
                           │          是                    否
                           │           ▼                    │
                           │  ┌────────────────────┐       │
                           │  │ 创建非核心线程执行   │       │
                           │  └────────────────────┘       │
                           │           │                    │
                           │           │                    ▼
                           │           │     ┌─────────────────────────┐
                           │           │     │    触发拒绝策略          │
                           │           │     └─────────────────────────┘
                           │           │
                           └───────────┴──────────────────────────────────┘
```

### 代码实现

```java
public void execute(Runnable command) {
    if (command == null) throw new NullPointerException();

    int c = ctl.get();

    // 步骤1：核心线程数未满，创建核心线程
    if (workerCountOf(c) &lt; corePoolSize) {
        if (addWorker(command, true))  // true = 创建核心线程
            return;
        c = ctl.get();
    }

    // 步骤2：核心线程满了，加入阻塞队列
    if (isRunning(c) &amp;&amp; workQueue.offer(command)) {
        int recheck = ctl.get();

        // 双重检查：可能线程池刚才被关闭了
        if (!isRunning(recheck) &amp;&amp; remove(command)) {
            reject(command);  // 拒绝
        } else if (workerCountOf(recheck) == 0) {
            // 队列非空但没有线程，补一个
            addWorker(null, false);
        }
    }

    // 步骤3：队列满了，尝试创建非核心线程
    else if (!addWorker(command, false))  // false = 非核心线程
        reject(command);  // 步骤4：拒绝
}
```

### 关键点解释

**为什么先创建核心线程，再加入队列？**

因为线程创建后可以复用，执行多个任务。如果先占满队列，线程可能在大部分时间空闲。

**为什么加入队列后还要双重检查？**

因为加入队列和检查线程池状态不是原子操作。检查通过后，线程池可能被关闭了。

**为什么用 `addWorker(null, false)`？**

队列非空但没有线程（核心线程都被回收了），需要补一个非核心线程来消费队列。

---

## 线程池五种状态

### 状态定义

```java
private final AtomicInteger ctl = new AtomicInteger(ctlOf(RUNNING, 0));

// 高3位表示状态，低29位表示线程数
private static final int COUNT_BITS = Integer.SIZE - 3;  // 29
private static final int CAPACITY   = (1 &lt;&lt; COUNT_BITS) - 1;  // 约 5 亿

// 五种状态（按值从小到大）
private static final int RUNNING    = -1 &lt;&lt; COUNT_BITS;  // 111...
private static final int SHUTDOWN   =  0 &lt;&lt; COUNT_BITS;  // 000...
private static final int STOP       =  1 &lt;&lt; COUNT_BITS;  // 001...
private static final int TIDYING    =  2 &lt;&lt; COUNT_BITS;  // 010...
private static final int TERMINATED =  3 &lt;&lt; COUNT_BITS;  // 011...
```

### 状态含义

| 状态 | 值 | 说明 | 接受新任务 | 执行队列任务 |
|------|---|------|-----------|-------------|
| RUNNING | -536870912 | 接受新任务，处理队列任务 | ✅ | ✅ |
| SHUTDOWN | 0 | 不接受新任务，但处理队列任务 | ❌ | ✅ |
| STOP | 536870912 | 不接受新任务，不处理队列任务 | ❌ | ❌ |
| TIDYING | 1073741824 | 所有任务终止，terminated() 待执行 | ❌ | ❌ |
| TERMINATED | 1610612736 | terminated() 执行完成 | ❌ | ❌ |

### 状态转换图

```
                    ┌──────────────────────────────────────────────┐
                    │                  RUNNING                      │
                    │         接受新任务，处理队列任务                 │
                    └──────────────────────────────────────────────┘
                                        │
                         shutdown() / shutdownNow()
                                        │
                                        ▼
        ┌────────────────────────────────────────────────────────────┐
        │                      SHUTDOWN                               │
        │             不接受新任务，继续处理队列任务                     │
        │           (队列空 + 所有任务完成 → TIDYING)                  │
        └────────────────────────────────────────────────────────────┘
                                        │
                         shutdownNow() / 队列空+任务完成
                                        │
                                        ▼
        ┌────────────────────────────────────────────────────────────┐
        │                        STOP                                │
        │            不接受新任务，中断正在执行的任务                   │
        │              (所有任务完成 → TIDYING)                       │
        └────────────────────────────────────────────────────────────┘
                                        │
                                   所有任务完成
                                        │
                                        ▼
        ┌────────────────────────────────────────────────────────────┐
        │                       TIDYING                               │
        │            所有任务已完成，terminated() 待执行                │
        └────────────────────────────────────────────────────────────┘
                                        │
                                 terminated() 完成
                                        │
                                        ▼
        ┌────────────────────────────────────────────────────────────┐
        │                     TERMINATED                              │
        │                    完全终止，可以被复用                       │
        └────────────────────────────────────────────────────────────┘
```

---

## 状态转换详解

### RUNNING → SHUTDOWN

```java
// 调用 shutdown()
public void shutdown() {
    final ReentrantLock mainLock = this.mainLock;
    mainLock.lock();
    try {
        advanceRunState(SHUTDOWN);
        // 中断空闲线程
        interruptIdleWorkers();
        onShutdown(); // hook for ScheduledThreadPoolExecutor
    } finally {
        mainLock.unlock();
    }
    tryTerminate();
}
```

### SHUTDOWN → TIDYING

```java
// 队列为空 + 所有任务完成
if (runStateAtLeast(ctl.get(), STOP) == false
    &amp;&amp; workQueue.isEmpty()
    &amp;&amp; workerCountOf(ctl.get()) == 0) {
    advanceRunState(TIDYING);
    terminated();
}
```

### TIDYING → TERMINATED

```java
protected void terminated() {
    // 空实现，留给子类扩展
}

// 可以覆盖
@Override
protected void terminated() {
    System.out.println("线程池已终止");
}
```

---

## 优雅关闭

### shutdown()：不中断正在执行的任务

```java
ExecutorService executor = Executors.newFixedThreadPool(5);

// 提交任务
for (int i = 0; i &lt; 10; i++) {
    final int taskId = i;
    executor.submit(() -&gt; {
        Thread.sleep(1000);
        System.out.println("任务" + taskId + " 完成");
    });
}

// 优雅关闭：不接受新任务，但等待队列和执行中的任务完成
executor.shutdown();

try {
    // 等待所有任务完成，最多等 1 小时
    if (executor.awaitTermination(1, TimeUnit.HOURS)) {
        System.out.println("所有任务完成");
    } else {
        System.out.println("超时，还有些任务没完成");
    }
} catch (InterruptedException e) {
    executor.shutdownNow();
}
```

### shutdownNow()：中断正在执行的任务

```java
ExecutorService executor = Executors.newFixedThreadPool(5);

// 提交任务
for (int i = 0; i &lt; 10; i++) {
    executor.submit(() -&gt; {
        // 任务可能不会响应中断
        while (true) {
            // 需要检查中断状态
            if (Thread.currentThread().isInterrupted()) {
                return;
            }
        }
    });
}

// 强制关闭
List&lt;Runnable&gt; remainingTasks = executor.shutdownNow();
System.out.println("被取消的任务: " + remainingTasks.size());
```

### 两者的区别

| 方法 | 新任务 | 队列任务 | 执行中任务 | 返回值 |
|------|-------|---------|-----------|-------|
| shutdown() | 拒绝 | 继续执行 | 继续执行 | 无 |
| shutdownNow() | 拒绝 | 返回列表 | 尝试中断 | 未执行的任务 |

---

## 常见问题

### 问题一：任务执行异常会怎样？

```java
executor.submit(() -&gt; {
    throw new RuntimeException("任务异常");
});
// Future.get() 会抛出 ExecutionException
// 线程不会死，会继续执行下一个任务
```

### 问题二：核心线程会回收吗？

```java
// 默认不会
executor.allowCoreThreadTimeOut(true);  // 开启后核心线程也会回收
```

### 问题三：线程池可以被复用吗？

```java
// TERMINATED 状态后，可以重新提交任务吗？
executor.execute(task);  // 抛出 RejectedExecutionException
// 不行！需要创建新的线程池
```

---

## 面试追问方向

1. **为什么线程池状态要用高 3 位表示？**
   为了在一个 int 中同时存储状态和线程数。状态不常变化，需要较大的空间；线程数频繁变化，需要较少空间。

2. **为什么 SHUTDOWN 还要处理队列任务？**
   这是优雅关闭的设计。让正在执行的任务继续完成，不造成任务丢失。

3. **TIDYING 和 TERMINATED 的区别？**
   TIDYING 是过渡状态，此时 terminated() 钩子正在执行；TERMINATED 是 terminated() 执行完成后进入的最终状态。

4. **shutdown() 和 awaitTermination() 的关系？**
   shutdown() 启动关闭流程，awaitTermination() 等待关闭完成。两者配合实现优雅关闭。

5. **如何保证任务不被遗漏？**
   - 捕获 RejectedExecutionException 后重试
   - 使用 CallerRunsPolicy 让调用方执行
   - 使用 shutdownNow() 获取未执行的任务列表
