# 线程同步机制：互斥锁、信号量、条件变量

假设你和女朋友共用一个银行账户。你在取钱的同时，女朋友也在取钱。
账户余额1000，你们同时取出800，理论上应该都失败。
但如果没有同步机制，最后余额可能是200，而不是0。

这就是**线程同步**要解决的问题。


## 为什么需要线程同步？

```
┌──────────────────────────────────────────────────────────┐
│                    线程安全问题                            │
│                                                          │
│   线程A: 读取余额 1000                                    │
│   线程B: 读取余额 1000  ←── 同时读取，旧值                 │
│   线程A: 扣款800，余额=200                               │
│   线程B: 扣款800，余额=200  ←── 覆盖了A的修改！            │
│                                                          │
│   预期结果: 余额应该是0或操作失败                          │
│   实际结果: 余额=200（丢了一次扣款）                       │
└──────────────────────────────────────────────────────────┘
```

**问题本质**：多个线程并发访问共享资源，导致数据不一致。


## 互斥锁（Mutex）

**最简单也最常用的同步机制——同一时刻只有一个线程能进入临界区。**

### Java中的synchronized

```java
public class Counter {
    private int count = 0;

    // 方式1：修饰方法，整个方法体是临界区
    public synchronized void increment() {
        count++;
    }

    public synchronized int getCount() {
        return count;
    }
}
```

```java
public class CounterAdvanced {
    private int count = 0;
    private final Object lock = new Object();  // 锁对象

    // 方式2：修饰代码块，更精细的控制
    public void increment() {
        synchronized (lock) {
            count++;
        }
    }

    // 方式3：修饰静态方法，锁的是Class对象
    public static synchronized void staticIncrement() {
        // 锁的是Counter.class
    }
}
```

### synchronized的原理

```java
// synchronized的工作原理（简化）
public class SynchronizedDemo {
    private final Object lock = new Object();

    public void method() {
        // 编译后变成：
        monitorenter  // 获取锁（ObjectMonitor）

        try {
            // 临界区代码
        } finally {
            monitorexit  // 释放锁
        }
    }
}
```

**synchronized的可重入性：**

```java
public class ReentrantDemo {
    public synchronized void methodA() {
        System.out.println("A进来了");
        methodB();  // 可以再次获取同一个锁
    }

    public synchronized void methodB() {
        System.out.println("B也进来了");
        // 如果不可重入，这里会死锁
    }

    public static void main(String[] args) {
        new ReentrantDemo().methodA();
        // 输出:
        // A进来了
        // B也进来了
    }
}
```

> synchronized是可重入锁，同一个线程可以多次获取同一个锁。

### ReentrantLock

JDK 5之后，Java提供了更灵活的Lock接口。

```java
public class ReentrantLockDemo {
    private final ReentrantLock lock = new ReentrantLock();
    private int count = 0;

    public void increment() {
        lock.lock();  // 获取锁
        try {
            count++;
        } finally {
            lock.unlock();  // 必须释放
        }
    }

    // 可中断的获取锁
    public void incrementInterruptibly() throws InterruptedException {
        lock.lockInterruptibly();
        try {
            count++;
        } finally {
            lock.unlock();
        }
    }

    // 尝试获取锁（非阻塞）
    public boolean tryIncrement() {
        if (lock.tryLock()) {
            try {
                count++;
                return true;
            } finally {
                lock.unlock();
            }
        }
        return false;
    }

    // 带超时的获取锁
    public boolean incrementWithTimeout(long timeout, TimeUnit unit)
            throws InterruptedException {
        if (lock.tryLock(timeout, unit)) {
            try {
                count++;
                return true;
            } finally {
                lock.unlock();
            }
        }
        return false;
    }
}
```

### synchronized vs ReentrantLock

| 特性 | synchronized | ReentrantLock |
|-----|-------------|---------------|
| 获取方式 | 自动获取/释放 | 手动获取/释放 |
| 可中断 | 否 | 是（tryLockInterruptibly） |
| 公平锁 | 否 | 可选（构造参数） |
| 条件变量 | 内置（wait/notify） | 多个（newCondition） |
| 性能 | JDK 6后优化良好 | 略复杂 |


## 信号量（Semaphore）

**信号量可以控制同时访问资源的线程数量，不只是互斥。**

```java
public class SemaphoreDemo {
    // 模拟连接池：最多10个并发连接
    private final Semaphore connections = new Semaphore(10);

    public void useConnection() {
        try {
            connections.acquire();  // 获取许可
            try {
                // 使用连接
                doSomething();
            } finally {
                connections.release();  // 释放许可
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
```

**信号量的两种类型：**
1. **二进制信号量**（值只能是0或1）= 互斥锁
2. **计数信号量**（值可以是任意非负整数）= 限流器

```java
// 信号量实现互斥锁
public class SemaphoreAsMutex {
    private final Semaphore mutex = new Semaphore(1);

    public void criticalSection() {
        try {
            mutex.acquire();
            // 临界区
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            mutex.release();
        }
    }
}
```


## 条件变量（Condition）

**条件变量用于线程间的等待和通知机制。**

### wait/notify的局限性

