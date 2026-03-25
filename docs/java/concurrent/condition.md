# Condition：精准等待与唤醒

还记得 synchronized 的 wait/notify 吗？

```java
synchronized (obj) {
    while (条件不满足) {
        obj.wait();
    }
    obj.notifyAll();
}
```

**问题**：一个 waitSet，所有等待都混在一起。

你只是想等「队列有空位」，结果「队列有数据」也把你唤醒了。

**Condition** 就是来解决这个问题的——**精准等待，精准唤醒**。

---

## 什么是 Condition？

Condition = **监视器方法的增强版**。

| synchronized | Condition |
|-------------|-----------|
| wait() | await() |
| notify() | signal() |
| notifyAll() | signalAll() |

但更重要的是：**一个 Lock 可以有多个 Condition**。

```
Lock lock = new ReentrantLock();

Condition queueNotFull = lock.newCondition();
Condition queueNotEmpty = lock.newCondition();
Condition resourceAvailable = lock.newCondition();
```

---

## 基本用法

### 生产者-消费者：精准唤醒

```java
public class 精准队列&lt;T&gt; {
    private final Queue&lt;T&gt; queue = new LinkedList&lt;&gt;();
    private final int capacity;
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition notFull = lock.newCondition();
    private final Condition notEmpty = lock.newCondition();

    public 精准队列(int capacity) {
        this.capacity = capacity;
    }

    public void put(T item) throws InterruptedException {
        lock.lock();
        try {
            // 精准等待：只等「不满」这个条件
            while (queue.size() == capacity) {
                notFull.await();
            }
            queue.offer(item);
            System.out.println("生产: " + item);
            // 精准唤醒：只唤醒等「不空」的线程
            notEmpty.signal();
        } finally {
            lock.unlock();
        }
    }

    public T take() throws InterruptedException {
        lock.lock();
        try {
            // 精准等待：只等「不空」这个条件
            while (queue.isEmpty()) {
                notEmpty.await();
            }
            T item = queue.poll();
            System.out.println("消费: " + item);
            // 精准唤醒：只唤醒等「不满」的线程
            notFull.signal();
            return item;
        } finally {
            lock.unlock();
        }
    }
}
```

**对比 synchronized 的做法**：

```java
// synchronized 方式：无法精准
synchronized (queue) {
    while (queue.isEmpty()) {
        queue.wait(); // 所有等待都在一起
    }
    queue.notifyAll(); // 唤醒所有，包括等「不满」的
}
```

---

## Condition 的方法

### 等待方法

```java
Condition condition = lock.newCondition();

// 1. 无限等待（可中断）
void await() throws InterruptedException;

// 2. 无限等待（不可中断）
void awaitUninterruptibly();

// 3. 带超时等待
boolean await(long time, TimeUnit unit) throws InterruptedException;

// 4. 绝对时间等待
boolean awaitUntil(Date deadline) throws InterruptedException;
```

### 唤醒方法

```java
// 1. 唤醒一个等待线程
void signal();

// 2. 唤醒所有等待线程
void signalAll();
```

---

## 实战：多条件同步

### 场景：三个线程按顺序打印 A、B、C

```java
public class 顺序打印 {
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition conditionA = lock.newCondition();
    private final Condition conditionB = lock.newCondition();
    private final Condition conditionC = lock.newCondition();

    private int turn = 0; // 0=A, 1=B, 2=C

    public void printA() throws InterruptedException {
        lock.lock();
        try {
            while (turn != 0) {
                conditionA.await();
            }
            System.out.print("A");
            turn = 1;
            conditionB.signal();
        } finally {
            lock.unlock();
        }
    }

    public void printB() throws InterruptedException {
        lock.lock();
        try {
            while (turn != 1) {
                conditionB.await();
            }
            System.out.print("B");
            turn = 2;
            conditionC.signal();
        } finally {
            lock.unlock();
        }
    }

    public void printC() throws InterruptedException {
        lock.lock();
        try {
            while (turn != 2) {
                conditionC.await();
            }
            System.out.print("C");
            turn = 0;
            conditionA.signal();
        } finally {
            lock.unlock();
        }
    }

    public static void main(String[] args) throws InterruptedException {
        顺序打印 printer = new 顺序打印();

        // 10轮打印 ABC
        for (int i = 0; i &lt; 10; i++) {
            printer.printA();
            printer.printB();
            printer.printC();
        }
    }
}
```

