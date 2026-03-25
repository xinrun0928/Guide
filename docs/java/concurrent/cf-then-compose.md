# thenCompose：扁平化链式调用

你有没有写过这样的代码：

```java
future1.thenApply(r1 -> 
    future2.thenApply(r2 -> 
        future3.thenApply(r3 -> r1 + r2 + r3)
    )
);
```

每一层都是 `CompletableFuture`，嵌套着 `CompletableFuture`，最终返回值是 `CompletableFuture<CompletableFuture<T>>`。

这就是**回调地狱**，或者说 **Future 嵌套**。

`thenCompose` 就是来解救你的。

---

## 回调地狱的根源

假设有这样一个业务：

```
用户验证 → 查询用户详情 → 查询用户订单 → 查询订单商品
```

每个步骤都依赖上一步的结果。用 `thenApply` 写：

```java
CompletableFuture<User> cf1 = CompletableFuture.supplyAsync(() -> validate(token));

// 用 thenApply：会嵌套
CompletableFuture<CompletableFuture<Order>> cf2 = cf1.thenApply(user -> 
    CompletableFuture.supplyAsync(() -> queryOrder(user.getId()))
);

// cf2 的类型是 CompletableFuture<CompletableFuture<Order>>
// 想继续链式调用？对不起，类型不对
```

### 问题分析

```
cf1.thenApply(user -> cf2) 返回什么？

CF1<T> + Function<T, CF2<U>> = CF2<CF2<U>>
                                               ↑ 双重嵌套！
```

---

## thenCompose：扁平化

`thenCompose` 的签名是：

```java
public <U> CompletableFuture<U> thenCompose(
    Function<? super T, ? extends CompletionStage<U>> fn
)
```

对比：

| 方法 | Function 类型 | 返回值 |
|-----|-------------|--------|
| `thenApply` | `T → U` | `CompletableFuture<U>` |
| `thenCompose` | `T → CF<U>` | `CompletableFuture<U>` |

关键区别：**`thenCompose` 期望 fn 返回一个 CompletionStage（或 CompletableFuture），然后自动帮你「展开」**。

### 扁平化原理

```
thenApply:  CF<T> + Function<T, U>              = CF<U>
thenCompose: CF<T> + Function<T, CF<U>>        = CF<U>  // 自动展开

before:  CF1<CF2<U>>  ← 嵌套的 CF
after:   CF<U>        ← 扁平的 CF
```

---

## 实战：链式调用

### 使用 thenApply（错误示例）

```java
// 错误：产生 CompletableFuture<CompletableFuture<Order>>
CompletableFuture<CompletableFuture<Order>> badFuture = cf1.thenApply(user ->
    CompletableFuture.supplyAsync(() -> queryOrder(user.getId()))
);

// 想获取订单？需要两层 join
Order order = badFuture.join().join();  // 丑陋！
```

### 使用 thenCompose（正确示例）

```java
// 正确：扁平化，直接得到 CompletableFuture<Order>
CompletableFuture<Order> orderFuture = cf1.thenCompose(user ->
    CompletableFuture.supplyAsync(() -> queryOrder(user.getId()))
);

// 一层 join 就够了
Order order = orderFuture.join();
```

### 完整链式调用

```java
public CompletableFuture<OrderDetail> buildOrderDetail(String token) {
    return CompletableFuture
        .supplyAsync(() -> validateToken(token))           // CF<User>
        .thenCompose(user -> 
            CompletableFuture.supplyAsync(() -> queryUserDetails(user))  // CF<UserDetail>
        )
        .thenCompose(userDetail ->
            CompletableFuture.supplyAsync(() -> queryOrders(userDetail.getId()))  // CF<List<Order>>
        )
        .thenCompose(orders ->
            CompletableFuture.supplyAsync(() -> enrichWithProducts(orders))  // CF<OrderDetail>
        );
}
```

---

## thenApply vs thenCompose：对比

### 图示对比

