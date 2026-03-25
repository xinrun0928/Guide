# JMM 八大 Happens-Before 规则

你可能听说过：「synchronized 能保证可见性」，「volatile 能保证有序性」。

但你有没有想过：**这些保证到底是怎么来的？**

答案是 **Happens-Before 规则**。

---

## 什么是 Happens-Before？

Happens-Before 是 JMM 制定的**一套偏序关系**。如果操作 A happens-before 操作 B，那么：

1. **可见性**：A 的结果对 B 可见
2. **有序性**：A 不会重排序到 B 之后

**重要提醒**：happens-before 不是指时间上的先后，而是指「执行结果的可见性」。

```
A happens-before B 不代表：
  - A 在时间上先于 B 执行
  - A 在 B 之前真正发生

A happens-before B 只代表：
  - A 的结果对 B 可见
  - A 不会在 B 之后重排序
```

---

## 八大规则详解

### 规则一：程序顺序规则（Program Order Rule）

> 在同一个线程中，前面的操作 happens-before 后面的操作。

```java
// 线程内部
int a = 1;      // 操作1
int b = 2;      // 操作2
int c = a + b;  // 操作3

// 1 happens-before 2 happens-before 3
// 因为在同一个线程内，代码顺序决定了 happens-before 关系
```

这是**同一个线程内**的规则，不涉及多线程。

---

### 规则二：监视器锁规则（Monitor Lock Rule）

> 对同一个锁的解锁操作 happens-before 对该锁的加锁操作。

```java
synchronized (lock) {
    // 临界区
    count++;
} // 解锁

// 下一个线程
synchronized (lock) {
    // 一定能读到前一个线程修改后的值
    System.out.println(count);
}
```

**这就是 synchronized 保证可见性的根本原因**：unlock 会强制将工作内存刷新到主内存，lock 会强制 invalid 其他线程的缓存。

---

### 规则三：volatile 变量规则（Volatile Variable Rule）

> 对一个 volatile 变量的写操作 happens-before 对该变量的读操作。

```java
volatile boolean flag = false;

// 线程 A
flag = true;  // 写

// 线程 B
if (flag) {  // 读
    // 一定能读到 true
}
```

**这是 volatile 保证可见性的核心**：volatile 写会插入 Store Barrier，volatile 读会插入 Load Barrier。

---

### 规则四：线程启动规则（Thread Start Rule）

> `Thread.start()` 调用 happens-before 被启动线程中的任意操作。

```java
Thread thread = new Thread(() -> {
    // 这里一定能读到 sharedValue 的值
    System.out.println(sharedValue);
});

int sharedValue = 100;
thread.start();

// 注意：sharedValue = 100 一定 happens-before 线程内的操作
```

**主线程对共享变量的修改，对子线程可见**，因为 start() 之前的操作 happens-before 线程内的所有操作。

---

### 规则五：线程终止规则（Thread Termination Rule）

> 线程中的所有操作 happens-before 其他线程检测到该线程终止。

```java
Thread thread = new Thread(() -> {
    count = 200;
});

thread.start();
thread.join();  // 等待线程结束

// 一定能读到 count = 200
System.out.println(count);
```

**join() 等待的线程，其所有操作对调用者可见**，因为 join() 会检测线程是否终止，而终止意味着所有操作都已完成。

---

### 规则六：传递性规则（Transitivity）

> 如果 A happens-before B，B happens-before C，那么 A happens-before C。

```java
int a = 1;           // A
synchronized (lock) { // B (加锁)
    int b = a;        // C
}

// A happens-before B（程序顺序）
// B happens-before C（程序顺序）
// 因此 A happens-before C（传递性）
```

这个规则让我们能够推导出一系列复杂的 happens-before 关系。

---

### 规则七：中断规则（Thread Interruption Rule）

> 对线程 `interrupt()` 的调用 happens-before 被中断线程检测到中断。

```java
Thread thread = new Thread(() -> {
    while (!Thread.currentThread().isInterrupted()) {
        // 业务逻辑
    }
    // 一定能读到中断标志
});

thread.interrupt();  // 中断
thread.join();

// 在 join() 返回后，线程一定已经检测到中断状态
```

**注意**：使用 `try-catch` 捕获 `InterruptedException` 会清除中断标志，需要用 `Thread.interrupted()` 或 `isInterrupted()` 判断。

---

### 规则八：final 字段规则（Final Field Rule）

> 构造函数的 final 字段写入 happens-before 其他线程读取该对象。

```java
class FinalFieldExample {
    final int x;
    int y;
    
    FinalFieldExample() {
        x = 42;   // final 字段
        y = 100;  // 非 final 字段
    }
}

// 线程 A
obj = new FinalFieldExample();

// 线程 B
// 一定能读到 obj.x = 42
// 但可能读到 obj.y = 0 或 obj.y = 100（存在竞争）
```

**为什么只有 final 字段保证可见？**

因为编译器可以在构造函数结束后、安全发布之前插入 barrier，而不会将构造函数内的操作重排到外部。

---

## 规则总结

| 规则 | 描述 | 典型场景 |
|-----|------|---------|
| 程序顺序规则 | 同一线程内按代码顺序 | 普通变量 |
| 监视器锁规则 | 解锁 happens-before 加锁 | synchronized |
| volatile 规则 | 写 happens-before 读 | volatile 变量 |
| 线程启动规则 | start() happens-before 线程操作 | Thread.start() |
| 线程终止规则 | 线程操作 happens-before join() 返回 | Thread.join() |
| 传递性规则 | A→B→C 则 A→C | 规则推导 |
| 中断规则 | interrupt() happens-before 检测 | Thread.interrupt() |
| final 规则 | 构造函数 final 写入 happens-before 读取 | 不可变对象 |

---

## 面试实战

**面试官问**：「请解释一下 happens-before 是什么？」

**参考回答**：

> happens-before 是 JMM 定义的一套偏序关系，规定了什么时候一个操作对另一个操作可见。它不是时间上的先后，而是执行结果的可见性保证。
>
> 主要有八大规则：程序顺序规则、监视器锁规则、volatile 规则、线程启动规则、线程终止规则、传递性规则、中断规则和 final 字段规则。
>
> 比如 synchronized 的可见性就是通过监视器锁规则实现的：unlock 时强制刷新缓存到主内存，lock 时 invalid 其他线程的缓存。

---

## 留给你的思考题

下面代码的输出是什么？

```java
public class HappensBeforeDemo {
    private int x = 0;
    private volatile boolean flag = false;
    
    public void writer() {
        x = 42;        // 1
        flag = true;   // 2 volatile 写
    }
    
    public void reader() {
        if (flag) {    // 3 volatile 读
            System.out.println(x);  // 4
        }
    }
}
```

如果两个线程分别调用 `writer()` 和 `reader()`，`reader()` 一定能读到 `x = 42` 吗？

（提示：考虑 happens-before 的传递性）
