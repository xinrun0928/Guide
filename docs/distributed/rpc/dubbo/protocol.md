# Dubbo 协议：dubbo://、rmi://、http://、hessian://、gRPC

你有没有想过这个问题：

同样是 RPC 框架，Dubbo 支持 dubbo://、rmi://、http://、hessian:// 等多种协议，为什么需要这么多？它们有什么区别？选哪个？

更重要的是——Dubbo 3.0 推出了 Triple 协议，号称要统一所有场景，这是怎么回事？

今天，我们来彻底搞清楚 Dubbo 的协议家族。

## 为什么 Dubbo 需要自定义协议？

在回答这个问题之前，我们先理解一下 HTTP 协议的问题：

HTTP 协议是**文本协议**，每个请求都包含大量的 header 信息，而且每次请求都需要建立 TCP 连接（HTTP/1.1 之前）。对于高并发场景，这是巨大的性能损耗。

Dubbo 选择自定义协议，核心目的是：

1. **减少网络开销**：二进制序列化，比 JSON/XML 小得多
2. **减少序列化时间**：二进制序列化比文本序列化快 5-20 倍
3. **连接复用**：基于 TCP 的长连接，避免频繁建立连接

## dubbo:// 协议：默认的高性能协议

`dubbo://` 是 Dubbo 的默认协议，也是它的核心竞争力。

### 协议格式

```
dubbo://192.168.1.100:20880/com.example.UserService?version=1.0.0&timeout=3000
```

一个典型的 dubbo:// URL 包含：
- **接口全限定名**：`com.example.UserService`
- **版本号**：`version=1.0.0`（用于接口升级）
- **分组**：`group=xxx`（用于服务分组）
- **方法名**：在请求体中传递

### 工作原理

```
┌──────────────────────────────────────────────────────────┐
│                      dubbo:// 协议栈                       │
├──────────────────────────────────────────────────────────┤
│  数据格式：Hessian2（默认）/ JSON / FastJson              │
│  连接模型：NIO（基于 Netty），支持长连接                    │
│  传输效率：高，比 HTTP 快 3-10 倍                          │
└──────────────────────────────────────────────────────────┘
```

### 关键配置

```xml
<!-- 服务提供者配置 -->
<dubbo:protocol
    name="dubbo"
    port="20880"
    threads="200"
    io="netty"
    serialization="hessian2"
    transporter="netty"
    charset="UTF-8"
    queue="0"
    buffer="8192"
    heartbeat="60000"/>
```

常用参数说明：

| 参数 | 默认值 | 说明 |
|-----|-------|-----|
| `port` | 20880 | 服务端口 |
| `threads` | 200 | 业务线程池大小 |
| `serialization` | hessian2 | 序列化方式 |
| `heartbeat` | 60000 | 心跳间隔（毫秒） |

### 单连接 vs 多连接

Dubbo 默认使用**单连接**——即一个 Consumer 和一个 Provider 之间只建立一条 TCP 长连接。

这听起来很奇怪：为什么不建立多个连接并发请求？

答案是：**短连接成本高，长连接效率高。**

- 单连接：适合数据量小、高并发场景（如 RPC 调用）
- 多连接：适合数据量大、吞吐量要求高的场景

```java
// 配置使用多连接
<dubbo:service connections="3" />  // 每个服务使用 3 条连接
// 或
<dubbo:reference connections="3" />
```

## rmi:// 协议：与 Java RMI 兼容

`rmi://` 协议是 Java 标准的 RMI（Remote Method Invocation）协议的 Dubbo 实现。

### 特点

- 基于 **Java RMI** 标准，使用 Java 原生序列化
- **短连接**：每次请求创建新连接，请求结束后关闭
- **穿透防火墙**：基于标准 HTTP 协议（通常走 1099 端口）

### 适用场景

```xml
<dubbo:protocol name="rmi" port="1099" />
```

适合以下场景：
- **传入传出参数较大**：Java RMI 对大对象支持较好
- **与遗留系统对接**：如果对方是标准 Java RMI 服务
- **需要穿透防火墙**：生产环境网络策略较严格时

### 缺点

- **性能较低**：Java 序列化效率低，短连接开销大
- **不是长连接**：无法享受连接复用的优势

## http:// 协议：前后端分离的首选

`http://` 协议是 Dubbo 对 HTTP 协议的支持。

### 特点

- 基于 **HTTP + JSON**，标准的 RESTful 风格
- **短连接**：每次请求建立新连接
- **跨语言友好**：任何 HTTP 客户端都可以调用
- **调试友好**：可以用浏览器直接访问

### 适用场景

```java
// 基于 Spring MVC 注解暴露服务
@RestController
@Path("/user")
public class UserServiceImpl {
    @POST
    @Path("/find")
    public User findById(@FormParam("id") Long id) {
        return userDao.findById(id);
    }
}
```

```xml
<dubbo:protocol name="http" port="8080" />
```

适合：
- **前后端分离项目**：前端直接通过 AJAX 调用
- **需要 HTTP 接口文档**：Swagger/OpenAPI 集成
- **跨语言调用**：Python、Go 等语言可以轻松调用

