# CompletableFuture vs ParallelStream vs 响应式编程对比

你知道吗？

Java 有三种「并行」方式：

1. `CompletableFuture` - JDK 8 引入
2. `ParallelStream` - JDK 8 引入
3. 响应式编程 - JDK 9+ Flow API，或 RxJava/Reactor

很多人分不清它们的区别，用错了，性能反而下降。

---

## 三种方案对比

| 特性 | CompletableFuture | ParallelStream | 响应式编程 |
|-----|-----------------|---------------|-----------|
| 引入版本 | JDK 8 | JDK 8 | JDK 9 (Flow) / 外部库 |
| 并行方式 | 显式任务提交 | 数据流自动分片 | 声明式管道 |
| 线程池 | 可自定义 | ForkJoinPool.commonPool | 可自定义 |
| 背压支持 | ❌ | ❌ | ✅ |
| 错误处理 | 异常机制 | 异常机制 | 错误信号 |
| 适用场景 | 异构任务、细粒度控制 | 同构数据处理 | 事件流处理 |

---

## ParallelStream：数据分片的并行处理

### 工作原理

```java
List<Integer> numbers = Arrays.asList(1, 2, 3, 4, 5, 6, 7, 8);

List<Integer> result = numbers.parallelStream()
    .map(this::compute)  // 自动分片并行处理
    .collect(Collectors.toList());
```

```
数据分片：
[1, 2, 3, 4, 5, 6, 7, 8]
  ↓ 分片 ↓
[1,2,3,4]  [5,6,7,8]
  ↓ 并行  ↓
[f(1-4)] [f(5-8)]
  ↓ 合并 ↓
[结果]
```

### 特点

```java
// 优点：简洁，自动并行
List<R> results = data.parallelStream()
    .map(Data::process)
    .filter(Data::isValid)
    .collect(Collectors.toList());

// 缺点：无法细粒度控制
// - 不能指定单个任务的执行
// - 不能处理异构任务
// - 线程池固定
```

---

## CompletableFuture：独立的异步任务

### 工作原理

```java
CompletableFuture<String> cf1 = CompletableFuture.supplyAsync(() -> serviceA());
CompletableFuture<Integer> cf2 = CompletableFuture.supplyAsync(() -> serviceB());
CompletableFuture<Double> cf3 = CompletableFuture.supplyAsync(() -> serviceC());

// 组合结果
CompletableFuture.allOf(cf1, cf2, cf3)
    .thenRun(() -> use(cf1.join(), cf2.join(), cf3.join()));
```

```
独立任务：
cf1: [────── Task A ──────]
cf2: [── Task B ──]
cf3: [──── Task C ────]

并行执行，任务独立，无数据分片
```

### 特点

```java
// 优点：灵活控制
CompletableFuture
    .supplyAsync(() -> queryUser())
    .thenCompose(user -> 
        CompletableFuture.supplyAsync(() -> queryOrders(user))
    )
    .thenAccept(orders -> process(orders))
    .exceptionally(ex -> handle(ex));

// - 可以指定单个任务的线程池
// - 可以链式依赖
// - 可以细粒度异常处理
```

---

## 响应式编程：事件流的声明式处理

### JDK 9 Flow API

```java
SubmissionPublisher<String> publisher = new SubmissionPublisher<>();

publisher.subscribe(new Subscriber<String>() {
    private Subscription subscription;
    
    @Override
    public void onSubscribe(Subscription s) {
        this.subscription = s;
        s.request(1);  // 请求一个数据（背压）
    }
    
    @Override
    public void onNext(String item) {
        process(item);
        subscription.request(1);  // 处理完再请求下一个
    }
    
    @Override
    public void onError(Throwable ex) { }
    
    @Override
    public void onComplete() { }
});

publisher.submit("data");
publisher.close();
```

### Reactor 示例

```java
Mono.just(userId)
    .flatMap(this::fetchUser)
    .flatMap(this::fetchOrders)
    .flatMap(this::fetchProducts)
    .subscribeOn(Schedulers.boundedElastic())
    .timeout(Duration.ofSeconds(3))
    .onErrorResume(ex -> Mono.just(FallbackData.get()))
    .subscribe(System.out::println);
```

---

## 场景对比

### 场景一：并行查询多个接口

**推荐：CompletableFuture**

```java
// CompletableFuture：最佳选择
CompletableFuture<User> userF = supplyAsync(() -> userService.get(id));
CompletableFuture<List<Order>> ordersF = supplyAsync(() -> orderService.getOrders(id));
CompletableFuture<Balance> balanceF = supplyAsync(() -> balanceService.get(id));

allOf(userF, ordersF, balanceF)
    .thenApply(v -> new Dashboard(
        userF.join(), ordersF.join(), balanceF.join()
    ));
```

**不推荐：ParallelStream**

```java
// ParallelStream：不适合这种场景
// ParallelStream 适合处理「数据」，不适合处理「异构任务」
Stream.of(
    userService.get(id),
    orderService.getOrders(id),
    balanceService.get(id)
)
.parallel()  // 这里的 parallel 只是让同步调用并行执行
.collect(Collectors.toList());
```

### 场景二：大数据量批量处理

