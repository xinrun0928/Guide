# Sentinel 核心概念：资源、规则、插槽链

想象一下，你经营一家网红餐厅。

平时每天只来几十个客人，后厨绰绰有余。但某天突然来了 1000 个人，后厨瞬间崩溃——锅不够、厨师不够、出餐速度跟不上。

结果呢？等位的顾客怨声载道，后厨手忙脚乱，菜品的质量也直线下降。

这种情况，在软件系统里叫**流量洪峰**。不加控制的话，系统会像这家餐厅一样彻底崩溃。

Sentinel 就是来解决这个问题的——它不是简单地"拒绝"请求，而是像一个智能的流量调度员，知道什么时候该放行、什么时候该排队、什么时候该直接拒绝。

---

## 什么是 Sentinel？

Sentinel 是阿里巴巴开源的流量控制组件，主打**流量控制**和**熔断降级**两大核心能力。它的设计理念是：**让系统在保证稳定性的前提下，尽可能多地服务请求**。

和 Hystrix 不同，Systentinel 不仅仅关注"熔断"，更关注"流量塑形"——它可以在系统即将过载时就开始控制流量，而不是等到已经崩溃了才行动。

---

## 核心概念一：资源

在 Sentinel 的世界里，**一切皆资源**。

一个 REST 接口、一个服务调用、甚至一段代码逻辑，都可以被定义为"资源"。

```java
// 定义一个资源：使用 try-with-resources 方式
try (Entry entry = SphU.entry("orderService")) {
    // 业务逻辑
    orderService.createOrder();
} catch (BlockException e) {
    // 请求被拒绝，进入降级逻辑
    handleBlock();
}
```

为什么要用"资源"这个概念？

因为 Sentinel 需要知道**你在保护什么**。只有明确了资源，Sentinel 才能对它施加流量控制规则。

### 资源的两种定义方式

**方式一：手动定义（代码侵入性强，但灵活）**

```java
try (Entry entry = SphU.entry("getUser")) {
    // 业务逻辑
    return userService.getUserById(id);
} catch (BlockException e) {
    // 被限流或熔断
    return fallback();
}
```

**方式二：注解定义（推荐，侵入性低）**

```java
@SentinelResource(value = "getUser", fallback = "getUserFallback")
public User getUserById(Long id) {
    return userRepository.findById(id);
}

// Fallback 方法
public User getUserFallback(Long id, Throwable t) {
    return User.defaultUser();
}
```

注解方式的优势很明显：业务代码和流量控制逻辑分离，代码更清晰。

---

## 核心概念二：规则

光有资源还不够，你还需要告诉 Sentinel：**这个资源的流量要怎么控制**。

这就是"规则"的作用。

Sentinel 支持四种规则：

| 规则类型 | 作用 | 典型场景 |
|---|---|---|
| **流量控制规则** | 控制每秒/每分钟能处理多少请求 | 防止瞬时流量冲击 |
| **熔断降级规则** | 当响应时间或异常比例过高时，暂时"熔断"调用 | 防止级联故障 |
| **系统保护规则** | 从系统维度限制整体负载 | 保护整个系统不被压垮 |
| **访问控制规则** | 黑名单/白名单控制 | 恶意访问拦截 |

### 规则的配置方式

**方式一：代码配置（调试方便）**

```java
FlowRule rule = new FlowRule();
rule.setResource("orderService");
rule.setGrade(RuleConstant.FLOW_GRADE_QPS);
rule.setCount(100);  // QPS 不能超过 100
rule.setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_DEFAULT);
FlowRuleManager.loadRules(Collections.singletonList(rule));
```

**方式二：动态配置（生产推荐）**

结合 Nacos、Apollo 等配置中心，Sentinel 支持规则的热更新——改配置不需要重启应用。

---

## 核心概念三：插槽链

这是 Sentinel 最精妙的设计。

当你调用 `SphU.entry("resourceName")` 时，Sentinel 内部会依次经过一串"插槽"，每个插槽负责一个职责：

