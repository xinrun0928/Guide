# 哲学家就餐问题

哲学家就餐问题是计算机科学中最经典的同步问题之一。

它展示了如何处理多个进程/线程之间的资源共享和死锁问题。

---

## 问题描述

```
                    哲学家 0
                       ↑
            筷子 0  ←  ╔═════╗  → 筷子 4
                      ║     ║
         哲学家 4  ←   ║     ║   → 哲学家 1
            ↖         ╚═════╝        ↗
            │        ╱       ╲        │
     筷子 4  ╲     ╱         ╲      /  筷子 1
              ╲   ╱           ╲    ╱
               ╲ ╱             ╲  ╱
        哲学家 3   ←   桌子   →   哲学家 2
                    筷子 2  筷子 3
```

5 位哲学家围坐在圆桌旁：
- 每人面前有一盘意大利面
- 每两位哲学家之间有一根筷子
- 哲学家要么思考，要么吃饭
- 吃饭需要同时持有左右两根筷子

---

## 简单实现（有问题）

```java
public class PhilosopherProblem {
    
    // 筷子类
    static class Chopstick {
        private final int id;
        public Chopstick(int id) {
            this.id = id;
        }
        
        public int getId() {
            return id;
        }
    }
    
    // 哲学家类
    static class Philosopher extends Thread {
        private final Chopstick left;
        private final Chopstick right;
        private final int id;
        
        public Philosopher(int id, Chopstick left, Chopstick right) {
            this.id = id;
            this.left = left;
            this.right = right;
        }
        
        @Override
        public void run() {
            while (true) {
                try {
                    // 思考
                    System.out.println("哲学家 " + id + " 正在思考");
                    Thread.sleep((long) (Math.random() * 1000));
                    
                    // 尝试拿起筷子
                    System.out.println("哲学家 " + id + " 尝试拿起筷子");
                    synchronized (left) {
                        System.out.println("哲学家 " + id + " 拿起左边筷子 " + left.getId());
                        synchronized (right) {
                            // 吃饭
                            System.out.println("哲学家 " + id + " 拿起右边筷子 " + right.getId());
                            System.out.println("哲学家 " + id + " 正在吃饭");
                            Thread.sleep((long) (Math.random() * 1000));
                        }
                    }
                    
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }
    }
    
    public static void main(String[] args) {
        Chopstick[] sticks = new Chopstick[5];
        for (int i = 0; i < 5; i++) {
            sticks[i] = new Chopstick(i);
        }
        
        Philosopher[] philosophers = new Philosopher[5];
        for (int i = 0; i < 5; i++) {
            // 每个哲学家拿起左边的筷子，再拿右边的
            philosophers[i] = new Philosopher(i, sticks[i], sticks[(i + 1) % 5]);
            philosophers[i].start();
        }
    }
}
```

### 问题分析

```
死锁场景：

T0  哲学家 0: 拿起筷子 0
T1  哲学家 1: 拿起筷子 1
T2  哲学家 2: 拿起筷子 2
T3  哲学家 3: 拿起筷子 3
T4  哲学家 4: 拿起筷子 4
T5  哲学家 0: 尝试拿筷子 1，但被哲学家 1 持有...
T6  哲学家 1: 尝试拿筷子 2，但被哲学家 2 持有...
...
所有哲学家都在等待右边/左边的筷子
→ 死锁！
```

---

## 解决方案一：资源有序分配

**核心思想**：打破循环等待条件。

所有哲学家都按**固定顺序**拿筷子，而不是每个人都先拿左边再拿右边。

```java
static class OrderedPhilosopher extends Thread {
    private final Chopstick lowerNumber;
    private final Chopstick higherNumber;
    private final int id;
    
    public OrderedPhilosopher(int id, Chopstick left, Chopstick right) {
        this.id = id;
        // 按编号顺序拿筷子，避免循环等待
        if (left.getId() < right.getId()) {
            this.lowerNumber = left;
            this.higherNumber = right;
        } else {
            this.lowerNumber = right;
            this.higherNumber = left;
        }
    }
    
    @Override
    public void run() {
        while (true) {
            try {
                System.out.println("哲学家 " + id + " 正在思考");
                Thread.sleep((long) (Math.random() * 1000));
                
                // 先拿编号小的筷子
                synchronized (lowerNumber) {
                    System.out.println("哲学家 " + id + " 拿起筷子 " + lowerNumber.getId());
                    // 再拿编号大的筷子
                    synchronized (higherNumber) {
                        System.out.println("哲学家 " + id + " 拿起筷子 " + higherNumber.getId());
                        System.out.println("哲学家 " + id + " 正在吃饭");
                        Thread.sleep((long) (Math.random() * 1000));
                    }
                }
                
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }
}
```

