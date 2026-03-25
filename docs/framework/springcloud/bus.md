# Spring Cloud Bus 消息总线与配置刷新

> 改了配置，要重启所有服务才能生效？几十个微服务实例，难道要一个个改？
>
> Spring Cloud Bus，就是来解决这个问题的——一处配置变更，自动广播到所有服务。

---

## 从一个问题开始

假设你有这样的场景：

```
┌─────────────────────────────────────────────────────────┐
│                    微服务集群                             │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ Order    │ │ Order    │ │ Order    │ │ Order    │  │
│  │ 实例 1    │ │ 实例 2    │ │ 实例 3    │ │ 实例 4    │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│                                                          │
│  配置中心（Nacos）                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  order-service.yaml                               │  │
│  │  order.timeout: 5000 ──► 8000 (修改了)            │  │
│  └──────────────────────────────────────────────────┘  │
│                                                          │
│  问题：4 个实例如何同时感知配置变更？                      │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**没有 Bus 之前**：

1. 手动触发每个实例的刷新
2. 或者等待每个实例的定时轮询（延迟大）

**有了 Spring Cloud Bus**：

1. 触发一次，自动广播到所有实例
2. 毫秒级响应

---

## 消息总线原理

### 架构图

```
┌─────────────────────────────────────────────────────────┐
│                   Spring Cloud Bus 架构                  │
│                                                          │
│  ┌─────────────┐                                        │
│  │   Git/Nacos │  配置中心                               │
│  │   Config    │                                        │
│  └──────┬──────┘                                        │
│         │                                                │
│         │ 触发刷新                                        │
│         ▼                                                │
│  ┌─────────────────────────────────────────────────┐   │
│  │              RabbitMQ / Kafka                     │   │
│  │              (消息总线)                           │   │
│  └──────────┬─────────┬─────────┬──────────────────┘   │
│             │         │         │                        │
│             ▼         ▼         ▼                        │
│       ┌─────────┐ ┌─────────┐ ┌─────────┐             │
│       │ Service │ │ Service │ │ Service │             │
│       │   A     │ │   B     │ │   C     │             │
│       └─────────┘ └─────────┘ └─────────┘             │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 刷新流程

```
1. POST /actuator/busrefresh          ← 触发刷新
2. Bus 发送 RefreshRemoteApplicationEvent    ← 广播消息
3. 所有服务实例收到消息                      ← 消息总线
4. 重新加载配置                            ← 配置刷新
5. @RefreshScope Bean 重建                 ← 生效
```

---

## 快速开始

### 1. 引入依赖

```xml
<dependencies>
    <!-- Spring Cloud Config -->
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-config-monitor</artifactId>
    </dependency>
    
    <!-- Spring Cloud Bus -->
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-starter-bus-amqp</artifactId>
    </dependency>
    
    <!-- RabbitMQ（使用 Kafka 则引入 spring-cloud-starter-bus-kafka） -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-amqp</artifactId>
    </dependency>
</dependencies>
```

### 2. 配置文件

```yaml
spring:
  application:
    name: order-service
  cloud:
    # RabbitMQ 配置
    bus:
      enabled: true
      trace:
        enabled: true  # 开启消息追踪
    config:
      import: optional:nacos:${spring.application.name}
      # 开启配置刷新
      refresh:
        enabled: true
  
  # RabbitMQ 配置
  rabbitmq:
    host: localhost
    port: 5672
    username: guest
    password: guest

# 暴露刷新端点
management:
  endpoints:
    web:
      exposure:
        include: health,info,busrefresh,bus-env
  endpoint:
    busrefresh:
      enabled: true
```

### 3. 配置刷新类

```java
@RestController
@RefreshScope  // 开启配置刷新
public class ConfigController {
    
    @Value("${order.timeout:5000}")
    private int orderTimeout;
    
    @GetMapping("/config")
    public String getConfig() {
        return "order.timeout = " + orderTimeout;
    }
}
```

### 4. 触发刷新

```bash
# 刷新所有服务
curl -X POST http://localhost:8080/actuator/busrefresh

# 刷新指定服务（通过 destination 参数）
curl -X POST "http://localhost:8080/actuator/busrefresh?destination=order-service:**"
```

---

## 消息追踪

### 开启追踪

```yaml
spring:
  cloud:
    bus:
      trace:
        enabled: true
```

### 查看追踪

```bash
# 查看追踪事件
curl http://localhost:8080/actuator/bus-events
```

```json
{
  "type": "RefreshRemoteApplicationEvent",
  "timestamp": 1704067200000,
  "origin": "order-service:8080",
  "destination": "**:**",
  "id": "abc123"
}
```

---

## 配合 Git Webhook 自动刷新

### 配置 Webhook

在 Git 仓库（如 GitLab、Gitee）配置 Webhook：

```
URL: http://gateway:8080/monitor
Secret: your-secret-token
Events: Push events
```

### 添加签名验证

