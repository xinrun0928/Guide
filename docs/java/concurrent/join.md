# join()：等待的艺术

想象一个场景：

你是一个项目的负责人（主线程），有三个下属（子线程）分别去做三件事：
- 小王：去打印室取资料
- 小李：去仓库盘点
- 小张：去买咖啡

你必须等三个人都回来才能开会。

怎么表达这种「等」？Java 里的 `join()` 就是干这个的。

---

## join() 的基本用法

```java
public class JoinDemo {
    public static void main(String[] args) throws InterruptedException {
        Thread t1 = new Thread(() -> {
            System.out.println("小王：资料取回来了");
        });

        Thread t2 = new Thread(() -> {
            System.out.println("小李：盘点完成");
        });

        t1.start();
        t2.start();

        // 等待两个线程执行完成
        t1.join();
        t2.join();

        System.out.println("三个人都回来了，可以开会了");
    }
}
```

输出顺序（一定是最后打印"开会"）：

```
小王：资料取回来了
小李：盘点完成
三个人都回来了，可以开会了
```

---

## join() 的原理

`join()` 的本质是 `wait()`：

```java
// Thread.join() 源码简化
public final void join() throws InterruptedException {
    // 底层调用 wait()
    wait();
}

// 带超时的版本
public final synchronized void join(long millis) throws InterruptedException {
    // 底层调用 wait(millis)
    wait(millis);
}
```

### 执行流程

```
主线程                    JVM                    子线程
   │                        │                       │
   │  t.start()             │                       │
   ├────────────────────────┼──────────────────────►│
   │                        │                       │
   │  t.join()              │                       │
   ├────────────────────────┼──────────────────────►│
   │                        │                       │
   │  wait()                │                       │ run() 执行中...
   │  (主线程阻塞)           │                       │
   │                        │                       │
   │                        │◄──────────────────────│ run() 结束
   │                        │    notifyAll()        │
   │  被唤醒                 │                       │
   │  (继续执行)             │                       │
```

**关键点**：`join()` 会让主线程进入 WAITING，等待子线程执行完毕。当子线程 run() 结束时，JVM 会自动调用 notifyAll() 唤醒等待的线程。

---

## 带超时的 join()

```java
// 最多等 3 秒，3 秒后不等了，继续执行
t.join(3000);

try {
    t.join();
} catch (InterruptedException e) {
    // 处理中断
}
```

### 应用场景

```java
public class TimeoutJoin {
    public static void main(String[] args) throws InterruptedException {
        Thread task = new Thread(() -> {
            // 模拟耗时操作，可能很慢
            try {
                Thread.sleep(5000);
            } catch (InterruptedException e) {}
            System.out.println("任务完成");
        });

        long start = System.currentTimeMillis();
        task.start();

        // 最多等 2 秒
        task.join(2000);

        long elapsed = System.currentTimeMillis() - start;
        if (task.isAlive()) {
            System.out.println("等了 " + elapsed + "ms，任务还没完成，先干别的");
        } else {
            System.out.println("任务已完成，耗时 " + elapsed + "ms");
        }
    }
}
```

---

## join() 与中断

```java
Thread t = new Thread(() -> {
    while (!Thread.currentThread().isInterrupted()) {
        // 做点什么
    }
});

t.start();

try {
    t.join();
} catch (InterruptedException e) {
    // 清理中断标志
    Thread.currentThread().interrupt();
    System.out.println("被中断了");
}
```

> **注意**：捕获 InterruptedException 后要重新设置中断状态，否则中断信息会丢失。

---

## 经典模式：主线程等待多个子线程

```java
public class WaitAllDemo {
    public static void main(String[] args) throws InterruptedException {
        List&lt;Thread&gt; threads = new ArrayList&lt;&gt;();

        // 创建 5 个子线程
        for (int i = 0; i &lt; 5; i++) {
            final int taskId = i;
            Thread t = new Thread(() -> {
                System.out.println("Task " + taskId + " 完成");
            });
            threads.add(t);
            t.start();
        }

        // 等待所有子线程完成
        for (Thread t : threads) {
            t.join();
        }

        System.out.println("所有任务完成，主线程继续");
    }
}
```

### 更优雅的方式：CountDownLatch

`join()` 的问题是代码不够优雅。更推荐的方式是 `CountDownLatch`：

```java
public class CountDownLatchDemo {
    public static void main(String[] args) throws InterruptedException {
        int taskCount = 5;
        CountDownLatch latch = new CountDownLatch(taskCount);

        for (int i = 0; i &lt; taskCount; i++) {
            final int taskId = i;
            new Thread(() -> {
                System.out.println("Task " + taskId + " 完成");
                latch.countDown();
            }).start();
        }

        // 等待所有任务完成
        latch.await();
        System.out.println("所有任务完成，主线程继续");
    }
}
```

---

## join() vs sleep() vs wait()

| 方法 | 作用对象 | 是否释放锁 | 唤醒方式 |
|------|---------|-----------|---------|
| `join()` | 另一个线程 | ✅ 释放（内部用 wait） | 线程结束自动唤醒 |
| `sleep()` | 当前线程 | ❌ 不释放 | 时间到自动醒 |
| `wait()` | 持有同一锁的线程 | ✅ 释放 | notify/notifyAll |

---

## 面试追问方向

**Q：join() 和 Thread.stop() 有什么区别？**

A：join() 是优雅等待，让线程自然结束；stop() 是强制终止，不安全，可能导致资源未释放、锁未释放等问题，已被废弃。

**Q：join() 在哪个对象上 wait？**

A：join() 是在 `this`（即调用 join() 的 Thread 对象）上 wait。比如 `t.join()` 就是在 t 对象上 wait。

**Q：为什么推荐用 CountDownLatch 而不是 join()？**

A：join() 只能等待特定线程，CountDownLatch 可以等待任意计数；join() 无法中途取消，CountDownLatch 可以配合中断使用。

---

## 留给你的思考题

```java
public class 思考题 {
    public static void main(String[] args) throws InterruptedException {
        Thread t = new Thread(() -> {
            try {
                Thread.sleep(2000);
            } catch (InterruptedException e) {
                System.out.println("子线程被中断");
            }
            System.out.println("子线程结束");
        });

        t.start();
        t.join(1000); // 只等 1 秒

        System.out.println("主线程继续执行");
        Thread.sleep(3000);
        System.out.println("主线程结束");
    }
}
```

输出顺序是什么？子线程真的结束了吗？

---

**提示**：带超时的 join() 不会中断线程，只是等待一段时间后继续。
