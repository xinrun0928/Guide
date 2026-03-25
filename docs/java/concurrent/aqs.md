# AQS 核心思想：state + FIFO 队列

如果你用过 `ReentrantLock`、`Semaphore`、`CountDownLatch`、`CyclicBarrier` 等并发工具，有没有想过它们是怎么实现的？

答案就是 **AQS**。

---

## AQS 是什么？

**AQS（AbstractQueuedSynchronizer）** 是 Java 并发包（JUC）的核心框架，几乎所有同步器的实现都基于它。

```
┌─────────────────────────────────────────────────────────────┐
│                     JUC 并发工具家族                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                     ┌───────────┐                          │
│                     │   AQS    │                          │
│                     └─────┬─────┘                          │
│                           │                                │
│         ┌─────────────────┼─────────────────┐              │
│         ↓                 ↓                 ↓              │
│   ┌───────────┐    ┌───────────┐    ┌───────────┐        │
│   │ReentrantLock│  │ Semaphore │    │CountDownLatch│      │
│   └───────────┘    └───────────┘    └───────────┘        │
│         │                 │                 │              │
│         ↓                 ↓                 ↓              │
│   ┌───────────┐    ┌───────────┐    ┌───────────┐        │
│   │Condition  │    │  ReadWriteLock│  │ CyclicBarrier │    │
│   └───────────┘    └───────────┘    └───────────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## AQS 的核心思想

AQS 的设计只有两个核心组件：

### 1. state（状态）

```java
// AQS 内部维护的同步状态
private volatile int state;
```

- `state = 0`：表示资源可用
- `state > 0`：表示资源被占用（或持有计数）
- 通过 `getState()`、`setState()`、`compareAndSetState()` 操作

### 2. FIFO 队列

```java
// 等待队列的头尾节点
private transient volatile Node head;
private transient volatile Node tail;
```

- 存储等待获取资源的线程
- 线程获取锁失败时，加入队列尾部
- 获取成功后，从队列头部移除

---

## Node 节点结构

```java
static final class Node {
    // 模式常量
    static final Node SHARED = new Node();   // 共享模式
    static final Node EXCLUSIVE = null;      // 独占模式
    
    // 等待状态
    static final int CANCELLED =  1;   // 取消
    static final int SIGNAL    = -1;   // 需要唤醒
    static final int CONDITION = -2;   // 等待条件
    static final int PROPAGATE = -3;   // 传播（共享模式）
    
    volatile int waitStatus;      // 等待状态
    volatile Node prev;           // 前驱节点
    volatile Node next;           // 后继节点
    volatile Thread thread;       // 封装的线程
    
    Node nextWaiter;             // 指向下一个等待节点
}
```

---

## 工作流程图

```
┌─────────────────────────────────────────────────────────────┐
│                       AQS 工作流程                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  线程 A 尝试获取锁：                                         │
│                                                             │
│  ┌─────────────────────────────────────────────┐           │
│  │  1. 调用 tryAcquire(arg)                    │           │
│  │  2. 如果成功，state++，线程 A 执行          │           │
│  │  3. 如果失败，线程 A 加入等待队列尾部        │           │
│  └─────────────────────────────────────────────┘           │
│                         ↓                                   │
│  ┌─────────────────────────────────────────────┐           │
│  │  等待队列（先进先出）                         │           │
│  │                                             │           │
│  │  HEAD         Node         Node         TAIL│           │
│  │  ┌────┐     ┌────┐      ┌────┐     ┌────┐│           │
│  │  │null│ ←→ │线程A│ ←→  │线程B│ ←→  │线程C││           │
│  │  └────┘     └────┘      └────┘     └────┘│           │
│  │   ↑                                         │           │
│  │   └──── 当前持有锁的线程                     │           │
│  └─────────────────────────────────────────────┘           │
│                         ↓                                   │
│  线程 A 释放锁：                                             │
│  ┌─────────────────────────────────────────────┐           │
│  │  1. 调用 tryRelease(arg)                    │           │
│  │  2. state--                                │           │
│  │  3. 唤醒队列头节点的后继线程                │           │
│  │  4. 线程 B 从 waiting 变为 running          │           │
│  └─────────────────────────────────────────────┘           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 独占模式 vs 共享模式

