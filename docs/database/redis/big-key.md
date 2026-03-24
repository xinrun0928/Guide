# 大 key 发现与解决方案

你的 Redis 内存报警了。
查看发现，一个 key 占用了 500MB。
这正常吗？

这就是**大 key 问题**。

## 什么是大 key？

大 key 是指：**单个 key 存储的数据量过大**，超过合理范围。

```
正常 key：
key1 ──▶ 100 bytes
key2 ──▶ 200 bytes
key3 ──▶ 150 bytes

大 key：
key1 ──▶ 500 MB  ← 大 key！
key2 ──▶ 200 bytes
key3 ──▶ 150 bytes
```

## Redis 各类型的大小建议

| 类型 | 建议大小 | 说明 |
|-----|---------|------|
| String | < 10 KB | 最佳 |
| Hash | < 10000 fields | 每 field < 100 bytes |
| List | < 10000 items | 每 item < 100 bytes |
| Set | < 10000 members | - |
| ZSet | < 10000 members | - |
| Stream | < 10000 entries | - |

## 大 key 的危害

| 危害 | 说明 |
|-----|------|
| 内存不均 | 一个 key 占大量内存 |
| 操作阻塞 | DEL、LRANGE 等操作耗时 |
| 网络阻塞 | 单次传输大量数据 |
| 集群问题 | 槽迁移卡住 |

## 大 key 是怎么产生的？

### 场景一：缓存大对象

```java
// 错误：将整个列表序列化为一个 String
List&lt;Product&gt; products = db.getAllProducts();  // 10 万条
redis.set("products:all", JSON.toJSONString(products));  // 500MB
```

### 场景二：没有分页

```java
// 错误：获取用户所有消息
List&lt;String&gt; messages = jedis.lrange("user:messages:" + userId, 0, -1);
// 用户有 100 万条消息，OOM！
```

### 场景三：统计数据累积

```java
// 错误：消息队列不断追加
while (true) {
    String msg = receiveMessage();
    jedis.lpush("msg:queue", msg);  // List 无限增长
}
```

## 发现大 key

### 方案一：redis-cli --bigkeys

```bash
# 扫描 Redis 中的大 key
redis-cli --bigkeys

# 输出示例
# Scanning 5 databases for big keys...
# 
# ------ Preliminary information ------
# 
# Big Key details:
# Database 0
#   String key: "products:cache" - 5MB
#   Hash key: "user:session:*" - 10MB, ~5000 fields
#   List key: "msg:queue" - 100MB, ~1000000 items
#   ZSet key: "leaderboard" - 50MB, ~100000 members
```

### 方案二：MEMORY USAGE

```bash
# 查看单个 key 的内存占用
redis-cli MEMORY USAGE product:12345

# 返回：1024000（约 1MB）
```

### 方案三：SCAN + TYPE + DBSIZE

```java
/**
 * 扫描大 key
 */
public class BigKeyScanner {
    
    private Jedis jedis;
    
    /**
     * 扫描所有 key 并分析大小
     */
    public List&lt;BigKeyInfo&gt; scanBigKeys(int scanCount, long sizeThreshold) {
        List&lt;BigKeyInfo&gt; bigKeys = new ArrayList&lt;&gt;();
        
        ScanParams params = new ScanParams().count(scanCount);
        String cursor = "0";
        
        do {
            ScanResult&lt;String&gt; result = jedis.scan(cursor, params);
            cursor = result.getCursor();
            
            for (String key : result.getResult()) {
                // 获取 key 类型
                String type = jedis.type(key);
                
                // 计算大小
                long size = calculateKeySize(key, type);
                
                if (size > sizeThreshold) {
                    bigKeys.add(new BigKeyInfo(key, type, size));
                }
            }
        } while (!"0".equals(cursor));
        
        // 按大小排序
        bigKeys.sort((a, b) -> Long.compare(b.getSize(), a.getSize()));
        
        return bigKeys;
    }
    
    /**
     * 计算 key 的大小
     */
    private long calculateKeySize(String key, String type) {
        switch (type) {
            case "string":
                return jedis.strlen(key);
            case "hash":
                return jedis.hlen(key) * 100;  // 估算
            case "list":
                return jedis.llen(key) * 100;  // 估算
            case "set":
                return jedis.scard(key) * 100;  // 估算
            case "zset":
                return jedis.zcard(key) * 100;  // 估算
            default:
                return 0;
        }
    }
}
```

### 方案四：Redis 5.0 MEMORY DOCS

