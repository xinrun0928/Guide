# allOf 聚合多路查询结果并处理异常

一个商品详情页需要多少数据？

商品信息 + 用户信息 + 库存信息 + 评价信息 + 推荐信息 + 活动信息......

每个接口耗时 50-200ms 不等。

串行调用？600ms 起步。

并行调用 + allOf？max(50, 100, 80, 60, 200, 150) = 200ms。

差距 3 倍。

---

## 场景：聚合商品详情页

### 数据依赖分析

```
商品详情页数据：
├── 商品基本信息（无依赖）
├── 商品价格（无依赖）
├── 库存信息（无依赖）
├── 用户评价列表（无依赖）
├── 相似商品推荐（无依赖）
└── 促销活动信息（无依赖）

结论：所有数据源相互独立，可以完全并行查询！
```

---

## 基础实现：allOf 批量查询

```java
public CompletableFuture<ProductDetail> getProductDetail(String productId) {
    // 并行发起所有查询
    CompletableFuture<Product> productFuture = CompletableFuture
        .supplyAsync(() -> productService.getProduct(productId));
    
    CompletableFuture<Price> priceFuture = CompletableFuture
        .supplyAsync(() -> priceService.getPrice(productId));
    
    CompletableFuture<Stock> stockFuture = CompletableFuture
        .supplyAsync(() -> stockService.getStock(productId));
    
    CompletableFuture<List<Review>> reviewsFuture = CompletableFuture
        .supplyAsync(() -> reviewService.getReviews(productId));
    
    CompletableFuture<List<Product>> similarFuture = CompletableFuture
        .supplyAsync(() -> recommendService.getSimilar(productId));
    
    CompletableFuture<Promotion> promotionFuture = CompletableFuture
        .supplyAsync(() -> promotionService.getPromotion(productId));
    
    // 等待所有查询完成
    return CompletableFuture.allOf(
            productFuture, priceFuture, stockFuture,
            reviewsFuture, similarFuture, promotionFuture
        )
        .thenApply(v -> {
            // 所有查询都完成，组装结果
            return new ProductDetail(
                productFuture.join(),
                priceFuture.join(),
                stockFuture.join(),
                reviewsFuture.join(),
                similarFuture.join(),
                promotionFuture.join()
            );
        });
}
```

### 问题：allOf 不感知异常

如果某个查询失败，`allOf` 仍然会「完成」，但后续 `join()` 会抛出异常！

```java
CompletableFuture.allOf(goodFuture, badFuture)
    .thenApply(v -> {
        // badFuture.join() 会抛出 CompletionException！
        return badFuture.join();
    });
```

---

## 正确处理：异常感知

### 方法一：检查每个 CF 的状态

```java
public CompletableFuture<ProductDetail> getProductDetailSafe(String productId) {
    CompletableFuture<Product> productFuture = ...
    CompletableFuture<Price> priceFuture = ...
    CompletableFuture<Stock> stockFuture = ...
    
    return CompletableFuture.allOf(productFuture, priceFuture, stockFuture)
        .thenApply(v -> {
            // 手动检查每个 CF 的状态
            Product product = productFuture.isCompletedExceptionally() 
                ? Product.EMPTY 
                : productFuture.join();
            
            Price price = priceFuture.isCompletedExceptionally()
                ? Price.DEFAULT 
                : priceFuture.join();
            
            Stock stock = stockFuture.isCompletedExceptionally()
                ? Stock.UNKNOWN
                : stockFuture.join();
            
            return new ProductDetail(product, price, stock);
        });
}
```

### 方法二：为每个 CF 添加异常处理

```java
public CompletableFuture<ProductDetail> getProductDetailWithFallback(String productId) {
    CompletableFuture<Product> productFuture = CompletableFuture
        .supplyAsync(() -> productService.getProduct(productId))
        .exceptionally(ex -> {
            log.warn("商品查询失败", ex);
            return Product.EMPTY;
        });
    
    CompletableFuture<Price> priceFuture = CompletableFuture
        .supplyAsync(() -> priceService.getPrice(productId))
        .exceptionally(ex -> {
            log.warn("价格查询失败", ex);
            return Price.DEFAULT;  // 返回默认价格
        });
    
    // 全部返回默认值，不会失败
    return CompletableFuture.allOf(productFuture, priceFuture, ...)
        .thenApply(v -> new ProductDetail(
            productFuture.join(),
            priceFuture.join(),
            ...
        ));
}
```

### 方法三：收集所有结果和异常

```java
public CompletableFuture<ProductDetail> getProductDetailComplete(String productId) {
    // 记录开始时间
    long startTime = System.currentTimeMillis();
    
    // 创建查询
    CompletableFuture<Product> productFuture = queryProduct(productId);
    CompletableFuture<Price> priceFuture = queryPrice(productId);
    CompletableFuture<Stock> stockFuture = queryStock(productId);
    
    List<CompletableFuture<?>> allFutures = Arrays.asList(
        productFuture, priceFuture, stockFuture
    );
    
    return CompletableFuture.allOf(allFutures.toArray(new CompletableFuture[0]))
        .handle((v, ex) -> {
            // 统计结果
            List<String> errors = new ArrayList<>();
            Map<String, Object> results = new HashMap<>();
            
            if (productFuture.isCompletedExceptionally()) {
                errors.add("商品: " + getError(productFuture));
            } else {
                results.put("product", productFuture.join());
            }
            
            if (priceFuture.isCompletedExceptionally()) {
                errors.add("价格: " + getError(priceFuture));
            } else {
                results.put("price", priceFuture.join());
            }
            
            if (stockFuture.isCompletedExceptionally()) {
                errors.add("库存: " + getError(stockFuture));
            } else {
                results.put("stock", stockFuture.join());
            }
            
            // 记录日志
            if (!errors.isEmpty()) {
                log.warn("部分查询失败: {}", errors);
                metrics.increment("product.detail.partial.failure");
            }
            
            // 记录耗时
            long duration = System.currentTimeMillis() - startTime;
            metrics.record("product.detail.duration", duration);
            
            return new ProductDetail(results, errors, duration);
        });
}

private String getError(CompletableFuture<?> future) {
    try {
        return future.exceptionally(ex -> ex).join().getMessage();
    } catch (Exception e) {
        return "unknown";
    }
}
```

