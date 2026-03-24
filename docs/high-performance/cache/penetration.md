# 缓存穿透：布隆过滤器 + 缓存空值双重方案

你的系统在凌晨 2 点被攻击了。

攻击者用一个**不存在的商品 ID** 频繁请求接口。

缓存查不到（商品不存在），数据库也查不到（商品真的不存在）。

结果呢？每次请求都打到数据库，数据库被活活拖死。

这就是**缓存穿透**。

---

## 什么是缓存穿透？

缓存穿透是指：**请求的数据既不在缓存中，也不在数据库中**。

正常情况下，缓存命中率高，大部分请求被缓存拦截。但如果有恶意请求或系统漏洞，每次都会穿透缓存直接打数据库。

### 穿透的常见原因

| 原因 | 描述 | 示例 |
|------|------|------|
| 恶意攻击 | 故意用大量不存在的 key 请求 | 用 UUID 疯狂请求 |
| 系统漏洞 | 参数校验不严 | 负数 ID、特殊字符导致查询失效 |
| 业务特性 | 正常请求不存在的资源 | 查询已下架商品、已删除用户 |

### 穿透的影响

```
正常情况：
10000 QPS → 缓存命中率 99% → 9900 次命中 → 100 次查库

缓存穿透情况：
10000 QPS → 缓存命中率 0% → 0 次命中 → 10000 次查库

结论：1% 的穿透请求可能导致数据库 100 倍的压力！
```

---

## 方案一：缓存空值

### 核心思想

对于查询结果为空的数据，也把它缓存起来，设置一个较短的过期时间。

**请求流程**：
```
查询缓存 → 未命中 → 查询数据库 → 结果为空
                                         ↓
                               缓存空值（key:null, TTL:5分钟）
                                         ↓
                               返回空结果
```

### 代码实现

```java
public class CachePenetrationService {
    
    private static final String EMPTY_VALUE = "EMPTY";
    private static final int EMPTY_TTL_SECONDS = 300;  // 空值缓存 5 分钟
    
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    private final ProductDao productDao;
    
    public Product getProduct(Long productId) {
        String cacheKey = "product:" + productId;
        
        // 1. 查询缓存
        Object cached = redisTemplate.opsForValue().get(cacheKey);
        
        if (cached != null) {
            // 2. 如果是空值标记，直接返回空
            if (EMPTY_VALUE.equals(cached)) {
                return null;
            }
            return (Product) cached;
        }
        
        // 3. 缓存未命中，查数据库
        Product product = productDao.selectById(productId);
        
        // 4. 不管结果是什么，都缓存起来
        if (product != null) {
            // 正常数据，缓存正常值
            redisTemplate.opsForValue().set(cacheKey, product, 1, TimeUnit.HOURS);
        } else {
            // 空数据，缓存空值标记
            redisTemplate.opsForValue().set(cacheKey, EMPTY_VALUE, EMPTY_TTL_SECONDS, TimeUnit.SECONDS);
        }
        
        return product;
    }
}
```

### 空值缓存的优缺点

✅ **优点**：
- 实现简单，改动小
- 有效防止缓存穿透
- 对正常的不存在数据也有效

❌ **缺点**：
- 如果大量不存在的数据，会浪费缓存空间
- 空值的过期时间不好把控（太长数据更新慢，太短穿透风险高）
- 无法区分「数据不存在」和「缓存过期」

---

## 方案二：布隆过滤器

### 核心思想

**布隆过滤器（Bloom Filter）** 是一种空间效率极高的概率数据结构，用于判断「一个元素是否可能存在」。

它有两个关键特性：
- **可能存在**（False Positive）：不存在的元素可能被误判为存在
- **一定不存在**（True Negative）：存在的元素一定不会被误判为不存在

布隆过滤器的核心思想：**宁可错杀一千，不可放过一个**。

### 布隆过滤器原理

