# LinkedHashSet：有序去重与 LRU 缓存

你有没有遇到过这种需求：

需要一个 Set，既要去重，又要保持插入顺序。

HashSet 做不到（无序），TreeSet 只能排序（自然顺序）。

答案是 `LinkedHashSet`。

## LinkedHashSet 的本质

LinkedHashSet 继承自 HashSet，但内部使用的是 **LinkedHashMap**：

```java
public class LinkedHashSet<E> extends HashSet<E> implements Set<E> {
    
    public LinkedHashSet(int initialCapacity, float loadFactor) {
        super(initialCapacity, loadFactor, true);  // 第三个参数 true 表示 LinkedHashMap
    }
    
    public LinkedHashSet(int initialCapacity) {
        super(initialCapacity, .75f, true);
    }
    
    public LinkedHashSet() {
        super(16, .75f, true);
    }
    
    // 关键：调用 HashMap 的构造时传入 LinkedHashMap.class
}
```

### 继承关系

```
HashSet<E>
    └── LinkedHashSet<E>
            └── 使用 LinkedHashMap<E, Object>
                    └── 使用 LinkedHashMap.Node<E, Object>
                            └── 增加了 before 和 after 指针
```

## LinkedHashMap vs HashMap

LinkedHashMap 在 HashMap 的基础上，增加了**双向链表**来维护顺序：

```java
// LinkedHashMap 的 Node
static class Node<K, V> extends HashMap.Node<K, V> {
    Node<K, V> before;   // 前一个节点
    Node<K, V> after;     // 后一个节点
    
    Node(int hash, K key, V value, Node<K, V> next) {
        super(hash, key, value, next);
    }
}
```

```
┌─────────────────────────────────────────────────────────────────┐
│                    LinkedHashMap 结构                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   HashMap 部分（数组 + 链表/红黑树）                              │
│   ┌────┬────┬────┬────┬────┬────┬────┬────┐                     │
│   │    │Node│    │    │Node│    │    │    │                     │
│   │null│ →  │null│null│ →  │null│null│null│                     │
│   └────┴────┴────┴────┴────┴────┴────┴────┘                     │
│                                                                 │
│   双向链表部分（维护插入顺序）                                    │
│   null ← HEAD ←→ Node("A") ←→ Node("C") ←→ Node("B") ←→ TAIL → null
│              ↑___________________________↑                       │
│                      双向指针连接                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 插入顺序 vs 访问顺序

LinkedHashMap 有两种顺序模式：

```java
// 插入顺序（默认）
Map<String, Integer> map = new LinkedHashMap<>();
map.put("first", 1);
map.put("second", 2);
map.put("third", 3);
// 迭代顺序：first → second → third

// 访问顺序（LRU 模式）
Map<String, Integer> map = new LinkedHashMap<>(16, 0.75f, true);
map.put("first", 1);
map.put("second", 2);
map.put("third", 3);
map.get("first");  // 访问后，first 移到链表末尾
// 迭代顺序：second → third → first
```

关键参数：**accessOrder = true** 表示访问顺序模式。

```java
public class LinkedHashMap<K, V> extends HashMap<K, V> {
    
    // true = 访问顺序，false = 插入顺序（默认）
    final boolean accessOrder;
    
    public LinkedHashMap(int initialCapacity, float loadFactor, boolean accessOrder) {
        super(initialCapacity, loadFactor);
        this.accessOrder = accessOrder;
    }
}
```

## LRU 缓存实战

LRU（Least Recently Used）缓存是一种经典缓存策略：**最近使用的放头部，最久未使用的在尾部**。

```java
public class LRUCache<K, V> extends LinkedHashMap<K, V> {
    
    private final int capacity;
    
    public LRUCache(int capacity) {
        // initialCapacity=16, loadFactor=0.75, accessOrder=true
        super(capacity, 0.75f, true);
        this.capacity = capacity;
    }
    
    @Override
    protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
        // 当大小超过容量时，移除最老的元素
        return size() > capacity;
    }
    
    public static void main(String[] args) {
        LRUCache<String, Integer> cache = new LRUCache<>(3);
        
        cache.put("A", 1);
        cache.put("B", 2);
        cache.put("C", 3);
        System.out.println(cache);  // {A=1, B=2, C=3}
        
        cache.get("A");  // 访问 A
        cache.put("D", 4);  // 添加 D，移除 B（A 刚被访问过）
        System.out.println(cache);  // {A=1, C=3, D=4}
    }
}
```

### LRU 缓存的执行过程

```
初始状态：capacity = 3

1. put("A", 1)  →  {A=1}
2. put("B", 2)  →  {A=1, B=2}
3. put("C", 3)  →  {A=1, B=2, C=3}
   链表顺序：HEAD → A → B → C → TAIL

4. get("A")     →  访问 A，移动到末尾
   链表顺序：HEAD → B → C → A → TAIL

