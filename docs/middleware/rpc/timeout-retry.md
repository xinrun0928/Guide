# 超时与重试：RPC 调用的生死线

你有没有遇到过这种情况？

用户反馈：「订单创建成功了，但页面一直转圈，最后报错。」

你查日志：服务端明明处理完了，返回了响应。

问题在哪？

**可能是超时和重试配置不当，导致客户端「等不到结果，提前放弃了」。**

---

## 超时：时间的艺术

### 超时是什么？

超时（Timeout）是指客户端等待服务端响应的最大时间。超过这个时间，客户端就认为调用失败。

```
客户端                              服务端
  │                                   │
  │  发起调用                         │
  ├──────────────────────────────────▶│
  │                                   │
  │  等待响应（超时计时开始）           │
  │  ⏱️ 3 秒...                       │
  │  ⏱️ 2 秒...                       │
  │  ⏱️ 1 秒...                       │
  │                                   │
  │  ╳ 超时！                         │
  │  认为调用失败                       │
  │  抛出 TimeoutException            │
  │                                   │
  │  ←───────── 服务端还在处理 ──────── │
  │                                   │
  │  服务端返回成功                     │
  │  但客户端已经不等了                │
  │                                   │
```

### 超时设置的原则

**超时太短：** 服务端还没处理完，客户端就放弃了
**超时太长：** 失败响应慢，系统可用性下降

```
最佳实践：
├─ 读操作：200-500ms（用户对延迟敏感）
├─ 写操作：1-3s（需要等待数据落地）
└─ 批量操作：视数据量而定，通常 30s 内
```

### Dubbo 超时配置

```java
// 接口级别超时
@DubboReference(
    timeout = 3000  // 3 秒超时
)
private OrderService orderService;

// 方法级别超时
@DubboReference(
    methods = {
        @Method(name = "getOrder", timeout = 2000),      // 2 秒
        @Method(name = "createOrder", timeout = 5000),  // 5 秒
        @Method(name = "batchCreate", timeout = 30000)  // 30 秒
    }
)
private OrderService orderService;

// 全局默认超时
dubbo:
  consumer:
    timeout: 3000  # 默认 3 秒
```

### gRPC 超时配置

```java
// Java gRPC 超时配置
ManagedChannel channel = ManagedChannelBuilder
    .forAddress("localhost", 8080)
    .build();

// 方式一：每次调用指定超时
Order order = blockingStub
    .withDeadlineAfter(3, TimeUnit.SECONDS)
    .getOrder(request);

// 方式二：使用 Context 控制
try (ManualResetTaskableSourceFuture&lt;Order&gt; future = 
        futureStub.withDeadlineAfter(3, TimeUnit.SECONDS)
                  .getOrderAsync(request)) {
    Order order = future.get();
} catch (ExecutionException e) {
    if (e.getCause() instanceof StatusRuntimeException) {
        StatusRuntimeException sre = (StatusRuntimeException) e.getCause();
        if (sre.getStatus() == Status.DEADLINE_EXCEEDED) {
            // 超时处理
        }
    }
}
```

---

## 重试：失败的补救

### 重试是什么？

重试（Retry）是指调用失败后，客户端自动重新发起调用。

```
调用 1 ──────────────────────────▶ │ 服务端
       │ 超时/失败                   │
       ◀─────────────────────────────│
       │                             │
       │ 重试 2                      │
       ├──────────────────────────▶   │ 成功！
       │ ◀──────────────────────────┤
       ✓ 返回结果
```

### 重试的前提

**不是所有失败都适合重试：**

| 场景 | 是否重试 | 原因 |
|-----|---------|-----|
| 网络抖动 | ✅ 重试 | 临时性问题 |
| 服务端正重启 | ✅ 重试 | 短暂不可用 |
| 超时 | ✅ 重试 | 可能只是慢 |
| 业务校验失败 | ❌ 不重试 | 重试也不会成功 |
| 资源不足（内存/连接池） | ❌ 不重试 | 只会雪上加霜 |
| 非幂等操作 | ⚠️ 谨慎重试 | 可能产生副作用 |

### 幂等性：重试的关键

**幂等操作：** 多次执行和一次执行的结果相同

