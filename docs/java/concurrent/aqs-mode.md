# AQS 两种模式：独占锁与共享锁

AQS 支持两种同步模式，理解它们的区别是理解 JUC 并发工具的关键。

---

## 两种模式的本质区别

```
┌─────────────────────────────────────────────────────────────┐
│                    两种模式对比                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  独占模式（Exclusive）                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │    线程 A  ████████████ ✓ (执行中)                 │   │
│  │    线程 B  ░░░░░░░░░░░░░ (等待中)                  │   │
│  │    线程 C  ░░░░░░░░░░░░░ (等待中)                  │   │
│  │                                                     │   │
│  │    只有 A 能执行，B 和 C 排队                        │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  共享模式（Shared）                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │    线程 A  ████████████ ✓                           │   │
│  │    线程 B  ████████████ ✓ (同时执行)                 │   │
│  │    线程 C  ████████████ ✓                           │   │
│  │    线程 D  ░░░░░░░░░░░░░ (许可用完，等待)           │   │
│  │                                                     │   │
│  │    A、B、C 可以同时执行                              │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 独占模式（Exclusive）

### 定义

同一时刻，**只有一个线程**能获取同步状态。

### 典型实现

- `ReentrantLock`（可重入独占锁）
- `ReentrantReadWriteLock.WriteLock`（写锁）

### 核心方法

```java
// 尝试获取（子类实现）
protected boolean tryAcquire(int arg) {
    throw new UnsupportedOperationException();
}

// 尝试释放（子类实现）
protected boolean tryRelease(int arg) {
    throw new UnsupportedOperationException();
}
```

### 获取流程

```java
public final void acquire(int arg) {
    // 1. tryAcquire 由子类实现，尝试获取
    if (!tryAcquire(arg)) {
        // 2. 获取失败，加入 FIFO 队列
        Node node = addWaiter(Node.EXCLUSIVE);
        
        // 3. 自旋等待
        acquireQueued(node, arg);
    }
}
```

### 释放流程

```java
public final boolean release(int arg) {
    // tryRelease 由子类实现，尝试释放
    if (tryRelease(arg)) {
        // 唤醒后继节点
        Node h = head;
        if (h != null && h.waitStatus != 0) {
            unparkSuccessor(h);
        }
        return true;
    }
    return false;
}
```

---

## 共享模式（Shared）

### 定义

**多个线程**可以同时获取同步状态。

### 典型实现

- `Semaphore`（信号量）
- `CountDownLatch`（倒计时门栓）
- `CyclicBarrier`（循环屏障）
- `ReentrantReadWriteLock.ReadLock`（读锁）

### 核心方法

```java
// 尝试获取（返回剩余资源数，负数表示失败）
protected int tryAcquireShared(int arg) {
    throw new UnsupportedOperationException();
}

// 尝试释放（返回是否还有剩余资源）
protected boolean tryReleaseShared(int arg) {
    throw new UnsupportedOperationException();
}
```

### 获取流程

```java
public final void acquireShared(int arg) {
    // tryAcquireShared 由子类实现
    // 返回值 > 0：成功
    // 返回值 < 0：失败，需要入队等待
    if (tryAcquireShared(arg) < 0) {
        doAcquireShared(arg);
    }
}

