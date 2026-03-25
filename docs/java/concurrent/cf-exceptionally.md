# exceptionally：异常时返回默认值

异步任务执行过程中抛出异常了，怎么办？

最简单的方式是：**返回一个默认值**。

这就是 `exceptionally` 的作用。

---

## exceptionally 基础

```java
public CompletableFuture<T> exceptionally(Function<Throwable, ? extends T> fn)
```

### 工作原理

```
正常流程：
CF<T> ──► thenApply ──► CF<U>

异常流程：
CF<T> ──► 抛出异常 ──► exceptionally(fn) ──► CF<U> (默认值)
```

### 简单示例

```java
CompletableFuture.supplyAsync(() -> queryUser())
    .thenApply(user -> user.getName())
    .exceptionally(ex -> {
        // 异常发生时，返回默认值
        System.err.println("查询失败：" + ex.getMessage());
        return "匿名用户";
    })
    .thenAccept(name -> System.out.println("用户名：" + name));
```

### 没有异常时

```java
CompletableFuture.completedFuture("Hello")
    .exceptionally(ex -> "默认值")
    .thenAccept(System.out::println);  // 输出：Hello
    // exceptionally 不会被执行！
```

---

## exceptionallyCompose：异常时返回新的 CF

`exceptionally` 返回一个值，`exceptionallyCompose` 返回一个新的 `CompletableFuture`。

```java
public CompletableFuture<T> exceptionallyCompose(Function<Throwable, ? extends CompletionStage<T>> fn)
```

### 区别

| 方法 | 返回值 | 适用场景 |
|-----|--------|---------|
| `exceptionally` | `T`（默认值） | 返回固定默认值 |
| `exceptionallyCompose` | `CompletableFuture<T>` | 需要执行异步操作 |

### 场景：服务降级

```java
// 主力服务查询，失败后调用备用服务
CompletableFuture.supplyAsync(() -> primaryService.query(key))
    .exceptionallyCompose(ex -> {
        // 主力服务失败，调用备用服务
        System.err.println("主力服务失败，降级到备用：" + ex.getMessage());
        return CompletableFuture.supplyAsync(() -> backupService.query(key));
    })
    .thenAccept(this::processResult);
```

### 场景：多级降级

```java
CompletableFuture.supplyAsync(() -> redisService.get(key))
    .exceptionallyCompose(ex -> {
        // Redis 失败，降级到本地缓存
        return CompletableFuture.supplyAsync(() -> localCache.get(key));
    })
    .exceptionallyCompose(ex -> {
        // 本地缓存也失败，降级到数据库
        return CompletableFuture.supplyAsync(() -> database.get(key));
    })
    .exceptionally(ex -> {
        // 所有服务都失败，返回空对象
        return CompletableFuture.completedFuture(null);
    });
```

---

## 实战：优雅的服务降级

### 传统写法 vs exceptionallyCompose

```java
// 传统写法：嵌套 if-else
public String getUserName(String userId) {
    try {
        User user = primaryService.getUser(userId);
        return user.getName();
    } catch (Exception e) {
        try {
            User user = backupService.getUser(userId);
            return user.getName();
        } catch (Exception e2) {
            return "默认用户";
        }
    }
}
```

```java
// exceptionallyCompose：链式降级
public CompletableFuture<String> getUserName(String userId) {
    return CompletableFuture
        .supplyAsync(() -> primaryService.getUser(userId))
        .exceptionallyCompose(ex -> {
            // 降级到备用服务
            return CompletableFuture.supplyAsync(() -> backupService.getUser(userId));
        })
        .exceptionallyCompose(ex -> {
            // 降级到默认用户
            return CompletableFuture.completedFuture(new User("default", "默认用户"));
        })
        .thenApply(User::getName);
}
```

### 完整的降级策略

```java
public CompletableFuture<UserProfile> getUserProfile(String userId) {
    return CompletableFuture
        // 第一级：Redis 缓存
        .supplyAsync(() -> redisTemplate.opsForValue().get(userId))
        .exceptionallyCompose(ex -> {
            log.warn("Redis 查询失败: {}", ex.getMessage());
            // 第二级：数据库查询
            return CompletableFuture.supplyAsync(() -> userDao.findById(userId));
        })
        .exceptionallyCompose(ex -> {
            log.error("数据库查询失败: {}", ex.getMessage());
            // 第三级：返回默认用户
            return CompletableFuture.completedFuture(UserProfile.defaultProfile(userId));
        });
}
```

