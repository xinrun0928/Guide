# RPC 框架

服务 A 要调用服务 B，跨了 3 台机器。

你写代码时，只写了一行：`orderService.getOrderById(12345);`

但这行代码背后，发生了什么？

**网络连接、序列化、路由、负载均衡、超时重试、链路追踪**——所有这些，都被 RPC 框架封装好了。你感觉在调用本地方法，其实背后是一场「跨服通信」。

这就是 RPC 的魅力：**让分布式调用像本地调用一样简单。**

---

## 什么是 RPC？

RPC（Remote Procedure Call，远程过程调用）是一种通信协议，允许程序像调用本地方法一样调用另一台机器上的方法。

想象一个场景：

```java
// 本地调用 —— 方法在同一个 JVM
Order order = orderRepository.findById(12345);
```

```java
// 远程调用 —— 方法在另一台服务器的 JVM
// 语法完全一样，但背后发生的事完全不同
Order order = orderService.getOrderById(12345);
```

区别在哪里？

| 维度 | 本地调用 | RPC 调用 |
|-----|--------|---------|
| 调用路径 | JVM 内存直接访问 | 网络请求 + 响应 |
| 参数传递 | 直接传引用 | 序列化后网络传输 |
| 返回结果 | 直接返回 | 反序列化后返回 |
| 失败处理 | 抛异常 | 超时、重试、熔断 |
| 性能瓶颈 | CPU/内存 | 网络延迟 |

RPC 框架的核心工作，就是**把这层复杂性屏蔽掉**，让开发者只关心业务逻辑。

---

## RPC vs HTTP

很多人分不清 RPC 和 HTTP 的区别。简单说：**HTTP 是一种协议，RPC 是一种调用方式。HTTP 可以是 RPC 的一种实现方式，但 RPC 不等于 HTTP。**

| 特性 | RPC | HTTP |
|-----|-----|-----|
| 传输协议 | TCP（通常）/ HTTP/2 | HTTP/1.1 / HTTP/2 |
| 序列化 | Protobuf、Java、Kryo | JSON、XML |
| 性能 | 高（自定义序列化） | 中等（JSON 解析开销） |
| 语言耦合 | 通常有 IDL 定义 | 跨语言、无 IDL |
| 使用场景 | 微服务内部调用 | 微服务外部接口、浏览器调用 |

**什么时候用哪个？**

- 微服务内部，高并发、低延迟 → RPC（Dubbo、gRPC）
- 微服务外部，需要跨语言、跨平台 → HTTP（RESTful API）
- 移动端、Web 端访问后端 → 必须用 HTTP

---

## 核心知识点

### 基础原理

RPC 调用的大致流程：

```java
// 你写的代码 —— 看起来像本地调用
Order order = orderService.getOrderById(12345);

// 框架帮你做的 —— 其实是这样的：
// 1. 序列化参数：orderService.getOrderById(12345) → 字节流
// 2. 网络传输：把字节流发到目标服务器
// 3. 服务端处理：反序列化、执行方法、序列化结果
// 4. 网络传输：把结果字节流传回
// 5. 客户端处理：反序列化，得到 Order 对象
```

深入理解：[RPC 原理](/middleware/rpc/principle)

### 序列化协议

为什么 Protobuf 比 JSON 快？

- JSON 需要解析字符串，解析时还要处理引号、括号、编码
- Protobuf 是二进制格式，直接按字段编号读取，CPU 友好的同时空间也更紧凑

```java
// JSON 序列化：解析字符串
{"id": 12345, "name": "MacBook Pro", "price": 9999.00}
// 长度：约 60 字节

// Protobuf 编码：二进制流
// 08 96 19 12 0C 4D 61 63 42 6F 6F 6B 20 50 72 6F 15 00 00 C2 42
// 长度：约 23 字节
```

深入理解：[序列化协议](/middleware/rpc/serialization) | [Protobuf](/middleware/rpc/protobuf)

### 主流框架对比

| 框架 | 出品方 | 特点 | 适用场景 |
|-----|-------|------|---------|
| [Dubbo](/middleware/rpc/compare) | 阿里巴巴 | SPI 扩展、治理能力完善、国内生态好 | Java 微服务、中大型项目 |
| [gRPC](/middleware/rpc/grpc-stream) | Google | HTTP/2、Procol Buffers、双向流 | 跨语言、高性能、云原生 |
| Thrift | Facebook | IDL 定义、跨语言、多协议 | 多语言异构系统 |

