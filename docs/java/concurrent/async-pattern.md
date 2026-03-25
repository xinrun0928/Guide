# Java 异步编程模式总结

从同步到异步，Java 走过了一条漫长的路。

你用过多少种异步编程方式？

Thread → Callback → Future → CompletableFuture → 响应式编程

每一种都是对前一种的改进，每一次改进都解决了前一代的痛点。

---

## 模式演进

```
同步阻塞
    │
    ├── Thread / Runnable
    │       ↓ 改进
    ├── Callback
    │       ↓ 改进
    ├── Future
    │       ↓ 改进
    └── CompletableFuture
            ↓ 扩展
        响应式编程
```

---

## 模式一：同步模式（最原始）

### Thread / Runnable

```java
// 同步调用：阻塞等待
String result = service.call();

// 异步调用：创建线程
new Thread(() -> service.call()).start();
```

**问题**：

- 线程创建开销大
- 结果无法获取
- 没有异常处理机制

---

## 模式二：回调模式（解决结果获取）

### 经典回调

```java
// 回调接口
interface Callback<T> {
    void onSuccess(T result);
    void onError(Exception e);
}

// 使用回调
service.callAsync(new Callback<String>() {
    @Override
    public void onSuccess(String result) {
        // 处理结果
    }
    
    @Override
    public void onError(Exception e) {
        // 处理异常
    }
});
```

### Guava ListenableFuture

```java
ListeningExecutorService executor = MoreExecutors.listeningDecorator(
    Executors.newFixedThreadPool(10));

ListenableFuture<String> future = executor.submit(() -> service.call());

 Futures.addCallback(future, new FutureCallback<String>() {
    @Override
    public void onSuccess(String result) {
        // 处理结果
    }
    
    @Override
    public void onFailure(Throwable t) {
        // 处理异常
    }
 }, executor);
```

### 回调的问题：回调地狱

```java
serviceA.callAsync(resultA -> {
    serviceB.callAsync(resultB -> {
        serviceC.callAsync(resultC -> {
            serviceD.callAsync(resultD -> {
                // 四层嵌套，这就是回调地狱
            }, errorD -> handle(errorD));
        }, errorC -> handle(errorC));
    }, errorB -> handle(errorB));
}, errorA -> handle(errorA));
```

---

## 模式三：Future 模式（解决回调地狱）

### JDK Future

```java
Future<String> future = executor.submit(() -> service.call());

// 可以查询状态
if (future.isDone()) {
    String result = future.get();  // 阻塞等待
}
```

### Future 的局限

```java
Future<String> f1 = executor.submit(() -> queryA());
Future<String> f2 = executor.submit(() -> queryB());

// ❌ 无法优雅地组合
Future<String> f3 = executor.submit(() -> combine(f1.get(), f2.get()));

// ✅ 手动等待
while (!f1.isDone() || !f2.isDone()) {
    Thread.sleep(10);
}
String result = combine(f1.get(), f2.get());
```

---

## 模式四：CompletableFuture（链式异步）

### 链式调用

```java
CompletableFuture.supplyAsync(() -> queryA())
    .thenCompose(a -> CompletableFuture.supplyAsync(() -> queryB(a)))
    .thenCombine(CompletableFuture.supplyAsync(() -> queryC()),
        (b, c) -> combine(b, c))
    .thenAccept(result -> process(result))
    .exceptionally(ex -> {
        handle(ex);
        return null;
    });
```

### 组合多个

```java
// allOf：等待所有
CompletableFuture.allOf(f1, f2, f3)
    .thenRun(() -> use(f1.join(), f2.join(), f3.join()));

// anyOf：任一完成
CompletableFuture.anyOf(f1, f2, f3)
    .thenAccept(result -> useFirst(result));
```

---

## 模式五：响应式编程（声明式流处理）

### JDK 9 Flow API

```java
SubmissionPublisher<Item> publisher = new SubmissionPublisher<>();

Subscriber<ProcessedItem> subscriber = new Subscriber<>() {
    private Subscription subscription;
    
    @Override
    public void onSubscribe(Subscription s) {
        this.subscription = s;
        s.request(1);  // 背压：请求一个
    }
    
    @Override
    public void onNext(Item item) {
        process(item);
        subscription.request(1);  // 处理完再请求
    }
    
    @Override
    public void onError(Throwable ex) { }
    
    @Override
    public void onComplete() { }
};

publisher.subscribe(subscriber);
publisher.submit(new Item());
```

### Reactor 示例

```java
Mono.just(userId)
    .flatMap(this::fetchUser)
    .flatMap(this::fetchOrders)
    .filter(orders -> !orders.isEmpty())
    .map(this::toResponse)
    .timeout(Duration.ofSeconds(3))
    .onErrorResume(ex -> Mono.just(FallbackResponse.get()))
    .subscribeOn(Schedulers.boundedElastic())
    .subscribe(response -> send(response));
```

