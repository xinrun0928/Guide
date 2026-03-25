# Gateway 熔断降级，Spring Cloud CircuitBreaker 集成

> 某个后端服务挂了，如果网关不处理，请求会一直打到这个服务上——不仅这个服务扛不住，还会拖垮整个系统。
>
> 熔断机制，就是给网关装上「保险丝」。当某个服务故障时，快速熔断，保护整个系统。

---

## 从一个问题开始

```
┌─────────────────────────────────────────────────────────┐
│                    微服务调用链路                          │
│                                                          │
│  用户 ──► 网关 ──► 服务 A ──► 服务 B ──► 服务 C          │
│                       │                                  │
│                       │ 服务 B 故障                      │
│                       ▼                                  │
│               ┌─────────────────┐                        │
│               │  超时、重试、雪崩  │                       │
│               │  整个系统不可用   │                        │
│               └─────────────────┘                        │
└─────────────────────────────────────────────────────────┘
```

**没有熔断**：一个服务故障 → 拖垮整个系统

**有熔断**：检测到故障 → 快速熔断 → 返回降级响应 → 系统可用

---

## 熔断器原理

### 三个状态

```
┌─────────────────────────────────────────────────────────┐
│                    熔断器状态机                           │
│                                                          │
│     ┌─────────────┐                                    │
│     │   关闭       │◄────────────────────┐             │
│     │  (正常)      │                     │            │
│     └──────┬──────┘                     │            │
│            │ 失败率超阈值               │ 恢复        │
│            ▼                           │            │
│     ┌─────────────┐                    │            │
│     │   打开       │───────────────────┘            │
│     │  (熔断)      │                                   │
│     └──────┬──────┘                                   │
│            │ 半开尝试                                  │
│            ▼                                           │
│     ┌─────────────┐                                    │
│     │   半开       │                                    │
│     │  (尝试)      │                                    │
│     └─────────────┘                                    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

| 状态 | 说明 | 行为 |
|---|---|---|
| 关闭（Closed） | 正常状态，请求正常通过 | 统计失败率 |
| 打开（Open） | 故障状态，请求直接降级 | 不发请求到后端 |
| 半开（Half-Open） | 尝试恢复 | 放行部分请求 |

### 状态转换规则

```
关闭 → 打开：失败率超过阈值（如 50%）
打开 → 半开：超过熔断时间（如 30 秒）
半开 → 关闭：请求成功
半开 → 打开：请求失败
```

---

## Gateway 熔断配置

### 1. 引入依赖

```xml
<dependencies>
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-starter-gateway</artifactId>
    </dependency>
    
    <!-- 熔断器：Resilience4j（推荐）或 Sentinel -->
    <dependency>
        <groupId>io.github.resilience4j</groupId>
        <artifactId>resilience4j-spring-boot2</artifactId>
    </dependency>
    <dependency>
        <groupId>io.github.resilience4j</groupId>
        <artifactId>resilience4j-circuitbreaker</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-aop</artifactId>
    </dependency>
</dependencies>
```

### 2. 基础配置

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/api/users/**
          filters:
            - name: CircuitBreaker
              args:
                # 熔断器名称
                name: userServiceCircuitBreaker
                # 降级 URI
                fallbackUri: forward:/fallback/user
```

### 3. Resilience4j 配置

```yaml
resilience4j:
  circuitbreaker:
    configs:
      default:
        # 熔断器滑动窗口类型：COUNT_BASED / TIME_BASED
        slidingWindowType: COUNT_BASED
        # 滑动窗口大小
        slidingWindowSize: 10
        # 最小调用次数（达到这个次数才计算失败率）
        minimumNumberOfCalls: 5
        # 失败率阈值（超过这个比例就熔断）
        failureRateThreshold: 50
        # 等待时间（熔断后多久尝试半开）
        waitDurationInOpenState: 30s
        # 半开允许的调用次数
        permittedNumberOfCallsInHalfOpenState: 3
        # 慢调用阈值
        slowCallDurationThreshold: 3s
        # 慢调用比例阈值
        slowCallRateThreshold: 80
    instances:
      # 针对特定服务的配置
      userServiceCircuitBreaker:
        slidingWindowSize: 20
        failureRateThreshold: 40
        waitDurationInOpenState: 60s
```

