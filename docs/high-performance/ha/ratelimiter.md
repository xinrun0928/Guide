# 单机限流：Guava RateLimiter 令牌桶实现

你的接口每秒能处理 1000 个请求，但流量高峰时每秒来了 5000 个。

怎么办？

最直接的方案：**超过 1000 的请求，直接拒绝**。

Guava 的 `RateLimiter` 就是干这个的。

## RateLimiter 核心概念

RateLimiter 基于令牌桶算法，但它做了优化——支持**预热**和**突发**。

### 核心特点

1. **令牌桶 + 预热**：考虑冷启动场景
2. **突发能力**：可以预存一些令牌，瞬间处理高峰
3. **阻塞与非阻塞**：可以选择等待还是立即返回

### 两种速率Limiter

```java
import com.google.common.util.concurrent.RateLimiter;

// 平滑突发限流器
RateLimiter limiter1 = RateLimiter.create(100);  // 每秒 100 个请求

// 预热型限流器（适合数据库连接池、线程池等冷启动场景）
RateLimiter limiter2 = RateLimiter.create(
    100,           // 每秒 100 个请求
    10,            // 预热时间（秒）
    TimeUnit.SECONDS
);
```

## 基本使用

### 1. 阻塞获取令牌

```java
public class SimpleRateLimiter {
    private final RateLimiter limiter;

    public SimpleRateLimiter(double permitsPerSecond) {
        // 每秒允许的请求数
        this.limiter = RateLimiter.create(permitsPerSecond);
    }

    public void handleRequest(Request request) {
        // 获取令牌，如果桶里没有，会阻塞等待
        limiter.acquire();

        // 执行业务逻辑
        processRequest(request);
    }
}
```

### 2. 非阻塞尝试获取

```java
public class NonBlockingRateLimiter {
    private final RateLimiter limiter;

    public NonBlockingRateLimiter(double permitsPerSecond) {
        this.limiter = RateLimiter.create(permitsPerSecond);
    }

    public Result handleRequest(Request request) {
        // 尝试获取令牌，立即返回
        // true: 获取成功
        // false: 获取失败（限流）
        if (limiter.tryAcquire()) {
            processRequest(request);
            return Result.SUCCESS;
        }

        // 限流降级
        return Result.RATE_LIMITED;
    }
}
```

### 3. 超时等待

```java
public class TimeoutRateLimiter {
    private final RateLimiter limiter;

    public TimeoutRateLimiter(double permitsPerSecond) {
        this.limiter = RateLimiter.create(permitsPerSecond);
    }

    public Result handleRequest(Request request, long timeout, TimeUnit unit) {
        // 等待指定时间获取令牌
        if (limiter.tryAcquire(timeout, unit)) {
            processRequest(request);
            return Result.SUCCESS;
        }

        return Result.TIMEOUT;
    }
}
```

## 预热机制

### 为什么需要预热

对于数据库连接池、线程池这类资源，它们的创建需要时间。

刚启动时，资源还没就绪，如果直接全速跑，可能导致连接超时、线程池打满。

**预热型限流器**会在启动初期慢慢提升发放令牌的速率：

```java
public class WarmupRateLimiter {
    private final RateLimiter limiter;

    public WarmupRateLimiter() {
        // 每秒 100 个请求，预热时间 10 秒
        // 在预热期间，令牌发放速率从 0 逐渐增加到 100
        this.limiter = RateLimiter.create(100,
            10, TimeUnit.SECONDS);
    }

    public void afterStart() {
        // 系统启动后，慢慢增加流量
        for (int i = 0; i < 100; i++) {
            limiter.acquire();
            warmUpComponent();
        }
    }
}
```

### 预热原理

```
预热时间 = 10 秒
桶容量 = 1000 个令牌
稳定速率 = 100 个/秒

启动时刻：速率 = 0
5 秒后：速率 ≈ 50 个/秒
10 秒后：速率 = 100 个/秒

速率变化曲线：
     速率
      ↑
 100 ┤╲
     │  ╲
  50 ┤   ╲
     │    ╲
   0 ┼─────╲────→ 时间
      0    10秒
```

## 突发处理

### 平滑突发限流

```java
public class BurstRateLimiter {
    private final RateLimiter limiter;

    public BurstRateLimiter() {
        // 每秒 100 个请求
        // 但可以一次性消耗之前积累的令牌
        this.limiter = RateLimiter.create(100);
    }

    public void batchProcess(List&lt;Request&gt; requests) {
        // 一次性获取所有需要的令牌
        // 如果桶里令牌不够，会等待
        limiter.acquire(requests.size());

        // 批量处理
        for (Request request : requests) {
            processRequest(request);
        }
    }
}
```

