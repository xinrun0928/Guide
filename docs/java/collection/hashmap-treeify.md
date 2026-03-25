# HashMap 树化条件：链表长度 > 8 且容量 >= 64

面试官问："HashMap 什么时候会把链表转成红黑树？"

你回答："链表长度超过 8 的时候。"

面试官点点头："那如果容量是 32 呢？"

你愣住了...

今天，我们彻底搞清楚 HashMap 树化的条件。

## 树化的两个必要条件

JDK 8 中，链表转红黑树需要**同时满足**两个条件：

```java
static final int TREEIFY_THRESHOLD = 8;        // 链表长度 > 8
static final int MIN_TREEIFY_CAPACITY = 64;    // 容量 >= 64
```

缺一不可。

## 为什么是 8？

这不是拍脑袋定的，而是基于**泊松分布**的概率分析。

JDK 源码注释里有这么一段：

```java
/**
 * BinCount probabilities for Poisson distribution:
 *  0:    0.60653066
 *  1:    0.30326533
 *  2:    0.07581633
 *  3:    0.01263606
 *  4:    0.00157952
 *  5:    0.00015795
 *  6:    0.00001316
 *  7:    0.00000094
 *  8:    0.00000006  <-- 亿万分之一
```

链表长度达到 8 的概率是 0.00000006（亿分之六），几乎不可能在正常情况下发生。

**这意味着**：如果链表真的达到长度 8，说明哈希函数有问题，或者有人在恶意攻击。

用红黑树保护，是"异常情况下的保险措施"。

## 为什么容量必须 >= 64？

先看 `treeifyBin()` 的代码：

```java
final void treeifyBin(Node<K,V>[] tab, int hash) {
    int n, index;
    Node<K,V> e;
    
    // 如果容量 < 64，扩容而不是树化
    if (tab == null || (n = tab.length) < MIN_TREEIFY_CAPACITY)
        resize();
    else
        // 真正树化
        ...
}
```

容量 < 64 时，**优先扩容**，而不是树化。

### 为什么不直接树化？

原因一：**空间成本**

红黑树节点比链表节点大得多：

```java
// 链表节点
class Node<K,V> {
    int hash;
    K key;
    V value;
    Node<K,V> next;
}

// 红黑树节点
class TreeNode<K,V> {
    int hash;
    K key;
    V value;
    TreeNode<K,V> parent;
    TreeNode<K,V> left;
    TreeNode<K,V> right;
    TreeNode<K,V> prev;    // 链表指针（双向链表）
    boolean red;           // 颜色
}
```

TreeNode 比 Node 大了 3 个引用 + 1 个 boolean，至少多占用 24 字节。**树化会显著增加内存占用**。

原因二：**容量小时，扩容更划算**

容量小意味着哈希分布可能不好。扩容可以让元素分散到更多桶中，链表自然就短了。

```java
// 场景：容量 16，元素 100 个
// 平均每个桶 6.25 个元素，有几个桶可能超过 8

// 如果扩容到 32
// 平均每个桶 3.125 个元素
// 即使最长的桶也只有 5-6 个
```

扩容治本，树化治标。

## 树化过程

```java
final void treeifyBin(Node<K,V>[] tab, int hash) {
    int n, index;
    Node<K,V> e;
    
    if (tab == null || (n = tab.length) < MIN_TREEIFY_CAPACITY) {
        resize();  // 容量 < 64，扩容
        return;
    }
    
    if ((e = tab[index = (n - 1) & hash]) != null) {
        TreeNode<K,V> hd = null, tl = null;
        do {
            // 把链表节点转成 TreeNode（保留链表结构）
            TreeNode<K,V> p = replacementTreeNode(e, null);
            if (tl == null)
                hd = p;
            else {
                p.prev = tl;
                tl.next = p;
            }
            tl = p;
        } while ((e = e.next) != null);
        
        // 用链表构建红黑树
        if ((tab[index] = hd) != null)
            hd.treeify(tab);
    }
}

// 将链表节点包装成 TreeNode
TreeNode<K,V> replacementTreeNode(Node<K,V> p, Node<K,V> next) {
    return new TreeNode<>(p.hash, p.key, p.value, next);
}
```

