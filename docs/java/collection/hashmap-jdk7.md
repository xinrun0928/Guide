# HashMap 在 JDK 7 中的秘密：数组 + 链表 + 头插法

你可能听说过 HashMap 在 JDK 7 中有"死循环"问题，但你知道死循环是怎么形成的吗？

先别急着说"我只要用 JDK 8 就没事了"——理解历史问题，才能真正掌握技术本质。

今天，我们从 JDK 7 的 HashMap 说起。

## 底层结构：Entry 数组 + 链表

JDK 7 的 HashMap 核心是 `Entry[] table`，每个 Entry 是一个链表节点。

```java
static class Entry<K,V> implements Map.Entry<K,V> {
    final K key;
    V value;
    Entry<K,V> next;  // 指向下一个节点
    int hash;
}
```

当你 `put("name", "zhangsan")` 时，JVM 会：

1. 计算 key 的 hash 值
2. 用 `(n - 1) & hash` 定位数组下标
3. 如果该位置为空，直接放进去；如果不为空，插入链表头部

等等，插入链表**头部**？这可不是随手一写，这里面藏着后续所有故事的伏笔。

## hash 算法：扰动函数的设计

JDK 7 的 hash 函数长这样：

```java
final int hash(Object k) {
    int h = 0;
    h ^= k.hashCode();
    h ^= (h >>> 20) ^ (h >>> 12);
    return h ^ (h >>> 7) ^ (h >>> 4);
}
```

`h ^= k.hashCode()` 把对象的 hashCode 混进去，然后右移、再异或、再右移、再异或...

为什么要这么折腾？

因为 `table[i = (n - 1) & hash]` 只用到 hash 的低几位。如果 key 的 hashCode 分布不均匀（比如总是低位为 0），那么所有 key 都会挤到少数几个桶里。

扰动函数的目的是：**让 hash 值的低位和高位都参与运算，减少哈希碰撞**。

JDK 8 简化了这个过程（后面会讲），但核心思想一致。

## 头插法：万恶之源

来看看 JDK 7 的 `addEntry()` 方法：

```java
void addEntry(int hash, K key, V value, int bucketIndex) {
    // 如果超过阈值，扩容
    if (++size > threshold) {
        resize(2 * table.length);
    }
    
    Entry<K,V> e = table[bucketIndex];
    // 关键在这里：newEntry.next = 旧头节点
    table[bucketIndex] = new Entry<>(hash, key, value, e);
}
```

每次新插入的节点，都指向原来的头节点，然后把自己放到数组位置。这就是**头插法**。

示意图：

```
插入前：table[2] -> A -> B -> C
插入后：table[2] -> NEW -> A -> B -> C
```

看起来很正常，对吧？但当**扩容**发生时，问题就来了。

## 扩容：链表倒置的现场

JDK 7 的 `resize()` 方法会重新计算每个节点的新位置：

```java
void transfer(Entry[] newTable) {
    Entry[] src = table;
    int newCapacity = newTable.length;
    
    for (int j = 0; j < src.length; j++) {
        Entry<K,V> e = src[j];
        if (e != null) {
            src[j] = null;  // 释放旧表引用
            do {
                Entry<K,V> next = e.next;
                // 重新计算位置
                int i = indexFor(e.hash, newCapacity);
                // 又是头插法！
                e.next = newTable[i];
                newTable[i] = e;
                e = next;
            } while (e != null);
        }
    }
}
```

看到关键点了吗？**又是头插法**。

单线程下，这段代码没问题。但如果是两个线程同时扩容...

## 两个线程的"死亡螺旋"

假设链表结构是 `A -> B -> C`（A 是头节点），扩容到 2 倍容量后，A、B、C 应该在同一个新桶中（因为容量翻倍后，原位置不变）。

**线程 1** 正在执行 transfer，走到一半：

```
src[2]: A -> B -> C (正在遍历，已经处理了 A)
线程1的 newTable[2]: C -> B（已经头插了 C 和 B）
线程1的 e = B
```

**线程 2** 此时也进入 transfer，它从头开始：

```
newTable[2]: C -> B -> A（头插 C，头插 B，头插 A）
```

等等，看起来也没问题？让我们更仔细地模拟...

### 死循环的完整过程

实际上，当两个线程**交替执行**时，问题才会真正爆发：

```
初始状态：table[2] -> A -> B -> C
```

