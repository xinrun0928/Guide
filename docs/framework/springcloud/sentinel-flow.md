# Sentinel 流量控制与熔断降级

> 双十一零点，流量是平时的 100 倍。你的服务开始超时，然后崩溃，最后整个系统雪崩。
>
> Sentinel 就是来解决这个问题的——它能在流量暴涨时，自动限流、熔断、降级，保证系统不被压垮。

---

## Sentinel 是什么

Sentinel（哨兵）是阿里巴巴开源的**流量控制组件**，主要解决：

1. **流量控制**：控制请求流量，避免瞬时流量压垮系统
2. **熔断降级**：当依赖服务故障时，快速降级，避免雪崩
3. **系统自适应保护**：根据系统负载自动调节流量
4. **热点参数限流**：对特殊参数进行精细化限流

```
┌─────────────────────────────────────────────────────────┐
│                      Sentinel 架构                       │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Sentinel Core                      │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐          │   │
│  │  │ 流量控制 │ │ 熔断降级 │ │ 系统保护 │          │   │
│  │  └─────────┘ └─────────┘ └─────────┘          │   │
│  └─────────────────────────────────────────────────┘   │
│                         │                               │
│                         ▼                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │           Sentinel Dashboard                    │   │
│  │    （控制台：规则配置、实时监控、熔断策略）       │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 快速开始

### 1. 引入依赖

```xml
<dependencies>
    <!-- Sentinel 核心 -->
    <dependency>
        <groupId>com.alibaba.csp</groupId>
        <artifactId>sentinel-core</artifactId>
    </dependency>
    
    <!-- Sentinel 适配 Spring Boot -->
    <dependency>
        <groupId>com.alibaba.csp</groupId>
        <artifactId>sentinel-spring-boot-starter</artifactId>
    </dependency>
    
    <!-- Spring Boot Web（需要引入 web jar） -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
</dependencies>
```

### 2. 基础配置

```yaml
spring:
  application:
    name: order-service
  cloud:
    nacos:
      discovery:
        server-addr: 127.0.0.1:8848

# Sentinel 配置
csp:
  sentinel:
    # 控制台地址
    dashboard: 127.0.0.1:8858
    # 日志文件路径
    log:
      dir: /tmp/sentinel/logs
```

### 3. 定义资源

```java
@RestController
@RequestMapping("/order")
public class OrderController {
    
    @GetMapping("/{id}")
    @SentinelResource(value = "order", blockHandler = "orderBlockHandler")
    public Result&lt;Order&gt; getOrder(@PathVariable Long id) {
        return Result.ok(orderService.getById(id));
    }
    
    // 限流处理
    public Result&lt;Order&gt; orderBlockHandler(Long id, BlockException e) {
        return Result.fail(429, "访问太频繁，请稍后再试");
    }
}
```

### 4. 启动控制台

```bash
# 下载 Sentinel Dashboard
wget https://github.com/alibaba/Sentinel/releases/download/1.8.6/sentinel-dashboard-1.8.6.jar

# 启动控制台
java -jar sentinel-dashboard-1.8.6.jar --server.port=8858
```

访问：`http://localhost:8858`（默认账号密码：sentinel/sentinel）

---

## 流量控制

### 核心概念

```
┌─────────────────────────────────────────────────────────┐
│                    流量控制三要素                          │
│                                                          │
│  1. 资源名（Resource）                                    │
│     → 要保护的对象（接口、方法）                           │
│                                                          │
│  2. 计数器窗口（Count）                                   │
│     → 时间窗口内的最大请求数                               │
│                                                          │
│  3. 生效规则（Rule）                                      │
│     → 根据什么策略进行限流                                │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 流量控制模式

#### 1. 直接拒绝（默认）

```java
// 当 QPS 超过阈值时，直接拒绝
@GetMapping("/api")
@SentinelResource(value = "api",
    blockHandler = "blockHandler",
    fallback = "fallback")
public Result&lt;String&gt; api() {
    return Result.ok("success");
}
```

#### 2. 冷启动（Warming Up）

**场景**：系统启动后，需要预热时间。冷启动策略让流量缓慢增加。

```yaml
# Nacos 配置
sentinel:
  rules:
    flow:
      - resource: api
        grade: 1  # QPS 模式
        count: 100
        controlBehavior: 2  # Warm Up
        warmUpPeriodSec: 10  # 预热时长（秒）
