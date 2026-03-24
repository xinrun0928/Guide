# Redis 大 key 发现与解决方案

凌晨 2 点，你的监控系统报警：Redis 内存使用率超过 90%。

你登录 Redis 排查，执行 `INFO memory` 发现 `used_memory_human` 确实很高。但这个内存是被谁占用的？哪些 key 吃掉了内存？

你开始翻日志，却发现没有任何异常流量。**问题可能藏在一个巨大的 key 里。**

这就是 Redis 开发中最容易被忽视的问题——**大 key**。

## 什么是大 key？

Redis 的 key 可以存储字符串、列表、哈希、集合、有序集合等多种数据类型。当某个 key 的 value 占用空间过大，就成了「大 key」。

具体多大算「大」？

| 数据类型 | 判定标准 |
|---|---|
| STRING | value 超过 10KB |
| LIST/HASH/SET/ZSET | 元素数量超过 10000 或总大小超过 10MB |

但这个标准不是绝对的，要根据业务场景灵活判断。

## 大 key 的危害

你以为大 key 只是占内存？它的危害远不止于此。

### 1. 内存空间不均

Redis 的内存分配是按容量分桶的。如果你的大 key 集中在某个桶，会导致这个桶的内存使用率远高于其他桶，形成「内存碎片」的假象。

```bash
# 查看 Redis 内存详情
redis-cli INFO memory | grep -E "(used_memory|mem_fragmentation)"
```

### 2. 操作阻塞

这是最严重的问题。

Redis 是单线程模型，当你对一个大 key 执行操作（GET、SMEMBERS、LRANGE 等），这个操作会阻塞整个 Redis，直到完成。

```bash
# 查看 Redis 的命令耗时统计
redis-cli INFO commandstats | grep -E "(cmdstat_get|cmdstat_lrange|cmdstat_hgetall)"
```

比如 `LRANGE list_key 0 -1`，如果 list_key 包含 100 万个元素，这个命令可能阻塞几秒钟——这段时间内，Redis 拒绝服务。

### 3. 网络阻塞

大 key 的传输会占用大量带宽。如果从 Redis 到客户端的网络带宽有限，大 key 会拖慢其他正常请求。

### 4. 集群数据倾斜

在 Redis Cluster 模式下，大 key 会导致数据在槽间分布不均。某些节点的内存使用率远高于其他节点，无法充分发挥集群的扩展能力。

## 如何发现大 key？

### 方法一：Redis 内置命令（不推荐用于生产环境）

```bash
# 扫描所有 key（阻塞操作，不推荐）
redis-cli --scan | xargs -I {} redis-cli MEMORY USAGE "{}"
```

这种方式简单粗暴，但在生产环境中执行会阻塞 Redis。

### 方法二：使用 SCAN 替代 KEYS

```bash
# 使用 SCAN 游走扫描（非阻塞，每次扫描一部分）
redis-cli --scan --pattern "*" | while read key; do
    size=$(redis-cli MEMORY USAGE "$key" 2>/dev/null)
    if [ "$size" != "" ] && [ "$size" -gt 10485760 ]; then  # 10MB
        echo "$key: $size bytes ($(echo "scale=2; $size/1024/1024" | bc) MB)"
    fi
done
```

### 方法三：Redis RDB 分析工具

使用 `redis-rdb-tools` 分析 RDB 文件：

```bash
# 生成内存报告
rdb -c memory dump.rdb --bytes 10485760 -f memory_report.csv

# 查看 TOP 10 大 key
cat memory_report.csv | sort -t',' -k3 -rn | head -10
```

### 方法四：阿里云的 redis-full-checker

```bash
# 使用大 key 分析工具
redis-full-checker --host 127.0.0.1 --port 6379 \
    --scan --bigkey-threshold 10485760
```

## 大 key 的解决方案

### 方案一：拆分大 key

把大 key 拆成多个小 key：

```bash
# 原来：一个 biglist 包含所有数据
LRANGE biglist 0 -1

# 拆分后：按时间/类别分桶
LPUSH biglist:2024-01 "data1"
LPUSH biglist:2024-02 "data2"
LPUSH biglist:2024-03 "data3"
```

```java
// Java 示例：分桶存储用户行为数据
public void saveUserAction(Long userId, String action) {
    String bucket = "user_actions:" + (userId % 100);
    redisTemplate.opsForList().leftPush(bucket, action);
}

// 查询时合并多个桶
public List&lt;String&gt; getUserActions(Long userId) {
    List&lt;String&gt; result = new ArrayList&lt;&gt;();
    for (int i = 0; i < 100; i++) {
        List&lt;String&gt; bucket = redisTemplate.opsForList().range(
            "user_actions:" + i, 0, -1
        );
        if (bucket != null) {
            result.addAll(bucket);
        }
    }
    return result;
}
```

### 方案二：压缩存储

