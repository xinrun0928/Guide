# ArrayList vs LinkedList：选错数据结构，性能差 100 倍

你有过这种经历吗？

明明写的是 List，用的是 LinkedList，结果代码跑起来比 ArrayList 慢了 10 倍。

或者反过来——你以为 ArrayList 万能，结果往中间插数据的逻辑卡成了 PPT。

这不是你代码的问题，是数据结构选型的问题。

## 先看一个真实的性能测试

```java
public class PerformanceTest {
    private static final int N = 100_000;
    
    public static void main(String[] args) {
        // 场景1：尾部追加
        test("尾部追加 ArrayList", () -> {
            ArrayList<Integer> list = new ArrayList<>();
            for (int i = 0; i < N; i++) list.add(i);
        });
        
        test("尾部追加 LinkedList", () -> {
            LinkedList<Integer> list = new LinkedList<>();
            for (int i = 0; i < N; i++) list.add(i);
        });
        
        // 场景2：头部插入
        test("头部插入 ArrayList", () -> {
            ArrayList<Integer> list = new ArrayList<>();
            for (int i = 0; i < N; i++) list.add(0, i);
        });
        
        test("头部插入 LinkedList", () -> {
            LinkedList<Integer> list = new LinkedList<>();
            for (int i = 0; i < N; i++) list.addFirst(i);
        });
        
        // 场景3：随机访问
        test("随机访问 ArrayList", () -> {
            ArrayList<Integer> list = new ArrayList<>(N);
            for (int i = 0; i < N; i++) list.add(i);
            for (int i = 0; i < N; i++) list.get((i * 7) % N);
        });
        
        test("随机访问 LinkedList", () -> {
            LinkedList<Integer> list = new LinkedList<>();
            for (int i = 0; i < N; i++) list.add(i);
            for (int i = 0; i < N; i++) list.get((i * 7) % N);
        });
    }
}
```

典型结果（N = 100,000）：

| 场景 | ArrayList | LinkedList | 差距 |
|-----|-----------|------------|------|
| 尾部追加 | 15ms | 85ms | **5.6x** |
| 头部插入 | 2800ms | 25ms | **112x** |
| 随机访问 | 8ms | 1200ms | **150x** |

**结论**：两者各有优势，选错就是灾难。

## 底层结构：数组 vs 链表

这是两者最根本的区别。

### ArrayList：连续的内存空间

```java
// ArrayList 内部
transient Object[] elementData;

// 内存布局
// [ elem0 | elem1 | elem2 | elem3 | elem4 | ... | null | null | null ]
//   地址连续，空间连续
```

ArrayList 的数组在内存中是**连续**的。这带来了两个特性：

1. **优点**：CPU 缓存一行可以加载多个元素（缓存友好）
2. **缺点**：插入/删除需要移动后面的元素

### LinkedList：离散的节点

```java
// LinkedList 内部
private static class Node<E> {
    E item;
    Node<E> next;
    Node<E> prev;
}

// 内存布局
// [ elem0 ] -> [ elem1 ] -> [ elem2 ] -> [ elem3 ]
//   地址随机，节点独立
```

LinkedList 的节点在内存中是**离散**的。每个节点记录前后的引用。

1. **优点**：插入/删除只需修改前后指针
2. **缺点**：无法利用 CPU 缓存，每次访问都要遍历

## 时间复杂度对比

| 操作 | ArrayList | LinkedList | 胜者 |
|-----|-----------|------------|------|
| get(int index) | O(1) | O(n) | ArrayList |
| add(E element) | O(1) amortized | O(1) | 平手 |
| add(int index, E) | O(n) | O(n) | 平手 |
| remove(int index) | O(n) | O(n) | 平手 |
| addFirst() | O(n) | O(1) | LinkedList |
| addLast() | O(1) amortized | O(1) | 平手 |
| removeFirst() | O(n) | O(1) | LinkedList |

**等等，为什么 add(int index, E) 都是 O(n)？**

因为 LinkedList 需要先找到插入位置——这一步是 O(n)。只有找到位置后，插入才是 O(1)。

