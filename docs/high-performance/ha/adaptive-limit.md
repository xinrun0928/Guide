# 流量控制：系统自适应限流与基于 QPS/并发数的限流

你有没有见过这种现象：某电商平台搞大促，零点时分流量暴增 100 倍，结果系统直接宕机，所有用户都无法访问。

但如果平台提前做好了流量控制，虽然部分用户可能会收到「系统繁忙」的提示，但至少服务不会完全崩溃。

这就是**流量控制**的价值——在系统被压垮之前，主动放弃部分请求，保证整体可用。

## 什么是流量控制

流量控制（Rate Limiting）是一种保护系统的机制，通过限制单位时间内允许通过的请求数量，防止系统过载。

```
┌─────────────────────────────────────────────────────────────┐
│                    流量控制示意图                              │
│                                                             │
│   请求 ──▶ ┌─────────┐ ──▶ 限流通过 ──▶ 服务正常              │
│    ↑      │         │                                       │
│    │      │  限流器  │                                       │
│    │      │         │                                       │
│    │      └─────────┘                                       │
│    │              │                                          │
│    │         限流拒绝 ──▶ 返回 429 / 降级处理                  │
│    │                                                    │
└─────────────────────────────────────────────────────────────┘
```

## 限流算法

### 1. 固定窗口限流

将时间划分为固定的窗口，在每个窗口内限制请求数量。

```java
public class FixedWindowRateLimiter {

    private final int maxRequests;
    private final long windowSizeMs;
    private final Map&lt;String, Counter&gt; counters = new ConcurrentHashMap&lt;&gt;();

    public FixedWindowRateLimiter(int maxRequests, long windowSizeMs) {
        this.maxRequests = maxRequests;
        this.windowSizeMs = windowSizeMs;
    }

    public boolean tryAcquire(String key) {
        long now = System.currentTimeMillis();
        long windowStart = now - (now % windowSizeMs);

        Counter counter = counters.computeIfAbsent(key,
            k -> new Counter(windowStart));

        // 如果窗口已经滚动，重置计数器
        synchronized (counter) {
            if (counter.windowStart != windowStart) {
                counter.count = 0;
                counter.windowStart = windowStart;
            }

            if (counter.count &lt; maxRequests) {
                counter.count++;
                return true;
            }
            return false;
        }
    }

    private static class Counter {
        long windowStart;
        int count;

        Counter(long windowStart) {
            this.windowStart = windowStart;
        }
    }
}
```

**问题**：窗口临界时刻可能产生 2 倍流量。

```
时间轴：
|--------- 窗口1 ---------|--------- 窗口2 ---------|
                           ↑
                      临界点
         请求A: 窗口1 最后 1ms，+1000 请求
         请求B: 窗口2 开始 1ms，+1000 请求
         实际通过: 2000（允许的 2 倍）
```

### 2. 滑动窗口限流

滑动窗口算法解决了固定窗口的临界问题。

```java
public class SlidingWindowRateLimiter {

    private final int maxRequests;
    private final long windowSizeMs;
    private final ConcurrentHashMap&lt;String, LinkedList&lt;Long&gt;&gt; windows = new ConcurrentHashMap&lt;&gt;();

    public SlidingWindowRateLimiter(int maxRequests, long windowSizeMs) {
        this.maxRequests = maxRequests;
        this.windowSizeMs = windowSizeMs;
    }

    public synchronized boolean tryAcquire(String key) {
        long now = System.currentTimeMillis();
        long windowStart = now - windowSizeMs;

        LinkedList&lt;Long&gt; times = windows.computeIfAbsent(key, k -> new LinkedList&lt;&gt;());

        // 移除窗口外的请求
        while (!times.isEmpty() && times.peekFirst() &lt;= windowStart) {
            times.pollFirst();
        }

        // 检查是否允许通过
        if (times.size() &lt; maxRequests) {
            times.addLast(now);
            return true;
        }

        return false;
    }
}
```

### 3. 令牌桶算法

以固定速率向桶中添加令牌，每次请求消耗一个令牌。

```java
public class TokenBucketRateLimiter {

    private final double rate;           // 每秒添加的令牌数
    private final double capacity;       // 桶的容量
    private double tokens;               // 当前令牌数
    private long lastRefillTime;        // 上次填充时间

    public TokenBucketRateLimiter(double rate, double capacity) {
        this.rate = rate;
        this.capacity = capacity;
        this.tokens = capacity;           // 初始为满桶
        this.lastRefillTime = System.currentTimeMillis();
    }

    public synchronized boolean tryAcquire(int permits) {
        refill();

        if (tokens >= permits) {
            tokens -= permits;
            return true;
        }

        return false;
    }

    private void refill() {
        long now = System.currentTimeMillis();
        double elapsed = (now - lastRefillTime) / 1000.0;

        // 添加令牌：速率 × 时间
        tokens = Math.min(capacity, tokens + elapsed * rate);
        lastRefillTime = now;
    }

    // 获取等待时间
    public synchronized long getWaitTime(int permits) {
        if (tokens >= permits) {
            return 0;
        }
        return (long) ((permits - tokens) / rate * 1000);
    }
}
```

