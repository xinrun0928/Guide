# 熔断器模式：断路器状态机与半开熔断

你的系统依赖了 10 个外部服务，其中 1 个服务挂了。

更糟糕的是，你的系统还在疯狂调用这个已经「死掉」的服务——每次调用都要等待超时才返回。

结果：资源耗尽，连锁反应，其他 9 个服务也扛不住了。

这就是**级联故障**。

熔断器模式就是来解决这个问题的。

## 为什么需要熔断器

### 没有熔断器的问题

```
用户请求
    │
    ▼
┌─────────────────────────────────────────┐
│              服务 A                       │
│    ┌──────────┐    ┌──────────┐        │
│    │ 正常调用 │───▶│ 依赖服务D │        │
│    └──────────┘    └──────────┘        │
│         │                 │              │
│         │ 超时等待 30s    │ 故障        │
│         │                 │              │
│    ┌──────────┐    ┌──────────┐        │
│    │ 线程阻塞 │    │ 无法连接 │        │
│    └──────────┘    └──────────┘        │
└─────────────────────────────────────────┘

问题：
1. 线程资源被耗尽
2. 其他请求也受影响
3. 级联故障
```

### 有熔断器之后

```
用户请求
    │
    ▼
┌─────────────────────────────────────────┐
│              服务 A                       │
│    ┌──────────┐    ┌──────────┐        │
│    │ 熔断器   │───▶│ 依赖服务D │        │
│    │ (关闭)   │    └──────────┘        │
│    └──────────┘                         │
└─────────────────────────────────────────┘

正常情况：熔断器关闭，请求正常通过

服务 D 故障：
    │
    ▼
熔断器打开，后续请求直接返回降级响应，不调用服务 D

等待一段时间后：
    │
    ▼
熔断器半开，允许一个请求尝试调用服务 D

如果成功：熔断器关闭，恢复正常
如果失败：熔断器再次打开
```

## 熔断器状态机

```
          成功 ◀───────────────────────────────┐
            │                                   │
            ▼                                   │
    ┌───────────────┐                          │
    │   关闭状态     │                          │
    │  (CLOSED)     │                          │
    │               │                          │
    │  请求正常通过  │                          │
    │  失败计入计数器│                          │
    └───────┬───────┘                          │
            │ 失败次数达到阈值                  │
            ▼                                   │
    ┌───────────────┐     成功      ┌───────────┴───────┐
    │   打开状态     │─────────────▶│    半开状态       │
    │  (OPEN)       │              │   (HALF_OPEN)    │
    │               │              │                   │
    │ 请求直接降级  │              │ 允许 1 个请求通过 │
    │ 不调用服务    │              │ 尝试探测服务是否恢复│
    └───────────────┘     失败      └───────────────────┘
            ▲
            │ 熔断时间到期
            │
            └────────────────────
```

### 三种状态详解

| 状态 | 行为 | 说明 |
|------|------|------|
| **关闭（Closed）** | 正常放行请求，失败计入计数器 | 熔断器「闭合」，一切正常 |
| **打开（Open）** | 所有请求直接降级，不调用服务 | 熔断器「断开」，保护服务 |
| **半开（Half-Open）** | 放行一个请求尝试调用 | 熔断器「半开」，探测恢复 |

### 状态转换条件

```
CLOSED → OPEN：
  - 在时间窗口 T 内，失败次数 >= N
  - 或者失败率 >= X%

OPEN → HALF_OPEN：
  - 熔断器打开后，经过 S 秒（熔断时长）

HALF_OPEN → CLOSED：
  - 探测请求成功

HALF_OPEN → OPEN：
  - 探测请求失败
```

## 熔断器核心参数

### 1. 熔断时间窗口（BreakDuration）

熔断器打开后，多久后尝试恢复。

```java
// 熔断 30 秒后尝试恢复
.breakDuration(30, TimeUnit.SECONDS)
```

### 2. 失败阈值（FailureThreshold）

#### 失败次数阈值

```java
// 连续失败 5 次后熔断
.failureThreshold(5)
```

适用于：调用量较低的场景。

#### 失败率阈值

```java
// 失败率超过 50% 后熔断
.failureRateThreshold(50)

// 时间窗口：10 秒内
.slidingWindowSize(10, TimeUnit.SECONDS)

// 最小请求数：至少 10 次请求才计算失败率
.minimumNumberOfCalls(10)
```

适用于：调用量较大的场景。

### 3. 半开请求数（HalfOpenRequests）

半开状态下，允许通过的请求数。

```java
// 允许 3 个请求尝试
.halfOpenRequests(3)
```

通常设置为 1，即每次只允许一个探测请求。

### 4. 滑动窗口（SlidingWindow）

统计失败的时间窗口。

