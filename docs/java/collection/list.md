# List 集合：ArrayList、LinkedList、Vector 三国演义

如果你要存储一组有序的数据，你会选什么？

大多数人第一反应是「数组」。但数组有个致命问题——长度固定，满了就得换个大数组。

于是 `List` 接口诞生了，它让数组有了「成长」的能力。

## List 是什么？

`List` 是有序、可重复的集合。你可以把它理解为一个「可以自动扩容的数组」：

```java
List<String> list = new ArrayList<>();
list.add("Java");      // [Java]
list.add("Python");    // [Java, Python]
list.add("Java");      // [Java, Python, Java] - 允许重复
System.out.println(list.get(0));  // Java - 可以用索引访问
```

List 的核心特性：

| 特性 | 说明 |
|-----|-----|
| 有序 | 元素按插入顺序存储 |
| 可重复 | 同一元素可以出现多次 |
| 有索引 | 支持 `get(index)` 随机访问 |
| 可变长 | 自动扩容，无需手动管理 |

## ArrayList：性能优先的选择

`ArrayList` 是 List 接口的**默认实现**，也是日常开发中使用最频繁的集合。

### 底层结构

ArrayList 底层是一个**动态数组**：

```java
// ArrayList 内部核心字段
public class ArrayList<E> {
    transient Object[] elementData;  // 存储元素的数组
    private int size;                // 当前元素数量
}
```

当你创建一个 ArrayList 时，它长这样：

```java
ArrayList<String> list = new ArrayList<>();
// elementData = [] (空数组，懒加载)
```

第一次 `add()` 时才会初始化数组（默认容量 10）：

```java
list.add("Java");
// elementData = [Java, null, null, null, null, null, null, null, null, null]
```

### ArrayList 的优缺点

```java
List<String> list = new ArrayList<>();

// 优点：随机访问 O(1)
String first = list.get(0);          // 极快

// 缺点：中间插入/删除 O(n)
list.add(5, "NewElement");           // 需要移动后面所有元素
```

| 操作 | 时间复杂度 | 说明 |
|-----|-----------|-----|
| get(index) | O(1) | 数组下标直接访问 |
| add(E element) | O(1) |  amortized，分摊后的复杂度 |
| add(index, E) | O(n) | 插入位置后的元素都要后移 |
| remove(index) | O(n) | 删除位置后的元素都要前移 |
| contains() | O(n) | 需要遍历数组 |

### 容量与扩容

ArrayList 会自动扩容，但这不是没有代价的：

```java
// 预知容量时，指定初始容量可以减少扩容次数
ArrayList<String> list = new ArrayList<>(1000);
// 避免了边添加边扩容的性能损耗
```

扩容策略：**新容量 = 旧容量 + 旧容量 / 2**（即 1.5 倍）

```java
// 容量 10 → 15 → 22 → 33 → 49 → ...
```

### 适用场景

ArrayList 适合这些场景：

- 需要高效的**随机访问**
- 主要在**尾部**进行添加/删除
- 不关心线程安全（单线程或外部同步）

## LinkedList：头部/尾部操作的优势

`LinkedList` 底层是**双向链表**，每个节点记录前一个和后一个节点的引用：

```java
// 链表节点结构
class Node<E> {
    E item;
    Node<E> prev;
    Node<E> next;
}
```

### LinkedList 的独特能力

LinkedList 同时实现了 `List` 和 `Deque` 接口，这意味着它可以在**两端**高效操作：

```java
LinkedList<String> list = new LinkedList<>();

// List 操作（效率一般）
list.add("middle");
list.get(0);          // O(n)，需要遍历

// Deque 操作（效率极高）
list.addFirst("first");   // O(1)
list.addLast("last");      // O(1)
list.removeFirst();       // O(1)
list.removeLast();         // O(1)
```

### LinkedList vs ArrayList 对比

| 操作 | ArrayList | LinkedList |
|-----|-----------|------------|
| get(0) | O(1) | O(1) |
| get(n/2) | O(1) | O(n) |
| add() 尾部 | O(1) amortized | O(1) |
| add(0) 头部 | O(n) | O(1) |
| remove(0) 头部 | O(n) | O(1) |
| remove(n/2) 中间 | O(n) | O(n) |
| 迭代器 | 快（缓存友好） | 较慢（指针跳转） |

### 适用场景

LinkedList 适合这些场景：

- 需要频繁在**头部或尾部**操作
- 不需要随机访问（总是从头/尾遍历）
- 实现**栈**或**队列**数据结构

## Vector：曾经的王者，如今的备选

`Vector` 是一个**线程安全**的 ArrayList：

```java
// Vector 的方法都加了 synchronized
public synchronized boolean add(E e) {
    modCount++;
    ensureCapacityHelper(elementCount + 1);
    elementData[elementCount++] = e;
    return true;
}
```

### Vector vs ArrayList

