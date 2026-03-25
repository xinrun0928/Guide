# LongAdder vs AtomicLong 高并发性能对比

面试中经常被问到：「高并发计数器，用什么？」

`AtomicLong` 还是 `LongAdder`？

这是一个经典问题。

---

## 问题的本质

`AtomicLong` 的性能瓶颈在哪里？

```java
public class AtomicLongCounter {
    private AtomicLong count = new AtomicLong(0);
    
    public void increment() {
        count.incrementAndGet();
    }
}
```

**问题**：所有线程竞争**同一个内存地址**的 CAS。

```
AtomicLong 高并发场景：

线程 1  ──CAS──→  失败 ──重试──→  失败 ──重试──→  成功
线程 2  ──CAS──→  失败 ──重试──→  成功
线程 3  ──CAS──→  失败
线程 4  ──CAS──→  失败 ──重试──→  失败 ──重试──→  失败 ──重试──→  成功
...

随着线程数增加，CAS 失败率急剧上升，自旋消耗大量 CPU！
```

---

## LongAdder 的解决思路

**核心思想**：**分散竞争**。

与其让所有线程竞争一个地址，不如给每个线程一个「本地计数器」，最后再汇总。

```
AtomicLong（单一竞争）：
┌─────────────────────┐
│      count          │
│   ┌───────────┐     │
│   │    0      │     │
│   └───────────┘     │
│         ↑           │
│    所有线程竞争     │
└─────────────────────┘

LongAdder（分散竞争）：
┌─────────────────────────────────┐
│   ┌───────┐  ┌───────┐  ┌───────┐
│   │Thread1│  │Thread2│  │Thread3│
│   │ count │  │ count │  │ count │
│   │   1   │  │   0   │  │   2   │
│   └───────┘  └───────┘  └───────┘
│         ↑         ↑         ↑     │
│         └─────────┴─────────┘     │
│              最终求和               │
└─────────────────────────────────┘
```

---

## LongAdder 源码解析

### 内部结构

```java
public class LongAdder extends Striped64 {
    // Cell 数组：每个线程一个 Cell，分散竞争
    // 懒加载，第一次冲突时才创建
    transient volatile Cell[] cells;
    
    // base：基础值，无竞争时直接累加到这里
    transient volatile long base;
    
    // cellsBusy：锁标记，CAS 操作 cells 数组时使用
    transient volatile int cellsBusy;
    
    // Cell 类：类似于 AtomicLong，但只服务单个线程
    @sun.misc.Contended
    static final class Cell {
        volatile long value;
        Cell(long x) { value = x; }
        // 核心方法
        final boolean cas(long cmp, long val) {
            return UNSAFE.compareAndSwapLong(this, valueOffset, cmp, val);
        }
        // ...
    }
}
```

### add() 方法

```java
public void add(long x) {
    Cell[] as;
    long b, v;
    int m;
    Cell a;
    
    // 第一次尝试：无竞争，直接累加 base
    if ((as = cells) != null || !casBase(b = base, b + x)) {
        // 进入这里说明：
        // 1. cells 已经初始化（有竞争过）
        // 2. 或者 casBase 失败（base 已被其他线程修改）
        
        boolean uncontended = true;
        if (as == null || (m = as.length - 1) < 1 ||
            (a = as.getProbe()) == null ||
            !(uncontended = a.cas(v = a.value, v + x))) {
            // cells 未初始化、长度不够、或当前线程的 Cell CAS 失败
            // 进入 longAccumulate()
            longAccumulate(x, null, uncontended);
        }
    }
}
```

### longAccumulate() 核心逻辑

