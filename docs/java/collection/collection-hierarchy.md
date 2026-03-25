# Collection 接口：Java 集合的「大纲」

你有没有想过，为什么 Java 的集合框架能统一管理这么多不同的数据结构？

ArrayList、HashSet、LinkedList、PriorityQueue……表面上看起来毫无关联，但它们都继承自同一个「老祖宗」——`Collection` 接口。

这个接口，就是 Java 集合框架的「大纲」。

## 从 Iterable 开始的继承体系

在 Java 中，所有集合都遵循一个清晰的继承层次：

```
Iterable<T>
    └── Collection<T>
            ├── List<T>        (有序、可重复)
            │       ├── ArrayList
            │       ├── LinkedList
            │       ├── Vector
            │       └── Stack
            ├── Set<T>         (无序、不可重复)
            │       ├── HashSet
            │       ├── LinkedHashSet
            │       └── TreeSet
            └── Queue<T>       (队列操作)
                    ├── Deque<T>
                    │       ├── ArrayDeque
                    │       ├── LinkedList
                    │       └── LinkedBlockingDeque
                    ├── BlockingQueue<T>
                    │       ├── ArrayBlockingQueue
                    │       ├── LinkedBlockingQueue
                    │       └── PriorityBlockingQueue
                    └── PriorityQueue<T>
```

`Iterable` 接口只有一个小小的能力：**可以被迭代**（遍历）。它只有一个方法：

```java
public interface Iterable<T> {
    Iterator<T> iterator();
}
```

只要实现了这个接口，你就能用 `for-each` 循环：

```java
for (String s : list) {
    System.out.println(s);
}
```

## Collection 接口：集合的「最小公约数」

`Collection` 继承自 `Iterable`，它定义了所有集合都必须具备的基本能力：

```java
public interface Collection<E> extends Iterable<E> {
    // 增删改查
    boolean add(E e);           // 添加元素
    boolean remove(Object o);   // 删除元素
    boolean contains(Object o); // 是否包含
    
    // 批量操作
    boolean addAll(Collection<? extends E> c);
    boolean removeAll(Collection<?> c);
    boolean retainAll(Collection<?> c);  // 取交集
    boolean containsAll(Collection<?> c);
    
    // 通用方法
    int size();
    boolean isEmpty();
    void clear();
    Object[] toArray();
    <T> T[] toArray(T[] a);
    
    // 迭代器
    Iterator<E> iterator();
    
    // 流操作 (JDK 8+)
    default Stream<E> stream();
    default Stream<E> parallelStream();
}
```

这些方法是所有集合的「最小公约数」——不管你用的是 ArrayList 还是 HashSet，这些操作都必须支持。

## List：有序帝国的「居民」

`List` 是最常用的集合接口，它的特点是**有序、可重复**：

```java
public interface List<E> extends Collection<E> {
    // 索引操作（List 特有）
    E get(int index);
    E set(int index, E element);
    void add(int index, E element);
    E remove(int index);
    
    // 搜索
    int indexOf(Object o);
    int lastIndexOf(Object o);
    
    // 切片
    List<E> subList(int fromIndex, int toIndex);
    
    // 迭代器增强
    ListIterator<E> listIterator();
    ListIterator<E> listIterator(int index);
}
```

**有序**意味着你可以用索引访问元素，元素的顺序就是插入的顺序（或者你手动排序后的顺序）。

**可重复**意味着你可以添加相同的元素多次：

```java
List<String> list = new ArrayList<>();
list.add("Java");
list.add("Java");  // 允许！
list.add("Python");
System.out.println(list);  // [Java, Java, Python]
```

List 的主要实现类：

| 实现类 | 底层结构 | 随机访问 | 插入删除 | 线程安全 |
|-------|---------|---------|---------|---------|
| ArrayList | 动态数组 | O(1) | O(n) | 否 |
| LinkedList | 双向链表 | O(n) | O(1) | 否 |
| Vector | 动态数组 | O(1) | O(n) | 是（synchronized） |
| Stack | Vector | O(1) | O(n) | 是 |

## Set：唯一性强迫症患者

`Set` 的特点就一个字：**不重复**。

```java
public interface Set<E> extends Collection<E> {
    // 没有新增独特方法，只是行为约束不同
    // add() 如果元素已存在，返回 false
    // 不能通过索引访问（无序）
}
```

当你调用 `add("Java")` 两次时，第二次会返回 `false`，因为 "Java" 已经存在了：

```java
Set<String> set = new HashSet<>();
set.add("Java");
boolean success = set.add("Java");  // false，添加失败
System.out.println(set.size());     // 1，不是 2
```

