# Sentinel 与 Hystrix 对比

> 「我们项目用的是 Hystrix，要换成 Sentinel 吗？」
>
> 这个问题，在微服务架构中是高频问题。今天我们来彻底对比一下这两个熔断器，看看该怎么选。

---

## 先说结论

| 维度 | Hystrix | Sentinel | 胜者 |
|---|---|---|---|
| 活跃度 | 低（已停更） | 高（持续迭代） | Sentinel |
| 熔断策略 | 3 种 | 3 种 + 系统自适应 | Sentinel |
| 隔离方式 | 线程池隔离 | 信号量隔离 | Sentinel |
| 热点参数限流 | 不支持 | 支持 | Sentinel |
| 控制台 | 无 | 功能完善 | Sentinel |
| 学习成本 | 中等 | 中等 | 持平 |
| Spring Cloud 集成 | 原生支持 | 官方适配 | 持平 |

**结论**：**新项目直接用 Sentinel**，Hystrix 只适合遗留项目。

---

## 为什么 Hystrix 被抛弃

### 1. 停止维护

Netflix 在 2018 年宣布 Hystrix 进入维护模式，不再开发新功能：

> Hystrix will continue to ship, but we recommend migrating to generally available alternatives such as Resilience4j.

### 2. 设计缺陷

**线程池隔离开销大**：

```
┌─────────────────────────────────────────────────────────┐
│              Hystrix 线程池隔离                           │
│                                                          │
│  ┌──────────┐                                           │
│  │  Tomcat   │                                           │
│  │  Thread   │                                           │
│  └─────┬────┘                                           │
│        │                                                │
│        ▼                                                │
│  ┌──────────┐                                           │
│  │ Hystrix  │ ← 线程切换开销                            │
│  │  Thread  │                                           │
│  └─────┬────┘                                           │
│        │                                                │
│        ▼                                                │
│  ┌──────────┐                                           │
│  │   HTTP   │                                           │
│  │  Client  │                                           │
│  └──────────┘                                           │
│                                                          │
│  问题：线程切换耗时 10-20ms                              │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**每个依赖维护一个线程池**，当依赖数量多时，线程数爆炸：

```
服务 A → 线程池 1 (10 线程)
服务 B → 线程池 2 (10 线程)
服务 C → 线程池 3 (10 线程)
服务 D → 线程池 4 (10 线程)
...
总线程数 = 依赖数 × 10
```

### 3. 无控制台

Hystrix 没有官方控制台，只能通过 Metrics 自己做监控。

---

## Sentinel 的优势

### 1. 信号量隔离（更轻量）

```
┌─────────────────────────────────────────────────────────┐
│              Sentinel 信号量隔离                         │
│                                                          │
│  ┌──────────┐                                           │
│  │  Tomcat   │                                           │
│  │  Thread   │ ← 同一线程，不切换                        │
│  └─────┬────┘                                           │
│        │                                                │
│        ▼                                                │
│  ┌──────────┐                                           │
│  │ Semaphore│ ← 信号量控制并发数                         │
│  └─────┬────┘                                           │
│        │                                                │
│        ▼                                                │
│  ┌──────────┐                                           │
│  │   HTTP   │                                           │
│  │  Client  │                                           │
│  └──────────┘                                           │
│                                                          │
│  优点：无线程切换开销                                    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 2. 多维度熔断策略

| 策略 | Hystrix | Sentinel | 说明 |
|---|---|---|---|
| 平均响应时间 | 支持 | 支持 | RT 超过阈值熔断 |
| 异常比例 | 支持 | 支持 | 异常比例超过阈值熔断 |
| 异常数 | 支持 | 支持 | 异常数超过阈值熔断 |
| 系统自适应 | 不支持 | 支持 | 根据系统负载自动熔断 |

### 3. 热点参数限流（独有）

