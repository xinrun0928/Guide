# thenCombine / thenAcceptBoth：合并两个 CompletableFuture

你有没有遇到过这种场景：

> 「这个接口需要同时调用用户服务、商品服务、库存服务，等它们都返回后，再组装数据。」

单个 CF 的链式调用你已经会了。现在来看看：**如何组合两个甚至多个 CF**。

---

## thenCombine：合并两个 CF 的结果

`thenCombine` 用于将**两个独立的 CF 结果**合并成一个新值。

```java
public <U, V> CompletableFuture<V> thenCombine(
    CompletableFuture<? extends U> other,
    BiFunction<? super T, ? super U, ? extends V> fn
)
```

### 图示

```
        CF1<T> ─────┐
                   │
                   ├──► BiFunction(T, U) → V ──► CF3<V>
                   │
        CF2<U> ─────┘
        
两个 CF 并行执行，完成后合并结果
```

### 示例：组装用户订单页

```java
CompletableFuture<User> userFuture = CompletableFuture.supplyAsync(() -> getUser());
CompletableFuture<List<Order>> ordersFuture = CompletableFuture.supplyAsync(() -> getOrders());

// 两个都完成后，组装数据
CompletableFuture<UserOrderPage> pageFuture = userFuture.thenCombine(
    ordersFuture,
    (user, orders) -> new UserOrderPage(user, orders)
);

// 获取最终结果
UserOrderPage page = pageFuture.join();
```

---

## thenAcceptBoth：合并但不产生新值

如果你只需要**使用**两个结果，不需要产生新值，用 `thenAcceptBoth`。

```java
public <U> CompletableFuture<Void> thenAcceptBoth(
    CompletableFuture<? extends U> other,
    BiConsumer<? super T, ? super U> action
)
```

```java
userFuture.thenAcceptBoth(ordersFuture, (user, orders) -> {
    // 只是打印，不返回新值
    System.out.println("用户：" + user.getName());
    System.out.println("订单数：" + orders.size());
});  // 返回 CompletableFuture<Void>
```

### thenCombine vs thenAcceptBoth

| 方法 | 返回值 | 适用场景 |
|-----|--------|---------|
| `thenCombine` | `CF<V>` | 需要根据两个结果计算新值 |
| `thenAcceptBoth` | `CF<Void>` | 只是使用两个结果，不产生新值 |

---

## runAfterBoth：两者都完成后执行

如果你**连结果都不关心**，只关心两个都完成了：

```java
public CompletableFuture<Void> runAfterBoth(
    CompletableFuture<?> other,
    Runnable action
)
```

```java
userFuture.runAfterBoth(ordersFuture, () -> {
    // 两个都完成后执行清理操作
    clearCache();
});
```

---

## 合并多个 CF

### 三个 CF 的合并

```java
CompletableFuture<User> userFuture = getUser();
CompletableFuture<List<Product>> productsFuture = getProducts();
CompletableFuture<Recommend> recommendFuture = getRecommend();

// 方式一：链式 thenCombine
CompletableFuture<String> result = userFuture
    .thenCombine(productsFuture, (user, products) -> mergeUserAndProducts(user, products))
    .thenCombine(recommendFuture, (merged, recommend) -> finalMerge(merged, recommend));

// 方式二：一次性合并（如果合并逻辑相同）
CompletableFuture.allOf(userFuture, productsFuture, recommendFuture)
    .thenAccept(v -> {
        // 手动获取各结果
        User user = userFuture.join();
        List<Product> products = productsFuture.join();
        Recommend recommend = recommendFuture.join();
        // 处理
    });
```

### 多个 CF 的通用合并模式

```java
public <T> CompletableFuture<List<T>> allResults(List<CompletableFuture<T>> cfs) {
    CompletableFuture<Object[]> all = CompletableFuture.allOf(
        cfs.toArray(new CompletableFuture[0])
    );
    
    return all.thenApply(v -> 
        cfs.stream()
            .map(CompletableFuture::join)
            .collect(Collectors.toList())
    );
}
```

---

## 实战：聚合多维度数据

