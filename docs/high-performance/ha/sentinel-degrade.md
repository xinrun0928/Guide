# Sentinel 熔断降级：RT、异常比例、异常数策略

Sentinel 的熔断降级支持三种策略：

- **RT 熔断**：平均响应时间过长，熔断
- **异常比例熔断**：失败率过高，熔断
- **异常数熔断**：失败次数过多，熔断

三个策略针对不同的故障场景，各有适用场景。

## 为什么需要三种策略

不同的故障，表现不同：

| 故障类型 | 表现 | 适用策略 |
|----------|------|----------|
| 服务卡顿 | 响应时间变长，但偶尔能返回 | RT 熔断 |
| 服务不稳定 | 时好时坏，大量超时 | 异常比例熔断 |
| 服务彻底挂了 | 持续异常 | 异常数熔断 |

## 1. RT 熔断（平均响应时间）

### 原理

当一个时间窗口内，平均响应时间超过阈值，触发熔断。

```
正常情况：响应时间 < 100ms

某时刻：数据库变慢
响应时间：500ms, 800ms, 1000ms, 2000ms...

平均响应时间 = (500+800+1000+2000)/4 = 1075ms

超过阈值（假设 500ms）
→ 触发 RT 熔断
→ 后续请求直接降级
```

### 配置

```java
DegradeRule rule = new DegradeRule("createOrder")  // 资源名
    .setGrade(CircuitBreakerStrategy.ERROR_RATE.getType())
    .setCount(0.5)           // 异常比例阈值：50%
    .setMinimumRequestAmount(5)  // 最小请求数
    .setStatIntervalMs(1000)    // 统计窗口：1 秒
    .setSlowRatioThreshold(0.5) // 慢调用比例阈值
    .setMaxAllowedDuration(100) // 最大允许 RT：100ms
    .setTimeWindow(10);         // 熔断时长：10 秒
```

### 更直观的配置方式

```yaml
degrade-rule:
  - resource: createOrder
    grade: 1  # 1=RT, 2=异常比例, 3=异常数
    count: 500  # 阈值
    timeWindow: 10  # 熔断时长（秒）
```

### 使用场景

- **适用**：数据库查询、文件读取等 IO 密集型操作
- **不适用**：计算密集型操作（本身耗时长）

### 代码示例

```java
@Service
public class OrderService {

    @SentinelResource(
        value = "createOrder",
        entryType = EntryType.OUT
    )
    public Order createOrder(OrderRequest request) {
        // 订单创建可能涉及数据库操作
        return orderRepository.save(request);
    }

    // 降级处理
    public Order createOrderFallback(OrderRequest request,
            BlockException e) {
        // RT 熔断触发
        log.warn("创建订单 RT 熔断触发");

        // 返回降级响应
        return Order.builder()
            .status("PENDING")
            .message("订单处理中，稍后通知您")
            .build();
    }
}
```

## 2. 异常比例熔断

### 原理

当一个时间窗口内，异常（抛异常）比例超过阈值，触发熔断。

```
时间窗口：1 秒
最小请求数：5

某时刻：
- 总请求数：10
- 异常数：6

异常比例 = 6/10 = 60%

超过阈值（假设 50%）
→ 触发异常比例熔断
```

### 配置

```java
DegradeRule rule = new DegradeRule("getProduct")
    .setGrade(CircuitBreakerStrategy.ERROR_RATE.getType())
    // 异常比例 50%
    .setCount(0.5)
    // 最小请求数：至少 5 个请求才计算
    .setMinimumRequestAmount(5)
    // 统计窗口
    .setStatIntervalMs(1000)
    // 熔断时长
    .setTimeWindow(10);
```

### 使用场景

- **适用**：依赖外部服务、第三方 API
- **不适用**：内部校验失败（不应该熔断）

### 代码示例

```java
@Service
public class ProductService {

    @SentinelResource(
        value = "getProduct",
        blockHandler = "getProductBlockHandler",
        exceptionsToIgnore = {ProductNotFoundException.class}  // 业务异常不熔断
    )
    public Product getProduct(Long id) {
        return productClient.get(id);
    }

    // 熔断降级处理
    public Product getProductBlockHandler(Long id,
            BlockException e) {
        log.warn("商品查询熔断: {}", e.getClass().getSimpleName());

        // 方案 1：返回缓存数据
        Product cached = productCache.get(id);
        if (cached != null) {
            return cached;
        }

        // 方案 2：返回空数据
        return Product.builder()
            .id(id)
            .name("商品暂时不可用")
            .build();
    }
}
```

