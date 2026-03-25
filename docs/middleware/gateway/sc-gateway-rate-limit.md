# Spring Cloud Gateway 限流

你有没有遇到过这种情况：电商网站在秒杀活动时，服务器被瞬间涌入的请求压垮？如果网关做了限流，这种情况就不会发生。

限流（Rate Limiting）是网关保护后端服务的核心能力之一。Spring Cloud Gateway 内置了基于 Redis 的限流过滤器：`RequestRateLimiter`。

## 限流算法

在深入配置之前，先了解几种常见的限流算法：

### 令牌桶算法

令牌桶是最常用的限流算法：

```
                    ┌─────────────┐
    请求 ────────▶ │   请求桶    │ ───────▶  放行或拒绝
                    └──────┬──────┘
                           │
                           │ 拿取令牌
                           ▼
                    ┌─────────────┐
         补充令牌 ─▶│   令牌桶    │ ◀── 固定速率补充
                    │  (容量=100) │
                    └─────────────┘
```

**特点**：
- 可以处理突发流量（桶满时）
- 长期稳定的请求速率

### 滑动窗口算法

将时间窗口划分为多个小窗口，统计落在窗口内的请求数：

```
时间轴 ──────────────────────────────────────────────────▶

窗口 [0-5s] ─┬─ [5-10s] ─┬─ [10-15s] ─┬─ [15-20s] ─┬─
              │            │            │            │
              ▼            ▼            ▼            ▼
            100个       150个        80个         120个
              │                         
              └─────── 当前窗口(15s内) ───────┘
                      总请求 = 150 + 80 = 230
```

**特点**：
- 计数更平滑
- Redis 实现常用 Lua 脚本保证原子性

### 漏桶算法

请求像水滴一样进入桶中，以固定速率漏出：

```
请求 ──▶ ┌──────────┐ ──▶ 固定速率输出 ──▶ 后端服务
         │   漏桶   │
         │ (队列)   │
         └──────────┘
           ↑
      满了就拒绝
```

**特点**：
- 严格控制输出速率
- 不适合突发流量场景

## RequestRateLimiter 配置

Spring Cloud Gateway 的限流基于 Redis，使用令牌桶算法：

