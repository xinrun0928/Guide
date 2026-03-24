# 锁优化：无锁 → 偏向锁 → 轻量级锁 → 重量级锁

面试官问你：「synchronized 的锁升级过程是怎样的？」

你答：「无锁 → 偏向锁 → 轻量级锁 → 重量级锁。」

面试官点点头：「为什么是这个顺序？而不是反过来？」

你沉默了三秒。

这是 Java 并发面试的高频题，但大多数人只背了结论，不知道背后的设计哲学。今天，我们来揭开 JVM 锁优化的完整面纱。

## 为什么需要锁升级？

一个朴素的问题：JVM 直接用重量级锁（操作系统互斥量）不就好了？为什么还要搞这么复杂的四级结构？

答案很简单：**性能**。

重量级锁需要把线程从用户态切换到内核态（上下文切换），这个开销大约是 1000-5000 个 CPU 时钟周期。对于只会执行一次的代码（比如只被一个线程访问的单例对象），这个开销完全是浪费。

JVM 的设计思想是：**根据竞争程度，渐进式地加锁**。没人抢的时候用最轻量的方式，有人抢了再逐步升级。

## Mark Word：锁的身份证

理解锁升级，必须先理解 Mark Word。

在 64 位 JVM 中，每个对象的对象头占用 12 字节（压缩后），里面包含：

| 状态 | Mark Word 内容 |
|------|---------------|
| 无锁 | 对象 hashCode（31位）+ 分代年龄（4位）+ 偏向标志（1位）+ 锁标志（2位） |
| 偏向锁 | 线程 ID（54位）+ Epoch（2位）+ 分代年龄（4位）+ 偏向标志（1位）+ 锁标志（2位） |
| 轻量级锁 | 指向栈中锁记录的指针（54位）+ 锁标志（2位）= 01 |
| 重量级锁 | 指向互斥量的指针（54位）+ 锁标志（2位）= 10 |
| GC 标记 | 空（00） |

锁标志位用来区分状态：
- `00` = 轻量级锁
- `10` = 重量级锁
- `11` = GC 标记
- `01` = 偏向锁或无锁

## 第一阶段：无锁

一个对象刚创建时，没有任何锁概念，就是个普普通通的对象。

```java
public class NoLockDemo {
    private int value;

    public void increment() {
        value++;  // 没有任何锁，但这行代码不是原子的！
    }
}
```

无锁状态下，对象头存储的是对象的 hashCode 和 GC 信息。问题是：`value++` 这个操作在多线程下会有数据竞争——读-改-写三步可能被其他线程打断。

## 第二阶段：偏向锁

当第一个线程访问同步块时，JVM 会尝试用偏向锁。

**原理**：在 Mark Word 中记录线程 ID，之后这个线程再来，直接「偏向」它，不需要任何同步操作。

```java
public class BiasedLockDemo {
    private int value;

    public synchronized void increment() {  // 第一次访问会偏向线程 A
        value++;
    }
}

// 线程 A 进入 synchronized
// Mark Word 变成：线程A的ID + 偏向标志(1) + 锁标志(01)
```

**偏向锁的撤销**：

偏向锁不是一劳永逸的。当有其他线程尝试获取锁时，偏向锁会被撤销，升级为轻量级锁。

```java
// 线程 A 持有偏向锁
synchronized(obj) {
    // 线程 A 在这个锁上偏向
}

// 线程 B 来竞争
synchronized(obj) {
    // 线程 B 导致偏向锁撤销，升级为轻量级锁
}
```

偏向锁的撤销需要等到「安全点」（Safe Point），即所有线程都在同一个位置时才能进行全局撤销。这就是为什么偏向锁在 JDK 15 后被废弃——撤销成本太高，高并发场景下反而成了负担。

> **面试追问**：为什么 JDK 15 废弃偏向锁？
> 因为偏向锁的撤销需要 Stop The World，高并发场景下这个代价太大。当有大量线程竞争同一个锁时，偏向锁会反复撤销，JVM 决定干脆废弃它。

## 第三阶段：轻量级锁

偏向锁撤销后，锁升级为轻量级锁。