```java
.slidingWindowSize(10, TimeUnit.SECONDS)
.slidingWindowType(SlidingWindowType.COUNT_BASED)
```

## Java 实现

### 简单实现

```java
public class CircuitBreaker {
    private final AtomicReference&lt;State&gt; state = new AtomicReference&lt;&gt;(State.CLOSED);
    private final AtomicInteger failureCount = new AtomicInteger(0);
    private final int failureThreshold;
    private final Duration breakDuration;
    private volatile long lastFailureTime = 0;

    public enum State {
        CLOSED,
        OPEN,
        HALF_OPEN
    }

    public CircuitBreaker(int failureThreshold, Duration breakDuration) {
        this.failureThreshold = failureThreshold;
        this.breakDuration = breakDuration;
    }

    public void recordSuccess() {
        failureCount.set(0);
        state.set(State.CLOSED);
    }

    public void recordFailure() {
        failureCount.incrementAndGet();
        lastFailureTime = System.currentTimeMillis();

        if (failureCount.get() >= failureThreshold) {
            state.set(State.OPEN);
        }
    }

    public boolean allowRequest() {
        switch (state.get()) {
            case CLOSED:
                return true;

            case OPEN:
                // 检查是否超过熔断时间
                long elapsed = System.currentTimeMillis() - lastFailureTime;
                if (elapsed >= breakDuration.toMillis()) {
                    state.set(State.HALF_OPEN);
                    return true;
                }
                return false;

            case HALF_OPEN:
                // 半开状态，允许一个请求通过
                return true;

            default:
                return true;
        }
    }
}
```

### 完整实现（基于 Resilience4j）

```java
// 定义 CircuitBreaker 配置
CircuitBreakerConfig config = CircuitBreakerConfig.custom()
    // 熔断器名称
    .name("orderService")
    // 熔断时长：30 秒
    .failureRateThreshold(50)
    .slowCallRateThreshold(80)
    .slowCallDurationThreshold(Duration.ofSeconds(5))
    .waitDurationInOpenState(Duration.ofSeconds(30))
    // 滑动窗口：10 秒，10 个请求
    .slidingWindowSize(10)
    .slidingWindowType(SlidingWindowType.COUNT_BASED)
    .minimumNumberOfCalls(10)
    // 自动从 OPEN 转为 HALF_OPEN
    .permittedNumberOfCallsInHalfOpenState(3)
    // 允许重试
    .retryableExceptions(List.of(TimeoutException.class))
    // 忽略异常
    .ignoreExceptions(List.of(BusinessException.class))
    .build();

// 创建熔断器
CircuitBreaker circuitBreaker = CircuitBreaker.of("orderService", config);

// 注册事件监听
circuitBreaker.getEventPublisher()
    .onStateTransition(event ->
        log.info("CircuitBreaker 状态变化: {} → {}",
            event.getStateTransition().getFromState(),
            event.getStateTransition().getToState()))
    .onFailureRateExceeded(event ->
        log.warn("失败率超标: {}%", event.getFailureRate()))
    .onSlowCallRateExceeded(event ->
        log.warn("慢调用率超标: {}%", event.getSlowCallRate()));
```

### Spring Boot 注解方式

```java
@Service
public class OrderService {

    @CircuitBreaker(
        name = "orderService",
        fallbackMethod = "createOrderFallback"
    )
    public Order createOrder(OrderRequest request) {
        return orderRepository.create(request);
    }

    // 降级方法
    public Order createOrderFallback(OrderRequest request,
            Throwable throwable) {
        log.error("创建订单失败，熔断触发: {}", throwable.getMessage());

        // 方案 1：返回友好提示
        return Order.builder()
            .status("PENDING")
            .message("订单正在处理中，稍后请查看")
            .build();

        // 方案 2：写入消息队列，后续处理
        // messageQueue.send("order:pending", request);

        // 方案 3：抛出业务异常
        // throw new OrderPendingException();
    }
}
```

## 熔断策略

### 1. 基于失败率

```java
CircuitBreakerConfig.custom()
    .failureRateThreshold(50)  // 50% 失败率触发熔断
    .slidingWindowSize(10)     // 统计最近 10 次调用
    .minimumNumberOfCalls(5)   // 至少 5 次调用才计算
    .build();
```

### 2. 基于慢调用

```java
CircuitBreakerConfig.custom()
    .slowCallRateThreshold(80)           // 80% 慢调用触发熔断
    .slowCallDurationThreshold(5, TimeUnit.SECONDS)  // 超过 5 秒算慢调用
    .slidingWindowSize(10)
    .minimumNumberOfCalls(5)
    .build();
```

### 3. 混合策略

```java
CircuitBreakerConfig.custom()
    // 任一条件触发熔断
    .failureRateThreshold(50)
    .slowCallRateThreshold(80)
    .slidingWindowSize(10)
    .minimumNumberOfCalls(5)
    .waitDurationInOpenState(30, TimeUnit.SECONDS)
    .build();
```