**线程 1** 执行 `e = A, next = B`，然后被 OS 挂起。

此时线程 1 的局部变量：`e = A, next = B, newTable[2] = null`

**线程 2** 开始执行 transfer，完整跑完了：

```
newTable[2]: A -> B -> C（因为头插，C先进，A后进，所以 A 在最前面）
```

**线程 1** 恢复执行，继续处理：

```java
// 线程1继续
int i = indexFor(e.hash, newCapacity);  // i = 2
e.next = newTable[2];  // A.next = A（自己！）
newTable[2] = A;        // table[2] = A
e = next;               // e = B
```

注意！`e.next = newTable[2]` 时，`newTable[2]` 已经指向 A，所以 `A.next = A`，**形成了自环**。

然后继续处理 B：

```java
int i = indexFor(B.hash, newCapacity);
B.next = newTable[2];  // B.next = A
newTable[2] = B;        // table[2] = B
e = C;
```

最后处理 C：

```java
int i = indexFor(C.hash, newCapacity);
C.next = newTable[2];  // C.next = B
newTable[2] = C;
e = null;  // 循环结束
```

最终状态：`table[2] -> C -> B -> A -> A`（A.next = A，环形链表）

## 死循环的后果

当你调用 `get("A")` 时：

```java
public V get(Object key) {
    Entry<K,V> e = entryForNullKey;
    int h = hash(key);
    Entry<K,V>[] tab = table;
    
    for (Entry<K,V> e = tab[indexFor(h, tab.length)];
         e != null; e = e.next) {
        // 这个循环永远不会结束！
        if (e.hash == h && e.key == key) {
            return e.value;
        }
    }
    return null;
}
```

`for` 循环遍历链表，因为 A.next = A，循环不会退出，**CPU 100%，线程假死**。

这就是 JDK 7 HashMap 并发下的"死循环"问题。

## JDK 8 怎么解决的？

核心改动就一个：**尾插法**。

JDK 8 扩容时，遍历链表，把每个节点**插入到新链表尾部**：

```java
// JDK 8 扩容逻辑（简化）
do {
    Entry<K,V> next = e.next;
    int newIndex = (e.hash & oldCap) == 0 ? j : j + oldCap;
    e.next = newTab[newIndex];
    newTab[newIndex] = e;
    e = next;
} while (e != null);
```

这样扩容后的链表顺序和原顺序一致，不会倒置，也就不会形成环形。

但这只是解决了死循环问题，**HashMap 本身仍然是线程不安全的**。并发 put 仍可能导致数据覆盖，JDK 8 并没有解决这个问题。

## 面试追问

### Q1: JDK 7 中 HashMap 真的只是"死循环"问题吗？

不，还有**数据覆盖**问题。

考虑这个场景：

```java
// 线程 A 和线程 B 同时 put 同一个 key
// 假设都定位到 table[2]

// 线程 A：判断 key 不存在，准备插入
// 线程 A 被挂起

// 线程 B：判断 key 不存在，插入成功
// 线程 B 完成

// 线程 A 恢复：覆盖了线程 B 的值
value = newValue;  // 线程 A 的 value 覆盖了线程 B 的
return oldValue;   // 返回的 oldValue 是对的，但数据已经被覆盖
```

所以面试时不要只说"死循环"，要提到**并发下的数据覆盖**问题。

### Q2: 为什么扩容是 2 倍而不是 3 倍、1.5 倍？

这是时间和空间的权衡：

- 扩容太少：频繁 rehash，哈希碰撞加剧
- 扩容太多：空间浪费，内存占用高

0.75 的负载因子 + 2 倍扩容，是经过大量测试的平衡点。JDK 团队在选择这个因子时考虑了平均查找长度和内存利用率。

### Q3: JDK 7 的头插法有什么"优点"吗？

其实头插法有一个隐藏的好处：**最近访问的 key 放在链表头部，查找更快**。

这类似于 LRU 的思想。但为了解决并发问题，JDK 8 不得不放弃这个优化。

---

## 留给你的思考题

JDK 8 用尾插法解决了死循环问题，但还有一个隐藏的并发问题：

假设两个线程同时 put，key 不存在，都判断需要树化——JDK 8 是怎么处理的？

提示：和 `TreeBin`、`MOVED` 状态有关。

这个问题，值得你去翻一翻 JDK 8 的源码。