```java
// Striped64 的核心方法，处理高并发场景
final void longAccumulate(long x, LongBinaryOperator fn, boolean wasUncontended) {
    int h = Thread.currentThread().getProbe();  // 获取线程的 hash
    
    if (h == 0) {
        ThreadLocalRandom.current();  // 强制初始化
        h = Thread.currentThread().getProbe();
    }
    
    // 自旋 + CAS 扩容 cells 数组
    for (;;) {
        Cell[] as;
        Cell a;
        int n;
        long v;
        
        if ((as = cells) != null && (n = as.length) > 0) {
            // cells 已存在，尝试找到/创建当前线程的 Cell
            
            int index = (n - 1) & h;  // 根据线程 hash 计算 Cell 索引
            
            if ((a = as[index]) == null) {
                // Cell 不存在，尝试创建
                if (cellsBusy == 0) {
                    Cell r = new Cell(x);
                    if (cellsBusy == 0 && casCellsBusy()) {
                        // 创建成功，退出
                    }
                }
            } else if (!wasUncontended) {
                // CAS 失败，说明有竞争，重试
                wasUncontended = true;
            } else if (a.cas(v = a.value, (fn == null) ? v + x : fn.applyAsLong(v, x))) {
                break;
            } else if (n >= NCPU) {
                // cells 数组已最大，不再扩容
            } else if (casCellsBusy()) {
                // 扩容 cells 数组为原来的 2 倍
                // ...
            }
        } else if (cellsBusy == 0 && cells == as && casCellsBusy()) {
            // 初始化 cells 数组
            // ...
        }
    }
}
```

### sum() 汇总

```java
public long sum() {
    Cell[] as = cells;
    long sum = base;  // 先加 base
    
    if (as != null) {
        // 遍历所有 Cell，求和
        for (Cell a : as) {
            if (a != null) {
                sum += a.value;
            }
        }
    }
    return sum;
}
```

**注意**：`sum()` 返回的是**近似值**，因为在求和过程中，其他线程可能还在修改 Cell。这是「最终一致」的设计。

---

## 性能对比

### 测试代码

```java
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.LongAdder;
import java.util.concurrent.CountDownLatch;

public class PerformanceComparison {
    private static final int THREAD_COUNT = 100;
    private static final int INCREMENTS_PER_THREAD = 100000;
    
    public static void main(String[] args) throws InterruptedException {
        // AtomicLong 测试
        AtomicLong atomicLong = new AtomicLong(0);
        CountDownLatch latch1 = new CountDownLatch(THREAD_COUNT);
        
        long start1 = System.nanoTime();
        for (int i = 0; i < THREAD_COUNT; i++) {
            new Thread(() -> {
                for (int j = 0; j < INCREMENTS_PER_THREAD; j++) {
                    atomicLong.incrementAndGet();
                }
                latch1.countDown();
            }).start();
        }
        latch1.await();
        long end1 = System.nanoTime();
        
        // LongAdder 测试
        LongAdder longAdder = new LongAdder();
        CountDownLatch latch2 = new CountDownLatch(THREAD_COUNT);
        
        long start2 = System.nanoTime();
        for (int i = 0; i < THREAD_COUNT; i++) {
            new Thread(() -> {
                for (int j = 0; j < INCREMENTS_PER_THREAD; j++) {
                    longAdder.increment();
                }
                latch2.countDown();
            }).start();
        }
        latch2.await();
        long end2 = System.nanoTime();
        
        System.out.println("AtomicLong: " + atomicLong.get() + 
                           ", 耗时: " + (end1 - start1) / 1_000_000 + " ms");
        System.out.println("LongAdder: " + longAdder.sum() + 
                           ", 耗时: " + (end2 - start2) / 1_000_000 + " ms");
    }
}
```

### 典型结果

```
测试环境：4 核 CPU，100 线程，每线程 10 万次递增

AtomicLong: 10000000, 耗时: 1234 ms
LongAdder:  10000000, 耗时:  456 ms

LongAdder 性能是 AtomicLong 的 2-3 倍！
```

---

## 详细对比

| 特性 | AtomicLong | LongAdder |
|-----|------------|-----------|
| 原理 | CAS 单一变量 | CAS + Cell 数组分散 |
| 线程竞争 | 高竞争时性能下降 | 低竞争 ≈ AtomicLong，高竞争性能好 |
| 内存 | 1 个变量 | Cell 数组 + base（更占用内存） |
| 结果一致性 | 强一致 | 最终一致（sum() 可能不是最新值） |
| `sum()` 性能 | O(1) | O(n)，n = Cell 数组长度 |
| 适用场景 | 低并发、需强一致性 | 高并发、允许最终一致 |