### 立即突发

```java
public class ImmediateBurstRateLimiter {
    private final RateLimiter limiter;

    public ImmediateBurstRateLimiter() {
        this.limiter = RateLimiter.create(100);
    }

    public void handleRequest(Request request) {
        // tryAcquire 不会等待
        // 桶里有令牌就拿，没有就直接返回 false
        if (limiter.tryAcquire()) {
            processRequest(request);
        } else {
            throw new RateLimitException("系统繁忙，请稍后重试");
        }
    }
}
```

## 实际应用场景

### 场景 1：用户级别限流

```java
@Service
public class UserRateLimitService {
    // 用户维度限流器缓存
    private final LoadingCache&lt;String, RateLimiter&gt; userLimiters =
        CacheBuilder.newBuilder()
            .maximumSize(10000)           // 最多缓存 1 万用户
            .expireAfterAccess(10, TimeUnit.MINUTES)  // 10 分钟无访问则移除
            .build(new CacheLoader&lt;String, RateLimiter&gt;() {
                @Override
                public RateLimiter load(String userId) {
                    // 每个用户每秒 10 个请求
                    return RateLimiter.create(10);
                }
            });

    public void handleUserRequest(String userId, Request request) {
        RateLimiter limiter = userLimiters.getUnchecked(userId);

        if (!limiter.tryAcquire()) {
            log.warn("用户 {} 请求过于频繁", userId);
            throw new RateLimitException("请求过于频繁，请稍后重试");
        }

        processRequest(request);
    }
}
```

### 场景 2：接口级别限流

```java
@Component
public class ApiRateLimitInterceptor {

    // 接口维度限流
    private final Map&lt;String, RateLimiter&gt; apiLimiters = new ConcurrentHashMap&lt;&gt;();

    @PostConstruct
    public void init() {
        // 初始化各接口限流器
        apiLimiters.put("/api/order/create", RateLimiter.create(100));   // 创建订单：100/s
        apiLimiters.put("/api/payment/pay", RateLimiter.create(50));     // 支付：50/s
        apiLimiters.put("/api/user/login", RateLimiter.create(20));       // 登录：20/s
    }

    public boolean preHandle(HttpServletRequest request, Object handler) {
        String api = request.getRequestURI();
        RateLimiter limiter = apiLimiters.get(api);

        if (limiter != null && !limiter.tryAcquire()) {
            response.setStatus(429);
            response.getWriter().write("{\"code\":429,\"msg\":\"请求过于频繁\"}");
            return false;
        }

        return true;
    }
}
```

### 场景 3：多级限流

```java
@Service
public class MultiLevelRateLimiter {

    // 第一层：全局限流
    private final RateLimiter globalLimiter = RateLimiter.create(10000);

    // 第二层：用户限流
    private final LoadingCache&lt;String, RateLimiter&gt; userLimiters =
        CacheBuilder.newBuilder()
            .maximumSize(100000)
            .build(new CacheLoader&lt;String, RateLimiter&gt;() {
                @Override
                public RateLimiter load(String userId) {
                    return RateLimiter.create(10);
                }
            });

    // 第三层：接口限流
    private final ConcurrentHashMap&lt;String, RateLimiter&gt; apiLimiters =
        new ConcurrentHashMap&lt;&gt;();

    public boolean tryAcquire(String userId, String api) {
        // 第一层：全局
        if (!globalLimiter.tryAcquire()) {
            log.warn("全局限流触发");
            return false;
        }

        // 第二层：用户
        RateLimiter userLimiter = userLimiters.getUnchecked(userId);
        if (!userLimiter.tryAcquire()) {
            log.warn("用户 {} 限流触发", userId);
            return false;
        }

        // 第三层：接口
        RateLimiter apiLimiter = apiLimiters.computeIfAbsent(
            api, k -> RateLimiter.create(100));

        if (!apiLimiter.tryAcquire()) {
            log.warn("接口 {} 限流触发", api);
            return false;
        }

        return true;
    }
}
```

### 场景 4：限流 + 降级

