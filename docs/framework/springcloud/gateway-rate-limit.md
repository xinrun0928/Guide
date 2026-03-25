# Gateway 限流，RequestRateLimiter 与 Redis

> 电商系统大促，流量是平时的 10 倍。如果不对网关限流，后端服务会被瞬时流量打垮。
>
> Gateway 内置的限流过滤器，配合 Redis，让你轻松实现分布式限流。

---

## 为什么要限流

### 场景一：突发流量

```
正常流量:  100 QPS ───────────────────────
          │
实际流量:  1000 QPS ───────
                │  ← 服务扛不住
                ▼
          服务崩溃，响应超时
```

### 场景二：恶意请求

```
正常用户: ████████████████████
攻击者:   ████████████████████████████████████████
         10% 的请求占用 90% 的资源
```

### 场景三：资源争抢

```
用户 A: 大量请求占用连接池
用户 B: 等待超时
用户 C: 页面打不开
用户 D: 愤怒投诉
```

**限流，就是给系统装上「保险丝」，保护后端服务不被瞬时流量打垮。**

---

## 限流算法

### 1. 计数器算法

最简单但有「突刺问题」：

```
时间窗口: 1 分钟
限流阈值: 100 请求

00:00 - 00:30 → 60 请求
00:30 - 00:31 → 40 请求（窗口重置）
00:31 - 01:00 → 0 请求（浪费后半段容量）
```

### 2. 滑动窗口算法

解决突刺问题：

```
将时间窗口切分为多个小窗口
[5s|5s|5s|5s|5s|5s|5s|5s|5s|5s|5s|5s] = 1 分钟

当前窗口请求数 = 最近 12 个小窗口的和
```

### 3. 令牌桶算法（Gateway 采用）

允许一定程度的突发流量：

```
┌─────────────────────────────────────┐
│           令牌桶                     │
│                                     │
│   ┌───┐                            │
│   │ T │ ──► 取出令牌 ──► 处理请求   │
│   │ T │                            │
│   │ T │      按固定速率放入令牌      │
│   │   │                            │
│   └───┘                            │
└─────────────────────────────────────┘

特点：
- 桶满时令牌溢出（不会累积）
- 允许一定突发（只要桶里有令牌）
```

### 4. 漏桶算法

严格控制请求速率：

```
┌─────────────────────────────────────┐
│           漏桶                       │
│                                     │
│   请求 ──► 进桶 ──► 按固定速率漏出   │
│                 │                   │
│                 ▼                   │
│            超过容量则拒绝            │
└─────────────────────────────────────┘

特点：
- 严格平稳输出
- 不允许突发
```

---

## Gateway 限流快速开始

### 1. 引入依赖

```xml
<dependencies>
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-starter-gateway</artifactId>
    </dependency>
    
    <!-- Redis 连接 -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-data-redis-reactive</artifactId>
    </dependency>
</dependencies>
```

