# 创建线程：三种方式与背后的思考

为什么有的人写的代码简洁优雅，有的人写的代码又臭又长？

创建线程这件事，有人能用一行代码搞定，有人非要写一个继承体系。问题不在于「能不能跑」，而在于「为什么这样写」。

今天聊聊创建线程的三种方式，以及什么时候该用哪种。

---

## 方式一：继承 Thread 类

```java
class MyThread extends Thread {
    @Override
    public void run() {
        System.out.println("线程执行中...");
    }
}

// 使用
Thread t = new MyThread();
t.start();
```

### 优点

- 简单直接，符合直觉

### 缺点

- Java 单继承，继承 Thread 后无法继承其他类
- 无法获取返回值
- 无法抛出检查异常

### 使用场景

简单的、不需要返回值和异常处理的场景。

```java
// 典型用法：继承 + 重写
Thread logThread = new Thread() {
    @Override
    public void run() {
        logger.write("日志写入");
    }
};
logThread.start();
```

---

## 方式二：实现 Runnable 接口

```java
class MyTask implements Runnable {
    @Override
    public void run() {
        System.out.println("线程执行中...");
    }
}

// 使用
Thread t = new Thread(new MyTask());
t.start();
```

### 优点

- 避免了单继承的限制
- 可以继承其他类
- 任务与线程解耦（`Runnable` 是任务，`Thread` 是载体）

### 缺点

- 无法获取返回值
- 无法抛出检查异常

### 使用场景

这是最常用的方式，符合「任务与执行机制分离」的设计原则。

```java
// Java 8 之后的 lambda 写法，更简洁
Thread t = new Thread(() -> {
    System.out.println("lambda 线程");
});
t.start();
```

---

## 方式三：实现 Callable 接口 + FutureTask

```java
import java.util.concurrent.*;

class MyCallable implements Callable&lt;Integer&gt; {
    @Override
    public Integer call() throws Exception {
        // 模拟耗时计算
        Thread.sleep(1000);
        return 42;
    }
}

// 使用
FutureTask&lt;Integer&gt; future = new FutureTask&lt;&gt;(new MyCallable());
Thread t = new Thread(future);
t.start();

// 获取返回值（会阻塞等待）
try {
    Integer result = future.get(); // 返回 42
    System.out.println("结果：" + result);
} catch (InterruptedException | ExecutionException e) {
    e.printStackTrace();
}
```

### 优点

- **可以获取返回值**
- **可以抛出检查异常**
- 支持泛型指定返回值类型

### 缺点

- 语法相对复杂

### 使用场景

需要获取线程执行结果、或者需要处理异常的场景。

```java
// 实际项目中的典型用法
ExecutorService executor = Executors.newSingleThreadExecutor();
Future&lt;String&gt; future = executor.submit(() -> {
    // 这里可以写复杂逻辑
    return callRemoteService();
});
String result = future.get(); // 获取远程服务返回结果
```

---

## 三种方式对比

| 特性 | 继承 Thread | 实现 Runnable | 实现 Callable + FutureTask |
|------|------------|--------------|--------------------------|
| 返回值 | ❌ | ❌ | ✅ |
| 抛异常 | ❌（只能 try-catch） | ❌ | ✅ |
| 单继承限制 | ✅ 有 | ❌ 无 | ❌ 无 |
| 可复用性 | 一般 | 高 | 高 |
| 代码复杂度 | 低 | 低 | 中 |

---

## 方式四：线程池（更推荐）

上面的三种方式，都是「临时工」模式——用完就扔。但频繁创建/销毁线程开销很大。

**线程池**才是生产环境的主流选择：

```java
// 使用线程池创建线程
ExecutorService executor = Executors.newFixedThreadPool(4);
executor.submit(() -> {
    System.out.println("线程池中的线程执行");
});
executor.shutdown();
```

为什么线程池更好？

1. **复用线程**：不用每次都创建新线程
2. **控制并发数**：防止线程过多耗尽系统资源
3. **统一管理**：方便监控和调优

---

## 演进：从「三种」到「最佳实践」

```
演进历程：

// 第一版：什么都继承 Thread
class MyThread extends Thread { ... }

// 第二版：用 Runnable 解耦
new Thread(new MyTask()).start();

// 第三版：Lambda 简化
new Thread(() -> doSomething()).start();

// 第四版：线程池（生产环境标配）
executor.submit(() -> doSomething());
```

---

## 面试追问方向

**Q：既然 Runnable 能完成任务，为什么还要有 Callable？**

A：Callable 可以返回结果和抛出异常，这是 Runnable 做不到的。但 Callable 需要配合 FutureTask 或线程池使用。

**Q：FutureTask 是什么？它实现了哪些接口？**

A：FutureTask 实现了 `RunnableFuture`，而 `RunnableFuture` 继承了 `Runnable` 和 `Future`。所以 FutureTask 既可以作为 Runnable 交给 Thread 执行，又可以获取 Future 的结果。

**Q：为什么说线程池才是最佳实践？**

A：线程创建和销毁有开销（涉及系统调用），线程池通过复用减少开销，还能控制并发数量，防止资源耗尽。

---

## 留给你的思考题

如果你要执行一个耗时 1 秒的任务，主线程需要获取结果，用哪种方式最合适？

```java
// 你会怎么写？
```

思考一下：如果不用 Callable + Future，还有其他方式吗？各有什么优缺点？
