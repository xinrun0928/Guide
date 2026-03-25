# sleep() vs wait() vs yield()：三个「让」的哲学

职场中有三种人：

- 偷偷去休息室睡觉的人（sleep）
- 主动放下手里的活等别人的人（wait）
- 跟领导说「让别人先干」的人（yield）

线程也有类似的三个方法，它们看似相似，实则大有不同。

---

## 一句话总结

| 方法 | 作用 | 锁释放 | 状态变化 |
|------|------|--------|---------|
| `sleep()` | 睡一会儿，时间到了自动醒 | ❌ 不释放 | RUNNABLE → TIMED_WAITING |
| `wait()` | 等等，有通知再继续 | ✅ 释放 | RUNNABLE → WAITING |
| `yield()` | 让一让，我不急 | ❌ 不释放 | RUNNABLE → RUNNABLE |

---

## sleep()：指定时间休息

```java
// sleep 2 秒
Thread.sleep(2000);

// sleep 是静态方法，调用 Thread.sleep()
// 不是某个线程的 sleep，而是「当前线程」sleep
Thread.sleep(1000);
System.out.println("我是主线程"); // 这行执行时，主线程睡了 1 秒
```

### 特点

- **不释放锁**：sleep 时仍然持有 synchronized 锁
- **静态方法**：Thread.sleep()，作用的是当前线程
- **自动唤醒**：时间到了自动变回 RUNNABLE
- **可中断**：sleep 时被 interrupt() 会抛 InterruptedException

### 使用场景

- 模拟耗时操作
- 控制请求频率
- 等待某个时间点

```java
// 典型用法：重试间隔
while (true) {
    try {
        doSomething();
        break;
    } catch (Exception e) {
        Thread.sleep(1000); // 失败后等 1 秒重试
    }
}
```

---

## wait()：等待通知

```java
synchronized (lock) {
    while (condition不满足) {
        lock.wait(); // 必须放在 synchronized 中！否则抛异常
    }
    // 条件满足，继续执行
}
```

### 特点

- **必须放在 synchronized 中**：否则抛 IllegalMonitorStateException
- **释放锁**：wait 时线程放弃 lock，其他线程可以进入
- **等待通知**：需要其他线程调用 notify() 或 notifyAll()
- **可以设置超时**：wait(long millis)，超时自动唤醒

### 三种 wait 形式

```java
// 无限等待
obj.wait();

// 等 1 秒
obj.wait(1000);

// 等到某个时间点
obj.wait(deadline - System.currentTimeMillis());
```

### 与 sleep 的本质区别

```java
synchronized (lock) {
    // 场景：检查共享变量
    while (flag == false) {
        lock.wait(); // 释放锁，让其他线程可以修改 flag
    }
    // 使用共享资源
}
```

> **为什么必须用 while 而不是 if？**
>
> 因为 wait 可能被「伪唤醒」——没有任何线程调用 notify，线程自己醒了。用 while 可以再次检查条件。

---

## yield()：谦虚一下

```java
Thread.yield(); // 当前线程让出 CPU，重新参与调度
```

### 特点

- **不释放锁**：yield 时仍然持有锁
- **只是建议**：调度器可能忽略这个建议
- **回到就绪**：不是阻塞，是立刻回到 RUNNABLE 等待调度
- **无副作用**：不会抛异常

### 使用场景

- **几乎没有生产场景**：yield 太不可靠
- **调试/测试**：模拟线程切换
- **避免饥饿**：理论上可以让高优先级线程偶尔让一让

```java
// yield 的典型（但很少用）场景
public void run() {
    while (true) {
        // 做一点工作
        doWork();

        // 让其他线程有机会执行
        Thread.yield();
    }
}
```

---

## 对比表格