```java
/**
 * 使用 OBJECT 命令分析 key
 */
public class KeyMemoryAnalyzer {
    
    private Jedis jedis;
    
    /**
     * 分析 key 的内存使用
     */
    public KeyMemoryInfo analyzeKey(String key) {
        KeyMemoryInfo info = new KeyMemoryInfo();
        info.setKey(key);
        info.setType(jedis.type(key));
        info.setEncoding(jedis.objectEncoding(key));
        info.setRefcount(jedis.objectRefcount(key));
        info.setMemoryUsage(jedis.memoryUsage(key));
        
        // 计算元素数量
        switch (info.getType()) {
            case "hash":
                info.setElementCount(jedis.hlen(key));
                break;
            case "list":
                info.setElementCount(jedis.llen(key));
                break;
            case "set":
                info.setElementCount(jedis.scard(key));
                break;
            case "zset":
                info.setElementCount(jedis.zcard(key));
                break;
            case "string":
                info.setElementCount(jedis.strlen(key));
                break;
        }
        
        return info;
    }
}
```

## 大 key 解决方案

### 方案一：拆分

**String 类型拆分**：

```java
/**
 * 大 String 拆分
 */
public class BigStringSplitter {
    
    private Jedis jedis;
    private static final int CHUNK_SIZE = 100 * 1024;  // 100KB 每个分片
    
    /**
     * 保存大字符串
     */
    public void setBigString(String key, String value) {
        // 1. 删除旧数据
        deleteBigKey(key);
        
        // 2. 计算分片数
        int chunkCount = (value.length() + CHUNK_SIZE - 1) / CHUNK_SIZE;
        
        // 3. 保存元数据
        Map&lt;String, String&gt; meta = new HashMap&lt;&gt;();
        meta.put("chunks", String.valueOf(chunkCount));
        meta.put("length", String.valueOf(value.length()));
        jedis.hset(key + ":meta", meta);
        
        // 4. 保存分片
        for (int i = 0; i < chunkCount; i++) {
            int start = i * CHUNK_SIZE;
            int end = Math.min(start + CHUNK_SIZE, value.length());
            String chunk = value.substring(start, end);
            jedis.set(key + ":" + i, chunk);
        }
    }
    
    /**
     * 获取大字符串
     */
    public String getBigString(String key) {
        // 1. 获取元数据
        Map&lt;String, String&gt; meta = jedis.hgetAll(key + ":meta");
        if (meta.isEmpty()) {
            return jedis.get(key);  // 可能是未拆分的老数据
        }
        
        int chunkCount = Integer.parseInt(meta.get("chunks"));
        int totalLength = Integer.parseInt(meta.get("length"));
        
        // 2. 收集所有分片
        StringBuilder sb = new StringBuilder(totalLength);
        for (int i = 0; i < chunkCount; i++) {
            sb.append(jedis.get(key + ":" + i));
        }
        
        return sb.toString();
    }
    
    /**
     * 删除大 key
     */
    public void deleteBigKey(String key) {
        // 删除元数据
        jedis.del(key + ":meta");
        
        // 删除分片
        ScanParams params = new ScanParams().match(key + ":*");
        ScanResult&lt;String&gt; result = jedis.scan("0", params);
        for (String k : result.getResult()) {
            jedis.del(k);
        }
    }
}
```

**Hash 类型拆分**：

```java
/**
 * 大 Hash 拆分
 */
public class BigHashSplitter {
    
    private Jedis jedis;
    private static final int HASH_SIZE = 1000;  // 每个 Hash 最多 1000 个 field
    
    /**
     * 保存大 Hash
     */
    public void setBigHash(String key, Map&lt;String, String&gt; data) {
        // 1. 计算分片数
        int shardCount = (data.size() + HASH_SIZE - 1) / HASH_SIZE;
        
        // 2. 保存元数据
        jedis.set(key + ":shards", String.valueOf(shardCount));
        
        // 3. 分片保存
        int index = 0;
        Iterator&lt;Map.Entry&lt;String, String&gt;&gt; iterator = data.entrySet().iterator();
        
        while (iterator.hasNext()) {
            Map&lt;String, String&gt; shardData = new HashMap&lt;&gt;();
            for (int i = 0; i < HASH_SIZE && iterator.hasNext(); i++) {
                Map.Entry&lt;String, String&gt; entry = iterator.next();
                shardData.put(entry.getKey(), entry.getValue());
            }
            jedis.hset(key + ":" + index, shardData);
            index++;
        }
    }
    
    /**
     * 获取 Hash 中的单个字段
     */
    public String getHashField(String key, String field) {
        // 遍历分片查找
        int shardCount = Integer.parseInt(jedis.get(key + ":shards"));
        for (int i = 0; i < shardCount; i++) {
            String value = jedis.hget(key + ":" + i, field);
            if (value != null) {
                return value;
            }
        }
        return null;
    }
}
```

### 方案二：异步删除

