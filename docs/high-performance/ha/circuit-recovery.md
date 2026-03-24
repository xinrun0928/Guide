# 熔断后的服务恢复与预热机制

你有没有遇到过这种情况：某个服务挂了一段时间，熔断器打开了。后来服务恢复了，但请求打过去，发现服务又挂了。

为什么？服务刚启动，JVM 刚完成类加载，数据库连接池正在建立，缓存还没预热……一下子涌进来大量请求，直接把服务压垮了。

这就是为什么熔断后不能简单地「打开闸门」，需要**渐进式恢复**和**服务预热**。

## 熔断恢复的挑战

### 冷启动问题

```
服务重启后的资源状态：
│
│                              ╭──── 资源峰值
│                           ╭─╯
│                        ╭─╯
│                     ╭─╯
│                  ╭─╯
│               ╭─╯
│            ╭─╯
│         ╭─╯
│      ╭─╯
│   ╭─╯
├───┴───────────────────────────────────▶ 时间
│      │           │
│      │           │
│   服务启动    资源建立
│   (熔断恢复) (预热期)
```

服务刚启动时：
- 类加载器正在加载类
- 数据库连接正在建立
- 缓存是空的
- JIT 编译器正在编译热点代码

### 流量冲击问题

```
熔断关闭后的流量变化：

         请求数
            │
  正常流量 ─┐
            │
熔断期间 ────┘  ≈ 0
            │
            │
熔断恢复 ────┐
            │
            │ ╭─ 瞬时涌入 ─╮
            ├─╯            ╰─╮
            │                │
            └────────────────┴───────▶ 时间
```

如果熔断恢复后直接涌入全部流量，会导致：
- 响应时间急剧增加
- 资源耗尽
- 再次触发熔断

## 半开状态设计

### 标准半开状态

```java
public class CircuitBreaker {

    private final AtomicReference&lt;State&gt; state = new AtomicReference&lt;&gt;(State.CLOSED);
    private final int halfOpenRequests;
    private final Duration breakDuration;

    private volatile int halfOpenAttemptCount = 0;

    public enum State {
        CLOSED,       // 正常
        OPEN,         // 熔断
        HALF_OPEN     // 半开
    }

    public boolean allowRequest() {
        if (state.get() == State.CLOSED) {
            return true;
        }

        if (state.get() == State.OPEN) {
            // 检查是否应该进入半开状态
            if (shouldAttemptReset()) {
                transitionToHalfOpen();
                return true;
            }
            return false;
        }

        if (state.get() == HALF_OPEN) {
            // 半开状态允许有限请求
            return halfOpenAttemptCount &lt; halfOpenRequests;
        }

        return false;
    }

    private boolean shouldAttemptReset() {
        return System.currentTimeMillis() - lastFailureTime >= breakDuration.toMillis();
    }

    private void transitionToHalfOpen() {
        state.set(State.HALF_OPEN);
        halfOpenAttemptCount = 0;
        log.info("熔断器进入半开状态");
    }
}
```

### 智能半开状态

标准半开状态的问题是：所有请求同时涌入。我们需要**渐进式半开**。

