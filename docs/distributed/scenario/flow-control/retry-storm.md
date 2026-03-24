# 超时重试风暴治理：重试策略与熔断降级组合

你的服务调用下游接口超时了。

重试一次。

又超时了。

再重试一次。

...

三个重试请求同时打向下游，下游压力更大，更容易超时。

这就是**重试风暴**。

## 重试风暴的本质

重试风暴的本质是：**大量服务同时重试，导致下游雪崩**。

```
正常请求：服务 A → 服务 B → 返回

超时重试：服务 A → 服务 B → 超时
        服务 A → 服务 B → 超时
        服务 A → 服务 B → 超时
        ↑
        三倍压力，下游直接崩溃
```

## 常见的错误重试模式

### 错误一：无限重试

```java
// 错误示例：无限重试
while (true) {
    try {
        return callService();
    } catch (Exception e) {
        // 没有退出条件，可能导致死循环
    }
}
```

### 错误二：无退避重试

```java
// 错误示例：立即重试
for (int i = 0; i < 3; i++) {
    try {
        return callService();
    } catch (Exception e) {
        // 立即重试，没有间隔
    }
}
```

### 错误三：对业务错误重试

```java
// 错误示例：对业务错误重试
try {
    return callService();
} catch (Exception e) {
    // 对所有异常都重试，包括业务错误（如余额不足、参数错误）
    retry();
}
```

## 正确的重试策略

### 策略一：限制重试次数

```java
// 限制重试次数
@Service
public class RetryService {

    private static final int MAX_RETRY = 3;

    public String callWithRetry(String param) {
        for (int i = 0; i < MAX_RETRY; i++) {
            try {
                return callService(param);
            } catch (Exception e) {
                if (i == MAX_RETRY - 1) {
                    throw e;  // 最后一次也失败，抛出异常
                }
                log.warn("调用失败，第 {} 次重试", i + 2);
            }
        }
        throw new RuntimeException("不应到达这里");
    }
}
```

### 策略二：指数退避 + jitter

```java
// 指数退避 + jitter
@Service
public class RetryService {

    public String callWithRetry(String param) {
        int baseDelay = 100;  // 基础延迟 100ms
        int maxDelay = 5000;  // 最大延迟 5 秒
        int maxRetries = 3;

        for (int i = 0; i < maxRetries; i++) {
            try {
                return callService(param);
            } catch (Exception e) {
                if (i == maxRetries - 1) {
                    throw e;
                }

                // 指数退避：100, 200, 400, 800...
                int delay = Math.min(baseDelay * (1 << i), maxDelay);
                // 加上 jitter：避免多服务同时重试
                delay += ThreadLocalRandom.current().nextInt(delay);

                log.warn("调用失败，{} ms 后重试", delay);
                Thread.sleep(delay);
            }
        }
        throw new RuntimeException("不应到达这里");
    }
}
```

### 策略三：只对瞬时故障重试

```java
// 只对瞬时故障重试
@Service
public class RetryService {

    public String callWithRetry(String param) {
        for (int i = 0; i < MAX_RETRY; i++) {
            try {
                return callService(param);
            } catch (TimeoutException e) {
                // 超时：重试
                retry(e);
            } catch (ConnectionException e) {
                // 连接失败：重试
                retry(e);
            } catch (BusinessException e) {
                // 业务错误：不重试，直接抛出
                throw e;
            } catch (Exception e) {
                // 其他异常：看情况决定
                if (isTransient(e)) {
                    retry(e);
                } else {
                    throw e;
                }
            }
        }
        throw new RuntimeException("重试次数用尽");
    }
}
```

## 熔断降级组合

重试不是万能的。当错误率已经很高时，继续重试只会让情况更糟。

此时需要熔断降级。

### 熔断器原理

```
熔断器状态机：

┌──────────┐  失败率 > 阈值  ┌──────────┐
│   关闭   │ ────────────→ │   打开   │
│  (正常) │                 │  (熔断)  │
└──────────┘                └──────────┘
     ↑                            │
     │                            │ 等待时间
     │                            ▼
     │                      ┌──────────┐
     └─────────────────────│   半开    │
                           │  (探测)   │
                           └──────────┘
```

### Sentinel + 重试

```java
@Service
public class ProductService {

    @Autowired
    private SentinelResource sentinelResource;

    @Autowired
    private ProductClient productClient;

    public Product getProductWithRetry(Long productId) {
        return sentinelResource.execute(() -> {
            return executeWithRetry(() -> productClient.getProduct(productId));
        });
    }

    private String executeWithRetry(Callable&lt;String&gt; call) {
        int maxRetries = 3;
        int baseDelay = 100;

        for (int i = 0; i < maxRetries; i++) {
            try {
                return call.call();
            } catch (Exception e) {
                if (i == maxRetries - 1) {
                    throw e;
                }
                // 指数退避
                int delay = baseDelay * (1 << i);
                delay += ThreadLocalRandom.current().nextInt(delay);
                Thread.sleep(delay);
            }
        }
        throw new RuntimeException("重试失败");
    }
}
```

### Spring Retry

Spring Retry 提供了声明式的重试支持：

```java
@Service
public class ProductService {

    @Retryable(value = {TimeoutException.class, ConnectionException.class},
               maxAttempts = 3,
               backoff = @Backoff(delay = 100, multiplier = 2))
    public Product getProduct(Long productId) {
        return productClient.getProduct(productId);
    }

    @Recover
    public Product fallback(Long productId, Exception e) {
        // 重试都失败后，执行兜底方法
        return getFromCache(productId);
    }
}
```

## 面试追问方向

- 为什么需要 jitter？（答：避免多个服务在相同时刻重试，造成流量突刺）
- 指数退避的最大延迟怎么设置？（答：通常设为几秒，避免等待时间过长影响用户体验）
- 什么情况下不能重试？（答：业务错误、幂等性不保证的操作、资源已释放）
- 熔断打开后多久恢复？（答：通常几秒到几十秒，由熔断器配置决定）

## 小结

重试风暴是分布式系统常见的问题，通过合理的重试策略和熔断降级组合，可以有效避免：

1. **限制重试次数**：避免无限重试
2. **指数退避 + jitter**：避免同时重试
3. **只对瞬时故障重试**：避免对业务错误重试
4. **熔断降级**：在错误率过高时停止重试，防止雪崩

记住重试的核心原则：**不要让重试成为压垮下游的最后一根稻草**。
