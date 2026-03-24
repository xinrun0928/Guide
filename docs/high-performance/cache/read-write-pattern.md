# 缓存读写模式：Cache Aside、Read Through、Write Through、Write Behind

你的系统为什么时而正常、时而数据不一致？

缓存读写模式选错了，一切努力都白费。

今天，我们来彻底搞清楚四种经典的缓存读写模式：**Cache Aside、Read Through、Write Through、Write Behind**。

每种模式都有自己的适用场景，选错了，轻则数据不一致，重则系统崩溃。

---

## 先理解一个核心问题

在讨论模式之前，我们先问一个根本问题：**缓存和数据源，谁才是「主」？**

这个问题没有标准答案，但它决定了你要选择哪种读写模式。

| 视角 | 缓存的角色 | 数据源的角色 | 适用场景 |
|------|----------|-------------|----------|
| **Cache Aside** | 从属 | 主 | 大部分业务场景 |
| **Read/Write Through** | 代理 | 主 | 数据源单一 |
| **Write Behind** | 主 | 从 | 高写入性能 |

---

## Cache Aside：最常用的模式

### 核心思想

**Cache Aside（旁路缓存）** 是业界最常用的缓存模式。它的核心是：

- **读操作**：缓存命中则返回，未命中则查数据库并回填缓存
- **写操作**：先更新数据库，再删除缓存（注意是删除，不是更新）

```
读流程：
缓存命中 → 直接返回
缓存未命中 → 查询数据库 → 回填缓存 → 返回

写流程：
更新数据库 → 删除缓存（而非更新缓存）
```

### 为什么是「删除」而非「更新」？

这是一个经典的面试题。

**场景分析**：

```
时刻 T1：线程 A 需要更新用户 name 为 "张三"（原值 "李四"）

时刻 T2：线程 B 需要读取该用户信息

可能的执行顺序（最危险的场景）：
T1: 线程 A 更新数据库，name = "张三"
T2: 线程 B 读取缓存，未命中
T3: 线程 B 查询数据库，得到 name = "张三"
T4: 线程 A 删除缓存
T5: 线程 C 读取缓存，未命中
T6: 线程 C 查询数据库，得到 name = "张三" ✓

这种情况是 OK 的，没有数据不一致。
```

但如果我们把「删除缓存」改成「更新缓存」：

```
T1: 线程 A 更新数据库，name = "张三"
T2: 线程 B 读取缓存，未命中
T3: 线程 A 更新缓存，name = "李四"（旧值！）
T4: 线程 B 查询数据库，得到 name = "张三"
T5: 线程 B 回填缓存，name = "张三"

最终缓存是 "张三"，数据库也是 "张三"，看起来 OK...
但如果顺序反过来呢？
```

```
最危险的顺序：
T1: 线程 A 更新数据库，name = "张三"
T2: 线程 A 更新缓存，name = "张三"
T3: 线程 B 读取缓存，命中，返回 "张三"
T4: 数据库因为某些原因回滚了（主从切换？事务回滚？）
T5: 线程 A 删除缓存
T6: 线程 C 读取缓存，未命中
T7: 线程 C 查询数据库，得到 "李四"（旧值！）
T8: 线程 C 回填缓存，name = "李四"

最终：缓存是 "李四"，数据库是 "李四"... 但如果 T4 之前发生了呢？
```

**结论**：删除是幂等的，更新不是。删除操作在高并发下更安全。

### 代码实现

```java
public class CacheAsideService {
    
    private final Cache&lt;String, Product&gt; localCache;
    private final RedisTemplate&lt;String, Product&gt; redisTemplate;
    private final ProductDao productDao;
    
    // 读操作
    public Product getProduct(Long productId) {
        String cacheKey = "product:" + productId;
        
        // 1. 先查本地缓存
        Product product = localCache.getIfPresent(cacheKey);
        if (product != null) {
            return product;
        }
        
        // 2. 再查 Redis
        product = redisTemplate.opsForValue().get(cacheKey);
        if (product != null) {
            // 回填本地缓存
            localCache.put(cacheKey, product);
            return product;
        }
        
        // 3. Redis 也未命中，查数据库
        product = productDao.selectById(productId);
        if (product != null) {
            // 双写缓存
            redisTemplate.opsForValue().set(cacheKey, product, 1, TimeUnit.HOURS);
            localCache.put(cacheKey, product);
        }
        
        return product;
    }
    
    // 写操作
    public void updateProduct(Product product) {
        String cacheKey = "product:" + product.getId();
        
        // 1. 先更新数据库
        productDao.updateById(product);
        
        // 2. 再删除缓存（注意：不是更新！）
        redisTemplate.delete(cacheKey);
        localCache.invalidate(cacheKey);
    }
    
    // 删除操作
    public void deleteProduct(Long productId) {
        String cacheKey = "product:" + productId;
        
        // 1. 先删除数据库
        productDao.deleteById(productId);
        
        // 2. 再删除缓存
        redisTemplate.delete(cacheKey);
        localCache.invalidate(cacheId);
    }
}
```

