# TreeSet：红黑树实现的有序集合

如果 LinkedHashSet 是「记住插入顺序」的 Set，那 TreeSet 就是「自动排序」的 Set。

但 TreeSet 的能力远不止排序——它的 **O(log n)** 查找、导航方法（lower/ceiling/higher 等）让它成为实现有序数据结构的利器。

## TreeSet 的本质

和 HashSet 依赖 HashMap 一样，TreeSet 依赖 **TreeMap**：

```java
public class TreeSet<E> extends AbstractSet<E> implements NavigableSet<E> {
    // 底层是 TreeMap
    private transient NavigableMap<E, Object> m;
    
    // 固定的 value
    private static final Object PRESENT = new Object();
    
    public TreeSet() {
        m = new TreeMap<>();
    }
}
```

TreeMap 底层是**红黑树**（Red-Black Tree），一种自平衡的二叉搜索树。

## 红黑树简介

红黑树是一种特殊的二叉搜索树，它有以下性质：

```
红黑树的性质：
1. 每个节点要么是红色，要么是黑色
2. 根节点是黑色
3. 叶子节点（NIL）是黑色
4. 红节点的子节点都是黑色（不能有两个连续的红节点）
5. 从任意节点到其每个叶子节点的所有路径都包含相同数量的黑节点
```

```
       黑
      /  \
    红    红        ← 不能有两个连续的红节点
    /\    /\
   黑  黑 黑  黑    ← 每条路径的黑节点数相同
```

### 红黑树 vs 链表 vs 平衡二叉树

| 结构 | 查找 | 插入 | 删除 | 平衡方式 |
|-----|------|------|------|---------|
| 链表 | O(n) | O(1) | O(1) | 无 |
| 理想平衡树 | O(log n) | O(log n) | O(log n) | 严格平衡（代价大） |
| 红黑树 | O(log n) | O(log n) | O(log n) | 近似平衡（代价小） |

红黑树不追求绝对平衡，但保证 **O(log n)** 的时间复杂度。

## TreeSet 的创建方式

```java
// 方式1：自然顺序（元素必须实现 Comparable）
TreeSet<Integer> set1 = new TreeSet<>();
set1.add(3);
set1.add(1);
set1.add(2);
// 迭代顺序：1 → 2 → 3

// 方式2：自定义比较器
TreeSet<String> set2 = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
set2.add("Apple");
set2.add("banana");
set2.add("Cherry");
// 忽略大小写排序：Apple → banana → Cherry

// 方式3：Lambda 比较器
TreeSet<String> set3 = new TreeSet<>((a, b) -> b.length() - a.length());
set3.add("apple");
set3.add("banana");
set3.add("hi");
// 按长度倒序：banana → apple → hi
```

## NavigableSet 接口：强大的导航方法

TreeSet 实现了 `NavigableSet` 接口，提供了丰富的导航方法：

```java
NavigableSet<Integer> set = new TreeSet<>();
set.addAll(Arrays.asList(1, 3, 5, 7, 9, 11));

// 向下取整（小于等于）
set.floor(8);    // 7
set.floor(7);    // 7

// 向上取整（大于等于）
set.ceiling(8);  // 9
set.ceiling(7);  // 7

// 严格小于
set.lower(7);    // 5

// 严格大于
set.higher(7);   // 9

// 获取第一个/最后一个
set.first();     // 1
set.last();      // 11

// 获取并移除第一个/最后一个
set.pollFirst(); // 1
set.pollLast();  // 11
```

### 图解导航方法

```
Set: [1, 3, 5, 7, 9, 11]

  lower(7)      floor(7)    ceiling(7)   higher(7)
     ↓            ↓           ↓            ↓
     5            7           7            9
     │            │           │            │
     ↓            ↓           ↓            ↓
   < 7          <= 7         >= 7         > 7
```

## 子集操作

TreeSet 支持高效的范围查询：

```java
NavigableSet<Integer> set = new TreeSet<>();
set.addAll(Arrays.asList(1, 3, 5, 7, 9, 11, 13, 15));

// 子集：前闭后开
set.subSet(5, 10);      // [5, 7, 9]

// 子集：包含起点，不包含终点
set.subSet(5, true, 10, true);  // [5, 7, 9]

// 前缀子集
set.headSet(10);        // [1, 3, 5, 7, 9]
set.headSet(10, true);  // [1, 3, 5, 7, 9, 11]

// 后缀子集
set.tailSet(10);        // [11, 13, 15]
set.tailSet(10, false); // [13, 15]
```

### 子集与原集合的联动

```java
NavigableSet<Integer> set = new TreeSet<>();
set.addAll(Arrays.asList(1, 3, 5, 7, 9, 11));

NavigableSet<Integer> subset = set.subSet(3, true, 9, false);

// 修改子集会影响原集合
subset.add(4);
subset.remove(5);

// 修改原集合会影响子集（但有边界限制）
set.add(8);  // 在子集范围内，可以
set.add(2);  // 不在子集范围内，不行！
// set.add(2) 会抛 IllegalArgumentException
```

## Comparable vs Comparator

### Comparable（自然顺序）

```java
// String 实现了 Comparable
public final class String implements Comparable<String> {
    public int compareTo(String anotherString) {
        return s1.compareTo(s2);  // 字典序比较
    }
}

// Integer 实现了 Comparable
public final class Integer implements Comparable<Integer> {
    public int compareTo(Integer anotherInteger) {
        return (x < y) ? -1 : ((x == y) ? 0 : 1);
    }
}
```

