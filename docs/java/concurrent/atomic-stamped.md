# AtomicStampedReference：解决 ABA 问题

如果你用过 `AtomicReference`，可能已经知道 ABA 问题。

但 `AtomicReference` 本身**无法解决** ABA 问题。

真正能解决问题的是 **`AtomicStampedReference`**。

---

## 回顾 ABA 问题

ABA 问题的本质：**CAS 只比较「值」，不比较「中间过程」**。

```
ABA 问题时间线：

初始：A
线程 B：A → B → A
线程 A：发现还是 A，以为没人动过，CAS 成功

实际：A 的值虽然一样，但中间已经变化过了！
```

---

## AtomicStampedReference 的解决方案

**核心思想**：不仅比较值，还比较**版本号**。

```
普通 CAS：       AtomicStampedReference：
┌─────────┐     ┌─────────┬─────────┐
│ 值=A    │     │ 值=A    │ 版本=2  │
└─────────┘     └─────────┴─────────┘
                     ↑
               版本号记录了变化次数
```

---

## 源码解析

### 内部结构

```java
public class AtomicStampedReference<V> {
    // Pair 内部类：封装值和版本号
    private static class Pair<T> {
        final T reference;    // 值
        final long stamp;     // 版本号
        private Pair(T reference, long stamp) {
            this.reference = reference;
            this.stamp = stamp;
        }
        // CAS 核心：比较版本号
        static <T> Pair<T> of(T reference, long stamp) {
            return new Pair<>(reference, stamp);
        }
    }
    
    // 用 volatile 保证 Pair 的可见性
    private volatile Pair<V> pair;
}
```

### compareAndSet 核心逻辑

```java
public boolean compareAndSet(V   expectedReference,  // 期望的值
                             V   newReference,       // 新值
                             int expectedStamp,      // 期望的版本
                             int newStamp) {         // 新版本
    // 获取当前的 Pair
    Pair<V> current = pair;
    
    // 1. 如果当前值不等于期望值，失败
    if (current.reference != expectedReference &&
        (expectedReference == null || 
         !expectedReference.equals(current.reference))) {
        return false;
    }
    
    // 2. 如果当前版本等于期望版本，说明没变化
    if (current.stamp == expectedStamp) {
        // 3. 创建新 Pair 并 CAS 更新
        Pair<V> newPair = Pair.of(newReference, newStamp);
        return unsafe.compareAndSwapObject(this, pairOffset, current, newPair);
    }
    
    return false;  // 版本不对，失败
}
```

---

## 使用示例

### 基本用法

```java
import java.util.concurrent.atomic.AtomicStampedReference;

public class StampedRefBasicDemo {
    public static void main(String[] args) {
        // 初始化：值=A，版本号=0
        AtomicStampedReference<String> ref = 
            new AtomicStampedReference<>("A", 0);
        
        // 获取值和版本
        String value = ref.getReference();
        int stamp = ref.getStamp();
        System.out.println("初始: value=" + value + ", stamp=" + stamp);
        
        // 正常 CAS：期望值=A 版本=0，改为 B 版本=1
        ref.compareAndSet("A", "B", 0, 1);
        System.out.println("第一次更新: " + ref.getReference() + 
                           ", stamp=" + ref.getStamp());
        
        // 再次更新：B 版本=1 改为 A 版本=2
        ref.compareAndSet("B", "A", 1, 2);
        System.out.println("第二次更新: " + ref.getReference() + 
                           ", stamp=" + ref.getStamp());
        
        // 尝试旧版本 CAS：期望值=A 版本=0，但实际版本是 2
        boolean success = ref.compareAndSet("A", "C", 0, 1);
        System.out.println("旧版本 CAS: " + success);  // false！
    }
}
```

### 用 get() 获取值和版本

```java
// 方式一：分别获取
int[] holder = new int[1];
String value = ref.get(holder);
int stamp = holder[0];

// 方式二：直接获取
Stamp stampObj = ref.getStamp();
```

---

## 实战：线程安全的栈

这是 `AtomicStampedReference` 最经典的应用——解决栈的 ABA 问题：

```java
import java.util.concurrent.atomic.AtomicStampedReference;

class Node<E> {
    E value;
    Node<E> next;
    
    Node(E value) {
        this.value = value;
    }
}

class SafeStack<E> {
    private AtomicStampedReference<Node<E>> top = 
        new AtomicStampedReference<>(null, 0);
    
    // push 操作
    public void push(E item) {
        Node<E> newNode = new Node<>(item);
        int[] stampHolder = new int[1];
        
        while (true) {
            Node<E> oldTop = top.get(stampHolder);
            int oldStamp = stampHolder[0];
            newNode.next = oldTop;
            
            // CAS：期望顶部不变 + 版本不变
            if (top.compareAndSet(oldTop, newNode, oldStamp, oldStamp + 1)) {
                return;
            }
            // 重试
        }
    }
    
    // pop 操作
    public E pop() {
        int[] stampHolder = new int[1];
        
        while (true) {
            Node<E> oldTop = top.get(stampHolder);
            int oldStamp = stampHolder[0];
            
            if (oldTop == null) {
                return null;  // 栈空
            }
            
            Node<E> newTop = oldTop.next;
            
            // CAS：期望顶部不变 + 版本不变
            if (top.compareAndSet(oldTop, newTop, oldStamp, oldStamp + 1)) {
                return oldTop.value;
            }
            // 重试
        }
    }
}
```

