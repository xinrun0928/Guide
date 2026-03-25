# Java 四种引用：从强到虚，掌控对象生死

你可能遇到过这些场景：

- 缓存数据太大，内存不够用，希望**自动清理**
- 实现一个「观察者」功能，对象被回收时能得到通知
- 手写缓存框架，想控制内存占用

这些场景的背后，是 Java 的**四种引用类型**在支撑。

---

## 为什么需要引用？

普通引用（强引用）无法满足复杂场景：

```java
Object obj = new Object();  // 强引用
obj = null;                  // 只有这行执行后，对象才可能被回收
```

问题是：如果我想「保留对象但内存不足时自动清理」怎么办？

Java 提供了四种引用级别，从**强**到**虚**，控制力递增。

---

## 四种引用类型一览

```
引用强度：强引用 > 软引用 > 弱引用 > 虚引用

┌─────────────────────────────────────────────────────────────┐
│  强引用（Strong Reference）                                  │
│  - Object obj = new Object()                                │
│  - 只要强引用存在，对象永不回收                              │
├─────────────────────────────────────────────────────────────┤
│  软引用（Soft Reference）                                    │
│  - SoftReference<T>                                        │
│  - 内存不足时回收                                           │
├─────────────────────────────────────────────────────────────┤
│  弱引用（Weak Reference）                                    │
│  - WeakReference<T>                                        │
│  - 下次 GC 必定回收                                         │
├─────────────────────────────────────────────────────────────┤
│  虚引用（Phantom Reference）                                 │
│  - PhantomReference<T>                                      │
│  - 形同虚设，随时回收，追踪回收前状态                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 强引用：最常见的引用

### 特点

- `Object obj = new Object()` 就是强引用
- 只要强引用存在，JVM 永远不会回收对象
- 即使 OOM，也不会回收强引用对象

```java
// 强引用永不回收
while (true) {
    Object o = new Object();  // 强引用
    // OOM 也不会回收 o，除非方法结束栈帧出栈
}
```

### 适用场景

- 常规业务代码中的对象引用
- 不需要特殊生命周期管理的对象

---

## 软引用：内存敏感型缓存

### 特点

- `SoftReference<T>` 包装对象
- **内存不足时**才会被回收
- 回收前会尝试最后一次

```java
public class SoftReferenceDemo {

    public static void main(String[] args) {
        // 软引用：内存不足时可被回收
        SoftReference<byte[]> cache = new SoftReference<>(new byte[1024 * 1024 * 10]);

        // 检查对象是否还在
        if (cache.get() != null) {
            System.out.println("缓存还在");
        } else {
            System.out.println("缓存已被回收（内存不足）");
        }
    }
}
```

### 典型应用：缓存

```java
public class SoftCache<K, V> {

    // 软引用 Map：值是软引用
    private Map<K, SoftReference<V>> cache = new HashMap<>();

    public V get(K key) {
        SoftReference<V> ref = cache.get(key);
        return ref != null ? ref.get() : null;
    }

    public void put(K key, V value) {
        // value 变成软引用，在内存不足时自动清理
        cache.put(key, new SoftReference<>(value));
    }

    public void clear() {
        cache.clear();
    }
}
```

### 软引用何时回收？

JVM 参数 `-XX:SoftRefLRUPolicyMSPerMB` 控制软引用存活时间（每 MB 空闲空间的毫秒数）。

```bash
# 默认 1000：每 MB 空闲空间，软引用存活 1 秒
java -XX:SoftRefLRUPolicyMSPerMB=1000 your.Application
```

**简单理解**：堆空闲空间越大，软引用越难被回收。

---

## 弱引用：比软引用更激进

### 特点

- `WeakReference<T>` 包装对象
- **下次 GC 时必定回收**，无论内存是否充足
- `get()` 可能返回 null

```java
public class WeakReferenceDemo {

    public static void main(String[] args) {
        WeakReference<Object> weakRef = new WeakReference<>(new Object());

        System.out.println("GC 前：" + weakRef.get());  // 对象存在

        System.gc();  // 触发 GC

        System.out.println("GC 后：" + weakRef.get());  // null（必定被回收）
    }
}
```

### 典型应用：ThreadLocal

ThreadLocal 的核心实现就依赖弱引用：

```java
public class ThreadLocalDemo {

