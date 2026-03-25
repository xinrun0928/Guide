# Spring Cloud Alibaba vs Spring Cloud Netflix 对比

> 「我们应该用 Nacos 还是 Eureka？用 Sentinel 还是 Hystrix？」这个问题几乎每个做微服务的人都会遇到。

今天我们来彻底分析一下两套技术栈的优劣，以及如何选择。

---

## 故事要从 2018 年说起

2018 年，Netflix 宣布 Hystrix、Ribbon、Zuul 等核心组件进入维护模式，不再提供新特性。

消息一出，业界哗然。很多人开始担心：Netflix 这套技术栈还能用吗？

与此同时，阿里巴巴开源了 Spring Cloud Alibaba，带来了 Nacos、Sentinel、Dubbo 等一系列组件，迅速在国内掀起热潮。

**两套技术栈，各有优劣。选哪个？我们先从核心组件对比说起。**

---

## 核心组件对比

| 功能 | Spring Cloud Netflix | Spring Cloud Alibaba |
|---|---|---|
| 注册中心 | Eureka（已停更） | Nacos（推荐） |
| 配置中心 | Spring Cloud Config | Nacos Config（推荐） |
| 服务调用 | Ribbon + RestTemplate | OpenFeign / Dubbo |
| 熔断器 | Hystrix（已停更） | Sentinel（推荐） |
| 网关 | Zuul（已停更） | Spring Cloud Gateway |
| 分布式事务 | 无官方方案 | Seata（推荐） |
| 消息队列 | 无官方方案 | RocketMQ |

---

## 注册中心对比：Nacos vs Eureka

### Eureka 的设计哲学

Eureka 是 Netflix 开源的注册中心，采用 **AP 模型**（高可用、分区容错）：

```
┌─────────────┐         ┌─────────────┐
│ Eureka      │◄──────►│ Eureka      │
│ Server 1    │  同步   │ Server 2    │
└──────┬──────┘         └──────┬──────┘
       │                       │
       ▼                       ▼
┌─────────────┐         ┌─────────────┐
│  服务实例   │         │  服务实例   │
└─────────────┘         └─────────────┘
```

- **自我保护机制**：当心跳失败比例超过阈值，Eureka 不再剔除过期实例
- **客户端缓存**：即使 Eureka 全部宕机，服务间仍可通信（基于本地缓存）

### Nacos 的设计哲学

Nacos 不仅仅是注册中心，还集成了配置中心。它同时支持 **AP 和 CP**：

```yaml
# AP 模式（默认）
spring:
  cloud:
    nacos:
      discovery:
        ephemeral: true  # 临时实例，使用 AP

# CP 模式
spring:
  cloud:
    nacos:
      discovery:
        ephemeral: false  # 持久实例，使用 CP
```

### 核心差异

| 特性 | Eureka | Nacos |
|---|---|---|
| CAP 模型 | AP | AP + CP 可切换 |
| 健康检查 | 客户端心跳 | 服务端探针 + 客户端心跳 |
| 配置中心集成 | 否 | 是 |
| 控制台 | 简陋 | 功能完善 |
| 活跃度 | 低（已停更） | 高 |
| 中文文档 | 一般 | 完善 |

**结论**：新项目**强烈推荐 Nacos**。Eureka 已停止维护，功能差距越来越大。

---

## 熔断器对比：Sentinel vs Hystrix

### Hystrix 的设计

Hystrix 是 Netflix 2012 年开源的熔断器，核心理念是**线程隔离**：

```java
@HystrixCommand(fallbackMethod = "fallback",
    commandProperties = {
        @HystrixProperty(name = "circuitBreaker.requestVolumeThreshold", value = "10"),
        @HystrixProperty(name = "circuitBreaker.sleepWindowInMilliseconds", value = "10000")
    })
public String callService() {
    return restTemplate.getForObject("http://service-b/api", String.class);
}
```

**问题**：

- 线程池隔离开销大
- 文档和社区活跃度下降
- 没有配套的控制台

### Sentinel 的设计

Sentinel 是阿里开源的流量防卫兵，核心理念是**资源维度控制**：

```java
@GetMapping("/api")
@SentinelResource(value = "api",
    blockHandler = "blockHandler",
    fallback = "fallback")
public String api() {
    return restTemplate.getForObject("http://service-b/api", String.class);
}
```

**优势**：

- 支持流量控制、熔断降级、系统自适应保护
- 提供功能完善的控制台
- 支持热点参数限流
- 规则动态配置

### 核心差异

| 特性 | Hystrix | Sentinel |
|---|---|---|
| 熔断策略 | 线程池隔离 | 信号量隔离（可选） |
| 限流维度 | QPS | QPS + 并发数 |
| 热点参数限流 | 不支持 | 支持 |
| 规则配置 | 配置复杂 | 控制台可视化 |
| 动态规则 | 不支持 | 支持 |
| 活跃度 | 低（已停更） | 高 |

