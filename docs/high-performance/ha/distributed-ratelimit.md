# 分布式限流：Redis + Lua 令牌桶实现

单机限流只能保护单机，但在分布式环境下，请求分布在多台机器上。

如果你的服务有 10 台机器，每台机器单机限流 100 QPS，理论上你能扛 1000 QPS。

但问题是：**流量可能全打在同一台机器上**。

这就是为什么需要分布式限流。

## 分布式限流的挑战

### 单机限流的问题

```
用户流量
    │
    ▼
┌─────────────────────────────────┐
│          负载均衡器              │
└─────────────────────────────────┘
    │       │       │
    ▼       ▼       ▼
┌───────┐┌───────┐┌───────┐
│ S1    ││ S2    ││ S3    │
│限流100││限流100││限流100│  ← 每台独立限流
└───────┘└───────┘└───────┘

问题：流量全打到 S1，S1 限流触发，但 S2、S3 空闲
```

### 分布式限流的目标

```
用户流量
    │
    ▼
┌─────────────────────────────────┐
│          Redis (共享状态)        │
│         全局限流：1000 QPS        │
└─────────────────────────────────┘
    │       │       │
    ▼       ▼       ▼
┌───────┐┌───────┐┌───────┐
│ S1    ││ S2    ││ S3    │
│       ││       ││       │
└───────┘└───────┘└───────┘

所有机器共享 Redis 状态，统一限流
```

## Redis + Lua 令牌桶实现

### 令牌桶算法回顾

```
令牌补充速率：R 个/秒
桶容量：C 个
当前令牌：T

请求到达：
- 如果 T >= 1：T--，放行
- 如果 T < 1：拒绝
```

### Lua 脚本实现

```lua
-- 令牌桶限流 Lua 脚本
-- KEYS[1]: 限流 key
-- ARGV[1]: 桶容量
-- ARGV[2]: 令牌补充速率（个/秒）
-- ARGV[3]: 当前时间戳（毫秒）

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- 初始化桶
local bucket = redis.call('HMGET', key, 'tokens', 'last_time')
local tokens = tonumber(bucket[1])
local last_time = tonumber(bucket[2])

-- 初始化
if tokens == nil then
    tokens = capacity
    last_time = now
end

-- 计算应该补充的令牌数
local elapsed = (now - last_time) / 1000.0  -- 转换为秒
local added = elapsed * refill_rate
tokens = math.min(capacity, tokens + added)

-- 尝试消费令牌
local allowed = 0
if tokens >= 1 then
    tokens = tokens - 1
    allowed = 1
end

-- 更新桶状态
redis.call('HMSET', key, 'tokens', tokens, 'last_time', now)
redis.call('EXPIRE', key, 60)  -- 60 秒无访问则过期

return allowed
```

### Java 客户端封装

```java
@Component
public class RedisTokenBucketLimiter {

    private final RedisTemplate&lt;String, String&gt; redisTemplate;
    private final String luaScript;

    public RedisTokenBucketLimiter(RedisTemplate&lt;String, String&gt; redisTemplate) {
        this.redisTemplate = redisTemplate;

        // 加载 Lua 脚本
        this.luaScript = """
            local key = KEYS[1]
            local capacity = tonumber(ARGV[1])
            local refill_rate = tonumber(ARGV[2])
            local now = tonumber(ARGV[3])

            local bucket = redis.call('HMGET', key, 'tokens', 'last_time')
            local tokens = tonumber(bucket[1])
            local last_time = tonumber(bucket[2])

            if tokens == nil then
                tokens = capacity
                last_time = now
            end

            local elapsed = (now - last_time) / 1000.0
            local added = elapsed * refill_rate
            tokens = math.min(capacity, tokens + added)

            local allowed = 0
            if tokens >= 1 then
                tokens = tokens - 1
                allowed = 1
            end

            redis.call('HMSET', key, 'tokens', tokens, 'last_time', now)
            redis.call('EXPIRE', key, 60)

            return allowed
            """;

        // 注册 Lua 脚本
        this.redisScript = redisTemplate.scriptOperations()
            .scriptOps(new DefaultRedisScript&lt;&gt;(luaScript, Long.class));
    }

    public boolean tryAcquire(String key, int capacity, double permitsPerSecond) {
        Long result = redisTemplate.execute(
            redisScript,
            Collections.singletonList(key),
            capacity,
            permitsPerSecond,
            System.currentTimeMillis()
        );
        return result != null && result == 1;
    }

    public boolean tryAcquire(String key, int capacity, double permitsPerSecond,
            long timeout, TimeUnit unit) {
        long deadline = System.currentTimeMillis() + unit.toMillis(timeout);

        while (System.currentTimeMillis() < deadline) {
            if (tryAcquire(key, capacity, permitsPerSecond)) {
                return true;
            }
            // 等待一小段时间后重试
            try {
                Thread.sleep(10);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }

        return false;
    }
}
```