---

## 实用封装：批量查询工具

```java
public class BatchQuery {
    
    @SafeVarargs
    public static <T> CompletableFuture<List<T>> allOf(
            CompletableFuture<T>... futures) {
        
        CompletableFuture<Void> allDone = CompletableFuture.allOf(futures);
        
        return allDone.thenApply(v -> 
            Arrays.stream(futures)
                .map(CompletableFuture::join)
                .collect(Collectors.toList())
        );
    }
    
    @SafeVarargs
    public static <T> CompletableFuture<List<T>> allOfWithFallback(
            Supplier<CompletableFuture<T>>... suppliers) {
        
        // 为每个 supplier 添加异常处理
        CompletableFuture<T>[] handled = Arrays.stream(suppliers)
            .map(s -> s.get().exceptionally(ex -> null))
            .toArray(CompletableFuture[]::new);
        
        return allOf(handled);
    }
    
    public static <T> CompletableFuture<List<T>> allOfWithDefault(
            List<Supplier<CompletableFuture<T>>> suppliers,
            T defaultValue) {
        
        CompletableFuture<T>[] handled = suppliers.stream()
            .map(s -> s.get().exceptionally(ex -> defaultValue))
            .toArray(CompletableFuture[]::new);
        
        return allOf(handled);
    }
}

// 使用
BatchQuery.allOfWithFallback(
    () -> queryProduct(id),
    () -> queryPrice(id),
    () -> queryStock(id)
).thenApply(list -> new ProductDetail(list.get(0), list.get(1), list.get(2)));
```

---

## 实战：带超时的批量查询

```java
public CompletableFuture<ProductDetail> getProductDetailWithTimeout(String productId) {
    // 每个查询都带超时
    CompletableFuture<Product> productFuture = CompletableFuture
        .supplyAsync(() -> productService.getProduct(productId))
        .orTimeout(2, TimeUnit.SECONDS)
        .exceptionally(ex -> {
            log.warn("商品查询超时");
            return Product.EMPTY;
        });
    
    CompletableFuture<Price> priceFuture = CompletableFuture
        .supplyAsync(() -> priceService.getPrice(productId))
        .orTimeout(1, TimeUnit.SECONDS)  // 价格查询超时更短
        .exceptionally(ex -> {
            log.warn("价格查询超时");
            return Price.DEFAULT;
        });
    
    // 整体超时
    return CompletableFuture.allOf(productFuture, priceFuture, ...)
        .orTimeout(3, TimeUnit.SECONDS)
        .thenApply(v -> new ProductDetail(...))
        .exceptionally(ex -> {
            log.error("详情页查询整体超时或失败");
            throw new ServiceException("商品详情加载失败");
        });
}
```

---

## 性能优化建议

### 1. 控制并发数

```java
// 如果有 100 个商品要查，不要同时发起 100 个请求
Semaphore semaphore = new Semaphore(20);  // 最多 20 个并发

List<CompletableFuture<Product>> futures = productIds.stream()
    .map(id -> CompletableFuture.supplyAsync(() -> {
        semaphore.acquire();
        try {
            return productService.getProduct(id);
        } finally {
            semaphore.release();
        }
    }))
    .collect(Collectors.toList());
```

### 2. 使用 CompletableFuture 的线程池隔离

```java
ExecutorService productExecutor = new ThreadPoolExecutor(10, 20, ...);
ExecutorService priceExecutor = new ThreadPoolExecutor(5, 10, ...);

// 不同类型的服务使用不同线程池
CompletableFuture<Product> pf = supplyAsync(() -> getProduct(), productExecutor);
CompletableFuture<Price> priceF = supplyAsync(() -> getPrice(), priceExecutor);
```

---

## 面试追问方向

**Q1：allOf 如果有 100 个 CF，任何一个失败会怎样？**

`allOf` 本身会正常完成（返回 `CF<Void>`），但后续 `join()` 获取任意一个失败 CF 的结果时，会抛出 `CompletionException`。你需要为每个 CF 添加 `exceptionally` 处理，或者在聚合时检查 `isCompletedExceptionally()`。

**Q2：如何实现 allOf 但跳过失败的 CF？**

```java
CompletableFuture.allOf(cf1, cf2, cf3)
    .thenApply(v -> 
        Stream.of(cf1, cf2, cf3)
            .filter(cf -> !cf.isCompletedExceptionally())
            .map(CompletableFuture::join)
            .collect(Collectors.toList())
    );
```

**Q3：allOf 和 whenComplete 有什么区别？**

`allOf` 是**静态方法**，用于等待多个 CF 完成。`whenComplete` 是**实例方法**，用于注册回调。`allOf` 返回 `CF<Void>`，`whenComplete` 返回同类型的 `CF<T>`。
