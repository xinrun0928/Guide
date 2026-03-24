# 缓存雪崩：过期时间随机化 + 熔断降级 + 多级缓存

你的系统昨晚又崩了。

不是被攻击，不是一个人抢票抢崩了。

而是**整点秒杀**开始的那一刻——大量缓存同时过期，大批请求同时涌入数据库，数据库直接 OOM。

这就是**缓存雪崩**。

---

## 什么是缓存雪崩？

缓存雪崩是指：**大量缓存同时失效，导致大量请求同时穿透到数据库**。

### 雪崩的成因

| 成因 | 描述 | 例子 |
|------|------|------|
| 集中过期 | 缓存设置了相同的过期时间 | 所有缓存 TTL 都是 1 小时，整点集体失效 |
| Redis 宕机 | 缓存服务不可用 | Redis 主从切换，所有请求打 DB |
| 热点数据集体失效 | 批量数据同时过期 | 商家下架商品，相关缓存同时失效 |

### 雪崩 vs 击穿 vs 穿透

| 场景 | 区别 | 特征 |
|------|------|------|
| 雪崩 | 大量缓存同时失效 | 大面积请求打 DB |
| 击穿 | 单个热点缓存失效 | 单点高并发打 DB |
| 穿透 | 数据本身不存在 | 查询不存在的数据打 DB |

### 雪崩的影响

```
假设系统配置：
- 缓存命中率：99%
- 数据库 QPS 能力：10000
- 正常 QPS：1000（数据库利用率 10%）

发生雪崩时：
- 缓存全部失效
- 10000 QPS 全部打 DB
- 数据库直接被打爆
```

---

## 方案一：过期时间随机化

### 核心思想

避免大量缓存同时过期，给过期时间加一个**随机偏移量**。

```
原 TTL = 1 小时 = 3600 秒
随机偏移 = Random(0, 600) 秒

实际 TTL = 3600 + Random(0, 600) = [3600, 4200] 秒
```

### 代码实现

```java
public class RandomExpireCacheService {
    
    private static final int BASE_TTL_SECONDS = 3600;      // 基础 TTL 1 小时
    private static final int RANDOM_TTL_SECONDS = 600;     // 随机偏移 ±10 分钟
    
    public void setProduct(Long productId, Product product) {
        String cacheKey = "product:" + productId;
        
        // 计算随机 TTL
        int randomTtl = BASE_TTL_SECONDS + ThreadLocalRandom.current()
            .nextInt(RANDOM_TTL_SECONDS);
        
        redisTemplate.opsForValue().set(cacheKey, product, randomTtl, TimeUnit.SECONDS);
    }
    
    // 通用方法：随机过期时间
    public void setWithRandomExpire(String key, Object value, long baseTtl, TimeUnit unit) {
        int randomOffset = ThreadLocalRandom.current().nextInt((int) unit.toSeconds(baseTtl) / 5);
        long actualTtl = baseTtl + randomOffset;
        redisTemplate.opsForValue().set(key, value, actualTtl, unit);
    }
}
```

### 进阶：基于 hash 的过期时间

避免随机导致的「随机雪崩」（虽然概率小了，但可能还有另一个整点）

```java
public class HashBasedExpireCacheService {
    
    // 使用 key 的 hash 值来决定过期时间的「分钟数」
    // 相同 key 每次过期时间相同，但不同 key 分布在不同时间点
    public long calculateExpireSeconds(String key, long baseTtlSeconds) {
        // hash(key) 的低 8 位决定过期时间的分钟偏移
        int hashOffset = Math.abs(key.hashCode() % 60);
        
        // 基础过期时间 + 分钟偏移
        return baseTtlSeconds + hashOffset * 60;
    }
    
    public void setProduct(Long productId, Product product) {
        String cacheKey = "product:" + productId;
        
        // 基于 key 算过期时间（固定但分散）
        long ttl = calculateExpireSeconds(cacheKey, 3600);
        
        redisTemplate.opsForValue().set(cacheKey, product, ttl, TimeUnit.SECONDS);
    }
}
```

### 随机化的优缺点

✅ **优点**：
- 实现简单，几乎零成本
- 有效避免集中过期

❌ **缺点**：
- 无法解决 Redis 宕机导致的雪崩
- 无法解决热点数据集体失效

---

## 方案二：多级缓存（兜底保护）

### 核心思想

