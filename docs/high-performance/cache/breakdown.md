# 缓存击穿：互斥锁、逻辑过期双检、永久不过期策略

你的系统平时稳如老狗，但每到整点秒杀就崩。

不是缓存雪崩（没有大面积失效），而是**热点数据过期**。

热门商品在秒杀开始的瞬间，缓存刚好过期了。10000 个请求同时发现缓存没了，都去查数据库，数据库直接被打爆。

这就是**缓存击穿**。

---

## 什么是缓存击穿？

缓存击穿是指：**热点数据在缓存中失效的瞬间，大量并发请求同时穿透到数据库**。

与缓存穿透的区别：
- **穿透**：数据本来就不存在
- **击穿**：数据存在，但缓存过期了

与缓存雪崩的区别：
- **雪崩**：大量缓存同时过期
- **击穿**：单个热点数据过期

### 击穿的典型场景

| 场景 | 原因 | 后果 |
|------|------|------|
| 热点 key 过期 | 热门商品缓存 TTL 到了 | 瞬间大量请求打爆 DB |
| 逻辑过期未刷新 | 异步刷新线程挂了 | 数据长期不更新 + 击穿风险 |
| 系统重启 | 缓存未预热 | 冷启动时所有请求打 DB |

---

## 方案一：互斥锁（Mutex Lock）

### 核心思想

只有一个线程去查数据库，其他线程等待。

**核心代码逻辑**：
```
线程 A：获取锁 → 查数据库 → 写入缓存 → 释放锁
线程 B：获取锁失败 → 等待 → 重试 → 命中缓存
线程 C：获取锁失败 → 等待 → 重试 → 命中缓存
```

### 代码实现

#### Redis 实现互斥锁

```java
public class MutexLockCacheService {
    
    private static final String LOCK_KEY_PREFIX = "lock:";
    private static final String LOCK_VALUE = UUID.randomUUID().toString();
    private static final int LOCK_TIMEOUT_SECONDS = 10;
    private static final int RETRY_TIMES = 3;
    private static final int RETRY_DELAY_MS = 100;
    
    public Product getProduct(Long productId) {
        String cacheKey = "product:" + productId;
        String lockKey = LOCK_KEY_PREFIX + cacheKey;
        
        // 1. 先查缓存
        Product product = (Product) redisTemplate.opsForValue().get(cacheKey);
        if (product != null) {
            return product;
        }
        
        // 2. 缓存未命中，尝试获取互斥锁
        boolean lockAcquired = tryAcquireLock(lockKey);
        
        if (lockAcquired) {
            try {
                // 3. 获取锁成功，查数据库
                product = (Product) redisTemplate.opsForValue().get(cacheKey);
                if (product != null) {
                    return product;
                }
                
                // 4. 真的未命中，查数据库
                product = productDao.selectById(productId);
                if (product != null) {
                    // 5. 写入缓存
                    redisTemplate.opsForValue().set(cacheKey, product, 1, TimeUnit.HOURS);
                }
                
                return product;
            } finally {
                // 6. 释放锁
                releaseLock(lockKey);
            }
        } else {
            // 7. 获取锁失败，短暂等待后重试
            for (int i = 0; i &lt; RETRY_TIMES; i++) {
                try {
                    Thread.sleep(RETRY_DELAY_MS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                
                // 重试查缓存
                product = (Product) redisTemplate.opsForValue().get(cacheKey);
                if (product != null) {
                    return product;
                }
            }
            
            // 重试耗尽，直接查数据库（兜底）
            return productDao.selectById(productId);
        }
    }
    
    private boolean tryAcquireLock(String lockKey) {
        // SET key value NX EX 10
        // NX: 不存在才设置
        // EX 10: 10 秒过期
        Boolean success = redisTemplate.opsForValue()
            .setIfAbsent(lockKey, LOCK_VALUE, LOCK_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        return Boolean.TRUE.equals(success);
    }
    
    private void releaseLock(String lockKey) {
        // 释放锁：只删除自己持有的锁（用 Lua 脚本保证原子性）
        String luaScript = 
            "if redis.call('get', KEYS[1]) == ARGV[1] then " +
            "   return redis.call('del', KEYS[1]) " +
            "else " +
            "   return 0 " +
            "end";
        
        redisTemplate.execute(
            new DefaultRedisScript&lt;&gt;(luaScript, Long.class),
            Collections.singletonList(lockKey),
            LOCK_VALUE
        );
    }
}
```

