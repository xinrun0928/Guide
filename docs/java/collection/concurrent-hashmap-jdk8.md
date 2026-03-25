# ConcurrentHashMap JDK 8+：CAS + synchronized

JDK 8 对 ConcurrentHashMap 做了彻底重构。

Segment 分段锁被抛弃，取而代之的是**CAS + synchronized**的组合。

这个改动解决了什么问题？又带来了什么新特性？

## JDK 8 的新结构

```java
public class ConcurrentHashMap<K,V> extends AbstractMap<K,V>
        implements ConcurrentMap<K,V>, Serializable {
    
    // Node 数组，类似 HashMap 的 table
    transient volatile Node<K,V>[] table;
    
    // CounterCell[]，用于并发计数
    private transient volatile CounterCell[] counterCells;
    
    // baseCount，基础计数
    private transient volatile long baseCount;
    
    // Node：基本节点
    static class Node<K,V> implements Map.Entry<K,V> {
        final int hash;
        final K key;
        volatile V value;
        volatile Node<K,V> next;
    }
    
    // ForwardingNode：扩容时的转发节点
    static class ForwardingNode<K,V> extends Node<K,V> {
        final Node<K,V>[] nextTable;
    }
    
    // TreeBin：红黑树的根节点
    static final class TreeBin<K,V> extends Node<K,V> {
        private TreeNode<K,V> root;
        private volatile TreeNode<K,V> first;
        private volatile Thread waiter;
        private volatile int lockState;
    }
}
```

关键变化：**不再有 Segment 数组**，直接用 Node 数组 + CAS + synchronized。

## 并发控制的核心

### 1. CAS 初始化 table

```java
private final Node<K,V>[] initTable() {
    Node<K,V>[] tab;
    int sc;
    while ((tab = table) == null || tab.length == 0) {
        // sizeCtl 是控制变量
        if ((sc = sizeCtl) < 0)
            Thread.yield();  // 让出 CPU
        
        // CAS 设置 sizeCtl = -1，表示正在初始化
        else if (U.compareAndSwapInt(this, SIZECTL, sc, -1)) {
            try {
                if ((tab = table) == null || tab.length == 0) {
                    int n = (sc > 0) ? sc : DEFAULT_CAPACITY;
                    @SuppressWarnings("rawtypes")
                    Node<K,V>[] nt = (Node<K,V>[]) new Node<?,?>[n];
                    table = tab = nt;
                    sc = n - (n >>> 2);
                }
            } finally {
                sizeCtl = sc;
            }
            break;
        }
    }
    return tab;
}
```

只有**一个线程能成功初始化** table，其他线程自旋等待。

### 2. synchronized 锁头节点

JDK 8 最大的变化：**锁粒度细化到每个桶（头节点）**。

```java
final V putVal(K key, V value, boolean onlyIfAbsent) {
    if (key == null || value == null) throw new NullPointerException();
    
    int hash = spread(key.hashCode());
    int binCount = 0;
    
    for (Node<K,V>[] tab = table;;) {
        Node<K,V> f;
        int n, i, fh;
        
        // 初始化 table
        if (tab == null || (n = tab.length) == 0)
            tab = initTable();
        
        // 该位置为空，CAS 插入
        else if ((f = tabAt(tab, i = (n - 1) & hash)) == null) {
            if (casTabAt(tab, i, null, new Node<K,V>(hash, key, value, null)))
                break;
        }
        
        // 发现正在扩容，帮助扩容
        else if ((fh = f.hash) == MOVED)
            tab = helpTransfer(tab, f);
        
        // 锁住头节点，插入或更新
        else {
            V oldVal = null;
            synchronized (f) {  // 只锁头节点
                if (tabAt(tab, i) == f) {
                    if (fh >= 0) {  // 普通链表
                        binCount = 1;
                        for (Node<K,V> e = f;; ++binCount) {
                            if (e.hash == hash &&
                                ((k = e.key) == key || key.equals(k))) {
                                oldVal = e.value;
                                if (!onlyIfAbsent)
                                    e.value = value;
                                break;
                            }
                            Node<K,V> pred = e;
                            if ((e = e.next) == null) {
                                pred.next = new Node<K,V>(hash, key, value, null);
                                break;
                            }
                        }
                    }
                    else if (f instanceof TreeBin) {  // 红黑树
                        Node<K,V> p = ((TreeBin<K,V>) f).putTreeVal(hash, key, value);
                        oldVal = p.value;
                    }
                }
            }
            
            if (binCount != 0) {
                if (binCount >= TREEIFY_THRESHOLD)
                    treeifyBin(tab, i);
                if (oldVal != null)
                    return oldVal;
                break;
            }
        }
    }
    addCount(1L, binCount);
    return null;
}
```

