# Redis 慢查询日志分析

你的 Redis 突然变慢了。

客户端等待超时，告警满天飞。

怎么找出「谁」拖慢了 Redis？

**慢查询日志**来帮你。

## 什么是慢查询？

慢查询是指：**执行时间超过指定阈值的命令**。

```
正常命令：
命令 ──▶ 执行 ──▶ 返回
         │
         └─ 100 微秒

慢查询：
命令 ──▶ 执行 ──▶ 返回
         │
         └─ 10 毫秒 ← 超过阈值
```

## 慢查询配置

### 两个关键配置

```bash
# redis.conf

# 慢查询阈值（微秒），默认 10000（10毫秒）
slowlog-log-slower-than 10000

# 保留的慢查询日志数量，默认 128
slowlog-max-len 128
```

### 配置建议

```bash
# 生产环境建议
slowlog-log-slower-than 1000      # 1毫秒（更敏感）
slowlog-max-len 1000              # 保留更多日志
```

## 慢查询日志内容

### 日志结构

```bash
redis-cli SLOWLOG GET
```

```
1) 1) (integer) 5              # 日志 ID
   2) (integer) 1609459200      # 时间戳（秒）
   3) (integer) 1500           # 执行时间（微秒）
   4) 1) "GET"                # 命令
      2) "user:1001"          # 参数
   5) "127.0.0.1:54321"       # 客户端地址
   6) ""                       # 客户端名称
```

### 日志字段解释

| 字段 | 说明 |
|-----|------|
| ID | 递增的唯一标识 |
| 时间戳 | 命令执行开始时间 |
| 执行时间 | 命令执行耗时（微秒） |
| 命令 + 参数 | 完整的命令 |
| 客户端地址 | 来源 IP 和端口 |
| 客户端名称 | CLIENT SETNAME 设置的名称 |

## 慢查询命令

### 查看慢查询

```bash
# 查看最近 10 条慢查询
redis-cli SLOWLOG GET 10

# 查看最新 1 条
redis-cli SLOWLOG GET 1

# 查看但不清空
redis-cli SLOWLOG GET
```

### 查看慢查询数量

```bash
redis-cli SLOWLOG LEN
# (integer) 42
```

### 清空慢查询日志

```bash
redis-cli SLOWLOG RESET
# OK
```

## 分析慢查询

### 常见慢查询原因

#### 1. O(n) 以上的命令

```java
/**
 * 慢查询命令示例：
 * 
 * KEYS pattern        → O(n)，n = 所有 key
 * SMEMBERS set       → O(n)，n = 集合大小
 * LRANGE list 0 -1   → O(n)，n = 列表长度
 * HGETALL hash      → O(n)，n = 字段数
 * GETALL *          → O(n * m)，所有 key × 每个 key 的值大小
 */
```

#### 2. 大 key 操作

```java
/**
 * 大 key 导致的慢查询：
 * 
 * GET big_key         → 读取 500MB
 * SET big_key         → 写入 500MB
 * DEL big_key         → 删除 500MB（阻塞）
 * LRANGE big_list 0 100000 → 读取 10 万元素
 */
```

#### 3. 批量操作过多

```java
/**
 * 错误的做法：循环单个操作
 */
for (String key : keys) {
    redis.del(key);  // N 次网络往返
}

/**
 * 正确的做法：Pipeline 批量操作
 */
Pipeline pipeline = jedis.pipelined();
for (String key : keys) {
    pipeline.del(key);  // 1 次网络往返
}
pipeline.sync();
```

### 慢查询分析脚本

```bash
#!/bin/bash
# slowlog-analyze.sh

echo "=== Redis 慢查询分析 ==="

# 获取最近 100 条慢查询
slowlogs=$(redis-cli SLOWLOG GET 100)

# 统计各命令出现次数
echo "命令频率统计："
echo "$slowlogs" | grep -oP '"[A-Z]+"' | sort | uniq -c | sort -rn

# 统计执行时间分布
echo ""
echo "执行时间分布："
echo "$slowlogs" | grep -oP '\(integer\) [0-9]+' | \
    awk '{print $2}' | \
    awk '
        BEGIN { s1=0; s5=0; s10=0; s50=0; s100=0; s500=0; s1000=0; s1000plus=0 }
        $1 < 1000 { s1++; next }
        $1 < 5000 { s5++; next }
        $1 < 10000 { s10++; next }
        $1 < 50000 { s50++; next }
        $1 < 100000 { s100++; next }
        $1 < 500000 { s500++; next }
        $1 < 1000000 { s1000++; next }
        { s1000plus++ }
        END {
            print "< 1ms:  " s1
            print "1-5ms:  " s5
            print "5-10ms: " s10
            print "10-50ms:" s50
            print "50-100ms:" s100
            print "100-500ms:" s500
            print "500ms-1s: " s1000
            print "> 1s:   " s1000plus
        }
    '

# 找出最慢的命令
echo ""
echo "最慢的 5 条命令："
echo "$slowlogs" | awk '/\(integer\)/ {print $0}' | head -n 25 | tail -n 5
```

## 优化慢查询

### 优化方案一：避免 O(n) 命令

