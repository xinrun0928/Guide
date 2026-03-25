# whenComplete：无论成功失败都执行回调

有时候你需要在任务完成后做些「收尾工作」，不管它是成功还是失败。

比如：记录日志、释放资源、更新状态。

`whenComplete` 就是为此而生的。

---

## whenComplete 基础

```java
public CompletableFuture<T> whenComplete(BiConsumer<? super T, ? super Throwable> action)
public CompletableFuture<T> whenCompleteAsync(BiConsumer<? super T, ? super Throwable> action)
```

### 签名解读

```java
BiConsumer<? super T, ? super Throwable> action
//      ↑ 结果类型              ↑ 异常（可能为 null）
```

- **成功时**：`T result` 是正常结果，`Throwable ex` 是 `null`
- **失败时**：`T result` 是 `null`，`Throwable ex` 是异常

### 简单示例

```java
CompletableFuture.supplyAsync(() -> processOrder())
    .whenComplete((result, ex) -> {
        if (ex != null) {
            // 失败：记录错误日志
            logger.error("订单处理失败", ex);
        } else {
            // 成功：记录成功日志
            logger.info("订单处理成功: {}", result.getOrderId());
        }
        // 无论成功失败，都执行
        cleanup();
    });
```

---

## whenComplete vs thenAccept

| 对比点 | whenComplete | thenAccept |
|-------|-------------|-----------|
| 触发条件 | 成功或异常都触发 | 只有成功时触发 |
| 参数 | `(result, ex)` | `(result)` |
| 异常处理 | 可以处理异常 | 不处理异常 |
| 返回值 | 保持原结果 | 返回 `Void` |

```java
// thenAccept：只关心成功
cf.thenAccept(result -> System.out.println("成功：" + result));

// whenComplete：成功和失败都关心
cf.whenComplete((result, ex) -> {
    if (ex != null) {
        System.err.println("失败：" + ex.getMessage());
    } else {
        System.out.println("成功：" + result);
    }
});
```

---

## whenComplete 不修改结果

**重要**：`whenComplete` 不会修改异步任务的结果，它只是「观察」结果。

```java
CompletableFuture.supplyAsync(() -> "原始结果")
    .whenComplete((result, ex) -> {
        System.out.println("观察到的结果：" + result);
        // 注意：这里不能 return 新值
    })
    .thenAccept(System.out::println);  // 仍然输出：原始结果
```

如果你想在观察的同时修改结果，用 `handle`。

---

## 实际场景

### 场景一：统一记录日志

```java
CompletableFuture.supplyAsync(() -> httpClient.get(url))
    .whenComplete((response, ex) -> {
        if (ex != null) {
            Metrics.record("http_request", "failure");
            logger.warn("请求失败: {}", url);
        } else {
            Metrics.record("http_request", "success");
            logger.debug("请求成功: {}", url);
        }
    });
```

### 场景二：释放资源

```java
Connection conn = connectionPool.getConnection();

CompletableFuture.supplyAsync(() -> {
    return conn.executeQuery(sql);
})
.whenComplete((result, ex) -> {
    // 无论成功失败，都要释放连接
    conn.close();
    
    if (ex != null) {
        logger.error("查询失败，连接已释放", ex);
    }
});
```

### 场景三：更新共享状态

```java
AtomicInteger successCount = new AtomicInteger();
AtomicInteger failureCount = new AtomicInteger();

CompletableFuture.supplyAsync(() -> processTask(i))
    .whenComplete((result, ex) -> {
        if (ex != null) {
            failureCount.incrementAndGet();
        } else {
            successCount.incrementAndGet();
        }
        // 更新进度
        updateProgress(successCount.get(), failureCount.get());
    });
```

---

## whenCompleteAsync：异步执行回调

`whenComplete` 在上一个任务完成的线程中执行回调。

`whenCompleteAsync` 在其他线程中执行回调。