### Comparator（自定义顺序）

```java
// 用 Comparator 覆盖自然顺序
TreeSet<Person> set = new TreeSet<>(new Comparator<Person>() {
    @Override
    public int compare(Person p1, Person p2) {
        return p1.getAge() - p2.getAge();  // 按年龄排序
    }
});

// Lambda 简写
TreeSet<Person> set = new TreeSet<>((p1, p2) -> p1.getAge() - p2.getAge());

// Comparator 静态方法
TreeSet<Person> set = new TreeSet<>(Comparator.comparingInt(Person::getAge));

// 多级排序
TreeSet<Person> set = new TreeSet<>(Comparator
    .comparingInt(Person::getAge)
    .thenComparing(Person::getName));
```

### 对比

| 特性 | Comparable | Comparator |
|-----|-----------|-----------|
| 接口位置 | 元素类本身 | 单独的比较器类 |
| 修改性 | 修改元素类 | 不修改元素类 |
| 场景 | 实现默认/自然排序 | 实现自定义排序 |
| 优先级 | 较低（TreeSet 构造时可覆盖） | 较高（优先使用） |

## TreeSet vs HashSet vs LinkedHashSet

| 特性 | HashSet | LinkedHashSet | TreeSet |
|-----|---------|---------------|---------|
| 底层结构 | 哈希表 | 哈希表 + 链表 | 红黑树 |
| 元素顺序 | 无序 | 插入顺序 | 有序（可自定义） |
| add 时间复杂度 | O(1) | O(1) | O(log n) |
| contains 时间复杂度 | O(1) | O(1) | O(log n) |
| 导航方法 | 无 | 无 | 有 |
| 允许 null | 允许（最多1个） | 允许（最多1个） | 不允许 |
| 需要 Comparable | 否 | 否 | 是（或者提供 Comparator） |

## 实际应用场景

### 场景1：实现排行榜

```java
class Leaderboard {
    private final TreeSet<Player> leaderboard;
    
    public Leaderboard() {
        // 按分数倒序，分数相同按名字正序
        leaderboard = new TreeSet<>(
            Comparator.comparingInt(Player::getScore).reversed()
                      .thenComparing(Player::getName)
        );
    }
    
    public void addPlayer(String name, int score) {
        leaderboard.add(new Player(name, score));
    }
    
    // 获取前 N 名
    public List<Player> getTopN(int n) {
        return leaderboard.stream()
            .limit(n)
            .collect(Collectors.toList());
    }
    
    // 获取某玩家的排名
    public int getRank(Player player) {
        return leaderboard.headSet(player).size() + 1;
    }
}
```

### 场景2：区间查询

```java
TreeSet<Integer> set = new TreeSet<>();
set.addAll(Arrays.asList(1, 5, 10, 15, 20, 25, 30));

// 查询 [12, 22] 区间的元素
System.out.println(set.subSet(12, 22));  // [15, 20]

// 查询小于 15 的最大元素
System.out.println(set.lower(15));  // 10

// 查询 15 及以上的第一个元素
System.out.println(set.ceiling(15));  // 15
```

### 场景3：实现去重 + 自动排序

```java
// 对大量数据进行排序 + 去重
TreeSet<Integer> uniqueSorted = new TreeSet<>();
for (int i : randomNumbers) {
    uniqueSorted.add(i);
}
// uniqueSorted 自动去重并排序
```

## 线程安全问题

TreeSet 不是线程安全的。

```java
// 线程安全版本
Set<Integer> set = Collections.synchronizedSortedSet(new TreeSet<>());
```

注意：`Collections.synchronizedSortedSet()` 返回的是 `SynchronizedSortedSet`，所有方法都会加锁。

## 面试追问方向

1. **TreeSet 为什么能保证 O(log n) 的性能？**

因为底层是红黑树。红黑树是自平衡的二叉搜索树，插入、删除、查找都在 O(log n) 时间内完成。

2. **TreeSet 可以存储 null 吗？**

不可以。TreeSet 需要比较元素来确定顺序，如果存入 null，调用 compareTo() 会抛出 NullPointerException。

3. **TreeSet 和 PriorityQueue 有什么区别？**

TreeSet 是 Set（不重复），PriorityQueue 是 Queue（可重复）；TreeSet 支持导航方法，PriorityQueue 不支持；TreeSet 按从小到大排序，PriorityQueue 是最小堆。

4. **为什么 TreeSet 用红黑树而不是 AVL 树？**

红黑树是近似平衡的，插入和删除时只需要 O(1) 次旋转（最多 3 次），而 AVL 树是严格平衡的，需要 O(log n) 次旋转。综合来看，红黑树的插入删除性能更好。

5. **如果元素的 compareTo() 返回 0 会怎样？**

TreeSet 会认为两个元素相等，不存储第二个。这可以用来实现「去重但保留最新」的需求：

```java
TreeSet<Integer> set = new TreeSet<>(Comparator.naturalOrder());
set.add(1);
set.add(1);  // 被认为是重复，不添加
// set.size() = 1
```

---

TreeSet 是 Java 集合框架中最「聪明」的 Set——它不仅去重，还能自动排序，提供导航查询。如果你的业务需要有序数据，TreeSet 是首选。

接下来，我们深入 HashMap 专题，这是面试中最重要的知识点。
