# Redis 集群优化：槽迁移与热点扩容

你的 Redis Cluster 从 6 个节点扩展到 12 个节点。

理论上，QPS 应该翻倍。但实际上，新增的 6 个节点几乎没有分担流量，性能提升不到 20%。

问题出在哪？

**数据迁移没有完成。**

## Redis Cluster 数据分布原理

Redis Cluster 将整个数据空间划分为 16384 个槽（slot）。每个 key 通过 CRC16 哈希计算落在哪个槽：

```
slot = CRC16(key) % 16384
```

```bash
# 查看某个 key 属于哪个槽
redis-cli CLUSTER KEYSLOT "user:10086"
# 输出：12543

# 查看槽的分布情况
redis-cli CLUSTER SLOTS
```

### 槽迁移的机制

当新增节点时，需要将部分槽迁移到新节点：

```
迁移前（6节点）：
节点1: 槽 0-2730
节点2: 槽 2731-5461
节点3: 槽 5462-8192
节点4: 槽 8193-10922
节点5: 槽 10923-13653
节点6: 槽 13654-16383

迁移后（12节点）：
新增节点7: 槽 0-1365
新增节点8: 槽 1366-2730
...
```

### 在线迁移 vs 离线迁移

| 方式 | 特点 | 影响 |
|---|---|---|
| 离线迁移 | 停止服务，备份数据，重新分配 | 服务中断，不可接受 |
| 在线迁移 | 使用 MOVED 重定向 | 最小化影响，推荐使用 |

## Redis Cluster 槽迁移实战

### 迁移前的准备工作

```bash
# 1. 查看集群状态
redis-cli --cluster info 127.0.0.1:7001

# 2. 查看槽分布
redis-cli --cluster check 127.0.0.1:7001

# 3. 查看节点信息
redis-cli CLUSTER NODES
```

### 使用 redis-cli 进行迁移

```bash
# 迁移 100 个槽从节点1到节点7
redis-cli --cluster reshard 127.0.0.1:7001 \
    --cluster-from node-id-1 \
    --cluster-to node-id-7 \
    --cluster-slots 100 \
    --cluster-timeout 60000 \
    --cluster-pipeline 100

# 交互式迁移：手动选择槽
redis-cli --cluster reshard 127.0.0.1:7001

# 查看迁移进度
redis-cli CLUSTER GETKEYSINSLOT 12543 100
```

### Java 代码控制迁移

```java
@Service
public class RedisClusterMigration {
    
    private final RedisClusterTemplate clusterTemplate;
    
    /**
     * 将指定槽从源节点迁移到目标节点
     */
    public void migrateSlots(String sourceNodeId, String targetNodeId, int slotCount) {
        // 1. 计算需要迁移的槽范围
        List&lt;Integer&gt; slots = calculateSlots(slotCount);
        
        // 2. 逐个槽迁移
        for (Integer slot : slots) {
            migrateSlot(slot, sourceNodeId, targetNodeId);
        }
    }
    
    private void migrateSlot(int slot, String sourceNodeId, String targetNodeId) {
        // 3. 设置槽状态为迁移中
        clusterTemplate.opsForCluster()
            .setSlotMigration(sourceNodeId, slot, targetNodeId);
        
        // 4. 迁移槽内的所有 key
        List&lt;String&gt; keys = clusterTemplate.getClusterOperations()
            .getKeysInSlot(slot, 1000);
        
        for (String key : keys) {
            migrateKey(key, sourceNodeId, targetNodeId);
        }
        
        // 5. 完成槽迁移
        clusterTemplate.getClusterOperations()
            .setSlotOwner(slot, targetNodeId);
    }
    
    private void migrateKey(String key, String sourceNodeId, String targetNodeId) {
        // 读取 key 的值
        Object value = clusterTemplate.opsForValue().get(key);
        
        // 写入目标节点
        clusterTemplate.opsForValue().set(key, value);
        
        // 删除源节点（如果存在）
        clusterTemplate.delete(key);
    }
}
```

## 迁移过程中的问题处理

### 问题一：MOVED 重定向过多

迁移过程中，部分 key 还在源节点，客户端访问这些 key 会收到 MOVED 响应：

```
GET user:123
-MOVED 12543 127.0.0.1:7007
```

**解决方案**：使用智能客户端，支持 MOVED 重定向：

```java
// Jedis Cluster 自动处理 MOVED
JedisCluster jedis = new JedisCluster(
    new HostAndPort("127.0.0.1", 7001),
    new JedisPoolConfig()
);

// 内部自动处理重定向
String value = jedis.get("user:123");
```

```xml
<!-- Redisson 自动处理 -->
<redisson>
    <cluster>
        <node>127.0.0.1:7001</node>
        <node>127.0.0.1:7002</node>
        <node>127.0.0.1:7003</node>
    </cluster>
</redisson>
```

### 问题二：迁移超时

槽内 key 数量多时，迁移可能超时：

```bash
# 设置更大的超时时间
redis-cli --cluster reshard 127.0.0.1:7001 \
    --cluster-timeout 300000  # 5分钟

# 使用 --cluster-slots 控制每次迁移的槽数
redis-cli --cluster reshard 127.0.0.1:7001 \
    --cluster-slots 10 \      # 每次迁移10个槽
    --cluster-pipeline 10000  # 批量获取 key
```

### 问题三：big key 迁移阻塞

大 key 的迁移会阻塞网络：

