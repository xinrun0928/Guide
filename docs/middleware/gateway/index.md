# API 网关：微服务统一入口

你的微服务架构有 20 个 API 服务，每个服务都要做认证、限流、日志、CORS 处理。

于是，每个服务里都有这样一堆代码：

```java
// 每个微服务都要写这些
public class AuthFilter {
    @Autowired
    private TokenService tokenService;

    public Mono<Void> filter(ServerWebExchange exchange) {
        String token = exchange.getRequest().getHeaders().getFirst("Authorization");
        // 验证 token
        // ...
    }
}

public class RateLimitFilter {
    // 限流逻辑
    // ...
}

public class CorsFilter {
    // CORS 处理
    // ...
}
```

每个服务都要复制粘贴这套代码，维护成本高，而且很容易出现不一致。

**API 网关** 就是来解决这个问题的——它把横切关注点（Cross-Cutting Concerns）集中到一层，让后端服务专注业务逻辑。

## API 网关是什么？

API 网关是微服务架构中的**统一入口**，位于客户端和后端服务之间，所有请求都经过网关转发。

```
┌─────────────┐
│   客户端    │  ← 浏览器、App、第三方
└──────┬──────┘
       │ HTTP/HTTPS
       ▼
┌─────────────┐
│  API 网关   │  ← 认证、限流、路由、日志、协议转换
└──────┬──────┘
       │
       ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  服务 A     │ │  服务 B     │ │  服务 C     │
└─────────────┘ └─────────────┘ └─────────────┘
```

## 核心功能

| 功能 | 说明 | 典型场景 |
|-----|------|---------|
| 路由转发 | 根据规则将请求路由到后端服务 | `/api/user/**` → user-service |
| 负载均衡 | 多个实例间的流量分配 | Round Robin、Weighted |
| 认证授权 | Token 验证、权限校验 | JWT、OAuth2 |
| 限流熔断 | 保护后端服务，防止雪崩 | 令牌桶、滑动窗口 |
| 日志监控 | 请求日志、性能指标 | 链路追踪、埋点 |
| 协议转换 | REST → gRPC、WebSocket | 多协议支持 |
| CORS 处理 | 跨域资源共享 | 前端开发联调 |

## 两大流派

### Spring Cloud Gateway

Java 技术栈首选，与 Spring Cloud 生态深度集成：

```java
// 路由配置示例
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/api/user/**
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 100
                redis-rate-limiter.burstCapacity: 200
```

### Kong

基于 Nginx 的高性能网关，支持插件扩展：

```java
// Kong 路由配置
curl -X POST http://localhost:8001/routes \
  --data "name=user-api" \
  --data "paths[]=/api/user" \
  --data "service.id=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

## 如何选型？

| 维度 | Spring Cloud Gateway | Kong |
|-----|---------------------|------|
| 技术栈 | Java | Nginx + Lua |
| 学习成本 | Java 开发者友好 | 需要熟悉 Kong 配置 |
| 插件生态 | Spring 生态 | 官方插件丰富 |
| 性能 | 万级 QPS | 十万级 QPS |
| 部署方式 | Spring Boot 应用 | Docker/K8s |
| 适用场景 | Spring Cloud 项目 | 多语言微服务 |

## 文档导航

### 基础入门

- [核心功能](/middleware/gateway/core-function)：路由、负载均衡、认证
- [架构设计](/middleware/gateway/architecture)：高可用、性能、安全设计
- [路由匹配](/middleware/gateway/route-match)：路径匹配规则与配置
- [过滤器链](/middleware/gateway/filter-chain)：过滤器执行顺序与原理

### Spring Cloud Gateway

- [路由配置](/middleware/gateway/sc-gateway-route)：动态路由与配置
- [过滤器](/middleware/gateway/sc-gateway-filter)：内置过滤器和自定义
- [限流](/middleware/gateway/sc-gateway-rate-limit)：令牌桶、滑动窗口
- [熔断](/middleware/gateway/sc-gateway-circuit-breaker)：Hystrix、Sentinel
- [工作流程](/middleware/gateway/sc-gateway-workflow)：请求处理全流程
- [vs Zuul](/middleware/gateway/sc-gateway-vs-zuul)：SCG vs Zuul 对比

### Kong

- [Kong 架构](/middleware/gateway/kong-architecture)：Kong 核心组件
- [负载均衡](/middleware/gateway/kong-loadbalance)：upstream 配置
- [插件系统](/middleware/gateway/kong-plugin)：认证、限流、插件开发

### 选型参考

- [网关选型](/middleware/gateway/selection)：如何选择适合的网关方案

---

**留给你的问题**：

你的项目正在从单体架构迁移到微服务架构，预计有 30+ 个微服务。你会选择 Spring Cloud Gateway 还是 Kong？为什么？

需要考虑：团队技术栈、现有系统、扩展需求、性能要求等因素。