```
请求进入 → [NodeSelectorSlot] → [ClusterBuilderSlot] → [LogSlot] 
         → [StatisticSlot] → [AuthoritySlot] → [SystemSlot] 
         → [FlowSlot] → [DegradeSlot] → [请求通过]
```

### 每个插槽的职责

**NodeSelectorSlot** - 负责为资源创建 `Node`（统计节点）

```java
// Sentinel 会为每个资源创建一个独立的 Node
// 用于后续的 QPS、响应时间等统计
```

**ClusterBuilderSlot** - 负责构建集群节点

```java
// 如果启用了集群模式，多个 Sentinel 实例会共享统计信息
// 这个插槽负责维护集群节点结构
```

**StatisticSlot** - 核心统计插槽

```java
// 每次请求通过，都会在这里更新统计数据：
// - QPS 计数
// - 线程数
// - 响应时间
// - 异常计数
// 这些数据是后续限流/熔断判断的依据
```

**FlowSlot** - 流量控制插槽

```java
// 基于 StatisticSlot 统计的数据，判断是否需要限流
// 如果超出阈值，返回 BlockException
```

**DegradeSlot** - 熔断降级插槽

```java
// 判断资源是否处于熔断状态
// 如果处于熔断状态，直接抛出 DegradeException
```

### 为什么这样设计？

插槽链的好处是**职责分离**和**可扩展**：

1. 每个插槽只做一件事，逻辑清晰
2. 可以灵活组合，比如不需要熔断功能？删掉 `DegradeSlot` 就行
3. 方便自定义开发，比如你想加一个特殊的限流策略，写一个新的 Slot 插入链中即可

---

## 三个概念的协作

用一个实际的例子把它们串起来：

```java
// 1. 定义资源
@SentinelResource(value = "fetchData", blockHandler = "fetchDataBlock")
public String fetchData(String id) {
    // 业务逻辑
    return remoteService.get(id);
}

// 2. 配置规则（限流 QPS=100，熔断：RT>500ms 持续 5 秒则触发）
FlowRuleManager.loadRules(Collections.singletonList(
    new FlowRule("fetchData").setCount(100)
));
DegradeRuleManager.loadRules(Collections.singletonList(
    new DegradeRule("fetchData")
        .setGrade(CircuitBreakerStrategy.SLOW_REQUEST_RATIO.getType())
        .setCount(0.5)  // 50% 请求 RT 超过阈值
        .setSlowRatioThreshold(500.0)  // 阈值：500ms
        .setMinRequestAmount(5)  // 最小请求数
        .setStatIntervalMs(60 * 1000)  // 统计周期
        .setRecoveryTimeoutSeconds(10)  // 熔断后 10s 进入半开状态
));

// 3. 插槽链自动工作
// - 每次请求进入，先统计（StatisticSlot）
// - 再检查系统状态（SystemSlot）
// - 再检查限流规则（FlowSlot）
// - 最后检查熔断状态（DegradeSlot）
```

整个过程，Sentinel 替你做了：统计 → 判断 → 决策。业务代码只需要关注"被拒绝后怎么办"（`blockHandler`）。

---

## 面试加分点

面试中聊到 Sentinel 核心概念时，可以展示你对架构设计的理解：

> Sentinel 的插槽链设计，本质上是**责任链模式**的应用。每个插槽职责单一，方便扩展和测试。而统计与决策分离的设计，让限流和熔断可以独立配置、独立生效。

这种设计思想，在 Dubbo、Spring Cloud Gateway 等框架中也有类似应用。

---

## 总结

Sentinel 的三要素：

- **资源**：你要保护的东西
- **规则**：怎么保护它
- **插槽链**：谁来执行保护逻辑

理解了这两点，你就掌握了 Sentinel 的灵魂。

但问题来了：Sentinel 怎么知道什么时候该"限流"、什么时候该"熔断"？这个判断的依据是什么？

下一节，我们来深入聊聊 Sentinel 的流量控制策略。
