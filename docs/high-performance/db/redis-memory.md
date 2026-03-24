# Redis 内存碎片与内存优化

你执行 `INFO memory`，看到这样的输出：

```
used_memory: 1073741824          # 实际使用 1GB
used_memory_human: 1.00G
used_memory_rss: 1610612736     # 操作系统显示 1.5GB
used_memory_rss_human: 1.50G
mem_fragmentation_ratio: 1.50   # 内存碎片率 1.5
```

Redis 明明只存了 1GB 数据，但操作系统显示占用了 1.5GB 内存。

**多出来的 0.5GB 去了哪里？**

答案是：**内存碎片**。

## 什么是内存碎片？

Redis 的内存分配由 jemalloc（Linux 默认）或 tcmalloc 负责。这些内存分配器以「块」（chunk）为单位分配内存，而不是按需分配。

当数据被写入、修改、删除后，已分配的内存空间可能无法被完全利用：

```
| 数据A (100B) | 删除 | 数据B (50B) | 删除 | 数据C (150B) |
|███████░░░░░░|░░░░░|███████░░░░░|░░░░░|████████████░░|

░ = 碎片空间，无法被新数据利用
```

### 内存碎片的来源

1. **删除操作**：删除数据后，释放的空间可能无法被新数据利用
2. **键值对大小变化**：SET 一个更大的值，可能需要额外的内存块
3. **过期键删除**：惰性删除或定期删除后，留下碎片空间
4. **jemalloc 分配机制**：jemalloc 会预分配一些空间用于快速分配

### 碎片率的计算

```
mem_fragmentation_ratio = used_memory_rss / used_memory
```

| 碎片率 | 含义 |
|---|---|
| 1.0 - 1.1 | 正常，几乎无碎片 |
| 1.1 - 1.5 | 可接受，轻微碎片 |
| 1.5 - 2.0 | 警告，中度碎片 |
| > 2.0 | 严重，需要处理 |

## 内存碎片的影响

### 1. 内存浪费

碎片率 1.5 意味着你有 33% 的内存是「无效」的。如果你的 Redis 实例配置了 10GB 内存限制，实际只能使用约 6.7GB 数据。

### 2. OOM 风险

当 Redis 内存接近 `used_memory_rss` 时，操作系统可能会触发 OOM Killer。即使 `used_memory` 还没达到限制。

### 3. 性能下降

大量内存碎片可能导致内存分配变慢（jemalloc 需要寻找合适的空闲块）。

## 如何检测内存碎片？

```bash
# 查看内存信息
redis-cli INFO memory | grep -E "(used_memory|used_memory_rss|mem_fragmentation)"

# 查看详细统计
redis-cli INFO stats | grep -E "(mem_fragmentation)"
```

## 内存碎片优化方案

### 方案一：重启 Redis

最简单粗暴的方案。重启后，Redis 会重新加载数据，内存连续，碎片率重置为 1.0。

**缺点**：
- 服务中断
- 如果没有持久化，数据丢失
- 预热时间长

**优化**：使用 Redis 主从复制，重启从节点，不影响服务。

```bash
# 1. 从节点重启
redis-cli DEBUG SEGFAULT  # 在从节点执行，触发重启

# 2. 等待从节点恢复
redis-cli -h slave-ip SLAVE NO ONE  # 停止复制

# 3. 主节点切从节点（可选）
```

### 方案二：activedefrag 自动内存碎片整理

Redis 4.0+ 提供了 `activedefrag` 功能，可以在运行时自动整理内存碎片：

```bash
# 开启自动碎片整理
redis-cli CONFIG SET activedefrag yes

# 配置触发阈值
redis-cli CONFIG SET active-defrag-threshold-lower 100   # 碎片率超过 100% 时开始整理
redis-cli CONFIG SET active-defrag-threshold-upper 100    # 碎片率低于 100% 时停止整理
redis-cli CONFIG SET active-defrag-ignore-bytes 100000000 # 碎片超过 100MB 才开始整理
redis-cli CONFIG SET active-defrag-max-scan-fields 1000  # 单次扫描的最大 field 数
```

**配置示例**：

```bash
# redis.conf
activedefrag yes
active-defrag-threshold-lower 100
active-defrag-threshold-upper 100
active-defrag-ignore-bytes 100mb
active-defrag-max-scan-fields 1000
active-defrag-cycle-min 25   # 碎片整理占用 CPU 的最小比例
active-defrag-cycle-max 75   # 碎片整理占用 CPU 的最大比例
```

**监控碎片整理进度**：

```bash
redis-cli INFO memory | grep -E "(active|defrag)"
# 输出示例：
# activedefrag_running: 1  # 正在运行
# active_defrag_key_hits: 12345    # 整理过程中访问的 key 数
# active_defrag_key_misses: 123    # 整理过程中未访问的 key 数
```

### 方案三：安全重启（CLUSTER SETSLOT）

对于 Redis Cluster，可以使用 `CLUSTER SETSLOT` 命令安全迁移槽位，然后重启：

```bash
# 1. 将某个节点的槽位迁移到其他节点
redis-cli CLUSTER SETSLOT 0 node-id-2
redis-cli CLUSTER SETSLOT 1 node-id-2
...

# 2. 等待迁移完成
redis-cli CLUSTER NODES

# 3. 重启空槽节点
```

### 方案四：避免内存碎片产生

从根本上减少碎片的产生：

