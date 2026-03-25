# 守护线程：默默付出的「背景板」

凌晨 3 点，你关了电脑回家睡觉。服务器上 JVM 还在跑，各种线程还在执行：

- 处理请求的主业务线程
- 记录日志的后台线程
- **GC 线程**——正在悄悄回收内存
- **JIT 编译线程**——正在优化热点代码

GC 线程做完工作后，没跟任何人打招呼，默默退出。因为它是**守护线程**。

---

## 什么是守护线程？

守护线程（Daemon Thread）为用户线程提供后台服务。当 JVM 中只剩下守护线程时，JVM 会直接退出，不会等待守护线程执行完毕。

```java
public class DaemonDemo {
    public static void main(String[] args) {
        Thread daemon = new Thread(() -> {
            while (true) {
                System.out.println("我是守护线程，还在运行...");
                try {
                    Thread.sleep(1000);
                } catch (InterruptedException e) {}
            }
        });

        // 设置为守护线程
        daemon.setDaemon(true);
        daemon.start();

        // 主线程睡 2 秒后结束
        try {
            Thread.sleep(2000);
        } catch (InterruptedException e) {}

        System.out.println("主线程结束");
    }
}
```

输出：

```
我是守护线程，还在运行...
我是守护线程，还在运行...
主线程结束
```

**注意**：输出两行后程序直接结束，守护线程被 JVM 强制终止。

---

## 设置时机：必须在 start() 之前

```java
Thread t = new Thread(() -> {});

t.setDaemon(true); // OK，在 start() 之前
t.start();

// t.setDaemon(true); // 错误！start() 之后抛 IllegalThreadStateException
```

---

## 守护线程 vs 用户线程

| 特性 | 守护线程 (Daemon) | 用户线程 (User) |
|------|-----------------|----------------|
| 用途 | 为用户线程服务 | 完成业务逻辑 |
| JVM 退出 | 不等待，直接退出 | 必须等待执行完毕 |
| 创建 | `setDaemon(true)` | 普通创建 |
| 典型代表 | GC 线程、日志线程 | 主线程、业务线程 |

---

## JVM 中的守护线程

JVM 启动时默认创建多个守护线程：

```java
// 这些都是守护线程
// GC 线程：负责垃圾回收
// JIT 编译线程：热点代码编译优化
// 信号分发线程：处理系统信号
// 参考线程监控线程：JMX 代理线程
```

---

## 使用场景

### 场景一：日志写入线程

```java
public class LoggerThread extends Thread {
    private final BlockingQueue&lt;String&gt; queue;

    public LoggerThread(BlockingQueue&lt;String&gt; queue) {
        this.setDaemon(true); // 日志线程应该是守护线程
        this.queue = queue;
    }

    @Override
    public void run() {
        while (true) {
            try {
                String log = queue.take();
                writeToFile(log);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }
}
```

### 场景二：心跳检测线程

```java
public class HeartbeatThread extends Thread {
    private final AtomicBoolean running = new AtomicBoolean(true);

    public HeartbeatThread() {
        setDaemon(true);
    }

    @Override
    public void run() {
        while (running.get()) {
            sendHeartbeat();
            try {
                Thread.sleep(30000); // 30 秒一次
            } catch (InterruptedException e) {}
        }
    }

    public void shutdown() {
        running.set(false);
    }
}
```

---

## 注意事项

### 1. 守护线程不能用于执行业务逻辑

```java
// 错误示例：业务逻辑用守护线程
Thread daemon = new Thread(() -> {
    // 这段代码可能随时被终止！
    processOrder();
});
daemon.setDaemon(true);
daemon.start();
```

当 JVM 退出时，订单可能只处理了一半。

### 2. 守护线程的 finally 不一定执行

```java
Thread daemon = new Thread(() -> {
    try {
        System.out.println("开始");
    } finally {
        // 守护线程的 finally 块可能不执行！
        System.out.println("释放资源");
    }
});
daemon.setDaemon(true);
daemon.start();
```

### 3. 线程池中的守护线程

```java
// ForkJoinPool 的 commonPool 内部使用守护线程
ExecutorService pool = Executors.newCachedThreadPool(r -> {
    Thread t = new Thread(r);
    t.setDaemon(true); // 如果你手动设置
    return t;
});
```

---

## 判断线程类型

```java
public class CheckDaemon {
    public static void main(String[] args) {
        Thread main = Thread.currentThread();
        System.out.println("主线程是守护线程吗？ " + main.isDaemon()); // false

        Thread gc = new Thread(() -> {});
        System.out.println("新线程默认是守护线程吗？ " + gc.isDaemon()); // false（默认是用户线程）
    }
}
```

---

## 面试追问方向

**Q：为什么需要守护线程？**

A：为了后台服务。如果所有后台任务都必须是用户线程，主业务结束时 JVM 必须等待所有后台任务完成才能退出，这不合理。GC 就是典型例子——程序结束时必须立刻回收内存，而不是等 GC 线程慢慢收。

**Q：守护线程的 finally 块一定不执行吗？**

A：不一定。finally 块在 JVM 退出前是否执行，取决于 CPU 是否来得及执行到 finally。但不能依赖 finally 做清理工作。

**Q：线程池中的线程默认是守护线程还是用户线程？**

A：**用户线程**。Executors 创建的线程池，worker 线程都是用户线程。

---

## 留给你的思考题

```java
public class 思考题 {
    public static void main(String[] args) {
        Thread t1 = new Thread(() -> {
            System.out.println("T1 开始");
            while (true) {} // 死循环
        });
        t1.setDaemon(true);
        t1.start();

        Thread t2 = new Thread(() -> {
            System.out.println("T2 开始");
        });
        t2.start();

        System.out.println("主线程结束");
    }
}
```

问题：
1. T1 是守护线程还是用户线程？
2. 程序会正常退出吗？
3. T2 会执行吗？

---

**提示**：当所有用户线程结束时，JVM 直接退出，不管守护线程在干什么。
