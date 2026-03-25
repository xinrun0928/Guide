# ConcurrentHashMap size() 方法演进

你用过 `ConcurrentHashMap` 吗？试过 `size()` 方法吗？

面试官问："ConcurrentHashMap 的 size() 是怎么实现的？"

你说："就是遍历计数啊。"

面试官追问："JDK 7 和 JDK 8 的实现有什么区别？"

你愣住了...

今天，我们来彻底搞清楚 size() 的演进历程。

## JDK 7：先乐观后悲观

JDK 7 的 ConcurrentHashMap 有 Segment[]，size() 分两步：

### 第一步：乐观模式（不加锁）

```java
public int size() {
    final Segment<K,V>[] segments = this.segments;
    long sum = 0;
    int check = 0;
    
    // 先尝试 2 次不加锁统计
    for (int i = 0; i < RETRIES_BEFORE_LOCK; ++i) {
        check = 0;
        sum = 0;
        for (Segment<K,V> seg : segments) {
            seg.begin();  // 读取 modCount
            if (seg.count != 0) {
                check++;
            }
            sum += seg.count;
            seg.end();
        }
        
        // 如果 check 等于 Segment 数量，说明没有并发修改
        if (check == segments.length) {
            return (int) sum;
        }
    }
    
    // 第二步：悲观模式（加锁）
    for (Segment<K,V> seg : segments) {
        seg.lock();
    }
    // ...
}
```

`begin()` 和 `end()` 做什么？

```java
// Segment.begin()
void begin() {
    updatedCount = modCount;  // 记录当前 modCount
}

// Segment.end()
void end() {
    if (updatedCount != modCount) {
        // 并发修改发生，需要重试
        retry = true;
    }
}
```

### 原理

1. 第一次遍历：记录每个 Segment 的 `modCount` 和 `count`
2. 第二次遍历：再次读取 `modCount`，如果和第一次相同，说明没有并发修改，可以信任 `count`
3. 如果不一致（有并发 put/remove），重新尝试
4. 多次尝试后仍不一致，加锁统计

### 缺点

- **有锁开销**：最终还是要加锁
- **可能不准确**：并发度极高时，可能多次重试
- **Segment 粒度太粗**：如果一个 Segment 热点，会成为瓶颈

## JDK 8：CounterCell 二级结构

JDK 8 彻底抛弃了 Segment，用 `CounterCell[]` 分散计数：

```java
public class ConcurrentHashMap<K,V> {
    
    // 基础计数（主要贡献者）
    private transient volatile long baseCount;
    
    // CounterCell[]：分散的计数单元
    private transient volatile CounterCell[] counterCells;
    
    // CounterCell：每个线程的计数
    @sun.misc.Contended
    static final class CounterCell {
        volatile long value;
        CounterCell(long x) { value = x; }
    }
}
```

### addCount()：更新计数

```java
private final void addCount(long x, int check) {
    CounterCell[] as;
    long b, s;
    
    // 如果 counterCells 还没初始化，或者 CAS 更新 baseCount 失败
    if ((as = counterCells) != null ||
        !U.compareAndSwapLong(this, BASECOUNT, b = baseCount, s = b + x)) {
        CounterCell a;
        long v;
        int m;
        boolean uncontended = true;
        
        // 尝试更新 CounterCell
        if (as == null || (m = as.length - 1) < 0 ||
            (a = as[ThreadLocalRandom.getProbe() & m]) == null ||
            !(uncontended = U.compareAndSwapLong(a, CELLVALUE, v = a.value, v + x))) {
            // 兜底：直接累加到 baseCount
            fullAddCount(x, uncontended);
            return;
        }
        if (check <= 1)
            return;
        s = sumCount();
    }
    
    // 检查是否需要扩容
    if (check >= 0) {
        CounterCell[] as;
        long sc;
        while (s >= (long)(sc = sizeCtl) && (as = counterCells) != null) {
            if (as != null) {
                int n = as.length;
                if (n < MAX_ARRAY_SIZE)
                    tryAdvance...
            }
        }
    }
}
```

流程：

