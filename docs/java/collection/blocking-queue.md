# BlockingQueue 体系与生产者-消费者模式

你有没有遇到过这种场景：生产者太快，消费者太慢，需要一个"缓冲区"来平滑处理？

`BlockingQueue` 就是为这种场景设计的。

它能在队列为空时阻塞消费者，在队列满时阻塞生产者——无需手动管理等待逻辑。

## BlockingQueue 的核心方法

```java
public interface BlockingQueue<E> extends Queue<E> {
    
    // 抛出异常
    void add(E e);           // 队满抛异常
    E remove();              // 队空抛异常
    E element();             // 队空抛异常
    
    // 返回特殊值
    boolean offer(E e);     // 队满返回 false
    E poll();                // 队空返回 null
    
    // 阻塞
    void put(E e) throws InterruptedException;  // 队满则阻塞
    E take() throws InterruptedException;        // 队空则阻塞
    
    // 超时
    boolean offer(E e, long timeout, TimeUnit unit) throws InterruptedException;
    E poll(long timeout, TimeUnit unit) throws InterruptedException;
}
```

| 方法 | 队满/队空时 | 可中断 |
|-----|-----------|--------|
| add/remove | 抛异常 | 否 |
| offer/poll | 返回 false/null | 否 |
| put/take | 阻塞 | 是 |
| offer(e, timeout)/poll(timeout) | 超时返回 | 是 |

## 核心实现类

### 1. ArrayBlockingQueue（有界队列）

```java
// 必须指定容量，数组实现
BlockingQueue<String> queue = new ArrayBlockingQueue<>(100);

// put：队满则阻塞
queue.put("item");  // 如果队列满了，会一直等待

// offer：队满则返回 false
queue.offer("item");  // 非阻塞

// offer 带超时：队满则等待一段时间
queue.offer("item", 5, TimeUnit.SECONDS);  // 等 5 秒还满就返回 false
```

底层是**数组 + ReentrantLock**：

```java
public class ArrayBlockingQueue<E> extends AbstractQueue<E>
        implements BlockingQueue<E> {
    
    final Object[] items;
    final ReentrantLock lock = new ReentrantLock();
    Condition notEmpty = lock.newCondition();  // 队列非空条件
    Condition notFull = lock.newCondition();  // 队列非满条件
}
```

put() 实现：

```java
public void put(E e) throws InterruptedException {
    Objects.requireNonNull(e);
    final ReentrantLock lock = this.lock;
    lock.lockInterruptibly();
    try {
        while (count == items.length)
            notFull.await();  // 队满，等待
        enqueue(e);
    } finally {
        lock.unlock();
    }
}

private void enqueue(E e) {
    items[putIndex++] = e;
    if (putIndex == items.length)
        putIndex = 0;
    count++;
    notEmpty.signal();  // 通知消费者
}
```

### 2. LinkedBlockingQueue（可选有界）

```java
// 默认容量 Integer.MAX_VALUE，几乎无界
BlockingQueue<String> queue = new LinkedBlockingQueue<>();

// 指定容量
BlockingQueue<String> queue = new LinkedBlockingQueue<>(1000);
```

底层是**链表 + 两把锁**（分别控制出队和入队）：

```java
public class LinkedBlockingQueue<E> extends AbstractQueue<E>
        implements BlockingQueue<E> {
    
    Node<E> head;
    private final AtomicInteger count = new AtomicInteger(0);
    
    // 两把锁，允许入队和出队并发
    private final ReentrantLock takeLock = new ReentrantLock();
    private final ReentrantLock putLock = new ReentrantLock();
    
    Condition notEmpty = takeLock.newCondition();
    Condition notFull = putLock.newCondition();
}
```

### 3. PriorityBlockingQueue（优先级队列）

```java
// 按自然顺序或自定义顺序排列
BlockingQueue<Integer> queue = new PriorityBlockingQueue<>(11, Comparator.reverseOrder());

queue.put(5);
queue.put(1);
queue.put(3);

System.out.println(queue.poll());  // 5（最大优先）
System.out.println(queue.poll());  // 3
System.out.println(queue.poll());  // 1
```

底层是**最小堆（数组实现）**，容量无界（自动扩容）。

### 4. DelayQueue（延迟队列）

```java
public class DelayedTask implements Delayed {
    private final long delayTime;
    private final String task;
    
    public DelayedTask(long delay, String task) {
        this.delayTime = System.currentTimeMillis() + delay;
        this.task = task;
    }
    
    @Override
    public long getDelay(TimeUnit unit) {
        return unit.convert(delayTime - System.currentTimeMillis(), TimeUnit.MILLISECONDS);
    }
    
    @Override
    public int compareTo(Delayed o) {
        return Long.compare(this.delayTime, ((DelayedTask) o).delayTime);
    }
}

// 使用
DelayQueue<DelayedTask> queue = new DelayQueue<>();
queue.put(new DelayedTask(1000, "task1"));  // 1秒后可用
queue.put(new DelayedTask(500, "task2"));    // 0.5秒后可用

DelayedTask task = queue.take();  // 等 0.5 秒后返回 task2
```

