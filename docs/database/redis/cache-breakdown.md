# 缓存击穿：互斥锁 + 逻辑过期双检

热点商品正在秒杀，缓存突然过期。
瞬间，大量请求同时打到数据库。

这就是**缓存击穿**。

## 什么是缓存击穿？

缓存击穿是指：**一个热点 key 过期后，大量请求同时发现缓存失效，一起涌入数据库查询**。

```
正常情况：
请求1 ──▶ 缓存[命中] ──▶ 返回
请求2 ──▶ 缓存[命中] ──▶ 返回

缓存击穿：
时间 ─────────────────────────────────────────────────▶

请求1 ──▶ 缓存 ──▶ ✗(过期) ──▶ 数据库 ──▶ 设置缓存 ──▶ 返回
请求2 ──▶ 缓存 ──▶ ✗(过期) ──▶ 数据库 ──▶ 设置缓存 ──▶ 返回
请求3 ──▶ 缓存 ──▶ ✗(过期) ──▶ 数据库 ──▶ 设置缓存 ──▶ 返回
请求4 ──▶ 缓存 ──▶ ✗(过期) ──▶ 数据库 ──▶ 设置缓存 ──▶ 返回
                    │
                    └── 1000 个请求同时打进来！
```

## 击穿 vs 穿透 vs 雪崩

| 问题 | 区别 | 原因 |
|-----|------|------|
| **缓存穿透** | 查询不存在的数据 | 数据库也没有 |
| **缓存击穿** | 热点 key 过期 | 单个热点 key 高并发 |
| **缓存雪崩** | 大量 key 同时过期 | 批量 key 过期 |

## 缓存击穿的危害

| 危害 | 说明 |
|-----|------|
| 数据库压力 | 瞬间大量请求打数据库 |
| 响应延迟 | 数据库响应慢 |
| 雪崩风险 | 可能引发连锁反应 |

## 解决方案

### 方案一：互斥锁

**原理**：只有一个线程去查数据库，其他线程等待。

```
请求1 ──▶ 获取锁 ──▶ 查数据库 ──▶ 设置缓存 ──▶ 释放锁 ──▶ 返回
请求2 ──▶ 获取锁 ✗ ──▶ 等待 ──▶ 获取锁 ──▶ 查缓存[命中] ──▶ 返回
请求3 ──▶ 获取锁 ✗ ──▶ 等待 ──▶ 获取锁 ──▶ 查缓存[命中] ──▶ 返回
```

```java
/**
 * 互斥锁方案
 * 
 * 优点：保证数据库只被查询一次
 * 缺点：其他线程需要等待，性能有损失
 */
public class MutexLockSolution {
    
    private Jedis jedis;
    
    /**
     * 查询商品（互斥锁）
     */
    public Product getProduct(String productId) {
        String cacheKey = "product:" + productId;
        String lockKey = "lock:product:" + productId;
        
        // 1. 先查缓存
        String cacheValue = jedis.get(cacheKey);
        if (cacheValue != null) {
            return JSON.parseObject(cacheValue, Product.class);
        }
        
        // 2. 缓存未命中，获取互斥锁
        String lockValue = jedis.set(lockKey, "1", SetParams.setNX().ex(10));
        
        if ("OK".equals(lockValue)) {
            try {
                // 3. 获取到锁，再次检查缓存（可能其他线程已经设置好了）
                cacheValue = jedis.get(cacheKey);
                if (cacheValue != null) {
                    return JSON.parseObject(cacheValue, Product.class);
                }
                
                // 4. 查数据库
                Product product = db.findProduct(productId);
                
                // 5. 设置缓存
                jedis.setex(cacheKey, 30 * 60, JSON.toJSONString(product));
                
                return product;
            } finally {
                // 6. 释放锁
                jedis.del(lockKey);
            }
        } else {
            // 7. 未获取到锁，短暂等待后重试
            try {
                Thread.sleep(50);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return getProduct(productId);  // 递归重试
        }
    }
}
```

### 方案二：逻辑过期（永远不过期）