```java
// LinkedList 在中间插入
public void add(int index, E element) {
    checkPositionIndex(index);
    if (index == size) {
        linkLast(element);  // O(1)
    } else {
        linkBefore(element, node(index));  // 先找位置：O(n)
    }
}

// ArrayList 在中间插入
public void add(int index, E element) {
    System.arraycopy(elementData, index, elementData, index + 1, size - index);
    // 需要移动 index 之后的所有元素：O(n)
}
```

## 空间复杂度对比

### ArrayList：固定开销 + 预留空间

```java
ArrayList<String> list = new ArrayList<>();
// 内部数组：空，预留 0 字节

list.add("Java");
// 内部数组：[Java, null, null, null, null, null, null, null, null, null]
// 有效数据：1 个元素
// 预留空间：9 个 null 引用 = ~72 字节（64位JVM）

// 扩容后
list.add("Python");  // ... 继续添加，到容量 15
list.add("Go");
list.add("Rust");
// 内部数组：[Java, Python, Go, Rust, null, null, null, ...]
// 旧数组被废弃，容量 15 的新数组存在
// 容量 10 的旧数组等待 GC：浪费 ~64 字节
```

ArrayList 的空间开销：
- 数组本身：一个对象头 + 每个元素一个引用（4 或 8 字节）
- 预留空间：扩容时旧数组被遗弃

### LinkedList：每个节点都有额外开销

```java
LinkedList<String> list = new LinkedList<>();
list.add("Java");
// 节点结构：
// [ prev=null | Java | next=... ]

// 节点内存布局（64位 JVM）
// Java 对象头：12 字节
// item 引用：8 字节
// prev 引用：8 字节
// next 引用：8 字节
// 对齐填充：4 字节
// 总计：40 字节/节点
```

LinkedList 的空间开销：
- 每个节点：40 字节（比 ArrayList 多 32 字节）
- 双向指针 prev + next：额外 16 字节/节点

### 空间对比结论

```
存储 1000 个字符串（每个字符串 16 字节引用）：

ArrayList：
- 数组：1000 * 8 = 8KB
- 总计：~8KB

LinkedList：
- 每个节点：40 字节
- 1000 个节点：40KB
- 总计：~40KB
```

LinkedList 比 ArrayList 多占用 **5 倍**的空间。

## 缓存命中率的秘密

这是 ArrayList 最被低估的优势。

### CPU 缓存机制

当 CPU 访问内存时，会把**相邻的数据**一起加载到缓存（一行通常是 64 字节）。

```java
ArrayList<Integer> list = new ArrayList<>(1000);
for (int i = 0; i < 1000; i++) list.add(i);

// 遍历时
for (int i = 0; i < 1000; i++) {
    int x = list.get(i);  // 顺序访问，缓存命中率高
}
```

顺序访问 ArrayList 时：
- 第一次 get(0)：加载 ~64 字节到缓存（8 个 Integer）
- 接下来 7 次 get()：直接从缓存读，**不需要访问内存**

### LinkedList 的缓存灾难

```java
LinkedList<Integer> list = new LinkedList<>();
for (int i = 0; i < 1000; i++) list.add(i);

// 遍历时
for (int i = 0; i < 1000; i++) {
    int x = list.get(i);  // 每次都要 follow 指针
}
```

遍历 LinkedList 时：
- get(0)：加载节点 0
- get(1)：**缓存不命中**，加载节点 1（节点在内存中是随机的）
- get(2)：**缓存不命中**，加载节点 2
- ...每次 get 都是一次内存访问

### 真实测试

```java
// 测试缓存对性能的影响
public class CacheTest {
    public static void main(String[] args) {
        int size = 1_000_000;
        
        // ArrayList 遍历
        ArrayList<Integer> al = new ArrayList<>(size);
        for (int i = 0; i < size; i++) al.add(i);
        
        long start = System.nanoTime();
        int sum = 0;
        for (int i = 0; i < size; i++) sum += al.get(i);
        long alTime = System.nanoTime() - start;
        
        // LinkedList 遍历
        LinkedList<Integer> ll = new LinkedList<>();
        for (int i = 0; i < size; i++) ll.add(i);
        
        start = System.nanoTime();
        sum = 0;
        for (int i = 0; i < size; i++) sum += ll.get(i);
        long llTime = System.nanoTime() - start;
        
        System.out.println("ArrayList: " + alTime / 1_000_000 + "ms");
        System.out.println("LinkedList: " + llTime / 1_000_000 + "ms");
        System.out.println("差距: " + llTime / alTime + "x");
    }
}
```

