# API 网关性能优化：缓存、压缩、连接池

你有没有想过这个问题：

用户发起一个请求，请求经过网关 -> 认证服务 -> 业务服务 -> 数据库 -> 业务服务 -> 网关 -> 用户。

这条链路上的每一环，都可能是瓶颈。

**而 API 网关，是所有流量的入口。** 优化好网关，性能收益是成倍的。

---

## 一、API 网关的核心职责

### 1.1 网关在架构中的位置

```
┌─────────────────────────────────────────────────────────────┐
│                        客户端                               │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                      API Gateway                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐             │
│  │ 路由转发 │ │ 负载均衡 │ │ 限流熔断 │ │ 认证授权 │             │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐             │
│  │ 请求压缩 │ │ 响应压缩 │ │ 协议转换 │ │ 日志监控 │             │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘             │
└─────────────────────────┬───────────────────────────────────┘
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
     ┌──────────┐  ┌──────────┐  ┌──────────┐
     │  用户服务 │  │  订单服务 │  │  商品服务 │
     └──────────┘  └──────────┘  └──────────┘
```

### 1.2 请求处理流程

```java
/**
 * 网关请求处理流程
 */
public class GatewayRequestFlow {

    public static void main(String[] args) {
        System.out.println("========== 网关请求处理流程 ==========");
        System.out.println();

        System.out.println("1. 接收请求 (0ms)");
        System.out.println("   - NIO 接收 TCP 连接");
        System.out.println("   - 解析 HTTP 请求头/行");
        System.out.println();

        System.out.println("2. 协议处理 (~1ms)");
        System.out.println("   - HTTP/2 帧解析");
        System.out.println("   - TLS 握手 (如果是 HTTPS)");
        System.out.println();

        System.out.println("3. 安全检查 (~2ms)");
        System.out.println("   - IP 黑名单");
        System.out.println("   - WAF 规则匹配");
        System.out.println();

        System.out.println("4. 认证鉴权 (~10-50ms)");
        System.out.println("   - JWT 验证");
        System.out.println("   - Session 查询");
        System.out.println("   - ← 这里可能是瓶颈！");
        System.out.println();

        System.out.println("5. 限流检查 (~1ms)");
        System.out.println("   - 令牌桶/滑动窗口");
        System.out.println();

        System.out.println("6. 路由转发 (~1ms)");
        System.out.println("   - 目标服务选择");
        System.out.println("   - 负载均衡");
        System.out.println();

        System.out.println("7. 后端调用 (~10-500ms)");
        System.out.println("   - 连接池获取连接");
        System.out.println("   - 等待响应");
        System.out.println();

        System.out.println("8. 响应处理 (~1ms)");
        System.out.println("   - 响应压缩");
        System.out.println("   - 日志记录");
        System.out.println();

        System.out.println("总耗时: 25ms - 560ms");
        System.out.println("优化重点: 步骤 3, 4, 7");
    }
}
```

---

## 二、认证鉴权优化

### 2.1 JWT 本地验证

JWT 验证如果每次都查数据库或远程服务，性能损耗巨大：

```java
import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import javax.crypto.SecretKey;
import java.util.Date;

public class JwtLocalValidation {

    // 预加载密钥，避免每次创建
    private static final SecretKey SECRET_KEY =
            Keys.hmacShaKeyFor("your-256-bit-secret-key-here".getBytes());

    /**
     * 本地 JWT 验证 - O(1) 复杂度
     */
    public Claims validateJwt(String token) {
        try {
            return Jwts.parser()
                    .verifyWith(SECRET_KEY)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
        } catch (JwtException e) {
            throw new InvalidTokenException("Token 无效", e);
        }
    }

    /**
     * 检查 Token 是否过期
     */
    public boolean isTokenExpired(Claims claims) {
        Date expiration = claims.getExpiration();
        return expiration != null && expiration.before(new Date());
    }

    /**
     * 提取用户信息（不查库）
     */
    public UserInfo extractUserInfo(Claims claims) {
        return new UserInfo(
                claims.getSubject(),           // userId
                claims.get("username", String.class),
                claims.get("roles", List.class)
        );
    }
}

@Data
@AllArgsConstructor
class UserInfo {
    private String userId;
    private String username;
    private List&lt;String&gt; roles;
}
```

