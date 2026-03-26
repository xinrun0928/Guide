# SkyWalking：让微服务调用「看得见」

你的微服务架构有 10 个服务，一次用户请求经过 API 网关 → 认证服务 → 订单服务 → 库存服务 → 支付服务 → 物流服务 → 短信服务。

现在用户投诉：下单很慢。

问题出在哪？API 网关？订单服务？库存服务？还是支付服务？每个服务都有日志，每个服务看起来都正常——但整个链路就是慢。

你需要一个工具，能把这次请求的**完整路径**画出来，告诉你每个环节花了多少毫秒。

这就是 SkyWalking 做的事：**分布式链路追踪**。

## 为什么需要链路追踪？

### 日志的局限

传统日志是这样的：

```
[order-service] 2024-01-01 10:00:00 - 收到下单请求
[inventory-service] 2024-01-01 10:00:00 - 扣减库存
[payment-service] 2024-01-01 10:00:01 - 发起支付
```

日志是分散的，每个服务一份。你要追踪一次请求，需要做三件事：

1. 登录 6 台服务器
2. 按时间排序过滤日志
3. 手动拼接调用链

如果有 100 个服务呢？每次排查问题都要这么折腾吗？

### 链路追踪的思路

链路追踪的核心思想很简单：**给每次请求一个唯一 ID（traceId），所有服务都用这个 ID 打印日志**。

```
traceId: abc123
├── [API Gateway]     收到请求，traceId=abc123      0ms
│   └── [Auth]        验证 token                    5ms
│       └── [Order]   创建订单                      10ms
│           ├── [Inventory] 扣减库存               15ms
│           ├── [Payment]   发起支付              100ms
│           └── [Logistics] 通知发货              20ms
```

这样一图胜千言：Payment 占了 100ms，是罪魁祸首。

## SkyWalking 核心架构

```
┌──────────────────────────────────────────────────────────────────┐
│                        SkyWalking 架构                             │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│   服务实例                                                        │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐                      │
│   │ Service A │  │ Service B │  │ Service C │                      │
│   │ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │                      │
│   │ │ Agent │ │  │ │ Agent │ │  │ │ Agent │ │                      │
│   │ └──────┘ │  │ └──────┘ │  │ └──────┘ │                      │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘                      │
│        │              │              │                            │
│        └──────────────┼──────────────┘                            │
│                       ▼                                            │
│              ┌─────────────────┐                                   │
│              │     OAP 集群     │  ← Observability Analysis Platform │
│              │  (分析平台)       │    接收、存储、分析链路数据       │
│              └────────┬────────┘                                   │
│                       ▼                                            │
│              ┌─────────────────┐                                   │
│              │    SkyWalking   │  ← Web UI                        │
│              │       UI        │    可视化展示                     │
│              └─────────────────┘                                   │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

**三剑客各司其职：**

- **Agent**：Java Agent 无侵入式埋点，挂在 JVM 上自动采集数据
- **OAP**：链路数据的接收端、分析引擎、存储层（支持 ES、H2、MySQL）
- **UI**：前端展示，拓扑图、链路详情、火焰图

## 核心概念：Trace、Span、Segment

理解 SkyWalking，先理解三个核心概念：

### 1. Trace：一次请求的完整路径

```java
// 一次 HTTP 请求，对应一个 Trace
// Trace ID 是全局唯一 ID，贯穿整个调用链
public class TraceExample {
    @GetMapping("/order/{id}")
    public Order getOrder(@PathVariable Long id) {
        // 这次请求有一个唯一的 traceId
        // 所有子调用都共享这个 traceId
        return orderService.findById(id);
    }
}
```

### 2. Span：一次调用的最小单元

```
Trace: [全局唯一的 traceId]
│
├── Span 1: [API Gateway] 收到请求
│   │
│   ├── Span 2: [Order Service] 处理业务
│   │   │
│   │   ├── Span 3: [Inventory Service] 扣减库存
│   │   │   Duration: 15ms
│   │   │
│   │   └── Span 4: [Payment Service] 发起支付
│   │       Duration: 100ms  ← 这里是瓶颈
│   │
│   └── Span 5: [Logistics Service] 通知发货
│       Duration: 20ms
```

**每个 Span 包含：**

- `spanId`：当前调用层级（0 是根，1 是子调用，1.1 是子调用的子调用）
- `parentSpanId`：父调用 ID
- `operationName`：操作名称，如 `GET /order/{id}`
- `startTime / endTime`：耗时计算
- `tags`：关键信息，如 URL、状态码

### 3. Segment：一个服务的所有 Span

```java
// Segment = 单个 JVM 进程内的所有 Span 集合
// 为什么需要 Segment？
// 因为一个微服务可能有多个线程处理同一个请求
// 每个线程产生的 Span 属于同一个 Segment

