# 生产者-消费者问题

这是并发编程中最经典的问题之一。

一个线程生产数据，另一个线程消费数据，两者需要协调运行。

---

## 问题描述

```
┌─────────────────────────────────────────────────────────────┐
│                  生产者-消费者模型                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   生产者                              消费者                 │
│   ┌─────┐                           ┌─────┐               │
│   │     │ ────── 数据 ──────→       │     │               │
│   └─────┘                           └─────┘               │
│       │                                   │                │
│       ↓                                   ↑                │
│   ┌─────────────────────────────────────────┐              │
│   │            缓冲区（队列）                │              │
│   │  [数据1] [数据2] [数据3] ...           │              │
│   └─────────────────────────────────────────┘              │
│                                                             │
│   约束：                                                    │
│   - 缓冲区满时，生产者不能生产                               │
│   - 缓冲区空时，消费者不能消费                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 同步需求

1. **互斥**：对缓冲区的访问需要互斥
2. **条件同步**：
   - 缓冲区满 → 消费者等待
   - 缓冲区空 → 生产者等待

---

## 方案一：wait()/notify() 实现

### 基本实现

```java
import java.util.*;

public class ProducerConsumer {
    private static final int CAPACITY = 10;
    private final Queue<Integer> buffer = new LinkedList<>();
    
    // 生产者
    public class Producer extends Thread {
        private int data = 0;
        
        @Override
        public void run() {
            while (true) {
                synchronized (buffer) {
                    // 缓冲区满，等待消费者消费
                    while (buffer.size() >= CAPACITY) {
                        try {
                            buffer.wait();
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                        }
                    }
                    
                    // 生产数据
                    buffer.offer(data);
                    System.out.println("生产: " + data);
                    data++;
                    
                    // 通知消费者可以消费了
                    buffer.notifyAll();
                }
                
                try {
                    Thread.sleep(100);
                } catch (InterruptedException e) {}
            }
        }
    }
    
    // 消费者
    public class Consumer extends Thread {
        @Override
        public void run() {
            while (true) {
                synchronized (buffer) {
                    // 缓冲区空，等待生产者生产
                    while (buffer.isEmpty()) {
                        try {
                            buffer.wait();
                        } catch (InterruptedException e) {
                            Thread.currentThread().interrupt();
                        }
                    }
                    
                    // 消费数据
                    Integer data = buffer.poll();
                    System.out.println("消费: " + data);
                    
                    // 通知生产者可以生产了
                    buffer.notifyAll();
                }
                
                try {
                    Thread.sleep(200);
                } catch (InterruptedException e) {}
            }
        }
    }
    
    public static void main(String[] args) {
        ProducerConsumer pc = new ProducerConsumer();
        pc.new Producer().start();
        pc.new Producer().start();
        pc.new Consumer().start();
        pc.new Consumer().start();
    }
}
```

### 关键点解释

```java
// 为什么用 while 而不是 if？
while (buffer.size() >= CAPACITY) {
    buffer.wait();  // 唤醒后还要再检查一次
}

// 原因：notify() 可能是「假」唤醒，或者多个线程同时被唤醒
// 必须再次检查条件，否则可能导致越界
```

---

## 方案二：BlockingQueue 实现（推荐）

Java 并发包提供了现成的 `BlockingQueue`，封装了同步逻辑。

```java
import java.util.concurrent.*;

public class BlockingQueueDemo {
    private static final int CAPACITY = 10;
    private final BlockingQueue<Integer> queue = 
        new LinkedBlockingQueue<>(CAPACITY);
    
    // 生产者
    public class Producer extends Thread {
        private int data = 0;
        
