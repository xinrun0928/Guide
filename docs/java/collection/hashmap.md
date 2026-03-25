# HashMap 底层结构：数组 + 链表 + 红黑树

你有没有想过这个问题：

HashMap 的 `get("name")` 为什么能在 O(1) 的时间内找到元素？

按理说，查找需要遍历，难道不应该 O(n) 吗？

答案藏在 HashMap 的底层结构里。

## HashMap 的三层结构

JDK 8 的 HashMap 底层是**数组 + 链表 + 红黑树**：

```
┌─────────────────────────────────────────────────────────────┐
│                        HashMap 结构                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   table[0]  →  Node(null)                                   │
│   table[1]  →  Node("Alice") → Node("Bob")                  │
│   table[2]  →  Node("Charlie")                              │
│   table[3]  →  TreeNode("David") → TreeNode("Eve") → ...   │
│   table[4]  →  Node(null)                                   │
│   ...                                                       │
│                                                             │
│   当链表长度 > 8 且容量 >= 64 时，链表转为红黑树              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 核心字段

```java
public class HashMap<K, V> {
    // 核心：数组 + 链表/红黑树
    transient Node<K, V>[] table;
    
    // 实际元素数量
    transient int size;
    
    // 修改次数（用于 fail-fast）
    transient int modCount;
    
    // 扩容阈值 = capacity * loadFactor
    int threshold;
    
    // 负载因子，默认 0.75
    final float loadFactor;
}
```

### Node 节点

```java
// 普通链表节点
static class Node<K, V> {
    final int hash;      // key 的 hash（优化后避免重复计算）
    final K key;          // 键（不可变，用 final）
    V value;              // 值
    Node<K, V> next;      // 下一个节点（链表）
}
```

### TreeNode 红黑树节点

```java
// 红黑树节点（JDK 8+）
static final class TreeNode<K, V> extends Node<K, V> {
    TreeNode<K, V> parent;      // 父节点
    TreeNode<K, V> left;        // 左子节点
    TreeNode<K, V> right;       // 右子节点
    TreeNode<K, V> prev;        // 前一个节点（用于删除）
    boolean red;                 // 颜色标记
}
```

## 寻址算法：如何找到元素

HashMap 用**位运算**代替取模来计算数组下标：

```java
// 核心公式
index = (n - 1) & hash

// 其中
// n = table.length（数组容量，必须是 2 的幂次）
// hash = key.hashCode() ^ (key.hashCode() >>> 16)（扰动后的 hash）
```

### 为什么用位运算？

```java
// 位运算：O(1)，CPU 一条指令
int index = (n - 1) & hash;

// 取模：相对较慢
int index = hash % n;
```

关键在于 **n 是 2 的幂次**。当 n = 16 时：

```
n - 1 = 15 = 0b00001111
hash    = 某个整数

(hash & 0b00001111) 等价于 (hash % 16)
```

这是数学上的技巧：**当除数是 2 的幂次时，取模可以用位运算优化**。

### 为什么 n 必须是 2 的幂次？

```java
// n = 16 时
// n - 1 = 15 = 0b00001111
// hash 的低 4 位决定了下标位置

// n = 15 时
// n - 1 = 14 = 0b00001110
// hash 的低位不是连续位，有跳跃
// 例如：hash=1 和 hash=2 落在同一位置（& 14 = 0）
// hash=3 和 hash=4 落在同一位置（& 14 = 2）
// 不均匀的分布导致哈希碰撞增加
```

**2 的幂次保证了 `n - 1` 的二进制是连续的 1**，这样 `&` 运算才能均匀分布。

## tableSizeFor()：向上取整的魔法

当你创建 HashMap 时，指定的容量会被调整为最近的 2 的幂次：

```java
// 指定 initialCapacity = 10
// 实际容量会是 16

// 指定 initialCapacity = 17
// 实际容量会是 32

static final int tableSizeFor(int cap) {
    int n = cap - 1;
    n |= n >>> 1;    // 把最高位的 1 复制到下一位
    n |= n >>> 2;    // 再复制两位
    n |= n >>> 4;    // 再复制四位
    n |= n >>> 8;    // 再复制八位
    n |= n >>> 16;   // 复制到最高位
    return n + 1;    // 加 1 得到 2 的幂次
}
```

### 举例说明

```java
// cap = 10
// n = 9 = 0b00001001

