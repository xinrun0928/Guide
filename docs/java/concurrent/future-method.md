# JDK Future 接口方法详解

`Future` 接口只有 5 个方法，但每个都暗藏玄机。

很多人只会用 `get()`，其他方法从来没碰过。但面试中，面试官问的往往就是你不熟悉的部分。

---

## 方法一览

```java
public interface Future<V> {
    V get() throws InterruptedException, ExecutionException;
    V get(long timeout, TimeUnit unit) 
        throws InterruptedException, ExecutionException, TimeoutException;
    boolean cancel(boolean mayInterruptIfRunning);
    boolean isDone();
    boolean isCancelled();
}
```

---

## get()：阻塞等待结果

`get()` 是最常用的方法，但它的问题也最多。

### 无参数 get()

```java
V get() throws InterruptedException, ExecutionException;
```

调用后，**当前线程会一直阻塞**，直到：

1. 任务正常完成 → 返回结果
2. 任务执行抛出异常 → 抛出 `ExecutionException`
3. 线程被中断 → 抛出 `InterruptedException`
4. **永远不会完成（永远不推荐单独使用）**

```java
Future<Integer> future = executor.submit(() -> {
    Thread.sleep(10000);
    return 42;
});

// 线程会在这里卡住 10 秒
Integer result = future.get();
```

### 带超时 get()

```java
V get(long timeout, TimeUnit unit) 
    throws InterruptedException, ExecutionException, TimeoutException;
```

这个方法才是生产环境的正确选择：

```java
try {
    // 最多等待 3 秒
    Integer result = future.get(3, TimeUnit.SECONDS);
} catch (TimeoutException e) {
    // 超时处理
    System.out.println("任务执行超时，执行降级逻辑");
} catch (ExecutionException e) {
    // 任务执行异常
    Throwable cause = e.getCause();
    cause.printStackTrace();
}
```

### 异常处理：ExecutionException

当任务执行过程中抛出异常时，`get()` 会将其包装成 `ExecutionException`：

```java
Future<Integer> future = executor.submit(() -> {
    throw new RuntimeException("计算错误");
});

try {
    future.get();
} catch (ExecutionException e) {
    // 获取真正的异常
    System.out.println("原始异常：" + e.getCause().getMessage());
}
```

---

## cancel()：尝试取消任务

```java
boolean cancel(boolean mayInterruptIfRunning);
```

这个方法有两个坑：

1. **返回值**：取消成功返回 `true`，任务已经完成或无法取消返回 `false`
2. **mayInterruptIfRunning**：
   - `true`：如果任务正在执行，尝试中断执行线程
   - `false`：如果任务正在执行，什么都不做

```java
Future<Integer> future = executor.submit(() -> {
    while (!Thread.currentThread().isInterrupted()) {
        // 模拟长时间计算
        Thread.sleep(1000);
    }
    return 42;
});

// 尝试取消
boolean cancelled = future.cancel(true);
System.out.println("取消结果：" + cancelled);
System.out.println("是否取消：" + future.isCancelled());
```

### cancel() 的副作用

调用 `cancel(true)` 后：

1. 任务会收到中断信号
2. `isDone()` 返回 `true`
3. `isCancelled()` 返回 `true`
4. 后续调用 `get()` 会抛出 `CancellationException`

---

## isDone()：任务是否完成

```java
boolean isDone();
```

判断任务是否完成，包含以下情况：

| 状态 | isDone() |
|-----|----------|
| 正常完成 | true |
| 执行异常 | true |
| 被取消 | true |
| 还未开始 | false |
| 执行中 | false |

```java
Future<Integer> future = executor.submit(() -> {
    Thread.sleep(5000);
    return 42;
});

while (!future.isDone()) {
    System.out.println("任务还在执行...");
    Thread.sleep(1000);
}
System.out.println("任务完成，结果：" + future.get());
```

---

## isCancelled()：任务是否被取消

```java
boolean isCancelled();
```

专门用于判断任务是否通过 `cancel()` 方法被取消。

---

## FutureTask 状态机详解

`FutureTask` 是 `Future` 的主要实现，它内部维护了完整的状态转换机制：

```
         ┌──────────────────────────────────────┐
         │              NEW                      │
         │   (任务刚创建，尚未开始执行)            │
         └──────────────────────────────────────┘
                        │
                        ▼
         ┌──────────────────────────────────────┐
         │          COMPLETING                   │
         │   (任务执行完，正在设置结果/异常)         │
         └──────────────────────────────────────┘
                │                   │
                │ 正常返回结果        │ 执行异常
                ▼                   ▼
    ┌───────────────────┐  ┌────────────────────┐
    │      NORMAL       │  │    EXCEPTIONAL     │
    │   (正常完成)       │  │   (执行异常)        │
    └───────────────────┘  └────────────────────┘

    ┌───────────────────┐
    │     CANCELLED     │
    │  (取消，未中断)     │
    └───────────────────┘
            │
            │ cancel(true)
            ▼
    ┌───────────────────┐
    │   INTERRUPTING    │
    │   (正在中断中)      │
    └───────────────────┘
            │
            ▼
    ┌───────────────────┐
    │    INTERRUPTED    │
    │   (已中断完成)      │
    └───────────────────┘
```

### 状态与方法的对应关系

```java
public class FutureTaskDemo {
    public static void main(String[] args) throws Exception {
        FutureTask<String> future = new FutureTask<>(() -> {
            Thread.sleep(1000);
            return "done";
        });
        
        new Thread(future).start();
        
        System.out.println("初始状态 isDone: " + future.isDone()); // false
        
        String result = future.get();
        System.out.println("完成后 isDone: " + future.isDone()); // true
    }
}
```

---

## 最佳实践

### 1. 永远不要用无参 get()

```java
// 错误：可能导致永久阻塞
future.get();

// 正确：设置合理的超时时间
future.get(30, TimeUnit.SECONDS);
```

### 2. 异常要解包

```java
try {
    future.get();
} catch (ExecutionException e) {
    // 不要只打印 ExecutionException
    // 要获取真正的根因
    throw (RuntimeException) e.getCause();
}
```

### 3. 取消要考虑线程安全

```java
// 如果任务已经开始执行，cancel() 不会等待任务真正停止
// 任务代码需要正确处理中断
Runnable task = () -> {
    try {
        while (!Thread.currentThread().isInterrupted()) {
            // 处理任务
        }
    } catch (InterruptedException e) {
        // 收到中断信号后正确退出
        Thread.currentThread().interrupt();
    }
};
```

---

## 面试追问方向

**Q1：调用 cancel(true) 后，任务一定会被中断吗？**

不一定。`cancel()` 只是向执行线程发送一个中断请求，如果任务没有响应中断的机制（如没有 `sleep`、`wait`、阻塞 I/O），中断请求会被忽略，任务会继续执行到完成。

**Q2：FutureTask 在并发环境下的安全性是如何保证的？**

`FutureTask` 使用 `volatile` 修饰 `state` 字段保证可见性，通过 `Unsafe` 类的 CAS 操作保证状态转换的原子性。所有状态变更都是通过 `U.compareAndSwapInt()` 完成的。

**Q3：isDone() 和 isCancelled() 有什么区别？**

`isDone()` 包括所有完成情况（正常完成、异常、取消），而 `isCancelled()` 只在任务被取消时返回 `true`。一个被取消的任务，`isDone()` 和 `isCancelled()` 都返回 `true`。
