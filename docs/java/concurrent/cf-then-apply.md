# thenApply / thenApplyAsync：同步与异步转换

假设你查询了一个用户，返回的是 `User` 对象。

但前端需要的是 `String` 格式的用户名。

你会怎么做？

```java
User user = userFuture.get();          // 阻塞等待
String name = user.getName();           // 转换
System.out.println(name);
```

CompletableFuture 告诉你：不用等，直接注册转换逻辑。

---

## thenApply：同步转换

`thenApply` 是最基本的转换方法。

```java
public <U> CompletableFuture<U> thenApply(Function<? super T, ? extends U> fn)
```

### 工作原理

```
┌─────────────┐      thenApply(fn)      ┌─────────────┐
│  CF<T>      │ ──────────────────────► │  CF<U>      │
│  (结果: T)  │                         │  (结果: U)  │
└─────────────┘                         └─────────────┘
              fn(t) = u
```

### 示例：数据转换链

```java
// 查询商品 → 转换格式 → 计算折扣 → 格式化
CompletableFuture.supplyAsync(() -> queryProduct(1))
    .thenApply(this::toProductDTO)           // Product → ProductDTO
    .thenApply(this::calculateDiscount)       // ProductDTO → double
    .thenApply(this::formatPrice)            // double → String
    .thenAccept(System.out::println);         // 打印最终结果
```

```java
// 具体实现
private ProductDTO toProductDTO(Product p) {
    return new ProductDTO(p.getId(), p.getName(), p.getPrice());
}

private double calculateDiscount(ProductDTO dto) {
    return dto.getPrice() * 0.8;  // 8折
}

private String formatPrice(double price) {
    return String.format("¥%.2f", price);
}
```

### 同步执行特点

```java
CompletableFuture<String> cf = CompletableFuture
    .completedFuture("Hello")
    .thenApply(s -> {
        System.out.println("执行线程：" + Thread.currentThread().getName());
        return s.toUpperCase();
    });

System.out.println("主线程继续执行...");
System.out.println("结果：" + cf.join());

// 输出：
// 主线程继续执行...
// 执行线程：main
// 结果：HELLO
```

注意：`completedFuture` 是同步完成的，所以 `thenApply` 也在主线程执行。

---

## thenApplyAsync：异步转换

`thenApplyAsync` 在**另一个线程**中执行转换逻辑。

```java
public <U> CompletableFuture<U> thenApplyAsync(Function<? super T, ? extends U> fn)
public <U> CompletableFuture<U> thenApplyAsync(Function<? super T, ? extends U> fn, Executor executor)
```

### 执行流程

```
主线程                          commonPool 线程
   │                                  │
   ▼                                  ▼
┌─────────┐                    ┌─────────────┐
│ supply  │                    │ thenApply   │
│   Async │ ──── 完成通知 ────►│   Async     │
└─────────┘                    └─────────────┘
```

### 示例：异步数据处理

```java
CompletableFuture.supplyAsync(() -> {
    System.out.println("查询线程：" + Thread.currentThread().getName());
    return "原始数据";
})
.thenApplyAsync(s -> {
    System.out.println("转换线程：" + Thread.currentThread().getName());
    return s + " -> 转换后";
})
.thenAccept(System.out::println);

// 主线程可以继续做其他事
```

### 指定线程池

```java
ExecutorService executor = Executors.newFixedThreadPool(10);

CompletableFuture.supplyAsync(() -> queryFromDB(), executor)
    .thenApplyAsync(this::processData, executor)  // 同一线程池
    .thenAccept(this::sendToKafka, executor);
```

---

## thenApply vs thenApplyAsync：如何选择？

### 性能对比

| 场景 | thenApply | thenApplyAsync |
|-----|-----------|---------------|
| 快速转换（微秒级） | ✅ 推荐，避免线程切换 | ❌ 不必要开销 |
| 耗时操作（毫秒+） | ❌ 阻塞上游线程 | ✅ 推荐，释放线程 |
| CPU 密集型 | ✅ 小心使用 | ✅ 可用 |
| IO 密集型 | ❌ 浪费线程 | ✅ 推荐 |

### 选择原则

