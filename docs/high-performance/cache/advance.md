# 缓存预热、缓存预计算、缓存降级策略

你的秒杀系统明天上线。

今晚你做了最后一次代码检查，确保缓存逻辑完美无缺。

明天零点，流量涌入——

然后系统崩了。

为什么？

——**缓存是空的，系统冷启动了**。

这就是为什么我们需要「缓存预热、预计算、降级」三位一体的策略。

---

## 一、缓存预热：让系统有备而来

### 为什么需要预热？

```
系统启动时：
- Redis 可能刚刚重启，数据全空
- 本地缓存为空
- 数据库承受冷启动流量

正常运行时：
- 缓存命中率 99%
- 数据库只处理 1% 的请求

结论：缓存预热做不好，再好的缓存策略都是空谈
```

### 预热时机

| 时机 | 触发条件 | 预热策略 |
|------|----------|----------|
| 系统启动 | 应用启动 | 启动时全量预热 |
| 活动开始前 | 定时任务 | 活动前增量预热 |
| 热点发现时 | 监控触发 | 实时增量预热 |
| 缓存失效后 | 懒加载触发 | 主动刷新兜底 |

---

### 方式一：启动时全量预热

```java
@Service
public class CacheWarmUpService implements ApplicationRunner {
    
    @Autowired
    private ProductDao productDao;
    
    @Autowired
    private RedisTemplate&lt;String, Object&gt; redisTemplate;
    
    @Autowired
    private Cache&lt;String, Product&gt; localCache;
    
    @Override
    public void run(ApplicationArguments args) {
        log.info("========== 开始缓存预热 ==========");
        long startTime = System.currentTimeMillis();
        
        // 1. 预热热门商品（Top 10000）
        warmUpHotProducts();
        
        // 2. 预热分类数据
        warmUpCategories();
        
        // 3. 预热配置数据
        warmUpConfigs();
        
        long cost = System.currentTimeMillis() - startTime;
        log.info("========== 缓存预热完成，耗时 {} ms ==========", cost);
    }
    
    private void warmUpHotProducts() {
        long startTime = System.currentTimeMillis();
        
        // 分批查询，避免一次加载过多数据
        int batchSize = 1000;
        int offset = 0;
        int totalWarmed = 0;
        
        while (true) {
            List&lt;Product&gt; products = productDao.selectHotProducts(offset, batchSize);
            if (products.isEmpty()) {
                break;
            }
            
            for (Product product : products) {
                String cacheKey = "product:" + product.getId();
                
                // 写入 Redis
                redisTemplate.opsForValue().set(cacheKey, product, 1, TimeUnit.HOURS);
                
                // 写入本地缓存（热点数据永久保留）
                localCache.put(cacheKey, product);
                
                totalWarmed++;
            }
            
            offset += batchSize;
            
            // 每批之间短暂休息，避免打爆 Redis
            if (offset % 5000 == 0) {
                try {
                    Thread.sleep(100);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }
        
        log.info("预热热门商品 {} 条，耗时 {} ms", 
            totalWarmed, System.currentTimeMillis() - startTime);
    }
    
    private void warmUpCategories() {
        // 分类数据一般较少，全量加载
        List&lt;Category&gt; categories = categoryDao.selectAll();
        
        for (Category category : categories) {
            String cacheKey = "category:" + category.getId();
            redisTemplate.opsForValue().set(cacheKey, category, 24, TimeUnit.HOURS);
        }
        
        log.info("预热分类 {} 条", categories.size());
    }
    
    private void warmUpConfigs() {
        // 配置数据通常放在 Redis Hash 中
        Map&lt;String, String&gt; configs = configDao.selectAllAsMap();
        redisTemplate.opsForHash().putAll("configs", configs);
        
        log.info("预热配置 {} 条", configs.size());
    }
}
```

### 方式二：活动前增量预热