// 每一步的变化
n = 9     = 0b00001001
n |= 1    → 0b00001001
n |= 4    → 0b00001101  = 13
n |= 6    → 0b00001111  = 15
n |= 7    → 0b00001111  = 15
n |= 15   → 0b00001111  = 15
n |= 15   → 0b00001111  = 15
return 16 = 0b00010000

// cap = 10 返回 16 ✓
```

这个算法确保返回 **>= cap 的最小 2 的幂次**。

## 容量与下标的对应关系

| 指定容量 | 实际容量 | n - 1 (二进制) | 可用位数 |
|---------|---------|---------------|---------|
| 1 | 1 | 0 | 0 位 |
| 2 | 2 | 1 | 1 位 |
| 3-4 | 4 | 3 | 2 位 |
| 5-8 | 8 | 7 | 3 位 |
| 9-16 | 16 | 15 | 4 位 |
| 17-32 | 32 | 31 | 5 位 |

## 插入流程图解

```java
map.put("name", "Alice");
```

```
Step 1: 计算 hash
┌─────────────────────────────────────┐
│  "name".hashCode() = 3373702        │
│  hash = 3373702 ^ (3373702 >>> 16) │
│       = 3373702 ^ 51 = 3373705     │
└─────────────────────────────────────┘
              ↓
Step 2: 计算下标
┌─────────────────────────────────────┐
│  假设 table.length = 16             │
│  index = (16 - 1) & 3373705        │
│        = 15 & 3373705              │
│        = 3373705 % 16              │
│        = 9                          │
└─────────────────────────────────────┘
              ↓
Step 3: 插入到 table[9]
┌─────────────────────────────────────┐
│  table[9] → Node("name", "Alice")  │
└─────────────────────────────────────┘
```

## 哈希冲突：同一个桶的多个元素

当两个不同的 key 计算出相同的下标时，就发生**哈希冲突**：

```java
// 假设 hash1 和 hash2 不同，但 (n-1) & hash 结果相同
index = (n - 1) & hash1  // = 5
index = (n - 1) & hash2  // = 5
```

HashMap 用**链表**解决冲突：

```
table[5] → Node(key1, value1) → Node(key2, value2) → null
```

当链表长度过长时（> 8 且容量 >= 64），转为**红黑树**：

```
table[5] → TreeNode(key1, value1)
              ↙            ↘
        TreeNode        TreeNode
        (key2, val2)    (key3, val3)
```

## 扩容对结构的影响

```java
// 扩容前容量 16
// 扩容后容量 32

// 原 table[5] 的元素会重新分配
// 一部分留在 table[5]
// 一部分移到 table[5 + 16] = table[21]
```

关键优化（JDK 8+）：
- 扩容时**不需要重新计算 hash**
- 只需要看 hash 的**高位是 0 还是 1**
- 为 0 留在原位置，为 1 移到原位置 + 旧容量

## 面试追问方向

1. **HashMap 的数组容量为什么必须是 2 的幂次？**

因为 `(n-1) & hash` 等价于 `hash % n`，但位运算比取模快得多。只有当 n 是 2 的幂次时，这个等价关系才成立。

2. **HashMap 为什么用链表解决哈希冲突，而不是开放定址法？**

链表（拉链法）的优点：实现简单、插入删除 O(1)、不易产生聚集。开放定址法的缺点：删除复杂、容易产生聚集、探测序列长度不确定。

3. **HashMap 的红黑树什么时候退化为链表？**

当 resize 导致节点数 <= 6 时会退化为链表。另外，HashMap 不保证树化，因为容量 < 64 时优先扩容而非树化。

4. **HashMap 的 table 为什么用 transient 修饰？**

因为 table 可能不是所有字段序列化的最小方式（如空数组不序列化），自定义的 `writeObject/readObject` 可以只序列化有值的桶。

5. **HashMap 的 Node 为什么用 final 修饰 key？**

因为 key 的 hashCode 是 HashMap 定位桶的依据。如果 key 的属性被修改（hashCode 变化），会导致找不到元素。用 final 防止 key 被修改。

---

HashMap 的设计充满了精妙的技术细节。从 2 的幂次的容量设计，到扰动函数减少碰撞，再到链表转红黑树的优化，每一步都经过深思熟虑。理解了这些底层原理，你才能真正掌握 HashMap 的使用技巧。

下一节，我们深入分析 HashMap 的扰动函数——这是面试中经常被问到的高频考点。
