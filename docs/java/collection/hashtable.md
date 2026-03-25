# Hashtable：为什么不再推荐

如果让你实现一个线程安全的 HashMap，你会怎么做？

早期 Java 的答案是 `Hashtable`——在所有方法上加 `synchronized`，简单粗暴。

但现在，如果你还在项目里用 Hashtable，面试官可能会皱眉头。

为什么？

## Hashtable 的实现

```java
public class Hashtable<K,V> extends Dictionary<K,V>
    implements Map<K,V>, Cloneable, java.io.Serializable {
    
    // 底层数组
    private transient Entry<?,?>[] table;
    
    // 所有公开方法都加了 synchronized
    public synchronized V put(K key, V value) {
        // ...
    }
    
    public synchronized V get(Object key) {
        // ...
    }
    
    public synchronized V remove(Object key) {
        // ...
    }
    
    // ...
}
```

所有方法都是 `synchronized`，相当于给**整个对象**加了一把锁。任何线程访问任何方法，都得排队。

## 为什么不再推荐？

### 1. 性能太差

```java
// 两个线程同时调用 get()，也要排队
map.get("a");  // 线程 1
map.get("b");  // 线程 2（必须等线程 1 释放锁）
```

synchronized 是**粗粒度锁**，并发度高时性能急剧下降。

### 2. 不允许 null key/value

```java
Hashtable<String, String> map = new Hashtable<>();
map.put(null, "value");  // NullPointerException
map.put("key", null);    // NullPointerException
```

HashMap 允许 null key 和 null value，Hashtable 不允许。

### 3. 迭代器不是快速失败的

HashMap 的迭代器是快速失败的，遍历时修改会抛出 `ConcurrentModificationException`。

Hashtable 的迭代器**不是**快速失败的，这可能导致不可预期的行为。

### 4. 遗留类

Hashtable 是 JDK 1.0 的类，从 Dictionary 继承而来，很多设计已经过时。

## Hashtable vs ConcurrentHashMap

| 特性 | Hashtable | ConcurrentHashMap |
|-----|----------|-------------------|
| 锁粒度 | 整个对象 | 每个桶（JDK 7）或 Node（JDK 8） |
| 并发度 | 1 | 高（16 或更高） |
| null key/value | 不允许 | key 和 value 都不能为 null |
| 迭代器 | 非快速失败 | 弱一致性 |
| 性能 | 差 | 好 |
| 推荐 | 否 | 是 |

## 如果不用 Hashtable，用什么？

### 替代方案一：ConcurrentHashMap（推荐）

```java
ConcurrentHashMap<String, String> map = new ConcurrentHashMap<>();
map.put("a", "1");
map.putIfAbsent("a", "2");  // key 存在时不覆盖
String value = map.get("a");  // "1"
```

### 替代方案二：Collections.synchronizedMap()

```java
Map<String, String> map = Collections.synchronizedMap(new HashMap<>());
synchronized (map) {
    map.put("a", "1");
    String value = map.get("a");
}
```

注意：迭代时仍然需要手动同步，否则可能 `ConcurrentModificationException`。

### 替代方案三：ConcurrentSkipListMap

需要有序 + 线程安全时：

```java
ConcurrentSkipListMap<String, String> map = new ConcurrentSkipListMap<>();
map.put("a", "1");
map.put("c", "3");
map.put("b", "2");
// 按 key 顺序遍历: a=1, b=2, c=3
```

## Hashtable 的适用场景

说实话，几乎没有。

唯一可能的场景：需要兼容老代码（JDK 1.0 时代的遗留系统）。

但即使是老代码，也建议逐步迁移到 `ConcurrentHashMap`。

## HashMap vs Hashtable vs ConcurrentHashMap

| 特性 | HashMap | Hashtable | ConcurrentHashMap |
|-----|--------|----------|------------------|
| 线程安全 | 否 | 是（全表锁） | 是（分段锁/CAS） |
| 性能 | 高 | 低 | 高 |
| null key | 1个 | 不允许 | 不允许 |
| null value | 多个 | 不允许 | 不允许 |
| 迭代器 | 快速失败 | 非快速失败 | 弱一致性 |
| 首次出现 | JDK 1.2 | JDK 1.0 | JDK 1.5 |

## 面试追问

### Q1: Collections.synchronizedMap() 和 ConcurrentHashMap 怎么选？

看场景：

```java
// 读多写少：高并发，需要高性能
ConcurrentHashMap<String, String> map = new ConcurrentHashMap<>();

// 写多读少，或需要原子复合操作
Map<String, String> map = Collections.synchronizedMap(new HashMap<>());
synchronized (map) {
    // 复合操作需要原子性
    if (!map.containsKey(key)) {
        map.put(key, value);
    }
}
```

`synchronizedMap` 的优势是**复合操作的原子性**（如 check-then-act），而 `ConcurrentHashMap` 的单个操作是原子的，但复合操作需要额外同步。

### Q2: Hashtable 的 contains() 方法有什么坑？

```java
Hashtable<String, String> map = new Hashtable<>();
map.put("a", "null");  // value 是字符串 "null"

map.contains("null");   // 返回 true（检查的是 key！）
map.containsValue("null");  // 检查 value
```

`contains()` 方法实际上是 `containsKey()`，不是 `containsValue()`！

这是一个历史遗留 bug，但为了向后兼容，一直没有修复。

### Q3: 为什么 ConcurrentHashMap 不允许 null key/value？

Doug Lea（ConcurrentHashMap 的作者）解释过：

1. **语义模糊**：null 可能表示"key 不存在"，也可能是"值为 null"
2. **并发场景下难以处理**：在并发操作中，如果一个线程看到 null，无法判断是"key 不存在"还是"其他线程删除了值"
3. **历史原因**：Hashtable 就不允许 null，ConcurrentHashMap 保持一致

---

## 留给你的思考题

ConcurrentHashMap 的 `compute()`、`merge()` 等原子方法，是怎么实现的？

提示：这些方法内部使用 `synchronized` 锁住特定 Node，保证复合操作的原子性。

但如果两个线程同时 `compute()` 不同的 key，会互相阻塞吗？

答案是不会，因为锁粒度是单个桶（Node），不同 key 不会冲突。

理解这个问题，你就掌握了 ConcurrentHashMap 的并发控制机制。
