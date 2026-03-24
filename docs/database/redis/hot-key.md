# 热点数据发现与处理

双十一零点，某款爆品开始秒杀。
瞬间，10 万 QPS 打在同一台 Redis 节点上。

Redis 集群没有垮，因为数据分片了。
但这款商品的缓存 key，正好落在同一个节点上。

这个节点被打爆了。

这就是**热点 key 问题**。

## 什么是热点 key？

热点 key 是指：**被高频访问的少量 key**，它们承受了大部分的访问压力。

```
正常情况：
Key1 ──▶ 100 QPS
Key2 ──▶ 100 QPS
Key3 ──▶ 100 QPS

热点情况：
Key1 ──▶ 100000 QPS  ← 热点！
Key2 ──▶ 100 QPS
Key3 ──▶ 100 QPS
```

## 热点 key 的危害

| 危害 | 说明 |
|-----|------|
| 单节点压力 | 热点 key 集中在某个节点 |
| Redis 卡顿 | CPU 打满，响应变慢 |
| 雪崩风险 | 一个 key 影响整个系统 |
| 服务降级 | 触发限流、熔断 |

## 热点 key 是怎么产生的？

### 场景一：明星效应

```
明星结婚、明星塌房
瞬间千万粉丝查询同一个明星的资料
```

### 场景二：商品秒杀

```
某商品 0 点开抢
所有用户同时访问同一个商品详情页
```

### 场景三：热点新闻

```
突发事件
大量用户同时刷新同一新闻
```

## 热点 key 发现方案

### 方案一：客户端统计

```java
/**
 * 客户端热点 key 统计
 * 
 * 在 Redis 客户端拦截所有请求，统计 key 的访问频率
 */
public class HotKeyDetector {
    
    // 本地滑动窗口统计
    private ConcurrentHashMap&lt;String, SlidingWindow&gt; keyStats = new ConcurrentHashMap&lt;&gt;();
    
    // 每分钟超过 1000 次访问的 key
    private static final int HOT_KEY_THRESHOLD = 1000;
    
    /**
     * 统计 key 访问
     */
    public void recordAccess(String key) {
        SlidingWindow window = keyStats.computeIfAbsent(key, k -> new SlidingWindow(60));
        window.add();
    }
    
    /**
     * 检查是否是热点 key
     */
    public boolean isHotKey(String key) {
        SlidingWindow window = keyStats.get(key);
        if (window == null) {
            return false;
        }
        return window.getCount() > HOT_KEY_THRESHOLD;
    }
    
    /**
     * 获取热点 key 列表
     */
    public List&lt;String&gt; getHotKeys() {
        return keyStats.entrySet().stream()
            .filter(e -> e.getValue().getCount() > HOT_KEY_THRESHOLD)
            .map(Map.Entry::getKey)
            .collect(Collectors.toList());
    }
    
    /**
     * 滑动窗口实现
     */
    static class SlidingWindow {
        private final int windowSize;
        private final AtomicIntegerArray slots;
        
        public SlidingWindow(int windowSize) {
            this.windowSize = windowSize;
            this.slots = new AtomicIntegerArray(windowSize);
        }
        
        public void add() {
            int slot = (int) (System.currentTimeMillis() / 1000) % windowSize;
            slots.incrementAndGet(slot);
        }
        
        public long getCount() {
            long sum = 0;
            for (int i = 0; i < windowSize; i++) {
                sum += slots.get(i);
            }
            return sum;
        }
    }
}
```

### 方案二：Redis 监控

```bash
# 使用 Redis MONITOR 监控
redis-cli MONITOR | grep "GET\|SET" | awk '{print $3}' | sort | uniq -c | sort -rn | head -20
```

