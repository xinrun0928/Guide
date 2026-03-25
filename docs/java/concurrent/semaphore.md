# Semaphore：信号量控制并发数

想象一个停车场的场景：

> 停车场有 10 个车位。每进来一辆车，占用一个车位；出去一辆车，释放一个车位。
>
> 如果车位满了，新来的车必须在外面等。

**Semaphore（信号量）** 就是这个「车位管理系统」。

---

## 什么是信号量？

信号量是一种计数器，用来控制同时访问某个资源的线程数量。

```
核心操作：
- acquire()：获取一个许可（计数器 -1）
- release()：释放一个许可（计数器 +1）
```

当计数器为 0 时，想获取许可的线程必须等待。

---

## 基本用法

### 限流：控制并发数

```java
public class 限流Demo {
    private final Semaphore semaphore;

    public 限流Demo(int maxConcurrent) {
        // permits = 最大并发数
        this.semaphore = new Semaphore(maxConcurrent);
    }

    public void doSomething(String task) {
        try {
            // 1. 获取许可（拿不到就等着）
            semaphore.acquire();
            try {
                System.out.println("处理任务: " + task);
                Thread.sleep(1000); // 模拟处理
            } finally {
                // 2. 释放许可
                semaphore.release();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}

// 使用：同时最多5个任务执行
限流Demo demo = new 限流Demo(5);
for (int i = 0; i &lt; 20; i++) {
    new Thread(() -&gt; demo.doSomething("任务" + i)).start();
}
```

### 连接池：控制连接数量

```java
public class 连接池 {
    private final Connection[] connections;
    private final Semaphore semaphore;

    public 连接池(int poolSize) {
        connections = new Connection[poolSize];
        semaphore = new Semaphore(poolSize, true); // 公平模式

        for (int i = 0; i &lt; poolSize; i++) {
            connections[i] = createConnection();
        }
    }

    public Connection getConnection() throws InterruptedException {
        semaphore.acquire();
        return connections[acquiredCount.incrementAndGet()];
    }

    public void releaseConnection(Connection conn) {
        // 归还连接
        semaphore.release();
    }
}
```

---

## acquire() 的多种变体

### 获取多个许可

```java
Semaphore semaphore = new Semaphore(5);

// 获取3个许可
semaphore.acquire(3);
try {
    // 需要3个许可才能执行的操作
} finally {
    semaphore.release(3); // 记得释放相同数量
}
```

### 可中断获取

```java
try {
    // 可以被 Thread.interrupt() 中断
    semaphore.acquireInterruptibly();
} catch (InterruptedException e) {
    System.out.println("被中断了");
}
```

### 带超时获取

```java
boolean acquired = semaphore.tryAcquire(2, TimeUnit.SECONDS);
if (acquired) {
    try {
        // 执行
    } finally {
        semaphore.release();
    }
} else {
    System.out.println("等了两秒没拿到，不等了");
}
```

---

## 公平 vs 非公平

```java
// 非公平（默认）：允许插队，性能更好
Semaphore unfair = new Semaphore(5);

// 公平模式：严格按照等待顺序
Semaphore fair = new Semaphore(5, true);
```

**公平模式的代价**：需要维护等待队列，有额外的开销。

什么时候用公平模式？—— 金融系统、任务调度等需要保证顺序的场景。

---

## 生产者-消费者模式

```java
public class 生产者消费者 {
    private final Queue&lt;String&gt; queue;
    private final int capacity;
    private final Semaphore producerSemaphore;
    private final Semaphore consumerSemaphore;

    public 生产者消费者(int capacity) {
        this.queue = new LinkedList&lt;&gt;();
        this.capacity = capacity;
        // 生产者信号量：初始为容量（表示可以生产多少）
        this.producerSemaphore = new Semaphore(capacity);
        // 消费者信号量：初始为0（队列空，不能消费）
        this.consumerSemaphore = new Semaphore(0);
    }

    public void produce(String item) throws InterruptedException {
        producerSemaphore.acquire(); // 等待有空位
        synchronized (queue) {
            queue.offer(item);
            System.out.println("生产: " + item);
        }
        consumerSemaphore.release(); // 通知有数据可消费
    }

    public String consume() throws InterruptedException {
        consumerSemaphore.acquire(); // 等待有数据
        String item;
        synchronized (queue) {
            item = queue.poll();
            System.out.println("消费: " + item);
        }
        producerSemaphore.release(); // 通知有空位
        return item;
    }
}
```

**巧妙之处**：两个信号量配合，一个控制生产，一个控制消费。

---

## 实现原理

### 内部结构

```java
// 简化版信号量实现
public class Semaphore {
    private final Sync sync;

    abstract static class Sync extends AbstractQueuedSynchronizer {
        int getPermits() { return getState(); }

        // 非公平获取
        protected boolean tryAcquireShared(int acquires) {
            for (;;) {
                int available = getState();
                int remaining = available - acquires;
                // CAS 更新
                if (remaining &gt;= 0 &&
                    compareAndSetState(available, remaining)) {
                    return true;
                }
            }
        }

        // 释放
        protected boolean tryReleaseShared(int releases) {
            for (;;) {
                int current = getState();
                int next = current + releases;
                if (compareAndSetState(current, next)) {
                    return true;
                }
            }
        }
    }
}
```

核心基于 AQS（AbstractQueuedSynchronizer），多个线程竞争共享状态。

---

## 常见陷阱

### 陷阱1：忘记 release()

```java
// 错误：异常时永远不会释放
semaphore.acquire();
doSomething(); // 如果这里抛异常
semaphore.release();

// 正确：用 try-finally
semaphore.acquire();
try {
    doSomething();
} finally {
    semaphore.release();
}
```

### 陷阱2：release() 次数不对

```java
// 错误：获取3个，释放1个
semaphore.acquire(3);
try {
    // ...
} finally {
    semaphore.release(); // 死锁！
}
```

### 陷阱3：Semaphore 不是重入的

```java
Semaphore semaphore = new Semaphore(1);
semaphore.acquire();
semaphore.acquire(); // 同一个线程也不能再获取！阻塞
```

---

## vs 其他并发工具

| 工具 | 控制什么 | 特点 |
|------|---------|------|
| Semaphore | 同时访问数量 | 可降级/升级 |
| CountDownLatch | 只减不复位 | 一次性 |
| CyclicBarrier | 等待N个线程 | 可循环 |
| ReentrantLock | 互斥 | 可重入 |

---

## 适用场景

### 适合

- **限流**：限制接口并发数
- **资源池**：数据库连接池、线程池
- **令牌桶**：控制访问频率
- **并发数限制**：同时下载数、同时登录数

### 不适合

- 需要互斥的场景（用 ReentrantLock）
- 需要等待特定条件的场景（用 Condition）
- 一次性同步（用 CountDownLatch）

---

## 面试追问方向

1. **Semaphore 的 permits 是什么意思？**
   许可数量。可以理解为「车位数」或「门票数量」。acquire() 减少，release() 增加。

2. **Semaphore 是公平锁吗？**
   可以选择。构造函数传入 `true` 是公平模式，false（默认）是非公平模式。

3. **Semaphore 和 ReentrantLock 的区别？**
   ReentrantLock 是互斥锁（0/1），Semaphore 是计数器（0~N）。ReentrantLock 可重入，Semaphore 不可重入。

4. **如果 acquire() 一直阻塞怎么办？**
   可以用 tryAcquire() 带超时，或者 acquireInterruptibly() 支持中断。

5. **Semaphore 如何实现互斥锁？**
   new Semaphore(1) 就可以。第一个 acquire() 成功，后续 acquire() 阻塞，类似互斥锁。
