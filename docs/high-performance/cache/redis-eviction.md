# Redis 淘汰策略：LRU vs LFU vs TTL

你的 Redis 内存占用已经达到 10GB，`maxmemory` 设置的是 10GB。

突然又来了一个大请求，需要写入 1GB 数据。

Redis 会怎么处理？

——**根据淘汰策略决定删除哪些数据**。

Redis 提供了 8 种淘汰策略，理解它们，才能在内存不足时做出正确选择。

---

## 为什么需要淘汰策略？

Redis 是内存数据库，内存是有限的。当内存用满时，新数据无法写入。

```
maxmemory = 10GB
current_memory = 10GB

SET new_key "new_value"
# ERROR: OOM command not allowed when used memory > 'maxmemory'
```

**淘汰策略（Eviction Policy）** 就是解决这个问题：当内存满时，决定删除哪些数据，腾出空间。

---

## 8 种淘汰策略一览

| 策略 | 含义 | 适用场景 |
|------|------|----------|
| `noeviction` | 不淘汰，新写入报错 | 数据不能丢 |
| `volatile-lru` | 在过期 key 中删除 LRU | 有过期时间的数据 |
| `volatile-lfu` | 在过期 key 中删除 LFU | 有过期时间且频率明显 |
| `volatile-ttl` | 在过期 key 中删除 TTL 最短的 | 越早过期越没价值 |
| `volatile-random` | 在过期 key 中随机删除 | 无所谓 |
| `allkeys-lru` | 在所有 key 中删除 LRU | 通用场景，推荐 |
| `allkeys-lfu` | 在所有 key 中删除 LFU | 访问频率差异大 |
| `allkeys-random` | 在所有 key 中随机删除 | 无所谓 |

---

## LRU：最近最少使用

### 原理

LRU（Least Recently Used）淘汰**最长时间没有被访问**的 key。

Redis 使用近似 LRU 算法，不是严格按访问时间排序，而是随机采样后选择最久未使用的。

```
采样过程：
1. 随机选 5 个 key（可配置）
2. 比较它们的 last access time
3. 删除最久未使用的

为什么是近似？
- 精确 LRU 需要维护有序列表，O(n) 复杂度
- 近似 LRU 是 O(1)，性能更好
- 效果差不多（10% 左右的差异）
```

### 配置

```bash
# 淘汰策略
maxmemory-policy allkeys-lru

# LRU 采样数量（默认 5，越大越精确但越慢）
maxmemory-samples 10
```

### Java 代码验证

```java
// 查看 Redis 淘汰统计
public void checkEvictionStats() {
    Properties info = redisTemplate.getConnectionFactory()
        .getConnection()
        .serverCommands()
        .info("stats");
    
    // evicted_keys: 被淘汰的 key 总数
    String evicted = info.getProperty("evicted_keys");
    // keyspace_hits: 命中次数
    // keyspace_misses: 未命中次数
    
    System.out.println("淘汰数量: " + evicted);
    System.out.println("命中率: " + 
        Long.parseLong(info.getProperty("keyspace_hits")) * 100.0 / 
        (Long.parseLong(info.getProperty("keyspace_hits")) + 
         Long.parseLong(info.getProperty("keyspace_misses"))) + "%");
}
```

---

## LFU：最不经常使用

### 原理

LFU（Least Frequently Used）淘汰**访问频率最低**的 key。

```
计数结构（16 位）：
┌─────────────────────────────────────┐
│   logcounter (高 8 位)  │  decr_time (低 8 位) │
│      访问次数的衰减值    │    距离上次衰减的时间   │
└─────────────────────────────────────┘

访问频率计算：
1. 每次访问，logcounter++
2. 每隔一段时间，logcounter--（衰减）
3. 衰减值越低，被淘汰优先级越高
```

### 为什么需要衰减？

LFU 的「频率」不是静态的。昨天的热点，今天可能变冷了。

```bash
# 配置 LFU 衰减时间（分钟，默认 1）
lfu-log-factor 10

# 配置 LFU 衰减周期（分钟，默认 1）
lfu-decay-time 1
```

### LFU vs LRU

| 特性 | LRU | LFU |
|------|-----|-----|
| 淘汰依据 | 最近访问时间 | 访问频率 |
| 冷启动 | 友好（新数据不会被立即淘汰） | 不友好（新数据可能立即被淘汰） |
| 突发流量 | 友好 | 不友好 |
| 长期热点 | 不友好 | 友好 |
| 适用场景 | 访问时间重要 | 访问频率重要 |

```
LRU 场景示例：
用户浏览商品列表，先看 A，再看 B，再看 A，再看 B...
B 虽然被频繁访问，但 A 的「最近访问时间」更近，LRU 会淘汰 B

LFU 场景示例：
A 被访问了 100 次，B 被访问了 10 次
即使 A 最后一次访问是 1 小时前，LFU 也会保留 A
```

---

## TTL：最近过期

### 原理

TTL 淘汰**剩余存活时间最短**的 key（即将过期的）。

```bash
# 设置了过期时间的 key 才有 TTL
SET key1 "value" EX 60      # TTL = 60 秒
SET key2 "value" EX 120     # TTL = 120 秒
SET key3 "value"            # TTL = 无

# volatile-ttl 策略会选择 key1（最快过期）
```

### 适用场景

```java
// 场景：缓存临时计算结果
// 过期时间=30分钟，数据越「旧」越没价值
// → volatile-ttl 合适

// 场景：永久存储的数据（如排行榜）
// 不能设置过期时间
// → 需要用 allkeys-lru
```

---

## volatile-xxx vs allkeys-xxx

