# Hystrix vs Sentinel vs Resilience4j 对比

微服务时代，容错是必修课。

三剑客：Hystrix、Sentinel、Resilience4j，你该选谁？

## 三者定位

```
┌─────────────────────────────────────────────────────────┐
│                      容错框架对比                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Hystrix        │  Netflix 亲儿子 | 已停止维护 | 适合遗留系统  │
│  ─────────────────┼────────────────────────────────────────│
│  Sentinel        │  阿里出品 | 功能全面 | 适合国内生态        │
│  ─────────────────┼────────────────────────────────────────│
│  Resilience4j    │  轻量级 | 函数式 | 适合响应式编程          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Hystrix：曾经的老大哥

### 核心特性

- 舱壁模式（线程池隔离）
- 熔断器模式
- 请求缓存
- 请求合并
- 后台命令模式

### 线程池隔离

```java
@HystrixCommand(
    groupKey = "UserGroup",
    commandKey = "getUser",
    threadPoolKey = "userThreadPool",
    threadPoolProperties = {
        @HystrixProperty(name = "coreSize", value = "10"),
        @HystrixProperty(name = "maxQueueSize", value = "20"),
        @HystrixProperty(name = "queueSizeRejectionThreshold", value = "15")
    },
    fallbackMethod = "getUserFallback"
)
public User getUser(Long id) {
    return userClient.getUser(id);
}

public User getUserFallback(Long id, Throwable t) {
    log.error("获取用户失败", t);
    return User.defaultUser();
}
```

### 熔断器配置

```java
@HystrixCommand(
    commandKey = "getProduct",
    fallbackMethod = "getProductFallback",
    commandProperties = {
        // 熔断器配置
        @HystrixProperty(name = "circuitBreaker.enabled", value = "true"),
        @HystrixProperty(name = "circuitBreaker.requestVolumeThreshold", value = "20"),
        @HystrixProperty(name = "circuitBreaker.sleepWindowInMilliseconds", value = "10000"),
        @HystrixProperty(name = "circuitBreaker.errorThresholdPercentage", value = "50"),

        // 超时配置
        @HystrixProperty(name = "execution.isolation.thread.timeoutInMilliseconds", value = "3000")
    }
)
public Product getProduct(Long id) {
    return productClient.get(id);
}
```

### Hystrix 的问题

1. **维护停止**：Netflix 宣布不再维护
2. **线程开销**：线程池隔离有额外开销
3. **入侵性强**：大量注解侵入业务代码
4. **响应式支持差**：不支持响应式编程

## Sentinel：全能选手

### 核心特性

- 流量控制（QPS、并发数）
- 熔断降级（RT、异常比例、异常数）
- 系统自适应保护
- 热点参数限流
- 黑白名单控制
- 实时监控

### 基本使用

```java
@RestController
public class ProductController {

    @GetMapping("/product/{id}")
    @SentinelResource(
        value = "getProduct",
        blockHandler = "getProductBlock",
        fallback = "getProductFallback"
    )
    public Product getProduct(@PathVariable Long id) {
        return productService.getById(id);
    }

    // 限流处理
    public Product getProductBlock(Long id, BlockException e) {
        return Product.builder()
            .id(id)
            .name("请求过于频繁")
            .build();
    }

    // 降级处理
    public Product getProductFallback(Long id, Throwable e) {
        return Product.builder()
            .id(id)
            .name("服务暂时不可用")
            .build();
    }
}
```

### 动态规则配置

```java
// 动态更新限流规则
@Autowired
private InitFunc initFunc;

@Data
public class FlowRuleConfig {
    private List&lt;FlowRule&gt; rules;