### 5. SynchronousQueue（同步队列）

最特殊的 BlockingQueue：**不存储元素**。

每个 put() 必须等待一个 take()，反之亦然。

```java
BlockingQueue<String> queue = new SynchronousQueue<>();

// 线程 A
new Thread(() -> {
    try {
        String item = queue.take();  // 等待
        System.out.println("Got: " + item);
    } catch (InterruptedException e) {}
}).start();

// 线程 B
queue.put("hello");  // 阻塞，直到有线程 take
System.out.println("Put done");
```

适用场景：**直接传递**，不缓冲。

## 生产者-消费者模式

这是 BlockingQueue 最经典的应用：

```java
public class ProducerConsumerDemo {
    
    private static BlockingQueue<String> queue = new LinkedBlockingQueue<>(10);
    
    // 生产者
    static class Producer implements Runnable {
        @Override
        public void run() {
            for (int i = 0; i < 20; i++) {
                try {
                    queue.put("item-" + i);
                    System.out.println("Produced: item-" + i);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }
    }
    
    // 消费者
    static class Consumer implements Runnable {
        @Override
        public void run() {
            while (true) {
                try {
                    String item = queue.take();  // 队空则阻塞
                    System.out.println("Consumed: " + item);
                    
                    // 处理完就停止
                    if (item.equals("item-19")) {
                        break;
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }
    }
    
    public static void main(String[] args) {
        ExecutorService executor = Executors.newFixedThreadPool(2);
        executor.submit(new Producer());
        executor.submit(new Consumer());
        executor.shutdown();
    }
}
```

## 线程池如何使用 BlockingQueue？

Executors 创建的线程池内部都使用 BlockingQueue：

```java
// newFixedThreadPool
public static ExecutorService newFixedThreadPool(int nThreads) {
    return new ThreadPoolExecutor(
        nThreads, nThreads,
        0L, TimeUnit.MILLISECONDS,
        new LinkedBlockingQueue<Runnable>());  // 无界队列
}

// newCachedThreadPool
public static ExecutorService newCachedThreadPool() {
    return new ThreadPoolExecutor(
        0, Integer.MAX_VALUE,
        60L, TimeUnit.SECONDS,
        new SynchronousQueue<Runnable>());  // 同步队列
}
```

| 线程池 | 队列类型 | 特点 |
|-------|---------|------|
| FixedThreadPool | LinkedBlockingQueue | 无界，可能积压 |
| CachedThreadPool | SynchronousQueue | 不缓冲，快速响应 |
| SingleThreadExecutor | LinkedBlockingQueue(1) | 单线程顺序执行 |

## 各实现类对比

| 实现 | 有界/无界 | 底层 | 特点 |
|-----|----------|------|------|
| ArrayBlockingQueue | 有界 | 数组 | 固定容量，需指定 |
| LinkedBlockingQueue | 可选有界 | 链表 | 默认无界，出入队锁分离 |
| PriorityBlockingQueue | 无界 | 堆 | 按优先级排序 |
| DelayQueue | 无界 | 堆 | 延迟获取元素 |
| SynchronousQueue | 不存储 | - | 直接传递 |

## 面试追问

### Q1: ArrayBlockingQueue vs LinkedBlockingQueue？

| 特性 | ArrayBlockingQueue | LinkedBlockingQueue |
|-----|------------------|-------------------|
| 容量 | 必须指定 | 可选，默认无界 |
| 锁 | 一把锁 | 两把锁（出入队分离） |
| 内存 | 预分配数组 | 按需分配节点 |
| 吞吐量 | 较低 | 较高 |

### Q2: SynchronousQueue 的使用场景？

1. **线程间直接传递**：不需要缓冲
2. **零延迟响应**：每个任务立即被消费
3. **背压机制**：生产者速度受限于消费者速度

### Q3: 为什么 BlockingQueue 不允许 null？

因为 null 被用来表示"超时"或"操作失败"：

- `poll()` 超时返回 null
- `offer()` 失败返回 false

如果允许 null，无法区分"成功插入 null 值"和"操作失败"。

---

## 留给你的思考题

假设你有一个应用，生产者每秒产生 1000 条消息，消费者每秒只能处理 500 条。

你会选择哪种 BlockingQueue？为什么？

提示：考虑以下因素
- 队列容量设置多大？
- 如果队列满了会发生什么？
- 是否有内存溢出的风险？
- 需要什么监控和告警？

理解这个问题，你就掌握了生产环境中队列选型的核心。
