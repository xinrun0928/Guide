# 热点数据识别与预热

「李佳琦直播间」开播，10 万人同时涌入。

你的系统是否能扛住？还是在零点零一分，眼睁睁看着数据库被打爆？

问题的关键在于：**你能不能在流量高峰到来之前，识别出哪些是热点数据，并提前把它们缓存起来**。

这就是今天的主题——热点数据识别与预热。

---

## 什么是热点数据？

热点数据（Hot Data）是指**被高频访问的数据**。在电商场景下，可能是：
- 爆款商品详情
- 热搜榜单
- 头部主播信息
- 活动页配置

### 热点的分类

**按维度分类**：
| 类型 | 描述 | 示例 |
|------|------|------|
| 主体热点 | 访问量集中于少数 key | 爆款商品、头部 SKU |
| 行为热点 | 访问模式集中于特定时间 | 秒杀、整点抢购 |
| 关系热点 | 关联查询产生的热点 | 商品详情 → SKU → 库存 |

**按热度分类**：
| 级别 | 访问频率 | 缓存策略 |
|------|----------|----------|
| 极热点 | Top 100，QPS 过万 | 多级缓存 + 本地缓存 |
| 热点 | Top 1000，QPS 破千 | Redis 缓存 + 永久保留 |
| 温数据 | Top 10000 | Redis 缓存 + 合理 TTL |
| 冷数据 | 其余 | 按需加载，不缓存 |

---

## 热点数据识别

### 方法一：基于历史数据分析

最简单的方式是**分析历史访问日志**，找出高频 key。

```java
// 伪代码：统计 Top N 热点 key
public Map&lt;String, Long&gt; analyzeHotKeys(List&lt;AccessLog&gt; logs, int topN) {
    return logs.stream()
        .collect(Collectors.groupingBy(AccessLog::getCacheKey, Collectors.counting()))
        .entrySet().stream()
        .sorted(Map.Entry.&lt;String, Long&gt;comparingByValue().reversed())
        .limit(topN)
        .collect(Collectors.toMap(
            Map.Entry::getKey,
            Map.Entry::getValue,
            (e1, e2) -&gt; e1,
            LinkedHashMap::new
        ));
}

// 示例输出
// product:88888888 -> 1,234,567 次
// product:77777777 -> 987,654 次
// product:66666666 -> 876,543 次
```

**优点**：实现简单，可以提前识别
**缺点**：需要离线计算，无法应对突发热点

### 方法二：基于实时流计算

生产环境更需要**实时识别热点**，这通常借助流计算框架：

**方案 1：Flink + Redis**

```java
// Flink 实时热点计算
public class HotKeyDetector {
    
    public static void main(String[] args) throws Exception {
        StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
        
        DataStream&lt;AccessLog&gt; stream = env
            .addSource(new KafkaSource&lt;&gt;("access-log-topic"))
            .keyBy(AccessLog::getCacheKey)
            .timeWindow(Time.seconds(10))
            .aggregate(new HotKeyAggregator());
        
        stream.addSink(new RedisSink&lt;&gt;());
        
        env.execute("hot-key-detector");
    }
}

public class HotKeyAggregator implements AggregateFunction&lt;AccessLog, Map&lt;String, Long&gt;, Map&lt;String, Long&gt;&gt; {
    
    @Override
    public Map&lt;String, Long&gt; createAccumulator() {
        return new HashMap&lt;&gt;();
    }
    
    @Override
    public Map&lt;String, Long&gt; add(AccessLog log, Map&lt;String, Long&gt; acc) {
        acc.merge(log.getCacheKey(), 1L, Long::sum);
        return acc;
    }
    
    @Override
    public Map&lt;String, Long&gt; getResult(Map&lt;String, Long&gt; acc) {
        // 过滤热点：超过阈值才算热点
        return acc.entrySet().stream()
            .filter(e -&gt; e.getValue() &gt; HOT_THRESHOLD)
            .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
    }
    
    @Override
    public Map&lt;String, Long&gt; merge(Map&lt;String, Long&gt; a, Map&lt;String, Long&gt; b) {
        a.putAll(b);
        return a;
    }
}
```

**方案 2：Redis + Lua 滑动窗口**

如果不想引入流计算框架，可以用 Redis 自己实现热点检测：

```java
// Redis Lua 脚本：滑动窗口热点检测
// 保存到 redis-hotkey.lua
-- 参数：KEY[1]=计数器 key, ARGV[1]=时间窗口秒数, ARGV[2]=热点阈值
local window = tonumber(ARGV[1])
local threshold = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local key = KEYS[1]

-- 记录访问（使用时间戳作为 score）
redis.call('ZREMRANGEBYSCORE', key, 0, now - window * 1000)
redis.call('ZADD', key, now, now .. '-' .. math.random())

-- 统计窗口内访问次数
local count = redis.call('ZCARD', key)

-- 设置过期时间
redis.call('EXPIRE', key, window)

return count
```

