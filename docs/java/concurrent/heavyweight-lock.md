# 重量级锁：Monitor 机制与等待队列

当自旋也无法获取锁时，synchronized 就不得不「请系统出马」了。

这就是**重量级锁**——它需要操作系统介入，把等待的线程挂起（Park），等到锁释放时再唤醒。

这是 synchronized 最「重」的一步，但也是最可靠的保障。

---

## 重量级锁的核心：Monitor

在 HotSpot JVM 中，每个重量级锁都关联一个 **Monitor** 对象（也叫管程）。

Monitor 是什么？它是一种同步机制，确保在任何时候只有一个线程能执行某个代码块。

```
┌─────────────────────────────────────────────────────────────────┐
│                      Monitor 对象结构                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                      Monitor                            │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │                                                         │    │
│  │   ┌─────────┐                                          │    │
│  │   │  Owner  │  当前持有锁的线程                          │    │
│  │   └─────────┘                                          │    │
│  │                                                         │    │
│  │   ┌─────────────────────────────────────────────────┐  │    │
│  │   │              EntryList（竞争队列）                │  │    │
│  │   │   等待获取锁的线程在此排队                        │  │    │
│  │   │   [Thread-3] [Thread-5] [Thread-2] ...            │  │    │
│  │   └─────────────────────────────────────────────────┘  │    │
│  │                                                         │    │
│  │   ┌─────────────────────────────────────────────────┐  │    │
│  │   │              WaitSet（等待队列）                  │  │    │
│  │   │   调用 wait() 后，线程在此等待                    │  │    │
│  │   │   [Thread-1] [Thread-4]                         │  │    │
│  │   └─────────────────────────────────────────────────┘  │    │
│  │                                                         │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Monitor 的三个关键组件

### 1. Owner（持有者）

记录当前持有锁的线程。

```java
// Owner 的作用
Thread currentOwner = monitor.getOwner();  // 获取当前锁持有者
if (currentOwner == Thread.currentThread()) {
    // 可重入！
    incrementHoldCount();
}
```

**可重入机制**：同一线程多次进入 synchronized 会增加计数器，退出时递减。

### 2. EntryList（竞争队列）

当线程尝试获取锁但失败时，会进入 EntryList 排队等待。

```
线程竞争锁失败的流程：

  线程A 持有锁
        │
        ▼
  线程B 尝试获取锁
        │
        ├─── 锁空闲？──▶ 线程B 获取锁，成为 Owner
        │
        └─── 锁被占用？──▶ 进入 EntryList 尾部，等待唤醒
```

### 3. WaitSet（等待队列）

当线程调用 `wait()` 方法时，会释放锁并进入 WaitSet。

```
  线程持有锁
        │
        ▼
  调用 wait()
        │
        ▼
  释放锁，进入 WaitSet
        │
        ▼
  其他线程调用 notify()
        │
        ├─── 随机唤醒一个 ───▶ 进入 EntryList 尾部
        │
        └─── 唤醒全部 ───▶ 全部进入 EntryList
```

---

## synchronized 字节码解析

### monitorenter 和 monitorexit

```java
public class SyncBytecode {
    