5. put("D", 4)  →  容量超限，移除最老的 B
   链表顺序：HEAD → C → A → D → TAIL
   结果：{C=3, A=1, D=4}
```

## LinkedHashSet 的实现

LinkedHashSet 的构造方法都调用了 HashSet 的这个包级私有的构造：

```java
// HashSet 源码（JDK 8）
HashSet(int initialCapacity, float loadFactor, boolean dummy) {
    map = new LinkedHashMap<>(initialCapacity, loadFactor);
}
// dummy 参数只是为了区分签名，没有实际用途
```

所以当你 `new LinkedHashSet<>()` 时，实际创建的是一个 LinkedHashMap。

## 性能对比

| 操作 | HashSet | LinkedHashSet | TreeSet |
|-----|---------|---------------|---------|
| add | O(1) | O(1) | O(log n) |
| contains | O(1) | O(1) | O(log n) |
| remove | O(1) | O(1) | O(log n) |
| 迭代 | 无序 | 插入顺序 | 有序 |
| 内存 | 较低 | 较高（+双向链表） | 较高（+红黑树） |

LinkedHashSet 比 HashSet 多维护一个双向链表，所以：
- 内存开销略高
- 插入略慢（需要维护链表）
- 但迭代是 O(1) 且保持顺序

## 使用场景

### 场景1：去重 + 保持插入顺序

```java
// 统计不重复的访问记录
Set<String> uniqueVisitors = new LinkedHashSet<>();
for (String visitor : visitors) {
    uniqueVisitors.add(visitor);
}
// 遍历时保持插入顺序
```

### 场景2：实现 LRU 缓存

```java
// 方法1：继承 LinkedHashMap
class LRUCache<K, V> extends LinkedHashMap<K, V> {
    private final int capacity;
    public LRUCache(int capacity) {
        super(16, 0.75f, true);
        this.capacity = capacity;
    }
    @Override
    protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
        return size() > capacity;
    }
}

// 方法2：组合模式（更推荐，解耦更清晰）
class LRUCache2<K, V> {
    private final int capacity;
    private final LinkedHashMap<K, V> map;
    
    public LRUCache2(int capacity) {
        this.capacity = capacity;
        // 匿名内部类实现 removeEldestEntry
        map = new LinkedHashMap<>(capacity, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
                return size() > LRUCache2.this.capacity;
            }
        };
    }
    
    public V get(K key) { return map.get(key); }
    public void put(K key, V value) { map.put(key, value); }
}
```

### 场景3：实现 FIFO 缓存

```java
// 先进先出缓存（最近最少使用的变体）
class FIFOCache<K, V> {
    private final int capacity;
    private final LinkedHashMap<K, V> map = 
        new LinkedHashMap<>(16, 0.75f, false) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
                return size() > FIFOCache.this.capacity;
            }
        };
    
    public V get(K key) { return map.get(key); }
    public void put(K key, V value) { map.put(key, value); }
}
```

## 线程安全问题

LinkedHashSet 和 HashSet 一样，都不是线程安全的。

```java
// 线程安全版本
Set<String> set = Collections.synchronizedSet(new LinkedHashSet<>());
```

注意：`Collections.synchronizedSet()` 包装后的 LinkedHashSet 可以保证线程安全，但迭代时仍需要手动同步。

## 面试追问方向

1. **LinkedHashMap 如何实现访问顺序？**

当 accessOrder=true 时，每次调用 get() 或 put() 都会调用 `afterNodeAccess()` 方法，将被访问的节点移动到链表末尾。put() 时如果覆盖了已有 key，也会触发移动。

2. **LinkedHashSet 和 HashSet 的性能差异是什么？**

LinkedHashSet 需要维护额外的双向链表，所以：
- 插入稍慢（需要更新链表指针）
- 内存开销稍大（每个节点多两个指针）
- 但迭代更快（直接遍历链表，不需要遍历桶）

3. **如何实现一个线程安全的 LRU 缓存？**

可以用 `ConcurrentHashMap` + `ConcurrentLinkedDeque` 组合，或者直接用 `java.util.concurrent` 包中的 `ConcurrentLinkedHashMap`（Guava 库也有 `CacheBuilder`）。

4. **LinkedHashMap 的 removeEldestEntry() 在什么时候被调用？**

在 `put()` 和 `putAll()` 方法中，每次添加新元素后检查。如果返回 true，就移除最老的元素（链表头部）。

5. **LinkedHashMap 可以用于实现排行榜吗？**

可以，但要小心性能问题。如果排行榜频繁更新，LinkedHashMap 不是最优选择。可以考虑用 `ConcurrentSkipListMap` 或专门的排序数据结构。

---

LinkedHashSet 是 HashSet 的有序变体，它用双向链表维护了插入或访问顺序。理解了这个原理，你就能轻松实现 LRU 缓存和各种有序去重场景。

下一节，我们来看看另一种有序 Set——基于红黑树的 TreeSet。