```java
public class DataAggregationDemo {
    
    // 用户服务
    CompletableFuture<User> getUser(String userId) {
        return CompletableFuture.supplyAsync(() -> userService.findById(userId));
    }
    
    // 商品服务
    CompletableFuture<List<Product>> getProducts(List<String> productIds) {
        return CompletableFuture.supplyAsync(() -> productService.findByIds(productIds));
    }
    
    // 库存服务
    CompletableFuture<Map<String, Integer>> getStocks(List<String> productIds) {
        return CompletableFuture.supplyAsync(() -> inventoryService.getStocks(productIds));
    }
    
    // 聚合接口
    public CompletableFuture<ProductDetail> getProductDetail(String userId, List<String> productIds) {
        CompletableFuture<User> userFuture = getUser(userId);
        CompletableFuture<List<Product>> productsFuture = getProducts(productIds);
        CompletableFuture<Map<String, Integer>> stocksFuture = getStocks(productIds);
        
        // 三路并行获取，最后聚合
        return userFuture.thenCombine(productsFuture, User::withProducts)
            .thenCombine(stocksFuture, ProductDetail::withStocks);
    }
}

class User {
    String id;
    String name;
    List<Product> products;
    
    User withProducts(List<Product> products) {
        this.products = products;
        return this;
    }
}

class ProductDetail extends User {
    Map<String, Integer> stocks;
    
    ProductDetail withStocks(Map<String, Integer> stocks) {
        this.stocks = stocks;
        return this;
    }
}
```

---

## allOf + join：批量等待

`thenCombine` 只适合两个 CF。对于多个 CF，用 `allOf` 更优雅。

```java
CompletableFuture<Void> allDone = CompletableFuture.allOf(cf1, cf2, cf3, cf4);

allDone.thenRun(() -> {
    // 所有 CF 都完成了
    Result1 r1 = cf1.join();
    Result2 r2 = cf2.join();
    Result3 r3 = cf3.join();
    Result4 r4 = cf4.join();
});
```

### 注意事项

```java
// allOf 不会传递结果，返回 CompletableFuture<Void>
// 即使某个 CF 异常完成，allOf 也会「完成」

CompletableFuture.allOf(cf1, cf2, cf3)
    .thenRun(() -> {
        // 这里可能会抛出异常！
        Result r1 = cf1.join();
        Result r2 = cf2.join();  // 可能是异常结果
    });

// 正确做法：手动处理每个 CF
CompletableFuture.allOf(cf1, cf2, cf3)
    .thenRun(() -> {
        cf1.join();  // 如果失败会抛出异常
        
        // 更好的方式
        if (cf1.isCompletedExceptionally()) {
            // 处理异常
        } else {
            // 正常使用
        }
    });
```

---

## 性能分析

### 串行 vs 并行

```
串行（thenCompose）：
CF1 ──► CF2 ──► CF3
时间：T1 + T2 + T3


并行（thenCombine）：
CF1 ──┐
CF2 ──┼──► 合并
CF3 ──┘
时间：max(T1, T2, T3)
```

### 选择原则

| 场景 | 方法 | 原因 |
|-----|------|------|
| B 依赖 A 的结果 | `thenCompose` | 必须串行 |
| A 和 B 独立执行 | `thenCombine` / `allOf` | 可以并行 |
| N 个任务并行（N>2） | `allOf` | 更简洁 |

---

## 面试追问方向

**Q1：thenCombine 是阻塞等待 other CF 吗？**

不是阻塞。`thenCombine` 会**异步等待**——当前 CF 和 other CF 并行执行，都完成后才触发合并逻辑。如果当前 CF 先完成，会等待 other CF；如果 other CF 先完成，也会等待当前 CF。

**Q2：allOf 如果有一个 CF 异常了，会怎样？**

`allOf` 本身不会感知异常，它只关心「是否完成」。即使某个 CF 异常了，`allOf` 返回的 `CF<Void>` 仍然会标记为完成。但在后续通过 `join()` 获取结果时，异常会被重新抛出。

**Q3：如何实现 allOf 并获取第一个成功的结果？**

用 `anyOf`：`CompletableFuture.anyOf(cf1, cf2, cf3).join()` 会返回第一个完成的结果，不管成功还是失败。如果需要第一个**成功**的结果，需要自己处理：

```java
CompletableFuture<Object> firstSuccess = CompletableFuture.anyOf(cf1, cf2, cf3);
firstSuccess.thenApply(v -> v).exceptionally(ex -> null);
```
