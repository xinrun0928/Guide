# 分布式锁 + 缓存实现的并发控制

你的系统在「一元秒杀」活动中，被人薅秃了。

100 份商品，被同一个人用脚本抢走了 80 份。

问题在哪？

**没有并发控制。**

分布式锁 + 缓存，是解决并发控制问题的黄金组合。

---

## 为什么需要分布式锁？

单机环境下，JVM 内置锁（synchronized、ReentrantLock）就够用了。

但分布式系统有多个节点，每个节点有自己的 JVM 内置锁，它们互不相干。

```
节点 A：synchronized (productLock) { 扣库存 }
节点 B：synchronized (productLock) { 扣库存 }

这两个锁是独立的！
A 和 B 可能同时进入临界区，导致超卖。
```

### 分布式锁要解决的问题

| 问题 | 描述 |
|------|------|
| **互斥** | 同一时刻只有一个节点能获取锁 |
| **防死锁** | 节点挂了，锁要能自动释放 |
| **可重入** | 同一节点可以多次获取同一把锁 |
| **公平性** | 锁的获取按先来后到（可选） |

---

## Redis 实现分布式锁

### 最简单的实现：SET NX EX

```java
public class SimpleRedisLock {
    
    private static final String LOCK_PREFIX = "lock:";
    
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    
    public boolean tryLock(String key, long expireSeconds) {
        String lockKey = LOCK_PREFIX + key;
        String lockValue = UUID.randomUUID().toString();
        
        // SET key value NX EX seconds
        // NX: 不存在才设置
        // EX: 设置过期时间
        Boolean success = redisTemplate.opsForValue()
            .setIfAbsent(lockKey, lockValue, expireSeconds, TimeUnit.SECONDS);
        
        return Boolean.TRUE.equals(success);
    }
    
    public void unlock(String key) {
        String lockKey = LOCK_PREFIX + key;
        redisTemplate.delete(lockKey);
    }
}
```

**问题**：这个实现有严重缺陷——**释放了他人的锁**。

如果线程 A 获取锁后因为 GC 或网络延迟导致超时，锁自动释放了。线程 B 获取了这把锁，线程 A 执行完后 unlock，把线程 B 的锁删了。

### 正确实现：Lua 脚本释放锁

```java
public class RedisLock {
    
    private static final String LOCK_PREFIX = "lock:";
    
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    
    public boolean tryLock(String key, String value, long expireSeconds) {
        String lockKey = LOCK_PREFIX + key;
        
        // SET key value NX EX seconds
        Boolean success = redisTemplate.opsForValue()
            .setIfAbsent(lockKey, value, expireSeconds, TimeUnit.SECONDS);
        
        return Boolean.TRUE.equals(success);
    }
    
    public void unlock(String key, String value) {
        String lockKey = LOCK_PREFIX + key;
        
        // Lua 脚本：只删除自己持有的锁
        String luaScript = 
            "if redis.call('get', KEYS[1]) == ARGV[1] then " +
            "   return redis.call('del', KEYS[1]) " +
            "else " +
            "   return 0 " +
            "end";
        
        redisTemplate.execute(
            new DefaultRedisScript&lt;&gt;(luaScript, Long.class),
            Collections.singletonList(lockKey),
            value
        );
    }
}
```

---

## 分布式锁 + 缓存实现库存扣减

### 场景分析

```
秒杀场景：
1. 100 份商品
2. 10000 人抢购
3. 必须保证不超卖
4. 性能要足够高
```

### 实现一：Redis 分布式锁（悲观的方案）

```java
@Service
public class PessimisticStockService {
    
    private final RedisLock redisLock;
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    private final StockDao stockDao;
    
    // 锁自动过期时间（比业务执行时间略长）
    private static final long LOCK_EXPIRE_SECONDS = 10;
    
    public boolean deductStock(Long productId, Long userId) {
        String lockKey = "stock:lock:" + productId;
        String lockValue = UUID.randomUUID().toString();
        
        // 1. 获取分布式锁
        if (!redisLock.tryLock(lockKey, lockValue, LOCK_EXPIRE_SECONDS)) {
            return false;  // 获取锁失败
        }
        
        try {
            // 2. 查询库存
            Integer stock = (Integer) redisTemplate.opsForValue()
                .get("stock:" + productId);
            
            if (stock == null || stock &lt;= 0) {
                return false;  // 无库存
            }
            
            // 3. 扣减库存
            redisTemplate.opsForValue()
                .decrement("stock:" + productId);
            
            // 4. 记录用户购买（Redis Set）
            redisTemplate.opsForSet()
                .add("purchased:product:" + productId, userId.toString());
            
            // 5. 异步写入数据库
            CompletableFuture.runAsync(() -&gt; {
                stockDao.decrementStock(productId);
                orderDao.insert(new Order(productId, userId));
            });
            
            return true;
            
        } finally {
            // 6. 释放锁
            redisLock.unlock(lockKey, lockValue);
        }
    }
}
```