### 为什么有效？

```
普通方式（循环等待）：
├─ 哲学家 0: 筷子0 → 筷子1
├─ 哲学家 1: 筷子1 → 筷子2
├─ ...
└─ 哲学家 4: 筷子4 → 筷子0
    └─ 形成循环！

有序方式（打破循环等待）：
├─ 哲学家 0: 筷子0 → 筷子1
├─ 哲学家 1: 筷子1 → 筷子2
├─ ...
├─ 哲学家 4: 筷子4 → 筷子0
│   └─ 但筷子4(4) > 筷子0(0)，所以是 筷子0 → 筷子4
│       └─ 与哲学家 0 的顺序一致，不会形成循环！
```

---

## 解决方案二：信号量限制并发

**核心思想**：打破占有并等待条件。

最多允许 N-1 位哲学家同时持有筷子，这样至少有一位能吃到饭。

```java
import java.util.concurrent.Semaphore;

public class SemaphorePhilosopher {
    private static final int N = 5;
    private final Semaphore table = new Semaphore(N - 1);  // 最多 N-1 人用餐
    private final Chopstick[] sticks = new Chopstick[N];
    
    static class Chopstick {
        private final int id;
        private final ReentrantLock lock = new ReentrantLock();
        
        public Chopstick(int id) {
            this.id = id;
        }
        
        public void pickup() {
            lock.lock();
        }
        
        public void putdown() {
            lock.unlock();
        }
    }
    
    static class Philosopher extends Thread {
        private final int id;
        private final Chopstick left;
        private final Chopstick right;
        private final Semaphore table;
        
        public Philosopher(int id, Chopstick left, Chopstick right, 
                           Semaphore table) {
            this.id = id;
            this.left = left;
            this.right = right;
            this.table = table;
        }
        
        @Override
        public void run() {
            while (true) {
                try {
                    System.out.println("哲学家 " + id + " 正在思考");
                    Thread.sleep((long) (Math.random() * 1000));
                    
                    // 获取用餐许可
                    table.acquire();
                    
                    // 拿起筷子
                    left.pickup();
                    System.out.println("哲学家 " + id + " 拿起左边筷子 " + left.id);
                    right.pickup();
                    System.out.println("哲学家 " + id + " 拿起右边筷子 " + right.id);
                    
                    // 吃饭
                    System.out.println("哲学家 " + id + " 正在吃饭");
                    Thread.sleep((long) (Math.random() * 1000));
                    
                    // 放下筷子
                    right.putdown();
                    left.putdown();
                    
                    // 释放用餐许可
                    table.release();
                    
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }
    }
    
    public static void main(String[] args) {
        SemaphorePhilosopher demo = new SemaphorePhilosopher();
        
        for (int i = 0; i < N; i++) {
            demo.sticks[i] = demo.new Chopstick(i);
        }
        
        for (int i = 0; i < N; i++) {
            new Philosopher(i, 
                demo.sticks[i], 
                demo.sticks[(i + 1) % N],
                demo.table
            ).start();
        }
    }
}
```

### 为什么有效？

```
信号量设置为 N-1 = 4：

如果有 5 位哲学家同时想吃饭：
├─ 4 位获得许可，开始吃饭
└─ 1 位等待（最多等一位吃完）

某位吃完后释放信号量：
├─ 等待的哲学家获得许可
└─ 开始吃饭

死锁不可能发生，因为不可能 5 个人同时持有筷子！
```

---

## 解决方案三：交替用餐

**核心思想**：让哲学家交替「禁食」。

一位哲学家「禁食」，打破对称性。

