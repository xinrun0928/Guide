# AQS 实现 CountDownLatch 源码解析

`CountDownLatch`（倒计时门栓）是共享模式的典型实现。

今天通过源码，深入理解它的工作原理。

---

## CountDownLatch 是什么？

`CountDownLatch` 允许一个或多个线程等待，直到其他线程完成操作。

```
┌─────────────────────────────────────────────────────────────┐
│                   CountDownLatch 工作模型                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────┐                                              │
│   │         │ ← 初始值 n                                   │
│   │   n     │                                              │
│   │         │                                              │
│   └────┬────┘                                              │
│        │                                                   │
│   ┌────┴────┐                                              │
│   │ countDown()                                           │
│   │ 每次调用 n--                                           │
│   └─────────┘                                              │
│        │                                                   │
│        ↓                                                   │
│   ┌─────────┐                                              │
│   │ n == 0  │                                              │
│   │ await() │ ← 所有等待的线程被唤醒                        │
│   │ 放行！  │                                              │
│   └─────────┘                                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 典型用法

```java
import java.util.concurrent.CountDownLatch;

public class WorkerDemo {
    public static void main(String[] args) throws InterruptedException {
        int workerCount = 3;
        CountDownLatch latch = new CountDownLatch(workerCount);
        
        // 启动 3 个工作线程
        for (int i = 0; i < workerCount; i++) {
            final int workerId = i;
            new Thread(() -> {
                System.out.println("工人 " + workerId + " 开始工作");
                try {
                    Thread.sleep((long) (Math.random() * 1000));
                } catch (InterruptedException e) {}
                System.out.println("工人 " + workerId + " 完成工作");
                latch.countDown();  // 计数减 1
            }).start();
        }
        
        // 等待所有工人完成
        latch.await();
        System.out.println("所有工人都完成了，监工开始验收");
    }
}
```

---

## 源码解析

### 构造方法

```java
public class CountDownLatch {
    // 内部使用 Sync 同步器
    private final Sync sync;
    
    public CountDownLatch(int count) {
        if (count < 0) throw new IllegalArgumentException();
        this.sync = new Sync(count);
    }
    
    // Sync 继承 AQS
    private static final class Sync extends AbstractQueuedSynchronizer {
        Sync(int count) {
            // 设置同步状态为 count
            setState(count);
        }
    }
}
```

### await() 等待

```java
public void await() throws InterruptedException {
    sync.acquireSharedInterruptibly(1);
}

public final void acquireSharedInterruptibly(int arg) {
    if (Thread.interrupted()) {
        throw new InterruptedException();
    }
    
    // tryAcquireShared 由 Sync 实现
    if (tryAcquireShared(arg) < 0) {
        // 获取失败（count != 0），进入等待队列
        doAcquireSharedInterruptibly(arg);
    }
}
```

### tryAcquireShared()

```java
// Sync.tryAcquireShared()
protected int tryAcquireShared(int arg) {
    // state == 0 表示倒计时结束，可以获取
    // 返回 1 表示成功，负数表示失败
    return getState() == 0 ? 1 : -1;
}
```

### doAcquireSharedInterruptibly()

```java
private void doAcquireSharedInterruptibly(int arg) throws InterruptedException {
    // 加入队列尾部（共享模式）
    final Node node = addWaiter(Node.SHARED);
    boolean failed = true;
    
    try {
        for (;;) {
            final Node predecessor = node.predecessor();
            
            if (predecessor == head) {
                // 前驱是头节点，尝试获取
                int r = tryAcquireShared(arg);
                
                if (r >= 0) {
                    // 获取成功，设置自己为头节点
                    setHeadAndPropagate(node, r);
                    predecessor.next = null;  // 帮助 GC
                    failed = false;
                    return;
                }
            }
            
            // 检查并阻塞
            if (shouldParkAfterFailedAcquire(predecessor, node)) {
                LockSupport.park(this);
                
                if (Thread.interrupted()) {
                    throw new InterruptedException();
                }
            }
        }
    } finally {
        if (failed) {
            cancelAcquire(node);
        }
    }
}
```

### countDown() 递减

```java
public void countDown() {
    sync.releaseShared(1);
}