---

## await() 的特性

### await() 期间会释放锁

```java
lock.lock();
try {
    while (!conditionMet) {
        // await() 会释放锁，其他线程可以获取
        await();
    }
    // 此时重新获取到锁
} finally {
    lock.unlock();
}
```

**重要**：signal() 唤醒后，await() 返回，但**此时线程需要重新竞争锁**。

```
线程A: lock → await() [释放锁，阻塞]
线程B: lock → signal() → unlock()
线程A: [被唤醒] → 竞争锁 → await() 返回
```

### awaitUntil() 精确超时

```java
public boolean tryProcess(long timeoutMs) throws InterruptedException {
    lock.lock();
    try {
        // 等到截止时间
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (!resourceAvailable) {
            long remaining = deadline - System.currentTimeMillis();
            if (remaining &lt;= 0) {
                return false; // 超时
            }
            // 等待到指定时间
            awaitUntil(new Date(deadline));
        }
        process();
        return true;
    } finally {
        lock.unlock();
    }
}
```

---

## 原理分析

### 内部实现

```java
// Condition 基于 AQS 的等待队列
public class ConditionObject implements Condition {
    private Node firstWaiter;
    private Node lastWaiter;

    // await() = 加入等待队列
    public void await() throws InterruptedException {
        if (Thread.interrupted()) throw new InterruptedException();
        Node node = addConditionWaiter();
        // 释放同步器持有的锁
        int savedState = fullyRelease(node);
        while (!isOnSyncQueue(node)) {
            LockSupport.park(this);
        }
        // 重新获取锁
        acquireQueued(node, savedState);
    }

    // signal() = 从等待队列移到同步队列
    public void signal() {
        if (!isHeldExclusively()) throw new IllegalMonitorStateException();
        Node first = firstWaiter;
        if (first != null) {
            doSignal(first);
        }
    }
}
```

**两个队列**：
- **同步队列**：竞争锁的线程排队
- **等待队列**：await() 的线程排队

signal() 把线程从等待队列移到同步队列。

---

## 常见陷阱

### 陷阱1：signal() 在 lock() 之外

```java
// 错误
condition.signal(); // 没有持有锁
lock.lock();

// 正确
lock.lock();
condition.signal();
lock.unlock();
```

### 陷阱2：signalAll() 唤醒过多

```java
// 假设队列满，多个生产者等待
while (queue.isFull()) {
    producerCondition.await();
}
// 来了一个消费者，调用 signal()
// 只唤醒一个生产者，而不是 signalAll()
```

### 陷阱3：while vs if

```java
// 错误：应该用 while
if (queue.isEmpty()) {
    consumerCondition.await();
}

// 正确：必须用 while
while (queue.isEmpty()) {
    consumerCondition.await();
}
```

**原因**：await() 返回时，条件可能仍然不满足（虚假唤醒、竞争失败）。

---

## 适用场景

### 适合

- **多条件等待**：生产者-消费者、多线程协调
- **精准唤醒**：只唤醒特定条件的线程
- **复杂同步逻辑**：需要多个等待条件

### 不适合

- 只需要一个等待条件（用 synchronized + wait/notify）
- 需要超时控制（用 awaitUntil）

---

## 面试追问方向

1. **Condition 和 wait/notify 的区别？**
   - 一个 Lock 可以有多个 Condition，synchronized 只有一个
   - Condition 可以精确唤醒指定条件的线程
   - Condition 需要手动创建，wait/notify 是对象自带的

2. **signal() 唤醒后为什么还需要 while 循环？**
   因为虚假唤醒（spurious wakeup）和竞争。signal() 只是把线程移到同步队列，不保证立即执行。

3. **await() 和 LockSupport.park() 的区别？**
   - await() 会释放锁，park() 不会
   - await() 有完整的等待队列管理，park() 是底层原语
   - await() 可被 interrupt() 中断

4. **Condition 能不能单独使用？**
   不能。Condition 必须配合 Lock 使用，因为 await() 需要释放锁。

5. **signalAll() 和 signal() 的选择？**
   - signal()：唤醒一个，效率高，但可能唤醒错误（如果条件不满足）
   - signalAll()：唤醒所有，更安全，但唤醒过多线程造成竞争
