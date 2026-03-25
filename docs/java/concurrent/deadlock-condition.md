# 死锁产生的 4 个必要条件

这是一个经典的面试题，但很多人只能背出四个条件，却不知道为什么要满足这四个条件。

今天彻底搞清楚。

---

## 什么是死锁？

先看一个死锁的经典场景：

```java
public class DeadLockDemo {
    private static final Object lockA = new Object();
    private static final Object lockB = new Object();
    
    public static void main(String[] args) {
        // 线程 1：先拿 lockA，再拿 lockB
        Thread t1 = new Thread(() -> {
            synchronized (lockA) {
                System.out.println("线程1: 持有 lockA");
                try { Thread.sleep(100); } catch (InterruptedException e) {}
                synchronized (lockB) {
                    System.out.println("线程1: 持有 lockB");
                }
            }
        });
        
        // 线程 2：先拿 lockB，再拿 lockA
        Thread t2 = new Thread(() -> {
            synchronized (lockB) {
                System.out.println("线程2: 持有 lockB");
                try { Thread.sleep(100); } catch (InterruptedException e) {}
                synchronized (lockA) {
                    System.out.println("线程2: 持有 lockA");
                }
            }
        });
        
        t1.start();
        t2.start();
        
        // 程序卡住，无法结束！
    }
}
```

**死锁**：两个或多个线程相互等待对方持有的锁，形成循环等待，导致程序无法继续执行。

---

## 死锁的 4 个必要条件

面试经常问这四个条件，但更重要的是**理解为什么是这四个**。

### 条件一：互斥条件（Mutual Exclusion）

> 资源一次只能被一个线程占用。

```
锁的本质就是互斥：
┌─────────┐      ┌─────────┐
│ lockA   │      │ lockB   │
│         │      │         │
│ 被线程1 │      │ 被线程2 │
│ 占用中  │      │ 占用中  │
└─────────┘      └─────────┘
  ↑ 线程2想要      ↑ 线程1想要
  但被拒绝         但被拒绝
```

如果锁可以被多个线程同时持有，就不会有死锁。**互斥是锁的本质特性，无法避免。**

### 条件二：占有并等待（Hold and Wait）

> 线程在持有资源的同时，等待获取其他资源。

```
线程1：                    线程2：
├─ 持有 lockA              ├─ 持有 lockB
│                         │
└─ 等待 lockB ─────────────→│（被线程2持有）
                            │
                            └─ 等待 lockA ──→（被线程1持有）
```

关键点：**不释放已持有的资源，就去申请新资源**。

如果线程在申请新资源前先释放已持有的资源，就不会死锁。

### 条件三：不可抢占（No Preemption）

> 资源不能被强制从持有线程中抢占，只能由持有线程主动释放。

```
线程1持有 lockA：
┌─────────────────────┐
│  lockA              │
│  ┌─────────────────┐│
│  │ 线程1 正在使用   ││
│  └─────────────────┘│
│  无法被抢占！       │
│  只能等线程1主动释放 │
└─────────────────────┘
```

如果资源可以被强制抢走（比如操作系统直接 kill 线程），死锁也不会发生。

### 条件四：循环等待（Circular Wait）

> 形成循环的等待链：线程1等线程2，线程2等线程1...

```
死锁形成的完整图示：

    ┌──────────────────────────────────────┐
    │                                      │
    ▼                                      │
┌────────┐    等待     ┌────────┐          │
│线程1   │──────────→│线程2   │          │
│持有A   │            │持有B   │          │
└────────┘            └────────┘          │
    ▲                    │                │
    │    等待            │                │
    └────────────────────┘                │
         形成循环等待！                    │
                                      │
                                      └────
```

---

## 为什么是「必要条件」？

**必要条件**：四个条件必须**同时满足**才会发生死锁。

打破**任意一个**条件，死锁就不会发生。

| 条件 | 打破方式 |
|-----|---------|
| 互斥条件 | 无法打破（锁的本质） |
| 占有并等待 | 一次性获取所有资源 |
| 不可抢占 | 设置超时，强制释放 |
| 循环等待 | 资源有序编号 |

---

## 死锁的演变过程

