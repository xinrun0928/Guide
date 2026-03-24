# 缓存与数据库双写一致性

用户修改了资料，缓存更新了，数据库却更新失败了。
用户再访问，拿到了旧数据。

或者反过来，数据库更新成功，缓存更新失败。
下次访问，缓存里还是旧数据。

这就是**双写一致性问题**。

## 什么是双写一致性？

双写一致性是指：**保证缓存和数据库的数据始终一致**。

```
双写流程：
┌─────────┐    ┌─────────┐    ┌─────────┐
│  应用   │───▶│  缓存   │───▶│  数据库  │
└─────────┘    └─────────┘    └─────────┘
   写入         更新           更新
```

问题在于：**缓存和数据库是两次操作，无法保证原子性**。

## 四种更新策略

### 策略一：Cache-Aside（旁路缓存）

**读流程**：
1. 先读缓存
2. 缓存未命中，读数据库
3. 写入缓存
4. 返回结果

**写流程**：
1. 先写数据库
2. 删除缓存（而非更新）

```java
/**
 * Cache-Aside 模式
 * 
 * 读：缓存优先，未命中查库并回填
 * 写：先写库，后删缓存
 */
public class CacheAsidePattern {
    
    private Jedis jedis;
    
    /**
     * 读取数据
     */
    public Product getProduct(String productId) {
        String cacheKey = "product:" + productId;
        
        // 1. 查缓存
        String cacheValue = jedis.get(cacheKey);
        if (cacheValue != null) {
            return JSON.parseObject(cacheValue, Product.class);
        }
        
        // 2. 查数据库
        Product product = db.findProduct(productId);
        
        // 3. 回填缓存
        if (product != null) {
            jedis.setex(cacheKey, 30 * 60, JSON.toJSONString(product));
        }
        
        return product;
    }
    
    /**
     * 更新数据（先写库，后删缓存）
     */
    public void updateProduct(Product product) {
        // 1. 更新数据库
        db.updateProduct(product);
        
        // 2. 删除缓存
        // 注意：是删除，不是更新！
        String cacheKey = "product:" + product.getId();
        jedis.del(cacheKey);
    }
    
    /**
     * 删除数据
     */
    public void deleteProduct(String productId) {
        // 1. 删除数据库
        db.deleteProduct(productId);
        
        // 2. 删除缓存
        String cacheKey = "product:" + productId;
        jedis.del(cacheKey);
    }
}
```

**为什么写的时候删除缓存而不是更新？**

因为如果更新缓存失败，会导致缓存和数据库不一致。而删除缓存失败，最坏情况是下次访问时拿到旧数据，再删除一次就好了。

### 策略二：Read-Through（读穿透）

**原理**：应用只和缓存交互，缓存负责从数据库加载数据。

```java
/**
 * Read-Through 模式
 */
public class ReadThroughPattern {
    
    private Cache&lt;String, Product&gt; cache;
    private ProductDao productDao;
    
    /**
     * 读取数据（缓存自动从数据库加载）
     */
    public Product getProduct(String productId) {
        String cacheKey = "product:" + productId;
        
        return cache.get(cacheKey, () -> {
            // 如果缓存未命中，这个函数会被调用
            // 负责从数据库加载数据
            return productDao.findById(productId);
        });
    }
    
    /**
     * 更新数据
     */
    public void updateProduct(Product product) {
        // 1. 更新数据库
        productDao.update(product);
        
        // 2. 删除缓存
        String cacheKey = "product:" + product.getId();
        cache.invalidate(cacheKey);
    }
}
```

### 策略三：Write-Through（写穿透）

**原理**：应用只和缓存交互，缓存负责写入数据库。

```java
/**
 * Write-Through 模式
 */
public class WriteThroughPattern {
    
    private Cache&lt;String, Product&gt; cache;
    private ProductDao productDao;
    
    /**
     * 更新数据（缓存自动写入数据库）
     */
    public void updateProduct(Product product) {
        String cacheKey = "product:" + product.getId();
        
        // 缓存自动同步写入数据库
        cache.put(cacheKey, product);
        
        // 实际上，缓存内部会：
        // 1. 更新缓存
        // 2. 同步更新数据库
        // 两步都是缓存负责
    }
}
```