    public static void main(String[] args) {
        ThreadLocal<Object> threadLocal = new ThreadLocal<>();
        threadLocal.set(new Object());

        // ThreadLocalMap 内部结构
        // Entry extends WeakReference<ThreadLocal<?>>
        // key（ThreadLocal）是弱引用，value 是强引用

        threadLocal = null;  // key 变成弱引用

        // 下次 GC 时，Entry 的 key 被回收
        // 但 value 还是强引用！
        // 所以 ThreadLocal 源码中，在 get/set 时会清理过期的 Entry
    }
}
```

> **这就是 ThreadLocal 内存泄漏的根源**：Entry 的 key 是弱引用，GC 会回收 key，但 value（强引用）还在。

### 解决方案：手动 remove

```java
try {
    threadLocal.set(value);
    // 业务逻辑
} finally {
    threadLocal.remove();  // 手动清理，防止内存泄漏
}
```

---

## 虚引用：形同虚设的引用

### 特点

- `PhantomReference<T>` 必须配合 `ReferenceQueue` 使用
- `get()` **永远返回 null**
- 对象被回收前，虚引用会被放入队列

```java
public class PhantomReferenceDemo {

    public static void main(String[] args) throws InterruptedException {
        ReferenceQueue<Object> queue = new ReferenceQueue<>();

        // 虚引用：get() 永远返回 null
        PhantomReference<Object> phantomRef =
            new PhantomReference<>(new Object(), queue);

        System.out.println("虚引用：" + phantomRef.get());  // 永远是 null

        // 对象没有强引用，等待 GC
        System.gc();
        Thread.sleep(100);

        // GC 后，虚引用被放入队列
        Reference<?> ref = queue.poll();
        if (ref != null) {
            System.out.println("对象被回收，虚引用进入队列");
        }
    }
}
```

### 典型应用：堆外内存管理

虚引用用于**追踪对象的回收时机**，配合 Cleaner 释放堆外内存：

```java
public class DirectByteBufferDemo {

    // DirectByteBuffer 内部实现
    // 虚引用 + Cleaner 实现堆外内存的自动释放

    public static void clean(ByteBuffer buffer) {
        // 虚引用的队列通知机制
    }
}
```

---

## 四种引用对比

| 类型 | 回收时机 | get() 返回值 | 典型应用 |
|-----|---------|-------------|---------|
| 强引用 | 永不自动回收 | 对象本身 | 普通变量 |
| 软引用 | 内存不足时 | 可能为 null | 缓存 |
| 弱引用 | 下次 GC | 可能为 null | ThreadLocal、WeakHashMap |
| 虚引用 | 无保证 | 永远 null | 堆外内存、对象追踪 |

---

## 引用队列：回收通知机制

`ReferenceQueue` 用于在对象被 GC 前收到通知：

```java
public class ReferenceQueueDemo {

    public static void main(String[] args) throws InterruptedException {
        ReferenceQueue<byte[]> queue = new ReferenceQueue<>();
        List<SoftReference<byte[]>> refs = new ArrayList<>();

        // 创建 10 个软引用
        for (int i = 0; i < 10; i++) {
            refs.add(new SoftReference<>(new byte[1024 * 1024], queue));
        }

        // 模拟内存不足
        System.gc();

        // 不断检查队列
        Reference<? extends byte[]> ref;
        while ((ref = queue.remove(1000)) != null) {
            System.out.println("引用被回收：" + ref);
        }
    }
}
```

---

## 实战：手写一个简单的缓存

```java
public class ReferenceCache<K, V> {

    private final Map<K, SoftReference<V>> cache = new HashMap<>();

    // 软引用缓存：内存不足时自动释放
    public void put(K key, V value) {
        cache.put(key, new SoftReference<>(value));
    }

    public V get(K key) {
        SoftReference<V> ref = cache.get(key);
        if (ref == null) {
            return null;
        }
        V value = ref.get();
        if (value == null) {
            cache.remove(key);  // 已被回收，清理引用
        }
        return value;
    }

    // WeakHashMap：key 为弱引用的 Map
    public void example() {
        WeakHashMap<CacheKey, V> weakMap = new WeakHashMap<>();
        // key（CacheKey）没有其他强引用时，会被自动回收
    }
}
```

---

## 面试追问方向

- ThreadLocal 的内存泄漏是怎么产生的？弱引用能完全避免泄漏吗？
- 软引用、弱引用、虚引用在 GC 时被扫描的时机有什么不同？
- 如何用四种引用实现一个「支持超时和容量限制的缓存」？
- WeakHashMap 和普通 HashMap 有什么区别？适用场景是什么？