```
volatile-xxx：只从设置了过期时间的 key 中淘汰
allkeys-xxx：从所有 key 中淘汰（包括没设置过期时间的）

选择依据：
- 如果所有数据都有过期时间 → 两者皆可
- 如果部分数据永不过期 → 用 allkeys-xxx
- 如果只想淘汰过期数据 → 用 volatile-xxx
```

### 典型场景

```bash
# 场景 1：所有数据都有过期时间
maxmemory-policy allkeys-lru
# 简单高效，通用场景

# 场景 2：部分数据永不过期（如配置）
maxmemory-policy volatile-lru
# 只有带 EXPIRE 的 key 会被淘汰

# 场景 3：Session 存储（带过期时间）
maxmemory-policy volatile-lru
# 过期 Session 自然被淘汰

# 场景 4：绝对不能丢数据
maxmemory-policy noeviction
# 写入报错，保证数据不丢失
```

---

## 淘汰策略配置

### 动态配置

```bash
# 查看当前淘汰策略
CONFIG GET maxmemory-policy

# 设置淘汰策略
CONFIG SET maxmemory-policy allkeys-lru
```

### Redis 6.0+ 动态配置

```java
// Spring Data Redis 动态修改
redisTemplate.execute((RedisCallback&lt;Void&gt;) connection -&gt; {
    byte[] command = "CONFIG".getBytes();
    connection.commands().command(command, 
        "SET".getBytes(), 
        "maxmemory-policy".getBytes(), 
        "allkeys-lru".getBytes());
    return null;
});
```

---

## 实战：如何选择淘汰策略？

### 决策树

```
Redis 内存满了，需要淘汰数据？

你的数据是否都有过期时间？
├── 是 → volatile-xxx 策略
│         │
│         ├── 访问频率差异大？ → volatile-lfu
│         ├── 想保留高频数据？ → volatile-lru
│         └── 无所谓？ → volatile-random
│
└── 否 → allkeys-xxx 策略
          │
          ├── 访问频率差异大？ → allkeys-lfu
          ├── 想保留热点数据？ → allkeys-lru（推荐）
          └── 无所谓？ → allkeys-random
```

### 推荐配置

```bash
# 通用场景（推荐）
maxmemory 10gb
maxmemory-policy allkeys-lru
maxmemory-samples 10

# 高频访问场景
maxmemory-policy allkeys-lfu
lfu-decay-time 5  # 5 分钟衰减一次

# 缓存 + 持久数据混合
# 缓存数据设置过期时间，持久数据不设置
maxmemory-policy volatile-lru
```

---

## 淘汰过程源码解析

```c
// Redis 淘汰算法的核心逻辑
void freeMemoryIfNeeded(void) {
    // 1. 检查是否真的需要淘汰
    size_t mem_used = zmalloc_used_memory();
    if (mem_used &lt;= server.maxmemory) return;  // 内存够用，不淘汰
    
    // 2. 根据策略选择淘汰算法
    while (mem_used &gt; server.maxmemory) {
        // 3. 随机采样
        for (int i = 0; i &lt; server.maxmemory_samples; i++) {
            robj *key = ...;  // 根据策略选择 key
            
            // 4. 删除 key
            deleteKey(key);
            mem_used -= ...;  // 更新内存统计
        }
    }
}

// LRU 策略：选择最久未使用的
robj * evictionPoolPopulate(dict *pool, dict *keydict) {
    // 从 keydict 中随机采样
    // 根据对象的 LRU 时间戳计算 idle time
    // 插入到 pool 中（按 idle time 排序）
    // 返回 idle time 最大的（即最久未使用的）
}
```

---

## 淘汰策略与持久化

### RDB 持久化

```bash
# save 触发时，如果内存满，可能触发淘汰
# 建议：bgsave + 预留内存
stop-writes-on-bgsave-error yes
```

### AOF 持久化

```bash
# AOF 写入频繁时，内存压力大
# 建议：everysec + 足够内存
appendonly yes
appendfsync everysec
```

---

## 总结

Redis 淘汰策略：

| 策略 | 淘汰对象 | 淘汰依据 | 推荐度 |
|------|----------|----------|--------|
| `allkeys-lru` | 所有 key | 最近使用 | ⭐⭐⭐⭐⭐ |
| `allkeys-lfu` | 所有 key | 使用频率 | ⭐⭐⭐⭐ |
| `volatile-lru` | 过期 key | 最近使用 | ⭐⭐⭐ |
| `volatile-lfu` | 过期 key | 使用频率 | ⭐⭐⭐ |
| `volatile-ttl` | 过期 key | 剩余 TTL | ⭐⭐ |
| `volatile-random` | 过期 key | 随机 | ⭐ |
| `allkeys-random` | 所有 key | 随机 | ⭐ |
| `noeviction` | 不淘汰 | 报错 | ⭐⭐⭐ |

**最佳实践**：
- 大部分场景用 `allkeys-lru`（热点数据自动保留）
- 访问频率差异明显的场景用 `allkeys-lfu`
- 有明确过期策略的业务用 `volatile-lru`
- 绝对不能丢数据的场景用 `noeviction` + 监控告警

---

## 留给你的问题

假设这样一个场景：你的 Redis 用于缓存商品信息。

商品数据的特点：
- 80% 是冷门商品，几乎没人访问
- 20% 是热门商品，访问量占 80%
- 商品信息每天都会更新（后台系统会更新）

请思考：
1. 应该选择哪种淘汰策略？为什么？
2. 如果商品有「上下架」状态，下架的商品应该怎么处理？
3. 如果缓存满了，新上架的商品会不会因为没有访问记录而被 LFU 快速淘汰？
4. 如何用 Redis 实现一个「冷热分离」的缓存策略？

提示：可以给热门商品单独一个 Redis 实例，或者用 LRU + 预热机制。
