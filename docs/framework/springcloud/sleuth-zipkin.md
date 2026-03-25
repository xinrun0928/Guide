# Sleuth 链路追踪与 Zipkin 可视化

> 一个请求经过 10 个服务，出问题了，你从哪个服务开始排查？
>
> 如果没有链路追踪，你可能要在 10 个日志文件里来回翻找。但有了链路追踪，一个请求的完整路径一目了然。

---

## 从一个真实问题开始

假设用户反馈：「我下的订单查不到了！」

```
┌─────────────────────────────────────────────────────────┐
│                    问题排查链路                           │
│                                                          │
│  用户 ──► API 网关 ──► 订单服务 ──► 用户服务            │
│           │             │              │                 │
│           │             │              │                 │
│           ▼             ▼              ▼                 │
│        登录态校验    查询订单        查询用户             │
│                                                          │
│  排查思路：                                              │
│  1. API 网关收到请求了吗？                               │
│  2. 订单服务调用链路正常吗？                             │
│  3. 用户服务返回正确吗？                                  │
│  4. 数据库查询有异常吗？                                  │
│                                                          │
│  没有链路追踪 = 在 10 个日志文件里猜谜                    │
│  有链路追踪 = 5 秒定位问题                                │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 链路追踪核心概念

### Trace 和 Span

```
┌─────────────────────────────────────────────────────────┐
│                    Trace 与 Span                         │
│                                                          │
│  Trace: 请求的完整链路（一次用户请求）                     │
│  Span: 链路中的每一个步骤（一次服务调用）                   │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Trace ID: abc123                               │   │
│  │                                                  │   │
│  │  ┌─────────┐                                   │   │
│  │  │Span 1   │  API 网关                         │   │
│  │  │---------|                                   │   │
│  │  │  ┌──────┴──────┐                           │   │
│  │  │  │             │                           │   │
│  │  │  ▼             ▼                           │   │
│  │  │ ┌─────────┐  ┌─────────┐                   │   │
│  │  │ │Span 2   │  │Span 3   │                   │   │
│  │  │ │订单服务  │  │用户服务  │                   │   │
│  │  │ └─────────┘  └─────────┘                   │   │
│  │  │                                               │   │
│  │  └─────────────────────────────────────────────┘   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

| 概念 | 说明 |
|---|---|
| Trace | 一次完整的请求链路，用 Trace ID 标识 |
| Span | 链路中的一个步骤，用 Span ID 标识 |
| Parent Span | 当前 Span 的父节点 |
| Annotation | 时间戳事件（cs、cr、ss、sr） |

### 四大 Annotation

| Annotation | 说明 | 英文全称 |
|---|---|---|
| CS | 客户端发送请求 | Client Send |
| SR | 服务端接收请求 | Server Received |
| SS | 服务端发送响应 | Server Send |
| CR | 客户端接收响应 | Client Received |

---

## Spring Cloud Sleuth 快速开始

### 1. 引入依赖

```xml
<dependencies>
    <!-- Sleuth 链路追踪 -->
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-starter-sleuth</artifactId>
    </dependency>
    
    <!-- Zipkin 客户端（发送数据到 Zipkin） -->
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-starter-zipkin</artifactId>
    </dependency>
    
    <!-- 如果使用 RabbitMQ 传输数据 -->
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-starter-sleuth</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.amqp</groupId>
        <artifactId>spring-rabbit</artifactId>
    </dependency>
</dependencies>
```

### 2. 配置文件

```yaml
spring:
  application:
    name: order-service
  
  # Zipkin 配置
  zipkin:
    base-url: http://localhost:9411
    # 采样率配置
    sampler:
      probability: 1.0  # 100% 采样，生产环境建议 0.1-0.5
  
  # 如果使用 RabbitMQ 传输
  sleuth:
    rabbit:
      enabled: true
```

### 3. 启动 Zipkin Server