## 3. 异常数熔断

### 原理

当一个时间窗口内，异常次数超过阈值，触发熔断。

```
时间窗口：10 秒
异常数阈值：10

某时刻：第三方支付服务异常
异常数：1, 2, 3, ... 10

达到阈值
→ 触发异常数熔断
→ 熔断 10 秒
```

### 配置

```java
DegradeRule rule = new DegradeRule("payment")
    .setGrade(CircuitBreakerStrategy.ERROR_COUNT.getType())
    // 异常次数
    .setCount(10)
    // 熔断时长
    .setTimeWindow(10);
```

### 使用场景

- **适用**：对稳定性要求高的核心服务
- **注意**：需要根据业务量调整阈值

### 代码示例

```java
@Service
public class PaymentService {

    @SentinelResource(
        value = "processPayment",
        fallback = "processPaymentFallback"
    )
    public PaymentResult processPayment(PaymentRequest request) {
        // 调用支付网关
        PaymentResponse response = paymentGateway.pay(request);
        return PaymentResult.success(response);
    }

    public PaymentResult processPaymentFallback(PaymentRequest request,
            Throwable t) {
        log.error("支付处理异常数熔断: {}", t.getMessage());

        // 记录异常
        alertService.send("支付服务异常数超标");

        // 返回友好提示
        return PaymentResult.retry("支付服务暂时不可用，请稍后重试");
    }
}
```

## 三种策略对比

| 策略 | 配置参数 | 适用场景 | 注意事项 |
|------|----------|----------|----------|
| RT 熔断 | `count`: 毫秒数 | 服务响应变慢 | 适用于 IO 密集型 |
| 异常比例 | `count`: 0-1 | 服务不稳定 | 需要设置最小请求数 |
| 异常数 | `count`: 次数 | 核心服务保护 | 根据业务量调整阈值 |

## 组合使用

### 实际生产环境建议

```java
@Configuration
public class SentinelDegradeConfig {

    @PostConstruct
    public void initDegradeRules() {
        List&lt;DegradeRule&gt; rules = new ArrayList&lt;&gt;();

        // 订单服务：RT + 异常比例
        rules.add(createDegradeRule("createOrder",
            CircuitBreakerStrategy.SLOW_REQUEST_RATIO.getType())
            .setCount(0.5)           // 50% 慢调用
            .setSlowRatioThreshold(0.5)
            .setMaxAllowedDuration(1000)  // 超过 1 秒算慢
            .setTimeWindow(30)
            .setMinimumRequestAmount(5));

        rules.add(createDegradeRule("createOrder",
            CircuitBreakerStrategy.ERROR_RATE.getType())
            .setCount(0.5)           // 50% 异常
            .setTimeWindow(30)
            .setMinimumRequestAmount(10));

        // 支付服务：异常数（更严格）
        rules.add(createDegradeRule("payment",
            CircuitBreakerStrategy.ERROR_COUNT.getType())
            .setCount(5)             // 5 次异常就熔断
            .setTimeWindow(60));

        // 读服务：更宽松
        rules.add(createDegradeRule("getProduct",
            CircuitBreakerStrategy.ERROR_RATE.getType())
            .setCount(0.8)           // 80% 异常才熔断
            .setTimeWindow(10)
            .setMinimumRequestAmount(20));

        DegradeRuleManager.loadRules(rules);
    }

    private DegradeRule createDegradeRule(String resource, int strategy) {
        return new DegradeRule(resource)
            .setGrade(strategy)
            .setStatIntervalMs(1000);
    }
}
```

## 熔断后的恢复

### 状态转换

```
熔断触发
    │
    ▼
熔断 OPEN（30 秒）
    │
    │ 经过 30 秒
    ▼
熔断 HALF_OPEN（探测阶段）
    │
    ├─ 成功 → 恢复 CLOSED
    │
    └─ 失败 → 再次 OPEN
```

### 探测机制

