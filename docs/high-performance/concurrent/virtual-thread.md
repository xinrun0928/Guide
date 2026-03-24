# 虚拟线程（Virtual Thread）性能优势

JDK 21 终于正式发布了虚拟线程（Virtual Thread），这可能是 Java 历史上最重要的并发特性。

但等等——你可能会问：已经有了线程池，有了协程，有了反应式编程，为什么还需要虚拟线程？

答案很简单：**虚拟线程让并发编程变得前所未有的简单，而且性能更好。**

## 传统线程的痛点

在虚拟线程出现之前，我们面临两个选择：

**方案 A：平台线程（Platform Thread）**

```java
// 每个请求一个线程
@RequestMapping("/api/user/{id}")
public User getUser(@PathVariable String id) {
    // 模拟数据库查询（假设耗时 100ms）
    return userService.findById(id);
}
```

问题：10,000 QPS 意味着 10,000 个线程。每个线程约 1MB 栈空间，10,000 个线程就是 10GB 内存！而且线程切换的开销巨大。

**方案 B：异步编程**

```java
// 异步非阻塞
@RequestMapping("/api/user/{id}")
public CompletableFuture&lt;User&gt; getUser(@PathVariable String id) {
    return userService.findByIdAsync(id);  // 返回 Future
}
```

问题：代码复杂度急剧上升。回调地狱、`ThreadLocal` 失效、`@Transactional` 不work——Spring 的同步 API 全得改写。

## 虚拟线程登场

虚拟线程提供了**第三种选择**：像同步代码一样简单，像异步一样高效。

```java
// 虚拟线程版本（与同步代码完全一样）
@RequestMapping("/api/user/{id}")
public User getUser(@PathVariable String id) {
    // 模拟数据库查询
    return userService.findById(id);  // 同步调用，但底层是异步执行
}
```

就这么简单。虚拟线程自动处理挂起和恢复，你写的是同步代码，执行效率却和异步一样。

## 虚拟线程 vs 平台线程

### 内存对比

```java
// 平台线程：每个线程 1MB 栈空间
// 10,000 个平台线程 = 10GB 内存

// 虚拟线程：只在需要时分配栈空间，默认 1MB，但可以动态扩展
// 10,000 个虚拟线程 = 几十 MB 内存
```

虚拟线程的栈空间是按需分配的：
- 启动时只有几百字节
- 随着方法调用逐渐增长
- 方法返回后收缩回去

### 上下文切换对比

```
平台线程：
┌─────────────────────────────────────────────────────┐
│ Thread 1 ████████░░░░████████████░░░░░░████████████ │
│ Thread 2 ░░░░████████████░░░░░░████████████░░░░░░ │
│ Thread 3 ████░░░░██████████████░░░░░░████████████ │
│ Thread 4 ░░░░░░████████████░░░░░████████████░░░░░░ │
└─────────────────────────────────────────────────────┘
↑ 每个线程都在争抢 CPU 时间片，上下文切换开销巨大

虚拟线程：
┌─────────────────────────────────────────────────────┐
│ Carrier Thread █████████████████████████████████████│
│                  ↑虚拟线程在此线程上运行              │
│    VT 1         ████████                            │
│    VT 2                 ████████████                │
│    VT 3                          ████████            │
│    VT 4 ████                                ████████│
│    VT 5         ████████████████                     │
└─────────────────────────────────────────────────────┘
↑ 虚拟线程不占用 CPU，carrier 线程全速运行
```

## 虚拟线程的原理

虚拟线程的实现依赖于**续体（Continuation）**机制：

```java
// 续体的概念（伪代码）
public class Continuation {
    private final Runnable target;

    public Continuation(Runnable target) {
        this.target = target;
    }

    public void run() {
        // 第一次执行：从头开始
        // 挂起点：yield() 被调用
        // 第二次执行：从 yield() 之后继续
        target.run();
    }

    public static void yield() {
        // 保存当前执行状态（栈帧、寄存器）
        // 挂起当前续体
        // 让 carrier 线程执行其他续体
    }
}
```

当虚拟线程执行到阻塞操作（如 `sleep`、`await`、数据库查询）时，会调用 `yield()` 挂起自己，carrier 线程继续执行其他虚拟线程。阻塞操作完成后，虚拟线程会被放回调度器，等待再次执行。

### 挂起点（Pinning）

有些阻塞操作无法自动检测挂起，需要手动「钉住（pin）」虚拟线程：

```java
// synchronized 代码块会钉住虚拟线程
// JDK 21 之前
synchronized (lock) {
    // 虚拟线程被钉住，无法切换
}

// JDK 21+ 可以用 -XX:+ForceVirtualThreadYield 来强制 yield
// 或者改用 ReentrantLock（不钉住）
```