```java
@GetMapping("/product/{id}")
@SentinelResource(value = "getProduct")
public Result&lt;Product&gt; getProduct(@PathVariable Long id) {
    return Result.ok(productService.getById(id));
}
```

Sentinel 可以针对特定参数值（如热门商品 ID）设置不同的限流阈值，Hystrix 完全不支持。

### 4. 完善的控制台

```
┌─────────────────────────────────────────────────────────┐
│              Sentinel Dashboard                          │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  [首页概览] [实时监控] [流控规则] [降级规则]     │   │
│  ├─────────────────────────────────────────────────┤   │
│  │                                                  │   │
│  │   QPS 监控图                                     │   │
│  │   ├─ 通过 QPS (绿)  ████████████████████        │   │
│  │   ├─ 拒绝 QPS (红)  ██                         │   │
│  │   └─ 平均 RT (蓝)   ████████                   │   │
│  │                                                  │   │
│  │   实时机器列表                                  │   │
│  │   ├─ app-A: 192.168.1.1 (在线)                  │   │
│  │   └─ app-B: 192.168.1.2 (在线)                  │   │
│  │                                                  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 核心对比

### 熔断策略对比

#### Hystrix

```java
@HystrixCommand(
    fallbackMethod = "fallback",
    commandProperties = {
        // 熔断器配置
        @HystrixProperty(name = "circuitBreaker.enabled", value = "true"),
        @HystrixProperty(name = "circuitBreaker.requestVolumeThreshold", value = "10"),
        @HystrixProperty(name = "circuitBreaker.sleepWindowInMilliseconds", value = "10000"),
        @HystrixProperty(name = "circuitBreaker.errorThresholdPercentage", value = "50"),
        // 超时配置
        @HystrixProperty(name = "execution.isolation.thread.timeoutInMilliseconds", value = "1000")
    },
    threadPoolProperties = {
        // 线程池配置
        @HystrixProperty(name = "coreSize", value = "10"),
        @HystrixProperty(name = "maxQueueSize", value = "100")
    }
)
public String callService() {
    return restTemplate.getForObject("http://service-b/api", String.class);
}
```

#### Sentinel

```java
@GetMapping("/api")
@SentinelResource(
    value = "api",
    blockHandler = "blockHandler",
    fallback = "fallback"
)
public String api() {
    return restTemplate.getForObject("http://service-b/api", String.class);
}

// 限流处理
public String blockHandler(Long id, BlockException e) {
    return "限流";
}

// 降级处理
public String fallback(Long id, Throwable e) {
    return "降级";
}
```

```yaml
# 熔断规则
sentinel:
  rules:
    degrade:
      - resource: api
        grade: 1  # 异常比例
        count: 0.5
        timeWindow: 10
```

**对比**：Sentinel 配置更简洁，规则与代码分离。

### 线程隔离对比

#### Hystrix 线程池隔离

```java
@HystrixCommand(
    groupKey = "userGroup",
    threadPoolKey = "userThreadPool",
    threadPoolProperties = {
        @HystrixProperty(name = "coreSize", value = "10"),
        @HystrixProperty(name = "maxQueueSize", value = "100")
    }
)
public String getUser(Long id) {
    return userClient.getUser(id);
}
```

#### Sentinel 信号量隔离

```yaml
# 不需要显式配置信号量
sentinel:
  rules:
    flow:
      - resource: getUser
        grade: 1
        count: 100
        controlBehavior: 0