**结论**：**Sentinel 全面优于 Hystrix**，无论是功能还是生态。

---

## 配置中心对比：Nacos Config vs Spring Cloud Config

### Spring Cloud Config

传统配置中心，分为 Config Server 和 Config Client：

```
┌─────────────────┐
│  Config Server  │
│  (连接 Git/SVN) │
└────────┬────────┘
         │ HTTP
         ▼
┌─────────────────┐
│  Config Client  │
│  (各微服务)       │
└─────────────────┘
```

**问题**：

- 需要额外搭建 Git 仓库
- 配置变更后需要手动刷新（配合 Bus 才能自动刷新）
- 没有控制台，配置管理不便

### Nacos Config

配置中心与注册中心合一：

```yaml
spring:
  cloud:
    nacos:
      config:
        server-addr: 127.0.0.1:8848
        file-extension: yaml
        namespace: dev
        group: ORDER_GROUP
```

**优势**：

- 配置可视化（控制台直接编辑）
- 配置变更实时推送
- 支持配置版本管理和回滚
- 集成注册中心，减少组件依赖

**结论**：**Nacos Config 完胜**，开箱即用，功能完善。

---

## 网关对比：Gateway vs Zuul

### Zuul 的问题

Netflix 的 Zuul 1.x 是同步阻塞网关，性能有限：

```properties
zuul.routes.user-service.path=/user/**
zuul.routes.user-service.url=http://user-service:8080
```

Zuul 2.x 虽然改为异步，但与 Spring Cloud 集成不如 Gateway 紧密。

### Gateway 的优势

Spring Cloud Gateway 是 Spring 官方出品，基于 WebFlux 异步非阻塞：

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/api/user/**
          filters:
            - StripPrefix=1
```

**优势**：

- 异步非阻塞，性能优秀
- 与 Spring Cloud 生态深度集成
- 内置丰富的 Predicate 和 Filter
- 支持限流、熔断等高级特性

**结论**：新项目**直接用 Gateway**，不要犹豫。

---

## 最终选型建议

### 推荐组合

```
Spring Cloud Alibaba 全家桶（国内首选）

┌─────────────────────────────────────────────────────┐
│  注册中心 + 配置中心  │  Nacos                       │
│  服务调用            │  OpenFeign / Dubbo            │
│  网关               │  Spring Cloud Gateway         │
│  限流熔断            │  Sentinel                     │
│  分布式事务          │  Seata                        │
│  链路追踪            │  Sleuth + Zipkin              │
└─────────────────────────────────────────────────────┘
```

### 什么情况用 Netflix 栈

- **遗留项目**：已经在用 Eureka + Hystrix，迁移成本高
- **海外项目**：Netflix 栈在海外社区更活跃
- **团队熟悉度**：团队已经熟悉 Netflix 组件

### 什么情况用 Alibaba 栈

- **新项目**：从零开始，直接用 Alibaba 栈
- **国内项目**：Nacos 中文文档完善，社区活跃
- **追求功能完善**：Sentinel 的限流功能比 Hystrix 强大太多

---

## 面试高频问题

### Q：为什么 Eureka 2.x 停止开源了？

A：Netflix 在 2018 年宣布调整开源策略，Eureka 2.x 不再开源。但 Eureka 1.x 仍然可用，只是不会再有新功能。对于新项目，建议使用 Nacos。

### Q：Sentinel 和 Hystrix 的核心区别是什么？

A：Hystrix 使用线程池隔离，每个依赖维护一个线程池；Sentinel 使用**信号量隔离 + 资源维度控制**，开销更小，功能更丰富（热点参数限流、系统自适应保护等）。

### Q：Nacos 为什么能同时支持 AP 和 CP？

A：Nacos 使用 Raft 协议实现 CP 模式（需要选举 leader），同时保留了心跳机制支持 AP 模式。通过配置 `ephemeral` 属性切换。

### Q：Spring Cloud Alibaba 和 Spring Cloud Netflix 能混用吗？

A：可以。例如用 Nacos（Alibaba）做注册中心，用 Gateway（Spring Cloud）做网关。这是目前国内的主流组合。

---

## 总结

| 维度 | Spring Cloud Netflix | Spring Cloud Alibaba |
|---|---|---|
| 活跃度 | 低（组件停更） | 高（持续迭代） |
| 功能完善度 | 基础功能可用 | 功能更强大 |
| 运维成本 | 组件多，维护复杂 | Nacos 一体化，降低成本 |
| 社区支持 | 英文为主 | 中文社区活跃 |
| 推荐度 | ⭐⭐（遗留项目） | ⭐⭐⭐⭐⭐（新项目） |

> 没有最好的技术栈，只有最适合的技术栈。但如果你是国内项目，**Spring Cloud Alibaba 全家桶是更明智的选择**。
