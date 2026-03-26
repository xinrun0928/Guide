# Sentinel 注解支持与 Dubbo 集成：优雅地保护你的服务

写流量控制代码，最糟糕的体验是什么？

是 `try-catch` 满天飞，`if (entry == null)` 判断到处有。业务逻辑被 Sentinel 的 API 污染得面目全非。

好在 Sentinel 提供了**注解支持**——用注解声明资源和方法，流量控制的逻辑完全透明。

再加上 Dubbo 集成，Sentinel 可以自动为 Dubbo 调用添加保护，不需要写一行额外代码。

---

## @SentinelResource 注解

`@SentinelResource` 是 Sentinel 注解支持的核心。它告诉 Sentinel："这个方法需要保护"。

```java
@SentinelResource(
    value = "getUser",
    blockHandler = "getUserBlock",
    fallback = "getUserFallback"
)
public User getUser(Long id) {
    return userRepository.findById(id);
}

// 限流/熔断时的处理
public User getUserBlock(Long id, BlockException ex) {
    log.warn("请求被限流: {}", id);
    return User.anonymous();
}

// 业务异常时的兜底
public User getUserFallback(Long id, Throwable t) {
    log.error("获取用户失败: {}", id, t);
    return User.anonymous();
}
```

### 注解属性详解

| 属性 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `value` | String | 是 | 资源名称 |
| `blockHandler` | String | 否 | 处理限流/熔断的方法名 |
| `blockHandlerClass` | Class | 否 | `blockHandler` 所在的类 |
| `fallback` | String | 否 | 处理业务异常的方法名 |
| `fallbackClass` | Class | 否 | `fallback` 所在的类 |
| `exceptionsToIgnore` | Class[] | 否 | 忽略的异常类型 |

### blockHandler vs fallback

很多人分不清这两个属性的区别：

| 属性 | 触发条件 | 适用场景 |
|---|---|---|
| `blockHandler` | 限流、熔断触发 | 系统保护、流量控制 |
| `fallback` | 业务代码抛出异常 | 业务容错、兜底返回 |

```java
@SentinelResource(
    value = "getOrder",
    blockHandler = "block",      // Sentinel 的限流/熔断
    fallback = "fallback"        // 业务异常
)
public Order getOrder(Long id) {
    // 业务代码：SQL 查询超时，抛出 SQLException
    return orderRepository.findById(id);
}

public Order block(Long id, BlockException e) {
    // 场景1：QPS 限流 → 返回友好提示
    return Order.placeholder("请求太频繁");
}

public Order fallback(Long id, Throwable t) {
    // 场景2：SQLException → 返回空或缓存
    log.error("查询订单失败", t);
    return Order.empty();
}
```

**为什么需要两个方法？**

因为限流/熔断和业务异常是两件不同的事：

- 限流/熔断：系统主动拒绝，跟你的业务代码无关
- 业务异常：你的代码出错了，需要业务层面的兜底

### 分离 blockHandler 和 fallback 的好处

```java
// 在类级别定义降级处理方法
@SentinelResource(
    value = "createOrder",
    blockHandler = "handleBlock",
    blockHandlerClass = OrderBlockHandler.class,
    fallback = "handleFallback",
    fallbackClass = OrderFallbackHandler.class
)
public Order createOrder(OrderDTO dto) {
    return orderService.create(dto);
}
```

`blockHandlerClass` 和 `fallbackClass` 允许你把降级逻辑抽离到独立的类中：

```java
// OrderBlockHandler.java
public class OrderBlockHandler {
    public static Order handleBlock(Long id, BlockException e, Class<?>... args) {
        return Order.placeholder("系统繁忙，请稍后重试");
    }
}

// OrderFallbackHandler.java
public class OrderFallbackHandler {
    public static Order handleFallback(Long id, Throwable t, Class<?>... args) {
        return Order.empty();
    }
}
```

**好处**：
- 降级逻辑和业务逻辑分离
- 可以复用同一套降级逻辑给多个方法
- 代码更整洁

---

## Dubbo 集成：零侵入保护

在 Dubbo 中集成 Sentinel，可能是最容易的限流方案——**不需要改一行业务代码**。

### 添加依赖

```xml
<dependency>
    <groupId>com.alibaba.csp</groupId>
    <artifactId>sentinel-apache-dubbo3-adapter</artifactId>
    <version>1.8.8</version>
</dependency>
```

### 配置规则

```java
// 保护 Dubbo 服务提供者
FlowRule rule = new FlowRule("dubbo.service.UserService")
    .setGrade(RuleConstant.FLOW_GRADE_QPS)
    .setCount(100)
    .setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_DEFAULT);

FlowRuleManager.loadRules(Collections.singletonList(rule));
```

资源名称的格式：`dubbo.service.接口名` 或 `dubbo.provider.接口名` / `dubbo.consumer.接口名`

### 集成原理

Dubbo 的 Filter 机制让 Sentinel 集成变得简单：

```
消费者请求 → Dubbo Filter → Sentinel Filter → 业务逻辑
                              ↓
                        检查限流/熔断规则
                        ↓
                   通过 → 继续
                   拒绝 → 返回异常
```

Sentinel 为 Dubbo 提供了一个 `SentinelDubboFilter`，自动完成：

1. **资源定义**：每个 Dubbo 调用都是一个资源
2. **统计**：自动统计 QPS、RT、异常数
3. **拦截**：超出规则时抛出 `SentinelRpcException`
4. **降级**：返回配置的降级结果

### 消费者端限流 vs 提供者端限流

