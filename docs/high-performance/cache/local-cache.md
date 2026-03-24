# 本地缓存：Caffeine、Guava Cache、Ehcache 对比

你可能觉得奇怪：都 2024 年了，Redis 这么好用，为什么还要本地缓存？

让我问你一个问题：Redis 的平均延迟是多少？

答案是：**0.5~2ms**（局域网环境下）。

而本地缓存呢？

答案是：**< 1μs**。

差了整整 **1000 倍**。

对于高频访问的热点数据，每减少 1ms 延迟，都是巨大的性能提升。这就是本地缓存存在的意义。

---

## 三剑客对比概览

Java 生态中，最常用的本地缓存库有三个：

| 特性 | Caffeine | Guava Cache | Ehcache |
|------|----------|-------------|----------|
| 性能 | ⭐⭐⭐⭐⭐ 最优 | ⭐⭐⭐⭐ 优秀 | ⭐⭐⭐ 良好 |
| API 丰富度 | ⭐⭐⭐⭐⭐ 最丰富 | ⭐⭐⭐⭐ 丰富 | ⭐⭐⭐⭐ 丰富 |
| 功能完整性 | ⭐⭐⭐⭐⭐ 最完整 | ⭐⭐⭐⭐ 完整 | ⭐⭐⭐⭐⭐ 完整 |
| Spring Cache 集成 | ✅ 官方支持 | ✅ 官方支持 | ✅ 官方支持 |
| 磁盘持久化 | ❌ 不支持 | ❌ 不支持 | ✅ 支持 |
| 社区活跃度 | ⭐⭐⭐⭐⭐ 活跃 | ⭐⭐⭐⭐ 一般 | ⭐⭐⭐⭐ 一般 |
| 发展趋势 | 推荐使用 | 维护状态 | 稳定维护 |

---

## Caffeine：新一代缓存王者

Caffeine 是目前**最推荐**的本地缓存方案，被 Spring Cache 选为默认实现（Spring 5+）。

### 为什么 Caffeine 更快？

Caffeine 采用了 **W-TinyLFU**（Window Tiny Least Frequently Used） eviction policy，这是它性能碾压其他方案的秘密武器。

关于 W-TinyLFU 的详细原理，参见 [Caffeine 原理：W-TinyLFU 算法与异步刷新](/high-performance/cache/caffeine)。

### Caffeine 基本用法

```java
// 创建缓存
Cache&lt;String, User&gt; cache = Caffeine.newBuilder()
    // 容量：最多缓存 10000 条
    .maximumSize(10_000)
    // 写入后过期时间
    .expireAfterWrite(10, TimeUnit.MINUTES)
    // 访问后过期时间
    .expireAfterAccess(5, TimeUnit.MINUTES)
    // 异步刷新
    .refreshAfterWrite(1, TimeUnit.MINUTES)
    // 记录统计信息
    .recordStats()
    .build();

// 读取
User user = cache.getIfPresent("user:1001");
if (user == null) {
    user = userDao.selectById(1001L);
    if (user != null) {
        cache.put("user:1001", user);
    }
}

// 或使用 get 方法（自动加载）
User user = cache.get("user:1001", id -&gt; userDao.selectById(id));
```

### Caffeine 高级特性

#### 异步加载

```java
AsyncLoadingCache&lt;String, User&gt; asyncCache = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(10, TimeUnit.MINUTES)
    .buildAsync(userId -&gt; userDao.selectById(userId));

// 返回 CompletableFuture
CompletableFuture&lt;User&gt; futureUser = asyncCache.getIfPresent("user:1001");
CompletableFuture&lt;User&gt; futureUser2 = asyncCache.get("user:1002");
```

#### 手动失效

```java
// 单个 key 失效
cache.invalidate("user:1001");

// 批量失效
cache.invalidateAll(Arrays.asList("user:1001", "user:1002"));

// 清空所有
cache.invalidateAll();

// 所有包含前缀的 key 失效（需要手动遍历）
cache.asMap().keySet().stream()
    .filter(k -&gt; k.startsWith("user:"))
    .forEach(cache::invalidate);
```

#### 统计信息

```java
CacheStats stats = cache.stats();
System.out.println("命中率: " + stats.hitRate());        // 0.95
System.out.println("加载耗时: " + stats.averageLoadPenalty() + "ms");  // 2.3ms
System.out.println("驱逐数: " + stats.evictionCount());  // 152
```

---

## Guava Cache：经典之选

Guava Cache 在 2011 年发布，曾是 Java 本地缓存的事实标准。虽然现在被 Caffeine 超越，但在很多老项目中仍能看到它的身影。

### 基本用法

```java
LoadingCache&lt;String, User&gt; cache = CacheBuilder.newBuilder()
    // 容量上限
    .maximumSize(10_000)
    // 写入后过期
    .expireAfterWrite(10, TimeUnit.MINUTES)
    // 访问后过期
    .expireAfterAccess(5, TimeUnit.MINUTES)
    // 记录统计
    .recordStats()
    .build(new CacheLoader&lt;String, User&gt;() {
        @Override
        public User load(String key) {
            return userDao.selectById(Long.parseLong(key.split(":")[1]));
        }
    });

// 使用
User user = cache.getUnchecked("user:1001");
```

