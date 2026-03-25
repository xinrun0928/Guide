# AtomicReference 与 ABA 问题

`AtomicInteger` 只能保证单个 `int` 的原子性。

如果我需要保证**任意引用类型**的原子操作呢？

答案是 **`AtomicReference`**。

---

## AtomicReference 是什么？

`AtomicReference<V>` 提供了对**任意引用类型**的原子更新能力。

```java
import java.util.concurrent.atomic.AtomicReference;

public class AtomicRefDemo {
    public static void main(String[] args) {
        AtomicReference<String> ref = new AtomicReference<>("A");
        
        // 原子地更新值
        ref.compareAndSet("A", "B");
        
        System.out.println(ref.get());  // 输出 B
    }
}
```

---

## 基本使用

### 构造方法

```java
AtomicReference<String> ref1 = new AtomicReference<>("initial");
AtomicReference<String> ref2 = new AtomicReference<>();  // 默认 null
```

### 常用方法

```java
AtomicReference<User> userRef = new AtomicReference<>(new User("Alice", 25));

// 获取值
User user = userRef.get();

// 设置值
userRef.set(new User("Bob", 30));

// CAS 更新
userRef.compareAndSet(oldUser, newUser);

// 原子更新
userRef.updateAndGet(u -> new User(u.getName(), u.getAge() + 1));
```

---

## ABA 问题演示

### 什么是 ABA 问题？

ABA 问题是 CAS 中最经典的问题之一。

```
ABA 问题时间线：

T0  线程 A                    线程 B                    线程 C
    │                         │                         │
    │  读取 ref = A           │                         │
    │                         │                         │
T1  │                         │  CAS(A → B) ✓            │
    │                         │                         │
T2  │                         │                         │  CAS(A → C) ✓
    │                         │                         │
T3  │                         │                         │
    │                         │                         │
T4  │  CAS(A → D)            │                         │
    │  ← 成功！但 A 已经历了 B 和 A                       │
    │  线程 A 不知道中间发生过变化                          │
```

### ABA 问题可能导致的后果

想象一个栈的操作：

```java
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicStampedReference;

class Node {
    String value;
    Node next;
    
    Node(String value) {
        this.value = value;
    }
}

class ConcurrentStack {
    private AtomicReference<Node> top = new AtomicReference<>();
    
    // push 操作
    public void push(String value) {
        Node newNode = new Node(value);
        Node oldTop;
        do {
            oldTop = top.get();
            newNode.next = oldTop;
        } while (!top.compareAndSet(oldTop, newNode));
    }
    
    // pop 操作
    public String pop() {
        Node oldTop;
        Node newTop;
        do {
            oldTop = top.get();
            if (oldTop == null) {
                return null;
            }
            newTop = oldTop.next;
        } while (!top.compareAndSet(oldTop, newTop));
        return oldTop.value;
    }
}
```

**ABA 场景导致的问题**：

```
栈状态：A → B → C（顶部是 A）

T0  线程 A 执行 pop()                          线程 B 执行 pop()
    │  读取 top = A                             │
    │  oldTop = A, newTop = B                    │
    │                                            │  读取 top = A
    │                                            │  读取 top = B
    │                                            │  CAS(A → B) ✓
    │                                            │  读取 top = B
    │                                            │  CAS(B → C) ✓
    │                                            │  此时：栈变成 C
    │                                            │
    │  读取 top = C（不是 null！）               │
    │  CAS(A → C) ✓                              │
    │  ← 线程 A 成功，但 C 里面藏着 B 的 next！   │
    │  ← 导致 B 丢失了！                         │
```

---

## AtomicReference 解决 ABA（但不彻底）

`AtomicReference` 本身**不能**解决 ABA 问题，因为它只比较值，不比较引用。

```java
public class ABADemo {
    public static void main(String[] args) {
        AtomicReference<String> ref = new AtomicReference<>("A");
        
        // 线程 A
        new Thread(() -> {
            String A = ref.get();
            System.out.println("线程 A 读取: " + A);
            
            try { Thread.sleep(1000); } catch (InterruptedException e) {}
            
            // 线程 A 尝试改为 D
            boolean success = ref.compareAndSet("A", "D");
            System.out.println("线程 A CAS(A → D): " + success);
        }).start();
        
        // 线程 B
        new Thread(() -> {
            String A = ref.get();
            System.out.println("线程 B 读取: " + A);
            
            // B 把 A 改成 B
            ref.compareAndSet("A", "B");
            System.out.println("线程 B CAS(A → B): true");
            
            // 再把 B 改回 A
            ref.compareAndSet("B", "A");
            System.out.println("线程 B CAS(B → A): true");
            
            // 此时 ref 又变成 A
            System.out.println("线程 B: ref = " + ref.get());
        }).start();
    }
}
```

**输出**：
```
线程 A 读取: A
线程 B 读取: A
线程 B CAS(A → B): true
线程 B CAS(B → A): true
线程 B: ref = A
线程 A CAS(A → D): true   ← 线程 A 成功了！但 ref 已经历过 B
```

**问题**：线程 A 认为「没有线程动过」，但实际上已经变过两次了。

---

## 真正解决问题：AtomicStampedReference

`AtomicStampedReference` 通过**版本号（时间戳）**来解决 ABA 问题：

