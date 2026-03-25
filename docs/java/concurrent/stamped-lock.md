# StampedLock：乐观读 vs 悲观读

你有没有遇到过这种情况：

> 图书馆里，你只想翻翻书看看，但每次翻页都要去前台登记一下，翻完再登记还书。

累不累？

JDK 8 给了你一个更聪明的选择——**StampedLock**。

它允许你「快速扫一眼」书架，不用每次都登记。如果发现有人动过书，再去登记。

这就是**乐观读**。

---

## 什么是 StampedLock？

StampedLock 是 JDK 8 引入的读写锁改进版，相比 ReadWriteLock：

| 特性 | ReadWriteLock | StampedLock |
|------|--------------|-------------|
| 读锁 | 阻塞式悲观读 | 支持乐观读 + 悲观读 |
| 写锁 | 排他锁 | 排他锁 |
| 性能 | 好 | 更好 |
| 可重入 | 支持 | **不支持** |

---

## 悲观读 vs 乐观读

### 悲观读：觉得别人会改

```java
StampedLock sl = new StampedLock();

// 悲观读：真的会阻塞
long stamp = sl.readLock();
try {
    // 读取数据
    return cache.get(key);
} finally {
    sl.unlockRead(stamp);
}
```

就像每次借书都要登记，生怕别人动了书。

### 乐观读：觉得没人会改

```java
StampedLock sl = new StampedLock();

// 1. 先试试运气（乐观读，不阻塞）
long stamp = sl.tryOptimisticRead();

// 2. 读取数据
V value = cache.get(key);

// 3. 检查是否有人改过
if (sl.validate(stamp)) {
    // 没人改，数据有效，直接用
    return value;
} else {
    // 有人改过，升级为悲观读
    stamp = sl.readLock();
    try {
        return cache.get(key);
    } finally {
        sl.unlockRead(stamp);
    }
}
```

**核心思想**：先假设没人改，快速读取。如果验证发现被改了（stamp 无效），再老老实实加锁。

---

## 三种锁模式

### 1. 写锁 writeLock()

```java
StampedLock sl = new StampedLock();

// 获取写锁（排他）
long stamp = sl.writeLock();
try {
    cache.put(key, value);
} finally {
    sl.unlockWrite(stamp);
}
```

### 2. 悲观读锁 readLock()

```java
long stamp = sl.readLock();
try {
    return cache.get(key);
} finally {
    sl.unlockRead(stamp);
}
```

### 3. 乐观读 tryOptimisticRead()

```java
long stamp = sl.tryOptimisticRead();
V value = cache.get(key);
// ... 后续验证
```

---

## 实战：高性能缓存

```java
public class StampedCache&lt;K, V&gt; {
    private final Map&lt;K, V&gt; cache = new ConcurrentHashMap&lt;&gt;();
    private final StampedLock sl = new StampedLock();

    public V get(K key) {
        // 1. 乐观读
        long stamp = sl.tryOptimisticRead();
        V value = cache.get(key);

        // 2. 验证（检查在此期间是否有写操作）
        if (sl.validate(stamp)) {
            return value;
        }

        // 3. 乐观读失败，升级为悲观读
        stamp = sl.readLock();
        try {
            return cache.get(key);
        } finally {
            sl.unlockRead(stamp);
        }
    }

    public void put(K key, V value) {
        long stamp = sl.writeLock();
        try {
            cache.put(key, value);
        } finally {
            sl.unlockWrite(stamp);
        }
    }

    // 读写锁升级（读 → 写）
    public V upgradeReadToWrite(K key, V newValue) {
        // 释放读锁
        long stamp = sl.readLock();
        try {
            // 尝试将读锁转换为写锁
            stamp = sl.tryConvertToWriteLock(stamp);
            if (stamp == 0) {
                // 转换失败，手动释放读锁再获取写锁
                unlockRead(stamp);
                stamp = sl.writeLock();
            }
            cache.put(key, newValue);
            return cache.get(key);
        } finally {
            sl.unlockWrite(stamp);
        }
    }
}
```

---

## StampedLock 的 stamp 是什么？

stamp 是一个 long 类型的版本号，每次获取锁都会返回一个新的 stamp：

```
初始 stamp = 1
读锁获取 stamp = 2
读锁释放 stamp = 2 → 失效
写锁获取 stamp = 3
...
```

**validate(stamp)** 检查 stamp 是否仍然有效——如果期间有写锁操作，stamp 会变化。

---

## 锁降级：从写到读

```java
public V update(K key, V newValue) {
    // 1. 获取写锁
    long stamp = sl.writeLock();
    try {
        // 2. 更新数据
        V oldValue = cache.get(key);
        cache.put(key, newValue);

        // 3. 锁降级：写锁 → 读锁
        // 注意：不是释放写锁再获取读锁，那样可能丢失更新
        long readStamp = sl.tryConvertToReadLock(stamp);
        if (readStamp != 0) {
            stamp = readStamp; // 成功降级
        }

        // 4. 在降级后的读锁保护下，可以继续读取
        // 但此时写锁已经释放
        return oldValue;
    } finally {
        sl.unlock(stamp); // 释放最终持有的锁
    }
}
```

---

## 性能对比

在「读多写少」场景下：

```
10000 次读 + 100 次写

ReadWriteLock (悲观读):  ~500ms
StampedLock (乐观读):    ~120ms  (提升 4x)

原因：乐观读几乎零开销
```

---

## 重要注意事项

### 1. StampedLock 不可重入

```java
StampedLock sl = new StampedLock();

// 线程A获取写锁
long stamp = sl.writeLock();

// 同一线程再次获取写锁 → 直接死锁！
long stamp2 = sl.writeLock(); // 永久阻塞
```

### 2. 必须手动释放

```java
// 所有锁都需要显式释放
sl.writeLock();
sl.readLock();
sl.tryOptimisticRead();
// 对应的 unlockXxx()
```

### 3. 不要在 finally 中无条件 unlock

```java
long stamp = sl.writeLock();
try {
    // 业务逻辑
} finally {
    sl.unlockWrite(stamp); // stamp 可能来自其他转换操作
    // 正确做法：传入对应的 stamp
}
```

### 4. 不要在锁保护区域内执行可能导致阻塞的操作

StampedLock 不支持 Condition，只能用 wait/notify 或其他同步工具。

---

## 适用场景

### 适合

- 读多写少的数据结构
- 对性能要求极高的并发场景
- 缓存系统

### 不适合

- 写多读少（乐观读会频繁失败）
- 有大量锁升级场景（StampedLock 不支持读锁升级为写锁）
- 需要 Condition 的场景

---

## 面试追问方向

1. **StampedLock 的乐观读是怎么实现的？**
   每个锁操作都会改变 stamp（版本号），validate() 检查 stamp 是否变化来判断是否有写操作干扰。

2. **StampedLock 为什么性能比 ReadWriteLock 好？**
   乐观读不需要加锁，只有在检测到冲突时才加悲观读锁。减少了锁竞争。

3. **StampedLock 支持 Condition 吗？**
   不支持。如果需要 Condition，用 ReadWriteLock 或 ReentrantLock。

4. **乐观读失败后为什么不直接重试乐观读？**
   因为写操作可能还在进行，直接重试大概率还是失败。应该升级为悲观读。

5. **StampedLock 和 ReadWriteLock 的区别？**
   - StampedLock 有乐观读，ReadWriteLock 只有悲观读
   - StampedLock 不可重入，ReadWriteLock 可重入
   - StampedLock 不支持 Condition，ReadWriteLock 支持