```java
/**
 * MONITOR 分析工具
 */
public class MonitorAnalyzer {
    
    /**
     * 分析热点 key
     */
    public List&lt;HotKey&gt; analyzeHotKeys(String redisHost, int redisPort, int durationSeconds) {
        Map&lt;String, Long&gt; counter = new ConcurrentHashMap&lt;&gt;();
        
        // 启动 MONITOR 收集
        Process process = new ProcessBuilder(
            "redis-cli", "-h", redisHost, "-p", String.valueOf(redisPort), "MONITOR"
        ).start();
        
        long startTime = System.currentTimeMillis();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(process.getInputStream()))) {
            
            String line;
            while (System.currentTimeMillis() - startTime < durationSeconds * 1000) {
                line = reader.readLine();
                if (line != null && line.contains("GET")) {
                    // 提取 key
                    String key = extractKey(line);
                    counter.merge(key, 1L, Long::sum);
                }
            }
        }
        
        // 排序返回
        return counter.entrySet().stream()
            .sorted((a, b) -> b.getValue().compareTo(a.getValue()))
            .limit(20)
            .map(e -> new HotKey(e.getKey(), e.getValue()))
            .collect(Collectors.toList());
    }
    
    private String extractKey(String line) {
        // 从 MONITOR 输出中提取 key
        // 格式：1587654321.123456 [0 127.0.0.1:12345] "GET" "key:value"
        int keyStart = line.lastIndexOf("\"GET\" \"") + 7;
        int keyEnd = line.lastIndexOf("\"", line.lastIndexOf("\"") - 1);
        return line.substring(keyStart, keyEnd);
    }
}
```

### 方案三：Redis 4.0+ 的 Hot Keys

Redis 4.0 引入了 `HOTKEYS` 命令：

```bash
# 使用 redis-cli
redis-cli --hotkeys

# 输出示例
# Scanning 5 known keys for hot keys...
# Hot key "product:hot:123" found with counter 1234567
```

### 方案四：Redis 5.0+ 的 MEMORY USAGE

```java
/**
 * 通过 SCAN + OBJECT 命令发现大 key 和热 key
 */
public class KeyAnalyzer {
    
    private Jedis jedis;
    
    /**
     * 分析所有 key 的访问频率
     */
    public Map&lt;String, Long&gt; analyzeKeyAccessFrequency() {
        Map&lt;String, Long&gt; frequencies = new HashMap&lt;&gt;();
        
        // SCAN 所有 key
        ScanParams params = new ScanParams().count(100);
        String cursor = "0";
        
        do {
            ScanResult&lt;String&gt; result = jedis.scan(cursor, params);
            cursor = result.getCursor();
            
            for (String key : result.getResult()) {
                // 使用 OBJECT 命令获取 key 的相关信息
                String encoding = jedis.objectEncoding(key);
                Long refcount = jedis.objectRefcount(key);
                
                // 统计逻辑
                if (refcount != null && refcount > 1) {
                    frequencies.merge(key, refcount, Long::sum);
                }
            }
        } while (!"0".equals(cursor));
        
        return frequencies;
    }
}
```

## 热点 key 处理方案

### 方案一：热点 key 分散

**原理**：将一个热点 key 拆分多个副本，分散访问压力。

```
热点 key：
product:hot:12345 ──▶ 100000 QPS

拆分后：
product:hot:12345:1 ──▶ 25000 QPS
product:hot:12345:2 ──▶ 25000 QPS
product:hot:12345:3 ──▶ 25000 QPS
product:hot:12345:4 ──▶ 25000 QPS
```

```java
/**
 * 热点 key 分散
 */
public class HotKeySharding {
    
    private Jedis jedis;
    
    /**
     * 设置热点 key（多个副本）
     */
    public void setHotKey(String key, String value, int replicaCount) {
        // 写入所有副本
        for (int i = 1; i <= replicaCount; i++) {
            jedis.set(key + ":" + i, value);
        }
    }
    
    /**
     * 读取热点 key（随机副本）
     */
    public String getHotKey(String key, int replicaCount) {
        int index = ThreadLocalRandom.current().nextInt(1, replicaCount + 1);
        return jedis.get(key + ":" + index);
    }
}
```

