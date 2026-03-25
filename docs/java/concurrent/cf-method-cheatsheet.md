# CompletableFuture 常用方法速查表

CompletableFuture 有 50+ 个方法，乍一看眼花缭乱。

别慌，这张速查表帮你理清脉络。

---

## 方法分类总览

```
┌─────────────────────────────────────────────────────────────┐
│                    CompletableFuture                         │
├─────────────────────────────────────────────────────────────┤
│  创建 ────► 转换 ────► 消费 ────► 组合 ────► 异常 ────► 辅助  │
└─────────────────────────────────────────────────────────────┘
```

---

## 一、创建方法

| 方法 | 说明 | 返回值 |
|-----|------|--------|
| `supplyAsync(Supplier)` | 异步执行，有返回值，默认线程池 | `CompletableFuture<T>` |
| `supplyAsync(Supplier, Executor)` | 异步执行，有返回值，指定线程池 | `CompletableFuture<T>` |
| `runAsync(Runnable)` | 异步执行，无返回值，默认线程池 | `CompletableFuture<Void>` |
| `runAsync(Runnable, Executor)` | 异步执行，无返回值，指定线程池 | `CompletableFuture<Void>` |
| `completedFuture(T)` | 返回已完成的 Future | `CompletableFuture<T>` |
| `failedFuture(Throwable)` | 返回已失败的 Future (JDK12+) | `CompletableFuture<T>` |

```java
// 示例
CompletableFuture<String> f1 = CompletableFuture.supplyAsync(() -> "hello");
CompletableFuture<Void> f2 = CompletableFuture.runAsync(() -> System.out.println("run"));
CompletableFuture<String> f3 = CompletableFuture.completedFuture("done");
```

---

## 二、转换方法（thenApply 系列）

### thenApply：同步转换

```java
<U> CompletableFuture<U> thenApply(Function<? super T, ? extends U> fn)
<U> CompletableFuture<U> thenApplyAsync(Function<? super T, ? extends U> fn)
<U> CompletableFuture<U> thenApplyAsync(Function, Executor)
```

| 方法 | 执行线程 | 适用场景 |
|-----|---------|---------|
| `thenApply` | 上一步的线程 | 快速转换、CPU 密集 |
| `thenApplyAsync` | commonPool 或指定线程池 | IO 操作、耗时转换 |

```java
// thenApply：当前线程执行
CompletableFuture<Integer> result = CompletableFuture
    .completedFuture("42")
    .thenApply(Integer::parseInt);  // "42" → 42

// thenApplyAsync：其他线程执行
CompletableFuture<Integer> result = CompletableFuture
    .supplyAsync(() -> "42")
    .thenApplyAsync(Integer::parseInt);  // 在 commonPool 执行
```

### thenCompose vs thenApply：返回值的区别

```java
// thenApply：Function<T, U>，返回 U
CompletableFuture<User> cf1 = ...;
CompletableFuture<String> cf2 = cf1.thenApply(User::getName);  // User → String

// thenCompose：Function<T, CompletableFuture<U>>，返回 CompletableFuture<U>
// 用于处理「返回值本身就是 Future」的情况
CompletableFuture<User> cf1 = ...;
CompletableFuture<CompletableFuture<Order>> cf2 = cf1.thenApply(user -> getOrderAsync(user.getId()));
CompletableFuture<Order> cf3 = cf1.thenCompose(user -> getOrderAsync(user.getId()));  // 扁平化
```

---

## 三、消费方法（thenAccept / thenRun）

### thenAccept：消费结果

```java
CompletableFuture<Void> thenAccept(Consumer<? super T> action)
CompletableFuture<Void> thenAcceptAsync(Consumer<? super T> action)
CompletableFuture<Void> thenAcceptBoth(
    CompletableFuture<? extends U> other, 
    BiConsumer<? super T, ? super U> action
)
```

### thenRun：不关心结果，只关心完成

```java
CompletableFuture<Void> thenRun(Runnable action)
CompletableFuture<Void> thenRunAsync(Runnable action)
CompletableFuture<Void> runAfterBoth(
    CompletableFuture<?> other, 
    Runnable action
)
```

| 方法 | 关心上一个 CF 结果 | 关心 other CF 结果 | 场景 |
|-----|------------------|------------------|-----|
| `thenAccept` | ✅ | ❌ | 消费单个结果 |
| `thenRun` | ❌ | ❌ | 不关心结果，只关心完成 |
| `thenAcceptBoth` | ✅ | ✅ | 合并两个结果 |
| `runAfterBoth` | ❌ | ❌ | 两个都完成后执行 |

```java
// thenAccept：消费结果
cf.thenAccept(result -> System.out.println("结果：" + result));

// thenRun：只关心完成
cf.thenRun(() -> System.out.println("任务完成"));

// thenAcceptBoth：两个都完成后消费
cf1.thenAcceptBoth(cf2, (r1, r2) -> System.out.println(r1 + r2));
```

---

## 四、组合方法（thenCombine / allOf / anyOf）

### thenCombine：合并两个 CF

```java
<U, V> CompletableFuture<V> thenCombine(
    CompletableFuture<? extends U> other,
    BiFunction<? super T, ? super U, ? extends V> fn
)
```

```java
CompletableFuture<String> name = CompletableFuture.completedFuture("张三");
CompletableFuture<Integer> age = CompletableFuture.completedFuture(25);

CompletableFuture<String> result = name.thenCombine(age, (n, a) -> n + "今年" + a + "岁");
// 结果：张三今年25岁
```

### allOf：等待所有 CF 完成

```java
CompletableFuture.allOf(CompletableFuture<?>... cfs)
```

```java
CompletableFuture.allOf(cf1, cf2, cf3).thenRun(() -> {
    // 所有 CF 都完成后执行
    System.out.println("全部完成");
});
```

