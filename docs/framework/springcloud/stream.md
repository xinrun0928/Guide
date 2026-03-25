# Spring Cloud Stream 屏蔽 MQ 底层差异

> 项目用了 RabbitMQ，隔壁组用了 Kafka。换成 RocketMQ 怎么办？
>
> Spring Cloud Stream，就是来解决这个问题的——它让你一套代码，切换任意消息队列。

---

## 从一个问题开始

假设你的团队有这样的需求：

- 开发环境用 RocketMQ（本地部署简单）
- 测试环境用 Kafka（公司统一搭建）
- 生产环境用 RabbitMQ（运维团队指定）

**没有 Stream 之前**，你需要写三套代码：

```java
// RocketMQ 版本
@Service
public class OrderService {
    @Autowired private RocketMQTemplate rocketMQTemplate;
    public void sendOrder(Order order) {
        rocketMQTemplate.convertAndSend("order-topic", order);
    }
}

// Kafka 版本
@Service
public class OrderService {
    @Autowired private KafkaTemplate kafkaTemplate;
    public void sendOrder(Order order) {
        kafkaTemplate.send("order-topic", order);
    }
}

// RabbitMQ 版本
@Service
public class OrderService {
    @Autowired private AmqpTemplate amqpTemplate;
    public void sendOrder(Order order) {
        amqpTemplate.convertAndSend("order-topic", order);
    }
}
```

**有了 Spring Cloud Stream**，一套代码走天下：

```java
@Service
public class OrderService {
    @Autowired private StreamBridge streamBridge;
    public void sendOrder(Order order) {
        streamBridge.send("order-out-0", order);
    }
}
```

切换 MQ，只需改配置。

---

## 核心概念

### 绑定器（Binder）

```
┌─────────────────────────────────────────────────────────┐
│                    Binder 架构                           │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Spring Cloud Stream                 │   │
│  │                                                  │   │
│  │  @Input / @Output 注解定义通道                   │   │
│  │  StreamBridge 动态发送                           │   │
│  │                                                  │   │
│  └─────────────────────────────────────────────────┘   │
│           │                │                │            │
│           ▼                ▼                ▼            │
│     ┌──────────┐     ┌──────────┐     ┌──────────┐     │
│     │ Kafka    │     │ RabbitMQ │     │ RocketMQ │     │
│     │ Binder   │     │ Binder   │     │ Binder   │     │
│     └──────────┘     └──────────┘     └──────────┘     │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 通道（Channel）

| 通道类型 | 说明 |
|---|---|
| @Input | 消费者接收消息的通道 |
| @Output | 生产者发送消息的通道 |
| @StreamListener | 监听消息 |
| StreamBridge | 动态发送消息 |

### Topic 和 Consumer Group

```
┌─────────────────────────────────────────────────────────┐
│                    Topic 与 Consumer Group               │
│                                                          │
│  Topic: order-events                                    │
│  ┌─────────────────────────────────────────────────┐   │
│  │  消息 1  消息 2  消息 3  消息 4  消息 5           │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
│  Consumer Group A                                       │
│  ┌─────────┐  ┌─────────┐                              │
│  │ 实例 1   │  │ 实例 2   │ ← 负载均衡，每人处理一半   │
│  └─────────┘  └─────────┘                              │
│                                                          │
│  Consumer Group B                                        │
│  ┌─────────┐  ┌─────────┐                              │
│  │ 实例 3   │  │ 实例 4   │ ← 独立消费，收到所有消息    │
│  └─────────┘  └─────────┘                              │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 快速开始

### 1. 引入依赖

```xml
<dependencies>
    <!-- Spring Cloud Stream 核心 -->
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-stream</artifactId>
    </dependency>
    
    <!-- RabbitMQ Binder（可替换为 Kafka、RocketMQ） -->
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-stream-binder-rabbit</artifactId>
    </dependency>
</dependencies>
```

### 2. 配置文件

