# Spring @Async 异步执行与线程池配置

你有没有想过这个问题：为什么同样是执行一个耗时的任务，加了 `@Async` 注解就能让接口响应变快？

答案藏在 Spring 的异步执行机制里。

## @Async 的工作原理

`@Async` 是 Spring 提供的异步方法注解，标注在方法上后，调用该方法不会同步执行，而是立即返回，实际执行会被提交到线程池中异步运行。

```java
@Service
public class OrderService {
    
    @Async
    public void sendNotification(Long orderId) {
        // 这个方法会异步执行，不阻塞调用方
        notificationClient.sendSms(orderId);
    }
    
    public void createOrder(Order order) {
        orderRepository.save(order);
        // 发送通知是异步的，不会阻塞下单流程
        sendNotification(order.getId());
        // 立即返回给用户
        return "下单成功";
    }
}
```

从调用方视角看，下单接口响应时间只取决于下单逻辑本身，通知发送的耗时被「剥离」了。

Spring 的 `@Async` 注解背后，依赖的是**代理机制**。当你调用一个被 `@Async` 标注的方法时：

1. Spring 为你创建了一个**代理对象**
2. 代理对象将方法调用封装为 `Runnable` 或 `Callable`
3. 将任务提交到配置的线程池执行
4. 原方法立即返回（实际还没执行）

```java
// @Async 的简化原理（Spring 内部大致逻辑）
public class AsyncProxy {
    private Executor executor;
    
    public Object invoke(MethodInvocation invocation) {
        // 将同步调用转为异步执行
        executor.execute(() -> {
            try {
                invocation.proceed(); // 真正执行原方法
            } catch (Throwable t) {
                throw new UndeclaredThrowableException(t);
            }
        });
        // 立即返回，不等待执行完成
        return null;
    }
}
```

## 基础配置：让 @Async 生效

### 1. 启用异步支持

```java
@Configuration
@EnableAsync
public class AsyncConfig {
    // 在这里配置线程池
}
```

没有 `@EnableAsync`，`@Async` 注解不会生效。

### 2. 配置自定义线程池

Spring 默认使用 `SimpleAsyncTaskExecutor`，**每次执行都创建新线程**，没有复用。这在生产环境中是灾难性的。

正确的做法是配置线程池：

```java
@Configuration
@EnableAsync
public class AsyncConfig implements AsyncConfigurer {
    
    @Bean("asyncExecutor")
    public Executor asyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(10);
        executor.setMaxPoolSize(50);
        executor.setQueueCapacity(200);
        executor.setKeepAliveSeconds(60);
        executor.setThreadNamePrefix("async-");
        
        // 拒绝策略：队列满了由调用线程执行
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        
        executor.initialize();
        return executor;
    }
    
    @Override
    public Executor getAsyncExecutor() {
        return asyncExecutor();
    }
}
```

### 3. 指定线程池

如果项目中有多个线程池，可以指定方法使用哪个线程池：

```java
public class AsyncConfig {
    @Bean("ioExecutor")
    public Executor ioExecutor() {
        // IO 密集型任务线程池
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(20);
        executor.setMaxPoolSize(100);
        executor.setQueueCapacity(500);
        executor.setThreadNamePrefix("io-");
        executor.initialize();
        return executor;
    }
    
    @Bean("cpuExecutor")
    public Executor cpuExecutor() {
        // CPU 密集型任务线程池
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(Runtime.getRuntime().availableProcessors());
        executor.setMaxPoolSize(Runtime.getRuntime().availableProcessors() * 2);
        executor.setThreadNamePrefix("cpu-");
        executor.initialize();
        return executor;
    }
}
```

```java
public class NotificationService {
    
    // 使用 ioExecutor 线程池
    @Async("ioExecutor")
    public void sendEmail(Long userId) {
        // IO 操作
    }
    
    // 使用 cpuExecutor 线程池
    @Async("cpuExecutor")
    public void generateReport(Long userId) {
        // CPU 密集型操作
    }
}
```

## 线程池参数详解

### 核心线程数 vs 最大线程数

```java
executor.setCorePoolSize(10);   // 核心线程数
executor.setMaxPoolSize(50);     // 最大线程数
```

这是理解线程池的关键：

```
请求进来 → 有空闲核心线程？→ 直接执行
                ↓ 否
         核心线程满了？→ 队列未满？→ 放入队列等待
                ↓ 否
         最大线程数未满？→ 创建新线程执行
                ↓ 否
         执行拒绝策略
```

### 队列容量选择

队列容量设置不当，会导致两种极端：

| 队列类型 | 问题 |
|---------|------|
| 队列太小 | 任务容易被拒绝，吞吐量受限 |
| 队列太大 | 任务等待时间长，内存压力大 |

估算公式：**队列容量 = 核心线程数 × 期望等待时间 × 每秒请求数**

```java
// 示例：核心线程 10，期望等待 5 秒，每秒 20 请求
// 队列容量 = 10 × 5 × 20 = 1000
executor.setQueueCapacity(1000);
```

### 拒绝策略

当线程池和队列都满了，需要处理被拒绝的任务：

| 策略 | 行为 |
|------|------|
| AbortPolicy（默认） | 抛异常 |
| DiscardPolicy | 直接丢弃 |
| DiscardOldestPolicy | 丢弃队列最老的任务 |
| CallerRunsPolicy | 由调用线程执行 |