### 2.2 Token 缓存策略

```java
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;

public class TokenCacheService {

    private final Cache&lt;String, BlacklistToken&gt; blacklistCache;
    private final Cache&lt;String, UserPermission&gt; permissionCache;

    public TokenCacheService() {
        // 黑名单缓存：短期
        this.blacklistCache = Caffeine.newBuilder()
                .maximumSize(100_000)
                .expireAfterWrite(10, TimeUnit.MINUTES)
                .build();

        // 权限缓存：中期
        this.permissionCache = Caffeine.newBuilder()
                .maximumSize(50_000)
                .expireAfterWrite(30, TimeUnit.MINUTES)
                .build();
    }

    /**
     * 检查 Token 是否被拉黑
     */
    public boolean isBlacklisted(String tokenId) {
        return blacklistCache.getIfPresent(tokenId) != null;
    }

    /**
     * 拉黑 Token（退出登录时）
     */
    public void blacklistToken(String tokenId, Date expiration) {
        long ttl = expiration.getTime() - System.currentTimeMillis();
        blacklistCache.put(tokenId, new BlacklistToken(tokenId, expiration));
    }

    /**
     * 批量获取用户权限
     */
    public List&lt;String&gt; getUserPermissions(String userId) {
        return permissionCache.get(userId, this::loadPermissionsFromDb);
    }

    private List&lt;String&gt; loadPermissionsFromDb(String userId) {
        // 从数据库加载
        return Collections.emptyList();
    }
}
```

---

## 三、请求/响应缓存

### 3.1 响应缓存策略

```java
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

@Service
public class GatewayCacheService {

    /**
     * 缓存 Key 生成策略
     */
    public static String generateCacheKey(HttpRequest request) {
        return String.format("api:%s:%s:%s",
                request.getMethod(),
                request.getPath(),
                request.getQueryParams());
    }

    /**
     * 判断是否可缓存
     */
    public boolean isCacheable(HttpRequest request) {
        // 只缓存 GET 请求
        if (!"GET".equalsIgnoreCase(request.getMethod())) {
            return false;
        }

        // 查询参数包含时间戳的不可缓存
        if (request.getQueryParam("t") != null ||
            request.getQueryParam("timestamp") != null) {
            return false;
        }

        // 认证用户的请求不共享缓存
        if (request.getHeader("Authorization") != null) {
            return false;
        }

        return true;
    }

    /**
     * 获取缓存的有效期
     */
    public Duration getCacheTtl(String path) {
        // 根据路径确定缓存时间
        if (path.startsWith("/api/products/")) {
            return Duration.ofMinutes(5);  // 商品详情 5 分钟
        }
        if (path.startsWith("/api/categories/")) {
            return Duration.ofHours(1);     // 分类 1 小时
        }
        if (path.equals("/api/config")) {
            return Duration.ofMinutes(30); // 配置 30 分钟
        }
        return Duration.ofMinutes(1);       // 默认 1 分钟
    }
}
```

### 3.2 多级缓存实现

