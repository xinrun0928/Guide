# 重试机制：重试策略、指数退避、幂等性保证

你有没有遇到过这种情况：用户支付时，点击「支付」按钮后转圈，然后报错「支付失败」。

用户很紧张，又点了一次。结果——扣了两次钱！

这是典型的**重试没有做好**的场景。

重试，是分布式系统中最重要的容错机制之一。用得好，可以让系统「自愈」；用不好，会把「小问题」放大成「大灾难」。

## 为什么需要重试

### 网络是不可靠的

```
用户请求
    │
    ▼
┌─────────────────────────────────────────┐
│            网络世界                       │
│                                         │
│  网络抖动 ──────────────────────▶ 丢包  │
│  路由故障 ──────────────────────▶ 绕路  │
│  服务重启 ──────────────────────▶ 暂时不可用 │
│                                         │
└─────────────────────────────────────────┘

这些临时性问题，往往重试一下就好了。
```

### 失败是分类型的

| 失败类型 | 是否重试 | 原因 |
|---------|---------|------|
| 网络抖动 | ✅ 重试 | 临时性问题 |
| 服务短暂不可用 | ✅ 重试 | 服务正在重启 |
| 超时 | ✅ 重试 | 可能是网络慢 |
| 业务异常 | ❌ 不重试 | 逻辑错误，重试无效 |
| 资源耗尽 | ❌ 不重试 | 需要扩容，不是重试能解决的 |
| 权限不足 | ❌ 不重试 | 认证问题，重试也无效 |

## 重试策略

### 1. 固定间隔重试

每次重试间隔相同的时间。

```java
public &lt;T&gt; T retry(Callable&lt;T&gt; action, int maxAttempts) {
    Exception lastException = null;

    for (int attempt = 1; attempt &lt;= maxAttempts; attempt++) {
        try {
            return action.call();
        } catch (Exception e) {
            lastException = e;
            log.warn("第 {} 次尝试失败: {}", attempt, e.getMessage());

            if (attempt &lt; maxAttempts) {
                try {
                    // 固定等待 1 秒
                    Thread.sleep(1000);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
    }

    throw new RuntimeException("重试 {} 次后仍然失败", lastException);
}
```

**适用场景**：失败概率低、对延迟不敏感的场景。

### 2. 指数退避重试

每次重试间隔时间成倍增加。

```java
public &lt;T&gt; T retryWithExponentialBackoff(Callable&lt;T&gt; action,
                                          int maxAttempts,
                                          long baseDelayMs) {
    Exception lastException = null;

    for (int attempt = 1; attempt &lt;= maxAttempts; attempt++) {
        try {
            return action.call();
        } catch (Exception e) {
            lastException = e;
            log.warn("第 {} 次尝试失败: {}", attempt, e.getMessage());

            if (attempt &lt; maxAttempts) {
                // 指数退避：1s, 2s, 4s, 8s, 16s...
                long delay = baseDelayMs * (1L &lt;&lt; (attempt - 1));
                try {
                    Thread.sleep(delay);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
    }

    throw new RuntimeException("重试 " + maxAttempts + " 次后仍然失败", lastException);
}
```

**适用场景**：需要给下游服务恢复时间，避免雪崩。

### 3. 带抖动的指数退避

在指数退避基础上添加随机抖动，避免多客户端同时重试造成「惊群效应」。

```java
public &lt;T&gt; T retryWithJitter(Callable&lt;T&gt; action,
                             int maxAttempts,
                             long baseDelayMs) {
    Random random = new Random();
    Exception lastException = null;

    for (int attempt = 1; attempt &lt;= maxAttempts; attempt++) {
        try {
            return action.call();
        } catch (Exception e) {
            lastException = e;

            if (attempt &lt; maxAttempts) {
                // 指数退避 + 随机抖动
                long expDelay = baseDelayMs * (1L &lt;&lt; (attempt - 1));
                // jitter: 0.5 ~ 1.5 倍
                long jitter = (long) (expDelay * (0.5 + random.nextDouble()));
                long delay = Math.min(jitter, 60_000);  // 最大 60 秒

                try {
                    Thread.sleep(delay);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
    }

    throw new RuntimeException("重试 " + maxAttempts + " 次后仍然失败", lastException);
}
```

**抖动公式**：
- Full Jitter: `random(0, base * 2^attempt)`
- Equal Jitter: `base * 2^attempt / 2 + random(0, base * 2^attempt / 2)`
- Decorrelated Jitter: `previous * 3 + random(0, base)`