典型结果：LinkedList 比 ArrayList 慢 **10-100 倍**。

## 迭代器性能对比

### ArrayList 的迭代器

```java
ArrayList<Integer> list = new ArrayList<>(1000);

// Iterator 是数组索引遍历
Iterator<Integer> it = list.iterator();
while (it.hasNext()) {
    Integer x = it.next();  // 直接通过索引访问
}
```

迭代器遍历也是 O(1) 的，性能与直接用 for-i 循环相当。

### LinkedList 的迭代器

```java
LinkedList<Integer> list = new LinkedList<>();

// Iterator 保存了当前位置
Iterator<Integer> it = list.iterator();
while (it.hasNext()) {
    Integer x = it.next();  // 从当前位置向后移动
}
```

由于迭代器保存了当前节点的引用，`next()` 只需要 `current = current.next`，这是 O(1) 操作。

**重要结论**：`LinkedList` 用迭代器遍历不慢！真正慢的是 `get(index)` 随机访问。

## 选择指南

```
你的使用场景是什么？

├── 主要操作是什么？
│   ├── 尾部追加 / 随机访问 → ArrayList
│   ├── 头部插入 / 双端操作 → LinkedList 或 ArrayDeque
│   └── 中间插入/删除 → ArrayList (数据量小) / LinkedList (数据量大)
│
├── 数据量多大？
│   ├── < 1000 → 两者差别不大，按喜好选择
│   ├── 1000 - 100000 → ArrayList 通常更快
│   └── > 100000 → 考虑内存和缓存命中率
│
├── 内存敏感吗？
│   ├── 是 → ArrayList（节省 5 倍空间）
│   └── 否 → 都可以
│
└── 线程安全需要吗？
    ├── 是 → CopyOnWriteArrayList
    └── 否 → ArrayList 或 LinkedList
```

## 常见误区

### 误区1：LinkedList 插入一定比 ArrayList 快

只有在**头部插入**时才是，在**尾部追加**时 ArrayList 反而更快（因为 LinkedList 需要创建节点对象）。

### 误区2：数据量大时应该用 LinkedList

错了！数据量越大，ArrayList 的缓存优势越明显。只有在头部/尾部频繁操作的场景，LinkedList 才有优势。

### 误区3：LinkedList 比 ArrayList 省内存

错！LinkedList 每个节点有 prev 和 next 指针，空间开销是 ArrayList 的 5 倍。

## 实际开发建议

```java
// 99% 的场景用 ArrayList
List<String> list = new ArrayList<>();

// 只有明确需要双端操作时才用 LinkedList
Deque<String> deque = new LinkedList<>();  // 显式声明为 Deque 类型

// ArrayDeque 是更好的「队列」选择（后面会讲）
Queue<String> queue = new ArrayDeque<>();   // 比 LinkedList 更快
```

## 面试追问方向

1. **ArrayList 和 LinkedList 的 fail-fast 机制有什么区别？**

两者都是 fail-fast，通过 modCount 实现。迭代器内部维护 `expectedModCount = modCount`，每次 next/remove 都检查，不一致就抛异常。**没有区别**。

2. **LinkedList 能否用二分查找优化 get？**

不能。链表不支持随机访问，二分查找无法通过索引 O(1) 定位中间元素。只能用跳表等特殊结构。

3. **什么情况下 LinkedList 比 ArrayList 更节省内存？**

元素是**大对象**时。当单个元素本身就很大（比如几 KB），prev/next 指针的 16 字节开销可以忽略不计。但这种情况极少。

4. **JDK 为什么把 ArrayList 的迭代器设计成随机访问优化？**

ArrayList 的迭代器内部用 `cursor` 索引而非节点引用。迭代时直接通过 `elementData[cursor++]` 访问，利用了数组的缓存友好性。这是设计上的细节优化。

---

选 ArrayList 还是 LinkedList，本质上是在选「随机访问优先」还是「插入删除优先」。大多数业务场景下，ArrayList 都是更好的选择——因为你的代码里，遍历和随机访问远远多于头部插入。

下一节，我们进入 HashMap 的世界，看看另一种完全不同的数据结构。