### 互斥锁的优缺点

✅ **优点**：
- 数据一致性最好（只有一个线程查库）
- 实现简单，逻辑清晰

❌ **缺点**：
- 并发性能下降（其他线程在等待）
- 如果获取锁的线程挂了，锁需要等 10 秒才能释放
- 如果缓存写入慢，可能导致大量线程超时

---

## 方案二：逻辑过期（永远不过期）

### 核心思想

**缓存永远不过期，但数据有「逻辑过期时间」**。

当数据逻辑过期时，后台异步线程负责刷新缓存。请求到来时，即使数据过期了，也能立即返回旧数据，同时触发异步刷新。

```
数据对象结构：
{
    "data": {Product 对象},
    "logicalExpireTime": 2024-01-01 10:00:00  // 逻辑过期时间
}

请求流程：
数据逻辑过期？
    ├── 否 → 直接返回
    └── 是 → 返回旧数据 + 异步刷新（用互斥锁保证只有一个线程刷新）
```

### 代码实现

#### 定义逻辑过期对象

```java
@Data
public class LogicalExpireProduct {
    private Product data;
    private long logicalExpireTime;  // 逻辑过期时间戳（毫秒）
    
    public boolean isLogicalExpired() {
        return System.currentTimeMillis() &gt; logicalExpireTime;
    }
    
    public static LogicalExpireProduct wrap(Product product, long ttlMillis) {
        LogicalExpireProduct result = new LogicalExpireProduct();
        result.setData(product);
        result.setLogicalExpireTime(System.currentTimeMillis() + ttlMillis);
        return result;
    }
}
```

#### 逻辑过期 + 双检锁

```java
public class LogicalExpireCacheService {
    
    private static final String LOCK_KEY_PREFIX = "lock:";
    private static final long DEFAULT_TTL_MILLIS = 30 * 60 * 1000;  // 30 分钟
    
    public Product getProduct(Long productId) {
        String cacheKey = "product:" + productId;
        String lockKey = LOCK_KEY_PREFIX + cacheKey;
        
        // 1. 查询缓存
        LogicalExpireProduct cached = 
            (LogicalExpireProduct) redisTemplate.opsForValue().get(cacheKey);
        
        if (cached != null) {
            // 2. 检查逻辑过期
            if (!cached.isLogicalExpired()) {
                // 未过期，直接返回
                return cached.getData();
            } else {
                // 3. 已过期，尝试获取互斥锁
                if (tryAcquireLock(lockKey)) {
                    try {
                        // 双重检查：可能其他线程已经刷新了
                        LogicalExpireProduct recheck = 
                            (LogicalExpireProduct) redisTemplate.opsForValue().get(cacheKey);
                        if (recheck != null &amp;&amp; !recheck.isLogicalExpired()) {
                            return recheck.getData();
                        }
                        
                        // 刷新缓存（异步）
                        CompletableFuture.runAsync(() -&gt; refreshCache(cacheKey, productId));
                    } finally {
                        releaseLock(lockKey);
                    }
                }
                
                // 4. 未获取锁或已刷新，返回旧数据（不阻塞）
                return cached.getData();
            }
        }
        
        // 5. 缓存不存在，查询数据库
        Product product = productDao.selectById(productId);
        if (product != null) {
            // 写入缓存（带逻辑过期时间）
            LogicalExpireProduct toCache = LogicalExpireProduct.wrap(product, DEFAULT_TTL_MILLIS);
            redisTemplate.opsForValue().set(cacheKey, toCache);
        }
        
        return product;
    }
    
    private void refreshCache(String cacheKey, Long productId) {
        Product product = productDao.selectById(productId);
        if (product != null) {
            LogicalExpireProduct toCache = LogicalExpireProduct.wrap(product, DEFAULT_TTL_MILLIS);
            redisTemplate.opsForValue().set(cacheKey, toCache);
        }
    }
    
    private boolean tryAcquireLock(String lockKey) {
        Boolean success = redisTemplate.opsForValue()
            .setIfAbsent(lockKey, "1", 10, TimeUnit.SECONDS);
        return Boolean.TRUE.equals(success);
    }
    
    private void releaseLock(String lockKey) {
        redisTemplate.delete(lockKey);
    }
}
```