```

**对比**：Sentinel 无需手动配置线程池。

### 资源模型对比

#### Hystrix

每个依赖对应一个 Command，Command 与线程池绑定：

```
CommandA → ThreadPoolA
CommandB → ThreadPoolB
```

#### Sentinel

以方法/URL 为资源，粒度更细：

```
/api/user/{id} → 资源1
/api/product/{id} → 资源2
/api/order/{id} → 资源3
```

**对比**：Sentinel 资源模型更灵活。

---

## 迁移方案

### Hystrix → Sentinel 迁移步骤

#### 1. 引入 Sentinel 依赖

```xml
<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-sentinel</artifactId>
</dependency>
```

#### 2. 替换注解

**Before（Hystrix）**：

```java
@HystrixCommand(
    fallbackMethod = "fallback",
    commandProperties = {
        @HystrixProperty(name = "execution.isolation.thread.timeoutInMilliseconds", value = "1000")
    }
)
public String getUser(Long id) {
    return userClient.getUser(id);
}
```

**After（Sentinel）**：

```java
@SentinelResource(
    value = "getUser",
    fallback = "fallback",
    blockHandler = "blockHandler"
)
public String getUser(Long id) {
    return userClient.getUser(id);
}
```

#### 3. 迁移熔断规则

| Hystrix | Sentinel |
|---|---|
| `circuitBreaker.requestVolumeThreshold` | `minRequestAmount` |
| `circuitBreaker.sleepWindowInMilliseconds` | `timeWindow` |
| `circuitBreaker.errorThresholdPercentage` | `count`（配合 grade） |

#### 4. 迁移线程池配置

Hystrix 的线程池隔离在 Sentinel 中用信号量替代：

```yaml
sentinel:
  rules:
    flow:
      - resource: getUser
        grade: 0  # 线程数模式
        count: 10  # 最大并发数
```

---

## 性能对比

### 响应延迟

```
并发数：1000 请求
目标服务延迟：100ms

┌─────────────────────────────────────────────────────────┐
│                  响应延迟对比                             │
│                                                          │
│   Hystrix (线程池隔离)    │    Sentinel (信号量)        │
│          ▲                 │           ▲               │
│          │                 │           │               │
│     10-20ms 额外开销        │      几乎无额外开销          │
│          │                 │           │               │
│          └─────────────────┴───────────────────          │
│                       时间                               │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 资源占用

| 指标 | Hystrix | Sentinel |
|---|---|---|
| 线程数 | 依赖数 × 线程池大小 | 正常线程数 |
| 内存占用 | 较高（线程栈） | 较低 |
| CPU 占用 | 上下文切换开销 | 较低 |

---

## 面试高频问题

### Q：为什么 Sentinel 比 Hystrix 性能更好？

A：核心原因是**隔离方式不同**。Hystrix 使用线程池隔离，请求在线程间切换，有 10-20ms 的额外开销。Sentinel 使用信号量隔离，不涉及线程切换，开销几乎为零。

### Q：Sentinel 可以完全替代 Hystrix 吗？

A：**可以**。Sentinel 提供了 Hystrix 的所有核心功能（流量控制、熔断降级），并且功能更丰富（热点限流、系统自适应）。新项目无需考虑 Hystrix。

### Q：Hystrix 的线程池隔离有什么场景必须用？

A：对于**执行时间不确定的慢操作**（如调用外部不可控的第三方 API），线程池隔离可以防止慢操作占满线程。Sentinel 也可以通过设置超时来实现类似效果。

### Q：迁移 Hystrix 到 Sentinel 需要注意什么？

A：重点关注三点——

1. **熔断规则**：确保阈值和熔断时长对应
2. **隔离方式**：Hystrix 线程池隔离改为 Sentinel 信号量
3. **超时配置**：Hystrix 超时在注解中，Sentinel 需要配置规则

---

## 总结

| 对比项 | Hystrix | Sentinel | 结论 |
|---|---|---|---|
| 维护状态 | 停止维护 | 活跃开发 | Sentinel 胜 |
| 隔离方式 | 线程池 | 信号量 | Sentinel 优 |
| 熔断策略 | 3 种 | 3 种 + 系统自适应 | Sentinel 优 |
| 热点限流 | 不支持 | 支持 | Sentinel 独有 |
| 控制台 | 无 | 有 | Sentinel 胜 |
| 性能 | 一般 | 优秀 | Sentinel 胜 |

> 新项目用 Sentinel，老项目逐步迁移。没有理由再选 Hystrix。