```java
public class ProgressiveCircuitBreaker {

    private final AtomicReference&lt;State&gt; state = new AtomicReference&lt;&gt;(State.CLOSED);

    // 半开状态的配置
    private final int maxHalfOpenRequests = 10;  // 半开状态最多允许的请求数
    private final double successRateThreshold = 0.8;  // 成功率达到 80% 才关闭熔断

    // 半开状态的统计
    private AtomicInteger halfOpenSuccess = new AtomicInteger(0);
    private AtomicInteger halfOpenFailure = new AtomicInteger(0);
    private volatile int currentPermits = 1;  // 当前允许的请求数

    public boolean allowRequest() {
        if (state.get() == State.CLOSED) {
            return true;
        }

        if (state.get() == State.OPEN) {
            if (shouldAttemptReset()) {
                transitionToHalfOpen();
            }
            return false;
        }

        if (state.get() == HALF_OPEN) {
            // 渐进式：当前允许的请求数
            return permits.tryAcquire();
        }

        return false;
    }

    private void transitionToHalfOpen() {
        state.set(State.HALF_OPEN);
        halfOpenSuccess.set(0);
        halfOpenFailure.set(0);
        currentPermits = 1;  // 从 1 开始
        permits.release(currentPermits);  // 释放初始 permit
    }

    public void recordSuccess() {
        if (state.get() == State.HALF_OPEN) {
            int success = halfOpenSuccess.incrementAndGet();

            // 检查是否可以关闭熔断
            int total = halfOpenSuccess.get() + halfOpenFailure.get();
            if (success * 1.0 / total >= successRateThreshold) {
                transitionToClosed();
            } else if (currentPermits &lt; maxHalfOpenRequests) {
                // 渐进增加请求数
                increasePermits();
            }
        }
    }

    public void recordFailure() {
        if (state.get() == State.HALF_OPEN) {
            halfOpenFailure.incrementAndGet();
            int total = halfOpenSuccess.get() + halfOpenFailure.get();

            // 失败率过高，回到熔断状态
            if (halfOpenFailure.get() * 1.0 / total > (1 - successRateThreshold)) {
                transitionToOpen();
            }
        }
    }

    private void increasePermits() {
        // 指数增加：1 → 2 → 4 → 8
        int newPermits = Math.min(currentPermits * 2, maxHalfOpenRequests);
        permits.release(newPermits - currentPermits);
        currentPermits = newPermits;
    }
}
```

## 服务预热

### 1. 连接池预热

```java
@Service
public class ConnectionPoolWarmer {

    @Autowired
    private DataSource dataSource;

    private final List&lt;String&gt; criticalQueries = List.of(
        "SELECT 1",
        "SELECT COUNT(*) FROM users LIMIT 1",
        "SELECT COUNT(*) FROM orders LIMIT 1"
    );

    /**
     * 应用启动时预热连接池
     */
    @PostConstruct
    public void warmUp() {
        log.info("开始预热数据库连接池...");

        HikariDataSource hikari = (HikariDataSource) dataSource;
        int targetConnections = hikari.getMinimumIdle();

        ExecutorService executor = Executors.newFixedThreadPool(targetConnections);

        for (int i = 0; i &lt; targetConnections; i++) {
            final int index = i;
            executor.submit(() -> {
                try (Connection conn = dataSource.getConnection()) {
                    // 执行一些查询，确保连接可用
                    for (String query : criticalQueries) {
                        conn.createStatement().execute(query);
                    }
                    log.debug("连接 {} 预热完成", index);
                } catch (Exception e) {
                    log.warn("连接 {} 预热失败: {}", index, e.getMessage());
                }
            });
        }

        executor.shutdown();
        try {
            executor.awaitTermination(60, TimeUnit.SECONDS);
            log.info("数据库连接池预热完成，共 {} 个连接", targetConnections);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
```

### 2. 缓存预热

```java
@Service
public class CacheWarmer {

    @Autowired
    private CacheManager cacheManager;
    @Autowired
    private ProductService productService;
    @Autowired
    private UserService userService;

    /**
     * 启动时预热缓存
     */
    @PostConstruct
    public void warmUp() {
        log.info("开始预热缓存...");

        CompletableFuture.allOf(
            warmProductCache(),
            warmUserCache(),
            warmConfigCache()
        ).join();

        log.info("缓存预热完成");
    }

    private CompletableFuture&lt;Void&gt; warmProductCache() {
        return CompletableFuture.runAsync(() -> {
            // 预热热门商品
            List&lt;Long&gt; hotProductIds = productService.getHotProductIds();
            for (Long productId : hotProductIds) {
                try {
                    Product product = productService.getProductById(productId);
                    // 主动放入缓存
                    cacheManager.getCache("product").put(productId, product);
                } catch (Exception e) {
                    log.warn("商品 {} 缓存预热失败", productId);
                }
            }
            log.info("商品缓存预热完成，共 {} 条", hotProductIds.size());
        });
    }

    private CompletableFuture&lt;Void&gt; warmUserCache() {
        return CompletableFuture.runAsync(() -> {
            // 预热活跃用户
            List&lt;Long&gt; activeUserIds = userService.getActiveUserIds();
            for (Long userId : activeUserIds) {
                try {
                    User user = userService.getUserById(userId);
                    cacheManager.getCache("user").put(userId, user);
                } catch (Exception e) {
                    log.warn("用户 {} 缓存预热失败", userId);
                }
            }
            log.info("用户缓存预热完成，共 {} 条", activeUserIds.size());
        });
    }

    private CompletableFuture&lt;Void&gt; warmConfigCache() {
        return CompletableFuture.runAsync(() -> {
            // 预热配置信息
            Map&lt;String, String&gt; configs = configService.getAllConfigs();
            Cache&lt;String, String&gt; configCache = cacheManager.getCache("config");
            configs.forEach(configCache::put);
            log.info("配置缓存预热完成，共 {} 条", configs.size());
        });
    }
}
```

