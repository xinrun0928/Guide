# JDK 8 的 HashMap 进化：从链表到红黑树

2014 年 3 月，JDK 8 正式发布。

对于 HashMap 来说，这是近年来最大的一次升级。链表变成红黑树、头插法改成尾插法、扰动函数简化...每一个改动都解决了 JDK 7 的历史遗留问题。

但这些改动背后，藏着怎样的权衡与思考？

## 链表到红黑树：为什么是 8？

JDK 8 之前，所有 hash 碰撞的节点都挂在链表上。最坏情况下，查询是 O(n)。

JDK 8 引入了红黑树：当链表长度超过 8 且数组容量 >= 64 时，链表会转成红黑树，查询变成 O(log n)。

为什么是 8？不是 7，不是 10？

```java
// JDK 8 源码
static final int TREEIFY_THRESHOLD = 8;

// 链表转红黑树的条件
if (binCount >= TREEIFY_THRESHOLD - 1)  // binCount >= 7
    treeifyBin(tab, hash);
```

答案在 JDK 源码注释里：

> Because TreeNodes are about twice as big as regular nodes,
> we use them only when bins contain enough nodes to warrant
> use of treeware space.
>
> (TreeNodes 占用空间大约是普通节点的 2 倍，所以只在必要时使用)

这是**空间换时间**的权衡。但为什么偏偏是 8？

### 泊松分布告诉你答案

JDK 团队做了统计分析：hash 碰撞时，链表长度服从泊松分布。

```java
// JDK 源码注释中的泊松分布概率
* Also, binCount probabilities follow Poisson distribution
* with lambda = 0.5. The values are:
*
*  0:    0.60653066
*  1:    0.30326533
*  2:    0.07581633
*  3:    0.01263606
*  4:    0.00157952
*  5:    0.00015795
*  6:    0.00001316
*  7:    0.00000094
*  8:    0.00000006  <-- 这里
```

链表长度超过 8 的概率是 **0.00000006**（千万分之六），几乎不可能发生。

所以 8 是一个"合理阈值"：正常情况下链表不会超过 8，超过了说明哈希函数有问题或者遭遇恶意攻击，需要用红黑树保护。

## 红黑树的特性

红黑树是一种自平衡二叉查找树，有 5 个规则：

| 规则 | 说明 |
|-----|------|
| 每个节点非红即黑 | 二元颜色 |
| 根节点是黑色 | 叶子节点（空 NIL）也是黑色 |
| 红节点的子节点必须是黑色 | 不能有两个连续的红节点 |
| 任意节点到叶子的路径黑色高度相同 | 近似平衡 |
| 新插入的节点默认红色 | 减少调整次数 |

为什么不用严格的平衡二叉树（如 AVL 树）？

因为**插入和删除的旋转操作更少**。HashMap 追求的是综合性能：读多写也多，不能让维护成本太高。

## 尾插法：解决死循环

JDK 8 扩容时，使用尾插法：

```java
// JDK 8 resize() 片段
do {
    Entry<K,V> next = e.next;
    int newIndex = (e.hash & oldCap) == 0 ? j : j + oldCap;
    e.next = newTab[newIndex];  // 先指向新桶
    newTab[newIndex] = e;       // 再把自己放进去
    e = next;
} while (e != null);
```

这是尾插法的精妙之处：**保持原链表的顺序**。

```
原链表：A -> B -> C
扩容后：A -> B -> C（顺序不变）
```

JDK 7 的头插法：
```
原链表：A -> B -> C
扩容后：C -> B -> A（顺序反转）
```

JDK 7 头插法 + 并发 = 链表倒置 + 环形引用 = 死循环。

JDK 8 尾插法：即使并发，链表顺序也不会乱。

## 扰动函数简化：省了一步

JDK 7 的 hash：
```java
h ^= k.hashCode();
h ^= (h >>> 20) ^ (h >>> 12);
return h ^ (h >>> 7) ^ (h >>> 4);
```

JDK 8 简化了：
```java
h ^= (h >>> 16);
return h;
```

