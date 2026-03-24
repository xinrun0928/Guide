# 服务重试：重试策略与幂等性保证

你有没有想过这个问题：

用户下单时，网络抖动导致请求失败。

但实际上后台已经处理成功了，只是响应没回来。

用户再次发起请求，结果扣了两次钱。

这就是**重试的风险**——如果操作不是幂等的，重试可能导致重复执行。

## 重试的适用场景

重试只适合处理**瞬时故障**：

```
1. 网络抖动：请求超时
2. 服务短暂不可用：服务重启
3. 数据库连接池耗尽：连接超时
4. 负载均衡器故障：连接拒绝
```

重试不适合：

```
1. 业务逻辑错误：参数校验失败
2. 永久性故障：服务不存在
3. 数据冲突：唯一键冲突
```

## 重试策略三要素

### 1. 重试次数

```java
@HystrixCommand(
    commandProperties = {
        @HystrixProperty(name = "metrics.rollingStats.timeInMilliseconds", value = "10000"),
        @HystrixProperty(name = "circuitBreaker.requestVolumeThreshold", value = "20"),
        @HystrixProperty(name = "circuitBreaker.errorThresholdPercentage", value = "50")
    },
    fallbackMethod = "getDefaultUser"
)
public User getUser(Long id) {
    return userService.getUser(id);
}
```

### 2. 重试间隔

固定间隔 vs 递增间隔。

```java
// 固定间隔
public <T> T retry(Functions<T> function, int maxRetries) {
    for (int i = 0; i < maxRetries; i++) {
        try {
            return function.apply();
        } catch (Exception e) {
            if (i == maxRetries - 1) throw e;
            Thread.sleep(1000); // 固定 1 秒
        }
    }
}
```

### 3. 退避算法

避免大量请求同时重试。

```java
public class ExponentialBackoff {

    public static void main(String[] args) {
        int baseDelay = 1000; // 基础延迟 1 秒
        int maxDelay = 30000; // 最大延迟 30 秒
        int maxRetries = 5;

        for (int i = 0; i < maxRetries; i++) {
            // 指数退避：1s, 2s, 4s, 8s, 16s
            int delay = (int) Math.min(baseDelay * Math.pow(2, i), maxDelay);
            System.out.println("Retry " + i + " after " + delay + "ms");
        }
    }
}
```

## 退避算法详解

### 指数退避

```java
public long getDelay(int retryCount) {
    return (long) (baseDelay * Math.pow(2, retryCount));
}
```

### 指数退避 + Jitter

避免「惊群效应」——大量请求在同一时间重试。

```java
public long getDelayWithJitter(int retryCount) {
    long exponentialDelay = baseDelay * (long) Math.pow(2, retryCount);
    long jitter = (long) (Math.random() * exponentialDelay);
    return Math.min(exponentialDelay + jitter, maxDelay);
}
```

```
场景：无 Jitter
请求 A、B、C 同时失败
1s 后同时重试 → 又同时失败
2s 后同时重试 → 又同时失败

场景：有 Jitter
请求 A、B、C 同时失败
A: 1.0s 后重试
B: 1.5s 后重试
C: 1.8s 后重试
→ 分散压力，避免惊群
```

## 重试风暴问题

大量服务同时故障，同时重试，可能压垮下游。

```java
// 解决方案：熔断器
@HystrixCommand(
    fallbackMethod = "fallback",
    commandProperties = {
        @HystrixProperty(name = "circuitBreaker.enabled", value = "true"),
        @HystrixProperty(name = "circuitBreaker.requestVolumeThreshold", value = "10"),
        @HystrixProperty(name = "circuitBreaker.errorThresholdPercentage", value = "50")
    }
)
public String callService() {
    return remoteService.call();
}
```

## 幂等性保证

### 幂等的定义

同一操作执行一次和执行多次，结果相同。

```
GET /users/1     → 幂等
PUT /users/1     → 幂等（多次 PUT 相同数据）
DELETE /users/1  → 幂等
POST /users      → 非幂等（每次创建新用户）
```

### 幂等实现方案

#### 方案一：唯一 ID + 防重表

```java
public String createOrder(Order order) {
    String idempotentKey = order.getIdempotentKey();

    // 检查是否已处理
    if (idempotentDao.exists(idempotentKey)) {
        return idempotentDao.getResult(idempotentKey);
    }

    // 标记处理中
    idempotentDao.save(idempotentKey, "PROCESSING");

    try {
        String result = orderService.create(order);
        idempotentDao.updateResult(idempotentKey, result);
        return result;
    } catch (Exception e) {
        idempotentDao.delete(idempotentKey);
        throw e;
    }
}
```

#### 方案二：Redis SETNX

```java
public String createOrderWithRedis(Order order) {
    String idempotentKey = "order:" + order.getIdempotentKey();

    // SETNX：key 不存在才设置
    Boolean success = redisTemplate.opsForValue()
        .setIfAbsent(idempotentKey, "PROCESSING", 30, TimeUnit.SECONDS);

    if (!success) {
        // 已有记录，返回原结果
        return getCachedResult(idempotentKey);
    }

    try {
        String result = orderService.create(order);
        redisTemplate.opsForValue().set(idempotentKey, result, 24, TimeUnit.HOURS);
        return result;
    } catch (Exception e) {
        redisTemplate.delete(idempotentKey);
        throw e;
    }
}
```

#### 方案三：数据库唯一约束

```java
// 订单表设计
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    idempotent_key VARCHAR(64) UNIQUE NOT NULL,
    user_id BIGINT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

public String createOrder(Order order) {
    try {
        return orderDao.insert(order);
    } catch (DuplicateKeyException e) {
        // 唯一键冲突，说明订单已存在
        return orderDao.findByIdempotentKey(order.getIdempotentKey());
    }
}
```

## Spring Retry 实现

```xml
<dependency>
    <groupId>org.springframework.retry</groupId>
    <artifactId>spring-retry</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework</groupId>
    <artifactId>spring-aspects</artifactId>
</dependency>
```

```java
@SpringBootApplication
@EnableRetry
public class Application { }

@Service
public class PaymentService {

    @Retryable(
        value = { RemoteServiceException.class },
        maxAttempts = 3,
        backoff = @Backoff(delay = 1000, multiplier = 2)
    )
    public void pay(Order order) {
        paymentGateway.process(order);
    }

    @Recover
    public void recover(RemoteServiceException e, Order order) {
        // 重试失败后的兜底逻辑
        order.setStatus("PAYMENT_FAILED");
        orderDao.update(order);
        notifyUser(order);
    }
}
```

## 总结

重试是处理瞬时故障的有效手段：

- **退避算法**：指数退避 + Jitter 避免惊群
- **幂等性**：重试的前提，防重复执行
- **熔断器**：防止重试风暴

好的重试策略 + 幂等保证 = 系统的韧性。

**面试追问方向：**
- 指数退避和 Jitter 是什么？解决什么问题？
- 如何保证重试不超过系统负载？
- 幂等性有哪些实现方案？
- Spring Retry 如何配置？