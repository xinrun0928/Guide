# 死锁处理策略：理论与实践

死锁是并发编程中最棘手的问题之一。
之前我们已经了解了死锁的四个必要条件，现在来深入探讨**如何系统地处理死锁**。


## 四种处理策略概览

```
┌─────────────────────────────────────────────────────────────┐
│                    死锁处理策略                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 预防（Prevention）                                      │
│     ─── 破坏死锁的必要条件，从根本上杜绝死锁                  │
│                                                             │
│  2. 避免（Avoidance）                                       │
│     ─── 在资源分配时检查是否安全，只分配安全的资源             │
│                                                             │
│  3. 检测与恢复（Detection & Recovery）                       │
│     ─── 允许死锁发生，但定期检测并恢复                         │
│                                                             │
│  4. 忽略（Ostrich）                                         │
│     ─── 假装死锁不会发生（很多操作系统的选择）                 │
│                                                             │
│  策略选择：可靠性 ←────────────────────→ 性能                │
│           预防 → 避免 → 检测恢复 → 忽略                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```


## 策略一：死锁预防

**通过破坏死锁的必要条件来预防死锁。**

### 破坏互斥条件

```
方案：允许多个进程共享某些资源

问题：
- 不是所有资源都可以共享（互斥是资源的本质属性）
- 某些资源必须互斥访问（锁、打印机）

实际应用：
-  spooling技术：将打印任务排队，打印机变成可共享设备
-  共享只读文件
```

### 破坏请求和保持条件

```
方案：进程开始时一次性申请所有需要的资源

优点：简单有效
缺点：
- 需要预先知道资源需求（实际中难以确定）
- 资源利用率低（进程持有资源但可能暂时不用）
- 可能导致饥饿（长期等待）
```

```java
// 一次性申请所有资源（伪代码）
public class AllOrNothing {
    public void process() {
        // 在开始前申请所有资源
        lock1.lock();
        lock2.lock();
        lock3.lock();

        try {
            // 执行处理
        } finally {
            lock1.unlock();
            lock2.unlock();
            lock3.unlock();
        }
    }
}
```

### 破坏不可抢占条件

```
方案：如果无法获得需要的资源，就释放已持有的资源

实现方式：
1. 操作系统强制回收资源
2. 进程主动释放（回退）

问题：
- 状态保存和恢复开销大
- 可能导致已完成工作丢失
- 只适用于某些资源（CPU可以抢占，磁盘文件不能）
```

```java
// 尝试获取锁，超时则回退
public class TryAndRollback {
    private final ReentrantLock lock1 = new ReentrantLock();
    private final ReentrantLock lock2 = new ReentrantLock();

    public void process() {
        while (true) {
            if (lock1.tryLock(1, TimeUnit.SECONDS)) {
                try {
                    if (lock2.tryLock(1, TimeUnit.SECONDS)) {
                        try {
                            // 执行处理
                            return;
                        } finally {
                            lock2.unlock();
                        }
                    }
                } finally {
                    lock1.unlock();
                }
            }
            // 获得锁失败，休息一会再试
            try {
                Thread.sleep(100);
            } catch (InterruptedException e) {}
        }
    }
}
```

### 破坏循环等待条件

```
方案：给资源编号，所有进程按固定顺序申请资源

例如：
资源顺序：R1 → R2 → R3 → R4

进程A：必须先申请R1，再申请R2
进程B：必须先申请R1，再申请R2
（不可能出现A持有R1等R2，B持有R2等R1的循环）

效果：打破循环等待链
```

```java
// 按固定顺序获取锁
public class FixedOrderTransfer {
    // 账户按ID排序，按固定顺序加锁
    public void transfer(Account from, Account to, int amount) {
        Account first = from.getId() < to.getId() ? from : to;
        Account second = from.getId() < to.getId() ? to : from;

        // 始终先锁ID小的，再锁ID大的
        synchronized (first) {
            synchronized (second) {
                from.withdraw(amount);
                to.deposit(amount);
            }
        }
    }
}
```


## 策略二：死锁避免

**在资源分配前检查是否会形成不安全状态。**

### 银行家算法

**核心思想：在分配资源前，检查分配后是否存在安全序列。**

