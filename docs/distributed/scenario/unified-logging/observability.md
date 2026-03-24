# 业务链路黑白盒监控：Metrics + Tracing + Logging

你知道你的系统在干什么吗？

它在正常运行？有多少请求？响应时间多少？有没有异常？

如果不知道，你怎么敢上线？

这就是可观测性的价值。

## 可观测性的三大支柱

```
┌─────────────────────────────────────────┐
│                可观测性                   │
├─────────────┬─────────────┬─────────────┤
│   Metrics   │   Tracing   │   Logging   │
│   指标监控   │   链路追踪   │    日志     │
│    聚合     │   串联     │    记录     │
└─────────────┴─────────────┴─────────────┘
```

- **Metrics**：系统聚合后的指标，快速发现异常
- **Tracing**：请求的完整链路，定位问题根因
- **Logging**：详细的业务和错误记录，分析问题细节

## Metrics（指标监控）

### 指标类型

```java
// Counter：只增不减的计数器
Counter requestCounter = Counter.builder("http_requests_total")
    .description("Total HTTP requests")
    .register(registry);
requestCounter.increment();

// Gauge：可增可减的值
Gauge gauge = Gauge.builder("active_connections", connectionPool,
    cp -> cp.getActiveCount())
    .register(registry);

// Histogram：分布统计
Histogram histogram = Histogram.builder("http_request_duration_seconds")
    .register(registry);
histogram.observe(requestDuration);
```

### Prometheus + Grafana

```yaml
# Prometheus 配置
scrape_configs:
  - job_name: 'order-service'
    metrics_path: '/actuator/prometheus'
    static_configs:
      - targets: ['order-service:8080']
```

Grafana 可以配置各种图表：

- **QPS**：每秒请求数
- **RT**：响应时间分布（P50、P90、P99）
- **Error Rate**：错误率
- **CPU / Memory**：资源使用率

## Tracing（链路追踪）

### 关键概念

- **Trace**：一次请求的完整链路
- **Span**：链路中的一个操作
- **Span Name**：操作名称
- **Duration**：操作耗时

### Skywalking 接入

```java
// 引入依赖
// <dependency>
//     <groupId>org.apache.skywalking</groupId>
//     <artifactId>apm-toolkit-trace</artifactId>
// </dependency>

// 手动埋点
@Trace
public Product getProduct(Long id) {
    Span span = ContextManager.createSpan("getProduct");
    try {
        return productRepository.findById(id);
    } finally {
        ContextManager.stopSpan(span);
    }
}

// 获取 TraceId
String traceId = ContextManager.getGlobalTraceId();
```

## Logging（日志）

### 日志级别

```java
// DEBUG：开发调试
log.debug("查询参数: {}", params);

// INFO：正常业务日志
log.info("用户 {} 登录成功", userId);

// WARN：警告，不影响业务
log.warn("库存不足，当前剩余: {}", stock);

// ERROR：错误，影响业务
log.error("订单创建失败", e);
```

### 错误日志规范

```java
// 错误日志必须包含
log.error("订单创建失败, userId={}, orderId={}, error={}",
    userId, orderId, e.getMessage(), e);

// 不要这样写
log.error("订单创建失败");  // 缺少上下文
log.error(e);              // 缺少说明
```

## 三者的关系

```
Metrics ← 聚合统计 → 快速发现异常
  ↑
Tracing ← 链路追踪 ← 定位问题
  ↑
Logging ← 详细记录 ← 分析细节
```

- **Metrics 发现异常**：QPS 突然下降
- **Tracing 定位链路**：看到哪个服务耗时最长
- **Logging 分析细节**：看到具体错误信息

## 业务链路监控

### 完整链路示意

```
HTTP 请求 → 网关 → 用户服务 → 订单服务 → 库存服务 → 支付服务 → MQ → 通知服务
    ↓          ↓          ↓          ↓          ↓          ↓        ↓
  Metrics    Metrics    Metrics    Metrics    Metrics    Metrics  Metrics
```

### 关键指标

| 链路节点 | 关键指标 |
|---------|---------|
| HTTP 请求 | QPS、RT、错误率 |
| 数据库 | 连接池、慢查询数 |
| Redis | 命中率、延迟 |
| MQ | 生产/消费速率、积压数 |

## Java 接入示例

### Micrometer（Prometheus）

```java
// 引入依赖
// <dependency>
//     <groupId>org.springframework.boot</groupId>
//     <artifactId>spring-boot-starter-actuator</artifactId>
// </dependency>
// <dependency>
//     <groupId>io.micrometer</groupId>
//     <artifactId>micrometer-registry-prometheus</artifactId>
// </dependency>

@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}

// 自定义指标
@Service
public class OrderService {

    private final MeterRegistry registry;

    public OrderService(MeterRegistry registry) {
        this.registry = registry;
    }

    public void createOrder(Order order) {
        Timer.Sample sample = Timer.start(registry);

        try {
            // 业务逻辑
            orderRepository.save(order);
        } finally {
            sample.stop(Timer.builder("order_create_duration")
                .tag("status", "success")
                .register(registry));
        }
    }
}
```

### Skywalking Agent

```yaml
# skywalking-agent 配置
agent:
  collector:
    backend_services: oap-server:11800
  service_name: order-service
```

## 面试追问方向

- Metrics、Tracing、Logging 的区别？（答：Metrics 聚合统计、Tracing 链路串联、Logging 详细记录）
- 如何选择 APM 工具？（答：Skywalking 功能强、Jaeger 轻量、Zipkin 简单）
- 监控指标怎么设计？（答：RED 方法：Rate、Errors、Duration）
- 告警怎么配置？（答：阈值告警、环比告警、趋势告警）

## 小结

可观测性是分布式系统的必备能力：

1. **Metrics**：快速发现异常
2. **Tracing**：定位问题链路
3. **Logging**：分析问题细节
4. **三者结合**：构建完整的可观测性体系

不知道系统在干什么，就等于在盲目飞行。