| 特性 | Vector | ArrayList |
|-----|--------|-----------|
| 线程安全 | synchronized | 非同步 |
| 性能 | 较低（有锁开销） | 较高 |
| 扩容策略 | 2 倍（oldCapacity * 2） | 1.5 倍（更保守） |
| 迭代器 | Enumeration | Iterator |

### 为什么不再推荐 Vector？

1. **性能差**：每个方法都有 synchronized，开销大
2. **替代品更好**：需要线程安全时，用 `CopyOnWriteArrayList` 或 `Collections.synchronizedList()`
3. **扩容太激进**：2 倍扩容容易造成空间浪费

### synchronizedList 包装

如果你真的需要线程安全的 List，推荐用 `Collections.synchronizedList()`：

```java
List<String> syncList = Collections.synchronizedList(new ArrayList<>());
// 只有操作方法加锁，遍历需要手动同步
synchronized (syncList) {
    for (String s : syncList) {
        System.out.println(s);
    }
}
```

## Stack：老派的选择

`Stack` 继承自 Vector，是一种**后进先出**（LIFO）的数据结构：

```java
Stack<Integer> stack = new Stack<>();
stack.push(1);      // 入栈
stack.push(2);
int top = stack.pop();   // 出栈，返回 2
int peek = stack.peek(); // 查看栈顶，返回 1
```

### Stack 的问题

Stack 的设计有缺陷：

1. **继承 Vector**：Stack 本质是 Vector，继承这种「实现」破坏了封装
2. **方法命名不规范**：`pop()`/`push()`/`peek()` 混在一起
3. **线程安全但性能差**：继承自 Vector 的 synchronized

### 更好的替代：Deque

JDK 推荐用 `Deque` 替代 Stack：

```java
Deque<Integer> stack = new ArrayDeque<>();

// Stack 操作
stack.push(1);
stack.push(2);
int pop = stack.pop();    // 2
int peek = stack.peek();  // 1

// ArrayDeque 比 Stack 更快（后面会讲为什么）
```

## 选择指南

面对 ArrayList、LinkedList、Vector、Stack，你会怎么选？

```
需要线程安全吗？
├── 否 → 需要高效随机访问？ → ArrayList
│        ├── 否 → 需要两端操作？ → LinkedList
│        └── 是 → LinkedList 或 ArrayDeque
└── 是 → 需要高效并发读？ → CopyOnWriteArrayList
         └── 普通场景 → Collections.synchronizedList(ArrayList)
```

| 场景 | 推荐选择 |
|-----|---------|
| 普通列表操作 | ArrayList |
| 频繁头部插入 | LinkedList 或 ArrayDeque |
| 模拟栈/队列 | ArrayDeque（不推荐 Stack） |
| 读多写少并发 | CopyOnWriteArrayList |
| 旧代码维护 | Vector（尽量迁移） |

## 性能陷阱：一个实验

来看看 ArrayList 和 LinkedList 在实际场景中的性能差异：

```java
public class ListPerformanceTest {
    public static void main(String[] args) {
        int N = 100_000;
        
        // 场景1：尾部追加
        testAddLast(new ArrayList<>(), N);     // ~10ms
        testAddLast(new LinkedList<>(), N);    // ~50ms
        
        // 场景2：头部插入
        testAddFirst(new ArrayList<>(), N);    // ~2000ms
        testAddFirst(new LinkedList<>(), N);   // ~30ms
        
        // 场景3：中间插入
        testAddMiddle(new ArrayList<>(), N);    // ~1500ms
        testAddMiddle(new LinkedList<>(), N);  // ~800ms
    }
}
```

尾部追加时，ArrayList 比 LinkedList 快——因为数组追加只需赋值，而 LinkedList 需要创建节点对象。

头部插入时，LinkedList 完胜——因为 ArrayList 需要移动所有元素。

## 面试追问方向

1. **ArrayList 是线程安全的吗？如果不是，多线程下使用 ArrayList 会有什么问题？**

不安全。主要问题：add() 可能覆盖数据、size() 和 get() 可能越界、扩容时可能数组越界。解决方案：用 `Vector`（不推荐，性能差）或 `Collections.synchronizedList()` 包装。

2. **ArrayList 的 iterator 是 fail-fast 还是 fail-safe？**

fail-fast。当迭代过程中发现集合被修改（modCount 变化），会快速失败并抛出 `ConcurrentModificationException`。

3. **为什么 LinkedList 实现了 List 接口还要实现 Deque？**

因为 LinkedList 的核心价值就是双端操作的高效性。实现 Deque 接口让它的身份更明确——它本质上是一个「队列」而不是「列表」。

---

List 的世界很精彩，但它的有序性来自于底层的数组或链表。理解了这一点，你就掌握了 List 的本质。下一节，我们来看看 ArrayList 的扩容机制——这个面试常考的细节。
