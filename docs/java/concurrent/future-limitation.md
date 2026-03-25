# Future 的三大局限性

你用 Future 写了几行代码，兴冲冲地跑起来，然后发现——

**不对，这不是我想要的。**

Future 看似美好：异步执行、获取结果。但当你真正用它来解决实际问题时会发现，它处处受限，简直是「甜蜜的陷阱」。

---

## 痛点一：get() 阻塞——异步变成了伪异步

`Future.get()` 是阻塞的。这意味着什么？

```java
Future<Integer> future = executor.submit(() -> {
    // 模拟耗时操作
    Thread.sleep(3000);
    return 42;
});

// 你以为这里可以继续干别的事？
System.out.println("继续做其他事情...");

// 错了！get() 会阻塞在这里
Integer result = future.get(); // 至少等 3 秒
System.out.println("拿到结果：" + result);
```

你以为 `submit()` 之后就可以干别的事了？想多了。`get()` 一调用，当前线程就卡住了，直到结果出来。

这跟同步调用有什么区别？唯一的区别是：你多创建了一个线程来「等」。

---

## 痛点二：无法链式调用——回调地狱的前奏

假设你有三个依赖的异步任务：

```
用户验证 → 查询用户信息 → 查询用户订单
```

用 Future 怎么写？

```java
// 第一层
Future<User> userFuture = executor.submit(() -> validateUser(token));

// 等待第一步完成，再执行第二步
Future<Order> orderFuture = userFuture.get() == null ? null : 
    executor.submit(() -> queryOrder(userFuture.get().getUserId()));

// 等待第二步完成，再执行第三步
Future<List<Item>> itemFuture = orderFuture.get() == null ? null :
    executor.submit(() -> queryItems(orderFuture.get().getOrderId()));
```

**这是灾难。**

每一步都要等上一步的 `get()` 返回，才能决定下一步该怎么做。代码被硬生生地「同步化」了，异步的优势完全丧失。

---

## 痛点三：无法组合多个 Future

现实场景往往是：同时发起多个请求，等它们都完成后再处理。

```java
Future<User> userFuture = executor.submit(() -> getUser());
Future<List<Product>> productFuture = executor.submit(() -> getProducts());
Future<Recommend> recommendFuture = executor.submit(() -> getRecommend());

// 想等所有请求都完成？Future 没有这个能力
// 只能这样写：
while (!userFuture.isDone() || !productFuture.isDone() || !recommendFuture.isDone()) {
    Thread.sleep(100); // 疯狂轮询，浪费 CPU
}
```

轮询 `isDone()`？这不是在侮辱 CPU 吗？

---

## 痛点四：轮询 isDone() 的代价

有人说了：我不用 `get()` 阻塞，我轮询 `isDone()` 总行了吧？

```java
Future<Integer> future = executor.submit(() -> compute());

while (!future.isDone()) {
    // 做其他事情？
    // 不，你只能在这空转或者 sleep
    Thread.sleep(100);
}
Integer result = future.get();
```

问题在于：

1. **CPU 浪费**：即使 sleep 也会消耗调度资源
2. **不精确**：`isDone()` 返回 true 只表示任务完成，不表示你能拿到结果（可能中间出错了）
3. **粒度粗**：你无法知道任务进展到哪一步了

---

## 痛点五：无法手动完成

`Future` 的设计是「单向」的：提交任务 → 等待结果。

但有时候，你需要**手动触发** Future 完成：

```java
// 场景：异步队列消费者，处理完成后通知等待方
CompletableFuture<String> future = new CompletableFuture<>();

// 某个线程处理完成后：
future.complete("处理结果");

// 另一个线程等待结果：
String result = future.get(); // 立即返回
```

`Future` 根本不支持这种模式。你无法把一个 `Future` 交给别人，让别人在合适的时机「填入」结果。

---

## 对比：Future vs CompletableFuture

| 特性 | Future | CompletableFuture |
|-----|--------|-------------------|
| 获取结果 | get() 阻塞 | get() / join() / thenApply() |
| 链式调用 | 不支持 | 支持 |
| 组合多个 | 不支持 | allOf() / anyOf() / thenCombine() |
| 超时控制 | get(timeout) | orTimeout() / completeOnTimeout() |
| 手动完成 | 不支持 | complete() |
| 异常处理 | get() 抛出 ExecutionException | exceptionally() / handle() |

---

## 总结

Future 的局限，本质上是**设计上的妥协**：

> 它解决了「异步执行」的问题，但没能解决「异步协作」的问题。

当你只有一个异步任务时，Future 够用。但现实中的异步任务往往是有依赖关系的，是需要组合的，是需要非阻塞处理的。

`CompletableFuture` 正是为了解决这些问题而生的。

---

## 留给你的问题

假设你有 5 个互不依赖的异步任务，每个执行时间都是 2 秒。

- 用 Future：需要多少时间？
- 用 CompletableFuture 组合：需要多少时间？
- 如果让你自己实现一个非阻塞的「等待所有任务完成」，你会怎么做？
