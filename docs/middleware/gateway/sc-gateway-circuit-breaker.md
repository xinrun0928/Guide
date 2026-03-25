# Spring Cloud Gateway 熔断

想象一下这个场景：电商网站首页调用了 10 个微服务，其中一个服务（比如推荐服务）响应变慢了。因为这个慢服务，整个首页都加载不出来。

这就是经典的**级联失败**问题。解决方案就是**熔断器（Circuit Breaker）**——当检测到下游服务不稳定时，「熔断」这个调用，直接返回降级响应，保护整个系统不被拖垮。

## 熔断器模式

熔断器借鉴了电路保险丝的思想，有三个状态：

```
        ┌─────────────────────────────────────┐
        │                                     │
        ▼                                     │
    ┌───────┐    失败率超阈值    ┌──────────┐  │
    │Closed │ ───────────────▶ │   Open   │  │
    │ 关闭  │                   │   熔断  │  │
    └───────┘                   └──────────┘  │
        ▲                             │       │
        │ 探测成功                    │ 超时   │
        │                             │ 后尝试 │
        │                             ▼       │
        │                         ┌──────────┐ │
        └──────────────────────── │  Half   │ │
              探测失败继续熔断      │  Open   │ │
                └────────────────▶│   半开  │ │
                                  └──────────┘ │
                                                     │
```

### 三种状态详解

| 状态 | 行为 | 何时进入 |
|---|---|---|
| Closed（关闭） | 正常调用，失败记录到计数器 | 系统启动时 / 探测成功后 |
| Open（打开） | 所有请求直接返回降级响应 | 失败率超过阈值 |
| Half-Open（半开） | 允许一个请求通过探测 | 熔断超时后 |

### 熔断策略

| 策略 | 说明 | 配置参数 |
|---|---|---|
| 失败率熔断 | 失败率超过阈值时熔断 | failureRateThreshold |
| 慢调用熔断 | 响应时间超过阈值时熔断 | slowCallDurationThreshold |
| 熔断时长 | 熔断持续多长时间 | waitDurationInOpenState |
| 半开探测数 | 半开状态允许通过的请求数 | permittedNumberOfCallsInHalfOpen |

## Resilience4j 集成

Spring Cloud Gateway 使用 Resilience4j 作为熔断组件。

### Maven 依赖

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-gateway-mvc</artifactId>
</dependency>

<!-- Resilience4j -->
<dependency>
    <groupId>io.github.resilience4j</groupId>
    <artifactId>resilience4j-spring-boot2</artifactId>
</dependency>

<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-aop</artifactId>
</dependency>
```

### 基础配置

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/api/order/**
          filters:
            - name: CircuitBreaker
              args:
                name: orderCircuitBreaker
                fallbackUri: forward:/fallback/order

resilience4j:
  circuitbreaker:
    configs:
      default:
        # 熔断器配置
        registerHealthIndicator: true          # 注册健康检查
        slidingWindowSize: 10                  # 滑动窗口大小（记录最近 10 次调用）
        minimumNumberOfCalls: 5                # 最小调用次数（达到后才计算失败率）
        permittedNumberOfCallsInHalfOpenState: 3  # 半开状态允许的调用次数
        automaticTransitionFromOpenToHalfOpenEnabled: true  # 自动从打开转为半开
        waitDurationInOpenState: 10s           # 熔断持续时间
        failureRateThreshold: 50               # 失败率阈值（超过 50% 则熔断）
        slowCallRateThreshold: 80              # 慢调用率阈值
        slowCallDurationThreshold: 2s           # 慢调用阈值（超过 2s 视为慢调用）
    instances:
      orderCircuitBreaker:
        baseConfig: default
        # 可以为特定实例覆盖配置
        slidingWindowSize: 20
        failureRateThreshold: 60
```

### 降级响应

当熔断触发时，网关会转发到配置的降级 URI：

```java
@RestController
public class FallbackController {
    
    @GetMapping("/fallback/order")
    public ResponseEntity&lt;Map&lt;String, Object&gt;&gt; orderFallback() {
        Map&lt;String, Object&gt; response = new HashMap&lt;&gt;();
        response.put("code", 503);
        response.put("message", "服务暂时不可用，请稍后重试");
        response.put("data", Collections.singletonMap(
            "recommendation", "建议稍后刷新页面或联系客服"
        ));
        return ResponseEntity.status(503).body(response);
    }
    
    @GetMapping("/fallback/product")
    public ResponseEntity&lt;Map&lt;String, Object&gt;&gt; productFallback() {
        Map&lt;String, Object&gt; response = new HashMap&lt;&gt;();
        response.put("code", 503);
        response.put("message", "商品服务暂时不可用");
        response.put("data", Collections.singletonMap(
            "cachedProducts", getCachedProducts()  // 返回缓存数据
        ));
        return ResponseEntity.status(503).body(response);
    }
}
```

## 自定义熔断过滤器

除了使用内置的 CircuitBreaker Filter，还可以自定义更灵活的熔断逻辑：

