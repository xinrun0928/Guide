# 三大 RPC 框架：Dubbo、gRPC、Thrift 该选谁？

「我们团队选 gRPC，Google 出品，必属精品。」

「不对，Dubbo 国内生态好，文档全，社区活跃。」

「Thrift 支持的特性最全，性能也最好。」

三个框架各有特色，选择困难症又犯了。

**在选框架之前，我们先搞清楚它们的定位和差异。**

---

## 先说结论

| 维度 | Dubbo | gRPC | Thrift |
|-----|-------|------|--------|
| **血统** | 阿里开源 | Google 出品 | Facebook 出品 |
| **主战场** | Java 微服务 | 多语言微服务 | 多语言服务通信 |
| **序列化** | 多种（默认 Hessian） | Protobuf | Thrift 二进制 |
| **协议** | 自定义（Dubbo 协议） | HTTP/2 | 自定义二进制 |
| **服务治理** | 完整（路由、熔断、限流） | 基础 | 基础 |
| **国内生态** | 成熟 | 一般 | 一般 |
| **学习曲线** | 中等 | 较陡（IDL） | 较陡（IDL） |

---

## 起源与发展：三个框架的故事

### Dubbo：国内微服务框架的老大哥

```
2011 年：阿里巴巴开源 Dubbo
2012-2017：国内最流行的 RPC 框架
2017-2019：Apache 孵化，社区重启
2019-至今：Dubbo 3.0，云原生时代
```

Dubbo 从一开始就是为 Java 量身定制的，提供了完整的服务治理能力，在国内拥有庞大的用户群体。

### gRPC：Google 的全球化野心

```
2015 年：Google 开源 gRPC
2017 年：加入 CNCF
2020 年：毕业成为顶级项目
```

gRPC 从一开始就走国际化路线，基于 HTTP/2 和 Protobuf，主打多语言支持和云原生特性。

### Thrift：Facebook 的秘密武器

```
2007 年：Facebook 内部开发 Thrift
2008 年：开源贡献给 Apache
2010 年：成为 Apache 顶级项目
```

Thrift 是最早成熟的多语言 RPC 框架，支持 28 种语言，功能非常全面。

---

## 核心对比

### 1. 协议设计

**Dubbo 2.x：自定义二进制协议**

```
┌────────┬────────┬────────┬──────────┬────────┐
│ Header │ Magic  │ Length │  Body    │ CRC    │
│  (16B) │ (2B)   │ (4B)   │  (变长)  │ (可选) │
└────────┴────────┴────────┴──────────┴────────┘
```

优点：专为 RPC 设计，效率高
缺点：不兼容 HTTP，需要专用客户端

**Dubbo 3.x：Triple 协议**

```
Triple = HTTP/2 + Protobuf
```

优点：兼容 HTTP，可以被浏览器直接访问
缺点：比自定义协议略重

**gRPC：HTTP/2 + Protobuf**

```
HTTP/2          Protobuf
  ├─ Multiplexing    ├─ 强类型定义
  ├─ Header 压缩     ├─ 高效编码
  └─ Bidirectional  └─ 代码生成
```

优点：标准化，生态好
缺点：必须用 Protobuf，灵活性受限

**Thrift：自研二进制协议**

```
┌────────────┬────────────┬────────────┐
│ Version    │ Name/Type  │ Value      │
│ (1B)       │ (变长)      │ (变长)     │
└────────────┴────────────┴────────────┘
```

优点：协议简洁，支持多种传输方式
缺点：版本兼容性较弱

### 2. 序列化性能

| 框架 | 默认序列化 | 序列化速度 | 反序列化速度 |
|-----|----------|----------|------------|
| Dubbo 2.x | Hessian | 中 | 中 |
| Dubbo 3.x | Protobuf | 快 | 快 |
| gRPC | Protobuf | 快 | 快 |
| Thrift | Thrift 二进制 | 快 | 快 |

**数据来源：业界基准测试，实际性能因场景而异。**

### 3. 服务治理能力

| 能力 | Dubbo | gRPC | Thrift |
|-----|------|------|--------|
| 服务注册/发现 | 内置（Nacos/Zookeeper） | 需集成 | 需集成 |
| 负载均衡 | 多种策略（轮询、随机、加权） | 基础轮询 | 基础轮询 |
| 路由/过滤 | 条件路由、标签路由 | 无 | 无 |
| 熔断降级 | 内置 | 无 | 无 |
| 限流 | 内置 | 无 | 无 |
| 集群容错 | 多种（Failover、Failfast、Failsafe） | 无 | 无 |
| 服务监控 | 集成 Prometheus/SkyWalking | 需集成 | 需集成 |

**Dubbo 的服务治理能力是三者中最完整的，开箱即用；gRPC 和 Thrift 更偏向「通信框架」，治理能力需要自行扩展。**

### 4. 多语言支持

| 语言 | Dubbo | gRPC | Thrift |
|-----|-------|------|--------|
| Java | 完整支持 | 支持 | 支持 |
| Go | 部分支持（Dubbo-Go） | 完整支持 | 完整支持 |
| Python | 部分支持 | 完整支持 | 完整支持 |
| C++ | 不支持 | 支持 | 完整支持 |
| Node.js | 部分支持 | 完整支持 | 完整支持 |
| Rust | 不支持 | 支持 | 部分支持 |
| PHP | 不支持 | 支持 | 完整支持 |
| Ruby | 不支持 | 支持 | 完整支持 |

**如果你的系统需要多语言，gRPC 和 Thrift 是更好的选择。**

---

## 适用场景分析

