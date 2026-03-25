# ReentrantLock：可重入锁与公平/非公平策略

想象一个场景：你去银行办业务，柜台前有个正在办理的客户。你站在旁边等，他办完后你上去。

但如果这时候，你发现可以**插队**——你跟柜员说「我是 VIP」，柜员直接服务你。

这就是 ReentrantLock 的两种模式：**公平锁**（老老实实排队）vs **非公平锁**（可以插队）。

---

## 什么是可重入锁？

先解释一个基础概念：**可重入**。

```java
public class ReentrantDemo {

    private final ReentrantLock lock = new ReentrantLock();

    public void outer() {
        lock.lock();
        try {
            System.out.println("outer 方法执行");
            inner(); // 调用同一个锁的方法
        } finally {
            lock.unlock();
        }
    }

    public void inner() {
        lock.lock();
        try {
            System.out.println("inner 方法执行");
        } finally {
            lock.unlock();
        }
    }
}
```

**同一个线程，可以多次获取同一把锁，不会死锁。**

这叫「可重入」——你自己家的门，用钥匙开了进去，进去后从里面还能开门（因为还是你自己）。

---

## 公平锁 vs 非公平锁

### 构造函数

```java
// 非公平锁（默认）
ReentrantLock lock1 = new ReentrantLock();

// 公平锁
ReentrantLock lock2 = new ReentrantLock(true);

// 非公平锁
ReentrantLock lock3 = new ReentrantLock(false);
```

### 公平锁：先来后到

```java
ReentrantLock fairLock = new ReentrantLock(true);

public void fairAccess() {
    fairLock.lock();
    try {
        System.out.println(Thread.currentThread().getName() + " 获取到锁");
    } finally {
        fairLock.unlock();
    }
}
```

公平锁的规则很简单：**等待时间最长的线程，先获取锁**。

就像食堂排队——无论你多饿，前面有人就得等。

### 非公平锁：插队可行

```java
ReentrantLock unfairLock = new ReentrantLock();

public void unfairAccess() {
    unfairLock.lock();
    try {
        System.out.println(Thread.currentThread().getName() + " 获取到锁");
    } finally {
        unfairLock.unlock();
    }
}
```

非公平锁不保证顺序。新线程来了，可能直接抢到锁，如果恰好锁刚释放的话。

### 为什么默认是非公平？

| 对比项 | 公平锁 | 非公平锁 |
|-------|--------|----------|
| 等待队列 | 需要维护 FIFO 队列 | 无需维护 |
| 线程切换 | 每次都要切换 | 可能减少切换 |
| 吞吐量 | 较低 | 较高 |
| 饥饿风险 | 无 | 可能（线程一直抢不到） |

**核心原因**：非公平锁在锁持有时间较短时，性能更好。

比如锁只持有 1 毫秒，线程 A 刚释放锁，线程 B 立刻来抢——非公平锁让 B 直接拿到，减少了线程切换开销。

---

## 核心 API

### 基本操作

```java
ReentrantLock lock = new ReentrantLock();

// 获取锁（阻塞）
lock.lock();
try {
    // 临界区
} finally {
    lock.unlock(); // 必须手动释放！
}

// 获取锁（可中断）
lock.lockInterruptibly();
try {
    // 临界区
} finally {
    lock.unlock();
}
```

**重要**：synchronized 是自动释放锁，ReentrantLock **必须手动释放**。忘了 unlock() = 死锁。

### tryLock()：尝试获取锁

```java
public void tryLockDemo() {
    ReentrantLock lock = new ReentrantLock();

    // 1. tryLock()：立刻返回，不阻塞
    if (lock.tryLock()) {
        try {
            System.out.println("获取到锁");
        } finally {
            lock.unlock();
        }
    } else {
        System.out.println("获取锁失败，继续做其他事");
    }

    // 2. tryLock(timeout)：等一段时间，超时放弃
    try {
        if (lock.tryLock(2, TimeUnit.SECONDS)) {
            try {
                System.out.println("2秒内获取到锁");
            } finally {
                lock.unlock();
            }
        } else {
            System.out.println("等了2秒还没拿到");
        }
    } catch (InterruptedException e) {
        e.printStackTrace();
    }
}
```

### 获取锁信息

```java
ReentrantLock lock = new ReentrantLock();

public void queryLockInfo() {
    // 当前线程重入次数
    System.out.println("重入次数: " + lock.getHoldCount());

    // 当前线程是否持有锁
    System.out.println("当前线程持有锁: " + lock.isHeldByCurrentThread());

    // 是否有任何线程持有锁
    System.out.println("锁被持有: " + lock.isLocked());

    // 获取等待队列长度
    System.out.println("等待线程数: " + lock.getQueueLength());
}
```

---

## 实战：生产者-消费者

用 ReentrantLock + Condition 实现精准控制：

```java
public class MessageQueue {
    private final Queue&lt;String&gt; queue = new LinkedList&lt;&gt;();
    private final int capacity;
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition notFull = lock.newCondition();
    private final Condition notEmpty = lock.newCondition();

    public MessageQueue(int capacity) {
        this.capacity = capacity;
    }

    public void put(String message) throws InterruptedException {
        lock.lockInterruptibly();
        try {
            while (queue.size() == capacity) {
                notFull.await(); // 队列满，等待消费
            }
            queue.offer(message);
            notEmpty.signal(); // 通知消费者
        } finally {
            lock.unlock();
        }
    }

    public String take() throws InterruptedException {
        lock.lockInterruptibly();
        try {
            while (queue.isEmpty()) {
                notEmpty.await(); // 队列空，等待生产
            }
            String message = queue.poll();
            notFull.signal(); // 通知生产者
            return message;
        } finally {
            lock.unlock();
        }
    }
}
```

---

## 与 synchronized 对比

| 特性 | synchronized | ReentrantLock |
|------|-------------|---------------|
| 锁获取 | 阻塞式 | 可选超时/中断 |
| 公平锁 | 不支持 | 支持 |
| 条件变量 | 无 | 多个 Condition |
| 锁释放 | 自动 | 手动必须 |
| 性能 | JDK 6+ 优化良好 | 更细粒度控制 |

---

## 面试追问方向

1. **ReentrantLock 是怎么实现可重入的？**
   每个锁内部维护一个计数器 + owner 线程 ID。同一个线程获取锁，计数器 +1；释放锁，计数器 -1。

2. **公平锁一定比非公平锁好吗？**
   不一定。公平锁需要维护等待队列，有线程切换开销。如果锁竞争不激烈或持有时间短，非公平锁性能更好。

3. **tryLock() 和 lock() 的区别？**
   lock() 阻塞等待直到获取锁；tryLock() 立即返回，获取成功返回 true，失败返回 false。

4. **为什么 ReentrantLock 要手动释放，而 synchronized 不用？**
   synchronized 是 JVM 内置语法，编译时自动添加 try-finally 释放逻辑。ReentrantLock 是 API 级别的实现，由程序员保证。
