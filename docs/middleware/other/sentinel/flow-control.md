# Sentinel 流量控制：当请求排队等待时

你的电商系统正在搞大促。

一瞬间，10 万个请求砸向商品查询接口。服务器的处理能力只有每秒 1 万 QPS，剩下的 9 万个请求怎么办？

直接拒绝？用户体验爆炸。全部接受？系统分分钟雪崩。

所以，**你需要流量控制**——让请求以系统能承受的速度通过，而不是一股脑全放进来。

---

## 流量控制的本质

流量控制（Flow Control），本质上是**请求速率和系统处理能力的匹配**。

常见的策略有两种：

1. **削峰填谷**：让请求均匀通过，不超过系统处理上限
2. **拒绝策略**：超出处理能力的请求，直接拒绝并返回友好提示

Sentinel 两种都支持，具体用哪种，取决于你的业务场景。

---

## QPS 限流 vs 并发线程数限流

这是 Sentinel 限流的两种维度，先搞清楚它们的区别。

| 维度 | QPS 限流 | 并发线程数限流 |
|---|---|---|
| 控制什么 | 每秒通过的请求数量 | 同时在处理的请求数量 |
| 适用场景 | 保护下游系统的吞吐量 | 保护线程资源，防止线程耗尽 |
| 举例 | "每秒最多 1000 个请求" | "最多同时有 50 个线程处理" |

为什么要区分？因为 **QPS 高不代表系统压力大**。

比如一个查询接口，QPS=1000，但每个请求 0.1ms 就返回，系统毫无压力。

反过来，一个复杂计算接口，QPS=10，但每个请求要占用线程 10 秒——这 10 个并发就能把线程池占满。

### QPS 限流示例

```java
// 配置规则：resourceName 的 QPS 不能超过 100
FlowRule rule = new FlowRule("orderService")
    .setGrade(RuleConstant.FLOW_GRADE_QPS)  // 按 QPS 维度
    .setCount(100)                            // 每秒最多 100 个请求
    .setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_DEFAULT);

FlowRuleManager.loadRules(Collections.singletonList(rule));
```

### 并发线程数限流示例

```java
// 配置规则：最多同时有 20 个线程在处理
FlowRule rule = new FlowRule("heavyCompute")
    .setGrade(RuleConstant.FLOW_GRADE_THREAD)  // 按并发线程数维度
    .setCount(20)                               // 最多 20 并发
    .setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_DEFAULT);

FlowRuleManager.loadRules(Collections.singletonList(rule));
```

---

## 流量控制行为

除了控制"量"，Sentinel 还能控制**超出流量后的行为**。

Sentinel 提供了四种控制行为：

| 行为 | 说明 | 适用场景 |
|---|---|---|
| **直接拒绝** | 超出阈值的请求直接拒绝 | 对延迟敏感，允许部分失败的场景 |
| **冷启动** | 让流量缓慢增加到一个稳定值 | 防止系统冷启动时被打爆 |
| **匀速排队** | 请求匀速通过，超时的直接拒绝 | 削峰填谷，保证系统稳定 |
| **冷启动 + 匀速排队** | 结合两者特点 | 渐进式流量控制 |

### 直接拒绝

```java
FlowRule rule = new FlowRule("fastReject")
    .setGrade(RuleConstant.FLOW_GRADE_QPS)
    .setCount(100)
    .setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_DEFAULT);  // 直接拒绝
```

这是默认行为，简单粗暴。超出阈值的请求会立即抛出 `BlockException`。

### 冷启动（Warm Up）

冷启动适合那种"系统需要预热"的场景。比如 JIT 编译、缓存预热等。

```java
FlowRule rule = new FlowRule("warmUp")
    .setGrade(RuleConstant.FLOW_GRADE_QPS)
    .setCount(100)
    .setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_WARM_UP)
    .setWarmUpPeriodSec(10);  // 预热时长：10 秒
```

假设阈值是 100，预热时长 10 秒：

- 第 1 秒：约 10 QPS
- 第 5 秒：约 50 QPS
- 第 10 秒：达到 100 QPS

**原理**：冷启动期间，Sentinel 会计算一个"令牌发放速率"，让它从 0 线性增长到满速。

### 匀速排队

匀速排队的核心是**削峰填谷**——让请求均匀通过，超时的直接放弃。

```java
FlowRule rule = new FlowRule("queue")
    .setGrade(RuleConstant.FLOW_GRADE_QPS)
    .setCount(100)
    .setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_QUEUE)
    .setMaxQueueingTimeMs(500);  // 最大排队时间 500ms
```

