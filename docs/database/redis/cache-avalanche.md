# 缓存雪崩：过期时间随机化 + 多级缓存

双十一零点，Redis 中 10000 个商品缓存同时过期。
瞬间，数据库被 10 万并发请求淹没，直接崩溃。

这就是**缓存雪崩**。

## 什么是缓存雪崩？

缓存雪崩是指：**大量缓存 key 在同一时间过期，导致大量请求直接打到数据库**。

```
正常情况：
时间 ─────────────────────────────────────────────────▶
     │         │         │         │         │
     ↓         ↓         ↓         ↓         ↓
  命中      命中      命中      命中      命中
  缓存      缓存      缓存      缓存      缓存

缓存雪崩：
时间 ─────────────────────────────────────────────────▶
     │                                           │
     ↓ (10000 个 key 同时过期)                    ↓
  命中                                          数据库
  缓存    ✗     ✗     ✗     ✗     ✗  ──▶  崩溃！
```

## 雪崩 vs 击穿 vs 穿透

| 问题 | 区别 | 原因 |
|-----|------|------|
| **缓存穿透** | 查询不存在的数据 | 数据库也没有 |
| **缓存击穿** | 单个热点 key 过期 | 单个 key 高并发 |
| **缓存雪崩** | 大量 key 同时过期 | 批量 key 同时失效 |

## 雪崩的原因

### 原因一：缓存服务宕机

```
Redis 宕机
    │
    ▼
所有请求直接打数据库
    │
    ▼
数据库崩溃
```

### 原因二：大量 key 设置相同过期时间

```java
// 批量设置缓存，都设置为 1 小时后过期
for (Product product : products) {
    redis.setex("product:" + product.getId(), 3600, JSON.toJSONString(product));
}
```

### 原因三：Redis 内存满，触发淘汰

```
Redis 内存使用率 100%
    │
    ▼
触发内存淘汰策略（LRU/LFU）
    │
    ▼
大量 key 被淘汰
```

## 雪崩的解决方案

### 方案一：过期时间随机化

**原理**：给 key 的过期时间加上随机值，避免同时过期。

```java
/**
 * 过期时间随机化
 */
public class RandomExpireSolution {
    
    private Jedis jedis;
    
    /**
     * 设置缓存（过期时间随机）
     */
    public void setProduct(Product product) {
        String cacheKey = "product:" + product.getId();
        
        // 基础过期时间：30 分钟
        int baseTimeout = 30 * 60;
        // 随机偏移：±5 分钟
        int randomOffset = ThreadLocalRandom.current().nextInt(-5 * 60, 5 * 60 + 1);
        // 最终过期时间：25-35 分钟
        int timeout = baseTimeout + randomOffset;
        
        jedis.setex(cacheKey, timeout, JSON.toJSONString(product));
    }
    
    /**
     * 批量设置缓存（过期时间随机）
     */
    public void setProducts(List&lt;Product&gt; products) {
        for (Product product : products) {
            setProduct(product);
        }
    }
}
```

配置方式：
```bash
# Redis 配置：不给缓存设置固定过期时间
# 而是在应用层计算随机过期时间
```

### 方案二：多级缓存

**原理**：构建多级缓存架构，一层失效还有下一层。

```
┌─────────────────────────────────────────────────────────────────┐
│                        多级缓存架构                               │
│                                                                 │
│   L1 (本地缓存)    L2 (Redis)        L3 (数据库)              │
│   ─────────────   ─────────────      ────────────              │
│                                                                 │
│   Caffeine         Redis              MySQL                     │
│   大小: 1000       大小: 10000        大小: 无限制              │
│   过期: 1分钟      过期: 30分钟        -                          │
│                                                                 │
│   请求流程：                                                    │
│   1. 查 L1，命中则返回                                        │
│   2. L1 未命中，查 L2                                          │
│   3. L2 未命中，查 L3                                          │
│   4. 结果写入 L2，再写入 L1                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

```java
/**
 * 多级缓存实现
 */
