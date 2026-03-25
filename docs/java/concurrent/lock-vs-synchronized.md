# ReentrantLock vs synchronized：深度对比

大多数面试者会说「synchronized 是 JDK 关键字，ReentrantLock 是类」。

然后就没有然后了。

这篇文章，让你把这个问题答出**深度**。

---

## 先说结论

| 维度 | synchronized | ReentrantLock |
|------|-------------|---------------|
| 锁获取方式 | 阻塞获取，不可中断 | 可选择超时、中断 |
| 公平锁 | 不支持 | 支持 |
| 条件变量 | 无（只有 wait/notify） | 多个 Condition |
| 锁释放 | 自动 | 必须手动 unlock() |
| 批量获取 | 无 | lockInterruptibly() |
| 性能（JDK 6+） | 优化良好，差别不大 | 更细粒度控制 |

---

## 场景一：锁获取的可控性

### synchronized：一条路走到黑

```java
synchronized (lockObj) {
    // 要么等到锁，要么死等
    // 无法设置超时，无法响应中断
}
```

**问题场景**：你等一把锁等了 30 秒，你确定要继续等吗？

### ReentrantLock：可以选择放弃

```java
ReentrantLock lock = new ReentrantLock();

// 场景1：设置超时
try {
    boolean acquired = lock.tryLock(5, TimeUnit.SECONDS);
    if (acquired) {
        try {
            // 临界区
        } finally {
            lock.unlock();
        }
    } else {
        System.out.println("等不了5秒，先撤");
    }
} catch (InterruptedException e) {
    // 被中断了
}

// 场景2：可中断获取
public void interruptibleAcquire() throws InterruptedException {
    lock.lockInterruptibly();
    try {
        // 可以被 Thread.interrupt() 中断
    } finally {
        lock.unlock();
    }
}
```

**实际应用**：防止死锁超时、设计带超时的分布式锁。

---

## 场景二：公平性的选择

### synchronized：不公平

JVM 的 synchronized 实现是**非公平锁**。锁释放后，任何线程都可能抢到，包括刚来的新线程。

### ReentrantLock：可选公平

```java
// 公平锁：严格按照等待顺序
ReentrantLock fairLock = new ReentrantLock(true);

// 非公平锁（默认）
ReentrantLock unfairLock = new ReentrantLock(false);
```

**公平锁的代价**：需要维护等待队列，每次都要判断是否应该让队首线程先执行。

```java
// ReentrantLock 公平锁实现简化版
protected FairSync() {
    super();
}

// tryAcquire 方法中判断等待队列
if (getQueuedThreads().contains(current)) {
    // 如果当前线程不在队首，让它继续等待
    return false;
}
```

**何时用公平锁**：金融交易系统，防止线程饥饿。

---

## 场景三：条件变量的数量

这是两者最核心的区别之一。

### synchronized：只有一组监视器方法

```java
synchronized (obj) {
    while (条件不满足) {
        obj.wait(); // 等待
    }
    // 处理
    obj.notifyAll(); // 唤醒所有
}
```

**问题**：所有等待都在同一个「房间」里，notifyAll 会唤醒所有人。

### ReentrantLock：可以有多个 Condition

```java
ReentrantLock lock = new ReentrantLock();
// 创建多个独立条件
Condition conditionA = lock.newCondition();
Condition conditionB = lock.newCondition();

// 线程A等待条件A
conditionA.await();

// 线程B等待条件B
conditionB.await();

// 只唤醒等待条件A的线程
conditionA.signal();
```

**实战场景**：一个线程池，有两个条件——任务队列满、任务队列空。用 synchronized，你只能用 notifyAll；用 ReentrantLock，可以精准唤醒。