public final boolean releaseShared(int arg) {
    // tryReleaseShared 由 Sync 实现
    if (tryReleaseShared(arg)) {
        // 释放成功，唤醒等待队列
        doReleaseShared();
        return true;
    }
    return false;
}
```

### tryReleaseShared()

```java
protected boolean tryReleaseShared(int arg) {
    for (;;) {
        int c = getState();
        
        // 如果已经是 0，不需要再减
        if (c == 0) {
            return false;
        }
        
        int nextc = c - 1;
        
        // CAS 更新 state
        if (compareAndSetState(c, nextc)) {
            // 只有减到 0 才返回 true
            return nextc == 0;
        }
    }
}
```

---

## 核心流程图

```
┌─────────────────────────────────────────────────────────────┐
│               CountDownLatch 工作流程                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  初始化：CountDownLatch latch = new CountDownLatch(3);     │
│                         ↓                                   │
│                    state = 3                               │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    await()                           │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  tryAcquireShared()                        │   │   │
│  │  │  state == 0 ? 1 : -1                       │   │   │
│  │  │         │                                  │   │   │
│  │  │         ├── 返回 1 → 成功，获取锁            │   │   │
│  │  │         │   → 返回                          │   │   │
│  │  │         │                                  │   │   │
│  │  │         └── 返回 -1 → 失败，加入队列         │   │   │
│  │  │             → 阻塞等待                        │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  countDown()                          │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  tryReleaseShared()                         │   │   │
│  │  │  state = state - 1                          │   │   │
│  │  │         │                                  │   │   │
│  │  │         └── state == 0 ? 唤醒队列            │   │   │
│  │  │             → doReleaseShared()             │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 传播唤醒机制

当 count 减到 0 时，所有等待的线程都会被唤醒：

```java
private void doReleaseShared() {
    for (;;) {
        Node h = head;
        
        if (h != null && h != tail) {
            int ws = h.waitStatus;
            
            if (ws == Node.SIGNAL) {
                // SIGNAL 状态，需要唤醒后继
                if (compareAndSetWaitStatus(h, Node.SIGNAL, 0)) {
                    unparkSuccessor(h);
                }
            } else if (ws == 0 &&
                       !compareAndSetWaitStatus(h, 0, Node.PROPAGATE)) {
                // 传播状态
            }
        }
        
        if (h == head) {
            break;
        }
    }
}
```

**传播机制的作用**：确保一个节点被唤醒后，会尝试唤醒后续的共享节点，形成链式传播。

---

## 使用场景

### 场景一：等待多个任务完成

```java
CountDownLatch latch = new CountDownLatch(5);

// 5 个线程并行计算
for (int i = 0; i < 5; i++) {
    new Thread(() -> {
        // 各自计算
        compute();
        latch.countDown();
    }).start();
}

// 等待所有计算完成
latch.await();
System.out.println("所有计算完成，汇总结果");
```

### 场景二：等待服务启动

```java
CountDownLatch latch = new CountDownLatch(1);

// 等待线程
new Thread(() -> {
    latch.await();
    System.out.println("服务已启动，开始处理请求");
}).start();

// 启动线程
new Thread(() -> {
    System.out.println("启动服务...");
    // 初始化资源
    init();
    latch.countDown();
}).start();
```

### 场景三：超时等待

```java
boolean completed = latch.await(5, TimeUnit.SECONDS);
if (completed) {
    System.out.println("所有任务完成");
} else {
    System.out.println("超时，部分任务未完成");
}
```

---

## 与 CyclicBarrier 对比

| 特性 | CountDownLatch | CyclicBarrier |
|-----|---------------|---------------|
| 用途 | 一个线程等待多个线程 | 多个线程相互等待 |
| 状态 | 不可重置，只能用一次 | 可以重置，循环使用 |
| 计数器 | 只能减，不能加 | 从 N 减到 0，可重置 |
| await() 调用者 | 任意线程 | 必须是参与线程 |

