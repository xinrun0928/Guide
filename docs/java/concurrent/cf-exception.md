# unchecked 异常与 CancellationException 处理

你有没有被 CompletableFuture 的异常绕晕过？

明明抛的是一个 `RuntimeException`，`get()` 出来却是 `CancellationException`？明明代码里没写取消，怎么就取消了？

这一节，把 CompletableFuture 的异常机制讲清楚。

---

## CompletableFuture 的异常类型

### 1. CancellationException

当 `cancel()` 被调用时，抛出 `CancellationException`：

```java
CompletableFuture<Integer> cf = CompletableFuture.supplyAsync(() -> {
    Thread.sleep(5000);
    return 42;
});

// 取消任务
cf.cancel(true);

// 获取结果
try {
    cf.get();
} catch (CancellationException e) {
    System.out.println("任务被取消");  // 输出这句话
} catch (ExecutionException e) {
    System.out.println("执行异常");
} catch (InterruptedException e) {
    System.out.println("线程中断");
}
```

### 2. CompletionException

当任务执行过程中抛出异常时，CompletableFuture 会将其包装成 `CompletionException`：

```java
CompletableFuture.supplyAsync(() -> {
    throw new RuntimeException("原始错误");
})
.get();

// 实际抛出的是：
// ExecutionException
//   └─ Cause: CompletionException
//             └─ Cause: RuntimeException("原始错误")
```

### 3. 异常包装层级

```
原始异常
    ↓
CompletionException（包装一次）
    ↓
ExecutionException（由 get() 抛出时包装）

实际调用 get() 时需要解包两次！
```

---

## 解包获取真实异常

### 错误做法

```java
try {
    future.get();
} catch (ExecutionException e) {
    // ❌ 这样拿到的可能是 CompletionException，不是真正的异常
    System.out.println(e.getMessage());  // 可能只是 "java.lang.RuntimeException"
}
```

### 正确做法

```java
try {
    future.get();
} catch (ExecutionException e) {
    // ✅ 获取真实异常
    Throwable cause = e.getCause();
    
    // 如果是 CompletionException，再解一层
    if (cause instanceof CompletionException) {
        cause = cause.getCause();
    }
    
    // 现在 cause 是真正的异常
    if (cause instanceof RuntimeException) {
        // 处理业务异常
    } else if (cause instanceof IOException) {
        // 处理 IO 异常
    }
}
```

### 封装异常处理工具

```java
public class CompletableFutures {
    
    public static Throwable unwrapCompletionException(Throwable t) {
        if (t instanceof CompletionException) {
            return t.getCause();
        }
        return t;
    }
    
    public static Throwable unwrapExecutionException(Throwable t) {
        if (t instanceof ExecutionException) {
            return unwrapCompletionException(t.getCause());
        }
        return t;
    }
}

// 使用
try {
    future.get();
} catch (ExecutionException e) {
    Throwable realEx = CompletableFutures.unwrapExecutionException(e);
    System.out.println("真实异常：" + realEx.getMessage());
}
```

---

## unchecked 异常的处理

### RuntimeException vs checked Exception

```java
CompletableFuture.supplyAsync(() -> {
    // unchecked 异常
    throw new RuntimeException("unchecked");
    // 不需要 try-catch 或 throws 声明
});
```

```java
CompletableFuture.supplyAsync(() -> {
    // checked 异常
    throw new IOException("checked");
    // 必须声明或捕获
});
```

### 处理 unchecked 异常

```java
CompletableFuture.supplyAsync(() -> {
    if (data == null) {
        throw new NullPointerException("数据为空");
    }
    return process(data);
})
.exceptionally(ex -> {
    // NullPointerException 在这里被捕获
    System.err.println("处理失败：" + ex.getMessage());
    return null;
})
.handle((result, ex) -> {
    if (ex != null) {
        return "降级结果";
    }
    return result;
});
```

---

## CancellationException 的处理

### 什么情况下会触发取消？

1. 调用 `future.cancel(true)`
2. 调用 `future.cancel(false)` 且任务尚未开始
3. 任务内部抛出 `InterruptedException`

```java
CompletableFuture.supplyAsync(() -> {
    try {
        while (running) {
            // 模拟长时间任务
            Thread.sleep(1000);
        }
    } catch (InterruptedException e) {
        // 收到中断信号
        Thread.currentThread().interrupt();
        throw new CancellationException("任务被中断");
    }
    return result;
});
```

### 判断任务是否被取消

