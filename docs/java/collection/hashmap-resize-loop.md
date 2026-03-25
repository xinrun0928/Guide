# JDK 7 HashMap 扩容死循环问题

这是 Java 面试中的"经典老番"，几乎每个面试官都会问。

但大多数人只会背"头插法会导致死循环"，问到细节就卡壳了。

今天，我们把这个过程彻底讲清楚。

## 先说结论

JDK 7 HashMap 在并发场景下扩容，可能导致**死循环**和**数据丢失**。

- **死循环**：线程 A 和 B 同时扩容，形成环形链表，get() 永不返回
- **数据丢失**：部分节点在迁移过程中被覆盖

JDK 8 用尾插法解决了死循环，但数据覆盖问题仍然存在。

## 问题根源：头插法

JDK 7 扩容使用头插法：

```java
void transfer(Entry[] newTable) {
    Entry[] src = table;
    int newCapacity = newTable.length;
    
    for (int j = 0; j < src.length; j++) {
        Entry<K,V> e = src[j];
        if (e != null) {
            src[j] = null;
            do {
                Entry<K,V> next = e.next;
                int i = indexFor(e.hash, newCapacity);
                // 头插法：newEntry.next = 旧头
                e.next = newTable[i];
                newTable[i] = e;
                e = next;
            } while (e != null);
        }
    }
}
```

单线程没问题，但并发时，问题来了。

## 场景模拟：两个线程的死亡交叉

### 初始状态

```
table[2] -> A -> B -> C (A 是头节点)
```

### 时间线

**T1: 线程 A 进入 transfer()，开始扩容**

```java
// 线程 A 局部变量
Entry[] src = table;      // src[2] = A
Entry[] newTab = newTab;   // 新的空数组
Entry<K,V> e = src[2];    // e = A
Entry<K,V> next = e.next; // next = B

// 线程 A 执行了一步：
e.next = newTab[2];  // A.next = null (newTab[2] 是空的)
newTab[2] = A;       // newTab[2] = A
e = next;            // e = B
```

**T2: 线程 A 被挂起**

此时线程 A 的状态：
```
newTab[2]: A -> null
线程 A 的 e = B, next = C
```

**T3: 线程 B 开始执行 transfer()，完整跑完**

```java
// 线程 B 完整执行：
// 处理节点 A
A.next = newTab[2] = null;  // A.next = null
newTab[2] = A;               // newTab[2] = A
A = B.next = C;              // 继续

// 处理节点 B
B.next = newTab[2] = A;      // B.next = A
newTab[2] = B;               // newTab[2] = B
B = C;                       // 继续

// 处理节点 C
C.next = newTab[2] = B;      // C.next = B
newTab[2] = C;               // newTab[2] = C
C = null;                    // 结束

// 结果：newTab[2] = C -> B -> A -> null
// 链表顺序反转了
```

**T4: 线程 A 恢复执行，继续处理 B**

```java
// 线程 A 继续（注意：newTab 现在是 B 创建的那个）
int i = indexFor(B.hash, newCapacity);  // i = 2
e.next = newTab[i];   // B.next = A（线程 B 创建的 A）
newTab[i] = B;        // newTab[2] = B
e = next;            // e = C
```

**T5: 线程 A 继续处理 C**

```java
int i = indexFor(C.hash, newCapacity);  // i = 2
e.next = newTab[i];   // C.next = B
newTab[i] = C;        // newTab[2] = C
e = next;            // e = null，循环结束
```

### 最终结果

```
newTab[2]: C -> B -> A -> A
           |           |
           └───────────┘
            形成环形！
```

当调用 `get(A)` 时：

```java
for (Entry<K,V> e = tab[index]; e != null; e = e.next) {
    if (e.hash == h && e.key == k) {
        return e.value;
    }
}
```

因为 `A.next = A`，循环永不退出，CPU 100%。

## 图解死循环过程

