# Redis Hot Key 发现与处理

双十一零点，你盯着监控大屏。订单量暴涨，一切正常——直到某个瞬间，整个系统开始报警。

数据库正常，Redis 正常，应用服务器正常……但响应时间从 50ms 飙升到 2 秒。

你仔细一看：Redis 的 CPU 使用率飙到了 100%。

但奇怪的是，Redis 的 QPS 并不高。**问题不在总量，而在某个 key 被访问得太频繁。**

这就是 Redis 的另一个经典问题——**Hot Key（热 key）**。

## 什么是 Hot Key？

Hot Key 是指在 Redis 中被频繁访问的 key。与大 key 不同，热 key 的问题不在于占用空间，而在于**访问频率过高**。

| 特征 | 大 key | 热 key |
|---|---|---|
| 问题本质 | 占用空间大 | 访问频率高 |
| 影响 | 操作阻塞、内存不均 | 单节点瓶颈、CPU 飙升 |
| 表现 | Redis 内存使用率高 | Redis QPS 极高或 CPU 使用率高 |

## Hot Key 的危害

### 1. 单节点瓶颈

Redis Cluster 模式下，数据按槽分布在 16384 个槽位中。每个 master 节点负责一部分槽位。

如果某个热 key 恰好落在某个节点上，所有访问都会打到这个节点：

```
正常情况：
Client → Redis Cluster → 多个节点分摊请求

热点情况：
Client → Redis Cluster → 某个节点被请求淹没，其他节点空闲
```

### 2. 请求倾斜

即使你的 Redis 是单节点部署，热 key 也会导致请求倾斜。假设你的 Redis 有 4 个 CPU 核心，但所有请求都在处理同一个 key，CPU 利用率只有 25%——单核打满，其他核心空闲。

### 3. 缓存击穿

热 key 过期时，大量请求同时打到数据库：

```
时刻 T:  热 key 过期
时刻 T+1:  10000 个请求同时发现缓存失效
时刻 T+1:  10000 个请求同时查询数据库
时刻 T+2:  数据库被打垮
```

## 如何发现 Hot Key？

### 方法一：Redis 客户端埋点

在所有 Redis 操作处记录 key 和访问次数：

```java
@Component
public class RedisHotKeyMonitor {
    
    private static final Map&lt;String, AtomicLong&gt; KEY_COUNTS = new ConcurrentHashMap&lt;&gt;();
    private static final ScheduledExecutorService SCHEDULER = Executors.newSingleThreadScheduledExecutor();
    
    public &lt;T&gt; T getAndMonitor(RedisTemplate&lt;String, T&gt; template, String key) {
        KEY_COUNTS.computeIfAbsent(key, k -> new AtomicLong()).incrementAndGet();
        return template.opsForValue().get(key);
    }
    
    @PostConstruct
    public void init() {
        // 每分钟输出 TOP 10 热 key
        SCHEDULER.scheduleAtFixedRate(() -> {
            KEY_COUNTS.entrySet().stream()
                .sorted(Map.Entry.&lt;String, AtomicLong&gt;comparingByValue().reversed())
                .limit(10)
                .forEach(e -> log.info("Hot Key: {} - {}", e.getKey(), e.getValue().get()));
            
            // 重置计数器
            KEY_COUNTS.clear();
        }, 1, 1, TimeUnit.MINUTES);
    }
}
```

### 方法二：使用 proxy 层统计

如果你使用 Codis 或 Twemproxy，可以在 proxy 层做统计：

```bash
# Codis 统计热点 key
curl http://codis-proxy:8080/api/stats/hotkey
```

### 方法三：Redis MONITOR 命令

```bash
# 实时监控所有命令（生产环境慎用，会影响性能）
redis-cli MONITOR | head -n 10000 > monitor.log

# 分析访问频率
cat monitor.log | awk '{print $3}' | sort | uniq -c | sort -rn | head -20
```

### 方法四：使用专业工具

```bash
# 使用 redis-faina（Facebook 开源工具）
# 先获取 MONITOR 数据
redis-cli MONITOR | head -n 100000 > monitor.log

# 分析热点 key
python redis-faina.py --input=monitor.log
```

### 方法五：Redis 6.2+ 的 CLIENT LIST

```bash
# 查看客户端连接和最近的命令
redis-cli CLIENT LIST | grep cmd=
```

## Hot Key 的解决方案

### 方案一：本地缓存 + Redis

在应用服务器本地缓存热 key，减少对 Redis 的访问：

```java
@Service
public class ProductService {
    
    private final RedisTemplate&lt;String, Product&gt; redisTemplate;
    private final Cache&lt;String, Product&gt; localCache;
    
    public ProductService(RedisTemplate&lt;String, Product&gt; redisTemplate) {
        this.redisTemplate = redisTemplate;
        // Caffeine 本地缓存
        this.localCache = Caffeine.newBuilder()
            .maximumSize(10000)
            .expireAfterWrite(10, TimeUnit.SECONDS)
            .build();
    }
    
    public Product getProduct(Long productId) {
        String key = "product:" + productId;
        
        // 1. 先查本地缓存
        Product product = localCache.getIfPresent(key);
        if (product != null) {
            return product;
        }
        
        // 2. 查 Redis
        product = redisTemplate.opsForValue().get(key);
        if (product != null) {
            // 写入本地缓存
            localCache.put(key, product);
        }
        
        return product;
    }
    
    // 更新时清除缓存
    public void updateProduct(Product product) {
        String key = "product:" + product.getId();
        redisTemplate.opsForValue().set(key, product);
        localCache.invalidate(key);
    }
}
```

