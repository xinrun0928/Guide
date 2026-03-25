# CompletableFuture 优势：异步 + 链式编排

你有没有遇到过这种情况：

三个服务需要串行调用，每个服务耗时 1 秒。用 Future，你得等 3 秒。用同步调用，还是 3 秒。

但如果这三个服务可以**同时调用**呢？理论上 1 秒就够了。

这就是 CompletableFuture 要解决的问题。

---

## Future 的三大痛点

JDK 5 引入了 Future，但它只是「能查结果的 Runnable」：

1. **get() 阻塞**：拿到结果之前，调用线程干等着
2. **无法链式调用**：上一步的结果出来了，才能决定下一步
3. **无法组合多个任务**：等这个、同时等那个？Future 做不到

---

## CompletableFuture 的核心优势

JDK 8 引入 CompletableFuture，就是为了解决这些问题：

| 特性 | Future | CompletableFuture |
|-----|--------|-------------------|
| 获取结果 | get() 阻塞 | 非阻塞回调 + get() |
| 链式调用 | 不支持 | 支持 |
| 组合多个 | 不支持 | 支持 |
| 超时控制 | get(timeout) | orTimeout() |
| 手动完成 | 不支持 | complete() |
| 异常处理 | ExecutionException | exceptionally / handle |

---

## 非阻塞：回调取代轮询

Future 的代码：

```java
Future<Integer> future = executor.submit(() -> compute());
// 线程卡在这里等
Integer result = future.get();
```

CompletableFuture 的代码：

```java
CompletableFuture.supplyAsync(() -> compute())
    .thenApply(result -> result * 2)  // 任务完成后自动执行
    .thenAccept(System.out::println);  // 最终结果自动打印
```

**关键区别**：回调注册后，当前线程可以继续做别的事，不用等着。

---

## 链式编排：优雅的任务依赖

假设有这样的业务逻辑：

```
1. 查询用户信息（1秒）
2. 根据用户ID查询订单（1秒）
3. 根据订单查询商品详情（1秒）
```

Future 的写法（串行等）：

```java
Future<User> userFuture = executor.submit(() -> getUser());
User user = userFuture.get(); // 干等1秒

Future<Order> orderFuture = executor.submit(() -> getOrder(user.getId()));
Order order = orderFuture.get(); // 再等1秒

Future<List<Item>> itemFuture = executor.submit(() -> getItems(order.getOrderId()));
List<Item> items = itemFuture.get(); // 又等1秒
// 总计：3秒
```

CompletableFuture 的写法（链式）：

```java
CompletableFuture.supplyAsync(() -> getUser())
    .thenCompose(user -> CompletableFuture.supplyAsync(() -> getOrder(user.getId())))
    .thenCompose(order -> CompletableFuture.supplyAsync(() -> getItems(order.getOrderId())))
    .thenAccept(System.out::println);
// 看起来是链式，实际也是1秒完成
```

等等，这里似乎有问题...让我们分析一下：

> 实际上，`thenCompose` 仍然是串行执行的，只有使用 `thenComposeAsync` 才会并行。但如果业务逻辑本身有依赖关系（必须先拿到用户才能查订单），那这就是正确的实现。真正的并行需要使用 `thenCombine` 或 `allOf`。

---

## 组合多个任务：allOf / thenCombine

多个**不相关**的任务可以并行：

```java
CompletableFuture<User> userFuture = CompletableFuture.supplyAsync(() -> getUser());
CompletableFuture<List<Product>> productFuture = CompletableFuture.supplyAsync(() -> getProducts());
CompletableFuture<Recommend> recommendFuture = CompletableFuture.supplyAsync(() -> getRecommend());

// 三个任务并行执行，总耗时 ≈ max(1秒, 2秒, 1.5秒) ≈ 2秒
CompletableFuture.allOf(userFuture, productFuture, recommendFuture)
    .thenAccept(v -> {
        System.out.println("用户：" + userFuture.join().getName());
        System.out.println("商品：" + productFuture.join().size());
        System.out.println("推荐：" + recommendFuture.join().getReason());
    });
```

---

## 17 个静态工厂方法

CompletableFuture 提供了丰富的创建方式：

```java
// 有返回值的异步任务
supplyAsync(Supplier<U>)           // 使用默认线程池
supplyAsync(Supplier<U>, Executor) // 指定线程池

// 无返回值的异步任务
runAsync(Runnable)                 // 使用默认线程池
runAsync(Runnable, Executor)       // 指定线程池

// 直接创建已完成的 CF
completedFuture(T value)           // 立即返回 value
failedFuture(Throwable ex)         // JDK12+，立即返回异常结果
```

---

## 内部状态机制

CompletableFuture 内部维护了一个复杂的 Completion 状态：

```java
// 内部状态（隐式，通过 Completion 链表体现）
// 当 CF 完成时，会依次触发所有注册的回调

CompletableFuture<Integer> cf = new CompletableFuture<>();

// 注册回调（此时 CF 还没完成）
cf.thenApply(x -> x * 2)
  .thenApply(x -> x + 1)
  .thenAccept(System.out::println);

// 手动完成
cf.complete(42); // 打印 84
```

---

## 一个完整的示例

```java
public class CompletableFutureDemo {
    public static void main(String[] args) throws Exception {
        // 模拟：查询商品详情
        CompletableFuture.supplyAsync(() -> {
            // 模拟数据库查询
            sleep(1000);
            return new Product(1, "iPhone", 9999);
        })
        .thenApply(product -> {
            // 计算折后价
            double discounted = product.getPrice() * 0.8;
            return new Product(product.getId(), product.getName(), discounted);
        })
        .thenAccept(product -> {
            // 发送到前端
            System.out.println("商品：" + product.getName() 
                + "，价格：" + product.getPrice());
        })
        .exceptionally(ex -> {
            // 统一异常处理
            System.err.println("查询失败：" + ex.getMessage());
            return null;
        });
        
        // 主线程继续做其他事
        System.out.println("主线程继续执行...");
        sleep(2000); // 确保异步任务完成
    }
    
    static void sleep(int ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) {}
    }
    
    static class Product {
        private final int id;
        private final String name;
        private final double price;
        // 构造函数、getters...
    }
}
```

---

## 为什么选择 CompletableFuture？

| 场景 | 推荐方案 |
|-----|---------|
| 单个后台任务 + 回调 | CompletableFuture |
| 多个任务并行 + 聚合 | CompletableFuture.allOf() |
| 多个任务串行依赖 | CompletableFuture.thenCompose() |
| CPU 密集 + 数据流固定 | ParallelStream |
| 需要背压的流式处理 | 响应式编程（Reactor/RxJava） |

---

## 面试追问方向

**Q1：CompletableFuture 和 Future 的本质区别是什么？**

Future 是一个「占位符」，代表一个未来会有的值，你只能阻塞等待或者轮询。CompletableFuture 是一个「事件总线」，当值可用时，会主动通知所有等待的消费者。这是一种从「拉」到「推」的模式转变。

**Q2：CompletableFuture 是线程安全的吗？**

是的。CompletableFuture 内部使用 CAS 操作保证状态变更的原子性，所有回调的触发都是线程安全的。但你注册的回调函数本身需要保证线程安全，如果回调中访问共享变量，需要自行同步。

**Q3：CompletableFuture 相比直接用 ExecutorService 有什么优势？**

ExecutorService + Future 只能做到异步执行，无法做到非阻塞的链式调用和任务组合。CompletableFuture 在保持异步执行的基础上，提供了声明式的任务编排能力，代码更简洁，逻辑更清晰。
