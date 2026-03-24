# Caffeine 原理：W-TinyLFU 算法与异步刷新

你知道为什么 Caffeine 比 Guava Cache 快 3-5 倍吗？

有人说是因为 Caffeine 用了更高效的数据结构，有人说是因为它优化了锁的粒度。

都对，但都不是根本原因。

真正的原因，是 Caffeine 采用了**W-TinyLFU**——一个为现代多核 CPU 量身定制的缓存淘汰算法。

---

## 为什么淘汰算法如此重要？

在解释 W-TinyLFU 之前，我们先理解一个核心问题：**缓存淘汰算法决定了缓存的效率**。

假设你的缓存容量是 10000 条，当存满后，新数据要进来，就必须踢掉一些旧数据。问题来了：**踢谁？**

| 算法 | 策略 | 优点 | 缺点 |
|------|------|------|------|
| FIFO | 先进先出 | 简单 | 不考虑访问频率，可能踢掉热点数据 |
| LRU | 最近最少使用 | 考虑访问时间 | 顺序扫描会导致热点数据被淘汰 |
| LFU | 最不经常使用 | 考虑访问频率 | 不考虑时间因素，历史热点难清除 |
| Random | 随机淘汰 | 性能好 | 命中率低 |

这些经典算法都有明显缺陷，而 **W-TinyLFU** 通过巧妙的设计，几乎完美地解决了这些问题。

---

## TinyLFU：频率统计的革命

### LFU 的问题

传统的 LFU（Least Frequently Used）有一个致命缺陷：**历史热点难以清除**。

举个例子：

- 数据 A 被访问了 10000 次，频率是 10000
- 数据 B 被访问了 100 次，频率是 100
- 一周后，A 变成了冷数据，再也没人访问
- 但它的频率还是 10000，永远不会被淘汰

这就是 **LFU 的「历史污染」问题**。

### 布隆过滤器 + 滑动窗口

TinyLFU 解决了这个问题。它使用两个关键机制：

**1. 布隆过滤器（Bloom Filter）记录频率**

布隆过滤器是一种空间效率极高的概率数据结构，可以判断「一个元素是否出现过」，但可能有假阳性（False Positive）。

```java
// TinyLFU 中的频率记录
// 使用 Count-Min Sketch 算法，4-bit 计数器
// 每个 key 有 4 个 hash 桶，取最小值
```

**2. 滑动窗口（WINDOW）**

TinyLFU 不记录「从缓存创建至今的总频率」，而是只记录**最近一段时间**的频率。

```
时间线 ──────────────────────────────────────────────────────►

        ◄──── 滑动窗口（1分钟）────►
        
        记录这个窗口内的访问频率，而不是从一开始的总频率
```

这样，一周前的热点数据会随着时间窗口滑动而「遗忘」，不会影响当前的淘汰决策。

### TinyLFU 工作流程

```
新数据请求到来 → TinyLFU 评估 → 是否淘汰现有数据？
                              ↓
                    比较频率：incoming vs resident
                    频率高者留下，低者被淘汰
```

---

## W-TinyLFU：Caffeine 的秘密武器

### W-TinyLFU 的结构

W-TinyLFU 在 TinyLFU 基础上增加了一个 **Window Cache**：

```
┌─────────────────────────────────────────────────────────┐
│                    W-TinyLFU 缓存结构                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐      ┌─────────────────────────────┐  │
│  │ Window Cache │      │        Main Cache          │  │
│  │   (1% 空间)   │      │      (99% 空间)            │  │
│  │              │      │                            │  │
│  │   [新数据    │ ──▶  │  [高频率热点数据]          │  │
│  │    暂存区]   │ 晋升  │  [已被验证的持久热点]       │  │
│  │              │      │                            │  │
│  └──────────────┘      └─────────────────────────────┘  │
│         ↑                                                   │
│         │ 淘汰                                             │
│         │                                                   │
│    ┌────┴────┐                                             │
│    │ TinyLFU │ ←── 频率统计（布隆过滤器 + 滑动窗口）         │
│    │ 评估器   │                                             │
│    └─────────┘                                             │
└─────────────────────────────────────────────────────────┘
```

