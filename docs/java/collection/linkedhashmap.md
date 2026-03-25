# LinkedHashMap 与 LRU 缓存实现

你有没有想过：HashMap 的遍历顺序是什么样的？

如果你用过 `LinkedHashMap`，会发现它可以**保持插入顺序**，甚至可以做到**访问顺序**（LRU）。

这个"链表 + 哈希表"的组合，是怎么实现的？

## LinkedHashMap 的秘密

`LinkedHashMap` 继承自 `HashMap`，但它比 HashMap 多维护了一条双向链表。

```java
public class LinkedHashMap<K,V> extends HashMap<K,V> {
    
    // 头尾节点，追踪链表
    transient LinkedHashMap.Entry<K,V> head;
    transient LinkedHashMap.Entry<K,V> tail;
    
    // true = 访问顺序，false = 插入顺序（默认）
    final boolean accessOrder;
    
    // 每个节点多了 before 和 after 指针
    static class Entry<K,V> extends HashMap.Node<K,V> {
        Entry<K,V> before, after;
    }
}
```

关键点：**每个 Entry 有 before 和 after 指针，维护插入顺序或访问顺序的双向链表**。

## 覆盖 newNode() 注入链表维护逻辑

`LinkedHashMap` 覆盖了 `HashMap` 的 `newNode()` 方法：

```java
Node<K,V> newNode(int hash, K key, V value, Node<K,V> e) {
    LinkedHashMap.Entry<K,V> p =
        new LinkedHashMap.Entry<>(hash, key, value, e);
    linkNodeLast(p);  // 把新节点加到链表尾部
    return p;
}

private void linkNodeLast(LinkedHashMap.Entry<K,V> p) {
    LinkedHashMap.Entry<K,V> last = tail;
    tail = p;
    if (last == null)
        head = p;
    else {
        p.before = last;
        last.after = p;
    }
}
```

每次插入新节点，都把它加到链表尾部。遍历时从 head 开始，就能按插入顺序访问了。

## accessOrder：插入顺序 vs 访问顺序

```java
// 插入顺序（默认）
Map<String, String> map = new LinkedHashMap<>();
map.put("a", "1");
map.put("b", "2");
map.put("c", "3");
// 遍历顺序: a -> b -> c

// 访问顺序
Map<String, String> map = new LinkedHashMap<>(16, 0.75f, true);
map.put("a", "1");
map.put("b", "2");
map.put("c", "3");
map.get("a");  // 访问 "a"
map.get("b");  // 访问 "b"
// 遍历顺序: c -> a -> b (c 是最近访问的，在链表头部)
```

`accessOrder = true` 时，每次 `get()` 也会把被访问的节点移到链表尾部——这就是**LRU 的核心**。

覆盖 `afterNodeAccess()` 方法实现这个逻辑：

```java
void afterNodeAccess(Node<K,V> e) {
    LinkedHashMap.Entry<K,V> last;
    if (accessOrder && (last = tail) != e) {
        // 把节点移到链表尾部
        LinkedHashMap.Entry<K,V> p =
            (LinkedHashMap.Entry<K,V>)e,
            b = p.before, a = p.after;
        p.after = null;
        if (b == null)
            head = a;
        else
            b.after = a;
        if (a != null)
            a.before = b;
        last.after = p;
        p.before = last;
        tail = p;
    }
}
```

## LRU 缓存实现

`LinkedHashMap` 自带 `removeEldestEntry()` 方法，可以实现 LRU 缓存：

```java
public class LRUCache<K, V> extends LinkedHashMap<K, V> {
    
    private final int capacity;
    
    public LRUCache(int capacity) {
        // accessOrder = true: 访问顺序
        super(capacity, 0.75f, true);
        this.capacity = capacity;
    }
    
    // 每次插入时调用，返回 true 表示要删除最老的节点
    @Override
    protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
        return size() > capacity;
    }
}
```

使用示例：

