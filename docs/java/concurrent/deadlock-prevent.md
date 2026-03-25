# 如何避免死锁：破坏四大条件

死锁的四个必要条件我们已经清楚了：**互斥、占有并等待、不可抢占、循环等待**。

其中互斥是锁的本质，无法打破。要避免死锁，必须破坏**其他三个条件之一**。

---

## 破坏条件一：一次性获取所有资源（打破占有并等待）

### 思想

不要「边吃边等」，要「先拿到所有资源再吃」。

```
普通方式（占有并等待）：
├─ 持有 lockA
├─ 等 lockB  ← 在等待期间不释放 lockA
└─ ...

一次性获取（打破占有并等待）：
├─ 一次性获取 lockA 和 lockB
└─ 做事情
```

### 代码实现

```java
public class SafeTransfer1 {
    private final Object lock = new Object();
    
    // 普通方式：有死锁风险
    public void unsafeTransfer(Account a, Account b, int amount) {
        synchronized (a) {
            synchronized (b) {
                // 转账逻辑
            }
        }
    }
    
    // 一次性获取：打破占有并等待
    public void safeTransfer(Account a, Account b, int amount) {
        // 先按固定顺序获取全局锁
        synchronized (lock) {
            // 持有全局锁后，再操作具体账户
            synchronized (a) {
                synchronized (b) {
                    // 转账逻辑
                }
            }
        }
    }
}
```

### 进阶方案：按 ID 排序获取锁

```java
public class SafeTransfer2 {
    public void transfer(Account a, Account b, int amount) {
        Account first = a.getId() < b.getId() ? a : b;
        Account second = a.getId() < b.getId() ? b : a;
        
        synchronized (first) {
            synchronized (second) {
                // 转账逻辑
            }
        }
    }
}
```

**关键**：无论调用顺序如何，锁的获取顺序是一致的。

---

## 破坏条件二：设置超时（打破不可抢占）

### 思想

如果等太久，就放弃已有的资源，重新来。

```
不可抢占（死锁）：
├─ 持有 lockA
├─ 等 lockB（永久等待）
└─ ×

可抢占（打破）：
├─ 持有 lockA
├─ 等 lockB（超时 3 秒）
│   └─ 超时后释放 lockA，重新尝试
└─ √
```

### 代码实现

```java
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

public class SafeTransfer3 {
    private final ReentrantLock lock = new ReentrantLock();
    
    public boolean transfer(Account a, Account b, int amount, long timeoutMs) {
        long deadline = System.currentTimeMillis() + timeoutMs;
        
        while (true) {
            // 尝试获取账户 A 的锁
            if (lock.tryLock(timeoutMs, TimeUnit.MILLISECONDS)) {
                try {
                    // 尝试获取账户 B 的锁
                    if (lock.tryLock(timeoutMs, TimeUnit.MILLISECONDS)) {
                        try {
                            // 转账逻辑
                            return doTransfer(a, b, amount);
                        } finally {
                            lock.unlock();
                        }
                    }
                } finally {
                    lock.unlock();
                }
            }
            
            // 超时，直接放弃
            long remaining = deadline - System.currentTimeMillis();
            if (remaining <= 0) {
                return false;  // 超时，放弃
            }
            
            // 短暂等待后重试
            try {
                Thread.sleep(Math.min(remaining, 100));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
    }
    
    private boolean doTransfer(Account a, Account b, int amount) {
        // 转账逻辑
        return true;
    }
}
```

### 使用 Lock 的 tryLock

```java
ReentrantLock lock = new ReentrantLock();

public void doSomething() {
    try {
        // 尝试获取锁，等 3 秒就放弃
        if (lock.tryLock(3, TimeUnit.SECONDS)) {
            try {
                // 做事情
            } finally {
                lock.unlock();
            }
        } else {
            // 获取失败，等待后重试
        }
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
}
```

---

## 破坏条件三：资源有序编号（打破循环等待）

### 思想

给所有资源编号，所有线程按固定顺序获取资源。

```
无顺序（可能死锁）：
├─ 线程1：A → B
└─ 线程2：B → A
    └─ 可能形成循环等待

有序编号（打破循环等待）：
├─ 给资源编号：A=1, B=2
└─ 所有线程必须先拿编号小的
    ├─ 线程1：A(1) → B(2)
    └─ 线程2：A(1) → B(2)  ← 顺序一致，不会死锁
```

### 代码实现

```java
public class SafeTransfer4 {
    // 账户对象本身作为锁
    public void transfer(Account source, Account target, int amount) {
        // 按 ID 排序，确保加锁顺序一致
        Account first = source.getId() < target.getId() ? source : target;
        Account second = source.getId() < target.getId() ? target : source;
        
        synchronized (first) {
            synchronized (second) {
                // 转账逻辑
            }
        }
    }
}

class Account {
    private final String id;
    private int balance;
    
    public Account(String id, int balance) {
        this.id = id;
        this.balance = balance;
    }
    
    public String getId() {
        return id;
    }
    
    public int getBalance() {
        return balance;
    }
    
    public void setBalance(int balance) {
        this.balance = balance;
    }
}
```