**原理**：缓存不过期，存储一个「逻辑过期时间」，后台异步更新。

```java
/**
 * 逻辑过期方案
 * 
 * 优点：完全避免缓存击穿
 * 缺点：可能短暂返回过期数据
 */
public class LogicalExpireSolution {
    
    private Jedis jedis;
    private static final int LOCK_TIMEOUT = 10;  // 锁超时时间（秒）
    
    /**
     * 缓存数据结构
     */
    @Data
    public static class CacheData {
        private Product data;
        private long expireTime;  // 逻辑过期时间（时间戳）
        
        public boolean isExpired() {
            return System.currentTimeMillis() > expireTime;
        }
    }
    
    /**
     * 查询商品（逻辑过期）
     */
    public Product getProduct(String productId) {
        String cacheKey = "product:" + productId;
        
        // 1. 查缓存
        String cacheValue = jedis.get(cacheKey);
        if (cacheValue == null) {
            // 缓存为空，查数据库
            Product product = db.findProduct(productId);
            setProductCache(productId, product);
            return product;
        }
        
        // 2. 反序列化
        CacheData cacheData = JSON.parseObject(cacheValue, CacheData.class);
        
        // 3. 检查是否逻辑过期
        if (!cacheData.isExpired()) {
            // 未过期，直接返回
            return cacheData.getData();
        }
        
        // 4. 已过期，尝试获取更新锁
        String lockKey = "lock:product:" + productId;
        String lockValue = jedis.set(lockKey, "1", 
            SetParams.setNX().ex(LOCK_TIMEOUT));
        
        if ("OK".equals(lockValue)) {
            // 5. 获取到锁，开启异步线程更新缓存
            CompletableFuture.runAsync(() -> {
                try {
                    Product product = db.findProduct(productId);
                    setProductCache(productId, product);
                } finally {
                    jedis.del(lockKey);
                }
            });
            
            // 6. 返回过期数据（短暂不一致，可接受）
            return cacheData.getData();
        } else {
            // 7. 未获取到锁，直接返回过期数据
            return cacheData.getData();
        }
    }
    
    /**
     * 设置缓存
     */
    private void setProductCache(String productId, Product product) {
        String cacheKey = "product:" + productId;
        CacheData cacheData = new CacheData();
        cacheData.setData(product);
        cacheData.setExpireTime(System.currentTimeMillis() + 30 * 60 * 1000);
        jedis.setex(cacheKey, 60 * 60, JSON.toJSONString(cacheData));
    }
}
```

### 方案三：双检 + 互斥锁（最佳实践）

两种方案结合，兼顾数据一致性和性能。

```java
/**
 * 双检 + 互斥锁（推荐方案）
 * 
 * 特点：
 * - 数据一致性好
 * - 只有一个线程查数据库
 * - 其他线程不阻塞
 */
public class DoubleCheckMutexSolution {
    
    private Jedis jedis;
    private static final int LOCK_TIMEOUT = 10;
    private static final int CACHE_TIMEOUT = 30 * 60;
    
    /**
     * 查询商品（双检 + 互斥锁）
     */
    public Product getProduct(String productId) {
        String cacheKey = "product:" + productId;
        String lockKey = "lock:product:" + productId;
        
        // 第一次检查
        String cacheValue = jedis.get(cacheKey);
        if (cacheValue != null) {
            return JSON.parseObject(cacheValue, Product.class);
        }
        
        // 获取互斥锁
        String lockValue = jedis.set(lockKey, "1", 
            SetParams.setNX().ex(LOCK_TIMEOUT));
        
        if ("OK".equals(lockValue)) {
            try {
                // 第二次检查（其他线程可能已经设置好了）
                cacheValue = jedis.get(cacheKey);
                if (cacheValue != null) {
                    return JSON.parseObject(cacheValue, Product.class);
                }
                
                // 查数据库
                Product product = db.findProduct(productId);
                
                // 设置缓存
                jedis.setex(cacheKey, CACHE_TIMEOUT, JSON.toJSONString(product));
                
                return product;
            } finally {
                jedis.del(lockKey);
            }
        } else {
            // 未获取到锁，短暂等待后重试
            try {
                Thread.sleep(50);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return getProduct(productId);
        }
    }
    
    /**
     * 使用 Redisson 实现（更简单）
     */
    public Product getProductWithRedisson(String productId) {
        String cacheKey = "product:" + productId;
        
        // 第一次检查
        String cacheValue = jedis.get(cacheKey);
        if (cacheValue != null) {
            return JSON.parseObject(cacheValue, Product.class);
        }
        
        // 使用 Redisson 的分布式锁
        RLock lock = redissonClient.getLock("lock:product:" + productId);
        lock.lock(10, TimeUnit.SECONDS);
        
        try {
            // 第二次检查
            cacheValue = jedis.get(cacheKey);
            if (cacheValue != null) {
                return JSON.parseObject(cacheValue, Product.class);
            }
            
            Product product = db.findProduct(productId);
            jedis.setex(cacheKey, CACHE_TIMEOUT, JSON.toJSONString(product));
            
            return product;
        } finally {
            lock.unlock();
        }
    }
}
```

