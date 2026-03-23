# 设计 Redis 缓存穿透/击穿/雪崩解决方案

缓存三剑客——穿透、击穿、雪崩。

这是 Redis 使用中最常见的问题，也是面试中的高频考点。

今天，我们用一篇文章，把这三个问题彻底讲清楚。

---

## 一、三个问题的本质

```
┌─────────────────────────────────────────────────────────┐
│              缓存三剑客的本质区别                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  穿透：数据本身不存在                                    │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐         │
│  │  请求   │────▶│  缓存   │────▶│  数据库  │         │
│  │         │     │ (miss)  │     │ (no data)│         │
│  └─────────┘     └─────────┘     └─────────┘         │
│     恶意攻击                                              │
│     业务漏洞                                              │
│                                                         │
│  击穿：热点 key 过期                                     │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐         │
│  │  请求   │────▶│  缓存   │────▶│  数据库  │         │
│  │         │     │ (过期!) │     │ (大量)  │         │
│  └─────────┘     └─────────┘     └─────────┘         │
│     热点数据                                              │
│     过期瞬间                                              │
│                                                         │
│  雪崩：大量 key 同时过期                                  │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐         │
│  │  请求   │────▶│  缓存   │────▶│  数据库  │         │
│  │         │     │(批量过期)│     │ (爆炸)  │         │
│  └─────────┘     └─────────┘     └─────────┘         │
│     集中过期                                              │
│     Redis 宕机                                           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 二、缓存穿透

### 2.1 什么是缓存穿透？

**大量请求查询一个不存在的数据**——数据既不在缓存，也不在数据库。

常见场景：
- 恶意攻击：黑客用不存在的 ID 疯狂请求
- 业务漏洞：查询已被删除的商品或用户

危害：
- 每个请求都打到数据库
- 数据库被打垮

### 2.2 解决方案

#### 方案一：缓存空值

```java
/**
 * 方案一：缓存空值
 * 
 * 思路：将「数据不存在」也缓存起来
 */
public class CacheNullValueSolution {
    
    private RedisTemplate<String, Object> redis;
    
    /**
     * 查询用户（带空值缓存）
     */
    public User getUser(String userId) {
        String cacheKey = "user:" + userId;
        
        // 1. 查缓存
        Object cached = redis.opsForValue().get(cacheKey);
        if (cached != null) {
            // 注意：空值也是有效缓存
            if (cached instanceof String && "NULL".equals(cached)) {
                return null;
            }
            return (User) cached;
        }
        
        // 2. 查数据库
        User user = database.findUserById(userId);
        
        // 3. 缓存结果（注意空值也要缓存）
        if (user != null) {
            redis.opsForValue().set(cacheKey, user, Duration.ofHours(1));
        } else {
            // 空值缓存时间短一些（5 分钟）
            // 避免数据真的存在时，长时间不一致
            redis.opsForValue().set(cacheKey, "NULL", Duration.ofMinutes(5));
        }
        
        return user;
    }
}
```

#### 方案二：布隆过滤器

```java
/**
 * 方案二：布隆过滤器
 * 
 * 思路：用布隆过滤器判断数据是否存在
 * - 不存在的数据：100% 返回不存在
 * - 存在的数据：可能误判（但可以接受）
 */
public class BloomFilterSolution {
    
    private RedisTemplate<String, String> redis;
    private BloomFilter<String> bloomFilter;
    
    /**
     * 初始化布隆过滤器
     * 
     * 从数据库加载所有存在的 key
     */
    public void initBloomFilter() {
        // 创建布隆过滤器
        // expectedInsertions: 预期插入数量
        // fpp: 可接受的误判率
        bloomFilter = BloomFilter.create(
            Funnels.stringFunnel(StandardCharsets.UTF_8),
            100_000_000,  // 1 亿
            0.01          // 1% 误判率
        );
        
        // 从数据库加载所有用户 ID
        List<String> allUserIds = database.getAllUserIds();
        for (String userId : allUserIds) {
            bloomFilter.put(userId);
        }
    }
    
