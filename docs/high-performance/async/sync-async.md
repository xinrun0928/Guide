# 同步 vs 异步 vs 回调 vs 事件驱动架构

你一定遇到过这种情况：点了支付按钮，页面转圈等了 10 秒，最后告诉你「系统繁忙」。

这背后，可能是一个同步地狱的故事。

想象一下：如果每次 API 调用都要等待结果返回才继续，用户等待的时间会累加到令人崩溃。而异步编程，正是打破这种等待僵局的关键。

## 同步调用：老老实实排队

同步调用是最直觉的编程模式——调用方发起请求后，**必须等待被调用方返回结果**，才能继续执行后续逻辑。

```java
public String getUserInfo(Long userId) {
    // 调用远程服务，必须等待返回
    User user = remoteService.getUser(userId);
    // 后续处理必须等待上面完成
    return user.getName();
}
```

同步调用的好处是逻辑清晰，代码从上往下读即可理解。但当系统复杂度上升，同步调用的弊端就暴露出来了：

- **性能瓶颈**：每个调用都要等待 IO 完成，线程资源被白白浪费
- **级联失败**：下游服务慢，上游服务也跟着慢，最终拖垮整个系统
- **资源浪费**：等待期间，线程什么事都没做，却占着内存和调度资源

更糟糕的是，如果你需要调用多个服务获取数据，同步模式下只能串行执行：

```java
public OrderDetail getOrderDetail(Long orderId) {
    // 串行调用，总耗时 = A + B + C + D
    Order order = orderService.getOrder(orderId);        // 假设耗时 100ms
    User user = userService.getUser(order.getUserId()); // 假设耗时 200ms
    Product product = productService.getProduct(order.getProductId()); // 假设耗时 150ms
    Payment payment = paymentService.getPayment(order.getPaymentId()); // 假设耗时 80ms
    
    return new OrderDetail(order, user, product, payment); // 总耗时 530ms
}
```

这 530ms 里，线程其实只有少部分时间在真正工作，大部分时间在等待网络 IO。

## 异步调用：不等待的智慧

异步调用的核心思想是：**发起调用后不等待结果，立即返回**，等结果就绪后再通知调用方。

```java
// 同步版本：等待 530ms
OrderDetail detail = getOrderDetail(orderId);

// 异步版本：立即返回 Future，不等待
Future&lt;OrderDetail&gt; futureDetail = asyncGetOrderDetail(orderId);
// 后续代码继续执行，不阻塞
doSomethingElse();

// 需要结果时再获取（可能还没准备好）
OrderDetail detail = futureDetail.get(); // 这时才真正等待
```

如果改成并行调用，总耗时将大幅缩短：

```java
public OrderDetail getOrderDetailAsync(Long orderId) throws Exception {
    // 使用 CompletableFuture 并行调用
    CompletableFuture&lt;Order&gt; orderFuture = 
        CompletableFuture.supplyAsync(() -> orderService.getOrder(orderId));
    CompletableFuture&lt;User&gt; userFuture = 
        CompletableFuture.supplyAsync(() -> userService.getUser(orderId));
    CompletableFuture&lt;Product&gt; productFuture = 
        CompletableFuture.supplyAsync(() -> productService.getProduct(orderId));
    CompletableFuture&lt;Payment&gt; paymentFuture = 
        CompletableFuture.supplyAsync(() -> paymentService.getPayment(orderId));
    
    // 等待所有结果返回
    // 总耗时 = max(100, 200, 150, 80) = 200ms
    CompletableFuture.allOf(orderFuture, userFuture, productFuture, paymentFuture).join();
    
    return new OrderDetail(
        orderFuture.get(),
        userFuture.get(),
        productFuture.get(),
        paymentFuture.get()
    );
}
```

同样的业务逻辑，**从 530ms 降到 200ms**，性能提升超过 2 倍。这就是异步并行的威力。

## 回调函数：异步的结果通知

回调（Callback）是异步编程中处理结果的一种方式。当异步操作完成后，调用预先指定的回调函数来处理结果。

```java
// 模拟异步回调
public void getUserAsync(Long userId, Callback&lt;User&gt; callback) {
    new Thread(() -> {
        User user = remoteService.getUser(userId);
        // 执行回调，回调结果通知
        callback.onSuccess(user);
    }).start();
}

// 使用回调
getUserAsync(1L, new Callback&lt;User&gt;() {
    @Override
    public void onSuccess(User user) {
        System.out.println("获取用户成功: " + user.getName());
    }
    
    @Override
    public void onError(Exception e) {
        System.out.println("获取用户失败: " + e.getMessage());
    }
});
```

回调的优点是解耦了调用和结果处理——调用方发起请求后可以去做其他事，结果来了再处理。

但回调也有「回调地狱」的问题：