## 方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
|-----|------|------|---------|
| 互斥锁 | 实现简单，数据一致性好 | 其他线程需等待 | 对数据一致性要求高 |
| 逻辑过期 | 完全避免击穿 | 返回过期数据 | 对数据一致性要求不高 |
| 双检+互斥锁 | 综合两者优点 | 实现稍复杂 | 生产环境推荐 |

## 热点 key 自动续期

除了被动处理击穿，还可以**主动续期热点 key**：

```java
/**
 * 热点 key 自动续期
 * 
 * 在业务访问时，检查 key 是否快过期
 * 如果快过期了，延长过期时间
 */
public class HotKeyAutoRenew {
    
    private Jedis jedis;
    
    /**
     * 查询并续期
     */
    public Product getAndRenew(String productId) {
        String cacheKey = "product:" + productId;
        
        // 查缓存
        String cacheValue = jedis.get(cacheKey);
        if (cacheValue == null) {
            return null;
        }
        
        // 获取 TTL
        Long ttl = jedis.ttl(cacheKey);
        
        // 如果快过期了（小于 5 分钟），续期
        if (ttl != null && ttl < 5 * 60) {
            jedis.expire(cacheKey, 30 * 60);
        }
        
        return JSON.parseObject(cacheValue, Product.class);
    }
}
```

## Redisson 分布式锁

Redisson 提供了更完善的分布式锁实现：

```java
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;

public class RedissonLockDemo {
    
    private RedissonClient redissonClient;
    
    /**
     * 获取商品（使用 Redisson 锁）
     */
    public Product getProduct(String productId) {
        String cacheKey = "product:" + productId;
        RLock lock = redissonClient.getLock("lock:product:" + productId);
        
        try {
            // 尝试获取锁，最多等待 0 秒，锁自动释放时间 10 秒
            boolean locked = lock.tryLock(0, 10, TimeUnit.SECONDS);
            
            if (!locked) {
                // 未获取到锁，等待后重试
                Thread.sleep(50);
                return getProduct(productId);
            }
            
            // 查缓存
            String cacheValue = jedis.get(cacheKey);
            if (cacheValue != null) {
                return JSON.parseObject(cacheValue, Product.class);
            }
            
            // 查数据库
            Product product = db.findProduct(productId);
            jedis.setex(cacheKey, 30 * 60, JSON.toJSONString(product));
            
            return product;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        } finally {
            // 释放锁
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
}
```

## 总结

缓存击穿是热点 key 的常见问题：

- **原因**：热点 key 过期后大量请求涌入
- **方案**：互斥锁、逻辑过期、双检+互斥锁
- **选型**：推荐双检+互斥锁，兼顾一致性和性能
- **预防**：热点 key 自动续期

## 留给你的问题

互斥锁方案中，如果获取锁的线程在执行过程中崩溃了，会发生什么？

**Redis 的锁有过期时间，为什么需要？Redisson 是如何处理这种情况的？**