```java
import java.util.concurrent.atomic.AtomicStampedReference;

public class StampedRefDemo {
    public static void main(String[] args) {
        // 初始化：值 + 版本号
        AtomicStampedReference<String> ref = 
            new AtomicStampedReference<>("A", 0);
        
        System.out.println("初始值: " + ref.getReference() + 
                           ", 版本: " + ref.getStamp());  // A, 0
        
        // 线程 B 修改：值变成 B，版本变成 1
        ref.compareAndSet("A", "B", 0, 1);
        System.out.println("线程 B: " + ref.getReference() + 
                           ", 版本: " + ref.getStamp());  // B, 1
        
        // 线程 B 修改：值变回 A，版本变成 2
        ref.compareAndSet("B", "A", 1, 2);
        System.out.println("线程 B: " + ref.getReference() + 
                           ", 版本: " + ref.getStamp());  // A, 2
        
        // 线程 A 尝试 CAS：期望 A 版本 0，但实际版本是 2
        boolean success = ref.compareAndSet("A", "D", 0, 3);
        System.out.println("线程 A CAS(A → D): " + success);  // false！
    }
}
```

---

## AtomicMarkableReference

如果只需要知道「是否被修改过」，不需要具体版本号，可以用 `AtomicMarkableReference`：

```java
import java.util.concurrent.atomic.AtomicMarkableReference;

// 比版本号更轻量：只记录 true/false
AtomicMarkableReference<String> ref = 
    new AtomicMarkableReference<>("A", false);

// 标记已修改
ref.compareAndSet("A", "B", false, true);

// 再次修改
ref.compareAndSet("B", "A", true, false);  // 期望标记是 true
```

**适用场景**：只需要知道「有没有人动过」，而不关心动了多少次。

---

## 实战：账户余额更新

```java
import java.util.concurrent.atomic.AtomicReference;

class Account {
    private final String accountId;
    private final AtomicReference<Integer> balance;
    
    public Account(String accountId, int balance) {
        this.accountId = accountId;
        this.balance = new AtomicReference<>(balance);
    }
    
    // 原子转账
    public boolean transfer(Account target, int amount) {
        while (true) {
            int fromBalance = this.balance.get();
            if (fromBalance < amount) {
                return false;  // 余额不足
            }
            
            int toBalance = target.balance.get();
            
            // 同时更新两个账户
            if (this.balance.compareAndSet(fromBalance, fromBalance - amount) &&
                target.balance.compareAndSet(toBalance, toBalance + amount)) {
                return true;
            }
            // 重试
        }
    }
    
    public int getBalance() {
        return balance.get();
    }
}
```

---

## 面试实战

**面试官问**：「什么是 ABA 问题？怎么解决？」

**参考回答**：
> ABA 是 CAS 中的经典问题。线程 A 读取值 X，线程 B 把 X 改成 Y 再改回 X，线程 A 的 CAS 依然成功，但实际上值已经被修改过。
>
> 解决方案有两种：
>
> **第一，AtomicStampedReference**，在值之外增加版本号。CAS 时不仅要比较值，还要比较版本号。
>
> **第二，AtomicMarkableReference**，只记录「是否被修改过」，不记录次数。
>
> 这两种方式都是用「额外的标记」来感知中间的变化。

---

## 总结

| 类 | 用途 | 版本控制 |
|-----|------|---------|
| `AtomicReference<V>` | 任意引用类型的原子操作 | 无 |
| `AtomicStampedReference<V>` | 带版本号的原子操作 | 完整版本号 |
| `AtomicMarkableReference<V>` | 带标记的原子操作 | 布尔标记 |

```
┌─────────────────────────────────────────────────────────────┐
│                    ABA 问题解决方案对比                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  AtomicReference              AtomicStampedReference         │
│  ┌─────────┐                 ┌─────────┬─────────┐          │
│  │ Value=A │                 │Value=A  │Stamp=0  │          │
│  └─────────┘                 └─────────┴─────────┘          │
│       ↑                            ↑                        │
│       │                            │                        │
│   CAS(A→B)                      CAS(A→B, 0→1)              │
│       ↓                            ↓                        │
│  ┌─────────┐                 ┌─────────┬─────────┐          │
│  │ Value=B │                 │Value=B  │Stamp=1  │          │
│  └─────────┘                 └─────────┴─────────┘          │
│       ↑                            ↑                        │
│       │                            │                        │
│   CAS(B→A)                      CAS(B→A, 1→2)              │
│       ↓                            ↓                        │
│  ┌─────────┐                 ┌─────────┬─────────┐          │
│  │ Value=A │ ← 无法区分      │Value=A  │Stamp=2  │ ← 能区分  │
│  └─────────┘                 └─────────┴─────────┘          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 留给你的思考题

使用 `AtomicStampedReference` 实现一个线程安全的「引用交换」操作：

```java
class SwapDemo {
    private AtomicStampedReference<String> ref = 
        new AtomicStampedReference<>("A", 0);
    
    // 实现：交换 ref 和另一个 ref 的值，同时更新版本号
    public void swap(AtomicStampedReference<String> other) {
        // 需要保证：
        // 1. 原子性（两个引用同时交换）
        // 2. 解决 ABA 问题
        // 怎么实现？
    }
}
```

（提示：这是一个更难的问题，因为涉及两个引用的原子更新，可能需要加锁或循环 CAS + 重试）