```

**原理**：

```
冷启动曲线：
     QPS
      │
  100 │                    ___________
      │                   /
   50 │                /
      │            /
    0 │__________/
      └────────────────────── 时间
      0    5    10   (秒)
      
启动时先放行少量请求，逐步增加到阈值
```

#### 3. 匀速排队（Throttling）

**场景**：严格控制请求间隔，削峰填谷。

```yaml
sentinel:
  rules:
    flow:
      - resource: api
        grade: 1
        count: 10  # 每秒 10 个请求
        controlBehavior: 3  # 匀速排队
        maxQueueingTimeMs: 500  # 最大排队时间
```

**原理**：

```
请求处理时间线：
时间:  0    1    2    3    4    5
      [R1][R2][R3][R4][R5][R6]
      
每个请求间隔 100ms 均匀处理
超过排队时间的请求被拒绝
```

### 限流阈值类型

| 类型 | 说明 | 适用场景 |
|---|---|---|
| QPS | 每秒查询数 | API 接口 |
| 并发线程数 | 同时处理的请求数 | 资源密集型操作 |

### 代码配置限流规则

```java
@Configuration
public class SentinelConfig {
    
    @PostConstruct
    public void init() {
        FlowRule rule = new FlowRule();
        rule.setResource("order");  // 资源名
        rule.setGrade(RuleConstant.FLOW_GRADE_QPS);  // QPS 模式
        rule.setCount(100);  // 每秒 100 个请求
        rule.setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_DEFAULT);  // 直接拒绝
        
        // 加载规则
        FlowRuleManager.loadRules(Collections.singletonList(rule));
    }
}
```

---

## 熔断降级

### 熔断器状态

```
┌─────────────────────────────────────────────────────────┐
│                    熔断器三状态                           │
│                                                          │
│     ┌─────────────┐                                    │
│     │   关闭       │◄────────────────────┐             │
│     │  (Normal)   │                     │            │
│     └──────┬──────┘                     │            │
│            │                            │            │
│            ▼                            │            │
│     ┌─────────────┐                     │            │
│     │   打开       │─────────────────────┘            │
│     │  (Open)     │  熔断时长结束后                     │
│     └──────┬──────┘                                   │
│            │                                          │
│            ▼ 半开                                      │
│     ┌─────────────┐                                    │
│     │   半开       │                                    │
│     │ (Half-Open) │                                    │
│     └─────────────┘                                    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 熔断策略

#### 1. 基于平均响应时间（RT）

当资源的平均响应时间超过阈值，开启熔断。

```yaml
sentinel:
  rules:
    degrade:
      - resource: order
        grade: 0  # RT 模式
        count: 100  # 平均响应时间阈值（ms）
        timeWindow: 10  # 熔断时长（秒）
```

```java
@GetMapping("/slow")
@SentinelResource(value = "slow", blockHandler = "blockHandler")
public Result&lt;String&gt; slowApi() throws InterruptedException {
    Thread.sleep(200);  // 模拟慢查询
    return Result.ok("slow");
}
```

#### 2. 基于异常比例

当异常比例超过阈值，开启熔断。

```yaml
sentinel:
  rules:
    degrade:
      - resource: order
        grade: 1  # 异常比例模式
        count: 0.5  # 50% 异常比例
        timeWindow: 10  # 熔断时长（秒）
        minRequestAmount: 5  # 最小请求数（达到这个数才开始计算）
```

#### 3. 基于异常数量

当异常数量超过阈值，开启熔断。

```yaml
sentinel:
  rules:
    degrade:
      - resource: order
        grade: 2  # 异常数量模式
        count: 10  # 10 个异常
        timeWindow: 10  # 熔断时长（秒）
```

---

## 降级处理

### BlockException 处理

```java
@RestController
@RequestMapping("/order")
public class OrderController {
    
    @GetMapping("/{id}")
    @SentinelResource(
        value = "getOrder",
        blockHandler = "getOrderBlockHandler",
        fallback = "getOrderFallback"
    )
    public Result&lt;Order&gt; getOrder(@PathVariable Long id) {
        return Result.ok(orderService.getById(id));
    }
    
    // 限流/熔断时调用
    public Result&lt;Order&gt; getOrderBlockHandler(
            Long id, BlockException e) {
        log.warn("限流触发: {}", e.getClass().getSimpleName());
        return Result.fail(429, "访问太频繁，请稍后再试");
    }
    
    // 业务异常时调用
    public Result&lt;Order&gt; getOrderFallback(Long id, Throwable e) {
        log.error("业务异常: {}", e.getMessage());
        return Result.fail(500, "服务繁忙，请稍后再试");
    }
}
```