    @PostConstruct
    public void init() {
        rules = new ArrayList&lt;&gt;();

        FlowRule rule = FlowRule.builder()
            .resource("getProduct")
            .grade(RuleConstant.GRADE_QPS)
            .count(100)
            .controlBehavior(RuleConstant.CONTROL_BEHAVIOR_DEFAULT)
            .build();

        rules.add(rule);
        FlowRuleManager.loadRules(rules);
    }
}
```

### Sentinel 优势

| 特性 | 说明 |
|------|------|
| 功能丰富 | 限流、熔断、降级、系统保护全覆盖 |
| 实时监控 | 自带监控 Dashboard |
| 动态配置 | 支持运行时动态修改规则 |
| 多语言支持 | Java、Go、C++ 等 |
| 生态完善 | Dubbo、Sentinel Gateway 等适配器 |

### Sentinel 劣势

- 规则配置相对复杂
- 学习曲线较陡

## Resilience4j：轻量新星

### 核心特性

- 熔断器（CircuitBreaker）
- 限流器（RateLimiter）
- 重试（Retry）
- 舱壁（Bulkhead）
- 时间限制（TimeLimiter）
- 函数式 API
- 支持响应式

### 熔断器

```java
// 定义熔断器配置
CircuitBreakerConfig config = CircuitBreakerConfig.custom()
    .failureRateThreshold(50)
    .slowCallRateThreshold(80)
    .slowCallDurationThreshold(Duration.ofSeconds(5))
    .waitDurationInOpenState(Duration.ofSeconds(30))
    .slidingWindowSize(10)
    .minimumNumberOfCalls(5)
    .build();

// 创建熔断器
CircuitBreaker circuitBreaker = CircuitBreaker.of("orderService", config);

// 使用熔断器
Supplier&lt;Order&gt; orderSupplier = CircuitBreaker.decorateSupplier(
    circuitBreaker,
    () -> orderService.getOrder(id)
);

Try&lt;Order&gt; result = Try.ofSupplier(orderSupplier)
    .recover(throwable -> Order.defaultOrder());
```

### 重试机制

```java
// 定义重试配置
RetryConfig retryConfig = RetryConfig.custom()
    .maxAttempts(3)
    .waitDuration(Duration.ofMillis(500))
    .retryExceptions(IOException.class, TimeoutException.class)
    .ignoreExceptions(BusinessException.class)
    .intervalFunction(IntervalFunction.ofExponentialBackoff(500, 2))
    .build();

// 创建重试器
Retry retry = Retry.of("orderService", retryConfig);

// 使用
Supplier&lt;Order&gt; retryableSupplier = Retry.decorateSupplier(
    retry,
    () -> orderService.getOrder(id)
);

Order order = retryableSupplier.get();
```

### 限流器

```java
// 定义限流器配置
RateLimiterConfig config = RateLimiterConfig.custom()
    .limitForPeriod(100)              // 每周期限流数
    .limitRefreshPeriod(Duration.ofSeconds(1))  // 刷新周期
    .timeoutDuration(Duration.ofMillis(100))     // 等待超时
    .build();

// 创建限流器
RateLimiter rateLimiter = RateLimiter.of("orderService", config);

// 使用
Supplier&lt;Order&gt; rateLimitedSupplier =
    RateLimiter.decorateSupplier(rateLimiter, () -> orderService.getOrder(id));

Order order = rateLimitedSupplier.get();
```

### 舱壁模式

```java
// 线程池舱壁
BulkheadConfig bulkheadConfig = BulkheadConfig.custom()
    .maxConcurrentCalls(10)
    .maxWaitDuration(Duration.ofMillis(100))
    .build();

Bulkhead bulkhead = Bulkhead.of("orderService", bulkheadConfig);

// 使用
Supplier&lt;Order&gt; bulkheadSupplier =
    Bulkhead.decorateSupplier(bulkhead, () -> orderService.getOrder(id));

Order order = bulkheadSupplier.get();
```

### Spring Boot 集成

```java
// 依赖
/*
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-aop</artifactId>
</dependency>
<dependency>
    <groupId>io.github.resilience4j</groupId>
    <artifactId>resilience4j-spring-boot2</artifactId>
    <version>2.1.0</version>
</dependency>
*/