```bash
# 方式一：Docker 启动
docker run -d -p 9411:9411 openzipkin/zipkin

# 方式二：Jar 启动
wget -O zipkin.jar 'https://search.maven.org/remote_content?g=io.zipkin&a=zipkin-server&v=LATEST&c=exec'
java -jar zipkin.jar

# 方式三：Docker Compose（包含 Elasticsearch）
docker run -d -p 9411:9411 -p 5601:5601 \
    openzipkin/zipkin:2.23.2
```

访问：`http://localhost:9411`

---

## 链路追踪代码示例

### 普通方法追踪

```java
@Service
@Slf4j
public class OrderService {
    
    @Autowired
    private UserClient userClient;
    
    public Order getOrder(Long orderId) {
        log.info("获取订单: orderId={}", orderId);
        
        // 自动创建 Span
        Order order = orderRepository.findById(orderId);
        
        // 跨服务调用，自动传递 TraceId
        User user = userClient.getUser(order.getUserId());
        order.setUser(user);
        
        return order;
    }
}
```

### 自定义 Span

```java
@Service
@Slf4j
public class OrderService {
    
    @Autowired
    private Tracer tracer;
    
    public Order getOrder(Long orderId) {
        // 1. 创建自定义 Span
        Span span = tracer.nextSpan().name("processOrder");
        
        try (Tracer.SpanInScope scope = tracer.withSpanInScope(span.start())) {
            // 添加标签（Tag）
            span.tag("orderId", orderId.toString());
            
            // 添加事件
            span.event("开始处理订单");
            
            // 业务逻辑
            Order order = processOrder(orderId);
            
            span.event("订单处理完成");
            return order;
            
        } finally {
            span.end();
        }
    }
}
```

### 异步任务追踪

```java
@Service
@Slf4j
public class AsyncService {
    
    @Autowired
    private BeanFactory beanFactory;
    
    public void asyncProcess() {
        // 使用 @Async 时需要手动传递 Span
        new Thread(() -> {
            Span span = tracer.nextSpan();
            try (Tracer.SpanInScope scope = tracer.withSpanInScope(span.start())) {
                // 异步逻辑
                doSomething();
            } finally {
                span.end();
            }
        }).start();
    }
    
    // 或者使用 @Async + Sleuth 自带的 Executor
    @Async("sleuthTaskExecutor")
    public void asyncProcessWithAnnotation() {
        doSomething();
    }
}
```

---

## Zipkin 可视化

### 查看链路

访问 `http://localhost:9411`，输入 Trace ID 或条件查询：

```
┌─────────────────────────────────────────────────────────┐
│                    Zipkin 链路视图                       │
│                                                          │
│  Service Name: order-service                             │
│  Span Name: [all] ▼    Lookback: [1 hour] ▼            │
│  [Search]                                               │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Trace List                                      │   │
│  │                                                  │   │
│  │  ID          │ Service      │ Duration │ Time    │   │
│  │  abc123      │ order-svc   │ 45ms    │ 14:30   │   │
│  │  def456      │ order-svc   │ 23ms    │ 14:29   │   │
│  │  ghi789      │ order-svc   │ 56ms    │ 14:28   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 依赖图

```
┌─────────────────────────────────────────────────────────┐
│                    服务依赖图                             │
│                                                          │
│           ┌─────────┐                                   │
│           │  Gateway │                                   │
│           └────┬────┘                                   │
│                │                                         │
│         ┌──────┴──────┐                                 │
│         │             │                                 │
│         ▼             ▼                                 │
│    ┌─────────┐   ┌─────────┐                           │
│    │  Order  │──►│  User   │                           │
│    │ Service │   │ Service │                           │
│    └────┬────┘   └─────────┘                           │
│         │                                               │
│         ▼                                               │
│    ┌─────────┐                                         │
│    │   MySQL │                                         │
│    └─────────┘                                         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 数据持久化

### MySQL 存储

```yaml
spring:
  zipkin:
    base-url: http://localhost:9411
    storage:
      type: mysql
```

```bash
# 创建 Zipkin 数据库表
CREATE DATABASE IF NOT EXISTS zipkin;
USE zipkin;
# Zipkin Server 启动时会自动创建表
```

### Elasticsearch 存储（推荐生产环境）

