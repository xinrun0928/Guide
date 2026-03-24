# 服务调用

微服务之间如何通信？

同步调用用 RPC（Dubbo、gRPC），声明式 HTTP 用 Feign，跨语言用 HTTP。

每种方式都有自己的适用场景，**选对通信方式，是微服务架构的第一步。**


## 模块速览

服务调用分为三个部分：Dubbo、Feign、gRPC。

|| 章节 | 篇数 | 核心内容 |
||------|------|----------|
|| [Dubbo](/distributed/dubbo/architecture) | 9 篇 | 架构、协议、负载均衡、路由、集群容错、线程模型、导出引用、SPI、链路追踪 |
|| [Feign 与 OpenFeign](/distributed/feign/principle) | 5 篇 | 声明式 HTTP、Spring Boot 集成、Ribbon、拦截器、压缩 |
|| [gRPC](/distributed/grpc/index) | 2 篇 | Protocol Buffers、HTTP/2、四种通信模式、REST vs RPC |


## 三种通信模式对比

| 维度 | Dubbo | Feign | gRPC |
|------|-------|-------|------|
| 通信协议 | TCP (Dubbo 协议) | HTTP | HTTP/2 |
| 序列化 | Hessian / Protobuf | JSON | Protobuf |
| 性能 | 最高 | 中 | 高 |
| 侵入性 | 中（注解） | 低（声明式） | 高（IDL） |
| 跨语言 | 困难 | 容易 | 容易 |
| 适用场景 | Java 微服务内部 | Spring Cloud | 跨语言 / 微服务互通 |


## Dubbo 架构图

```
┌─────────────────────────────────────────┐
│                  Consumer                │
│  ┌─────────┐    ┌─────────┐             │
│  │  Proxy  │───▶│ Filter   │             │
│  └────┬────┘    └─────────┘             │
│       │                                   │
│  ┌────▼────┐    ┌─────────┐             │
│  │ Cluster │───▶│ Router   │             │
│  └────┬────┘    └─────────┘             │
│       │                                   │
│  ┌────▼────┐                            │
│  │ LoadBalance │                          │
│  └────┬────┘                            │
│       │                                   │
└───────┼───────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────┐
│              Registry (Nacos / ZK)         │
└───────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────┐
│                  Provider                │
│  ┌─────────┐    ┌─────────┐             │
│  │ Export   │───▶│ Protocol │             │
│  └─────────┘    └─────────┘             │
│       │                                   │
│  ┌────▼────┐    ┌─────────┐             │
│  │ ThreadPool │◀──│ Netty    │             │
│  └─────────┘    └─────────┘             │
└─────────────────────────────────────────┘
```


## 选型建议

```
1. Spring Cloud 生态 → OpenFeign（声明式，代码最简洁）
2. 高性能 Java 微服务 → Dubbo（TCP 协议，性能最优）
3. 跨语言微服务互通 → gRPC（HTTP/2 + Protobuf）
4. RESTful API → Spring MVC / OpenFeign
```


## 面试高频问题

### Q1：Dubbo 和 Feign 的区别？

> 「Dubbo 是 RPC 框架，基于 TCP 协议，用 Hessian/Protobuf 序列化，性能高。
> Feign 是声明式 HTTP 客户端，基于 HTTP 协议，用 JSON 序列化，性能中等。
> Dubbo 适合高性能场景，Feign 适合快速开发和 Spring Cloud 集成。」

### Q2：Dubbo 的负载均衡策略有哪些？

> 「五种：Random（加权随机）、RoundRobin（加权轮询）、LeastActive（最小活跃数）、ConsistentHash（一致性哈希）、ShortestResponse（最短响应时间）。
> 默认是加权随机，各有适用场景。」

### Q3：gRPC 相比 RESTful 的优势？

> 「性能高（HTTP/2 + Protobuf）、强类型、自动代码生成、双向流。
> 劣势是 ProtoBuf 学习成本、浏览器支持需要 gRPC-Web、中间件生态不如 REST。」


## 延伸阅读

服务调用的选择，本质上是「性能 vs 开发效率」的权衡。

- 极致性能：Dubbo
- 快速开发：Feign
- 跨语言互通：gRPC
- 外部 API：RESTful

没有银弹，只有最适合的选择。
