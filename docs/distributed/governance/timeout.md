# 服务超时：超时传递与最佳实践

你有没有想过这个问题：

服务 A 超时了，但服务 B、C、D 还在拼命执行。

A 超时返回了错误，但 B、C、D 浪费了大量资源做无用功。

这就是**超时传递**的问题。

## 超时是分布式系统的隐形杀手

分布式系统中，每个调用都可能超时。

```java
// 调用链路
A → B → C → D

// A 设置超时 1 秒
// B 设置超时 1 秒
// C 设置超时 1 秒
// D 设置超时 1 秒

// 实际耗时：
// A 等待 B: 1000ms (超时)
// B 等待 C: 2000ms
// C 等待 D: 2000ms
// D 执行: 5000ms
```

整个链路可能浪费几秒的资源。

## 超时传递的实现

### 概念

超时传递：将上游的超时时间，传递给下游调用链。

```
上游超时 1 秒 → 下游超时 800ms → 下游超时 600ms
```

### 实现方式

```java
// 传递超时时间
public class TimeoutPropagation {

    private static final long DEFAULT_TIMEOUT = 1000;

    public String callService(String serviceName, long parentTimeout) {
        // 扣除本服务处理时间
        long localProcessingTime = 100; // 假设本服务需要 100ms
        long downstreamTimeout = parentTimeout - localProcessingTime;

        // 下游调用时传递超时
        try {
            return restTemplate.getForObject(
                "http://" + serviceName + "/api",
                String.class,
                downstreamTimeout
            );
        } catch (RestClientException e) {
            throw new TimeoutException("调用 " + serviceName + " 超时");
        }
    }
}
```

## 最佳实践原则

### 1. 设置默认值

```yaml
# 全局超时配置
hystrix:
  command:
    default:
      execution:
        timeout:
          enabled: true
        isolation:
          thread:
            timeoutInMilliseconds: 3000
```

### 2. 下游超时 < 上游超时

```java
// 上游超时：3 秒
@HystrixCommand(commandKey = "serviceA")
public String serviceA() {
    // 下游超时：2 秒（给重试留时间）
    return serviceB();
}

@HystrixCommand(
    commandKey = "serviceB",
    commandProperties = {
        @HystrixProperty(name = "execution.isolation.thread.timeoutInMilliseconds", value = "2000")
    }
)
public String serviceB() {
    // 再下游超时：1.5 秒
    return serviceC();
}
```

### 3. 核心链路超时控制

```java
// 核心链路超时配置
@Configuration
public class TimeoutConfig {

    @Bean
    public feign.Logger.Level feignLoggerLevel() {
        return feign.Logger.Level.FULL;
    }

    @Bean
    public Request.Options requestOptions() {
        // 全局超时配置
        return new Request.Options(3000, 3000);
    }
}
```

## Dubbo 超时配置

```xml
<!-- 全局超时 -->
<dubbo:consumer timeout="3000" />

<!-- 接口级超时 -->
<dubbo:reference interface="com.example.UserService"
    timeout="5000" />

<!-- 方法级超时 -->
<dubbo:method name="getUser" timeout="1000" />
```

```java
// Java 配置
@DubboReference(timeout = 3000, methods = {
    @DubboMethod(timeout = 1000, method = "getUser"),
    @DubboMethod(timeout = 2000, method = "createUser")
})
private UserService userService;
```

## 超时治理

### 监控

```java
// 记录超时
public class TimeoutMonitor {

    public void recordTimeout(String service, long timeout, long actual) {
        metrics.record("service.timeout",
            Map.of(
                "service", service,
                "timeout", timeout,
                "actual", actual,
                "exceeded", actual > timeout
            )
        );
    }
}
```

### 告警

```yaml
# Prometheus 告警规则
groups:
  - name: timeout
    rules:
      - alert: ServiceTimeoutHigh
        expr: rate(http_server_requests_seconds_count{status="timeout"} [5m]) > 0.1
        for: 5m
        labels:
          severity: warning
```

## 总结

超时是分布式系统的关键配置：

- **超时传递**：让每个调用都有合适的超时时间
- **下游 < 上游**：给重试留出时间
- **核心链路 < 1 秒**：快速失败，快速恢复
- **监控 + 告警**：及时发现超时问题

好的超时配置，能让你的系统在部分服务故障时「快速失败」而不是「无限等待」。

**面试追问方向：**
- 超时传递如何实现？
- 下游超时为什么不能等于上游超时？
- 如何确定合理的超时时间？
- 超时后如何处理？