```java
public class AlternatingPhilosopher {
    private static final int N = 5;
    private final Chopstick[] sticks = new Chopstick[N];
    
    static class Chopstick {
        private final int id;
        private final ReentrantLock lock = new ReentrantLock();
        
        public Chopstick(int id) {
            this.id = id;
        }
    }
    
    static class Philosopher extends Thread {
        private final int id;
        private final Chopstick left;
        private final Chopstick right;
        
        // 偶数哲学家：先拿左边的筷子
        // 奇数哲学家：先拿右边的筷子
        private final boolean isOdd;
        
        public Philosopher(int id, Chopstick left, Chopstick right) {
            this.id = id;
            this.left = left;
            this.right = right;
            this.isOdd = (id % 2 == 1);
        }
        
        @Override
        public void run() {
            while (true) {
                try {
                    System.out.println("哲学家 " + id + " 正在思考");
                    Thread.sleep((long) (Math.random() * 1000));
                    
                    Chopstick first = isOdd ? right : left;
                    Chopstick second = isOdd ? left : right;
                    
                    // 先拿第一根筷子
                    synchronized (first) {
                        System.out.println("哲学家 " + id + " 拿起筷子 " + first.id);
                        // 再拿第二根筷子
                        synchronized (second) {
                            System.out.println("哲学家 " + id + " 拿起筷子 " + second.id);
                            System.out.println("哲学家 " + id + " 正在吃饭");
                            Thread.sleep((long) (Math.random() * 1000));
                        }
                    }
                    
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }
    }
    
    public static void main(String[] args) {
        AlternatingPhilosopher demo = new AlternatingPhilosopher();
        
        for (int i = 0; i < N; i++) {
            demo.sticks[i] = demo.new Chopstick(i);
        }
        
        for (int i = 0; i < N; i++) {
            new Philosopher(i, 
                demo.sticks[i], 
                demo.sticks[(i + 1) % N]
            ).start();
        }
    }
}
```

---

## 解决方案对比

| 方案 | 破坏的条件 | 思想 | 资源利用率 |
|-----|-----------|------|-----------|
| 资源有序分配 | 循环等待 | 按固定顺序获取资源 | 100% |
| 信号量限制 | 占有并等待 | 限制并发数 | N-1/N |
| 交替用餐 | 对称性 | 打破镜像对称 | 取决于设计 |

---

## 面试实战

**面试官问**：「哲学家就餐问题怎么解决？」

**参考回答**：
> 哲学家就餐问题是经典的死锁问题。5 位哲学家每人需要同时持有左右两根筷子才能吃饭，但按简单的「先拿左边再拿右边」实现会导致死锁。
>
> 常见解决方案有三种：
>
> **第一种，资源有序分配**。给筷子编号，所有哲学家都按编号从小到大的顺序拿筷子。这样就打破了循环等待条件。
>
> **第二种，信号量限制**。最多允许 4 位哲学家同时持有筷子，确保至少有一位能吃到饭。破坏「占有并等待」条件。
>
> **第三种，交替用餐**。让奇数编号的哲学家先拿右边筷子，偶数编号的先拿左边筷子，打破对称性。
>
> 实际工作中，资源有序分配是最常用的方案，核心思想是「按固定顺序获取锁」。

---

## 总结

```
┌─────────────────────────────────────────────────────────────┐
│                   哲学家就餐问题解决方案                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   问题：5 位哲学家，5 根筷子，循环等待 → 死锁                  │
│                                                             │
│   解决方案：                                                  │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  方案一：资源有序分配                                 │   │
│   │  ├─ 破坏：循环等待条件                               │   │
│   │  └─ 方法：所有线程按固定顺序获取资源                   │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  方案二：信号量限制                                   │   │
│   │  ├─ 破坏：占有并等待条件                             │   │
│   │  └─ 方法：限制并发数至 N-1                           │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  方案三：交替用餐                                     │   │
│   │  ├─ 破坏：对称性                                     │   │
│   │  └─ 方法：奇偶不同顺序获取筷子                        │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 留给你的思考题

如果除了筷子，还给每位哲学家配备了一把「餐叉」：

```
哲学家 0
   ↑↑
筷子0 餐叉0
      ↖
哲学家 4 ← 餐叉4
   ↓
筷子4
```

现在哲学家吃饭需要：1 根筷子 + 1 把餐叉。

如果每位哲学家都按「筷子→餐叉」的顺序获取，会发生什么？怎么用「资源有序分配」的思想解决？

（提示：餐叉也需要编号，并且获取顺序要全局一致）
