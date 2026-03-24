# CompletableFuture 异步编程实战

你用过 Future 吗？

用过？那你一定知道它的痛——主线程调用 `future.get()` 等待结果，如果任务还没完成，线程就阻塞在那儿了。CPU 空转，系统资源浪费。

更糟糕的是，如果需要组合多个 Future，比如「等 A 和 B 都完成后再执行 C」，用原生的 Future 你得自己写一堆回调地狱。

`CompletableFuture` 就是来解决这些问题的。

## Future 的局限

先来看一下传统 Future 的用法：

```java
public class FutureDemo {
    public static void main(String[] args) throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(4);
        Future&lt;String&gt; future = executor.submit(() -&gt; {
            // 模拟耗时操作
            Thread.sleep(1000);
            return "Result";
        });

        // 线程阻塞在这里等待结果
        String result = future.get();  
        System.out.println(result);
        executor.shutdown();
    }
}
```

问题：
1. `get()` 会阻塞调用线程
2. 无法手动完成（complete）Future
3. 无法组合多个 Future
4. 无法注册回调

CompletableFuture 正是针对这些问题设计的。

## CompletableFuture 入门

### 基本用法

```java
public class CompletableFutureBasic {
    public static void main(String[] args) throws Exception {
        // 创建 CompletableFuture
        CompletableFuture&lt;String&gt; cf = new CompletableFuture&lt;&gt;();

        // 在另一个线程中计算结果
        new Thread(() -&gt; {
            try {
                Thread.sleep(1000);
                cf.complete("Hello");  // 手动完成
            } catch (InterruptedException e) {
                cf.completeExceptionally(e);  // 标记异常
            }
        }).start();

        // 主线程等待结果（这里可以用 join，也可以用 get）
        String result = cf.get();
        System.out.println(result);
    }
}
```

### 静态工厂方法

```java
// supplyAsync: 有返回值
CompletableFuture&lt;String&gt; future1 = CompletableFuture.supplyAsync(() -&gt; "result");

// runAsync: 无返回值
CompletableFuture&lt;Void&gt; future2 = CompletableFuture.runAsync(() -&gt; {
    System.out.println("Running async");
});

// 指定线程池
ExecutorService pool = Executors.newFixedThreadPool(4);
CompletableFuture&lt;String&gt; future3 = CompletableFuture.supplyAsync(() -&gt; "result", pool);
```

## 异步编排

CompletableFuture 的精髓在于**链式调用**。

### thenApply: 转换结果

```java
CompletableFuture&lt;String&gt; cf1 = CompletableFuture.supplyAsync(() -&gt; "Hello");
// 把 String 转为 Integer
CompletableFuture&lt;Integer&gt; cf2 = cf1.thenApply(String::length);
System.out.println(cf2.get());  // 输出 5
```

### thenCompose: 扁平化嵌套 Future

```java
public CompletableFuture&lt;User&gt; getUser(String userId) { ... }
public CompletableFuture&lt;Order&gt; getOrder(String orderId) { ... }

// 获取用户后，再获取该用户的订单
CompletableFuture&lt;Order&gt; future = getUser(userId)
    .thenCompose(user -&gt; getOrder(user.getDefaultOrderId()));

// 如果用 thenApply，会得到 CompletableFuture&lt;CompletableFuture&lt;Order&gt;&gt;
```

### thenCombine: 合并两个 Future

```java
CompletableFuture&lt;String&gt; cf1 = CompletableFuture.supplyAsync(() -&gt; "Hello");
CompletableFuture&lt;String&gt; cf2 = CompletableFuture.supplyAsync(() -&gt; " World");

// 合并两个结果
CompletableFuture&lt;String&gt; combined = cf1.thenCombine(cf2, (s1, s2) -&gt; s1 + s2);
System.out.println(combined.get());  // 输出 "Hello World"
```

### allOf / anyOf: 批量等待

```java
// 等待所有 Future 完成
CompletableFuture&lt;String&gt; f1 = CompletableFuture.supplyAsync(() -&gt; "A");
CompletableFuture&lt;String&gt; f2 = CompletableFuture.supplyAsync(() -&gt; "B");
CompletableFuture&lt;String&gt; f3 = CompletableFuture.supplyAsync(() -&gt; "C");

CompletableFuture&lt;Void&gt; all = CompletableFuture.allOf(f1, f2, f3);
all.join();  // 等待所有完成

// 任意一个完成就继续
CompletableFuture&lt;Object&gt; any = CompletableFuture.anyOf(f1, f2, f3);
System.out.println(any.get());  // 输出最先完成的结果
```

## 异常处理

### 异常传播

```java
CompletableFuture&lt;String&gt; future = CompletableFuture
    .supplyAsync(() -&gt; {
        if (true) throw new RuntimeException("Oops!");
        return "result";
    })
    .thenApply(s -&gt; s.toUpperCase())
    .exceptionally(ex -&gt; {
        System.out.println("Caught: " + ex.getMessage());
        return "default";  // 返回默认值
    });

System.out.println(future.get());  // 输出 "default"
```

### handle: 不管成功失败都处理

```java
CompletableFuture&lt;String&gt; future = CompletableFuture
    .supplyAsync(() -&gt; {
        if (true) throw new RuntimeException("Oops!");
        return "result";
    })
    .handle((result, ex) -&gt; {
        if (ex != null) {
            return "default";  // 异常时返回默认值
        }
        return result;  // 正常时返回原值
    });
```

## 实战场景

