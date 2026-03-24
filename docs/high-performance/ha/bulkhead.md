# 热点隔离与舱壁模式

想象一个场景：船舱进水了。

如果没有舱壁设计，水会蔓延到整个船体，船会沉没。

有了舱壁设计，进水的舱室被隔离，其他舱室继续正常工作。

这就是舱壁模式的核心思想：**故障隔离，防止扩散**。

## 为什么需要舱壁模式

### 雪崩效应

```
用户请求
    │
    ▼
┌─────────────────────────────────────────┐
│              服务 A                       │
│    ┌──────────┐    ┌──────────┐        │
│    │ 依赖服务B │    │ 依赖服务C │        │
│    └──────────┘    └──────────┘        │
│         │               │              │
└─────────┼───────────────┼──────────────┘
          │               │
          ▼               ▼
    ┌──────────┐    ┌──────────┐
    │ 服务 B   │    │ 服务 C   │
    │   挂了   │    │   挂了   │
    └──────────┘    └──────────┘
          │               │
          └───────┬───────┘
                  ▼
           所有请求堆积
                  │
                  ▼
            服务 A 也挂了
```

### 舱壁模式的作用

```
用户请求
    │
    ▼
┌─────────────────────────────────────────┐
│              服务 A                       │
│    ┌──────────┐    ┌──────────┐        │
│    │ 舱�壁 B   │    │ 舱壁 C    │        │
│    │ (隔离)   │    │ (隔离)   │        │
│    └──────────┘    └──────────┘        │
└─────────────────────────────────────────┘
          │               │
          ▼               ▼
    ┌──────────┐    ┌──────────┐
    │ 服务 B   │    │ 服务 C   │
    │   挂了   │    │   挂了   │
    └──────────┘    └──────────┘

服务 B 的故障被隔离在舱壁 B 内
服务 C 继续正常工作
```

## 舱壁模式类型

### 1. 线程池隔离

每个依赖服务使用独立的线程池，互不影响。

```
主线程池
    │
    ├──▶ 服务 A 线程池（10 线程）
    │
    ├──▶ 服务 B 线程池（5 线程）──▶ 队列（20）
    │
    └──▶ 服务 C 线程池（15 线程）

服务 B 故障：
- 线程池 B 的线程阻塞
- 其他服务不受影响
```

### 2. 信号量隔离

使用计数器限制并发调用数。

```
服务 A ──Semaphore(10)──▶ 服务 B
服务 A ──Semaphore(5)──▶ 服务 C

服务 C 限流时：
- 信号量立即返回
- 不占用线程资源
```

### 3. 舱壁隔离级别

| 级别 | 隔离粒度 | 资源消耗 | 适用场景 |
|------|----------|----------|----------|
| 接口级 | 每个接口独立 | 高 | 核心接口保护 |
| 服务级 | 每个服务独立 | 中 | 一般依赖 |
| 全局 | 共享线程池 | 低 | 非关键依赖 |

## Java 实现

### 线程池隔离（手动实现）

```java
@Service
public class IsolatedService {

    // 用户服务专用线程池
    private final ExecutorService userExecutor =
        Executors.newFixedThreadPool(10,
            new ThreadFactoryBuilder()
                .setNameFormat("user-pool-%d")
                .build());

    // 订单服务专用线程池
    private final ExecutorService orderExecutor =
        Executors.newFixedThreadPool(20,
            new ThreadFactoryBuilder()
                .setNameFormat("order-pool-%d")
                .build());

    // 支付服务专用线程池
    private final ExecutorService paymentExecutor =
        Executors.newFixedThreadPool(5,
            new ThreadFactoryBuilder()
                .setNameFormat("payment-pool-%d")
                .build());

    public CompletableFuture&lt;User&gt; getUser(Long userId) {
        return CompletableFuture.supplyAsync(
            () -> userClient.getUser(userId),
            userExecutor
        );
    }

    public CompletableFuture&lt;Order&gt; createOrder(OrderRequest request) {
        return CompletableFuture.supplyAsync(
            () -> orderService.create(request),
            orderExecutor
        );
    }

    public CompletableFuture&lt;PaymentResult&gt; pay(PaymentRequest request) {
        return CompletableFuture.supplyAsync(
            () -> paymentGateway.pay(request),
            paymentExecutor
        );
    }

    @PreDestroy
    public void shutdown() {
        userExecutor.shutdown();
        orderExecutor.shutdown();
        paymentExecutor.shutdown();
    }
}
```

### Hystrix 线程池隔离

```java
@HystrixCommand(
    groupKey = "UserGroup",
    threadPoolKey = "userThreadPool",
    threadPoolProperties = {
        @HystrixProperty(name = "coreSize", value = "10"),
        @HystrixProperty(name = "maxQueueSize", value = "20"),
        @HystrixProperty(name = "queueSizeRejectionThreshold", value = "15"),
        @HystrixProperty(name = "keepAliveTimeMinutes", value = "1"),
        @HystrixProperty(name = "maxThreadSize", value = "100")
    }
)
public User getUser(Long userId) {
    return userClient.getUser(userId);
}
```