**不要把鸡蛋放在一个篮子里**。

建立多级缓存体系，即使 Redis 挂了，本地缓存还能撑一阵子。

```
L1 本地缓存（Caffeine）：容量小，访问快
L2 Redis 缓存：容量大，跨进程共享
L3 数据库：最终数据源

任一缓存命中即可返回
```

### 多级缓存实现

```java
public class MultiLevelCacheService {
    
    // L1: 本地缓存（永不过期，容量小）
    private final Cache&lt;String, Product&gt; localCache;
    
    // L2: Redis 缓存（带过期时间）
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    
    public MultiLevelCacheService() {
        this.localCache = Caffeine.newBuilder()
            .maximumSize(10_000)       // 容量 10000 条
            .expireAfterWrite(10, TimeUnit.MINUTES)  // 兜底过期
            .recordStats()
            .build();
    }
    
    public Product getProduct(Long productId) {
        String cacheKey = "product:" + productId;
        
        // ========== L1: 本地缓存 ==========
        Product product = localCache.getIfPresent(cacheKey);
        if (product != null) {
            return product;
        }
        
        // ========== L2: Redis 缓存 ==========
        try {
            product = (Product) redisTemplate.opsForValue().get(cacheKey);
            if (product != null) {
                // 回填 L1
                localCache.put(cacheKey, product);
                return product;
            }
        } catch (Exception e) {
            // Redis 故障，降级到 L1 + L3
            log.warn("Redis 查询失败，降级处理", e);
            return getProductWithFallback(productId, cacheKey);
        }
        
        // ========== L3: 数据库 ==========
        product = productDao.selectById(productId);
        if (product != null) {
            // 双写缓存
            try {
                redisTemplate.opsForValue().set(cacheKey, product, 1, TimeUnit.HOURS);
            } catch (Exception e) {
                log.warn("Redis 写入失败，忽略", e);
            }
            localCache.put(cacheKey, product);
        }
        
        return product;
    }
    
    // Redis 故障时的降级逻辑
    private Product getProductWithFallback(Long productId, String cacheKey) {
        // 1. 查本地缓存（可能还有）
        Product product = localCache.getIfPresent(cacheKey);
        if (product != null) {
            log.info("Redis 降级：命中本地缓存 {}", cacheKey);
            return product;
        }
        
        // 2. 本地缓存也没有，查数据库
        product = productDao.selectById(productId);
        if (product != null) {
            // 写入本地缓存（Redis 恢复前先用本地）
            localCache.put(cacheKey, product);
            log.info("Redis 降级：写入本地缓存 {}", cacheKey);
        }
        
        return product;
    }
}
```

### 多级缓存的效果

```
正常情况：
- 99% 请求被 L1 拦截
- 0.9% 请求被 L2 拦截
- 0.1% 请求查 L3

Redis 故障情况：
- L1 继续工作（5-10 分钟容量）
- 数据库压力增加 10-20 倍（但不会被打爆）
```

---

## 方案三：熔断降级

### 核心思想

当数据库压力过大时，主动**熔断**部分请求，返回**降级数据**或**友好提示**。

核心组件：**熔断器（Circuit Breaker）**

```
状态机：
CLOSED（关闭）→ 正常，所有请求通过
    ↓ 失败率超过阈值
OPEN（打开）→ 所有请求直接降级
    ↓ 等待一段时间后
HALF_OPEN（半开）→ 放行部分请求探测
    ↓ 探测成功
CLOSED（关闭）→ 恢复正常
    ↓ 探测失败
OPEN（打开）→ 继续降级
```

### 熔断降级实现