---

## 异常链传递

`exceptionally` 返回值后，后续的 `thenApply` 仍然会正常执行。

```java
CompletableFuture.supplyAsync(() -> {
    throw new RuntimeException("原始异常");
})
.exceptionally(ex -> {
    System.out.println("捕获：" + ex.getMessage());  // 输出：原始异常
    return "默认值";
})
.thenApply(value -> value.toUpperCase())  // 正常执行
.thenAccept(System.out::println);  // 输出：默认值
```

但如果 `exceptionally` 自己也抛出异常：

```java
CompletableFuture.supplyAsync(() -> {
    throw new RuntimeException("原始异常");
})
.exceptionally(ex -> {
    throw new RuntimeException("处理异常");  // 抛出新异常
})
// 后续的 thenApply 不会执行
.exceptionally(ex -> {
    System.out.println("捕获处理异常：" + ex.getMessage());  // 输出：处理异常
    return "最终默认值";
});
```

---

## 对比：exceptionally vs handle

| 对比点 | exceptionally | handle |
|-------|--------------|--------|
| 触发条件 | 只在异常时执行 | 成功或异常都执行 |
| 返回值类型 | `T` | `U`（可以不同） |
| 异常处理后 | 后续正常执行 | 后续正常执行 |
| 适用场景 | 服务降级返回默认值 | 统一处理成功/失败逻辑 |

```java
// exceptionally：只关心异常
cf.exceptionally(ex -> "默认值");

// handle：关心成功和异常
cf.handle((result, ex) -> {
    if (ex != null) {
        return "默认值";
    }
    return result;
});
```

---

## 完整示例

```java
public class ServiceCaller {
    
    private final UserService userService;
    private final OrderService orderService;
    private final NotificationService notificationService;
    
    public CompletableFuture<OrderDetail> getOrderDetail(String orderId) {
        return CompletableFuture
            .supplyAsync(() -> orderService.findById(orderId))
            
            // 订单查询失败
            .exceptionallyCompose(ex -> {
                log.error("订单查询失败: {}", orderId, ex);
                // 降级：从缓存查询
                return CompletableFuture.supplyAsync(() -> orderCache.get(orderId));
            })
            
            // 缓存也失败
            .exceptionallyCompose(ex -> {
                log.error("缓存查询失败: {}", orderId, ex);
                // 返回空订单
                return CompletableFuture.completedFuture(OrderDetail.empty(orderId));
            })
            
            // 查询用户信息
            .thenCompose(detail -> 
                CompletableFuture.supplyAsync(() -> userService.findById(detail.getUserId()))
                    .exceptionally(ex -> {
                        log.warn("用户查询失败: {}", detail.getUserId());
                        return User.anonymous();  // 返回匿名用户
                    })
                    .thenApply(user -> detail.withUser(user))
            )
            
            // 最终处理
            .thenAccept(detail -> {
                log.info("订单详情获取成功: {}", orderId);
                // 发送通知
                notificationService.notify(detail.getUserId(), "订单已找到");
            })
            
            // 最后的兜底
            .exceptionally(ex -> {
                log.error("订单详情获取完全失败: {}", orderId, ex);
                return null;
            });
    }
}
```

---

## 面试追问方向

**Q1：exceptionally 和 exceptionllyCompose 怎么选？**

如果只需要返回一个固定的默认值，用 `exceptionally`。如果需要执行异步操作（如调用备用服务），用 `exceptionallyCompose`。本质上是同步返回值 vs 异步返回值的区别。

**Q2：exceptionally 会丢失原始异常吗？**

不会。`exceptionally` 接收的参数就是原始异常，你可以打印日志、决定返回什么默认值，或者抛出新异常。但如果你只是返回了默认值，原始异常信息就丢失了。建议在 `exceptionally` 中至少记录日志。

**Q3：多个 exceptionally 怎么执行顺序？**

`exceptionally` 会从上到下依次检查：如果第一个 `exceptionally` 捕获了异常，后续的 `exceptionally` 就不会触发。如果第一个 `exceptionally` 返回了默认值（正常路径），后续的 `exceptionally` 也不会触发。只有当异常发生且 `exceptionally` 也抛出异常时，才会触发下一个 `exceptionally`。