```java
// 幂等操作：可以安全重试
public Order getOrderById(Long id) {
    // 查询，多次执行结果相同
    return orderRepository.findById(id);
}

// 非幂等操作：不能随意重试
public void createOrder(Order order) {
    // 创建，每次执行都会创建新订单
    // 重试会导致重复订单
    return orderRepository.save(order);
}

// 解决方案：使用唯一订单号
public void createOrder(Order order, String idempotencyKey) {
    // 幂等化：先检查是否已存在
    if (orderRepository.existsByIdempotencyKey(idempotencyKey)) {
        return orderRepository.findByIdempotencyKey(idempotencyKey);
    }
    return orderRepository.save(order);
}
```

### Dubbo 重试配置

```java
@DubboReference(
    retries = 3,  // 重试次数（不包含首次调用）
    timeout = 3000
)
private OrderService orderService;
```

**Dubbo 内置的重试策略：**

| 策略 | 说明 | 使用场景 |
|-----|-----|---------|
| `failover` | 失败自动切换到其他实例 | 读操作，幂等 |
| `failfast` | 快速失败，不重试 | 非幂等写操作 |
| `failsafe` | 失败忽略，返回空 | 日志、监控 |
| `failback` | 失败后台重试 | 非核心服务 |
| `forking` | 并发调用多个实例 | 需要多个结果 |

```java
// 配置重试策略
@DubboReference(
    cluster = "failover",  // 失败切换
    retries = 2,          // 重试 2 次（最多 3 次调用）
    methods = {
        @Method(
            name = "getOrder",
            timeout = 2000,
            retries = 3  // 单独配置方法级别重试
        )
    }
)
private OrderService orderService;
```

---

## 超时与重试的配合

### 黄金公式

```
总超时时间 = 单次超时时间 × (重试次数 + 1) + 间隔时间
```

### 配置不当的后果

**场景一：超时设置过长**

```java
// 超时 30 秒，重试 3 次
// 最坏情况：30s × 4 = 120 秒
// 用户体验极差
@DubboReference(
    timeout = 30000,
    retries = 3
)
private OrderService orderService;
```

**场景二：超时设置过短**

```java
// 超时 100ms，重试 3 次
// 服务端正常处理需要 500ms
// 结果：调用了 4 次，全部超时
@DubboReference(
    timeout = 100,
    retries = 3
)
private OrderService orderService;
```

### 正确的配置示例

```java
// 推荐配置：超时短，重试少
@DubboReference(
    timeout = 3000,    // 单次调用超时 3 秒
    retries = 2,       // 最多重试 2 次
    // 最坏情况：3s × 3 = 9 秒，用户可接受
    cluster = "failover"
)
private OrderService orderService;
```

---

## 高级配置

### 1. 指数退避重试

每次重试的间隔时间逐渐增加，避免对服务端造成压力：

```java
// 指数退避实现
public class ExponentialBackoffRetry {
    
    public static final int MAX_RETRIES = 3;
    public static final long BASE_DELAY_MS = 100;
    public static final long MAX_DELAY_MS = 5000;
    
    public &lt;T&gt; T execute(Callable&lt;T&gt; operation) throws Exception {
        Exception lastException = null;
        
        for (int attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                return operation.call();
            } catch (Exception e) {
                lastException = e;
                
                if (attempt < MAX_RETRIES - 1) {
                    // 计算退避时间：100ms, 200ms, 400ms...
                    long delay = Math.min(
                        BASE_DELAY_MS * (1L << attempt), 
                        MAX_DELAY_MS
                    );
                    Thread.sleep(delay);
                }
            }
        }
        
        throw lastException;
    }
}
```

### 2. 熔断器模式

当失败率超过阈值时，快速失败，不再重试：

