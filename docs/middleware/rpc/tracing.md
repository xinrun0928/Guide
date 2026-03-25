# 链路追踪：如何定位分布式系统的问题？

凌晨 3 点，监控系统报警：「订单服务接口响应时间 P99 超过 5 秒」。

你登录后台查看：调用链路涉及 5 个微服务、20+ 个数据库操作、10+ 个 Redis 调用。

**问题到底出在哪？**

靠人肉翻日志已经不可能了，你需要链路追踪。

---

## 从一个用户请求说起

```
用户点击「提交订单」
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│                        网关层                                      │
│  请求进入，开始计时                                                │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│                        订单服务                                    │
│  ├─ 验证用户参数（5ms）                                            │
│  ├─ 查询用户信息（20ms）                                           │
│  ├─ 查询商品库存（Redis）（30ms）──┐                                │
│  ├─ 查询商品价格（Redis）（25ms）──┼─ 可否并行？                   │
│  └─ 扣减库存（Redis）（40ms）────┘                                │
│                                                                 │
│  调用用户服务                                                      │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                        用户服务                             │   │
│  │  ├─ 验证用户状态（15ms）                                   │   │
│  │  └─ 查询用户积分（20ms）                                   │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  调用库存服务                                                      │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                        库存服务                             │   │
│  │  ├─ 扣减库存（DB）（100ms）                                │   │
│  │  └─ 记录库存流水（50ms）                                   │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  调用支付服务                                                      │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │                        支付服务                             │   │
│  │  ├─ 第三方支付扣款（1000ms）← 可能是慢的源头！              │   │
│  │  └─ 记录支付流水（20ms）                                   │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  创建订单（DB）（80ms）                                            │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
    返回结果
```

**如果没有链路追踪：**
- 只能看到「订单服务响应慢」
- 不知道是哪个下游服务慢
- 不知道慢在哪个环节

**有了链路追踪：**
- 可以看到完整的调用链
- 可以定位到「支付服务调用第三方接口耗时 1000ms」
- 可以关联分析：为什么第三方接口突然变慢？

---

## 链路追踪的核心概念

### Trace（追踪）

一个用户请求从开始到结束的全部过程，形成一个 Trace。

```
Trace = 用户请求 → 网关 → 服务A → 服务B → 服务C → 返回
```

### Span（跨度）

调用链中的每一个节点称为一个 Span。

```
Trace
  ├─ Span: 网关
  │    ├─ Span: 订单服务
  │    │    ├─ Span: 验证参数
  │    │    ├─ Span: 查询用户
  │    │    │    └─ Span: 用户服务
  │    │    ├─ Span: 查询库存
  │    │    │    └─ Span: 库存服务
  │    │    └─ Span: 扣减库存
  │    │         └─ Span: 库存服务
  │    └─ Span: 创建订单
```

### Span 的生命周期

```
     ┌─────────────────────────────────┐
     │           Span                 │
     │                                 │
spanId=1      spanId=2      spanId=3   │
     │           │            │        │
     ├───────────┼────────────┤        │
     │           │            │        │
     ▼           ▼            ▼        │
   开始       记录事件      结束        │
                             │        │
                             ▼        │
                         记录耗时
```

每个 Span 记录：
- `traceId`：追踪 ID，整个链路的唯一标识
- `spanId`：跨度 ID，当前调用的唯一标识
- `parentId`：父跨度 ID，用于构建调用树
- `startTime`：开始时间
- `duration`：耗时
- `tags`：标签（HTTP URL、DB 语句等）
- `logs`：事件日志

---

## OpenTracing：标准化的链路追踪

### OpenTracing 是什么？

OpenTracing 是一个 vendor-neutral 的链路追踪标准，定义了统一的数据模型和 API。

```
┌─────────────────────────────────────────────────────┐
│                   业务代码                          │
│     tracer.trace("operation", span => {             │
│         // 业务逻辑                                  │
│     });                                            │
└─────────────────────────────────────────────────────┘
                      │
                      │ OpenTracing API
                      ▼
┌─────────────────────────────────────────────────────┐
│                   Tracer 实现                       │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐             │
│  │ Jaeger  │  │Zipkin  │  │ SkyWalking │           │
│  └─────────┘  └─────────┘  └─────────┘             │
└─────────────────────────────────────────────────────┘
```

### OpenTracing Java API

