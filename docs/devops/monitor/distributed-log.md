# 分布式日志追踪：请求 ID、OpenTelemetry、Jaeger

「这个请求从哪来、到哪去？」——分布式日志追踪的答案。

一个用户请求，经过 API Gateway → 订单服务 → 支付服务 → 库存服务 → 数据库。每一步都可能出错，你需要知道：请求在哪一步失败了？耗时在哪一步最高？这就是分布式追踪的意义。

## 分布式追踪的核心概念

```
┌─────────────────────────────────────────────────────────────────┐
│                 分布式追踪核心概念                                  │
│                                                                  │
│  Trace（追踪）                                                   │
│  请求从开始到结束的完整路径                                       │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Trace                                                        │  │
│  │  ├── Span 1: API Gateway                                     │  │
│  │  │   ├── Span 2: Order Service                               │  │
│  │  │   │   ├── Span 3: Payment Service                         │  │
│  │  │   │   ├── Span 4: Inventory Service                       │  │
│  │  │   │   └── Span 5: Notification Service                    │  │
│  │  │   └── Span 6: Database                                     │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Span（跨度）                                                     │
│  一次服务调用或一个操作单元                                       │
│  ├── Span Name: order.create                                    │
│  ├── Span ID: 4bf92f3577b34da6                                 │
│  ├── Parent Span ID: 3bf92f3577b34da5                          │
│  ├── Start Time: 1700000000.000                                │
│  ├── End Time: 1700000000.150                                  │
│  ├── Duration: 150ms                                            │
│  └── Tags: {service: order, method: POST}                      │
│                                                                  │
│  Tags / Attributes（标签）                                        │
│  Key-Value 元数据                                                │
│  {service: order, user_id: 12345, order_id: abc}               │
│                                                                  │
│  Events / Logs（事件）                                            │
│  Span 内的关键事件                                               │
│  {event: "DB query", "db.statement": "SELECT..."}              │
└─────────────────────────────────────────────────────────────────┘
```

## OpenTelemetry（OTel）架构

```
┌─────────────────────────────────────────────────────────────────┐
│                 OpenTelemetry 架构                               │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    应用代码（Application）                   │  │
│  │                                                             │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │           OpenTelemetry SDK                           │  │  │
│  │  │  TracerProvider / Tracer / Span / SpanContext        │  │  │
│  │  │  MeterProvider / Meter / Metric                       │  │  │
│  │  │  LoggerProvider / Logger / LogRecord                  │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  │                         │                                   │  │
│  │  ┌──────────────────────┴──────────────────────────────┐  │  │
│  │  │           Auto Instrumentation                       │  │  │
│  │  │  Java Agent / Python Agent / Go Instrumentation    │  │  │
│  │  └──────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────┬─────────────────────────────────┘  │
│                              │                                     │
│                              │ OTLP / W3C Trace Context            │
│                              ▼                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Collector（可选中间层）                      │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │  │
│  │  │ Receivers│  │Processors│  │Exporters│  │ Connectors│        │  │
│  │  │ OTLP     │  │ Batch    │  │ Jaeger   │  │ fan-out   │        │  │
│  │  │ Jaeger   │  │ Memory   │  │ OTLP     │  │           │        │  │
│  │  │ Zipkin   │  │ Rate     │  │ Prometheus│ │           │        │  │
│  │  │ S3       │  │ Limiter  │  │ S3       │  │           │        │  │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                    ┌─────────┼─────────┐                          │
│                    ▼         ▼         ▼                          │
│              ┌─────────┐ ┌─────────┐ ┌─────────┐                  │
│              │ Jaeger   │ │  Tempo   │ │ Prometheus│                  │
│              │          │ │ (Grafana)│ │          │                  │
│              └─────────┘ └─────────┘ └─────────┘                  │
└─────────────────────────────────────────────────────────────────┘
```

## Java 应用接入 OTel

### Spring Boot + Micrometer