```java
@Service
public class RateLimitWithFallback {

    private final RateLimiter limiter = RateLimiter.create(100);

    public Response handleRequest(Request request) {
        // 尝试获取令牌
        if (!limiter.tryAcquire(100, TimeUnit.MILLISECONDS)) {
            // 限流降级：返回缓存数据或友好提示
            return handleDegraded(request);
        }

        try {
            return processRequest(request);
        } catch (Exception e) {
            // 业务异常降级
            return handleFallback(request, e);
        }
    }

    private Response handleDegraded(Request request) {
        // 降级策略 1：返回缓存
        CacheData cached = cache.get(request.getKey());
        if (cached != null) {
            return Response.degraded(cached);
        }

        // 降级策略 2：排队处理
        queue.offer(request);
        return Response.queued();

        // 降级策略 3：直接拒绝
        // throw new RateLimitException("系统繁忙");
    }
}
```

## 高级用法

### 动态调整速率

```java
public class DynamicRateLimiter {

    private volatile double permitsPerSecond = 100;
    private final AtomicReference&lt;RateLimiter&gt; limiter =
        new AtomicReference&lt;&gt;(RateLimiter.create(100));

    // 动态更新限流阈值
    public void updateRate(double newPermitsPerSecond) {
        // 创建新的限流器，保留原限流器中已发放的令牌
        RateLimiter newLimiter = RateLimiter.create(
            newPermitsPerSecond,
            newPermitsPerSecond / 10,
            TimeUnit.SECONDS
        );

        // 替换
        limiter.set(newLimiter);
        this.permitsPerSecond = newPermitsPerSecond;
    }

    public boolean tryAcquire() {
        return limiter.get().tryAcquire();
    }
}
```

### 结合 Sentinel 使用

```java
@Configuration
public class SentinelConfig {

    @Bean
    public Converter&lt;String, String&gt; getUrlExtractor() {
        // 定义 URL 提取器：基于 API 配置限流规则
        return exchange -> {
            ServerHttpRequest request = exchange.getRequest();
            String path = request.getPath().value();
            return path;
        };
    }
}

@Service
public class SentinelRateLimitService {

    @Autowired
    private SentinelRestTemplate restTemplate;

    public Response callRemote(String url) {
        // Sentinel 会自动根据配置的限流规则进行限流
        return restTemplate.getForObject(url, Response.class);
    }
}
```

## 注意事项

### 1. RateLimiter 是线程安全的

```java
// 正确：多个线程共享一个 RateLimiter
RateLimiter limiter = RateLimiter.create(100);
ExecutorService executor = Executors.newFixedThreadPool(10);

for (int i = 0; i < 100; i++) {
    final int taskId = i;
    executor.submit(() -> {
        limiter.acquire();  // 线程安全
        process(taskId);
    });
}
```

### 2. 限流粒度选择

```java
// 不要：每个请求创建新限流器（浪费资源）
public void badExample(Request request) {
    RateLimiter limiter = RateLimiter.create(100);
    limiter.acquire();
    // ...
}

// 正确：复用限流器
private final RateLimiter limiter = RateLimiter.create(100);

public void goodExample(Request request) {
    limiter.acquire();
    // ...
}
```

### 3. 监控与告警

```java
public class MonitoredRateLimiter {

    private final RateLimiter limiter;
    private final MeterRegistry meterRegistry;

    public MonitoredRateLimiter(double permitsPerSecond, MeterRegistry registry) {
        this.limiter = RateLimiter.create(permitsPerSecond);
        this.meterRegistry = registry;

        // 注册指标
        Gauge.builder("rate_limiter.available_permits", limiter,
            RateLimiter::getAvailablePermits)
            .register(registry);
    }

    public boolean tryAcquire() {
        boolean acquired = limiter.tryAcquire();
        if (!acquired) {
            meterRegistry.counter("rate_limiter.rejected").increment();
        }
        return acquired;
    }
}
```

---

**思考题：**

假设你在实现一个用户下单接口，需要对用户进行限流。

问题：
1. 如果使用用户维度的限流器，每个用户每秒只能下 5 单。但某天用户 A 通过了所有验证，正在下单过程中，突然网络断了导致请求超时。请思考：超时重试时，限流器会怎么对待这个请求？
2. 如果让你实现一个「允许适度突发」的限流策略，比如平时每秒 10 请求，但允许一次性处理最多 50 请求，你会怎么设计？
3. 在高并发场景下，`LoadingCache` + `RateLimiter` 的组合可能有什么问题？如何优化？
4. 如果用户量从 1 万增长到 1000 万，你现有的限流方案能支撑吗？

提示：考虑内存占用、GC 压力、以及限流精度。