// 比如 Spring MVC 的 Controller 和 Repository 在同一 JVM
// 它们产生的 Span 都在同一个 Segment 里
@RestController
public class OrderController {
    @GetMapping("/order/{id}")
    public Order getOrder(@PathVariable Long id) {
        // Span 1: Controller 层
        return orderService.findById(id);
    }
}

@Service
public class OrderServiceImpl {
    @Autowired
    private OrderRepository repository;

    public Order findById(Long id) {
        // Span 2: Service 层
        // Span 3: Repository 层
        // Span 1, 2, 3 都在同一个 Segment 里
        return repository.findById(id).orElse(null);
    }
}
```

## Agent 工作原理：无侵入式埋点

SkyWalking Agent 基于 Java Agent 技术，不需要改一行业务代码。

```java
// SkyWalking Agent 启动方式
// java -javaagent:skywalking-agent.jar -Dskywalking.agent.service_name=order-service
// -Dskywalking.collector.backend_service=oap:11800

// Agent 做了三件事：
// 1. 字节码增强：在方法入口/出口自动插入统计代码
// 2. 上下文传播：通过 HTTP Header 传递 traceId
// 3. 数据上报：将链路数据发送到 OAP

// 关键机制：为什么不用改代码？
// 答案：字节码增强（ByteBuddy/ASM）
// Agent 在类加载时修改字节码，在方法开始和结束时自动埋点
```

**SkyWalking 会自动拦截这些框架：**

| 框架 | 拦截点 |
|-----|-------|
| Tomcat/Jetty | HTTP 请求入口 |
| Dubbo/REST | RPC 调用 |
| MySQL/Redis | 数据库操作 |
| HttpClient/OkHttp | HTTP 客户端 |
| Spring MVC | Controller 方法 |

## SkyWalking vs Zipkin vs Jaeger

| 维度 | SkyWalking | Zipkin | Jaeger |
|-----|-----------|--------|--------|
| **埋点方式** | Agent 无侵入 | 手动埋点或 Brave | 手动埋点 |
| **字节码增强** | ✅ 支持 | ❌ 不支持 | ❌ 不支持 |
| **UI 友好度** | 优秀 | 一般 | 较好 |
| **语言支持** | Java/Go/Node.js | 多语言 | 多语言 |
| **存储** | ES/MySQL/H2 | ES/Cassandra/Zipkin 内置 | ES/Cassandra |
| **性能分析** | 主动分析，慢 SQL 检测 | 无 | 无 |
| **社区活跃度** | Apache 顶级项目，活跃 | 较活跃 | CNCF 项目，活跃 |
| **学习成本** | 低，上手快 | 中 | 中 |

**选型建议：**

- **Java 技术栈、追求免运维** → SkyWalking（自动分析能力强）
- **多语言混合、需要轻量** → Jaeger（CNCF 生态兼容好）
- **老项目、需要快速集成** → Zipkin（依赖简单）

## 核心功能展示

### 1. 服务拓扑图

SkyWalking 自动根据调用关系画出拓扑图：

```
        ┌─────────┐
        │  用户端  │
        └────┬────┘
             │ 5000 rps
             ▼
     ┌───────────────┐
     │   API Gateway │  ← 入口流量
     └───────┬───────┘
             │
     ┌───────┴───────┐
     ▼               ▼
