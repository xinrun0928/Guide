# Redis 慢命令阻塞与处理

你的 Redis 突然卡住了。

所有命令都在等待，客户端超时。

可能是**慢命令**在作怪。

## 什么是慢命令？

慢命令是指**执行时间过长的命令**，会阻塞 Redis 主线程。

```
正常命令：
请求1 ──▶ 执行(10ms) ──▶ 返回
请求2 ──▶ 执行(10ms) ──▶ 返回
请求3 ──▶ 执行(10ms) ──▶ 返回

慢命令阻塞：
请求1 ──▶ 执行(10ms) ──▶ 返回
请求2 ──▶ 执行(10ms) ──▶ 返回
请求3 ──▶ 执行(10s) ──────────────▶ 返回
                          ↑
                      所有请求卡住！
```

## 哪些命令是慢命令？

### O(n) 及以上的命令

| 命令 | 时间复杂度 | 风险 |
|-----|-----------|-----|
| KEYS pattern | O(n) | 高 |
| SMEMBERS | O(n) | 高 |
| LRANGE | O(m) | 中 |
| HGETALL | O(n) | 高 |
| GETALL | O(n*m) | 高 |
| SORT | O(n log n) | 中 |
| ZRANGEBYSCORE | O(log n + m) | 低 |

### 大 key 操作

| 类型 | 操作 | 风险 |
|-----|------|-----|
| String | GET/SET 大 value | 高 |
| List | LRANGE/LPUSH 大列表 | 高 |
| Hash | HGETALL 大 Hash | 高 |
| Set | SMEMBERS 大集合 | 高 |
| ZSet | ZRANGE 大有序集合 | 中 |

## 慢命令的成因

### 场景一：KEYS 命令

```java
/**
 * KEYS 命令：遍历所有 key
 * 
 * 在有 1000 万 key 的 Redis 中：
 * 
 * redis-cli KEYS "user:*"
 * 
 * 时间：可能需要几秒甚至几十秒
 * 阻塞：期间所有命令都无法执行
 */
public class KeysCommand {
    
    // 错误：在线上使用 KEYS
    public void badPractice() {
        // 危险！
        Set<String> keys = jedis.keys("user:*");
        // 在大数据库中，这会冻结 Redis
    }
    
    // 正确：使用 SCAN
    public void goodPractice() {
        ScanParams params = new ScanParams().match("user:*").count(100);
        String cursor = "0";
        
        do {
            ScanResult<String> result = jedis.scan(cursor, params);
            cursor = result.getCursor();
            
            // 处理这一批 key
            List<String> keys = result.getResult();
            process(keys);
            
        } while (!"0".equals(cursor));
    }
}
```

### 场景二：大 List 操作

```java
/**
 * 大 List 操作
 */
public class BigListOperation {
    
    // 错误：读取整个 List
    public void badPractice() {
        // 假设有 100 万元素的 List
        List<String> all = jedis.lrange("big_list", 0, -1);
        // 这会读取 100 万元素，阻塞 Redis
    }
    
    // 正确：分批读取
    public void goodPractice() {
        long size = jedis.llen("big_list");
        int batchSize = 1000;
        
        for (int start = 0; start < size; start += batchSize) {
            int end = Math.min(start + batchSize - 1, (int) size);
            List<String> batch = jedis.lrange("big_list", start, end);
            process(batch);
        }
    }
    
    // 正确：使用 SCAN
    public void scanPractice() {
        // 不存在，但可以用 LRANGE 分批
    }
}
```

### 场景三：大 Hash 操作

```java
/**
 * 大 Hash 操作
 */
public class BigHashOperation {
    
    // 错误：一次性读取整个 Hash
    public void badPractice() {
        Map<String, String> all = jedis.hgetAll("big_hash");
        // 假设有 100 万字段，这会阻塞 Redis
    }
    
    // 正确：分批读取
    public void goodPractice() {
        ScanParams params = new ScanParams().match("*").count(100);
        Map<String, String> result = new HashMap<>();
        String cursor = "0";
        
        do {
            ScanResult<Map.Entry&lt;String, String&gt;&gt; result = 
                jedis.hscan("big_hash", cursor, params);
            cursor = result.getCursor();
            
            for (Map.Entry<String, String> entry : result.getResult()) {
                result.put(entry.getKey(), entry.getValue());
            }
            
        } while (!"0".equals(cursor));
    }
}
```