| 特性 | sleep() | wait() | yield() |
|------|---------|--------|---------|
| 方法来源 | Thread | Object | Thread |
| 是否释放锁 | ❌ | ✅ | ❌ |
| 是否需要 synchronized | ❌ | ✅ | ❌ |
| 唤醒方式 | 时间到自动醒 | notify/notifyAll | 调度器决定 |
| 是否可中断 | ✅ | ✅ | ❌ |
| 线程状态 | TIMED_WAITING | WAITING | RUNNABLE |
| 常见场景 | 重试间隔 | 生产者-消费者 | 几乎没有 |

---

## notify() 和 notifyAll()

wait() 必须配合 notify() 使用才有意义：

```java
// 线程 A（消费者）
synchronized (lock) {
    while (queue.isEmpty()) {
        lock.wait(); // 没东西就等着
    }
    Object item = queue.poll();
    lock.notify(); // 叫醒一个等待的线程（生产者）
}

// 线程 B（生产者）
synchronized (lock) {
    queue.offer(item);
    lock.notify(); // 叫醒一个等待的线程（消费者）
}
```

### notify() vs notifyAll()

| 方法 | 效果 | 风险 |
|------|------|------|
| notify() | 随机唤醒一个 WAITING 线程 | 可能导致其他线程永久等待 |
| notifyAll() | 唤醒所有 WAITING 线程 | 性能略差，但更安全 |

**最佳实践**：大多数情况下用 `notifyAll()` 更安全，notify() 容易踩坑。

---

## 生产者-消费者完整示例

```java
public class ProducerConsumer {
    private static final Object lock = new Object();
    private static Queue&lt;Integer&gt; queue = new LinkedList&lt;&gt;();
    private static final int MAX = 10;

    static class Producer extends Thread {
        @Override
        public void run() {
            synchronized (lock) {
                while (queue.size() >= MAX) {
                    try {
                        lock.wait(); // 满了，等消费
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                }
                queue.offer(1);
                System.out.println("生产，当前数量: " + queue.size());
                lock.notifyAll(); // 通知消费者
            }
        }
    }

    static class Consumer extends Thread {
        @Override
        public void run() {
            synchronized (lock) {
                while (queue.isEmpty()) {
                    try {
                        lock.wait(); // 空的，等生产
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                }
                queue.poll();
                System.out.println("消费，当前数量: " + queue.size());
                lock.notifyAll(); // 通知生产者
            }
        }
    }

    public static void main(String[] args) {
        for (int i = 0; i &lt; 5; i++) new Producer().start();
        for (int i = 0; i &lt; 3; i++) new Consumer().start();
    }
}
```

---

## 面试高频追问

**Q：sleep() 和 wait() 都会让线程等待，它们的本质区别是什么？**

A：sleep() 不释放锁，时间到了自动醒；wait() 必须配合 synchronized 使用，会释放锁，需要 notify() 唤醒。

**Q：wait() 为什么必须在 synchronized 中调用？**

A：这是 Java 的设计规范。wait/notify 是监视器模式的一部分，需要确保原子性。如果不在 synchronized 中，线程可能在 wait 之前就失去 CPU，导致条件已经被其他线程改变。

**Q：yield() 在实际开发中有什么用？**

A：几乎没有用。它的行为完全由 JVM 决定，不保证任何事情。不要在生产代码中使用 yield()。

---

## 留给你的思考题

```java
public class 思考题 {
    private static final Object lock = new Object();

    public static void main(String[] args) throws InterruptedException {
        Thread t1 = new Thread(() -> {
            synchronized (lock) {
                System.out.println("T1 获得锁，开始等");
                try {
                    lock.wait();
                } catch (InterruptedException e) {}
                System.out.println("T1 被唤醒");
            }
        });

        synchronized (lock) {
            t1.start();
            Thread.sleep(100);
            lock.notify(); // 注释掉这行会怎样？
        }

        System.out.println("主线程结束");
    }
}
```

如果注释掉 `lock.notify()`，T1 会怎样？程序会正常结束吗？

---

**提示**：JVM 退出条件是什么？守护线程还是用户线程？
