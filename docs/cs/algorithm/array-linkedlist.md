# 数组与链表：原理与对比


## 凌晨3点的「增删改查」

凌晨3点，你被线上告警叫醒——系统响应超时，P99延迟飙到了5秒。

登录服务器一看，CPU不高，内存够用，网络通畅。问题指向了一个不起眼的地方：大量随机插入操作。

你的系统用的是数组存储用户会话，而每次插入都需要移动后面所有元素。1万个在线用户，每人一次插入，就是 O(n × n) 的灾难。

这就是「数据结构选错了」的代价。

数组和链表，是最基础的数据结构，也是面试中最常被追问的起点。看似简单，但真正理解它们「为什么这样设计」，才是高手的标志。


## 数组：连续的内存布局

### 什么是数组？

数组（Array）是由相同类型的元素组成的有序集合，这些元素在内存中连续存储。

```java
int[] arr = new int[10];
```

这行代码做了什么？

1. JVM 在堆内存中申请了一块连续空间（10 × 4 = 40 字节）
2. 数组的起始地址保存在 `arr` 变量中
3. 元素通过索引直接计算偏移量访问：`address = base + index × elementSize`

这就是数组「随机访问」的精髓——**通过数学计算直接定位，不需要遍历**。

### 数组的查询：O(1) 的代价

```java
// 数组按下标访问
int value = arr[5];  // 一步到位，O(1)

// 链表按位置访问
Node node = head;
for (int i = 0; i < 5; i++) {
    node = node.next;  // 一步一步走，O(n)
}
```

数组访问是常数时间，链表是线性时间。但这背后有一个隐藏的前提：**数据在 CPU 缓存中**。

现代 CPU 有多级缓存，当访问数组的一个元素时，CPU 会预取（prefetch）相邻的多个元素到缓存中。这就是「缓存友好」的含义——**顺序访问数组时，访问模式可预测，缓存命中率高**。

但随机访问链表呢？每次 `node.next` 都可能是一次新的内存访问，缓存基本没用武之地。

### 数组的插入与删除：O(n) 的宿命

数组的插入和删除之所以是 O(n)，根本原因是「腾位置」：

```java
// 在数组中间插入元素
public void insert(int[] arr, int index, int value) {
    // 1. 先把 index 及其后面的元素全部后移
    for (int i = arr.length - 1; i > index; i--) {
        arr[i] = arr[i - 1];
    }
    // 2. 再放入新元素
    arr[index] = value;
}
```

插入一个元素，最坏情况需要移动 n 个元素。删除同理，只是方向相反。

### 数组的扩容：动态数组的实现

Java 的 `ArrayList` 之所以能「动态增长」，靠的是「扩容」机制：

```java
// ArrayList 扩容核心逻辑（简化版）
private void ensureCapacity(int minCapacity) {
    if (minCapacity > elementData.length) {
        int newCapacity = elementData.length + (elementData.length >> 1);  // 扩容 1.5 倍
        // 复制原数组到新数组
        elementData = Arrays.copyOf(elementData, newCapacity);
    }
}
```

扩容过程：
1. 申请一个更大的数组（通常是 1.5 倍或 2 倍）
2. 把原数组的所有元素复制过去
3. 替换引用

扩容的代价是 O(n)，但均摊到每次插入，实际是 **O(1)**。这就是「均摊复杂度」的概念——偶尔的高代价被多次低代价平摊。


## 链表：灵活的节点串连

### 什么是链表？

链表（Linked List）由一系列节点组成，每个节点包含数据和指向下一个节点的引用（指针）。

```java
public class ListNode {
    int val;
    ListNode next;
    
    ListNode(int val) {
        this.val = val;
    }
}
```

### 单向链表的基本操作

```java
// 单向链表的头插法
public void addFirst(ListNode head, int val) {
    ListNode newNode = new ListNode(val);
    newNode.next = head;
    head = newNode;  // 注意：这里修改的是局部变量
}

// 单向链表的尾插法
public void addLast(ListNode head, int val) {
    ListNode newNode = new ListNode(val);
    ListNode cur = head;
    while (cur.next != null) {
        cur = cur.next;
    }
    cur.next = newNode;
}

// 按值删除
public ListNode remove(ListNode head, int val) {
    if (head == null) return null;
    if (head.val == val) return head.next;
    
    ListNode cur = head;
    while (cur.next != null && cur.next.val != val) {
        cur = cur.next;
    }
    if (cur.next != null) {
        cur.next = cur.next.next;
    }
    return head;
}
```

