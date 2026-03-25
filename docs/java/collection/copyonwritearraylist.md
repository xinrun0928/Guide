# CopyOnWriteArrayList 原理与适用场景

"读多写少"的并发场景，用什么 List？

`ConcurrentHashMap` 适合 key-value 场景，`CopyOnWriteArrayList` 则适合列表场景。

它的名字已经透露了核心思想：**写时复制**。

## 核心原理：读写分离

```java
public class CopyOnWriteArrayList<E>
        implements List<E>, RandomAccess, Cloneable, java.io.Serializable {
    
    // volatile 数组，保证可见性
    private transient volatile Object[] array;
    
    // 独占锁
    final transient ReentrantLock lock = new ReentrantLock();
    
    final Object[] getArray() {
        return array;
    }
    
    final void setArray(Object[] a) {
        array = a;
    }
}
```

### 读操作：无锁

```java
public E get(int index) {
    return get(getArray(), index);
}

private E get(Object[] a, int index) {
    return (E) a[index];
}
```

直接读取 `volatile` 数组，不需要加锁。

### 写操作：复制 + 修改 + 替换

```java
public E set(int index, E element) {
    final ReentrantLock lock = this.lock;
    lock.lock();
    try {
        Object[] elements = getArray();
        E oldValue = get(elements, index);
        
        if (oldValue != element) {
            int len = elements.length;
            // 复制整个数组
            Object[] newElements = Arrays.copyOf(elements, len);
            newElements[index] = element;
            // 替换引用
            setArray(newElements);
        }
        return oldValue;
    } finally {
        lock.unlock();
    }
}
```

写操作流程：

1. 获取锁
2. 复制整个数组
3. 修改副本
4. 替换引用
5. 释放锁

读操作不受影响，因为读的是旧数组。

## add() 操作

```java
public boolean add(E e) {
    final ReentrantLock lock = this.lock;
    lock.lock();
    try {
        Object[] elements = getArray();
        int len = elements.length;
        // 复制 + 扩展
        Object[] newElements = Arrays.copyOf(elements, len + 1);
        newElements[len] = e;
        setArray(newElements);
        return true;
    } finally {
        lock.unlock();
    }
}
```

## 迭代器

```java
public Iterator<E> iterator() {
    Object[] snapshot = array;  // 获取快照
    return new CowIterator<>(snapshot, 0);
}

static class CowIterator<E> implements ListIterator<E> {
    private final Object[] snapshot;
    private int cursor;
    
    public boolean hasNext() {
        return cursor < snapshot.length;
    }
    
    public E next() {
        return (E) snapshot[cursor++];
    }
}
```

**重要**：迭代器持有的是创建时的数组快照，后续修改对迭代器不可见。

这意味着：**迭代过程中修改 List，不会抛出 ConcurrentModificationException**。

## 适用场景

### 场景一：配置信息

```java
CopyOnWriteArrayList<Config> configs = new CopyOnWriteArrayList<>();

// 读线程：频繁读取配置
for (Config config : configs) {
    process(config);
}

// 写线程：偶尔更新配置
configs.add(newConfig);  // 不影响读线程
configs.remove(oldConfig);
```

### 场景二：监听器列表

```java
CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();

// 添加监听器（写操作）
listeners.add(listener);

// 触发事件（读操作）
for (Listener listener : listeners) {
    listener.onEvent(event);  // 迭代过程中，其他线程可以 add/remove
}
```

### 场景三：白名单/黑名单

```java
CopyOnWriteArrayList<String> whitelist = new CopyOnWriteArrayList<>();

// 检查是否在白名单
boolean allowed = whitelist.contains(userId);

// 更新白名单
whitelist.add(newUserId);
```

## 性能分析

### 优点

1. **读操作无锁**：读性能极高
2. **迭代器弱一致性**：迭代过程中可以修改
3. **无 ConcurrentModificationException**

### 缺点