| 位置 | 限流对象 | 目的 |
|---|---|---|
| **提供者限流** | 服务端收到的请求 | 保护服务端不被冲垮 |
| **消费者限流** | 客户端发出的请求 | 保护客户端不被慢服务拖垮 |

```java
// 提供者端限流
FlowRule providerRule = new FlowRule("dubbo.provider.UserService")
    .setGrade(RuleConstant.FLOW_GRADE_QPS)
    .setCount(100);

// 消费者端限流
FlowRule consumerRule = new FlowRule("dubbo.consumer.UserService")
    .setGrade(RuleConstant.FLOW_GRADE_QPS)
    .setCount(50);  // 客户端限制更严格
```

**为什么消费者也要限流？**

想象一个场景：某个服务变慢了，但消费者还在不断发请求。

- 这些请求会在消费者端堆积，占用线程
- 每个请求都在等待远程响应
- 最终消费者的线程池被耗尽

如果消费者端限流，就能**快速失败**，避免资源被无效请求占用。

---

## Dubbo + Sentinel 熔断配置

Dubbo 集成 Sentinel 后，熔断同样零配置生效：

```java
// 熔断规则：RT 超过 500ms，或异常比例超过 30%
DegradeRule rule = new DegradeRule("dubbo.service.PaymentService")
    .setGrade(CircuitBreakerStrategy.SLOW_REQUEST_RATIO.getType())
    .setCount(500.0)
    .setSlowRatioThreshold(0.3)
    .setMinRequestAmount(5)
    .setStatIntervalMs(60 * 1000)
    .setRecoveryTimeoutSeconds(30);

DegradeRuleManager.loadRules(Collections.singletonList(rule));
```

**效果**：

- 当 PaymentService 响应变慢或错误增多
- Sentinel 自动熔断，后续调用直接返回降级结果
- 30 秒后进入半开状态，尝试恢复

---

## Sentinel Dashboard 动态配置

Sentinel 提供了一个可视化的管理后台，支持规则的动态配置和实时监控。

### 引入 Dashboard 依赖

```xml
<dependency>
    <groupId>com.alibaba.csp</groupId>
    <artifactId>sentinel-transport-simple-http</artifactId>
    <version>1.8.8</version>
</dependency>
```

### 启动 Dashboard

```bash
java -jar sentinel-dashboard.jar
```

默认端口：8080
默认账号密码：sentinel / sentinel

### 应用接入

在应用启动时添加 JVM 参数：

```bash
java -Dcsp.sentinel.dashboard.server=localhost:8080 \
     -Dproject.name=my-app \
     -jar my-app.jar
```

### Dashboard 功能

| 功能 | 说明 |
|---|---|
| **实时监控** | 查看每个资源的 QPS、RT、通过率 |
| **流控规则** | 配置流量控制策略 |
| **降级规则** | 配置熔断策略 |
| **系统规则** | 配置系统自适应限流 |
| **热点参数** | 配置热点参数限流 |
| **机器列表** | 查看接入的 Sentinel 客户端 |

**规则动态下发**：

在 Dashboard 上配置的规则，会自动推送到所有 Sentinel 客户端，**无需重启应用**。

---

## 注解 + Dubbo 集成的最佳实践

```java
// 1. 在 Dubbo Service 上使用注解
@DubboService
public class UserServiceImpl implements UserService {
    
    @Override
    @SentinelResource(
        value = "UserService.getUser",
        blockHandler = "getUserBlock",
        fallback = "getUserFallback"
    )
    public User getUser(Long id) {
        return userRepository.findById(id);
    }
    
    // 限流/熔断处理
    public User getUserBlock(Long id, BlockException e) {
        throw new RpcException("请求过于频繁，请稍后重试");
    }
    
    // 业务异常处理
    public User getUserFallback(Long id, Throwable t) {
        log.error("获取用户失败", t);
        return User.anonymous();
    }
}
```

```java
// 2. 在启动类中初始化规则
@SpringBootApplication
public class Application {
    static {
        // 初始化默认规则
        initFlowRules();
        initDegradeRules();
    }
    
    private static void initFlowRules() {
        FlowRule rule = new FlowRule("UserService.getUser")
            .setGrade(RuleConstant.FLOW_GRADE_QPS)
            .setCount(100)
            .setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_DEFAULT);
        FlowRuleManager.loadRules(Collections.singletonList(rule));
    }
}
```

---

## 面试加分点

面试中聊到 Sentinel 与 Dubbo 集成：

> Sentinel 通过 Dubbo 的 Filter 机制实现无侵入集成，这体现了**面向切面编程**的思想。Filter 在请求前后插入限流逻辑，业务代码完全不需要感知。这种设计比直接在业务代码中写 `if (entry == null)` 优雅得多。

如果面试官追问 Sentinel 和 Hystrix 在注解支持上的区别：

> Hystrix 用 `@HystrixCommand` 注解，但它和业务代码耦合较紧。Sentinel 的 `@SentinelResource` 区分了 `blockHandler` 和 `fallback`，前者处理限流/熔断，后者处理业务异常，职责更清晰。

---

## 总结

注解支持和 Dubbo 集成让 Sentinel 的使用变得优雅：

- **`@SentinelResource`**：声明式资源定义，业务逻辑与限流逻辑分离
- **`blockHandler`**：处理限流/熔断
- **`fallback`**：处理业务异常
- **Dubbo Filter**：零侵入的 Dubbo 集成
- **Dashboard**：可视化的规则配置和监控

但 Sentinel 和 Hystrix 都能做流量控制和熔断，它们的区别是什么？各自适合什么场景？

下一节，我们来深入对比 Sentinel 与 Hystrix。
