# Sentinel 与 Hystrix 对比：谁才是流量控制的王者？

2018 年，Netflix 宣布 Hystrix 进入维护模式，不再积极开发新功能。

同年，阿里巴巴开源了 Sentinel，定位同样是"流量控制"和"熔断降级"。

于是社区里开始流传一个说法：Sentinel 是 Hystrix 的"接班人"。

但实际上，两者的设计理念和适用场景有显著差异。选哪个，要看你的具体需求。

---

## 先说结论

| 维度 | Sentinel | Hystrix |
|---|---|---|
| **设计理念** | 流量控制为主，熔断为辅 | 熔断降级为主 |
| **熔断策略** | RT、异常比例、异常数 | 错误率 |
| **限流维度** | QPS、并发线程数、入口 QPS | 仅并发线程数 |
| **配置方式** | 注解 + 规则 + Dashboard | 注解 + 配置文件 |
| **生态集成** | Dubbo、Spring Cloud Gateway 等 | Spring Cloud（官方） |
| **社区状态** | 活跃维护 | 维护停滞 |
| **学习曲线** | 较平缓 | 较陡峭 |

---

## 设计理念的差异

这是两者最核心的区别。

### Hystrix：熔断优先

Hystrix 的设计哲学是：**保护远程调用不被故障拖垮**。

它的核心是**熔断器（Circuit Breaker）**，一切机制都围绕熔断展开：

```
请求 → Hystrix Command → 熔断器检查 → 执行 → 统计 → 熔断判断
```

Hystrix 认为：**远程调用是不可靠的，所以你要假设它随时会失败**。

基于这个假设，Hystrix 提供了：

- 线程池隔离：每个依赖服务有独立的线程池
- 信号量隔离：轻量级的并发控制
- 熔断器：故障时快速失败
- Fallback：失败时的兜底逻辑

### Sentinel：流量塑形

Sentinel 的设计哲学是：**让流量以系统能承受的速率通过**。

它的核心是**流量控制（Flow Control）**，熔断只是其中一种策略：

```
请求 → Slot Chain → 统计 → 限流检查 → 熔断检查 → 通过/拒绝
```

Sentinel 认为：**系统是有处理能力的，关键是控制流量的节奏**。

基于这个理念，Sentinel 提供了：

- 流量控制：QPS、并发数、冷启动、匀速排队
- 熔断降级：RT、异常比例、异常数
- 系统自适应：从系统全局维度保护
- 热点参数限流：精细化的流量控制

---

## 熔断策略对比

### Hystrix 熔断策略

Hystrix 只有一种熔断策略：**基于错误率**。

```
10 秒内，至少 20 个请求
错误率 > 50%
→ 触发熔断
```

```java
@HystrixCommand(
    fallbackMethod = "fallback",
    commandProperties = {
        @HystrixProperty(name = "circuitBreaker.requestVolumeThreshold", value = "20"),
        @HystrixProperty(name = "circuitBreaker.errorThresholdPercentage", value = "50"),
        @HystrixProperty(name = "circuitBreaker.sleepWindowInMilliseconds", value = "5000")
    }
)
public String callRemoteService() {
    return remoteService.get();
}
```

### Sentinel 熔断策略

Sentinel 支持三种熔断策略，更加灵活：

```java
// 策略1：RT 熔断
DegradeRule rtRule = new DegradeRule("service")
    .setGrade(CircuitBreakerStrategy.SLOW_REQUEST_RATIO.getType())
    .setCount(200.0)  // RT 阈值
    .setSlowRatioThreshold(0.5);  // 50% 请求超阈值则熔断

// 策略2：异常比例熔断
DegradeRule errorRatioRule = new DegradeRule("service")
    .setGrade(CircuitBreakerStrategy.ERRORRatio.getType())
    .setCount(0.3);  // 30% 异常比例

// 策略3：异常数熔断
DegradeRule errorCountRule = new DegradeRule("service")
    .setGrade(CircuitBreakerStrategy.ERROR_COUNT.getType())
    .setCount(10);  // 10 秒内超过 10 个异常
```

**Sentinel 的优势**：

- 慢响应场景：可以基于 RT 熔断，而不是等出错了才熔断
- 灵活性：不同服务可以用不同的熔断策略

---

## 限流维度对比

这是 Sentinel 明显领先的地方。

### Hystrix 的限流

Hystrix **不支持 QPS 限流**，只能用线程池隔离控制并发数。

```java
@HystrixCommand(
    threadPoolKey = "userPool",
    threadPoolProperties = {
        @HystrixProperty(name = "coreSize", value = "10"),
        @HystrixProperty(name = "maxQueueSize", value = "100")
    }
)
public String getUser() {
    return userService.get();
}
```

**问题**：

- 线程池隔离开销大（每个线程栈占用约 1MB）
- 无法控制 QPS，只能控制并发数
- 不支持冷启动、匀速排队等高级策略

### Sentinel 的限流

Sentinel 支持多种限流维度：