    /**
     * 查询用户（带布隆过滤器）
     */
    public User getUser(String userId) {
        // 1. 先判断布隆过滤器
        if (!bloomFilter.mightContain(userId)) {
            // 布隆过滤器说一定不存在，直接返回
            return null;
        }
        
        // 2. 过滤器说可能存在，查缓存
        String cacheKey = "user:" + userId;
        Object cached = redis.opsForValue().get(cacheKey);
        if (cached != null) {
            return (User) cached;
        }
        
        // 3. 查数据库
        User user = database.findUserById(userId);
        
        // 4. 缓存结果
        if (user != null) {
            redis.opsForValue().set(cacheKey, user, Duration.ofHours(1));
        }
        
        return user;
    }
}
```

#### 方案对比

| 方案 | 适用场景 | 优点 | 缺点 |
|-----|---------|------|------|
| 缓存空值 | 数据量较小 | 简单 | 浪费内存存空值 |
| 布隆过滤器 | 数据量巨大 | 内存效率高 | 有误判率 |

---

## 三、缓存击穿

### 3.1 什么是缓存击穿？

**热点 key 过期瞬间，大量请求同时回源数据库**。

常见场景：
- 热点商品详情页（618 大促期间缓存过期）
- 明星粉丝系统（明星发微博时粉丝暴涨）

危害：
- 大量请求同时打到数据库
- 数据库被打垮

### 3.2 解决方案

#### 方案一：互斥锁

```java
/**
 * 方案一：互斥锁（分布式锁）
 * 
 * 思路：只有一个线程去查数据库，其他线程等待
 */
public class MutexLockSolution {
    
    private RedisTemplate<String, Object> redis;
    private RedissonClient redisson;
    
    /**
     * 获取用户（带互斥锁）
     */
    public User getUserWithLock(String userId) {
        String cacheKey = "user:" + userId;
        String lockKey = "lock:user:" + userId;
        
        // 1. 先查缓存
        User cached = (User) redis.opsForValue().get(cacheKey);
        if (cached != null) {
            return cached;
        }
        
        // 2. 获取分布式锁
        RLock lock = redisson.getLock(lockKey);
        
        try {
            // 尝试获取锁，最多等待 3 秒，锁自动过期 10 秒
            boolean acquired = lock.tryLock(3, 10, TimeUnit.SECONDS);
            
            if (acquired) {
                try {
                    // 双重检查缓存
                    cached = (User) redis.opsForValue().get(cacheKey);
                    if (cached != null) {
                        return cached;
                    }
                    
                    // 查数据库
                    User user = database.findUserById(userId);
                    
                    // 回填缓存
                    if (user != null) {
                        redis.opsForValue().set(cacheKey, user, Duration.ofHours(1));
                    }
                    
                    return user;
                    
                } finally {
                    // 释放锁
                    lock.unlock();
                }
            } else {
                // 获取锁失败，短暂等待后重试
                Thread.sleep(50);
                return getUserWithLock(userId); // 递归重试
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        }
    }
}
```

#### 方案二：热点数据永不过期

```java
/**
 * 方案二：热点数据永不过期
 * 
 * 思路：不设置 TTL，用逻辑过期时间
 */
public class LogicalExpireSolution {
    
    private RedisTemplate<String, String> redis;
    
    /**
     * 缓存数据结构（包含逻辑过期时间）
     */
    public static class CacheData<T> {
        T data;
        long logicalExpireTime;  // 逻辑过期时间戳
        
        public boolean isExpired() {
            return System.currentTimeMillis() > logicalExpireTime;
        }
    }
    
    /**
     * 获取用户（带逻辑过期）
     */
    public User getUserWithLogicalExpire(String userId) {
        String cacheKey = "user:" + userId;
        
        // 1. 查缓存
        String cachedJson = redis.opsForValue().get(cacheKey);
        if (cachedJson == null) {
            return null;
        }
        
        // 2. 反序列化
        CacheData<User> cacheData = JSON.parseObject(cachedJson, 
            new TypeReference<CacheData<User>>() {});
        
        // 3. 检查是否逻辑过期
        if (cacheData.isExpired()) {
            // 异步更新缓存（不阻塞读取）
            refreshCacheAsync(userId, cacheKey);
            
            // 返回旧数据（虽然过期，但勉强能用）
            return cacheData.data;
        }
        
        // 4. 数据有效，直接返回
        return cacheData.data;
    }
    
