# anyOf 实现超时降级与快速失败

你有没有遇到过这种情况：

> 一个接口依赖 5 个下游服务，最慢的那个拖了整个接口的后腿。
>
> 3 秒能返回，却让用户等了 10 秒。

这是超时设计不当的典型问题。

这一节，聊聊如何使用 `anyOf` 和相关机制实现**超时降级**和**快速失败**。

---

## 超时处理的重要性

```
响应时间分布（假设 5 个服务串行）：
├─────────────────────────────────────────────────┤
│ 服务A │ 服务B │ 服务C │ 服务D │ 服务E │
│ 50ms  │ 100ms │ 200ms │ 500ms │ 3000ms │
├─────────────────────────────────────────────────┤
│           总耗时 = 3850ms                        │
└─────────────────────────────────────────────────┘

优化后（设置超时）：
├─────────────────────────────────────────────────┤
│ 服务A │ 服务B │ 服务C │ 服务D │ 服务E │  超时兜底 │
│ 50ms  │ 100ms │ 200ms │ 500ms │ 3000ms │  500ms  │
├─────────────────────────────────────────────────┤
│           总耗时 = max(50,100,200,500,3000,500) = 3000ms  │
│           如果都超时 = 500ms                      │
└─────────────────────────────────────────────────┘
```

---

## JDK 9+：orTimeout 简洁超时

```java
// JDK 9+ 简洁的超时设置
CompletableFuture.supplyAsync(() -> slowService.call())
    .orTimeout(3, TimeUnit.SECONDS)  // 3 秒超时
    .thenAccept(result -> System.out.println("结果：" + result))
    .exceptionally(ex -> {
        System.err.println("超时或异常：" + ex.getMessage());
        return null;
    });
```

### completeOnTimeout：超时返回默认值

```java
CompletableFuture.supplyAsync(() -> slowQuery())
    .completeOnTimeout("默认值", 3, TimeUnit.SECONDS)  // 超时返回默认值
    .thenAccept(System.out::println);  // 3 秒后输出：默认值
```

---

## JDK 8 兼容：anyOf 实现超时

JDK 8 没有 `orTimeout`，需要自己实现：

```java
public <T> CompletableFuture<T> withTimeout(
        CompletableFuture<T> future,
        long timeout, 
        TimeUnit unit,
        T defaultValue) {
    
    final CompletableFuture<T> timeoutFuture = new CompletableFuture<>();
    
    // 定时器线程
    ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
    scheduler.schedule(() -> {
        // 如果原 Future 还没完成，注入默认值
        timeoutFuture.complete(defaultValue);
    }, timeout, unit);
    
    // 原 Future 完成后，取消定时器
    return future.applyToEither(timeoutFuture, Function.identity());
}
```

### 使用示例

```java
CompletableFuture<String> resultFuture = withTimeout(
    CompletableFuture.supplyAsync(() -> slowService.call()),
    3, TimeUnit.SECONDS,
    "超时返回默认值"
);

resultFuture.thenAccept(System.out::println);  // 3 秒后输出：超时返回默认值
```

---

## anyOf 实现超时检测

```java
public <T> CompletableFuture<T> withTimeoutAnyOf(
        CompletableFuture<T> future,
        long timeout, 
        TimeUnit unit) {
    
    CompletableFuture<T> timeoutFuture = new CompletableFuture<>();
    
    // 定时器：超时后让 timeoutFuture 完成
    Executors.newSingleThreadScheduledExecutor()
        .schedule(() -> timeoutFuture.completeExceptionally(
            new TimeoutException("操作超时")),
            timeout, unit);
    
    // 谁先完成就用谁的结果
    return future.applyToEither(timeoutFuture, Function.identity());
}
```

### 完整超时包装

```java
public class TimeoutSupport {
    
    public static <T> CompletableFuture<T> withTimeout(
            CompletableFuture<T> cf,
            long timeout,
            TimeUnit unit,
            String taskName) {
        
        return cf.applyToEither(
            CompletableFuture.delayedExecutor(timeout, unit),
            Function.identity()
        ).exceptionally(ex -> {
            throw new TimeoutException(taskName + " 执行超时");
        });
    }
    
    // JDK 9+ 简化版
    public static <T> CompletableFuture<T> withTimeoutOrDefault(
            CompletableFuture<T> cf,
            long timeout,
            TimeUnit unit,
            T defaultValue) {
        
        return cf.orTimeout(timeout, unit)
            .exceptionally(ex -> defaultValue);
    }
}
```

---

## 快速失败模式

### 场景：熔断降级

```java
public CompletableFuture<Data> getDataWithCircuitBreaker(String key) {
    // 检查熔断器状态
    if (circuitBreaker.isOpen()) {
        // 熔断开启，直接返回缓存或默认值
        return CompletableFuture.completedFuture(
            cache.getOrDefault(key, Data.fallback())
        );
    }
    
    CompletableFuture<Data> future = CompletableFuture
        .supplyAsync(() -> primaryService.get(key))
        .orTimeout(2, TimeUnit.SECONDS)
        .exceptionallyCompose(ex -> {
            // 失败计数
            circuitBreaker.recordFailure();
            
            if (circuitBreaker.shouldOpen()) {
                // 熔断器打开
                return CompletableFuture.completedFuture(Data.fallback());
            }
            
            // 尝试备用服务
            return CompletableFuture
                .supplyAsync(() -> backupService.get(key))
                .orTimeout(1, TimeUnit.SECONDS);
        });
    
    return future;
}
```

