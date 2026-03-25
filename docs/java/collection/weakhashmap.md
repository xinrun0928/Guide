# WeakHashMap 与弱引用

你有没有遇到过这种场景：缓存了一些对象，但不知道什么时候该清理？

手动清理太麻烦，交给 GC 又怕内存泄漏。

`WeakHashMap` 就是为这种场景设计的——当 key 只被 WeakHashMap 引用时，GC 会自动回收。

这个"自动清理"的魔法是怎么实现的？

## 弱引用（WeakReference）是什么？

Java 有四种引用：

| 引用类型 | 回收时机 | 典型用途 |
|---------|---------|---------|
| 强引用 | 永远不会回收 | 普通对象引用 |
| 软引用（SoftReference） | 内存不足时回收 | 缓存 |
| 弱引用（WeakReference） | 下次 GC 时回收 | 缓存、注册表 |
| 虚引用（PhantomReference） | 不影响回收，随时可检测 | 管理堆外内存 |

```java
// 强引用：只要有引用，对象就不会被回收
Object obj = new Object();

// 弱引用：随时可能被 GC 回收
WeakReference<Object> ref = new WeakReference<>(new Object());
```

## WeakHashMap 的实现

```java
public class WeakHashMap<K,V> extends AbstractMap<K,V>
    implements Map<K,V> {
    
    // ReferenceQueue，用于存储被 GC 回收的 key
    private final ReferenceQueue<Object> queue = new ReferenceQueue<>();
    
    // 内部数组
    private Entry<K,V>[] table;
    
    // Entry 继承自 WeakReference
    private static class Entry<K,V> extends WeakReference<Object>
            implements Map.Entry<K,V> {
        V value;
        int hash;
        Entry<K,V> next;
        
        Entry(Object key, V value, ReferenceQueue<Object> queue) {
            super(key, queue);  // 关键：key 被包装成弱引用
            this.value = value;
        }
    }
}
```

关键点：**WeakHashMap 的 Entry 把 key 包装成了 WeakReference**，并且关联了 ReferenceQueue。

## GC 发生时会发生什么？

```java
// 添加元素
public V put(K key, V value) {
    Object k = maskNull(key);
    int h = hash(k);
    Entry<K,V>[] tab = getTable();
    int i = indexFor(h, tab.length);
    
    for (Entry<K,V> e = tab[i]; e != null; e = e.next) {
        if (h == e.hash && eq(k, e.get())) {
            // key 相同，覆盖 value
            V oldValue = e.value;
            e.value = value;
            return oldValue;
        }
    }
    
    modCount++;
    addEntry(k, value, i);
    return null;
}

// 每次操作都会清理过期条目
private void expungeStaleEntries() {
    for (Object x; (x = queue.poll()) != null; ) {
        // ReferenceQueue 中存放了被 GC 回收的 key
        synchronized (queue) {
            @SuppressWarnings("unchecked")
            Entry<K,V> e = (Entry<K,V>) removeEntryForKey(x);
            // 从 table 中移除对应的 Entry
        }
    }
}
```

流程：

1. **GC 发生时**：如果 key 只被 WeakReference 引用，会被回收
2. **Entry 进入 ReferenceQueue**：被回收的 key 对应的 Entry 进入队列
3. **下次操作时**：`expungeStaleEntries()` 清理队列中的过期 Entry
4. **Entry 被移除**：对应的 value 也会失去引用，最终被回收

## 适用场景

### 场景一：缓存

```java
WeakHashMap<String, Bitmap> cache = new WeakHashMap<>();

// 加载图片
Bitmap bitmap = cache.get(path);
if (bitmap == null) {
    bitmap = loadBitmap(path);
    cache.put(path, bitmap);  // 不需要手动清理
}
// 当 bitmap 不被其他地方引用时，会被 GC 自动清理
```

### 场景二：注册表

```java
// 监听器注册表，当监听器不再使用时自动注销
WeakHashMap<Component, FocusListener> listeners = new WeakHashMap<>();

// 组件销毁时，不需要手动 remove 监听器
```