**适用场景**：数据更新不频繁，但读取极其频繁（如商品详情页、配置信息）。

### 方案二：多级缓存架构

```
┌─────────────┐
│   CDN       │  ← 静态资源
└──────┬──────┘
       │
┌──────▼──────┐
│ Nginx 缓存   │  ← 接口级缓存
└──────┬──────┘
       │
┌──────▼──────┐
│ 本地缓存     │  ← 应用内存
└──────┬──────┘
       │
┌──────▼──────┐
│   Redis     │  ← 分布式缓存
└─────────────┘
```

### 方案三：热点 key 打散

把一个热 key 的访问分散到多个 key 上：

```java
// 原来：所有请求访问同一个 key
public Product getProduct(Long productId) {
    return redisTemplate.opsForValue().get("product:" + productId);
}

// 优化：将一个 key 打散成多个实例
public Product getProductWithSharding(Long productId) {
    // 随机选择一个实例
    int shard = ThreadLocalRandom.current().nextInt(SHARD_COUNT);
    return redisTemplate.opsForValue().get("product:" + productId + ":" + shard);
}

// 写入时写入所有实例
public void setProduct(Long productId, Product product) {
    for (int i = 0; i < SHARD_COUNT; i++) {
        redisTemplate.opsForValue().set("product:" + productId + ":" + i, product);
    }
}
```

**优点**：完全解决单节点瓶颈
**缺点**：数据同步复杂，更新时需要更新所有副本

### 方案四：Redis Cluster 热点 key 复制

Redis 5.0 引入了 `HOTKEY` 命令，可以找出热 key，但没有提供复制功能。

对于企业版 Redis（如腾讯云 Redis、阿里云 Redis），通常提供了热 key 复制功能：

```bash
# 开启热 key 复制（以腾讯云 Redis 为例）
redis-cli -h ip -p port HOTKEY-CONFIG SET hotkey-replica-read on
```

### 方案五：使用 Hash tag 均匀分布

如果你发现热 key 集中在某个 hash field，可以利用 hash tag 将数据打散：

```bash
# 原来：所有用户数据都存在一个 hash
HSET user:info user:1001 "{...}"
HSET user:info user:1002 "{...}"

# 优化：使用 hash tag 让 field 分布在不同槽
HSET user:info:{1} user:1001 "{...}"
HSET user:info:{2} user:1002 "{...}"
```

### 方案六：防止缓存击穿

对于热 key 过期导致的缓存击穿，使用锁或永不过期策略：

```java
public String getWithLock(String key) {
    String value = redisTemplate.opsForValue().get(key);
    
    if (value == null) {
        // 获取锁
        String lockKey = "lock:" + key;
        Boolean acquired = redisTemplate.opsForValue()
            .setIfAbsent(lockKey, "1", 10, TimeUnit.SECONDS);
        
        if (Boolean.TRUE.equals(acquired)) {
            try {
                // 查数据库
                value = loadFromDatabase(key);
                redisTemplate.opsForValue().set(key, value, 1, TimeUnit.HOURS);
            } finally {
                redisTemplate.delete(lockKey);
            }
        } else {
            // 没获取到锁，短暂等待后重试
            try {
                Thread.sleep(50);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return redisTemplate.opsForValue().get(key);
        }
    }
    
    return value;
}
```

```java
// 更优雅的方式：永不过期 + 异步更新
public String getWithNeverExpire(String key) {
    String value = redisTemplate.opsForValue().get(key);
    
    if (value == null) {
        // 加载数据，不设置过期时间
        value = loadFromDatabase(key);
        redisTemplate.opsForValue().set(key, value);
        
        // 异步更新缓存
        scheduleUpdateCache(key);
    }
    
    return value;
}
```

## Hot Key 预防 checklist

1. **热点数据分析**：上线前分析数据访问模式，预判热 key
2. **本地缓存**：对高频读取的数据增加本地缓存层
3. **打散策略**：对可拆分的数据使用多副本或分桶策略
4. **监控告警**：对 Redis QPS 和 CPU 设置异常告警
5. **压测验证**：上线前进行热点场景压测

## 总结

Hot Key 是 Redis 高并发场景下的常见问题：

1. **预防优先**：通过数据分析提前识别热 key
2. **多级缓存**：本地缓存 + Redis 是最有效的缓解方案
3. **数据打散**：将热 key 复制或拆分到多个实例
4. **防止击穿**：热 key 过期时要控制并发，避免打垮数据库

---

## 留给你的问题

假设你的系统有以下场景：

- 直播间实时在线人数展示
- 每个直播间每秒需要更新一次在线人数
- 同时在线的直播间数量：1000 个
- 每个直播间的在线人数范围：0 - 100 万人

请思考：

1. 如果把每个直播间的在线人数存储为一个 key，在高峰期可能遇到什么问题？
2. 如果 1000 个直播间的数据集中在 Redis Cluster 的 3 个节点上，如何实现负载均衡？
3. 如果需要查询「当前在线人数 TOP 10 的直播间」，Redis 的数据结构如何设计才能高效？

这道题的关键在于理解 Redis 的数据分布机制，以及如何在性能和一致性之间取得平衡。
