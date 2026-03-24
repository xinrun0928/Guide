# 分布式链路追踪：Jaeger

「请求链路怎么追踪？」——Jaeger 是云原生分布式追踪的标准方案。

一个 API 请求经过网关 → 服务 A → 服务 B → 服务 C → 数据库，涉及 10+ 个微服务，每个服务可能有几十个实例。当请求变慢或失败时，是哪个环节出了问题？Jaeger 回答这个问题。

## 链路追踪核心概念

```
┌─────────────────────────────────────────────────────────────────┐
│                    分布式链路追踪原理                             │
│                                                                  │
│  Trace (完整请求链路)                                           │
│  └── Span 1 (API Gateway) ──────────────────────────────────│
│      ├── Span 2 (Auth Service)                                 │
│      └── Span 3 (Order Service) ──────────────────────────────│
│          ├── Span 4 (Inventory Service)                         │
│          └── Span 5 (Payment Service)                          │
│                                                                  │
│  每个 Span 包含：                                              │
│  - operationName: 操作名                                        │
│  - startTime / endTime: 时间戳                                 │
│  - tags: 业务标签 (http.status_code=200)                      │
│  - logs: 事件日志                                              │
│  - references: 父子 Span 关系                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Jaeger 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      Jaeger 架构                                 │
│                                                                  │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐  ┌──────────┐ │
│  │  应用    │────►│  Agent   │────►│ Collector │──►│ Cassandra│ │
│  │ (埋点)  │     │ (本地代理)│     │ (收集器) │  │ (存储)   │ │
│  └──────────┘     └──────────┘     └──────────┘  └──────────┘ │
│                                                  │              │
│  ┌──────────┐                            ┌─────┴──────────┐  │
│  │  SDK     │                            │  Elasticsearch  │  │
│  │ (Open    │                            │  / BigTable    │  │
│  │  Tracing)│                            └────────────────┘  │
│  └──────────┘                            ┌────────────────┐  │
│                                          │  Jaeger Query  │──►│  UI │
│                                          │  (查询服务)   │  └──────────┘
└─────────────────────────────────────────────────────────────────┘
```

## Jaeger 部署

### Docker Compose 部署

```bash
# docker-compose.yml
version: '3.8'
services:
  jaeger:
    image: jaegertracing/all-in-one:1.52
    ports:
      - "16686:16686"    # Jaeger UI
      - "6831:6831/udp"  # Jaeger Agent (Compact thrift)
      - "14250:14250"    # gRPC
      - "14268:14268"     # Jaeger Collector (Zipkin)
    environment:
      - COLLECTOR_ZIPKIN_HOST_PORT=:9411
      - SPAN_STORAGE_TYPE=cassandra
      - CASSANDRA_SERVERS=cassandra:9042
      - CASSANDRA_KEYSPACE=jaeger_v1_dc1
    depends_on:
      - cassandra

  cassandra:
    image: cassandra:4.0
    ports:
      - "9042:9042"
    environment:
      - CASSANDRA_START_RPC=true
    volumes:
      - cassandra-data:/var/lib/cassandra

  # 使用 Elasticsearch 时
  # elasticsearch:
  #   image: elasticsearch:8.11.0
  #   environment:
  #     - discovery.type=single-node
  #     - xpack.security.enabled=false
  #   ports:
  #     - "9200:9200"

volumes:
  cassandra-data:
```

### Kubernetes 部署

```yaml
# jaeger-operator.yaml
apiVersion: jaegertracing.io/v1
kind: Jaeger
metadata:
  name: jaeger-production
  namespace: monitoring
spec:
  strategy: production
  collector:
    maxReplicas: 3
    resources:
      requests:
        cpu: 500m
        memory: 512Mi
      limits:
        cpu: 2000m
        memory: 2Gi
  storage:
    type: elasticsearch
    elasticsearch:
      nodeCount: 3
      redundancyPolicy: SingleRedundancy
      resources:
        requests:
          cpu: 500m
          memory: 2Gi
        limits:
          cpu: 2000m
          memory: 4Gi
  query:
    replicas: 2
    resources:
      requests:
        cpu: 100m
        memory: 256Mi
  ingress:
    enabled: true
    annotations:
      kubernetes.io/ingress.class: nginx
    hosts:
      - jaeger.example.com
```

## 客户端埋点

### Java 应用（OpenTelemetry）