```java
/**
 * 异步删除大 key
 */
public class AsyncDeleter {
    
    private Jedis jedis;
    
    /**
     * 异步删除大 key（Redis 4.0+ UNLINK）
     */
    public void asyncDelete(String key) {
        // UNLINK 是异步版本的 DEL
        jedis.unlink(key);
    }
    
    /**
     * 分批删除大 List
     */
    public void deleteBigList(String key) {
        Long size = jedis.llen(key);
        if (size == null || size == 0) {
            return;
        }
        
        int batchSize = 1000;
        while (size > 0) {
            // 每次删除 1000 个
            jedis.ltrim(key, 0, -batchSize - 1);
            size = jedis.llen(key);
        }
        
        // 最后删除 key
        jedis.del(key);
    }
    
    /**
     * 使用 SCAN 遍历删除大 Set
     */
    public void deleteBigSet(String key) {
        ScanParams params = new ScanParams().count(1000);
        String cursor = "0";
        
        do {
            ScanResult&lt;String&gt; result = jedis.sscan(key, cursor, params);
            cursor = result.getCursor();
            
            if (!result.getResult().isEmpty()) {
                jedis.srem(key, result.getResult().toArray(new String[0]));
            }
        } while (!"0".equals(cursor));
        
        jedis.del(key);
    }
}
```

### 方案三：压缩

```java
/**
 * 大 key 压缩存储
 */
public class CompressedStorage {
    
    private Jedis jedis;
    
    /**
     * 压缩存储
     */
    public void setCompressed(String key, String value) throws IOException {
        // 使用 GZIP 压缩
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(bos)) {
            gzip.write(value.getBytes(StandardCharsets.UTF_8));
        }
        byte[] compressed = bos.toByteArray();
        
        // 存储压缩后的数据
        jedis.set(key.getBytes(), compressed);
    }
    
    /**
     * 解压获取
     */
    public String getDecompressed(String key) throws IOException {
        byte[] compressed = jedis.get(key.getBytes());
        if (compressed == null) {
            return null;
        }
        
        try (GZIPInputStream gzip = new GZIPInputStream(
                new ByteArrayInputStream(compressed))) {
            return new String(gzip.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
```

### 方案四：设计优化

```java
/**
 * 避免大 key 的设计原则
 */
public class GoodDesignPrinciples {
    
    /**
     * 1. 分页替代全量
     */
    public void paginateMessages() {
        // 错误：获取所有消息
        // List msgs = jedis.lrange("user:messages", 0, -1);
        
        // 正确：分页获取
        int page = 1;
        int pageSize = 20;
        int start = (page - 1) * pageSize;
        int end = start + pageSize - 1;
        List&lt;String&gt; messages = jedis.lrange("user:messages", start, end);
    }
    
    /**
     * 2. 使用 Set 替代 String 缓存列表
     */
    public void useSetForTags() {
        // 错误：大 String 缓存所有标签
        // redis.set("article:123:tags", JSON.toJSONString(tags));
        
        // 正确：使用 Set
        jedis.sadd("article:123:tags", tags.toArray(new String[0]));
    }
    
    /**
     * 3. 使用 ZSet 做时间线，带过期时间
     */
    public void useZSetTimeline() {
        // 添加带时间戳的消息
        long now = System.currentTimeMillis();
        jedis.zadd("user:feed:" + userId, now, messageId);
        
        // 设置过期
        jedis.expire("user:feed:" + userId, 7 * 24 * 60 * 60);
        
        // 分页获取（按时间排序）
        Set&lt;String&gt; feed = jedis.zrevrange("user:feed:" + userId, 0, 19);
    }
}
```

## 预防措施

### 1. 写入限制

```java
/**
 * 写入校验
 */
public class WriteValidator {
    
    /**
     * 校验写入大小
     */
    public void validateWrite(String key, String value) {
        // String 类型限制
        if (value.length() > 10 * 1024) {  // 10KB
            throw new IllegalArgumentException("Value too large for String key");
        }
        
        // Hash 类型限制
        Long currentSize = jedis.hlen(key);
        if (currentSize != null && currentSize > 10000) {
            throw new IllegalArgumentException("Hash too large");
        }
    }
}
```

### 2. 监控告警

```yaml
# Prometheus 告警规则
groups:
  - name: redis_big_key_alerts
    rules:
      - alert: RedisBigKey
        expr: redis_key_memory_bytes > 10 * 1024 * 1024
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "发现大 key，占用 {{ $value | humanize1024 }}"
          description: "大 key: {{ $labels.key }}"
```

## 总结

大 key 是 Redis 性能杀手：

- **发现**：redis-cli --bigkeys、MEMORY USAGE、SCAN 扫描
- **处理**：拆分、异步删除、压缩
- **预防**：设计优化、写入校验、监控告警

## 留给你的问题

大 List 的异步删除需要分批执行，但如果删除过程中 Redis 重启了，会发生什么？

**如何设计一个可靠的异步删除机制，保证即使 Redis 重启也不会丢失删除任务？**
