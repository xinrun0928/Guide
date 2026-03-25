# Collections 工具类常用方法

`Collections` 是 Java 集合框架中最强大的工具类。

它提供了大量静态方法，用于操作集合——排序、查找、同步控制、不可变集合创建...

今天，我们来系统地梳理这些方法。

## 排序与查找

### sort()：排序

```java
// 自然顺序排序（元素必须实现 Comparable）
List<Integer> list = new ArrayList<>(Arrays.asList(3, 1, 2));
Collections.sort(list);  // [1, 2, 3]

// 自定义排序
List<String> words = Arrays.asList("banana", "apple", "cherry");
Collections.sort(words, Comparator.comparingInt(String::length));
// [apple, banana, cherry] 按长度排序
```

JDK 8 之后，更推荐直接用 List 的 sort() 方法：

```java
list.sort(Comparator.reverseOrder());  // 降序
```

### binarySearch()：二分查找

```java
List<String> list = new ArrayList<>(Arrays.asList("a", "c", "e", "g"));
int index = Collections.binarySearch(list, "e");  // 2

// 自定义比较器
int index = Collections.binarySearch(list, "f", Comparator.naturalOrder());  // -4
```

**注意**：二分查找前必须先排序，否则结果不确定。

### reverse()：反转

```java
List<Integer> list = new ArrayList<>(Arrays.asList(1, 2, 3, 4, 5));
Collections.reverse(list);  // [5, 4, 3, 2, 1]
```

### shuffle()：随机打乱

```java
List<Integer> list = new ArrayList<>(Arrays.asList(1, 2, 3, 4, 5));
Collections.shuffle(list);  // 随机顺序
Collections.shuffle(list, new Random(42));  // 指定随机种子
```

### rotate()：循环移位

```java
List<Integer> list = new ArrayList<>(Arrays.asList(1, 2, 3, 4, 5));
Collections.rotate(list, 2);  // [4, 5, 1, 2, 3]
// 正数向右移，负数向左移
```

## 批量操作

### fill()：填充

```java
List<String> list = new ArrayList<>(Arrays.asList("a", "b", "c"));
Collections.fill(list, "x");  // [x, x, x]
```

### copy()：复制

```java
List<String> src = Arrays.asList("a", "b", "c");
List<String> dest = new ArrayList<>(Arrays.asList("x", "y", "z"));
Collections.copy(dest, src);  // dest 变成 [a, b, c]

// dest 必须有足够的容量
List<String> dest = new ArrayList<>(3);
Collections.copy(dest, src);
```

### swap()：交换

```java
List<Integer> list = new ArrayList<>(Arrays.asList(1, 2, 3, 4, 5));
Collections.swap(list, 0, 4);  // [5, 2, 3, 4, 1]
```

## 查找最值

### min() / max()

```java
List<Integer> list = Arrays.asList(3, 1, 4, 1, 5, 9, 2, 6);

int min = Collections.min(list);  // 1
int max = Collections.max(list);  // 9

// 自定义比较器
String shortest = Collections.min(list, Comparator.comparingInt(String::length));
```

## 同步控制

### synchronizedList / synchronizedMap / synchronizedSet

```java
// 线程安全的 List
List<String> syncList = Collections.synchronizedList(new ArrayList<>());
synchronized (syncList) {
    Iterator<String> i = syncList.iterator();
    while (i.hasNext()) {
        System.out.println(i.next());
    }
}

// 线程安全的 Map
Map<String, Integer> syncMap = Collections.synchronizedMap(new HashMap<>());

// 线程安全的 Set
Set<String> syncSet = Collections.synchronizedSet(new HashSet<>());

// 线程安全的 SortedMap
SortedMap<String, Integer> syncSortedMap = 
    Collections.synchronizedSortedMap(new TreeMap<>());

// 线程安全的 SortedSet
SortedSet<String> syncSortedSet = 
    Collections.synchronizedSortedSet(new TreeSet<>());
```

**重要**：迭代时必须同步，否则可能导致 `ConcurrentModificationException`。

## 不可变集合

### unmodifiableList / unmodifiableMap / unmodifiableSet

```java
// 不可变的 List
List<String> unmodifiable = Collections.unmodifiableList(Arrays.asList("a", "b"));
unmodifiable.add("c");  // UnsupportedOperationException

// 不可变的 Map
Map<String, Integer> unmodifiableMap = 
    Collections.unmodifiableMap(new HashMap<>());

// 不可变的 Set
Set<String> unmodifiableSet = 
    Collections.unmodifiableSet(new HashSet<>());

// 不可变的 SortedMap
SortedMap<String, Integer> unmodifiableSortedMap = 
    Collections.unmodifiableSortedMap(new TreeMap<>());

// 不可变的 SortedSet
SortedSet<String> unmodifiableSortedSet = 
    Collections.unmodifiableSortedSet(new TreeSet<>());
```

### JDK 9+ 的替代

JDK 9 引入了更简洁的不可变集合创建方式：