---

## LongAdder 的坑

### 坑一：sum() 不是原子快照

```java
LongAdder adder = new LongAdder();

// 线程 A 在累加
new Thread(() -> {
    for (int i = 0; i < 1000000; i++) {
        adder.increment();
    }
}).start();

// 线程 B 在求和
// 注意：求和过程中，线程 A 可能还在修改！
long sum = adder.sum();  // 可能不是精确值
```

### 坑二：reset() 不安全

```java
LongAdder adder = new LongAdder();
adder.increment();
adder.increment();

// reset() 会重置 base，但 Cell[] 数组不变
// 其他线程可能还在往 Cell 里写！
adder.reset();  // ⚠️ 有并发风险
```

**正确做法**：如果需要重置，创建新的 LongAdder。

### 坑三：数组会不断扩容

```java
// LongAdder 内部 Cell 数组最多扩展到 CPU 核心数
// 每个 Cell 用 @Contended 注解避免伪共享
// 但 Cell 数组不会缩小
```

---

## 适用场景

### 适合用 LongAdder

```java
// 场景 1：统计计数（允许最终一致）
LongAdder requestCount = new LongAdder();
LongAdder errorCount = new LongAdder();

// 场景 2：性能监控
LongAdder totalLatency = new LongAdder();
LongAdder maxLatency = new LongAdder();  // max 用 LongAdder 不太合适
```

### 不适合用 LongAdder

```java
// 场景 1：需要强一致的结果
if (adder.sum() == targetCount) {  // ⚠️ 可能不准
    // 不适合
}

// 场景 2：求最大值
LongAdder 不适合！应该用 AtomicLong 或其他方式

// 场景 3：限流判断
if (adder.sum() >= maxQps) {  // ⚠️ 可能超限
    // 不适合
}
```

---

## 面试实战

**面试官问**：「LongAdder 怎么比 AtomicLong 性能好？」

**标准回答**：
> LongAdder 通过分散竞争来提升性能。它维护了一个 Cell 数组，每个线程累加时，实际上是累加到自己对应的 Cell 上，而不是一个公共变量。只有在 `sum()` 时才把所有 Cell 的值加起来。
>
> 这样，高并发下，不同线程累加到不同的 Cell，避免了 CAS 竞争。

**追问**：「LongAdder 有坑吗？」

**深入回答**：
> 有两个主要坑：
>
> **第一，`sum()` 不是原子快照**。在 `sum()` 求和的过程中，其他线程可能还在修改 Cell，所以 `sum()` 返回的是近似值，不是精确值。
>
> **第二，不适合需要强一致性的场景**。比如限流判断，用 `LongAdder.sum() >= limit` 是不安全的，可能超限。
>
> 所以 LongAdder 只适合「高并发 + 允许最终一致」的统计类场景。

---

## 总结

```
┌─────────────────────────────────────────────────────────────┐
│              LongAdder vs AtomicLong 选择指南                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  使用 LongAdder：                                            │
│    ✅ 高并发计数器（> 10 线程）                               │
│    ✅ 统计类应用（PV、UV、访问计数）                          │
│    ✅ 允许最终一致                                            │
│                                                             │
│  使用 AtomicLong：                                          │
│    ✅ 低并发场景                                             │
│    ✅ 需要强一致性                                            │
│    ✅ 需要获取准确即时值                                      │
│    ✅ 内存敏感                                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 留给你的思考题

假设你需要实现一个「滑动窗口限流器」，要求：

```java
// 1. 统计最近 1 秒内的请求数
// 2. 如果超过 100，返回限流
// 3. 需要准确的即时值

// LongAdder 适合吗？为什么？
// 如果不适合，应该怎么实现？
```

（提示：滑动窗口需要准确计数，而 LongAdder 的 sum() 不是精确快照）
