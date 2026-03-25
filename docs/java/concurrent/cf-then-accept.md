# thenAccept / thenRun：消费结果与最终动作

你拿到了异步计算的结果，下一步怎么办？

- 如果需要对结果做点什么 → `thenAccept`
- 如果只关心任务是否完成，不关心结果 → `thenRun`

这两个方法听起来简单，但组合起来能解决大部分「最终处理」的场景。

---

## thenAccept：消费结果

`thenAccept` 是「转换」阶段的最后一环——**只消费，不生产**。

```java
public CompletableFuture<Void> thenAccept(Consumer<? super T> action)
public CompletableFuture<Void> thenAcceptAsync(Consumer<? super T> action)
```

### 与 thenApply 的区别

```java
// thenApply：T → U，返回新的 CF<U>
CompletableFuture<Integer> cf1 = cf.thenApply(x -> x * 2);
// cf1 是 CompletableFuture<Integer>

// thenAccept：T → Void，返回 CF<Void>
CompletableFuture<Void> cf2 = cf.thenAccept(x -> System.out.println(x));
// cf2 是 CompletableFuture<Void>，不返回任何值
```

### 典型用法：结果输出

```java
CompletableFuture.supplyAsync(() -> queryUser())
    .thenApply(User::toDTO)                 // 转换
    .thenAccept(userDTO -> {
        // 消费结果：发送给前端
        response.setContentType("application/json");
        response.getWriter().write(toJson(userDTO));
    });
```

---

## thenRun：不关心结果，只关心完成

`thenRun` 比 `thenAccept` 更「冷漠」——它连上一步的结果都不在乎。

```java
public CompletableFuture<Void> thenRun(Runnable action)
public CompletableFuture<Void> thenRunAsync(Runnable action)
```

### 典型用法：清理/通知

```java
CompletableFuture.supplyAsync(() -> processData())
    .thenRun(() -> {
        // 不关心处理结果，只关心处理完了
        // 比如：关闭加载动画
        hideLoadingSpinner();
    });
```

---

## thenAcceptBoth：合并两个结果

当你需要**两个 CF 都完成后**再处理它们的结果。

```java
public <U> CompletableFuture<Void> thenAcceptBoth(
    CompletableFuture<? extends U> other,
    BiConsumer<? super T, ? super U> action
)
```

### 示例：合并用户信息和商品信息

```java
CompletableFuture<User> userFuture = CompletableFuture.supplyAsync(() -> getUser());
CompletableFuture<Product> productFuture = CompletableFuture.supplyAsync(() -> getProduct());

// 两个都完成后，组装订单
userFuture.thenAcceptBoth(productFuture, (user, product) -> {
    Order order = new Order(user.getId(), product.getId());
    System.out.println("订单创建：" + order);
}).join();  // 等待完成
```

### 与 thenCombine 的区别

| 方法 | 返回值 | 适用场景 |
| --- | --- | --- |
| `thenCombine` | `CF<R>` | 需要根据两个结果计算新值 |
| `thenAcceptBoth` | `CF<Void>` | 只是使用两个结果，不产生新值 |

`thenCombine` 和 `thenAcceptBoth` 的核心区别在于是否需要返回值：

```java
// thenCombine：计算新值，返回 CF<R>
cf1.thenCombine(cf2, (r1, r2) -> r1 + r2);  // 返回 CF<Integer>

// thenAcceptBoth：只消费，不返回新值
cf1.thenAcceptBoth(cf2, (r1, r2) -> System.out.println(r1 + r2));  // 返回 CF<Void>
```

---

## runAfterBoth：两个都完成后执行

两个 CF 都完成后，**不管结果是什么**，执行一个动作。

```java
public CompletableFuture<Void> runAfterBoth(
    CompletableFuture<?> other,
    Runnable action
)
```

### 示例：后置清理

```java
CompletableFuture.supplyAsync(() -> process())
    .thenAccept(result -> save(result))
    .runAfterBoth(CompletableFuture.runAsync(() -> cleanup()))
    .exceptionally(ex -> {
        log.error("处理失败", ex);
        return null;
    });
```

---

## thenApply / thenAccept / thenRun：三角关系

