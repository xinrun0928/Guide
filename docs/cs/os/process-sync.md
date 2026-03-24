# 进程同步：哲学家就餐、读者写者问题

哲学家就餐问题和读者写者问题，是操作系统领域最经典的两个同步问题。
看似简单，却能考察你对并发控制的理解深度。


## 先思考一个问题

假设你和室友共用一台打印机和一台电脑。你在打印的时候，室友也想打印。
你能直接抢过来吗？当然不能。那怎么协调？

这就是**进程同步**要解决的问题。


## 同步 vs 互斥

```
同步：多个进程按一定顺序执行
      例如：先生产再消费
      
互斥：多个进程不能同时访问共享资源
      例如：两个人不能同时用一把牙刷
```


## 问题一：生产者-消费者问题

**最经典的同步问题——缓冲区不能为空也不能满。**

```
┌────────┐     ┌──────────────────┐     ┌────────┐
│生产者1 │────►│                  │────►│消费者1 │
│生产者2 │────►│    缓冲区(N)     │────►│消费者2 │
│生产者3 │────►│                  │────►│消费者3 │
└────────┘     └──────────────────┘     └────────┘

规则：
1. 缓冲区满时，生产者不能生产（阻塞）
2. 缓冲区空时，消费者不能消费（阻塞）
3. 互斥访问缓冲区
```

### Java实现

```java
public class ProducerConsumer {
    private static final int CAPACITY = 10;
    private final Queue<Integer> buffer = new LinkedList<>();
    private final int maxSize = CAPACITY;

    // 使用信号量实现
    private final Semaphore mutex = new Semaphore(1);       // 互斥信号量
    private final Semaphore full = new Semaphore(0);        // 满缓冲区计数
    private final Semaphore empty = new Semaphore(CAPACITY); // 空缓冲区计数

    // 生产者
    static class Producer implements Runnable {
        private final ProducerConsumer pc;
        private final int id;

        Producer(ProducerConsumer pc, int id) {
            this.pc = pc;
            this.id = id;
        }

        @Override
        public void run() {
            for (int i = 0; i < 50; i++) {
                try {
                    pc.produce(i);
                    System.out.println("Producer " + id + " produced: " + i);
                    Thread.sleep(100);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }
    }

    // 消费者
    static class Consumer implements Runnable {
        private final ProducerConsumer pc;
        private final int id;

        Consumer(ProducerConsumer pc, int id) {
            this.pc = pc;
            this.id = id;
        }

        @Override
        public void run() {
            while (true) {
                try {
                    Integer item = pc.consume();
                    System.out.println("Consumer " + id + " consumed: " + item);
                    Thread.sleep(200);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
    }

    public void produce(int item) throws InterruptedException {
        empty.acquire();  // 消耗一个空槽位
        mutex.acquire();   // 进入临界区
        try {
            buffer.offer(item);
        } finally {
            mutex.release();
            full.release();  // 增加一个满槽位
        }
    }

    public Integer consume() throws InterruptedException {
        full.acquire();    // 消耗一个满槽位
        mutex.acquire();   // 进入临界区
        try {
            return buffer.poll();
        } finally {
            mutex.release();
            empty.release(); // 增加一个空槽位
        }
    }

    public static void main(String[] args) {
        ProducerConsumer pc = new ProducerConsumer();

        // 启动3个生产者，2个消费者
        ExecutorService producers = Executors.newFixedThreadPool(3);
        ExecutorService consumers = Executors.newFixedThreadPool(2);

        for (int i = 0; i < 3; i++) {
            producers.submit(new Producer(pc, i));
        }
        for (int i = 0; i < 2; i++) {
            consumers.submit(new Consumer(pc, i));
        }

        // 运行一段时间后关闭
        try {
            Thread.sleep(5000);
        } catch (InterruptedException e) {}
        producers.shutdown();
        consumers.shutdown();
    }
}
```

**信号量分析：**
- `empty`：初始值N，表示空缓冲区数量
- `full`：初始值0，表示满缓冲区数量
- `mutex`：初始值1，保证互斥访问


## 问题二：哲学家就餐问题

**经典的死锁问题——五个哲学家、五根筷子、循环等待。**

```
        哲学家0
           │
    筷子0  │  筷子4
           ▼
哲学家4  ●──────●  哲学家1
    筷子3            筷子1
           │
        哲学家3       哲学家2
           │            │
           ▼            ▼
        筷子2  ─────  ●
```

### 问题描述

五个哲学家围坐一张桌子，每人面前有一碗米饭，两根筷子分别在左右。
每个哲学家需要同时拿到左右两根筷子才能吃饭。

### 错误的解法

```java
// 错误解法：直接加互斥锁
public class PhilosopherWrong {
    private final Semaphore mutex = new Semaphore(1);

    public void eat(int philosopherId) {
        try {
            mutex.acquire();  // 所有人都抢同一把锁
            // 拿筷子
            // 吃饭
            // 放筷子
        } finally {
            mutex.release();
        }
    }
    // 问题：变成了串行执行，违背了并发初衷
}
```

### 解法一：限制同时吃饭的人数

```java
// 解法1：最多4个哲学家同时尝试拿筷子
public class PhilosopherSolution1 {
    private final Semaphore table = new Semaphore(4);  // 关键！

    public void eat(int philosopherId) throws InterruptedException {
        table.acquire();

        // 拿起左右筷子
        takeChopsticks(philosopherId);

        // 吃饭
        System.out.println("Philosopher " + philosopherId + " is eating");

        // 放下筷子
        dropChopsticks(philosopherId);

        table.release();
    }
}
```