```java
/**
 * 避免 KEYS 命令
 * 
 * 错误：
 * KEYS user:*  → O(n)
 * 
 * 正确：
 * SCAN cursor MATCH user:* → O(1) 每次调用
 */
public void scanKeys() {
    String cursor = "0";
    do {
        ScanResult<String> result = jedis.scan(cursor, 
            new ScanParams().match("user:*").count(100));
        cursor = result.getCursor();
        List<String> keys = result.getResult();
        // 处理 keys
    } while (!"0".equals(cursor));
}

/**
 * 使用 SCAN 替代 KEYS
 */
public void safeKeysOperation() {
    // 分批处理，避免阻塞
    ScanParams params = new ScanParams().count(100);
    String cursor = "0";
    
    do {
        ScanResult<String> result = jedis.scan(cursor, params);
        cursor = result.getCursor();
        
        // 处理这一批 key
        for (String key : result.getResult()) {
            // ...
        }
    } while (!"0".equals(cursor));
}
```

### 优化方案二：拆分大 key

```java
/**
 * 大 List 拆分为多个小 List
 */
public class ListSplitter {
    
    private static final int CHUNK_SIZE = 1000;
    
    /**
     * 分批写入
     */
    public void splitListPush(List<String> items, String targetKey) {
        List<String> currentChunk = new ArrayList<>(CHUNK_SIZE);
        int chunkIndex = 0;
        
        for (String item : items) {
            currentChunk.add(item);
            
            if (currentChunk.size() == CHUNK_SIZE) {
                // 保存当前 chunk
                String chunkKey = targetKey + ":" + chunkIndex;
                jedis.del(chunkKey);
                jedis.rpush(chunkKey, currentChunk.toArray(new String[0]));
                currentChunk.clear();
                chunkIndex++;
            }
        }
        
        // 保存剩余的
        if (!currentChunk.isEmpty()) {
            String chunkKey = targetKey + ":" + chunkIndex;
            jedis.del(chunkKey);
            jedis.rpush(chunkKey, currentChunk.toArray(new String[0]));
        }
    }
    
    /**
     * 分批读取
     */
    public List<String> splitListRange(String targetKey, int start, int end) {
        List<String> result = new ArrayList<>();
        int chunkCount = 0;
        int processed = 0;
        
        while (processed <= end) {
            String chunkKey = targetKey + ":" + chunkCount;
            long chunkSize = jedis.llen(chunkKey);
            
            if (processed + chunkSize > start) {
                int localStart = Math.max(0, start - processed);
                int localEnd = Math.min((int) chunkSize - 1, end - processed);
                List<String> chunk = jedis.lrange(chunkKey, localStart, localEnd);
                result.addAll(chunk);
            }
            
            processed += chunkSize;
            chunkCount++;
        }
        
        return result;
    }
}
```

### 优化方案三：使用 Pipeline

```java
/**
 * Pipeline 批量操作
 */
public class PipelineDemo {
    
    private Jedis jedis;
    
    /**
     * 批量删除
     */
    public void batchDelete(List<String> keys) {
        Pipeline pipeline = jedis.pipelined();
        
        for (String key : keys) {
            pipeline.del(key);
        }
        
        pipeline.sync();
    }
    
    /**
     * 批量读取
     */
    public Map<String, String> batchGet(List<String> keys) {
        Pipeline pipeline = jedis.pipelined();
        
        for (String key : keys) {
            pipeline.get(key);
        }
        
        List<Object> results = pipeline.sync();
        
        Map<String, String> map = new HashMap<>();
        for (int i = 0; i < keys.size(); i++) {
            Object result = results.get(i);
            if (result != null) {
                map.put(keys.get(i), (String) result);
            }
        }
        
        return map;
    }
    
    /**
     * 批量写入
     */
    public void batchSet(Map<String, String> data) {
        Pipeline pipeline = jedis.pipelined();
        
        for (Map.Entry<String, String> entry : data.entrySet()) {
            pipeline.set(entry.getKey(), entry.getValue());
        }
        
        pipeline.sync();
    }
}
```

### 优化方案四：异步操作

```java
/**
 * 异步删除大 key
 */
public class AsyncDeleter {
    
    /**
     * 使用 UNLINK 替代 DEL
     * 
     * DEL：同步删除，阻塞
     * UNLINK：异步删除，立即返回
     */
    public void asyncDelete(String key) {
        jedis.unlink(key);  // Redis 4.0+
    }
    
    /**
     * 分批删除大 List
     */
    public void batchDeleteList(String key, int batchSize) {
        Long size = jedis.llen(key);
        if (size == null || size == 0) return;
        
        while (size > 0) {
            jedis.ltrim(key, 0, -batchSize - 1);
            size = jedis.llen(key);
        }
        
        jedis.del(key);
    }
}
```

## 监控告警

### Prometheus 告警规则

```yaml
groups:
  - name: redis_slowlog_alerts
    rules:
      - alert: RedisSlowQueries
        expr: rate(redis_slowlog_count_total[5m]) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redis 慢查询过多"
          description: "过去 5 分钟产生了 {{ $value }} 条慢查询"
          
      - alert: RedisVerySlowQuery
        expr: redis_slowlog_duration_seconds > 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Redis 存在秒级慢查询"
          description: "发现执行时间超过 1 秒的查询"
```

## 总结

Redis 慢查询分析：

- **配置**：`slowlog-log-slower-than`、`slowlog-max-len`
- **分析**：`SLOWLOG GET`、`SLOWLOG LEN`
- **优化**：避免 O(n) 命令、拆分大 key、使用 Pipeline
- **监控**：持续监控慢查询数量和分布

## 留给你的问题

SCAN 命令虽然不会阻塞，但也是 O(1) 操作单次调用，多次调用总时间可能比 KEYS 更长。

**在什么场景下，SCAN 的总耗时反而超过 KEYS？应该如何选择？**