```java
// 引入依赖
// &lt;dependency&gt;
//     &lt;groupId&gt;io.opentracing&lt;/groupId&gt;
//     &lt;artifactId&gt;opentracing-api&lt;/artifactId&gt;
// &lt;/dependency&gt;

// 创建 Tracer
Tracer tracer = new JaegerTracer.Builder("order-service")
    .withSampler(new ConstSampler(true))
    .build();

// 开始一个 Span
Span span = tracer.buildSpan("createOrder").start();

// 添加标签
span.setTag("userId", userId);
span.setTag("orderAmount", amount);

// 记录事件
span.log("验证用户通过");

// 在子调用中传递 context
try (Scope scope = tracer.scopeManager().activate(span)) {
    // 调用下游服务
    userService.getUser(userId);
} finally {
    span.finish();
}
```

### Dubbo 集成 OpenTracing

Dubbo 原生支持链路追踪，只需要添加依赖并配置：

```xml
<!-- Dubbo + OpenTracing -->
<dependency>
    <groupId>org.apache.dubbo</groupId>
    <artifactId>dubbo-spring-boot-tracing</artifactId>
</dependency>

<!-- Jaeger 实现 -->
<dependency>
    <groupId>io.jaegertracing</groupId>
    <artifactId>jaeger-client</artifactId>
</dependency>
```

```yaml
dubbo:
  tracing:
    enabled: true
    tracer: jaeger

jaeger:
  service-name: order-service
  agent-host: localhost
  agent-port: 6831
  sampler:
    type: const
    param: true
```

启用后，Dubbo 会自动：
- 在 RPC 调用时传播 TraceContext
- 在服务提供方创建子 Span
- 记录 RPC 调用信息（服务名、方法名、参数等）

---

## SkyWalking：国产链路追踪利器

### SkyWalking 是什么？

SkyWalking 是 Apache 顶级项目，专门为分布式系统设计的应用性能监控（APM）工具。

**优势：**
- 对 Java 生态支持非常好
- 自动埋点，无需修改业务代码
- 支持微服务、数据库、缓存、MQ 等多种组件
- 提供 UI 分析界面

### SkyWalking 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                    SkyWalking 架构                          │
│                                                             │
│  ┌─────────────┐                                            │
│  │  OAP Server │  ← 收集器，接收 agent 数据                  │
│  │             │                                            │
│  │  - 接收     │                                            │
│  │  - 存储     │                                            │
│  │  - 查询     │                                            │
│  └──────┬──────┘                                            │
│         │                                                   │
│    ┌────┴────┐                                               │
│    │  Storage│  Elasticsearch / MySQL / H2                │
│    └─────────┘                                               │
│                                                              │
│  ┌─────────────┐                                            │
│  │    UI       │  ← 可视化界面                               │
│  │  - 链路图   │                                            │
│  │  - 拓扑图   │                                            │
│  │  - 告警     │                                            │
│  └─────────────┘                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    被监控的应用                              │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  Java Agent                         │   │
│  │                                                     │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐              │   │
│  │  │ Tomcat  │  │ Dubbo   │  │ MySQL   │              │   │
│  │  │ Plugin  │  │ Plugin  │  │ Plugin  │              │   │
│  │  └─────────┘  └─────────┘  └─────────┘              │   │
│  │                                                     │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐              │   │
│  │  │ Redis   │  │ Kafka   │  │ Spring  │              │   │
│  │  │ Plugin  │  │ Plugin  │  │ Plugin  │              │   │
│  │  └─────────┘  └─────────┘  └─────────┘              │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### SkyWalking Java Agent 配置

```bash
# 下载 agent
# https://skywalking.apache.org/downloads/

# 启动应用时添加 agent
java -javaagent:/path/to/skywalking-agent.jar \
     -Dskywalking.agent.service_name=order-service \
     -Dskywalking.collector.backend_service=localhost:11800 \
     -jar order-service.jar
```

### SkyWalking 自动埋点

SkyWalking 通过 Java Agent 技术，在运行时修改字节码，实现无侵入埋点：