```yaml
spring:
  application:
    name: order-service
  cloud:
    stream:
      # Binder 配置
      binders:
        rabbit-binder:
          type: rabbit
          environment:
            spring:
              rabbitmq:
                host: localhost
                port: 5672
                username: guest
                password: guest
      # 绑定配置
      bindings:
        # 输出通道（发送消息）
        order-out:
          destination: order-events
          content-type: application/json
          binder: rabbit-binder
        # 输入通道（接收消息）
        order-in:
          destination: order-events
          content-type: application/json
          binder: rabbit-binder
          # 消费者组（用于负载均衡）
          group: order-consumer-group
```

### 3. 消息生产者

```java
@Service
public class OrderService {
    
    @Autowired
    private StreamBridge streamBridge;
    
    public void sendOrderCreatedEvent(Order order) {
        // 发送消息到 order-out 通道
        streamBridge.send("order-out-0", order);
    }
}
```

### 4. 消息消费者

```java
@SpringBootApplication
@EnableBinding({OrderChannels.class})
public class OrderApplication {
    public static void main(String[] args) {
        SpringApplication.run(OrderApplication.class, args);
    }
}

// 定义通道接口
public interface OrderChannels {
    
    String ORDER_INPUT = "order-in";
    String ORDER_OUTPUT = "order-out";
    
    @Input(ORDER_INPUT)
    SubscribableChannel orderInput();
    
    @Output(ORDER_OUTPUT)
    MessageChannel orderOutput();
}
```

```java
@Service
public class OrderConsumer {
    
    @StreamListener(OrderChannels.ORDER_INPUT)
    public void handleOrderCreated(@Payload Order order) {
        System.out.println("收到订单消息：" + order);
        // 处理订单逻辑
    }
}
```

---

## 多绑定器配置

### 同时支持 RabbitMQ 和 Kafka

```yaml
spring:
  cloud:
    stream:
      binders:
        rabbit-binder:
          type: rabbit
          defaultCandidate: true
          environment:
            spring:
              rabbitmq:
                host: ${RABBIT_HOST:localhost}
                port: ${RABBIT_PORT:5672}
        kafka-binder:
          type: kafka
          environment:
            spring:
              kafka:
                bootstrap-servers: ${KAFKA_SERVERS:localhost:9092}
      
      bindings:
        order-out:
          destination: order-events
          binder: rabbit-binder  # 使用 RabbitMQ
        notification-out:
          destination: notification-events
          binder: kafka-binder  # 使用 Kafka
```

### 动态切换

```java
@Service
public class NotificationService {
    
    @Autowired
    private StreamBridge streamBridge;
    
    public void sendNotification(Notification notification) {
        // 发送到 Kafka
        streamBridge.send("notification-out-0", notification);
    }
}
```

---

## 函数式编程模型（推荐）

Spring Cloud Stream 3.0+ 推荐使用函数式编程：

### 生产者

```java
@SpringBootApplication
public class ProducerApplication {
    public static void main(String[] args) {
        SpringApplication.run(ProducerApplication.class, args);
    }
    
    @Bean
    public Supplier&lt;Order&gt; orderProducer() {
        return () -> {
            Order order = new Order();
            order.setId(System.currentTimeMillis());
            order.setAmount(new BigDecimal("99.9"));
            return order;
        };
    }
}
```

```yaml
spring:
  cloud:
    stream:
      function:
        definition: orderProducer
      bindings:
        orderProducer-out-0:
          destination: order-events
          content-type: application/json
```

### 消费者

```java
@SpringBootApplication
public class ConsumerApplication {
    public static void main(String[] args) {
        SpringApplication.run(ConsumerApplication.class, args);
    }
    
    @Bean
    public Consumer&lt;Order&gt; orderConsumer() {
        return order -> {
            System.out.println("收到订单：" + order);
            // 处理订单
        };
    }
}
```

```yaml
spring:
  cloud:
    stream:
      function:
        definition: orderConsumer
      bindings:
        orderConsumer-in-0:
          destination: order-events
          content-type: application/json
          group: order-group
```

---

## 消息分区

### 场景

确保同一订单的相关消息（如订单创建、订单支付、订单完成）发送到同一个消费者实例。