```java
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.data.redis.core.RedisTemplate;

public class MultiLevelCacheService {

    // L1: 本地缓存 (Caffeine)
    private final Cache&lt;String, CachedResponse&gt; localCache;
    // L2: 分布式缓存 (Redis)
    private final RedisTemplate&lt;String, CachedResponse&gt; redisTemplate;

    public MultiLevelCacheService(RedisTemplate&lt;String, CachedResponse&gt; redisTemplate) {
        this.redisTemplate = redisTemplate;

        this.localCache = Caffeine.newBuilder()
                .maximumSize(10_000)
                .expireAfterWrite(1, TimeUnit.MINUTES)
                .recordStats()
                .build();
    }

    /**
     * 获取缓存
     */
    public CachedResponse get(String key) {
        // L1: 先查本地缓存
        CachedResponse cached = localCache.getIfPresent(key);
        if (cached != null && !cached.isExpired()) {
            return cached;
        }

        // L2: 查 Redis
        cached = redisTemplate.opsForValue().get(key);
        if (cached != null && !cached.isExpired()) {
            // 回填本地缓存
            localCache.put(key, cached);
            return cached;
        }

        return null;
    }

    /**
     * 设置缓存
     */
    public void put(String key, CachedResponse response) {
        // 同时写入 L1 和 L2
        localCache.put(key, response);
        redisTemplate.opsForValue().set(key, response, response.getTtl());
    }

    /**
     * 获取缓存统计
     */
    public CacheStats getStats() {
        var stats = localCache.stats();
        return new CacheStats(
                stats.hitCount(),
                stats.missCount(),
                stats.hitRate()
        );
    }
}

@Data
@AllArgsConstructor
class CachedResponse {
    private int statusCode;
    private Map&lt;String, List&lt;String&gt;&gt; headers;
    private byte[] body;
    private long cachedAt;
    private long expiresAt;

    public boolean isExpired() {
        return System.currentTimeMillis() > expiresAt;
    }

    public Duration getTtl() {
        long ttl = expiresAt - System.currentTimeMillis();
        return Duration.ofMillis(Math.max(ttl, 0));
    }
}
```

---

## 四、连接池与路由优化

### 4.1 后端连接池配置

```java
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.apache.http.impl.conn.PoolingHttpClientConnectionManager;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Configuration
@ConfigurationProperties(prefix = "gateway.http-client")
public class GatewayHttpClientConfig {

    private int maxTotal = 200;
    private int defaultMaxPerRoute = 50;
    private int connectionRequestTimeout = 5000;
    private int connectTimeout = 3000;
    private int socketTimeout = 30000;

    @Bean
    public CloseableHttpClient httpClient() {
        PoolingHttpClientConnectionManager connectionManager =
                new PoolingHttpClientConnectionManager();

        connectionManager.setMaxTotal(maxTotal);
        connectionManager.setDefaultMaxPerRoute(defaultMaxPerRoute);
        // 检测空闲连接
        connectionManager.setValidateAfterInactivity(2000);

        RequestConfig requestConfig = RequestConfig.custom()
                .setConnectionRequestTimeout(connectionRequestTimeout)
                .setConnectTimeout(connectTimeout)
                .setSocketTimeout(socketTimeout)
                .build();

        return HttpClients.custom()
                .setConnectionManager(connectionManager)
                .setDefaultRequestConfig(requestConfig)
                // 重试策略
                .setRetryHandler((exception, executionCount, context) ->
                        executionCount < 3 && is idempotent)
                .build();
    }
}
```

### 4.2 动态路由策略

```java
import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class DynamicRouteConfig {

    @Bean
    public RouteLocator customRouteLocator(RouteLocatorBuilder builder) {
        return builder.routes()
                // 静态路由
                .route("user-service", r -> r
                        .path("/api/users/**")
                        .filters(f -> f
                                .stripPrefix(1)
                                .addRequestHeader("X-Gateway", "true")
                                .circuitBreaker(c -> c
                                        .setName("userCircuitBreaker")
                                        .setFallbackUri("forward:/fallback/users")
                                )
                        )
                        .uri("lb://user-service")
                )
                // 基于权重的路由 (金丝雀发布)
                .route("canary-route", r -> r
                        .path("/api/products/**")
                        .filters(f -> f.stripPrefix(1))
                        .uri("lb://product-service-canary")
                )
                .build();
    }

    /**
     * 路由选择策略
     */
    public interface RouteSelector {
        String selectTarget(String path, Map&lt;String, Object&gt; attributes);
    }

    /**
     * 基于权重的路由选择
     */
    public class WeightBasedRouteSelector implements RouteSelector {

        private final Map&lt;String, WeightConfig&gt; weights;

        @Override
        public String selectTarget(String path, Map&lt;String, Object&gt; attributes) {
            WeightConfig config = weights.get(path);
            if (config == null) {
                return getDefaultTarget();
            }

            double random = Math.random() * 100;
            if (random < config.getCanaryWeight()) {
                return "canary-service";
            }
            return "production-service";
        }
    }
}
```

