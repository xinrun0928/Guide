# Sentinel 限流规则与流量效果控制器

你的微服务正在运行，突然流量激增。

没有限流的情况下，服务可能直接被打爆——CPU 打满、内存溢出、数据库连接耗尽...

有了 Sentinel，一切尽在掌控。

## Sentinel 是什么

Sentinel 是阿里巴巴开源的流量控制组件，主要功能：

```
┌─────────────────────────────────────────────────┐
│                   Sentinel                       │
├─────────────────────────────────────────────────┤
│  流量控制 (Flow Control)                         │
│    └─ 基于 QPS / 并发数的限流                     │
│                                                 │
│  熔断降级 (Degrade)                              │
│    └─ RT、异常比例、异常数熔断                    │
│                                                 │
│  系统自适应保护 (System Adaptive)                 │
│    └─ 根据系统负载动态调整                        │
│                                                 │
│  热点参数限流 (Param Flow)                       │
│    └─ 针对参数值的限流                            │
│                                                 │
│  多样化流量塑形                                   │
│    └─ 直接拒绝、冷启动、匀速排队                   │
└─────────────────────────────────────────────────┘
```

## 核心概念

### 1. Resource（资源）

资源是你要保护的对象，可以是：
- URL
- 接口
- 方法
- 服务名

```java
// 定义资源
@RestController
public class OrderController {

    @GetMapping("/order/{id}")
    public Order getOrder(@PathVariable Long id) {
        // 定义资源名
        try (Entry entry = SphU.entry("getOrder")) {
            return orderService.getById(id);
        } catch (BlockException e) {
            // 被限流
            return Response.fail("系统繁忙");
        }
    }
}
```

### 2. Rule（规则）

Sentinel 支持多种规则：

| 规则类型 | 说明 |
|----------|------|
| FlowRule | 流量控制规则 |
| DegradeRule | 熔断降级规则 |
| ParamFlowRule | 热点参数限流规则 |
| SystemRule | 系统自适应规则 |
| AuthorityRule | 黑白名单规则 |

### 3. Entry（入口）

每个资源的每次访问都对应一个 Entry，用于统计和监控。

## 流量控制规则

### FlowRule 详解

```java
FlowRule flowRule = new FlowRule();
flowRule.setResource("getOrder");           // 资源名
flowRule.setGrade(RuleConstant.GRADE_QPS);   // 基于 QPS
flowRule.setCount(100);                       // 阈值：100 QPS

// 限流效果
flowRule.setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_DEFAULT);

// 流量整形行为
// - CONTROL_BEHAVIOR_DEFAULT: 直接拒绝（默认）
// - CONTROL_BEHAVIOR_WARM_UP: 冷启动预热
// - CONTROL_BEHAVIOR_RATE_LIMITER: 匀速排队
// - CONTROL_BEHAVIOR_WARM_UP_RATE_LIMITER: 预热 + 匀速排队

// 关联资源（可选）
flowRule.setRelationApp("order-service");

FlowRuleManager.loadRules(Collections.singletonList(flowRule));
```

### 三种流量整形效果

#### 1. 直接拒绝（Default）

```java
// 效果：超出阈值的请求直接拒绝
flowRule.setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_DEFAULT);
```

```
请求序列：■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
           │←──── 100 个 ────→││←───── 拒绝 ────→│
           │                   │
           阈值 100 QPS       后续请求直接被拒绝
```

#### 2. 冷启动预热（Warm Up）

```java
// 效果：启动初期逐步提升 QPS
flowRule.setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_WARM_UP);
flowRule.setWarmUpPeriodSec(10);  // 预热时间：10 秒
```

适用于：秒杀系统、数据库连接池等需要冷启动的场景。

```
QPS
  ↑
100┤━━━━━━━━━━━━━━━━━━━━
   │                  ╱
 50┤────────────╱─────
   │────────╱─────────
  0┤───────────────────→ 时间
   0   5        10 秒

  预热期间：QPS 逐步提升
  预热后：达到满负荷 100 QPS
```

#### 3. 匀速排队（Rate Limiter）

```java
// 效果：请求匀速通过，超时则拒绝
flowRule.setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_RATE_LIMITER);
flowRule.setMaxQueueingTimeMs(500);  // 最大排队时间：500ms
```

