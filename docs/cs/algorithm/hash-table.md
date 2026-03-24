# 哈希表：散列函数与冲突解决


## 为什么 Map.get() 可以这么快？

你写下了这行代码：

```java
Map&lt;String, User&gt; userCache = new HashMap&lt;&gt;();
userCache.put("user_12345", new User("张三", 25));
User user = userCache.get("user_12345");  // O(1) 找到
```

从散落在大内存各处的几十万个对象中，用一个字符串 key 瞬间找到对应值——这不是魔法，背后是**哈希表**在支撑。

理解哈希表，不仅是面试要求，更是理解所有高性能存储系统的钥匙：Redis 的 K-V 存储、Java 的 HashMap、MySQL 的索引……它们的核心思想都源自哈希表。

今天，让我们揭开它的神秘面纱。


## 哈希表的核心思想

### 什么是哈希表？

哈希表（Hash Table）是一种通过**键（Key）直接访问值（Value）**的数据结构。

它的核心公式：

```
位置 = Hash(键)
```

`Hash` 函数接收任意输入（字符串、数字、对象），输出一个固定范围的整数（哈希值）。根据这个整数，直接定位到存储位置。

### 理想状态 vs 现实

理想情况下，哈希函数应该：

1. **确定性**：相同输入总是产生相同输出
2. **均匀分布**：哈希值尽可能均匀分布在所有槽位
3. **快速计算**：哈希函数本身不能太慢

但现实很骨感：

- **输入无限，输出有限**：无限多的可能 key 映射到有限的数组下标
- **冲突不可避免**：两个不同的 key 可能映射到同一个位置

这就是著名的**抽屉原理**——n+1 个球放进 n 个抽屉，至少有一个抽屉会放两个球。


## 散列函数的设计

### 常见的哈希函数

**1. 除法散列法**

```java
int hash(int key) {
    return key % capacity;
}
```

简单高效，但需要选择合适的容量。经验法则：容量选择**质数**且**远离 2 的幂次**。

**2. 乘法散列法**

```java
int hash(int key) {
    double A = 0.6180339887;  // 黄金分割比例
    return (int) (capacity * ((key * A) % 1));
}
```

这是 Java 的 `HashMap` 使用的策略（但有更复杂的实现）。

**3. 字符串哈希**

```java
int hashString(String key, int capacity) {
    int hash = 0;
    for (int i = 0; i < key.length(); i++) {
        hash = (hash * 31 + key.charAt(i)) % capacity;
    }
    return hash;
}
```

Java 的 `String` 哈希就用了这个公式（31 是经典选择，因为它是质数且乘法运算可以被 JVM 优化）。

### 哈希函数的质量影响

一个不好的哈希函数会导致：

```
好的哈希（均匀分布）:
槽0: [key1] → 槽1: [key2, key8] → 槽2: [] → 槽3: [key5]
长度:    1              2               0             1

坏的哈希（聚集效应）:
槽0: [] → 槽1: [] → 槽2: [key1, key2, key3, key4, key5...]
长度:    0      0                    很多很多
```

聚集会导致大量冲突，退化为链表查询，复杂度从 O(1) 退化为 O(n)。


## 冲突解决方法

### 方法一：拉链法（Separate Chaining）

每个槽位不再存一个元素，而是存一个**链表**（或红黑树）。冲突的元素依次挂在后面。

```java
public class HashMap&lt;K, V&gt; {
    private static class Node&lt;K, V&gt; {
        K key;
        V value;
        Node&lt;K, V&gt; next;
    }
    
    private Node&lt;K, V&gt;[] table;
    private int size;
    private double loadFactor = 0.75;
    
    public V put(K key, V value) {
        int index = indexFor(hash(key), table.length);
        Node&lt;K, V&gt; p = table[index];
        
        // 1. 遍历链表查找 key
        while (p != null) {
            if (p.key.equals(key)) {
                V oldValue = p.value;
                p.value = value;
                return oldValue;
            }
            p = p.next;
        }
        
        // 2. 没找到，头插法插入新节点
        Node&lt;K, V&gt; newNode = new Node&lt;&gt;(key, value, table[index]);
        table[index] = newNode;
        size++;
        
        // 3. 扩容检查
        if (size >= table.length * loadFactor) {
            resize(table.length * 2);
        }
        return null;
    }
}
```

**链表 vs 红黑树**

Java 8 对 `HashMap` 的优化：当链表长度超过 8 且数组长度 >= 64 时，链表会转为红黑树。长度 <= 6 时退化为链表。

这是因为红黑树的查询是 O(log n)，但维护成本高；链表是 O(n)，但维护简单。长度大时红黑树更优。

### 方法二：开放寻址法（Open Addressing）

冲突时不另开空间，而是在**原数组**中寻找下一个空位置。

**线性探测（Linear Probing）**

```java
int hash = hash(key);
int index = hash;

// 依次向后找空位
while (table[index] != null) {
    if (table[index].key.equals(key)) {
        return table[index].value;  // 找到了
    }
    index = (index + 1) % capacity;  // 移动到下一个位置
}
table[index] = value;  // 找到空位，放入
```

**二次探测（Quadratic Probing）**

```java
int index = hash;
int step = 0;
while (table[index] != null) {
    index = (hash + step * step) % capacity;
    step++;
}
```

**双重哈希（Double Hashing）**

```java
int hash1 = hash1(key);
int hash2 = hash2(key);
int index = hash1;
int step = 0;
while (table[index] != null) {
    index = (hash1 + step * hash2) % capacity;
    step++;
}
```

### 两种方法的对比