## 熔断与降级的关系

```
熔断器（保证系统不死）
    │
    ▼
降级处理（保证用户体验）
    │
    ▼
限流器（保证系统不被过载）
```

### 降级策略

```java
public Order createOrderFallback(OrderRequest request,
        Throwable throwable) {
    // 1. 记录日志
    log.error("创建订单失败", throwable);

    // 2. 判断异常类型
    if (throwable instanceof TimeoutException) {
        // 超时：可能是服务压力大，返回处理中
        return Order.pending(request.getUserId());
    }

    if (throwable instanceof ServiceUnavailableException) {
        // 服务不可用：返回友好提示
        return Order.unavailable();
    }

    // 3. 通用降级
    return Order.builder()
        .status("PENDING")
        .message("系统繁忙，订单将在 5 分钟内处理")
        .build();
}
```

## 熔断器可视化

### 状态监控

```java
@GetMapping("/circuit-breaker/status")
public Map&lt;String, Object&gt; getCircuitBreakerStatus() {
    CircuitBreaker orderCircuitBreaker = circuitBreakerRegistry
        .circuitBreaker("orderService");

    CircuitBreakerMetrics metrics = orderCircuitBreaker.getMetrics();

    Map&lt;String, Object&gt; status = new HashMap&lt;&gt;();
    status.put("state", orderCircuitBreaker.getState());
    status.put("failureRate", metrics.getFailureRate());
    status.put("slowCallRate", metrics.getSlowCallRate());
    status.put("numberOfSuccessfulCalls",
        metrics.getNumberOfSuccessfulCalls());
    status.put("numberOfFailedCalls",
        metrics.getNumberOfFailedCalls());
    status.put("numberOfNotPermittedCalls",
        metrics.getNumberOfNotPermittedCalls());

    return status;
}
```

### 响应示例

```json
{
  "state": "HALF_OPEN",
  "failureRate": 0.0,
  "slowCallRate": 0.0,
  "numberOfSuccessfulCalls": 5,
  "numberOfFailedCalls": 0,
  "numberOfNotPermittedCalls": 10
}
```

## 最佳实践

### 1. 合理的熔断阈值

```java
// 避免阈值太低导致频繁熔断
CircuitBreakerConfig.custom()
    .failureRateThreshold(70)      // 不要太敏感，70% 再熔断
    .slowCallDurationThreshold(10, TimeUnit.SECONDS)
    .waitDurationInOpenState(60, TimeUnit.SECONDS)  // 熔断时间稍长
    .build();
```

### 2. 降级方法要健壮

```java
// 降级方法本身不能有问题
public Order createOrderFallback(...) {
    try {
        // 降级逻辑要简单，避免复杂操作
        return orderCache.get(request.getId());
    } catch (Exception e) {
        // 即使缓存失败，也要返回一个默认值
        return Order.defaultOrder();
    }
}
```

### 3. 熔断器隔离

```java
// 不同服务使用不同的熔断器
CircuitBreakerRegistry registry = CircuitBreakerRegistry.ofDefaults();

CircuitBreaker userCircuitBreaker = registry.circuitBreaker("userService");
CircuitBreaker orderCircuitBreaker = registry.circuitBreaker("orderService");
CircuitBreaker paymentCircuitBreaker = registry.circuitBreaker("paymentService");
```

### 4. 分层熔断

```java
// 全局熔断 + 局部熔断
@CircuitBreaker(name = "globalFallback", fallbackMethod = "globalFallback")
public class OrderService {

    @CircuitBreaker(name = "userService", fallbackMethod = "getUserFallback")
    public User getUser(Long id) {
        return userClient.getUser(id);
    }

    @CircuitBreaker(name = "inventoryService", fallbackMethod = "checkInventoryFallback")
    public boolean checkInventory(Long productId) {
        return inventoryClient.check(productId);
    }
}
```

---

**思考题：**

假设你负责一个电商系统，其中「订单服务」依赖「库存服务」。

某天，库存服务发生故障，响应时间从 50ms 飙升到 30 秒。

问题：
1. 如果你的熔断器基于「失败率」熔断，阈值设为 50%。当库存服务响应超时（30 秒）时，这些超时算失败吗？还是只算慢调用？
2. 如果你的熔断器基于「慢调用」熔断，阈值设为 80%。当库存服务持续响应 30 秒时，会发生什么？
3. 半开状态下，你只允许 1 个请求通过。如果这个请求也超时了，会怎样？用户会看到什么？
4. 如果库存服务恢复了，但你的熔断器还在打开状态，用户会一直无法下单。如何设计熔断器的恢复机制，使其更「智能」？

提示：考虑熔断时长、重置策略、探测请求的代价。