这三个方法构成了完整的数据处理链路：

```
thenApply → thenAccept → thenRun
  转换         消费        收尾
   ↓           ↓           ↓
返回新值     返回Void     不管结果
```

```java
CompletableFuture.supplyAsync(() -> "原始数据")
    .thenApply(s -> s.toUpperCase())              // 转换：String → String
    .thenAccept(s -> System.out.println(s))       // 消费：打印结果
    .thenRun(() -> System.out.println("完成"))     // 收尾：打印结束标记
    .join();
```

---

## 避免回调地狱

`thenApply` 和 `thenCompose` 解决的是「返回值嵌套」问题。

`thenAccept` 和 `thenRun` 解决的是「最终处理」问题。

两者配合，避免层层嵌套：

```java
// 回调地狱
cf.thenAccept(result1 -> {
    CompletableFuture.supplyAsync(() -> step2(result1))
        .thenAccept(result2 -> {
            CompletableFuture.supplyAsync(() -> step3(result2))
                .thenAccept(result3 -> {
                    // 终于到了最终处理
                });
        });
});
```

```java
// 链式写法：清晰明了
cf.thenApply(this::step2Async)
  .thenCompose(cf2 -> cf2.thenApply(this::step3Async))
  .thenAccept(result3 -> {
      // 最终处理
  });
```

---

## 完整示例：异步订单处理

```java
public class OrderProcessDemo {
    public static void main(String[] args) {
        CompletableFuture
            .supplyAsync(() -> queryUser("张三"))
            .thenAccept(user -> {
                // 消费用户信息：记录日志
                logger.info("查询到用户：{}", user.getName());
            })
            .thenCompose(v -> CompletableFuture.supplyAsync(() -> queryOrders()))
            .thenAccept(orders -> {
                // 消费订单列表：更新缓存
                cache.put("orders", orders);
                logger.info("缓存更新完成，共 {} 条订单", orders.size());
            })
            .thenRun(() -> {
                // 不关心具体结果，只关心流程走完：发送通知
                notificationService.send("订单处理完成");
            })
            .exceptionally(ex -> {
                // 异常处理
                logger.error("处理失败", ex);
                notificationService.send("订单处理失败");
                return null;
            });
    }
}
```

---

## 方法对比表

| 方法 | 接收参数 | 返回值 | 是否关心结果 | 何时执行 |
| --- | --- | --- | --- | --- |
| `thenAccept` | `Consumer<T>` | `CF<Void>` | ✅ 只关心上一个 | 上一个完成后 |
| `thenRun` | `Runnable` | `CF<Void>` | ❌ 都不关心 | 上一个完成后 |
| `thenAcceptBoth` | `CF2, BiConsumer` | `CF<Void>` | ✅ 关心两个 | 两个都完成后 |
| `runAfterBoth` | `CF2, Runnable` | `CF<Void>` | ❌ 都不关心 | 两个都完成后 |
| `applyToEither` | `CF2, Function` | `CF<U>` | ✅ 只关心最快 | 任一完成后 |
| `runAfterEither` | `CF2, Runnable` | `CF<Void>` | ❌ 都不关心 | 任一完成后 |

---

## 面试追问方向

**Q1：thenAccept 返回 CompletableFuture<Void> 有什么用？**

`thenAccept` 返回 `Void` 意味着这个阶段不产生新值。但返回 `CF<Void>` 仍然可以继续链式调用，因为它代表「完成」这个事件。你可以在 `thenAccept` 后面继续 `thenRun`、`thenCompose` 等操作。

**Q2：thenAccept 和 thenApply 性能上有区别吗？**

在执行逻辑相同的情况下，没有显著区别。两者的主要区别是语义上的：如果你需要转换结果用 `thenApply`，如果你只需要「使用」结果而不产生新值，用 `thenAccept`。

**Q3：为什么有时候 thenRun 要放在 thenAccept 前面？**

`thenRun` 不关心上一步的结果，所以如果两个操作有依赖关系，应该让不依赖结果的操作先执行。比如：先记录日志（`thenRun`），再保存数据（`thenAccept`），这样日志记录不会因为数据保存失败而被跳过。