### Resilience4j Bulkhead

```java
// 配置舱壁
BulkheadConfig config = BulkheadConfig.custom()
    .maxConcurrentCalls(10)         // 最大并发调用数
    .maxWaitDuration(Duration.ofMillis(100))  // 等待超时
    .build();

// 创建舱壁
Bulkhead bulkhead = Bulkhead.of("userService", config);

// 使用舱壁
Supplier&lt;User&gt; bulkheadSupplier = Bulkhead.decorateSupplier(
    bulkhead,
    () -> userClient.getUser(userId)
);

User user = bulkheadSupplier.get();
```

### 信号量隔离

```java
@Service
public class SemaphoreIsolationService {

    // 每个服务独立的信号量
    private final Map&lt;String, Semaphore&gt; semaphores = new ConcurrentHashMap&lt;&gt;();

    @PostConstruct
    public void init() {
        // 初始化各服务的信号量
        semaphores.put("userService", new Semaphore(10, true));
        semaphores.put("orderService", new Semaphore(20, true));
        semaphores.put("paymentService", new Semaphore(5, true));
    }

    public &lt;T&gt; T execute(String serviceName,
            Supplier&lt;T&gt; supplier,
            Supplier&lt;T&gt; fallback) {
        Semaphore semaphore = semaphores.get(serviceName);

        // 尝试获取信号量
        if (semaphore.tryAcquire(100, TimeUnit.MILLISECONDS)) {
            try {
                return supplier.get();
            } finally {
                semaphore.release();
            }
        }

        // 获取失败，执行降级
        return fallback.get();
    }

    // 使用示例
    public User getUser(Long userId) {
        return execute(
            "userService",
            () -> userClient.getUser(userId),
            () -> User.defaultUser()
        );
    }
}
```

## 热点隔离

### 什么是热点

热点是指被大量并发访问的相同资源：

- 热点数据：热门商品、明星用户
- 热点接口：秒杀商品、排行榜
- 热点参数：商品 ID、用户 ID

### 热点隔离策略

```
                     请求
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
   ┌─────────┐   ┌─────────┐   ┌─────────┐
   │热点数据 │   │普通数据 │   │冷数据   │
   │(本地缓存)│   │(Redis) │   │(数据库) │
   └─────────┘   └─────────┘   └─────────┘

热点数据 → 本地缓存 → 无需访问 Redis/DB
普通数据 → Redis → 可能访问 DB
冷数据   → 数据库
```

### 热点数据识别

```java
@Service
public class HotDataDetector {

    // 使用滑动窗口统计访问频率
    private final Map&lt;Long, SlidingWindowCounter&gt; counters =
        new ConcurrentHashMap&lt;&gt;();

    // 热点阈值
    private static final int HOT_THRESHOLD = 1000;

    public boolean isHot(Long id) {
        SlidingWindowCounter counter = counters.computeIfAbsent(
            id, k -> new SlidingWindowCounter(60, 10));

        long count = counter.incrementAndGet();
        return count >= HOT_THRESHOLD;
    }

    // 热点数据缓存
    private final Map&lt;Long, Object&gt; hotDataCache =
        new ConcurrentHashMap&lt;&gt;();

    public &lt;T&gt; T getHotData(Long id, Supplier&lt;T&gt; loader) {
        // 先检查热点缓存
        T data = (T) hotDataCache.get(id);

        if (data == null) {
            // 检查是否热点
            if (isHot(id)) {
                data = loader.get();
                hotDataCache.put(id, data);
            } else {
                // 非热点，直接查询
                data = loader.get();
            }
        }

        return data;
    }
}
```

### Sentinel 热点参数限流

```java
@GetMapping("/product/{id}")
@SentinelResource(
    value = "getProduct",
    paramFlowItemNum = 1,  // 每个参数值每秒 1 次
    blockHandler = "hotProductBlock"
)
public Product getProduct(@PathVariable Long id) {
    return productService.getById(id);
}

// 配置热点规则
List&lt;ParamFlowRule&gt; rules = new ArrayList&lt;&gt;();

// 普通商品：每秒 100 次
ParamFlowRule rule = new ParamFlowRule("getProduct")
    .setParamIdx(0)
    .setCount(100)
    .setDurationInSec(1);

// 热点商品：每秒 10 次
ParamFlowRule hotRule = new ParamFlowRule("getProduct")
    .setParamIdx(0)
    .setCount(10)
    .setDurationInSec(1)
    .setParamFlowItemList(Collections.singletonList(
        new ParamFlowItem().setObject("10001")  // 热门商品 ID
            .setCount(10).setDurationInSec(1)));

// 只针对特定参数值限流
rules.add(hotRule);
ParamFlowRuleManager.loadRules(rules);
```

## 实际应用场景

### 场景 1：支付服务隔离