### 3. JIT 预热

```java
@Service
public class JITWarmer {

    /**
     * 预热 JIT 编译热点代码
     */
    @PostConstruct
    public void warmUp() {
        log.info("开始 JIT 预热...");

        // 预热关键接口
        warmEndpoint("/api/product/list");
        warmEndpoint("/api/product/detail");
        warmEndpoint("/api/order/create");
        warmEndpoint("/api/user/info");

        log.info("JIT 预热完成");
    }

    private void warmEndpoint(String endpoint) {
        log.debug("预热接口: {}", endpoint);

        // 循环调用，让 JIT 充分编译
        for (int i = 0; i &lt; 10000; i++) {
            try {
                // 模拟请求
                RestTemplate.getForObject(endpoint, String.class);
            } catch (Exception e) {
                // 忽略错误
            }
        }
    }
}
```

## 渐进式流量恢复

### 1. 令牌桶控制

```java
@Service
public class GradualRecoveryService {

    private final AtomicInteger currentRps = new AtomicInteger(0);
    private final int maxRps;
    private final int increaseStep;

    private final TokenBucket rateLimiter;

    public GradualRecoveryService(int maxRps, int increaseStep) {
        this.maxRps = maxRps;
        this.increaseStep = increaseStep;
        this.rateLimiter = new TokenBucket(maxRps);
    }

    /**
     * 获取是否允许请求
     */
    public boolean allowRequest() {
        return rateLimiter.tryAcquire();
    }

    /**
     * 增加流量
     */
    public void increaseTraffic() {
        int current = currentRps.get();
        int newRps = Math.min(current + increaseStep, maxRps);

        if (currentRps.compareAndSet(current, newRps)) {
            rateLimiter.setRate(newRps);
            log.info("流量增加: {} -> {}", current, newRps);
        }
    }

    /**
     * 减少流量（触发熔断时）
     */
    public void decreaseTraffic() {
        int current = currentRps.get();
        int newRps = Math.max(current / 2, 1);

        if (currentRps.compareAndSet(current, newRps)) {
            rateLimiter.setRate(newRps);
            log.info("流量减少: {} -> {}", current, newRps);
        }
    }
}
```

### 2. 调度器控制

```java
@Configuration
public class RecoveryScheduler {

    @Autowired
    private GradualRecoveryService recoveryService;
    @Autowired
    private MetricsService metricsService;

    /**
     * 渐进式增加流量
     */
    @Scheduled(fixedRate = 10000)  // 每 10 秒
    public void increaseTrafficIfHealthy() {
        Metrics metrics = metricsService.getCurrentMetrics();

        // 检查健康指标
        if (isHealthy(metrics)) {
            recoveryService.increaseTraffic();
        } else {
            log.warn("指标不健康，暂停流量增加: errorRate={}, latency={}",
                metrics.getErrorRate(), metrics.getAvgLatency());
        }
    }

    private boolean isHealthy(Metrics metrics) {
        return metrics.getErrorRate() &lt; 0.01 &&        // 错误率 < 1%
               metrics.getAvgLatency() &lt; 500 &&         // 平均延迟 < 500ms
               metrics.getP99Latency() &lt; 1000;         // P99 < 1s
    }
}
```