### 场景一：异步 HTTP 调用

```java
@Service
public class AsyncHttpService {
    private final CloseableHttpAsyncClient httpClient = HttpAsyncClients.createDefault();

    @PostConstruct
    public void init() {
        httpClient.start();
    }

    public CompletableFuture&lt;String&gt; fetch(String url) {
        CompletableFuture&lt;String&gt; future = new CompletableFuture&lt;&gt;();
        httpClient.execute(new HttpGet(url), new FutureCallback&lt;HttpResponse&gt;() {
            @Override
            public void completed(HttpResponse result) {
                future.complete(parse(result));  // 完成 Future
            }

            @Override
            public void failed(Exception ex) {
                future.completeExceptionally(ex);  // 标记异常
            }

            @Override
            public void cancelled() {
                future.cancel(false);
            }
        });
        return future;
    }

    // 组合多个 HTTP 请求
    public CompletableFuture&lt;UserProfile&gt; getUserProfile(String userId) {
        return CompletableFuture
            .supplyAsync(() -&gt; fetchUser(userId))  // 获取用户信息
            .thenCombine(
                fetchUserPosts(userId),  // 获取用户帖子
                (user, posts) -&gt; new UserProfile(user, posts)  // 组合结果
            )
            .thenCombine(
                fetchUserFollowers(userId),  // 获取关注者
                (profile, followers) -&gt; {
                    profile.setFollowers(followers);
                    return profile;  // 最终结果
                }
            );
    }
}
```

### 场景二：并行计算

```java
public class ParallelComputation {
    public double compute(List&lt;Data&gt; dataList, ExecutorService executor) {
        // 把数据分成多个批次，并行计算
        List&lt;CompletableFuture&lt;Double&gt;&gt; futures = dataList.stream()
            .map(data -&gt; CompletableFuture.supplyAsync(() -&gt; computeSingle(data), executor))
            .collect(Collectors.toList());

        // 等待所有结果并求和
        return futures.stream()
            .mapToDouble(CompletableFuture::join)
            .sum();
    }

    private double computeSingle(Data data) {
        // 复杂的计算逻辑
        return Math.sqrt(data.getX() * data.getX() + data.getY() * data.getY());
    }
}
```

### 场景三：超时控制

```java
public CompletableFuture&lt;Result&gt; fetchWithTimeout(String url) {
    CompletableFuture&lt;Result&gt; future = new CompletableFuture&lt;&gt;();

    // 实际执行
    CompletableFuture&lt;Result&gt; fetchFuture = CompletableFuture.supplyAsync(() -&gt; doFetch(url));

    // 超时控制
    CompletableFuture&lt;Result&gt; timeoutFuture = fetchFuture
        .orTimeout(3, TimeUnit.SECONDS)  // 3 秒超时
        .exceptionally(ex -&gt; {
            if (ex instanceof TimeoutException) {
                return Result.timeout();  // 返回超时结果
            }
            throw new RuntimeException(ex);
        });

    return timeoutFuture;
}
```

## 注意事项

### 线程池配置

```java
// 默认使用 ForkJoinPool.commonPool()
// 生产环境建议使用自定义线程池
public class CustomThreadPool {
    private final ExecutorService executor = new ThreadPoolExecutor(
        10, 20, 60L, TimeUnit.SECONDS,
        new LinkedBlockingQueue&lt;&gt;(1000),
        new ThreadFactoryBuilder().setNameFormat("async-%d").build(),
        new ThreadPoolExecutor.CallerRunsPolicy()
    );

    // 在使用 CompletableFuture 时指定线程池
    public &lt;T&gt; CompletableFuture&lt;T&gt; supplyAsync(Supplier&lt;T&gt; supplier) {
        return CompletableFuture.supplyAsync(supplier, executor);
    }
}
```

### 异常丢失问题

```java
// 危险：exceptionally 之后异常被「吞掉」了
CompletableFuture&lt;String&gt; future = CompletableFuture
    .supplyAsync(() -&gt; { throw new RuntimeException(); })
    .thenApply(s -&gt; s.toUpperCase())
    .exceptionally(ex -&gt; null);  // 异常被捕获并返回 null

// future.get() 会正常返回 null，但异常信息丢失了
// 正确做法：明确处理或重新抛出
```

### 串行 vs 并行

```java
// thenApply: 串行执行（b 依赖 a 的结果）
future.thenApply(a -&gt; b);  // 先执行 a，再执行 b

// thenCombine: 并行执行（两者没有依赖）
f1.thenCombine(f2, (r1, r2) -&gt; r1 + r2);  // f1 和 f2 并行执行，然后合并
```

## 总结

CompletableFuture 让异步编程变得优雅：

| 方法 | 说明 |
|------|------|
| supplyAsync / runAsync | 创建异步任务 |
| thenApply / thenAccept | 同步转换 |
| thenCompose | 扁平化嵌套 Future |
| thenCombine | 合并两个独立 Future |
| allOf / anyOf | 批量等待 |
| exceptionally / handle | 异常处理 |
| orTimeout | 超时控制 |

但也要注意：
- 合理配置线程池，避免默认线程池被耗尽
- 注意异常处理，避免异常丢失
- 区分串行和并行，选择合适的组合方式

---

## 留给你的问题

CompletableFuture.allOf() 有一个「坑」——如果有任何一个 Future 异常，其他正常完成的 Future 的结果也会丢失。你知道怎么解决这个问题吗？

提示：考虑使用 handle 或 whenComplete 来保存每个 Future 的结果。
