# Spring Cloud 微服务架构实战

> 微服务架构从「听起来很美」到「真正落地」，中间隔着一百个坑。而 Spring Cloud，就是帮你跨过这些坑的那把梯子。

---

## 凌晨 3 点的生产事故

你一定见过这样的场景：

> 凌晨 3 点，用户反馈订单支付失败。日志里满是 `feign.FeignException: Connection refused`。
> 你排查了半天才发现，是用户服务重启了，订单服务还在用旧的 IP 地址调用——服务注册中心没有及时更新。

或者这样：

> 618 大促，流量是平时的 20 倍。某个接口开始超时，然后整个系统雪崩。
> 你想限流，但发现网关没有限流功能；你想降级，但不知道该降级谁。

这些问题，单体架构根本遇不到。但微服务架构下，服务间通信、服务治理、流量控制——每个环节都可能出问题。

**Spring Cloud 全家桶，就是来解决这些问题的。**

---

## Spring Cloud 是什么

Spring Cloud 是 Spring 官方提供的一套微服务解决方案，它并不是一个新的框架，而是一系列框架的集合。

打个比方：Spring Cloud 就像一个「微服务超市」：

- 你想要服务注册发现？**Nacos / Eureka** 在这儿
- 你想要统一网关？**Gateway / Zuul** 挑一个
- 你想要服务间调用？**OpenFeign / RestTemplate** 随你选
- 你想要流量控制？**Sentinel** 了解一下
- 你想要链路追踪？**Sleuth + Zipkin** 组合拳

这些组件可以自由组合，按需取用——这就是 Spring Cloud 的设计哲学。

---

## 核心组件一览

| 场景 | 组件 | 说明 |
|---|---|---|
| 服务注册与发现 | Nacos / Consul / Eureka | 管理服务实例，支持动态上下线 |
| 统一网关 | Spring Cloud Gateway | 请求路由、限流、认证 |
| 声明式 HTTP 客户端 | OpenFeign | 用注解的方式调用 HTTP 接口 |
| 流量控制 | Sentinel | 限流、熔断、降级 |
| 配置中心 | Nacos Config / Apollo | 集中管理配置，支持热更新 |
| 链路追踪 | Sleuth + Zipkin | 追踪请求链路，定位性能瓶颈 |
| 分布式事务 | Seata | AT、TCC、Saga 模式 |
| 消息总线 | Spring Cloud Bus | 配置变更广播 |

---

## 两种技术路线

目前国内主流的 Spring Cloud 生态有两套：

### Spring Cloud Netflix（经典路线）

Netflix 是微服务领域的先行者，提供了大量成熟组件：Eureka（注册中心）、Hystrix（熔断器）、Zuul（网关）、Ribbon（负载均衡）。

但 Netflix 在 2018 年宣布部分组件进入维护模式，Eureka 2.x 停止开源。这让很多人开始转向新方案。

### Spring Cloud Alibaba（国产之光）

阿里开源的微服务解决方案，在国内拥有大量用户。核心组件包括：

- **Nacos**：同时担任注册中心和配置中心，开源友好
- **Sentinel**：流量控制熔断，比 Hystrix 更强大
- **Seata**：分布式事务解决方案
- **Dubbo**：RPC 框架，可与 Spring Cloud 生态无缝集成

> 如果你在国内做微服务，推荐 **Spring Cloud Alibaba**。Nacos 的活跃度、中文文档、以及国内大厂背书，都是实打实的优势。

---

## 学习路径

对于 Spring Cloud，建议按以下顺序学习：

```
第一阶段：基础设施
├─ 服务注册与发现（Nacos/Eureka）
├─ 配置中心（Nacos Config）
└─ 服务间调用（OpenFeign）

第二阶段：网关与安全
├─ 统一网关（Gateway）
├─ 限流与熔断（Sentinel）
└─ 统一认证（OAuth2 + JWT）

第三阶段：高阶特性
├─ 链路追踪（Sleuth + Zipkin）
├─ 消息总线（Bus）
└─ 分布式事务（Seata）
```

每一阶段都有它的「坑」——但别担心，这个系列会带你一个个踩过去。

---

## 写在最后

微服务不是银弹。它解决了很多问题，但也引入了新的复杂性：服务拆分、网络通信、数据一致性、运维复杂度……

**Spring Cloud 能帮你降低这些复杂性，但前提是你得理解它为什么这样设计。**

这个系列的目标，不仅仅是告诉你「怎么用」，更是帮你理解「为什么这样用」。

准备好了吗？我们开始。