### 3. 基于指标的动态调整

```java
@Service
public class AdaptiveRecoveryService {

    private final AtomicInteger currentRps = new AtomicInteger(0);
    private final MetricsService metricsService;

    public void adjustTraffic() {
        Metrics metrics = metricsService.getCurrentMetrics();
        int current = currentRps.get();

        if (metrics.getErrorRate() > 0.05) {
            // 错误率高，大幅减少流量
            int newRps = Math.max(current / 4, 1);
            currentRps.set(newRps);
            log.warn("错误率过高，流量降至: {}", newRps);

        } else if (metrics.getErrorRate() > 0.01) {
            // 错误率偏高，小幅减少
            int newRps = Math.max(current / 2, 1);
            currentRps.set(newRps);
            log.warn("错误率偏高，流量降至: {}", newRps);

        } else if (metrics.getAvgLatency() > 1000) {
            // 延迟高，适当减少
            int newRps = Math.max(current * 8 / 10, 1);
            currentRps.set(newRps);
            log.warn("延迟过高，流量降至: {}", newRps);

        } else if (metrics.getErrorRate() &lt; 0.001 && metrics.getAvgLatency() &lt; 200) {
            // 指标优秀，快速增加
            int newRps = Math.min(current * 2, getMaxRps());
            currentRps.set(newRps);
            log.info("指标优秀，流量增至: {}", newRps);
        }
    }
}
```

## 健康检查

### 1. 健康检查端点

```java
@RestController
@RequestMapping("/health")
public class HealthController {

    @Autowired
    private DataSource dataSource;
    @Autowired
    private CacheManager cacheManager;
    @Autowired
    private ExternalService externalService;

    @GetMapping
    public HealthStatus health() {
        HealthStatus status = new HealthStatus();

        // 数据库检查
        try (Connection conn = dataSource.getConnection()) {
            status.setDatabase(true);
        } catch (Exception e) {
            status.setDatabase(false);
            status.setDatabaseError(e.getMessage());
        }

        // 缓存检查
        try {
            String testKey = "health:check";
            cacheManager.getCache("default").put(testKey, "ok");
            cacheManager.getCache("default").evict(testKey);
            status.setCache(true);
        } catch (Exception e) {
            status.setCache(false);
            status.setCacheError(e.getMessage());
        }

        // 外部服务检查
        status.setExternalService(externalService.isHealthy());

        // 综合状态
        boolean allHealthy = status.isDatabase() &&
                             status.isCache() &&
                             status.isExternalService();
        status.setStatus(allHealthy ? "UP" : "DEGRADED");

        return status;
    }

    @GetMapping("/ready")
    public Response ready() {
        HealthStatus status = health();
        if ("UP".equals(status.getStatus())) {
            return Response.ok(status);
        }
        return Response.status(503).body(status);
    }

    @GetMapping("/live")
    public Response live() {
        // 只要进程存活就返回 OK
        return Response.ok("OK");
    }
}
```

### 2. Kubernetes 探针配置

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    spec:
      containers:
      - name: myapp
        image: myapp:v2
        # 存活探针：检查进程是否存活
        livenessProbe:
          httpGet:
            path: /health/live
            port: 8080
          initialDelaySeconds: 30      # 启动后 30 秒开始检查
          periodSeconds: 10            # 每 10 秒检查一次
          timeoutSeconds: 5            # 超时 5 秒
          failureThreshold: 3          # 连续 3 次失败则重启

        # 就绪探针：检查是否准备好接收流量
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 8080
          initialDelaySeconds: 60      # 启动后 60 秒开始检查
          periodSeconds: 5             # 每 5 秒检查一次
          timeoutSeconds: 3            # 超时 3 秒
          failureThreshold: 3          # 连续 3 次失败则移出服务

        # 启动探针：检查是否完成启动
        startupProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 0
          periodSeconds: 10
          failureThreshold: 30         # 最多等待 5 分钟启动完成
```

### 3. 探针友好的代码

```java
@SpringBootApplication
public class Application {