### 生产者分区配置

```yaml
spring:
  cloud:
    stream:
      bindings:
        order-out:
          destination: order-events
          producer:
            partition-key-expression: headers['partitionKey']
            partition-count: 3
```

```java
@Service
public class OrderService {
    
    @Autowired
    private StreamBridge streamBridge;
    
    public void sendOrder(Order order) {
        // 按订单 ID 分区
        Message&lt;Order&gt; message = MessageBuilder
            .withPayload(order)
            .setHeader("partitionKey", order.getId())
            .build();
        
        streamBridge.send("order-out-0", message);
    }
}
```

### 消费者分区配置

```yaml
spring:
  cloud:
    stream:
      bindings:
        order-in:
          destination: order-events
          consumer:
            partitioned: true
            instance-count: 3
```

---

## 消费者组与负载均衡

### 消费者组配置

```yaml
spring:
  cloud:
    stream:
      bindings:
        order-in:
          destination: order-events
          group: order-service-group  # 消费者组名
```

### 负载均衡

```
Topic: order-events
┌─────────────────────────────────────────────────┐
│ 消息 1,2,3,4,5,6,7,8,9,10                      │
└─────────────────────────────────────────────────┘

Consumer Group: order-service-group
┌─────────────────────────────────────────────────┐
│ 实例 A (消费者 1) ──► 消息 1,4,7,10           │
│ 实例 B (消费者 2) ──► 消息 2,5,8              │
│ 实例 C (消费者 3) ──► 消息 3,6,9              │
└─────────────────────────────────────────────────┘
```

---

## 错误处理

### 死信队列

```yaml
spring:
  cloud:
    stream:
      bindings:
        order-in:
          destination: order-events
          consumer:
            # 开启重试和死信
            maxAttempts: 3
            backOffInitialInterval: 1000
            backOffMaxInterval: 10000
            backOffMultiplier: 2.0
          # 死信队列配置（RabbitMQ）
          rabbit:
            consumer:
              binding:
                dlq-ttl: 60000
                dead-letter-exchange: order-dlx
                dead-letter-routing-key: order-events.dlq
```

### 全局错误处理

```java
@Configuration
public class ErrorHandlingConfiguration {
    
    @Bean
    public ErrorMessageExceptionHandler errorMessageExceptionHandler() {
        return new ErrorMessageExceptionHandler() {
            @Override
            public void accept(Message&lt;?&gt; message, Throwable throwable) {
                // 记录错误日志
                log.error("消息处理失败: {}", message.getPayload(), throwable);
                
                // 发送到死信队列
                // ...
            }
        };
    }
}
```

---

## 面试高频问题

### Q：Spring Cloud Stream 如何屏蔽底层 MQ 差异？

A：通过**Binder 抽象层**。不同 MQ 有不同的 Binder 实现（RabbitMQ Binder、Kafka Binder），开发者只需面向 Stream API 编程，切换 MQ 时只需修改配置，不改动代码。

### Q：消费者组的作用是什么？

A：**负载均衡 + 消息隔离**。同一个消费者组内的实例分担消息，实现负载均衡。不同消费者组独立消费同一 Topic，互不影响。

### Q：分区和消费者组有什么区别？

A：**消费者组**解决的是消费者实例间的负载均衡。**分区**解决的是消息和消费者实例的亲和性（确保同一类消息被同一实例处理）。

### Q：StreamBridge 和 @Input/@Output 哪个好？

A：**推荐 StreamBridge**（函数式编程），代码更简洁。@Input/@Output 是响应式编程模型，适合复杂场景。

---

## 总结

Spring Cloud Stream 提供了统一的消息编程模型：

1. **绑定器抽象**：一套代码，切换任意 MQ
2. **通道定义**：通过 @Input/@Output 或函数式接口定义通道
3. **分区支持**：确保消息和消费者的亲和性
4. **消费者组**：负载均衡和消息隔离

> 用好 Spring Cloud Stream，可以让消息队列切换变得毫无痛苦。