生产环境推荐 `CallerRunsPolicy`，既不丢任务，又能让调用方感受到压力：

```java
executor.setRejectedExecutionHandler(
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

## @Async 常见坑与解决方案

### 坑 1：同类内部调用不生效

```java
@Service
public class OrderService {
    
    public void createOrder(Order order) {
        // 同一个类中调用 @Async 方法，代理不生效
        sendNotification(order.getId()); // 不会异步执行！
    }
    
    @Async
    public void sendNotification(Long orderId) {
        // 这个方法会同步执行
    }
}
```

原因：同一个类中的方法调用不走代理，直接调用原方法。

解决方案：

```java
// 方案 1：注入自身代理
@Autowired
private OrderService self;

public void createOrder(Order order) {
    self.sendNotification(order.getId()); // 走代理，异步执行
}

// 方案 2：拆分到另一个 Bean
@Service
public class NotificationService {
    @Async
    public void sendNotification(Long orderId) {}
}
```

### 坑 2：事务问题

`@Async` 方法默认在**另一线程**执行，而 Spring 的事务绑定在**当前线程**。

```java
@Async
public void createOrderAndNotify(Order order) {
    orderRepository.save(order);  // 不在事务中！
    // 如果 save 失败，通知已经发了
}
```

解决方案：事务操作单独抽出来：

```java
public void createOrderAndNotify(Order order) {
    // 事务方法在当前线程执行
    createOrder(order);
    // 异步通知在另一线程执行
    notifyAsync(order.getId());
}

@Transactional
public void createOrder(Order order) {
    orderRepository.save(order);
}

@Async
public void notifyAsync(Long orderId) {
    notificationService.send(orderId);
}
```

### 坑 3：异常丢失

```java
@Async
public void processOrder(Long orderId) {
    throw new RuntimeException("处理失败");
}

public void createOrder(Long orderId) {
    try {
        processOrder(orderId); // 调用方不知道异常
    } catch (Exception e) {
        // 这里捕获不到！异常在线程池线程中
    }
}
```

解决方案：使用 `Future` 或 `AsyncResult`：

```java
@Async
public Future&lt;Void&gt; processOrder(Long orderId) {
    try {
        // 业务逻辑
        return new AsyncResult&lt;&gt;(null);
    } catch (Exception e) {
        return new AsyncResult&lt;&gt;(e);
    }
}
```

或者使用 `CompletableFuture`：

```java
@Async
public CompletableFuture&lt;Void&gt; processOrder(Long orderId) {
    return CompletableFuture.runAsync(() -> {
        // 业务逻辑
    });
}
```

## 最佳实践总结

### 1. 线程池配置原则

```java
// IO 密集型任务（网络请求、文件 IO）
// 经验公式：核心线程数 = CPU 核心数 × 2
// 或：核心线程数 = CPU 核心数 / (1 - 阻塞系数)
// 阻塞系数通常取 0.8~0.9，假设为 0.9
// 则：核心线程数 = CPU 核心数 / 0.1 = CPU 核心数 × 10
executor.setCorePoolSize(Runtime.getRuntime().availableProcessors() * 10);

// CPU 密集型任务（计算、加密）
// 核心线程数 = CPU 核心数 + 1
executor.setCorePoolSize(Runtime.getRuntime().availableProcessors() + 1);
```

### 2. 合理选择队列类型

```java
// 无界队列：任务多时 OOM 风险
new LinkedBlockingQueue&lt;&gt;();

// 有界队列：控制内存，避免 OOM
new LinkedBlockingQueue&lt;&gt;(1000);

// 同步队列：直接交给线程执行，不缓存
new SynchronousQueue&lt;&gt;();
```

### 3. 监控线程池状态

```java
@Component
public class ThreadPoolMonitor {
    
    @Scheduled(fixedRate = 60000)
    public void monitor() {
        ThreadPoolTaskExecutor executor = applicationContext.getBean("asyncExecutor", 
            ThreadPoolTaskExecutor.class);
        
        log.info("Async 线程池状态: 核心={}, 最大={}, 当前={}, 活跃={}, 完成={}, 队列={}",
            executor.getCorePoolSize(),
            executor.getMaxPoolSize(),
            executor.getPoolSize(),
            executor.getActiveCount(),
            executor.getCompletedTaskCount(),
            executor.getThreadPoolExecutor().getQueue().size()
        );
    }
}
```

---

## 总结

Spring `@Async` 是处理异步任务的利器，但要真正用好它，需要：

1. **自定义线程池**：避免使用默认的 `SimpleAsyncTaskExecutor`
2. **避免同类内部调用**：走代理才能异步
3. **注意事务边界**：异步方法的事务会失效
4. **处理异常丢失**：使用 Future 或 CompletableFuture
5. **监控线程池状态**：及时发现线程池问题

---

## 留给你的问题

假设你的系统高峰期 QPS 为 1000，每个请求需要调用一个外部接口（IO 耗时约 200ms），如果你希望 99% 的请求在 500ms 内返回，请问：

1. 使用同步调用，最少需要多少并发线程？
2. 使用 `@Async` + 线程池，核心线程数和最大线程数应该设为多少？
3. 如果你把核心线程数设为 10、最大线程数设为 100、队列容量设为 500，在高峰期可能会发生什么？

这些问题能帮助你理解线程池参数的实际意义。
