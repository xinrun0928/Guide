# Redis 过期策略：定期删除 vs 惰性删除

你的 Redis 内存占用越来越高，但明明没有存那么多数据。

怎么回事？

——Redis 的过期数据没有及时清理，堆积在内存里。

Redis 使用了两种过期策略：**定期删除**和**惰性删除**。理解它们，是理解 Redis 内存管理的关键。

---

## Redis 的过期机制

当给一个 key 设置过期时间时，Redis 会把这个信息存储在 key 本身，而不是单独建一个「过期表」。

```bash
SET product:1001 "商品信息" EX 3600
# Redis 内部记录：这个 key 在 3600 秒后过期
```

### 为什么要这样设计？

如果独立存储过期信息，会有两个问题：
1. **数据一致性问题**：过期表和实际数据需要同步
2. **额外空间开销**：每个 key 都要维护过期时间

Redis 选择把过期时间存在 key 的元数据里（RedisObject），这样查询 key 时可以同时检查过期时间。

---

## 过期策略一：惰性删除（Lazy Expiration）

### 核心思想

**不用的时候不删，只有访问时才发现过期了，顺手删掉**。

```java
// 伪代码：Redis 的惰性删除逻辑
Object get(String key) {
    // 1. 检查 key 是否存在
    Object value = lookupKey(key);
    
    if (value == null) {
        return null;
    }
    
    // 2. 检查是否过期
    if (isExpired(key)) {
        // 过期了，删除并返回 null
        deleteKey(key);
        return null;
    }
    
    // 3. 未过期，返回值
    return value;
}
```

### 惰性删除的优点

| 优点 | 说明 |
|------|------|
| **节省 CPU** | 不浪费 CPU 时间去扫描过期数据 |
| **精确删除** | 只删除被访问的过期数据 |
| **实现简单** | 代码逻辑清晰 |

### 惰性删除的缺点

```bash
# 场景：大量过期数据，但永远不被访问
SET key1 "value1" EX 1      # 1 秒后过期
SET key2 "value2" EX 1      # 1 秒后过期
SET key3 "value3" EX 1      # 1 秒后过期
# ... 一共 100 万个 key

# 等待 1 秒后，这 100 万个 key 都过期了
# 但没有任何客户端访问它们
# 它们会一直占用内存，直到被访问或定期删除
```

| 缺点 | 说明 |
|------|------|
| **内存浪费** | 不访问的过期数据会一直占用内存 |
| **无法清理冷数据** | 永远不访问的过期数据会成为「僵尸」 |

---

## 过期策略二：定期删除（Active Expiration）

### 核心思想

**每隔一段时间，主动扫描一批 key，删除过期的**。

Redis 每隔 100ms 随机抽取一批设置了过期时间的 key，检查并删除过期的。

```java
// 伪代码：Redis 的定期删除逻辑
void activeExpireCycle() {
    // 1. 遍历所有数据库（默认 16 个）
    for (db = 0; db < server.dbnum; db++) {
        // 2. 每个数据库抽取一定数量的 key
        int expiredCount = 0;
        for (int i = 0; i < EXPIRE_KEYS_PER_CYCLE; i++) {
            // 随机选一个带过期时间的 key
            String key = randomExpireKey(db);
            
            if (isExpired(key)) {
                deleteKey(key);
                expiredCount++;
            }
            
            // 如果这批 key 中超过 25% 是过期的，继续抽
            // 否则退出，节省 CPU
            if (expiredCount > EXPIRE_KEYS_PER_CYCLE * 0.25) {
                break;
            }
        }
    }
}
```

### 定期删除的参数

Redis 提供了两个参数控制定期删除：

```bash
# 每 100ms 执行一次过期扫描
hz 10  # 默认值，可调整 1-500

# 每次扫描最多检查的 key 数量
dynamic-hz yes  # 根据客户端数量动态调整 hz
```

### 定期删除的优点

| 优点 | 说明 |
|------|------|
| **主动清理** | 不用等到访问才发现过期 |
| **避免内存膨胀** | 定期释放过期数据占用的内存 |
| **可控的 CPU 开销** | 通过 hz 参数控制扫描频率 |

### 定期删除的缺点

| 缺点 | 说明 |
|------|------|
| **不确定** | 不能保证所有过期 key 都被及时清理 |
| **CPU 开销** | 高 hz 会增加 CPU 消耗 |

---

## 两种策略的配合

