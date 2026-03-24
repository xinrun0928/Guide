# Dubbo 链路追踪：Traces、Spans、baggage

微服务架构下，一次请求可能涉及十几个服务的调用。

当用户反馈「请求很慢」时，你该怎么办？逐个服务排查？日志里 grep？

这显然不现实。

**链路追踪**就是来解决这个问题的——它能让你看到一次请求在所有服务中的完整轨迹。

今天，我们来彻底搞清楚 Dubbo 的链路追踪机制。

## 链路追踪的核心概念

在讲 Dubbo 之前，我们需要先理解链路追踪的三个核心概念：

### 1. Trace：一次完整的请求调用链

```
Trace = 整个请求的生命周期，从开始到结束

┌─────────────────────────────────────────────────────────┐
│                     Trace (请求链路)                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  用户请求 → API Gateway → User Service → Order Service │
│       │            │              │            │        │
│       └────────────┴──────────────┴────────────┘        │
│                         ↓                               │
│                   同一个 Trace ID                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

所有属于同一次请求的调用，都共享同一个 **Trace ID**。

### 2. Span：调用中的一个步骤

```
Span = 一次 RPC 调用，或者一个本地方法调用

┌─────────────────────────────────────────────────────────┐
│                      Span 层级                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Span A (Gateway)                                       │
│    │                                                    │
│    ├── Span B (User Service)                            │
│    │       │                                            │
│    │       ├── Span C (Query User DB)                   │
│    │       │                                            │
│    │       └── Span D (Cache Lookup)                    │
│    │                                                        │
│    └── Span E (Order Service)                          │
│               │                                          │
│               └── Span F (Create Order)                 │
│                                                         │
│  Span 有父子关系，形成树形结构                           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

每个 Span 有：
- **Span ID**：唯一标识
- **Parent Span ID**：父 Span 的 ID
- **Start Time / End Time**：开始和结束时间

### 3. Baggage：携带的上下文数据

```
Baggage = 附加在请求上的键值对数据

常见用途：
- TraceId：在所有服务间传递，用于关联日志
- UserId：用户身份识别
- TenantId：多租户标识
- Custom Tags：自定义标签
```

## Dubbo 如何接入链路追踪

### Dubbo 2.7：OpenTracing 支持

Dubbo 2.7 引入了对 OpenTracing 的原生支持：

```xml
<!-- 引入依赖 -->
<dependency>
    <groupId>org.apache.dubbo</groupId>
    <artifactId>dubbo-tracing</artifactId>
    <version>2.7.23</version>
</dependency>

<!-- 使用 Zipkin -->
<dependency>
    <groupId>io.zipkin.zipkin</groupId>
    <artifactId>zipkin</artifactId>
    <version>2.23.2</version>
</dependency>

<dependency>
    <groupId>io.opentracing.contrib</groupId>
    <artifactId>opentracing-zipkin-activetrail</artifactId>
    <version>0.33</version>
</dependency>
```

### Dubbo 3.0+：原生 Dubbo Trace

Dubbo 3.0 推出了原生链路追踪——**Dubbo Trace**：

```java
// Provider 配置
@DubboService(tracing = true)
public class UserServiceImpl implements UserService { }

// Consumer 配置
@Reference(tracing = true)
private UserService userService;
```

## 链路追踪数据的传递

Dubbo 通过 **RpcContext** 的 Attachment 传递追踪数据：

```
┌─────────────────────────────────────────────────────────┐
│                 追踪数据传递流程                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Consumer 端                                            │
│  ┌─────────────────────────────────────────────────┐  │
│  │ 1. 生成 TraceId: abc123                         │  │
│  │ 2. 生成 SpanId: 1                                │  │
│  │ 3. 放入 RpcContext Attachment                   │  │
│  │    RpcContext.getContext().setAttachment(       │  │
│  │        "tracing.traceId", "abc123"              │  │
│  │    );                                            │  │
│  └─────────────────────────────────────────────────┘  │
│                         ↓                               │
│  网络传输（序列化到请求头）                              │
│                         ↓                               │
│  Provider 端                                           │
│  ┌─────────────────────────────────────────────────┐  │
│  │ 1. 从 RpcContext 读取 TraceId                   │  │
│  │ 2. 创建新的 Span（记录当前调用）                  │  │
│  │ 3. 继续传递给下游服务                             │  │
│  └─────────────────────────────────────────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 代码实现

```java
// Dubbo Trace 过滤器（简化版）
public class TracingFilter implements Filter {