```
thenApply：值 → 值
┌──────────┐      apply(f)       ┌──────────┐
│ CF<T>    │ ──────────────────► │ CF<U>    │
│          │                     │          │
│ result=T │                     │ result=U │
└──────────┘                     └──────────┘
              f: T → U


thenCompose：值 → CF → CF展开
┌──────────┐    compose(f)    ┌──────────┐
│ CF<T>    │ ───────────────►│ CF<U>    │
│          │                 │          │
│ result=T │                 │ result=U │
└──────────┘                 └──────────┘
              f: T → CF<U> (自动展开)


thenApply（嵌套）：值 → CF
┌──────────┐    apply(f)    ┌────────────────┐
│ CF<T>    │ ─────────────►│ CF<CF<U>>      │
│          │               │                │
│ result=T │               │ outer.result=  │
└──────────┘               │   inner (CF<U>)│
                           └────────────────┘
```

### 代码对比

```java
// thenApply：普通转换
cf1.thenApply(user -> user.getName());  // CF<User> → CF<String>

// thenCompose：返回 CF 的转换
cf1.thenCompose(user -> getOrderFuture(user.getId()));  // CF<User> → CF<Order>

// thenApply（嵌套）：错误示例
cf1.thenApply(user -> getOrderFuture(user.getId()));  
// 返回 CF<CF<Order>>，无法继续链式调用
```

---

## 实际场景：用户下单流程

```java
public class OrderService {
    
    public CompletableFuture<String> placeOrder(String userId, String productId) {
        return CompletableFuture
            // 第一步：验证用户
            .supplyAsync(() -> userService.validateUser(userId))
            
            // 第二步：查询用户余额
            .thenCompose(user -> 
                CompletableFuture.supplyAsync(() -> accountService.getBalance(user.getId()))
            )
            
            // 第三步：检查库存
            .thenCompose(balance ->
                CompletableFuture.supplyAsync(() -> inventoryService.checkStock(productId))
                    .thenApply(stock -> new BalanceStock(balance, stock))  // 合并信息
            )
            
            // 第四步：创建订单
            .thenCompose(info -> {
                if (info.balance < info.stock.getPrice()) {
                    // 余额不足，返回失败的 CF
                    return CompletableFuture.failedFuture(
                        new InsufficientBalanceException("余额不足")
                    );
                }
                return CompletableFuture.supplyAsync(() -> 
                    orderService.createOrder(userId, productId)
                );
            })
            
            // 第五步：扣减库存
            .thenCompose(order ->
                CompletableFuture.supplyAsync(() -> inventoryService.deductStock(productId))
                    .thenApply(ok -> order)  // 返回订单（忽略扣减结果）
            )
            
            // 最终处理
            .thenAccept(order -> notificationService.notify(order));
    }
}
```

---

## thenCompose + thenApply：组合使用

有时候你需要 **先转换，再扁平化**：

```java
// thenApply + thenCompose
cf.thenApply(this::convertToUser)           // CF<T> → CF<User>
   .thenCompose(user -> queryOrder(user.getId()))  // CF<User> → CF<Order>

// 等价于
cf.thenCompose(result -> 
    CompletableFuture.supplyAsync(() -> 
        convertToUser(result)
    ).thenCompose(user -> queryOrder(user.getId()))
);
```

---

## 面试追问方向

**Q1：thenCompose 和 flatMap 有什么关系？**

`thenCompose` 本质上就是 `flatMap`（扁平化 map）。在 Scala/Kotlin 中，`flatMap` 直接是方法名。在 Java 中，`thenCompose` 是更语义化的命名。两者都是将「返回集合/容器」的操作扁平化，避免嵌套结构。

**Q2：thenCompose 和 thenCombine 有什么区别？**

`thenCompose` 用于**串行依赖**：B 依赖 A 的结果。`thenCombine` 用于**并行合并**：A 和 B 独立执行，合并结果。`thenCompose` 强调时序，`thenCombine` 强调并行。

**Q3：如果 thenCompose 中的函数返回 null 会怎样？**

会抛出 `NullPointerException`。`thenCompose` 期望函数返回的是一个 `CompletionStage`，如果返回 `null`，CompletableFuture 会认为异常发生了。你应该返回 `CompletableFuture.completedFuture(null)` 或者 `CompletableFuture.failedFuture()`。