### 4. 基于 Spring Retry 的实现

```java
// 引入依赖
// &lt;dependency&gt;
//     &lt;groupId&gt;org.springframework.retry&lt;/groupId&gt;
//     &lt;artifactId&gt;spring-retry&lt;/artifactId&gt;
// &lt;/dependency&gt;

// 启用重试
@EnableRetry
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}

// 使用注解
@Service
public class PaymentService {

    @Retryable(
        value = {RemoteServiceException.class, TimeoutException.class},
        maxAttempts = 3,
        backoff = @Backoff(delay = 1000, multiplier = 2)
    )
    public PaymentResult pay(Order order) {
        return paymentGateway.process(order);
    }

    // 重试失败后执行
    @Recover
    public PaymentResult recover(RemoteServiceException e, Order order) {
        log.error("支付重试失败: orderId={}", order.getId());
        return PaymentResult.failed("支付失败，请稍后重试");
    }

    // Recovery 方法支持多种异常
    @Recover
    public PaymentResult recover(TimeoutException e, Order order) {
        log.error("支付超时: orderId={}", order.getId());
        return PaymentResult.timeout();
    }
}
```

## 重试框架选型

### 1. Resilience4j Retry

```java
// 配置
RetryConfig config = RetryConfig.custom()
    .maxAttempts(3)                                    // 最大重试次数
    .waitDuration(Duration.ofMillis(500))             // 等待间隔
    .retryExceptions(
        IOException.class,
        TimeoutException.class
    )
    .ignoreExceptions(
        BusinessException.class,
        IllegalArgumentException.class
    )
    .intervalFunction(IntervalFunction.ofExponentialBackoff(
        500, 2, 10000))  // 指数退避，最大 10 秒
    .build();

// 创建 Retry 实例
Retry retry = Retry.of("paymentService", config);

// 使用
Supplier&lt;PaymentResult&gt; supplier = Retry.decorateSupplier(retry, () -> {
    return paymentGateway.process(order);
});

PaymentResult result = Try.ofSupplier(supplier)
    .recover(e -> PaymentResult.failed(e.getMessage()))
    .get();
```

### 2. Spring Retry +注解方式

```java
@Configuration
public class RetryConfiguration {

    @Bean
    public RetryTemplate retryTemplate() {
        ExponentialBackOffPolicy backOffPolicy = new ExponentialBackOffPolicy();
        backOffPolicy.setInitialInterval(1000);      // 初始间隔 1 秒
        backOffPolicy.setMultiplier(2.0);            // 倍数 2
        backOffPolicy.setMaxInterval(10000);         // 最大间隔 10 秒

        SimpleRetryPolicy retryPolicy = new SimpleRetryPolicy();
        retryPolicy.setMaxAttempts(3);               // 最大重试 3 次

        RetryTemplate template = new RetryTemplate();
        template.setBackOffPolicy(backOffPolicy);
        template.setRetryPolicy(retryPolicy);

        return template;
    }
}

// 使用
@Service
public class OrderService {

    @Autowired
    private RetryTemplate retryTemplate;

    public Order createOrder(OrderRequest request) {
        return retryTemplate.execute(context -> {
            // 这里的代码会被重试
            log.info("创建订单，当前重试次数: {}",
                context.getRetryCount());

            if (context.getRetryCount() > 0) {
                // 可以在这里做一些重试前的准备
            }

            return orderGateway.create(request);
        });
    }
}
```

## 重试与幂等性

**重要提醒**：重试的前提是**幂等性**。如果不保证幂等，重试可能会导致重复操作。

### 幂等重试的关键

```java
public class IdempotentRetryTemplate {

    private final RetryTemplate retryTemplate;
    private final IdempotencyChecker idempotencyChecker;

    public &lt;T&gt; T retry(String idempotentKey, Callable&lt;T&gt; action) {
        // 检查是否已经成功执行过
        Result&lt;T&gt; cached = idempotencyChecker.getResult(idempotentKey);
        if (cached != null) {
            log.info("检测到幂等返回: key={}", idempotentKey);
            return cached.getValue();
        }

        return retryTemplate.execute(context -> {
            // 检查是否本次重试中已成功
            Result&lt;T&gt; current = idempotencyChecker.getResult(idempotentKey);
            if (current != null && current.isSuccess()) {
                return current.getValue();
            }

            // 执行操作
            T result = action.call();

            // 保存结果
            idempotencyChecker.saveResult(idempotentKey, Result.success(result));

            return result;
        });
    }
}
```