---

## 五、限流与熔断优化

### 5.1 令牌桶限流

```java
import com.github.v力道.github.ratelimiter.tokenbucket.TokenBucket;
import java.util.concurrent.ConcurrentHashMap;

public class DistributedRateLimiter {

    // 本地令牌桶缓存
    private final ConcurrentHashMap&lt;String, TokenBucket&gt; localBuckets;

    // Redis 分布式令牌桶
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;

    public DistributedRateLimiter(RedisTemplate&lt;String, Object&gt; redisTemplate) {
        this.redisTemplate = redisTemplate;
        this.localBuckets = new ConcurrentHashMap&lt;&gt;();
    }

    /**
     * 尝试获取令牌
     */
    public boolean tryAcquire(String key, int permits, long timeoutMs) {
        // L1: 本地限流（快速路径）
        TokenBucket localBucket = localBuckets.computeIfAbsent(key,
                k -> new TokenBucket(100, Duration.ofSeconds(1)));

        if (localBucket.tryAcquire(permits)) {
            return true;
        }

        // L2: 分布式限流（Redis）
        return tryAcquireDistributed(key, permits, timeoutMs);
    }

    /**
     * Redis 分布式限流 (滑动窗口算法)
     */
    private boolean tryAcquireDistributed(String key, int permits, long timeoutMs) {
        String redisKey = "rate_limit:" + key;
        long now = System.currentTimeMillis();
        long windowStart = now - 1000; // 1秒窗口

        Long count = redisTemplate.execute(new RedisCallback&lt;Long&gt;() {
            @Override
            public Long doInRedis(RedisConnection connection) throws DataAccessException {
                byte[] keyBytes = redisKey.getBytes();
                byte[] script = """
                    local list = redis.call('LRANGE', KEYS[1], 0, -1)
                    local count = 0
                    local now = tonumber(ARGV[1])
                    local window = tonumber(ARGV[2])
                    local limit = tonumber(ARGV[3])

                    -- 清理过期记录
                    for i = #list, 1, -1 do
                        if tonumber(list[i]) &lt; now - window then
                            redis.call('LTRIM', KEYS[1], 0, i - 2)
                        end
                    end

                    -- 重新获取清理后的数量
                    list = redis.call('LRANGE', KEYS[1], 0, -1)
                    count = #list

                    if count &lt; limit then
                        redis.call('RPUSH', KEYS[1], now)
                        redis.call('EXPIRE', KEYS[1], 2)
                        return 1
                    end
                    return 0
                    """.getBytes();

                return (Long) connection.eval(script, ReturnType.INTEGER,
                        1, keyBytes,
                        String.valueOf(now).getBytes(),
                        String.valueOf(1000).getBytes(),
                        String.valueOf(permits).getBytes()
                );
            }
        });

        return count != null && count == 1L;
    }
}
```

### 5.2 熔断降级

