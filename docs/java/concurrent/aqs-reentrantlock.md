# AQS 实现 ReentrantLock 源码解析

`ReentrantLock` 是最常用的并发工具之一，它是基于 AQS 实现的独占锁。

今天我们深入源码，看看它是怎么工作的。

---

## ReentrantLock 结构

```java
public class ReentrantLock implements Lock, java.io.Serializable {
    // 抽象同步器
    private final Sync sync;
    
    // 两种同步策略
    abstract static class Sync extends AbstractQueuedSynchronizer {
        abstract void lock();
        abstract boolean nonfairTryAcquire(int acquires);
        protected final boolean tryRelease(int releases) { ... }
    }
    
    // 非公平锁
    static final class NonfairSync extends Sync { ... }
    
    // 公平锁
    static final class FairSync extends Sync { ... }
}
```

---

## 公平锁 vs 非公平锁

```
┌─────────────────────────────────────────────────────────────┐
│                    公平 vs 非公平                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  公平锁（FairSync）                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  线程 A ──────────────────→ 获取锁                   │   │
│  │  线程 B ──────────────────→ 获取锁（排队）           │   │
│  │  线程 C ──────────────────→ 获取锁（排队）           │   │
│  │                                                     │   │
│  │  严格按顺序，FIFO                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  非公平锁（NonfairSync）                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  线程 A ──────────────────→ 获取锁                   │   │
│  │  线程 B ──────────────────→ 获取锁（排队）           │   │
│  │  线程 C ──获取锁 ✓  ←─ 新来的线程可能插队！          │   │
│  │                                                     │   │
│  │  可能插队，吞吐量高                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 非公平锁 tryAcquire()

```java
static final class NonfairSync extends Sync {
    protected final boolean tryAcquire(int acquires) {
        return nonfairTryAcquire(acquires);
    }
}

final boolean nonfairTryAcquire(int acquires) {
    // 获取当前线程
    final Thread current = Thread.currentThread();
    
    // 获取同步状态
    int c = getState();
    
    // state == 0：锁空闲，尝试获取
    if (c == 0) {
        // CAS 尝试修改 state
        if (compareAndSetState(0, acquires)) {
            // 成功，设置持有锁的线程
            setExclusiveOwnerThread(current);
            return true;
        }
    }
    
    // state != 0：锁已被占用
    // 判断是否是同一个线程
    else if (current == getExclusiveOwnerThread()) {
        // 同一线程重入，state + 重入次数
        int nextc = c + acquires;
        setState(nextc);
        return true;
    }
    
    // 其他线程占用，失败
    return false;
}
```

**核心逻辑**：
1. 如果 state == 0，尝试 CAS 获取锁（**可能插队**）
2. 如果 state != 0 且是同一线程，重入
3. 否则失败

---

## 公平锁 tryAcquire()

```java
static final class FairSync extends Sync {
    protected final boolean tryAcquire(int acquires) {
        final Thread current = Thread.currentThread();
        int c = getState();
        
        if (c == 0) {
            // ========== 关键区别 ==========
            // 公平锁：检查队列中是否有前驱节点
            if (!hasQueuedPredecessors()) {
                // 没有前驱，尝试获取
                if (compareAndSetState(0, acquires)) {
                    setExclusiveOwnerThread(current);
                    return true;
                }
            }
            // ========== 关键区别 ==========
        }
        else if (current == getExclusiveOwnerThread()) {
            int nextc = c + acquires;
            setState(nextc);
            return true;
        }
        return false;
    }
}
```

**公平锁的额外检查**：

```java
public final boolean hasQueuedPredecessors() {
    Node t = tail;
    Node h = head;
    Node s;
    
    // 队列不为空，且头节点的后继不是当前线程
    return h != t &&
        ((s = h.next) == null || s.thread != Thread.currentThread());
}
```

---

## tryRelease() 释放锁

```java
protected final boolean tryRelease(int releases) {
    // 减去释放的计数
    int c = getState() - releases;
    
    // 只有持有锁的线程才能释放
    if (Thread.currentThread() != getExclusiveOwnerThread()) {
        throw new IllegalMonitorStateException();
    }
    
    boolean free = false;
    
    // state 变为 0，表示完全释放
    if (c == 0) {
        free = true;
        setExclusiveOwnerThread(null);
    }
    
    setState(c);
    return free;
}
```

**关键点**：
- 只有持有锁的线程才能释放
- state 减到 0 时才完全释放，唤醒后继节点

---

## lock() 方法

```java
// 非公平锁的 lock()
public void lock() {
    sync.lock();
}

// NonfairSync
static final class NonfairSync extends Sync {
    final void lock() {
        // 直接尝试 CAS 获取锁（插队）
        if (compareAndSetState(0, 1))
            setExclusiveOwnerThread(Thread.currentThread());
        else
            acquire(1);
    }
}

// FairSync
static final class FairSync extends Sync {
    final void lock() {
        // 直接调用 AQS 的 acquire（会检查队列）
        acquire(1);
    }
}
```

---

## 可重入原理

```java
// 线程 A 连续调用 lock() 三次
lock();   // state: 0 → 1
lock();   // state: 1 → 2
lock();   // state: 2 → 3

// state = 3 表示线程 A 重入了 3 次
// 必须调用 unlock() 三次才能完全释放

