# TreeMap：Comparable vs Comparator

如果 HashMap 是"无序"的代名词，那么 TreeMap 就是"有序"的代表。

和 HashMap 的 hash + 链表/红黑树不同，TreeMap 使用**真正的红黑树**来存储数据，保证 key 按自然顺序或自定义顺序排列。

但有序的代价是什么？TreeMap 的 key 有什么要求？

## TreeMap 的底层结构

```java
public class TreeMap<K,V> extends AbstractMap<K,V>
    implements NavigableMap<K,V>, Cloneable, java.io.Serializable {
    
    // 红黑树的根节点
    private transient Entry<K,V> root = null;
    
    // 比较器，为 null 时使用 key 的自然顺序
    private final Comparator<? super K> comparator;
    
    // 红黑树节点
    private static class Entry<K,V> implements Map.Entry<K,V> {
        K key;
        V value;
        Entry<K,V> left;
        Entry<K,V> right;
        Entry<K,V> parent;
        boolean color = BLACK;
    }
}
```

关键点：**每个节点有 left、right、parent 指针，构成真正的二叉搜索树**。

## Comparable vs Comparator

TreeMap 对 key 有两种排序方式：

### 1. key 实现 Comparable（自然顺序）

```java
public class User implements Comparable<User> {
    private String name;
    private int age;
    
    @Override
    public int compareTo(User o) {
        // 按 name 升序排列
        return this.name.compareTo(o.name);
    }
}

TreeMap<User, String> map = new TreeMap<>();
map.put(new User("alice", 20), "value1");
map.put(new User("bob", 25), "value2");
```

### 2. 提供 Comparator（自定义顺序）

```java
TreeMap<User, String> map = new TreeMap<>(new Comparator<User>() {
    @Override
    public int compare(User u1, User u2) {
        // 按 age 降序排列
        return u2.age - u1.age;
    }
});
```

### 优先级：Comparator > Comparable

```java
// 如果提供了 Comparator，使用 Comparator
if (comparator != null) {
    return comparator.compare(key, m.key);
}
// 否则使用 key 的自然顺序（key 必须实现 Comparable）
return ((Comparable<K>) key).compareTo(m.key);
```

## 导航方法：lower/ floor/ ceiling/ higher

TreeMap 的导航方法是面试常考点：

```java
TreeMap<String, Integer> map = new TreeMap<>();
map.put("a", 1);
map.put("c", 3);
map.put("e", 5);
map.put("g", 7);

// lowerKey: 严格小于
map.lowerKey("c");  // "a"
map.lowerKey("b");  // "a"

// floorKey: 小于等于
map.floorKey("c");  // "c"
map.floorKey("b");  // "a"

// ceilingKey: 大于等于
map.ceilingKey("c");  // "c"
map.ceilingKey("d");  // "e"

// higherKey: 严格大于
map.higherKey("c");  // "e"
map.higherKey("f");  // "g"
```

| 方法 | 语义 | 返回值 |
|-----|------|-------|
| lowerKey/lowerEntry | < key | 最大的小于 key 的元素 |
| floorKey/floorEntry | <= key | 最大的小于等于 key 的元素 |
| ceilingKey/ceilingEntry | >= key | 最小的大于等于 key 的元素 |
| higherKey/higherEntry | > key | 最小的大于 key 的元素 |

## 范围查询：subMap/ headMap/ tailMap

```java
TreeMap<String, Integer> map = new TreeMap<>();
map.put("a", 1);
map.put("b", 2);
map.put("c", 3);
map.put("d", 4);
map.put("e", 5);

// subMap: [fromKey, toKey)
map.subMap("b", "d");   // {b=2, c=3}
map.subMap("b", "d");   // 左闭右开，不包含 "d"

// headMap: < toKey
map.headMap("c");       // {a=1, b=2}

// tailMap: >= fromKey
map.tailMap("c");       // {c=3, d=4, e=5}
```

注意：返回的子 Map 是**视图**，修改会影响原 Map：

```java
SortedMap<String, Integer> sub = map.subMap("b", "d");
sub.put("b2", 22);      // 成功
sub.put("a", 0);        // 抛出 IllegalArgumentException（超出范围）
```

## 线程安全性

TreeMap **不是线程安全的**。

如果需要线程安全的有序 Map，用 `ConcurrentSkipListMap`：

```java
// 线程安全的 TreeMap
Map<String, Integer> map = new ConcurrentSkipListMap<>();
map.put("a", 1);
map.put("c", 3);
map.put("b", 2);

// 按 key 顺序遍历
for (Map.Entry<String, Integer> entry : map.entrySet()) {
    System.out.println(entry.getKey() + "=" + entry.getValue());
}
// 输出: a=1, b=2, c=3
```

## 适用场景

| 场景 | 推荐 |
|-----|------|
| 需要按 key 排序遍历 | TreeMap / ConcurrentSkipListMap |
| 需要按范围查询 | TreeMap（subMap） |
| 需要导航方法 | TreeMap（lower/ higher） |
| 高并发场景 | ConcurrentSkipListMap |
| 只需要快速查找 | HashMap |

## 面试追问

### Q1: TreeMap 和 HashMap 的性能对比？

| 操作 | TreeMap | HashMap |
|-----|--------|--------|
| 查找 | O(log n) | O(1)（平均），O(n)（最坏） |
| 插入 | O(log n) | O(1)（平均） |
| 删除 | O(log n) | O(1)（平均） |
| 有序遍历 | O(n)（按顺序） | O(n + m)（n=容量，m=元素） |
| 空间 | O(n) | O(n + m |

HashMap 平均性能更好，但 TreeMap 保证最坏情况性能且支持有序操作。

### Q2: TreeMap 的 key 可以是 null 吗？

取决于是否有 Comparator：

- **无 Comparator**（使用自然顺序）：key 不能为 null，因为 null 无法调用 `compareTo()`
- **有 Comparator**：key 可以为 null（取决于 Comparator 的实现）

```java
TreeMap<String, Integer> map = new TreeMap<>();
map.put(null, 1);  // NullPointerException

TreeMap<String, Integer> map = new TreeMap<>(Comparator.nullsFirst());
map.put(null, 1);  // OK
```

### Q3: 红黑树如何保持平衡？

TreeMap 使用**颜色标记 + 旋转**来保持近似平衡：

- 新插入的节点默认红色
- 通过左旋、右旋、变色来调整
- 最多旋转 2 次（插入）或 3 次（删除）就能恢复平衡

---

## 留给你的思考题

JDK 的 `Collections.synchronizedSortedMap()` 返回的 synchronized SortedMap，底层是怎么实现的？

提示：它返回一个 `SynchronizedSortedMap` 类，内部用 `synchronized` 关键字锁住所有操作。

但这种实现有一个问题：**范围查询（如 subMap）返回的子 Map 仍然需要加锁**。你知道这个陷阱吗？

理解这个问题，你就掌握了 Collections 工具类的局限性。