### 2. 启用限流

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/api/users/**
          filters:
            - name: RequestRateLimiter
              args:
                # 每秒允许的请求数
                redis-rate-limiter.replenishRate: 100
                # 桶容量（最大突发流量）
                redis-rate-limiter.burstCapacity: 200
```

### 3. 配置 Redis

```yaml
spring:
  redis:
    host: localhost
    port: 6379
    password:
    database: 0
    lettuce:
      pool:
        max-active: 8
        max-idle: 8
        min-idle: 0
```

---

## 限流维度

### 基于请求路径

```yaml
filters:
  - name: RequestRateLimiter
    args:
      redis-rate-limiter.replenishRate: 100
      redis-rate-limiter.burstCapacity: 200
      # 默认基于请求路径限流
```

### 基于用户（通过参数指定）

```yaml
filters:
  - name: RequestRateLimiter
    args:
      redis-rate-limiter.replenishRate: 100
      redis-rate-limiter.burstCapacity: 200
      key-resolver: '#{@userKeyResolver}'  # 自定义 Key 解析器
```

```java
@Configuration
public class RateLimiterConfig {
    
    // 基于用户 ID 限流
    @Bean
    public KeyResolver userKeyResolver() {
        return exchange -> Mono.just(
            exchange.getRequest().getHeaders().getFirst("X-User-Id")
        );
    }
}
```

### 基于 IP 地址

```java
@Bean
public KeyResolver ipKeyResolver() {
    return exchange -> Mono.just(
        exchange.getRequest().getRemoteAddress()
            .getAddress()
            .getHostAddress()
    );
}
```

### 基于接口路径

```java
@Bean
public KeyResolver pathKeyResolver() {
    return exchange -> Mono.just(
        exchange.getRequest().getPath().value()
    );
}
```

### 组合维度

```java
@Bean
public KeyResolver userPathKeyResolver() {
    return exchange -> {
        String userId = exchange.getRequest().getHeaders().getFirst("X-User-Id");
        String path = exchange.getRequest().getPath().value();
        return Mono.just(userId + "_" + path);
    };
}
```

---

## 自定义限流器

### 实现 RateLimiter 接口

```java
@Component
public class CustomRateLimiter implements RateLimiter&lt;Object&gt; {
    
    private final RedisTemplate&lt;String, String&gt; redisTemplate;
    
    public CustomRateLimiter(RedisTemplate&lt;String, String&gt; redisTemplate) {
        this.redisTemplate = redisTemplate;
    }
    
    @Override
    public Mono&lt;ServerWebExchange&gt; isAllowed(String routeId, String id) {
        // 1. 获取限流配置
        Config config = getConfig().get(routeId);
        if (config == null) {
            return Mono.just(true);  // 无配置，不限流
        }
        
        // 2. 生成 Redis Key
        String key = "rate_limit:" + routeId + ":" + id;
        
        // 3. 原子操作限流
        return redisTemplate.execute(
            new RedisCallback&lt;Boolean&gt;() {
                @Override
                public Boolean doInRedis(RedisOperations operations) throws DataAccessException {
                    // Lua 脚本保证原子性
                    return true;  // 实际实现见下方
                }
            }
        );
    }
}
```

### Lua 脚本实现

Gateway 使用 Lua 脚本实现令牌桶：

```lua
-- token_bucket.lua
local key = KEYS[1]           -- 限流 key
local rate = tonumber(ARGV[1])       -- 补充速率
local capacity = tonumber(ARGV[2])    -- 桶容量
local now = tonumber(ARGV[3])         -- 当前时间戳
local requested = tonumber(ARGV[4])   -- 请求数量

-- 获取当前令牌数
local last_tokens = tonumber(redis.call('get', key) or capacity)
-- 获取上次补充时间
local last_refreshed = tonumber(redis.call('get', key .. ':timestamp') or now)

-- 计算需要补充的令牌
local delta = math.max(0, (now - last_refreshed) * rate)
local tokens = math.min(capacity, last_tokens + delta)

-- 检查是否允许
if tokens >= requested then
    tokens = tokens - requested
    redis.call('set', key, tokens)
    redis.call('set', key .. ':timestamp', now)
    return {1, tokens}  -- 允许
else
    return {0, tokens}  -- 拒绝
end
```

---

## 不同场景的限流配置

### 场景一：普通接口

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: normal-api
          uri: lb://normal-service
          predicates:
            - Path=/api/normal/**
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 1000
                redis-rate-limiter.burstCapacity: 2000
```

### 场景二：敏感接口（更严格的限流）

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: sensitive-api
          uri: lb://sensitive-service
          predicates:
            - Path=/api/sensitive/**
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 10
                redis-rate-limiter.burstCapacity: 20
```

### 场景三：登录接口（防暴力破解）

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: login-api
          uri: lb://auth-service
          predicates:
            - Path=/api/auth/login
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 5
                redis-rate-limiter.burstCapacity: 10
                key-resolver: '#{@ipKeyResolver}'  # 基于 IP
```

---

## 限流后的响应

### 默认行为

默认返回 `429 Too Many Requests`。

### 自定义响应

```yaml
spring:
  cloud:
    gateway:
      default-filters:
        - name: RequestRateLimiter
          args:
            redis-rate-limiter.replenishRate: 100
            redis-rate-limiter.burstCapacity: 200
      # 自定义 Response Writer
```

```java
@Component
public class RateLimitResponseWriter implements GatewayFilter, ErrorWebExceptionHandler {
    
    @Override
    public Mono&lt;Void&gt; handle(ServerWebExchange exchange, Throwable ex) {
        if (ex instanceof RateLimitException) {
            ServerHttpResponse response = exchange.getResponse();
            response.setStatusCode(HttpStatus.TOO_MANY_REQUESTS);
            response.getHeaders().add("Content-Type", "application/json");
            
            String body = "{\"code\":429,\"msg\":\"访问太频繁，请稍后再试\"}";
            DataBuffer buffer = response.bufferFactory().wrap(body.getBytes());
            
            return response.writeWith(Mono.just(buffer));
        }
        return Mono.error(ex);
    }
}
```

---

## 分布式限流 vs 本地限流

### 本地限流（Token Bucket）

```
┌────────────┐
│ Gateway 1  │ ← 本地限流 100 QPS
│ TokenBucket│
└────────────┘

┌────────────┐
│ Gateway 2  │ ← 本地限流 100 QPS
│ TokenBucket│
└────────────┘

总限流: 200 QPS（不符合预期）
```

### 分布式限流（Redis）

```
┌────────────┐
│  Redis     │ ← 全局限流 100 QPS
│  TokenBucket│
└────────────┘
      ▲
      │
┌─────┴─────┐
│ Gateway 1 │
└───────────┘
      ▲
      │
┌─────┴─────┐
│ Gateway 2 │
└───────────┘

总限流: 100 QPS（符合预期）
```

**Gateway 的 Redis 限流是分布式限流，多个 Gateway 实例共享一个限流计数器。**

---

## 面试高频问题

### Q：Gateway 限流用的什么算法？

A：Gateway 使用**令牌桶算法**，通过 Redis + Lua 脚本实现。令牌桶允许一定程度的突发流量，同时保证平均速率不超过设定值。

### Q：限流 Key 怎么确定？

A：通过 `KeyResolver` 接口自定义。常见的 Key 包括：用户 ID、IP 地址、请求路径、服务名等。可以组合多个维度。

### Q：replenishRate 和 burstCapacity 有什么区别？

A：`replenishRate` 是令牌补充速率（每秒），`burstCapacity` 是桶容量。**burstCapacity 必须 >= replenishRate**。burstCapacity 决定了允许的最大突发流量。

### Q：单机限流和分布式限流有什么区别？

A：单机限流每个 Gateway 实例独立限流，多实例总流量可能超出预期。分布式限流使用 Redis 作为共享计数器，保证全局限流。Gateway + Redis 是分布式限流。

---

## 总结

Gateway 限流提供了完整的限流能力：

1. **令牌桶算法**：允许突发流量，平稳处理请求
2. **Redis 存储**：分布式限流，多实例共享限流额度
3. **多维度 Key**：支持用户、IP、路径等多种限流维度
4. **Lua 脚本**：保证限流检查的原子性

> 限流是保护系统的高考手段。配合熔断降级，可以让系统在极端流量下依然保持可用。