关键点：

1. **CAS 插入**：如果桶为空，用 CAS 尝试插入
2. **synchronized 锁头节点**：如果桶有值，锁住头节点再操作
3. **锁粒度是桶**：不同桶的线程互不影响

## 红黑树的支持

JDK 8 的 ConcurrentHashMap 也支持红黑树，和 HashMap 类似：

```java
// 树化条件
static final int TREEIFY_THRESHOLD = 8;
static final int MIN_TREEIFY_CAPACITY = 64;
static final int UNTREEIFY_THRESHOLD = 6;
```

但有一个关键区别：**TreeBin 用自己的锁机制**。

```java
static final class TreeBin<K,V> extends Node<K,V> {
    private final ReentrantLock lock = new ReentrantLock();
    private TreeNode<K,V> root;
    private volatile TreeNode<K,V> first;
    
    // 树操作需要获取锁
    final TreeNode<K,V> putTreeVal(...) {
        lock.lock();
        try {
            // 红黑树插入
        } finally {
            lock.unlock();
        }
    }
}
```

TreeBin 维护红黑树的同时，还维护一个链表（`first`），用于遍历。

## 扩容机制

JDK 8 改进了扩容机制，支持**多线程并发扩容**：

```java
final Node<K,V>[] helpTransfer(Node<K,V>[] tab, Node<K,V> f) {
    Node<K,V>[] nextTab;
    int sc;
    
    if (tab != null && f instanceof ForwardingNode &&
        (nextTab = ((ForwardingNode<K,V>)f).nextTable) != null) {
        // 发现其他线程正在扩容，帮助它
        transfer(tab, nextTab);
    }
    return nextTab;
}
```

`ForwardingNode` 是一个特殊节点，表示"这个桶已经迁移到 nextTable 了"。

多个线程可以同时参与扩容，通过 `transfer()` 方法协作。

## JDK 7 vs JDK 8

| 特性 | JDK 7 | JDK 8 |
|-----|-------|-------|
| 结构 | Segment[] + HashEntry[] | Node[] |
| 锁粒度 | Segment（固定） | Node（桶，可扩展） |
| 并发控制 | ReentrantLock | CAS + synchronized |
| 红黑树 | 不支持 | 支持 |
| 扩容 | 单线程 | 多线程协作 |
| size() | 先无锁后加锁 | CounterCell 计数 |

## 为什么 JDK 8 放弃了 Segment？

### 1. 锁粒度更细

JDK 7 的 Segment 数量固定（默认 16），即使元素都集中在一个 Segment，其他 Segment 也是空转。

JDK 8 锁粒度细化到桶，并发度更高。

### 2. 内存占用更低

JDK 7 需要额外的 Segment 数组，JDK 8 只有一个 Node 数组。

### 3. 支持红黑树

JDK 7 不支持红黑树，高并发下链表过长会退化。

JDK 8 借鉴了 HashMap 的优化。

## 面试追问

### Q1: synchronized 锁住的是对象还是类？

在 ConcurrentHashMap 中，`synchronized (f)` 锁住的是**头节点对象**。

这意味着：访问同一个桶的线程会互斥，但访问不同桶的线程可以并发。

### Q2: CAS 和 synchronized 怎么配合使用？

```java
// 桶为空，用 CAS
if ((f = tabAt(tab, i)) == null) {
    if (casTabAt(tab, i, null, newNode))
        break;  // 成功
    // 失败，说明有竞争，继续循环
}

// 桶有值，用 synchronized
else {
    synchronized (f) {
        // 链表/红黑树操作
    }
}
```

CAS 用于快速路径（桶为空），synchronized 用于慢速路径（桶有冲突）。

### Q3: 为什么 TreeBin 需要自己的锁？

因为红黑树的插入/删除需要更复杂的并发控制。

TreeBin 用 `ReentrantLock` 保护红黑树，同时维护链表用于遍历。

---

## 留给你的思考题

JDK 8 的 ConcurrentHashMap 在并发度高时，多个线程同时操作同一个桶会发生什么？

提示：synchronized 保证了互斥，但有没有可能出现**死锁**？

实际上不会，因为 ConcurrentHashMap 的操作都是**同层级**的（都在同一个桶上），不会形成循环等待。

但如果一个操作需要同时操作多个桶（如 `putAll()`），会怎么处理？

这涉及到更大的并发控制问题，值得深入思考。
