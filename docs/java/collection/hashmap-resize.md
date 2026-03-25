# HashMap 扩容时机与 resize 过程

你有没有想过：HashMap 什么时候会扩容？扩容做了什么？扩容的成本有多高？

如果你回答"当元素超过容量 * 0.75 时扩容"，这只是表面。让我带你深入 JDK 8 源码，看看扩容的完整逻辑。

## 扩容时机：threshold 是关键

```java
// HashMap 的几个关键变量
transient Node<K,V>[] table;  // 数组
int threshold;                // 扩容阈值
final float loadFactor;      // 负载因子，默认 0.75
```

threshold = capacity * loadFactor。当 `size > threshold` 时，触发扩容。

```java
// putVal 中的扩容检查
if (++size > threshold)
    resize();
```

注意是 `++size > threshold`，先自增再比较。所以实际元素数达到 threshold 时扩容。

## resize() 的职责

`resize()` 做三件事：

1. **计算新容量**：旧容量 * 2（不能超过 MAXIMUM_CAPACITY = 1 << 30）
2. **计算新阈值**：新容量 * loadFactor
3. **迁移数据**：把旧表的数据迁移到新表

```java
final Node<K,V>[] resize() {
    Node<K,V>[] oldTab = table;
    int oldCap = (oldTab == null) ? 0 : oldTab.length;
    int oldThr = threshold;
    
    int newCap, newThr = 0;
    
    // 情况1：已有 table，计算新容量和阈值
    if (oldCap > 0) {
        // 容量已达上限，不再扩容
        if (oldCap >= MAXIMUM_CAPACITY) {
            threshold = Integer.MAX_VALUE;
            return oldTab;
        }
        // 新容量 = 旧容量 * 2
        newCap = oldCap << 1;
        newThr = oldThr << 1;  // 新阈值也翻倍
    }
    // 情况2：初始化时使用 threshold 作为容量
    else if (oldThr > 0)
        newCap = oldThr;
    // 情况3：空 table，使用默认值
    else {
        newCap = DEFAULT_INITIAL_CAPACITY;    // 16
        newThr = (int)(DEFAULT_LOAD_FACTOR * DEFAULT_INITIAL_CAPACITY);  // 12
    }
    
    // 如果新阈值计算出错，修正
    if (newThr == 0) {
        float ft = (float) newCap * loadFactor;
        newThr = (newCap < MAXIMUM_CAPACITY && ft < (float) MAXIMUM_CAPACITY ?
                  (int) ft : Integer.MAX_VALUE);
    }
    
    threshold = newThr;
    
    // 创建新数组
    @SuppressWarnings("rawtypes")
    Node<K,V>[] newTab = (Node<K,V>[]) new Node[newCap];
    table = newTab;
    
    // 如果旧表不为空，迁移数据
    if (oldTab != null) {
        for (int j = 0; j < oldCap; ++j) {
            Node<K,V> e;
            if ((e = oldTab[j]) != null) {
                oldTab[j] = null;  // 释放旧引用
                if (e.next == null)
                    // 单节点，直接移动
                    newTab[e.hash & (newCap - 1)] = e;
                else if (e instanceof TreeNode)
                    // 红黑树分裂
                    ((TreeNode<K,V>) e).split(this, newTab, j, oldCap);
                else {
                    // 链表分裂（重点！）
                    Node<K,V> loHead = null, loTail = null;
                    Node<K,V> hiHead = null, hiTail = null;
                    Node<K,V> next;
                    do {
                        next = e.next;
                        // 关键：判断节点在新表的位置
                        if ((e.hash & oldCap) == 0) {
                            // 位置不变
                            if (loTail == null)
                                loHead = e;
                            else
                                loTail.next = e;
                            loTail = e;
                        } else {
                            // 位置 = 原位置 + oldCap
                            if (hiTail == null)
                                hiHead = e;
                            else
                                hiTail.next = e;
                            hiTail = e;
                        }
                    } while ((e = next) != null);
                    
                    // 两条链表分别放到新表位置
                    if (loTail != null) {
                        loTail.next = null;
                        newTab[j] = loHead;
                    }
                    if (hiTail != null) {
                        hiTail.next = null;
                        newTab[j + oldCap] = hiTail;
                    }
                }
            }
        }
    }
    return newTab;
}
```

## JDK 8 的关键优化：不需要重新计算 hash

这是 JDK 8 扩容最精妙的地方。

JDK 7 需要对每个节点重新计算 hash（`indexFor(hash, newCapacity)`），而 JDK 8 只需要判断 `hash & oldCap`：

```java
if ((e.hash & oldCap) == 0) {
    // 新位置 = 原位置
    newTab[j] = loHead;
} else {
    // 新位置 = 原位置 + oldCap
    newTab[j + oldCap] = hiHead;
}
```

为什么只需要看 `hash & oldCap`？

假设 `oldCap = 16 (10000)`，`hash = 27 (11011)`：