```java
// 场景一：简单转换，不涉及 IO
.thenApply(s -> s.trim().toUpperCase())  // 用 thenApply

// 场景二：涉及数据库查询
.thenApplyAsync(this::queryRelatedData)  // 用 thenApplyAsync

// 场景三：涉及 HTTP 调用
.thenApplyAsync(this::callExternalAPI, httpExecutor)  // 专用线程池
```

---

## applyToEither：任一完成时执行

有时候你只需要**最快的那个结果**。

```java
public <U> CompletableFuture<U> applyToEither(
    CompletableFuture<? extends T> other,
    Function<? super T, U> fn
)
```

### 示例：多个数据源取最快响应

```java
CompletableFuture<String> sourceA = CompletableFuture
    .supplyAsync(() -> querySourceA());  // 预计 200ms

CompletableFuture<String> sourceB = CompletableFuture
    .supplyAsync(() -> querySourceB());  // 预计 100ms

// 哪个先完成用哪个
sourceA.applyToEither(sourceB, result -> {
    System.out.println("最快结果：" + result);
    return result;
}).join();
```

---

## orTimeout：超时控制（JDK 9+）

异步任务如果没有完成，就需要超时处理。

```java
public CompletableFuture<T> orTimeout(long timeout, TimeUnit unit)
```

### 示例

```java
CompletableFuture.supplyAsync(() -> slowQuery())
    .orTimeout(3, TimeUnit.SECONDS)      // 3秒超时
    .thenAccept(result -> System.out.println(result))
    .exceptionally(ex -> {
        // 超时后进入这里
        System.err.println("查询超时");
        return null;
    });
```

---

## 完整示例：数据转换流水线

```java
public class TransformDemo {
    public static void main(String[] args) {
        // 模拟数据转换流水线
        CompletableFuture
            .supplyAsync(() -> loadRawData())           // 异步加载
            .thenApplyAsync(this::validate)             // 异步验证
            .thenApply(this::transform)                 // 同步转换
            .thenApplyAsync(this::enrich)               // 异步丰富
            .thenApply(this::finalize)                  // 同步最终处理
            .thenAccept(this::publish)                  // 发布结果
            .exceptionally(this::handleError);         // 统一异常
    }
    
    // 加载原始数据
    static String loadRawData() {
        System.out.println("加载线程：" + Thread.currentThread().getName());
        return "raw";
    }
    
    // 验证数据
    static String validate(String data) {
        System.out.println("验证线程：" + Thread.currentThread().getName());
        return data + "-valid";
    }
    
    // 转换格式
    static String transform(String data) {
        System.out.println("转换线程：" + Thread.currentThread().getName());
        return data + "-transformed";
    }
    
    // 丰富数据
    static String enrich(String data) {
        System.out.println("丰富线程：" + Thread.currentThread().getName());
        return data + "-enriched";
    }
    
    // 最终处理
    static String finalize(String data) {
        System.out.println("最终线程：" + Thread.currentThread().getName());
        return data + "-final";
    }
    
    // 发布
    static void publish(String data) {
        System.out.println("发布线程：" + Thread.currentThread().getName());
        System.out.println("最终结果：" + data);
    }
    
    // 异常处理
    static Void handleError(Throwable ex) {
        System.err.println("异常：" + ex.getMessage());
        return null;
    }
}
```

---

## 面试追问方向

**Q1：thenApply 和 thenApplyAsync 在性能上有什么区别？**

`thenApply` 在上一个任务完成的线程中同步执行，不会产生线程切换开销，适合快速转换。`thenApplyAsync` 会把任务提交到线程池，可能涉及线程切换，适合耗时操作。关键在于：如果转换本身很快，`thenApply` 的性能更好；如果转换涉及 IO 或计算密集，`thenApplyAsync` 能更好利用线程资源。

**Q2：如果 thenApply 抛出异常，会怎么样？**

`thenApply` 中的异常会被包装成 `CompletionException`，自动触发后续的 `exceptionally` 处理。如果没有任何异常处理，调用 `get()` 或 `join()` 时会抛出 `CompletionException`，你需要解包才能获取真正的异常。

**Q3：thenApply 可以链式调用多个吗？**

可以。`thenApply` 可以无限链式调用，构成一个转换流水线。每一个 `thenApply` 接收上一个的结果，返回新的值，最终传递给 `thenAccept` 消费。