### 逻辑过期的优缺点

✅ **优点**：
- 永不击穿（数据永远可用）
- 性能最好（无阻塞等待）

❌ **缺点**：
- 返回的数据可能是过期的（业务是否能接受？）
- 实现复杂
- 后台刷新线程可能失败

---

## 方案三：永久不过期（不设置过期时间）

### 核心思想

对于热点数据，**干脆不设置过期时间**，依赖主动失效机制来更新缓存。

更新策略：
- 定时任务主动刷新即将过期的数据
- 数据变更时主动删除缓存

```java
public class NeverExpireCacheService {
    
    // 热点数据：永不过期
    private final Set&lt;String&gt; HOT_KEYS = ConcurrentHashMap.newKeySet();
    
    @PostConstruct
    public void init() {
        // 初始化热点 key 列表
        HOT_KEYS.addAll(hotKeyService.getHotProductIds()
            .stream()
            .map(id -&gt; "product:" + id)
            .collect(Collectors.toSet()));
    }
    
    public Product getProduct(Long productId) {
        String cacheKey = "product:" + productId;
        
        // 1. 查缓存
        Product product = (Product) redisTemplate.opsForValue().get(cacheKey);
        if (product != null) {
            return product;
        }
        
        // 2. 未命中，查数据库
        product = productDao.selectById(productId);
        if (product != null) {
            // 根据是否是热点数据决定 TTL
            if (HOT_KEYS.contains(cacheKey)) {
                // 热点数据：永不过期
                redisTemplate.opsForValue().set(cacheKey, product);
            } else {
                // 普通数据：正常过期
                redisTemplate.opsForValue().set(cacheKey, product, 1, TimeUnit.HOURS);
            }
        }
        
        return product;
    }
    
    // 主动失效：数据更新时调用
    public void invalidate(Long productId) {
        String cacheKey = "product:" + productId;
        redisTemplate.delete(cacheKey);
    }
    
    // 主动刷新：定时任务调用
    @Scheduled(fixedRate = 60000)  // 每分钟执行
    public void refreshHotKeys() {
        for (String cacheKey : HOT_KEYS) {
            // 异步刷新热点数据
            CompletableFuture.runAsync(() -&gt; {
                Long productId = extractId(cacheKey);
                Product product = productDao.selectById(productId);
                if (product != null) {
                    redisTemplate.opsForValue().set(cacheKey, product);
                }
            });
        }
    }
}
```

### 永久不过期的优缺点

✅ **优点**：
- 永远不会因为过期导致击穿
- 性能稳定

❌ **缺点**：
- 数据一致性最弱（依赖主动失效机制）
- 内存可能不足（大量数据永不过期）
- 需要额外的热点识别和主动刷新机制

---

## 三种方案对比