// 共享模式获取
private void doAcquireShared(int arg) {
    // 加入队列尾部（共享模式）
    Node node = addWaiter(Node.SHARED);
    
    boolean failed = true;
    try {
        boolean interrupted = false;
        for (;;) {
            Node predecessor = node.predecessor();
            
            if (predecessor == head) {
                // 前驱是头节点，再次尝试获取
                int r = tryAcquireShared(arg);
                if (r >= 0) {
                    // 成功获取，传播（唤醒后续共享节点）
                    setHeadAndPropagate(node, r);
                    predecessor.next = null;
                    failed = false;
                    return;
                }
            }
            
            // 需要阻塞
            if (shouldParkAfterFailedAcquire(predecessor, node)) {
                LockSupport.park(this);
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

### 释放流程

```java
public final boolean releaseShared(int arg) {
    if (tryReleaseShared(arg)) {
        // 唤醒后继节点
        doReleaseShared();
        return true;
    }
    return false;
}
```

---

## 传播机制（Propagate）

共享模式有一个独特的机制：**传播**。

当一个共享节点获取成功后，会尝试**唤醒后续的共享节点**。

```java
private void setHeadAndPropagate(Node node, int propagate) {
    Node h = head;
    setHead(node);
    
    // propagate > 0 表示还有剩余资源，尝试唤醒后续节点
    if (propagate > 0 || h == null || h.waitStatus < 0) {
        Node s = node.next;
        if (s == null || s.isShared()) {
            // 唤醒后继节点
            doReleaseShared();
        }
    }
}
```

**为什么需要传播？**

```
场景：Semaphore 有 3 个许可

T0  线程 A 获取 1 个许可（剩余 2）
T1  线程 B 获取 1 个许可（剩余 1）
T2  线程 C 获取 1 个许可（剩余 0）
T3  线程 D 需要许可，但没有了，加入队列

T4  线程 A 释放许可（剩余 1）
    ├─ 唤醒线程 D？还是继续传播？

如果没有传播：
  线程 A 只唤醒线程 D
  但线程 C 也在等待，线程 D 唤醒后可能又要去排队

如果有传播：
  线程 A 唤醒线程 D（假设 D 是共享节点）
  线程 D 发现自己能获取，继续唤醒后续节点
  线程 C 也会被唤醒
```

---

## 共享 vs 独占：关键区别

| 维度 | 独占模式 | 共享模式 |
|-----|---------|---------|
| 同一时刻持有者 | 1 个线程 | 多个线程 |
| tryAcquire 返回 | boolean | int（剩余资源数） |
| tryRelease 返回 | boolean | boolean |
| 唤醒机制 | 只唤醒后继节点 | 传播唤醒多个节点 |
| Node 模式 | EXCLUSIVE | SHARED |
| 典型工具 | ReentrantLock | Semaphore |

---

## 读写锁：混合模式

`ReentrantReadWriteLock` 巧妙地**结合了两种模式**：

```java
// 读锁：共享模式
public static class ReadLock implements Lock, java.io.Serializable {
    private final Sync sync;
    
    protected int tryAcquireShared(int unused) {
        // 读锁可以被多个线程同时持有
        // 但如果有线程持有写锁，读锁必须等待
    }
}

// 写锁：独占模式
public static class WriteLock implements Lock, java.io.Serializable {
    private final Sync sync;
    
    protected boolean tryAcquire(int acquires) {
        // 写锁独占，同时不允许任何读锁
    }
}
```

### 读写锁的状态存储

```
state 高 16 位：读锁计数
state 低 16 位：写锁重入计数

┌────────────────────┬────────────────────┐
│      高 16 位       │      低 16 位       │
│    读锁持有计数     │    写锁重入计数     │
└────────────────────┴────────────────────┘
```

---

## 代码示例：模拟 Semaphore

```java
import java.util.concurrent.*;
import java.util.concurrent.locks.*;

public class MySemaphore {
    private final Sync sync;
    
    // AQS 的内部类
    abstract static class Sync extends AbstractQueuedSynchronizer {
        abstract void nonfairTryAcquire(int permits);
        abstract boolean tryRelease(int permits);
    }
    
    // 非公平版本
    static class NonfairSync extends Sync {
        NonfairSync(int permits) {
            setState(permits);
        }
        
        protected int tryAcquireShared(int permits) {
            return nonfairTryAcquireShared(permits);
        }
        
        final int nonfairTryAcquireShared(int acquires) {
            for (;;) {
                int available = getState();
                int remaining = available - acquires;
                
                if (remaining < 0 ||
                    compareAndSetState(available, remaining)) {
                    return remaining;
                }
            }
        }
        
        protected boolean tryRelease(int permits) {
            for (;;) {
                int current = getState();
                int next = current + permits;
                if (compareAndSetState(current, next)) {
                    return true;
                }
            }
        }
    }
    
    // 公共 API
    private final Sync sync;
    
    public MySemaphore(int permits) {
        this.sync = new NonfairSync(permits);
    }
    
    public void acquire() throws InterruptedException {
        sync.acquireSharedInterruptibly(1);
    }
    
    public void release() {
        sync.releaseShared(1);
    }
}
```

---

## 面试实战

**面试官问**：「独占锁和共享锁有什么区别？」

**参考回答**：
> **独占模式**下，同一时刻只有一个线程能获取锁，其他线程必须等待。`ReentrantLock` 就是独占模式。
>
> **共享模式**下，多个线程可以同时获取资源。比如 `Semaphore` 允许 N 个线程同时执行，`CountDownLatch` 让 N 个线程等待倒计时。
>
> 两者的核心区别在于 `tryAcquireShared()` 的返回值：返回负数表示失败，返回正数表示成功且还有剩余资源。
>
> 共享模式还有一个**传播机制**：当一个节点获取成功后，会尝试唤醒后续的共享节点，充分利用剩余资源。

**追问**：「读写锁是哪种模式？」

**参考回答**：
> 读写锁是**混合模式**。
>
> 读锁是共享模式，允许多个线程同时持有。
>
> 写锁是独占模式，排他地持有，不允许任何其他线程持有。
>
> 它们共用 AQS 的 state，但用不同的位来表示读锁和写锁的计数。

---

## 总结

```
┌─────────────────────────────────────────────────────────────┐
│                   独占模式 vs 共享模式                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                     独占模式                         │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  tryAcquire() → boolean                    │   │   │
│  │  │  tryRelease()  → boolean                   │   │   │
│  │  │  同一时刻只有一个线程能执行                   │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                     共享模式                         │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  tryAcquireShared() → int (资源数)          │   │   │
│  │  │  tryReleaseShared() → boolean              │   │   │
│  │  │  多个线程可以同时执行                         │   │   │
│  │  │  独有传播机制：唤醒后续节点                    │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  代表工具：                                                  │
│  独占：ReentrantLock、ReentrantReadWriteLock.WriteLock     │
│  共享：Semaphore、CountDownLatch、ReadLock                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 留给你的思考题

假设 `Semaphore` 有 2 个许可：

```java
Semaphore semaphore = new Semaphore(2);

// 线程执行顺序：
// 1. 线程 A 获取 1 个许可
// 2. 线程 B 获取 1 个许可
// 3. 线程 C 尝试获取 1 个许可（失败，加入队列）
// 4. 线程 A 释放 1 个许可
```

1. 线程 C 能立即获取许可吗？
2. 如果线程 A 释放许可后，线程 B 也释放许可，线程 C 的行为是什么？
3. 如果把 Semaphore 换成 ReentrantLock，场景会有什么不同？

（提示：考虑共享模式的传播机制）