适用于：削峰填谷，不允许突发。

```
请求：■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
时间：→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→

限制：每秒 100 个
如果一秒内来了 1000 个请求：
- 前 100 个立即通过
- 剩余 900 个匀速排队
- 排队超时的被拒绝
```

### 基于注解的限流

```java
@Aspect
@Component
public class SentinelAspect {

    @Around("@annotation(SentinelResource)")
    public Object around(ProceedingJoinPoint pjp,
            SentinelResource annotation) throws Throwable {
        String resource = annotation.value();
        int grade = annotation.grade();
        int count = annotation.count();
        int controlBehavior = annotation.controlBehavior();

        Entry entry = null;
        try {
            entry = SphU.entry(resource);
            // 配置限流规则
            FlowRule rule = FlowRule.builder()
                .resource(resource)
                .grade(grade)
                .count(count)
                .controlBehavior(controlBehavior)
                .build();
            FlowRuleManager.loadRules(Collections.singletonList(rule));

            return pjp.proceed();
        } catch (BlockException e) {
            // 限流处理
            return annotation.blockHandlerClass()
                .getMethod(annotation.blockHandler(),
                    pjp.getArgs().getClass())
                .invoke(
                    annotation.blockHandlerClass().newInstance(),
                    pjp.getArgs()
                );
        } finally {
            if (entry != null) {
                entry.exit();
            }
        }
    }
}
```

```java
@Service
public class OrderService {

    @SentinelResource(value = "createOrder",
        blockHandler = "createOrderBlockHandler",
        fallback = "createOrderFallback")
    public Order createOrder(OrderRequest request) {
        // 业务逻辑
        return orderRepository.save(request.toOrder());
    }

    // 限流处理
    public Order createOrderBlockHandler(OrderRequest request,
            BlockException e) {
        log.warn("createOrder 被限流: {}", e.getClass().getSimpleName());
        return Response.fail("系统繁忙，请稍后重试");
    }

    // 降级处理
    public Order createOrderFallback(OrderRequest request,
            Throwable throwable) {
        log.error("createOrder 降级: {}", throwable.getMessage());
        return Response.fail("服务暂时不可用");
    }
}
```

## 限流规则配置

### 配置文件方式

```yaml
# application.yml
spring:
  cloud:
    sentinel:
      # 规则文件位置
      rule-file: classpath:flow-rule.json
      # 控制台地址
      console: localhost:8080
```

```json
// flow-rule.json
[
  {
    "resource": "getOrder",
    "grade": 1,
    "count": 100,
    "controlBehavior": 0,
    "strategy": 0,
    "clusterMode": false
  },
  {
    "resource": "createOrder",
    "grade": 1,
    "count": 50,
    "controlBehavior": 1,
    "warmUpPeriodSec": 10,
    "clusterMode": false
  }
]
```

### 动态规则配置

```java
@Configuration
public class SentinelConfig {

    @PostConstruct
    public void init() {
        // 初始化限流规则
        initFlowRules();
    }

    private void initFlowRules() {
        List&lt;FlowRule&gt; rules = new ArrayList&lt;&gt;();

        // 订单查询限流
        FlowRule orderRule = new FlowRule();
        orderRule.setResource("getOrder");
        orderRule.setGrade(RuleConstant.GRADE_QPS);
        orderRule.setCount(100);
        orderRule.setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_DEFAULT);
        rules.add(orderRule);

        // 订单创建限流（预热）
        FlowRule createRule = new FlowRule();
        createRule.setResource("createOrder");
        createRule.setGrade(RuleConstant.GRADE_QPS);
        createRule.setCount(50);
        createRule.setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_WARM_UP);
        createRule.setWarmUpPeriodSec(10);
        rules.add(createRule);

        FlowRuleManager.loadRules(rules);
    }
}
```

## 热点参数限流

### 使用场景

针对接口的特定参数进行限流：

```
GET /product/{id}

id = 1（热门商品）：限流 10 QPS
id = 2（普通商品）：限流 100 QPS
```

### 实现