```java
// 回调地狱示例
getUserAsync(userId, user -> {
    getOrdersAsync(user.getId(), orders -> {
        getProductsAsync(orders, products -> {
            getRecommendationsAsync(products, recommendations -> {
                // 代码嵌套越来越深，难以阅读和维护
                displayRecommendations(recommendations);
            });
        });
    });
});
```

每次回调都嵌套在上一次回调里，代码像宝丽龙一样层层嵌套，阅读和维护都是噩梦。

## CompletableFuture：告别回调地狱

Java 8 引入的 `CompletableFuture` 解决了回调地狱问题，它提供了链式调用能力：

```java
public CompletableFuture&lt;Recommendation&gt; getRecommendations(Long userId) {
    return CompletableFuture
        .supplyAsync(() -> userService.getUser(userId))
        .thenCompose(user -> 
            CompletableFuture.supplyAsync(() -> orderService.getOrders(user.getId()))
        )
        .thenCompose(orders -> 
            CompletableFuture.supplyAsync(() -> productService.getProducts(orders))
        )
        .thenCompose(products -> 
            CompletableFuture.supplyAsync(() -> 
                recommendationService.getRecommendations(products)
            )
        );
}
```

代码逻辑变成了线性写法，更容易阅读和理解。`thenCompose` 用于串联有依赖关系的异步任务，`thenCombine` 用于合并两个独立的异步任务结果。

## 事件驱动架构：发布-订阅模式

事件驱动架构是另一种异步编程范式。核心思想是：**组件之间不直接调用，而是通过事件进行通信**。

```
┌─────────────┐    发布事件     ┌─────────────┐
│  事件发布者  │ ───────────&gt; │  事件总线    │
└─────────────┘              └─────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
            ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
            │  订阅者 A    │ │  订阅者 B    │ │  订阅者 C    │
            └─────────────┘ └─────────────┘ └─────────────┘
```

事件驱动架构的优势：

- **松耦合**：发布者和订阅者不需要知道彼此的存在
- **可扩展**：可以随时添加新的订阅者，无需修改发布者代码
- **高并发**：事件可以异步处理，不影响主流程

```java
// 定义事件
public class OrderCreatedEvent {
    private Long orderId;
    private LocalDateTime createdAt;
    // getters...
}

// 发布事件
@Service
public class OrderService {
    @Autowired
    private ApplicationEventPublisher eventPublisher;
    
    public void createOrder(Order order) {
        // 创建订单逻辑
        orderRepository.save(order);
        // 发布事件，不关心谁会处理
        eventPublisher.publishEvent(new OrderCreatedEvent(order.getId(), LocalDateTime.now()));
    }
}

// 订阅事件（可以有多个订阅者）
@Component
public class OrderNotificationListener {
    @EventListener
    public void handleOrderCreated(OrderCreatedEvent event) {
        // 发送通知，不影响订单创建流程
        notificationService.sendOrderCreatedNotification(event.getOrderId());
    }
}

@Component
public class OrderAnalyticsListener {
    @EventListener
    public void handleOrderCreated(OrderCreatedEvent event) {
        // 统计数据分析，不影响订单创建流程
        analyticsService.recordOrderCreation(event.getOrderId());
    }
}
```

一个订单创建事件，可以被多个订阅者处理，每个订阅者做不同的事，但互不干扰。这就是事件驱动的魅力。

## 四种模式对比

| 特性 | 同步调用 | 异步调用 | 回调 | 事件驱动 |
|------|---------|---------|------|---------|
| 调用方式 | 阻塞等待 | 非阻塞立即返回 | 非阻塞，通过回调通知 | 发布-订阅，不直接调用 |
| 代码复杂度 | 低 | 中 | 高（回调地狱） | 中 |
| 耦合度 | 高 | 中 | 中 | 低 |
| 适用场景 | 简单流程、需即时结果 | 并行化、IO 密集型 | 单次异步操作 | 多消费者、复杂业务流程 |
| 错误处理 | 简单 try-catch | Future.get() + Exception | 回调 onError | 事件监听器异常 |

## 何时选择何种模式

1. **同步调用**：结果需要立即使用，业务逻辑有强依赖关系
2. **异步调用**：多个任务可并行执行，需要提升吞吐量
3. **回调**：简单的一次性异步操作，嵌套不深时使用
4. **事件驱动**：多系统解耦、一对多通知、需要审计日志

## 总结

同步与异步，是两种截然不同的编程哲学。同步追求的是「确定性」，代码执行顺序清晰明了；异步追求的是「效率」，最大化资源利用率。

没有最好的模式，只有最适合的场景。理解各种模式的优缺点，才能在实际开发中做出正确的选择。

---

## 留给你的问题

假设你有一个微服务系统，其中用户下单后需要触发：库存扣减、支付扣款、物流通知、积分累计、短信通知这 5 个操作。

- 如果用同步调用，总耗时是多少？
- 如果用异步并行，总耗时是多少？
- 如果某些操作之间有依赖关系（比如支付必须先完成才能通知物流），代码应该如何设计？

思考这些问题，能帮助你更好地理解同步与异步的选择。