```java
@Component
@Slf4j
public class CustomCircuitBreakerFilter implements GatewayFilter, Ordered {
    
    private final CircuitBreakerRegistry circuitBreakerRegistry;
    
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String routeId = exchange.getAttribute(GATEWAY_HANDLER_MAPPER_ATTR);
        CircuitBreaker circuitBreaker = circuitBreakerRegistry.circuitBreaker(routeId);
        
        // 使用 Mono 创建可恢复的调用
        Supplier&lt;Mono&lt;Void&gt;&gt; supplier = () -&gt; chain.filter(exchange);
        
        // 使用熔断器包装
        Mono&lt;Void&gt; mono = Mono.fromSupplier(supplier)
            .transformDeferred(CircuitBreakerOperator.of(circuitBreaker))
            .doOnError(e -&gt; {
                // 记录熔断错误
                log.error("Circuit breaker caught error: {}", e.getMessage());
            })
            .onErrorResume(e -&gt; {
                // 降级处理
                return fallback(exchange, routeId);
            });
        
        return mono;
    }
    
    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 50;
    }
    
    private Mono&lt;Void&gt; fallback(ServerWebExchange exchange, String routeId) {
        log.warn("Circuit breaker open for route: {}, returning fallback", routeId);
        
        exchange.getResponse().setStatusCode(HttpStatus.SERVICE_UNAVAILABLE);
        exchange.getResponse().getHeaders().add("Content-Type", "application/json");
        
        String body = String.format(
            "{\"code\": 503, \"message\": \"服务 %s 暂时不可用\", \"routeId\": \"%s\"}",
            routeId,
            routeId
        );
        
        return exchange.getResponse().writeWith(
            Mono.just(exchange.getResponse().bufferFactory().wrap(body.getBytes()))
        );
    }
}
```

## 熔断与重试的配合

熔断和重试是互补的策略：

- **重试**：解决瞬时故障（网络抖动）
- **熔断**：解决持续故障（服务真挂了）

合理的配置是：重试失败后再触发熔断：

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: resilient-route
          uri: lb://service
          predicates:
            - Path=/api/**
          filters:
            # 先重试（最多 3 次）
            - name: Retry
              args:
                retries: 3
                statuses: INTERNAL_SERVER_ERROR, SERVICE_UNAVAILABLE
                series: SERVER_ERROR
            # 重试失败后熔断
            - name: CircuitBreaker
              args:
                name: serviceCircuit
                fallbackUri: forward:/fallback
```

```java
// Java DSL 配置
.route("resilient-route", r -&gt; r
    .path("/api/**")
    .filters(f -&gt; f
        .retry(retry -&gt; retry
            .setRetries(3)
            .setStatuses(HttpStatus.INTERNAL_SERVER_ERROR))
        .circuitBreaker(cb -&gt; cb
            .setName("serviceCircuit")
            .setFallbackUri("forward:/fallback")))
    .uri("lb://service"))
```

## 熔断监控

生产环境中，需要监控熔断器的状态：

```java
@Configuration
public class CircuitBreakerMonitor {
    
    @Autowired
    private CircuitBreakerRegistry registry;
    
    @PostConstruct
    public void monitor() {
        registry.circuitBreaker("orderCircuitBreaker")
            .getEventPublisher()
            .onStateTransition(event -&gt; {
                CircuitBreaker.State from = event.getStateTransition().getFromState();
                CircuitBreaker.State to = event.getStateTransition().getToState();
                log.warn("Circuit breaker state transition: {} -> {}", from, to);
                
                // 发送告警
                if (to == CircuitBreaker.State.OPEN) {
                    sendAlert("Circuit breaker OPENED!");
                }
            })
            .onErrorRateThresholdExceeded(event -&gt; {
                log.error("Error rate threshold exceeded: {}%", 
                    event.getErrorRatePercentage());
            })
            .onSlowCallRateThresholdExceeded(event -&gt; {
                log.error("Slow call rate threshold exceeded: {}%", 
                    event.getSlowCallRatePercentage());
            });
    }
}
```

```yaml
# Actuator 端点暴露熔断器状态
management:
  endpoints:
    web:
      exposure:
        include: health,info,circuitbreakers,circuitbreakerevents
  endpoint:
    health:
      show-details: always
  health:
    circuitbreakers:
      enabled: true
```

访问 `/actuator/circuitbreakers` 可以查看熔断器状态：

```json
{
  "circuitBreakers": {
    "orderCircuitBreaker": {
      "state": "CLOSED",
      "failureRate": "15.0%",
      "slowCallRate": "5.0%",
      "slowCallDurationThreshold": "2s"
    }
  }
}
```

## 总结

| 配置项 | 说明 | 推荐值 |
|---|---|---|
| slidingWindowSize | 统计调用次数 | 10-100 |
| failureRateThreshold | 失败率阈值 | 50% |
| slowCallDurationThreshold | 慢调用阈值 | 2-5s |
| waitDurationInOpenState | 熔断持续时间 | 30-60s |
| permittedNumberOfCallsInHalfOpenState | 半开探测次数 | 3-5 |

熔断器的核心价值：

1. **快速失败**：不等超时，直接返回降级响应
2. **防止级联失败**：一个服务故障不影响其他服务
3. **自我恢复**：半开状态探测服务是否恢复

---

**留给你的问题**

熔断器虽然保护了系统，但也带来了一个问题：**降级响应可能比正常响应差很多**。

比如商品详情页，熔断后返回的是缓存数据，但缓存可能是旧的。你会如何设计降级策略，让降级响应尽可能有价值？

提示：可以考虑**多级降级**（缓存 → 默认值 → 友好提示）和**降级信息的透明度**（让用户知道这是降级响应）。
