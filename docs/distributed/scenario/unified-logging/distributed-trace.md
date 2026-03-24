# 分布式日志追踪：TraceId + SpanId 全链路串联

你的请求经过网关 → 用户服务 → 订单服务 → 库存服务 → 支付服务。

用户打电话投诉：支付失败了。

你需要在 5 个服务的日志中，找到这次请求的所有日志。

没有 TraceId，你得一个一个服务去查。

有了 TraceId，一条命令搞定。

## 分布式追踪的核心问题

一个请求经过多个服务，如何串联日志？

```
用户请求 → 网关 → 用户服务 → 订单服务 → 库存服务 → 支付服务
    |         |          |          |          |
   日志     日志       日志       日志       日志
```

如果没有 TraceId，你需要知道用户的请求时间、用户 ID，然后人工关联。

有了 TraceId，所有日志都有同一个 TraceId，一搜就出来了。

## TraceId

TraceId 是请求链路的唯一标识，从请求入口生成。

```java
// 网关生成 TraceId
@Component
public class TraceIdFilter extends ZuulFilter {

    @Override
    public Object run() {
        RequestContext context = RequestContext.getCurrentContext();
        String traceId = context.getRequest().getHeader("X-Trace-Id");

        if (StringUtils.isEmpty(traceId)) {
            traceId = UUID.randomUUID().toString();
        }

        Tracer.setTraceId(traceId);
        context.addZuulRequestHeader("X-Trace-Id", traceId);

        return null;
    }
}
```

## SpanId

SpanId 是每个服务调用步骤的编号，有层级关系。

```
TraceId: abc123
  SpanId: 1  (网关)
    SpanId: 1.1  (用户服务)
      SpanId: 1.1.1  (订单服务)
        SpanId: 1.1.1.1  (库存服务)
        SpanId: 1.1.1.2  (支付服务)
```

### TraceId 和 SpanId 的关系

- **TraceId**：贯穿整个链路，唯一标识
- **SpanId**：每一步的编号，有层级关系
- **ParentId**：当前调用的父 SpanId

## TraceId 传递

### HTTP Header 传递

```java
// 网关
public class TraceIdInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
                            Object handler) {
        String traceId = request.getHeader("X-Trace-Id");

        if (StringUtils.isEmpty(traceId)) {
            traceId = UUID.randomUUID().toString();
        }

        MDC.put("traceId", traceId);
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                               Object handler, Exception ex) {
        MDC.remove("traceId");
    }
}

// Feign 传递
@Configuration
public class FeignConfig {

    @Bean
    public RequestInterceptor requestInterceptor() {
        return template -> {
            template.header("X-Trace-Id", MDC.get("traceId"));
        };
    }
}
```

### MQ 消息 Header 传递

```java
@Service
public class OrderMessageProducer {

    @Autowired
    private RocketMQTemplate rocketMQTemplate;

    public void sendOrderCreatedEvent(Order order) {
        Message&lt;Order&gt; message = MessageBuilder
            .withPayload(order)
            .setHeader("X-Trace-Id", MDC.get("traceId"))
            .build();

        rocketMQTemplate.asyncSend("order:created", message, null);
    }
}

@Service
public class OrderMessageConsumer {

    @RocketMQMessageListener(topic = "order:created")
    public void onMessage(Order order, MessageHeaders headers) {
        String traceId = headers.get("X-Trace-Id", String.class);

        MDC.put("traceId", traceId);

        try {
            processOrder(order);
        } finally {
            MDC.remove("traceId");
        }
    }
}
```

## Logback MDC 集成

Logback MDC 可以将 TraceId 自动写入日志：

```java
@Configuration
public class LogbackConfig {

    @Bean
    public FilterRegistrationBean&lt;TraceIdFilter&gt; traceIdFilter() {
        FilterRegistrationBean&lt;TraceIdFilter&gt; bean = new FilterRegistrationBean&lt;&gt;();
        bean.setFilter(new TraceIdFilter());
        bean.addUrlPatterns("/*");
        return bean;
    }
}
```

Logback 配置：

```xml
<configuration>
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] [%X{traceId}] %-5level %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>
</configuration>
```

日志输出：

```
2024-01-15 10:30:00.001 [http-nio-8080-exec-1] [abc123] INFO  UserService - 获取用户信息
2024-01-15 10:30:00.005 [http-nio-8080-exec-1] [abc123] INFO  OrderService - 创建订单
```

## 完整的追踪工具链

### Skywalking

APM 工具，自动埋点、无代码侵入：

```yaml
# Skywalking agent 配置
agent:
  collector:
    backend_services: oap-server:11800
  sample:
    per_5_sec: 2
```

### Zipkin

轻量级追踪工具：

```java
// 引入依赖
// <dependency>
//     <groupId>org.springframework.cloud</groupId>
//     <artifactId>spring-cloud-starter-sleuth-zipkin</artifactId>
// </dependency>

spring:
  zipkin:
    base-url: http://zipkin-server:9411
```

## 面试追问方向

- TraceId 如何生成？（答：UUID 或 Twitter Snowflake）
- SpanId 的层级关系怎么建立？（答：通过 ParentId 建立父子关系）
- Skywalking 和 Zipkin 的区别？（答：Skywalking 功能更丰富、支持自动埋点；Zipkin 更轻量）
- 如何在日志中看到 TraceId？（答：Logback MDC 配置）

## 小结

分布式追踪的核心是 TraceId：

1. **TraceId**：请求链路的唯一标识
2. **SpanId**：每一步的编号
3. **MDC 集成**：TraceId 自动写入日志
4. **工具链**：Skywalking、Zipkin、Jaeger

有了 TraceId，排查问题从 30 分钟变成 3 分钟。
