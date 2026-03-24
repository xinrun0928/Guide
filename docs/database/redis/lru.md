# LRU 算法实现：近似 LRU vs 精确 LRU

面试官：「Redis 用的是什么 LRU 算法？」

你：「近似 LRU。」

面试官：「为什么不是真正的 LRU？」

你：「……」

今天来聊聊 Redis 的 LRU 实现。

## 什么是 LRU？

LRU（Least Recently Used）：**最近最少使用**。

核心思想：**如果一个数据最近被访问过，将来被访问的概率也更高**。

```
访问顺序：key1 → key2 → key3 → key1 → key4

按最近访问时间排序（从新到旧）：
key4 → key1 → key3 → key2

淘汰时，删除最久未访问的（key2）：
```

## LRU 的实现方式

### 方式一：双向链表 + 哈希表

```java
/**
 * 真正的 LRU 实现
 * 
 * 双向链表：维护访问顺序
 * 哈希表：O(1) 查找
 */
public class TrueLRUCache<K, V> {
    
    // 双向链表节点
    static class Node<K, V> {
        K key;
        V value;
        Node<K, V> prev;
        Node<K, V> next;
    }
    
    // 双向链表头（最新访问）
    private Node<K, V> head;
    // 双向链表尾（最久未访问）
    private Node<K, V> tail;
    // 哈希表：key → Node
    private Map<K, Node<K, V>> cache;
    // 容量
    private int capacity;
    
    public TrueLRUCache(int capacity) {
        this.capacity = capacity;
        this.cache = new HashMap<>();
        this.head = new Node<>();
        this.tail = new Node<>();
        head.next = tail;
        tail.prev = head;
    }
    
    /**
     * 访问数据
     */
    public V get(K key) {
        Node<K, V> node = cache.get(key);
        if (node == null) return null;
        
        // 移到链表头部
        moveToHead(node);
        return node.value;
    }
    
    /**
     * 写入数据
     */
    public void put(K key, V value) {
        Node<K, V> node = cache.get(key);
        if (node != null) {
            // 更新
            node.value = value;
            moveToHead(node);
        } else {
            // 新增
            Node<K, V> newNode = new Node<>(key, value);
            cache.put(key, newNode);
            addToHead(newNode);
            
            // 淘汰
            if (cache.size() > capacity) {
                Node<K, V> removed = removeTail();
                cache.remove(removed.key);
            }
        }
    }
    
    /**
     * 移到链表头部（最近访问）
     */
    private void moveToHead(Node<K, V> node) {
        removeNode(node);
        addToHead(node);
    }
    
    /**
     * 删除链表尾部（最久未访问）
     */
    private Node<K, V> removeTail() {
        Node<K, V> node = tail.prev;
        removeNode(node);
        return node;
    }
    
    // ... 其他辅助方法
}
```

**复杂度分析**：

| 操作 | 时间复杂度 | 空间复杂度 |
|-----|-----------|-----------|
| get | O(1) | - |
| put | O(1) | O(n) |
| 淘汰 | O(1) | - |

### 方式二：数组 + 移动

```java
/**
 * 简单 LRU（数组实现）
 * 
 * 问题：每次访问都需要移动元素
 */
public class SimpleLRUCache<K, V> {
    private List<Node<K, V>> list;
    private int capacity;
    
    public V get(K key) {
        for (Node<K, V> node : list) {
            if (node.key.equals(key)) {
                // 移到列表头部（需要移动元素）
                list.remove(node);
                list.add(0, node);
                return node.value;
            }
        }
        return null;
    }
}
```

**复杂度分析**：

| 操作 | 时间复杂度 |
|-----|-----------|
| get | O(n) |
| put | O(n) |

## Redis 的近似 LRU

### 为什么 Redis 用近似 LRU？

```c
// 真正 LRU 的问题：
// 1. 需要维护双向链表
// 2. 每次访问都要移动节点
// 3. 内存开销大

// Redis 的设计哲学：
// - 单线程，不想引入太多开销
// - 内存敏感，不想像 Java 那样每个节点都占几十字节
// - 近似 LRU 已经足够好
```

### Redis 的 LRU 实现

```c
// 每个 redisObject 有 24 位的 LRU 时钟
typedef struct redisObject {
    unsigned type:4;       // 类型
    unsigned encoding:4;     // 编码
    unsigned lru:24;        // LRU 时钟（只占 3 字节）
    // ...
} robj;

// LRU 时钟的定义
#define LRU_BITS 24
#define LRU_CLOCK_MAX ((1<<LRU_BITS)-1)  // 1600 万
#define LRU_CLOCK_RESOLUTION 1000  // 毫秒级

// 获取当前 LRU 时钟值
unsigned int getLRUClock(void) {
    return (mstime() / LRU_CLOCK_RESOLUTION) & LRU_CLOCK_MAX;
}
```

### 近似 LRU 算法

