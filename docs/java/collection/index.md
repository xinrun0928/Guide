# 集合框架

Java 集合框架是日常开发中使用最频繁的 API 之一，也是面试的必考战场。

从最简单的 `ArrayList` 到高性能的 `ConcurrentHashMap`，从无序的 `HashSet` 到有序的 `TreeSet`——每一个集合背后都有精心设计的数据结构与算法。这一模块，会把它们一一拆解给你看。

---

## 模块内容

### Collection 体系

集合框架的顶层结构，决定了你选择哪种集合。

- [Collection 接口结构与分类](/java/collection/collection-hierarchy)：Iterable → Collection → List/Set/Queue 继承体系
- [List：ArrayList、LinkedList、Vector](/java/collection/list)：三种列表的特点、适用场景、性能差异
- [ArrayList 扩容机制与位运算](/java/collection/arraylist-resize)：grow() 源码、1.5 倍扩容、位运算优化
- [ArrayList vs LinkedList 深度对比](/java/collection/arraylist-vs-linkedlist)：缓存命中率分析、真实场景性能对比

### Set 与散列表

HashSet 的背后是 HashMap，HashMap 的背后是哈希表——这是一条完整的知识链。

- [HashSet 实现原理](/java/collection/hashset)：HashSet = HashMap、所有操作都委托给 HashMap
- [HashMap 底层结构与寻址算法](/java/collection/hashmap)：数组 + 链表/红黑树、index = (n-1) & hash
- [HashMap 的扰动函数与哈希冲突](/java/collection/hashmap-hash)：JDK 7 vs JDK 8 扰动函数、为什么要异或高 16 位
- [负载因子 0.75 的深层原因](/java/collection/loadfactor)：泊松分布分析、空间与时间的平衡艺术
- [HashSet 如何判断元素重复](/java/collection/hashset-duplicate)：hashCode() + equals() 的协作机制
- [LinkedHashSet 与访问顺序 LRU](/java/collection/linkedhashset)：accessOrder = true 实现 LRU 缓存
- [TreeSet 与红黑树](/java/collection/treeset)：NavigableSet 接口、红黑树的导航方法

### HashMap 专题（JDK 7 vs JDK 8）

这是集合框架中最重要的一节——面试中 HashMap 的问题可以问到天荒地老。

- [JDK 7：数组 + 链表 + 头插法](/java/collection/hashmap-jdk7)：JDK 7 的数据结构、死循环的根源
- [JDK 8：数组 + 链表/红黑树 + 尾插法](/java/collection/hashmap-jdk8)：红黑树的引入、尾插法的优势
- [HashMap.put() 全流程源码解析](/java/collection/hashmap-put)：put 的六个步骤完整图解
- [HashMap 扩容时机与 resize 过程](/java/collection/hashmap-resize)：JDK 8 扩容优化、不重新计算 hash
- [树化条件：链表长度 > 8 且容量 >= 64](/java/collection/hashmap-treeify)：泊松分布证明、容量 < 64 时优先扩容
- [JDK 7 扩容死循环问题](/java/collection/hashmap-resize-loop)：头插法 + 多线程 = 环形链表、get() 死循环的全过程

### Map 接口其他实现

除了 HashMap，Map 还有这些重要实现。

- [LinkedHashMap 与 LRU 缓存实现](/java/collection/linkedhashmap)：before/after 双向链表、removeEldestEntry()
- [TreeMap：Comparable vs Comparator](/java/collection/treemap)：红黑树实现、自定义排序
- [Hashtable：为什么不再推荐](/java/collection/hashtable)：synchronized 全表锁、遗产类
- [WeakHashMap 与弱引用](/java/collection/weakhashmap)：弱引用在缓存中的应用

### 并发容器

在多线程环境下，普通集合不再安全——你需要并发容器。

- [ConcurrentHashMap JDK 7：Segment 分段锁](/java/collection/concurrent-hashmap-jdk7)：Segment 数组、16 个独立锁
- [ConcurrentHashMap JDK 8+：CAS + synchronized](/java/collection/concurrent-hashmap-jdk8)：锁细化到桶、CAS + synchronized 的协作
- [ConcurrentHashMap size() 方法演进](/java/collection/concurrent-hashmap-size)：JDK 7 的多次 CAS vs JDK 8 的 CounterCell
- [CopyOnWriteArrayList 原理与适用场景](/java/collection/copyonwritearraylist)：读不阻塞、读写不冲突、内存占用代价
- [ConcurrentLinkedQueue 无锁实现原理](/java/collection/concurrent-linked-queue)：CAS + volatile、无锁队列的精髓
- [BlockingQueue 体系与生产者-消费者模式](/java/collection/blocking-queue)：ArrayBlockingQueue、LinkedBlockingQueue、PriorityBlockingQueue
- [各并发容器对比与选型](/java/collection/concurrent-container-compare)：场景化选型建议

### Queue 与 Deque

队列是许多高级数据结构和算法的基石。

- [Queue 接口与实现类](/java/collection/queue)：offer/poll/peek vs add/remove/element
- [PriorityQueue 堆结构与排序](/java/collection/priority-queue)：最小堆、上浮与下沉、Top K 问题
- [ArrayDeque：比 LinkedList 更快的双端队列](/java/collection/array-deque)：循环数组、为什么比 LinkedList 快

### 工具类

- [Collections 工具类常用方法](/java/collection/collections-tool)：sort、binarySearch、synchronizedMap、unmodifiableMap

---

## 学习路线建议

```
第一阶段：Collection 体系 → List → ArrayList 扩容（建立基础）
         ↓
第二阶段：HashMap 底层结构 → HashMap 专题（JDK 7 vs JDK 8）★ 重点
         ↓
第三阶段：Set 与散列表 → Map 其他实现 → 并发容器 → Queue
```

## 面试核心考点

| 高频考点 | 关联文档 |
|---|---|
| HashMap 死循环 | [JDK 7 扩容死循环](/java/collection/hashmap-resize-loop)、[JDK 7 实现](/java/collection/hashmap-jdk7) |
| HashMap 1.8 红黑树 | [JDK 8 实现](/java/collection/hashmap-jdk8)、[树化条件](/java/collection/hashmap-treeify) |
| ConcurrentHashMap 并发机制 | [JDK 7 分段锁](/java/collection/concurrent-hashmap-jdk7)、[JDK 8 CAS+synchronized](/java/collection/concurrent-hashmap-jdk8) |
| HashMap 扩容 | [扩容时机](/java/collection/hashmap-resize)、[ArrayList 扩容](/java/collection/arraylist-resize) |
| HashMap 扰动函数 | [扰动函数与哈希冲突](/java/collection/hashmap-hash) |
|负载因子 | [负载因子 0.75](/java/collection/loadfactor) |
