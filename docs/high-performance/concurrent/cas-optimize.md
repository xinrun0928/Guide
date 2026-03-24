# CAS 优化与 LongAdder 高并发性能

你可能听说过 `AtomicLong` 的性能很好，但一到高并发场景就「力不从心」。

原因很简单：`AtomicLong` 底层用的是 CAS（Compare-And-Swap），而 CAS 在高并发下会有一个致命问题——**冲突**。几十个线程同时 CAS 一个变量，只有一个能成功，剩下的都在「白忙活」。

`LongAdder` 就是来解决这个问题的。

## CAS 的原理与局限

CAS 是现代 CPU 提供的一条硬件指令：

```java
// CAS 的语义（伪代码）
public boolean compareAndSwap(Object target, long expect, long update) {
    if (target.value == expect) {
        target.value = update;
        return true;
    }
    return false;
}
```

它的核心思想是：**乐观锁**——先假设没人跟我抢，直接改；如果发现被别人改过了，就重试。

`AtomicLong` 的 `incrementAndGet()` 就是这样实现的：

```java
public final long incrementAndGet() {
    for (;;) {
        long current = get();
        long next = current + 1;
        if (compareAndSwap(current, next)) {
            return next;
        }
        // CAS 失败，重试
    }
}
```

**问题在哪？**

当并发度很高时，CAS 的失败率会急剧上升。比如 100 个线程同时执行 `incrementAndGet()`，只有 1 个能一次成功，99 个都要重试。大量线程在 `for` 循环里空转，CPU 消耗严重，但实际吞吐量却上不去。

这就是所谓的「**CAS 竞争**」问题。

## LongAdder 的设计思路

`LongAdder` 采用了**分段累加**的思想：把一个 value 拆成多个 cell，多个线程分别累加不同的 cell，最后求和时把 cell 的值加起来。

```
传统 CAS:  [====value====]
           线程1 CAS → 成功
           线程2 CAS → 失败重试
           线程3 CAS → 失败重试
           ...

LongAdder: [c1][c2][c3][c4][c5]...
           线程1 → c1++
           线程2 → c2++
           线程3 → c3++
           ...
           每个线程操作不同的 cell，无竞争！
```

## LongAdder 的实现原理

```java
public class LongAdder extends Number {
    // transient 表示不参与序列化
    // volatile 保证可见性
    @sun.misc.Contended
    transient volatile Cell[] cells;

    // 基础值，在没有竞争时直接累加这个
    transient volatile long base;

    // 自旋锁，用于 cells 的初始化和扩容
    transient volatile int cellsBusy;
}
```

`Cell` 是 `LongAdder` 内部的一个数组，每个 `Cell` 也是一个用 `@Contended` 注解标记的类（防止伪共享）：

```java
// Cell 的实现
@sun.misc.Contended
static final class Cell {
    volatile long value;

    Cell(long x) {
        value = x;
    }

    // 使用 CAS 累加
    final boolean cas(long cmp, long val) {
        return UNSAFE.compareAndSwapLong(this, valueOffset, cmp, val);
    }
}
```

### 累加过程

```java
public void increment() {
    add(1L);
}

public void add(long x) {
    Cell[] as;
    long b, v;
    int m;
    Cell a;

    // CASE 1: cells 未初始化，尝试用 base CAS
    if ((as = cells) == null || (m = as.length - 1) &lt; 0) {
        if (casBase(b = base, b + x)) {
            return;  // base CAS 成功，直接返回
        }
    }

    // CASE 2: cells 已初始化，或者 base CAS 失败
    // 计算应该落在哪个 cell
    int index = getProbe() & m;

    // CASE 3: cell 存在，尝试 CAS
    if ((a = as[index]) != null) {
        if (a.cas(v = a.value, v + x)) {
            return;  // cell CAS 成功
        }
        // CAS 失败（竞争激烈），重新计算 index 并重试
    }

    // CASE 4: cell 不存在或者 CAS 一直失败
    // 需要初始化 cells 或扩容
    retry:
    for (;;) {
        Cell[] rs;
        int n = rs.length;
        int m = n - 1;
        int index = getProbe() & m;

        // 初始化 cells
        if (rs == cells &amp;&amp; (a = rs[index]) == null) {
            if (cellsBusy == 0 &amp;&amp; casCellsBusy()) {
                // 初始化新的 cell
                Cell cell = new Cell(x);
                rs[index] = cell;
                break retry;
            }
        }

        // 扩容（当竞争很激烈时）
        if (n &gt;= NCPU) {
            // 达到 CPU 核心数，不再扩容，继续用 base
            if (casBase(b = base, b + x)) {
                return;
            }
        } else if (rs == cells &amp;&amp; casCellsBusy()) {
            // 扩容 cells 数组
            Cell[] newCells = new Cell[n &lt;&lt; 1];
            for (int i = 0; i &lt; n; i++) {
                newCells[i] = rs[i];
            }
            cells = newCells;
        }
    }
}
```