```java
@Configuration
public class BusSecurityConfig {
    
    @Bean
    @ConfigurationProperties(prefix = "spring.cloud.bus.trace")
    public SecurityConfig traceConfig() {
        return new SecurityConfig();
    }
}
```

```yaml
spring:
  cloud:
    bus:
      trace:
        enabled: true
    config:
      monitor:
        # 开启签名验证
        authorization:
          header-name: X-Custom-Header
          authorized-value: your-secret-token
```

---

## 自定义消息类型

### 定义事件

```java
public class OrderConfigChangedEvent extends RemoteApplicationEvent {
    
    private String configKey;
    private String configValue;
    
    public OrderConfigChangedEvent(Object source, String origin, 
            String configKey, String configValue) {
        super(source, origin, OrderConfigChangedEvent.class);
        this.configKey = configKey;
        this.configValue = configValue;
    }
}
```

### 发布事件

```java
@Service
public class ConfigPublisher {
    
    @Autowired
    private ApplicationEventPublisher publisher;
    
    public void publishConfigChange(String configKey, String configValue) {
        publisher.publishEvent(
            new OrderConfigChangedEvent(this, null, configKey, configValue)
        );
    }
}
```

### 监听事件

```java
@Service
public class ConfigListener {
    
    @EventListener
    public void onConfigChange(OrderConfigChangedEvent event) {
        System.out.println("配置变更: " + event.getConfigKey() 
            + " = " + event.getConfigValue());
        // 处理配置变更
    }
}
```

---

## 多种触发方式

### 1. Actuator 端点

```bash
# 刷新所有
curl -X POST http://localhost:8080/actuator/busrefresh

# 刷新指定应用
curl -X POST "http://localhost:8080/actuator/busrefresh?destination=order-service:**"

# 刷新指定实例
curl -X POST "http://localhost:8080/actuator/busrefresh?destination=order-service:8080"
```

### 2. Git Webhook

配置 Git 仓库的 Webhook，Push 时自动触发。

### 3. Nacos 变更监听

Nacos 配置变更时自动触发。

### 4. 自定义触发

```java
@Service
public class CustomRefreshTrigger {
    
    @Autowired
    private ContextRefresher contextRefresher;
    
    public void triggerRefresh() {
        // 手动触发刷新
        Set&lt;String&gt; keys = contextRefresher.refresh();
        System.out.println("刷新了: " + keys);
    }
}
```

---

## 消息总线选型

### RabbitMQ vs Kafka

| 特性 | RabbitMQ | Kafka |
|---|---|---|
| 实时性 | 高（消息推送） | 中（轮询拉取） |
| 吞吐量 | 中等 | 高 |
| 消息持久化 | 支持 | 支持 |
| 延迟队列 | 支持 | 不直接支持 |
| 适用场景 | 配置刷新、事件通知 | 日志采集、大数据分析 |

**Spring Cloud Bus 场景**：RabbitMQ 更适合（实时性要求高、消息量不大）。

---

## 常见问题

### Q：Spring Cloud Bus 和 Spring Cloud Config 是什么关系？

A：**Config 是配置中心**，存储配置数据。**Bus 是消息总线**，用于广播配置变更通知。两者配合使用：Config 存配置，Bus 通知变更。

### Q：刷新失败怎么办？

A：检查几个点——

1. RabbitMQ 是否正常
2. Actuator 端点是否暴露
3. 服务是否注册到 RabbitMQ
4. 查看 Bus 追踪日志

### Q：所有服务都需要引入 Bus 依赖吗？

A：**是的**。所有需要响应配置变更的服务都需要引入 Bus 依赖，并开启消息监听。

### Q：消息丢失怎么办？

A：RabbitMQ 配置消息持久化（durable=true）。Bus 消息默认持久化。

---

## 面试高频问题

### Q：Spring Cloud Bus 的原理是什么？

A：基于 Spring Cloud Stream 的消息发布订阅机制。当触发刷新时，发送一个 RefreshRemoteApplicationEvent 到消息总线，所有订阅的服务收到消息后，调用 ContextRefresher 重新加载配置。

### Q：Bus 如何保证消息只被消费一次？

A：每个服务实例都订阅同一个 Topic，但使用不同的 group。消息会被投递给每个 group，但同一 group 内的多个实例会负载均衡。

### Q：如何实现精确刷新（只刷新某些服务）？

A：通过 `destination` 参数指定目标服务。例如：`?destination=order-service:**` 表示刷新所有 order-service 实例。

### Q：Bus 刷新失败会影响其他服务吗？

A：不会。消息是广播到所有订阅者，每个服务独立处理。失败的服务不会影响其他服务。

---

## 总结

Spring Cloud Bus 实现了配置变更的自动广播：

1. **消息总线**：基于 RabbitMQ/Kafka 的发布订阅
2. **广播机制**：一次触发，全网生效
3. **追踪功能**：traceEnabled 开启后可追踪消息流向
4. **多触发方式**：Actuator、Webhook、Nacos 变更监听

> Spring Cloud Bus 让配置管理从「手动」变成「自动」，是微服务配置治理的必备工具。