```xml
<!-- pom.xml -->
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-tracing-bridge-otel</artifactId>
</dependency>
<dependency>
    <groupId>io.opentelemetry</groupId>
    <artifactId>opentelemetry-exporter-otlp</artifactId>
</dependency>
```

```yaml
# application.yml
spring:
  application:
    name: order-service
  otlp:
    tracing:
      endpoint: http://otel-collector:4318/v1/traces
      headers:
        Authorization: Bearer ${OTEL_TOKEN}
  sleuth:
    sampler:
      probability: 1.0  # 采样率
    baggage:
      remote-fields: user_id,order_id  # baggage 传递

management:
  tracing:
    sampling:
      probability: 1.0
    propagation:
      style: w3c
```

```java
// 自定义链路追踪
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Scope;

@Service
public class OrderService {
    private final Tracer tracer;

    public OrderService(Tracer tracer) {
        this.tracer = tracer;
    }

    public Order createOrder(OrderRequest request) {
        // 创建子 Span
        Span span = tracer.spanBuilder("order.create")
            .setAttribute("order.type", request.getType())
            .setAttribute("user.id", request.getUserId())
            .startSpan();

        try (Scope scope = span.makeCurrentScope()) {
            // 验证订单
            span.addEvent("validating order");
            validateOrder(request);

            // 调用库存服务
            span.addEvent("calling inventory service");
            inventoryService.reserve(request);

            // 调用支付服务
            span.addEvent("calling payment service");
            PaymentResult result = paymentService.process(request);

            span.setAttribute("payment.status", result.getStatus());
            span.setAttribute("payment.id", result.getPaymentId());

            // 创建订单
            Order order = orderRepository.save(createOrder(request, result));

            span.setAttribute("order.id", order.getId());
            span.setAttribute("order.status", order.getStatus());

            return order;
        } catch (Exception e) {
            span.recordException(e);
            span.setStatus(StatusCode.ERROR, e.getMessage());
            throw e;
        } finally {
            span.end();
        }
    }
}
```

## Go 应用接入 OTel

### Gin + OpenTelemetry

```go
// main.go
package main

import (
    "context"
    "fmt"
    "log"
    "net/http"
    "time"

    "github.com/gin-gonic/gin"
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/attribute"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
    "go.opentelemetry.io/otel/propagation"
    "go.opentelemetry.io/otel/sdk/resource"
    "go.opentelemetry.io/otel/sdk/trace"
    semconv "go.opentelemetry.io/otel/semconv/v1.17.0"
    "go.opentelemetry.io/contrib/instrumentation/github.com/gin/gin-otel"
)

func initTracer() func() {
    ctx := context.Background()

    // 创建 OTLP Exporter
    exporter, err := otlptracegrpc.New(ctx,
        otlptracegrpc.WithEndpoint("otel-collector:4317"),
        otlptracegrpc.WithInsecure(),
    )
    if err != nil {
        log.Fatal(err)
    }

    // 创建 Resource
    res, err := resource.Merge(
        resource.Default(),
        resource.NewWithAttributes(
            semconv.SchemaURL,
            semconv.ServiceName("order-service"),
            semconv.ServiceVersion("v1.0"),
            attribute.String("environment", "production"),
        ),
    )

    // 创建 TracerProvider
    tp := trace.NewTracerProvider(
        trace.WithBatcher(exporter),
        trace.WithResource(res),
        trace.WithSampler(trace.ParentBased(trace.TraceIDRatioBased(1.0))),
    )

    otel.SetTracerProvider(tp)
    otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
        propagation.TraceContext{},
        propagation.Baggage{},
    ))

    return func() {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        if err := tp.Shutdown(ctx); err != nil {
            log.Printf("Error shutting down tracer provider: %v", err)
        }
    }
}

func main() {
    cleanup := initTracer()
    defer cleanup()

    r := gin.New()
    r.Use(ginotel.Middleware("order-service"))
    r.GET("/health", func(c *gin.Context) {
        c.JSON(200, gin.H{"status": "ok"})
    })
    r.POST("/orders", createOrder)
    r.Run(":8080")
}

func createOrder(c *gin.Context) {
    // 从 Context 提取 Trace 信息
    span := trace.SpanFromContext(c.Request.Context())
    span.SetAttributes(attribute.String("order.action", "create"))

    // 业务逻辑...
    c.JSON(http.StatusCreated, gin.H{"order_id": "12345"})
}
```