### 典型场景：支付幂等重试

```java
@Service
public class IdempotentPaymentService {

    private final PaymentGateway paymentGateway;
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;

    /**
     * 幂等支付接口
     * @param orderId 订单 ID（作为幂等键）
     * @param paymentRequest 支付请求
     */
    public PaymentResult pay(Long orderId, PaymentRequest paymentRequest) {
        String idempotentKey = "payment:" + orderId;

        // 1. 检查是否已支付
        PaymentResult cached = redisTemplate.opsForValue().get(idempotentKey);
        if (cached != null) {
            log.info("幂等返回: orderId={}, status={}",
                orderId, cached.getStatus());
            return cached;
        }

        // 2. 使用分布式锁，防止并发扣款
        String lockKey = "lock:payment:" + orderId;
        Boolean locked = redisTemplate.opsForValue()
            .setIfAbsent(lockKey, "1", 30, TimeUnit.SECONDS);

        if (!Boolean.TRUE.equals(locked)) {
            throw new PaymentInProgressException("支付正在进行中");
        }

        try {
            // 3. 执行支付
            PaymentResult result = paymentGateway.process(paymentRequest);

            // 4. 写入结果（带过期时间）
            redisTemplate.opsForValue().set(idempotentKey, result,
                24, TimeUnit.HOURS);

            return result;
        } finally {
            redisTemplate.delete(lockKey);
        }
    }
}
```

## 重试的最佳实践

### 1. 重试要有上限

```java
// 错误：无限重试
while (true) {
    try {
        return action.call();
    } catch (Exception e) {
        // 永不休止...
    }
}

// 正确：设置上限
@Retryable(maxAttempts = 3)
public Result action() { ... }
```

### 2. 只重试可恢复的异常

```java
@Retryable(
    value = {
        IOException.class,           // 网络问题
        TimeoutException.class,     // 超时
        ServiceUnavailableException.class  // 服务暂时不可用
    },
    exclude = {
        BusinessException.class,    // 业务异常不重试
        IllegalArgumentException.class  // 参数异常不重试
    }
)
public Result doAction() { ... }
```

### 3. 重试要有熔断保护

```java
@CircuitBreaker(name = "paymentService", fallbackMethod = "fallback")
@Retryable(maxAttempts = 3)
public PaymentResult pay(Order order) {
    return paymentGateway.process(order);
}

public PaymentResult fallback(Order order, Exception e) {
    log.error("支付服务熔断: {}", e.getMessage());
    return PaymentResult.degraded("支付通道繁忙，请稍后重试");
}
```

### 4. 重试要有监控

```java
@Retryable(
    value = Exception.class,
    maxAttempts = 3,
    listeners = {"retryListener"}
)
public Result doAction() { ... }

// 监听器
@Component
class RetryListener {

    @RetryableEndpoint
    public void onSuccess(RetryContext context) {
        metrics.increment("retry.success");
        if (context.getRetryCount() > 0) {
            log.info("重试成功: attempt={}",
                context.getRetryCount());
        }
    }

    @RetryInterceptor
    public void onError(RetryContext context, Throwable throwable) {
        metrics.increment("retry.error");
        log.warn("重试失败: attempt={}, error={}",
            context.getRetryCount(), throwable.getMessage());
    }
}
```

### 5. 重试要有合理的超时

```java
@Retryable(
    maxAttempts = 3,
    timeout = 5000  // 总超时 5 秒
)
public Result doAction() { ... }
```

### 6. 重试要考虑资源消耗

```java
// 错误：重试时创建新连接
for (int i = 0; i &lt; maxRetries; i++) {
    HttpClient client = new HttpClient();  // 每次重试都创建新连接
    client.post(url, data);
}

// 正确：复用连接
HttpClient client = new HttpClient();  // 创建一次
for (int i = 0; i &lt; maxRetries; i++) {
    client.post(url, data);  // 复用连接
}
```

---

**思考题：**

1. 假设你的系统需要调用外部支付接口，这个接口不保证幂等。你如何在重试机制下保证不重复扣款？

2. 指数退避的重试间隔，如果设置得太长（比如 1 分钟），用户会怎么想？如果设置得太短（比如 100 毫秒），会有什么后果？

3. 为什么重试要加随机抖动？如果不加抖动，多个客户端同时失败后同时重试，会发生什么「惊群效应」？

4. 重试次数设置多少合适？3 次？5 次？还是根据服务类型动态调整？各有什么优缺点？