```java
// 方法一：检查状态
if (future.isCancelled()) {
    System.out.println("任务已取消");
}

// 方法二：捕获异常
try {
    future.get();
} catch (CancellationException e) {
    System.out.println("任务被取消：" + e.getMessage());
}
```

### 取消 vs 异常完成

```java
// isCancelled() 和 isCompletedExceptionally() 的区别

future.cancel(true);              // isCancelled() = true, isDone() = true
future.completeExceptionally(ex); // isCompletedExceptionally() = true, isDone() = true
future.complete(value);           // 正常完成，isDone() = true
```

---

## isCompletedExceptionally()

判断 CF 是否异常完成。

```java
CompletableFuture<String> cf = CompletableFuture.supplyAsync(() -> {
    throw new RuntimeException("错误");
});

// 此时
cf.isCompletedExceptionally();  // false（还没完成）
cf.join();                     // 触发异常
cf.isCompletedExceptionally();  // true（异常完成了）
```

### 实际应用：检查 allOf 中的失败任务

```java
List<CompletableFuture<Result>> futures = ...;

CompletableFuture.allOf(futures.toArray(new CompletableFuture[0]))
    .thenRun(() -> {
        // 检查每个 CF 的状态
        for (CompletableFuture<Result> future : futures) {
            if (future.isCompletedExceptionally()) {
                System.out.println("发现失败任务！");
                Throwable ex = future.exceptionually(throwable -> throwable).join();
                System.err.println("异常：" + ex.getMessage());
            } else {
                Result result = future.join();
                System.out.println("成功：" + result);
            }
        }
    });
```

---

## join() vs get()

| 对比点 | get() | join() |
|-------|-------|--------|
| 声明异常 | throws InterruptedException, ExecutionException | 不声明（unchecked） |
| 用法 | 必须 try-catch | 可以直接用 |
| 本质 | 一样 | 一样 |

```java
// get()：必须处理检查异常
try {
    Integer result = future.get();
} catch (InterruptedException | ExecutionException e) {
    throw new RuntimeException(e);
}

// join()：直接抛出 unchecked 异常
Integer result = future.join();  // 可能抛出 CompletionException
```

### join() 的使用场景

```java
// 场景一：stream 操作中
List<Integer> results = futures.stream()
    .map(CompletableFuture::join)  // 不能 throws
    .collect(Collectors.toList());

// 场景二：测试代码中
CompletableFuture<String> test = CompletableFuture.completedFuture("test");
assertEquals("test", test.join());

// 场景三：不想写 try-catch 时
CompletableFuture.supplyAsync(() -> query())
    .thenApply(String::toUpperCase)
    .join();  // 直接抛出异常
```

---

## 完整异常处理模式

```java
public CompletableFuture<Result> processWithFullErrorHandling() {
    return CompletableFuture
        .supplyAsync(() -> doProcess())
        
        // 第一层：业务异常恢复
        .handle((result, ex) -> {
            if (ex != null) {
                // 业务异常，尝试恢复
                return tryRecover();
            }
            return result;
        })
        
        // 第二层：确保不为 null
        .thenApply(result -> {
            if (result == null) {
                throw new IllegalStateException("恢复后结果仍为空");
            }
            return result;
        })
        
        // 第三层：统一日志记录
        .whenComplete((result, ex) -> {
            if (ex != null) {
                logger.error("处理最终失败", unwrapException(ex));
            } else {
                logger.info("处理成功");
            }
        })
        
        // 第四层：最终降级
        .exceptionally(ex -> {
            logger.error("降级处理", ex);
            return Result.fallback();
        });
}
```

---

## 面试追问方向

**Q1：为什么 get() 要抛出 ExecutionException？**

`get()` 设计的目的是处理**检查异常**（checked exception）。任务执行中的异常可能是检查异常（如 `IOException`），需要调用方显式处理。`join()` 是后来添加的简化版本，适合快速开发和测试。

**Q2：CancellationException 和普通异常有什么区别？**

`CancellationException` 继承自 `InterruptedException`，表示任务被**主动取消**，而不是执行失败。在处理时应该区分：取消是调用方的决定，可能需要清理资源；异常是执行失败，可能需要重试或降级。

**Q3：exceptionally 中可以重新抛出异常吗？**

可以。但要注意，如果 `exceptionally` 抛出的是普通 `RuntimeException`，它会替代原始异常；如果想保留原始异常，应该用 `throw new CompletionException(original)` 包装。