---

## 降级响应

### 方式一：转发到本地降级接口

```yaml
filters:
  - name: CircuitBreaker
    args:
      name: userServiceCircuitBreaker
      fallbackUri: forward:/fallback/user
```

```java
@RestController
public class FallbackController {
    
    @GetMapping("/fallback/user")
    public Result&lt;Object&gt; userFallback() {
        return Result.fail(503, "用户服务暂时不可用，请稍后再试");
    }
    
    @GetMapping("/fallback/order")
    public Result&lt;Object&gt; orderFallback() {
        return Result.fail(503, "订单服务暂时不可用，请稍后再试");
    }
}
```

### 方式二：返回静态响应

```java
@Component
public class CustomFallback implements FallbackProvider {
    
    @Override
    public String getRoute() {
        return "user-service";  // 针对哪个路由
        // return "*";  // 或者返回 * 表示所有
    }
    
    @Override
    public Mono&lt;ResponseEntity&lt;Void&gt;&gt; fallbackResponse(String route, Throwable cause) {
        // 记录日志
        log.error("路由 {} 降级，原因: {}", route, cause.getMessage());
        
        return Mono.just(
            ResponseEntity
                .status(HttpStatus.SERVICE_UNAVAILABLE)
                .contentType(MediaType.APPLICATION_JSON)
                .body(null)
        );
    }
}
```

### 方式三：动态降级数据

```java
@Component
public class DynamicFallbackProvider implements FallbackProvider {
    
    @Override
    public String getRoute() {
        return "user-service";
    }
    
    @Override
    public Mono&lt;ResponseEntity&lt;Void&gt;&gt; fallbackResponse(String route, Throwable cause) {
        // 根据异常类型返回不同响应
        if (cause instanceof TimeoutException) {
            return Mono.just(
                ResponseEntity
                    .status(HttpStatus.GATEWAY_TIMEOUT)
                    .body(null)
            );
        }
        
        return Mono.just(
            ResponseEntity
                .status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(null)
        );
    }
}
```

---

## 全局熔断过滤器

```java
@Component
@Slf4j
public class GlobalCircuitBreakerFilter implements GlobalFilter {
    
    private final CircuitBreakerFactory&lt;CircuitBreakerConfig&gt; circuitBreakerFactory;
    
    public GlobalCircuitBreakerFilter(
            CircuitBreakerFactory&lt;CircuitBreakerConfig&gt; circuitBreakerFactory) {
        this.circuitBreakerFactory = circuitBreakerFactory;
    }
    
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        // 获取路由
        String routeId = exchange.getAttribute("org.springframework.cloud.gateway.handler.RouteId");
        
        // 创建/获取熔断器
        CircuitBreaker circuitBreaker = circuitBreakerFactory.create(routeId);
        
        // 使用熔断器包装过滤器链
        return circuitBreaker.run(
            chain.filter(exchange),
            // 降级处理
            throwable -> handleFallback(exchange, throwable)
        );
    }
    
    private Mono&lt;Void&gt; handleFallback(ServerWebExchange exchange, Throwable throwable) {
        log.error("Gateway 熔断降级: {}", throwable.getMessage());
        
        ServerHttpResponse response = exchange.getResponse();
        response.setStatusCode(HttpStatus.SERVICE_UNAVAILABLE);
        response.getHeaders().add("X-Gateway-Fallback", "true");
        
        String body = "{\"code\":503,\"msg\":\"服务暂时不可用\"}";
        DataBuffer buffer = response.bufferFactory().wrap(body.getBytes());
        
        return response.writeWith(Mono.just(buffer));
    }
}
```

---

## 熔断与重试