### 场景三：防止内存泄漏

```java
// 保存临时对象，不影响 GC
WeakHashMap<Context, String> tempData = new WeakHashMap<>();
tempData.put(activity, "some data");
// Activity 销毁时，tempData 中的 entry 会被自动清理
```

## 和 WeakReference 的关系

WeakHashMap 本质上是**多个 WeakReference 的集合**，每个 Entry 持有一个 key 的弱引用。

```java
// 手动使用 WeakReference
WeakReference<String> ref = new WeakReference<>("hello");
System.out.println(ref.get());  // "hello"

System.gc();  // 触发 GC
System.out.println(ref.get());  // 可能变成 null
```

WeakHashMap 封装了这个逻辑，让使用更方便。

## 注意事项

### 1. 迭代时可能看到 null key

```java
WeakHashMap<String, Integer> map = new WeakHashMap<>();
map.put("a", 1);

// 如果此时 GC 发生
System.gc();

// 遍历时可能看到 null key（key 被回收了，但 Entry 还没清理）
for (String key : map.keySet()) {
    // key 可能是 null！
}
```

正确做法：先调用 `expungeStaleEntries()` 或在遍历时检查。

### 2. value 是强引用

```java
WeakHashMap<String, List<String>> map = new WeakHashMap<>();
List<String> list = new ArrayList<>();
map.put("key", list);

// 虽然 key 可能被回收
// 但 value (list) 仍然被强引用，不会被 GC
```

如果想让 value 也能被 GC，需要用**弱引用包装 value**：

```java
WeakHashMap<String, WeakReference<List<String>>> map = new WeakHashMap<>();
```

### 3. 不是线程安全的

WeakHashMap 不是线程安全的，需要外部同步或用 `Collections.synchronizedMap()`。

## WeakHashMap vs HashMap

| 特性 | HashMap | WeakHashMap |
|-----|--------|-------------|
| 引用类型 | 强引用 | key 是弱引用 |
| GC 行为 | key 不会被自动回收 | key 可能被自动回收 |
| 适用场景 | 长期持有 | 短期缓存 |
| 内存管理 | 手动 | 自动 |
| 性能 | 稍高 | 稍低（需要维护 ReferenceQueue） |

## 面试追问

### Q1: 软引用（SoftReference）和弱引用（WeakReference）有什么区别？

| 引用类型 | 回收时机 | 适用场景 |
|---------|---------|---------|
| SoftReference | 内存不足时 | 图片缓存（内存敏感） |
| WeakReference | 下次 GC | 注册表、监听器列表 |

简单说：**软引用比弱引用"寿命更长"**——只有真正内存不足时才回收。

### Q2: 虚引用（PhantomReference）有什么用？

虚引用几乎不影响对象的生命周期，它的主要用途：

1. **跟踪对象被回收的时机**：可以感知对象何时被 GC
2. **管理堆外内存**：如 DirectByteBuffer，通过虚引用管理堆外内存

```java
ReferenceQueue<Object> queue = new ReferenceQueue<>();
PhantomReference<Object> ref = new PhantomReference<>(obj, queue);

// 对象被 GC 后，可以在 queue 中检测到
```

### Q3: WeakHashMap 的 key 被 GC 后，value 什么时候被回收？

**不是立即回收**，而是在下次访问 WeakHashMap 时（如 `get()`、`put()`、`size()` 等），会调用 `expungeStaleEntries()` 清理。

所以 value 的回收可能"延迟"到下一次操作。

---

## 留给你的思考题

WeakHashMap 在遍历时调用 `expungeStaleEntries()`，这意味着**遍历本身可能会修改 Map**。

这和 HashMap 的快速失败（fail-fast）机制有什么不同？

提示：WeakHashMap 的迭代器是**弱一致的**——它不会抛出 `ConcurrentModificationException`，但可能在遍历过程中看到"快照"状态。

理解这个问题，你就掌握了 Java 集合框架中各种迭代器的区别。