### 服务治理

微服务调用不只是「发请求-收响应」这么简单，还需要考虑：

- **负载均衡**：10 个服务实例，请求发给谁？
- **超时重试**：网络抖动时，要不要重试？重试几次？
- **链路追踪**：请求经过 10 个服务，哪个环节慢了？
- **故障熔断**：下游服务挂了，要不要快速失败？

深入理解：[负载均衡](/middleware/rpc/loadbalance) | [超时重试](/middleware/rpc/timeout-retry) | [链路追踪](/middleware/rpc/tracing)

### Dubbo 高级特性

Dubbo 之所以在国内微服务场景占据主导地位，很大原因是它的 SPI 机制和丰富的治理功能：

```java
// Dubbo 的 SPI 机制：比 JDK SPI 更强大
// 你可以按需加载实现类，可以获取同一个接口的多个实现
Protocol protocol = ExtensionLoader.getExtensionLoader(Protocol.class)
    .getAdaptiveExtension();

// 这个机制让 Dubbo 的每个组件都可以替换
// 序列化可以换、负载均衡策略可以换、注册中心可以换
```

深入理解：[Dubbo SPI](/middleware/rpc/dubbo-spi)

### gRPC 进阶

gRPC 的流式调用是其一大特色：

- **服务端流**：客户端发一次请求，服务端可以返回一系列响应
- **客户端流**：客户端发送一系列请求，服务端返回一次响应
- **双向流**：双方都可以自由地发送消息

```java
// gRPC 双向流示例
public interface OrderStreamService {
    // 客户端流式上传订单，服务器返回处理结果
    StreamObserver&lt;OrderUpload&gt; uploadOrders(StreamObserver&lt;UploadResult&gt; response);
}
```

深入理解：[gRPC 流式调用](/middleware/rpc/grpc-stream)

---

## 面试高频问题

**Q：RPC 和 HTTP 的区别是什么？**

表面区别是 RPC 通常基于 TCP，HTTP 基于 HTTP 协议。但更核心的区别是：**RPC 强调的是「像调用本地方法一样调用远程方法」，HTTP 强调的是「遵守 HTTP 协议的 RESTful 风格」。** RPC 可以用 HTTP 作为传输层（比如 gRPC），HTTP 也可以包装成 RPC 风格。

**Q：为什么 Protobuf 比 JSON 快？**

1. 二进制格式 vs 文本格式，空间更紧凑
2. 不需要解析字段名，直接按字段编号读取
3. 数据类型固定，不需要运行时类型推断

**Q：Dubbo 的负载均衡策略有哪些？**

- Random LoadBalance：随机，是默认策略
- RoundRobin LoadBalance：轮询，不推荐（无法感知服务权重）
- LeastActive LoadBalance：优先分配给活跃度低的服务
- ConsistentHash LoadBalance：一致性哈希，同一请求始终打到同一节点

**Q：服务调用超时了怎么办？**

分两种情况：
- **幂等操作**：可以安全重试，比如查询、删除
- **非幂等操作**：不能重试，比如下单、支付，否则会重复下单

**Q：RPC 框架怎么实现链路追踪？**

核心是通过 traceId 把整个调用链串起来。每个请求生成一个全局唯一的 traceId，这个 ID 跟着请求一路传递，从服务 A → B → C → D，每个服务都把自己的信息（耗时、状态、日志）关联到这个 traceId。

---

## 学习路径

```
先搞懂原理
  ↓
RPC 调用是怎么工作的？（序列化 → 网络传输 → 反序列化）
  ↓
理解 HTTP vs RPC 的本质区别
  ↓
选择一个框架深入（推荐 Dubbo，用于国内微服务）
  ↓
理解服务治理（负载均衡、超时重试、熔断降级）
  ↓
理解链路追踪（为什么需要、如何实现）
```

下一节，从 [RPC 原理](/middleware/rpc/principle) 开始——先搞懂 RPC 调用的整个链路，再去看具体的框架实现。