```java
// 简化熔断器实现
public class CircuitBreaker {
    
    private final AtomicInteger failureCount = new AtomicInteger(0);
    private final AtomicInteger successCount = new AtomicInteger(0);
    
    private volatile State state = State.CLOSED;
    private volatile long lastFailureTime = 0;
    
    private static final int THRESHOLD = 5;      // 失败阈值
    private static final long TIMEOUT = 60000;   // 熔断恢复时间
    
    public void recordFailure() {
        failureCount.incrementAndGet();
        lastFailureTime = System.currentTimeMillis();
        
        if (failureCount.get() >= THRESHOLD) {
            state = State.OPEN;
        }
    }
    
    public void recordSuccess() {
        successCount.incrementAndGet();
        failureCount.set(0);
        
        if (successCount.get() >= THRESHOLD && state == State.HALF_OPEN) {
            state = State.CLOSED;
            successCount.set(0);
        }
    }
    
    public boolean allowRequest() {
        if (state == State.CLOSED) {
            return true;
        }
        
        if (state == State.OPEN) {
            // 检查是否超时，可以尝试恢复
            if (System.currentTimeMillis() - lastFailureTime > TIMEOUT) {
                state = State.HALF_OPEN;
                return true;
            }
            return false;
        }
        
        // HALF_OPEN 状态允许部分请求通过
        return true;
    }
    
    enum State {
        CLOSED,     // 正常状态
        OPEN,       // 熔断状态，拒绝请求
        HALF_OPEN   // 半开状态，尝试恢复
    }
}
```

### 3. 服务端超时设置

服务端也需要设置超时，防止客户端无限等待：

```java
// Dubbo 服务端超时
@DubboService(
    timeout = 5000,  // 服务端处理超时
    executes = 10    // 最大并发执行数
)
public class OrderServiceImpl implements OrderService {
    // ...
}
```

---

## 常见问题与排查

### 问题一：超时异常怎么排查？

```java
// 捕获超时异常
try {
    orderService.createOrder(request);
} catch (RpcException e) {
    if (e.isTimeout()) {
        // 是超时异常
        // 记录上下文信息
        log.error("RPC 调用超时", e);
        log.error("  服务: {}", e.getServiceName());
        log.error("  方法: {}", e.getMethodName());
        log.error("  超时时间: {}ms", e.getTimeout());
        
        // 上报监控
        metrics.increment("rpc.timeout", 
            Tags.of("service", serviceName, "method", methodName));
    }
}
```

### 问题二：重试导致重复数据？

```java
// 问题场景
public void createOrder(Order order) {
    // 没有幂等控制的重试场景
    // 第 1 次：创建订单 A（成功，但响应丢失）
    // 第 2 次：重试，又创建订单 B（重复！）
    
    orderRepository.save(order);
}

// 解决方案：数据库唯一约束
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    idempotency_key VARCHAR(64) UNIQUE NOT NULL,  -- 幂等键
    customer_name VARCHAR(100),
    total_amount DECIMAL(10,2)
);

// 解决方案：先查询再插入
@Transactional
public Order createOrder(String idempotencyKey, Order order) {
    Order existing = orderRepository.findByIdempotencyKey(idempotencyKey);
    if (existing != null) {
        return existing;  // 返回已有的订单
    }
    return orderRepository.save(order);
}
```

### 问题三：重试风暴

当大量请求同时失败时，同时发起重试，可能把服务端打垮：

```java
// 问题：所有客户端同时重试
// 失败 ──▶ 重试 ──▶ 更多请求 ──▶ 更多失败 ──▶ 更多重试
//                    ↑                              │
//                    └──────────────────────────────┘

// 解决方案：添加随机抖动
public long calculateDelayWithJitter(int attempt) {
    long baseDelay = BASE_DELAY_MS * (1L << attempt);
    // 随机增加 0-100% 的延迟
    long jitter = (long) (baseDelay * Math.random());
    return baseDelay + jitter;
}
```

---

## 总结

| 配置 | 建议值 | 说明 |
|-----|-------|-----|
| 简单查询超时 | 1-3 秒 | 快速失败，快速切换 |
| 复杂查询超时 | 3-10 秒 | 需要多表 join |
| 写入操作超时 | 3-5 秒 | 需要等待数据落盘 |
| 批量操作超时 | 30-60 秒 | 视数据量调整 |
| 重试次数 | 1-3 次 | 避免雪崩 |
| 重试间隔 | 指数退避 | 100ms → 200ms → 400ms |

**超时和重试是 RPC 调用可靠性的基础，配合熔断、限流等机制，才能构建健壮的分布式系统。**

---

## 留给你的问题

假设你的系统有以下特点：

- 服务 A 调用服务 B，B 调用服务 C
- 链路：A → B → C
- 每个服务都配置了 timeout=1s, retries=2

**在最坏情况下，用户等待多久才能收到错误响应？如果要优化这个链路，你会从哪些方面入手？**

这个问题，可以结合 [RPC 链路追踪](/middleware/rpc/tracing) 来思考如何定位超时问题。