```java
@Service
public class PaymentIsolationService {

    // 支付使用独立线程池
    private final ExecutorService paymentExecutor =
        Executors.newFixedThreadPool(5);

    @HystrixCommand(
        threadPoolKey = "paymentPool",
        threadPoolProperties = {
            @HystrixProperty(name = "coreSize", value = "5"),
            @HystrixProperty(name = "maxQueueSize", value = "10")
        },
        fallbackMethod = "paymentFallback"
    )
    public PaymentResult pay(PaymentRequest request) {
        return paymentGateway.pay(request);
    }

    public PaymentResult paymentFallback(PaymentRequest request,
            Throwable t) {
        // 支付失败降级
        return PaymentResult.retry("支付服务繁忙，请稍后重试");
    }
}
```

### 场景 2：查询服务隔离

```java
@Service
public class QueryIsolationService {

    // 不同类型的查询使用不同的隔离策略
    private final HotDataCache hotDataCache;
    private final RedisCache redisCache;
    private final DatabaseQuery databaseQuery;

    public Product getProduct(Long productId) {
        // 1. 先查本地热点缓存
        Product hotCached = hotDataCache.get(productId);
        if (hotCached != null) {
            return hotCached;
        }

        // 2. 查 Redis
        Product redisCached = redisCache.get("product:" + productId);
        if (redisCached != null) {
            return redisCached;
        }

        // 3. 查数据库
        return databaseQuery.getProduct(productId);
    }
}
```

### 场景 3：写服务隔离

```java
@Service
public class WriteIsolationService {

    private final ExecutorService writeExecutor =
        Executors.newFixedThreadPool(10,
            new ThreadFactoryBuilder()
                .setNameFormat("write-pool-%d")
                .setRejectedExecutionHandler(new CallerRunsPolicy())
                .build());

    // 写操作队列
    private final BlockingQueue&lt;WriteTask&gt; writeQueue =
        new LinkedBlockingQueue&lt;&gt;(1000);

    @PostConstruct
    public void init() {
        // 启动写任务处理线程
        IntStream.range(0, 5).forEach(i ->
            new Thread(() -> processWriteTasks()).start());
    }

    public void submitWrite(WriteTask task) {
        if (!writeQueue.offer(task)) {
            throw new WriteQueueFullException("写队列已满");
        }
    }

    private void processWriteTasks() {
        while (true) {
            try {
                WriteTask task = writeQueue.take();
                executeWrite(task);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
    }
}
```

## 舱壁模式最佳实践

### 1. 合理设置线程池大小

```java
// 线程池大小计算
// 线程数 = CPU 核心数 * 期望 CPU 利用率 * (1 + 等待时间/计算时间)

// 假设：
// CPU 核心数 = 8
// 期望利用率 = 80%
// 等待时间/计算时间 = 4 (IO 密集型)

// 线程数 = 8 * 0.8 * (1 + 4) = 32

// 但要考虑：
// - 每个线程占用栈内存（约 1MB）
// - 队列长度
// - 最大负载时的并发数
```

### 2. 设置合理的队列

```java
// 队列策略选择
// 1. 同步队列：无缓冲，CallerRuns
SynchronousQueue&lt;Runnable&gt; queue1 = new SynchronousQueue&lt;&gt;();

// 2. 有界队列：超过拒绝
LinkedBlockingQueue&lt;Runnable&gt; queue2 =
    new LinkedBlockingQueue&lt;&gt;(100);

// 3. CallerRunsPolicy：超过的由调用线程执行
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    corePoolSize, maxPoolSize, 60L, TimeUnit.SECONDS, queue2,
    new ThreadFactoryBuilder().setNameFormat("pool-%d").build(),
    new ThreadPoolExecutor.CallerRunsPolicy()
);
```

### 3. 超时设置

```java
@Configuration
public class TimeoutConfig {

    @Bean
    public RestTemplate restTemplate() {
        SimpleClientHttpRequestFactory factory =
            new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(3000);   // 连接超时
        factory.setReadTimeout(5000);      // 读取超时

        return new RestTemplate(factory);
    }
}

// 所有远程调用都必须设置超时
public Order getOrder(Long orderId) {
    try {
        return restTemplate.getForObject(
            "http://order-service/orders/" + orderId,
            Order.class
        );
    } catch (ResourceAccessException e) {
        throw new TimeoutException("订单服务调用超时");
    }
}
```

---

**思考题：**

假设你负责一个电商系统，需要对不同类型的服务进行隔离。

系统包括：
- 搜索服务（响应式，大量查询）
- 订单服务（事务性，写操作为主）
- 推荐服务（计算密集型）
- 监控服务（非关键）

问题：
1. 每种服务应该如何设置线程池大小？请给出具体计算过程。
2. 如果订单服务发生故障，线程池被打满，会不会影响搜索服务？为什么？
3. 推荐服务是计算密集型的，它适合使用线程池隔离吗？还是应该使用其他方式？
4. 如果监控服务发生故障导致线程池阻塞，会不会影响其他关键服务？如何防止？

提示：考虑服务特性、资源消耗、故障影响等因素。
