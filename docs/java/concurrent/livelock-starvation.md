# 活锁与饥饿

死锁大家都熟悉，但还有两种容易被忽略的问题：**活锁**和**饥饿**。

很多人把它们混为一谈，其实完全不是一回事。

---

## 三个概念对比

```
┌─────────────────────────────────────────────────────────────┐
│                  三种线程问题对比                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  死锁（Deadlock）                                           │
│  ├─ 线程都在等待对方释放锁                                    │
│  ├─ 线程状态：BLOCKED（阻塞）                                │
│  ├─ 程序表现：完全卡住，不消耗 CPU                           │
│  └─ 需要干预才能恢复                                        │
│                                                             │
│  活锁（Livelock）                                           │
│  ├─ 线程都在「主动」让步，但无法前进                          │
│  ├─ 线程状态：RUNNABLE（运行中）                            │
│  ├─ 程序表现：一直在跑，但不产生结果                          │
│  └─ 消耗 CPU，但无法完成任务                                │
│                                                             │
│  饥饿（Starvation）                                         │
│  ├─ 线程能获得锁，但永远轮不到它                             │
│  ├─ 线程状态：RUNNABLE 或 WAITING                           │
│  ├─ 程序表现：某些线程永远不执行                             │
│  └─ 看起来在运行，但部分功能失效                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 活锁（Livelock）

### 什么是活锁？

**活锁**：线程没有被阻塞，但由于某种机制，它们一直在「主动」让步，导致无法继续执行。

**关键区别**：死锁是「被动等待」，活锁是「主动让步但无效」。

### 现实类比

```
走廊相遇：
┌─────────────────────────────────────┐
│                                     │
│   线程A ──────────→                 │
│   ◀─────────────── 线程B            │
│                                     │
│   A 往左让，B 也往左让               │
│   A 往右让，B 也往右让               │
│   两人一直在让，但都过不去！          │
│                                     │
└─────────────────────────────────────┘
```

### 代码示例

```java
public class LivelockDemo {
    private static final AtomicBoolean transferA = new AtomicBoolean(true);
    private static final AtomicBoolean transferB = new AtomicBoolean(true);
    
    public static void main(String[] args) {
        // 线程 A：转账 A → B
        new Thread(() -> {
            while (true) {
                if (transferA.compareAndSet(true, false)) {
                    // 尝试获取资源
                    if (tryTransfer("A", "B", 100)) {
                        transferA.set(true);
                        break;
                    }
                }
                // 转让机会，但对方可能也做了同样的事
                transferA.set(true);
                Thread.yield();  // 让步
            }
        }).start();
        
        // 线程 B：转账 B → A
        new Thread(() -> {
            while (true) {
                if (transferB.compareAndSet(true, false)) {
                    if (tryTransfer("B", "A", 100)) {
                        transferB.set(true);
                        break;
                    }
                }
                transferB.set(true);
                Thread.yield();
            }
        }).start();
    }
}
```

### 经典场景：两个线程互相礼让

```java
public class PolitenessDemo {
    private final Object resource = new Object();
    private volatile boolean turnA = true;
    
    public void methodA() throws InterruptedException {
        while (true) {
            synchronized (resource) {
                if (turnA) {
                    // 使用资源
                    System.out.println("A 使用资源");
                    turnA = false;
                    return;
                }
            }
            // 礼让，让 B 先用
            Thread.sleep(1);
        }
    }
    
    public void methodB() throws InterruptedException {
        while (true) {
            synchronized (resource) {
                if (!turnA) {
                    System.out.println("B 使用资源");
                    turnA = true;
                    return;
                }
            }
            Thread.sleep(1);
        }
    }
}
```

**问题**：如果 A 和 B 总是同时判断，导致它们一直在互相礼让。

---

## 饥饿（Starvation）

### 什么是饥饿？

**饥饿**：线程需要获取某资源（如 CPU 时间片、锁），但由于竞争激烈或调度策略，它**永远得不到**。

### 饥饿的典型场景

#### 场景一：非公平锁导致饥饿

```java
// ReentrantLock 默认是非公平锁
ReentrantLock lock = new ReentrantLock();

public void doSomething() {
    lock.lock();
    try {
        // 长时间持有锁
        Thread.sleep(10000);
    } finally {
        lock.unlock();
    }
}

// 新来的线程可能插队，导致其他线程永远得不到锁
```

#### 场景二：低优先级线程饥饿

```java
Thread lowPriority = new Thread(() -> {
    while (true) {
        // 永远得不到 CPU 时间片
        System.out.println("Low priority");
    }
});
lowPriority.setPriority(Thread.MIN_PRIORITY);  // 优先级 1

Thread highPriority = new Thread(() -> {
    while (true) {
        System.out.println("High priority");
    }
});
highPriority.setPriority(Thread.MAX_PRIORITY);  // 优先级 10

lowPriority.start();
highPriority.start();
```

#### 场景三：线程池饥饿

```java
// 只有一个线程的线程池
ExecutorService executor = Executors.newSingleThreadExecutor();

// 如果这个线程死循环，其他任务永远无法执行
executor.submit(() -> {
    while (true) {}  // 线程卡住
});

executor.submit(() -> {
    // 这辈子都执行不到
});
```

---

## 解决方案

### 解决活锁

```java
// 方法一：随机退避
public void methodWithRandomBackoff() {
    Random random = new Random();
    while (true) {
        if (tryAcquire()) {
            // 做事情
            break;
        }
        // 随机等待，避免同步
        int delay = random.nextInt(1000);
        Thread.sleep(delay);
    }
}

