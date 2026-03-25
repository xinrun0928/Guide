# 多服务并行调用：thenCompose 链式编排实战

电商系统里，一个下单请求要经过多少服务？

用户服务 → 商品服务 → 库存服务 → 订单服务 → 支付服务 → 物流服务......

每个服务耗时 100ms，如果串行调用：6 × 100ms = 600ms。

如果能并行调用：max(100ms) = 100ms。

差距 6 倍。

---

## 场景分析

### 依赖关系图

```
下单流程依赖：
┌─────────┐
│  验证   │  ──► 无依赖
│  用户   │  ──► 无依赖
│  商品   │  ──► 无依赖
│  库存   │  ──► 依赖商品
│  订单   │  ──► 依赖用户+商品+库存
│  支付   │  ──► 依赖订单
│  物流   │  ──► 依赖订单+支付
```

### 可优化的点

1. **完全独立的服务可以并行**：验证、用户、商品
2. **依赖上游结果的服务必须串行**：库存→商品，订单→用户+商品+库存

---

## 错误示例：串行调用

```java
public OrderResult placeOrder(OrderRequest request) {
    // 串行调用：每个服务都等上一个完成才开始
    User user = userService.validate(request.getToken());        // 100ms
    Product product = productService.get(request.getProductId()); // 100ms
    Stock stock = stockService.check(product.getId());           // 100ms
    Order order = orderService.create(user, product, stock);     // 100ms
    Payment payment = paymentService.pay(order);                 // 100ms
    Logistics logistics = logisticsService.schedule(payment);    // 100ms
    
    return new OrderResult(order, payment, logistics);  // 总计 600ms
}
```

---

## 优化一：基础并行 + thenCompose 依赖链

```java
public CompletableFuture<OrderResult> placeOrderAsync(OrderRequest request) {
    // 第一波：完全独立的服务，并行执行
    CompletableFuture<User> userFuture = CompletableFuture
        .supplyAsync(() -> userService.validate(request.getToken()));
    
    CompletableFuture<Product> productFuture = CompletableFuture
        .supplyAsync(() -> productService.get(request.getProductId()));
    
    // 商品查询完成后，才能查库存
    CompletableFuture<Stock> stockFuture = productFuture
        .thenApply(product -> stockService.check(product.getId()));
    
    // 合并用户、商品、库存结果，创建订单
    CompletableFuture<Order> orderFuture = userFuture
        .thenCombine(productFuture, (user, product) -> new UserProduct(user, product))
        .thenCombine(stockFuture, (up, stock) -> {
            if (!stock.isAvailable()) {
                throw new InsufficientStockException("库存不足");
            }
            return new OrderContext(up.getUser(), up.getProduct(), stock);
        })
        .thenCompose(ctx -> 
            CompletableFuture.supplyAsync(() -> orderService.create(ctx))
        );
    
    // 订单完成后，并行执行支付和物流准备
    CompletableFuture<Payment> paymentFuture = orderFuture
        .thenCompose(order -> 
            CompletableFuture.supplyAsync(() -> paymentService.pay(order))
        );
    
    CompletableFuture<Logistics> logisticsFuture = orderFuture
        .thenCompose(order ->
            CompletableFuture.supplyAsync(() -> logisticsService.prepare(order))
        );
    
    // 支付完成后，安排物流
    return paymentFuture
        .thenCombine(logisticsFuture, Payment::withLogistics)
        .thenApply(payment -> new OrderResult(
            orderFuture.join(),  // 获取订单结果
            payment,
            payment.getLogistics()
        ));
}
```

### 性能分析

```
并行优化后的时间线：
├─────────────────────────────────────────────────────┤
│ 0ms ──────────────────────────────────────────────► 600ms
│
│ 验证 ─────────────────────────────────────────────► 100ms
│ 用户 ─────────────────────────────────────────────► 100ms
│ 商品 ─────────────► 库存 ──► 订单 ──► 支付 ──► 物流 ► 500ms
│                                            ↑    ↑
│                                            合并  合并
│
│ 实际总耗时：max(100, 100, 100+100+100+100+100) = 500ms
│ 节省：100ms (约 17%)
```