```
布隆过滤器内部结构：
┌────────────────────────────────────────────────────┐
│                    Bit Array                        │
│   [0] [1] [2] [3] [4] [5] [6] [7] [8] [9] ...     │
│     1    0    1    0    1    0    0    1    0 ...  │
└────────────────────────────────────────────────────┘

添加元素 "product:1001"：
1. 用 Hash 函数 1 计算：hash1("product:1001") = 2   → 设置 bit[2] = 1
2. 用 Hash 函数 2 计算：hash2("product:1001") = 5   → 设置 bit[5] = 1
3. 用 Hash 函数 3 计算：hash3("product:1001") = 7   → 设置 bit[7] = 1

查询元素 "product:1001"：
1. hash1("product:1001") = 2   → 检查 bit[2] = 1 ✓
2. hash2("product:1001") = 5   → 检查 bit[5] = 1 ✓
3. hash3("product:1001") = 7   → 检查 bit[7] = 1 ✓
→ 结论：product:1001 可能存在

查询元素 "product:9999"：
1. hash1("product:9999") = 2   → 检查 bit[2] = 1 ✓
2. hash2("product:9999") = 8   → 检查 bit[8] = 0 ✗
→ 结论：product:9999 一定不存在
```

### 布隆过滤器的数学原理

布隆过滤器的误判率计算：

```
m = bit 数组长度
n = 元素个数
k = hash 函数个数
p = 误判率

最优 hash 函数个数：
k = (m / n) * ln2

误判率：
p = (1 - e^(-kn/m))^k
```

**推荐配置**（假设 100 万数据量）：
```java
// Google Guava BloomFilter
BloomFilter&lt;CharSequence&gt; bloomFilter = BloomFilter.create(
    Funnels.stringFunnel(StandardCharsets.UTF_8),
    1_000_000,     // 期望插入的元素个数
    0.01           // 期望误判率 1%
);
// 空间占用约 1.2MB
```

### 布隆过滤器 + Redis 实现

```java
public class BloomFilterCacheService {
    
    private static final String BLOOM_KEY_PREFIX = "bloom:";
    
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    private final ProductDao productDao;
    
    // 初始化布隆过滤器（可以定时从数据库同步）
    private BloomFilter&lt;CharSequence&gt; createProductBloomFilter() {
        BloomFilter&lt;CharSequence&gt; bloomFilter = BloomFilter.create(
            Funnels.stringFunnel(StandardCharsets.UTF_8),
            10_000_000,  // 期望插入 1000 万商品
            0.01         // 1% 误判率
        );
        
        // 从数据库加载所有商品 ID 到布隆过滤器
        productDao.selectAllIds().forEach(id -&gt; 
            bloomFilter.put("product:" + id)
        );
        
        return bloomFilter;
    }
    
    public Product getProduct(Long productId) {
        String cacheKey = "product:" + productId;
        
        // 1. 布隆过滤器检查：一定不存在 → 直接返回空
        if (!bloomFilter.mightContain(cacheKey)) {
            // 一定不存在，无需查库
            return null;
        }
        
        // 2. 布隆过滤器说可能存在，继续查缓存
        Object cached = redisTemplate.opsForValue().get(cacheKey);
        if (cached != null) {
            return (Product) cached;
        }
        
        // 3. 缓存未命中，查数据库
        Product product = productDao.selectById(productId);
        
        if (product != null) {
            // 正常数据，写入缓存
            redisTemplate.opsForValue().set(cacheKey, product, 1, TimeUnit.HOURS);
            
            // 同时更新布隆过滤器（新增数据）
            bloomFilter.put(cacheKey);
        }
        
        return product;
    }
}
```

### 布隆过滤器的变体：可更新的布隆过滤器

布隆过滤器删除困难，如果业务需要删除数据，可以考虑：
- **Counting Bloom Filter**：用计数器代替 bit
- **布隆过滤器 + 定时重建**：定时从数据库全量同步
- **Cuckoo Filter**：支持删除的布隆过滤器变体

```java
// RedisBloom 模块的 Cuckoo Filter
// Redisson 支持
RCuckooFilter&lt;String&gt; cuckooFilter = redissonClient.getCuckooFilter("product:filter");
cuckooFilter.tryInit(10_000_000, 0.01);

// 支持删除
cuckooFilter.delete("product:1001");
```

---

## 方案三：布隆过滤器 + 缓存空值（推荐）

单独使用任何一种方案都有缺陷，**组合使用**效果最佳。