Set 的主要实现类：

| 实现类 | 底层结构 | 元素顺序 | 允许 null |
|-------|---------|---------|-----------|
| HashSet | 哈希表 | 无序 | 允许 |
| LinkedHashSet | 哈希表 + 链表 | 插入顺序 | 允许 |
| TreeSet | 红黑树 | 自然顺序/自定义 | 否 |

## Queue：排队的艺术

`Queue` 是一种特殊的集合，专门用于**队列操作**——FIFO（先进先出）。

```java
public interface Queue<E> extends Collection<E> {
    // 成功返回 true，失败抛异常
    boolean add(E e);
    
    // 成功返回 true，失败返回 false
    boolean offer(E e);
    
    // 移除并返回队首，空队列抛异常
    E remove();
    
    // 移除并返回队首，空队列返回 null
    E poll();
    
    // 返回队首但不移除，空队列抛异常
    E element();
    
    // 返回队首但不移除，空队列返回 null
    E peek();
}
```

为什么有两套方法？这是设计模式中的「双重保险」：

| 方法 | 队列满时 | 队列空时 |
|-----|---------|---------|
| add()/remove()/element() | 抛异常 | 抛异常 |
| offer()/poll()/peek() | 返回 false/null | 返回 false/null |

**实际使用建议**：优先用 `offer()`/`poll()`/`peek()`，它们更安全，不会因为队列状态变化而抛异常。

## Deque：双端队列——排队排两头

`Deque`（Double Ended Queue）是 Queue 的扩展，支持在**两端**进行操作：

```java
public interface Deque<E> extends Queue<E> {
    // 队首操作
    void addFirst(E e);
    void addLast(E e);
    E removeFirst();
    E removeLast();
    
    // 队尾操作（Deque 独有）
    E getFirst();
    E getLast();
}
```

Deque 的应用场景：

- **栈**（Stack）：`push()`/`pop()`/`peek()` 在队首操作
- **队列**（Queue）：`offer()`/`poll()`/`peek()` 在队尾操作
- **双端队列**：两端都可以进出

```java
Deque<String> deque = new ArrayDeque<>();

// 当栈用
deque.push("A");
deque.push("B");
System.out.println(deque.pop());  // B

// 当队列用
deque.offer("C");
deque.offer("D");
System.out.println(deque.poll());  // C
```

## 三大操作族对比

| 操作类型 | Queue | Deque | List |
|---------|-------|-------|------|
| 队首添加 | offer() | addFirst()/offerFirst() | add(index, e) |
| 队尾添加 | offer() | addLast()/offerLast() | add(index, e) |
| 队首移除 | poll() | removeFirst()/pollFirst() | remove(index) |
| 队尾移除 | — | removeLast()/pollLast() | remove(index) |
| 队首查看 | peek() | getFirst()/peekFirst() | get(index) |
| 队尾查看 | peek() | getLast()/peekLast() | get(index) |

## 为什么要有这么多接口？

Java 集合框架采用接口分离的设计，不是吃饱了撑的，而是有深刻的设计意图：

1. **职责分离**：每个接口只关注一种能力
2. **组合灵活**：类可以实现多个接口
3. **多态应用**：方法参数用接口类型，接收任何实现类

```java
// 这个方法可以接收任何集合
public void process(Collection<String> collection) {
    for (String item : collection) {
        System.out.println(item);
    }
}

// 调用时传入任何实现
process(new ArrayList<>());   // OK
process(new HashSet<>());      // OK
process(new LinkedList<>());   // OK
```

## 面试追问方向

1. **ArrayList 和 LinkedList 都实现了 List 接口，为什么还要都实现 Deque？**

LinkedList 实现 Deque 是因为它确实可以在两端高效操作。ArrayList 不实现 Deque 是因为在数组头部操作需要移动所有元素，效率太低。

2. **为什么 Queue 继承自 Collection，而不是单独设计？**

因为 Queue 本质上还是集合的一种形态——一组元素的聚合。继承关系保证了所有集合操作（遍历、判空、批量处理）都能用在 Queue 上。

3. **如果让你设计一个只读的集合，你会怎么做？**

可以让集合实现 `Collections.unmodifiableXxx()` 包装后的版本，或者让底层实现抛 `UnsupportedOperationException`。

---

理解了整个 Collection 体系的结构后，下一步就是深入到每个实现类的细节。ArrayList 是如何动态扩容的？HashMap 的散列表是怎么工作的？让我们继续探索。