### 窗口缓存的作用

为什么需要窗口缓存？

如果没有窗口缓存，所有新数据都要和 Main Cache 中的热点数据竞争。新数据访问频率低，大概率被淘汰，导致**新数据永远没有机会证明自己是热点**。

有了窗口缓存：
1. 新数据先进入 Window Cache（占 1% 空间）
2. 在窗口中有机会被多次访问，逐渐累积频率
3. 当频率足够高时，晋升到 Main Cache

### 淘汰流程详解

```
步骤 1：新数据请求（如 key=X）

步骤 2：检查 X 是否在 Window Cache
        ├── 是 → 访问次数 +1，评估是否晋升
        └── 否 → 检查 TinyLFU 频率

步骤 3：频率评估
        X 的频率 vs Main Cache 中频率最低的 entry
        
        ├── X 频率更高 → 淘汰 Main Cache 最低者，X 晋升到 Main
        └── X 频率更低 → 淘汰 X（进入 Window Cache 或直接丢弃）

步骤 4：Window Cache 满了？
        └── 触发 Window 内部淘汰，频率最低者被踢出
```

### 为什么是 1%？

这个比例不是拍脑袋的。Caffeine 作者通过大量实验发现：

- **太小**：新数据没有足够的空间证明自己
- **太大**：会稀释 Main Cache 的热点命中率

1% 是一个平衡点，使得 W-TinyLFU 在各种访问模式（ZIPF 分布、突发流量、扫描攻击）下都有优异表现。

---

## 异步刷新：缓存永不过期

### 同步刷新的问题

传统的缓存过期策略是**同步刷新**：

```java
// 同步刷新：请求触发，检查过期
User user = cache.get("user:1001", k -&gt; loadFromDb(k));
// 如果缓存过期，这个请求会阻塞直到数据加载完成
```

问题：
- 过期瞬间大量请求同时打到数据库（缓存击穿）
- 用户体验差，响应时间长

### Caffeine 的异步刷新

Caffeine 提供了 `refreshAfterWrite`，实现**异步刷新**：

```java
LoadingCache&lt;String, User&gt; cache = Caffeine.newBuilder()
    .maximumSize(10_000)
    .refreshAfterWrite(1, TimeUnit.MINUTES)  // 写入 1 分钟后异步刷新
    .build(key -&gt; {
        // 只有缓存不存在或过期时才会调用
        return userDao.selectById(Long.parseLong(key.split(":")[1]));
    });
```

### 异步刷新 vs 过期刷新

```
同步过期刷新：
t=0   请求 → 命中缓存 → 返回
t=1m  缓存过期
t=1m+100ms  请求 → 过期！→ 同步加载 → 返回（慢）

异步刷新：
t=0   请求 → 命中缓存 → 返回
t=1m  后台线程异步加载新数据
t=1m+100ms  请求 → 命中旧缓存 → 返回（快）
t=1m+200ms  异步加载完成 → 更新缓存
```

### refreshAfterWrite vs expireAfterWrite

| 特性 | refreshAfterWrite | expireAfterWrite |
|------|-------------------|------------------|
| 过期后是否返回旧数据 | ✅ 是（旧数据仍可用） | ❌ 否（返回 null） |
| 加载时机 | 后台异步 | 请求线程同步 |
| 缓存数据一致性 | 可能返回稍旧数据 | 始终返回最新数据 |
| 适用场景 | 读多写少，允许稍旧数据 | 数据一致性要求高 |

### 实战：双重过期策略

对于数据一致性要求高的场景，可以组合使用：

```java
LoadingCache&lt;String, Product&gt; cache = Caffeine.newBuilder()
    // 软引用：当 JVM 内存不足时，允许回收
    .softValues()
    // 异步刷新：保证可用性
    .refreshAfterWrite(5, TimeUnit.MINUTES)
    // 逻辑过期：标识数据是否需要刷新（业务层判断）
    .build(key -&gt; {
        Product product = productDao.selectById(key);
        // 包装为逻辑过期对象
        return new LogicalProduct(product, System.currentTimeMillis());
    });

// 业务层：判断是否逻辑过期
public Product getProduct(String productId) {
    LogicalProduct lp = cache.get(productId);
    if (lp.isLogicallyExpired(30, TimeUnit.MINUTES)) {
        // 异步刷新，不阻塞返回
        cache.refresh(productId);
    }
    return lp.getProduct();
}
```