```java
public class CircuitBreakerCacheService {
    
    // 熔断器配置
    private static final int FAILURE_THRESHOLD = 5;           // 失败次数阈值
    private static final int RECOVERY_TIMEOUT_SECONDS = 30;     // 恢复等待时间
    private static final double FAILURE_RATE_THRESHOLD = 0.5;  // 失败率阈值 50%
    
    // 熔断器状态
    private volatile CircuitState state = CircuitState.CLOSED;
    private AtomicInteger failureCount = new AtomicInteger(0);
    private AtomicInteger successCount = new AtomicInteger(0);
    private volatile long lastFailureTime = 0;
    
    public Product getProduct(Long productId) {
        String cacheKey = "product:" + productId;
        
        // ========== 1. 检查熔断器状态 ==========
        if (state == CircuitState.OPEN) {
            // 熔断中，检查是否应该进入半开状态
            if (shouldTryReset()) {
                transitionToHalfOpen();
            } else {
                // 返回降级数据
                return getDegradedProduct(productId);
            }
        }
        
        // ========== 2. 正常查询 ==========
        try {
            Product product = doGetProduct(cacheKey, productId);
            
            // 成功，关闭熔断器
            onSuccess();
            
            return product;
        } catch (Exception e) {
            // 失败，打开熔断器
            onFailure();
            throw e;
        }
    }
    
    private Product doGetProduct(String cacheKey, Long productId) {
        // 先查缓存
        Product product = (Product) redisTemplate.opsForValue().get(cacheKey);
        if (product != null) {
            return product;
        }
        
        // 查数据库
        product = productDao.selectById(productId);
        if (product != null) {
            redisTemplate.opsForValue().set(cacheKey, product, 1, TimeUnit.HOURS);
        }
        
        return product;
    }
    
    // ========== 熔断器逻辑 ==========
    
    private void onSuccess() {
        successCount.incrementAndGet();
        
        // 半开状态时，连续成功则关闭
        if (state == CircuitState.HALF_OPEN) {
            if (successCount.get() &gt;= 3) {
                transitionToClosed();
            }
        }
    }
    
    private void onFailure() {
        lastFailureTime = System.currentTimeMillis();
        int failures = failureCount.incrementAndGet();
        
        // 达到阈值，打开熔断器
        if (failures &gt;= FAILURE_THRESHOLD) {
            transitionToOpen();
        }
    }
    
    private boolean shouldTryReset() {
        return System.currentTimeMillis() - lastFailureTime &gt; RECOVERY_TIMEOUT_SECONDS * 1000;
    }
    
    private void transitionToOpen() {
        state = CircuitState.OPEN;
        log.warn("熔断器打开");
    }
    
    private void transitionToHalfOpen() {
        state = CircuitState.HALF_OPEN;
        failureCount.set(0);
        successCount.set(0);
        log.info("熔断器进入半开状态");
    }
    
    private void transitionToClosed() {
        state = CircuitState.CLOSED;
        failureCount.set(0);
        successCount.set(0);
        log.info("熔断器关闭");
    }
    
    // ========== 降级逻辑 ==========
    
    private Product getDegradedProduct(Long productId) {
        // 降级方案 1：返回静态数据
        return getStaticProduct(productId);
        
        // 降级方案 2：返回缓存的空值
        // return getCachedEmptyValue(productId);
        
        // 降级方案 3：抛出友好异常
        // throw new ServiceDegradedException("服务繁忙，请稍后再试");
    }
    
    private Product getStaticProduct(Long productId) {
        // 兜底的静态数据
        Product product = new Product();
        product.setId(productId);
        product.setName("商品正在加载中...");
        product.setPrice(BigDecimal.ZERO);
        return product;
    }
    
    private enum CircuitState {
        CLOSED,    // 关闭：正常请求
        OPEN,      // 打开：全部降级
        HALF_OPEN  // 半开：探测恢复
    }
}
```

### Sentinel 实现熔断降级

实际生产推荐使用 Sentinel、Hystrix 等成熟的熔断组件：

```java
// Sentinel 熔断降级示例
@SentinelResource(value = "getProduct",
    fallback = "getProductFallback",
    blockHandler = "getProductBlockHandler")
public Product getProduct(Long productId) {
    String cacheKey = "product:" + productId;
    return (Product) redisTemplate.opsForValue().get(cacheKey);
}

// 降级方法
public Product getProductFallback(Long productId, Throwable t) {
    log.warn("查询商品 {} 降级，原因: {}", productId, t.getMessage());
    Product product = new Product();
    product.setId(productId);
    product.setName("商品正在加载中...");
    return product;
}

// 限流/熔断处理
public Product getProductBlockHandler(Long productId, BlockException e) {
    throw new ServiceDegradedException("访问过于频繁，请稍后再试");
}
```

---

## 方案四：预热 + 过期时间递进

### 核心思想

不要等到缓存过期，而是**提前主动刷新**，让缓存永远保持「新鲜」。

```
传统方式：
写入缓存（TTL=1小时）→ 等 1 小时 → 过期 → 下次请求触发加载
                        ↑
                    这是雪崩风险点

预热方式：
写入缓存（TTL=1小时）→ 55 分钟后主动刷新 → 新 TTL=1小时
                                          ↑
                                      无缝衔接，无雪崩风险
```