**特点**：
- 允许突发流量（桶满时）
- 长期来看，速率恒定
- 支持突发 + 限流的双重需求

### 4. 漏桶算法

请求以任意速率进入桶中，以固定速率流出。

```java
public class LeakyBucketRateLimiter {

    private final double rate;           // 漏水速率（每秒）
    private final double capacity;       // 桶的容量
    private double water;               // 当前水量
    private long lastLeakTime;          // 上次漏水时间

    public LeakyBucketRateLimiter(double rate, double capacity) {
        this.rate = rate;
        this.capacity = capacity;
        this.water = 0;
        this.lastLeakTime = System.currentTimeMillis();
    }

    public synchronized boolean tryAcquire() {
        leak();

        if (water &lt; capacity) {
            water++;
            return true;
        }

        return false;
    }

    private void leak() {
        long now = System.currentTimeMillis();
        double elapsed = (now - lastLeakTime) / 1000.0;
        double leaked = elapsed * rate;

        water = Math.max(0, water - leaked);
        lastLeakTime = now;
    }
}
```

**特点**：
- 流出速率恒定
- 平滑限流
- 不允许突发

### 5. 算法对比

| 特性 | 固定窗口 | 滑动窗口 | 令牌桶 | 漏桶 |
|------|---------|---------|-------|------|
| 实现复杂度 | 低 | 中 | 中 | 中 |
| 精度 | 低 | 高 | 高 | 高 |
| 允许突发 | 是 | 是 | 是 | 否 |
| 平滑限流 | 否 | 否 | 是 | 是 |
| 临界问题 | 有 | 无 | 无 | 无 |

## QPS 限流

### 基于接口的限流

```java
@Service
public class RateLimitService {

    private final Map&lt;String, TokenBucketRateLimiter&gt; limiters = new ConcurrentHashMap&lt;&gt;();

    @Autowired
    private RateLimitConfig config;

    public boolean tryAcquire(String endpoint) {
        RateLimitRule rule = config.getRule(endpoint);
        if (rule == null) {
            return true;  // 没有限流规则，放行
        }

        TokenBucketRateLimiter limiter = limiters.computeIfAbsent(endpoint,
            k -> new TokenBucketRateLimiter(rule.getQps(), rule.getCapacity()));

        return limiter.tryAcquire(1);
    }

    public boolean tryAcquire(String endpoint, int permits) {
        RateLimitRule rule = config.getRule(endpoint);
        if (rule == null) {
            return true;
        }

        TokenBucketRateLimiter limiter = limiters.computeIfAbsent(endpoint,
            k -> new TokenBucketRateLimiter(rule.getQps(), rule.getCapacity()));

        return limiter.tryAcquire(permits);
    }
}
```

### 配置规则

```java
@Data
public class RateLimitRule {
    private String endpoint;              // 接口路径
    private double qps;                   // QPS 限制
    private double capacity;              // 令牌桶容量（突发容量）
    private int timeout;                  // 等待超时时间（毫秒）
}

@Configuration
public class RateLimitConfig {

    @Bean
    public Map&lt;String, RateLimitRule&gt; rateLimitRules() {
        Map&lt;String, RateLimitRule&gt; rules = new HashMap&lt;&gt;();

        // 查询接口：允许较高 QPS
        rules.put("/api/user/*", RateLimitRule.builder()
            .endpoint("/api/user/*")
            .qps(100)
            .capacity(200)
            .timeout(100)
            .build());

        // 写入接口：限制较低
        rules.put("/api/order/create", RateLimitRule.builder()
            .endpoint("/api/order/create")
            .qps(50)
            .capacity(50)
            .timeout(500)
            .build());

        // 敏感接口：限制更严格
        rules.put("/api/pay/*", RateLimitRule.builder()
            .endpoint("/api/pay/*")
            .qps(20)
            .capacity(20)
            .timeout(1000)
            .build());

        return rules;
    }
}
```

### Spring Boot 注解限流