### 基本配置

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: limited-route
          uri: http://service:8080
          predicates:
            - Path=/api/**
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 100      # 每秒补充 100 个令牌
                redis-rate-limiter.burstCapacity: 200      # 桶容量 200
                redis-rate-limiter.requestedToken: 1        # 每个请求消耗 1 个令牌
```

| 参数 | 说明 | 示例值 |
|---|---|---|
| replenishRate | 令牌补充速率（每秒） | 100 |
| burstCapacity | 令牌桶容量 | 200 |
| requestedToken | 每个请求消耗的令牌数 | 1 |

### 按用户限流

基于请求中的某个值（如用户 ID）做细粒度限流：

```yaml
filters:
  - name: RequestRateLimiter
    args:
      redis-rate-limiter.replenishRate: 100
      redis-rate-limiter.burstCapacity: 200
      key-resolver: "#{@userKeyResolver}"  # SpEL 表达式，引用 Bean
```

```java
@Configuration
public class RateLimitConfig {
    
    @Bean
    public KeyResolver userKeyResolver() {
        // 按用户 ID 限流
        return exchange -&gt; Mono.just(
            exchange.getAttribute("userId")  // 从认证过滤器获取
        );
    }
    
    @Bean
    public KeyResolver ipKeyResolver() {
        // 按 IP 限流
        return exchange -&gt; Mono.just(
            exchange.getRequest().getRemoteAddress()
                .getAddress().getHostAddress()
        );
    }
    
    @Bean
    public KeyResolver pathKeyResolver() {
        // 按路径限流
        return exchange -&gt; Mono.just(
            exchange.getRequest().getPath().value()
        );
    }
    
    @Bean
    public KeyResolver compositeKeyResolver() {
        // 组合维度：用户 + 路径
        return exchange -&gt; {
            String userId = exchange.getAttribute("userId");
            String path = exchange.getRequest().getPath().value();
            return Mono.just(userId + ":" + path);
        };
    }
}
```

### 多维度限流

可以配置多个限流规则，对不同的路由使用不同的限流策略：

```yaml
spring:
  cloud:
    gateway:
      routes:
        # 普通接口：每人 100 QPS
        - id: normal-api
          uri: http://service:8080
          predicates:
            - Path=/api/normal/**
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 100
                redis-rate-limiter.burstCapacity: 200
                key-resolver: "#{@userKeyResolver}"
        
        # 敏感接口：每人 10 QPS
        - id: sensitive-api
          uri: http://service:8080
          predicates:
            - Path=/api/sensitive/**
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 10
                redis-rate-limiter.burstCapacity: 20
                key-resolver: "#{@userKeyResolver}"
        
        # 全局限流：总共 10000 QPS
        - id: global-limit
          uri: http://service:8080
          predicates:
            - Path=/api/**
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 10000
                redis-rate-limiter.burstCapacity: 20000
                key-resolver: "#{@ipKeyResolver}"
```

## Redis 限流原理

### Lua 脚本保证原子性

限流操作需要读取和写入两个步骤，为了保证原子性，Spring Cloud Gateway 使用 Lua 脚本：

```lua
-- Spring Cloud Gateway 内置的 Lua 限流脚本
local tokens_key = KEYS[1]
local timestamp_key = KEYS[2]

-- 配置参数
local rate = tonumber(ARGV[1])        -- 补充速率
local capacity = tonumber(ARGV[2])    -- 桶容量
local now = tonumber(ARGV[3])         -- 当前时间戳
local requested = tonumber(ARGV[4])   -- 请求的令牌数

-- 计算上次补充令牌的时间
local last_tokens = tonumber(redis.call("get", tokens_key))
if last_tokens == nil then
    last_tokens = capacity
end

local last_refreshed = tonumber(redis.call("get", timestamp_key))
if last_refreshed == nil then
    last_refreshed = now
end

-- 计算应该补充的令牌数
local delta = math.max(0, (now - last_refreshed) * rate)
local filled_tokens = math.min(capacity, last_tokens + delta)

-- 检查是否有足够的令牌
if filled_tokens >= requested then
    filled_tokens = filled_tokens - requested
    redis.call("set", tokens_key, filled_tokens)
    redis.call("set", timestamp_key, now)
    return 1  -- 允许通过
else
    redis.call("set", tokens_key, filled_tokens)
    redis.call("set", timestamp_key, now)
    return 0  -- 拒绝
end
```

### 自定义限流实现

如果需要更灵活的限流策略，可以自己实现：

```java
@Component
@Slf4j
public class CustomRateLimiterFilter implements GatewayFilter, Ordered {
    
    private final RedisTemplate&lt;String, String&gt; redisTemplate;
    private final RedissonClient redissonClient;
    
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String key = getKey(exchange);
        int limit = 100;  // QPS
        int window = 1;   // 窗口大小（秒）
        
        // 使用 Redisson 的滑动窗口限流
        RRateLimiter limiter = redissonClient.getRateLimiter("gateway:limiter:" + key);
        limiter.trySetRate(RateType.OVERALL, limit, window, RateIntervalUnit.SECONDS);
        
        if (limiter.tryAcquire()) {
            return chain.filter(exchange);
        } else {
            // 限流触发
            exchange.getResponse().setStatusCode(HttpStatus.TOO_MANY_REQUESTS);
            exchange.getResponse().getHeaders().add("Content-Type", "application/json");
            
            String body = String.format(
                "{\"code\": 429, \"message\": \"Rate limit exceeded. Limit: %d QPS\"}", limit);
            
            return exchange.getResponse().writeWith(
                Mono.just(exchange.getResponse().bufferFactory().wrap(body.getBytes()))
            );
        }
    }
    
    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 10;  // 在认证之后执行
    }
    
    private String getKey(ServerWebExchange exchange) {
        // 组合用户ID和路径作为限流 key
        String userId = exchange.getAttribute("userId");
        String path = exchange.getRequest().getPath().value();
        return userId + ":" + path;
    }
}
```

## 限流后的处理

当请求被限流时，应该给客户端明确的响应：

```java
@Configuration
public class RateLimitResponseConfig {
    
    @Bean
    @Order(-1)
    public GlobalFilter rateLimitResponseFilter() {
        return (exchange, chain) -&gt; chain.filter(exchange)
            .then(Mono.fromRunnable(() -&gt; {
                HttpStatus status = exchange.getResponse().getStatusCode();
                if (status == HttpStatus.TOO_MANY_REQUESTS) {
                    // 添加限流相关的响应头
                    exchange.getResponse().getHeaders().add("X-RateLimit-Retry-After", "1");
                    exchange.getResponse().getHeaders().add("X-RateLimit-Limit", "100");
                }
            }));
    }
}
```

客户端收到 429 响应后，可以：

1. **等待后重试**：根据 `Retry-After` 头等待指定时间
2. **指数退避**：每次重试的等待时间指数增长
3. **放弃请求**：超过最大重试次数后放弃

```java
// 客户端重试示例
public Mono&lt;String&gt; requestWithRetry(String url) {
    return WebClient.create()
        .get()
        .uri(url)
        .retrieve()
        .bodyToMono(String.class)
        .retryWhen(Retry.backoff(3, Duration.ofSeconds(1))
            .filter(ex -> ex instanceof RateLimitException)
            .doBeforeRetry(signal -&gt; {
                // 指数退避
                long wait = (long) Math.pow(2, signal.totalRetries());
                try {
                    Thread.sleep(wait * 1000);
                } catch (InterruptedException ignored) {}
            }));
}
```

## 总结

| 限流维度 | 配置方式 | 说明 |
|---|---|---|
| 全局限流 | 全局限流器 | 限制所有请求 |
| 服务限流 | 路由限流器 | 限制特定服务 |
| 用户限流 | KeyResolver | 按用户 ID 区分 |
| IP 限流 | KeyResolver | 按 IP 地址区分 |
| 接口限流 | KeyResolver | 按请求路径区分 |

限流算法对比：

| 算法 | 特点 | 适用场景 |
|---|---|---|
| 令牌桶 | 允许突发 | 大多数场景 |
| 滑动窗口 | 平滑计数 | 精确限流 |
| 漏桶 | 严格限速 | 严格控制输出 |

---

**留给你的问题**

限流虽好，但也带来一个问题：**误杀**。如果一个正常用户恰好在秒杀时发起请求，他会被限流吗？

你会如何设计一个「智能限流」系统，既能保护系统，又能减少误杀？提示：可以考虑**动态调整限流阈值**或**排队机制**。