1. **内存占用高**：每次写都复制整个数组
2. **写操作成本高**：O(n) 的复制开销
3. **数据一致性是最终一致**：读可能读到旧数据

### 性能对比

| 操作 | CopyOnWriteArrayList | synchronizedList |
|-----|----------------------|------------------|
| 读 | O(1)，无锁 | O(1)，需获取锁 |
| 写 | O(n)，需复制数组 | O(1)，直接修改 |
| 迭代 | 弱一致，无异常 | 强一致，需同步 |

## 和 Collections.synchronizedList 对比

```java
// synchronizedList：所有操作都加锁
List<String> list1 = Collections.synchronizedList(new ArrayList<>());

// CopyOnWriteArrayList：读写分离
List<String> list2 = new CopyOnWriteArrayList<>();
```

| 特性 | synchronizedList | CopyOnWriteArrayList |
|-----|-----------------|---------------------|
| 锁粒度 | 整个 List | 写操作加锁 |
| 读性能 | 低（需加锁） | 高（无锁） |
| 写性能 | 高（直接修改） | 低（复制数组） |
| 迭代安全性 | 需要手动同步 | 弱一致，无需同步 |
| 内存占用 | 低 | 高 |

## 面试追问

### Q1: CopyOnWriteArrayList 的迭代器会反映后续的修改吗？

**不会**。迭代器持有的是创建时的数组快照。

```java
CopyOnWriteArrayList<Integer> list = new CopyOnWriteArrayList<>();
list.add(1);
list.add(2);

Iterator<Integer> iter = list.iterator();
list.add(3);  // 修改

// 迭代器看不到 3
while (iter.hasNext()) {
    System.out.println(iter.next());  // 1, 2
}
```

### Q2: 为什么 CopyOnWriteArrayList 不允许 null 元素？

和 ConcurrentHashMap 一样，是为了避免语义歧义：

- `null` 可能表示"元素不存在"
- 也可能是真的 `null` 值

在并发场景下，无法区分两种情况。

### Q3: addIfAbsent() 怎么实现的？

```java
public boolean addIfAbsent(E e) {
    Object[] snapshot = getArray();
    // 检查是否存在
    return indexOf(e, snapshot, 0, snapshot.length) >= 0 ? false :
           addIfAbsent(e, snapshot);
}

private boolean addIfAbsent(E e, Object[] snapshot) {
    final ReentrantLock lock = this.lock;
    lock.lock();
    try {
        Object[] current = getArray();
        int len = current.length;
        if (snapshot != current) {
            // 合并检查：快照中的元素 + 当前数组
            int common = Math.min(snapshot.length, len);
            for (int i = 0; i < common; i++) {
                if (current[i] != snapshot[i] &&
                    Objects.equals(e, current[i])) {
                    return false;  // 已被添加
                }
            }
        }
        if (indexOf(e, current, 0, len) >= 0) {
            return false;
        }
        // 添加
        Object[] newElements = Arrays.copyOf(current, len + 1);
        newElements[len] = e;
        setArray(newElements);
        return true;
    } finally {
        lock.unlock();
    }
}
```

---

## 留给你的思考题

CopyOnWriteArrayList 在遍历时修改（add/remove），会不会导致某些元素被跳过或重复遍历？

提示：迭代器持有的是快照，不受影响。

但如果有多个迭代器呢？

```java
CopyOnWriteArrayList<Integer> list = new CopyOnWriteArrayList<>();
list.add(1);
list.add(2);

Iterator<Integer> iter1 = list.iterator();
Iterator<Integer> iter2 = list.iterator();

list.add(3);  // 修改数组

// 两个迭代器分别遍历
// iter1 看到：1, 2
// iter2 看到：1, 2
```

因为迭代器都是快照，互相不影响。

思考：如果用 `listIterator()` 返回的 ListIterator 呢？它的 `remove()` 和 `set()` 操作是有效的吗？