### 解法二：让一个人拿筷子的顺序不同

```java
// 解法2：打破循环等待 - 最后一个哲学家先拿右边
public class PhilosopherSolution2 {
    private final Chopstick[] chopsticks;

    public PhilosopherSolution2(int n) {
        chopsticks = new Chopstick[n];
        for (int i = 0; i < n; i++) {
            chopsticks[i] = new Chopstick();
        }
    }

    public void eat(int philosopherId) throws InterruptedException {
        int left = philosopherId;
        int right = (philosopherId + 1) % chopsticks.length;

        // 最后一个哲学家先拿右边
        if (philosopherId == chopsticks.length - 1) {
            chopsticks[right].acquire();
            chopsticks[left].acquire();
        } else {
            chopsticks[left].acquire();
            chopsticks[right].acquire();
        }

        System.out.println("Philosopher " + philosopherId + " is eating");

        chopsticks[left].release();
        chopsticks[right].release();
    }
}
```

### 解法三：使用ReentrantLock和tryLock

```java
// 解法3：非阻塞尝试
public class PhilosopherSolution3 {
    private final ReentrantLock lock = new ReentrantLock();

    public boolean tryToEat(int philosopherId) {
        int left = philosopherId;
        int right = (philosopherId + 1) % 5;

        // 尝试获取左筷子
        if (!chopsticks[left].tryLock()) {
            return false;  // 拿不到就放弃
        }

        // 尝试获取右筷子
        if (!chopsticks[right].tryLock()) {
            chopsticks[left].unlock();  // 释放左筷子
            return false;
        }

        // 吃饭
        return true;
    }
}
```


## 问题三：读者-写者问题

**读操作可以并发，写操作必须独占。**

```
┌────────────────────────────────────────────┐
│               共享数据区                     │
│                                            │
│   读者1 ──┐                                │
│   读者2 ──┼──► 同时读取  ✓                  │
│   读者3 ──┘                                │
│                                            │
│   写者1  ──► 独占写入  ✗（需等待所有读者）   │
│   写者2  ──► 独占写入  ✗（需等待写者1）      │
└────────────────────────────────────────────┘
```

### Java实现（写者优先）

```java
public class ReadWriteLock {
    private int readers = 0;           // 当前读者数量
    private boolean writing = false;    // 是否正在写入
    private final ReentrantReadWriteLock rwLock =
        new ReentrantReadWriteLock();
    private final Lock readLock = rwLock.readLock();
    private final Lock writeLock = rwLock.writeLock();

    // 读者
    public void read() throws InterruptedException {
        // 写者优先的读者实现
        synchronized (this) {
            while (writing) {
                wait();
            }
            readers++;
        }

        // 执行读操作
        System.out.println("Reading, readers: " + readers);
        Thread.sleep(100);

        synchronized (this) {
            readers--;
            notifyAll();
        }
    }

    // 写者
    public synchronized void write() throws InterruptedException {
        while (readers > 0 || writing) {
            wait();
        }
        writing = true;

        // 执行写操作
        System.out.println("Writing...");
        Thread.sleep(100);

        writing = false;
        notifyAll();
    }
}
```

### 使用ReadWriteLock实现（读优先）

```java
public class ReadWriteLockImpl {
    private final ReadWriteLock rwLock = new ReentrantReadWriteLock();

    public void read() {
        rwLock.readLock().lock();
        try {
            // 读操作，多个读者可以同时进入
            System.out.println("Reading by " + Thread.currentThread().getName());
            Thread.sleep(100);
        } finally {
            rwLock.readLock().unlock();
        }
    }

    public void write() {
        rwLock.writeLock().lock();
        try {
            // 写操作，独占
            System.out.println("Writing by " + Thread.currentThread().getName());
            Thread.sleep(100);
        } finally {
            rwLock.writeLock().unlock();
        }
    }
}
```


## 总结：同步问题的解决思路

```
┌─────────────────────────────────────────────────────┐
│                  解决同步问题的模式                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  1. 破坏互斥条件？                                    │
│     → 不是所有资源都能共享                           │
│                                                     │
│  2. 破坏请求和保持？                                  │
│     → 一次性获取所有资源                             │
│                                                     │
│  3. 破坏不可抢占？                                    │
│     → 如果拿不到需要的，就释放已占有的               │
│                                                     │
│  4. 破坏循环等待？                                    │
│     → 按固定顺序获取资源                             │
│                                                     │
│  5. 破坏循环等待？                                    │
│     → 使用定时锁，尝试获取，超时回退                  │
│                                                     │
└─────────────────────────────────────────────────────┘
```


## 面试追问方向

- **哲学家就餐问题为什么会产生死锁？**
  提示：循环等待 + 请求保持 + 不可抢占 + 互斥。
- **读者-写者问题中，读优先和写优先有什么区别？**
  提示：读优先可能让写者饥饿，写优先可能让读者饥饿。
- **生产者-消费者问题中，为什么需要三个信号量？**
  提示：empty、full、mutex各自的作用。
- **除了信号量，还有什么方式可以实现生产者-消费者？**
  提示：BlockingQueue。