```
时间线：

T0  线程1: synchronized(lockA) ✓ 持有 lockA
T1  线程2: synchronized(lockB) ✓ 持有 lockB
T2  线程1: 尝试 synchronized(lockB) 阻塞，等待线程2释放
T3  线程2: 尝试 synchronized(lockA) 阻塞，等待线程1释放
T4  ...僵持中...
T5  ...程序无法继续...
```

---

## 哲学家就餐问题

经典死锁场景：5 个哲学家围桌而坐，每人左右各有一根筷子。

```java
class Philosopher extends Thread {
    private Chopstick left;
    private Chopstick right;
    
    public Philosopher(Chopstick left, Chopstick right) {
        this.left = left;
        this.right = right;
    }
    
    public void run() {
        while (true) {
            try {
                // 先拿左筷子
                synchronized (left) {
                    // 再拿右筷子
                    synchronized (right) {
                        // 吃饭...
                    }
                }
                Thread.sleep(10);
            } catch (InterruptedException e) {}
        }
    }
}
```

**问题**：如果 5 个哲学家同时拿起左边的筷子，然后同时等待右边的筷子，就形成了死锁。

---

## 活锁 vs 死锁

很多人分不清这两个概念：

| 类型 | 状态 | 特点 |
|-----|------|-----|
| 死锁 | 线程阻塞，等待对方释放锁 | 程序完全卡住，不消耗 CPU |
| 活锁 | 线程活跃，但在做无用功 | 程序继续运行，但无法前进 |

```java
// 活锁示例：两个线程都在让步，但让步后立即又冲突
while (true) {
    if (tryLock(lockA)) {
        if (tryLock(lockB)) {
            // 做事情
            unlock(lockA);
            unlock(lockB);
            break;
        }
        unlock(lockA);
    }
    // 随机等待后重试
    Thread.sleep(random.nextInt(100));
}
```

---

## 面试实战

**面试官问**：「死锁的四个必要条件是什么？怎么理解？」

**参考回答**：
> 死锁必须同时满足四个条件：
>
> **第一，互斥条件**。资源一次只能被一个线程使用，比如锁不能被两个线程同时持有。
>
> **第二，占有并等待**。线程持有资源的同时，还在等待其他资源。
>
> **第三，不可抢占**。资源不能被强制释放，只能持有者主动释放。
>
> **第四，循环等待**。形成循环的等待链，线程之间相互等待。
>
> 互斥是锁的本质，无法打破。要避免死锁，必须打破其他三个条件之一。比如资源有序编号（打破循环等待）、一次性获取所有资源（打破占有并等待）、设置超时强制释放（打破不可抢占）。

---

## 总结

```
┌─────────────────────────────────────────────────────────────┐
│                   死锁四必要条件                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────┐                                              │
│   │ 互斥条件 │ ← 无法打破（锁的本质）                        │
│   └────┬────┘                                              │
│        ↓                                                   │
│   ┌─────────┐                                              │
│   │占有并等待│ ← 打破：一次性获取所有资源                     │
│   └────┬────┘                                              │
│        ↓                                                   │
│   ┌─────────┐                                              │
│   │不可抢占  │ ← 打破：设置超时强制释放                        │
│   └────┬────┘                                              │
│        ↓                                                   │
│   ┌─────────┐                                              │
│   │循环等待 │ ← 打破：资源有序编号                           │
│   └─────────┘                                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 留给你的思考题

下面代码有没有死锁风险？如果有，哪个条件触发了？

```java
public class TransferDemo {
    private static final Object accountALock = new Object();
    private static final Object accountBLock = new Object();
    
    private int balanceA = 1000;
    private int balanceB = 1000;
    
    // 转账：A → B
    public void transferAtoB(int amount) {
        synchronized (accountALock) {
            synchronized (accountBLock) {
                if (balanceA >= amount) {
                    balanceA -= amount;
                    balanceB += amount;
                }
            }
        }
    }
    
    // 转账：B → A
    public void transferBtoA(int amount) {
        synchronized (accountBLock) {
            synchronized (accountALock) {
                if (balanceB >= amount) {
                    balanceB -= amount;
                    balanceA += amount;
                }
            }
        }
    }
}
```

（提示：如果两个方法同时被调用，可能形成什么样的等待链？）