对于字符串类型的大 key，考虑压缩：

```java
public void saveLargeData(String key, byte[] data) {
    // 使用 gzip 压缩
    ByteArrayOutputStream baos = new ByteArrayOutputStream();
    try (GZIPOutputStream gzos = new GZIPOutputStream(baos)) {
        gzos.write(data);
    }
    byte[] compressed = baos.toByteArray();
    redisTemplate.opsForValue().set(key, compressed);
    
    // 存储压缩标记，方便读取时解压
    redisTemplate.opsForValue().set(key + ":compressed", "1");
}
```

### 方案三：使用合适的数据结构

| 原结构 | 问题 | 优化 |
|---|---|---|
| STRING（大 JSON） | 每次修改都要序列化/反序列化整个 JSON | 使用 Hash 字段存储各个属性 |
| LIST（无限增长） | 越来越大，查询效率低 | 使用 ZSET 按时间戳排序，定期归档 |
| SET（大量成员） | 内存占用高 | 使用 BITMAP 或 HyperLogLog（如果适用） |

```java
// 原来：存储用户画像为 JSON 字符串
public void saveUserProfile(Long userId, UserProfile profile) {
    String json = JSON.toJSONString(profile);
    redisTemplate.opsForValue().set("user:profile:" + userId, json);
}

// 优化：使用 Hash 存储
public void saveUserProfile(Long userId, UserProfile profile) {
    String key = "user:profile:" + userId;
    redisTemplate.opsForHash().putAll(key, Map.of(
        "name", profile.getName(),
        "age", String.valueOf(profile.getAge()),
        "email", profile.getEmail()
    ));
}

// 按字段读取，而不是读取整个 JSON
public String getUserName(Long userId) {
    return (String) redisTemplate.opsForHash().get("user:profile:" + userId, "name");
}
```

### 方案四：定期清理与归档

```java
// 定时归档：把历史数据迁移到 MySQL 或 HBase
public void archiveOldData(String date) {
    // 扫描指定日期的 key
    Set&lt;String&gt; keys = redisTemplate.keys("data:*:" + date);
    if (keys == null || keys.isEmpty()) {
        return;
    }
    
    for (String key : keys) {
        // 读取数据
        String value = redisTemplate.opsForValue().get(key);
        
        // 写入归档存储
        archiveToHBase(key, value);
        
        // 删除 Redis 中的旧数据
        redisTemplate.delete(key);
    }
}
```

### 方案五：开启 lazyfree 机制

Redis 4.0+ 提供了 lazyfree 机制，在后台异步删除大 key，避免阻塞：

```bash
# 配置 redis.conf
lazyfree-lazy-eviction yes      # 内存满时的淘汰策略异步执行
lazyfree-lazy-expire yes        # 过期 key 的删除异步执行
lazyfree-lazy-server-del yes    # 执行 DEL 操作时异步执行
replica-lazy-flush yes          # 从库 flushdb 时异步执行
```

## 大 key 预防 checklist

1. **写入前检查大小**：在写入 Redis 之前，检查数据大小是否超过阈值
2. **设计阶段考虑分桶**：对于会不断增长的数据，提前设计好分桶策略
3. **建立监控告警**：对 key 的内存使用量设置告警阈值
4. **定期巡检**：使用工具定期扫描大 key，提前发现问题
5. **控制 TTL**：给所有大 key 设置合理的过期时间

```java
// 写入前检查
public void safeSet(String key, Object value, long ttlSeconds) {
    String serialized = JSON.toJSONString(value);
    if (serialized.length() > MAX_VALUE_SIZE) {
        throw new BusinessException("数据过大，不适合存储到 Redis");
    }
    redisTemplate.opsForValue().set(key, serialized, ttlSeconds, TimeUnit.SECONDS);
}
```

## 总结

大 key 是 Redis 性能问题的重要来源之一：

1. **预防胜于治疗**：从设计阶段就考虑数据大小和增长模式
2. **拆分是核心**：把大 key 拆成多个小 key 是最有效的解决方案
3. **监控不可少**：建立大 key 的发现和告警机制
4. **善用新特性**：Redis 4.0+ 的 lazyfree 机制可以缓解删除大 key 的阻塞问题

---

## 留给你的问题

假设你的系统有以下场景：

- 用户签到功能，每天有 1000 万用户签到
- 需要记录每个用户每天是否签到（已签到/未签到）
- 查询需求：某用户是否在某个日期签到；某日期有多少用户签到

请思考：

1. 如果用 SET 存储每个用户的签到记录，会产生什么问题？
2. 如果用 BITMAP 存储，如何设计 key 的结构？每天的签到数据大概占用多少内存？
3. 如果用 Redis Stream，能否解决这个场景？有什么优缺点？

这道题的关键在于理解不同数据结构的适用场景，以及如何根据业务特点选择最优方案。