// 配置
resilience4j:
  circuitbreaker:
    configs:
      default:
        failureRateThreshold: 50
        waitDurationInOpenState: 30s
        slidingWindowSize: 10
    instances:
      orderService:
        baseConfig: default
        failureRateThreshold: 30
  retry:
    configs:
      default:
        maxAttempts: 3
        waitDuration: 500ms
    instances:
      orderService:
        baseConfig: default
        maxAttempts: 5
```

```java
// 注解方式
@Service
public class OrderService {

    @CircuitBreaker(name = "orderService", fallbackMethod = "fallback")
    @Retry(name = "orderService")
    @RateLimiter(name = "orderService")
    @Bulkhead(name = "orderService")
    public Order createOrder(OrderRequest request) {
        return orderRepository.save(request);
    }

    public Order fallback(Exception e) {
        return Order.pending();
    }
}
```

## 全面对比

| 维度 | Hystrix | Sentinel | Resilience4j |
|------|---------|----------|--------------|
| **维护状态** | 已停止维护 | 活跃维护 | 活跃维护 |
| **学习曲线** | 中等 | 较陡 | 平缓 |
| **功能丰富度** | 丰富 | 最丰富 | 适中 |
| **性能** | 中等（线程开销） | 优秀 | 优秀 |
| **线程隔离** | 支持（线程池） | 不支持 | 不支持 |
| **响应式支持** | 差 | 一般 | 优秀 |
| **动态配置** | 需要自己实现 | 原生支持 | 需要配合 |
| **监控** | 自带 Dashboard | 自带 Dashboard | 需要配合 Micrometer |
| **生态** | Netflix 生态 | 阿里生态 | 独立 |

## 选型建议

### 选 Hystrix

- 遗留系统，不想大改
- 已经用了 Hystrix
- 需要线程池隔离（注意：开销大）

### 选 Sentinel

- 需要全面的流量控制
- 国内团队，习惯阿里生态
- 需要动态配置规则
- 需要与 Spring Cloud Alibaba 集成

### 选 Resilience4j

- 新项目
- 使用响应式编程（WebFlux）
- 喜欢函数式风格
- 需要轻量级方案

## 迁移方案

### Hystrix → Resilience4j

```java
// Hystrix
@HystrixCommand(
    fallbackMethod = "fallback",
    commandProperties = {
        @HystrixProperty(name = "circuitBreaker.errorThresholdPercentage", value = "50"),
        @HystrixProperty(name = "execution.isolation.thread.timeoutInMilliseconds", value = "3000")
    }
)
public Order getOrder(Long id) {
    return orderClient.getOrder(id);
}

// Resilience4j
@CircuitBreaker(name = "orderService", fallbackMethod = "fallback")
@TimeLimiter(name = "orderService")
public CompletableFuture&lt;Order&gt; getOrder(Long id) {
    return CompletableFuture.supplyAsync(() -> orderClient.getOrder(id));
}
```

### Hystrix → Sentinel

```java
// Hystrix
@HystrixCommand(fallbackMethod = "fallback")
public Order getOrder(Long id) {
    return orderClient.getOrder(id);
}

// Sentinel
@SentinelResource(
    value = "getOrder",
    fallback = "fallback",
    blockHandler = "blockHandler"
)
public Order getOrder(Long id) {
    return orderClient.getOrder(id);
}
```

---

**思考题：**

假设你负责一个微服务系统，需要从 Hystrix 迁移到新的容错框架。

问题：
1. 你的系统使用了 Hystrix 的线程池隔离功能。迁移到 Sentinel 或 Resilience4j 后，如何保持类似的隔离效果？
2. Hystrix 有请求合并（Request Collapser）功能， Sentinel 和 Resilience4j 有类似功能吗？
3. 如果你的系统已经深度定制了 Hystrix（自定义命令、请求缓存等），迁移成本会有多大？
4. 如果让你设计一个「容错框架评估标准」，你会从哪些维度评估？请给出具体的评分表。

提示：考虑功能、性能、可维护性、社区活跃度、生态完整性等。