### 异常类型

| 异常类 | 说明 |
|---|---|
| FlowException | 限流触发 |
| DegradeException | 熔断触发 |
| SystemBlockException | 系统规则触发 |
| AuthorityException | 黑白名单触发 |
| ParamFlowException | 热点参数限流触发 |

---

## 系统自适应保护

系统自适应保护根据系统负载自动调节流量，比规则配置更智能。

### 配置

```yaml
sentinel:
  rules:
    system:
      - resource: order
        highestSystemLoad: 3.0  # 系统负载（Load1）
        highestCpuUsage: 0.9  # CPU 使用率 90%
        avgRt: 100  # 平均响应时间
        qps: 1000  # QPS 阈值
```

### 触发条件

| 规则 | 说明 |
|---|---|
| highestSystemLoad | 当系统 Load1 超过阈值，开启保护 |
| highestCpuUsage | 当 CPU 使用率超过阈值，开启保护 |
| avgRt | 当平均响应时间超过阈值，开启保护 |
| qps | 当 QPS 超过阈值，开启保护 |

---

## 整合 Spring Cloud

### 1. Sentinel + OpenFeign

```xml
<dependencies>
    <!-- Sentinel + Feign 适配 -->
    <dependency>
        <groupId>com.alibaba.cloud</groupId>
        <artifactId>spring-cloud-starter-alibaba-sentinel</artifactId>
    </dependency>
</dependencies>
```

```yaml
feign:
  sentinel:
    enabled: true  # 开启 Sentinel 支持
```

```java
// Feign 降级
@Component
public class UserClientFallback implements UserClient {
    
    @Override
    public User getUser(Long id) {
        User fallbackUser = new User();
        fallbackUser.setId(id);
        fallbackUser.setName("降级用户");
        return fallbackUser;
    }
}

@FeignClient(name = "user-service", fallback = UserClientFallback.class)
public interface UserClient {
    
    @GetMapping("/user/{id}")
    User getUser(@PathVariable("id") Long id);
}
```

### 2. Sentinel + Gateway

```xml
<dependency>
    <groupId>com.alibaba.csp</groupId>
    <artifactId>sentinel-spring-cloud-gateway-adapter</artifactId>
</dependency>
```

```java
@Configuration
public class SentinelGatewayConfig {
    
    @PostConstruct
    public void init() {
        // 加载网关流控规则
        List&lt;GatewayFlowRule&gt; rules = new ArrayList&lt;&gt;();
        rules.add(GatewayFlowRule
            .resource("order-service")
            .resourceMode(0)  // 0=资源名，1=路由 ID
            .count(100)  // QPS
            .intervalSec(1)  // 统计时长（秒）
        );
        GatewayRuleManager.loadRules(rules);
    }
}
```

---

## 面试高频问题

### Q：Sentinel 和 Hystrix 有什么区别？

A：核心区别在于三点——

1. **隔离方式**：Hystrix 使用线程池隔离，Sentinel 使用信号量隔离（更轻量）
2. **熔断策略**：Sentinel 支持基于 RT、异常比例、异常数三种策略，更灵活
3. **热点参数限流**：Sentinel 独有，Hystrix 没有

### Q：@SentinelResource 的 blockHandler 和 fallback 有什么区别？

A：**blockHandler** 处理 Sentinel 的流控/熔断，**fallback** 处理业务异常。两者互不干扰，可以同时配置。

### Q：Sentinel 的流量控制有哪些模式？

A：三种模式——

1. **直接拒绝**：超过阈值直接拒绝
2. **冷启动**：流量缓慢增加，用于系统预热
3. **匀速排队**：严格控制请求间隔，削峰填谷

### Q：Sentinel 如何保证规则实时生效？

A：通过 SphU.entry() 方法每次检查规则，规则变更后立即生效。控制台推送规则时使用推送模式（通过 DataSource）。

---

## 总结

Sentinel 提供了全方位的流量保护能力：

1. **流量控制**：QPS 限流、并发数限流
2. **熔断降级**：RT、异常比例、异常数三种策略
3. **系统自适应**：根据系统负载自动调节
4. **热点参数限流**：对特殊参数精细化控制

> Sentinel 是微服务流量控制的利器。用好它，可以让系统在极端流量下依然保持可用。