        @Override
        public void run() {
            while (true) {
                try {
                    // put() 会阻塞，直到队列有空位
                    queue.put(data);
                    System.out.println("生产: " + data);
                    data++;
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
    }
    
    // 消费者
    public class Consumer extends Thread {
        @Override
        public void run() {
            while (true) {
                try {
                    // take() 会阻塞，直到队列有数据
                    Integer data = queue.take();
                    System.out.println("消费: " + data);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
    }
    
    public static void main(String[] args) {
        BlockingQueueDemo demo = new BlockingQueueDemo();
        demo.new Producer().start();
        demo.new Producer().start();
        demo.new Consumer().start();
        demo.new Consumer().start();
    }
}
```

### BlockingQueue 方法对比

| 方法 | 队列满/空时 | 返回值 |
|-----|-----------|--------|
| `put(e)` | 阻塞等待 | void |
| `offer(e, timeout)` | 超时等待 | boolean |
| `offer(e)` | 立即返回 | boolean |
| `take()` | 阻塞等待 | E |
| `poll(timeout)` | 超时等待 | E |
| `poll()` | 立即返回 | E |

---

## 方案三：Condition 实现

`Lock` 配合 `Condition` 可以更精细地控制。

```java
import java.util.concurrent.locks.*;

public class ConditionDemo {
    private static final int CAPACITY = 10;
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition notFull = lock.newCondition();   // 队列不满
    private final Condition notEmpty = lock.newCondition(); // 队列不空
    private final Queue<Integer> buffer = new LinkedList<>();
    
    public class Producer extends Thread {
        private int data = 0;
        
        @Override
        public void run() {
            while (true) {
                lock.lock();
                try {
                    while (buffer.size() >= CAPACITY) {
                        notFull.await();  // 等待不满
                    }
                    
                    buffer.offer(data);
                    System.out.println("生产: " + data);
                    data++;
                    
                    notEmpty.signalAll();  // 通知队列不空
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    lock.unlock();
                }
            }
        }
    }
    
    public class Consumer extends Thread {
        @Override
        public void run() {
            while (true) {
                lock.lock();
                try {
                    while (buffer.isEmpty()) {
                        notEmpty.await();  // 等待不空
                    }
                    
                    Integer data = buffer.poll();
                    System.out.println("消费: " + data);
                    
                    notFull.signalAll();  // 通知队列不满
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    lock.unlock();
                }
            }
        }
    }
}
```

### Condition vs Object.wait/notify

| 特性 | Condition | Object.wait/notify |
|-----|-----------|-------------------|
| 等待队列 | 多个 | 一个 |
| 中断支持 | awaitUninterruptibly() | 无 |
| 超时 | awaitNanos() | 无 |
| 锁条件 | 绑定 Lock | 绑定 Object |

---

## 完整示例：订单处理系统

```java
import java.util.concurrent.*;
import java.util.*;

public class OrderProcessingSystem {
    // 订单队列
    private final BlockingQueue<Order> orderQueue = new LinkedBlockingQueue<>(100);
    
    // 处理结果
    private final Map<String, OrderResult> results = new ConcurrentHashMap<>();
    
    // 订单类
    static class Order {
        final String orderId;
        final double amount;
        
        Order(String orderId, double amount) {
            this.orderId = orderId;
            this.amount = amount;
        }
    }
    
    // 处理结果类
    static class OrderResult {
        final String orderId;
        final boolean success;
        final String message;
        
        OrderResult(String orderId, boolean success, String message) {
            this.orderId = orderId;
            this.success = success;
            this.message = message;
        }
    }
    
    // 生产者：接收订单
    public class OrderReceiver extends Thread {
        private final Random random = new Random();
        
        @Override
        public void run() {
            while (true) {
                try {
                    // 模拟接收订单
                    String orderId = "ORD-" + System.currentTimeMillis();
                    double amount = random.nextDouble() * 10000;
                    
                    Order order = new Order(orderId, amount);
                    orderQueue.put(order);
                    
                    System.out.println("接收订单: " + orderId + ", 金额: " + amount);
                    
                    Thread.sleep(random.nextInt(1000));
                } catch (InterruptedException e) {
                    break;
                }
            }
        }
    }
    
    // 消费者：处理订单
    public class OrderProcessor extends Thread {
        private final int processorId;
        
        public OrderProcessor(int id) {
            this.processorId = id;
        }
        
        @Override
        public void run() {
            while (true) {
                try {
                    Order order = orderQueue.take();  // 阻塞等待
                    
                    System.out.println("处理器-" + processorId + " 处理: " + order.orderId);
                    
                    // 模拟处理
                    Thread.sleep(100);
                    
                    // 存储结果
                    OrderResult result = new OrderResult(
                        order.orderId,
                        true,
                        "处理成功"
                    );
                    results.put(order.orderId, result);
                    
                } catch (InterruptedException e) {
                    break;
                }
            }
        }
    }
    
    public static void main(String[] args) {
        OrderProcessingSystem system = new OrderProcessingSystem();
        
        // 启动 1 个接收线程
        system.new OrderReceiver().start();
        
        // 启动 3 个处理线程
        for (int i = 1; i <= 3; i++) {
            system.new OrderProcessor(i).start();
        }
    }
}
```

---

## 面试实战

**面试官问**：「生产者-消费者问题怎么解决？」

**参考回答**：
> 生产者-消费者问题的核心是**同步**和**互斥**。
>
> 同步需要两个条件：
> - 缓冲区满时，生产者等待
> - 缓冲区空时，消费者等待
>
> 互斥需要保护缓冲区的访问。
>
> **方案一**：用 `wait()/notifyAll()` 实现，这是最基础的方案。
>
> **方案二**：用 `BlockingQueue`，Java 并发包已经封装好了，生产者用 `put()`，消费者用 `take()`，内部自动处理同步。
>
> 实际工作中推荐方案二，简单可靠。

**追问**：「为什么用 while 而不是 if 判断条件？」

**参考回答**：
> 因为 `wait()` 可能被**伪唤醒**。即使没有调用 `notify()`，线程也可能被唤醒。另外，多个生产者/消费者同时被唤醒时，只有一个能成功操作，其他的需要继续等待。
>
> 所以唤醒后必须重新检查条件：`while (条件不满足) wait()`。

---

## 总结

```
┌─────────────────────────────────────────────────────────────┐
│                生产者-消费者问题解决方案                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  核心问题：                                                  │
│  1. 互斥：保护缓冲区的访问                                   │
│  2. 同步：缓冲区满/空的等待                                  │
│                                                             │
│  方案对比：                                                   │
│  ┌────────────┬────────────┬────────────┬─────────────┐     │
│  │  方案       │  复杂度    │  推荐度     │  适用场景    │     │
│  ├────────────┼────────────┼────────────┼─────────────┤     │
│  │ wait/notify│  高        │  ⭐⭐        │  学习原理    │     │
│  │ Condition  │  中        │  ⭐⭐⭐      │  需要精细控制 │     │
│  │ BlockingQueue│ 低        │  ⭐⭐⭐⭐⭐   │  生产环境    │     │
│  └────────────┴────────────┴────────────┴─────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 留给你的思考题

如果只有一个生产者和一个消费者，下面两种实现有什么区别？

```java
// 方案 A
synchronized (buffer) {
    if (buffer.isEmpty()) {
        buffer.wait();
    }
    // 消费
}

// 方案 B
synchronized (buffer) {
    while (buffer.isEmpty()) {
        buffer.wait();
    }
    // 消费
}
```

在什么情况下，方案 A 会出问题？

（提示：考虑 `notifyAll()` 唤醒多个线程的场景）