```java
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerConfig;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;

public class CircuitBreakerConfig {

    public static CircuitBreaker createCircuitBreaker(String name) {
        CircuitBreakerConfig config = CircuitBreakerConfig.custom()
                // 熔断触发条件
                .failureRateThreshold(50)              // 失败率 > 50% 触发熔断
                .minimumNumberOfCalls(100)            // 至少 100 次调用才计算失败率
                .slidingWindowSize(100)               // 滑动窗口: 100 次调用
                .slidingWindowType(SlidingWindowType.COUNT_BASED)

                // 熔断持续时间
                .waitDurationInOpenState(Duration.ofSeconds(30))  // 熔断 30 秒后尝试恢复

                // 半开状态配置
                .permittedNumberOfCallsInHalfOpenState(10)  // 半开时允许 10 次调用
                .automaticTransitionFromOpenToHalfOpenEnabled(true)

                // 慢调用配置
                .slowCallDurationThreshold(Duration.ofSeconds(5))  // > 5 秒视为慢调用
                .slowCallRateThreshold(80)                          // 慢调用率 > 80% 触发熔断

                // 异常处理
                .recordExceptions(Exception.class)
                .ignoreExceptions(ValidationException.class)

                .build();

        return CircuitBreakerRegistry.of(config).circuitBreaker(name);
    }
}
```

---

## 六、监控与调优

### 6.1 关键指标

```java
public class GatewayMetrics {

    public static void main(String[] args) {
        System.out.println("========== 网关关键监控指标 ==========");
        System.out.println();

        System.out.println("1. 流量指标:");
        System.out.println("   - QPS (每秒请求数)");
        System.out.println("   - 并发连接数");
        System.out.println("   - 请求成功率");
        System.out.println();

        System.out.println("2. 性能指标:");
        System.out.println("   - P50/P90/P99 响应延迟");
        System.out.println("   - 网关自身耗时");
        System.out.println("   - 后端服务耗时");
        System.out.println();

        System.out.println("3. 资源指标:");
        System.out.println("   - CPU 使用率");
        System.out.println("   - 内存使用率");
        System.out.println("   - 连接池使用率");
        System.out.println();

        System.out.println("4. 业务指标:");
        System.out.println("   - 限流触发次数");
        System.out.println("   - 熔断触发次数");
        System.out.println("   - 认证失败次数");
        System.out.println();

        System.out.println("告警阈值建议:");
        System.out.println("   - P99 延迟 > 500ms");
        System.out.println("   - 错误率 > 1%");
        System.out.println("   - CPU > 80%");
        System.out.println("   - 连接池使用率 > 80%");
    }
}
```

### 6.2 常见问题排查

```java
public class GatewayTroubleshooting {

    public static void main(String[] args) {
        System.out.println("========== 网关常见问题 ==========");
        System.out.println();

        System.out.println("Q1: 网关 CPU 占用高");
        System.out.println("   可能原因:");
        System.out.println("   - 压缩级别过高");
        System.out.println("   - 正则表达式复杂");
        System.out.println("   - JSON 序列化效率低");
        System.out.println("   解决方案: 降低压缩级别，优化正则，使用高效序列化");
        System.out.println();

        System.out.println("Q2: 网关响应延迟高");
        System.out.println("   可能原因:");
        System.out.println("   - 认证服务响应慢");
        System.out.println("   - 连接池配置不当");
        System.out.println("   - 限流检测阻塞");
        System.out.println("   解决方案: JWT 本地验证，优化连接池，异步限流");
        System.out.println();

        System.out.println("Q3: 间歇性超时");
        System.out.println("   可能原因:");
        System.out.println("   - 后端服务不稳定");
        System.out.println("   - 熔断阈值不当");
        System.out.println("   - GC 停顿");
        System.out.println("   解决方案: 优化熔断配置，增加超时缓冲，GC 优化");
        System.out.println();
    }
}
```

---

## 留给你的问题

网关是流量的入口，也是风险的集中点。

优化网关性能，你需要回答几个问题：

1. **你的网关有多少时间是花在「等待」上？**（连接等待、后端响应等待）
2. **你的认证流程有没有成为瓶颈？**（JWT 本地验证 vs 远程验证）
3. **你的缓存策略是否合理？**（缓存命中率、过期策略）

**你有没有遇到过网关的性能问题？最后是怎么解决的？**