public class MultiLevelCache {
    
    // L1 本地缓存（Caffeine）
    private Cache&lt;String, Product&gt; l1Cache;
    // L2 Redis 缓存
    private Jedis jedis;
    
    /**
     * 初始化 L1 缓存
     */
    public void init() {
        l1Cache = Caffeine.newBuilder()
            .maximumSize(1000)           // 最大 1000 条
            .expireAfterWrite(1, TimeUnit.MINUTES)  // 1 分钟过期
            .build();
    }
    
    /**
     * 查询商品（多级缓存）
     */
    public Product getProduct(String productId) {
        String cacheKey = "product:" + productId;
        
        // 1. 查 L1
        Product product = l1Cache.getIfPresent(cacheKey);
        if (product != null) {
            return product;
        }
        
        // 2. 查 L2
        String l2Value = jedis.get(cacheKey);
        if (l2Value != null) {
            product = JSON.parseObject(l2Value, Product.class);
            // 回填 L1
            l1Cache.put(cacheKey, product);
            return product;
        }
        
        // 3. 查 L3
        product = db.findProduct(productId);
        
        if (product != null) {
            // 回填 L2 和 L1
            jedis.setex(cacheKey, 30 * 60, JSON.toJSONString(product));
            l1Cache.put(cacheKey, product);
        }
        
        return product;
    }
    
    /**
     * 更新商品（双写）
     */
    public void updateProduct(Product product) {
        String cacheKey = "product:" + product.getId();
        
        // 1. 更新数据库
        db.updateProduct(product);
        
        // 2. 删除缓存（Cache-Aside 模式）
        jedis.del(cacheKey);
        l1Cache.invalidate(cacheKey);
    }
}
```

### 方案三：服务熔断和降级

**原理**：当缓存服务不可用时，通过降级保护数据库。

```java
/**
 * 缓存降级保护
 */
public class CacheDegradation {
    
    private Jedis jedis;
    
    /**
     * 查询商品（带降级）
     */
    public Product getProduct(String productId) {
        String cacheKey = "product:" + productId;
        
        try {
            // 尝试从缓存获取
            String cacheValue = jedis.get(cacheKey);
            if (cacheValue != null) {
                return JSON.parseObject(cacheValue, Product.class);
            }
        } catch (Exception e) {
            // 缓存异常，记录日志
            log.warn("Redis 查询失败，触发降级", e);
            // 降级：直接查数据库
            return getProductFromDB(productId);
        }
        
        // 缓存未命中，查数据库
        return getProductFromDBWithCache(productId);
    }
    
    /**
     * 从数据库查询（带缓存）
     */
    private Product getProductFromDBWithCache(String productId) {
        String cacheKey = "product:" + productId;
        
        try {
            Product product = db.findProduct(productId);
            if (product != null) {
                // 尝试写入缓存
                jedis.setex(cacheKey, 30 * 60, JSON.toJSONString(product));
            }
            return product;
        } catch (Exception e) {
            log.error("数据库查询失败", e);
            return null;
        }
    }
    
    /**
     * 纯数据库查询（完全降级）
     */
    private Product getProductFromDB(String productId) {
        try {
            return db.findProduct(productId);
        } catch (Exception e) {
            log.error("降级后数据库查询也失败", e);
            return null;
        }
    }
}
```

### 方案四：构建 Redis 高可用集群

**原理**：Redis 本身不宕机，就不会因为 Redis 宕机导致雪崩。

```bash
# 主从 + Sentinel
# 或
# Redis Cluster
```

### 方案五：请求限流

**原理**：限制进入系统的请求数量，保护数据库。

```java
/**
 * 请求限流
 */
public class RateLimiter {
    
    private Jedis jedis;
    