    @Override
    public Result invoke(Invoker<?> invoker, Invocation invocation) {
        RpcContext context = RpcContext.getContext();
        String side = isProviderSide(context) ? "provider" : "consumer";

        // 获取或生成 TraceId
        String traceId = context.getAttachment("tracing.traceId");
        if (traceId == null) {
            traceId = UUID.randomUUID().toString();
        }

        // 获取或生成 SpanId
        String parentSpanId = context.getAttachment("tracing.spanId");
        String spanId = parentSpanId == null
            ? "1"
            : parentSpanId + ".1";

        // 设置当前 Span 的上下文
        context.setAttachment("tracing.traceId", traceId);
        context.setAttachment("tracing.spanId", spanId);

        // 创建 Span 并记录
        Span span = tracer.buildSpan(invocation.getMethodName())
            .withTag("traceId", traceId)
            .withTag("spanId", spanId)
            .withTag("service", invoker.getInterface().getName())
            .start();

        try {
            // 执行业务
            Result result = invoker.invoke(invocation);

            // 记录结果
            span.finish();

            return result;
        } catch (Exception e) {
            // 记录异常
            span.error(e);
            span.finish();
            throw e;
        }
    }
}
```

## Dubbo + SkyWalking 集成

SkyWalking 是最流行的链路追踪工具之一，它和 Dubbo 的集成非常简单。

### 安装 SkyWalking Agent

```bash
# 下载 Agent
wget https://archive.apache.org/dist/skywalking/9.5.0/apache-skywalking-apm-9.5.0.tar.gz
tar -xzf apache-skywalking-apm-9.5.0.tar.gz
```

### 启动时加载 Agent

```bash
java -javaagent:/path/to/skywalking-agent.jar \
     -Dskywalking.agent.service_name=dubbo-provider \
     -Dskywalking.collector.backend_service=127.0.0.1:11800 \
     -jar dubbo-provider.jar
```

### 自动拦截 Dubbo 调用

SkyWalking Agent 会自动拦截 Dubbo 的：

- `@DubboService` 注解的服务
- `@Reference` 注解的引用
- Filter 链

生成的 Trace 视图：

```
┌─────────────────────────────────────────────────────────────┐
│                   SkyWalking Trace 视图                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  dubbo-provider:20880                                      │
│  ├─ UserService.findById() [15ms]                          │
│  │   ├─ MySQL: SELECT * FROM user [8ms]                   │
│  │   └─ Cache.get("user:1") [2ms]                         │
│  │                                                          │
│  └─ OrderService.create() [32ms]                           │
│      ├─ OrderDao.insert() [12ms]                          │
│      └─ InventoryService.decrease() [18ms]                 │
│          └─ Redis.decr() [1ms]                            │
│                                                             │
│  Trace ID: 7c1b2a3d4e5f...                                  │
│  Duration: 47ms                                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 常见链路追踪工具对比

| 工具 | 特点 | 适用场景 |
|-----|------|---------|
| SkyWalking | 功能全面，APM 能力强，Java 生态友好 | 生产环境，中大规模 |
| Zipkin | 轻量级，集成简单 | 快速上手，小规模 |
| Jaeger | CNCF 项目，跨语言 | 多语言微服务 |
| Pinpoint | 无代码侵入，UI 精美 | Korean 社区，稳定性优先 |

## 链路追踪的价值

### 1. 快速定位问题

```
没有链路追踪：
"请求很慢"
→ 逐个服务排查
→ 日志 grep
→ 2小时后找到问题

有链路追踪：
"请求很慢"
→ 查看 Trace 瀑布图
→ 发现某个 Span 耗时异常
→ 直接定位到慢查询
→ 10分钟解决问题
```

### 2. 分析性能瓶颈

```
┌─────────────────────────────────────────────────────────────┐
│                    Trace 瀑布图                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  API Gateway      ████████████████████ 120ms                │
│       │                                                    │
│       ├── User Svc  ████████████████  95ms                 │
│       │             ├── Redis     ████  8ms                │
│       │             ├── MySQL      ████████████████  85ms  │
│       │             └── Kafka       ██  2ms                 │
│       │                                                    │
│       └── Order Svc  ████████████████████████  110ms       │
│                      ├── Cache     ████████  15ms           │
│                      └── DB        ████████████████  93ms  │
│                                                             │
│  分析结论：MySQL 查询慢，应该加索引或优化 SQL               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3. 服务依赖关系

链路追踪数据可以自动绘制出服务依赖图：

```
┌─────────────────────────────────────────────────────────────┐
│                    服务依赖图                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                  ┌─────────┐                               │
│                  │  Gateway │                               │
│                  └────┬────┘                               │
│                       │                                    │
│            ┌─────────┼─────────┐                         │
│            ↓         ↓         ↓                          │
│       ┌────────┐ ┌────────┐ ┌────────┐                     │
│       │  User  │ │ Order  │ │ Product│                    │
│       │ Service│ │ Service│ │ Service │                   │
│       └───┬────┘ └───┬────┘ └───┬────┘                   │
│           │          │          │                          │
│       ┌───┴───┐  ┌───┴───┐  ┌───┴───┐                     │
│       │  MySQL │  │  Redis │  │  ES   │                   │
│       └────────┘  └────────┘  └────────┘                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 面试追问方向

- TraceId 是怎么生成的？为什么要用 UUID？
- 如果 Provider 调用 Provider（嵌套调用），SpanId 是怎么管理的？
- 链路追踪数据量很大，怎么避免影响性能？（答：采样、异步上报）
- Baggage 和 Tag有什么区别？什么数据适合放在 Baggage 里？

## 总结

链路追踪是微服务架构的「眼睛」，它让你能够：

```
看不到追踪时：
请求 → 服务 A → 服务 B → 服务 C → 服务 D → 失败
          ↓
      不知道哪个环节出问题

看到追踪后：
Trace: abc123
  ├─ A: 5ms ✓
  ├─ B: 8ms ✓
  ├─ C: 3000ms ✗ (慢查询，没有索引)
  └─ D: 未执行 (因为 C 超时了)
```

Dubbo 通过 RpcContext 的 Attachment 传递追踪数据，结合 SkyWalking、Zipkin 等工具，可以实现完整的全链路追踪。

在生产环境中，链路追踪是排查问题的利器——它能让你在海量日志中快速定位问题。