```java
CompletableFuture.supplyAsync(() -> {
    Thread.sleep(1000);
    return "result";
})
.whenComplete((r, e) -> {
    // 在 ForkJoinPool.commonPool() 线程执行
    System.out.println("whenComplete 线程: " + Thread.currentThread().getName());
})
.whenCompleteAsync((r, e) -> {
    // 在另一个 commonPool 线程执行
    System.out.println("whenCompleteAsync 线程: " + Thread.currentThread().getName());
});
```

### 性能考量

```java
// 如果回调很轻量，用 whenComplete（避免线程切换）
cf.whenComplete((r, e) -> incrementCounter());

// 如果回调较重，用 whenCompleteAsync（避免阻塞上游）
cf.whenCompleteAsync((r, e) -> writeToDatabase(r, e));
```

---

## 完整示例：请求生命周期管理

```java
public class RequestLifecycle {
    
    public CompletableFuture<Response> executeRequest(Request request) {
        // 1. 开始计时
        long startTime = System.currentTimeMillis();
        AtomicReference<String> traceId = new AtomicReference<>();
        
        // 2. 生成追踪 ID
        return CompletableFuture
            .supplyAsync(() -> {
                traceId.set(UUID.randomUUID().toString());
                return traceId.get();
            })
            
            // 3. 执行业务逻辑
            .thenCompose(trace -> 
                CompletableFuture.supplyAsync(() -> doBusiness(request))
                    .thenApply(result -> new TracedResult<>(trace, result))
            )
            
            // 4. 无论成功失败，都记录日志和指标
            .whenComplete((tracedResult, ex) -> {
                long duration = System.currentTimeMillis() - startTime;
                
                if (ex != null) {
                    // 失败处理
                    Metrics.recordLatency("request_failure", duration);
                    Metrics.incrementCounter("request_error");
                    logger.error("请求失败 [trace={}] [duration={}ms]", 
                        traceId.get(), duration, ex);
                } else {
                    // 成功处理
                    Metrics.recordLatency("request_success", duration);
                    Metrics.incrementCounter("request_success");
                    logger.info("请求成功 [trace={}] [duration={}ms]", 
                        traceId.get(), duration);
                }
                
                // 释放资源（如果需要）
                releaseResources(request);
            })
            
            // 5. 提取结果或抛出异常
            .thenApply(TracedResult::getResult);
    }
}
```

---

## 异常处理注意事项

### whenComplete 中的异常

如果 `whenComplete` 的回调本身抛出异常：

```java
CompletableFuture.supplyAsync(() -> {
    throw new RuntimeException("原始异常");
})
.whenComplete((result, ex) -> {
    throw new RuntimeException("回调异常");  // 会覆盖原始异常
})
.exceptionally(e -> {
    // 这里捕获的是「回调异常」
    System.out.println("异常：" + e.getMessage());  // 输出：回调异常
    return null;
});
```

### 正确的异常处理

```java
cf.whenComplete((result, ex) -> {
    try {
        // 可能抛出异常的操作
        writeLog(result, ex);
    } catch (Exception e) {
        // 不要让 whenComplete 本身抛出异常
        // 可以记录到另一个日志
        emergencyLogger.error("日志写入失败", e);
    }
});
```

---

## 面试追问方向

**Q1：whenComplete 和 handle 有什么区别？**

`whenComplete` 的回调返回 `void`，不改变原始结果。`handle` 的回调返回 `U`，可以替换原始结果。`handle` 适合需要转换或恢复错误的场景，`whenComplete` 适合纯粹的副作用（如记录日志）。

**Q2：whenComplete 会吞掉异常吗？**

不会。`whenComplete` 只是「观察」异常，不会消除它。如果原始 CF 异常完成，后续的 `exceptionally` 或 `handle` 仍然会感知到异常。

**Q3：为什么 whenComplete 的第二个参数叫 Throwable 而不是 Exception？**

因为不只是 `Exception`，还可能是 `Error`（如 `StackOverflowError`）。`Throwable` 覆盖了所有可抛出的情况，更全面。