## hessian:// 协议：跨语言的二进制协议

`hessian://` 是基于 Hessian 序列化的协议，它是 dubbo:// 的跨语言版本。

### 特点

- **Hessian 序列化**：比 Java 原生序列化更高效
- **跨语言**：Java、C++、Python、.NET 等多种语言支持
- **长连接**：性能较好

### 适用场景

```xml
<dubbo:protocol name="hessian" port="8080" serialization="hessian2" />
```

适合：
- **Java 服务调用非 Java 服务**：如调用 Python 机器学习服务
- **需要跨语言 RPC**：微服务使用不同语言开发

## gRPC 协议：Dubbo 3.0 的新选择

Dubbo 3.0 开始原生支持 gRPC 协议。

### 什么是 gRPC？

gRPC 是 Google 开源的 RPC 框架，基于 HTTP/2 + Protocol Buffers：

- **HTTP/2**：多路复用、header 压缩、性能优异
- **Protocol Buffers**：高效的二进制序列化
- **强类型**：通过 `.proto` 文件定义服务接口

```protobuf
// user.proto
syntax = "proto3";
package com.example;

service UserService {
  rpc findById (UserRequest) returns (UserResponse);
}

message UserRequest {
  int64 id = 1;
}

message UserResponse {
  int64 id = 1;
  string name = 2;
}
```

### Dubbo 对 gRPC 的支持

```java
// Dubbo 支持使用 gRPC 协议
@DubboService(protocol = "grpc", port = 50051)
public class UserServiceImpl implements UserService {
    // ...
}
```

## Triple 协议：Dubbo 3.0 的统一协议

Dubbo 3.0 推出了 **Triple 协议**，目标是成为 Dubbo 的「终极协议」。

### Triple 的设计目标

```
┌─────────────────────────────────────────────────────────┐
│                      Triple 协议                         │
├─────────────────────────────────────────────────────────┤
│  ✓ 基于 HTTP/2：兼容现有 HTTP 基础设施                    │
│  ✓ 支持 gRPC：可直接与 gRPC 服务互操作                   │
│  ✓ 原生支持 Streaming：支持流式调用                      │
│  ✓ 完美的网关穿透性：可以走标准 HTTP 代理                 │
│  ✓ 向后兼容：支持 dubbo:// 协议升级                      │
└─────────────────────────────────────────────────────────┘
```

### 为什么 Triple 能统一所有场景？

| 场景 | dubbo:// | http:// | gRPC | Triple |
|-----|----------|---------|------|--------|
| 高性能 | ✓ | ✗ | ✓ | ✓ |
| 跨语言 | ✗ | ✓ | ✓ | ✓ |
| 网关穿透 | ✗ | ✓ | ✗ | ✓ |
| Streaming | ✗ | ✗ | ✓ | ✓ |
| 调试友好 | ✗ | ✓ | ✗ | ✓ |

Triple 协议基于 HTTP/2，所以它继承了 HTTP 的所有优点（网关穿透、调试友好），同时通过 Protocol Buffers 实现了高性能和跨语言。

## 协议选型建议

```
┌─────────────────────────────────────────────────────────┐
│                    协议选型决策树                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  服务调用场景                                            │
│       │                                                 │
│       ├─── 内部微服务调用 ──→ dubbo:// 或 Triple         │
│       │                      （追求极致性能）            │
│       │                                                 │
│       ├─── 前后端分离 ────────→ http://                 │
│       │                      （RESTful，浏览器可直接调） │
│       │                                                 │
│       ├─── 跨语言调用 ────────→ gRPC 或 Hessian          │
│       │                      （Protocol Buffers）        │
│       │                                                 │
│       └─── 需要 Streaming ──→ gRPC 或 Triple             │
│                              （双向流、客户端流、服务端流）  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## 面试追问方向

- 为什么 dubbo:// 默认使用单连接？这会不会成为瓶颈？
- Hessian 序列化相比 Java 原生序列化有什么优势？有什么坑？
- HTTP/2 的多路复用是什么原理？为什么比 HTTP/1.1 快？
- dubbo:// 和 Triple 协议可以共存吗？如何平滑升级？

## 总结

Dubbo 的协议家族解决了不同场景的需求：

| 协议 | 序列化 | 连接方式 | 性能 | 跨语言 |
|-----|--------|---------|------|--------|
| dubbo:// | Hessian2 | 长连接 | 最高 | 差 |
| rmi:// | Java | 短连接 | 中 | 差 |
| http:// | JSON | 短连接 | 低 | 好 |
| hessian:// | Hessian | 长连接 | 高 | 好 |
| gRPC | Protobuf | 长连接 | 高 | 好 |
| Triple | Protobuf | 长连接 | 高 | 好 |

Dubbo 3.0 的 Triple 协议是一个集大成者，它试图用一套协议覆盖所有场景——高性能、跨语言、网关穿透、Streaming 全都支持。

未来，Triple 很可能成为 Dubbo 生态的默认选择。
