# Sentinel 熔断降级：当系统"生病"时

你家的电路突然短路了。

如果没有保险丝，电流会持续增大、电线会发热、绝缘层会融化、火灾就来了。

但有了保险丝呢？电流过载的瞬间，保险丝会**自动熔断**，切断电路。虽然部分电器无法使用，但至少保住了整栋房子。

软件系统里的"熔断器"，就是从电路保险丝得到的启发。

---

## 熔断降级的本质

想象一个调用链路：

```
用户请求 → 服务A → 服务B → 服务C
```

正常情况下，一切都很好。但某天，服务 C 开始变慢、开始报错。

如果没有熔断机制：
- 服务 B 会等待服务 C 的响应，线程被占用
- 服务 A 调用服务 B，也会开始等待
- 最终，所有线程被耗尽，系统崩溃

这就是**级联故障**，也叫"雪崩"。

有了熔断机制：
- 当服务 C 的错误率达到阈值，熔断器"跳闸"
- 后续请求不再调用服务 C，而是直接返回降级结果
- 服务 C 有时间恢复，熔断器"合闸"，恢复正常调用

**熔断的目的是：快速失败，给系统喘息的机会。**

---

## Sentinel 熔断策略

Sentinel 提供了三种熔断策略，分别从不同维度判断是否需要熔断。

| 策略 | 判断依据 | 适用场景 |
|---|---|---|
| **RT 熔断** | 平均响应时间（RT） | 慢响应导致的资源占用 |
| **异常比例熔断** | 请求异常比例 | 不稳定服务、依赖外部接口 |
| **异常数熔断** | 异常总数 | 突发性故障、配置错误 |

### RT 熔断

当资源的**平均响应时间**超过阈值，且持续一定时间，就触发熔断。

```java
DegradeRule rule = new DegradeRule("slowService")
    .setGrade(CircuitBreakerStrategy.SLOW_REQUEST_RATIO.getType())
    .setCount(200.0)           // RT 阈值：200ms
    .setSlowRatioThreshold(0.5) // 50% 请求 RT 超过阈值时触发
    .setMinRequestAmount(5)      // 最小请求数：5
    .setStatIntervalMs(60 * 1000)  // 统计周期：60 秒
    .setRecoveryTimeoutSeconds(10); // 熔断恢复时间：10 秒

DegradeManager.loadRules(Collections.singletonList(rule));
```

**场景理解**：

一个接口平时响应 50ms，但某天数据库变慢了，70% 的请求需要 500ms 才能返回。

- 熔断器检测到：60 秒内有 100 个请求，其中 70 个 RT > 200ms
- 比例 70% > 阈值 50%，触发熔断
- 接下来 10 秒，所有请求直接返回降级结果
- 10 秒后，熔断器进入"半开"状态，放几个请求试试
- 如果请求正常，关闭熔断；如果还是慢，继续熔断

### 异常比例熔断

当请求的**异常比例**超过阈值，触发熔断。

```java
DegradeRule rule = new DegradeRule("unstableService")
    .setGrade(CircuitBreakerStrategy.ERROR_COUNT.getType())
    .setCount(10)                    // 10 秒内异常数超过 10 则触发
    .setMinRequestAmount(10)         // 最小请求数：10
    .setStatIntervalMs(10 * 1000);   // 统计周期：10 秒

DegradeManager.loadRules(Collections.singletonList(rule));
```

或者基于**异常比例**：

```java
DegradeRule rule = new DegradeRule("errorProneService")
    .setGrade(CircuitBreakerStrategy.ERRORRatio.getType())
    .setCount(0.3)               // 异常比例阈值：30%
    .setMinRequestAmount(10)     // 最小请求数：10
    .setStatIntervalMs(60 * 1000);

DegradeManager.loadRules(Collections.singletonList(rule));
```

**场景理解**：

外部支付接口不稳定，10% 的请求会超时失败。

- 当异常比例超过 30%，说明问题严重了
- 熔断支付接口，提示用户"支付服务暂时不可用"
- 等外部服务恢复后，再继续调用

### 异常数熔断

当**异常总数**超过阈值，触发熔断。

```java
DegradeRule rule = new DegradeRule("faultyService")
    .setGrade(CircuitBreakerStrategy.ERROR_COUNT.getType())
    .setCount(50)                    // 60 秒内超过 50 个异常就熔断
    .setMinRequestAmount(5)          // 最小请求数
    .setStatIntervalMs(60 * 1000);    // 统计周期：60 秒
```

**场景理解**：

某个接口平时很稳定，但偶尔会报配置错误。

- 当异常总数突然增加（比如 60 秒内超过 50 个）
- 说明可能有配置被错误修改了
- 熔断这个接口，防止错误影响更多用户

---

## 半开状态：自动恢复

熔断器不是一直"断开"的，它有一个关键的**半开状态**。

```
         ┌─────────────────────────────────────────┐
         │                                         │
         ▼                                         │
    ┌─────────┐    条件触发    ┌────────┐    恢复失败   ┌─────────┐
    │  关闭   │ ───────────▶ │  熔断   │ ───────────▶ │  半开   │
    │ (正常)  │              │ (断开)  │              │ (试探)  │
    └─────────┘              └────────┘              └────┬────┘
         ▲                         │                       │
         │                         │                       │ 恢复成功
         │                         └───────────────────────┘
         │                              熔断超时后自动进入
         │
    统计指标恢复正常
```

