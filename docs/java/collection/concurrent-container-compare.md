# 各并发容器对比与选型

Java 并发容器的种类很多，但每种都有其适用场景。

选错了，性能可能比单线程还差。

今天，我们来彻底搞清这些容器的区别和选型原则。

## 并发 Map 对比

| 特性 | ConcurrentHashMap | Collections.synchronizedMap | Hashtable |
|-----|-------------------|---------------------------|----------|
| 并发度 | 高（桶级锁） | 低（全表锁） | 低（全表锁） |
| null key/value | 不允许 | 允许 | 不允许 |
| 迭代器 | 弱一致 | 快速失败 | 非快速失败 |
| 性能 | 高 | 低 | 低 |
| 推荐 | **是** | 可选 | 否 |

### 选型建议

```java
// 高并发场景（推荐）
ConcurrentHashMap<String, String> map = new ConcurrentHashMap<>();

// 需要原子复合操作
Map<String, String> map = Collections.synchronizedMap(new HashMap<>());
synchronized (map) {
    if (!map.containsKey(key)) {
        map.put(key, value);  // check-then-act
    }
}

// 需要有序 + 并发
ConcurrentSkipListMap<String, String> map = new ConcurrentSkipListMap<>();
```

## 并发 List 对比

| 特性 | CopyOnWriteArrayList | Collections.synchronizedList | Vector |
|-----|---------------------|------------------------------|--------|
| 读性能 | 极高（无锁） | 低（需加锁） | 低（需加锁） |
| 写性能 | 低（复制数组） | 低（需加锁） | 低（需加锁） |
| 迭代器 | 弱一致 | 快速失败 | 快速失败 |
| 内存 | 高（每次复制） | 低 | 低 |
| 适用场景 | 读多写少 | 写多读少 | 几乎不用 |

### 选型建议

```java
// 读多写少（监听器列表、配置）
CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();
for (Listener listener : listeners) {  // 迭代无需同步
    listener.onEvent();
}

// 写多读少
List<String> list = Collections.synchronizedList(new ArrayList<>());

// 几乎不用 Vector
List<String> v = new Vector<>();  // 遗留类
```

## 并发 Set 对比

| 特性 | ConcurrentHashMap.newKeySet() | Collections.synchronizedSet | CopyOnWriteArraySet |
|-----|------------------------------|----------------------------|---------------------|
| 底层 | ConcurrentHashMap | synchronized Set | CopyOnWriteArrayList |
| 性能 | 高 | 低 | 读高写低 |
| 适用场景 | 高并发 set | 一般并发 | 读多写少 |

### 选型建议

```java
// 高并发 Set（推荐）
Set<String> set = ConcurrentHashMap.<String>newKeySet();

// 需要保留不支持的方法时
Set<String> set = Collections.synchronizedSet(new HashSet<>());

// 读多写少的 Set
Set<String> set = new CopyOnWriteArraySet<>();
```

## 并发 Queue 对比

| 特性 | ConcurrentLinkedQueue | ArrayBlockingQueue | LinkedBlockingQueue |
|-----|----------------------|-------------------|-------------------|
| 阻塞 | 非阻塞 | 阻塞 | 阻塞 |
| 容量 | 无界 | 有界 | 可选有界 |
| 锁 | 无锁（CAS） | 一把锁 | 两把锁 |
| 吞吐量 | 最高 | 中等 | 高 |

### 选型建议

```java
// 高并发非阻塞（推荐）
ConcurrentLinkedQueue<String> queue = new ConcurrentLinkedQueue<>();

// 需要阻塞能力（有界队列）
BlockingQueue<String> bounded = new ArrayBlockingQueue<>(100);

// 需要阻塞能力（高吞吐量）
BlockingQueue<String> highThroughput = new LinkedBlockingQueue<>(1000);

// 生产者-消费者模式
BlockingQueue<String> pcQueue = new LinkedBlockingQueue<>(50);
```

## BlockingQueue 选型