    /**
     * 异步刷新缓存
     */
    @Async
    public void refreshCacheAsync(String userId, String cacheKey) {
        // 1. 获取分布式锁
        RLock lock = redisson.getLock("lock:" + cacheKey);
        
        try {
            lock.lock();
            
            // 2. 重新查询数据库
            User user = database.findUserById(userId);
            
            // 3. 更新缓存
            CacheData<User> newCacheData = new CacheData<>();
            newCacheData.data = user;
            newCacheData.logicalExpireTime = System.currentTimeMillis() + 30 * 60 * 1000; // 30 分钟后过期
            
            redis.opsForValue().set(cacheKey, 
                JSON.toJSONString(newCacheData),
                Duration.ofHours(2)); // 物理过期时间 2 小时
            
        } finally {
            lock.unlock();
        }
    }
}
```

#### 方案三：提前重建

```java
/**
 * 方案三：提前重建缓存
 * 
 * 思路：在 key 过期前，主动重建
 */
public class AdvanceRebuildSolution {
    
    /**
     * 获取用户（提前重建）
     */
    public User getUserWithAdvanceRebuild(String userId) {
        String cacheKey = "user:" + userId;
        
        // 1. 查缓存
        User cached = (User) redis.opsForValue().get(cacheKey);
        if (cached != null) {
            // 2. 检查是否快过期
            Long ttl = redis.getExpire(cacheKey);
            if (ttl != null && ttl < 60) { // TTL 小于 60 秒
                // 异步重建
                rebuildCacheAsync(userId);
            }
            
            return cached;
        }
        
        // 3. 缓存不存在，查数据库
        User user = database.findUserById(userId);
        
        if (user != null) {
            redis.opsForValue().set(cacheKey, user, Duration.ofHours(1));
        }
        
        return user;
    }
    
    /**
     * 异步重建缓存
     */
    @Async
    public void rebuildCacheAsync(String userId) {
        // 获取锁后重建...
    }
}
```

---

## 四、缓存雪崩

### 4.1 什么是缓存雪崩？

**大量 key 同时过期，或者 Redis 宕机，导致大量请求直接打到数据库**。

常见场景：
- 大量 key 使用相同的过期时间
- 凌晨 12 点大量 key 同时过期
- Redis 宕机

危害：
- 数据库瞬间承受巨大压力
- 系统崩溃

### 4.2 解决方案

#### 方案一：过期时间随机化

```java
/**
 * 方案一：过期时间随机化
 * 
 * 思路：给过期时间加随机偏移量
 */
public class ExpireTimeJitterSolution {
    
    /**
     * 设置缓存（带随机过期时间）
     */
    public void setWithJitter(String key, Object value, long baseExpireSeconds) {
        // 基础过期时间 + 随机偏移量（0 ~ 30 分钟）
        long jitter = (long) (Math.random() * 1800);
        long actualExpire = baseExpireSeconds + jitter;
        
        redis.opsForValue().set(key, value, Duration.ofSeconds(actualExpire));
    }
    
    /**
     * 批量设置缓存（带随机过期时间）
     */
    public void batchSetWithJitter(Map<String, Object> data, long baseExpireSeconds) {
        Random random = new Random();
        
        for (Map.Entry<String, Object> entry : data.entrySet()) {
            long jitter = (long) (random.nextDouble() * 1800);
            long actualExpire = baseExpireSeconds + jitter;
            
            redis.opsForValue().set(entry.getKey(), entry.getValue(), 
                Duration.ofSeconds(actualExpire));
        }
    }
}
```

#### 方案二：多级缓存

```java
/**
 * 方案二：多级缓存（L1 + L2）
 * 
 * 思路：本地缓存 + Redis + 数据库
 * 本地缓存作为最后的防线
 */
public class MultiLevelCacheSolution {
    
    private Cache<String, Object> localCache;  // Caffeine / Guava Cache
    private RedisTemplate<String, Object> redis;
    
    /**
     * L1 本地缓存配置
     * 
     * 使用 Caffeine：
     * - 最大容量：10000
     * - 过期：访问后 1 分钟过期
     * - 线程安全
     */
    @Bean
    public Cache<String, Object> localCache() {
        return Caffeine.newBuilder()
            .maximumSize(10000)
            .expireAfterAccess(1, TimeUnit.MINUTES)
            .build();
    }
    
