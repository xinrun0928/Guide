# 缓存雪崩：过期时间打散 + 熔断降级方案

双十一零点，商品详情页集体「炸了」。

不是单个商品，是所有商品都查不出来。

运维一查日志，发现数据库 CPU 打满了。缓存呢？Redis 监控一看——所有缓存 key 都在同一秒过期了。

这就是**缓存雪崩**。

## 雪崩的本质

缓存雪崩的本质是：**大量缓存同时过期，导致大量请求同时穿透到数据库。**

```
时间 00:00:00
┌─────────────────────────────────────────┐
│  商品 1 过期 ──┐                        │
│  商品 2 过期 ──┼──→ 同时查数据库 ──→ DB 爆炸 │
│  商品 3 过期 ──┘                        │
│  ...                                   │
│  商品 N 过期 ──┘                        │
└─────────────────────────────────────────┘
```

为什么缓存会同时过期？

1. **运维操作**：缓存服务器重启，所有缓存清空
2. **批量写入**：系统上线时批量导入了数据，所有 key 同时写入，到期时间一致
3. **TTL 设置问题**：所有 key 的 TTL 都设置为 1 小时，整点时大量过期

## 方案一：过期时间随机化

最简单、最有效的方案。

```java
// 设置缓存时，随机增加 0-30 分钟的偏移量
int baseTTL = 3600;  // 1 小时
int randomOffset = new Random().nextInt(1800);  // 0-30 分钟
int actualTTL = baseTTL + randomOffset;

redis.setex(key, actualTTL, value);
```

### 效果

```
原来：
商品 1: 01:00:00 过期
商品 2: 01:00:00 过期
商品 3: 01:00:00 过期

打散后：
商品 1: 01:15:23 过期
商品 2: 01:08:47 过期
商品 3: 01:27:12 过期
```

没有同时过期的 key，数据库不会被瞬间打爆。

### 局限性

过期时间打散只能缓解，不能根除。如果访问量足够大，即使错开几秒，也可能打爆数据库。需要配合其他方案。

## 方案二：永不过期 + 异步更新

既然缓存会过期导致雪崩，那就让它永不过期。

```java
@Data
public class ProductCache {
    private Product data;
    private Long updateTime;
}

public Product getProduct(Long id) {
    String key = "product:" + id;
    String cacheValue = redis.get(key);
    ProductCache cache = JSON.parseObject(cacheValue, ProductCache.class);

    if (cache != null) {
        // 检查是否需要更新（比如超过 30 分钟没更新）
        if (System.currentTimeMillis() - cache.getUpdateTime() > 30 * 60 * 1000) {
            // 异步更新，不阻塞请求
            asyncExecutor.submit(() -> refreshCache(id));
        }
        return cache.getData();
    }

    // 缓存不存在，查数据库
    Product product = productMapper.selectById(id);

    ProductCache newCache = new ProductCache();
    newCache.setData(product);
    newCache.setUpdateTime(System.currentTimeMillis());
    redis.setex(key, 24 * 3600, JSON.toJSONString(newCache));

    return product;
}
```

### 问题

1. **实现复杂**：需要维护额外的时间戳字段
2. **可能返回脏数据**：异步更新期间，返回的是旧数据
3. **缓存一致性**：数据变更时需要主动更新缓存

## 方案三：熔断降级

当缓存不可用时，熔断器打开，直接走数据库（有损降级）。

```java
@Service
public class ProductService {

    private CircuitBreaker circuitBreaker;

    public Product getProduct(Long id) {
        // 检查熔断器状态
        if (circuitBreaker.isOpen()) {
            // 熔断打开，返回降级数据
            return getFallbackProduct(id);
        }

        try {
            String cacheValue = redis.get(key);
            if (cacheValue != null) {
                return JSON.parseObject(cacheValue, Product.class);
            }

            Product product = productMapper.selectById(id);
            redis.setex(key, 3600, JSON.toJSONString(product));
            return product;
        } catch (Exception e) {
            // Redis 异常，打开熔断器
            circuitBreaker.recordFailure();
            return getFallbackProduct(id);
        }
    }

    private Product getFallbackProduct(Long id) {
        // 降级策略：1. 本地缓存 2. 静态数据 3. 友好错误
        return localCache.getIfPresent(id);  // 兜底本地缓存
    }
}
```

### 熔断器的工作原理

```
熔断器状态机：
┌──────────┐  失败率超过阈值  ┌───────────┐
│   关闭   │ ──────────────→ │   打开    │
│  (正常)  │                 │  (熔断)   │
└──────────┘                 └───────────┘
     ↑                              │
     │  半开探测成功                  │
     └──────────────────────────────┘
```

熔断打开后，所有请求直接降级，不查缓存。等待一段时间后，放一个请求去探测，如果成功就关闭熔断器。

## 方案四：Redis 高可用 + 本地缓存兜底

```
┌──────────────────────────────────────┐
│           用户请求                     │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│         本地缓存（L1）                 │
│         永不过期                      │
└──────────────┬───────────────────────┘
               │ 未命中
               ▼
┌──────────────────────────────────────┐
│       Redis Cluster（L2）             │
│       分布式缓存                      │
└──────────────┬───────────────────────┘
               │ 未命中
               ▼
┌──────────────────────────────────────┐
│              数据库                   │
└──────────────────────────────────────┘
```

本地缓存作为最后兜底，即使 Redis 挂了，也能用本地缓存撑一段时间。

## 多层防护策略

```java
public Product getProduct(Long id) {
    String key = "product:" + id;

    // 第一层：本地缓存
    ProductCache local = localCache.getIfPresent(key);
    if (local != null) {
        return local.getData();
    }

    // 第二层：Redis
    try {
        String redisValue = redis.get(key);
        if (redisValue != null) {
            ProductCache cache = JSON.parseObject(redisValue, ProductCache.class);
            // 写入本地缓存（永不过期）
            localCache.put(key, cache);
            return cache.getData();
        }
    } catch (Exception e) {
        log.error("Redis 异常", e);
        // Redis 异常，继续往下走
    }

    // 第三层：数据库
    Product product = productMapper.selectById(id);

    // 写入缓存
    ProductCache cache = new ProductCache();
    cache.setData(product);
    cache.setUpdateTime(System.currentTimeMillis());
    redis.setex(key, 3600, JSON.toJSONString(cache));
    localCache.put(key, cache);

    return product;
}
```

## 面试追问方向

- 雪崩和击穿有什么区别？（答：雪崩是大量缓存同时过期，击穿是单个热点缓存过期）
- 如何选择降级策略？（答：根据业务容忍度决定：返回静态数据 < 返回缓存 < 返回友好错误）
- 熔断器的阈值怎么设置？（答：失败率通常 50%，窗口期通常 1 分钟）
- 本地缓存和 Redis 缓存数据不一致怎么办？（答：本地缓存 TTL 短，变更时主动失效）

## 小结

缓存雪崩不是单一方案能解决的，需要多层防护：

1. **预防**：过期时间随机化，避免同时过期
2. **兜底**：本地缓存作为 Redis 的兜底
3. **止损**：熔断降级，缓存不可用时保护数据库
4. **恢复**：Redis 高可用，快速切换到备用节点

没有银弹，但多层防护能让你在任何单点故障时，都能从容应对。