    @Autowired
    private ConnectionPoolWarmer connectionPoolWarmer;
    @Autowired
    private CacheWarmer cacheWarmer;
    @Autowired
    private JITWarmer jitWarmer;

    private volatile boolean ready = false;

    @PostConstruct
    public void init() {
        // 顺序执行预热
        connectionPoolWarmer.warmUp();
        cacheWarmer.warmUp();
        jitWarmer.warmUp();

        // 标记就绪
        ready = true;
        log.info("应用预热完成，已就绪");
    }

    @GetMapping("/health/ready")
    public Response ready() {
        if (!ready) {
            return Response.status(503).body("warming up");
        }
        return Response.ok("ready");
    }
}
```

## 综合恢复策略

### 恢复流程

```
熔断器打开
    │
    │ 等待熔断时间
    ▼
进入半开状态
    │
    ├──▶ 允许 1 个请求通过
    │        │
    │        ├──▶ 成功
    │        │       │
    │        │    允许更多请求（2 → 4 → 8...）
    │        │       │
    │        │    成功率 > 80% ──▶ 关闭熔断，全量恢复
    │        │       │
    │        │    成功率 &lt; 80% ──▶ 继续半开或回到熔断
    │        │
    │        └──▶ 失败
    │               │
    │            回到熔断状态
    │               │
    │            重置熔断计时器
    ▼
根据指标动态调整
```

### 代码实现

```java
@Service
public class CircuitBreakerRecoveryManager {

    private final Map&lt;String, CircuitBreaker&gt; breakers;
    private final MetricsService metricsService;
    private final LoadBalancer loadBalancer;

    /**
     * 处理熔断器状态转换
     */
    public void handleStateTransition(String name, StateTransition transition) {
        switch (transition) {
            case OPEN_TO_HALF_OPEN:
                handleOpenToHalfOpen(name);
                break;
            case HALF_OPEN_TO_CLOSED:
                handleHalfOpenToClosed(name);
                break;
            case HALF_OPEN_TO_OPEN:
                handleHalfOpenToOpen(name);
                break;
        }
    }

    private void handleOpenToHalfOpen(String name) {
        log.info("熔断器 {} 进入半开状态", name);

        // 减少目标服务的权重
        loadBalancer.adjustWeight(name, 0.1);

        // 发送告警
        alertManager.send(Alert.builder()
            .level(AlertLevel.WARNING)
            .title("熔断器进入半开")
            .message("服务 " + name + " 正在尝试恢复")
            .build());
    }

    private void handleHalfOpenToClosed(String name) {
        log.info("熔断器 {} 恢复关闭", name);

        // 恢复服务权重
        loadBalancer.adjustWeight(name, 1.0);

        // 恢复正常流量
        recoveryService.restoreTraffic(name, 1.0);
    }

    private void handleHalfOpenToOpen(String name) {
        log.warn("熔断器 {} 半开状态下再次熔断", name);

        // 进一步减少权重
        loadBalancer.adjustWeight(name, 0);

        // 记录失败
        recoveryService.recordFailure(name);
    }

    /**
     * 渐进式恢复
     */
    public void progressiveRecovery(String name) {
        Metrics metrics = metricsService.getMetrics(name);

        if (metrics.getErrorRate() &lt; 0.01 && metrics.getAvgLatency() &lt; 500) {
            // 指标良好，增加流量
            double factor = recoveryService.getRecoveryFactor(name);
            recoveryService.increaseTraffic(name, factor);
        } else {
            // 指标不健康，暂停恢复
            recoveryService.pauseRecovery(name);
        }
    }
}
```

---

**思考题：**

1. 服务预热需要时间，但如果预热期间大量请求进来怎么办？如何设计预热机制让用户无感知？

2. 熔断恢复时，如果上游服务已经恢复了，但下游依赖还没准备好（比如数据库连接池还没建好），会发生什么？如何处理？

3. 渐进式流量恢复的节奏如何控制？太快会导致再次熔断，太慢又影响用户体验。如何找到一个平衡点？

4. 如何设计一个「智能熔断器」，能够根据历史数据自动调整熔断阈值和恢复策略？
