# CompletableFuture 创建方式

你有几种方式创建一个 CompletableFuture？

答案是：至少 5 种。

每种创建方式都有其适用场景，理解它们是掌握 CompletableFuture 的基础。

---

## supplyAsync：创建带返回值的异步任务

`supplyAsync` 用于创建**有返回值**的异步任务。

```java
public static <U> CompletableFuture<U> supplyAsync(Supplier<U> supplier)
public static <U> CompletableFuture<U> supplyAsync(Supplier<U> supplier, Executor executor)
```

### 示例：异步查询商品信息

```java
// 使用默认线程池（ForkJoinPool.commonPool()）
CompletableFuture<Product> productFuture = CompletableFuture.supplyAsync(() -> {
    return productService.findById(1);
});

// 指定线程池
CompletableFuture<Product> productFuture = CompletableFuture.supplyAsync(() -> {
    return productService.findById(1);
}, executor);
```

---

## runAsync：创建无返回值的异步任务

`runAsync` 用于创建**无返回值**的异步任务，类似 `Runnable`。

```java
public static CompletableFuture<Void> runAsync(Runnable runnable)
public static CompletableFuture<Void> runAsync(Runnable runnable, Executor executor)
```

### 示例：异步发送消息

```java
// 发送通知，不需要等待结果
CompletableFuture.runAsync(() -> {
    notificationService.send("订单已发货");
});

// 指定线程池
CompletableFuture.runAsync(() -> {
    notificationService.send("订单已发货");
}, executor);
```

---

## completedFuture：创建已完成的 Future

有时候，你已经知道结果了，不需要异步执行。

```java
public static <U> CompletableFuture<U> completedFuture(U value)
```

### 示例：缓存命中场景

```java
public CompletableFuture<User> getUser(String userId) {
    // 先查缓存
    User cached = cache.get(userId);
    if (cached != null) {
        // 缓存命中，直接返回已完成的 Future
        return CompletableFuture.completedFuture(cached);
    }
    // 缓存未命中，异步查询数据库
    return CompletableFuture.supplyAsync(() -> database.findUser(userId));
}
```

### 对比：completedFuture vs 直接返回

```java
// 方式一：completedFuture（推荐用于适配）
CompletableFuture<User> result = CompletableFuture.completedFuture(user);

// 方式二：普通值包装（不推荐）
CompletableFuture<User> result = CompletableFuture.supplyAsync(() -> user);
// 多此一举，还要额外分配线程执行
```

---

## failedFuture：创建已失败的 Future（JDK 12+）

有时候你需要返回一个「已完成但失败」的 Future。

```java
public static <U> CompletableFuture<U> failedFuture(Throwable ex)
```

### 示例：服务不可用时返回失败结果

```java
public CompletableFuture<User> getUser(String userId) {
    if (!service.isAvailable()) {
        // 服务不可用，直接返回失败
        return CompletableFuture.failedFuture(
            new ServiceUnavailableException("用户服务暂时不可用")
        );
    }
    return CompletableFuture.supplyAsync(() -> service.findUser(userId));
}
```

### JDK 8 兼容写法

如果你的代码需要兼容 JDK 8，可以用这种方式模拟：

```java
public static <T> CompletableFuture<T> failedFuture(Throwable ex) {
    CompletableFuture<T> future = new CompletableFuture<>();
    future.completeExceptionally(ex);
    return future;
}
```

---

## 手动完成：complete() 与 completeExceptionally()

除了静态工厂方法，你还可以手动控制 CompletableFuture 的完成。

### complete()

```java
public boolean complete(T value)
```

如果 Future 尚未完成，将 value 作为结果返回；如果已完成，则忽略。

```java
CompletableFuture<String> future = new CompletableFuture<>();

// 在另一个线程中
new Thread(() -> {
    try {
        // 模拟等待某个事件
        Thread.sleep(5000);
        // 事件发生了，手动完成
        future.complete("事件已触发");
    } catch (InterruptedException e) {
        future.completeExceptionally(e);
    }
}).start();

// 主线程等待
System.out.println(future.get()); // 阻塞5秒后打印：事件已触发
```

### 实际场景：异步队列

```java
CompletableFuture<Message> future = new CompletableFuture<>();

// 消息队列消费者
queue.consume(msg -> {
    if (msg != null) {
        future.complete(msg);
    }
});

// 生产者等待
Message message = future.get();
```

### completeExceptionally()

```java
public boolean completeExceptionally(Throwable ex)
```

手动标记 Future 为异常完成。

```java
CompletableFuture<Integer> future = new CompletableFuture<>();

try {
    // 模拟业务逻辑
    int result = doSomething();
    future.complete(result);
} catch (Exception e) {
    future.completeExceptionally(e);
}
```

---

## 完整示例：创建方式对比

```java
public class CreateDemo {
    public static void main(String[] args) throws Exception {
        // 1. supplyAsync - 有返回值
        CompletableFuture<String> cf1 = CompletableFuture.supplyAsync(() -> {
            sleep(500);
            return "supplyAsync 结果";
        });
        
        // 2. runAsync - 无返回值
        CompletableFuture<Void> cf2 = CompletableFuture.runAsync(() -> {
            sleep(500);
            System.out.println("runAsync 执行完毕");
        });
        
        // 3. completedFuture - 已知结果
        CompletableFuture<String> cf3 = CompletableFuture.completedFuture("直接返回");
        
        // 4. failedFuture - 已知异常（JDK 12+）
        CompletableFuture<String> cf4 = CompletableFuture.failedFuture(
            new RuntimeException("已知错误")
        );
        
        // 5. 手动完成
        CompletableFuture<String> cf5 = new CompletableFuture<>();
        CompletableFuture.runAsync(() -> {
            sleep(300);
            cf5.complete("手动完成");
        });
        
        // 输出结果
        System.out.println(cf1.get());
        System.out.println(cf3.get());
        System.out.println(cf5.get());
    }
    
    static void sleep(int ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) {}
    }
}
```

---

## 创建方式选择指南

| 场景 | 推荐方法 | 说明 |
|-----|---------|-----|
| 异步执行，有返回值 | `supplyAsync` | 最常用 |
| 异步执行，无返回值 | `runAsync` | 纯异步操作 |
| 同步结果转异步 | `completedFuture` | 缓存命中、测试 |
| 返回已知异常 | `completedFuture` + `completeExceptionally` 或 `failedFuture` | 降级处理 |
| 外部事件触发完成 | `new CompletableFuture()` + `complete()` | 消息队列、响应式 |
| 等待多个条件 | `new CompletableFuture()` + `complete()` | 手动控制完成时机 |

---

## 面试追问方向

**Q1：supplyAsync 和 runAsync 有什么区别？**

`supplyAsync` 接受 `Supplier<T>`，可以有返回值；`runAsync` 接受 `Runnable`，返回 `Void`。从语义上说，`supplyAsync` 用于「获取数据」，`runAsync` 用于「执行动作」。

**Q2：为什么 completedFuture 不需要线程池？**

因为它不需要执行任何异步操作。`completedFuture` 直接返回一个已经完成状态且包含结果的 CompletableFuture，相当于一个「盒子」，里面已经装好了结果，不需要任何执行过程。

**Q3：CompletableFuture.supplyAsync 默认使用哪个线程池？**

默认使用 `ForkJoinPool.commonPool()`。这是一个 JVM 级别的共享线程池，适用于 CPU 密集型任务。但对于 IO 密集型任务，建议使用自定义线程池。
