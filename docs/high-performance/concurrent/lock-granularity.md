# 减少锁粒度：分段锁、分段 ConcurrentHashMap

一个经验法则：**锁的粒度越小，并发度越高**。

这句话听起来简单，但真正理解并实践的人不多。今天，我们从 ConcurrentHashMap 出发，深入理解分段锁的思想，以及如何在实际项目中应用。

## 为什么需要减少锁粒度？

来看一个经典的性能问题：

```java
public class SlowCounter {
    private long count = 0;

    public synchronized void increment() {
        count++;
    }

    public long getCount() {
        return count;
    }
}
```

`SlowCounter` 用了 `synchronized` 关键字，在高并发下所有线程排队等待。假设 QPS 是 10 万，线程竞争激烈的情况下，这个 `synchronized` 就是性能瓶颈。

你可能会说：「那用 AtomicLong 不就好了？」没错，但这只是第一步。真正的挑战在于：当你的数据结构更复杂时（比如一个 Map），该怎么办？

## 分段锁的思想

JDK 7 的 `ConcurrentHashMap` 采用了分段锁（Segment）技术。

它的核心思想是：**把一个大的 HashMap 分成若干个小的 HashMap，每个小 HashMap 独立加锁**。

```java
// JDK 7 ConcurrentHashMap 的结构
public class ConcurrentHashMap&lt;K, V&gt; {
    // 默认分成 16 段
    final Segment&lt;K, V&gt;[] segments;

    public V put(K key, V value) {
        // 计算 key 应该落在哪个段
        int hash = hash(key);
        int segmentIndex = (hash &gt;&gt;&gt; 28) % 16;
        // 只锁住这个段，不影响其他段的读写
        return segments[segmentIndex].put(key, hash, value);
    }
}
```

理论上，16 个段可以让并发度提升 16 倍。16 个线程可以同时操作 Map 而不冲突。

## JDK 8 的改进：CAS + synchronized

JDK 8 彻底抛弃了分段锁，改用了更轻量的方式：**CAS + synchronized**。

```java
// JDK 8 ConcurrentHashMap 的 put 过程
public V put(K key, V value) {
    // 1. 首次 put 时初始化数组
    if (tab == null || tab.length == 0) {
        tab = initTable();
    }

    // 2. 计算位置
    int hash = spread(key.hashCode());
    int index = (tab.length - 1) & hash;

    // 3. 用 CAS 尝试写入
    for (Node&lt;K, V&gt; node = tab[index]; node != null; ) {
        if (casTabAt(tab, index, null, new Node&lt;K,V&gt;(hash, key, value))) {
            return null;  // 成功
        }
    }

    // 4. CAS 失败，说明有竞争，用 synchronized 锁住头节点
    synchronized(node) {
        // 链表/红黑树操作
    }
}
```

为什么 JDK 8 放弃了分段锁？

1. **段数固定**：分段锁的段数在创建时就固定了，无法动态调整
2. **内存开销**：每个段都是独立的 ReentrantLock，有额外的对象开销
3. **热点段**：实际访问往往集中在某几个段，热点段依然会成为瓶颈

而 JDK 8 的方案更灵活：先用 CAS 试探，失败再用 synchronized，并且锁的粒度细化到单个 bucket。

## 分段锁的实战应用

理解了分段锁的思想，我们可以在自己的代码中应用。

### 场景一：分段写锁

假设有一个批量写入场景，多个线程需要同时写入不同的业务数据：

```java
public class SegmentLock&lt;T&gt; {
    private final Object[] locks;
    private final int segmentCount;

    public SegmentLock(int segmentCount) {
        this.segmentCount = segmentCount;
        this.locks = new Object[segmentCount];
        for (int i = 0; i &lt; segmentCount; i++) {
            locks[i] = new Object();
        }
    }

    private int getSegmentIndex(Object key) {
        return Math.abs(key.hashCode() % segmentCount);
    }

    public void doInLock(Object key, Runnable task) {
        int index = getSegmentIndex(key);
        synchronized (locks[index]) {
            task.run();
        }
    }
}

// 使用示例
SegmentLock&lt;String&gt; segmentLock = new SegmentLock&lt;&gt;(16);
segmentLock.doInLock(userId, () -&gt; {
    // 只锁住这个 userId 对应的段
    userService.process(userId);
});
```

### 场景二：分段计数器

对于热点 ID 的计数问题，可以用分段来分散热点：

```java
public class SegmentedCounter {
    private final AtomicLong[] counters;
    private final int segmentCount;

    public SegmentedCounter(int segmentCount) {
        this.segmentCount = segmentCount;
        this.counters = new AtomicLong[segmentCount];
        for (int i = 0; i &lt; segmentCount; i++) {
            counters[i] = new AtomicLong();
        }
    }

    public void increment(Object key) {
        int index = Math.abs(key.hashCode() % segmentCount);
        counters[index].incrementAndGet();
    }

    public long getCount(Object key) {
        int index = Math.abs(key.hashCode() % segmentCount);
        return counters[index].get();
    }

    public long getTotalCount() {
        return Arrays.stream(counters).mapToLong(AtomicLong::get).sum();
    }
}
```

这样，即使有热点 key，也会被分散到不同的计数器，减少竞争。

### 场景三：ConcurrentHashMap 的进阶用法

JDK 8 的 `ConcurrentHashMap` 提供了更丰富的原子操作，可以直接使用：

```java
ConcurrentHashMap&lt;String, Long&gt; stats = new ConcurrentHashMap&lt;&gt;();

// 原子增加
stats.merge(userId, 1L, Long::sum);

// 原子更新
stats.computeIfPresent(userId, (k, v) -&gt; v + 1);

// 批量操作（原子性）
stats.putAll(Map.of("a", 1L, "b", 2L));
```

## 分段锁 vs 无锁

分段锁并不是终点。在某些场景下，我们可以完全抛弃锁，改用无锁数据结构：

```java
// 无锁计数器（基于 LongAdder）
public class LockFreeCounter {
    private final LongAdder counter = new LongAdder();

    public void increment() {
        counter.increment();  // 比 AtomicLong 高并发下性能更好
    }

    public long getCount() {
        return counter.sum();
    }
}
```

`LongAdder` 的原理是：把一个 value 拆成多个 cell，每个线程累加自己的 cell，最后求和时把 cell 加起来。这样在高并发下，多个线程可以真正并行操作，没有锁竞争。

## 分段数的选择

分段锁的分段数是个技术活：

- **太少**：锁竞争严重，并发度上不去
- **太多**：内存开销大，而且如果 key 的分布不均匀，会产生「热点段」

一个经验值：
- 一般场景：16-32 段
- 高并发场景：64-128 段
- 内存敏感场景：8-16 段

但最关键的是：**根据 key 的分布特点来选择分段策略**。如果 80% 的请求都集中在 20% 的 key 上，那分再多段也没用 —— 热点 key 永远会产生竞争。

## 总结

减少锁粒度的本质是**提高并行度**：

| 方案 | 并发度 | 内存开销 | 适用场景 |
|------|-------|---------|---------|
| synchronized | 1 | 低 | 低并发，简单场景 |
| 分段锁 | N（N 段数） | 中 | 中等并发，数据可分段 |
| CAS | 理论无限 | 低 | 简单操作，计数器等 |
| LongAdder | 理论无限 | 高 | 高并发计数器 |

选择哪种方案，取决于你的业务场景、数据特点和性能要求。

---

## 留给你的问题

假设你有 1000 个热点 key，它们占据了 90% 的访问量，你会怎么设计你的分段策略？

提示：考虑「分段数」和「分段策略」两个维度。