1. **避免大量删除操作**：使用 SCAN 逐步删除，避免一次性删除大量 key
2. **使用合理的数据结构**：STRING 类型比复杂数据结构碎片率低
3. **控制 key 的数量**：大量小 key 更容易产生碎片
4. **使用整数作为 value**：整数内存效率更高

```java
// 渐进式删除大量 key
public void safeDeleteByPattern(String pattern) {
    try (Scanner scan = redisTemplate.getScanModel().getScanner(pattern).iterator()) {
        List&lt;String&gt; keys = new ArrayList&lt;&gt;();
        int batchSize = 100;
        
        while (scan.hasNext()) {
            keys.add(scan.next());
            if (keys.size() >= batchSize) {
                redisTemplate.delete(keys);
                keys.clear();
                // 暂停一下，让 Redis 有喘息时间
                try {
                    Thread.sleep(10);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }
        
        // 删除剩余的 key
        if (!keys.isEmpty()) {
            redisTemplate.delete(keys);
        }
    }
}
```

## 内存使用优化

除了碎片问题，优化内存使用本身也很重要。

### 1. 使用合适的数据类型

| 数据类型 | 适用场景 | 内存效率 |
|---|---|---|
| STRING | 简单字符串、序列化对象 | 中等 |
| HASH | 对象属性，可单独访问 | 高（比多个 STRING 省内存） |
| LIST | 有序列表，按索引访问 | 高 |
| SET | 无序集合 | 高 |
| ZSET | 有序集合，按分数排序 | 中等 |
| BITMAP | 二值状态统计 | 极高 |
| HyperLogLog | 基数统计 | 极高（误差约 0.81%） |

```java
// 统计用户登录状态：1 亿用户
// 方案 1：使用 SET，每个用户一个 key
// 内存：100,000,000 × 50B ≈ 5GB

// 方案 2：使用 BITMAP
// 内存：100,000,000 bits ≈ 12.5MB
public class LoginBitmap {
    private final RedisTemplate&lt;String, byte[]&gt; redisTemplate;
    
    public void setLogin(Long userId) {
        long offset = userId;
        redisTemplate.opsForValue().setBit("login:bitmap", offset, true);
    }
    
    public boolean isLogin(Long userId) {
        return Boolean.TRUE.equals(
            redisTemplate.opsForValue().getBit("login:bitmap", userId)
        );
    }
    
    public long countLogin() {
        Long count = redisTemplate.execute((RedisCallback&lt;Long&gt;) connection -> 
            connection.stringCommands().bitCount("login:bitmap".getBytes())
        );
        return count != null ? count : 0;
    }
}
```

### 2. 开启内存优化选项

```bash
# 启用 ziplist（压缩列表）
redis-cli CONFIG SET hash-max-ziplist-entries 512
redis-cli CONFIG SET hash-max-ziplist-value 64
redis-cli CONFIG SET list-max-ziplist-size -2
redis-cli CONFIG SET zset-max-ziplist-entries 128
redis-cli CONFIG SET zset-max-ziplist-value 64

# 这些参数可以让小数据量使用更紧凑的编码
```

### 3. 使用 RDB 压缩

Redis 6.0+ 支持 AOF 持久化时的压缩：

```bash
# 开启 AOF 压缩
redis-cli CONFIG SET aof-use-rdb-preamble yes
```

## 内存监控

```bash
# 查看内存使用详情
redis-cli INFO memory

# 查看大 key（可能导致内存不均）
redis-cli --bigkeys

# 查看 key 统计
redis-cli INFO keyspace
```

```java
// 代码层面监控
public Map&lt;String, Object&gt; getMemoryStats() {
    Properties info = redisTemplate.getConnectionFactory()
        .getConnection()
        .serverCommands()
        .info("memory");
    
    return Map.of(
        "used_memory", Long.parseLong(info.getProperty("used_memory")),
        "used_memory_rss", Long.parseLong(info.getProperty("used_memory_rss")),
        "mem_fragmentation_ratio", Double.parseDouble(info.getProperty("mem_fragmentation_ratio")),
        "maxmemory", Long.parseLong(info.getProperty("maxmemory")),
        "maxmemory_policy", info.getProperty("maxmemory_policy")
    );
}
```

## 总结

Redis 内存问题是生产环境中常见的问题：

1. **理解碎片来源**：删除操作、数据变化、分配器机制
2. **善用自动整理**：Redis 4.0+ 的 activedefrag 是利器
3. **预防优先**：避免大量删除、使用合适的数据结构
4. **持续监控**：关注内存使用率和碎片率，及时告警

---

## 留给你的问题

假设你的 Redis 实例有以下情况：

- `used_memory`: 8GB
- `used_memory_rss`: 12GB
- `mem_fragmentation_ratio`: 1.5
- 业务要求：Redis 不能中断
- 可用资源：另外有一台服务器，可以部署 Redis 从节点

请思考：

1. 如果 `activedefrag` 在后台整理内存，会对 Redis 性能造成影响吗？如何在不影响业务的情况下完成碎片整理？
2. 如果碎片整理后，内存仍然不够用（8GB < 实际需要 10GB），有哪些优化手段？
3. 如果你的 Redis 没有开启持久化，重启会丢失数据，如何安全地进行内存优化？

这道题的关键在于理解 Redis 的内存管理机制，以及如何在生产环境中安全地进行优化操作。
