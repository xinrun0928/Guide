# 多级缓存模式：本地缓存（Caffeine/Guava）→ 分布式缓存（Redis）→ 数据库

你有没有注意过一个现象？

双十一零点抢购，页面刷不出来，系统没崩，数据库也活着——但用户就是进不去页面。

问题在哪？

**数据库承受不住那么多请求。**

如果每个请求都直接打数据库，再好的数据库也会跪。而多级缓存要解决的，就是这个问题。

## 为什么需要多级缓存

让我们先理解一个基本事实：**每往上一层缓存，数据访问就快一个数量级。**

- 直接查数据库：毫秒级（ms）
- 查 Redis：微秒级（μs），比数据库快 10-100 倍
- 查本地缓存：纳秒级（ns），比 Redis 快 1000 倍

但缓存也不是越多越好。本地缓存占用 JVM 堆内存，如果数据量太大会导致 OOM。Redis 是跨进程共享的，但多一次网络开销。

所以，多级缓存的核心理念是：**让不同层级的缓存各司其职。**

## 经典三级缓存架构

```
┌─────────────────────────────────────────────────────────┐
│                      用户请求                            │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│         L1 本地缓存（Caffeine/Guava Cache）              │
│         进程内，TTL 短，数据量小，纳秒级访问              │
└─────────────────────────┬───────────────────────────────┘
                          │ 未命中
                          ▼
┌─────────────────────────────────────────────────────────┐
│         L2 分布式缓存（Redis/Memcached）                 │
│         跨进程共享，TTL 可长，毫秒级访问                  │
└─────────────────────────┬───────────────────────────────┘
                          │ 未命中
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   L3 数据库                              │
│                   最终数据源                              │
└─────────────────────────────────────────────────────────┘
```

### L1 本地缓存

进程内缓存，访问速度最快。适合存放**访问极其频繁、数据量小、变化不多**的数据。

```java
@Configuration
public class LocalCacheConfig {

    @Bean
    public Cache&lt;String, Object&gt; localCache() {
        return Caffeine.newBuilder()
            .maximumSize(1000)              // 最多 1000 条
            .expireAfterWrite(60, TimeUnit.SECONDS)  // 写后 60 秒过期
            .recordStats()                   // 记录统计数据
            .build();
    }
}
```

### L2 分布式缓存

跨进程共享，适合存放**数据量大、需要多节点共享**的数据。

```yaml
spring:
  cache:
    type: redis
  redis:
    time-to-live: 3600000    # 1 小时
```

### 多级缓存配置

Spring Boot + Spring Cache 可以优雅地配置多级缓存：

```java
@Configuration
public class MultiLevelCacheConfig {

    @Bean
    public CacheManager cacheManager(RedisConnectionFactory factory) {
        return new RedisCacheManager(
            RedisCacheWriter.lockingRedisCacheWriter(factory),
            RedisCacheConfiguration.defaultCacheConfig()
                .entryTtl(Duration.ofHours(1))
        );
    }
}
```

## 缓存读取策略

### Cache-Aside（旁路缓存）

最常用的一种策略，**应用自己管理缓存**。

- **读流程**：查缓存 → 命中返回，未命中查 DB → 写缓存 → 返回
- **写流程**：更新 DB → 删除缓存（不是更新！）

```java
public Product getProduct(Long productId) {
    // 先查 L1 本地缓存
    Product product = localCache.getIfPresent(productId);
    if (product != null) {
        return product;
    }

    // 再查 L2 Redis 缓存
    product = redisCache.get(productId);
    if (product != null) {
        localCache.put(productId, product);
        return product;
    }

    // 查数据库
    product = productRepository.findById(productId);
    if (product != null) {
        // 写缓存
        redisCache.put(productId, product);
        localCache.put(productId, product);
    }

    return product;
}
```

### Read-Through（读穿透）

缓存自动处理未命中，应用只感知缓存。

```java
public interface ProductService {
    Product getProduct(Long productId);  // 应用只调用这个
}

// 缓存层实现
public class ProductCacheService implements ProductService {
    @Autowired
    private ProductRepository productRepository;

    @Override
    public Product getProduct(Long productId) {
        Product product = cache.get(productId);
        if (product == null) {
            // 缓存未命中，缓存层自动查数据库并回填
            product = productRepository.findById(productId);
            cache.put(productId, product);
        }
        return product;
    }
}
```

## 缓存写入策略

### Write-Through（同步写入）

同时写 DB 和缓存，强一致但性能差。

```java
public void updateProduct(Product product) {
    // 同时写 DB 和缓存
    productRepository.save(product);
    cache.put(product.getId(), product);
}
```

### Write-Behind（异步写入）

先写缓存，异步批量写 DB。性能最高，但可能丢数据。

```java
public void updateProduct(Product product) {
    // 先写缓存
    cache.put(product.getId(), product);

    // 异步写 DB（用 MQ 或线程池）
    asyncExecutor.execute(() -> productRepository.save(product));
}
```

## 缓存一致性问题

回到 Cache-Aside 的写流程：**先更新 DB 还是先删缓存？**

**正确答案是：先更新 DB，再删缓存。**

为什么？

假设两个并发请求：
1. 请求 A 更新数据（先删缓存）
2. 请求 B 读取数据（缓存未命中，查 DB，得到旧值，写入缓存）
3. 请求 A 更新 DB

结果是缓存里是旧值。

反过来，先更新 DB 再删缓存：
1. 请求 A 更新 DB，删缓存
2. 请求 B 读取（缓存未命中，查 DB，得到新值，写入缓存）

结果正确。

**但这个结论的前提是：读操作比写操作慢。** 如果数据库读写都很快，反而先删缓存更好。实际情况中，数据库写操作通常会有锁，比读慢，所以先更新 DB 再删缓存是更稳妥的选择。

## 面试追问方向

- 本地缓存和分布式缓存如何保证一致性？（答：本地缓存 TTL 短，Redis 变更是触发本地缓存失效）
- 多级缓存如何避免缓存雪崩？（答：各层过期时间随机化，不要同时过期）
- 本地缓存满了怎么办？（答：LRU 驱逐策略，设置合理的容量上限）

## 小结

多级缓存不是「堆缓存」，每一层都有它存在的理由：

- **L1 本地缓存**：极热点数据，访问量是 Redis 的数十倍
- **L2 分布式缓存**：跨进程共享，准热点数据
- **L3 数据库**：最终数据源

让它们各司其职，而不是简单堆叠，才能发挥多级缓存的最大威力。