### 场景四：SORT 命令

```java
/**
 * SORT 命令
 * 
 * 时间复杂度 O(n log n)
 * 对大集合排序会非常慢
 */
public class SortCommand {
    
    // 错误：对大 List 排序
    public void badPractice() {
        // 对有 100 万元素的 List 排序
        List<String> sorted = jedis.sort("big_list");
    }
    
    // 正确：使用 ZSet 代替
    public void goodPractice() {
        // 如果需要排序，使用 ZSet
        // ZSet 天然有序，查询 O(log n)
        // ZRANGEBYSCORE 可以高效获取范围
    }
}
```

## 慢命令处理方案

### 方案一：使用 SCAN 替代 KEYS

```java
/**
 * SCAN vs KEYS
 * 
 * KEYS: O(n)，阻塞
 * SCAN: O(1) 每次调用，返回一批，返回所有需要多次调用
 */
public class ScanVsKeys {
    
    /**
     * 安全地遍历所有 key
     */
    public void safeScan() {
        ScanParams params = new ScanParams()
            .match("user:*")
            .count(100);  // 每批返回数量
        
        String cursor = "0";
        int processed = 0;
        
        do {
            ScanResult<String> result = jedis.scan(cursor, params);
            cursor = result.getCursor();
            processed += result.getResult().size();
            
            // 处理这一批
            for (String key : result.getResult()) {
                processKey(key);
            }
            
        } while (!"0".equals(cursor));
        
        System.out.println("处理了 " + processed + " 个 key");
    }
    
    /**
     * SCAN 系列命令
     */
    public void scanSeries() {
        // SCAN: 遍历所有 key
        jedis.scan(cursor, params);
        
        // SSCAN: 遍历 Set
        jedis.sscan("big_set", cursor, params);
        
        // HSCAN: 遍历 Hash
        jedis.hscan("big_hash", cursor, params);
        
        // ZSCAN: 遍历 ZSet
        jedis.zscan("big_zset", cursor, params);
    }
}
```

### 方案二：大 key 拆分

```java
/**
 * 大 key 拆分策略
 */
public class BigKeySplit {
    
    /**
     * 大 String 拆分
     */
    public void splitBigString() {
        String key = "big_data";
        String value = getFromDatabase();  // 假设 10MB
        
        // 拆分为多个小 chunk
        int chunkSize = 100 * 1024;  // 100KB
        int chunkCount = (value.length() + chunkSize - 1) / chunkSize;
        
        // 保存元数据
        jedis.hset(key + ":meta", "chunks", String.valueOf(chunkCount));
        jedis.hset(key + ":meta", "total", String.valueOf(value.length()));
        
        // 保存分片
        for (int i = 0; i < chunkCount; i++) {
            int start = i * chunkSize;
            int end = Math.min(start + chunkSize, value.length());
            String chunk = value.substring(start, end);
            jedis.set(key + ":" + i, chunk);
        }
    }
    
    /**
     * 大 List 拆分
     */
    public void splitBigList() {
        String key = "big_list";
        String metaKey = key + ":meta";
        
        // 扫描原 List（使用 LRANGE 分批）
        int chunkSize = 1000;
        int chunkIndex = 0;
        
        while (true) {
            List<String> batch = jedis.lrange(key, 0, chunkSize - 1);
            if (batch.isEmpty()) break;
            
            // 保存到新 key
            String chunkKey = key + ":" + chunkIndex;
            jedis.rpush(chunkKey, batch.toArray(new String[0]));
            
            // 删除原 List 中的这批
            jedis.ltrim(key, batch.size(), -1);
            
            chunkIndex++;
        }
        
        // 保存元数据
        jedis.hset(metaKey, "chunks", String.valueOf(chunkIndex));
    }
    
    /**
     * 大 Hash 拆分
     */
    public void splitBigHash() {
        String key = "big_hash";
        String metaKey = key + ":meta";
        
        // 分批读取
        ScanParams params = new ScanParams().match("*").count(1000);
        String cursor = "0";
        int chunkIndex = 0;
        
        while (true) {
            ScanResult<Map.Entry&lt;String, String&gt;&gt; result = 
                jedis.hscan(key, cursor, params);
            cursor = result.getCursor();
            
            if (result.getResult().isEmpty()) break;
            
            // 保存到新 Hash
            Map<String, String> chunk = new HashMap<>();
            for (Map.Entry<String, String> entry : result.getResult()) {
                chunk.put(entry.getKey(), entry.getValue());
            }
            
            if (!chunk.isEmpty()) {
                jedis.hset(key + ":" + chunkIndex, chunk);
                chunkIndex++;
            }
            
            if ("0".equals(cursor)) break;
        }
        
        jedis.hset(metaKey, "chunks", String.valueOf(chunkIndex));
    }
}
```