```yaml
zipkin:
  collector:
    elasticsearch:
      hosts: localhost:9200
  storage:
    type: elasticsearch
```

```bash
# Docker Compose 方式
docker run -d \
    -p 9411:9411 \
    -p 5601:5601 \
    -e STORAGE_TYPE=elasticsearch \
    -e ES_HOSTS=http://localhost:9200 \
    openzipkin/zipkin
```

---

## 采样策略

### 为什么要采样

在高并发系统中，100% 采样会产生大量数据，影响性能。采样可以减少数据量。

### 采样策略配置

```yaml
spring:
  zipkin:
    # 方式一：固定采样率
    sampler:
      probability: 0.1  # 10% 采样
      
    # 方式二：速率限制采样
    sampler:
      rate: 100  # 每秒最多 100 条
      
    # 方式三：alwaysSampler（调试用）
    # sampler:
    #   probability: 1.0
```

### 自定义采样器

```java
@Configuration
public class SleuthConfig {
    
    @Bean
    public Sampler sampler() {
        // 1. 慢请求 100% 采样
        return new Sampler() {
            @Override
            public boolean isSampled(long traceId) {
                // 慢请求（超过 1 秒）或错误请求全部采样
                return true;
            }
        };
        
        // 2. 基于请求的采样
        // return new RequestUriSampler();
        
        // 3. 基于百分比的采样
        // return ProbabilityBasedSampler.create(0.1);
    }
}
```

---

## MDC 集成

### 将 TraceId 加入日志

```yaml
logging:
  pattern:
    console: "%d{yyyy-MM-dd HH:mm:ss} [%X{traceId:-},%X{spanId:-}] %-5level %logger{36} - %msg%n"
```

```java
@Service
@Slf4j
public class OrderService {
    
    public void createOrder(Order order) {
        // 日志自动带上 traceId 和 spanId
        log.info("创建订单: orderId={}", order.getId());
        // 输出: 2024-01-01 14:30:00 [abc123,def456] INFO - 创建订单: orderId=100
    }
}
```

### 自定义 MDC 字段

```java
@Service
@Slf4j
public class OrderService {
    
    @Autowired
    private Tracer tracer;
    
    public void createOrder(Order order) {
        Span currentSpan = tracer.currentSpan();
        if (currentSpan != null) {
            // 添加自定义标签到 MDC
            MDC.put("orderId", order.getId().toString());
        }
        
        try {
            // 业务逻辑
            processOrder(order);
        } finally {
            MDC.remove("orderId");
        }
    }
}
```

---

## 面试高频问题

### Q：Sleuth 和 Zipkin 的关系是什么？

A：**Sleuth 是客户端库**，负责生成和收集链路数据。**Zipkin 是服务端**，负责存储和展示链路数据。Sleuth 收集的数据会发送到 Zipkin 进行可视化。

### Q：TraceId 和 SpanId 有什么区别？

A：**TraceId** 是整条请求链路的唯一标识，所有服务共享同一个 TraceId。**SpanId** 是链路中每个步骤的唯一标识，父节点和子节点的 SpanId 不同。父子关系通过 ParentSpanId 关联。

### Q：采样率设多少合适？

A：没有固定答案，取决于系统规模。原则是**慢请求和错误请求优先采样**。生产环境通常 5-10%，高并发系统可能更低。

### Q：Sleuth 能否追踪异步任务？

A：可以，但需要特殊处理。使用 `@Async` 时 Sleuth 有内置支持；使用自定义线程池时，需要手动传递 Span。

### Q：链路追踪会影响性能吗？

A：会有轻微影响（增加 1-5ms 延迟），但可控。建议采样率在 5-10%，并使用异步发送数据。

---

## 总结

Sleuth + Zipkin 提供了完整的链路追踪解决方案：

1. **Sleuth**：自动生成 TraceId/SpanId，无需侵入业务代码
2. **Zipkin**：可视化链路、依赖图、性能分析
3. **MDC 集成**：日志自动带上链路信息
4. **采样控制**：减少数据量，降低性能影响

> 链路追踪是微服务问题定位的利器。系统越复杂，链路追踪的价值越大。