## 请求 ID 透传

### Header 规范

```
┌─────────────────────────────────────────────────────────────────┐
│                    W3C Trace Context                             │
│                                                                  │
│  格式：                                                         │
│  traceparent: 00-<trace-id>-<span-id>-<flags>                  │
│                                                                  │
│  示例：                                                         │
│  traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f07aa0e6d04e58-01  │
│                                                                  │
│  字段含义：                                                     │
│  - version: 00（1 byte）                                        │
│  - trace-id: 32 hex characters（唯一追踪 ID）                   │
│  - span-id: 16 hex characters（当前调用 ID）                     │
│  - flags: 01（sampled，采样标记）                                │
│                                                                  │
│  tracestate: congo=t61rcWkgMzE,rojo=00f067aa0ba902b7            │
│  用于多系统间的上下文传递                                         │
└─────────────────────────────────────────────────────────────────┘
```

### Java 请求 ID 拦截器

```java
@Component
public class TraceInterceptor implements HandlerInterceptor {
    private static final String TRACE_ID_HEADER = "X-Request-ID";
    private static final Logger logger = LoggerFactory.getLogger(TraceInterceptor.class);

    @Autowired
    private Tracer tracer;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        // 获取或生成请求 ID
        String requestId = request.getHeader(TRACE_ID_HEADER);
        if (requestId == null || requestId.isEmpty()) {
            requestId = UUID.randomUUID().toString();
        }

        // 注入 MDC
        MDC.put("requestId", requestId);
        response.setHeader(TRACE_ID_HEADER, requestId);

        // 创建或延续 Trace Span
        Span currentSpan = tracer.currentSpan();
        if (currentSpan != null) {
            currentSpan.setAttribute("http.request_id", requestId);
            currentSpan.setAttribute("http.client_ip", getClientIp(request));
        }

        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                Object handler, Exception ex) {
        // 清理 MDC
        MDC.clear();

        // 记录请求日志
        Span currentSpan = tracer.currentSpan();
        if (currentSpan != null) {
            currentSpan.setAttribute("http.status_code", response.getStatus());
            if (ex != null) {
                currentSpan.recordException(ex);
            }
        }
    }

    private String getClientIp(HttpServletRequest request) {
        String xForwardedFor = request.getHeader("X-Forwarded-For");
        if (xForwardedFor != null && !xForwardedFor.isEmpty()) {
            return xForwardedFor.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
```

### 日志 MDC 集成

```java
// Logback 配置
<encoder>
    <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%thread] [%X{traceId:-}] [%X{spanId:-}] %-5level %logger{36} - %msg%n</pattern>
</encoder>
```

```java
// 日志中使用
@Slf4j
public class OrderService {
    public void process() {
        // 自动带上 traceId
        log.info("Processing order");
        // 输出：2024-01-01 10:00:00.000 [http-nio-8080-exec-1] [4bf92f3577b34da6] [00f07aa0e6d04e58] INFO  OrderService - Processing order
    }
}
```

## Jaeger 部署

