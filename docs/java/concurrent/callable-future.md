# Callable、Future、FutureTask 三者关系

你一定写过这样的代码：启动一个线程执行任务，然后干等着结果。

但如果任务执行需要 5 秒、10 秒，甚至更久呢？主线程就这么空等着，CPU 空转？

这就是 `Callable` + `Future` 组合要解决的问题。

---

## Callable 与 Runnable：为什么需要 Callable？

`Runnable` 是 Java 并发的基础接口，但它有两个硬伤：

1. **没有返回值**：`run()` 方法返回 `void`
2. **不能抛异常**：`run()` 方法不能声明抛出 `Checked Exception`

```java
// Runnable 的问题：无法获取任务执行结果
Runnable task = () -> {
    // 执行一些操作
    System.out.println("任务执行完成");
};
// 结果呢？不知道！无法获取任何返回值
```

`Callable` 就是为了解决这两个问题：

```java
public interface Callable<V> {
    V call() throws Exception;
}
```

| 对比项 | Runnable | Callable |
|-------|----------|----------|
| 返回值 | void | V（泛型） |
| 异常 | 不能抛检查异常 | 可以抛检查异常 |
| 执行方式 | Thread.start() / Executor.execute() | Executor.submit() |

```java
// Callable 示例：计算并返回结果
Callable<Integer> task = () -> {
    // 模拟耗时计算
    Thread.sleep(2000);
    return 42;
};
```

---

## Future 接口：异步任务的结果容器

`Future` 是一个接口，代表一个异步计算的结果。你可以：

- **查询是否完成**：`isDone()`
- **获取结果**（阻塞等待）：`get()`
- **获取结果**（超时等待）：`get(timeout, unit)`
- **取消任务**：`cancel()`

```java
public interface Future<V> {
    // 阻塞等待结果，如果任务执行抛出异常，这里会抛出 ExecutionException
    V get() throws InterruptedException, ExecutionException;
    
    // 带超时的 get，避免无限等待
    V get(long timeout, TimeUnit unit) 
        throws InterruptedException, ExecutionException, TimeoutException;
    
    // 查询任务是否完成（包含正常完成、异常、取消）
    boolean isDone();
    
    // 尝试取消任务，mayInterruptIfRunning 表示是否中断正在运行的线程
    boolean cancel(boolean mayInterruptIfRunning);
    
    // 查询任务是否被取消
    boolean isCancelled();
}
```

---

## FutureTask：Future + Runnable 的适配器

`FutureTask` 是 `Future` 的一个实现类，同时实现了 `Runnable` 接口。

这意味着 `FutureTask` 可以交给 `Thread` 执行，也可以交给 `ExecutorService` 执行。

### 创建 FutureTask 的两种方式

```java
// 方式一：包装 Callable（常用）
Callable<Integer> callable = () -> {
    Thread.sleep(2000);
    return 42;
};
FutureTask<Integer> futureTask = new FutureTask<>(callable);
new Thread(futureTask).start();

// 方式二：包装 Runnable + result
// Runnable 执行完毕后，结果就是传入的 result
Runnable runnable = () -> System.out.println("任务完成");
FutureTask<String> futureTask = new FutureTask<>(runnable, "执行成功");
new Thread(futureTask).start();
System.out.println(futureTask.get()); // 输出：执行成功
```

---

## 三者关系：一条完整的调用链

```
Callable<T>
    ↓ 创建
FutureTask<T>（实现 Future + Runnable）
    ↓ 提交
Thread.start() / ExecutorService.submit()
    ↓ 返回
Future<T>（用于获取结果）
```

一个完整的示例：

```java
public class FutureDemo {
    public static void main(String[] args) throws Exception {
        // 1. 创建 Callable
        Callable<Integer> callable = () -> {
            Thread.sleep(1000);
            return 123;
        };
        
        // 2. 包装成 FutureTask
        FutureTask<Integer> futureTask = new FutureTask<>(callable);
        
        // 3. 提交给线程执行
        new Thread(futureTask).start();
        
        // 4. 获取结果（会阻塞等待）
        Integer result = futureTask.get();
        System.out.println("结果：" + result);
    }
}
```

---

## FutureTask 的状态转换

`FutureTask` 内部维护了一个 `state` 状态机：

```
NEW → COMPLETING → NORMAL      (正常完成，返回结果)
                 → EXCEPTIONAL (执行异常)
     → CANCELLED               (被取消，未中断)
     → INTERRUPTING → INTERRUPTED (被取消，中断执行)
```

```java
// FutureTask 内部状态
private volatile int state;
private static final int NEW          = 0;
private static final int COMPLETING   = 1;  // 正在设置结果
private static final int NORMAL       = 2;  // 正常完成
private static final int EXCEPTIONAL  = 3;  // 异常完成
private static final int CANCELLED    = 4;  // 取消（未中断）
private static final int INTERRUPTING  = 5;  // 正在中断
private static final int INTERRUPTED  = 6;  // 已中断
```

状态转换图：

```
         NEW
           │
           ▼
     COMPLETING ────► NORMAL
           │
           ├──► EXCEPTIONAL
           │
           └──► CANCELLED
                    │
                    ▼
              INTERRUPTING
                    │
                    ▼
               INTERRUPTED
```

---

## 面试追问方向

**Q1：FutureTask 的 get() 方法为什么需要抛出那么多异常？**

`get()` 抛出 `InterruptedException`（线程等待时被中断）、`ExecutionException`（任务执行抛出异常）和 `TimeoutException`（等待超时）。这反映了异步任务的多种失败场景。

**Q2：Callable 和 Future 有什么线程安全问题？**

`Callable` 的 `call()` 方法通常由不同线程调用，需要注意线程安全。如果 `Callable` 访问共享变量，需要适当同步。`FutureTask` 本身是线程安全的，内部状态变更都是原子操作。

**Q3：FutureTask 在什么情况下会抛出 CancellationException？**

当调用 `future.cancel(true)` 取消正在执行的任务，且任务响应中断抛出 `InterruptedException` 时，后续调用 `get()` 会抛出 `CancellationException`。