    /**
     * 三级查询
     */
    public User getUser(String userId) {
        String cacheKey = "user:" + userId;
        
        // 1. L1 本地缓存（无网络开销，μs 级）
        User cached = localCache.getIfPresent(cacheKey);
        if (cached != null) {
            return cached;
        }
        
        // 2. L2 Redis 缓存
        cached = (User) redis.opsForValue().get(cacheKey);
        if (cached != null) {
            // 回填 L1 缓存
            localCache.put(cacheKey, cached);
            return cached;
        }
        
        // 3. 数据库
        User user = database.findUserById(userId);
        
        if (user != null) {
            // 回填 L2 缓存
            redis.opsForValue().set(cacheKey, user, Duration.ofHours(1));
            // 回填 L1 缓存
            localCache.put(cacheKey, user);
        }
        
        return user;
    }
    
    /**
     * 更新时清理所有缓存
     */
    public void updateUser(User user) {
        String cacheKey = "user:" + user.getId();
        
        // 1. 更新数据库
        database.updateUser(user);
        
        // 2. 删除 L2 缓存
        redis.delete(cacheKey);
        
        // 3. 删除 L1 缓存
        localCache.invalidate(cacheKey);
    }
}
```

#### 方案三：Redis 高可用 + 熔断降级

```java
/**
 * 方案三：Redis 高可用 + 应用层熔断
 */
public class RedisHighAvailabilitySolution {
    
    private RedisTemplate<String, Object> redis;
    private CircuitBreaker circuitBreaker;
    
    /**
     * 查询（带熔断保护）
     */
    public User getUserWithCircuitBreaker(String userId) {
        String cacheKey = "user:" + userId;
        
        try {
            // 尝试从 Redis 获取
            User cached = (User) redis.opsForValue().get(cacheKey);
            if (cached != null) {
                return cached;
            }
            
            // 查数据库
            User user = database.findUserById(userId);
            
            // 回填缓存
            if (user != null) {
                redis.opsForValue().set(cacheKey, user, Duration.ofHours(1));
            }
            
            // 成功后重置熔断器
            circuitBreaker.recordSuccess();
            
            return user;
            
        } catch (Exception e) {
            // Redis 出错，降级到数据库
            circuitBreaker.recordFailure();
            
            // 熔断器打开时，直接查数据库
            if (circuitBreaker.isOpen()) {
                return database.findUserById(userId);
            }
            
            throw e;
        }
    }
    
    /**
     * 熔断器实现
     */
    public static class CircuitBreaker {
        
        private AtomicInteger failureCount = new AtomicInteger(0);
        private volatile long lastFailureTime = 0;
        private static final int THRESHOLD = 5;
        private static final long RECOVERY_TIMEOUT = 30_000; // 30 秒
        
        public void recordSuccess() {
            failureCount.set(0);
        }
        
        public void recordFailure() {
            failureCount.incrementAndGet();
            lastFailureTime = System.currentTimeMillis();
        }
        
        public boolean isOpen() {
            if (failureCount.get() >= THRESHOLD) {
                // 检查是否超过恢复时间
                if (System.currentTimeMillis() - lastFailureTime > RECOVERY_TIMEOUT) {
                    // 进入半开状态，允许一个请求试试
                    return false;
                }
                return true;
            }
            return false;
        }
    }
}
```

#### 方案四：接口限流

```java
/**
 * 方案四：接口限流
 */
public class RateLimitSolution {
    
    private RedisTemplate<String, String> redis;
    
    /**
     * 查询（带限流保护）
     */
    public User getUserWithRateLimit(String userId) {
        String cacheKey = "user:" + userId;
        String rateLimitKey = "ratelimit:user:" + userId;
        
        // 1. 限流检查
        if (!tryAcquire(rateLimitKey)) {
            // 限流触发，返回默认值或友好提示
            return getDefaultOrCached(userId);
        }
        
        // 2. 正常查询
        User cached = (User) redis.opsForValue().get(cacheKey);
        if (cached != null) {
            return cached;
        }
        
        User user = database.findUserById(userId);
        
        if (user != null) {
            redis.opsForValue().set(cacheKey, user, Duration.ofHours(1));
        }
        
        return user;
    }
    