**半开状态的意义**：

- 熔断一段时间后，放几个请求试试水温
- 如果请求正常，说明服务恢复了，关闭熔断
- 如果请求还是失败，继续熔断

```java
DegradeRule rule = new DegradeRule("recoverableService")
    .setGrade(CircuitBreakerStrategy.SLOW_REQUEST_RATIO.getType())
    .setCount(200.0)
    .setSlowRatioThreshold(0.5)
    .setMinRequestAmount(5)
    .setRecoveryTimeoutSeconds(30);  // 熔断 30 秒后进入半开状态
```

**为什么要设置 `MinRequestAmount`？**

防止误判。如果系统只有 1-2 个请求，即使全部失败也不足以说明服务有问题。

`MinRequestAmount` 确保只有在请求量足够的情况下，才触发熔断。

---

## 熔断与限流的区别

很多人容易混淆熔断和限流，这里做个对比：

| 维度 | 流量控制 | 熔断降级 |
|---|---|---|
| **触发条件** | QPS 或并发数超过阈值 | 响应时间过长、异常比例过高 |
| **目的** | 保护系统不被瞬时流量打爆 | 保护系统不被慢服务拖垮 |
| **处理方式** | 拒绝请求或排队等待 | 快速失败，返回降级结果 |
| **恢复方式** | 阈值下降后自动恢复 | 等待超时后进入半开状态试探 |

**两者配合使用**：

- 流量控制：处理"流量太大"的问题
- 熔断降级：处理"服务故障"的问题

---

## 降级处理：返回什么？

被熔断后，请求返回什么？这个逻辑由**降级处理函数**决定。

```java
@SentinelResource(
    value = "getOrder",
    blockHandler = "getOrderBlock",
    fallback = "getOrderFallback"
)
public Order getOrder(Long orderId) {
    return orderService.findById(orderId);
}

// 熔断时的处理
public Order getOrderBlock(Long orderId, BlockException e) {
    log.warn("Order service degraded: {}", e.getClass());
    return Order.placeholder("服务繁忙，请稍后重试");
}

// 业务异常时的兜底
public Order getOrderFallback(Long orderId, Throwable t) {
    log.error("Order query failed", t);
    return Order.placeholder("查询失败，请联系客服");
}
```

**降级策略设计建议**：

1. **返回默认值**：如商品详情页，返回"暂无数据"
2. **返回缓存**：如果有本地缓存，返回旧数据
3. **返回简化版本**：比如不查询关联数据，只返回核心字段
4. **返回友好提示**：告诉用户当前情况，不要给用户展示技术错误

---

## 实际案例：保护远程调用

假设你的服务需要调用一个外部 API：

```java
@SentinelResource(
    value = "externalApi",
    blockHandler = "externalApiBlock",
    fallback = "externalApiFallback"
)
public ExternalData callExternalApi(String param) {
    return externalApiClient.get(param);
}

public ExternalData externalApiBlock(String param, BlockException e) {
    // 熔断触发，返回兜底数据
    return ExternalData.fromCache(param);
}

public ExternalData externalApiFallback(String param, Throwable t) {
    // 业务异常，返回空或重试
    log.error("External API call failed", t);
    return ExternalData.empty();
}
```

加上熔断规则：

```java
// 当 externalApi 的 RT 超过 1 秒，或异常比例超过 20% 时，熔断
DegradeRule rule = new DegradeRule("externalApi")
    .setGrade(CircuitBreakerStrategy.SLOW_REQUEST_RATIO.getType())
    .setCount(1000.0)  // 1 秒
    .setSlowRatioThreshold(0.2)  // 20% 请求慢
    .setMinRequestAmount(10)
    .setStatIntervalMs(60 * 1000)
    .setRecoveryTimeoutSeconds(30);
```

---

## 面试加分点

面试中聊熔断降级，可以展示你对系统弹性的理解：

> 熔断器的设计，本质上是**防患于未然**。与其让系统在压力下慢慢崩溃，不如主动"截断"，保护关键路径。Sentinel 的半开状态设计很巧妙——它不是简单的"开/关"，而是有试探机制，减少误判对可用性的影响。

如果面试官追问熔断的实现原理：

> Sentinel 内部使用状态机维护熔断状态。每次请求结束后，根据统计数据判断是否需要触发熔断。熔断器不会真正"阻止"请求，而是直接抛出异常，由降级函数处理。这个设计让熔断逻辑和业务逻辑完全解耦。

---

## 总结

熔断降级的核心是**保护系统不被故障拖垮**：

- **RT 熔断**：应对慢服务
- **异常比例熔断**：应对不稳定服务
- **异常数熔断**：应对突发故障
- **半开状态**：自动恢复机制
- **降级处理**：返回兜底结果

但熔断只能处理"单个资源"的问题。如果整个系统都面临压力——CPU 飙升、内存不足、线程池耗尽——怎么办？

下一节，我们来聊聊 Sentinel 的**系统自适应限流**，从更宏观的维度保护系统。
