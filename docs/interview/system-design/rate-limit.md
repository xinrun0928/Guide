# 接口限流算法与实现

---

## 场景切入：双十一的「塞车」与「红绿灯」

想象一条高速公路，双十一期间车流量暴增 100 倍。

如果不加控制：

- 道路直接堵死（系统雪崩）
- 有人加塞引发冲突（资源抢占）
- 有人飙车出事故（线程耗尽）

限流器就是交通规则：

- 红绿灯：定时放行一部分
- 收费站：控制车流速度
- 单双号限行：按规则分流

今天，我们来聊聊接口限流的算法与实现。

---

## 需求分析：为什么要限流？

限流（Rate Limiting）有三个核心目的：

1. **保护系统**：防止流量超过系统承载能力
2. **公平分配**：防止少数用户占满所有资源
3. **成本控制**：按配额使用资源，避免意外支出

### 限流维度

| 维度 | 说明 | 示例 |
|---|---|---|
| 接口维度 | 限制单个接口 | /api/order 每秒最多 1000 次 |
| 用户维度 | 限制单个用户 | 每个用户每秒最多 10 次 |
| IP 维度 | 限制单个 IP | 每个 IP 每秒最多 100 次 |
| 全局维度 | 限制整个系统 | 总 QPS 不超过 10 万 |

---

## 容量估算

限流系统的容量评估主要关注**检测速度**：

| 指标 | 数值 |
|---|---|
| 限流检测 QPS | 10 万/秒 |
| 检测延迟要求 | <1ms |
| 存储容量 | 根据用户数 × 维度 |

限流器本身不能成为瓶颈，所以实现必须是**高性能**的。

---

## 核心算法

### 算法一：计数器（Fixed Window Counter）

最简单，但有临界问题。

```java
public class FixedWindowRateLimiter {

    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    private final int limit;
    private final long windowSeconds;

    /**
     * 固定窗口限流
     * 窗口大小固定（如每秒），计数器清零后重新计数
     * 问题：临界问题——如果流量集中在窗口边界，可能 2 倍超限
     */
    public boolean tryAcquire(String key) {
        String redisKey = "ratelimit:fixed:" + key;
        long now = System.currentTimeMillis() / 1000;
        long windowStart = now / windowSeconds * windowSeconds;
        String windowKey = redisKey + ":" + windowStart;

        Long count = redisTemplate.opsForValue().increment(windowKey);
        if (count != null &amp;&amp; count == 1) {
            // 第一次请求，设置过期时间
            redisTemplate.expire(windowKey, windowSeconds * 2, TimeUnit.SECONDS);
        }

        return count != null &amp;&amp; count &lt;= limit;
    }
}
```

### 算法二：滑动窗口（Sliding Window）

解决临界问题，但实现复杂一些。

```java
public class SlidingWindowRateLimiter {

    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    private final int limit;
    private final long windowSeconds;

    /**
     * 滑动窗口限流
     * 使用 ZSet 实现，时间戳作为分数，请求 ID 作为成员
     * 每次请求时，删除窗口外的旧请求，然后统计窗口内的请求数
     */
    public boolean tryAcquire(String key) {
        String redisKey = "ratelimit:sliding:" + key;
        long now = System.currentTimeMillis();
        long windowStart = now - windowSeconds * 1000;
        String requestId = UUID.randomUUID().toString();

        Jedis jedis = redisTemplate.getConnectionFactory().getConnection().getNativeConnection();

        try {
            // 开启事务
            jedis.watch(redisKey);

            // 删除窗口外的旧请求
            jedis.zremrangeByScore(redisKey, 0, windowStart);

            // 统计窗口内的请求数
            Long count = jedis.zcard(redisKey);

            if (count != null &amp;&amp; count &lt; limit) {
                // 没超限，添加新请求
                jedis.multi();
                jedis.zadd(redisKey, now, requestId);
                jedis.expire(redisKey, windowSeconds * 2);
                jedis.exec();
                return true;
            } else {
                jedis.unwatch();
                return false;
            }
        }
    }
}
```

### 算法三：令牌桶（Token Bucket）

最常用，支持突发流量。

```java
public class TokenBucketRateLimiter {

    private final int capacity;
    private final double refillRate;
    private final AtomicLong tokens;
    private final AtomicLong lastRefillTime;

    /**
     * 令牌桶限流
     * 核心思想：桶里有 token 才能通过，没 token 就等待或拒绝
     * 支持突发流量（桶满时一次性取完），同时限制平均速率
     */
    public synchronized boolean tryAcquire(int permits) {
        refill();
        if (tokens.get() &gt;= permits) {
            tokens.addAndGet(-permits);
            return true;
        }
        return false;
    }

    /**
     * 令牌补充
     * 按时间比例补充令牌，而不是一次性补充
     */
    private void refill() {
        long now = System.currentTimeMillis();
        long elapsed = now - lastRefillTime.get();
        double tokensToAdd = elapsed * refillRate / 1000.0;
        long newTokens = Math.min(capacity, (long) (tokens.get() + tokensToAdd));
        tokens.set(newTokens);
        lastRefillTime.set(now);
    }
}
```

### 算法四：漏桶（Leaky Bucket）

严格控制速率，不支持突发。