### 场景一：Java 技术栈的微服务

```
推荐：Dubbo 3.x
```

原因：
- 完整的生态和服务治理能力
- 与 Spring Cloud 生态无缝集成
- 国内社区活跃，问题容易解决
- 新旧项目都有大量实践案例

```java
// Dubbo 接口定义
public interface OrderService {
    Order getOrderById(Long id);
}

// Dubbo 服务暴露
@DubboService
public class OrderServiceImpl implements OrderService {
    @Override
    public Order getOrderById(Long id) {
        return orderRepository.findById(id);
    }
}

// Dubbo 服务引用
@DubboReference
private OrderService orderService;
```

### 场景二：多语言微服务架构

```
推荐：gRPC
```

原因：
- CNCF 主流项目，生态成熟
- HTTP/2 支持流式调用
- Protobuf 跨语言能力强
- 文档和示例丰富

```protobuf
// gRPC 接口定义
service OrderService {
    rpc GetOrder(GetOrderRequest) returns (Order);
    rpc StreamOrders(SearchRequest) returns (stream Order);
}

message GetOrderRequest {
    int64 order_id = 1;
}
```

```java
// gRPC 服务端实现
public class OrderServiceImpl extends OrderServiceGrpc.OrderServiceImplBase {
    @Override
    public void getOrder(GetOrderRequest request,
                        StreamObserver&lt;Order&gt; responseObserver) {
        Order order = orderRepository.findById(request.getOrderId());
        responseObserver.onNext(order);
        responseObserver.onCompleted();
    }
}
```

### 场景三：高并发、低延迟的内部系统

```
推荐：Thrift 或 Dubbo（高性能配置）
```

原因：
- Thrift 二进制协议体积小
- 支持多种传输方式（Socket、HTTP、文件）
- 支持非阻塞 I/O

```thrift
// Thrift IDL 定义
service OrderService {
    Order getOrderById(1: i64 order_id)
    oneway void cancelOrder(1: i64 order_id)  // oneway = 不等待响应
}
```

### 场景四：对外 API 网关

```
推荐：gRPC + REST 适配层
```

原因：
- gRPC 服务可以通过 grpc-gateway 转换为 REST API
- 支持 HTTP/JSON 到 gRPC 的透明转换

```bash
# 通过 HTTP/JSON 调用 gRPC 服务
curl -X POST http://api.example.com/v1/orders/1001
```

---

## 迁移与升级

### 从 Dubbo 2.x 升级到 3.x

**主要变化：**

1. 序列化从 Hessian 切换到 Triple（基于 Protobuf）
2. 服务发现从「接口级」改为「应用级」
3. 新的 Triple 协议兼容 HTTP

```java
// Dubbo 2.x 配置
dubbo:
  protocol:
    name: dubbo
    serialization: hessian2

// Dubbo 3.x 配置（向后兼容）
dubbo:
  protocol:
    name: tri  # Triple 协议
    serialization: protobuf
```

### 从 REST 迁移到 gRPC

**挑战：**

1. 需要定义 `.proto` 文件
2. 所有客户端需要重新生成代码
3. HTTP/1.1 客户端无法直接访问

**方案：使用 grpc-gateway 透明转换**

```protobuf
// 启用 HTTP 注解
import "google/api/annotations.proto";

service OrderService {
    rpc GetOrder(GetOrderRequest) returns (Order) {
        option (google.api.http) = {
            get: "/v1/orders/{order_id}"
        };
    }
}
```

---

## 面试高频问题

### 问题一：Dubbo 和 Spring Cloud 怎么选？

**考察点：** 对微服务技术栈的整体理解。

**参考答案：**
- Dubbo 侧重 RPC 通信，适合服务间调用频繁的场景
- Spring Cloud 侧重生态完整性，适合快速构建微服务
- 两者可以结合：Spring Cloud 做网关/配置/Dubbo 做服务间 RPC 调用

### 问题二：gRPC 为什么选择 HTTP/2？

**考察点：** 对底层协议的理解。

**参考答案：**
- HTTP/1.1 的队头阻塞问题：同一连接只能串行请求
- HTTP/2 的多路复用：多个请求并发传输
- HTTP/2 头部压缩：减少重复 header 的传输
- 支持流式响应：Server Push、Streaming RPC

### 问题三：Thrift 的 oneway 关键字是什么？

**考察点：** 对 Thrift 特性的了解。

**参考答案：**
- `oneway` 表示客户端不等待服务端响应
- 客户端调用后立即返回，不关心服务端是否执行
- 适用于日志、监控等不需要确认的场景
- 注意：服务端执行失败时，客户端完全不知道

---

## 总结

| 选择 | 场景 | 理由 |
|-----|-----|-----|
| **Dubbo 3.x** | Java 微服务、需要服务治理 | 生态完整、开箱即用 |
| **gRPC** | 多语言微服务、流式调用 | 标准化、云原生 |
| **Thrift** | 高性能、多种传输方式 | 协议简洁、功能全面 |
| **混合方案** | 复杂架构 | BFF 用 REST，内部用 RPC |

---

## 留给你的问题

假设你的团队正在从单体架构迁移到微服务架构，有以下约束：

- 技术栈以 Java 为主
- 未来可能接入 Go 和 Python 服务
- 团队没有 RPC 框架使用经验
- 项目周期紧张，只有 3 个月

**在这种情况下，你会选择哪个框架？为什么？如果只选一个不够，你会如何组合使用？**

这个问题，可以结合 [Dubbo SPI 机制](/middleware/rpc/dubbo-spi) 来思考如何扩展框架能力。