### 熔断 + 重试的组合

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/api/users/**
          filters:
            # 先重试，再熔断
            - name: Retry
              args:
                retries: 3
                series: 5xx,CLIENT_READ_ERROR
                exceptions: java.io.IOException,java.util.concurrent.TimeoutException
                backoff:
                  firstBackoff: 100ms
                  maxBackoff: 500ms
                  factor: 2
            - name: CircuitBreaker
              args:
                name: userServiceCircuitBreaker
                fallbackUri: forward:/fallback/user
```

### 重试条件

| 参数 | 说明 |
|---|---|
| retries | 重试次数 |
| series | 重试的 HTTP 状态码类型 |
| exceptions | 重试的异常类型 |
| backoff | 退避策略 |

---

## 监控熔断状态

### Actuator 端点

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,circuitbreakers,metrics
  endpoint:
    health:
      show-details: always
  health:
    circuitbreakers:
      enabled: true
```

```bash
# 查看熔断器状态
curl http://localhost:8080/actuator/health

# 查看熔断器详情
curl http://localhost:8080/actuator/circuitbreakers
```

### 自定义监控

```java
@Component
public class CircuitBreakerMetrics {
    
    @Autowired
    private CircuitBreakerRegistry circuitBreakerRegistry;
    
    @Scheduled(fixedRate = 60000)
    public void reportMetrics() {
        circuitBreakerRegistry.getAllCircuitBreakers().forEach(cb -> {
            CircuitBreakerMetrics metrics = cb.getMetrics();
            log.info("熔断器: {}, 状态: {}, 失败率: {}%, 慢调用比例: {}%",
                cb.getName(),
                cb.getState(),
                metrics.getFailureRate(),
                metrics.getSlowCallRate());
        });
    }
}
```

---

## Sentinel 集成（可选）

除了 Resilience4j，还可以使用 Sentinel 作为熔断器：

### 引入依赖

```xml
<dependency>
    <groupId>com.alibaba.csp</groupId>
    <artifactId>sentinel-spring-cloud-gateway-adapter</artifactId>
</dependency>
```

### 配置

```java
@Configuration
public class SentinelConfig {
    
    @PostConstruct
    public void init() {
        // 添加 Sentinel 限流过滤器
        SentinelGatewayFilter filter = new SentinelGatewayFilter();
        // 配置降级响应
        GatewayApiMatcherManager.loadApiMatchers(
            Collections.singletonList(new VersionGatewayApiMatcherGroup("1.0"))
        );
    }
}
```

---

## 实战场景

### 场景一：用户服务故障

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/api/users/**
          filters:
            - name: CircuitBreaker
              args:
                name: userCircuitBreaker
                fallbackUri: forward:/fallback/user
```

```java
@GetMapping("/fallback/user")
public Result&lt;Object&gt; userFallback() {
    return Result.fail(503, "用户服务繁忙，请稍后再试");
}
```

### 场景二：支付服务故障（更严格的熔断）

```yaml
resilience4j:
  circuitbreaker:
    instances:
      paymentCircuitBreaker:
        slidingWindowSize: 5
        failureRateThreshold: 30  # 30% 就熔断
        waitDurationInOpenState: 60s  # 熔断 60 秒
```

---

## 面试高频问题

### Q：熔断和降级有什么区别？

A：**熔断**是防止故障扩散的保护机制，检测到故障后「截断」请求。**降级**是故障后的兜底处理，返回备用数据或响应。熔断是手段，降级是目的。

### Q： Resilience4j 和 Sentinel 怎么选？

A：Resilience4j 是轻量级熔断器，配置简单，适合简单的熔断需求。Sentinel 功能更丰富（限流、热点参数、系统自适应保护），控制台更强大，适合复杂流量控制场景。

### Q：熔断器的参数怎么设置？

A：建议根据业务特点调整：

- **失败率阈值**：核心服务设低（如 30-50%），非核心服务设高（如 70%）
- **熔断时长**：根据服务恢复时间设置，通常 30-60 秒
- **最小调用次数**：设置太低容易误触发，通常 5-10 次

### Q：Gateway 熔断后如何通知运维？

A：可以配合监控告警系统（Prometheus + AlertManager），监控熔断器状态变化。当状态变为 OPEN 时触发告警。

---

## 总结

Gateway 熔断降级提供了完整的保护机制：

1. **熔断器**：三个状态自动切换，保护后端服务
2. **降级响应**：快速返回兜底数据，保证系统可用
3. **Resilience4j**：轻量级熔断器，开箱即用
4. **监控**：通过 Actuator 监控熔断状态

> 熔断是微服务架构的「保险丝」。用好它，可以让系统在部分服务故障时依然保持可用。