```java
public class LeakyBucketRateLimiter {

    private final int capacity;
    private final double leakRate;
    private final AtomicLong water;
    private final AtomicLong lastLeakTime;

    /**
     * 漏桶限流
     * 核心思想：水流进桶里，以固定速率漏出去
     * 特点：输出速率恒定，突发流量会被平滑
     */
    public synchronized boolean tryAcquire(int permits) {
        leak();
        if (water.get() + permits &lt;= capacity) {
            water.addAndGet(permits);
            return true;
        }
        return false;
    }

    /**
     * 按时间漏水
     */
    private void leak() {
        long now = System.currentTimeMillis();
        long elapsed = now - lastLeakTime.get();
        long leaked = (long) (elapsed * leakRate / 1000.0);
        if (leaked &gt; 0) {
            water.set(Math.max(0, water.get() - leaked));
            lastLeakTime.set(now);
        }
    }
}
```

---

## 核心设计：分布式限流

单机限流容易，分布式限流难——多个节点如何共享限流状态？

### 方案一：Redis + Lua 原子操作

```java
public class DistributedRateLimiter {

    private final RedisTemplate&lt;String, Object&gt; redisTemplate;

    /**
     * Redis + Lua 实现滑动窗口限流
     * Lua 脚本保证检查和更新的原子性
     */
    public boolean tryAcquire(String key, int limit, int windowSeconds) {
        String luaScript =
            "local key = KEYS[1] " +
            "local limit = tonumber(ARGV[1]) " +
            "local window = tonumber(ARGV[2]) " +
            "local now = tonumber(ARGV[3]) " +
            "local window_start = now - window * 1000 " +
            // 删除窗口外的记录
            "redis.call('zremrangebyscore', key, 0, window_start) " +
            // 统计窗口内请求数
            "local count = redis.call('zcard', key) " +
            "if count &lt; limit then " +
            "  redis.call('zadd', key, now, now .. ':' .. math.random()) " +
            "  redis.call('expire', key, window) " +
            "  return 1 " +
            "else " +
            "  return 0 " +
            "end";

        Long result = redisTemplate.execute(
            new DefaultRedisScript&lt;&gt;(luaScript, Long.class),
            Collections.singletonList(key),
            limit, windowSeconds, System.currentTimeMillis()
        );

        return result != null &amp;&amp; result == 1;
    }
}
```

### 方案二：Redis 令牌桶

```java
public class RedisTokenBucket {

    private final RedisTemplate&lt;String, Object&gt; redisTemplate;

    /**
     * Redis 令牌桶实现
     * 使用 Lua 脚本保证原子性
     */
    public boolean tryAcquire(String key, int capacity, int refillTokens, int refillPeriodSeconds) {
        String luaScript =
            "local key = KEYS[1] " +
            "local capacity = tonumber(ARGV[1]) " +
            "local refill_tokens = tonumber(ARGV[2]) " +
            "local refill_period = tonumber(ARGV[3]) " +
            "local now = tonumber(ARGV[4]) " +
            "local requested = 1 " +

            // 获取当前令牌数和上次更新时间
            "local bucket = redis.call('hmget', key, 'tokens', 'last_time') " +
            "local tokens = tonumber(bucket[1]) or capacity " +
            "local last_time = tonumber(bucket[2]) or now " +

            // 计算应该补充的令牌数
            "local elapsed = now - last_time " +
            "local refill = math.floor(elapsed / (refill_period * 1000)) * refill_tokens " +
            "tokens = math.min(capacity, tokens + refill) " +

            // 检查是否有足够令牌
            "if tokens &gt;= requested then " +
            "  tokens = tokens - requested " +
            "  redis.call('hmset', key, 'tokens', tokens, 'last_time', now) " +
            "  redis.call('expire', key, refill_period * 2) " +
            "  return 1 " +
            "else " +
            "  redis.call('hmset', key, 'tokens', tokens, 'last_time', now) " +
            "  return 0 " +
            "end";

        Long result = redisTemplate.execute(
            new DefaultRedisScript&lt;&gt;(luaScript, Long.class),
            Collections.singletonList(key),
            capacity, refillTokens, refillPeriodSeconds, System.currentTimeMillis()
        );

        return result != null &amp;&amp; result == 1;
    }
}
```

---

## 延伸问题

### Q1：限流后怎么告知用户？

- **HTTP 429**：Too Many Requests
- **返回 Retry-After 头**：告诉用户多久后重试
- **返回错误码**：如 `RATE_LIMIT_EXCEEDED`，前端据此展示友好提示

### Q2：如何实现多维度限流？

可以使用**复合 Key**：`user:123:ip:192.168.1.1:接口:order`

限流结果取所有维度的最小值。

### Q3：限流和熔断有什么区别？

限流发生在流量入口，熔断发生在调用下游时。

- **限流**：保护自己不被压垮
- **熔断**：保护不被下游拖垮

两者配合使用。

---

## 总结

四种限流算法对比：

| 算法 | 特点 | 适用场景 |
|---|---|---|
| 计数器 | 简单 | 简单限流 |
| 滑动窗口 | 精确 | 生产环境 |
| 令牌桶 | 支持突发 | 突发流量场景 |
| 漏桶 | 平滑输出 | 严格限流 |

记住：**限流不是拒绝服务，是保护系统。**

好的限流策略，应该让大部分正常用户通过，只拒绝少量异常流量。