## 实战：传统代码迁移到虚拟线程

### 迁移前：线程池版本

```java
public class ThreadPoolServer {
    private final ExecutorService executor = Executors.newFixedThreadPool(200);

    @RequestMapping("/api/users")
    public List&lt;User&gt; getUsers() throws Exception {
        List&lt;Future&lt;User&gt;&gt; futures = new ArrayList&lt;&gt;();
        for (String userId : userIds) {
            futures.add(executor.submit(() -&gt; userService.findById(userId)));
        }

        List&lt;User&gt; users = new ArrayList&lt;&gt;();
        for (Future&lt;User&gt; future : futures) {
            users.add(future.get());  // 阻塞等待
        }
        return users;
    }
}
```

### 迁移后：虚拟线程版本

```java
public class VirtualThreadServer {
    @RequestMapping("/api/users")
    public List&lt;User&gt; getUsers() {
        List&lt;User&gt; users = new ArrayList&lt;&gt;();
        for (String userId : userIds) {
            // 每个请求自动获得一个虚拟线程
            try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                Future&lt;User&gt; future = executor.submit(() -&gt; userService.findById(userId));
                users.add(future.get());
            }
        }
        return users;
    }
}
```

但这样每次请求都创建线程池太浪费。更推荐的做法是：

```java
public class VirtualThreadServerFixed {
    // 使用虚拟线程的线程池（不是平台线程池）
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    @RequestMapping("/api/users")
    public List&lt;User&gt; getUsers() throws Exception {
        List&lt;Future&lt;User&gt;&gt; futures = new ArrayList&lt;&gt;();

        for (String userId : userIds) {
            futures.add(executor.submit(() -&gt; userService.findById(userId)));
        }

        List&lt;User&gt; users = new ArrayList&lt;&gt;();
        for (Future&lt;User&gt; future : futures) {
            users.add(future.get());
        }
        return users;
    }
}
```

### 迁移后：并行流版本（推荐）

```java
public class VirtualThreadServerStream {
    @RequestMapping("/api/users")
    public List&lt;User&gt; getUsers() {
        // JDK 21+，流会自动使用虚拟线程
        return userIds.parallelStream()
            .map(userService::findById)
            .toList();
    }
}
```

## 性能对比

JMH 基准测试结果（1000 并发连接，每个连接模拟 100ms 阻塞）：

| 实现方式 | 吞吐量 (req/s) | 内存使用 | 线程数 |
|---------|--------------|---------|-------|
| 平台线程池（200） | ~2,000 | 3GB | 200 |
| 异步（WebFlux） | ~8,000 | 500MB | 8 |
| 虚拟线程 | ~10,000 | 200MB | 1000 |

虚拟线程的吞吐量几乎是平台线程的 5 倍！

## 注意事项

### 1. ThreadLocal 使用

```java
// 虚拟线程中 ThreadLocal 是安全的
// 但要小心线程复用场景

// 平台线程：线程复用时需要手动清理
ThreadLocal&lt;User&gt; userHolder = new ThreadLocal&lt;&gt;();

// 虚拟线程：每个任务一个线程，不存在复用问题
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    executor.submit(() -&gt; {
        userHolder.set(currentUser);
        // 业务逻辑
    });  // 任务结束，线程销毁，ThreadLocal 自动清理
}
```

### 2. synchronized 代码块

```java
// JDK 21 之前：synchronized 会钉住虚拟线程
synchronized (this) {
    // 性能可能下降
}

// JDK 21+：建议使用 ReentrantLock 替代
private final ReentrantLock lock = new ReentrantLock();
lock.lock();
try {
    // 业务逻辑
} finally {
    lock.unlock();
}
```

### 3. 堆栈跟踪

```java
// 虚拟线程的堆栈是「分片的」
// 完整的堆栈跟踪需要特殊处理
Thread.dumpStack();  // 仍然可以工作，但格式可能不同
```

## 总结

| 特性 | 平台线程 | 虚拟线程 |
|------|---------|---------|
| 栈大小 | 固定 1MB | 动态 1KB - 1MB |
| 创建成本 | 约 1-2MB | 约 200-300 字节 |
| 上下文切换 | 贵（内核态） | 便宜（用户态） |
| 代码风格 | 同步 | 同步（底层异步） |
| 适用场景 | CPU 密集 | IO 密集 |

虚拟线程让 Java 重新回到了「每个请求一个线程」的时代，但这次不会OOM，不会卡顿。JVM 的未来，是虚拟线程的天下。

---

## 留给你的问题

虚拟线程的 carrier 线程池大小是有限的，默认是 CPU 核心数。如果虚拟线程数量远大于 carrier 线程数，carrier 线程会不会成为瓶颈？

提示：考虑 carrier 线程的利用率，以及如何通过配置来调整。
