# 微服务拆分原则与实践

你的单体应用越来越大了。

代码库有 100 万行，100 个工程师在上面开发。

每次改代码都要小心翼翼，生怕影响其他模块。

每次发布都要全量回归，生怕出问题。

这是微服务化改造的信号。

今天我们就来聊聊微服务的拆分原则。

## 场景切入

微服务不是银弹，它解决了一些问题，也带来了一些新问题：

**微服务解决的问题**：
- 代码库太大，难以维护
- 团队规模大，协作困难
- 发布频率高，相互影响
- 技术栈单一，无法灵活选型

**微服务带来的问题**：
- 分布式复杂性
- 服务治理难度
- 数据一致性
- 运维成本

## 微服务拆分原则

### 原则一：单一职责

每个服务只负责一个业务功能。

```
❌ 错误拆分：
├── 用户服务（用户信息 + 权限 + 认证）
├── 订单服务（订单 + 库存 + 支付）
└── 商品服务（商品 + 分类 + 搜索）

✅ 正确拆分：
├── 用户服务（用户信息）
├── 认证服务（登录、认证、Token）
├── 权限服务（RBAC、ACL）
├── 订单服务（订单）
├── 库存服务（库存）
├── 支付服务（支付）
├── 商品服务（商品）
├── 分类服务（分类）
└── 搜索服务（搜索）
```

### 原则二：高内聚低耦合

服务内部紧密相关，服务之间松散依赖。

```java
// 高内聚：订单服务包含订单相关的所有逻辑
public class OrderService {
    private final OrderDao orderDao;
    private final InventoryClient inventoryClient;
    private final PaymentClient paymentClient;

    public void createOrder(OrderCreateRequest request) {
        // 1. 校验商品
        Product product = productClient.getProduct(request.getProductId());

        // 2. 扣减库存（调用库存服务）
        inventoryClient.deduct(request.getProductId(), request.getQuantity());

        // 3. 创建订单
        Order order = new Order();
        order.setProductId(request.getProductId());
        order.setQuantity(request.getQuantity());
        order.setStatus(OrderStatus.CREATED);
        orderDao.save(order);

        // 4. 调用支付
        paymentClient.createPayment(order.getId(), order.getAmount());
    }
}

// 低耦合：服务间通过接口通信，不直接依赖实现
public interface InventoryClient {
    void deduct(Long productId, Integer quantity);
    void restore(Long productId, Integer quantity);
}
```

### 原则三：边界清晰

服务边界要清晰，避免跨服务调用形成循环。

```
❌ 循环依赖：
用户服务 ←→ 订单服务

✅ 单向依赖：
用户服务 → 订单服务 → 库存服务 → 商品服务
```

### 原则四：渐进式拆分

不要一次性拆分，先从边界清晰的模块开始。

```
阶段一：模块化（单体应用内部拆分）
├── user/
│   └── UserModule
├── order/
│   └── OrderModule
└── product/
    └── ProductModule

阶段二：服务化（按模块拆分为独立服务）
├── user-service
├── order-service
└── product-service

阶段三：深化（按子域继续拆分）
├── user-service
│   ├── auth-service
│   ├── account-service
│   └── profile-service
├── order-service
│   ├── order-service
│   └── payment-service
└── product-service
    ├── catalog-service
    └── search-service
```

## 服务间通信

### 1. 同步通信：HTTP/REST

```java
// Feign 客户端
@FeignClient(name = "user-service", fallback = UserClientFallback.class)
public interface UserClient {
    @GetMapping("/users/{id}")
    User getUser(@PathVariable Long id);

    @GetMapping("/users/{id}/profile")
    UserProfile getProfile(@PathVariable Long id);
}

// Fallback 实现
@Component
public class UserClientFallback implements UserClient {
    @Override
    public User getUser(Long id) {
        // 返回降级数据
        return User.defaultUser(id);
    }

    @Override
    public UserProfile getProfile(Long id) {
        return UserProfile.empty();
    }
}
```

### 2. 同步通信：gRPC

```protobuf
// user.proto
syntax = "proto3";

service UserService {
    rpc GetUser(GetUserRequest) returns (User);
    rpc GetUserProfile(GetUserRequest) returns (UserProfile);
}

message GetUserRequest {
    int64 user_id = 1;
}

message User {
    int64 id = 1;
    string name = 2;
    string email = 3;
}

message UserProfile {
    int64 user_id = 1;
    string avatar = 2;
    string bio = 3;
}
```

### 3. 异步通信：消息队列

```java
// 发布事件
public class OrderService {
    private final RabbitTemplate rabbitTemplate;

    public void createOrder(Order order) {
        orderDao.save(order);

        // 发布订单创建事件
        rabbitTemplate.convertAndSend("order.events", "order.created",
            new OrderCreatedEvent(order));
    }
}

// 订阅事件
@Component
public class OrderEventConsumer {
    @RabbitListener(queues = "order.payment.queue")
    public void handleOrderCreated(OrderCreatedEvent event) {
        // 调用支付服务
        paymentService.initiatePayment(event.getOrderId());
    }

    @RabbitListener(queues = "order.notification.queue")
    public void handleOrderNotification(OrderCreatedEvent event) {
        // 发送通知
        notificationService.notifyUser(event.getUserId(), "订单创建成功");
    }
}
```

## 服务治理

### 1. 服务注册与发现

```yaml
# application.yml
spring:
  cloud:
    nacos:
      discovery:
        enabled: true
        service-name: ${spring.application.name}
        server-addr: nacos-server:8848
```

### 2. 负载均衡

