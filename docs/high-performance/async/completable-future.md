# CompletableFuture 异步编排实战

当你需要调用多个服务获取数据，然后组合结果时，你会怎么写？

如果还是这样：

```java
User user = userService.getUser(userId);
List&lt;Order&gt; orders = orderService.getOrders(userId);
List&lt;Product&gt; products = productService.getProducts(orders);
List&lt;Recommendation&gt; recommendations = recommendService.getRecommendations(products);
```

——那么你错失了异步并行的巨大性能提升机会。

`CompletableFuture` 是 Java 8 引入的异步编程利器，它让你用**同步的写法，写出异步的性能**。

## CompletableFuture 基础

### 创建 CompletableFuture

```java
public class CompletableFutureDemo {
    
    // 1. 使用 supplyAsync 创建有返回值的异步任务
    public CompletableFuture&lt;String&gt; getData() {
        return CompletableFuture.supplyAsync(() -> {
            // 模拟耗时操作
            try { Thread.sleep(1000); } catch (InterruptedException e) {}
            return "Data loaded";
        });
    }
    
    // 2. 使用 runAsync 创建无返回值的异步任务
    public CompletableFuture&lt;Void&gt; processData() {
        return CompletableFuture.runAsync(() -> {
            // 模拟耗时操作
            try { Thread.sleep(1000); } catch (InterruptedException e) {}
            System.out.println("Data processed");
        });
    }
    
    // 3. 指定线程池
    public CompletableFuture&lt;String&gt; getDataWithPool(ExecutorService pool) {
        return CompletableFuture.supplyAsync(() -> {
            return "Data loaded";
        }, pool);
    }
}
```

### 获取结果

```java
CompletableFuture&lt;String&gt; future = getData();

// 阻塞等待
String result = future.get(); // 抛出受检异常
String result = future.join(); // 不抛受检异常

// 带超时
try {
    String result = future.get(5, TimeUnit.SECONDS);
} catch (TimeoutException e) {
    // 超时处理
}

// 同步获取（检查完成状态）
if (future.isDone()) {
    System.out.println(future.getNow("default"));
}
```

## 异步编排：链式调用

`CompletableFuture` 的精髓在于**链式编排**，多个异步任务可以串联、并联、组合。

### 串联：thenApply / thenCompose

**`thenApply`**：上一步结果传给下一步，**有返回值**

```java
CompletableFuture&lt;Long&gt; userIdFuture = CompletableFuture
    .supplyAsync(() -> getToken())
    .thenApply(token -> parseUserId(token));

System.out.println(userIdFuture.join()); // 同步等待最终结果
```

**`thenCompose`**：上一步结果是一个 `CompletableFuture`，需要**展平**（FlatMap）

```java
// 场景：先获取用户，再通过用户获取订单
public CompletableFuture&lt;User&gt; getUser(String token) { /*...*/ }
public CompletableFuture&lt;List&lt;Order&gt;&gt; getOrders(User user) { /*...*/ }

// 错误写法：返回 CompletableFuture&lt;CompletableFuture&lt;List&lt;Order&gt;&gt;&gt;
future.thenApply(user -> getOrders(user));

// 正确写法：使用 thenCompose 展平
CompletableFuture&lt;List&lt;Order&gt;&gt; ordersFuture = userFuture
    .thenCompose(user -> getOrders(user));
```

### 并联：thenCombine / allOf

**`thenCombine`**：两个独立的 CompletableFuture **都完成后**，合并结果

```java
CompletableFuture&lt;User&gt; userFuture = getUser(userId);
CompletableFuture&lt;List&lt;Product&gt;&gt; productFuture = getProducts();

// 合并两个结果
CompletableFuture&lt;UserProducts&gt; combinedFuture = userFuture
    .thenCombine(productFuture, (user, products) -> 
        new UserProducts(user, products)
    );
```

**`allOf`**：等待**所有** CompletableFuture 完成