### 策略四：Write-Behind（异步写回）

**原理**：只写缓存，异步批量写回数据库。

```java
/**
 * Write-Behind 模式
 */
public class WriteBehindPattern {
    
    private Cache&lt;String, Product&gt; cache;
    private ProductDao productDao;
    private BlockingQueue&lt;Product&gt; writeQueue;
    
    /**
     * 更新数据（只写缓存）
     */
    public void updateProduct(Product product) {
        String cacheKey = "product:" + product.getId();
        
        // 1. 只更新缓存
        cache.put(cacheKey, product);
        
        // 2. 放入异步写队列
        writeQueue.offer(product);
    }
    
    /**
     * 后台线程批量写回数据库
     */
    @PostConstruct
    public void startWriteBackThread() {
        Thread writeBackThread = new Thread(() -> {
            List&lt;Product&gt; batch = new ArrayList&lt;&gt;();
            while (true) {
                try {
                    // 收集一批数据
                    writeQueue.drainTo(batch, 100);
                    
                    if (!batch.isEmpty()) {
                        // 批量写入数据库
                        productDao.batchUpdate(batch);
                        batch.clear();
                    } else {
                        Thread.sleep(100);
                    }
                } catch (Exception e) {
                    log.error("异步写回失败", e);
                }
            }
        });
        writeBackThread.start();
    }
}
```

## 四种策略对比

| 策略 | 一致性 | 性能 | 复杂度 | 说明 |
|-----|-------|------|-------|------|
| Cache-Aside | 最终一致 | 高 | 低 | 最常用 |
| Read-Through | 最终一致 | 高 | 中 | 缓存负责加载 |
| Write-Through | 强一致 | 低 | 中 | 同步写库 |
| Write-Behind | 最终一致 | 最高 | 高 | 异步写库 |

## Cache-Aside 的边界情况

### 情况一：缓存有，数据库失败

```
1. 更新数据库 → 失败
2. 缓存未删除
3. 结果：缓存是新的，数据库是旧的

处理：捕获异常，不删除缓存
```

### 情况二：数据库成功，缓存删除失败

```
1. 更新数据库 → 成功
2. 删除缓存 → 失败
3. 结果：缓存是旧的，数据库是新的
4. 下次访问：缓存未命中，查库得到新数据
5. 但这期间，缓存一直返回旧数据

处理：删除失败时，延迟后再删除
```

```java
/**
 * 删除缓存失败时的处理
 */
public void deleteCacheWithRetry(String cacheKey) {
    try {
        jedis.del(cacheKey);
    } catch (Exception e) {
        // 异步延迟重试
        CompletableFuture.delayedExecutor(1, TimeUnit.SECONDS)
            .execute(() -> jedis.del(cacheKey));
    }
}
```

### 情况三：并发读写导致的不一致

```
线程 A（读）                 线程 B（写）
   │                           │
   │ 缓存未命中                  │
   │ 查数据库                   │
   │ ←──────────────            │
   │                           │
   │                           更新数据库
   │                           删除缓存
   │                           │
   │ 设置缓存（旧数据）─────────┤
   │                           │
   结果：数据库是新数据，缓存是旧数据！
```

**解决方案**：延迟双删

```java
/**
 * 延迟双删
 */
public void updateProduct(Product product) {
    // 1. 删除缓存
    jedis.del(cacheKey);
    
    // 2. 更新数据库
    db.updateProduct(product);
    
    // 3. 延迟一段时间后再删除缓存
    // 等待线程 A 完成设置缓存的操作
    try {
        Thread.sleep(500);
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
    jedis.del(cacheKey);
}
```

## 分布式环境的一致性

### 分布式锁方案

