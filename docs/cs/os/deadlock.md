# 死锁：程序员的噩梦

你有没有遇到过这种情况：两个线程互相等待对方释放锁，程序彻底卡死。
重启？好使。但下次还会发生。

这就是**死锁**——并发编程中最让人头疼的问题之一。


## 什么是死锁？

**死锁 = 多个进程/线程互相等待对方持有的资源，导致谁都无法继续执行。**

```
线程A                          线程B
  │                              │
  ├─ 持有锁1 ──→ 等待锁2 ──→     │
  │    ↑                    │    │
  │    └────────────────────┘    │
  │                              │
  │    持有锁2 ──→ 等待锁1 ──→   │
  │                              │
  └──────────────────────────────┘
        循环等待，永无止境
```


## 死锁的四个必要条件

只有同时满足以下四个条件，才会发生死锁（Coffman条件）：

### 1. 互斥条件

资源一次只能被一个进程使用。

```java
// 互斥：锁只能被一个线程持有
private final ReentrantLock lock = new ReentrantLock();
```

### 2. 请求和保持条件

进程持有资源的同时，还请求其他资源。

```java
// 请求和保持：持有锁A，同时请求锁B
synchronized (resourceA) {
    // 持有resourceA
    synchronized (resourceB) {
        // 请求resourceB
    }
}
```

### 3. 不可抢占条件

资源不能被强制释放，只能由持有者主动释放。

```java
// 不可抢占：无法从外部强行夺走锁
synchronized (lock) {
    // 只有这里释放了，其他线程才能获得
}
```

### 4. 循环等待条件

形成循环链：P1等P2，P2等P3，...，Pn等P1。

```
┌────────────────────────────────────────┐
│           循环等待链                     │
│                                        │
│   线程0 ──→ 等待线程1的锁               │
│     ↑                                 │
│     │                                 │
│     └──────────── 持有线程0的锁        │
│                                        │
│   线程1 ──→ 等待线程2的锁               │
│     ↑                                 │
│     │                                 │
│     └──────────── 持有线程1的锁        │
│                                        │
│   ... 循环 ...                         │
└────────────────────────────────────────┘
```

> **只要破坏其中任何一个条件，就能避免死锁。**


## 死锁示例：转账操作

```java
public class TransferDeadlock {
    private final ReentrantLock lock1 = new ReentrantLock();
    private final ReentrantLock lock2 = new ReentrantLock();

    // 账户A → 账户B 转账
    public void transferAtoB(int amount) {
        lock1.lock();
        try {
            // 模拟处理时间
            Thread.sleep(10);
            lock2.lock();  // 等待获取lock2
            try {
                System.out.println("A→B 转账成功: " + amount);
            } finally {
                lock2.unlock();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            lock1.unlock();
        }
    }

    // 账户B → 账户A 转账（相反顺序加锁）
    public void transferBtoA(int amount) {
        lock2.lock();  // 如果线程A持有lock1还没拿到lock2
        try {          // 线程B持有lock2等待lock1
            Thread.sleep(10);    // ← 死锁！
            lock1.lock();
            try {
                System.out.println("B→A 转账成功: " + amount);
            } finally {
                lock1.unlock();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            lock2.unlock();
        }
    }

    public static void main(String[] args) {
        TransferDeadlock demo = new TransferDeadlock();

        // 两个线程同时执行相反方向的转账
        new Thread(() -> demo.transferAtoB(100)).start();
        new Thread(() -> demo.transferBtoA(100)).start();

        // 观察结果：程序可能卡死
    }
}
```


## 死锁的处理策略

```
┌─────────────────────────────────────────────────────────┐
│                    死锁处理策略                          │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │   预防      │  │   避免      │  │   检测与恢复  │      │
│  │ (破坏条件)   │  │ (银行家算法) │  │  (定期检测)   │      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
│                                                         │
│  悲观策略                      乐观策略                  │
└─────────────────────────────────────────────────────────┘
```

### 策略一：死锁预防（破坏条件）

#### 破坏互斥条件

不是所有资源都能共享，有些资源天生就是互斥的（打印机、锁）。

#### 破坏请求和保持条件

**一次性申请所有需要的资源。**

```java
// 错误：分步获取
public void wrong() {
    lock1.lock();
    // 处理
    lock2.lock();  // 可能死锁
    lock2.unlock();
    lock1.unlock();
}

// 正确：一次性获取
public void correct() {
    // 先检查能否同时获得所有锁
    while (!lock1.tryLock()) {
        lock1.unlock();  // 如果拿不到，释放已持有的
        Thread.yield();  // 让出CPU
        lock1.lock();    // 重试
    }
    // 类似方式获取lock2...
}
```

#### 破坏不可抢占条件

**如果拿不到需要的锁，就释放已持有的锁。**

```java
public class LockTryAndRelease {
    private final ReentrantLock lock1 = new ReentrantLock();
    private final ReentrantLock lock2 = new ReentrantLock();

    public void doSomething() {
        while (true) {
            if (lock1.tryLock()) {
                try {
                    if (lock2.tryLock()) {
                        try {
                            // 执行任务
                            return;
                        } finally {
                            lock2.unlock();
                        }
                    }
                } finally {
                    lock1.unlock();
                }
            }
            // 都拿不到，休息一下再试
            Thread.sleep(100);
        }
    }
}
```