```java
CompletableFuture&lt;User&gt; userFuture = getUser(userId);
CompletableFuture&lt;List&lt;Order&gt;&gt; orderFuture = getOrders(userId);
CompletableFuture&lt;Account&gt; accountFuture = getAccount(userId);

CompletableFuture.allOf(userFuture, orderFuture, accountFuture).join();

// 获取结果（确保所有都完成后再获取）
User user = userFuture.join();
List&lt;Order&gt; orders = orderFuture.join();
Account account = accountFuture.join();
```

### 异常处理：exceptionally / handle

**`exceptionally`**：捕获异常，返回默认值

```java
CompletableFuture&lt;User&gt; userFuture = getUser(userId)
    .exceptionally(ex -> {
        log.error("获取用户失败", ex);
        return new User(); // 返回默认用户
    });
```

**`handle`**：无论成功还是异常都能处理

```java
CompletableFuture&lt;String&gt; resultFuture = getData()
    .handle((result, ex) -> {
        if (ex != null) {
            log.error("获取数据失败", ex);
            return "default"; // 异常时返回默认值
        }
        return transform(result); // 成功时处理结果
    });
```

### 先执行：thenRun / thenAccept

**`thenRun`**：上一步完成后，执行一个**不需要参数**的操作

```java
CompletableFuture.supplyAsync(() -> loadData())
    .thenRun(() -> System.out.println("数据加载完成"));
```

**`thenAccept`**：上一步完成后，**消费**结果，不返回新值

```java
CompletableFuture.supplyAsync(() -> loadData())
    .thenAccept(data -> System.out.println("收到数据: " + data));
```

## 实战案例：用户首页数据聚合

### 需求分析

用户打开首页，需要展示：
1. 用户基本信息（昵称、头像、等级）
2. 未读消息数
3. 最近 3 笔订单
4. 推荐商品（5 个）

其中，步骤 1、2、3 可以并行执行，步骤 4 依赖步骤 3 的结果（根据最近购买的商品推荐相似商品）。

### 实现代码

```java
@Service
public class HomePageService {
    
    @Autowired
    private UserService userService;
    
    @Autowired
    private MessageService messageService;
    
    @Autowired
    private OrderService orderService;
    
    @Autowired
    private ProductService productService;
    
    public HomeVO getHomePage(Long userId) {
        long startTime = System.currentTimeMillis();
        
        // 第一批：可以并行的请求
        CompletableFuture&lt;User&gt; userFuture = CompletableFuture
            .supplyAsync(() -> userService.getUser(userId), executor);
        
        CompletableFuture&lt;Integer&gt; unreadCountFuture = CompletableFuture
            .supplyAsync(() -> messageService.getUnreadCount(userId), executor);
        
        CompletableFuture&lt;List&lt;Order&gt;&gt; recentOrdersFuture = CompletableFuture
            .supplyAsync(() -> orderService.getRecentOrders(userId, 3), executor);
        
        // 第二批：依赖第一批结果的请求
        // 当 recentOrdersFuture 完成时，触发获取推荐商品
        CompletableFuture&lt;List&lt;Product&gt;&gt; recommendationsFuture = recentOrdersFuture
            .thenCompose(orders -> {
                List&lt;Long&gt; productIds = orders.stream()
                    .map(Order::getProductId)
                    .collect(Collectors.toList());
                return CompletableFuture.supplyAsync(
                    () -> productService.getRecommendations(productIds, 5), 
                    executor
                );
            });
        
        // 等待所有请求完成
        CompletableFuture.allOf(
            userFuture, 
            unreadCountFuture, 
            recentOrdersFuture, 
            recommendationsFuture
        ).join();
        
        // 组装结果
        HomeVO homeVO = new HomeVO();
        homeVO.setUser(userFuture.join());
        homeVO.setUnreadCount(unreadCountFuture.join());
        homeVO.setRecentOrders(recentOrdersFuture.join());
        homeVO.setRecommendations(recommendationsFuture.join());
        
        log.info("首页加载耗时: {}ms", System.currentTimeMillis() - startTime);
        return homeVO;
    }
}
```

### 性能分析