---

## Caffeine 的其他性能优化

### 1. 无锁读取

Caffeine 大量使用 `ConcurrentHashMap` 的无锁读操作，读取缓存不需要加锁：

```java
// 高并发下，Caffeine 的读操作几乎无锁竞争
User user = cache.getIfPresent("user:1001");  // 内部使用 CAS
```

### 2. 高效的频率统计

TinyLFU 的频率统计使用 **Count-Min Sketch** 算法：

- 空间复杂度：O(n)，固定大小
- 时间复杂度：O(1)，每次访问只需 4 次 hash + 取最小值
- 准确性：可能有假阳性，但不影响整体命中率

### 3. 批量淘汰优化

当缓存满了需要淘汰时，Caffeine 不是逐个评估，而是批量处理：

```java
// 内部实现：维护一个小顶堆，快速找到频率最低的 entry
// 淘汰时批量驱逐，减少锁竞争
```

---

## 实战：配置调优

### 根据场景选择策略

```java
// 场景 1：读多写少，QPS 极高
LoadingCache&lt;String, Banner&gt; bannerCache = Caffeine.newBuilder()
    .maximumSize(1000)
    .refreshAfterWrite(30, TimeUnit.SECONDS)  // 30 秒刷新
    .recordStats()  // 开启监控
    .build(key -&gt; bannerService.getActiveBanners());

// 场景 2：写多读少，数据量大
Cache&lt;String, Order&gt; orderCache = Caffeine.newBuilder()
    .maximumSize(100_000)
    .expireAfterWrite(5, TimeUnit.MINUTES)  // 5 分钟完全过期
    .weakKeys()   // 弱引用 key（GC 时回收）
    .weakValues() // 弱引用 value（GC 时回收）
    .build();

// 场景 3：内存敏感，需要主动控制
Cache&lt;String, Config&gt; configCache = Caffeine.newBuilder()
    .maximumWeight(50 * 1024 * 1024)  // 最大内存 50MB
    .weigher((key, value) -&gt; value.getWeight())  // 按权重计算
    .expireAfterWrite(1, TimeUnit.HOURS)
    .build();
```

### 监控与调优

```java
CacheStats stats = cache.stats();

System.out.println("========== 缓存统计 ==========");
System.out.println("命中率: " + String.format("%.2f%%", stats.hitRate() * 100));
System.out.println("加载新数据次数: " + stats.loadCount());
System.out.println("加载失败次数: " + stats.loadFailureCount());
System.out.println("平均加载耗时: " + stats.averageLoadPenalty() + "ms");
System.out.println("驱逐数量: " + stats.evictionCount());
System.out.println("驱逐前最大加权大小: " + stats.evictionWeight());

// 根据监控调整参数
if (stats.hitRate() &lt; 0.8) {
    // 命中率太低，增加缓存容量
    // 或延长过期时间
}
```

---

## 总结

W-TinyLFU 是 Caffeine 高性能的根源：

- **TinyLFU**：用布隆过滤器和滑动窗口解决了 LFU 的历史污染问题
- **Window Cache**：让新数据有机会证明自己是热点
- **1% 窗口比例**：经过大量实验验证的最优值

异步刷新则是 Caffeine 保持高可用的利器：

- `refreshAfterWrite`：后台异步刷新，缓存永不过期
- 配合 `expireAfterWrite`：实现双重过期策略

理解了这些原理，你才能真正用好 Caffeine，而不是把它当成一个简单的 `Map&lt;K, V&gt;`。

---

## 留给你的问题

假设这样一个场景：你的系统在凌晨 0 点有**定时任务**批量更新商品价格，更新量是 10 万条。

使用 Caffeine 作为本地缓存，你有什么方案让这些更新**尽量快地**同步到所有应用节点？

提示：可以考虑主动失效、广播刷新、分批更新等策略。