```java
// Java 调用
public boolean isHotKey(String cacheKey) {
    String luaScript = loadScript("redis-hotkey.lua");
    
    DefaultRedisScript&lt;Long&gt; script = new DefaultRedisScript&lt;&gt;();
    script.setScriptText(luaScript);
    script.setResultType(Long.class);
    
    Long count = redisTemplate.execute(
        script,
        Collections.singletonList("hotkey:" + cacheKey),
        String.valueOf(windowSeconds),
        String.valueOf(hotThreshold),
        String.valueOf(System.currentTimeMillis())
    );
    
    return count != null &amp;&amp; count &gt; hotThreshold;
}
```

### 方法三：基于 Redis 的原生热点探测

Redis 4.0+ 引入了 `MONITOR` 命令和**客户端缓存（Client-side caching）**，可以更方便地探测热点：

```bash
# 实时监控访问
redis-cli --latency-history

# 或者使用 redis-cli 内置的热点分析
redis-cli --hotkeys
```

注意：`MONITOR` 命令会降低 Redis 性能，生产环境慎用。

---

## 热点数据保护策略

识别出热点数据后，需要针对性的保护策略。

### 策略一：多级缓存兜底

```
请求 → Nginx 缓存 → CDN → 本地缓存 → Redis → 数据库
           ↓           ↓         ↓         ↓
         L1 命中率    L2 命中率   L3 命中率   最终
```

```java
public class MultiLevelCacheService {
    
    // 三级缓存获取
    public Product getProduct(Long productId) {
        String cacheKey = "product:" + productId;
        
        // L1：本地缓存（Caffeine）
        Product product = localCache.getIfPresent(cacheKey);
        if (product != null) {
            return product;
        }
        
        // L2：Redis 缓存
        product = redisTemplate.opsForValue().get(cacheKey);
        if (product != null) {
            // 回填 L1
            localCache.put(cacheKey, product);
            return product;
        }
        
        // L3：数据库
        product = productDao.selectById(productId);
        if (product != null) {
            // 双写缓存
            redisTemplate.opsForValue().set(cacheKey, product, 1, TimeUnit.HOURS);
            localCache.put(cacheKey, product);
        }
        
        return product;
    }
    
    // 热点数据主动标记：永久保留在本地缓存
    public void markAsHot(Long productId) {
        String cacheKey = "product:" + productId;
        
        // 从 Redis 加载
        Product product = redisTemplate.opsForValue().get(cacheKey);
        if (product == null) {
            product = productDao.selectById(productId);
            if (product != null) {
                redisTemplate.opsForValue().set(cacheKey, product, 1, TimeUnit.HOURS);
            }
        }
        
        // 放入本地缓存（不过期）
        if (product != null) {
            localCache.put(cacheKey, product);
        }
    }
}
```

### 策略二：热点数据 hash tag 隔离

对于 Redis Cluster，将热点数据集中在特定节点，避免打爆整个集群：

```java
public class HotDataIsolation {
    
    // 将热点 key 路由到固定槽位
    public void routeHotKey(String hotKey) {
        // 对于 "hot:" 前缀的 key，强制使用相同槽位
        // 实际实现：在 JedisCluster 中自定义槽位计算逻辑
    }
}
```

### 策略三：热点数据本地队列削峰

```java
public class HotKeyDeduplicator {
    
    private LoadingCache&lt;String, Boolean&gt; requestCache;
    private BlockingQueue&lt;String&gt; asyncQueue;
    
    public HotKeyDeduplicator() {
        // 100ms 内的重复请求去重
        requestCache = Caffeine.newBuilder()
            .maximumSize(100_000)
            .expireAfterWrite(100, TimeUnit.MILLISECONDS)
            .build(key -&gt; true);
        
        asyncQueue = new LinkedBlockingQueue&lt;&gt;(10_000);
    }
    
    public boolean tryAcquire(String cacheKey) {
        // 第一次请求：返回 true，走数据库
        // 后续 100ms 内请求：返回 false，忽略
        return requestCache.asMap()
            .putIfAbsent(cacheKey, Boolean.TRUE) == null;
    }
}
```

---

## 热点数据预热

识别是为了保护，**预热是为了从容**。

### 预热时机

| 时机 | 场景 | 预热策略 |
|------|------|----------|
| 系统启动时 | 新增节点、冷启动 | 全量预热 |
| 活动开始前 | 秒杀、大促 | 定向预热 |
| 实时触发 | 热点发现时 | 增量预热 |

### 全量预热：系统启动时

