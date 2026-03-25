# 选型困惑：RPC、HTTP、REST 到底有什么区别？

「我们用 HTTP 吧，简单。」

「不对，RPC 性能更好。」

「REST 是行业标准，用它肯定没错。」

技术选型时，这样的争论几乎每天都在上演。但争论各方往往对这三个概念的理解就不一致——有人拿苹果和橘子比，有人在讨论汽车和发动机。

**在开始争论之前，我们需要先把这些概念的定义理清楚。**

---

## 先问一个问题

你调用一个远程接口，以下哪种方式你觉得更「自然」？

**方式 A：**

```java
Order order = orderService.getOrderById(1001L);
```

**方式 B：**

```java
// 构造 HTTP 请求
HttpClient client = new HttpClient();
Response response = client.post("http://api.example.com/orders/1001");
Order order = parseJson(response.getBody(), Order.class);
```

答案不言而喻。方式 A 就像在跟同事说话，方式 B 像在填表格。

**RPC 的核心目标，就是让方式 A 成为可能。**

---

## 基本概念：三个不在同一维度的词

### 什么是 RPC？

RPC（Remote Procedure Call）是一种**通信协议**，核心目标是让远程调用像本地调用一样简单。

RPC 是一种**协议规范**，它定义了：
- 如何标识一个远程方法？（类名 + 方法名）
- 如何传递参数？（序列化）
- 如何返回结果？（反序列化 + 网络传输）

### 什么是 HTTP？

HTTP（HyperText Transfer Protocol）也是一种**通信协议**，但它是为 Web 设计的。

HTTP 定义了：
- 请求-响应模型
- 请求方法（GET、POST、PUT、DELETE...）
- 头部、状态码等规范

### 什么是 REST？

REST（Representational State Transfer）是一种**架构风格**，不是协议。它建立在 HTTP 协议之上，定义了一套设计 Web API 的约束条件。

**关键区别：RPC 和 HTTP 是协议，REST 是架构风格。这三者不在同一个维度，不能直接对比。**

---

## 真正的问题：RPC over HTTP vs REST

技术选型时，真正的对比应该是：

```
RPC 框架（如 Dubbo、gRPC）
        vs
REST API（如 Spring MVC @RestController）
```

两者的本质区别在于**如何描述接口**。

### RPC 的描述方式

```java
// 面向方法
Order order = orderService.getOrderById(1001L);
```

RPC 用「方法调用」来描述操作，接口定义更像本地方法调用。

### REST 的描述方式

```java
// 面向资源
GET /orders/1001
POST /orders
PUT /orders/1001
DELETE /orders/1001
```

REST 用「资源 + HTTP 动词」来描述操作，一切都是资源的增删改查。

---

## 深度对比：RPC vs REST

### 接口定义方式

**RPC：**

```java
// Dubbo 接口定义
public interface OrderService {
    Order getOrderById(Long id);
    List&lt;Order&gt; searchOrders(OrderQuery query);
    void cancelOrder(Long id);
}
```

**REST：**

```java
// Spring MVC 定义
@RestController
@RequestMapping("/orders")
public class OrderController {
    @GetMapping("/{id}")
    public Order getOrder(@PathVariable Long id) {}
    
    @PostMapping("/search")
    public List&lt;Order&gt; searchOrders(@RequestBody OrderQuery query) {}
    
    @DeleteMapping("/{id}")
    public void cancelOrder(@PathVariable Long id) {}
}
```

### 数据传输格式

**RPC（常用）：**

- Protobuf：二进制，体积小速度快
- Hessian：二进制，跨语言
- Kryo：二进制，仅 Java

**REST（常用）：**

- JSON：文本格式，人类可读
- XML：文本格式，较少使用

### 性能对比

| 指标 | RPC（以 gRPC 为例） | REST（JSON over HTTP） |
|-----|------------------|---------------------|
| 序列化速度 | 极快 | 较慢 |
| 传输体积 | 小（二进制） | 大（文本） |
| CPU 消耗 | 低 | 较高 |
| 调试难度 | 难（二进制不可见） | 容易（JSON 可读） |

**为什么 RPC 性能更高？**

1. 二进制序列化比 JSON 体积小，节省带宽
2. 序列化/反序列化速度更快
3. HTTP/2 支持头部压缩、连接复用
4. 避免每次请求都解析 HTTP 头部

### 跨语言支持

**RPC：**

- gRPC：天然支持多语言（Go、Python、Java...）
- Thrift：支持多语言
- Dubbo：主要 Java，但可通过 Crosslang 扩展

**REST：**

- JSON + HTTP，天生跨语言
- 任何能发 HTTP 请求的语言都能调用

**如果你的系统是多语言环境，REST 的兼容性优势很明显。**

### 调试与可观测性

**REST 的优势：**