**推荐：ParallelStream**

```java
// ParallelStream：最佳选择
List<Trade> trades = loadTrades();  // 100万条
double total = trades.parallelStream()
    .filter(Trade::isValid)
    .mapToDouble(Trade::getAmount)
    .sum();
```

**也可以用 CompletableFuture**

```java
// CompletableFuture：需要手动分批
List<List<Trade>> batches = partition(trades, 1000);
List<CompletableFuture<Double>> batchResults = batches.stream()
    .map(batch -> supplyAsync(() -> batch.parallelStream()
        .mapToDouble(Trade::getAmount).sum()))
    .collect(Collectors.toList());

double total = batchResults.stream()
    .mapToDouble(CompletableFuture::join)
    .sum();
```

### 场景三：实时事件流处理

**推荐：响应式编程**

```java
// 响应式：最佳选择
stockStream
    .filter(tick -> tick.getPrice() > threshold)
    .debounce(Duration.ofMillis(100))
    .map(this::calculateSignal)
    .subscribe(this::onSignal);
```

---

## 性能对比

### CPU 密集型任务

```java
// 场景：计算密集（Hash 计算）
// 测试：处理 10000 个任务

// ParallelStream
list.parallelStream()
    .map(this::computeHash)
    .collect(Collectors.toList());
// 耗时：≈ 核心数 × 单线程时间 / 并行度

// CompletableFuture
CompletableFuture<?>[] cfs = list.stream()
    .map(item -> supplyAsync(() -> computeHash(item)))
    .toArray(CompletableFuture[]::new);
allOf(cfs).join();
// 耗时：≈ max(单个任务时间) × 分批数

结论：对于纯 CPU 任务，性能差异不大
```

### IO 密集型任务

```java
// 场景：网络请求（IO 等待）
// 测试：100 个 HTTP 请求，每个 100ms

// ParallelStream
// 问题：使用 commonPool（核心数-1 个线程）
//       100 个请求，8 核机器只有 7 个线程
list.parallelStream()
    .map(this::httpCall)  // 7 个线程处理 100 个请求
    .collect(Collectors.toList());
// 耗时：100 × 100ms / 7 ≈ 1.4 秒

// CompletableFuture（自定义线程池）
ExecutorService executor = newFixedThreadPool(50);
list.stream()
    .map(item -> supplyAsync(() -> httpCall(item), executor))
    .toArray(CompletableFuture[]::new);
// 耗时：100 × 100ms / 50 = 200ms
```

---

## 选型决策树

```
需要并行处理吗？
    │
    ├── 否 → 单线程同步
    │
    └── 是
         │
         ├── 数据流固定，CPU 密集
         │    └── ParallelStream
         │
         ├── 异构任务，需要细粒度控制
         │    └── CompletableFuture
         │
         ├── 需要背压，无限流
         │    └── 响应式编程（Reactor/RxJava）
         │
         └── 混合场景
              └── CompletableFuture + 自定义线程池
```

---

## 混用示例

```java
// 场景：聚合多个商品的数据，每个商品需要多次查询

public CompletableFuture<ProductAggregate> aggregateProducts(List<String> productIds) {
    ExecutorService executor = newFixedThreadPool(50);
    
    // 并行处理多个商品
    List<CompletableFuture<ProductAggregate>> futures = productIds.parallelStream()
        .map(id -> aggregateSingleProduct(id, executor))
        .collect(Collectors.toList());
    
    return allOf(futures.toArray(new CompletableFuture[0]))
        .thenApply(v -> futures.stream()
            .map(CompletableFuture::join)
            .collect(Collectors.toList()));
}

private CompletableFuture<ProductAggregate> aggregateSingleProduct(
        String productId, ExecutorService executor) {
    
    // 单个商品的多个查询用 CompletableFuture 编排
    CompletableFuture<Product> productF = supplyAsync(
        () -> productService.get(productId), executor);
    
    CompletableFuture<Price> priceF = supplyAsync(
        () -> priceService.get(productId), executor);
    
    // ParallelStream 处理同类数据
    CompletableFuture<List<Review>> reviewsF = supplyAsync(
        () -> reviewService.getReviews(productId).stream()
            .filter(Review::isVerified)
            .collect(Collectors.toList()),
        executor);
    
    return allOf(productF, priceF, reviewsF)
        .thenApply(v -> new ProductAggregate(
            productF.join(), priceF.join(), reviewsF.join()));
}
```

---

## 面试追问方向

**Q1：ParallelStream 和 CompletableFuture 共享线程池吗？**

是的，它们默认都使用 `ForkJoinPool.commonPool()`。这意味着如果同时使用，可能相互影响。建议 IO 密集型任务使用自定义线程池。

**Q2：什么时候用 CompletableFuture 而不是 ParallelStream？**

当任务不是数据流形式的异构任务时；当需要细粒度控制异常、超时、依赖链时；当需要为不同任务使用不同线程池时。

**Q3：响应式编程适合什么场景？**

适合事件流处理、需要背压的场景（如数据库到前端的流式传输）、高并发低延迟场景。但学习曲线陡峭，调试困难，不要为了「响应式」而响应式。