┌─────────┐    ┌─────────┐
│  Order  │───▶│Inventory│
│ Service │    │ Service │
└────┬────┘    └─────────┘
     │
┌────┴────┐
▼         ▼
┌────┐  ┌────┐
│ DB │  │Redis│
└────┘  └────┘
```

图中能直观看到：**哪个服务调用量最大，哪个服务是热点**。

### 2. 链路详情

点击拓扑图中的某个调用，能看到详细链路：

```
Trace ID: 7f9e.123456.001

┌─────────────────────────────────────────────────────────────────┐
│  总耗时 125ms                                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ████████████████████████████████████████████ 125ms  [API GW]   │
│  ██████████████████████████ 100ms [Order Service]              │
│  ████ 15ms [MySQL Query]                                        │
│  ████ 15ms [Redis Cache]                                        │
│  ██████ 30ms [Inventory Service]                                │
│  ████████████████████████████████ 80ms [Payment Service]       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Payment Service 占 80ms，这里是瓶颈**——下一步就是优化这个服务。

### 3. 慢 SQL 检测

SkyWalking 的主动分析能力，能自动识别慢 SQL：

```sql
-- SkyWalking 检测到的慢 SQL
SELECT * FROM orders WHERE user_id = ? AND status = 'pending'

平均执行时间: 1234ms  ← 超过阈值
调用次数: 5000/min
建议: 为 user_id + status 建立联合索引
```

### 4. 告警配置

```yaml
# skywalking-alarm.yml
rules:
  # 服务响应时间告警
  service_resp_time_rule:
    metrics-name: service_resp_time
    threshold: 1000  # 超过 1 秒
    op: ">"
    period: 10       # 10 分钟内
    count: 3         # 触发 3 次告警
    message: "服务 {{serviceName}} 响应时间超过 1 秒"

  # 服务成功率告警
  service_success_rate_rule:
    metrics-name: service_success_rate
    threshold: 0.95  # 成功率低于 95%
    op: "<"
    period: 5
    count: 2
    message: "服务 {{serviceName}} 成功率低于 95%"
```

## 面试高频问题

**Q: SkyWalking 如何实现跨服务的 traceId 传递？**

A: 通过 HTTP Header 或 RPC 框架的扩展点传递。SkyWalking 定义了 `sw8` 扩展头，包含 traceId、spanId 等信息。服务 A 调用服务 B 时，A 会把 sw8 头传给 B，B 解析后继续使用同一个 traceId。

**Q: 为什么 Segment 概念是必要的？**

A: 因为一个请求可能由多个线程处理（异步场景），或者一个微服务内有多个组件（Controller、Service、Repository）。同一个 JVM 内的所有 Span 归为 Segment，方便关联和展示。

**Q: SkyWalking 的性能开销有多大？**

A: 官方数据：CPU 增加 < 5%，内存增加 < 50MB。Agent 使用异步队列批量上报，对业务影响极小。

**Q: 链路追踪和日志有什么关系？**

A: 链路追踪回答「哪个服务慢」，日志回答「为什么慢」。最佳实践：在链路详情中点击某个 Span，能跳转到该服务的日志（通过 traceId 关联）。

## 写在最后

链路追踪解决的不是「日志怎么查」的问题，而是「怎么快速定位问题在哪」的问题。

以前你花 1 小时排查，现在花 5 分钟看拓扑图——**这不是效率提升，这是工作方式的改变**。

但链路追踪只能告诉你「慢在哪」，不能告诉你「配置错了怎么办」——比如你要改一个功能的开关，要改数据库连接池大小，要改 JVM 参数，该怎么办？

下一节，我们来聊聊 [Apollo 配置中心](/middleware/apollo) —— 它能让你**改配置不用重启，改完秒级生效**。