### 方案三：异步执行

```java
/**
 * 异步执行慢命令
 */
public class AsyncCommand {
    
    private Jedis jedis;
    private ExecutorService executor;
    
    /**
     * 在后台执行 KEYS（会阻塞 Redis，但不影响主线程）
     */
    public Future<List<String>> backgroundKeys(String pattern) {
        return executor.submit(() -> {
            // 这个操作会阻塞 Redis
            // 但不会阻塞调用线程
            return new ArrayList<>(jedis.keys(pattern));
        });
    }
    
    /**
     * 使用 UNLINK 替代 DEL
     */
    public void asyncDelete(String key) {
        // DEL 是同步的，会阻塞
        // UNLINK 是异步的，立即返回
        jedis.unlink(key);  // Redis 4.0+
    }
    
    /**
     * 使用懒删除
     */
    public void lazyDelete(String key) {
        // 设置过期时间，让 Redis 后台删除
        jedis.expire(key, 1);  // 1 秒后过期
    }
}
```

### 方案四：监控告警

```bash
# redis.conf 配置

# 慢查询日志
slowlog-log-slower-than 1000  # 1毫秒
slowlog-max-len 1000

# 命令监控
monitor-command enabled
```

```yaml
# Prometheus 告警规则
groups:
  - name: redis_slow_command_alerts
    rules:
      - alert: RedisBlockingCommand
        expr: |
          sum(rate(redis_commands_duration_seconds_sum[5m])) by (cmd) > 1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "检测到慢命令 {{ $labels.cmd }}"
```

## 最佳实践总结

| 场景 | 错误做法 | 正确做法 |
|-----|---------|---------|
| 遍历 key | KEYS | SCAN |
| 遍历 Set | SMEMBERS | SSCAN |
| 遍历 Hash | HGETALL | HSCAN |
| 遍历 List | LRANGE 0 -1 | 分批 LRANGE |
| 删除大 key | DEL | UNLINK / 懒删除 |
| 读取大 value | GET | 分 chunk |

## 工具推荐

### 1. redis-cli --bigkeys

```bash
# 找出大 key
redis-cli --bigkeys

# 输出示例
# Scanning 5 databases for big keys...
# 
# Big Key details:
#   String key: "cache:data" - 50MB
#   Hash key: "user:1001" - 10MB, 100000 fields
#   List key: "msg:queue" - 100MB, 1000000 items
```

### 2. SCAN 系列

```bash
# 遍历 key
SCAN cursor MATCH pattern COUNT count

# 遍历 Set
SSCAN set_key cursor MATCH pattern COUNT count

# 遍历 Hash
HSCAN hash_key cursor MATCH pattern COUNT count

# 遍历 ZSet
ZSCAN zset_key cursor MATCH pattern COUNT count
```

### 3. MEMORY USAGE

```bash
# 查看 key 的内存使用
redis-cli MEMORY USAGE big_key
# (integer) 52428800  # 50MB
```

## 总结

慢命令是 Redis 性能杀手：

- **识别**：慢查询日志、INFO stats
- **原因**：O(n) 命令、大 key、操作频繁
- **解决**：SCAN 替代 KEYS、大 key 拆分、异步执行
- **预防**：代码审查、监控告警

## 留给你的问题

SCAN 命令虽然不会阻塞 Redis，但多次 SCAN 的总耗时可能超过 KEYS。

**在什么情况下，SCAN 的总耗时反而比 KEYS 更长？应该如何权衡？**