| 场景 | 推荐队列 | 原因 |
|-----|---------|------|
| 固定容量、生产者-消费者 | ArrayBlockingQueue | 有界，容量可控 |
| 高吞吐量、生产者-消费者 | LinkedBlockingQueue | 双锁，吞吐量高 |
| 按优先级处理 | PriorityBlockingQueue | 支持优先级排序 |
| 延迟任务 | DelayQueue | 延迟获取元素 |
| 直接传递、零缓冲 | SynchronousQueue | 不存储元素 |
| 线程池任务队列 | LinkedBlockingQueue | 默认选择 |

## 完整选型指南

### 场景一：高并发缓存

```java
// ConcurrentHashMap 最适合
ConcurrentHashMap<String, Object> cache = new ConcurrentHashMap<>();
cache.putIfAbsent(key, computeValue());
```

### 场景二：监听器列表

```java
// CopyOnWriteArrayList 最适合
CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();
listeners.add(listener);
for (Listener l : listeners) {  // 无需同步迭代
    l.onEvent();
}
```

### 场景三：生产者-消费者队列

```java
// 有界阻塞队列
BlockingQueue<Task> queue = new ArrayBlockingQueue<>(100);

// 生产者
while (true) {
    Task task = produce();
    queue.put(task);  // 队满则阻塞
}

// 消费者
while (true) {
    Task task = queue.take();  // 队空则阻塞
    process(task);
}
```

### 场景四：排行榜

```java
// ConcurrentSkipListMap 支持有序
ConcurrentSkipListMap<Integer, String> ranking = new ConcurrentSkipListMap<>(
    Comparator.reverseOrder()  // 分数高的排前面
);
ranking.put(100, "Alice");
ranking.put(90, "Bob");
```

### 场景五：去重 Set

```java
// ConcurrentHashMap.newKeySet() 最简洁
Set<String> seen = ConcurrentHashMap.<String>newKeySet();
if (seen.add(url)) {
    crawl(url);  // 第一次见到的 URL
}
```

## 线程安全集合 vs 同步包装

```java
// 线程安全集合（推荐）
ConcurrentHashMap<K, V> map = new ConcurrentHashMap<>();
CopyOnWriteArrayList<E> list = new CopyOnWriteArrayList<>();
ConcurrentLinkedQueue<E> queue = new ConcurrentLinkedQueue<>();

// 同步包装（性能较差，仅用于兼容旧代码）
Map<K, V> map = Collections.synchronizedMap(new HashMap<>());
List<E> list = Collections.synchronizedList(new ArrayList<>());
```

| 包装类 | 问题 |
|-------|------|
| synchronizedMap | 所有操作都加全局锁 |
| synchronizedList | 同上 |
| synchronizedSet | 同上 |
| synchronizedMap/NavigableMap | 范围操作需要额外同步 |

## 面试追问

### Q1: 什么情况下用同步包装而不是并发容器？

1. **需要强一致性**：并发容器的迭代器是弱一致的
2. **兼容旧代码**：有些遗留 API 只接受特定类型
3. **简单场景**：并发度极低，同步包装的性能损失可忽略

### Q2: ConcurrentHashMap 可以完全替代 synchronizedMap 吗？

不完全是。ConcurrentHashMap 的单个操作是原子的，但**复合操作不是原子的**：

```java
// 不是原子操作！
if (!map.containsKey(key)) {
    map.put(key, value);  // 可能在判断后被其他线程修改
}

// 需要这样做
map.putIfAbsent(key, value);  // 原子操作
```

对于 check-then-act 模式，需要用原子方法或外部同步。

### Q3: LinkedBlockingQueue 为什么比 ArrayBlockingQueue 吞吐量大？

1. **双锁机制**：入队和出队用不同的锁，可以并发进行
2. **链表特性**：无需像数组那样搬移元素
3. **减少竞争**：入队线程和出队线程不竞争同一把锁

但 ArrayBlockingQueue 的优势是**内存占用稳定**（预分配数组），适合内存敏感场景。

---

## 留给你的思考题

设计一个高并发的限流系统，需要：

1. 记录每个用户的请求次数
2. 超过阈值（每分钟 100 次）就拒绝请求
3. 支持分布式部署

你会选择哪种并发容器？如何保证准确性？

提示：
- 用什么数据结构记录次数？
- 如何实现滑动窗口？
- 如何解决分布式一致性问题？

理解这个问题，你就掌握了并发容器在实际生产中的高级应用。
