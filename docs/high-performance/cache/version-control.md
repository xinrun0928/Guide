# 缓存版本控制与乐观锁

你更新了缓存数据，但与此同时，另一个线程也在更新。

没有加锁，没有排队。

结果就是：**后更新的覆盖了先更新的，数据丢了**。

如何解决这个问题？

**缓存版本控制与乐观锁**。

---

## 为什么需要版本控制？

缓存的典型问题是**并发更新冲突**。

```
时刻 T1：线程 A 读取缓存，version = 1, value = "张三"
时刻 T2：线程 B 读取缓存，version = 1, value = "张三"
时刻 T3：线程 A 更新缓存，version = 2, value = "李四"
时刻 T4：线程 B 更新缓存，version = 2, value = "王五"
                          ↑
                      B 的更新覆盖了 A 的更新
                      "李四" 被 "王五" 覆盖，数据丢失
```

这个问题在单机多线程下可以用 synchronized 解决，但在分布式环境下，synchronized 无能为力。

---

## 方案一：缓存版本号

### 核心思想

每次更新缓存时，携带一个**版本号**。如果版本号不匹配，则更新失败。

```
读取：GET key → {value: "张三", version: 1}
更新：SET key {value: "李四", version: 2} WHERE version = 1
      ├── 版本匹配 → 更新成功，返回 version = 2
      └── 版本不匹配 → 更新失败，返回错误
```

### 实现：Redis Hash 存储版本

```java
public class VersionedCacheService {
    
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    
    // 读取数据（带版本）
    public CacheEntry&lt;User&gt; getUser(Long userId) {
        String key = "user:" + userId;
        Map&lt;Object, Object&gt; map = redisTemplate.opsForHash().entries(key);
        
        if (map.isEmpty()) {
            return null;
        }
        
        Long version = ((Number) map.get("version")).longValue();
        User user = (User) map.get("data");
        
        return new CacheEntry&lt;&gt;(user, version);
    }
    
    // 更新数据（CAS 乐观锁）
    public boolean updateUser(Long userId, User newUser) {
        String key = "user:" + userId;
        
        // 1. 获取当前版本
        Long currentVersion = (Long) redisTemplate.opsForHash().get(key, "version");
        
        // 2. 更新（只有版本匹配才更新）
        Long newVersion = currentVersion + 1;
        
        Map&lt;String, Object&gt; newData = new HashMap&lt;&gt;();
        newData.put("version", newVersion);
        newData.put("data", newUser);
        newData.put("updateTime", System.currentTimeMillis());
        
        // 3. 使用 Lua 脚本保证原子性
        String luaScript = 
            "local current = redis.call('HGET', KEYS[1], 'version') " +
            "if current == false then " +
            "   return -1 " +  -- key 不存在
            "elseif tostring(current) == ARGV[1] then " +
            "   redis.call('HSET', KEYS[1], 'version', ARGV[2]) " +
            "   redis.call('HSET', KEYS[1], 'data', ARGV[3]) " +
            "   redis.call('HSET', KEYS[1], 'updateTime', ARGV[4]) " +
            "   return 1 " +  -- 更新成功
            "else " +
            "   return 0 " +  -- 版本冲突
            "end";
        
        DefaultRedisScript&lt;Long&gt; script = new DefaultRedisScript&lt;&gt;();
        script.setScriptText(luaScript);
        script.setResultType(Long.class);
        
        Long result = redisTemplate.execute(
            script,
            Collections.singletonList(key),
            String.valueOf(currentVersion),
            String.valueOf(newVersion),
            serialize(newUser),
            String.valueOf(System.currentTimeMillis())
        );
        
        return result == 1;
    }
    
    @Data
    public static class CacheEntry&lt;T&gt; {
        private T data;
        private Long version;
        
        public CacheEntry(T data, Long version) {
            this.data = data;
            this.version = version;
        }
    }
}
```

### Java 业务层调用

```java
public void updateUserName(Long userId, String newName) {
    int retryTimes = 3;
    
    for (int i = 0; i &lt; retryTimes; i++) {
        // 1. 读取当前数据
        CacheEntry&lt;User&gt; entry = versionedCache.getUser(userId);
        if (entry == null) {
            throw new BusinessException("用户不存在");
        }
        
        // 2. 构造新数据
        User newUser = entry.getData();
        newUser.setName(newName);
        
        // 3. CAS 更新
        boolean success = versionedCache.updateUser(userId, newUser);
        
        if (success) {
            return;
        }
        
        // 4. 更新失败，重试
        log.warn("版本冲突，更新用户 {} 失败，第 {} 次重试", userId, i + 1);
        
        // 短暂等待后重试
        try {
            Thread.sleep(50);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
    
    throw new BusinessException("更新失败，请稍后重试");
}
```

---

## 方案二：Redis WATCH + MULTI（事务）