unlock(); // state: 3 → 2
unlock(); // state: 2 → 1
unlock(); // state: 1 → 0，唤醒后继线程
```

---

## 完整流程图

```
┌─────────────────────────────────────────────────────────────┐
│              ReentrantLock 非公平锁获取流程                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   lock() 被调用                                            │
│         ↓                                                  │
│   ┌───────────────────────────────────────┐              │
│   │  compareAndSetState(0, 1)             │              │
│   │         │                              │              │
│   │         ├── 成功 → setExclusiveOwner   │              │
│   │         │   → 返回                      │              │
│   │         │                              │              │
│   │         └── 失败 → acquire(1)          │              │
│   └───────────────────────────────────────┘              │
│         ↓                                                  │
│   ┌───────────────────────────────────────┐              │
│   │  tryAcquire(1)                        │              │
│   │         │                              │              │
│   │         ├── state == 0？               │              │
│   │         │   → CAS 获取                 │              │
│   │         │                              │              │
│   │         ├── 同一线程重入？             │              │
│   │         │   → state++                 │              │
│   │         │                              │              │
│   │         └── 其他线程？                 │              │
│   │             → 返回 false，排队等待      │              │
│   └───────────────────────────────────────┘              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 代码示例

```java
import java.util.concurrent.locks.ReentrantLock;

public class ReentrantLockDemo {
    private final ReentrantLock lock = new ReentrantLock();
    private int counter = 0;
    
    public void increment() {
        lock.lock();
        try {
            counter++;
        } finally {
            lock.unlock();  // 必须在 finally 中释放
        }
    }
    
    public void incrementWithTryLock() {
        // 尝试获取锁，最多等 1 秒
        try {
            if (lock.tryLock(1, TimeUnit.SECONDS)) {
                try {
                    counter++;
                } finally {
                    lock.unlock();
                }
            } else {
                System.out.println("获取锁失败");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
    
    public static void main(String[] args) throws InterruptedException {
        ReentrantLockDemo demo = new ReentrantLockDemo();
        
        Thread[] threads = new Thread[100];
        for (int i = 0; i < 100; i++) {
            threads[i] = new Thread(demo::increment);
            threads[i].start();
        }
        
        for (Thread t : threads) {
            t.join();
        }
        
        System.out.println("Counter: " + demo.counter);  // 一定是 100
    }
}
```

---

## 与 synchronized 对比

| 特性 | ReentrantLock | synchronized |
|-----|--------------|--------------|
| 公平性 | 支持公平/非公平 | 非公平 |
| tryLock | 支持超时/可中断 | 不支持 |
| Condition | 支持多个 Condition | 只有一个 |
| 性能 | JDK 6+ 已优化，差异不大 | 已优化 |
| 释放方式 | 必须手动 unlock() | 自动释放 |

---

## 面试实战

**面试官问**：「ReentrantLock 怎么实现可重入的？」

**参考回答**：
> ReentrantLock 通过 AQS 的 state 实现可重入。
>
> 当同一线程再次获取锁时，`tryAcquire()` 检查是否是同一线程持有：
> - 如果是，state + 1
> - 释放时 state - 1
> - 只有 state 减到 0 才完全释放
>
> 每个线程记录自己的重入次数，而不是简单的是/否。

**追问**：「公平锁和非公平锁的区别？」

**参考回答**：
> 核心区别在于**是否允许插队**。
>
> **非公平锁**：尝试获取时直接 CAS，不管队列里有没有人等待。如果 CAS 成功就插队成功。
>
> **公平锁**：获取锁前先检查队列，如果队列里有人比自己早来，就乖乖排队。
>
> 公平锁用 `hasQueuedPredecessors()` 检查队列。
>
> 非公平锁性能更好（减少线程切换），但可能导致饥饿。公平锁不会饥饿，但性能稍差。

---

## 总结

```
┌─────────────────────────────────────────────────────────────┐
│                   ReentrantLock 要点                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  两种实现：                                                  │
│  ┌──────────────────┬──────────────────────────────────┐   │
│  │  NonfairSync     │  FairSync                        │   │
│  ├──────────────────┼──────────────────────────────────┤   │
│  │  lock() 直接 CAS │  lock() 调用 acquire()           │   │
│  │  可能插队         │  检查 hasQueuedPredecessors()     │   │
│  │  吞吐量高         │  不会饥饿                        │   │
│  └──────────────────┴──────────────────────────────────┘   │
│                                                             │
│  可重入实现：                                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  state > 0 + 同一线程 → state++                    │   │
│  │  state == 0 → 完全释放，唤醒后继                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 留给你的思考题

分析以下代码的输出：

```java
ReentrantLock lock = new ReentrantLock();

public void method1() {
    lock.lock();
    try {
        System.out.println("method1");
        method2();
    } finally {
        lock.unlock();
    }
}

public void method2() {
    lock.lock();
    try {
        System.out.println("method2");
    } finally {
        lock.unlock();
    }
}

// 线程 A 调用 method1()
```

1. method1() 能成功获取锁吗？
2. method2() 能成功获取锁吗？
3. 一共调用了几次 lock() 和 unlock()？
4. 最终 state 是多少？

（提示：考虑可重入特性）