### Cache Aside 的适用场景

✅ **优点**：
- 实现简单，逻辑清晰
- 数据一致性较好（配合删除策略）
- 适合读多写多的场景

❌ **缺点**：
- 首次访问一定有数据库查询（缓存冷启动问题）
- 并发写入时可能导致短暂的数据不一致

---

## Read Through：缓存自动加载

### 核心思想

**Read Through（读穿透）** 的核心是：**缓存当代表，数据加载自动化**。

应用层只和缓存打交道，不关心数据是从缓存来还是从数据库来。缓存自己判断是否需要从数据库加载数据。

```
应用层：只调用 cache.get(key)
         ↓
缓存层：检查是否命中
         ├── 命中 → 直接返回
         └── 未命中 → 自动从数据库加载 → 返回
```

### 代码实现

```java
public class ReadThroughCache {
    
    private LoadingCache&lt;String, Product&gt; cache;
    
    public ReadThroughCache() {
        this.cache = Caffeine.newBuilder()
            .maximumSize(10_000)
            .expireAfterWrite(10, TimeUnit.MINUTES)
            .build(this::loadFromDatabase);  // 定义加载方法
    }
    
    public Product getProduct(Long productId) {
        String cacheKey = "product:" + productId;
        // 一行代码搞定：缓存未命中时自动加载
        return cache.get(cacheKey);
    }
    
    // 缓存未命中时自动调用此方法
    private Product loadFromDatabase(String cacheKey) {
        Long productId = extractProductId(cacheKey);
        return productDao.selectById(productId);
    }
}
```

### Read Through 的适用场景

✅ **优点**：
- 应用层代码简洁，不用关心缓存加载逻辑
- 缓存未命中时自动加载，避免缓存击穿（配合缓存本身的黑洞机制）

❌ **缺点**：
- 依赖缓存组件的支持
- 加载逻辑需要幂等

---

## Write Through：同步写入，缓存即数据源

### 核心思想

**Write Through（写穿透）** 的核心是：**写操作同时更新缓存和数据库，要么都成功，要么都失败**。

缓存就像数据库的镜像，每次写入都要保证两边一致。

```
写操作：
写入缓存 → 同步写入数据库 → 返回成功
         ↓ 失败
      回滚缓存写入 → 返回失败
```

### 代码实现

```java
public class WriteThroughCache {
    
    private Cache&lt;String, Product&gt; cache;
    private ProductDao productDao;
    
    public void updateProduct(Product product) {
        String cacheKey = "product:" + product.getId();
        
        // 1. 先更新缓存
        cache.put(cacheKey, product);
        
        // 2. 再同步更新数据库
        boolean success = productDao.updateById(product);
        
        if (!success) {
            // 数据库更新失败，需要回滚缓存
            cache.invalidate(cacheKey);
            throw new BusinessException("更新失败");
        }
    }
}
```

### Write Through vs Cache Aside

| 特性 | Write Through | Cache Aside |
|------|--------------|-------------|
| 写操作 | 同步写缓存 + 数据库 | 只写数据库，删除缓存 |
| 读操作 | 命中则快，未命中需加载 | 缓存命中则快，未命中查库 |
| 一致性 | 更高 | 一般 |
| 性能 | 写操作较慢（要写两个地方） | 写操作快（只写数据库） |
| 适用场景 | 数据一致性要求极高 | 读多写少，允许短暂不一致 |

---

## Write Behind：异步写入，性能至上

### 核心思想

**Write Behind（写回）** 的核心是：**先写缓存，再异步批量写数据库**。

缓存是「主」，数据库是「从」。写操作只写到缓存就返回，后台异步同步到数据库。

```
写操作（快）：
写入缓存 → 返回成功（异步批量写数据库）

读操作：
缓存命中 → 返回
缓存未命中 → 查库 → 回填缓存
```

### 代码实现