### 独占模式（Exclusive）

同一时刻只有一个线程能获取资源。

```
┌─────────────────────────────────────────────┐
│              独占模式示意                    │
├─────────────────────────────────────────────┤
│                                             │
│   线程A: 获取锁 ✓                          │
│   线程B: 等待...                            │
│   线程C: 等待...                            │
│   线程D: 等待...                            │
│                                             │
│   只有 A 能执行，其他只能排队                 │
│                                             │
│   代表：ReentrantLock                       │
│                                             │
└─────────────────────────────────────────────┘
```

### 共享模式（Shared）

多个线程可以同时获取资源。

```
┌─────────────────────────────────────────────┐
│              共享模式示意                    │
├─────────────────────────────────────────────┤
│                                             │
│   state = 3（3 个许可）                      │
│                                             │
│   线程A: 获取 1 个许可 ✓                    │
│   线程B: 获取 1 个许可 ✓                    │
│   线程C: 获取 1 个许可 ✓                    │
│   线程D: 需要 1 个许可，但没有了，等待...    │
│                                             │
│   多个线程可以同时执行                       │
│                                             │
│   代表：Semaphore、CountDownLatch           │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 模板方法模式

AQS 采用**模板方法模式**，定义了核心流程骨架：

```java
public abstract class AbstractQueuedSynchronizer
        extends AbstractOwnableSynchronizer implements java.io.Serializable {
    
    // 独占模式：获取资源（子类实现）
    protected boolean tryAcquire(int arg) {
        throw new UnsupportedOperationException();
    }
    
    // 独占模式：释放资源（子类实现）
    protected boolean tryRelease(int arg) {
        throw new UnsupportedOperationException();
    }
    
    // 共享模式：获取资源（子类实现）
    protected int tryAcquireShared(int arg) {
        throw new UnsupportedOperationException();
    }
    
    // 共享模式：释放资源（子类实现）
    protected boolean tryReleaseShared(int arg) {
        throw new UnsupportedOperationException();
    }
    
    // 判断是否被独占（子类实现）
    protected boolean isHeldExclusively() {
        throw new UnsupportedOperationException();
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 以下是 AQS 内部实现的模板方法，调用子类实现的方法
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    // 获取资源（独占）
    public final void acquire(int arg) {
        if (!tryAcquire(arg) &&
            acquireQueued(addWaiter(Node.EXCLUSIVE), arg)) {
            selfInterrupt();
        }
    }
    
    // 获取资源（共享）
    public final void acquireShared(int arg) {
        if (tryAcquireShared(arg) < 0) {
            doAcquireShared(arg);
        }
    }
    
    // 释放资源（独占）
    public final boolean release(int arg) {
        if (tryRelease(arg)) {
            Node h = head;
            if (h != null && h.waitStatus != 0) {
                unparkSuccessor(h);
            }
            return true;
        }
        return false;
    }
    
    // 释放资源（共享）
    public final boolean releaseShared(int arg) {
        if (tryReleaseShared(arg)) {
            doReleaseShared();
            return true;
        }
        return false;
    }
}
```

---

## acquire() 核心流程

```java
public final void acquire(int arg) {
    // 1. 先尝试获取锁
    if (!tryAcquire(arg)) {
        // 2. 获取失败，加入等待队列
        Node node = addWaiter(Node.EXCLUSIVE);
        
        // 3. 自旋尝试获取
        boolean interrupted = false;
        for (;;) {
            Node predecessor = node.prev;
            
            // 4. 如果前驱是头节点，再次尝试获取
            if (predecessor == head && tryAcquire(arg)) {
                setHead(node);
                predecessor.next = null;
                return;
            }
            
            // 5. 前驱不是头节点，检查并阻塞
            if (shouldParkAfterFailedAcquire(predecessor, node)) {
                LockSupport.park(this);
                interrupted = true;
            }
        }
    }
}
```

---

## acquireQueued() 自旋机制

```java
final boolean acquireQueued(final Node node, int arg) {
    boolean failed = true;
    try {
        boolean interrupted = false;
        for (;;) {
            final Node p = node.predecessor();
            
            // 如果前驱是头节点，尝试获取
            if (p == head && tryAcquire(arg)) {
                setHead(node);
                p.next = null;  // 帮助 GC
                failed = false;
                return interrupted;
            }
            
            // 检查是否需要阻塞
            if (shouldParkAfterFailedAcquire(p, node)) {
                // 阻塞，直到被唤醒
                LockSupport.park(this);
                
                // 被唤醒后，检查中断状态
                interrupted |= Thread.interrupted();
            }
        }
    } finally {
        if (failed) {
            cancelAcquire(node);
        }
    }
}
```

---

## 为什么需要自旋？

```
自旋的目的：减少线程切换开销

场景：线程 A 持有锁，线程 B 在等待

如果不自旋（普通阻塞）：
  T0  线程 B 被阻塞，操作系统切换到其他线程
  T1  线程 A 释放锁，通知线程 B
  T2  操作系统切换回线程 B
  T3  线程 B 恢复执行

如果自旋：
  T0  线程 B 自旋检查，发现锁已释放
  T1  线程 B 获取锁成功，立即执行
  T2  线程 B 执行

自旋减少了上下文切换的开销，但消耗 CPU
```

---

## 面试实战

**面试官问**：「AQS 的核心思想是什么？」

**参考回答**：
> AQS 的核心是**state + FIFO 队列**。
>
> **state** 是一个 volatile 的整数，表示同步状态。不同实现用它表示不同含义：ReentrantLock 用它表示重入次数，Semaphore 用它表示剩余许可数。
>
> **FIFO 队列**是一个双向链表，存储等待获取资源的线程。线程获取锁失败时加入队列尾部，获取成功后从队列头部移除。
>
> AQS 采用模板方法模式，定义了 acquire/release 的核心流程骨架，但具体的「如何判断能否获取锁」由子类实现。

**追问**：「AQS 支持哪两种模式？」

**参考回答**：
> **独占模式**和**共享模式**。
>
> 独占模式下，同一时刻只有一个线程能获取锁，其他线程需要等待。ReentrantLock 就是独占模式。
>
> 共享模式下，多个线程可以同时获取资源。Semaphore 和 CountDownLatch 是共享模式。

---

## 总结

```
┌─────────────────────────────────────────────────────────────┐
│                       AQS 核心要点                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  核心组件：                                                  │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ 1. state - 同步状态                                  │ │
│  │    - volatile int state                             │ │
│  │    - 表示资源可用/被占用/许可数量                      │ │
│  │ 2. FIFO 队列 - 等待队列                              │ │
│  │    - 双向链表存储等待线程                             │ │
│  │    - Node 包含 thread + waitStatus + prev/next      │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  两种模式：                                                  │
│  ┌──────────────────┬──────────────────────────────────┐  │
│  │ 独占模式          │ 共享模式                          │  │
│  ├──────────────────┼──────────────────────────────────┤  │
│  │ tryAcquire()     │ tryAcquireShared()               │  │
│  │ tryRelease()     │ tryReleaseShared()               │  │
│  │ ReentrantLock    │ Semaphore, CountDownLatch        │  │
│  └──────────────────┴──────────────────────────────────┘  │
│                                                             │
│  工作流程：                                                  │
│  tryAcquire() 失败 → addWaiter() 入队 → 自旋尝试获取       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 留给你的思考题

假设有以下场景：

```
state = 1（ReentrantLock，只有一个线程能获取）

线程 A 获取锁成功（state = 1 → 0）
线程 B 尝试获取锁失败，加入队列
线程 C 尝试获取锁失败，加入队列
线程 A 释放锁
```

1. 释放锁后，state 变成多少？
2. 线程 B 和线程 C 谁会先获得锁？
3. 如果线程 B 在获取锁的过程中被中断，会发生什么？

（提示：考虑队列的 FIFO 特性）