Redis 提供了 `WATCH` 命令来实现乐观锁：

```
WATCH key          # 监视 key
GET key            # 读取
MULTI              # 开启事务
SET key new_value  # 写入命令（进入队列）
EXEC               # 执行事务
                   # ├── key 未被修改 → 事务成功
                   # └── key 被修改了 → 事务失败，返回 null
```

### 代码实现

```java
public class WatchCacheService {
    
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    
    public boolean updateUserWithWatch(Long userId, User newUser) {
        String key = "user:" + userId;
        
        // 开启监视
        redisTemplate.watch(key);
        
        try {
            // 读取当前数据
            User currentUser = (User) redisTemplate.opsForValue().get(key);
            if (currentUser == null) {
                return false;
            }
            
            // 开启事务
            redisTemplate.setEnableTransactionSupport(true);
            redisTemplate.multi();
            
            // 写入更新
            redisTemplate.opsForValue().set(key, newUser);
            
            // 执行事务
            List&lt;Object&gt; results = redisTemplate.exec();
            
            // results 为空表示事务失败（被其他客户端修改）
            return results != null &amp;&amp; !results.isEmpty();
            
        } finally {
            // 取消监视
            redisTemplate.unwatch();
        }
    }
}
```

### WATCH 的注意事项

⚠️ **WATCH 只保证单 key 的 CAS**，如果要保证多 key 的原子性，需要用 Lua 脚本。

```java
// 多 key 场景，用 Lua 脚本更可靠
String luaScript = 
    "local current = redis.call('GET', KEYS[1]) " +
    "if current == ARGV[1] then " +
    "   redis.call('SET', KEYS[1], ARGV[2]) " +
    "   return 1 " +
    "else " +
    "   return 0 " +
    "end";
```

---

## 方案三：数据库乐观锁

如果缓存数据最终要持久化到数据库，可以在**数据库层**实现乐观锁。

### 实现：版本字段

```sql
CREATE TABLE product (
    id BIGINT PRIMARY KEY,
    name VARCHAR(100),
    price DECIMAL(10, 2),
    version INT DEFAULT 0,  -- 版本号
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### Java 代码

```java
public class OptimisticLockProductService {
    
    private final ProductDao productDao;
    
    // 更新商品（乐观锁）
    public boolean updateProductPrice(Long productId, BigDecimal newPrice) {
        // 1. 获取当前版本
        Product product = productDao.selectById(productId);
        int currentVersion = product.getVersion();
        
        // 2. 执行更新（WHERE version = 当前版本）
        // UPDATE product SET price = ?, version = version + 1 WHERE id = ? AND version = ?
        int affectedRows = productDao.updatePriceWithVersion(
            productId, 
            newPrice, 
            currentVersion
        );
        
        // affectedRows = 0 表示版本冲突
        return affectedRows &gt; 0;
    }
    
    // 重试机制
    public void updateProductPriceWithRetry(Long productId, BigDecimal newPrice) {
        int maxRetries = 3;
        
        for (int i = 0; i &lt; maxRetries; i++) {
            Product product = productDao.selectById(productId);
            int currentVersion = product.getVersion();
            
            int affectedRows = productDao.updatePriceWithVersion(
                productId, 
                newPrice, 
                currentVersion
            );
            
            if (affectedRows &gt; 0) {
                // 更新缓存
                updateCache(productId, product.getName(), newPrice);
                return;
            }
            
            log.warn("乐观锁冲突，商品 {} 更新失败，第 {} 次重试", productId, i + 1);
        }
        
        throw new BusinessException("更新失败，请稍后重试");
    }
}
```

### DAO 层

```java
@Mapper
public interface ProductDao {
    
    // 乐观锁更新
    @Update("UPDATE product " +
            "SET price = #{price}, version = version + 1 " +
            "WHERE id = #{id} AND version = #{version}")
    int updatePriceWithVersion(@Param("id") Long id, 
                               @Param("price") BigDecimal price, 
                               @Param("version") int version);
}
```

---

## 方案四：缓存 + 数据库双版本

对于一致性要求高的场景，可以同时维护**缓存版本**和**数据库版本**。

```java
public class DualVersionCacheService {
    
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    private final ProductDao productDao;
    
    // 缓存 key 结构：product:{id}:data, product:{id}:version
    public void updateProduct(Long productId, Product newProduct) {
        // 1. 更新数据库
        boolean dbUpdated = updateDbWithVersion(productId, newProduct);
        if (!dbUpdated) {
            throw new BusinessException("数据库版本冲突");
        }
        
        // 2. 更新缓存（使用数据库返回的新版本）
        String dataKey = "product:" + productId + ":data";
        String versionKey = "product:" + productId + ":version";
        
        redisTemplate.opsForValue().set(dataKey, newProduct);
        redisTemplate.opsForValue().increment(versionKey);
    }
    