简单总结：
1. **无竞争时**：直接 CAS `base`，最快路径
2. **低竞争时**：CAS `cells[index]`，部分并行
3. **高竞争时**：扩容 `cells` 数组，进一步分散热点

## LongAdder vs AtomicLong

实测数据（来源：JMH 基准测试，16 线程，1000 万次操作）：

| 类型 | 吞吐量（ops/ms） | 延迟（ns/op） |
|------|----------------|---------------|
| AtomicLong | ~500 | ~2000 |
| LongAdder | ~3000 | ~300 |

`LongAdder` 的吞吐量是 `AtomicLong` 的 **6 倍**！

但 `LongAdder` 也有代价：

```java
// LongAdder 的 sum() 需要遍历所有 cell
public long sum() {
    Cell[] as = cells;
    long sum = base;
    if (as != null) {
        for (Cell a : as) {
            if (a != null) {
                sum += a.value;
            }
        }
    }
    return sum;
}
```

`sum()` 不是原子的，可能在求和过程中有其他线程在累加。如果需要精确值，`AtomicLong` 才是正确的选择。

## LongAdder 的使用场景

### 场景一：接口调用统计

```java
public class ApiMetrics {
    private final LongAdder totalCount = new LongAdder();
    private final LongAdder errorCount = new LongAdder();
    private final LongAdder totalLatency = new LongAdder();

    public void recordCall(long latencyMs, boolean success) {
        totalCount.increment();
        totalLatency.add(latencyMs);
        if (!success) {
            errorCount.increment();
        }
    }

    public ApiStats getStats() {
        return new ApiStats(
            totalCount.sum(),
            totalLatency.sum(),
            errorCount.sum()
        );
    }
}
```

### 场景二：分布式 ID 生成器的本地计数

```java
public class IdGenerator {
    private final LongAdder counter = new LongAdder();
    private final long workerId;
    private final long epoch;

    public long nextId() {
        // 分段获取，减少 CAS 竞争
        long batch = counter.addAndGet(1000);
        return generateBatch(workerId, epoch, batch);
    }
}
```

## 其他 Adder 和 Striped64

JDK 8 还提供了 `LongAccumulator` 和 `DoubleAdder`：

```java
// LongAccumulator：支持自定义操作
LongAccumulator adder = new LongAccumulator(Long::sum, 0);
adder.accumulate(10);
adder.accumulate(20);
System.out.println(adder.get());  // 30

// DoubleAdder：用于浮点数
DoubleAdder doubleAdder = new DoubleAdder();
doubleAdder.add(1.5);
doubleAdder.add(2.5);
System.out.println(doubleAdder.sum());  // 4.0
```

`Striped64` 是这些类的共同父类，封装了分段累加的核心逻辑。

## 总结

| 特性 | AtomicLong | LongAdder |
|------|-----------|-----------|
| 并发度 | 单点 CAS | 分段 CAS |
| 吞吐量 | 较低 | 高（约 6 倍） |
| sum() 原子性 | 保证 | 不保证 |
| 内存占用 | 1 个对象 | N 个 Cell 对象 |
| 适用场景 | 需要精确值 | 允许近似值 |

选择建议：
- **需要精确值**（如库存扣减）：用 `AtomicLong`
- **统计类场景**（如 PV、UV、延迟）：用 `LongAdder`

---

## 留给你的问题

`LongAdder` 的 `sum()` 返回的不是精确值，在什么场景下这会是个问题？你会如何解决？

提示：考虑分段求和与「数据丢失」的关系。