```java
// QPS 限流
FlowRule qpsRule = new FlowRule("service")
    .setGrade(RuleConstant.FLOW_GRADE_QPS)
    .setCount(1000);

// 并发线程数限流
FlowRule threadRule = new FlowRule("service")
    .setGrade(RuleConstant.FLOW_GRADE_THREAD)
    .setCount(50);

// 冷启动（预热）
FlowRule warmUpRule = new FlowRule("service")
    .setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_WARM_UP)
    .setWarmUpPeriodSec(30);

// 匀速排队
FlowRule queueRule = new FlowRule("service")
    .setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_QUEUE)
    .setMaxQueueingTimeMs(500);
```

---

## 隔离策略对比

### Hystrix 的线程池隔离

Hystrix 使用**线程池隔离**，每个依赖服务有独立的线程池：

```
请求1 → [线程池A: userService] → 调用
请求2 → [线程池B: orderService] → 调用
请求3 → [线程池C: paymentService] → 调用
```

**优点**：

- 故障隔离彻底：一个服务慢，不会影响其他服务
- 可以并发调用多个依赖服务

**缺点**：

- 线程池管理开销大
- 线程上下文切换损耗
- 线程池配置复杂

### Sentinel 的并发控制

Sentinel 默认使用**信号量隔离**（也可以用线程池）：

```java
// 信号量隔离
try (Entry entry = SphU.entry("service")) {
    // 业务逻辑，最多 50 个并发
} catch (BlockException e) {
    // 限流处理
}
```

**优点**：

- 开销小，不需要线程切换
- 配置简单

**缺点**：

- 阻塞调用会占用信号量，可能导致线程阻塞

---

## 社区与生态

### Hystrix

- Netflix 已停止维护（2018 年 12 月宣布）
- 只修复 critical bug，不再开发新功能
- 大量遗留项目在使用
- 与 Spring Cloud 官方集成

### Sentinel

- 阿里持续维护
- 与 Spring Cloud Alibaba 深度集成
- 支持 Dubbo、Apache Dubbo、Spring Cloud Gateway
- 支持 Nacos、Apollo 等配置中心集成
- 活跃的社区和文档

---

## 选型建议

### 选 Sentinel，如果：

- 你需要**流量控制**（QPS 限流、冷启动、匀速排队）
- 你需要**系统自适应限流**（从全局保护系统）
- 你使用 **Dubbo** 或 **Spring Cloud Alibaba**
- 你希望**动态配置规则**（Dashboard 热更新）
- 你希望**社区活跃、持续维护**

### 选 Hystrix，如果：

- 你在使用 **Spring Cloud Netflix**（官方集成）
- 你需要**线程池隔离**（适合有状态操作）
- 你的团队已经熟悉 Hystrix（迁移成本高）
- 你只需要**基础的熔断功能**（不追求高级限流）

### 如果是新项目：

**推荐 Sentinel**。

原因：

1. 社区活跃，持续迭代
2. 功能更丰富，限流维度更全
3. 性能开销更小
4. 配置更灵活

---

## 迁移建议

如果你的项目已经在用 Hystrix，有以下迁移路径：

### 1. 完全迁移到 Sentinel

```
Hystrix → Sentinel
```

- 替换依赖
- 重写熔断规则
- 重写 Fallback 逻辑
- 迁移成本中等

### 2. 渐进式迁移

```
Hystrix + Sentinel → Sentinel
```

- 新增功能用 Sentinel
- 存量功能逐步迁移
- 迁移成本低，但维护两套系统

### 3. 保持 Hystrix（不推荐）

- 只修复 critical bug
- 新功能开发受限
- 长期来看会增加技术债务

---

## 面试加分点

面试中对比 Sentinel 和 Hystrix：

> 两者的设计理念不同。Hystrix 的核心是**熔断器**，默认假设远程调用不可靠，通过线程池隔离来保护系统。Sentinel 的核心是**流量塑形**，默认系统有处理能力，关键是控制流量的节奏。这个理念差异决定了两者在功能上的差异——Sentinel 有更丰富的限流策略，而 Hystrix 的线程池隔离更彻底。

如果面试官追问线程池隔离和信号量隔离的区别：

> 线程池隔离适合**有状态的操作**（比如需要维护 session），因为线程是绑定的。信号量隔离适合**无状态操作**，开销更小。Sentinel 默认用信号量，但如果需要线程池隔离，也有对应实现。

---

## 总结

| 对比项 | Sentinel | Hystrix |
|---|---|---|
| **核心定位** | 流量控制 + 熔断降级 | 熔断降级为主 |
| **限流维度** | QPS、并发线程数、入口 QPS | 仅并发线程数 |
| **熔断策略** | RT、异常比例、异常数 | 仅错误率 |
| **高级特性** | 冷启动、匀速排队、系统自适应 | 线程池隔离 |
| **性能开销** | 较小（信号量为主） | 较大（线程池为主） |
| **维护状态** | 活跃 | 停止维护 |
| **推荐场景** | 新项目、Dubbo、精细化限流 | 遗留项目、Spring Cloud Netflix |

选择 Sentinel，不只是选择一个工具，更是一种**流量优先**的架构思维。

---

## 下一步

Sentinel 还有很多高级特性值得探索：

- **集群流控**：多实例协调限流
- **动态数据源**：规则存储到 Nacos、Apollo
- **规则推送模式**：推送 vs 拉取

如果你对某个方向感兴趣，可以深入研究。Sentinel 的官方文档和源码都是很好的学习资源。