    public Product getProduct(Long productId) {
        String dataKey = "product:" + productId + ":data";
        String versionKey = "product:" + productId + ":version";
        
        // 1. 先查缓存
        Product cached = (Product) redisTemplate.opsForValue().get(dataKey);
        Long cacheVersion = (Long) redisTemplate.opsForValue().get(versionKey);
        
        if (cached != null &amp;&amp; cacheVersion != null) {
            // 2. 验证缓存版本
            Product dbProduct = productDao.selectById(productId);
            
            if (dbProduct.getVersion().equals(cacheVersion)) {
                return cached;
            }
            
            // 版本不一致，更新缓存
            redisTemplate.opsForValue().set(dataKey, dbProduct);
            redisTemplate.opsForValue().set(versionKey, (long) dbProduct.getVersion());
            
            return dbProduct;
        }
        
        // 3. 缓存不存在，从数据库加载
        Product product = productDao.selectById(productId);
        if (product != null) {
            redisTemplate.opsForValue().set(dataKey, product);
            redisTemplate.opsForValue().set(versionKey, (long) product.getVersion());
        }
        
        return product;
    }
}
```

---

## 四种方案对比

| 方案 | 一致性 | 性能 | 复杂度 | 适用场景 |
|------|--------|------|--------|----------|
| 缓存版本号 | 高 | 中 | 中 | 纯缓存更新 |
| Redis WATCH | 高 | 中 | 低 | 单 key CAS |
| 数据库乐观锁 | 最高 | 中 | 中 | 数据最终要落库 |
| 双版本控制 | 最高 | 中 | 高 | 强一致性要求 |

---

## 实战：如何选择？

### 选择建议

| 场景 | 推荐方案 |
|------|----------|
| 纯缓存，无数据库 | 缓存版本号 + Lua |
| 缓存 + 数据库，最终一致 | 数据库乐观锁 + 缓存失效 |
| 高并发 + 强一致 | 双版本控制 |
| 简单计数、限流 | Redis INCR |

### 实战代码模板

```java
public class OptimisticUpdateTemplate {
    
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    
    // 通用乐观更新方法
    public &lt;T&gt; boolean updateWithCas(String key, 
                                    Function&lt;Optional&lt;T&gt;, T&gt; updater,
                                    Class&lt;T&gt; clazz,
                                    int maxRetries) {
        String luaScript = 
            "local current = redis.call('GET', KEYS[1]) " +
            "if current == false then " +
            "   return 0 " +  // key 不存在
            "elseif current == ARGV[1] then " +
            "   redis.call('SET', KEYS[1], ARGV[2]) " +
            "   return 1 " +  // 成功
            "else " +
            "   return 2 " +  // 值被修改
            "end";
        
        for (int i = 0; i &lt; maxRetries; i++) {
            T current = (T) redisTemplate.opsForValue().get(key);
            T updated = updater.apply(Optional.ofNullable(current));
            
            if (updated == null) {
                return false;
            }
            
            // CAS 更新
            DefaultRedisScript&lt;Long&gt; script = new DefaultRedisScript&lt;&gt;();
            script.setScriptText(luaScript);
            script.setResultType(Long.class);
            
            Long result = redisTemplate.execute(
                script,
                Collections.singletonList(key),
                serialize(current),
                serialize(updated)
            );
            
            if (result == 1) {
                return true;
            }
            
            // 短暂等待后重试
            try {
                Thread.sleep(10 * (i + 1));  // 指数退避
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        
        return false;
    }
}
```

---

## 总结

缓存并发控制的四种方案：

| 方案 | 核心思想 | 适用场景 |
|------|----------|----------|
| 缓存版本号 | CAS 更新，版本不匹配则失败 | 纯缓存场景 |
| Redis WATCH | 监视 key，事务执行 | 单 key 简单场景 |
| 数据库乐观锁 | 版本字段 + 重试 | 缓存 + 数据库 |
| 双版本控制 | 缓存版本 + 数据库版本 | 强一致性要求 |

**最佳实践**：
- 大部分场景用**数据库乐观锁**，缓存作为读加速
- 高并发扣减用 **Lua 脚本原子操作**
- 需要重试的场景，做好**幂等性保护**

---

## 留给你的问题

假设这样一个场景：你的系统需要实现一个**分布式计数器**，用于统计接口调用次数。

需求：
- 每分钟统计一次调用次数
- 计数结果需要持久化到数据库
- 支持多节点并发计数
- 允许一定的误差（最终一致即可）

请思考：
1. 如何用 Redis 实现高性能的并发计数？
2. 如何保证计数结果最终一致性到数据库？
3. 如果 Redis 宕机，如何从数据库恢复计数？
4. 如何防止计数器被人恶意刷？

提示：可以用 Redis INCR 原子操作 + 定时批量同步到数据库。