```java
@Service
public class FlashSaleWarmUpService {
    
    @Scheduled(cron = "0 30 9 * * ?")  // 每天 9:30 预热
    public void warmUpBeforeFlashSale() {
        log.info("秒杀活动预热开始...");
        
        // 1. 获取秒杀商品列表
        List&lt;FlashSaleProduct&gt; flashSaleProducts = flashSaleService.getFlashSaleProducts();
        
        // 2. 批量预热
        for (FlashSaleProduct fsp : flashSaleProducts) {
            warmUpFlashSaleProduct(fsp);
        }
        
        log.info("秒杀活动预热完成，共 {} 件商品", flashSaleProducts.size());
    }
    
    private void warmUpFlashSaleProduct(FlashSaleProduct fsp) {
        String productKey = "product:" + fsp.getProductId();
        String stockKey = "stock:" + fsp.getProductId();
        
        // 1. 预热商品信息
        Product product = productDao.selectById(fsp.getProductId());
        if (product != null) {
            redisTemplate.opsForValue().set(productKey, product, 2, TimeUnit.HOURS);
        }
        
        // 2. 预热库存（使用 Lua 原子操作）
        String luaScript = 
            "redis.call('SET', KEYS[1], ARGV[1]) " +
            "return 1";
        
        redisTemplate.execute(
            new DefaultRedisScript&lt;&gt;(luaScript, Long.class),
            Collections.singletonList(stockKey),
            fsp.getStock().toString()
        );
        
        // 3. 预热活动配置
        String configKey = "flash:config:" + fsp.getId();
        redisTemplate.opsForValue().set(configKey, fsp, 2, TimeUnit.HOURS);
    }
}
```

### 方式三：实时热点预热

```java
@Service
public class HotDataPreWarmingService {
    
    @Autowired
    private HotKeyDetector hotKeyDetector;  // 热点探测服务
    
    @PostConstruct
    public void init() {
        // 监听热点发现事件，实时预热
        hotKeyDetector.addListener(this::onHotKeyDiscovered);
    }
    
    private void onHotKeyDiscovered(String cacheKey) {
        // 发现热点后立即预热
        CompletableFuture.runAsync(() -&gt; {
            try {
                // 避免重复预热
                if (redisTemplate.hasKey(cacheKey)) {
                    return;
                }
                
                // 从数据库加载
                Object data = loadDataFromDatabase(cacheKey);
                if (data != null) {
                    redisTemplate.opsForValue().set(cacheKey, data, 30, TimeUnit.MINUTES);
                    localCache.put(cacheKey, data);
                    
                    log.info("热点数据实时预热完成: {}", cacheKey);
                }
            } catch (Exception e) {
                log.error("热点数据预热失败: {}", cacheKey, e);
            }
        });
    }
}
```

---

## 二、缓存预计算：算好再缓存

### 为什么需要预计算？

有些数据计算代价很高，如果每次请求都算一遍，缓存命中后也要计算。

**预计算**就是提前把结果算好，缓存命中后直接返回。

```java
// 场景：商品详情页需要展示「相似商品」
// 计算相似商品：需要向量相似度计算，耗时 100ms

// 不预计算：每次都算
public List&lt;Product&gt; getSimilarProducts(Long productId) {
    Product product = getFromCache(productId);  // 缓存命中
    
    // 即使缓存命中，还是要计算相似商品
    return computeSimilarProducts(product);  // 耗时 100ms
}

// 预计算：写入缓存时就算好
public void setProduct(Product product) {
    // 写入商品缓存
    redisTemplate.opsForValue().set("product:" + product.getId(), product);
    
    // 预计算相似商品
    List&lt;Product&gt; similarProducts = computeSimilarProducts(product);
    redisTemplate.opsForValue().set(
        "similar:" + product.getId(), 
        similarProducts, 
        1, TimeUnit.HOURS
    );
}
```

### 预计算策略