关键点：**先把所有 Node 转成 TreeNode 构建链表，再构建红黑树**。这个链表在红黑树中仍然保留（prev/next 指针），用于遍历。

## 红黑树的平衡

TreeNode 继承自 Node，实现了 `balanceInsertion()` 和 `balanceDeletion()` 方法来保持红黑树平衡。

插入节点时：

1. 将新节点设为红色
2. 不断调整（旋转 + 变色），直到满足红黑树性质

```java
static <K,V> TreeNode<K,V> balanceInsertion(TreeNode<K,V> root,
                                            TreeNode<K,V> x) {
    x.red = true;
    for (TreeNode<K,V> xp, xpp, xppl, xppr;;) {
        // 各种旋转和变色...
    }
}
```

这是 JDK 中红黑树实现的核心，代码较长，有兴趣可以深入阅读。

## 退化条件

红黑树可以退化回链表：

```java
static final int UNTREEIFY_THRESHOLD = 6;
```

当节点数 <= 6 时，在 `resize()` 或 `split()` 时会退化为链表。

### 为什么是 6 而不是 7？

```java
// 扩容时分裂红黑树
if (lc <= UNTREEIFY_THRESHOLD)
    tab[index] = loHead.untreeify(map);
```

避免**频繁转换**：如果阈值是 7，节点数在 6-8 之间反复变化时，会导致频繁树化/退化。

设为 6，留了一个"缓冲地带"：7-8 树化，6 以下退化。

## 容量与树化的关系

| 容量 | threshold (size > threshold 扩容) | 链表长度 > 8 时 |
|-----|----------------------------------|----------------|
| 16  | 12 | 扩容（因为 16 < 64） |
| 32  | 24 | 扩容（因为 32 < 64） |
| 64  | 48 | 树化（64 >= 64） |
| 128 | 96 | 树化 |

**记住**：容量 < 64 时，链表再长也不树化，只扩容。

## 面试追问

### Q1: 红黑树的查找时间复杂度是 O(log n)，为什么不直接用红黑树？

两个原因：

1. **空间开销**：红黑树节点比链表节点大 2 倍左右
2. **正常情况链表不长**：根据泊松分布，链表超过 8 的概率极低

HashMap 的哲学：**默认用链表（空间小），只在必要时升级为红黑树（性能保护）**。

### Q2: HashMap 的 key 需要实现 Comparable 吗？

对于 HashMap 本身（`hash()` + `equals()`）不需要。

但如果是 TreeMap 或 HashMap 的红黑树节点，需要 key 可比较。

红黑树的 `putTreeVal()` 会比较 key：

```java
if (kc == null)
    kc = Comparable.class.cast(k);
if (kc != null) {
    // 使用 comparableCompareTo 比较
}
```

如果 key 没有实现 Comparable，会在插入时抛出 ClassCastException。

### Q3: 红黑树节点在遍历时有什么优势？

TreeNode 保留了链表结构（prev/next），所以可以按插入顺序遍历。

同时，按 key 的 hash 顺序遍历时，TreeNode 的效率更高（因为树本身就是有序的）。

---

## 留给你的思考题

JDK 8 中，红黑树的 `split()` 方法在并发扩容时，可能出现什么问题？

提示：

1. 线程 A 正在遍历红黑树（遍历用的是 prev/next 链表）
2. 线程 B 同时 resize，split() 把红黑树分裂成两个
3. 线程 A 可能看到不一致的链表结构

JDK 8 对这个问题有什么处理？（提示：`TreeNode` 的 `next` 指针在 split 时会被清空）

但更根本的问题是：**HashMap 不是线程安全的**，在任何并发场景下都不安全。
