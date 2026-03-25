# 网关选型

说到 API 网关选型，市场上有太多选择了：Spring Cloud Gateway、Kong、Apache APISIX、Traefik……

每个网关都宣称自己「高性能」「易扩展」「功能丰富」。但实际上，每个网关都有自己的适用场景和 Trade-off。

这篇文章帮你梳理主流网关的特点，让你能做出合适的选择。

## 选型维度

在开始对比之前，先明确选型需要考虑的维度：

| 维度 | 说明 | 重要性 |
|---|---|---|
| 性能 | QPS、延迟、吞吐 | 高 |
| 生态集成 | 与现有技术栈的兼容性 | 高 |
| 扩展性 | 插件系统、自定义能力 | 高 |
| 易用性 | 学习曲线、配置复杂度 | 中 |
| 功能丰富度 | 内置功能多少 | 中 |
| 社区活跃度 | 文档、问题响应 | 中 |
| 运维复杂度 | 部署、监控、升级 | 中 |

## 主流网关对比

### Spring Cloud Gateway

**定位**：Spring Cloud 微服务生态的官方网关

| 特性 | 说明 |
|---|---|
| 架构 | 基于 WebFlux + Netty，异步非阻塞 |
| 性能 | 高（单节点可达 50K QPS） |
| 编程语言 | Java |
| 配置方式 | YAML / Java DSL |
| 插件开发 | 实现 GatewayFilter 接口 |
| 优点 | 与 Spring Cloud 无缝集成，学习成本低 |
| 缺点 | 仅支持 Java，技术栈受限 |

```yaml
# 典型配置
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
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 100
```

### Kong

**定位**：企业级 API 网关

| 特性 | 说明 |
|---|---|
| 架构 | Nginx + OpenResty + Lua |
| 性能 | 极高（基于 Nginx，单节点可达 100K+ QPS） |
| 编程语言 | Lua（插件） |
| 配置方式 | RESTful Admin API |
| 插件开发 | Lua 脚本 |
| 优点 | 插件丰富，生态成熟，支持多种数据存储 |
| 缺点 | Lua 语言相对小众，架构复杂度高 |

```bash
# 典型配置
curl -X POST http://localhost:8001/services \
    --data "name=user-service" \
    --data "url=http://user-service:8080"

curl -X POST http://localhost:8001/routes \
    --data "service.name=user-service" \
    --data "paths[]=/api/user"

curl -X POST http://localhost:8001/routes/user-route/plugins \
    --data "name=rate-limiting" \
    --data "config.minute=100"
```

### Apache APISIX

**定位**：云原生 API 网关

| 特性 | 说明 |
|---|---|
| 架构 | Nginx + OpenResty + Lua，etcd 配置中心 |
| 性能 | 极高（优化过的 OpenResty，单节点可达 200K+ QPS） |
| 编程语言 | Lua（插件） |
| 配置方式 | Admin API + etcd |
| 插件开发 | Lua 脚本（支持热加载） |
| 优点 | 性能最优，支持热插件加载，云原生友好 |
| 缺点 | etcd 依赖，学习曲线较陡 |

```yaml
# 典型配置
routes:
  - id: user-route
    uri: /api/user/*
    upstream:
      type: roundrobin
      nodes:
        "user-service:8080": 1
plugins:
  rate-limiting:
    minute: 100
  jwt-auth:
    key: user-key
```

### Traefik

**定位**：云原生边缘路由器

| 特性 | 说明 |
|---|---|
| 架构 | Go 语言，异步处理 |
| 性能 | 中等（单节点约 20K QPS） |
| 编程语言 | Go |
| 配置方式 | 配置文件 / 标签 / Kubernetes CRD |
| 插件开发 | Go 插件或中间件 |
| 优点 | 云原生集成最佳，自动服务发现，配置简单 |
| 缺点 | 性能相对较低，插件生态较弱 |

```yaml
# docker-compose 标签方式
labels:
  - "traefik.http.routers.user-service.rule=PathPrefix(`/api/user`)"
  - "traefik.http.routers.user-service.middlewares=user-auth"
  - "traefik.http.middlewares.user-auth.basicauth.users=admin:$$apr1$$H6uskkkW$$IgXLP6ewTrSuBkTrqE8wj/"
```

## 横向对比

| 维度 | Spring Cloud Gateway | Kong | Apache APISIX | Traefik |
|---|---|---|---|---|
| 性能 | ★★★★ | ★★★★★ | ★★★★★ | ★★★ |
| Java 集成 | ★★★★★ | ★★ | ★★ | ★★ |
| 插件生态 | ★★★ | ★★★★★ | ★★★★ | ★★★ |
| 云原生支持 | ★★★ | ★★★★ | ★★★★★ | ★★★★★ |
| 学习曲线 | ★★★★ | ★★★ | ★★★ | ★★★★★ |
| 配置实时生效 | ★★★ | ★★★★ | ★★★★★ | ★★★★★ |
| 多语言支持 | ★★ | ★★★★★ | ★★★★★ | ★★★★ |
| 商业支持 | Datadog/VMware | Kong Inc. | API7.ai | Containous |

