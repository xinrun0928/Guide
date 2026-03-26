# Dubbo 线程模型：IO 线程与业务线程分离

凌晨 3 点，你被报警叫醒：「服务响应时间 P99 超过 10 秒」。

你打开监控一看，CPU 使用率不高，内存也够，网络也没问题。但为什么响应这么慢？

排查了一圈，发现问题出在**线程池**——业务线程池被打满了，请求在排队等待。

这是微服务中非常经典的问题：**IO 线程和业务线程没有正确分离**。

今天，我们来彻底搞清楚 Dubbo 的线程模型。

## 从 BIO 到 NIO：Dubbo 线程模型的演进

### 远古时代：BIO 模型

早期的 RPC 框架（如 Java RMI）使用的是 BIO（Blocking I/O）模型：

```
┌─────────────────────────────────────────────────────────┐
│                    BIO 模型                              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   Client A ──请求──→  Thread A ──处理──→  Server       │
│   Client B ──请求──→  Thread B ──处理──→               │
│   Client C ──请求──→  Thread C ──处理──→               │
│                                                         │
│   问题：线程数 = 并发连接数，线程开销巨大                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

每个请求占用一个线程，请求 IO 操作时线程阻塞。1000 个并发请求，就需要 1000 个线程。

### 进化：NIO 模型

Netty 出现后，Dubbo 采用了 NIO（Non-Blocking I/O）模型：

```
┌─────────────────────────────────────────────────────────┐
│                    NIO 模型（单 Reactor）                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ┌──────────────────────────────────────────────────┐  │
│   │              NIO EventLoop（IO 线程）            │  │
│   │                                                   │  │
│   │   Client A ──请求──→ Channel Handler（处理）      │  │
│   │   Client B ──请求──→ Channel Handler（处理）      │  │
│   │   Client C ──请求──→ Channel Handler（处理）      │  │
│   │                                                   │  │
│   └──────────────────────────────────────────────────┘  │
│                                                         │
│   问题：IO 线程直接处理业务逻辑，如果业务慢，IO 也会阻塞   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

一个 IO 线程可以处理多个连接，但 IO 线程直接处理业务逻辑会导致 IO 线程被阻塞，影响其他请求。

### 成熟：线程池分离

现在主流的方案是**线程池分离**：

```
┌─────────────────────────────────────────────────────────┐
│              Dubbo 线程模型（IO + 业务分离）               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ┌─────────────────────┐     ┌─────────────────────┐  │
│   │   Netty IO 线程池   │────→│    业务线程池        │  │
│   │   (EventLoopGroup)  │     │    (Dubbo ThreadPool)│  │
│   │                      │     │                      │  │
│   │  - 接收请求          │     │  -执行业务逻辑       │  │
│   │  - 事件分发          │     │  -返回结果           │  │
│   │  - 编解码            │     │                      │  │
│   └─────────────────────┘     └─────────────────────┘  │
│                                                         │
│   关键点：IO 线程和业务线程分开，互不影响                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Dubbo 的线程池类型

Dubbo 内置了四种线程池实现：

### 1. FixedThreadPool（固定大小线程池）

```java
// 默认线程池，等待队列满了会拒绝请求
public class FixedThreadPool implements ThreadPool {
    @Override
    public Executor getExecutor(URL url) {
        int threads = url.getParameter("threads", 200);
        int queues = url.getParameter("queues", 0);  // 0 = 无等待队列

        return new ThreadPoolExecutor(
            threads, threads,
            0, TimeUnit.MILLISECONDS,
            queues == 0
                ? new SynchronousQueue&lt;&gt;()
                : new LinkedBlockingQueue&lt;&gt;(queues),
            new NamedThreadFactory("DubboServerHandler", true),
            new AbortPolicy()
        );
    }
}
```

**特点**：线程数固定，适合 CPU 密集型任务。

### 2. CachedThreadPool（可变大小线程池）

```java
public class CachedThreadPool implements ThreadPool {
    @Override
    public Executor getExecutor(URL url) {
        int corePoolSize = url.getParameter("corethreads", 0);
        int maxPoolSize = url.getParameter("threads", Integer.MAX_VALUE);
        int queues = url.getParameter("queues", 0);

        return new ThreadPoolExecutor(
            corePoolSize, maxPoolSize,
            60, TimeUnit.SECONDS,
            queues == 0
                ? new SynchronousQueue&lt;&gt;()
                : new LinkedBlockingQueue&lt;&gt;(queues),
            new NamedThreadFactory("DubboServerHandler", true),
            new AbortPolicy()
        );
    }
}
```

**特点**：线程数可动态扩展，适合 IO 密集型任务。

### 3. LimitedThreadPool（可伸缩线程池）

```java
public class LimitedThreadPool implements ThreadPool {
    @Override
    public Executor getExecutor(URL url) {
        int corePoolSize = url.getParameter("threads", 200);
        int maxPoolSize = url.getParameter("threads", 200);

        return new ThreadPoolExecutor(
            corePoolSize, maxPoolSize,
            Long.MAX_VALUE, TimeUnit.MILLISECONDS,
            new LinkedBlockingQueue&lt;&gt;(Integer.MAX_VALUE),
            new NamedThreadFactory("DubboServerHandler", true),
            new AbortPolicy()
        );
    }
}
```

**特点**：核心线程数和最大线程数相同，但空闲线程不会被回收。适合负载稳定的场景。

### 4. EagerThreadPool（优先创建线程）

```java
public class EagerThreadPool implements ThreadPool {
    @Override
    public Executor getExecutor(URL url) {
        int corePoolSize = url.getParameter("corethreads", 0);
        int maxPoolSize = url.getParameter("threads", 200);
        int queues = url.getParameter("queues", 0);

        TaskQueue queue = new TaskQueue(
            queues > 0 ? queues : Integer.MAX_VALUE
        );

        return new ThreadPoolExecutor(
            corePoolSize, maxPoolSize,
            60, TimeUnit.SECONDS,
            queue,
            new NamedThreadFactory("DubboServerHandler", true),
            new AbortPolicy()
        );
    }
}
```

**特点**：优先创建新线程而不是放入队列，适合高并发短任务场景。

## 线程分配策略

Dubbo 的线程配置涉及两个维度：

### 配置参数

```xml
<!-- Provider 端线程配置 -->
<dubbo:protocol
    name="dubbo"
    port="20880"
    threads="200"              <!-- 业务线程池大小 -->
    threadpool="fixed"         <!-- 线程池类型 -->
    queues="0"                 <!-- 等待队列大小 -->
    iothreads="16"             <!-- IO 线程数（Netty 线程数） -->