### 双向链表：更灵活的代价

双向链表的节点有两个指针——指向前驱和后继：

```java
public class DNode {
    int val;
    DNode prev;
    DNode next;
}
```

```java
// 双向链表的插入（O(1)）
public void insert(DNode prev, DNode newNode) {
    newNode.next = prev.next;
    newNode.prev = prev;
    if (prev.next != null) {
        prev.next.prev = newNode;
    }
    prev.next = newNode;
}
```

双向链表的插入和删除只需要 O(1)，但代价是每个节点多一个指针的空间开销，以及维护两个指针的复杂度。

Java 的 `LinkedList` 就是双向链表的实现，而 `ArrayList` 是动态数组的实现。

### 链表的问题：缓存不友好

链表的致命缺陷不是时间复杂度，而是**内存访问模式**。

```java
// 遍历链表
ListNode cur = head;
while (cur != null) {
    process(cur.val);  // 每次访问都可能是新内存
    cur = cur.next;
}
```

每次访问 `cur.val` 和 `cur.next`，都可能触发一次内存加载。在现代计算机中，内存访问延迟是 CPU 计算的数百倍。

这就是为什么在高性能场景下，人们更倾向于用数组（或者使用对象池来复用节点）。


## 数组 vs 链表：如何选择？

| 操作 | 数组 | 链表 |
|------|------|------|
| 随机访问 | O(1) | O(n) |
| 头部插入/删除 | O(n) | O(1) |
| 尾部插入 | O(1)（均摊） | O(1)（有尾指针） |
| 中间插入/删除 | O(n) | O(1)（定位后） |
| 空间效率 | 高（无额外开销） | 低（每个节点多一个指针） |
| 缓存友好性 | 高 | 低 |

### 实战场景的选择

**选数组的场景：**
- 需要频繁随机访问（索引访问）
- 数据量相对固定，不太需要频繁增删
- 追求缓存友好性（遍历、顺序处理）
- 需要高效的元素查找

**选链表的场景：**
- 需要频繁在任意位置插入/删除
- 数据量动态变化，无法预估大小
- 主要在头部或尾部操作
- 需要使用对象池优化内存分配

### 一个反直觉的事实

很多人以为链表的插入比数组快，因为是 O(1)。但这只是「插入操作」本身是 O(1)。

实际上，链表的插入需要先定位（O(n)），再插入（O(1)），总复杂度还是 O(n)。

只有一种情况链表真正优于数组：**在已知位置（如头部）插入，且不需要遍历**。


## 经典面试题：LRU 缓存

这是数组 vs 链表思想的经典应用——用双向链表 + 哈希表实现 LRU（最近最少使用）缓存：

```java
public class LRUCache {
    // 哈希表：O(1) 查找
    private Map&lt;Integer, DNode&gt; cache;
    // 双向链表：O(1) 插入/删除
    private DNode head, tail;
    private int capacity;

    public LRUCache(int capacity) {
        this.capacity = capacity;
        this.cache = new HashMap&lt;&gt;();
        this.head = new DNode(0);
        this.tail = new DNode(0);
        head.next = tail;
        tail.prev = head;
    }

    public int get(int key) {
        if (!cache.containsKey(key)) return -1;
        DNode node = cache.get(key);
        // 移动到头部（最近使用）
        moveToHead(node);
        return node.val;
    }

    public void put(int key, int val) {
        if (cache.containsKey(key)) {
            DNode node = cache.get(key);
            node.val = val;
            moveToHead(node);
        } else {
            DNode newNode = new DNode(val);
            cache.put(key, newNode);
            addToHead(newNode);
            if (cache.size() > capacity) {
                DNode removed = removeTail();
                cache.remove(removed.val);
            }
        }
    }
}
```

这个实现完美结合了两种数据结构：哈希表的 O(1) 查找 + 双向链表的 O(1) 增删。


## 总结

数组和链表是所有复杂数据结构的基石。理解它们的关键不在于背复杂度，而在于理解**时空权衡**：

- **数组**：用空间换时间（预分配、连续内存）
- **链表**：用灵活性换可控性（动态大小、O(1) 头部操作）

没有绝对的好坏，只有场景的匹配。

## 面试追问方向

- 如何判断链表是否有环？（快慢指针）
- 如何在 O(n) 时间内对链表进行排序？（归并排序的链表版本）
- 如何实现一个线程安全的链表？（锁分段 or 无锁链表）
- 数组和链表的内存分配有什么区别？（堆 vs 栈、连续 vs 离散）