    /**
     * 滑动窗口限流
     */
    private boolean tryAcquire(String key) {
        long now = System.currentTimeMillis();
        long windowStart = now - 60_000; // 1 分钟窗口
        
        // 使用 Lua 脚本保证原子性
        String luaScript = """
            redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
            redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
            redis.call('EXPIRE', KEYS[1], 120)
            return redis.call('ZCARD', KEYS[1])
            """;
        
        Long count = redis.execute(
            new DefaultRedisScript<>(luaScript, Long.class),
            Collections.singletonList(key),
            String.valueOf(windowStart),
            String.valueOf(now),
            UUID.randomUUID().toString()
        );
        
        return count != null && count <= 100; // 每分钟最多 100 次
    }
}
```

---

## 五、综合解决方案

### 5.1 完整的缓存防护体系

```java
/**
 * 完整的缓存防护方案
 */
public class CacheProtectionSystem {
    
    private RedisTemplate<String, Object> redis;
    private BloomFilter<String> bloomFilter;
    private Cache<String, Object> localCache;
    
    /**
     * 获取数据（综合防护）
     */
    public <T> T get(String key, Class<T> clazz, DataLoader<T> loader) {
        // 1. L1 本地缓存（防雪崩第一道防线）
        T localCached = localCache.getIfPresent(key);
        if (localCached != null) {
            return localCached;
        }
        
        // 2. L2 Redis 缓存
        try {
            T cached = (T) redis.opsForValue().get(key);
            if (cached != null) {
                // 回填 L1
                localCache.put(key, cached);
                return cached;
            }
        } catch (Exception e) {
            // Redis 异常，降级
            return loadAndCache(key, loader);
        }
        
        // 3. 布隆过滤器检查（防穿透）
        if (bloomFilter != null && !bloomFilter.mightContain(key)) {
            // 一定不存在，直接返回空
            return null;
        }
        
        // 4. 数据库加载（带互斥锁，防击穿）
        return loadWithLock(key, loader);
    }
    
    /**
     * 带锁的数据加载
     */
    private <T> T loadWithLock(String key, DataLoader<T> loader) {
        String lockKey = "lock:" + key;
        RLock lock = redisson.getLock(lockKey);
        
        try {
            if (lock.tryLock(3, 10, TimeUnit.SECONDS)) {
                try {
                    // 双重检查
                    T cached = (T) redis.opsForValue().get(key);
                    if (cached != null) {
                        return cached;
                    }
                    
                    // 加载数据
                    T data = loader.load();
                    
                    // 回填缓存
                    if (data != null) {
                        redis.opsForValue().set(key, data, 
                            Duration.ofSeconds(randomExpire(3600)));
                        localCache.put(key, data);
                    }
                    
                    return data;
                } finally {
                    lock.unlock();
                }
            } else {
                // 等待后重试
                Thread.sleep(50);
                return get(key, null, loader);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return loader.load();
        }
    }
    
    /**
     * 生成随机过期时间
     */
    private long randomExpire(long baseSeconds) {
        return baseSeconds + (long) (Math.random() * 1800);
    }
    
    /**
     * 数据加载器接口
     */
    @FunctionalInterface
    public interface DataLoader<T> {
        T load();
    }
}
```

---

## 六、面试总结

| 问题 | 原因 | 解决方案 |
|-----|------|---------|
| 穿透 | 数据不存在 | 缓存空值 / 布隆过滤器 |
| 击穿 | 热点 key 过期 | 互斥锁 / 逻辑过期 / 提前重建 |
| 雪崩 | 大量 key 同时过期 | 过期随机化 / 多级缓存 / 高可用 / 限流 |

```
┌─────────────────────────────────────────────────────────┐
│                  缓存防护最佳实践                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  预防措施                                              │
│  ├── 过期时间随机化                                    │
│  ├── 热点数据永不过期                                  │
│  └── Redis 高可用部署                                  │
│                                                         │
│  兜底措施                                              │
│  ├── 多级缓存（L1 本地 + L2 Redis）                   │
│  ├── 熔断降级                                         │
│  └── 接口限流                                         │
│                                                         │
│  根治措施                                              │
│  ├── 布隆过滤器防穿透                                 │
│  ├── 互斥锁防击穿                                     │
│  └── 监控告警                                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

> "缓存三剑客不是孤立的三个问题，而是一个系统的防护体系。最好的方案是预防 + 兜底的组合拳。"