### 实现

```java
public class ProactiveRefreshCacheService {
    
    private static final long BASE_TTL_MILLIS = 60 * 60 * 1000;      // 1 小时
    private static final long REFRESH_THRESHOLD_MILLIS = 10 * 60 * 1000;  // 提前 10 分钟刷新
    
    // 异步刷新任务
    private final ScheduledExecutorService refreshExecutor;
    
    public void setProduct(Long productId, Product product) {
        String cacheKey = "product:" + productId;
        long expireTime = System.currentTimeMillis() + BASE_TTL_MILLIS;
        
        // 存储数据和过期时间
        CacheEntry entry = new CacheEntry(product, expireTime);
        redisTemplate.opsForValue().set(cacheKey, entry);
    }
    
    public Product getProduct(Long productId) {
        String cacheKey = "product:" + productId;
        
        CacheEntry entry = (CacheEntry) redisTemplate.opsForValue().get(cacheKey);
        if (entry == null) {
            // 未命中，查数据库
            Product product = productDao.selectById(productId);
            if (product != null) {
                setProduct(productId, product);
            }
            return product;
        }
        
        // 检查是否需要主动刷新
        if (entry.isNearExpiry(REFRESH_THRESHOLD_MILLIS)) {
            // 异步刷新
            refreshExecutor.submit(() -&gt; doRefresh(productId, cacheKey));
        }
        
        return entry.getProduct();
    }
    
    private void doRefresh(Long productId, String cacheKey) {
        try {
            Product product = productDao.selectById(productId);
            if (product != null) {
                setProduct(productId, product);
                log.debug("主动刷新缓存: {}", cacheKey);
            }
        } catch (Exception e) {
            log.warn("主动刷新缓存失败: {}", cacheKey, e);
        }
    }
    
    @Data
    public static class CacheEntry {
        private Product product;
        private long expireTime;
        
        public CacheEntry(Product product, long expireTime) {
            this.product = product;
            this.expireTime = expireTime;
        }
        
        public boolean isNearExpiry(long thresholdMillis) {
            return System.currentTimeMillis() + thresholdMillis &gt; expireTime;
        }
        
        public Product getProduct() {
            return product;
        }
    }
}
```

---

## 综合防护方案

单一方案都不够，实际需要**多层防护**：

```
┌─────────────────────────────────────────────────────────────┐
│                        综合防护体系                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  第一层：过期时间分散化                                      │
│  ├── 基础 TTL + 随机偏移                                    │
│  └── hash(key) 决定过期分钟                                │
│                                                             │
│  第二层：多级缓存                                            │
│  ├── L1 本地缓存（Caffeine）                                │
│  ├── L2 Redis 缓存                                         │
│  └── L3 数据库                                              │
│                                                             │
│  第三层：熔断降级                                            │
│  ├── Sentinel/Hystrix                                       │
│  ├── 半开探测                                               │
│  └── 降级返回                                               │
│                                                             │
│  第四层：主动刷新                                           │
│  ├── 热点数据永不过期                                       │
│  └── 异步预热机制                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 总结

缓存雪崩的四种防护方案：

| 方案 | 防护对象 | 效果 | 成本 |
|------|----------|------|------|
| 过期时间随机化 | 集中过期 | ⭐⭐⭐⭐⭐ | 低 |
| 多级缓存 | Redis 故障 | ⭐⭐⭐⭐⭐ | 中 |
| 熔断降级 | 数据库过载 | ⭐⭐⭐⭐ | 中 |
| 主动刷新 | 热点数据失效 | ⭐⭐⭐⭐ | 高 |

**最佳实践**：过期随机化 + 多级缓存 + 熔断降级 三合一。

---

## 留给你的问题

假设这样一个场景：你的电商系统在「双十一」零点迎来流量高峰，**所有秒杀商品的缓存都在同一时刻失效**。

已知：
- 秒杀商品有 100 个
- 每个商品的峰值 QPS 是 10 万
- 数据库每秒最多处理 1000 次查询

请思考：
1. 如果只用「过期时间随机化」方案，能否扛住？为什么？
2. 结合「多级缓存」和「熔断降级」，系统应该怎么设计？
3. 如何利用「主动刷新」在活动开始前完成缓存预热？