```java
// JDK 9+
List<String> list = List.of("a", "b", "c");
Set<String> set = Set.of("a", "b", "c");
Map<String, Integer> map = Map.of("a", 1, "b", 2);

// JDK 10+ 的 copyOf
List<String> copy = List.copyOf(list);
```

## 集合关系

### frequency()：元素出现次数

```java
List<String> list = Arrays.asList("a", "b", "a", "c", "a", "b");
int count = Collections.frequency(list, "a");  // 3
```

### disjoint()：是否无交集

```java
List<Integer> list1 = Arrays.asList(1, 2, 3);
List<Integer> list2 = Arrays.asList(4, 5, 6);
List<Integer> list3 = Arrays.asList(3, 4, 5);

boolean noIntersection = Collections.disjoint(list1, list2);  // true
boolean hasIntersection = Collections.disjoint(list1, list3); // false
```

## Enumeration 和 Iterator 转换

```java
// Enumeration -> Iterator
Vector<String> vector = new Vector<>(Arrays.asList("a", "b", "c"));
Enumeration<String> enumeration = vector.elements();
Iterator<String> iterator = Collections.list(enumeration).iterator();

// Iterator -> Enumeration
List<String> list = Arrays.asList("a", "b", "c");
Iterator<String> iterator = list.iterator();
Enumeration<String> enumeration = Collections.enumeration(list);
```

## 方法分类速查表

| 分类 | 方法 | 说明 |
|-----|------|------|
| 排序 | `sort(List)` | 自然顺序排序 |
| 排序 | `sort(List, Comparator)` | 自定义排序 |
| 查找 | `binarySearch(List, T)` | 二分查找（需先排序） |
| 反转 | `reverse(List)` | 反转元素顺序 |
| 打乱 | `shuffle(List)` | 随机打乱 |
| 移位 | `rotate(List, distance)` | 循环移位 |
| 填充 | `fill(List, T)` | 用同一元素填充 |
| 复制 | `copy(List dest, List src)` | 复制集合 |
| 交换 | `swap(List, i, j)` | 交换两个位置的元素 |
| 最值 | `min(Collection)` | 最小值 |
| 最值 | `max(Collection)` | 最大值 |
| 计数 | `frequency(Collection, Object)` | 元素出现次数 |
| 判断 | `disjoint(Collection, Collection)` | 是否无交集 |
| 同步 | `synchronizedList/Map/Set()` | 创建线程安全集合 |
| 不可变 | `unmodifiableList/Map/Set()` | 创建不可变集合 |
| 转换 | `enumeration(Collection)` | Iterator 转 Enumeration |
| 转换 | `list(Enumeration)` | Enumeration 转 ArrayList |

## 面试追问

### Q1: Collections.synchronizedMap() 和 ConcurrentHashMap 怎么选？

```java
// 低并发：synchronizedMap 够用
Map<String, Object> map = Collections.synchronizedMap(new HashMap<>());

// 高并发：ConcurrentHashMap
ConcurrentHashMap<String, Object> map = new ConcurrentHashMap<>();
```

| 场景 | 推荐 |
|-----|------|
| 读多写少 | ConcurrentHashMap |
| 写多读少 | synchronizedMap |
| 迭代时需要同步 | synchronizedMap |
| 原子复合操作 | ConcurrentHashMap（如 computeIfAbsent） |

### Q2: Collections.unmodifiableMap() 和 Map.of() 的区别？

| 特性 | unmodifiableMap() | Map.of() |
|-----|------------------|----------|
| JDK 版本 | JDK 1.2+ | JDK 9+ |
| null key/value | 允许 | 不允许 |
| 重复 key | 允许（原 Map） | 抛异常 |
| 性能 | 基本相同 | 略优 |

### Q3: 如何创建既线程安全又不可变的集合？

```java
// 方法一：先不可变，再同步（外层同步无用）
Map<String, Integer> map = Collections.unmodifiableMap(new HashMap<>());

// 方法二：Deeply Unmodifiable（JDK 10+）
Map<String, List<String>> nested = Map.of("key", List.of("a", "b"));
// 外层不可变，但内层 List 仍然可变

// 方法三：手动实现
public class ImmutableMap<K, V> {
    private final Map<K, V> map;
    
    public ImmutableMap(Map<K, V> map) {
        this.map = Collections.unmodifiableMap(new HashMap<>(map));
    }
    
    public V get(K key) {
        return map.get(key);
    }
}
```

---

## 留给你的思考题

Collections 类有一个方法叫 `nCopies()`，你知道它是做什么的吗？

```java
List<String> list = Collections.nCopies(5, "hello");
System.out.println(list);  // [hello, hello, hello, hello, hello]
```

提示：这个方法返回一个特殊的 List，它的内存效率非常高——所有元素都共享同一个引用。

思考：这个特性有什么应用场景？又有什么潜在风险？

理解这个问题，你就掌握了 Collections 工具类的精髓。