---

## 实战：转账场景的最佳实践

### 方案一：全局锁（简单粗暴）

```java
public class AccountService1 {
    private final Object globalLock = new Object();
    
    public boolean transfer(Account a, Account b, int amount) {
        synchronized (globalLock) {
            if (a.getBalance() >= amount) {
                a.setBalance(a.getBalance() - amount);
                b.setBalance(b.getBalance() + amount);
                return true;
            }
            return false;
        }
    }
}
```

**优点**：简单，不会死锁
**缺点**：性能差，所有转账串行执行

### 方案二：分段锁（高性能）

```java
public class AccountService2 {
    // 分段锁数组
    private static final int SEGMENTS = 16;
    private final Object[] locks = new Object[SEGMENTS];
    
    public AccountService2() {
        for (int i = 0; i < SEGMENTS; i++) {
            locks[i] = new Object();
        }
    }
    
    // 根据账户 ID 选择锁
    private Object getLock(String accountId) {
        int hash = accountId.hashCode();
        return locks[(hash & 0x7FFFFFFF) % SEGMENTS];
    }
    
    public boolean transfer(Account a, Account b, int amount) {
        if (a.getId().equals(b.getId())) {
            return false;  // 同一账户不需要转账
        }
        
        // 按顺序获取两把锁
        Object lock1 = getLock(a.getId());
        Object lock2 = getLock(b.getId());
        
        // 确保顺序一致
        if (lock1 == lock2) {
            synchronized (lock1) {
                return doTransfer(a, b, amount);
            }
        } else {
            // 按内存地址顺序加锁
            Object first = System.identityHashCode(lock1) < 
                          System.identityHashCode(lock2) ? lock1 : lock2;
            Object second = first == lock1 ? lock2 : lock1;
            
            synchronized (first) {
                synchronized (second) {
                    return doTransfer(a, b, amount);
                }
            }
        }
    }
    
    private boolean doTransfer(Account a, Account b, int amount) {
        if (a.getBalance() >= amount) {
            a.setBalance(a.getBalance() - amount);
            b.setBalance(b.getBalance() + amount);
            return true;
        }
        return false;
    }
}
```

---

## 总结：四种方案对比

| 方案 | 破坏条件 | 优点 | 缺点 |
|-----|---------|------|------|
| 一次性获取所有资源 | 占有并等待 | 简单 | 性能差 |
| 设置超时 | 不可抢占 | 自动恢复 | 可能饥饿 |
| 资源有序编号 | 循环等待 | 性能好 | 需要全局编号 |
| 分段锁 | 多个条件 | 高性能 | 实现复杂 |

```
┌─────────────────────────────────────────────────────────────┐
│                   避免死锁的四种策略                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 破坏「占有并等待」                                        │
│     ├─ 一次性获取所有资源                                     │
│     └─ 场景：低并发、简单业务                                 │
│                                                             │
│  2. 破坏「不可抢占」                                          │
│     ├─ 设置锁超时，失败后释放                                 │
│     └─ 场景：需要自动恢复的业务                               │
│                                                             │
│  3. 破坏「循环等待」                                          │
│     ├─ 资源有序编号                                           │
│     └─ 场景：转账、账户操作                                   │
│                                                             │
│  4. 无锁设计                                                │
│     ├─ 使用无锁数据结构                                       │
│     └─ 场景：高性能系统                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 面试实战

**面试官问**：「怎么避免死锁？」

**参考回答**：
> 死锁需要同时满足四个条件：互斥、占有并等待、不可抢占、循环等待。互斥无法打破，所以要从其他三个条件入手。
>
> **第一种，破坏占有并等待**。不要在持有锁的时候去等待其他锁，而是先获取所有需要的锁再操作。但这种方式粒度太粗，性能差。
>
> **第二种，破坏不可抢占**。用 `tryLock(timeout)` 设置获取锁的超时时间，超时后主动释放已持有的锁，重新尝试。
>
> **第三种，破坏循环等待（最常用）**。给所有资源编号，所有线程按固定顺序获取资源。比如转账场景，无论 A→B 还是 B→A，都先操作 ID 小的账户，这样就不会形成循环等待。
>
> 实际工作中，第三种用得最多。

---

## 留给你的思考题

哲学家就餐问题有多种解法，请用「破坏循环等待」的思想实现一个不会死锁的版本。

```java
class Philosopher extends Thread {
    private Chopstick left;
    private Chopstick right;
    
    public Philosopher(Chopstick left, Chopstick right) {
        this.left = left;
        this.right = right;
    }
    
    // 怎么修改，保证不会死锁？
    public void run() {
        while (true) {
            try {
                synchronized (left) {
                    synchronized (right) {
                        // 吃饭
                    }
                }
            } catch (Exception e) {}
        }
    }
}
```

（提示：让哲学家按统一顺序拿起筷子，而不是「左→右」）