**原理**：在栈帧中创建一个锁记录（Lock Record），将 Mark Word 复制进去，然后用 CAS 把 Mark Word 指向这个锁记录。

```java
// 轻量级锁获取过程
public class LightweightLockDemo {
    private Object lock = new Object();

    public void doSomething() {
        synchronized(lock) {
            // 这里的代码块被轻量级锁保护
        }
    }
}

// 线程 B 获取轻量级锁时：
// 1. 在线程 B 的栈帧中创建 Lock Record
// 2. 将对象头的 Mark Word 复制到 Lock Record
// 3. CAS 将对象头的 Mark Word 改为指向 Lock Record 的指针
// 4. 成功则获取锁，失败则自旋重试
```

**自旋锁**：轻量级锁获取失败后，线程不会立即进入内核态等待，而是「自旋」——在用户态循环重试。

```java
// 自旋的本质
while (!cas(markWord, expected, newValue)) {
    // 空转等待，不释放 CPU
}
```

**自旋的代价**：自旋会消耗 CPU。如果自旋时间过长或者竞争激烈，自旋的线程会浪费大量 CPU  cycles。JVM 默认自旋次数是 10 次，但会自适应调整。

## 第四阶段：重量级锁

自旋超过一定次数后，锁膨胀为重量级锁。

**原理**：向操作系统申请互斥量，线程从用户态进入内核态等待。

```java
// 重量级锁的获取
synchronized(sharedResource) {
    // 当轻量级锁自旋失败后
    // JVM 调用操作系统互斥量（mutex）
    // 当前线程被挂起，进入等待队列
    // 释放锁时唤醒等待线程
}
```

**重量级锁的问题**：
- 用户态到内核态的切换开销大
- 线程被阻塞和唤醒需要上下文切换
- 等待锁的线程不消耗 CPU，但唤醒有延迟

## 锁升级不可逆：一个单向通道

锁升级是单向的：**无锁 → 偏向锁 → 轻量级锁 → 重量级锁**。

为什么不能降级？

答案藏在设计哲学里：**降级比升级更危险**。

想象一下这样的场景：线程 A 持有重量级锁，线程 B 在等待。突然锁释放了，如果降级回轻量级锁，线程 C 立刻拿到锁开始执行 —— 这时候线程 B 还不知道锁已经被释放和重新获取了。降级会引入复杂的同步问题，远比升级麻烦。

## 实战：观察锁状态

可以用 jol-core 观察对象头的变化：

```java
import org.openjdk.jol.info.ClassLayout;

public class LockStateDemo {
    private final Object lock = new Object();

    public static void main(String[] args) throws InterruptedException {
        System.out.println("--- 无锁状态 ---");
        LockStateDemo demo = new LockStateDemo();
        System.out.println(ClassLayout.parseInstance(demo.lock).toPrintable());

        System.out.println("\n--- 偏向锁（打印偏向线程后的状态）---");
        // 注意：需要-XX:+UseBiasedLocking 参数（JDK 15+ 已废弃）
        synchronized (demo.lock) {
            System.out.println("线程持有偏向锁:");
            System.out.println(ClassLayout.parseInstance(demo.lock).toPrintable());
        }
    }
}
```

## 总结

锁升级是 JVM 根据竞争程度做的渐进式优化：

| 阶段 | 适用场景 | 性能开销 | 实现原理 |
|------|---------|---------|---------|
| 无锁 | 无竞争 | 无 | 普通对象头 |
| 偏向锁 | 单线程反复访问 | 极低 | Mark Word 存线程 ID |
| 轻量级锁 | 短时低竞争 | 中等 | CAS + 自旋 |
| 重量级锁 | 高竞争 | 高 | 操作系统互斥量 |

理解这个设计，能帮助你在写代码时做出更合理的选择：比如用 `ThreadLocal` 减少锁竞争，或者用 `CAS` 替代 `synchronized` 处理简单计数器。

---

## 留给你的问题

JDK 15 废弃了偏向锁，但偏向锁的「思路」——针对单线程优化的思路——有没有在其他地方延续？

提示：想想 Loom 项目的虚拟线程是如何处理这个问题的。