```
初始链表: A -> B -> C

线程 A 处理: e=A, next=B
  A.next = null
  newTab[2] = A
  e = B
  
线程 A 被挂起，线程 B 完整执行:
  B.next = A
  C.next = B
  newTab[2] = C
  结果: C -> B -> A -> null

线程 A 恢复，处理 B:
  B.next = A (A 是线程 B 创建的)
  newTab[2] = B
  e = C
  
处理 C:
  C.next = B
  newTab[2] = C
  e = null

最终: C -> B -> A -> A (自环！)
```

## JDK 8 的解决方案：尾插法

JDK 8 改用尾插法：

```java
// JDK 8
do {
    Entry<K,V> next = e.next;
    int newIndex = (e.hash & oldCap) == 0 ? oldIndex : oldIndex + oldCap;
    e.next = newTab[newIndex];
    newTab[newIndex] = e;
    e = next;
} while (e != null);
```

关键区别：**按顺序把节点放到新链表尾部**。

```
原链表: A -> B -> C
JDK 7 新表: C -> B -> A (反转)
JDK 8 新表: A -> B -> C (顺序不变)
```

JDK 8 扩容后，链表顺序和原来一致，不会倒置，也就不会形成环形。

## JDK 8 解决了所有并发问题吗？

**没有。** JDK 8 只解决了死循环，并发 put 仍有问题。

### 并发覆盖问题

```java
// 线程 A 和 B 同时 put key="a", value 分别是 "A" 和 "B"
map.put("a", "A");  // 线程 A
map.put("a", "B");  // 线程 B
```

两个线程可能都判断 key 不存在，然后后者覆盖前者。这个问题 JDK 8 没有解决。

### 扩容时的数据丢失

```java
// 线程 A 正在 resize()
// 线程 B 执行 put，新值可能丢失
```

扩容过程中，如果其他线程执行 put，可能导致数据丢失或不一致。

**根本原因**：HashMap 本身不是为并发设计的。

## 真正线程安全的替代方案

| 方案 | 说明 |
|-----|------|
| `ConcurrentHashMap` | 分段锁（JDK 7）或 CAS + synchronized（JDK 8），推荐 |
| `Collections.synchronizedMap(map)` | 全局锁，性能较差 |
| `Hashtable` | 遗产类，全局 synchronized，不推荐 |

## 面试追问

### Q1: JDK 7 死循环只发生在扩容时吗？

**不只是扩容**。JDK 7 的头插法在每次插入新节点时都把新节点放到链表头部。

但在单线程下，头插法不会造成问题（只是链表顺序反转）。**只有并发 + 扩容同时发生**，才会形成环形链表。

### Q2: JDK 7 还有哪些并发问题？

1. **数据覆盖**：两个线程同时 put 新值，后者覆盖前者
2. **put 和 get 并发**：put 触发扩容，get 可能读到不一致的数据
3. **size() 不准确**：modCount 在并发下可能不准确

### Q3: 为什么 JDK 8 用尾插法而不是彻底解决并发问题？

因为**完全线程安全需要更大的代价**：

- 细粒度锁或 CAS 会增加复杂度
- 完全的并发安全意味着所有操作都要加锁，性能下降

HashMap 的定位是**高效的单线程实现**，而非线程安全的并发容器。JDK 8 解决死循环是一个务实的选择。

---

## 留给你的思考题

JDK 8 虽然用尾插法解决了死循环，但还有一个隐藏的并发问题：

在 JDK 8 的 `putVal()` 中，如果两个线程同时发现需要 `treeifyBin()`，会发生什么？

提示：`treeifyBin()` 会把链表转成红黑树，如果两个线程同时执行，可能会出现**树结构不完整**或**节点丢失**的问题。

JDK 8 实际上是用什么机制来处理这个场景的？

答案是 `TreeBin` 和 `MOVED` 节点。有兴趣可以去研究一下 JDK 8 的 `TreeBin.putTreeVal()` 方法。