```
┌─────────────────────────────────────────────────────────────┐
│                   Redis 过期策略协作                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  惰性删除（主）                                              │
│  ├── 时机：每次访问 key 时                                 │
│  ├── 优点：精确、资源节约                                  │
│  └── 缺点：冷数据无法清理                                  │
│                                                             │
│  定期删除（辅）                                              │
│  ├── 时机：每 100ms 一次                                   │
│  ├── 优点：主动清理冷数据                                  │
│  └── 缺点：可能清理不及时                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 实际效果

假设有 1000 万个 key，其中 500 万个已过期：

```
1. 惰性删除：
   - 只有被访问的过期 key 才会被删除
   - 如果这些过期 key 从未被访问，它们会继续占用内存

2. 定期删除：
   - 每 100ms 扫描约 20 个 key（取决于 hz 和配置）
   - 500 万个过期 key 需要很长时间才能清理完
   - 但至少在持续清理，不会无限堆积

3. 两者配合：
   - 大部分过期数据被定期删除清理
   - 少量被遗漏的，在下次访问时被惰性删除清理
   - 平衡了 CPU 开销和内存占用
```

---

## 过期策略的调优

### 场景一：内存压力大

```bash
# 增加定期删除的频率
hz 100  # 从默认 10 提升到 100

# 代价：CPU 消耗增加

# 或者：使用淘汰策略
maxmemory-policy allkeys-lru  # 内存满时，删除最近最少使用的 key
```

### 场景二：需要精确过期

```java
// 如果业务对过期时间敏感，不要完全依赖 Redis
// 定期清理 + 业务层校验

public class CacheService {
    
    private static final long EXPIRE_THRESHOLD_MS = 5 * 60 * 1000;  // 5 分钟
    
    // 存储：数据 + 过期时间戳
    public void set(String key, Object value, long ttlSeconds) {
        long expireTime = System.currentTimeMillis() + ttlSeconds * 1000;
        Map&lt;String, Object&gt; data = new HashMap&lt;&gt;();
        data.put("value", value);
        data.put("expireTime", expireTime);
        redisTemplate.opsForValue().set(key, data);
    }
    
    public Object get(String key) {
        Map&lt;String, Object&gt; data = (Map&lt;String, Object&gt;) redisTemplate.opsForValue().get(key);
        
        if (data == null) {
            return null;
        }
        
        long expireTime = (Long) data.get("expireTime");
        
        // 业务层额外校验（Redis 过期可能有延迟）
        if (System.currentTimeMillis() &gt; expireTime) {
            redisTemplate.delete(key);
            return null;
        }
        
        return data.get("value");
    }
}
```

### 场景三：批量清理过期数据

```bash
# SCAN 命令遍历 + 删除（不影响主线程）
redis-cli --scan --pattern "user:*:expired" | xargs redis-cli unlink

# 或使用 Lua 脚本批量删除
EVAL "
local keys = redis.call('KEYS', ARGV[1])
for i, key in ipairs(keys) do
    if redis.call('TTL', key) &lt; 0 then
        redis.call('DEL', key)
    end
end
return #keys(keys)
" 0 "user:session:*"
```

---

## 过期删除与 RDB/AOF 的关系

### RDB 持久化

```bash
# 生成 RDB 时，已过期的 key 不会被写入
# 加载 RDB 时，主库会忽略过期 key
# 从库会加载所有 key（包括过期的，因为主库会发送 DEL 命令）
```

### AOF 持久化

```bash
# AOF 追加的是命令，不会记录过期状态
# 当 key 过期时，Redis 会发送 DEL 命令到 AOF
# 过期数据的删除是独立记录的
```

---

## 总结

Redis 的过期策略：

| 策略 | 时机 | 优点 | 缺点 |
|------|------|------|------|
| 惰性删除 | 访问时 | CPU 友好、精确 | 冷数据堆积 |
| 定期删除 | 每 100ms | 主动清理 | 可能有延迟 |

**最佳实践**：
- 依赖 Redis 的过期策略，但不能完全信任它
- 业务层对过期时间敏感的数据，做额外校验
- 内存压力大时，配置淘汰策略
- 定期监控 Redis 内存使用：`INFO memory`

---

## 留给你的问题

假设这样一个场景：你的系统有 1000 万用户 Session，每个 Session 有效期是 24 小时。

用户活跃度差异很大：
- 10% 是活跃用户，每天都在访问
- 90% 是沉默用户，登录一次后就再也不访问

请思考：
1. 如果只用惰性删除，会有什么问题？
2. 定期删除的 hz 参数应该设置多少？为什么？
3. 有没有更好的方案来处理这种「大量冷数据」的过期问题？
4. 是否应该用淘汰策略替代过期策略？

提示：可以考虑按活跃度分层存储，使用不同的过期策略。