```java
// Ribbon 负载均衡
@FeignClient(name = "user-service")
public interface UserClient {
    @RequestMapping(method = RequestMethod.GET, value = "/users/{id}")
    User getUser(@PathVariable("id") Long id);
}

// 指定负载均衡策略
@Configuration
public class RibbonConfig {
    @Bean
    public IRule ribbonRule() {
        // 轮询、加权、最小连接数等
        return new WeightedResponseTimeRule();
    }
}
```

### 3. 限流熔断

```java
// Sentinel 限流
@RestController
public class UserController {
    @GetMapping("/users/{id}")
    @SentinelResource(value = "getUser",
        blockHandler = "getUserBlockHandler",
        fallback = "getUserFallback")
    public User getUser(@PathVariable Long id) {
        return userService.getUser(id);
    }

    // 限流处理
    public User getUserBlockHandler(Long id, BlockException ex) {
        return User.defaultUser(id);
    }

    // 熔断处理
    public User getUserFallback(Long id, Throwable ex) {
        return User.defaultUser(id);
    }
}
```

### 4. 网关路由

```yaml
# gateway routes
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/api/users/**
          filters:
            - StripPrefix=1

        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/api/orders/**
          filters:
            - StripPrefix=1
```

## 数据管理

### 原则：每个服务管理自己的数据

```
❌ 共享数据库
├── Service A ←→ Database ←→ Service B

✅ 独立数据库
├── Service A → Database A
├── Service B → Database B
└── Service C → Database C
```

### 跨服务查询

```java
// 方案一：API 聚合
public class OrderVO getOrderDetail(Long orderId) {
    Order order = orderDao.findById(orderId);
    User user = userClient.getUser(order.getUserId());
    Product product = productClient.getProduct(order.getProductId());

    OrderVO vo = new OrderVO();
    vo.setOrder(order);
    vo.setUser(user);
    vo.setProduct(product);
    return vo;
}

// 方案二：数据冗余（CQRS）
// 订单服务保存用户信息的副本
public class Order {
    private Long id;
    private Long userId;
    private String userName;  // 冗余字段
    private String userAvatar;
}
```

## 事务一致性

微服务下的事务问题更加复杂。

### 方案：Saga 模式

```java
public class OrderSagaOrchestrator {
    private final InventoryClient inventoryClient;
    private final PaymentClient paymentClient;
    private final OrderDao orderDao;

    public void createOrderSaga(OrderCreateRequest request) {
        Order order = new Order();
        order.setStatus(OrderStatus.PENDING);

        try {
            // 步骤 1：预留库存
            inventoryClient.reserve(request.getProductId(), request.getQuantity());
            order.setInventoryReserved(true);

            // 步骤 2：创建支付
            paymentClient.create(request.getOrderId(), request.getAmount());
            order.setPaymentCreated(true);

            // 步骤 3：创建订单
            order.setStatus(OrderStatus.CREATED);
            orderDao.save(order);

        } catch (Exception e) {
            // 补偿操作
            compensate(order);
            throw e;
        }
    }

    private void compensate(Order order) {
        if (order.isPaymentCreated()) {
            paymentClient.cancel(order.getId());
        }
        if (order.isInventoryReserved()) {
            inventoryClient.release(order.getProductId(), order.getQuantity());
        }
        order.setStatus(OrderStatus.CANCELLED);
        orderDao.update(order);
    }
}
```

## 什么时候拆分微服务？

### 建议拆分的信号

1. **团队规模**：超过 10 人开发同一个应用
2. **代码规模**：代码超过 50 万行
3. **发布频率**：需要每天发布多次
4. **技术需求**：不同模块需要不同技术栈
5. **业务边界**：业务模块边界清晰

### 不建议拆分的信号

1. **团队小**：只有 2-3 个工程师
2. **业务简单**：没有复杂的跨模块调用
3. **迭代慢**：几个月才发布一次
4. **资源有限**：没有足够的运维能力

## 面试追问

### 追问一：微服务和 SOA 有什么区别？

| 维度 | SOA | 微服务 |
|-----|-----|--------|
| 服务粒度 | 粗粒度 | 细粒度 |
| 通信方式 | ESB | HTTP/gRPC |
| 数据管理 | 共享数据库 | 独立数据库 |
| 部署方式 | 单体部署 | 独立部署 |
| 治理方式 | 集中式 | 去中心化 |

### 追问二：如何处理微服务的分布式事务？

1. **Saga 模式**：补偿事务
2. **2PC/3PC**：强一致性（性能差）
3. **最终一致性**：异步补偿
4. **业务绕行**：避免跨服务事务

### 追问三：微服务拆分的粒度应该多细？

没有标准答案，但可以参考：

1. **按业务能力拆分**：核心业务域
2. **按团队边界拆分**：2 个披萨原则
3. **按变更频率拆分**：经常一起变更的放一起
4. **按性能要求拆分**：独立扩展

## 总结

微服务拆分原则：

1. **单一职责**：每个服务只负责一件事
2. **高内聚低耦合**：服务内紧密，服务间松散
3. **边界清晰**：避免循环依赖
4. **渐进式拆分**：不要一次性拆分
5. **按需拆分**：不要为了微服务而微服务

微服务的价值：
- 独立部署，快速迭代
- 技术异构，灵活选型
- 容错性好，故障隔离
- 易于扩展，按需扩展

微服务的代价：
- 分布式复杂性
- 服务治理成本
- 数据一致性挑战
- 运维成本增加

**微服务是一种架构风格，不是目标。目标是让系统更好地支撑业务发展。**
