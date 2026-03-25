# AtomicInteger/AtomicLong 源码解析

`synchronized` 能保证线程安全，但性能开销大。

有没有一种方式，既能保证原子性，又能减少锁竞争？

答案就是 **AtomicInteger**。

---

## AtomicInteger 是什么？

`AtomicInteger` 是 Java 并发包（`java.util.concurrent.atomic`）提供的原子整数类，基于 **CAS + 自旋** 实现。

```java
import java.util.concurrent.atomic.AtomicInteger;

public class Counter {
    private AtomicInteger count = new AtomicInteger(0);
    
    public void increment() {
        count.incrementAndGet();  // 等价于 count++
    }
    
    public int get() {
        return count.get();
    }
}
```

**等价于** synchronized 版的计数器，但性能更好：

```java
// synchronized 版本
private int count = 0;
public synchronized void increment() {
    count++;
}

// AtomicInteger 版本
private AtomicInteger count = new AtomicInteger(0);
public void increment() {
    count.incrementAndGet();
}
```

---

## 源码解析

### 内部结构

```java
public class AtomicInteger extends Number implements java.io.Serializable {
    // 保存值的字段，用 volatile 保证可见性
    private volatile int value;
    
    // 其他字段...
}
```

**关键点**：值用 `volatile` 修饰，保证可见性，但不保证原子性。真正的原子性靠 `Unsafe.compareAndSwapInt()` 实现。

### incrementAndGet()

```java
public final int incrementAndGet() {
    // unsafe 是 Unsafe 实例，提供 CAS 本地方法
    // valueOffset 是 value 字段在对象中的内存偏移量
    for (;;) {
        int current = get();           // 1. 读取当前值
        int next = current + 1;       // 2. 计算新值
        if (compareAndSet(current, next)) {  // 3. CAS 更新
            return next;              // 4. 成功，返回新值
        }
        // 失败，重试（循环）
    }
}
```

**执行流程**：

```
┌─────────────────────────────────────────────────────────────┐
│                incrementAndGet() 执行流程                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   int current = get()         // 读取 volatile value        │
│         ↓                                                     │
│   int next = current + 1     // 计算新值                    │
│         ↓                                                     │
│   CAS(current, next)          // 比较并交换                   │
│         │                                                     │
│         ├─ 成功 → 返回 next                                   │
│         │                                                     │
│         └─ 失败 → 循环重试                                    │
│                      ↑                                       │
│                      └──────┐                                │
│                             │                                │
│         (重新读取、计算、CAS)  ┘                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### compareAndSet()

```java
public final boolean compareAndSet(int expect, int update) {
    // 调用 Unsafe 的 CAS 方法
    // this: 对象引用
    // valueOffset: value 字段的内存偏移量
    // expect: 期望的旧值
    // update: 新值
    return unsafe.compareAndSwapInt(this, valueOffset, expect, update);
}
```

这是**唯一**真正执行原子操作的方法，其他方法都是在这个基础上封装。

### getAndIncrement()

```java
public final int getAndIncrement() {
    for (;;) {
        int current = get();
        int next = current + 1;
        if (compareAndSet(current, next)) {
            return current;  // 返回旧值
        }
    }
}
```

**与 `incrementAndGet()` 的区别**：返回的是**修改前的值**，而不是修改后的值。

```java
AtomicInteger counter = new AtomicInteger(5);

System.out.println(counter.getAndIncrement());  // 输出 5，变量变为 6
System.out.println(counter.incrementAndGet());    // 输出 7，变量变为 7
```

---

## 其他常用方法

### getAndSet()

```java
public final int getAndSet(int newValue) {
    // 原子地设置新值，返回旧值
    // 相当于 synchronized { int old = value; value = newValue; return old; }
    int current;
    do {
        current = get();
    } while (!compareAndSet(current, newValue));
    return current;
}
```

### updateAndGet()

```java
public final int updateAndGet(IntUnaryOperator updateFunction) {
    int prev, next;
    do {
        prev = get();
        next = updateFunction.applyAsInt(prev);
    } while (!compareAndSet(prev, next));
    return next;
}
```

支持自定义操作：

```java
AtomicInteger counter = new AtomicInteger(10);