### 场景：多级降级

```java
public CompletableFuture<UserProfile> getUserProfile(String userId) {
    // 第一级：Redis
    CompletableFuture<UserProfile> redisFuture = CompletableFuture
        .supplyAsync(() -> redisService.getUser(userId))
        .orTimeout(100, TimeUnit.MILLISECONDS);
    
    // 第二级：本地缓存
    CompletableFuture<UserProfile> localFuture = CompletableFuture
        .supplyAsync(() -> localCache.get(userId))
        .orTimeout(50, TimeUnit.MILLISECONDS);
    
    // 第三级：数据库
    CompletableFuture<UserProfile> dbFuture = CompletableFuture
        .supplyAsync(() -> databaseService.getUser(userId))
        .orTimeout(500, TimeUnit.MILLISECONDS);
    
    // 第四级：默认值
    CompletableFuture<UserProfile> defaultFuture = CompletableFuture
        .completedFuture(UserProfile.anonymous(userId));
    
    // 按优先级尝试，任一成功即返回
    return redisFuture
        .fallbackTo(localFuture)
        .fallbackTo(dbFuture)
        .fallbackTo(defaultFuture);
}
```

---

## 综合示例：带超时和降级的查询

```java
public class ResilientQuery {
    
    private final ExecutorService executor;
    private final CircuitBreaker circuitBreaker;
    private final Metrics metrics;
    
    public ResilientQuery() {
        this.executor = Executors.newFixedThreadPool(20);
        this.circuitBreaker = new CircuitBreaker(5, 10000);  // 5 次失败后熔断
        this.metrics = new Metrics();
    }
    
    public CompletableFuture<ProductDetail> getProductDetail(String productId) {
        long startTime = System.currentTimeMillis();
        
        // 1. 并行查询多个数据源
        CompletableFuture<Product> productFuture = queryWithTimeout(
            () -> productService.getProduct(productId),
            "product", 2, TimeUnit.SECONDS, Product.EMPTY);
        
        CompletableFuture<Price> priceFuture = queryWithTimeout(
            () -> priceService.getPrice(productId),
            "price", 1, TimeUnit.SECONDS, Price.DEFAULT);
        
        CompletableFuture<Stock> stockFuture = queryWithTimeout(
            () -> stockService.getStock(productId),
            "stock", 1, TimeUnit.SECONDS, Stock.UNKNOWN);
        
        CompletableFuture<List<Review>> reviewsFuture = queryWithTimeout(
            () -> reviewService.getReviews(productId),
            "reviews", 3, TimeUnit.SECONDS, Collections.emptyList());
        
        // 2. 等待所有完成或超时
        CompletableFuture<ProductDetail> detailFuture = CompletableFuture
            .allOf(productFuture, priceFuture, stockFuture, reviewsFuture)
            .thenApply(v -> new ProductDetail(
                productFuture.join(),
                priceFuture.join(),
                stockFuture.join(),
                reviewsFuture.join()
            ));
        
        // 3. 整体超时控制
        return detailFuture
            .orTimeout(5, TimeUnit.SECONDS)
            .exceptionally(ex -> {
                // 整体超时，返回部分数据
                metrics.increment("product.detail.timeout");
                return ProductDetail.partial(
                    productFuture.join(),
                    priceFuture.join(),
                    stockFuture.join()
                );
            })
            .whenComplete((result, ex) -> {
                long duration = System.currentTimeMillis() - startTime;
                metrics.record("product.detail.latency", duration);
                
                if (ex != null) {
                    metrics.increment("product.detail.failure");
                } else {
                    metrics.increment("product.detail.success");
                }
            });
    }
    
    private <T> CompletableFuture<T> queryWithTimeout(
            Supplier<T> supplier,
            String name,
            long timeout,
            TimeUnit unit,
            T defaultValue) {
        
        return CompletableFuture
            .supplyAsync(supplier, executor)
            .orTimeout(timeout, unit)
            .exceptionally(ex -> {
                log.warn("{} 查询超时，使用默认值", name);
                metrics.increment("query.timeout." + name);
                return defaultValue;
            });
    }
}
```

---

## 面试追问方向

**Q1：orTimeout 和 completeOnTimeout 有什么区别？**

`orTimeout` 超时后会**抛出异常**（CompletionException），触发后续的 `exceptionally` 处理。`completeOnTimeout` 超时后会**注入默认值**，正常继续流程。选择取决于业务需求：严格场景用 `orTimeout`，降级场景用 `completeOnTimeout`。

**Q2：如何实现「N 秒内有 M 次失败就熔断」？**

需要维护一个计数器，记录最近 N 秒内的失败次数。每当失败时增加计数，计数超过阈值时打开熔断器。可以使用滑动窗口（Ring Buffer）实现精确的时间窗口统计。Google Guava 的 `CircuitBreaker` 提供了开箱即用的实现。

**Q3：anyOf 和 applyToEither 有什么区别？**

`anyOf` 是**静态方法**，等待多个 CF 中**任一**完成。`applyToEither` 是**实例方法**，等待当前 CF 和另一个 CF 中**任一**完成。`applyToEither` 实际上是 `anyOf` 的一种简化形式，用于两个 CF 的场景。