```java
/**
 * 限流注解
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RateLimiter {
    /**
     * QPS 限制
     */
    double qps() default 100;

    /**
     * 令牌桶容量（突发容量）
     */
    double capacity() default 100;

    /**
     * 限流后的提示消息
     */
    String message() default "请求过于频繁，请稍后重试";
}

/**
 * 限流切面
 */
@Aspect
@Component
public class RateLimiterAspect {

    private final Map&lt;String, TokenBucketRateLimiter&gt; limiters = new ConcurrentHashMap&lt;&gt;();

    @Around("@annotation(rateLimiter)")
    public Object around(ProceedingJoinPoint point, RateLimiter rateLimiter) throws Throwable {
        String key = getKey(point);

        TokenBucketRateLimiter limiter = limiters.computeIfAbsent(key,
            k -> new TokenBucketRateLimiter(rateLimiter.qps(), rateLimiter.capacity()));

        if (!limiter.tryAcquire(1)) {
            throw new RateLimitException(rateLimiter.message());
        }

        return point.proceed();
    }

    private String getKey(ProceedingJoinPoint point) {
        MethodSignature signature = (MethodSignature) point.getSignature();
        return signature.getMethod().getName();
    }
}

// 使用
@Service
public class OrderService {

    @RateLimiter(qps = 50, capacity = 50, message = "下单过于频繁，请稍后重试")
    public Order createOrder(OrderRequest request) {
        return orderMapper.insert(request);
    }

    @RateLimiter(qps = 100, capacity = 200, message = "查询过于频繁")
    public List&lt;Product&gt; searchProducts(String keyword) {
        return productMapper.search(keyword);
    }
}
```

## 并发数限流

### 线程池限流

```java
@Service
public class ConcurrencyLimitedService {

    private final ExecutorService executor;
    private final Semaphore semaphore;

    public ConcurrencyLimitedService(int maxConcurrency) {
        // 固定大小的线程池
        this.executor = Executors.newFixedThreadPool(maxConcurrency);
        // 信号量控制并发数
        this.semaphore = new Semaphore(maxConcurrency);
    }

    public &lt;T&gt; T execute(Callable&lt;T&gt; task) throws Exception {
        if (!semaphore.tryAcquire(5, TimeUnit.SECONDS)) {  // 等待 5 秒
            throw new TooManyRequestsException("系统繁忙，请稍后重试");
        }

        try {
            return executor.submit(task).get();
        } finally {
            semaphore.release();
        }
    }

    // 获取当前并发数
    public int getCurrentConcurrency() {
        return semaphore.availablePermits();
    }
}
```

### 连接数限流

```java
@Configuration
public class ConnectionPoolConfig {

    @Bean
    public HikariDataSource dataSource() {
        HikariConfig config = new HikariConfig();

        // 连接池大小限制
        config.setMaximumPoolSize(20);      // 最大连接数
        config.setMinimumIdle(5);           // 最小空闲连接
        config.setConnectionTimeout(30000); // 获取连接超时

        // 连接获取后的验证
        config.setConnectionTestQuery("SELECT 1");
        config.setValidationTimeout(5000);

        // 连接空闲时间
        config.setIdleTimeout(600000);      // 10 分钟
        config.setMaxLifetime(1800000);     // 30 分钟

        return new HikariDataSource(config);
    }
}
```

## 系统自适应限流

### 基于指标的限流

```java
@Service
public class AdaptiveRateLimiter {

    private final MeterRegistry meterRegistry;
    private final AtomicReference&lt;Double&gt; currentLimit = new AtomicReference&lt;&gt;(1000.0);

    // 阈值配置
    private static final double CPU_HIGH_THRESHOLD = 0.8;
    private static final double CPU_LOW_THRESHOLD = 0.6;
    private static final double MEMORY_HIGH_THRESHOLD = 0.85;
    private static final double RT_THRESHOLD_MS = 100;

    @Scheduled(fixedRate = 1000)
    public void adjustLimit() {
        double cpu = getCpuUsage();
        double memory = getMemoryUsage();
        double avgRt = getAverageResponseTime();

        double limit = currentLimit.get();

        // 根据指标调整限流阈值
        if (cpu > CPU_HIGH_THRESHOLD || memory > MEMORY_HIGH_THRESHOLD || avgRt > RT_THRESHOLD_MS) {
            // 系统压力大，降低限流阈值
            limit = limit * 0.8;  // 降低 20%
        } else if (cpu &lt; CPU_LOW_THRESHOLD && avgRt &lt; RT_THRESHOLD_MS / 2) {
            // 系统负载低，可以放宽限制
            limit = Math.min(limit * 1.2, getMaxLimit());  // 提高 20%，不超过上限
        }

        currentLimit.set(limit);

        log.info("自适应限流调整: CPU={}, Memory={}, RT={}ms, QPS Limit={}",
            String.format("%.2f%%", cpu * 100),
            String.format("%.2f%%", memory * 100),
            String.format("%.2f", avgRt),
            String.format("%.0f", limit));
    }

    public boolean tryAcquire() {
        TokenBucketRateLimiter limiter = new TokenBucketRateLimiter(
            currentLimit.get(), currentLimit.get());
        return limiter.tryAcquire(1);
    }
}
```

### 基于 PID 的自适应限流