这个配置的含义：

- 每 10ms 放行一个请求（100 QPS = 100/1000ms = 每 10ms 一个）
- 如果请求进入队列后，排队时间超过 500ms，直接拒绝

适合场景：**秒杀系统**。让所有用户请求排队，而不是直接打爆系统。

---

## 热点参数限流

普通的限流是针对整个资源的，但实际场景中，你可能需要对不同的参数做不同的限流。

比如商品查询接口：
- 查询热门商品（ID=123）：QPS 限制 100
- 查询普通商品：QPS 限制 1000

```java
// 热点参数规则
ParamFlowRule rule = new ParamFlowRule("getProduct")
    .setGrade(RuleConstant.FLOW_GRADE_QPS)
    .setCount(100)
    .setParamIdx(0);  // 第 0 个参数（商品ID）作为热点参数

ParamFlowManager.loadRules(Collections.singletonList(rule));
```

如果某些特定值的限流阈值需要特别设置：

```java
// 对商品 ID = 10086 设置特殊限流阈值
ParamFlowItem item = new ParamFlowItem()
    .setObject(String.valueOf(10086))  // 热点值
    .setCount(10);                     // 这个值的阈值是 10

ParamFlowRule rule = new ParamFlowRule("getProduct")
    .setGrade(RuleConstant.FLOW_GRADE_QPS)
    .setCount(100)
    .setParamIdx(0)
    .setParamFlowItemList(Collections.singletonList(item));
```

**应用场景**：

- 防止某个爆款商品把系统打爆
- 防止黑客用固定 IP 刷接口
- 对不同租户设置不同限流阈值

---

## 关联限流

有时候，限制 A 资源的流量，是为了保护 B 资源。

比如"下订单"接口压力大时，会拖慢"查询订单"接口。这时应该**限制"下订单"的流量**，而不是限制"查询订单"。

```java
// 配置关联限流
FlowRule rule = new FlowRule("queryOrder")
    .setGrade(RuleConstant.FLOW_GRADE_QPS)
    .setCount(100)
    .setResource("createOrder")      // 关联到 createOrder
    .setStrategy(RuleConstant.STRATEGY_RELATE_UPstream);  // 上游关联
```

这个配置的含义：**当 createOrder 的 QPS 超过阈值时，限制 queryOrder 的访问**。

---

## 使用注解简化配置

实际项目中，手动写规则代码比较繁琐。推荐使用 `@SentinelResource` 注解配合动态配置。

```java
@SentinelResource(
    value = "getUser",
    blockHandler = "getUserBlockHandler",
    fallback = "getUserFallback"
)
public User getUserById(Long id) {
    return userRepository.findById(id);
}

// 限流/熔断时的处理
public User getUserBlockHandler(Long id, BlockException e) {
    // 被限流或熔断
    log.warn("getUser blocked: {}", e.getClass().getSimpleName());
    return User.anonymous();
}

// 业务异常时的兜底
public User getUserFallback(Long id, Throwable t) {
    log.error("getUser failed", t);
    return User.anonymous();
}
```

**注意**：`blockHandler` 处理限流/熔断，`fallback` 处理业务异常。两者的触发条件不同。

---

## 面试加分点

面试中问到流量控制时，可以展示对不同场景的理解：

> Sentinel 的流量控制维度很丰富。QPS 限流保护下游系统，并发线程数限流保护自身线程资源。冷启动适合有预热需求的系统，匀速排队适合秒杀场景。而热点参数限流，解决的是"部分参数值压力过大"的问题。

如果面试官追问匀速排队的实现原理：

> Sentinel 内部使用 `TokenCache` 维护一个队列，请求进来后不是立即通过，而是等待令牌发放。如果等待超时，说明系统已经过载，直接拒绝。这种方式比直接拒绝更温和，对用户更友好。

---

## 总结

流量控制的核心是**让请求速率和系统能力匹配**：

- **QPS 限流**：控制请求速率
- **并发线程数限流**：控制并发量
- **冷启动**：渐进式放行，适合有预热需求的系统
- **匀速排队**：削峰填谷，适合秒杀场景
- **热点参数限流**：精细化控制
- **关联限流**：保护被关联的资源

但流量控制只能防止"请求太多"，如果某个资源本身响应极慢，它会慢慢拖垮整个系统——这时候，流量控制就不够用了。

怎么办？

下一节，我们来聊聊 Sentinel 的另一个核心能力：**熔断降级**。
