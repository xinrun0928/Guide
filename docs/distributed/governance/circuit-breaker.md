# 服务熔断：断路器模式与状态转换

你有没有想过这个问题：

场景：服务 A 调用服务 B，服务 B 调用服务 C。

某时刻，服务 C 变慢了 → 服务 B 超时 → 服务 A 也超时 → 更多请求打到服务 B → 服务 B 更慢 → 服务 A 更慢 → 系统崩溃。

这就是**雪崩效应**——一个服务的故障，引发了一系列连锁故障。

如何防止雪崩？答案就是**熔断机制**。

## 为什么需要熔断

### 雪崩效应的成因

```
1. 服务 C 响应变慢（网络抖动、数据库慢查询）
2. 服务 B 调用 C 超时，线程阻塞
3. 服务 A 调用 B 也超时，更多请求涌入
4. 服务 B 的线程池耗尽
5. 服务 A 的线程池也耗尽
6. 系统崩溃
```

### 熔断的核心思想

**快速失败，保护系统**。

当检测到下游服务不可用时，立即返回错误或默认值，而不是等待超时。

## 断路器的三个状态

断路器模式模拟了电路保险丝的行为：

```
        ┌──────────────────────────────────────────┐
        │                                          │
        ▼                                          │
┌───────────────┐    失败率 > 阈值     ┌───────────────┐
│   Closed      │ ───────────────────► │     Open      │
│   (关闭)       │                      │   (熔断)       │
│  正常调用      │                      │  快速失败      │
└───────┬───────┘                      └───────┬───────┘
        │                                      │
        │                                      │
        │ 超时后放行请求                        │ 超时后放行请求
        │ 探测成功                              │ 探测失败
        ▼                                      ▼
┌───────────────┐    失败率 > 阈值     ┌───────────────┐
│   Half-Open   │ ───────────────────► │     Open      │
│  (半开)        │                      │   (熔断)       │
│  放行探测      │                      │  快速失败      │
└───────┬───────┘                      └───────────────┘
        │
        │ 探测成功
        ▼
┌───────────────┐
│    Closed      │
│   (关闭)       │
│  正常调用      │
└───────────────┘
```

### Closed（关闭状态）

```
- 断路器关闭，正常调用下游服务
- 统计失败率
- 如果失败率超过阈值 → 切换到 Open
```

### Open（打开状态）

```
- 断路器打开，快速失败（返回错误或默认值）
- 不调用下游服务
- 超过熔断时间 → 切换到 Half-Open
```

### Half-Open（半开状态）

```
- 断路器半开，放行部分请求进行探测
- 如果探测成功 → 切换到 Closed
- 如果探测失败 → 切换到 Open
```

## 断路器的参数配置

```java
public class CircuitBreakerConfig {
    // 失败率阈值，超过此阈值熔断
    private double failureRateThreshold = 50;
    // 熔断持续时间（毫秒）
    private long sleepWindowInMillis = 60_000;
    // 滑动窗口大小（毫秒）
    private long slidingWindowSizeInMillis = 100_000;
    // 最小请求数，低于此数量不计算失败率
    private int minimumNumberOfRequests = 100;
    // 半开状态允许的探测请求数
    private int permittedNumberOfCallsInHalfOpenState = 10;
}
```

## Sentinel 熔断器

Sentinel 是阿里巴巴开源的流量控制组件，是 Hystrix 的替代者。

### Sentinel 核心概念

```java
// 引入 Sentinel
<dependency>
    <groupId>com.alibaba.csp</groupId>
    <artifactId>sentinel-core</artifactId>
    <version>1.8.6</version>
</dependency>
```

### Sentinel 熔断规则

```java
// 定义熔断规则
List&lt;DegradeRule&gt; rules = new ArrayList&lt;&gt;();

DegradeRule rule = new DegradeRule("userService")
    .setGrade(CircuitBreaker.ERROR_RATIO)  // 按失败比例熔断
    .setCount(0.5)                          // 失败率 50%
    .setSlowRatioThreshold(1.0)             // 最大响应时间（秒）
    .setMinRequestAmount(5)                 // 最小请求数
    .setStatIntervalMs(10000)               // 统计窗口大小（毫秒）
    .setTimeWindow(10);                     // 熔断持续时间（秒）

rules.add(rule);
DegradeRuleManager.loadRules(rules);
```

### Sentinel 使用示例

```java
public class UserService {

    public String getUser(Long id) {
        try (Entry entry = SphU.entry("getUser")) {
            // 正常业务逻辑
            return userDao.findById(id);
        } catch (BlockException e) {
            // 被限流或熔断
            return getDefaultUser(id);
        }
    }
}
```

```java
// 使用注解方式
@SentinelResource(value = "getUser", fallback = "getUserFallback")
public User getUser(Long id) {
    return userDao.findById(id);
}

public User getUserFallback(Long id, Throwable t) {
    // 熔断时的兜底逻辑
    log.error("getUser fallback, id={}", id, t);
    return User.DEFAULT;
}
```

## Sentinel vs Hystrix

| 维度 | Sentinel | Hystrix |
|------|----------|---------|
| 活跃度 | 活跃维护 | 已停止维护 |
| 限流维度 | QPS/并发数 | 线程池 |
| 熔断策略 | 慢调用比例/异常比例/异常数 | 失败率 |
| 实时性 | 滑动窗口统计 | 线程池统计 |
| 学习资源 | 中文文档丰富 | 英文文档为主 |

## 总结

断路器模式是防止雪崩的利器：

- **Closed**：正常调用，统计失败率
- **Open**：熔断，快速失败
- **Half-Open**：探测，恢复正常则关闭

Sentinel 是目前推荐的熔断组件。

**面试追问方向：**
- 熔断和降级有什么区别？
- Sentinel 和 Hystrix 的区别是什么？
- 如何配置熔断参数？
- 半开状态下，为什么只放行部分请求？