# ConcurrentHashMap JDK 7：Segment 分段锁

说起并发容器，不得不提 `ConcurrentHashMap`。

JDK 7 和 JDK 8 的实现完全不同，面试时两个版本都会被问到。

今天，我们先聊 JDK 7 的分段锁设计。

## HashMap 为什么不是线程安全的？

回顾一下 HashMap 的问题：

1. **并发 put**：两个线程同时 put 新值，可能覆盖彼此的数据
2. **扩容死循环**：JDK 7 头插法 + 并发扩容 = 环形链表
3. **数据不一致**：遍历时修改，可能漏数据或死循环

解决方案是什么？加锁。但锁粒度太大（Hashtable）会严重影响性能。

于是 JDK 7 提出了**分段锁**的概念。

## Segment 分段锁设计

```java
public class ConcurrentHashMap<K, V> extends AbstractMap<K, V>
        implements ConcurrentMap<K, V>, Serializable {
    
    // Segment 数组，类似 HashMap 的桶
    final Segment<K, V>[] segments;
    
    // 每个 Segment 继承 ReentrantLock
    static final class Segment<K, V> extends ReentrantLock {
        transient volatile int count;        // 元素数量
        transient int modCount;             // 修改计数
        transient int threshold;             // 扩容阈值
        transient volatile HashEntry<K, V>[] table;  // 底层数组
    }
    
    // HashEntry 和 HashMap 类似
    static final class HashEntry<K, V> {
        final K key;
        final int hash;
        volatile V value;
        final HashEntry<K, V> next;
    }
}
```

结构图：

```
ConcurrentHashMap
├── Segment[0] ───> HashEntry[] (链表)
├── Segment[1] ───> HashEntry[] (链表)
├── Segment[2] ───> HashEntry[] (链表)
└── ...
```

## 并发度：Segment 数组长度

```java
// 默认并发度 16
static final int DEFAULT_CONCURRENCY_LEVEL = 16;

// 构造函数
public ConcurrentHashMap(int initialCapacity, float loadFactor, int concurrencyLevel) {
    // 计算 Segment 数组大小（必须是 2 的幂次）
    int sshift = 0;
    int ssize = 1;
    while (ssize < concurrencyLevel) {
        ++sshift;
        ssize <<= 1;
    }
    
    this.segmentShift = 32 - sshift;
    this.segmentMask = ssize - 1;
    this.segments = Segment.newArray(ssize);
}
```

**并发度 = Segment 数组长度**，意味着最多同时有 16 个线程并发写入（每个线程占一个 Segment）。

## put() 流程

```java
public V put(K key, V value) {
    int hash = hash(key);
    // 定位 Segment
    Segment<K,V> s = segmentFor(hash);
    // 在 Segment 上加锁
    s.lock();
    try {
        // 和 HashMap 类似，在 HashEntry 数组上操作
        HashEntry<K,V>[] tab = s.table;
        int index = (tab.length - 1) & hash;
        HashEntry<K,V> first = tab[index];
        
        // 遍历链表...
        for (HashEntry<K,V> e = first;;) {
            if (e != null) {
                if (e.hash == hash && key.equals(e.key)) {
                    V oldValue = e.value;
                    e.value = value;
                    return oldValue;
                }
                e = e.next;
            } else {
                // 插入新节点
                if (casTabAt(tab, index, first, new HashEntry<>(hash, key, value, first))) {
                    break;
                }
            }
        }
    } finally {
        s.unlock();
    }
}
```

关键：**只锁住一个 Segment，不影响其他 Segment 的并发访问**。

## get() 不需要锁

```java
public V get(Object key) {
    int hash = hash(key);
    Segment<K,V> s = segmentFor(hash);
    
    HashEntry<K,V>[] tab;
    // 不需要加锁，直接读
    return (s != null ?
        scanAndLockForGet(s, key) :
        null);
}

// scanAndLockForGet 尝试快速获取
private V scanAndLockForGet(Segment<K,V> s, Object key) {
    HashEntry<K,V> e = s.table[(s.table.length - 1) & hash(key)];
    while (e != null) {
        if (e.hash == hash && key.equals(e.key)) {
            // 找到了，返回
            return e.value;
        }
        e = e.next;
    }
    // 没找到，加锁（悲观锁）
    s.lock();
    // ...
}
```

为什么 get 不需要加锁？因为 `value` 用 `volatile` 修饰：

```java
volatile V value;
```

volatile 保证**可见性**——所有线程都能看到最新的值。

## size() 的巧妙实现

size() 需要统计所有 Segment 的 count，如果每个都加锁，成本很高。

JDK 7 的优化：**先乐观地不加锁统计 3 次**，如果结果一致，就直接返回。

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
            // 读取 modCount
            seg.begin();
            if (seg.count != 0) {
                check++;
            }
            sum += seg.count;
            seg.end();
        }
        // 如果 check 和上次一样，说明没有并发修改
        if (check == segments.length) {
            return (int) sum;
        }
    }
    
    // 不一致，加锁统计
    for (Segment<K,V> seg : segments) {
        seg.lock();
    }
    // ...
    finally {
        for (Segment<K,V> seg : segments) {
            seg.unlock();
        }
    }
}
```

## JDK 7 分段锁的缺点

### 1. 并发度固定

Segment 数组大小在构造时确定，**不能动态扩展**。

如果并发度不够高（Segment 数量太少），热点 Segment 会成为瓶颈。

### 2. 跨 Segment 查询无法优化

`containsValue()` 需要遍历所有 Segment，无法利用分段优势：

```java
public boolean containsValue(Object value) {
    for (Segment<K,V> seg : segments) {
        // 每个 Segment 都要加锁
        seg.scanSearch(value);
    }
}
```

### 3. 定位过程多一次 hash

```
HashMap: key -> hash -> (n-1) & hash -> index
JDK 7:   key -> hash -> 定位 Segment -> (n-1) & hash -> index
```

## 面试追问

### Q1: JDK 7 ConcurrentHashMap 的锁粒度是什么？

**锁粒度是 Segment**，不是整个 Map，也不是每个桶。

每个 Segment 独立加锁，访问不同 Segment 的线程互不影响。

### Q2: 为什么 get 不需要加锁？

因为 `value` 是 volatile 变量，保证可见性。

同时 Segment 的 `count` 和 `table` 也是 volatile，读取 count 时可以看到 table 的最新状态。

### Q3: Segment 数量和并发度是什么关系？

并发度 = Segment 数组长度。

默认并发度 16，意味着最多 16 个线程可以同时写入（各自占一个 Segment）。

如果实际并发度更高，线程可能会竞争同一个 Segment 的锁。

---

## 留给你的思考题

JDK 7 的 ConcurrentHashMap 在扩容时，是单个 Segment 扩容还是整个 Map 扩容？

提示：每个 Segment 独立扩容，和 HashMap 类似。

但这带来一个问题：如果一个 Segment 扩容，其他 Segment 不受影响——这是优势还是劣势？

思考这个问题，你就会理解 JDK 8 为什么放弃了分段锁设计。