### anyOf：任一 CF 完成

```java
CompletableFuture.anyOf(CompletableFuture<?>... cfs)
```

```java
CompletableFuture.anyOf(cf1, cf2, cf3).thenAccept(result -> {
    // 第一个完成的 CF 的结果
    System.out.println("最先完成：" + result);
});
```

---

## 五、异常处理方法

| 方法 | 签名 | 说明 |
|-----|------|-----|
| `exceptionally` | `Function<Throwable, T>` | 异常时返回默认值 |
| `exceptionallyCompose` | `Function<Throwable, CompletableFuture<T>>` | 异常时返回新 CF |
| `whenComplete` | `BiConsumer<T, Throwable>` | 无论成功失败都执行，不改结果 |
| `handle` | `BiFunction<T, Throwable, U>` | 无论成功失败都执行，可以返回新值 |
| `obtrudeException` | `void` | 强制设置异常 |

```java
// exceptionally：异常时返回默认值
cf.exceptionally(ex -> {
    System.err.println("出错了：" + ex.getMessage());
    return "默认值";
});

// whenComplete：记录日志，无论成功失败
cf.whenComplete((result, ex) -> {
    if (ex != null) {
        logger.error("失败", ex);
    } else {
        logger.info("成功：{}", result);
    }
});

// handle：统一处理，可以转换结果
cf.handle((result, ex) -> {
    if (ex != null) {
        return "降级结果";
    }
    return result;
});
```

---

## 六、辅助方法

### 超时处理（JDK 9+）

```java
// 超时后抛出 TimeoutException
CompletableFuture<T> orTimeout(long timeout, TimeUnit unit)

// 超时后返回默认值
CompletableFuture<T> completeOnTimeout(T value, long timeout, TimeUnit unit)
```

```java
cf.orTimeout(3, TimeUnit.SECONDS)
  .exceptionally(ex -> {
      throw new RuntimeException("超时：" + ex.getMessage());
  });
```

### 查询方法

```java
boolean isDone()           // 是否完成
boolean isCompletedExceptionally()  // 是否异常完成
boolean isCancelled()     // 是否被取消
```

### 强制完成

```java
boolean complete(T value)           // 手动完成
boolean completeExceptionally(Throwable ex)  // 手动标记异常
void obtrudeValue(T value)         // 强制设置结果
void obtrudeException(Throwable ex) // 强制设置异常
```

---

## 七、对比速查表

### thenApply vs thenAccept vs thenRun

| 方法 | 参数类型 | 返回值 | 用途 |
|-----|--------|--------|-----|
| `thenApply` | `Function<T, U>` | `CompletableFuture<U>` | 转换结果 |
| `thenAccept` | `Consumer<T>` | `CompletableFuture<Void>` | 消费结果 |
| `thenRun` | `Runnable` | `CompletableFuture<Void>` | 不关心结果，只关心完成 |

### thenApply vs thenCompose

| 对比点 | thenApply | thenCompose |
|-------|-----------|-------------|
| Function 类型 | `T → U` | `T → CompletableFuture<U>` |
| 返回类型 | `CompletableFuture<U>` | `CompletableFuture<U>` |
| 适用场景 | 普通转换 | 返回值本身是 CF |

### thenCombine vs allOf

| 对比点 | thenCombine | allOf |
|-------|------------|-------|
| CF 数量 | 2个 | 多个 |
| 回调参数 | 两者的结果 | Void |
| 返回值 | 有（BiFunction 的返回值） | Void |

---

## 实战代码模板

### 模板一：链式调用

```java
CompletableFuture.supplyAsync(() -> step1())
    .thenCompose(this::step2Async)      // 返回 CF
    .thenApply(this::transform)          // 返回值转换
    .thenAccept(this::consume)           // 消费结果
    .exceptionally(this::handleError);   // 异常处理
```

### 模板二：并行+聚合

```java
CompletableFuture<U1> cf1 = supplyAsync(() -> query1());
CompletableFuture<U2> cf2 = supplyAsync(() -> query2());
CompletableFuture<U3> cf3 = supplyAsync(() -> query3());

cf1.thenCombine(cf2, (r1, r2) -> merge(r1, r2))
   .thenCombine(cf3, (r12, r3) -> merge(r12, r3))
   .thenAccept(this::useResult)
   .exceptionally(this::handleError);
```

### 模板三：allOf 批量处理

```java
List<CompletableFuture<T>> futures = items.stream()
    .map(item -> supplyAsync(() -> process(item)))
    .collect(Collectors.toList());

CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
    .thenRun(() -> {
        futures.forEach(f -> System.out.println(f.join()));
    });
```

---

## 面试追问方向

**Q1：thenApply 和 thenApplyAsync 有什么区别？什么时候用哪个？**

`thenApply` 在上一个任务执行的线程中执行，适合快速转换操作，避免线程切换开销。`thenApplyAsync` 在其他线程执行，适合耗时操作。如果你的转换操作很快（只是做个计算），用 `thenApply`；如果涉及 IO 或耗时操作，用 `thenApplyAsync`。

**Q2：exceptionally 和 handle 都能处理异常，有什么区别？**

`exceptionally` 只在异常时执行，返回值类型是 T；`handle` 不论成功失败都会执行，返回值类型可以不同。`exceptionally` 适合返回降级默认值，`handle` 适合统一处理逻辑（成功和失败走不同的分支）。

**Q3：allOf 返回的 CompletableFuture<Void> 怎么获取各个任务的结果？**

`allOf` 只保证所有任务完成，不会传递结果。你需要保留对原始 Future 的引用，在回调中通过 `cf.join()` 获取结果。如果有任务失败，`allOf` 不会自动感知，需要在回调中手动检查每个 Future 是否异常完成。