**问题**：悲观锁会串行化请求，高并发下性能差。

### 实现二：Redis 原子操作（乐观的方案）

不用锁，直接用 Redis 的原子操作来扣减：

```java
@Service
public class OptimisticStockService {
    
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    private final StockDao stockDao;
    
    public boolean deductStock(Long productId, Long userId) {
        String stockKey = "stock:" + productId;
        String purchasedKey = "purchased:product:" + productId;
        
        // 1. 检查用户是否已购买（防重复）
        Boolean isMember = redisTemplate.opsForSet()
            .isMember(purchasedKey, userId.toString());
        if (Boolean.TRUE.equals(isMember)) {
            return false;  // 已经买过了
        }
        
        // 2. 原子扣减库存
        Long remainStock = redisTemplate.opsForValue()
            .decrement(stockKey);
        
        if (remainStock == null || remainStock &lt; 0) {
            // 库存不足，回补（加回去）
            if (remainStock != null) {
                redisTemplate.opsForValue().increment(stockKey);
            }
            return false;
        }
        
        // 3. 记录用户购买
        redisTemplate.opsForSet().add(purchasedKey, userId.toString());
        
        // 4. 异步写入数据库
        CompletableFuture.runAsync(() -&gt; {
            try {
                stockDao.decrementStock(productId);
                orderDao.insert(new Order(productId, userId));
            } catch (Exception e) {
                // 数据库写入失败，回滚 Redis
                redisTemplate.opsForValue().increment(stockKey);
                redisTemplate.opsForSet().remove(purchasedKey, userId.toString());
                log.error("数据库写入失败，已回滚", e);
            }
        });
        
        return true;
    }
}
```

### 实现三：Redis Lua 脚本（最推荐的方案）

将扣减逻辑写成 Lua 脚本，Redis 保证原子性：

```java
@Service
public class LuaStockService {
    
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    
    // Lua 脚本：库存扣减
    private static final String DEDUCT_STOCK_SCRIPT = 
        "-- KEYS[1] = stock key\n" +
        "-- KEYS[2] = purchased key\n" +
        "-- ARGV[1] = userId\n" +
        "-- ARGV[2] = 扣减数量\n" +
        "\n" +
        "-- 1. 检查是否已购买\n" +
        "if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then\n" +
        "   return -1  -- 已购买\n" +
        "end\n" +
        "\n" +
        "-- 2. 检查库存\n" +
        "local stock = tonumber(redis.call('GET', KEYS[1]) or '0')\n" +
        "local deduct = tonumber(ARGV[2])\n" +
        "if stock &lt; deduct then\n" +
        "   return -2  -- 库存不足\n" +
        "end\n" +
        "\n" +
        "-- 3. 扣减库存\n" +
        "redis.call('DECRBY', KEYS[1], deduct)\n" +
        "\n" +
        "-- 4. 标记已购买\n" +
        "redis.call('SADD', KEYS[2], ARGV[1])\n" +
        "\n" +
        "return stock - deduct  -- 返回剩余库存";
    
    public Long deductStock(Long productId, Long userId, int count) {
        String stockKey = "stock:" + productId;
        String purchasedKey = "purchased:product:" + productId;
        
        DefaultRedisScript&lt;Long&gt; script = new DefaultRedisScript&lt;&gt;();
        script.setScriptText(DEDUCT_STOCK_SCRIPT);
        script.setResultType(Long.class);
        
        Long result = redisTemplate.execute(
            script,
            Arrays.asList(stockKey, purchasedKey),
            userId.toString(),
            String.valueOf(count)
        );
        
        if (result == -1) {
            throw new BusinessException("您已购买过该商品");
        } else if (result == -2) {
            throw new BusinessException("库存不足");
        }
        
        return result;
    }
}
```

---

## 分布式锁的坑

### 坑一：锁自动过期，业务还没执行完

```
线程 A 获取锁（10 秒过期）
线程 A 开始执行（预计 15 秒）
5 秒后，锁自动释放
线程 B 获取了同一把锁
线程 A 执行完后释放了线程 B 的锁
线程 B 还没执行完，锁又没了...
```