```
hash & oldCap = 11011 & 10000 = 10000 = 16 ≠ 0
说明 hash 的第 5 位是 1

原位置 = hash & 15 = 11011 & 01111 = 01011 = 11
新位置 = hash & 31 = 11011 & 11111 = 11011 = 27 = 11 + 16
```

结论：**如果 hash 的最高位（oldCap 对应位）是 0，新位置不变；是 1，新位置 = 原位置 + oldCap**。

## 链表分裂：lo 和 hi

JDK 8 把链表分成两条：

```java
Node<K,V> loHead = null, loTail = null;  // 位置不变的链表
Node<K,V> hiHead = null, hiTail = null;  // 位置移动的链表
```

遍历原链表：

```
原链表: A -> B -> C -> D -> E
假设 hash & oldCap:
  A = 0 (lo)
  B = 1 (hi)
  C = 0 (lo)
  D = 1 (hi)
  E = 0 (lo)
  
loHead: A -> C -> E (尾插法)
hiHead: B -> D (尾插法)

新表:
  table[j] = loHead (位置不变)
  table[j + oldCap] = hiHead (位置 + oldCap)
```

注意也是**尾插法**，保证顺序不变。

## 扩容的成本有多高？

扩容操作的成本：

1. **内存分配**：需要分配一个 2 倍大小的新数组
2. **数据迁移**：需要遍历所有节点，重新分配位置
3. **时间复杂度**：O(n)，n 是元素数量

所以**避免频繁扩容**是 HashMap 优化的关键。

预估容量可以减少扩容次数：

```java
// 预估 1000 个元素，合理设置初始容量
// 1000 / 0.75 ≈ 1333，需要 2048（最近的 2 的幂）
Map<String, Object> map = new HashMap<>(2048);
```

## 红黑树的分裂

红黑树在扩容时可能退化为链表：

```java
final void split(HashMap<K,V> map, Node<K,V>[] tab, int index, int oldCap) {
    TreeNode<K,V> b = this;
    TreeNode<K,V> loHead = null, loTail = null;
    TreeNode<K,V> hiHead = null, hiTail = null;
    int lc = 0, hc = 0;
    
    // 按链表方式遍历红黑树节点
    for (TreeNode<K,V> e = b; e != null; e = e.next) {
        if ((e.hash & oldCap) == 0) {
            // 同 lo 链表
            if ((e.prev = loTail) == null)
                loHead = e;
            else
                loTail.next = e;
            loTail = e;
            ++lc;
        } else {
            // 同 hi 链表
            if ((e.prev = hiTail) == null)
                hiHead = e;
            else
                hiTail.next = e;
            hiTail = e;
            ++hc;
        }
    }
    
    // 节点数 <= 6，退化为链表
    if (loHead != null) {
        if (lc <= UNTREEIFY_THRESHOLD)
            tab[index] = loHead.untreeify(map);
        else {
            tab[index] = loHead;
            if (hiHead != null)
                loHead.treeify(tab);
        }
    }
    
    if (hiHead != null) {
        if (hc <= UNTREEIFY_THRESHOLD)
            tab[index + oldCap] = hiHead.untreeify(map);
        else {
            tab[index + oldCap] = hiHead;
            if (loHead != null)
                hiHead.treeify(tab);
        }
    }
}
```

如果分裂后某条链表的节点数 <= 6，**红黑树退化为链表**（调用 `untreeify()`）。

## 面试追问

### Q1: HashMap 容量为什么必须是 2 的幂次？

两个原因：

1. **定位下标更快**：`table[i = (n - 1) & hash]` 比 `table[i = hash % n]` 更快
2. **扩容优化**：`hash & oldCap` 判断新位置的前提是容量是 2 的幂次

2 的幂次的二进制都是 1000...，减 1 后变成 111...，位与运算可以直接用 hash 的低位定位。

### Q2: 负载因子为什么默认是 0.75？

这是**空间和时间的平衡**。

- 负载因子太小（0.5）：空间浪费，扩容频繁，但哈希碰撞少
- 负载因子太大（0.9）：空间利用率高，但哈希碰撞多，链表/红压树变长

0.75 是一个经验值：当容量为 16 时，阈值是 12，意味着平均每个桶 0.75 个元素，哈希分布相对均匀。

### Q3: 扩容操作是线程安全的吗？

**不是**。扩容过程中，如果其他线程同时 put，可能导致数据丢失或不一致。

例如：线程 A 在扩容，线程 B put 新值到某个桶，这个值可能被遗漏。

---

## 留给你的思考题

JDK 8 中，`resize()` 方法在并发场景下有什么问题？

提示：考虑以下场景

1. 两个线程同时检测到需要扩容（`size > threshold`）
2. 两个线程同时进入 `resize()`
3. `newTab = new Node[newCap]` 执行了两次
4. 后面的线程可能看到错误的 table 状态

JDK 8 对这个问题有什么处理？（提示：和 `CAS` 以及 `synchronized` 有关）

但即使有并发控制，**HashMap 仍然不是线程安全的**——你能说出具体场景吗？