```java
LRUCache<String, Integer> cache = new LRUCache<>(3);
cache.put("a", 1);
cache.put("b", 2);
cache.put("c", 3);
System.out.println(cache.keySet());  // [a, b, c]

cache.put("d", 4);  // 超出容量，删除 "a"
System.out.println(cache.keySet());  // [b, c, d]

cache.get("b");      // 访问 "b"，移到尾部
cache.put("e", 5);   // 删除最老的 "c"
System.out.println(cache.keySet());  // [b, d, e]
```

## 完整的 LRU 实现（线程安全版）

如果要用于并发场景，需要加上读写锁：

```java
import java.util.*;
import java.util.concurrent.locks.ReadWriteLock;
import java.util.concurrent.locks.ReentrantReadWriteLock;

public class ThreadSafeLRUCache<K, V> {
    
    private final int capacity;
    private final LinkedHashMap<K, V> cache;
    private final ReadWriteLock lock = new ReentrantReadWriteLock();
    
    public ThreadSafeLRUCache(int capacity) {
        this.capacity = capacity;
        // 容量+1，因为 removeEldestEntry 在插入后判断
        this.cache = new LinkedHashMap<>(capacity + 1, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
                return size() > ThreadSafeLRUCache.this.capacity;
            }
        };
    }
    
    public V get(K key) {
        lock.readLock().lock();
        try {
            return cache.get(key);
        } finally {
            lock.readLock().unlock();
        }
    }
    
    public V put(K key, V value) {
        lock.writeLock().lock();
        try {
            cache.put(key, value);
            return value;
        } finally {
            lock.writeLock().unlock();
        }
    }
    
    public int size() {
        lock.readLock().lock();
        try {
            return cache.size();
        } finally {
            lock.readLock().unlock();
        }
    }
    
    public void clear() {
        lock.writeLock().lock();
        try {
            cache.clear();
        } finally {
            lock.writeLock().unlock();
        }
    }
}
```

## LinkedHashMap vs HashMap

| 特性 | HashMap | LinkedHashMap |
|-----|--------|--------------|
| 遍历顺序 | 不确定 | 可控（插入顺序或访问顺序） |
| 内存占用 | 较低 | 较高（多了 before/after 指针） |
| 插入性能 | 稍快 | 稍慢（多了链表维护） |
| 适用场景 | 通用 Map | 需要有序遍历、LRU 缓存 |

## 面试追问

### Q1: LinkedHashMap 的遍历是 O(n) 吗？

是的，遍历是 O(n)，其中 n 是元素数量。

因为遍历是从 head 开始，沿着 before/after 指针依次访问，每个节点只访问一次。

但注意：如果只看特定 key 的值，时间复杂度是 O(1)（因为底层是 HashMap）。

### Q2: LinkedHashMap 可以用来做爬虫的 URL 去重吗？

可以，但更推荐用 `HashSet` 或 `HashMap`：

1. **URL 去重只需要判断存在性**，不需要有序遍历
2. **HashSet 内存占用更小**（不需要维护链表）
3. **HashSet 查询更快**（只存 key，不需要存 value）

LinkedHashMap 更适合的场景：
- LRU 缓存
- 需要按插入顺序遍历
- 保持任务执行顺序

### Q3: removeEldestEntry() 什么时候被调用？

`removeEldestEntry()` 在每次 `put()` 或 `putAll()` 时被调用，在新节点插入后。

```java
// HashMap.putVal() 中
if (++size > threshold)
    resize();

afterNodeInsertion(evict);  // LinkedHashMap 覆盖了这个方法

// LinkedHashMap.afterNodeInsertion()
public void afterNodeInsertion(boolean evict) {
    LinkedHashMap.Entry<K,V> first;
    if (evict && (first = head) != null && removeEldest) {
        K key = first.key;
        removeNode(hash(key), key, null, false, false);
    }
}
```

---

## 留给你的思考题

JDK 中的 `java.util.LinkedHashSet` 底层是 `LinkedHashMap`，你能想到它的实现方式吗？

提示：`LinkedHashSet` 的所有操作（add/remove/contains）都是委托给 `LinkedHashMap` 完成的，只是 value 都用同一个空对象。

理解这个问题，你就掌握了 LinkedHashMap/LinedHashSet 的全部秘密。