为什么能简化？

因为 `(n - 1) & hash` 只需要 hash 的低位参与运算。JDK 7 的多步扰动，在 `(n - 1) & hash` 之前就已经把高位信息混入低位了。

JDK 8 只需要一步：`h ^ (h >>> 16)`，直接把高 16 位异或到低 16 位。

## 扩容时的特殊优化

JDK 8 还有一个大招：扩容时**不需要重新计算每个节点的 hash**。

```java
// 经典写法：需要重新计算
int newIndex = (newCapacity - 1) & hash;

// JDK 8 的优化
int newIndex = (e.hash & oldCap) == 0 ? oldIndex : oldIndex + oldCap;
```

怎么做到的？

假设 `oldCap = 16 (10000)`，`hash = 27 (11011)`：

```
hash & oldCap = 11011 & 10000 = 10000 = oldCap
说明 hash 的第 5 位是 1

如果 oldCap = 16，新容量 = 32 (100000)
原 index = 27 & 15 = 11 (01011)
新 index = 27 & 31 = 27 (11011) = 11 + 16

所以：如果 (hash & oldCap) == 0，新位置 = 原位置
                 == oldCap，新位置 = 原位置 + oldCap
```

**只需要看 hash 的最高位（oldCap 对应的那一位）是 0 还是 1**，就能决定新位置。

## 容量 < 64 时的选择

JDK 8 增加了一个保护机制：

```java
static final int MIN_TREEIFY_CAPACITY = 64;

final void treeifyBin(Node<K,V>[] tab, int hash) {
    int n, index;
    Node<K,V> e;
    
    // 如果容量 < 64，优先扩容，而不是树化
    if (tab == null || (n = tab.length) < MIN_TREEIFY_CAPACITY)
        resize();
    else
        // 树化
        ...
}
```

为什么这样设计？

因为**树化是有成本的**：红黑树节点比链表节点大（需要存储颜色、左右孩子指针），而且树化本身也需要时间。

如果当前容量很小（< 64），说明哈希分布可能不好，但更可能是元素太少。这时候**扩容**比树化更划算——扩容可以让哈希分布更均匀，同时避免占用额外内存。

## 退化为链表

红黑树可以退化回链表：

```java
static final int UNTREEIFY_THRESHOLD = 6;
```

当红黑树节点数 <= 6 时，在 resize 时会退化为链表。

为什么是 6 不是 7？

避免频繁在链表和红黑树之间转换。如果阈值是 7，链表长度在 6-8 之间反复时，会导致频繁树化/退化。

## 面试追问

### Q1: 红黑树查找是 O(log n)，链表是 O(n)，那为什么不直接全部用红黑树？

两个原因：

1. **空间成本**：红黑树节点比链表节点大 2 倍左右
2. **维护成本**：插入/删除需要旋转调整，比链表 O(1) 插入复杂

HashMap 的设计哲学：**大多数情况下，链表不会很长；只有异常情况才用红黑树保护**。

### Q2: JDK 8 中 HashMap 是线程安全的吗？

**不是**。JDK 8 只是解决了死循环问题，但并发 put 仍然可能导致：

1. **数据覆盖**：两个线程同时 put 新值，后者覆盖前者
2. **ConcurrentModificationException**：遍历时修改结构

真正线程安全，用 `ConcurrentHashMap`。

### Q3: 红黑树怎么保持平衡？

通过**旋转 + 变色**：

- **变色**：红变黑或黑变红
- **左旋**：当前节点左下沉
- **右旋**：当前节点右下沉

插入最多 2 次旋转，删除最多 3 次旋转。这是红黑树相对于 AVL 树的优势：**调整次数少**。

---

## 留给你的思考题

JDK 8 的 HashMap 在 put 时，如果发现某个桶正在被另一个线程树化（`MOVED` 状态），会怎么做？

提示：这和 `ForwardingToNext` 节点有关。

理解这个问题，你才算真正掌握了 JDK 8 HashMap 并发的全貌。