| 特性 | 拉链法 | 开放寻址法 |
|------|--------|------------|
| 空间开销 | 需要额外的指针空间 | 数组本身 |
| 负载因子 | 可超过 1（链表增长） | 必须 < 1 |
| 删除操作 | 简单（链表删除） | 复杂（需要墓碑标记） |
| 缓存友好性 | 差（节点分散） | 好（连续存储） |
| 极端冲突 | 链表退化 | 聚集效应 |


## 扩容与缩容

### 为什么要扩容？

随着元素增多，负载因子 = n/m（n 是元素数，m 是槽位数）会越来越大，冲突越来越多，查询效率下降。

当负载因子超过阈值（通常 0.75）时，需要扩容。

### 扩容过程

```java
void resize(int newCapacity) {
    Node&lt;K, V&gt;[] newTable = new Node[newCapacity];
    
    for (Node&lt;K, V&gt; node : table) {
        while (node != null) {
            Node&lt;K, V&gt; next = node.next;
            // 重新计算位置
            int index = indexFor(hash(node.key), newCapacity);
            node.next = newTable[index];
            newTable[index] = node;
            node = next;
        }
    }
    table = newTable;
}
```

扩容的代价是 O(n)，但均摊到每次插入是 **O(1)**。

### JDK 的扩容优化

Java 8 使用了扩容优化的技巧：**不需要重新计算哈希，只需看旧容量的最高位是 0 还是 1**：

```java
int newIndex = (e.hash & oldCap) == 0 ? i : i + oldCap;
```

这样每个元素只需要 O(1) 时间确定新位置。


## 哈希表的复杂度分析

| 操作 | 平均 | 最坏 |
|------|------|------|
| 查找 | O(1) | O(n) |
| 插入 | O(1) | O(n) |
| 删除 | O(1) | O(n) |

最坏情况发生在**所有 key 哈希到同一位置**（哈希函数设计糟糕或遭遇哈希攻击）。

### 哈希攻击

恶意攻击者可以构造大量哈希值相同的 key，发送给服务器，导致哈希表退化为链表。

JDK 7 的 `HashMap` 确实存在这个问题。JDK 8 引入红黑树后有所缓解，但根本解决方案是使用**可重设哈希**，如 Java 11 的 `j.u.HashMap` 增加了扰动函数：

```java
static final int hash(Object key) {
    int h;
    return (key == null) ? 0 : (h = key.hashCode()) ^ (h >>> 16);
}
```

高位和低位异或，增加哈希的随机性。


## 实战：手写简易 HashMap

```java
public class SimpleHashMap&lt;K, V&gt; {
    private static final int DEFAULT_CAPACITY = 16;
    private static final double LOAD_FACTOR = 0.75;
    
    private Node&lt;K, V&gt;[] buckets;
    private int size;
    
    @SuppressWarnings("unchecked")
    public SimpleHashMap() {
        buckets = (Node&lt;K, V&gt;[]) new Node[DEFAULT_CAPACITY];
    }
    
    private int getIndex(K key, int length) {
        return (key == null) ? 0 : (key.hashCode() & 0x7fffffff) % length;
    }
    
    public void put(K key, V value) {
        int index = getIndex(key, buckets.length);
        Node&lt;K, V&gt; node = buckets[index];
        
        // 覆盖已存在的 key
        while (node != null) {
            if (Objects.equals(node.key, key)) {
                node.value = value;
                return;
            }
            node = node.next;
        }
        
        // 头插法插入新节点
        Node&lt;K, V&gt; newNode = new Node&lt;&gt;(key, value, buckets[index]);
        buckets[index] = newNode;
        size++;
        
        if (size > buckets.length * LOAD_FACTOR) {
            resize();
        }
    }
    
    public V get(K key) {
        int index = getIndex(key, buckets.length);
        Node&lt;K, V&gt; node = buckets[index];
        while (node != null) {
            if (Objects.equals(node.key, key)) {
                return node.value;
            }
            node = node.next;
        }
        return null;
    }
    
    @SuppressWarnings("unchecked")
    private void resize() {
        Node&lt;K, V&gt;[] oldBuckets = buckets;
        buckets = (Node&lt;K, V&gt;[]) new Node[oldBuckets.length * 2];
        
        for (Node&lt;K, V&gt; node : oldBuckets) {
            while (node != null) {
                Node&lt;K, V&gt; next = node.next;
                int index = getIndex(node.key, buckets.length);
                node.next = buckets[index];
                buckets[index] = node;
                node = next;
            }
        }
    }
    
    private static class Node&lt;K, V&gt; {
        K key;
        V value;
        Node&lt;K, V&gt; next;
        
        Node(K key, V value, Node&lt;K, V&gt; next) {
            this.key = key;
            this.value = value;
            this.next = next;
        }
    }
}
```


## 总结

哈希表是「空间换时间」思想的完美体现——用更多的内存换取 O(1) 的查询效率。

它的核心设计哲学：
1. **好的哈希函数**：均匀分布，减少冲突
2. **好的冲突解决**：平衡查询效率和空间利用率
3. **动态扩容**：保持负载因子在合理范围

理解这些，你就能理解为什么 Redis 这么快、为什么 MySQL 的 InnoDB 索引用 B+ 树而不是哈希表（范围查询）、为什么 Guava 的 `BloomFilter` 用哈希做去重……

## 面试追问方向

- Java 7 和 Java 8 的 HashMap 有什么区别？（链表 vs 红黑树）
- HashMap 为什么是线程不安全的？（并发修改、快速失败机制）
- ConcurrentHashMap 是怎么保证线程安全的？（JDK 7 分段锁，JDK 8 CAS + synchronized）
- 什么时候应该用 HashMap，什么时候应该用 TreeMap？（需要有序范围查询时）
- 哈希表和 B+ 树各有什么适用场景？（点查询 vs 范围查询、缓存友好性）