```
┌─────────────────────────────────────────────────────────────┐
│                  字节码增强原理                               │
│                                                             │
│  原代码：                                                    │
│  public Order createOrder(OrderRequest request) {          │
│      // 业务逻辑                                            │
│      return order;                                         │
│  }                                                         │
│                                                             │
│  增强后：                                                   │
│  public Order createOrder(OrderRequest request) {          │
│      Span span = tracer.createSpan("createOrder");         │
│      try {                                                 │
│          // 业务逻辑                                        │
│          return order;                                     │
│      } finally {                                           │
│          span.end();                                       │
│      }                                                     │
│  }                                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 链路追踪实战

### 场景：定位「订单创建慢」的问题

**步骤一：查看整体链路**

```
SkyWalking UI 显示：
order-service /createOrder (5000ms) ← 超时！
  ├─ validate (5ms) ✓
  ├─ queryUser (20ms) ✓
  ├─ queryInventory (30ms) ✓
  ├─ callUserService (2000ms) ← 慢！
  │    └─ user-service /getUser (1990ms)
  │         └─ DB query (1980ms) ← 找到了！SQL 全表扫描
  ├─ callInventoryService (100ms) ✓
  └─ saveOrder (80ms) ✓
```

**步骤二：分析 SQL 问题**

```sql
-- 发现的慢 SQL
SELECT * FROM user WHERE id = ?

-- 问题：没有使用索引
-- 解决：添加索引
ALTER TABLE user ADD INDEX idx_id (id);
```

**步骤三：验证修复**

```sql
-- 修复后查询
EXPLAIN SELECT * FROM user WHERE id = 12345;
-- 使用了 idx_id 索引
```

---

## TraceContext 传播

### 如何把 Trace 从一个服务传到另一个服务？

在 RPC 调用时，需要把 TraceContext 传递给下游：

```java
// Dubbo 中的 TraceContext 传播
public class DubboTraceFilter implements Filter {
    
    @Override
    public Result invoke(Invoker&lt;?&gt; invoker, Invocation invocation) {
        // 1. 尝试从当前上下文获取 TraceContext
        TraceContext traceContext = TraceContext.current();
        
        // 2. 如果没有，创建一个新的 Root Span
        if (traceContext == null) {
            traceContext = TraceContext.newTrace();
        }
        
        // 3. 把 TraceContext 信息放入 RpcContext
        RpcContext.getContext().setAttachment(
            "sw6_traceid", traceContext.getTraceId()
        );
        RpcContext.getContext().setAttachment(
            "sw6_spanid", traceContext.getSpanId()
        );
        
        // 4. 调用下游
        try (Scope scope = tracer.scopeManager().activate(traceContext)) {
            return invoker.invoke(invocation);
        }
    }
}
```

### HTTP header 传播

HTTP 调用时，通过 header 传递 TraceContext：

```
┌────────────────────────────────────────────────────────────┐
│                    HTTP Header                            │
│                                                             │
│  Headers:                                                   │
│    sw6-traceid: 1.2.3.4.5.6                                │
│    sw6-spanid: 7                                           │
│    sw6-parentspanid: 6                                     │
│    sw6-sampled: 1                                           │
│    sw6-priority: 1                                         │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

---

## 采样策略

### 全量采样的问题

高流量系统无法承受全量采样：

```
10000 QPS × 60 秒 = 600000 条 Trace/分钟
```

### 采样策略

| 策略 | 说明 | 适用场景 |
|-----|-----|---------|
| 全量 | 100% 采集 | 测试环境、低流量系统 |
| 固定比例 | 按百分比采样（如 10%） | 大部分生产环境 |
| 动态采样 | 基于流量动态调整 | 高流量系统 |
| 尾部采样 | 只采集慢请求/错误请求 | 问题排查 |

```java
// 尾部采样配置（SkyWalking）
agent:
  sampler:
    # 正常请求采样率
    ratio: 0.1  # 10%
    # 慢请求强制采样
    slow-threshold: 1000  # 超过 1 秒的请求，100% 采样
    # 错误请求强制采样
    error-threshold: 1     # 有错误的请求，100% 采样
```

---

## 总结

| 概念 | 说明 |
|-----|-----|
| **Trace** | 一次请求的完整调用链 |
| **Span** | 调用链中的一个节点 |
| **TraceContext** | Trace 的上下文信息，用于传播 |
| **采样** | 高流量下只采集部分请求 |

**链路追踪是分布式系统的「眼睛」，没有它，排查问题就像大海捞针。**

---

## 留给你的问题

假设你正在排查一个线上问题：

1. 用户反馈下单接口有时很慢（3-5 秒）
2. 但链路追踪显示所有服务的 Span 都是正常的（< 100ms）
3. 数据库慢日志也没有异常

**问题可能出在哪里？如果链路追踪看不到问题，你会从哪些方面继续排查？**

这个问题，可以结合 [Dubbo SPI 机制](/middleware/rpc/dubbo-spi) 来思考如何扩展 Dubbo 的监控能力。