```java
public class PIDRateLimiter {

    private double kp = 0.5;  // 比例系数
    private double ki = 0.1;  // 积分系数
    private double kd = 0.2;  // 微分系数

    private double targetRt = 50;      // 目标响应时间（毫秒）
    private double currentLimit = 1000; // 当前限流值

    private double integral = 0;       // 积分项
    private double lastError = 0;      // 上次误差

    public double adjust(double currentRt) {
        // 计算误差
        double error = currentRt - targetRt;

        // 比例项
        double p = kp * error;

        // 积分项（防止积分饱和）
        integral = Math.max(-100, Math.min(100, integral + error));
        double i = ki * integral;

        // 微分项
        double d = kd * (error - lastError);
        lastError = error;

        // PID 输出
        double output = p + i + d;

        // 调整限流值
        currentLimit = Math.max(100, Math.min(10000, currentLimit - output));

        return currentLimit;
    }
}
```

## 限流实现

### 网关限流

```java
@Component
public class GatewayRateLimiterFilter implements GlobalFilter {

    @Autowired
    private RateLimitConfig config;
    @Autowired
    private RedisTemplate&lt;String, String&gt; redisTemplate;

    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getPath().value();
        RateLimitRule rule = config.getRule(path);

        if (rule == null) {
            return chain.filter(exchange);
        }

        String key = "rate_limit:" + path;
        Long current = redisTemplate.opsForValue().increment(key);

        if (current == 1) {
            // 设置过期时间
            redisTemplate.expire(key, 1, TimeUnit.SECONDS);
        }

        if (current > rule.getQps()) {
            exchange.getResponse().setStatusCode(HttpStatus.TOO_MANY_REQUESTS);
            exchange.getResponse().getHeaders().add("Retry-After", "1");
            return writeResponse(exchange, "请求过于频繁");
        }

        return chain.filter(exchange);
    }
}
```

### Sentinel 限流

```java
// 配置限流规则
@Configuration
public class SentinelConfig {

    @PostConstruct
    public void init() {
        // 配置限流规则
        List&lt;FlowRule&gt; rules = new ArrayList&lt;&gt;();

        FlowRule rule1 = new FlowRule("orderService")
            .setGrade(RuleConstant.FLOW_GRADE_QPS)
            .setCount(100)                        // QPS 限制 100
            .setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_DEFAULT)
            .setResourceType(ResourceConstant.HEAP);

        FlowRule rule2 = new FlowRule("orderService")
            .setGrade(RuleConstant.FLOW_GRADE_QPS)
            .setCount(10)                         // 调用关系限流
            .setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_DEFAULT)
            .setResourceType(ResourceConstant.HEAP);

        rules.add(rule1);
        FlowRuleManager.loadRules(rules);
    }
}

// 使用限流注解
public class OrderService {

    @SentinelResource(value = "createOrder",
        blockHandler = "createOrderBlockHandler",
        fallback = "createOrderFallback")
    public Order createOrder(OrderRequest request) {
        return orderMapper.insert(request);
    }

    // 限流处理
    public Order createOrderBlockHandler(OrderRequest request, BlockException e) {
        log.warn("创建订单被限流: {}", e.getClass().getSimpleName());
        return Order.degraded("系统繁忙，请稍后重试");
    }

    // 降级处理
    public Order createOrderFallback(OrderRequest request, Throwable e) {
        log.error("创建订单失败: {}", e.getMessage());
        return Order.degraded("服务暂时不可用");
    }
}
```

## 限流后的处理

### 返回标准错误

```java
@RestControllerAdvice
public class RateLimitExceptionHandler {

    @ExceptionHandler(RateLimitException.class)
    public Response handleRateLimit(RateLimitException e) {
        return Response.builder()
            .code(429)
            .message(e.getMessage())
            .header("Retry-After", "5")
            .build();
    }
}
```

### 排队限流

```java
public class QueuedRateLimiter {

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final BlockingQueue&lt;Runnable&gt; queue = new LinkedBlockingQueue&lt;&gt;(1000);

    public &lt;T&gt; CompletableFuture&lt;T&gt; submit(Callable&lt;T&gt; task) {
        CompletableFuture&lt;T&gt; future = new CompletableFuture&lt;&gt;();

        queue.offer(() -> {
            try {
                future.complete(task.call());
            } catch (Exception e) {
                future.completeExceptionally(e);
            }
        });

        return future;
    }
}
```

---

**思考题：**

1. 令牌桶和漏桶都能限流，它们有什么区别？什么场景下用令牌桶，什么场景下用漏桶？

2. 固定窗口限流在窗口临界时刻可能产生 2 倍流量，有什么实际影响？如何避免？

3. 如果你的系统被限流了，返回 429 错误和直接等待重试，哪个对用户更友好？

4. 系统自适应限流看起来很美好，但 PID 控制器的参数（kp、ki、kd）如何设置？设置不当会有什么后果？