## 滑动窗口限流实现

除了令牌桶，滑动窗口也是常用的分布式限流算法。

### Redis ZSet 实现

```lua
-- 滑动窗口限流 Lua 脚本
-- KEYS[1]: 限流 key
-- ARGV[1]: 窗口大小（毫秒）
-- ARGV[2]: 限流阈值
-- ARGV[3]: 当前时间戳

local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local window_start = now - window

-- 删除窗口外的数据
redis.call('ZREMRANGEBYSCORE', key, 0, window_start)

-- 获取窗口内请求数
local current = redis.call('ZCARD', key)

if current < limit then
    -- 添加新请求
    redis.call('ZADD', key, now, now .. '-' .. math.random())
    -- 设置过期时间
    redis.call('EXPIRE', key, math.ceil(window / 1000) + 1)
    return 1
else
    return 0
end
```

### Java 实现

```java
@Service
public class RedisSlidingWindowLimiter {

    private final RedisTemplate&lt;String, String&gt; redisTemplate;
    private final DefaultRedisScript&lt;Long&gt; script;

    public RedisSlidingWindowLimiter(RedisTemplate&lt;String, String&gt; redisTemplate) {
        this.redisTemplate = redisTemplate;

        String luaScript = """
            local key = KEYS[1]
            local window = tonumber(ARGV[1])
            local limit = tonumber(ARGV[2])
            local now = tonumber(ARGV[3])
            local window_start = now - window

            redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
            local current = redis.call('ZCARD', key)

            if current < limit then
                redis.call('ZADD', key, now, now .. '-' .. math.random())
                redis.call('EXPIRE', key, math.ceil(window / 1000) + 1)
                return 1
            else
                return 0
            end
            """;

        script = new DefaultRedisScript&lt;&gt;(luaScript, Long.class);
    }

    public boolean tryAcquire(String key, long windowMs, int limit) {
        Long result = redisTemplate.execute(
            script,
            Collections.singletonList(key),
            windowMs,
            limit,
            System.currentTimeMillis()
        );
        return result != null && result == 1;
    }
}
```

## 多维度限流

### 维度组合

```java
@Service
public class MultiDimensionalRateLimiter {

    private final RedisTemplate&lt;String, String&gt; redisTemplate;
    private final RedisTokenBucketLimiter tokenBucketLimiter;
    private final RedisSlidingWindowLimiter slidingWindowLimiter;

    // 限流维度定义
    public enum LimitDimension {
        USER,           // 用户维度
        API,            // 接口维度
        IP,             // IP 维度
        GLOBAL          // 全局限流
    }

    public boolean tryAcquire(LimitDimension dimension, String dimensionValue,
            String api, int limit, long windowMs) {
        String key = buildKey(dimension, dimensionValue, api);

        switch (dimension) {
            case GLOBAL:
                // 全局使用令牌桶
                return tokenBucketLimiter.tryAcquire(key, limit,
                    limit / (windowMs / 1000.0));

            case USER:
            case API:
            case IP:
                // 其他维度使用滑动窗口
                return slidingWindowLimiter.tryAcquire(key, windowMs, limit);

            default:
                return true;
        }
    }

    private String buildKey(LimitDimension dimension,
            String dimensionValue, String api) {
        return String.format("ratelimit:%s:%s:%s",
            dimension.name().toLowerCase(),
            dimensionValue,
            api);
    }
}
```

### 实际使用

```java
@RestController
public class OrderController {

    @Autowired
    private MultiDimensionalRateLimiter rateLimiter;

    @PostMapping("/api/order/create")
    public Response createOrder(HttpServletRequest request,
            @RequestBody OrderRequest orderRequest) {
        String userId = getUserId(request);
        String ip = getClientIp(request);
        String api = "/api/order/create";

        // 第一层：全局限流
        if (!rateLimiter.tryAcquire(
                LimitDimension.GLOBAL, "global", api, 10000, 1000)) {
            return Response.fail("系统繁忙，请稍后重试");
        }

        // 第二层：用户限流
        if (!rateLimiter.tryAcquire(
                LimitDimension.USER, userId, api, 5, 1000)) {
            return Response.fail("下单过于频繁，请稍后重试");
        }

        // 第三层：IP 限流
        if (!rateLimiter.tryAcquire(
                LimitDimension.IP, ip, api, 20, 1000)) {
            return Response.fail("请求过于频繁，请稍后重试");
        }

        // 通过限流，执行业务
        return doCreateOrder(orderRequest);
    }
}
```

## 分布式限流的坑

### 1. Redis 单点故障