```java
public class WriteBehindCache {
    
    private final Map&lt;String, Product&gt; localCache = new ConcurrentHashMap&lt;&gt;();
    private final BlockingQueue&lt;WriteRequest&gt; writeQueue = new LinkedBlockingQueue&lt;&gt;();
    private final ProductDao productDao;
    
    public WriteBehindCache(ProductDao productDao) {
        this.productDao = productDao;
        
        // 启动后台异步写入线程
        Thread writeThread = new Thread(this::asyncWriteToDb);
        writeThread.setName("write-behind-thread");
        writeThread.start();
    }
    
    public void updateProduct(Product product) {
        String cacheKey = "product:" + product.getId();
        
        // 1. 先写入本地缓存（快速）
        localCache.put(cacheKey, product);
        
        // 2. 放入异步写入队列
        writeQueue.offer(new WriteRequest(WriteType.UPDATE, cacheKey, product));
    }
    
    public void deleteProduct(Long productId) {
        String cacheKey = "product:" + productId;
        
        // 1. 先删除本地缓存
        localCache.remove(cacheKey);
        
        // 2. 放入异步写入队列
        writeQueue.offer(new WriteRequest(WriteType.DELETE, cacheKey, null));
    }
    
    private void asyncWriteToDb() {
        while (true) {
            try {
                // 批量取出待写入的请求
                List&lt;WriteRequest&gt; batch = new ArrayList&lt;&gt;();
                writeQueue.drainTo(batch, 100);
                
                if (batch.isEmpty()) {
                    Thread.sleep(10);
                    continue;
                }
                
                // 批量写入数据库
                for (WriteRequest req : batch) {
                    switch (req.type) {
                        case UPDATE:
                            productDao.updateById(req.product);
                            break;
                        case DELETE:
                            productDao.deleteById(extractId(req.cacheKey));
                            break;
                    }
                }
                
                log.info("Write behind: 批量写入 {} 条数据到数据库", batch.size());
                
            } catch (Exception e) {
                log.error("Write behind 异步写入失败", e);
            }
        }
    }
}
```

### Write Behind 的挑战

✅ **优点**：
- 写入性能极高（只写缓存，异步批量写库）
- 减少数据库压力
- 适合高并发写入场景（如埋点、日志、实时统计）

❌ **缺点**：
- 数据一致性最弱（缓存写入但数据库未写入时故障会丢数据）
- 实现复杂（需要考虑数据持久化、故障恢复）
- 不适合数据一致性要求高的场景

---

## 四种模式对比

| 特性 | Cache Aside | Read Through | Write Through | Write Behind |
|------|-------------|---------------|---------------|--------------|
| **一致性** | 中等 | 中等 | 高 | 低 |
| **写入性能** | 快 | 快 | 中等 | 极高 |
| **读取性能** | 快 | 快 | 快 | 快 |
| **实现复杂度** | 低 | 低 | 中等 | 高 |
| **适用场景** | 通用 | 读多 | 写多且一致性要求高 | 高并发写、允许丢数据 |
| **缓存故障影响** | 降级到数据库 | 降级到数据库 | 数据库是备份 | 可能丢数据 |

---

## 实战：如何选择？

### 选择 Cache Aside 的场景

```java
// 电商商品信息、用户信息等
// 读多写多，但允许短暂不一致
public Product getProduct(Long productId) {
    // Cache Aside 实现
}
```

### 选择 Write Through 的场景

```java
// 账户余额、库存等一致性要求极高的数据
// 每次写入都要保证强一致
public void deductStock(Long productId, Integer count) {
    // Write Through 实现
    // 库存扣减失败则整个事务回滚
}
```

### 选择 Write Behind 的场景

```java
// 用户行为埋点、日志写入、实时统计
// 允许少量数据丢失，追求极致写入性能
public void recordClick(Long userId, Long productId) {
    // Write Behind 实现
    // 异步批量写库
}
```

---

## 总结

四种缓存读写模式，没有绝对的优劣，只有场景的匹配：

- **Cache Aside**：最通用，业界首选，适合大部分业务
- **Read Through**：简化应用层代码，适合读多场景
- **Write Through**：一致性优先，适合关键数据写入
- **Write Behind**：性能优先，适合高并发写入

理解它们的区别，才能在系统设计时做出正确的选择。

---

## 留给你的问题

假设你正在设计一个**库存扣减系统**，要求：
1. 库存不能出现负数
2. 并发扣减时不能超卖
3. 性能要足够高，能扛住秒杀流量

你会在这个场景下选择哪种缓存读写模式？缓存和数据库的一致性如何保证？

提示：需要结合分布式锁或乐观锁来保证库存不超卖。