1. **优先更新 baseCount**：用 CAS 更新 `baseCount`，如果成功，说明没有竞争
2. **竞争时用 CounterCell**：如果 baseCount CAS 失败（多个线程同时更新），用 `CounterCell[]` 分散计数
3. **每个线程有独立的 CounterCell**：通过 `ThreadLocalRandom.getProbe()` 分配

### sumCount()：汇总计数

```java
final long sumCount() {
    CounterCell[] as = counterCells;
    long sum = baseCount;
    if (as != null) {
        for (CounterCell a : as) {
            sum += a.value;  // 累加每个 CounterCell 的值
        }
    }
    return sum;
}
```

遍历 `counterCells[]`，累加所有 CounterCell 的值，再加上 `baseCount`。

### 为什么用二级结构？

考虑并发场景：

```
线程1: baseCount += 1      ✓ CAS 成功
线程2: baseCount += 1      ✗ CAS 失败（被线程1改了）
线程3: baseCount += 1      ✗ CAS 失败
...
```

如果每次 put 都要 CAS 竞争 `baseCount`，性能会很差。

CounterCell[] 让每个线程更新自己的 CounterCell，减少竞争：

```
线程1: counterCells[3] += 1    ✓ CAS 成功（cell 3）
线程2: counterCells[7] += 1    ✓ CAS 成功（cell 7）
线程3: counterCells[3] += 1    ✗ CAS 失败（被线程1改了）
                                 换个 cell 重试...
```

### @sun.misc.Contended

```java
@sun.misc.Contended
static final class CounterCell {
    volatile long value;
}
```

这个注解是**伪共享**保护。

CPU 缓存行是 64 字节，如果两个 CounterCell 恰好在同一个缓存行，修改一个会影响另一个的性能。

`@Contended` 在每个 CounterCell 前后填充，让它们在不同的缓存行。

## size() vs mappingCount()

```java
public int size() {
    return sumCount();
}

public long mappingCount() {
    return sumCount();
}
```

JDK 8 新增 `mappingCount()` 方法，返回 `long` 类型，避免 `int` 溢出。

如果元素数量超过 `Integer.MAX_VALUE`（约 21 亿），用 `size()` 会溢出返回负数，用 `mappingCount()` 更安全。

## 面试追问

### Q1: size() 是强一致性的吗？

**不是**。ConcurrentHashMap 的 size() 是**弱一致性**的。

因为 `baseCount + counterCells` 的累加过程没有加锁，所以可能在遍历过程中有其他线程修改。

返回的 size() 是一个**近似值**，不是精确值。

如果需要精确计数，需要加全局锁。

### Q2: 什么时候初始化 counterCells？

懒初始化。当 `baseCount` CAS 失败达到一定次数后，会调用 `fullAddCount()` 初始化 `counterCells[]`。

```java
private final void fullAddCount(long x, boolean wasUncontended) {
    int h;
    if ((h = ThreadLocalRandom.getProbe()) == 0) {
        ThreadLocalRandom.localInit();
        h = ThreadLocalRandom.getProbe();
    }
    
    boolean collide = false;
    for (;;) {
        CounterCell[] as;
        CounterCell a;
        int n;
        long v;
        
        if ((as = counterCells) != null && (n = as.length) > 0) {
            // 尝试更新现有 CounterCell
        }
        else if (counterCells == as && casCellsBusy()) {
            // 初始化 counterCells
            CounterCell[] rs = new CounterCell[n = NCPU > 1 ? (n >>>= 1) : 4];
            // ...
        }
        else {
            // 重试 baseCount
        }
    }
}
```

### Q3: CounterCell[] 的大小是多少？

初始时为 null，在 `fullAddCount()` 中初始化。

大小和 CPU 核心数相关：`NCPU > 1 ? n >>> 1 : 4`。

例如 8 核 CPU，初始大小为 4。

---

## 留给你的思考题

JDK 8 的 `size()` 和 `mappingCount()` 都是弱一致的，那有没有办法获得强一致的大小？

提示：可以加锁后遍历，或者在所有操作上加全局锁。

但这会带来严重的性能问题，所以 ConcurrentHashMap 选择**弱一致性**来换取高性能。

思考：什么场景下需要强一致性？什么场景下弱一致性就够了？

理解这个问题，你就掌握了并发容器设计的核心权衡。