---

## 代码示例：模拟比赛开始

```java
import java.util.concurrent.*;

public class RaceDemo {
    public static void main(String[] args) throws InterruptedException {
        int runnerCount = 5;
        CountDownLatch startSignal = new CountDownLatch(1);  // 让运动员等待
        CountDownLatch endSignal = new CountDownLatch(runnerCount);  // 计时员等待
        
        // 运动员
        for (int i = 0; i < runnerCount; i++) {
            final int runnerId = i;
            new Thread(() -> {
                try {
                    System.out.println("运动员 " + runnerId + " 就位");
                    startSignal.await();  // 等待发令枪
                    System.out.println("运动员 " + runnerId + " 起跑");
                    Thread.sleep((long) (Math.random() * 1000));
                    System.out.println("运动员 " + runnerId + " 到达终点");
                } catch (InterruptedException e) {}
                finally {
                    endSignal.countDown();
                }
            }).start();
        }
        
        Thread.sleep(1000);
        System.out.println("发令枪响！");
        startSignal.countDown();  // 触发所有运动员起跑
        
        endSignal.await();  // 计时员等待所有运动员到达
        System.out.println("所有运动员到达，比赛结束");
    }
}
```

---

## 面试实战

**面试官问**：「CountDownLatch 的实现原理？」

**参考回答**：
> CountDownLatch 基于 AQS 的**共享模式**实现。
>
> 内部维护一个 `Sync`，它的 `state` 表示倒计时初始值。
>
> `await()` 调用 AQS 的 `acquireSharedInterruptibly()`，内部调用 `tryAcquireShared()` 检查 state 是否为 0。如果不是 0，线程加入等待队列并阻塞。
>
> `countDown()` 调用 `releaseShared()`，内部调用 `tryReleaseShared()` 让 state 减 1。只有 state 减到 0 时才返回 true，并唤醒所有等待队列中的线程。
>
> CountDownLatch 是不可重置的，因为 state 只会从大变小，不会恢复。

**追问**：「为什么叫倒计时门栓？」

**参考回答**：
> 想象一个门栓（latch）：
> - 门栓关闭时，门被锁住（await() 阻塞）
> - 每调用一次 countDown()，倒计时减 1
> - 倒计时减到 0，门栓打开（await() 返回）
>
> 一旦打开，门栓就废了，不能再用第二次。这和 CountDownLatch 只能使用一次是一致的。

---

## 总结

```
┌─────────────────────────────────────────────────────────────┐
│                 CountDownLatch 要点                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  基于 AQS 共享模式实现：                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  state = 初始计数值                                  │   │
│  │                                                     │   │
│  │  await()                                            │   │
│  │  └─ state == 0 ? 直接通过 : 加入队列阻塞            │   │
│  │                                                     │   │
│  │  countDown()                                        │   │
│  │  └─ state--                                        │   │
│  │     └─ state == 0 ? 唤醒所有等待线程                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  特点：                                                     │
│  - 一次性使用，计数不能恢复                                  │
│  - 可设置超时                                                │
│  - 支持中断                                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 留给你的思考题

分析以下代码的执行顺序：

```java
CountDownLatch latch = new CountDownLatch(2);

Thread t1 = new Thread(() -> {
    System.out.println("T1 开始");
    latch.countDown();
    System.out.println("T1 完成");
});

Thread t2 = new Thread(() -> {
    System.out.println("T2 开始");
    latch.countDown();
    System.out.println("T2 完成");
});

Thread t3 = new Thread(() -> {
    System.out.println("T3 等待");
    latch.await();
    System.out.println("T3 继续执行");
});

t1.start();
t2.start();
t3.start();
```

1. 可能的输出顺序是什么？
2. 如果 T1 和 T2 还没执行完，T3 会怎样？
3. 如果在 `latch.countDown()` 之前调用 `latch.await()`，会发生什么？