    // 编译后的字节码
    public void method();
    descriptor: ()V
    flags:
    Code:
      stack=2, locals=3, args_size=1
         0: aload_0
         1: dup
         2: astore_1
         3: monitorenter      // 进入监视器（获取锁）
         4: aload_1
         5: monitorexit      // 退出监视器（释放锁）
         6: return
         7: astore_2
         8: monitorexit      // 异常路径的释放锁
         9: aload_2
        10: athrow
```

**注意**：有两个 `monitorexit`！

- 第 5 行：正常退出
- 第 8 行：异常退出（确保锁不会泄漏）

这就是为什么 synchronized 不需要 finally 块来释放锁——JVM 已经帮你处理了。

---

## 重量级锁的开销

### 用户态到内核态的切换

这是重量级锁最「重」的地方：

```
┌─────────────────────────────────────────────────────────────────┐
│                    线程阻塞/唤醒的成本                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  用户态 ───────────────────────────────────────────▶ 内核态      │
│   │                                                    │        │
│   │                                                    │        │
│   │     1. 用户代码执行                                │        │
│   │     2. 系统调用（pthread_mutex_lock）             │        │
│   │     3. 内核切换开销（上下文保存/恢复）              │        │
│   │     4. 线程被挂起                                  │        │
│   │                                                    │        │
│   ◀───────────────────────────────────────────        │        │
│        唤醒时：内核态恢复线程，继续执行                    │        │
│                                                                 │
│  单次切换开销：约 1-10 微秒                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 对比三种锁的开销

| 锁类型 | 单次获取成本 | 适用场景 |
|-------|------------|---------|
| 偏向锁 | ~0 纳秒 | 单线程独占 |
| 轻量级锁 | ~100 纳秒 | 短时间竞争 |
| 重量级锁 | ~1-10 微秒 | 长时间竞争 |

**差距**：轻量级锁比重量级锁快 **10-100 倍**！

---

## wait/notify 的实现原理

### wait() 的过程

```java
public class WaitNotifyDemo {
    private final Object lock = new Object();
    
    public void waitForSignal() throws InterruptedException {
        synchronized (lock) {
            while (someConditionNotMet()) {
                lock.wait();  // 释放锁，进入 WaitSet
            }
            // 继续执行
        }
    }
    
    public void sendSignal() {
        synchronized (lock) {
            setCondition();
            lock.notify();  // 唤醒 WaitSet 中的一个线程
        }
    }
}
```

`wait()` 的执行流程：

```
1. 线程持有锁（Owner）
       │
       ▼
2. 调用 wait()，线程进入 WaitSet，锁被释放
       │
       ▼
3. Owner 变为空（或转移给其他线程）
       │
       ▼
4. 线程进入等待状态（不消耗 CPU）
```

### notify() 的过程

```java
// 随机唤醒 WaitSet 中的一个线程
lock.notify();

// 或者唤醒所有
lock.notifyAll();
```

`notify()` 的执行流程：

```
1. 从 WaitSet 中选择一个线程唤醒
       │
       ├─── notify() ──▶ 随机选一个
       │
       └─── notifyAll() ──▶ 唤醒所有
       
       │
       ▼
2. 被唤醒的线程移动到 EntryList 尾部
       │
       ▼
3. 等待获取锁（被唤醒后还需要竞争）
       │
       ▼
4. 竞争成功，继续执行
```

### wait/notify 的坑

```java
// 错误示例：没有在 while 循环中等待
synchronized (lock) {
    if (conditionIsFalse()) {  // 用 if 有问题！
        lock.wait();
    }
}

// 正确示例：必须用 while
synchronized (lock) {
    while (conditionIsFalse()) {  // 防止伪唤醒
        lock.wait();
    }
}
```

**原因**：wait/notify 可能被意外唤醒（伪唤醒），必须重新检查条件。

---

## 生产者-消费者实战

### 用 wait/notify 实现

```java
public class BlockingQueue&lt;T&gt; {
    private final T[] items;
    private int count = 0;
    private int putIndex = 0;
    private int takeIndex = 0;
    private final Object lock = new Object();
    
    public BlockingQueue(int capacity) {
        items = (T[]) new Object[capacity];
    }
    
    // 生产者
    public void put(T item) throws InterruptedException {
        synchronized (lock) {
            // 队列满，等待消费
            while (count == items.length) {
                lock.wait();
            }
            
            items[putIndex] = item;
            putIndex = (putIndex + 1) % items.length;
            count++;
            
            // 唤醒等待的消费者
            lock.notify();
        }
    }
    
    // 消费者
    public T take() throws InterruptedException {
        synchronized (lock) {
            // 队列空，等待生产
            while (count == 0) {
                lock.wait();
            }
            
            T item = items[takeIndex];
            items[takeIndex] = null;  // 帮助 GC
            takeIndex = (takeIndex + 1) % items.length;
            count--;
            
            // 唤醒等待的生产者
            lock.notify();
            
            return item;
        }
    }
}
```

### 为什么推荐用 BlockingQueue？

现代 Java 推荐使用 `java.util.concurrent.BlockingQueue`，因为：
1. 线程安全
2. API 更清晰
3. 避免手动实现 wait/notify 的各种坑

```java
// 推荐写法
BlockingQueue&lt;Task&gt; queue = new LinkedBlockingQueue&lt;&gt;(100);

// 生产者
queue.put(task);

// 消费者
Task task = queue.take();
```

---

## 面试追问方向

1. **synchronized 和 Lock 的 wait/notify 有什么区别？**
   synchronized 用 Object 的 wait/notify，Lock 用 Condition 的 await/signal。Condition 可以创建多个，Object 只有一个等待队列。

2. **为什么 wait/notify 必须在 synchronized 中调用？**
   这是 Java 语言规范的要求，确保线程在调用前已经持有锁。

3. **notifyAll() vs notify()，该怎么选？**
   不确定唤醒哪个线程时用 notifyAll()；确定只需要一个线程时用 notify()。wait/notifyAll() 更安全。

4. **为什么说 wait/notify 可能导致「丢失的信号」？**
   如果 notify() 先于 wait() 调用，wait() 会一直阻塞。解决方案：使用 while 循环或 `java.util.concurrent` 工具。

---

## 留给你的思考题

假设这样一个场景：

```
线程A 持有锁，调用 wait() 进入 WaitSet
线程B 持有锁，调用 wait() 进入 WaitSet
线程C 持有锁，调用 notify()

问题：
1. 哪个线程被唤醒？
2. 被唤醒后线程C 释放锁了吗？
3. 线程A 或线程B 醒来后，需要做什么才能继续执行？
```

**提示**：notify() 只是把线程从 WaitSet 移到 EntryList，并不释放锁。