```java
// Maven 依赖
// <dependency>
//     <groupId>io.opentelemetry</groupId>
//     <artifactId>opentelemetry-api</artifactId>
// </dependency>

import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanKind;
import io.opentelemetry.api.trace.StatusCode;
import io.opentelemetry.context.Scope;

public class OrderService {
    private final Tracer tracer;

    public OrderService(Tracer tracer) {
        this.tracer = tracer;
    }

    public Order createOrder(Long userId, List&lt;Long&gt; productIds) {
        // 创建 Span
        Span span = tracer.spanBuilder("createOrder")
            .setSpanKind(SpanKind.INTERNAL)
            .setAttribute("user.id", userId)
            .setAttribute("product.count", productIds.size())
            .startSpan();

        try (Scope scope = span.makeCurrentScope()) {
            // 验证用户
            User user = validateUser(userId);

            // 验证库存（子 Span）
            Span inventorySpan = tracer.spanBuilder("checkInventory")
                .setSpanKind(SpanKind.CLIENT)
                .setAttribute("db.system", "redis")
                .startSpan();
            try (Scope inventoryScope = inventorySpan.makeCurrentScope()) {
                checkInventory(productIds);
            } catch (Exception e) {
                inventorySpan.setStatus(StatusCode.ERROR, e.getMessage());
                throw e;
            } finally {
                inventorySpan.end();
            }

            // 创建订单
            Order order = orderRepository.save(new Order(userId, productIds));

            // 发送消息（另一个子 Span）
            Span messageSpan = tracer.spanBuilder("sendOrderCreatedEvent")
                .setSpanKind(SpanKind.PRODUCER)
                .setAttribute("messaging.system", "kafka")
                .setAttribute("messaging.destination", "order-created")
                .startSpan();
            try (Scope msgScope = messageSpan.makeCurrentScope()) {
                kafkaTemplate.send("order-created", order);
            } finally {
                messageSpan.end();
            }

            span.setAttribute("order.id", order.getId());
            return order;
        } catch (Exception e) {
            span.setStatus(StatusCode.ERROR, e.getMessage());
            span.recordException(e);
            throw e;
        } finally {
            span.end();
        }
    }
}
```

### Spring Boot 集成

```yaml
# pom.xml
dependencies:
  - groupId: io.opentelemetry
    artifactId: opentelemetry-api
  - groupId: io.opentelemetry
    artifactId: opentelemetry-sdk
  - groupId: io.opentelemetry.instrumentation
    artifactId: opentelemetry-spring-boot-starter
```

```java
// OpenTelemetryConfig.java
@Configuration
public class OpenTelemetryConfig {

    @Bean
    public OpenTelemetry openTelemetry() {
        return OpenTelemetrySdk.builder()
            .setTracerProvider(
                SdkTracerProvider.builder()
                    .addSpanProcessor(
                        BatchSpanProcessor.builder(
                            OtlpGrpcSpanExporter.builder()
                                .setEndpoint("http://jaeger-collector:4317")
                                .build()
                        ).build()
                    )
                    .build()
            )
            .setPropagators(ContextPropagators.create(W3CTraceContextPropagator.getInstance()))
            .build();
    }
}
```

### Go 应用

```go
// go.mod
// require (
//     go.opentelemetry.io/otel v1.22.0
//     go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc v1.22.0
//     go.opentelemetry.io/otel/sdk v1.22.0
// )

package main

import (
    "context"
    "log"

    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/attribute"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
    "go.opentelemetry.io/otel/sdk/trace"
    semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
)

func initTracer() (*trace.TracerProvider, error) {
    ctx := context.Background()

    exporter, err := otlptracegrpc.New(ctx,
        otlptracegrpc.WithEndpoint("jaeger-collector:4317"),
        otlptracegrpc.WithInsecure(),
    )
    if err != nil {
        return nil, err
    }

    tp := trace.NewTracerProvider(
        trace.WithBatcher(exporter),
        trace.WithResource(
            resource.NewWithAttributes(
                semconv.SchemaURL,
                semconv.ServiceName("order-service"),
                semconv.ServiceVersion("1.0.0"),
            ),
        ),
        trace.WithSampler(trace.AlwaysSample()),
    )

    otel.SetTracerProvider(tp)
    return tp, nil
}

func main() {
    tp, err := initTracer()
    if err != nil {
        log.Fatal(err)
    }
    defer func() {
        if err := tp.Shutdown(context.Background()); err != nil {
            log.Printf("Error shutting down tracer provider: %v", err)
        }
    }()

    tracer := otel.Tracer("order-service")

    ctx, span := tracer.Start(context.Background(), "processOrder")
    defer span.End()

    span.SetAttributes(
        attribute.String("order.id", "12345"),
        attribute.Int("order.amount", 100),
    )

    // 业务逻辑...
}
```