// 方法二：固定顺序，不让步
public void methodNoYield() {
    while (true) {
        synchronized (resource) {
            // 不让步，直到成功
            if (canProceed()) {
                // 做事情
                break;
            }
        }
    }
}
```

### 解决饥饿

#### 方法一：使用公平锁

```java
// ReentrantLock 支持公平模式
ReentrantLock fairLock = new ReentrantLock(true);  // true = 公平

// 公平锁保证：先来先服务，不会插队
// 但性能比非公平锁差
```

#### 方法二：动态优先级调整

```java
// 长时间得不到调度的线程，提升优先级
class AdaptiveThread extends Thread {
    private int waitCount = 0;
    
    @Override
    public void run() {
        while (true) {
            synchronized (this) {
                waitCount++;
                if (waitCount > THRESHOLD) {
                    // 提升自己的优先级
                    int current = getPriority();
                    if (current < Thread.MAX_PRIORITY) {
                        setPriority(Math.min(current + 1, Thread.MAX_PRIORITY));
                    }
                    waitCount = 0;
                }
            }
        }
    }
}
```

#### 方法三：多线程池分散任务

```java
// 不用单线程池，用多线程池
ExecutorService executor = Executors.newFixedThreadPool(10);  // 10 个线程
```

---

## 三种问题的检测

```java
import java.lang.management.*;

public class ThreadHealthMonitor {
    public static void main(String[] args) {
        ThreadMXBean threadMXBean = ManagementFactory.getThreadMXBean();
        
        // 死锁检测
        long[] deadlocks = threadMXBean.findDeadlockedThreads();
        if (deadlocks != null) {
            System.out.println("检测到死锁！");
        }
        
        // 线程信息
        ThreadInfo[] infos = threadMXBean.dumpAllThreads(false, false);
        for (ThreadInfo info : infos) {
            // 检测长时间 BLOCKED/WAITING 的线程
            if (info.getThreadState() == Thread.State.BLOCKED ||
                info.getThreadState() == Thread.State.WAITING) {
                long waitTime = System.currentTimeMillis() - 
                               info.getLockOwnerId();
                if (waitTime > 60000) {  // 等待超过 1 分钟
                    System.out.println("警告：线程 " + info.getThreadName() + 
                                      " 等待时间过长，可能饥饿");
                }
            }
            
            // 检测 CPU 使用
            if (info.getThreadState() == Thread.State.RUNNABLE) {
                long cpuTime = info.getCpuTime();
                // 如果一个线程一直占用 CPU 但不产生有意义的结果
                // 可能是活锁
            }
        }
    }
}
```

---

## 面试实战

**面试官问**：「活锁和死锁有什么区别？」

**参考回答**：
> 死锁是线程被阻塞，相互等待对方释放锁。活锁是线程没有被阻塞，但由于某种机制（如互相礼让），它们一直在「主动」让步，导致无法继续。
>
> 举例子：
> - **死锁**：两个人面对面站着，都抱着胳膊让对方先过，结果都过不去。
> - **活锁**：两个人同时向左让，又同时向右让，一直在做让步，但都过不去。
>
> 从现象上看：死锁的线程是 BLOCKED 状态，不消耗 CPU；活锁的线程是 RUNNABLE 状态，消耗 CPU 但不产生结果。

**追问**：「怎么解决活锁？」

**参考回答**：
> 活锁的解决方法是打破「同步」。常见做法：
>
> 1. **随机退避**：让线程随机等待一段时间再重试，避免它们一直同步。
> 2. **固定顺序**：不让步，按固定顺序竞争资源。
> 3. **引入优先级**：有些线程可以让步，但有些线程不礼让。

---

## 总结

```
┌─────────────────────────────────────────────────────────────┐
│                 三种线程问题对比                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   死锁 vs 活锁 vs 饥饿                                       │
│                                                             │
│   ┌──────────┬───────────┬─────────────────────────────┐   │
│   │          │  死锁      │ 活锁                        │   │
│   ├──────────┼───────────┼─────────────────────────────┤   │
│   │ 原因     │ 相互等待   │ 相互让步                     │   │
│   │ 线程状态 │ BLOCKED   │ RUNNABLE                    │   │
│   │ CPU 消耗 │ 不消耗     │ 消耗                        │   │
│   │ 恢复方式 │ 需干预     │ 可能自动恢复                 │   │
│   └──────────┴───────────┴─────────────────────────────┘   │
│                                                             │
│   饥饿：                                                      │
│   - 原因：资源分配不公平                                      │
│   - 线程状态：RUNNABLE 或 WAITING                          │
│   - 解决方案：公平锁、优先级调整                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 留给你的思考题

下面代码存在什么问题？会导致死锁、活锁还是饥饿？

```java
public class BankAccount {
    private int balance = 1000;
    
    public synchronized void deposit(int amount) {
        balance += amount;
    }
    
    public synchronized void withdraw(int amount) {
        while (balance < amount) {
            try {
                wait();  // 等待余额足够
            } catch (InterruptedException e) {}
        }
        balance -= amount;
    }
    
    // 转账：获取两个账户的锁
    public static void transfer(BankAccount from, BankAccount to, int amount) {
        synchronized (from) {
            synchronized (to) {
                from.withdraw(amount);
                to.deposit(amount);
            }
        }
    }
}
```

如果同时调用 `transfer(A, B, 500)` 和 `transfer(B, A, 500)`，会发生什么？

（提示：考虑顺序获取锁的问题）
