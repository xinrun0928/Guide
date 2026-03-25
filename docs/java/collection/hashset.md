# HashSet：看似简单，内藏玄机

你用过 HashSet 吗？

```java
Set<String> set = new HashSet<>();
set.add("Java");
set.add("Python");
set.add("Java");  // 第二次添加会失败

System.out.println(set.size());  // 2，不是 3
```

大多数人用 HashSet 就是为了去重。但你知道它是怎么实现去重的吗？

**HashSet = HashMap + 一个空对象**。就这么简单，又这么巧妙。

## HashSet 的秘密：它根本不是「集合」

打开 HashSet 的源码，你会惊讶地发现——它根本没有自己的数据结构。

```java
public class HashSet<E> extends AbstractSet<E> implements Set<E> {
    // 底层依赖 HashMap
    private transient HashMap<E, Object> map;
    
    // HashSet 不需要 value，用一个固定的对象充当
    private static final Object PRESENT = new Object();
}
```

没错，HashSet 就是一个**披着 Set 外衣的 HashMap**。

## add() 方法的真相

当你调用 `set.add("Java")` 时：

```java
public boolean add(E e) {
    // 调用的其实是 HashMap 的 put()
    return map.put(e, PRESENT) == null;
}
```

存入的元素变成了 **HashMap 的 key**，而 value 是一个固定的空对象 `PRESENT`。

为什么 HashMap 的 `put()` 能实现去重？因为 HashMap 的 key 本身就是不可重复的。

## remove() 方法同样委托

```java
public boolean remove(Object o) {
    return map.remove(o) == PRESENT;
}
```

删除操作也是委托给 HashMap。

## 为什么 value 用固定对象？

因为 HashMap 需要 value——它不允许 key 为 null，但 value 可以是任意对象。

用 `PRESENT` 的好处：
1. **节省内存**：所有元素共用一个 `PRESENT` 对象，而不是每个元素创建新对象
2. **判断方便**：`put()` 返回 null 表示新增成功，返回旧值表示覆盖失败

```java
// HashMap.put() 的返回值设计
V put(K key, V value);
// 返回 null 表示 key 不存在（新增成功）
// 返回旧值表示 key 已存在（覆盖）

// HashSet 利用这一点
return map.put(e, PRESENT) == null;
// 如果返回 null，说明新增成功，返回 true
// 如果返回 PRESENT，说明已存在，返回 false
```

## HashSet 的核心特性

| 特性 | 说明 |
|-----|-----|
| 底层结构 | HashMap（数组 + 链表/红黑树） |
| 元素顺序 | 无序（不保证任何顺序） |
| 允许 null | 允许一个 null 元素 |
| 线程安全 | 非线程安全 |
| 性能 | O(1) 的 add/remove/contains |

## 无序性证明

```java
Set<Integer> set = new HashSet<>();
set.add(3);
set.add(1);
set.add(4);
set.add(1);
set.add(5);
set.add(9);
set.add(2);
set.add(6);

// 迭代顺序：不一定等于插入顺序
// 可能输出：[1, 2, 3, 4, 5, 9]（任意顺序）
for (Integer i : set) {
    System.out.print(i + " ");
}
```

HashSet 的迭代顺序取决于：
- 元素的 hashCode()
- 数组容量
- 插入顺序

**如果你需要有序的 Set，请用 LinkedHashSet（插入顺序）或 TreeSet（自然顺序）**。

## HashSet vs ArrayList 去重

两种方式都可以去重，但性能差异巨大：

```java
public class DeduplicationTest {
    private static final int N = 100_000;
    
    public static void main(String[] args) {
        List<Integer> list = new ArrayList<>();
        for (int i = 0; i < N; i++) {
            list.add(i % 1000);  // 只有 1000 个不同的值
        }
        
        // 方式1：ArrayList + contains（O(n²)）
        long start = System.nanoTime();
        List<Integer> dedup1 = new ArrayList<>();
        for (Integer i : list) {
            if (!dedup1.contains(i)) {
                dedup1.add(i);
            }
        }
        System.out.println("ArrayList: " + (System.nanoTime() - start) / 1_000_000 + "ms");
        
        // 方式2：HashSet（O(n)）
        start = System.nanoTime();
        Set<Integer> dedup2 = new HashSet<>(list);
        System.out.println("HashSet: " + (System.nanoTime() - start) / 1_000_000 + "ms");
    }
}
```

典型结果（N = 100,000）：

| 方式 | 耗时 | 复杂度 |
|-----|-----|-------|
| ArrayList | ~5000ms | O(n²) |
| HashSet | ~10ms | O(n) |

差距可达 **500 倍**！

## HashSet 的构造方法