```java
@PostMapping("/product/{id}")
@SentinelResource("getProduct")
public Product getProduct(@PathVariable Long id) {
    return productService.getById(id);
}

// 配置热点规则
List&lt;ParamFlowRule&gt; rules = new ArrayList&lt;&gt;();

ParamFlowRule rule = new ParamFlowRule("getProduct")
    .setParamIdx(0)  // 第一个参数（id）
    .setCount(10)    // 每个参数值限流 10 QPS
    .setDurationInSec(1);

ParamFlowRuleManager.loadRules(rules);
```

## Spring Cloud 集成

### 依赖

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-sentinel</artifactId>
    <version>2021.1</version>
</dependency>
```

### 配置

```yaml
spring:
  cloud:
    sentinel:
      enabled: true
      # 控制台
      dashboard: localhost:8080
      # 传输层配置
      transport:
        port: 8719
        dashboard: localhost:8080
      # 规则持久化（推模式）
      datasource:
        ds:
          file:
            file: classpath:flow-rule.json
            data-type: json
            rule-type: flow
```

### Feign 集成

```yaml
# 开启 Sentinel
feign:
  sentinel:
    enabled: true
```

```java
@FeignClient(name = "user-service", fallback = UserClientFallback.class)
public interface UserClient {

    @GetMapping("/user/{id}")
    User getUser(@PathVariable Long id);
}

@Component
public class UserClientFallback implements UserClient {

    @Override
    public User getUser(Long id) {
        // 降级返回
        return User.builder()
            .id(id)
            .name("默认用户")
            .build();
    }
}
```

## 监控与规则管理

### 控制台使用

```bash
# 启动 Sentinel 控制台
java -jar sentinel-dashboard.jar
```

访问 `http://localhost:8080`，可以：
- 查看实时监控
- 配置限流规则
- 查看异常记录
- 测试规则效果

### API 方式

```java
// 获取所有规则
List&lt;FlowRule&gt; rules = FlowRuleManager.getRules();

// 添加规则
FlowRuleManager.loadRules(Collections.singletonList(rule));

// 获取实时指标
String appName = "order-service";
long idx = 0;
while (true) {
    MetricFetcher.HandlerResult result = fetchMetric(appName, idx);
    for (Metric metric : result.getMetrics()) {
        System.out.println(metric.getResource() + ": " +
            metric.getQps());
    }
    idx = result.getPosition();
    Thread.sleep(1000);
}
```

## 最佳实践

### 1. 资源命名规范

```java
// 推荐：使用有意义的资源名
SphU.entry("order:create");
SphU.entry("order:get:" + orderId);
SphU.entry("product:query");

// 不推荐：使用模糊名
SphU.entry("method1");
SphU.entry("handle");
```

### 2. 规则配置层级

```
全局限流
    │
    ▼
API 限流
    │
    ▼
用户限流
    │
    ▼
IP 限流
```

### 3. 限流后的降级处理

```java
@SentinelResource(
    value = "createOrder",
    blockHandler = "createOrderBlockHandler",
    fallback = "createOrderFallback",
    exceptionsToIgnore = {BusinessException.class}
)
public Order createOrder(OrderRequest request) {
    return orderService.create(request);
}

// 限流处理
public Order createOrderBlockHandler(OrderRequest request,
        BlockException e) {
    // 返回友好提示或重试建议
    return Response.fail("当前请求过多，请稍后重试");
}

// 业务降级
public Order createOrderFallback(OrderRequest request,
        Throwable e) {
    // 记录日志
    // 发送告警
    return Response.fail("服务暂时不可用");
}
```

---

**思考题：**

假设你在实现一个商品查询接口，需要对商品 ID 进行限流。

问题：
1. 如果热门商品 ID=1001 每秒被查询 1000 次，普通商品每秒只被查询 10 次，你该如何设计限流策略？
2. Sentinel 的冷启动预热适合什么场景？如果你的服务需要从零开始处理洪峰流量，冷启动策略能帮助到你吗？
3. 匀速排队模式有个问题：如果用户发送请求后需要等待 500ms 才能得到响应，但你的超时设置是 200ms，会发生什么？
4. 如果让你实现一个「根据系统负载自适应限流」的功能，你会监控哪些指标？如何动态调整限流阈值？

提示：考虑 CPU 使用率、响应时间、队列长度、吞吐量等指标。