```java
// Spring Boot 启动时执行
@Component
public class CacheWarmer implements ApplicationRunner {
    
    @Autowired
    private ProductDao productDao;
    
    @Autowired
    private RedisTemplate&lt;String, Object&gt; redisTemplate;
    
    @Autowired
    private Cache&lt;String, Product&gt; localCache;
    
    @Override
    public void run(ApplicationArguments args) {
        log.info("开始缓存预热...");
        
        // 预热 Top 1000 热点商品
        List&lt;Product&gt; hotProducts = productDao.selectHotProducts(1000);
        
        for (Product product : hotProducts) {
            String cacheKey = "product:" + product.getId();
            
            // 写入 Redis
            redisTemplate.opsForValue().set(cacheKey, product, 1, TimeUnit.HOURS);
            
            // 写入本地缓存
            localCache.put(cacheKey, product);
        }
        
        log.info("缓存预热完成，共预热 {} 条数据", hotProducts.size());
    }
}
```

### 定向预热：活动开始前

```java
// 活动开始前 30 分钟定时预热
@Scheduled(cron = "0 30 9 * * ?")  // 每天 9:30 预热
public void warmUpBeforeFlashSale() {
    // 1. 获取秒杀商品列表
    List&lt;Long&gt; flashSaleProductIds = flashSaleService.getFlashSaleProductIds();
    
    // 2. 批量获取商品信息
    for (Long productId : flashSaleProductIds) {
        String cacheKey = "product:" + productId;
        
        // 跳过已有缓存
        if (redisTemplate.hasKey(cacheKey)) {
            continue;
        }
        
        // 3. 加载并缓存
        Product product = productDao.selectById(productId);
        if (product != null) {
            // 设置较长的过期时间（活动期间不会过期）
            redisTemplate.opsForValue().set(
                cacheKey, product, 
                2, TimeUnit.HOURS  // 活动结束后自然过期
            );
            
            // 放入本地缓存
            localCache.put(cacheKey, product);
        }
    }
}
```

### 增量预热：热点发现时

```java
// 热点发现后立即预热
public void warmUpHotKey(String cacheKey) {
    // 1. 检查是否已在缓存
    if (redisTemplate.hasKey(cacheKey)) {
        return;
    }
    
    // 2. 从数据库加载
    Object data = loadFromDatabase(cacheKey);
    if (data != null) {
        // 3. 写入 Redis
        redisTemplate.opsForValue().set(cacheKey, data, 30, TimeUnit.MINUTES);
        
        // 4. 放入本地缓存
        localCache.put(cacheKey, data);
        
        log.info("热点数据预热完成: {}", cacheKey);
    }
}
```

---

## 热点数据监控

预热不是一劳永逸，需要持续监控和调整。

### 监控指标

```java
public class HotDataMonitor {
    
    // 每分钟上报热点数据统计
    public void reportHotDataMetrics() {
        CacheStats localStats = localCache.stats();
        
        Map&lt;String, Object&gt; metrics = new HashMap&lt;&gt;();
        metrics.put("local_hit_rate", localStats.hitRate());
        metrics.put("local_hit_count", localStats.hitCount());
        metrics.put("local_miss_count", localStats.missCount());
        metrics.put("local_eviction_count", localStats.evictionCount());
        
        // 上报到监控系统（Prometheus/InfluxDB）
        prometheusClient.gauge("cache_hot_data", metrics);
    }
}
```

### 热点数据告警

```yaml
# Prometheus 告警规则
groups:
  - name: hot_data_alert
    rules:
      # 热点数据命中率下降
      - alert: HotDataHitRateLow
        expr: cache_hit_rate &lt; 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "热点数据命中率过低"
          description: "当前命中率 {{ $value }}，低于 80%"
      
      # 热点数据驱逐过多
      - alert: HotDataEvictionHigh
        expr: rate(cache_eviction_total[5m]) &gt; 1000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "热点数据驱逐过多"
          description: "每秒驱逐 {{ $value }} 条缓存"
```

---

## 总结

热点数据处理的核心是三个环节：

**识别**：
- 历史数据分析（离线）
- 流计算实时检测（Flink）
- Redis 滑动窗口（在线）

**保护**：
- 多级缓存（L1 本地 + L2 Redis + L3 DB）
- 热点数据永久保留
- 请求去重、削峰

**预热**：
- 系统启动全量预热
- 活动开始前定向预热
- 热点发现后增量预热

**监控**：
- 命中率监控
- 驱逐率监控
- 热点 key 排行榜

---

## 留给你的问题

假设这样一个场景：「双十一」零点，某个爆款商品因为突发事件（明星同款、话题热搜）从第 1000 名突然窜到第 1 名。

系统启动时的预热数据没有包含这个商品，而它现在的访问量是平时的 **100 倍**。

请思考：
1. 系统如何快速识别这个「突发热点」？
2. 在识别之前，第一波流量如何扛住？
3. 识别之后，如何将这个商品的保护级别提升到最高？