```java
// 检测大 key 并分批迁移
public void safeMigrateKey(String key, String targetNodeId) {
    // 获取 key 的大小
    Long memoryUsage = redisTemplate.opsForValue().getOperations()
        .getClusterOperations()
        .getKeySlot(key);
    
    // 如果是大 key，分批迁移
    if (memoryUsage > 10 * 1024 * 1024) { // 10MB
        migrateBigKeyInChunks(key, targetNodeId);
    } else {
        // 普通迁移
        redisTemplate.opsForCluster().migrate(key, targetNodeId);
    }
}

private void migrateBigKeyInChunks(String key, String targetNodeId) {
    // 对于 LIST 类型
    if (key.startsWith("list:")) {
        Long size = redisTemplate.opsForList().size(key);
        
        // 分批迁移，每次 1000 条
        int batchSize = 1000;
        for (int i = 0; i < size; i += batchSize) {
            List&lt;Object&gt; items = redisTemplate.opsForList()
                .range(key, i, i + batchSize - 1);
            
            // 写入目标
            if (items != null) {
                for (Object item : items) {
                    redisTemplate.opsForList().rightPush(key, item);
                }
            }
            
            // 从源删除
            redisTemplate.opsForList().trim(key, 0, size - 1);
        }
    }
}
```

## 热点 key 的集群扩容

### 问题场景

热点 key 落在单个槽，即使整个集群负载均衡，热点 key 所在的节点仍是瓶颈：

```
热点 key: "hot:product:12345" → 槽 5432 → 节点3
                            ↑
                            所有请求都打到这里
```

### 解决方案一：热点 key 复制

企业版 Redis（如腾讯云、阿里云）支持热点 key 复制：

```bash
# 以腾讯云 Redis 为例
redis-cli -h host -p port HOTKEY-CONFIG SET hotkey-replica-count 3

# 热点 key 会自动复制到 3 个节点
# 客户端访问时会被路由到不同的副本
```

### 解决方案二：本地缓存兜底

```java
@Service
public class HotKeyService {
    
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    private final Cache&lt;String, Object&gt; localCache;
    
    public HotKeyService(RedisTemplate&lt;String, Object&gt; redisTemplate) {
        this.redisTemplate = redisTemplate;
        this.localCache = Caffeine.newBuilder()
            .maximumSize(10000)
            .expireAfterWrite(1, TimeUnit.SECONDS)  // 短 TTL，保证数据新鲜
            .build();
    }
    
    public Object getHotKey(String key) {
        // 1. 先查本地缓存
        Object value = localCache.getIfPresent(key);
        if (value != null) {
            return value;
        }
        
        // 2. 查 Redis
        value = redisTemplate.opsForValue().get(key);
        
        // 3. 写本地缓存
        if (value != null) {
            localCache.put(key, value);
        }
        
        return value;
    }
}
```

### 解决方案三：热点 key 打散

把一个热点 key 拆成多个副本：

```java
public Object getHotKeyWithSharding(String key, int shardCount) {
    // 随机选择一个 shard
    int shard = ThreadLocalRandom.current().nextInt(shardCount);
    String shardedKey = key + ":" + shard;
    
    // 写入时写入所有 shard
    // 读取时随机读取一个 shard
    return redisTemplate.opsForValue().get(shardedKey);
}
```

**注意**：打散后无法保证精确的聚合查询（如 COUNT、SUM）。

## 集群健康监控

```bash
# 查看集群状态
redis-cli --cluster info 127.0.0.1:7001

# 检查所有节点
redis-cli --cluster check 127.0.0.1:7001

# 查看槽分布
redis-cli CLUSTER SLOTS

# 查看节点角色
redis-cli CLUSTER NODES
```

```java
// Java 监控
public Map&lt;String, Object&gt; getClusterHealth() {
    List&lt;RedisClusterServerCommands&gt; commands = clusterTemplate.getClusterOperations()
        .getClusterCommands();
    
    int healthyNodes = 0;
    int totalSlots = 0;
    
    for (RedisClusterServerCommands cmd : commands) {
        try {
            String info = cmd.info("replication");
            if (info != null) {
                healthyNodes++;
            }
        } catch (Exception e) {
            // 节点不可用
        }
    }
    
    return Map.of(
        "healthyNodes", healthyNodes,
        "totalSlots", totalSlots,
        "healthStatus", healthyNodes == 6 ? "OK" : "DEGRADED"
    );
}
```

## 总结

Redis Cluster 的优化重点在于：

1. **槽迁移要平滑**：使用在线迁移机制，避免服务中断
2. **处理 MOVED 重定向**：使用智能客户端，自动处理重定向
3. **大 key 要谨慎**：分批迁移，避免阻塞
4. **热点 key 要单独处理**：本地缓存 + 复制 + 打散
5. **持续监控**：关注节点状态、槽分布、热点 key

---

## 留给你的问题

假设你的 Redis Cluster 有以下情况：

- 6 个主节点，每个节点 16GB 内存
- 当前总数据量 60GB
- 热点 key「product:hot:1001」占用 8GB 内存
- 其他数据都是普通数据

请思考：

1. 这个热点 key 会造成什么问题？即使整个集群负载均衡，热点 key 所在的节点会怎样？
2. 如果产品经理要求「热点 key 所在的节点 CPU 不能超过 50%」，你有哪些方案？
3. 如果热点 key 是不断变化的（比如每分钟都会变），如何动态发现和处理热点 key？
4. 如果你的 Redis Cluster 不支持热点复制功能，你如何在应用层实现类似的效果？

这道题的关键在于理解 Redis Cluster 的数据分布机制，以及如何处理单点热点问题。