```java
@Service
public class PreComputationService {
    
    // 定时任务：每天凌晨预计算
    @Scheduled(cron = "0 0 2 * * ?")
    public void dailyPreComputation() {
        log.info("开始每日预计算...");
        
        // 1. 预计算商品排行榜
        preComputeRankings();
        
        // 2. 预计算用户推荐
        preComputeRecommendations();
        
        // 3. 预计算聚合数据
        preComputeAggregations();
        
        log.info("每日预计算完成");
    }
    
    private void preComputeRankings() {
        // 预计算日榜
        List&lt;Product&gt; dailyTop = productDao.selectDailyTopSales(100);
        redisTemplate.opsForValue().set("rankings:daily", dailyTop, 24, TimeUnit.HOURS);
        
        // 预计算周榜
        List&lt;Product&gt; weeklyTop = productDao.selectWeeklyTopSales(100);
        redisTemplate.opsForValue().set("rankings:weekly", weeklyTop, 7, TimeUnit.DAYS);
        
        // 预计算分类榜单
        List&lt;Category&gt; categories = categoryDao.selectAll();
        for (Category category : categories) {
            List&lt;Product&gt; categoryTop = productDao.selectTopByCategory(category.getId(), 50);
            redisTemplate.opsForValue().set(
                "rankings:category:" + category.getId(), 
                categoryTop, 
                24, TimeUnit.HOURS
            );
        }
    }
    
    private void preComputeRecommendations() {
        // 预计算热门推荐（基于协同过滤）
        List&lt;Product&gt; hotRecommendations = recommendationEngine.getHotRecommendations(100);
        redisTemplate.opsForValue().set(
            "recommendations:hot", 
            hotRecommendations, 
            6, TimeUnit.HOURS
        );
    }
}
```

### 预计算的使用

```java
public List&lt;Product&gt; getDailyTopProducts() {
    // 直接从缓存读取预计算结果
    List&lt;Product&gt; cached = redisTemplate.opsForList()
        .range("rankings:daily", 0, 9);
    
    if (cached != null &amp;&amp; !cached.isEmpty()) {
        return cached;
    }
    
    // 缓存失效时的兜底计算
    return productDao.selectDailyTopSales(10);
}
```

---

## 三、缓存降级策略：优雅地失败

### 为什么需要降级？

```
正常情况：缓存 → 返回
          ↓
         缓存故障：Redis 挂了
          ↓
         数据库承受不住 → 系统崩溃
```

**降级策略**的目标是：缓存不可用时，系统仍能提供**有损服务**。

### 降级策略层次

| 层次 | 策略 | 响应时间 | 数据准确性 |
|------|------|----------|------------|
| L1 本地缓存 | Caffeine | < 1μs | 可能有延迟 |
| L2 Redis | 降级到本地/数据库 | < 10ms | 可能有延迟 |
| L3 数据库 | 直接查库 | < 100ms | 实时准确 |
| 降级页 | 返回友好提示 | < 1ms | 无数据 |

### 降级实现

```java
@Service
public class CacheDegradationService {
    
    private final Cache&lt;String, Product&gt; localCache;
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    
    public Product getProductWithDegrade(Long productId) {
        String cacheKey = "product:" + productId;
        
        // ========== L1: 尝试本地缓存 ==========
        Product product = localCache.getIfPresent(cacheKey);
        if (product != null) {
            return product;
        }
        
        // ========== L2: 尝试 Redis ==========
        try {
            product = (Product) redisTemplate.opsForValue().get(cacheKey);
            if (product != null) {
                // 回填本地缓存
                localCache.put(cacheKey, product);
                return product;
            }
        } catch (Exception e) {
            // Redis 故障，记录日志，继续降级
            log.warn("Redis 查询失败，降级处理", e);
        }
        
        // ========== L3: 降级到数据库 ==========
        try {
            product = productDao.selectById(productId);
            if (product != null) {
                // 写本地缓存（不写 Redis）
                localCache.put(cacheKey, product);
                return product;
            }
        } catch (Exception e) {
            log.error("数据库查询失败", e);
        }
        
        // ========== L4: 返回降级数据 ==========
        return getDegradedProduct(productId);
    }
    
    private Product getDegradedProduct(Long productId) {
        // 降级方案 1：返回静态兜底数据
        Product degraded = new Product();
        degraded.setId(productId);
        degraded.setName("商品信息加载中...");
        degraded.setPrice(BigDecimal.ZERO);
        return degraded;
    }
}
```

### Sentinel 降级

```java
@RestController
public class ProductController {
    
    @Autowired
    private SentinelDegradeService sentinelService;
    
    // Sentinel 熔断降级
    @GetMapping("/product/{id}")
    @SentinelResource(value = "getProduct",
        blockHandler = "getProductBlockHandler",
        fallback = "getProductFallback")
    public Response&lt;Product&gt; getProduct(@PathVariable Long id) {
        return Response.success(productService.getProduct(id));
    }
    
    // 限流/熔断处理
    public Response&lt;Product&gt; getProductBlockHandler(Long id, BlockException e) {
        return Response.fail("访问过于频繁，请稍后再试");
    }
    
    // 降级处理
    public Response&lt;Product&gt; getProductFallback(Long id, Throwable t) {
        log.warn("商品 {} 查询降级，原因: {}", id, t.getMessage());
        
        // 返回降级数据
        Product degraded = new Product();
        degraded.setId(id);
        degraded.setName("商品信息加载中...");
        return Response.success(degraded);
    }
}
```