```java
// wait/notify的问题
public class WaitNotifyProblems {
    private final Object lock = new Object();
    private boolean ready = false;

    public void await() throws InterruptedException {
        synchronized (lock) {
            while (!ready) {
                lock.wait();  // 只能有一个等待条件
            }
        }
    }

    public void signal() {
        synchronized (lock) {
            ready = true;
            lock.notify();  // 只能唤醒一个
        }
    }

    // 问题：如果有多个条件（如数据好了、错误了、完成信号）
    // 就需要多个wait/notify，代码会变得混乱
}
```

### Condition接口

```java
public class ConditionDemo {
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition dataAvailable = lock.newCondition();
    private final Condition errorOccurred = lock.newCondition();
    private String data = null;
    private boolean hasError = false;

    // 等待数据就绪
    public void awaitData() throws InterruptedException {
        lock.lock();
        try {
            while (data == null && !hasError) {
                dataAvailable.await();
            }
            if (hasError) {
                throw new RuntimeException("Error occurred");
            }
        } finally {
            lock.unlock();
        }
    }

    // 数据就绪通知
    public void signalDataAvailable() {
        lock.lock();
        try {
            data = "some data";
            dataAvailable.signal();  // 精确通知
        } finally {
            lock.unlock();
        }
    }

    // 错误通知
    public void signalError() {
        lock.lock();
        try {
            hasError = true;
            errorOccurred.signalAll();  // 唤醒所有等待错误的线程
        } finally {
            lock.unlock();
        }
    }
}
```


## 生产者-消费者问题

**这是最经典的线程同步问题。**

```java
public class ProducerConsumer {
    private static final int CAPACITY = 10;
    private final Queue<Integer> buffer = new LinkedList<>();
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition notFull = lock.newCondition();
    private final Condition notEmpty = lock.newCondition();

    // 生产者
    public void produce(int item) throws InterruptedException {
        lock.lock();
        try {
            while (buffer.size() == CAPACITY) {
                notFull.await();  // 缓冲区满，等待消费
            }
            buffer.offer(item);
            System.out.println("Produced: " + item);
            notEmpty.signal();  // 通知消费者
        } finally {
            lock.unlock();
        }
    }

    // 消费者
    public Integer consume() throws InterruptedException {
        lock.lock();
        try {
            while (buffer.isEmpty()) {
                notEmpty.await();  // 缓冲区空，等待生产
            }
            Integer item = buffer.poll();
            System.out.println("Consumed: " + item);
            notFull.signal();  // 通知生产者
            return item;
        } finally {
            lock.unlock();
        }
    }
}
```


## 读多写少场景：ReadWriteLock

```java
public class ReadWriteLockDemo {
    private final ReadWriteLock rwLock = new ReentrantReadWriteLock();
    private final Lock readLock = rwLock.readLock();
    private final Lock writeLock = rwLock.writeLock();
    private Map<String, String> cache = new HashMap<>();

    // 读操作：多个线程可以同时读
    public String read(String key) {
        readLock.lock();
        try {
            return cache.get(key);
        } finally {
            readLock.unlock();
        }
    }

    // 写操作：独占
    public void write(String key, String value) {
        writeLock.lock();
        try {
            cache.put(key, value);
        } finally {
            writeLock.unlock();
        }
    }
}
```

> **读写锁原则**：读操作不冲突，写操作互斥，读和写也互斥。


## 实战：实现一个线程安全的计数器

```java
public class ThreadSafeCounter {
    private long count = 0;

    // 方法1：synchronized
    public synchronized void incrementSync() {
        count++;
    }

    // 方法2：ReentrantLock
    private final ReentrantLock lock = new ReentrantLock();
    public void incrementLock() {
        lock.lock();
        try {
            count++;
        } finally {
            lock.unlock();
        }
    }

    // 方法3：AtomicLong（无锁实现，性能最好）
    private final AtomicLong atomicCount = new AtomicLong(0);
    public void incrementAtomic() {
        atomicCount.incrementAndGet();
    }

    // 性能测试
    public static void main(String[] args) throws Exception {
        int iterations = 10_000_000;
        ThreadSafeCounter counter = new ThreadSafeCounter();

        long start = System.nanoTime();
        for (int i = 0; i < iterations; i++) {
            counter.incrementAtomic();
        }
        long duration = System.nanoTime() - start;

        System.out.println("AtomicLong: " + duration / 1_000_000 + " ms");
        System.out.println("Result: " + counter.atomicCount.get());
    }
}
```


## 总结：选择合适的同步机制

| 场景 | 推荐方案 |
|-----|---------|
| 简单互斥 | synchronized |
| 需要公平锁 | ReentrantLock(true) |
| 需要tryLock | ReentrantLock |
| 限流 | Semaphore |
| 等待/通知 | Condition |
| 读多写少 | ReadWriteLock |
| 计数器 | Atomic类 |


## 面试追问方向

- **synchronized的锁升级过程是什么？**
  提示：无锁→偏向锁→轻量级锁→重量级锁。
- **为什么ReentrantLock需要手动释放锁，而synchronized不需要？**
  提示：语法层面的try-finally保证。
- **读写锁和普通锁的区别是什么？什么时候用？**
  提示：读不阻塞读，写独占。
- **Condition和wait/notify的区别是什么？**
  提示：一个ReentrantLock可以创建多个Condition。