| 特性 | 互斥锁 | 逻辑过期 | 永久不过期 |
|------|--------|----------|------------|
| **一致性** | ✅ 最高 | ⚠️ 可能有脏数据 | ⚠️ 最低 |
| **性能** | ⚠️ 有等待 | ✅ 好 | ✅ 最好 |
| **实现复杂度** | 低 | 中 | 中 |
| **适用场景** | 数据一致性要求高 | 允许短暂脏读 | 热点数据保护 |
| **风险点** | 锁竞争激烈 | 返回脏数据 | 数据长期不更新 |

---

## 实战：混合策略

实际项目中，通常采用**分层保护策略**：

```java
public class HybridCacheService {
    
    // L1: 本地缓存（永不过期）
    private final Cache&lt;String, Product&gt; localCache;
    
    // L2: Redis 缓存
    public Product getProduct(Long productId) {
        String cacheKey = "product:" + productId;
        
        // ========== L1: 本地缓存 ==========
        Product product = localCache.getIfPresent(cacheKey);
        if (product != null) {
            return product;
        }
        
        // ========== L2: Redis 缓存（逻辑过期）==========
        LogicalExpireProduct redisCached = 
            (LogicalExpireProduct) redisTemplate.opsForValue().get(cacheKey);
        
        if (redisCached != null) {
            if (!redisCached.isLogicalExpired()) {
                // 未过期，回填 L1，返回
                localCache.put(cacheKey, redisCached.getData());
                return redisCached.getData();
            } else {
                // 已过期，异步刷新
                asyncRefreshCache(cacheKey, productId);
            }
        }
        
        // ========== L3: 数据库（兜底）==========
        product = productDao.selectById(productId);
        if (product != null) {
            // 写入 L2（逻辑过期）
            LogicalExpireProduct toCache = 
                LogicalExpireProduct.wrap(product, 30 * 60 * 1000);
            redisTemplate.opsForValue().set(cacheKey, toCache);
            
            // 写入 L1（永不过期）
            localCache.put(cacheKey, product);
        }
        
        return product;
    }
    
    private void asyncRefreshCache(String cacheKey, Long productId) {
        // 使用分布式锁，保证只有一个节点刷新
        String lockKey = "lock:" + cacheKey;
        if (tryAcquireLock(lockKey)) {
            try {
                Product product = productDao.selectById(productId);
                if (product != null) {
                    LogicalExpireProduct toCache = 
                        LogicalExpireProduct.wrap(product, 30 * 60 * 1000);
                    redisTemplate.opsForValue().set(cacheKey, toCache);
                    localCache.put(cacheKey, product);
                }
            } finally {
                releaseLock(lockKey);
            }
        }
    }
}
```

### 分层保护的威力

```
L1 本地缓存（Caffeine）：纳秒级访问，QPS 扛万级
L2 Redis 缓存（逻辑过期）：毫秒级访问，保护数据库
L3 数据库：兜底，保证数据最终一致性
```

---

## 总结

缓存击穿的三种经典解决方案：

| 方案 | 核心思想 | 一致性 | 性能 | 选择建议 |
|------|----------|--------|------|----------|
| 互斥锁 | 只有一人查库 | 最高 | 中等 | 数据一致性要求极高 |
| 逻辑过期 | 返回旧数据 + 异步刷新 | 中等 | 高 | 大部分场景首选 |
| 永久不过期 | 依赖主动刷新 | 低 | 最高 | 极热点数据 |

**最佳实践**：分层保护 + 逻辑过期 + 本地缓存兜底。

---

## 留给你的问题

假设这样一个场景：你的系统有三个角色——**普通用户、VIP 用户、管理员**。

他们对同一份商品数据的可见性不同：
- 普通用户：只能看到上架状态、价格等信息
- VIP 用户：额外看到折扣信息
- 管理员：能看到全部信息（包括成本、库存预警等）

请问：
1. 这种场景下，缓存击穿保护应该怎么做？
2. 三种角色的数据是同一个缓存 key 还是不同 key？为什么？
3. 如果管理员修改了商品成本，VIP 用户的折扣应该如何处理？