---

## 优化二：thenCompose 链式调用

```java
public CompletableFuture<OrderResult> placeOrderChain(OrderRequest request) {
    // 核心链式调用：每一步的结果直接传给下一步
    return CompletableFuture
        // 1. 验证用户（无依赖）
        .supplyAsync(() -> userService.validate(request.getToken()))
        
        // 2. 并行查询商品
        .thenCompose(user -> CompletableFuture
            .supplyAsync(() -> productService.get(request.getProductId()))
            .thenApply(product -> new UserProductContext(user, product))
        )
        
        // 3. 查询库存（依赖商品）
        .thenCompose(ctx -> CompletableFuture
            .supplyAsync(() -> stockService.check(ctx.product.getId()))
            .thenApply(stock -> ctx.withStock(stock))
        )
        
        // 4. 验证库存
        .thenCompose(ctx -> {
            if (!ctx.stock.isAvailable()) {
                return CompletableFuture.failedFuture(
                    new InsufficientStockException("库存不足"));
            }
            return CompletableFuture.completedFuture(ctx);
        })
        
        // 5. 创建订单（依赖用户+商品+库存）
        .thenCompose(ctx -> CompletableFuture
            .supplyAsync(() -> orderService.create(ctx.user, ctx.product, ctx.stock))
        )
        
        // 6. 支付（依赖订单）
        .thenCompose(order -> CompletableFuture
            .supplyAsync(() -> paymentService.pay(order))
        )
        
        // 7. 物流（依赖支付）
        .thenCompose(payment -> CompletableFuture
            .supplyAsync(() -> logisticsService.schedule(payment))
        )
        
        // 8. 最终组装
        .thenApply(logistics -> {
            Order order = ...;  // 从上下文获取
            Payment payment = ...;
            return new OrderResult(order, payment, logistics);
        });
}
```

---

## 错误处理贯穿整个链路

### 局部降级

```java
public CompletableFuture<OrderResult> placeOrderWithFallback(OrderRequest request) {
    return CompletableFuture
        .supplyAsync(() -> userService.validate(request.getToken()))
        
        // 用户服务降级
        .exceptionallyCompose(ex -> {
            log.warn("用户服务失败，使用默认用户", ex);
            return CompletableFuture.completedFuture(User.guest());
        })
        
        .thenCompose(user -> CompletableFuture
            .supplyAsync(() -> productService.get(request.getProductId()))
            
            // 商品服务降级
            .exceptionallyCompose(ex -> {
                log.warn("商品服务失败，使用默认商品", ex);
                return CompletableFuture.completedFuture(Product.defaultProduct());
            })
            .thenApply(product -> new UserProductContext(user, product))
        )
        
        .thenCompose(ctx -> CompletableFuture
            .supplyAsync(() -> stockService.check(ctx.product.getId()))
            
            // 库存不足返回特定异常
            .handle((stock, ex) -> {
                if (ex != null || !stock.isAvailable()) {
                    // 库存不足，不降级，直接失败
                    throw new InsufficientStockException("商品库存不足");
                }
                return stock;
            })
            
            // 继续处理
            .thenApply(stock -> ctx.withStock(stock))
        )
        
        // ... 其余步骤
        ;
}
```

### 整体超时控制

```java
public CompletableFuture<OrderResult> placeOrderWithTimeout(OrderRequest request) {
    return placeOrderChain(request)
        // 整体超时 5 秒
        .orTimeout(5, TimeUnit.SECONDS)
        
        // 超时或异常的最终处理
        .exceptionally(ex -> {
            if (ex instanceof TimeoutException) {
                throw new OrderException("下单超时，请稍后重试");
            }
            throw new OrderException("下单失败：" + ex.getMessage());
        });
}
```

---

## 性能对比

### 串行 vs 并行

| 调用方式 | 总耗时 | 吞吐量 | CPU 利用率 |
|---------|--------|--------|-----------|
| 串行 | 600ms | 低 | 低（大量等待） |
| 基础并行 | 500ms | 中 | 中 |
| 优化并行 | 300ms | 高 | 高 |

### 性能瓶颈分析