---

## 模式对比

| 模式 | 同步/异步 | 组合能力 | 错误处理 | 背压 | 学习曲线 |
|-----|----------|---------|---------|-----|---------|
| 同步 | 同步 | 无 | try-catch | N/A | 最低 |
| Thread | 异步 | 无 | 手动 | N/A | 低 |
| Callback | 异步 | 无 | 内联 | 无 | 中 |
| Future | 异步 | 有限 | get() 抛异常 | 无 | 低 |
| CompletableFuture | 异步 | 强 | 异常链 | 无 | 中 |
| 响应式 | 异步 | 强 | 信号传播 | 有 | 高 |

---

## 选型指南

### 小型项目 / 简单场景

```
需求：后台执行一个任务，不关心结果
选择：Thread / Runnable
```

```java
new Thread(() -> sendEmail()).start();
```

### 中型项目 / 需要结果

```
需求：异步执行，需要获取结果
选择：Future / CompletableFuture
```

```java
Future<String> future = executor.submit(() -> query());
String result = future.get(3, TimeUnit.SECONDS);
```

### 中大型项目 / 复杂编排

```
需求：多个异步任务，依赖关系复杂
选择：CompletableFuture
```

```java
CompletableFuture.supplyAsync(() -> queryA())
    .thenCompose(this::queryB)
    .thenCombine(queryC(), this::combine)
    .exceptionally(this::handleError);
```

### 大型项目 / 高并发 / 事件流

```
需求：高并发、需要背压、事件流处理
选择：响应式编程（Reactor/RxJava）
```

```java
flux.filter().map().flatMap()
    .backpressure()
    .subscribe();
```

---

## 实际推荐

### 日常开发推荐

**90% 的场景用 CompletableFuture 就够了**

```java
// 标准异步模式
public CompletableFuture<Result> asyncMethod() {
    return CompletableFuture
        .supplyAsync(() -> doWork(), customExecutor)
        .thenApply(this::transform)
        .thenAccept(this::consume)
        .exceptionally(this::handleError);
}
```

### 团队技术栈建议

| 团队规模 | 推荐技术栈 |
|---------|----------|
| 小团队 / 快速迭代 | CompletableFuture |
| 中团队 / 需要清晰架构 | CompletableFuture + 统一封装 |
| 大团队 / 高并发系统 | CompletableFuture + Reactor |
| 技术储备足 / 微服务 | WebFlux (Reactor) |

---

## 最佳实践总结

### 1. 避免回调地狱

```java
// ❌ 回调地狱
callback1(result1 -> {
    callback2(result2 -> {
        callback3(result3 -> handle(result1, result2, result3));
    });
});

// ✅ CompletableFuture 链式
CompletableFuture.supplyAsync(() -> step1())
    .thenCompose(r1 -> step2(r1))
    .thenCompose(r2 -> step3(r2))
    .thenAccept(this::handle);
```

### 2. 正确处理异常

```java
// ❌ 异常丢失
future.thenApply(this::transform)
    .thenAccept(this::use);

// ✅ 异常处理
future.thenApply(this::transform)
    .exceptionally(ex -> {
        log.error("处理失败", ex);
        return fallback();
    })
    .thenAccept(this::use);
```

### 3. 避免阻塞

```java
// ❌ get() 阻塞
future.get();

// ✅ 链式回调
future.thenApply(this::transform)
    .thenAccept(this::use);
```

### 4. 合理使用线程池

```java
// ✅ IO 密集型：自定义大线程池
ExecutorService ioExecutor = new ThreadPoolExecutor(50, 100, ...);
CompletableFuture.supplyAsync(() -> httpCall(), ioExecutor);

// ✅ CPU 密集型：commonPool
CompletableFuture.supplyAsync(() -> computeHash());
```

---

## 面试追问方向

**Q1：如何从 Callback 迁移到 CompletableFuture？**

```java
// Callback 风格
void callAsync(Callback<T> callback);

// CompletableFuture 风格
CompletableFuture<T> callAsync() {
    CompletableFuture<T> future = new CompletableFuture<>();
    callAsync(new Callback<T>() {
        @Override
        public void onSuccess(T result) {
            future.complete(result);
        }
        
        @Override
        public void onError(Exception e) {
            future.completeExceptionally(e);
        }
    });
    return future;
}
```

**Q2：CompletableFuture 和响应式编程如何选择？**

看需求。如果需要**请求-响应**模式，用 CompletableFuture。如果需要**流式处理**（事件源、背压），用响应式。不要为了技术而技术。

**Q3：CompletableFuture 可以替代同步代码吗？**

可以，但要看场景。简单场景同步更清晰，复杂异步场景用 CompletableFuture。不要为了「异步」而「异步」。