```
同步执行时间 = user + message + order + recommendations
            = 100ms + 50ms + 150ms + 200ms = 500ms

异步并行执行时间 = max(user, message, order) + recommendations
               = max(100, 50, 150) + 200 = 350ms

如果 recommendations 不依赖 order（可完全并行）：
异步并行执行时间 = max(user, message, order, recommendations)
               = max(100, 50, 150, 200) = 200ms
```

## CompletableFuture 的坑

### 坑 1：线程池饥饿

如果所有任务都用同一个线程池，且某个任务阻塞，会导致整个线程池阻塞。

```java
// 错误：异步任务又调用了异步方法，形成嵌套
supplyAsync(() -> asyncMethod1())  // 用 executor
    .thenCompose(r -> asyncMethod2()) // thenCompose 也会用 executor！
```

解决方案：为不同类型的任务配置不同的线程池。

### 坑 2：没有 timeout

`CompletableFuture` 默认不会超时，需要手动处理：

```java
CompletableFuture&lt;User&gt; future = getUser(userId)
    .orTimeout(3, TimeUnit.SECONDS)  // Java 9+
    .exceptionally(ex -> {
        if (ex instanceof TimeoutException) {
            return User.defaultUser(); // 超时返回默认用户
        }
        throw new CompletionException(ex);
    });
```

### 坑 3：thenApply 与 thenApplyAsync 的区别

```java
// thenApply：上一个任务的线程继续执行
future.thenApply(data -> {
    // 可能在 ForkJoinPool.commonPool() 线程执行
    return transform(data);
});

// thenApplyAsync：切换到公共线程池执行
future.thenApplyAsync(data -> {
    // 在不同的线程执行
    return transform(data);
});

// 指定线程池
future.thenApplyAsync(data -> {
    return transform(data);
}, customExecutor);
```

## 高级用法

### 任意一个完成：anyOf

```java
CompletableFuture&lt;User&gt; userFuture = getUserFromCache(userId);
CompletableFuture&lt;User&gt; userFromDbFuture = getUserFromDb(userId);

// 谁先完成就用谁
CompletableFuture&lt;User&gt; winner = userFuture.applyToEither(
    userFromDbFuture, 
    user -> user
);
```

### 先完成的处理：handle

```java
// 只要有一个完成就继续，不等待所有完成
CompletableFuture&lt;User&gt; userFuture = getUser(userId);
CompletableFuture&lt;Account&gt; accountFuture = getAccount(userId);

userFuture.acceptEither(accountFuture, result -> {
    // 处理先返回的结果
    log.info("先收到结果: {}", result);
});
```

### 手动完成：complete

```java
CompletableFuture&lt;String&gt; future = new CompletableFuture&lt;&gt;();

new Thread(() -> {
    try {
        // 模拟业务处理
        String result = doSomething();
        future.complete(result); // 手动标记完成
    } catch (Exception e) {
        future.completeExceptionally(e); // 标记异常
    }
}).start();
```

## 总结

`CompletableFuture` 是 Java 异步编程的核心工具：

| 方法 | 作用 | 返回值 |
|------|------|--------|
| `supplyAsync` | 创建异步任务 | CompletableFuture&lt;T&gt; |
| `thenApply` | 串联转换 | CompletableFuture&lt;R&gt; |
| `thenCompose` | 串联展平 | CompletableFuture&lt;R&gt; |
| `thenCombine` | 并联合并 | CompletableFuture&lt;R&gt; |
| `allOf` | 等待所有 | CompletableFuture&lt;Void&gt; |
| `anyOf` | 任意一个完成 | CompletableFuture&lt;Object&gt; |
| `exceptionally` | 异常处理 | CompletableFuture&lt;T&gt; |

掌握这些方法，你就能用同步的写法写出高性能的异步代码。

---

## 留给你的问题

假设你需要实现一个「比价功能」：用户输入商品名称，系统同时向京东、淘宝、拼多多三家电商发起查询，返回最便宜的价格和来源。

1. 三个请求相互独立，如何用 `CompletableFuture` 并行调用？
2. 如果用户设置了超时时间（比如 2 秒），如何实现？
3. 如果三家都超时了，返回什么？缓存里的历史价格？还是报错？

思考这些问题，能帮助你理解 `CompletableFuture` 在实际业务中的应用。