### 与 Caffeine 的关键差异

1. **淘汰算法**：Guava 使用 LRU，Caffeine 使用 W-TinyLFU
2. **异步支持**：Guava 没有原生异步支持，Caffeine 有
3. **性能**：Caffeine 在高并发场景下性能约为 Guava 的 3-5 倍

### 适用场景

- Spring 5 之前的老项目
- 不追求极致性能，业务场景相对简单
- 团队对 Guava 更熟悉

---

## Ehcache：老牌劲旅

Ehcache 是三者中**历史最悠久**的，也是功能最全面的。它不仅能做内存缓存，还支持磁盘持久化、集群同步等高级特性。

### 基本用法

```java
CacheManager cacheManager = CacheManagerBuilder.newCacheManagerBuilder()
    .withCache("userCache", CacheConfigurationBuilder
        .newCacheConfigurationBuilder(
            String.class, User.class,
            ResourcePoolsBuilder.heap(10_000)  // 堆内存 10000 条
        )
        .withExpiry(ExpiryPolicyBuilder
            .writeExpiration(Duration.ofMinutes(10))
        )
    )
    .build(true);

// 获取缓存
Cache&lt;String, User&gt; cache = cacheManager.getCache("userCache", String.class, User.class);
User user = cache.get("user:1001");
```

### Ehcache 的独特优势

#### 磁盘持久化

```java
// 配置磁盘持久化
PersistentCacheManager persistentCacheManager = CacheManagerBuilder.newCacheManagerBuilder()
    .with(CacheManagerBuilder.persistence(
        new File("/tmp/ehcache")  // 持久化到磁盘
    ))
    .withCache("diskCache", CacheConfigurationBuilder
        .newCacheConfigurationBuilder(
            String.class, User.class,
            ResourcePoolsBuilder
                .heap(1000)           // 堆内存 1000 条
                .disk(100, MemoryUnit.MB)  // 磁盘 100MB
        )
        .withExpiry(ExpiryPolicyBuilder
            .writeExpiration(Duration.ofMinutes(30))
        )
    )
    .build(true);
```

#### 集群同步

```java
// Ehcache 集群配置（Terracotta 模式）
CacheManager clusterManager = CacheManagerBuilder.newCacheManager(
    new XMLConfiguration(new File("ehcache-cluster.xml"))
);
```

### 适用场景

- 需要磁盘持久化的场景（如应用重启后恢复缓存）
- 分布式 Ehcache 集群场景
- 老项目迁移（Ehcache 2.x 兼容性好）

### 性能问题

Ehcache 在纯内存模式下性能不如 Caffeine，而且配置相对复杂。如果不需要磁盘持久化，建议使用 Caffeine。

---

## 选型建议

### 选 Caffeine 的场景

```java
// 高性能要求的热点缓存
// 需要异步刷新
// 使用 Spring Boot 2.x+ (默认集成)
LoadingCache&lt;String, Product&gt; productCache = Caffeine.newBuilder()
    .maximumSize(50_000)
    .expireAfterWrite(5, TimeUnit.MINUTES)
    .refreshAfterWrite(1, TimeUnit.MINUTES)  // 异步刷新，不阻塞
    .recordStats()
    .build(key -&gt; productService.loadFromDb(key));
```

### 选 Guava Cache 的场景

```java
// 老项目，不想引入额外依赖
// 场景相对简单，不需要异步
// 团队更熟悉 Guava 生态
LoadingCache&lt;String, Config&gt; configCache = CacheBuilder.newBuilder()
    .maximumSize(1000)
    .expireAfterWrite(1, TimeUnit.HOURS)
    .recordStats()
    .build(key -&gt; configService.loadConfig(key));
```

### 选 Ehcache 的场景

```java
// 需要磁盘持久化
// Hibernate 二级缓存（Ehcache 是官方推荐）
// 分布式缓存集群（Ehcache Terracotta）
Cache&lt;String, User&gt; persistentCache = CacheManagerBuilder.newCacheManagerBuilder()
    .withCache("persistentUserCache", CacheConfigurationBuilder
        .newCacheConfigurationBuilder(
            String.class, User.class,
            ResourcePoolsBuilder
                .heap(1000)
                .disk(50, MemoryUnit.MB)
        )
    )
    .build(true)
    .getCache("persistentUserCache", String.class, User.class);
```

---

## 总结

三个本地缓存，各有各的场景：

| 场景 | 推荐方案 |
|------|---------|
| 新项目，高性能要求 | **Caffeine** |
| 老项目，简单场景 | Guava Cache |
| 需要磁盘持久化 | **Ehcache** |
| Hibernate 二级缓存 | Ehcache |

但无论选择哪个，都要记住：**本地缓存是双刃剑**。

它用起来简单，但一旦用错——容量设置过大影响 GC、过期时间设置不合理导致数据不一致——后果往往是生产事故。

---

## 留给你的问题

假设这样一个场景：商品详情页需要缓存，但每个商品的「最近浏览用户数」「实时库存」等数据是高频变化的。

如果使用本地缓存，这些实时数据应该怎么处理？

提示：可以考虑「本地缓存存静态数据 + 实时数据走接口」的模式。