```c
// Redis 淘汰池（eviction pool）
typedef struct {
    unsigned long long idle;    // 空闲时间
    robj *key;                  // key 对象
} evictionPoolEntry;

// 近似 LRU 淘汰过程
int freeMemoryIfNeeded(void) {
    // 1. 初始化淘汰池
    static evictionPoolEntry pool[MAX_MEMORY_EVICTION_POOL_SIZE];
    
    // 2. 随机采样
    for (int i = 0; i < server.maxmemory_samples; i++) {
        // 随机选择一个 key
        robj *key = selectRandomKey();
        
        // 计算空闲时间（LRU 时钟的差值）
        unsigned long long idle = estimateIdleTime(key);
        
        // 插入到淘汰池（按空闲时间排序）
        insertIntoPool(pool, key, idle);
    }
    
    // 3. 从淘汰池选择要淘汰的 key
    robj *evictKey = pool[0].key;
    
    // 4. 删除 key
    deleteKey(evictKey);
}

// 估计空闲时间
unsigned long long estimateIdleTime(robj *key) {
    unsigned int clock = getLRUClock();
    unsigned int keyClock = objectGetLRU(key);
    // 差值就是空闲时间（越大表示越久没访问）
    return (clock - keyClock) & REDIS_LRU_CLOCK_MAX;
}
```

### 淘汰池的结构

```
淘汰池（按 idle 从大到小排序）：

┌─────────────────────────────────────────────────────┐
│  index 0  │  idle: 10000  │  key: "key3"  │  ← 最久未访问 │
│  index 1  │  idle: 5000   │  key: "key1"  │
│  index 2  │  idle: 2000   │  key: "key5"  │
│  index 3  │  idle: 500    │  key: "key2"  │
│  ...      │  ...         │  ...         │
└─────────────────────────────────────────────────────┘
       ↑
       淘汰时，选择 index 0（最久未访问）
```

### 近似 LRU vs 真实 LRU

| 维度 | 近似 LRU | 真实 LRU |
|-----|---------|---------|
| 精确度 | 采样可能选错 | 精确选择最久未访问 |
| 时间复杂度 | O(1) 采样 + O(n log n) 排序 | O(1) |
| 内存开销 | 每个 key 额外 3 字节 | 每个节点双向链表指针 |
| 实现复杂度 | 低 | 高 |

### 采样数量的影响

```bash
# maxmemory-samples 越大越精确，越慢
# 
# 采样 5 个：快速，约 40% 准确
# 采样 10 个：更精确，约 60% 准确
# 采样 50 个：非常接近真实 LRU

maxmemory-samples 5
```

实验数据（Redis 官方）：

```
采样数量    命中率对比真实 LRU
──────────────────────────────
5          45%
10         60%
50         90%
```

## LRU vs LFU

### LRU 的问题

LRU 只看访问时间，不看访问频率：

```
场景：热点 key 偶尔被访问一次，然后很久没访问
      冷 key 每次访问都被访问

LRU 可能会淘汰热点 key，保留冷 key
```

### LFU 的优势

LFU（Least Frequently Used）记录访问频率：

```c
// LFU 实现（Redis 4.0+）
typedef struct redisObject {
    unsigned type:4;
    unsigned encoding:4;
    unsigned lru:24;  // 16位访问次数 + 8位衰减时间
} robj;

// 访问次数计数器
uint16_t counter = o->lru >> 8;

// 概率性递增
double p = 1.0 / (counter + 1);
if (random() < p) {
    counter++;
}
```

### 何时选 LRU，何时选 LFU？

| 场景 | 推荐策略 |
|-----|---------|
| 突发流量：偶尔一次大流量，之后很少访问 | LRU |
| 持续热点：一直高频访问，偶尔被冷数据插入 | LFU |
| 无明显规律 | LRU（默认） |

## 面试场景模拟

**面试官**：Redis 的 LRU 是怎么实现的？

**候选人**（思考后）：Redis 用的是近似 LRU，不是真正的 LRU。

Redis 每个 key 记录一个 24 位的 LRU 时钟（server.lruclock），当需要淘汰时，随机采样 5 个 key，选择 LRU 时钟值最小的（即最久未访问的）。

**面试官**：为什么不用真正的 LRU？

**候选人**：

1. **内存开销**：真正的 LRU 需要双向链表，每个节点需要额外的 prev/next 指针。
2. **访问开销**：每次访问都需要移动链表节点，单线程下开销不小。
3. **Redis 哲学**：够用就好，近似 LRU 已经能淘汰掉最久未访问的 key。

**面试官**：采样数量可以调整吗？

**候选人**：可以。`maxmemory-samples` 配置项，默认 5，越大越精确但越慢。

## 总结

Redis 的 LRU 实现：

| 实现 | 精确度 | 内存开销 | 时间开销 |
|-----|-------|---------|---------|
| 真实 LRU | 100% | 每个 key 多 16 字节 | O(1) |
| 近似 LRU | ~45% (5采样) | 每个 key 多 3 字节 | O(1) |

Redis 选择近似 LRU 是权衡后的决定：
- 牺牲少量精确度
- 换取极低的内存和时间开销
- 符合 Redis 简单高效的设计哲学

## 留给你的问题

近似 LRU 的随机采样，可能选错要淘汰的 key。

**如果业务对淘汰准确性要求很高，有什么方案可以在 Redis 中实现更精确的 LRU？**