## 服务网格集成

### Istio + Jaeger

```yaml
# Istio 配置启用追踪
# istio-config.yaml
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
metadata:
  name: istio
  namespace: istio-system
spec:
  profile: default
  components:
    pilot:
      k8s:
        tracing:
          sampling: 1.0  # 采样率 100%
          providers:
            - name: jaeger
  meshConfig:
    enableTracing: true
    defaultConfig:
      tracing:
        sampling: 1.0
        zipkin:
          address: jaeger-collector.istio-system:9411
        propagation: W3C
```

```bash
# 访问 Jaeger UI
kubectl port-forward -n monitoring svc/jaeger-query 16686:16686
# 打开 http://localhost:16686
```

## 链路追踪最佳实践

### 1. 采样策略

```yaml
# Jaeger Collector 采样配置
apiVersion: jaegertracing.io/v1
kind: Jaeger
metadata:
  name: jaeger
spec:
  strategy: adaptive
  collector:
    maxReplicas: 3
  sampling:
    type: adaptive
    options:
      adaptive:
        sampling_server_url: $JAEGER_SAMPLING_HOST:5778
        max_traces_per_second: 100
        initial_sampling_rate: 10
```

### 2. Span 命名规范

```
# 良好的 Span 命名
# 格式：{service}.{operation}
http.method: GET
db.operation: SELECT
messaging.operation: send

# 好的例子
order-service.createOrder
inventory-service.checkStock
payment-service.processPayment

# 差的例子
handle
process
doSomething
```

### 3. 关键标签

```java
// HTTP 请求
span.setAttribute(SemanticAttributes.HTTP_METHOD, "GET");
span.setAttribute(SemanticAttributes.HTTP_URL, "https://api.example.com/orders");
span.setAttribute(SemanticAttributes.HTTP_STATUS_CODE, 200);

// 数据库操作
span.setAttribute(SemanticAttributes.DB_SYSTEM, "postgresql");
span.setAttribute(SemanticAttributes.DB_NAME, "orders_db");
span.setAttribute(SemanticAttributes.DB_STATEMENT, "SELECT * FROM orders WHERE id = ?");

// 消息队列
span.setAttribute(SemanticAttributes.MESSAGING_SYSTEM, "kafka");
span.setAttribute(SemanticAttributes.MESSAGING_DESTINATION, "order-created");
span.setAttribute(SemanticAttributes.MESSAGING_OPERATION, "send");
```

## 与 Prometheus + Grafana 集成

```yaml
# Grafana 数据源配置 Jaeger
# grafana-datasources.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-datasources
data:
  datasources.yaml: |
    apiVersion: 1
    datasources:
      - name: Jaeger
        type: jaeger
        access: proxy
        url: http://jaeger-query:16686
        jsonData:
          tracesToLogs:
            datasourceUid: Loki
            tags:
              - instance
              - pod
              - namespace
```

## 面试追问方向

1. **OpenTracing 和 OpenTelemetry 的区别是什么？**
   答：OpenTracing 是早期的分布式追踪标准，由 CNCF 维护，已被 OpenTelemetry 取代。OpenTelemetry（OTel）是 OpenTracing 和 OpenCensus 的合并，提供统一的 Traces、Metrics、Logs 采集标准，支持多种语言和后端（Jaeger、Zipkin、Tempo）。

2. **链路追踪的采样策略有哪些？**
   答：Head-based Sampling（在追踪开始时决定是否采样，如 Always、Never、Probability）；Tail-based Sampling（在追踪结束时根据结果决定，如 Error sampling、Latency-based sampling）；Adaptive Sampling（根据负载动态调整采样率）。Jaeger 支持自适应采样。

3. **链路追踪和日志的关系是什么？**
   答：链路追踪记录请求的整体路径，日志记录详细的业务信息。两者互补：追踪告诉你「哪个服务慢」，日志告诉你「为什么慢」。通过 Trace ID 关联两者，可以在 Jaeger/Grafana 中直接跳转到对应日志。

4. **Istio 的 sidecar 注入如何影响链路追踪？**
   答：Istio 自动在每个 Pod 中注入 Envoy sidecar，拦截所有入站和出站流量，自动生成 spans。这意味着即使应用代码没有埋点，Istio 也能追踪服务间通信。可以配置 `config.alpha.io/opentelemetry` 注解将 Istio 生成的 spans 导出到 Jaeger。

链路追踪是微服务调试的核心工具。没有它，分布式系统就是一个黑盒子。