/>
```

### 参数详解

| 参数 | 说明 | 默认值 |
|-----|------|-------|
| `threads` | 业务线程池大小 | 200 |
| `iothreads` | IO 线程数（Netty Boss + Worker） | CPU 核数 |
| `queues` | 等待队列大小，0 表示不排队 | 0（直接拒绝） |
| `corethreads` | 核心线程数（Cached/Eager 模式） | 0 |
| `threadpool` | 线程池类型 | fixed |

### 线程数设置建议

```
┌─────────────────────────────────────────────────────────┐
│                   线程数计算公式                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  IO 线程数 = CPU 核数                                    │
│                                                         │
│  业务线程数 = 预估并发量 × 平均响应时间 / 单个线程处理时间   │
│                                                         │
│  例如：                                                 │
│  - 预估并发量：1000                                     │
│  - 平均响应时间：100ms                                  │
│  - 单线程处理时间（不含等待）：10ms                      │
│  - 业务线程数 = 1000 × 100 / 10 = 10000                │
│                                                         │
│  实际情况通常 200-500 即可，瓶颈往往在其他地方            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## 业务线程池打满的问题

### 问题现象

当业务线程池被占满时，新的请求会：

1. **等待队列排队**：如果配置了 `queues > 0`
2. **被拒绝执行**：如果 `queues = 0`（默认）

### 问题排查

```java
// 在 Dubbo Filter 中监控线程池状态
@Activate(group = Constants.PROVIDER_GROUP)
public class ThreadPoolMonitorFilter implements Filter {

    @Override
    public Result invoke(Invoker&lt;?&gt; invoker, Invocation invocation) throws RpcException {
        int active = RpcStatus.getStatus(invoker.getUrl())
                              .getActive();
        int poolSize = getThreadPoolSize(invoker.getUrl());

        // 监控指标
        MetricsCollector.record("thread.pool.active", active);
        MetricsCollector.record("thread.pool.size", poolSize);
        MetricsCollector.record("thread.pool.usage", (float) active / poolSize);

        if (active > poolSize * 0.8) {
            logger.warn("Thread pool almost full! active={}, poolSize={}",
                       active, poolSize);
        }

        return invoker.invoke(invocation);
    }
}
```

### 解决方案

1. **扩容**：增加 Provider 实例
2. **优化业务逻辑**：减少每个请求的处理时间
3. **降级**：非核心服务降级，释放线程资源
4. **异步处理**：将耗时操作异步化

## 执行流程图

```
┌─────────────────────────────────────────────────────────────┐
│                   Dubbo 请求处理流程                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 客户端发起请求                                           │
│     └──→ Netty Client Channel                              │
│                                                             │
│  2. Netty IO 线程（EventLoop）接收数据                       │
│     └──→ 解码（Deserialize）                                │
│                                                             │
│  3. 数据放入业务线程池                                       │
│     └──→ Dubbo ThreadPool (业务线程执行)                    │
│                                                             │
│  4. 执行业务逻辑                                            │
│     └──→ 调用 Service 实现                                  │
│                                                             │
│  5. 结果返回给 IO 线程                                       │
│     └──→ 编码（Serialize）→ Netty Channel → 客户端        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 面试追问方向

- IO 线程和业务线程之间是怎么传递数据的？（答：通过队列，通常是无界队列或有限队列）
- 如果业务线程池打满了，会发生什么？请求会丢失吗？
- Dubbo 的 `dispacther` 配置是做什么的？`all`、`direct`、`message` 有什么区别？
- 如何排查线程池耗尽的问题？有哪些监控指标？

## 总结

Dubbo 的线程模型经历了从 BIO 到 NIO、从单线程到线程池分离的演进：

```
BIO（1:1 线程连接）→ NIO（单 Reactor）→ 线程池分离（IO + 业务）
```

核心设计思想是**隔离**：

- **IO 线程**：负责网络通信，不处理业务逻辑
- **业务线程池**：负责执行业务逻辑，不阻塞 IO

正确的线程配置能保证系统在高并发下的稳定运行。线程数不是越大越好——需要根据业务特性和系统资源来调优。

如果你的服务响应慢，先看看线程池是否成为瓶颈。