#### 破坏循环等待条件

**按固定顺序获取锁。**

```java
public class FixedOrderTransfer {
    // 锁的获取顺序：总是先获取account1，再获取account2
    public void transfer(Account from, Account to, int amount) {
        Account first = from.id < to.id ? from : to;
        Account second = from.id < to.id ? to : from;

        // 固定顺序加锁
        synchronized (first) {
            synchronized (second) {
                from.balance -= amount;
                to.balance += amount;
            }
        }
    }
}
```

### 策略二：死锁避免（银行家算法）

**在资源分配前检查是否安全。**

```java
// 银行家算法核心
public class BankerAlgorithm {
    private int[] available;           // 可用资源
    private int[][] maximum;           // 最大需求
    private int[][] allocation;        // 已分配
    private int[][] need;              // 还需要

    // 尝试分配资源
    public boolean tryAllocate(int process, int[] request) {
        // 1. 检查请求是否超过需求
        for (int i = 0; i < request.length; i++) {
            if (request[i] > need[process][i]) {
                return false;  // 请求超过需求
            }
        }

        // 2. 检查请求是否超过可用
        for (int i = 0; i < request.length; i++) {
            if (request[i] > available[i]) {
                return false;  // 资源不足
            }
        }

        // 3. 假装分配，测试安全性
        for (int i = 0; i < request.length; i++) {
            available[i] -= request[i];
            allocation[process][i] += request[i];
            need[process][i] -= request[i];
        }

        // 4. 检查是否存在安全序列
        if (isSafe()) {
            return true;  // 真的分配
        }

        // 不安全，回滚
        for (int i = 0; i < request.length; i++) {
            available[i] += request[i];
            allocation[process][i] -= request[i];
            need[process][i] += request[i];
        }
        return false;
    }

    // 检查是否存在安全序列
    private boolean isSafe() {
        int[] work = available.clone();
        boolean[] finish = new boolean[maximum.length];

        for (int i = 0; i < maximum.length; i++) {
            if (!finish[i] && canSatisfy(need[i], work)) {
                // 进程i可以完成
                for (int j = 0; j < work.length; j++) {
                    work[j] += allocation[i][j];  // 释放资源
                }
                finish[i] = true;
                i = -1;  // 重新开始检查
            }
        }

        // 所有进程都能完成
        for (boolean f : finish) {
            if (!f) return false;
        }
        return true;
    }

    private boolean canSatisfy(int[] need, int[] work) {
        for (int i = 0; i < need.length; i++) {
            if (need[i] > work[i]) return false;
        }
        return true;
    }
}
```

### 策略三：死锁检测与恢复

#### 资源分配图法

```
圆圈: 进程
方框: 资源类型（方框内的点表示实例）
箭头: 请求/分配

   P1 ──→│R1│←── P2       P1持有R1，请求R2
                     ↓      P2持有R2，请求R1
                    R2      → 死锁！

   P1 ──→│R1│       P1持有R1，请求R2
                     ↓      P2持有R2，请求R1
   P2 ←──│R2│              → 死锁！
```

#### 恢复策略

| 策略 | 方法 |
|-----|-----|
| 终止进程 | 终止死锁进程，释放资源 |
| 回滚 | 回滚到安全检查点 |
| 强制抢占 | 剥夺进程的资源 |
| 鸵鸟算法 | 忽略它（大多数操作系统的选择） |

> 大多数操作系统采用「鸵鸟算法」——因为死锁发生的概率很低，检测和恢复的开销太大。


## 实际开发中的死锁避免

### 1. 减少锁的使用

```java
// 不用锁的方式：用原子操作
public class LockFreeCounter {
    private final AtomicLong count = new AtomicLong(0);

    public void increment() {
        count.incrementAndGet();  // CAS操作，无锁
    }
}
```

### 2. 缩小锁的范围

```java
// 错误：锁住整个方法
public synchronized void process() {
    long start = System.currentTimeMillis();
    // ... 耗时的数据库操作、网络请求
    // 这些操作不需要锁保护
    long duration = System.currentTimeMillis() - start;
}

// 正确：只锁住需要保护的部分
public void process() {
    long start = System.currentTimeMillis();
    performSlowOperation();  // 不需要锁
    synchronized (this) {
        count++;  // 只锁住真正需要保护的部分
    }
}
```

### 3. 使用显式锁的tryLock

```java
public class TryLockExample {
    private final ReentrantLock lock = new ReentrantLock();

    public void execute() {
        // 尝试获取锁，超时则放弃
        try {
            if (lock.tryLock(1, TimeUnit.SECONDS)) {
                try {
                    // 执行临界区
                } finally {
                    lock.unlock();
                }
            } else {
                // 获取失败，执行回退逻辑
                handleFailure();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
```


## 面试追问方向

- **死锁的四个必要条件是什么？**
  提示：互斥、请求和保持、不可抢占、循环等待。
- **如何破坏死锁的循环等待条件？**
  提示：固定顺序获取锁。
- **什么是鸵鸟算法？为什么大多数操作系统采用它？**
  提示：死锁概率低、检测恢复成本高。
- **银行家算法的时间复杂度是多少？**
  提示：O(进程数 × 资源类型数)。