## 性能对比

> 以下数据基于公开基准测试，实际性能因硬件、网络、配置而异

| 网关 | QPS（8核机器） | P99 延迟 | 内存占用 |
|---|---|---|---|
| Spring Cloud Gateway | ~50,000 | ~10ms | 中等 |
| Kong | ~100,000 | ~5ms | 较高 |
| Apache APISIX | ~200,000 | ~2ms | 较低 |
| Traefik | ~20,000 | ~15ms | 较低 |

性能排名：**Apache APISIX > Kong > Spring Cloud Gateway > Traefik**

## 选型决策树

```
                    开始选型
                       │
                       ▼
            ┌─────────────────────┐
            │  技术栈是什么？      │
            └─────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   Spring/Java    多语言/跨平台    云原生/K8s
        │              │              │
        ▼              ▼              ▼
   ┌────────┐    ┌──────────┐   ┌──────────┐
   │ SC Gateway│   │ Kong/    │   │Traefik/  │
   │          │   │ APISIX   │   │APISIX    │
   └────────┘    └──────────┘   └──────────┘
        │              │              │
        ▼              ▼              ▼
    企业级需求？    需要插件生态？   自动服务发现？
        │              │              │
   ┌────┴────┐    ┌────┴────┐    ┌────┴────┐
   ▼         ▼    ▼         ▼    ▼         ▼
  SC Gateway Kong  APISIX  Traefik APISIX Traefik
```

## 场景推荐

### 场景一：Spring Cloud 微服务项目

**推荐**：Spring Cloud Gateway

理由：
- 与 Spring Cloud 其他组件无缝集成
- 使用 Java 开发，团队学习成本低
- 限流、熔断、认证等功能开箱即用

### 场景二：需要丰富插件生态

**推荐**：Kong

理由：
- 插件库最丰富（认证、限流、日志、安全等）
- 企业版提供额外功能和支持
- PostgreSQL + Redis 架构稳定可靠

### 场景三：追求极致性能

**推荐**：Apache APISIX

理由：
- 基于优化过的 Nginx，性能最优
- etcd 实现毫秒级配置同步
- 支持热插件加载，不需要重启

### 场景四：Kubernetes 环境

**推荐**：Traefik 或 Apache APISIX

理由：
- Traefik 与 Kubernetes 深度集成，配置最简单
- Apache APISIX Ingress Controller 功能丰富
- 自动服务发现，无需手动配置路由

### 场景五：混合云/多团队

**推荐**：Apache APISIX

理由：
- 支持多租户隔离
- etcd 集中配置，便于统一管理
- 性能足够支撑大流量场景

## 成本考量

除了技术因素，还要考虑成本：

| 成本类型 | Spring Cloud Gateway | Kong | APISIX | Traefik |
|---|---|---|---|---|
| 软件成本 | 开源免费 | 开源免费/企业版付费 | 开源免费/企业版付费 | 开源免费 |
| 运维成本 | 中等（Java 服务） | 较高（多组件） | 较高（etcd） | 较低（Go 单二进制） |
| 人力成本 | 中等 | 中等 | 较高（需要 Lua 能力） | 较低 |
| 硬件成本 | 中等 | 较高 | 较低 | 较低 |

## 迁移策略

如果需要从一个网关迁移到另一个：

```yaml
# 路由映射示例：Zuul → Spring Cloud Gateway
# Zuul
zuul:
  routes:
    user-service:
      path: /api/user/**
      url: http://user-service:8080

# Spring Cloud Gateway
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: http://user-service:8080
          predicates:
            - Path=/api/user/**
          filters:
            - StripPrefix=1
```

迁移检查清单：
- [ ] 路由规则一一对应
- [ ] 插件/过滤器功能迁移
- [ ] 认证方式兼容
- [ ] 上游服务配置迁移
- [ ] 监控指标对应
- [ ] 测试验证（灰度切换）

## 总结

| 场景 | 推荐选择 | 备选 |
|---|---|---|
| Spring Cloud 项目 | Spring Cloud Gateway | Kong |
| 企业级应用 | Kong | APISIX |
| 高性能需求 | Apache APISIX | Kong |
| Kubernetes 环境 | Traefik / APISIX | Kong |
| 快速上线 | Traefik | Spring Cloud Gateway |
| 多语言微服务 | Kong / APISIX | Traefik |

---

**留给你的问题**

网关选型是一个需要综合考虑的决策。假设你负责为一个 50 人团队的微服务项目选型网关：

- 项目使用 Spring Cloud
- 每天处理 1000 万次 API 调用
- 需要支持 API 认证、限流、日志审计
- 团队有 Java 开发者，但没有 Lua/Go 经验

**你会选择哪个网关？**请说明理由。

如果未来项目扩展到 10 倍规模，你需要如何应对？
