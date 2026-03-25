# ReadWriteLock：读写锁原理

你见过图书馆的借书系统吗？

- **一个人借书时**：其他人可以同时借（只要不是同一本书）
- **管理员整理书架时**：所有人等着，不能借不能还

这就是读写锁的思想：**读读不互斥，读写互斥，写写互斥**。

---

## 为什么需要读写锁？

先看一个反例——普通锁导致的性能问题：

```java
public class SlowCache {
    private final Map&lt;String, Object&gt; cache = new HashMap&lt;&gt;();
    private final Lock lock = new ReentrantLock();

    public Object get(String key) {
        lock.lock();
        try {
            return cache.get(key);
        } finally {
            lock.unlock();
        }
    }

    public void put(String key, Object value) {
        lock.lock();
        try {
            cache.put(key, value);
        } finally {
            lock.unlock();
        }
    }
}
```

**问题**：读操作也要排队！1000 个线程同时读，都要一个个等。

**读写锁的解决方案**：

```java
public class FastCache {
    private final Map&lt;String, Object&gt; cache = new HashMap&lt;&gt;();
    private final ReadWriteLock rwLock = new ReentrantReadWriteLock();
    private final Lock readLock = rwLock.readLock();
    private final Lock writeLock = rwLock.writeLock();

    public Object get(String key) {
        readLock.lock();
        try {
            return cache.get(key);
        } finally {
            readLock.unlock();
        }
    }

    public void put(String key, Object value) {
        writeLock.lock();
        try {
            cache.put(key, value);
        } finally {
            writeLock.unlock();
        }
    }
}
```

---

## 读写锁的三种规则

| 操作组合 | 是否互斥 | 说明 |
|---------|---------|------|
| 读 + 读 | 不互斥 | 多个线程可以同时读 |
| 读 + 写 | 互斥 | 读的时候不能写，写的时候不能读 |
| 写 + 写 | 互斥 | 只能一个线程写 |

**为什么这样设计？**

- 读操作不会修改数据，多个线程同时读是安全的
- 写操作会修改数据，必须独占

---

## 读写锁的内部实现

### 读写状态分离

ReentrantReadWriteLock 用一个整数的高 16 位表示读锁状态，低 16 位表示写锁状态：

```
 32位整数
┌──────────────────┬──────────────────┐
│     读锁计数(高16位)     │     写锁计数(低16位)      │
└──────────────────┴──────────────────┘
```

```java
// 获取读锁
if (sharers == 0 && writer == 0) {
    sharers++;
}

// 获取写锁
if (sharers == 0 && writer == 0) {
    writer++;
}
```

### 写锁降级为读锁

```java
public void processData() {
    writeLock.lock();
    try {
        System.out.println("获取写锁，写入数据");
        // 写锁降级为读锁
        readLock.lock();
        try {
            System.out.println("降级为读锁");
            // 此时仍然持有写锁，但多了一个读锁
        } finally {
            // 不能释放写锁！只能最后释放
        }
    } finally {
        writeLock.unlock(); // 写锁释放
    }
}
```

**注意**：读锁不能升级为写锁（死锁风险）。

---

## 实战：用读写锁实现缓存

```java
public class ReadWriteCache&lt;K, V&gt; {
    private final Map&lt;K, V&gt; cache = new HashMap&lt;&gt;();
    private final ReadWriteLock rwLock = new ReentrantReadWriteLock();
    private final Lock readLock = rwLock.readLock();
    private final Lock writeLock = rwLock.writeLock();

    // 缓存要设置容量，防止无限膨胀
    private final int maxSize;
    private final LinkedHashMap&lt;K, V&gt; lruCache;

    public ReadWriteCache(int maxSize) {
        this.maxSize = maxSize;
        this.lruCache = new LinkedHashMap&lt;K, V&gt;(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry&lt;K, V&gt; eldest) {
                return size() &gt; ReadWriteCache.this.maxSize;
            }
        };
    }

    public V get(K key) {
        readLock.lock();
        try {
            return lruCache.get(key);
        } finally {
            readLock.unlock();
        }
    }

    public void put(K key, V value) {
        writeLock.lock();
        try {
            lruCache.put(key, value);
        } finally {
            writeLock.unlock();
        }
    }

    public void clear() {
        writeLock.lock();
        try {
            lruCache.clear();
        } finally {
            writeLock.unlock();
        }
    }

    // 缓存不存在时加载（防止缓存击穿）
    public V getOrLoad(K key, Supplier&lt;V&gt; loader) {
        readLock.lock();
        try {
            V value = lruCache.get(key);
            if (value != null) {
                return value;
            }
        } finally {
            readLock.unlock();
        }

        // 缓存未命中，尝试加载
        writeLock.lock();
        try {
            // 可能其他线程已经加载了
            V value = lruCache.get(key);
            if (value == null) {
                value = loader.get();
                lruCache.put(key, value);
            }
            return value;
        } finally {
            writeLock.unlock();
        }
    }
}
```

---

## 读写锁的「坑」

### 坑1：读锁不能升级为写锁

```java
// 错误代码！会导致死锁
readLock.lock();
try {
    writeLock.lock(); // 永远等不到
    try {
        // 永远不会执行
    } finally {
        writeLock.unlock();
    }
} finally {
    readLock.unlock();
}
```

### 坑2：读写锁不是重入的

```java
ReadWriteLock rwLock = new ReentrantReadWriteLock();

// 线程A获取读锁后，不能再获取写锁
readLock.lock();
try {
    // 不能在这里获取写锁
    // writeLock.lock(); // 死锁
} finally {
    readLock.unlock();
}
```

### 坑3：公平模式下读锁可能「饿死」写锁

```
线程A（读）→ 线程B（读）→ 线程C（读）→ ...
                                    ↑
                               线程Z（写）在等...
```

如果一直有新读线程进来，写锁可能永远拿不到。ReentrantReadWriteLock 默认非公平模式。

---

## 读写锁适用场景

### 适合的场景

- **读多写少**：如配置信息、缓存数据、商品详情
- 读操作远多于写操作
- 读操作耗时长（如数据库查询）

### 不适合的场景

- 读写操作差不多
- 写操作耗时很长（会阻塞所有读操作）
- 有大量的短写操作（读锁持有时间短，非公平模式更快）

---

## StampedLock：读写锁的升级版

JDK 8 引入了 StampedLock，提供了**乐观读**的能力：

```java
StampedLock sl = new StampedLock();

// 乐观读（不阻塞，性能最高）
long stamp = sl.tryOptimisticRead();
V value = cache.get(key);
if (!sl.validate(stamp)) {
    // 乐观读失败，有写操作，获取正式读锁
    stamp = sl.readLock();
    try {
        value = cache.get(key);
    } finally {
        sl.unlockRead(stamp);
    }
}
```

StampedLock 详细内容见 [StampedLock：乐观读 vs 悲观读](/java/concurrent/stamped-lock)。

---

## 面试追问方向

1. **读写锁的写锁是什么类型的锁？**
   排他锁，一次只能一个线程持有。

2. **ReadWriteLock 和 ReentrantReadWriteLock 的关系？**
   ReadWriteLock 是接口，ReentrantReadWriteLock 是实现。ReentrantReadWriteLock 还支持重入、公平/非公平模式。

3. **为什么读锁不能升级为写锁？**
   假设读锁 A 获取后升级为写锁，需要等待其他读锁释放。但如果其他读锁不释放，就会死锁。

4. **如何防止「写锁饥饿」？**
   - 使用公平锁（按等待顺序）
   - 使用 StampedLock 的乐观读
   - 限制读锁持有时间