```java
public class AntiPenetrationService {
    
    private static final String EMPTY_VALUE = "EMPTY";
    private static final int EMPTY_TTL_SECONDS = 300;
    
    private final BloomFilter&lt;CharSequence&gt; bloomFilter;
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    private final ProductDao productDao;
    
    public Product getProduct(Long productId) {
        String cacheKey = "product:" + productId;
        
        // ========== 第一层：布隆过滤器 ==========
        if (!bloomFilter.mightContain(cacheKey)) {
            // 一定不存在，直接返回
            return null;
        }
        
        // ========== 第二层：缓存 ==========
        Object cached = redisTemplate.opsForValue().get(cacheKey);
        
        if (cached != null) {
            if (EMPTY_VALUE.equals(cached)) {
                return null;
            }
            return (Product) cached;
        }
        
        // ========== 第三层：数据库 ==========
        Product product = productDao.selectById(productId);
        
        if (product != null) {
            // 正常数据，写入缓存（TTL 较长）
            redisTemplate.opsForValue().set(cacheKey, product, 1, TimeUnit.HOURS);
        } else {
            // 空数据，写入空值缓存（TTL 较短）
            redisTemplate.opsForValue().set(cacheKey, EMPTY_VALUE, EMPTY_TTL_SECONDS, TimeUnit.SECONDS);
            
            // 更新布隆过滤器（表示这个 key 曾经被查询过）
            bloomFilter.put(cacheKey);
        }
        
        return product;
    }
}
```

### 三层防护的效果

```
恶意请求 product:9999（不存在）

无防护：10000 QPS × 每次查库 = 数据库崩溃

有布隆过滤器：
10000 QPS × 99% 直接拦截 = 100 QPS 查缓存

有布隆过滤器 + 空值缓存：
10000 QPS × 99% 直接拦截 = 100 QPS
第一次查库后缓存空值，后续 99% 命中空值缓存
最终数据库压力 ≈ 1 QPS
```

---

## 布隆过滤器的预热与同步

布隆过滤器不是银弹，最大的问题是**数据同步**。

### 问题场景

```
时刻 T1：商家上架新商品（ID=10086）
时刻 T2：布隆过滤器未更新
时刻 T3：用户查询 product:10086 → 布隆过滤器说不存在 → 返回空 → 错误！
```

### 解决方案：延迟双写 + 定时全量同步

```java
public class BloomFilterSyncService {
    
    // 方案 1：延迟双写
    @Transactional
    public void addProduct(Product product) {
        // 1. 先写数据库
        productDao.insert(product);
        
        // 2. 延迟更新布隆过滤器（异步）
        CompletableFuture.runAsync(() -&gt; {
            bloomFilter.put("product:" + product.getId());
        });
    }
    
    // 方案 2：定时全量同步
    @Scheduled(cron = "0 0 3 * * ?")  // 每天凌晨 3 点
    public void fullSyncBloomFilter() {
        log.info("开始全量同步布隆过滤器...");
        
        // 创建新的布隆过滤器
        BloomFilter&lt;CharSequence&gt; newFilter = BloomFilter.create(
            Funnels.stringFunnel(StandardCharsets.UTF_8),
            productDao.countAll() + 100_000,  // 预估数量 + buffer
            0.01
        );
        
        // 批量加载所有数据
        productDao.selectAllIds().forEach(id -&gt; 
            newFilter.put("product:" + id)
        );
        
        // 原子替换
        synchronized (this) {
            this.bloomFilter = newFilter;
        }
        
        log.info("全量同步布隆过滤器完成");
    }
}
```

---

## 总结

缓存穿透的两种经典解决方案：

| 方案 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| 缓存空值 | 不存在的数据也缓存 | 简单有效 | 浪费内存 |
| 布隆过滤器 | 用空间换时间 | 省内存，拦截彻底 | 有误判率 |
| 组合方案 | 双重保障 | 最安全 | 实现复杂一点 |

**推荐使用组合方案**，布隆过滤器负责第一层拦截，缓存空值兜底。

---

## 留给你的问题

假设这样一个场景：你正在设计一个**搜索系统**，索引了 1 亿条商品数据。

用户可以搜索任意关键词，部分关键词对应的商品很少（甚至没有）。

请思考：
1. 如何使用布隆过滤器来防止缓存穿透？
2. 布隆过滤器的 bit 数组应该多大？（假设每条数据平均 50 字节）
3. 如果需要支持「商家下架商品后，搜索结果立即更新」，布隆过滤器应该如何处理？

提示：布隆过滤器本身不支持删除，可以考虑用定时全量同步或 Cuckoo Filter。