```java
public class BankerAlgorithm {
    private int[] available;           // 可用资源
    private int[][] maximum;            // 最大需求
    private int[][] allocation;         // 已分配
    private int[][] need;              // 还需要

    public BankerAlgorithm(int[] available, int[][] maximum) {
        this.available = available.clone();
        this.maximum = maximum;
        this.allocation = new int[maximum.length][available.length];
        this.need = new int[maximum.length][available.length];

        for (int i = 0; i < maximum.length; i++) {
            for (int j = 0; j < available.length; j++) {
                need[i][j] = maximum[i][j];
            }
        }
    }

    // 请求资源
    public synchronized boolean request(int process, int[] request) {
        // 1. 检查请求是否超过需求
        for (int j = 0; j < request.length; j++) {
            if (request[j] > need[process][j]) {
                throw new IllegalArgumentException("请求超过最大需求");
            }
        }

        // 2. 检查请求是否超过可用
        for (int j = 0; j < request.length; j++) {
            if (request[j] > available[j]) {
                return false;  // 必须等待
            }
        }

        // 3. 尝试分配
        for (int j = 0; j < request.length; j++) {
            available[j] -= request[j];
            allocation[process][j] += request[j];
            need[process][j] -= request[j];
        }

        // 4. 检查安全性
        if (isSafe()) {
            return true;  // 真的分配
        }

        // 不安全，回滚
        for (int j = 0; j < request.length; j++) {
            available[j] += request[j];
            allocation[process][j] -= request[j];
            need[process][j] += request[j];
        }

        return false;
    }

    // 检查是否存在安全序列
    private boolean isSafe() {
        int[] work = available.clone();
        boolean[] finish = new boolean[maximum.length];

        // 尝试找到满足条件的进程
        for (int i = 0; i < maximum.length; i++) {
            boolean found = false;

            for (int p = 0; p < maximum.length; p++) {
                if (!finish[p] && canFinish(p, work)) {
                    // 进程P可以完成
                    for (int j = 0; j < work.length; j++) {
                        work[j] += allocation[p][j];  // 释放资源
                    }
                    finish[p] = true;
                    found = true;
                }
            }

            if (!found) break;  // 没有进程可以完成
        }

        // 所有进程都能完成 → 安全
        for (boolean f : finish) {
            if (!f) return false;
        }
        return true;
    }

    private boolean canFinish(int process, int[] work) {
        for (int j = 0; j < need[process].length; j++) {
            if (need[process][j] > work[j]) {
                return false;
            }
        }
        return true;
    }
}
```

### 银行家算法的局限性

```
优点：
- 理论完备
- 保证系统始终处于安全状态

缺点：
- 需要预先知道最大资源需求
- 系统可能处于低利用率状态
- 算法复杂度高（O(进程数 × 资源类型数)）
- 实际系统中很少使用
```


## 策略三：死锁检测与恢复

**允许死锁发生，但系统会检测并恢复。**

### 死锁检测算法

```java
public class DeadlockDetector {
    // 资源分配图检测
    // 图中有环 → 死锁

    public boolean hasCycle(int[][] allocation, int[][] request) {
        int n = allocation.length;  // 进程数
        int m = allocation[0].length;  // 资源类型数

        // 构建等待图
        // 进程i → 进程j 表示：i等待j持有的资源

        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                if (i != j && canWaitFor(i, j, allocation, request)) {
                    // i等待j
                    // 检查图中是否有环
                }
            }
        }

        // 使用DFS检测环
        return detectCycle();
    }

    private boolean canWaitFor(int i, int j,
                                int[][] allocation, int[][] request) {
        // 进程i是否能等待进程j？
        // 条件：进程j持有的资源中，有进程i需要的
        for (int r = 0; r < allocation[0].length; r++) {
            if (allocation[j][r] > 0 && request[i][r] > 0) {
                return true;
            }
        }
        return false;
    }
}
```

### 恢复策略

| 策略 | 方法 | 优点 | 缺点 |
|-----|------|-----|------|
| 终止进程 | 杀死一个死锁进程，释放资源 | 简单 | 可能丢失工作 |
| 进程回滚 | 回滚到安全检查点 | 可以重试 | 实现复杂 |
| 资源抢占 | 强制从进程夺取资源 | 可恢复 | 可能导致饥饿 |
| 通知用户 | 让用户决定如何处理 | 灵活 | 用户体验差 |


## 策略四：鸵鸟算法

**假装死锁不会发生。**

```
为什么不处理死锁？

1. 死锁发生概率很低
2. 检测和恢复的开销很大
3. 大多数程序涉及的锁很少，死锁很少见
4. 用户可以重启程序解决问题

实际选择：
- Linux：忽略
- Windows：忽略
- 某些实时系统：必须处理
```


## 实际开发中的最佳实践

### 1. 减少锁的使用

```java
// 用无锁数据结构减少锁
public class LockFreeCounter {
    private final AtomicLong count = new AtomicLong(0);

    public void increment() {
        count.incrementAndGet();
    }
}
```

### 2. 固定顺序获取锁

```java
// 始终按对象ID排序
public void transfer(Account a, Account b, int amount) {
    if (a.getId() < b.getId()) {
        synchronized (a) {
            synchronized (b) {
                doTransfer(a, b, amount);
            }
        }
    } else {
        synchronized (b) {
            synchronized (a) {
                doTransfer(a, b, amount);
            }
        }
    }
}
```

### 3. 锁超时和回退

```java
public void tryWithLock(ReentrantLock lock) {
    try {
        if (lock.tryLock(5, TimeUnit.SECONDS)) {
            try {
                // 执行操作
            } finally {
                lock.unlock();
            }
        } else {
            // 获取锁失败，执行回退逻辑
        }
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
}
```

### 4. 使用高级并发工具

```java
// 使用ConcurrentHashMap减少死锁风险
public class SafeCounter {
    private final ConcurrentHashMap<String, Long> counts =
        new ConcurrentHashMap<>();

    public void increment(String key) {
        counts.computeIfAbsent(key, k -> 0L);
        counts.compute(key, (k, v) -> v + 1);
    }
}
```


## 面试追问方向

- **死锁预防和死锁避免的区别是什么？**
  提示：预防破坏条件，避免检查安全状态。
- **银行家算法的时间复杂度是多少？有什么局限性？**
  提示：O(m × n²)，需要预知最大需求。
- **为什么大多数操作系统选择忽略死锁？**
  提示：发生概率低，处理开销大。
- **如何在代码中避免死锁？**
  提示：固定顺序获取锁、减少锁粒度、锁超时。