**解决方案**：
- 合理设置过期时间
- 锁续期机制（看门狗）

```java
// Redisson 的看门狗机制
RLock lock = redissonClient.getLock("stock:lock:" + productId);
try {
    // 自动续期：每 10 秒续一次，30 秒不释放就停止续期
    lock.lock(30, TimeUnit.SECONDS);
    
    // 业务逻辑
    
} finally {
    lock.unlock();
}
```

### 坑二：Redis 主从切换导致锁丢失

```
线程 A 获取锁（写入主库）
主库宕机，从库晋升为主库（但没有那条锁记录）
线程 B 获取锁（成功了！）
线程 A 和线程 B 同时在临界区
```

**解决方案**：
- Redlock 算法（需要多个独立的 Redis 实例）
- 或者接受这个风险（CAP 定理）

### 坑三：锁的粒度太大

```
锁粒度太大（锁整个库存表）
↓
所有商品共用一把锁
↓
并发能力退化成单线程
```

**解决方案**：按商品 ID 分段锁

```java
// 分段锁：100 份商品分成 10 段，每段 10 份
public boolean deductStock(Long productId, Long userId) {
    int segmentCount = 10;
    int stockPerSegment = 10;
    
    for (int i = 0; i &lt; segmentCount; i++) {
        String lockKey = "stock:lock:" + productId + ":" + i;
        if (tryLock(lockKey)) {
            try {
                Integer stock = getStock(lockKey);
                if (stock &gt; 0) {
                    decrementStock(lockKey);
                    recordPurchase(productId, userId);
                    return true;
                }
            } finally {
                unlock(lockKey);
            }
        }
    }
    return false;
}
```

---

## Redisson 实现分布式锁

Redisson 是 Java 中最成熟的分布式锁实现：

```java
@Service
public class RedissonStockService {
    
    @Autowired
    private RedissonClient redissonClient;
    
    @Autowired
    private StockDao stockDao;
    
    public boolean deductStock(Long productId, Long userId) {
        String lockKey = "stock:lock:" + productId;
        RLock lock = redissonClient.getLock(lockKey);
        
        try {
            // 等待锁，最长 3 秒，自动释放 10 秒
            boolean locked = lock.tryLock(3, 10, TimeUnit.SECONDS);
            if (!locked) {
                return false;
            }
            
            // 业务逻辑
            Stock stock = stockDao.selectByProductId(productId);
            if (stock.getCount() &lt;= 0) {
                return false;
            }
            
            stockDao.decrementStock(productId);
            orderDao.insert(new Order(productId, userId));
            
            return true;
            
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        } finally {
            // 注意：自动续期的锁不能主动释放，否则会打断续期
            // 只有 tryLock 非等待模式才需要主动释放
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
}
```

### Redisson 的优势

| 特性 | 说明 |
|------|------|
| **自动续期** | 看门狗机制，防止业务执行超过锁过期时间 |
| **可重入** | 同一线程可多次获取同一把锁 |
| **公平锁** | 支持按获取顺序排队 |
| **读写锁** | 支持读读、读写、写写不同策略 |
| **信号量** | 支持限流 |

---

## 总结

分布式锁 + 缓存的并发控制方案：

| 方案 | 一致性 | 性能 | 复杂度 | 适用场景 |
|------|--------|------|--------|----------|
| Redis SET NX | 中 | 高 | 低 | 简单场景 |
| Lua 脚本 | 高 | 高 | 中 | 库存扣减 |
| Redisson | 高 | 高 | 中 | 通用场景 |
| Redlock | 最高 | 中 | 高 | 金融级场景 |

**最佳实践**：
- 库存扣减用 Lua 脚本（原子性最好）
- 通用场景用 Redisson（功能最全）
- 避免锁粒度过大
- 合理设置锁过期时间

---

## 留给你的问题

假设这样一个场景：你的系统需要实现一个**限时优惠**功能：

- 每天 10:00-12:00，商品 A 打 5 折
- 同一用户只能享受一次优惠价
- 商品 A 的库存是独立的（优惠库存和普通库存分开）
- 需要防止用户薅羊毛（用脚本抢购）

请思考：
1. 如何用 Redis 分布式锁 + 缓存实现这个功能？
2. 「同一用户只能享受一次优惠价」如何用 Redis 保证？
3. 如果 Redis 挂了，系统应该如何降级？（提示：可以用本地标记 + 数据库兜底）
4. 如何防止「超卖」问题？

提示：可以把用户 ID 和优惠资格做成一个 Redis Set，扣减库存前检查用户是否已经在集合中。