```java
// 如果某个服务耗时特别长，会成为瓶颈
CompletableFuture<Product> productFuture = CompletableFuture
    .supplyAsync(() -> productService.get(request.getProductId()));  // 500ms！
// 整个流程被拖慢 400ms
```

**优化策略**：

1. 识别耗时最长的服务
2. 为耗时服务添加缓存
3. 考虑服务拆分
4. 使用异步客户端

---

## 完整代码模板

```java
public CompletableFuture<OrderResult> placeOrderComplete(OrderRequest request) {
    long startTime = System.currentTimeMillis();
    
    ExecutorService executor = Executors.newFixedThreadPool(10);
    
    try {
        // 阶段一：并行查询基础信息
        CompletableFuture<User> userFuture = CompletableFuture
            .supplyAsync(() -> userService.validate(request.getToken()), executor)
            .exceptionallyCompose(ex -> {
                log.warn("用户服务降级");
                return CompletableFuture.completedFuture(User.guest());
            });
        
        CompletableFuture<Product> productFuture = CompletableFuture
            .supplyAsync(() -> productService.get(request.getProductId()), executor);
        
        CompletableFuture<Void> metricsFuture = CompletableFuture
            .runAsync(() -> metrics.increment("order.query"), executor);
        
        // 阶段二：查询库存（依赖商品）
        CompletableFuture<Stock> stockFuture = productFuture
            .thenApplyAsync(product -> stockService.check(product.getId()), executor);
        
        // 阶段三：创建订单（合并用户、商品、库存）
        CompletableFuture<Order> orderFuture = CompletableFuture
            .allOf(userFuture, productFuture, stockFuture)
            .thenCompose(v -> {
                User user = userFuture.join();
                Product product = productFuture.join();
                Stock stock = stockFuture.join();
                
                return CompletableFuture
                    .supplyAsync(() -> orderService.create(user, product, stock), executor);
            });
        
        // 阶段四：并行支付和物流
        CompletableFuture<Payment> paymentFuture = orderFuture
            .thenComposeAsync(order -> 
                CompletableFuture.supplyAsync(() -> paymentService.pay(order), executor),
                executor
            );
        
        CompletableFuture<Logistics> logisticsFuture = orderFuture
            .thenComposeAsync(order ->
                CompletableFuture.supplyAsync(() -> logisticsService.schedule(order), executor),
                executor
            );
        
        // 阶段五：合并结果
        return paymentFuture
            .thenCombine(logisticsFuture, Payment::withLogistics)
            .thenApply(payment -> new OrderResult(
                orderFuture.join(),
                payment,
                payment.getLogistics()
            ))
            .whenComplete((result, ex) -> {
                long duration = System.currentTimeMillis() - startTime;
                metrics.record("order.duration", duration);
                log.info("下单完成，耗时：{}ms", duration);
            })
            .orTimeout(5, TimeUnit.SECONDS)
            .exceptionally(ex -> {
                log.error("下单失败", ex);
                throw new OrderException("下单失败，请稍后重试");
            });
    } finally {
        executor.shutdown();
    }
}
```

---

## 面试追问方向

**Q1：thenCompose 和 thenApply 嵌套有什么区别？**

`thenApply` 嵌套会得到 `CompletableFuture<CompletableFuture<U>>`，需要两次 `join()` 才能获取结果。`thenCompose` 自动展开，返回 `CompletableFuture<U>`。但如果你需要「等待两个异步操作都完成后再继续」，可以用 `thenApply` 嵌套结合 `CompletableFuture.allOf()`。

**Q2：多个服务并行调用时，如何处理部分失败？**

使用 `exceptionally` 或 `handle` 为每个 CF 单独处理异常，不要让一个服务的失败影响整个流程。或者使用 `allOf` 等待所有完成，然后检查每个 CF 的 `isCompletedExceptionally()` 状态。

**Q3：如何实现「任意一个服务失败就整体失败」？**

使用 `exceptionallyCompose` 在第一个异常处直接返回 `failedFuture`，后续的 `thenCompose` 就不会执行。这比用 `allOf` 然后检查每个 CF 更简洁。