---

## ABA 场景对比

### 普通 CAS 导致的问题

```
栈状态：A → B

T0  线程 A pop                    线程 B pop
    │  读取 top=A                 │  读取 top=A
    │  读取 next=B                │  读取 next=B
    │                             │
T1  │  CAS(A → B) ✓               │  CAS(A → B) ✓
    │  ← 都成功了！但 B 被弹出两次  │
    │                             │
    │  返回 A，栈变成 B            │  返回 A，栈变成 null
    │  ← B 丢失！                  │
```

### 版本号 CAS 解决的问题

```
带版本号的栈：

T0  线程 A pop                    线程 B pop
    │  读取 top=A, stamp=0         │  读取 top=A, stamp=0
    │  读取 next=B                │
    │                             │
T1  │  CAS(A → B, 0 → 1) ✓        │  CAS(A → B, 0 → 1) ✗
    │  ← 线程 A 成功了             │  ← 线程 B 失败！版本已变
    │                             │
    │  返回 A，stamp 变成 1        │  重试，读取 top=B, stamp=1
    │                             │  读取 next=null
    │                             │  CAS(B → null, 1 → 2) ✓
    │                             │  返回 B
```

---

## 与 AtomicMarkableReference 对比

| 特性 | AtomicStampedReference | AtomicMarkableReference |
|-----|----------------------|------------------------|
| 标记类型 | long 版本号 | boolean 标记 |
| 精度 | 完整版本号，可区分每次修改 | 只能区分「修改过」和「未修改」 |
| 内存 | 8 字节（long） | 1 字节（boolean） |
| 适用场景 | 需要知道修改次数 | 只需知道是否被修改 |

```java
// AtomicMarkableReference 示例
AtomicMarkableReference<String> ref = 
    new AtomicMarkableReference<>("A", false);

// 第一次修改：期望 A + 未标记，改为 B + 已标记
ref.compareAndSet("A", "B", false, true);

// 第二次修改：期望 B + 已标记，改为 A + 未标记
ref.compareAndSet("B", "A", true, false);

// 此时 ref = A，但标记是 false（未修改）
// 如果期望 A + 标记 false，再改就不行，因为要同时匹配值和标记
```

---

## 面试实战

**面试官问**：「AtomicStampedReference 怎么解决 ABA 问题的？」

**参考回答**：
> AtomicStampedReference 在值之外额外维护了一个 long 类型的版本号（stamp）。
>
> 每次 `compareAndSet()` 不仅比较值是否等于期望值，还比较版本号是否等于期望版本号。只有两者都匹配，CAS 才会成功。
>
> 这样，即使值从 A→B→A 变回来了，版本号也从 0→1→2，线程再次尝试 CAS(A→X, stamp=0) 时会失败，因为实际的 stamp 是 2。
>
> 这就像给对象加上了「时间戳」，任何变化都会更新时间戳，CAS 时就能感知到。

---

## 总结

```
┌─────────────────────────────────────────────────────────────┐
│               AtomicStampedReference 要点                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  构造：AtomicStampedReference<>(初始值, 初始版本)           │
│                                                             │
│  核心方法：                                                   │
│  compareAndSet(expectedRef, newRef, expectedStamp, newStamp) │
│                                                             │
│  工作原理：                                                   │
│  ┌─────────┐      ┌─────────┐      ┌─────────┐           │
│  │  值=A   │  →   │  值=A   │  →   │  值=A   │           │
│  │  stamp=0│      │  stamp=1│      │  stamp=2│           │
│  └─────────┘      └─────────┘      └─────────┘           │
│                                                             │
│  线程只能感知到自己期望版本号的变化                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 留给你的思考题

假设有一个「版本号计数器」，每次修改版本号加 1：

```java
AtomicStampedReference<Integer> counter = 
    new AtomicStampedReference<>(0, 0);

// 线程 A 和线程 B 同时尝试：
// 1. 读取当前值和版本
// 2. 值 + 10
// 3. 版本 + 1
// 4. CAS 更新

// 线程 A 的 CAS 参数应该是：compareAndSet(?, ?, ?, ?)
// 线程 B 的 CAS 参数应该是：compareAndSet(?, ?, ?, ?)

// 如果线程 B 在 CAS 时发现版本已经变了，它应该怎么重试？
```

（提示：版本号只能增加，不能减少；重试时要重新读取最新的值和版本）
