# start() vs run()：为什么必须调用 start()？

面试官问：「启动一个线程，你会怎么做？」

你回答：「调用 start() 方法。」

面试官追问：「为什么不用 run()？run() 不是也会执行吗？」

这题看似简单，但能答清楚的人不多。

---

## 直接调用 run() 的问题

先看一段代码：

```java
public class StartVsRun {
    public static void main(String[] args) {
        Thread t = new Thread(() -> {
            System.out.println("当前线程: " + Thread.currentThread().getName());
        });

        t.run();  // 方式一：直接调用 run()
        // t.start(); // 方式二：调用 start()
    }
}
```

运行结果：

```
当前线程: main
```

**问题来了**：输出的是 `main`，不是 `Thread-0`。

这说明 `run()` 根本不是在独立线程中执行的，而是在**调用者线程（主线程）**中执行的。

---

## start() 做了什么？

调用 `start()` 会真正创建一个新线程，并在这个新线程中执行 `run()`：

```
主线程                    新线程
   │                        │
   │  start()               │
   ├───────────────────────►│
   │                        │  JVM 创建 OS 线程
   │                        │  调用本地方法 start0()
   │                        │
   │                        │  run() 在这里执行
   │                        │  （独立栈空间）
```

---

## 源码解析

```java
// Thread.java
public class Thread implements Runnable {
    private Runnable target;

    public void start() {
        // 1. 检查线程状态，必须是 NEW
        if (threadStatus != 0) {
            throw new IllegalThreadStateException();
        }

        // 2. 加入线程组
        group.add(this);

        // 3. 创建操作系统线程
        start0();
    }

    // 本地方法，由 JVM 实现
    private native void start0();

    @Override
    public void run() {
        if (target != null) {
            target.run();
        }
    }
}
```

**关键点**：`start0()` 是 native 方法，由 JVM 在底层创建真正的 OS 线程。

---

## 为什么 start() 只能调用一次？

```java
Thread t = new Thread(() -> System.out.println("执行"));
t.start(); // 第一次：OK
t.start(); // 第二次：抛异常 IllegalThreadStateException
```

因为 `start()` 会将 `threadStatus` 从 0 改成其他值，JVM 检查状态不对就抛异常。

这保证了：**一个 Thread 对象对应一个真实的操作系统线程**。

---

## 四种情况对比

| 场景 | 线程数 | 执行位置 | 结果 |
|------|--------|---------|------|
| `t.run()` | 1 | 主线程 | 看起来像多线程，实际是单线程 |
| `t.start()` | 2 | 新线程 | 真正创建新线程 |
| 多次 `run()` | 1 | 主线程 | 多次调用，多次执行 |
| 多次 `start()` | 1 | 抛异常 | 只能 start 一次 |

---

## 面试场景模拟

**面试官**：启动一个线程，用 start() 还是 run()？

**候选人甲**：都行吧，结果一样。

**面试官**：（摇头）

**候选人乙**：用 start()。run() 只是在当前线程执行，start() 才真正创建新线程。

**面试官**：为什么 start() 只能调用一次？

**候选人乙**：因为 start() 会调用本地方法创建 OS 线程，JVM 内部会检查线程状态，只能在 NEW 状态下调用。

**面试官**：（点头）好，继续。

---

## 实际应用中的坑

### 坑一：误用 run() 导致阻塞

```java
// 错误示例：以为异步执行，实际是同步
List&lt;Thread&gt; threads = new ArrayList&lt;&gt;();
for (int i = 0; i &lt; 10; i++) {
    threads.add(new Thread(() -> doTask())); // 创建线程对象
}
for (Thread t : threads) {
    t.run(); // 错误：应该调用 start()
}
```

结果：任务一个接一个执行，完全没有并行效果。

### 坑二：start() 是异步的

```java
Thread t = new Thread(() -> {
    // 耗时任务
    Thread.sleep(5000);
    System.out.println("完成");
});
t.start();
System.out.println("主线程结束");

// 输出：
// 主线程结束
// 完成（5秒后）
```

主线程不会等待子线程，这是异步的本质。

---

## 总结：start() vs run()

| 对比 | start() | run() |
|------|---------|-------|
| 本质 | 创建新线程 | 普通方法调用 |
| 执行位置 | 新线程 | 调用者线程 |
| 调用次数 | 一次 | 多次 |
| 异步 | 是 | 否（同步） |

---

## 留给你的思考题

```java
public class 思考题 {
    public static void main(String[] args) {
        Thread t = new Thread(() -> {
            System.out.println("A");
            try {
                Thread.sleep(1000);
            } catch (InterruptedException e) {}
            System.out.println("B");
        });

        t.start();
        t.run(); // 这里会发生什么？
        System.out.println("C");
    }
}
```

输出顺序是什么？是 ABC 还是 ACB？为什么？

---

**面试追问方向：**

- start() 调用时发生了什么？（JVM 创建线程，调用 start0()）
- Thread 对象的 run() 和 target 的 run() 有什么区别？
- 如何让主线程等待子线程执行完成？（join()）