```bash
# 直接用 curl 就能测试
curl http://api.example.com/orders/1001

# 响应是人类可读的 JSON
{
  "id": 1001,
  "customerName": "张三",
  "totalAmount": 999.00
}
```

**RPC 的劣势：**

二进制格式直接看是乱码，必须借助工具解码。

```bash
# gRPC 的请求是二进制，无法直接查看
# 需要使用 grpcurl 工具
grpcurl -d '{"id": 1001}' localhost:8080 OrderService/GetOrder
```

### 服务治理能力

| 能力 | RPC 框架 | REST |
|-----|---------|------|
| 负载均衡 | 内置（客户端/服务端） | 需要网关或 LB |
| 重试机制 | 内置 | 需自行实现 |
| 超时控制 | 内置 | 需自行实现 |
| 熔断降级 | 内置 | 需借助 Sentinel |
| 链路追踪 | 内置/插件支持 | 需自行集成 |

**RPC 框架是「全家桶」，开箱即用；REST 更轻量，但周边能力需要自己组装。**

---

## 使用场景对比

### 什么时候选 RPC？

**场景：微服务内部通信**

微服务集群内部，服务间的调用频率高、性能要求高、且通常是同一技术栈。

```java
// 订单服务调用库存服务
// 内部微服务，用 RPC 更合适
InventoryResponse response = inventoryService.checkStock(orderItems);
```

典型场景：
- 电商系统内部服务调用
- 用户中心调用风控服务
- 支付服务调用营销服务

### 什么时候选 REST？

**场景：对外开放 API、跨平台对接**

对外暴露的接口，需要兼容各种客户端（Web、移动端、第三方系统），REST 的标准化优势明显。

```java
// 开放平台 API
@RestController
@RequestMapping("/open/api")
public class OpenApiController {
    // 任何语言都能通过 HTTP 调用
    @GetMapping("/v1/products")
    public List&lt;Product&gt; getProducts() {}
}
```

典型场景：
- 开放平台
- 移动端 BFF 层
- 与第三方系统对接

---

## 不是非此即彼：混合使用

很多项目会同时使用 RPC 和 REST：

```
┌─────────────────────────────────────────────────────┐
│                    外部客户端                         │
│          (移动 App / Web 前端 / 第三方)               │
└──────────────────────┬──────────────────────────────┘
                       │ REST JSON
                       ▼
┌─────────────────────────────────────────────────────┐
│                    BFF 层                            │
│              (Spring MVC / Gateway)                 │
│          把多个微服务的数据聚合返回                    │
└──────────────────────┬──────────────────────────────┘
                       │ RPC（二进制）
                       ▼
┌─────────────────────────────────────────────────────┐
│                    微服务层                          │
│       订单服务  │  用户服务  │  库存服务              │
│         (Dubbo / gRPC 内部调用)                      │
└─────────────────────────────────────────────────────┘
```

**BFF（Backend For Frontend）** 模式：
- 对外暴露 RESTful API，兼容各种客户端
- 内部微服务间使用 RPC，追求高性能

---

## 常见误区

### 误区一：HTTP 就是 REST

HTTP 是传输协议，REST 是架构风格。用 HTTP 传输 JSON 的接口不一定是 RESTful API。

RESTful API 有严格的约束：
- 无状态
- 统一接口
- 可缓存
- 分层系统

很多声称是 REST API 的实现，实际上只是「用 HTTP 传 JSON」。

### 误区二：RPC 一定比 REST 快

**在局域网环境下**，RPC 确实更快，因为二进制序列化 + 短连接。

**但在公网环境下**，HTTP/2 + JSON 的差距没那么大，而且 REST 的可调试性优势可能更重要。

### 误区三：REST 是行业标准，RPC 是私有协议

gRPC 是 Google 主推的 RPC 框架，已捐赠给 CNCF 成为主流标准。

Dubbo 3.0 的 Triple 协议基于 HTTP/2，是兼容 HTTP 的 RPC 协议。

**两者都在互相借鉴，界限越来越模糊。**

---

## 总结

| 对比维度 | RPC | REST |
|---------|-----|------|
| 核心理念 | 像本地调用一样调用远程方法 | 资源 + HTTP 动词 |
| 性能 | 高（二进制序列化） | 中等（JSON 文本） |
| 可读性 | 低（需解码） | 高（JSON 可读） |
| 跨语言 | 看具体实现 | 天然跨语言 |
| 服务治理 | 框架内置 | 需自行实现 |
| 适用场景 | 内部微服务 | 开放平台、外部 API |

---

## 留给你的问题

如果你的项目需要同时支持：
- 内部微服务高性能调用
- 外部合作伙伴的 API 对接
- 移动端的接口

**你会如何设计架构？RPC 和 REST 分别用在哪些层？**

这个问题，可以结合 [Dubbo vs gRPC vs Thrift 对比](/middleware/rpc/compare) 来思考。