    /**
     * 限流查询
     */
    public Product getProductWithLimit(String productId) {
        String limitKey = "limit:product:" + productId;
        
        // 1. 检查限流
        Long count = jedis.incr(limitKey);
        if (count == 1) {
            // 第一个请求，设置过期时间
            jedis.expire(limitKey, 1);
        }
        
        // 2. 每秒最多 100 个请求
        if (count > 100) {
            throw new ServiceUnavailableException("请求过于频繁，请稍后重试");
        }
        
        // 3. 正常查询
        return getProduct(productId);
    }
}
```

## 预防措施

### 1. 过期时间差异化

```java
// 不要
redis.setex(key, 3600, value);  // 3600 秒 = 1 小时

// 要
redis.setex(key, 3600 + random.nextInt(3600), value);  // 1-2 小时
```

### 2. 热点数据永不过期

```java
// 热点 key 使用逻辑过期
if (isHotKey(productId)) {
    setWithLogicalExpire(productId, product);
} else {
    setWithNormalExpire(productId, product);
}
```

### 3. 监控和预警

```yaml
# Prometheus 告警规则
groups:
  - name: redis_cache_alerts
    rules:
      - alert: RedisCacheHitRateLow
        expr: redis_keyspace_hits / (redis_keyspace_hits + redis_keyspace_misses) < 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "缓存命中率低于 80%"
          
      - alert: RedisExpiredKeysSpike
        expr: rate(redis_expired_keys_total[5m]) > 10000
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "过期 key 数量激增，可能发生雪崩"
```

## 综合方案

实际生产环境中，通常需要组合多种方案：

```java
/**
 * 完整的雪崩防护方案
 */
public class CompleteSnowslideProtection {
    
    private Cache&lt;String, Product&gt; l1Cache;  // 本地缓存
    private Jedis jedis;                        // Redis 缓存
    private RateLimiter rateLimiter;            // 限流器
    private CircuitBreaker circuitBreaker;      // 熔断器
    
    /**
     * 查询商品（完整防护）
     */
    public Product getProduct(String productId) {
        String cacheKey = "product:" + productId;
        
        // 1. 检查熔断器
        if (circuitBreaker.isOpen()) {
            return getProductFallback(productId);
        }
        
        try {
            // 2. 限流
            rateLimiter.check("product:" + productId);
            
            // 3. 查 L1
            Product product = l1Cache.getIfPresent(cacheKey);
            if (product != null) {
                return product;
            }
            
            // 4. 查 L2
            String l2Value = jedis.get(cacheKey);
            if (l2Value != null) {
                product = JSON.parseObject(l2Value, Product.class);
                l1Cache.put(cacheKey, product);
                return product;
            }
            
            // 5. 查 L3
            product = db.findProduct(productId);
            if (product != null) {
                // 随机过期时间
                int timeout = 30 * 60 + ThreadLocalRandom.current().nextInt(-10 * 60, 10 * 60 + 1);
                jedis.setex(cacheKey, timeout, JSON.toJSONString(product));
                l1Cache.put(cacheKey, product);
            }
            
            return product;
        } catch (Exception e) {
            circuitBreaker.recordFailure();
            return getProductFallback(productId);
        }
    }
    
    /**
     * 降级查询
     */
    private Product getProductFallback(String productId) {
        // 直接查数据库，不走缓存
        try {
            return db.findProduct(productId);
        } catch (Exception e) {
            // 返回默认数据或空
            return null;
        }
    }
}
```

## 总结

缓存雪崩是严重的系统故障：

- **原因**：大量 key 同时过期或 Redis 宕机
- **预防**：过期时间随机化、多级缓存、限流熔断
- **选型**：生产环境推荐多级缓存 + 降级熔断组合

## 留给你的问题

多级缓存架构中，L1 和 L2 可能短暂不一致。

**如果用户 A 修改了商品信息，L1 和 L2 都需要更新。应该先更新 L1 还是先更新 L2？有没有更好的策略？**