### 自动降级配置

```java
@Configuration
public class SentinelConfig {
    
    @Bean
    public InitFunc dataSourceInitFunc() {
        return (context, environment) -&gt; {
            // 配置降级规则
            DegradeRule degradeRule = new DegradeRule("getProduct")
                .setGrade(CircuitBreakerStrategy.ERROR_RATIO.getType())
                .setCount(0.3)  // 30% 错误率触发降级
                .setMinRequestAmount(10)  // 最小请求数
                .setStatIntervalMs(1000)  // 统计窗口 1 秒
                .setSlowRatioThreshold(0.5)  // 50% 慢调用触发
                .setMaxAllowedSlowRatio(0.5)  // 最大慢调用比例
                .setSlowRatioMaxDuration(2000)  // 2 秒以上算慢调用
                .setTimeWindow(10);  // 降级时间窗口 10 秒
            
            DegradeRuleManager.loadRules(Collections.singletonList(degradeRule));
        };
    }
}
```

---

## 综合策略：三位一体

```java
@Service
public class CacheStrategyService {
    
    // 1. 预热：系统启动时
    @PostConstruct
    public void warmUp() {
        cacheWarmUpService.warmUp();
    }
    
    // 2. 预计算：定时任务
    @Scheduled(cron = "0 0 2 * * ?")
    public void preComputation() {
        preComputationService.computeAll();
    }
    
    // 3. 查询（带降级）
    public Product getProductWithStrategy(Long productId) {
        String cacheKey = "product:" + productId;
        
        // L1: 本地缓存（永不过期）
        Product product = localCache.getIfPresent(cacheKey);
        if (product != null) {
            return product;
        }
        
        // L2: Redis
        try {
            product = (Product) redisTemplate.opsForValue().get(cacheKey);
            if (product != null) {
                localCache.put(cacheKey, product);
                return product;
            }
        } catch (Exception e) {
            // 降级到 L3
            log.warn("Redis 不可用，降级到数据库", e);
        }
        
        // L3: 数据库
        try {
            product = productDao.selectById(productId);
            if (product != null) {
                // 写本地缓存（不写 Redis，因为 Redis 可能故障）
                localCache.put(cacheKey, product);
                
                // 异步写 Redis（避免阻塞）
                CompletableFuture.runAsync(() -&gt; {
                    try {
                        redisTemplate.opsForValue().set(cacheKey, product, 1, TimeUnit.HOURS);
                    } catch (Exception e) {
                        log.warn("异步写 Redis 失败", e);
                    }
                });
            }
            
            return product;
        } catch (Exception e) {
            log.error("数据库查询失败", e);
        }
        
        // L4: 降级
        return getDegradedProduct(productId);
    }
}
```

---

## 总结

缓存三位一体策略：

| 策略 | 时机 | 目标 |
|------|------|------|
| **预热** | 启动/活动前/实时 | 让缓存从一开始就有数据 |
| **预计算** | 定时任务 | 把计算成本提前消化 |
| **降级** | 缓存故障时 | 保证系统有备选路径 |

**最佳实践**：
- 启动预热：确保热点数据已缓存
- 预计算：减少实时计算压力
- 多级降级：本地缓存 → Redis → 数据库 → 降级页

---

## 留给你的问题

假设这样一个场景：你的系统有**定时任务**在每天凌晨 3 点更新商品价格。

已知：
- 商品数量：100 万
- 价格更新逻辑：后台系统计算新价格
- 用户可能随时访问商品

请思考：
1. 如何设计预热策略，让价格更新后立即生效？
2. 价格更新时，用户正在浏览商品页面，如何处理？
3. 如果 Redis 故障，价格更新失败，应该怎么办？
4. 如何实现「灰度发布」式的价格更新——先更新 10% 的商品，观察没问题再全量？

提示：可以用版本号 + 主动失效的组合策略。