```java
/**
 * 分布式锁保证一致性
 */
public void updateProductWithLock(Product product) {
    String lockKey = "lock:product:" + product.getId();
    String cacheKey = "product:" + product.getId();
    
    // 获取分布式锁
    String lockValue = jedis.set(lockKey, "1", SetParams.setNX().ex(10));
    
    if ("OK".equals(lockValue)) {
        try {
            // 更新数据库
            db.updateProduct(product);
            
            // 删除缓存
            jedis.del(cacheKey);
        } finally {
            jedis.del(lockKey);
        }
    } else {
        // 未获取到锁，重试或抛异常
        throw new ServiceBusyException("系统繁忙，请稍后重试");
    }
}
```

### Binlog 异步更新方案

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│   应用   │───▶│  数据库  │───▶│ Binlog  │───▶│ Canal   │
└─────────┘    └─────────┘    └─────────┘    └─────────┘
                                                          │
                                                          ▼
                                                    ┌─────────┐
                                                    │  更新   │
                                                    │  缓存   │
                                                    └─────────┘
```

Canal 监听数据库的 Binlog，异步更新缓存。

## 实际代码实现

### 通用缓存工具类

```java
/**
 * 缓存工具类（Cache-Aside 实现）
 */
public class CacheTemplate {
    
    private Jedis jedis;
    
    /**
     * 获取数据
     */
    public &lt;T&gt; T get(String key, Class&lt;T&gt; clazz, Supplier&lt;T&gt; dbLoader) {
        return get(key, clazz, dbLoader, 30 * 60);
    }
    
    public &lt;T&gt; T get(String key, Class&lt;T&gt; clazz, Supplier&lt;T&gt; dbLoader, int expireSeconds) {
        // 1. 查缓存
        String cacheValue = jedis.get(key);
        if (cacheValue != null) {
            return JSON.parseObject(cacheValue, clazz);
        }
        
        // 2. 查数据库
        T data = dbLoader.get();
        
        // 3. 回填缓存
        if (data != null) {
            jedis.setex(key, expireSeconds, JSON.toJSONString(data));
        }
        
        return data;
    }
    
    /**
     * 更新数据
     */
    public void update(String key, Runnable dbUpdater) {
        // 1. 更新数据库
        dbUpdater.run();
        
        // 2. 删除缓存
        jedis.del(key);
    }
    
    /**
     * 延迟双删更新
     */
    public void updateWithDelay(String key, Runnable dbUpdater, long delayMillis) {
        // 1. 先删除缓存
        jedis.del(key);
        
        // 2. 更新数据库
        dbUpdater.run();
        
        // 3. 延迟后再删除缓存
        CompletableFuture.runAsync(() -> {
            try {
                Thread.sleep(delayMillis);
                jedis.del(key);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
    }
}
```

### 使用示例

```java
/**
 * 商品服务
 */
public class ProductService {
    
    private CacheTemplate cacheTemplate;
    
    /**
     * 获取商品
     */
    public Product getProduct(String productId) {
        String cacheKey = "product:" + productId;
        return cacheTemplate.get(cacheKey, Product.class, 
            () -> db.findProduct(productId));
    }
    
    /**
     * 更新商品
     */
    public void updateProduct(Product product) {
        String cacheKey = "product:" + product.getId();
        cacheTemplate.updateWithDelay(cacheKey, () -> {
            db.updateProduct(product);
        }, 500);
    }
}
```

## 总结

缓存一致性是一个复杂问题：

| 策略 | 适用场景 |
|-----|---------|
| Cache-Aside | 大多数业务场景 |
| Read-Through | 读多写少 |
| Write-Through | 写多读少 |
| Write-Behind | 高并发写入 |

**最佳实践**：
- 读场景：Cache-Aside
- 写场景：先更新数据库，后删除缓存
- 高并发：延迟双删
- 强一致：分布式锁

## 留给你的问题

Write-Behind 模式性能最高，但也最复杂。

**Write-Behind 模式下，如果系统突然宕机，缓存中的数据还没来得及写回数据库，会发生什么？如何保证不丢数据？**