// 原子地乘以 2
counter.updateAndGet(x -> x * 2);  // 变为 20
```

### getAndUpdate()

```java
public final int getAndUpdate(IntUnaryOperator updateFunction) {
    int prev, next;
    do {
        prev = get();
        next = updateFunction.applyAsInt(prev);
    } while (!compareAndSet(prev, next));
    return prev;  // 返回旧值
}
```

---

## lazySet 的特殊性

```java
public final void lazySet(int newValue) {
    unsafe.putOrderedInt(this, valueOffset, newValue);
}
```

**`lazySet` vs `set`**：

| 方法 | 保证 | 性能 |
|-----|------|------|
| `set()` | volatile 语义，立即可见 | 较慢（Store Barrier） |
| `lazySet()` | 不保证立即可见 | 较快（StoreStore 屏障） |

**使用场景**：`lazySet` 适用于那些「最终一致即可」的场景，比如**计数器归零**：

```java
// 场景：定期重置统计计数器
private AtomicInteger requestCount = new AtomicInteger(0);

public void resetCount() {
    requestCount.lazySet(0);  // 不需要立即被其他线程看到
}
```

---

## 完整示例

```java
import java.util.concurrent.atomic.AtomicInteger;

public class AtomicCounter {
    private final AtomicInteger value = new AtomicInteger(0);
    
    // 原子递增，返回新值
    public int increment() {
        return value.incrementAndGet();
    }
    
    // 原子递减，返回新值
    public int decrement() {
        return value.decrementAndGet();
    }
    
    // 获取当前值
    public int get() {
        return value.get();
    }
    
    // 原子增加并获取旧值
    public int getAndAdd(int delta) {
        return value.getAndAdd(delta);
    }
    
    // 条件更新：只有当值等于 expect 时才更新
    public boolean compareAndSet(int expect, int update) {
        return value.compareAndSet(expect, update);
    }
    
    public static void main(String[] args) throws InterruptedException {
        AtomicCounter counter = new AtomicCounter();
        
        // 启动 10 个线程，每个执行 1000 次递增
        Thread[] threads = new Thread[10];
        for (int i = 0; i < 10; i++) {
            threads[i] = new Thread(() -> {
                for (int j = 0; j < 1000; j++) {
                    counter.increment();
                }
            });
            threads[i].start();
        }
        
        // 等待所有线程完成
        for (Thread t : threads) {
            t.join();
        }
        
        System.out.println("Final value: " + counter.get());  // 一定是 10000
    }
}
```

---

## 面试追问

**面试官问**：「AtomicInteger 怎么保证原子性的？」

**标准回答**：
> AtomicInteger 内部使用 `Unsafe.compareAndSwapInt()` 实现 CAS。CAS 是 CPU 提供的原子指令，保证比较和交换是一个原子操作。
>
> 其他方法如 `incrementAndGet()` 是在 CAS 基础上封装，通过自旋 + CAS 实现原子递增。

**追问**：「为什么需要自旋？」

**深入回答**：
> 因为 CAS 可能失败。比如线程 A 刚读取了值，还没 CAS，线程 B 就把值改掉了。线程 A 的 CAS 就会失败，需要重新读取、计算、再 CAS。
>
> 这就是乐观锁的思想：假设没有冲突，失败了重试。

**追问**：「和 synchronized 比，性能如何？」

**深入回答**：
> 在**低竞争**场景下，AtomicInteger 性能更好，因为不需要线程阻塞/唤醒。
>
> 在**高竞争**场景下，synchronized 经过锁升级优化后，两者性能差异不大。极端情况下，自旋会消耗大量 CPU，此时 synchronized 的线程阻塞更优。
>
> JDK 8 引入的 `LongAdder` 在超高并发下性能更好，因为它分散了竞争。

---

## 总结

| 方法 | 说明 | 返回值 |
|-----|------|--------|
| `incrementAndGet()` | 原子递增 | 新值 |
| `getAndIncrement()` | 原子递增 | 旧值 |
| `decrementAndGet()` | 原子递减 | 新值 |
| `getAndDecrement()` | 原子递减 | 旧值 |
| `getAndAdd(delta)` | 原子增加 delta | 旧值 |
| `addAndGet(delta)` | 原子增加 delta | 新值 |
| `compareAndSet()` | 条件更新 | 是否成功 |
| `lazySet()` | 延迟设置 | void |

---

## 留给你的思考题

下面代码的输出是什么？

```java
AtomicInteger counter = new AtomicInteger(0);

Thread t1 = new Thread(() -> counter.set(100));
Thread t2 = new Thread(() -> counter.set(200));
Thread t3 = new Thread(() -> counter.set(300));

t1.start();
t2.start();
t3.start();
t1.join();
t2.join();
t3.join();

System.out.println(counter.get());
```

（提示：`set()` 是原子操作吗？最终值会是多少？）