```yaml
# jaeger.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jaeger
  namespace: monitoring
spec:
  replicas: 1
  selector:
    matchLabels:
      app: jaeger
  template:
    metadata:
      labels:
        app: jaeger
    spec:
      containers:
        - name: jaeger
          image: jaegertracing/all-in-one:1.52
          ports:
            - containerPort: 16686
              name: query
            - containerPort: 6831
              name: agent-grpc
            - containerPort: 14268
              name: collector-http
            - containerPort: 4317
              name: otlp-grpc
            - containerPort: 4318
              name: otlp-http
          env:
            - name: COLLECTOR_OTLP_ENABLED
              value: "true"
            - name: SPAN_STORAGE_TYPE
              value: elasticsearch
            - name: ES_SERVER_URLS
              value: http://elasticsearch:9200
            - name: ES_INDEX_PREFIX
              value: jaeger
            - name: ES_USERNAME
              value: elastic
            - name: ES_PASSWORD
              value: changeme
          resources:
            requests:
              cpu: 100m
              memory: 512Mi
            limits:
              cpu: 500m
              memory: 1Gi
---
apiVersion: v1
kind: Service
metadata:
  name: jaeger
  namespace: monitoring
spec:
  selector:
    app: jaeger
  ports:
    - port: 16686
      targetPort: 16686
      name: query
    - port: 4317
      targetPort: 4317
      name: otlp-grpc
    - port: 4318
      targetPort: 4318
      name: otlp-http
---
# Ingress
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: jaeger
  namespace: monitoring
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  rules:
    - host: jaeger.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: jaeger
                port:
                  number: 16686
```

## 常见问题

```
# 问题一：采样率配置不当
# 高流量时 100% 采样会导致存储爆炸
# 解决：尾部采样（Tail-based Sampling）
# - 错误率 > 1% 的请求全部采样
# - 延迟 > 1s 的请求全部采样
# - 有异常的请求全部采样

# 问题二：Trace ID 不连续
# 某些请求没有 Trace ID，可能是：
# 1. 消息队列异步处理（需要手动传递 Context）
# 2. 定时任务（需要主动创建 Span）
# 3. gRPC 客户端未注入 Header

# 问题三：Jaeger 查询慢
# 原因：ES 索引过大、shard 不合理
# 解决：设置合理的 ILM 策略，按日期滚动索引

# 问题四：微服务间 Baggage 传递失败
# 原因：部分服务没有配置 Propagator
# 解决：确保所有服务使用相同的 W3C Trace Context
```

## 面试追问方向

1. **OpenTelemetry 和 Jaeger 的关系是什么？**
   答：OpenTelemetry 是 CNCF 的可观测性标准，包括 Tracing、Metrics、Logging 三个方向；Jaeger 是分布式追踪系统（Tracer）。OpenTelemetry 定义了数据模型和 SDK，Jaeger 是实现之一。你可以用 OTel SDK 采集数据，导出到 Jaeger，也可以导出到 Zipkin、DataDog 等。

2. **分布式追踪的采样策略有哪些？**
   答：头部采样（Head-based Sampling）在请求入口决定是否采样，如 1% 采样；尾部采样（Tail-based Sampling）在请求结束后根据结果决定，适合发现异常请求，但需要 Collector 支持。生产环境推荐「低频采样 + 尾部采样补偿」，既控制存储成本，又不漏掉异常。

3. **如何将 Trace 和日志关联？**
   答：通过 MDC（Mapped Diagnostic Context）将 Trace ID 写入日志上下文。在 Java 中用 `log4j2` 的 `%X{traceId}` 格式打印；在 Go 中用 `otel.SetBaggage` 或自定义 Context。日志查询时用 Trace ID 搜索，即可看到该请求的全链路日志。

4. **什么情况下需要手动创建 Span？**
   答：Auto Instrumentation 只能覆盖 HTTP/gRPC/Database 框架层。对于关键业务逻辑（如订单创建、支付流程）、异步任务（消息队列消费）、批量处理等，需要手动创建 Span 来追踪。Span 名称要描述清晰（如 `order.create`、`payment.process`），方便在 Trace 视图中定位。

分布式追踪让「请求在哪个服务出错了」不再是谜题。它是微服务架构的必备基础设施。