```java
@Configuration
public class RedisConfig {

    @Bean
    public RedisTemplate&lt;String, String&gt; redisTemplate(
            RedisConnectionFactory factory) {
        RedisTemplate&lt;String, String&gt; template =
            new RedisTemplate&lt;&gt;();
        template.setConnectionFactory(factory);
        return template;
    }

    // 使用 Redis Cluster 或 Sentinel 提高可用性
    // 这里只是简化示例
}
```

### 2. 限流精度问题

```
问题：多个服务实例同时检查 Redis
     可能导致实际流量超过限流阈值

T1 时刻：
- 实例 1 检查：当前 99，请求通过，当前 100
- 实例 2 检查：当前 100（还没来得及更新），请求通过，当前 101
- 实例 3 检查：当前 101（还没来得及更新），请求通过，当前 102

实际：102 个请求通过，限流阈值 100
```

**解决方案：使用 Lua 脚本保证原子性**

### 3. 性能问题

```java
// 优化：减少 Redis 调用
public class OptimizedRateLimiter {

    // 本地缓存 + 远程限流
    private final LoadingCache&lt;String, Boolean&gt; localCache =
        CacheBuilder.newBuilder()
            .maximumSize(10000)
            .expireAfterWrite(100, TimeUnit.MILLISECONDS)  // 100ms 本地缓存
            .build(new CacheLoader&lt;String, Boolean&gt;() {
                @Override
                public Boolean load(String key) {
                    // 本地缓存未命中，查询 Redis
                    return redisLimiter.tryAcquire(key);
                }
            });

    public boolean tryAcquire(String key) {
        // 先查本地缓存
        if (localCache.getIfPresent(key) == Boolean.FALSE) {
            return false;
        }
        return true;
    }
}
```

### 4. 分布式锁 + 限流

```java
public class RateLimiterWithLock {

    public boolean tryAcquireWithLock(String key,
            int capacity, double rate) {
        String lockKey = key + ":lock";

        // 尝试获取分布式锁
        Boolean locked = redisTemplate.opsForValue()
            .setIfAbsent(lockKey, "1",
                Duration.ofMillis(100));

        if (Boolean.TRUE.equals(locked)) {
            try {
                // 执行业务
                return doAcquire(key, capacity, rate);
            } finally {
                // 释放锁
                redisTemplate.delete(lockKey);
            }
        }

        // 获取锁失败，快速失败
        return false;
    }
}
```

## 完整示例：订单服务限流

```java
@Service
@Slf4j
public class OrderRateLimitService {

    private final RedisTemplate&lt;String, String&gt; redisTemplate;
    private final DefaultRedisScript&lt;Long&gt; script;

    public OrderRateLimitService(
            RedisTemplate&lt;String, String&gt; redisTemplate) {
        this.redisTemplate = redisTemplate;

        this.script = new DefaultRedisScript&lt;&gt;();
        this.script.setScriptText(getLuaScript());
        this.script.setResultType(Long.class);
    }

    private String getLuaScript() {
        return """
            local key = KEYS[1]
            local limit = tonumber(ARGV[1])
            local window = tonumber(ARGV[2])
            local now = tonumber(ARGV[3])

            -- 使用滑动窗口计数
            local window_start = now - window
            redis.call('ZREMRANGEBYSCORE', key, 0, window_start)

            local count = redis.call('ZCARD', key)
            if count < limit then
                redis.call('ZADD', key, now, now .. '-' .. math.random())
                redis.call('EXPIRE', key, math.ceil(window / 1000) + 1)
                return 1
            end

            return 0
            """;
    }

    public boolean tryCreateOrder(String userId, String orderId) {
        String key = String.format("order:ratelimit:%s", userId);

        Long result = redisTemplate.execute(
            script,
            Collections.singletonList(key),
            5,      // 每用户每秒最多 5 单
            1000,   // 1 秒窗口
            System.currentTimeMillis()
        );

        if (result == null || result == 0) {
            log.warn("用户 {} 下单限流触发，orderId={}", userId, orderId);
            return false;
        }

        return true;
    }
}
```

---

**思考题：**

假设你在实现一个分布式下单限流系统，要求每用户每秒最多下单 5 次。

问题：
1. 使用 Redis ZSet 实现滑动窗口限流，当用户每秒请求 6 次时，会发生什么？限流是否准确？
2. 如果 Redis 发生短暂故障（比如 5 秒不可用），你的限流系统会怎样处理？有没有降级策略？
3. 如果让你实现一个「允许适度突发」的分布式限流（比如平时每秒 5 次，但可以累积到最多 20 次），你会怎么修改 Lua 脚本？
4. 在高并发场景下，Redis 限流可能成为性能瓶颈。你有什么优化方案？

提示：考虑本地缓存、异步更新、令牌桶 vs 滑动窗口的选择。