```java
// 默认构造：初始容量 16，负载因子 0.75
Set<String> set1 = new HashSet<>();

// 指定初始容量
Set<String> set2 = new HashSet<>(100);

// 指定初始容量和负载因子
Set<String> set3 = new HashSet<>(100, 0.5f);

// 从现有集合创建
Set<String> set4 = new HashSet<>(existingList);
```

### 初始容量与负载因子的影响

```java
// 反面教材：大量数据，小初始容量
Set<String> set = new HashSet<>();
for (int i = 0; i < 1_000_000; i++) {
    set.add("value" + i);  // 不断扩容，性能下降
}

// 正面教材：预估容量，一次到位
Set<String> set = new HashSet<>(1_500_000);
for (int i = 0; i < 1_000_000; i++) {
    set.add("value" + i);  // 减少扩容次数
}
```

## contains() 的性能

HashSet 的 `contains()` 是 O(1) 操作：

```java
public boolean contains(Object o) {
    return map.containsKey(o);
}
```

这是 HashSet 最重要的优势之一。当需要快速判断「某个元素是否存在」时，用 HashSet 而不是 ArrayList：

```java
// 判断元素是否存在
List<String> list = new ArrayList<>();  // O(n)
Set<String> set = new HashSet<>();        // O(1)

// 场景：过滤重复请求
Set<String> processedIds = new HashSet<>();
for (Request req : requests) {
    if (processedIds.contains(req.getId())) {
        continue;  // 跳过已处理的请求
    }
    processedIds.add(req.getId());
    process(req);
}
```

## HashSet 的局限性

### 不保证元素顺序

```java
Set<Integer> set = new HashSet<>();
set.add(5);
set.add(3);
set.add(1);
set.add(4);
set.add(2);

// 迭代顺序不确定，可能是任意顺序
```

需要有序？用这些替代：

| 需求 | 替代方案 |
|-----|---------|
| 保持插入顺序 | LinkedHashSet |
| 自然顺序排序 | TreeSet |
| 自定义顺序排序 | TreeSet + Comparator |

### 不支持按索引访问

```java
Set<Integer> set = new HashSet<>();
set.add(1);

// 不能这样用！
// set.get(0);  // 编译错误

// 只能遍历
for (Integer i : set) { ... }
```

### 非线程安全

```java
// 多线程环境下不安全
Set<Integer> set = new HashSet<>();
// 线程 A: set.add(1)
// 线程 B: set.add(2)
// 可能：数据丢失、ConcurrentModificationException

// 线程安全版本
Set<Integer> set = Collections.synchronizedSet(new HashSet<>());
// 或者用 ConcurrentHashMap.newKeySet()
```

## 与 HashMap 的关系图解

```
HashSet 的本质
┌─────────────────────────────────────────┐
│  HashSet<E>                             │
│  ┌───────────────────────────────────┐  │
│  │  HashMap<E, Object>               │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │  数组 + 链表/红黑树           │  │  │
│  │  │  ┌─────┬─────┬─────┬─────┐   │  │  │
│  │  │  │key1 │key2 │key3 │ ... │   │  │  │
│  │  │  │val  │val  │val  │     │   │  │  │
│  │  │  └─────┴─────┴─────┴─────┘   │  │  │
│  │  │  PRESENT = new Object()      │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## 面试追问方向

1. **HashSet 是如何保证元素不重复的？**

通过 HashMap 的 key 不可重复特性保证。HashMap 在 put 时会先比较 hashCode()，hash 相同时再比较 equals()，都相同则覆盖。

2. **HashSet 和 HashMap 的关系是什么？**

HashSet 内部使用 HashMap 存储数据，元素作为 key，固定的 PRESENT 对象作为 value。HashSet 的所有操作都是对 HashMap 的委托。

3. **HashSet 的初始容量为什么是 16？**

这是 HashMap 的默认值。16 是 2 的幂次，便于用位运算计算下标。负载因子 0.75 是在空间和时间之间的平衡点。

4. **HashSet 能否存入两个 equals() 返回 true 但 hashCode() 不同的对象？**

能存入，但违反了 hashCode() 和 equals() 的契约。这种情况下，它们会被视为不同的 key，无法通过 HashSet 的 contains() 正确判断相等性。

5. **HashSet 在 JDK 8 中有什么优化？**

与 HashMap 同步优化：链表长度超过 8 时转为红黑树、扰动函数简化、扩容时不重新计算 hash。

---

HashSet 看起来简单，但背后的设计思想很精妙——用已有的 HashMap 实现去重功能，而不是重复造轮子。这种「组合优于继承」的设计模式，在 Java 源码中随处可见。

下一节，我们深入 HashMap 的底层结构，看看这个核心数据结构是如何工作的。