```java
public class精准唤醒Demo {
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition notEmpty = lock.newCondition();
    private final Condition notFull = lock.newCondition();
    private final Queue&lt;Task&gt; queue = new LinkedList&lt;&gt;();
    private final int capacity = 100;

    public void put(Task task) throws InterruptedException {
        lock.lock();
        try {
            while (queue.size() == capacity) {
                notFull.await(); // 只等待"不满"这个条件
            }
            queue.offer(task);
            notEmpty.signal(); // 只唤醒"不空"等待者
        } finally {
            lock.unlock();
        }
    }

    public Task take() throws InterruptedException {
        lock.lock();
        try {
            while (queue.isEmpty()) {
                notEmpty.await(); // 只等待"不空"这个条件
            }
            Task task = queue.poll();
            notFull.signal(); // 只唤醒"不满"等待者
            return task;
        } finally {
            lock.unlock();
        }
    }
}
```

---

## 场景四：锁的手动释放

### synchronized：自动释放

```java
public synchronized void method() {
    // JVM 保证：正常/异常退出都会释放锁
}
```

### ReentrantLock：必须手动释放

```java
ReentrantLock lock = new ReentrantLock();

public void method() {
    lock.lock();
    try {
        // 临界区
    } finally {
        lock.unlock(); // 忘写 = 死锁！
    }
}
```

**陷阱案例**：

```java
// 错误示例
public void wrongMethod() {
    lock.lock();
    if (condition) {
        return; // 锁未释放！
    }
    lock.unlock();
}

// 正确示例
public void correctMethod() {
    lock.lock();
    try {
        if (condition) {
            return;
        }
    } finally {
        lock.unlock(); // finally 确保一定执行
    }
}
```

---

## 场景五：性能对比

### JDK 6 之前

```
synchronized: 重量级锁，需要 OS 介入，用户态→内核态切换
ReentrantLock: 性能好很多
```

### JDK 6 之后

HotSpot 团队对 synchronized 做了大量优化：

- 偏向锁：单线程无竞争时，几乎零开销
- 轻量级锁：自旋不阻塞
- 锁消除：JVM 自动识别无需同步的代码

**结论**：在 JDK 6+ 环境下，两者在大多数场景性能差异不大。

```java
// 测试：单线程循环 1000 万次
synchronized: ~200ms
ReentrantLock: ~180ms
// 差距很小
```

---

## 场景六：lockInterruptibly 的必要性

```java
public class 优雅关闭示例 {
    private final ReentrantLock lock = new ReentrantLock();
    private volatile boolean shutdown = false;

    public void shutdown() {
        shutdown = true;
        // 中断所有等待锁的线程
    }

    public void task() throws InterruptedException {
        // lock() 无法响应中断
        // lockInterruptibly() 可以被中断
        lock.lockInterruptibly();
        try {
            while (!shutdown) {
                // 处理任务
            }
        } finally {
            lock.unlock();
        }
    }
}
```

---

## 总结对比表

| 特性 | synchronized | ReentrantLock |
|------|-------------|---------------|
| 语法形式 | 关键字 | API |
| 锁获取 | 阻塞 | 可超时/中断 |
| 公平锁 | 不支持 | 支持 |
| 条件变量 | 一组 wait/notify | 多个 Condition |
| 锁释放 | 自动 | 手动 |
| 批量锁 | 无 | lockAll() |
| 性能（JDK 8+） | 优化良好 | 相当 |

---

## 面试追问方向

1. **什么场景下 ReentrantLock 性能比 synchronized 差？**
   synchronized 有锁升级机制，偏向锁→轻量级锁→重量级锁，在锁竞争激烈时会自动升级。ReentrantLock 一开始就是较重的实现。

2. **ReentrantLock 可以实现公平锁，那能实现非公平锁吗？**
   可以，默认就是非公平锁。

3. **synchronized 的 wait/notify 和 Condition 的 await/signal 有什么区别？**
   前者必须在 synchronized 内使用，一个对象只有一组监视器；后者在 Lock 内使用，一个 Lock 可以有多个 Condition，实现精准等待。

4. **为什么 JDK 推荐尽量用 synchronized？**
   因为 synchronized 是 JVM 原生支持，有锁升级优化，且不需要手动释放。ReentrantLock 更灵活，但增加了程序员的负担。