### 方案二：热点 key 本地缓存

**原理**：热点 key 缓存在应用本地，减少 Redis 访问。

```java
/**
 * 热点 key 本地缓存
 */
public class LocalHotKeyCache {
    
    // 使用 Caffeine 作为本地缓存
    private Cache&lt;String, String&gt; localCache;
    private Jedis jedis;
    
    public LocalHotKeyCache() {
        localCache = Caffeine.newBuilder()
            .maximumSize(1000)
            .expireAfterWrite(1, TimeUnit.MINUTES)
            .build();
    }
    
    /**
     * 读取热点 key
     */
    public String getHotKey(String key) {
        // 1. 先查本地缓存
        String value = localCache.getIfPresent(key);
        if (value != null) {
            return value;
        }
        
        // 2. 查 Redis
        value = jedis.get(key);
        if (value != null) {
            // 3. 回填本地缓存
            localCache.put(key, value);
        }
        
        return value;
    }
    
    /**
     * 更新热点 key
     */
    public void setHotKey(String key, String value) {
        // 1. 更新 Redis
        jedis.set(key, value);
        
        // 2. 更新本地缓存
        localCache.put(key, value);
    }
}
```

### 方案三：热点 key 永不过期 + 后台更新

**原理**：热点 key 不设置过期时间，后台异步更新。

```java
/**
 * 热点 key 永不过期 + 异步更新
 */
public class HotKeyNoExpire {
    
    private Jedis jedis;
    
    /**
     * 获取热点 key
     */
    public String getHotKey(String key) {
        String value = jedis.get(key);
        if (value != null) {
            // 触发异步更新
            CompletableFuture.runAsync(() -> refreshHotKey(key));
        }
        return value;
    }
    
    /**
     * 异步刷新热点 key
     */
    private void refreshHotKey(String key) {
        try {
            // 从数据库加载最新数据
            String latestValue = db.loadLatest(key);
            // 更新 Redis（不设置过期时间）
            jedis.set(key, latestValue);
        } catch (Exception e) {
            log.warn("刷新热点 key 失败: {}", key, e);
        }
    }
}
```

### 方案四：使用 Redis Cluster + 热点 key 识别

```java
/**
 * Redis Cluster 热点 key 处理
 */
public class ClusterHotKeyHandler {
    
    private JedisCluster jedisCluster;
    
    /**
     * 识别热点 key 所在的节点
     */
    public String getHotKeyNode(String key) {
        // 计算槽
        int slot = JedisCluster.getCRC16(key) % 16384;
        
        // 获取槽对应的节点
        Map&lt;Integer, JedisPool&gt; slots = jedisCluster.getSlots();
        JedisPool pool = slots.get(slot);
        
        if (pool != null) {
            try (Jedis jedis = pool.getResource()) {
                return jedis.getClient().getHost() + ":" + jedis.getClient().getPort();
            }
        }
        return null;
    }
}
```

## 监控告警

```yaml
# Prometheus 告警规则
groups:
  - name: redis_hot_key_alerts
    rules:
      - alert: RedisHotKeyDetected
        expr: redis_key_hits > 100000
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "检测到热点 key，访问频率 {{ $value }} 次/分钟"
          description: "热点 key: {{ $labels.key }}"
          
      - alert: RedisNodeHighLoad
        expr: redis_node_commands > 100000
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Redis 节点负载过高"
```

## 总结

热点 key 是高并发系统的常见问题：

- **发现**：客户端统计、MONITOR 分析、Redis 内置命令
- **处理**：热点分散、本地缓存、永不过期
- **预防**：监控告警、提前识别

## 留给你的问题

热点 key 本地缓存可以减少 Redis 压力，但可能导致数据短暂不一致。

**如果商品价格是一个热点 key，用户修改了价格，本地缓存中的旧价格还能被看到。这个问题如何解决？**
