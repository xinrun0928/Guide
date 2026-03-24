# 热点数据探测与自动扩容

你知道双十一最热门的商品是什么吗？

不是那些普通的打折商品，而是——iPhone、茅台、PS5 这种全民抢购的硬通货。

这类商品的特点是：**全中国几百万用户同时抢同一批库存**。几百万请求打到同一个 Redis key 上，单机 Redis 被打爆了。

这就是热点数据的威力。

## 热点数据的挑战

普通数据的访问分布是均匀的，每个 key 的访问量差不多。但热点数据完全不同——**20% 的 key 占了 80% 的访问量**。

如果这 20% 的热点 key 恰好集中在一个 Redis 节点上，单机 Redis 的 CPU 和网卡都会被打满。

## 热点探测方法

### 方法一：客户端统计

在客户端代码中，对每个 key 的访问次数做计数，定期上报到统计服务。

```java
@Service
public class HotKeyDetector {

    private ConcurrentHashMap&lt;String, AtomicLong&gt; localCounter = new ConcurrentHashMap&lt;&gt;();

    public Object getValue(String key) {
        // 计数
        localCounter.computeIfAbsent(key, k -> new AtomicLong()).incrementAndGet();

        // 定时上报（可以用定时任务）
        if (shouldReport()) {
            reportHotKeys();
        }

        return redis.get(key);
    }

    private void reportHotKeys() {
        // 只上报计数超过阈值的 key
        localCounter.entrySet().stream()
            .filter(e -> e.getValue().get() > HOT_THRESHOLD)
            .forEach(e -> reportToCenter(e.getKey(), e.getValue().get()));
    }
}
```

### 方法二：Redis 端统计

Redis 4.0+ 提供了 `HOTKEYS` 子命令，可以直接统计热点 key。

```bash
redis-cli --hotkeys

# 或者使用 redis-cli info 命令查看 keyspace
redis-cli info keyspace
```

### 方法三：独立热点探测服务

生产环境推荐使用独立服务采集热点数据，比如阿里云的 HotKey 或者自研的探测系统。

```
┌─────────────────────────────────────────────────────────┐
│                     流量请求                            │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   Redis Cluster                         │
│         ┌────────┐  ┌────────┐  ┌────────┐             │
│         │ Node 1 │  │ Node 2 │  │ Node 3 │             │
│         └────────┘  └────────┘  └────────┘             │
└─────────────────────────┬───────────────────────────────┘
                          │ MONITOR 命令采样
                          ▼
┌─────────────────────────────────────────────────────────┐
│              热点探测服务（独立部署）                      │
│              分析命令频率，识别热点 key                    │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              热点数据处理（多副本/降级）                   │
└─────────────────────────────────────────────────────────┘
```

## 热点数据自动扩容

识别出热点 key 后，需要对热点 key 做特殊处理。

### 方案一：热点 key 多副本

将热点 key 的多个副本分散到不同 Redis 节点：

```java
@Service
public class HotKeyService {

    // 热点 key 副本数
    private static final int REPLICA_COUNT = 4;

    public String getHotValue(String key) {
        // 热点 key 加随机后缀，分散到不同节点
        int replicaIndex = ThreadLocalRandom.current().nextInt(REPLICA_COUNT);
        String replicaKey = key + ":replica:" + replicaIndex;

        String value = redis.get(replicaKey);
        if (value == null) {
            // 查主 key，回填所有副本
            value = redis.get(key);
            if (value != null) {
                for (int i = 0; i < REPLICA_COUNT; i++) {
                    redis.setex(key + ":replica:" + i, 60, value);
                }
            }
        }
        return value;
    }
}
```

### 方案二：读写分离

写操作只写主节点，读操作可以分散到从节点。

```java
public String getValue(String key) {
    // 读从节点（可能有延迟，但对热点数据可以接受）
    return redis slaveOf(key);
}

public void setValue(String key, String value) {
    // 写主节点
    redis.master.setex(key, 3600, value);
}
```

### 方案三：本地缓存兜底

热点数据同时存 Redis 和本地缓存，优先读本地：

```java
@Service
public class HotKeyService {

    private LoadingCache&lt;String, String&gt; localCache = Caffeine.newBuilder()
        .maximumSize(10000)
        .expireAfterWrite(10, TimeUnit.SECONDS)
        .build();

    public String getHotValue(String key) {
        // 第一步：本地缓存
        String value = localCache.getIfPresent(key);
        if (value != null) {
            return value;
        }

        // 第二步：Redis
        value = redis.get(key);
        if (value != null) {
            localCache.put(key, value);
        }

        return value;
    }
}
```

## 热点 key 的治理策略

### 策略一：热 key 拆分

将一个 key 拆成多个 key，分散到不同节点。

```java
// 原始请求：查询商品 id=1 的库存
// 拆分后：库存 key = "stock:" + (productId % N)

// 写操作：更新所有分片
public void updateStock(Long productId, Integer stock) {
    int shardCount = 4;
    for (int i = 0; i < shardCount; i++) {
        String key = "stock:" + productId + ":" + i;
        redis.set(key, stock);
    }
}

// 读操作：取所有分片求和
public Integer getStock(Long productId) {
    int shardCount = 4;
    int total = 0;
    for (int i = 0; i < shardCount; i++) {
        String key = "stock:" + productId + ":" + i;
        total += (Integer) redis.get(key);
    }
    return total;
}
```

### 策略二：热点数据降级

热点 key 不可用时，降级到本地缓存或返回默认值。

```java
public String getValue(String key) {
    try {
        return redis.get(key);
    } catch (Exception e) {
        // Redis 异常，降级
        log.warn("Redis 异常，降级到本地缓存: {}", key);
        return localCache.getIfPresent(key);
    }
}
```

### 策略三：主动预热

系统启动时，预先将热点数据加载到缓存。

```java
@PostConstruct
public void preloadHotData() {
    log.info("开始预热热点数据...");

    // 从数据库或配置中心加载热点数据
    List&lt;HotKey&gt; hotKeys = hotKeyConfig.getHotKeys();

    for (HotKey hotKey : hotKeys) {
        String value = database.getValue(hotKey.getKey());
        if (value != null) {
            // 同时写 Redis 和本地缓存
            redis.setex(hotKey.getKey(), hotKey.getTtl(), value);
            localCache.put(hotKey.getKey(), value);
        }
    }

    log.info("预热完成，共加载 {} 个热点 key", hotKeys.size());
}
```

## 面试追问方向

- 热点数据和普通数据怎么区分？（答：通过访问频率统计，访问量超过阈值的为热点数据）
- 热点 key 多副本会不会有数据不一致问题？（答：对于只读热点数据，没有问题；对于可写数据，需要注意一致性）
- Redis Cluster 下热点 key 怎么分布？（答：使用 hash tag 可以将多个相关 key 打到同一个 slot）
- 如何防止热点 key 被攻击？（答：限流 + 热点数据降级 + 多副本分散）

## 小结

热点数据治理是一个系统性问题：

1. **探测**：多维度采集热点 key（客户端、Redis 端、独立服务）
2. **识别**：设定阈值，识别真正的热点
3. **分散**：多副本、读写分离、本地缓存
4. **治理**：热 key 拆分、降级、预热

热点数据治理的目标是：**让热点数据的访问分散到多个节点，不要集中在单机上。**

没有银弹，只有根据业务特点选择合适的方案。
