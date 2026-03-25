# Thread 的一生：六种状态与千转百回

线程的一生，像极了一个职场人：

出生（NEW）→ 准备就绪（RUNNABLE）→ 阻塞等待（BLOCKED/WAITING）→ 退休（TERMINATED）

有时候在工位上埋头苦干（Running），有时候去会议室等通知（Blocked），有时候去茶水间休息等同事做完（Waiting）。

今天聊聊线程的六种状态，以及它们之间的转换关系。

---

## 六种状态的完整图谱

```java
public enum Thread.State {
    NEW,        // 新建
    RUNNABLE,   // 可运行（含就绪+运行中）
    BLOCKED,    // 阻塞（等待锁）
    WAITING,    // 等待（无限期）
    TIMED_WAITING, // 计时等待（限期）
    TERMINATED; // 终止
}
```

### 状态转换图

```
                    ┌─────────────────────────────────────────────┐
                    │                                             │
                    ▼                                             │
    ┌─────────┐  start()   ┌────────────┐                         │
    │   NEW   │ ─────────► │  RUNNABLE   │◄───────────────────────┤
    └─────────┘             └─────┬──────┘                         │
                                  │                                │
                                  │      ┌────────────────────┐    │
                                  │      │                    │    │
                                  ▼      ▼                    │    │
                           ┌──────────┐                      │    │
                           │ BLOCKED  │                      │    │
                           └────┬─────┘                      │    │
                                │ synchronize 获锁成功        │    │
                                └──────────────────────────────┘    │
                                  │                                │
                                  │                                │
                    ┌────────────┼────────────┐                   │
                    │            │            │                   │
                    ▼            ▼            ▼                   │
             ┌───────────┐ ┌───────────┐ ┌────────────┐           │
             │  WAITING   │ │TIMED_WAIT │ │  RUNNING   │           │
             │ (无限期)   │ │ (计时等待)  │ │  (真正运行) │           │
             └─────┬─────┘ └─────┬─────┘ └────────────┘           │
                   │             │                                │
                   │             │                                │
    notify()/      │   sleep()   │ wait(long)                     │
    notifyAll()/   │   到期       │ timeout/                      │
    join()         │             │ join(timeout)                  │
                   │             │                                │
                   └─────────────┴────────────────────────────────┘
                                  │
                                  │ run() 执行完毕
                                  ▼
                           ┌─────────────┐
                           │ TERMINATED  │
                           └─────────────┘
```

---

## 状态详解

### 1. NEW：新建状态

线程被创建，但还没有执行 `start()`。

```java
Thread t = new Thread(() -> {});
// 此时 t.getState() == NEW
// t 还没有真正创建操作系统线程
```

### 2. RUNNABLE：可运行状态

调用 `start()` 后，线程进入 RUNNABLE。

**注意**：RUNNABLE 包含了两种子状态：
- **Ready（就绪）**：等待 CPU 调度
- **Running（运行中）**：正在 CPU 上执行

```java
t.start();
// 此时 t.getState() == RUNNABLE
// 线程可能在等待 CPU（Ready）也可能正在执行（Running）
```

### 3. BLOCKED：阻塞状态

线程等待获取 synchronized 锁时，进入 BLOCKED。

```java
// 线程 A 持有锁
synchronized (lock) {
    // 线程 A 在这里
}

// 线程 B 尝试获取锁
synchronized (lock) {  // 线程 B 被阻塞在这里
    // BLOCKED 状态
}
```

### 4. WAITING：无限期等待

调用以下方法会进入 WAITING：
- `Object.wait()`
- `Thread.join()`（不带超时）
- `LockSupport.park()`

```java
// 主线程等待子线程完成
Thread child = new Thread(() -> {
    // 子线程执行...
});
child.start();
child.join(); // 主线程进入 WAITING，直到子线程结束
```

### 5. TIMED_WAITING：计时等待

调用带超时的方法会进入 TIMED_WAITING：
- `Thread.sleep(long millis)`
- `Object.wait(long millis)`
- `Thread.join(long millis)`
- `LockSupport.parkNanos()`
- `LockSupport.parkUntil()`

```java
Thread.sleep(1000); // TIMED_WAITING，1秒后自动唤醒
thread.join(2000); // TIMED_WAITING，最多等2秒
```

### 6. TERMINATED：终止状态

线程的 `run()` 方法执行完毕，进入 TERMINATED。

```java
Thread t = new Thread(() -> {
    System.out.println("执行完成");
});
t.start();
t.join();
// 此时 t.getState() == TERMINATED
```

---

## 状态对比：BLOCKED vs WAITING

这是面试高频考点。

| 特性 | BLOCKED | WAITING |
|------|---------|---------|
| 触发条件 | 等待获取 synchronized 锁 | 调用 wait()/join()/park() |
| 等待时间 | 无限期（直到获锁） | 可以无限期，也可以有超时 |
| 唤醒方式 | 锁释放后自动唤醒 | 需要 notify()/notifyAll()/unpark() |
| 线程数量 | 多个线程可能同时 Blocked | 多个线程可能同时 Waiting |

---

## 代码验证状态转换

```java
public class ThreadStateDemo {
    public static void main(String[] args) throws Exception {
        Thread thread = new Thread(() -> {
            System.out.println("子线程状态: " + Thread.currentThread().getState());
            synchronized (ThreadStateDemo.class) {
                System.out.println("获得锁后子线程状态: " + Thread.currentThread().getState());
            }
        });

        System.out.println("启动前: " + thread.getState()); // NEW
        thread.start();

        Thread.sleep(100);
        System.out.println("启动后: " + thread.getState()); // RUNNABLE

        synchronized (ThreadStateDemo.class) {
            Thread.sleep(100);
            System.out.println("主线程获得锁: " + thread.getState()); // BLOCKED
        }

        thread.join();
        System.out.println("终止后: " + thread.getState()); // TERMINATED
    }
}
```

---

## 面试追问方向

**Q：RUNNABLE 状态下，线程一定在 CPU 上运行吗？**

A：不一定。RUNNABLE 只表示线程「可以运行」，可能正在等待 CPU 调度（Ready 状态），也可能正在 CPU 上执行（Running 状态）。

**Q：wait() 和 sleep() 有什么区别？**

A：wait() 会释放锁，sleep() 不释放锁。wait() 必须在 synchronized 中调用，sleep() 没有这个限制。

**Q：线程从 BLOCKED 转到 RUNNABLE，是谁唤醒的？**

A：不需要唤醒。当持有锁的线程释放锁时，Blocked 的线程会自动被调度器选中转为 Runnable。

---

## 留给你的思考题

```java
public class思考题 {
    public static void main(String[] args) {
        Thread t = new Thread(() -> {
            synchronized (思考题.class) {
                System.out.println("线程状态: " + Thread.currentThread().getState());
            }
        });

        synchronized (思考题.class) {
            t.start();
            System.out.println("主线程锁内: " + t.getState());
        }

        System.out.println("主线程锁外: " + t.getState());
    }
}
```

这段代码输出什么？为什么？

提示：考虑主线程持有锁时启动子线程，子线程能否立即执行？