```java
// 半开状态下的行为
// Sentinel 会放行 1 个请求进行探测
// 如果成功，关闭熔断器
// 如果失败，重新打开

// 配置半开探测的最大请求数
.setMinRequestAmountInHalfOpenState(1)  // 默认值
```

## 降级策略设计

### 分级降级

```java
public Order createOrderFallback(OrderRequest request,
        Throwable throwable) {
    // 1. 记录详细日志
    log.error("创建订单失败", throwable);

    // 2. 发送告警
    alertService.alert("OrderService", throwable);

    // 3. 根据异常类型返回不同降级响应
    if (throwable instanceof TimeoutException) {
        // 超时：订单可能已创建，查询确认
        return handleTimeout(request);
    }

    if (throwable instanceof ServiceUnavailableException) {
        // 服务不可用：订单进入队列
        return handleUnavailable(request);
    }

    if (throwable instanceof BusinessException) {
        // 业务异常：不降级，抛出
        throw (BusinessException) throwable;
    }

    // 默认降级
    return defaultFallback(request);
}

private Order handleTimeout(OrderRequest request) {
    // 查询订单状态
    Order order = orderRepository.findByUserAndProduct(
        request.getUserId(), request.getProductId());

    if (order != null) {
        order.setMessage("订单可能已创建，请在我的订单中确认");
    } else {
        // 订单未创建，标记待处理
        order = orderRepository.createPending(request);
        order.setMessage("订单处理中，请稍后在我的订单中确认");
    }

    return order;
}

private Order handleUnavailable(OrderRequest request) {
    // 发送消息到延迟队列
    messageQueue.send("order:create:retry", request);
    return Order.builder()
        .status("PENDING")
        .message("订单将在稍后处理")
        .build();
}
```

### 降级后的数据一致性

```java
@Service
public class OrderServiceWithCompensation {

    @CircuitBreaker(name = "orderService", fallbackMethod = "fallback")
    public Order createOrder(OrderRequest request) {
        Order order = orderRepository.create(request);
        paymentService.process(order);
        return order;
    }

    public Order fallback(OrderRequest request, Throwable t) {
        // 降级处理
        Order pendingOrder = createPendingOrder(request);

        // 注册补偿任务
        compensationService.register(
            new CompensationTask()
                .type("CREATE_ORDER")
                .data(request)
                .retryStrategy(new ExponentialBackoff(3))
        );

        return pendingOrder;
    }
}
```

## 监控与告警

### 熔断事件监控

```java
@Component
public class DegradeMonitor {

    @Autowired
    private SentinelDegradeMonitor sentinelDegradeMonitor;

    @PostConstruct
    public void init() {
        // 监听熔断事件
        DegradeRuleManager.registerPropertyListener(
            property -> {
                List&lt;DegradeRule&gt; rules = property.get();
                for (DegradeRule rule : rules) {
                    monitorRule(rule);
                }
            }
        );
    }

    private void monitorRule(DegradeRule rule) {
        // 监控熔断器的状态变化
        ClusterBuilderSlot.getClusterMap()
            .computeIfAbsent(rule.getResource(), k -> new ClusterMetric())
            .addStateChangeListener((prevState, newState) -> {
                if (newState == CircuitBreaker.State.OPEN) {
                    alertService.send("熔断触发",
                        rule.getResource(),
                        rule.getGrade());
                }
            });
    }
}
```

---

**思考题：**

假设你负责一个商品查询服务，该服务依赖 Redis 缓存和 MySQL 数据库。

某天，Redis 突然挂了。

问题：
1. 如果你的熔断策略是 RT 熔断，当 Redis 不可用时，查询会切换到 MySQL，响应时间可能从 5ms 变成 50ms。RT 熔断会被触发吗？为什么？
2. 如果你的熔断策略是异常比例熔断，当 Redis 不可用时，所有 Redis 查询都会抛出异常（连接超时）。异常比例会是多少？会被熔断吗？
3. 如果 Redis 恢复后，你的熔断器还在「打开」状态。用户请求会怎样？什么时候会恢复？
4. 如果让你设计一个「智能熔断」策略：根据 Redis 的实际健康状况动态调整熔断策略，你会怎么做？

提示：考虑 Redis 本地缓存、MySQL 降级、缓存预热等场景。
