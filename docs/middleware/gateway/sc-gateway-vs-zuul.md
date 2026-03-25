# Spring Cloud Gateway 与 Zuul

如果你在 Spring Cloud 项目中使用过 API 网关，很可能听过两个名字：**Zuul** 和 **Spring Cloud Gateway**。

Zuul 是 Netflix 开发的网关，曾是微服务架构的标配。但 2018 年之后，Spring 官方推荐转向 Spring Cloud Gateway。

为什么？它们之间有什么区别？本文带你深入对比。

## 历史回顾

| 时间 | 事件 | 影响 |
|---|---|---|
| 2013 | Netflix 开源 Zuul 1.x | 成为微服务网关的事实标准 |
| 2016 | Spring Cloud 整合 Zuul | Spring Cloud Gateway 项目启动 |
| 2018 | Netflix 停止维护 Zuul 1.x | Spring 转向自研网关 |
| 2019 | Spring Cloud Gateway GA | 成为官方推荐的网关方案 |
| 2020 | Zuul 2.x 开源 | 但已错过最佳时机 |

## 核心架构对比

### Zuul 1.x：同步阻塞模式

```
                    ┌──────────────────────────────────┐
                    │           Zuul Server            │
                    │                                  │
请求 ───────────────▶│ ┌─────────┐  ┌─────────┐  ┌─────┐ │
                    │ │ Router  │→ │ Filter  │→ │     │ │
                    │ │ 路由    │  │ 过滤器  │  │     │ │
                    │ └─────────┘  └─────────┘  │     │ │
                    │                          │     │ │
                    │  ┌─────────┐  ┌─────────┐│     │ │
                    │  │ Pre     │→ │ Post    ││     │ │
                    │  │ 过滤    │  │ 过滤    ││     │ │
                    │  └─────────┘  └─────────┘│     │ │
                    │                          │     │ │
                    │  ┌─────────────────────┐ │     │ │
                    │  │  Synchronous Queue  │→│     │ │
                    │  │  同步队列            │ │     │ │
                    │  └─────────────────────┘ │     │ │
                    │                          └─────┘ │
                    └──────────────────────────────────┘
                                                 │
                                                 ▼
                                            后端服务
```

Zuul 1.x 使用同步阻塞模式，每个请求占用一个线程直到请求完成。

### Spring Cloud Gateway：响应式非阻塞模式

```
                    ┌──────────────────────────────────┐
                    │        Spring Cloud Gateway       │
                    │                                    │
                    │  ┌──────────────────────────────┐ │
请求 ───────────────▶│  │   Netty (Event Loop Group)   │ │
                    │  │   Netty 事件循环              │ │
                    │  └──────────────────────────────┘ │
                    │                │                   │
                    │                ▼                   │
                    │  ┌──────────────────────────────┐ │
                    │  │  HandlerMapping + FilterChain  │ │
                    │  │  处理器映射 + 过滤器链          │ │
                    │  └──────────────────────────────┘ │
                    │                │                   │
                    │                ▼                   │
                    │  ┌──────────────────────────────┐ │
                    │  │    Reactive Pipeline          │ │
                    │  │    响应式管道（非阻塞）         │ │
                    │  └──────────────────────────────┘ │
                    └──────────────────────────────────┘
                                                 │
                                                 ▼
                                            后端服务
```

Spring Cloud Gateway 基于 WebFlux，使用 Netty 进行异步非阻塞处理。

## 性能对比

性能是选择网关的重要因素：

### 基准测试结果

| 指标 | Zuul 1.x | Spring Cloud Gateway | 提升 |
|---|---|---|---|
| QPS（8核机器） | ~15,000 | ~50,000 | 3.3x |
| 平均延迟 | 30ms | 8ms | 3.75x |
| P99 延迟 | 150ms | 25ms | 6x |
| 内存占用 | 高（线程栈） | 低（事件驱动） | - |
| CPU 利用率 | 中等 | 较低 | - |

### 性能差异原因

```java
// Zuul 1.x：同步阻塞
public class UserZuulFilter extends ZuulFilter {
    @Override
    public Object run() {
        // 每个请求占用一个线程
        // 线程等待 I/O 时阻塞
        RequestContext ctx = RequestContext.getCurrentContext();
        HttpClient httpClient = new DefaultHttpClient();
        
        // 同步调用，阻塞等待响应
        HttpResponse response = httpClient.execute(getRequest(ctx));
        ctx.setResponseDataStream(response.getEntity().getContent());
        
        return null;
    }
}
```

```java
// Spring Cloud Gateway：异步非阻塞
public class UserWebFilter implements WebFilter {
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, WebFilterChain chain) {
        // 单线程处理多个请求
        // 不阻塞，利用回调处理
        return webClient.get()
            .uri("http://user-service" + exchange.getRequest().getPath())
            .retrieve()
            .bodyToMono(String.class)  // 返回 Mono，不阻塞线程
            .flatMap(body -&gt; {
                exchange.getResponse().getHeaders().add("X-User", "gateway");
                return chain.filter(exchange);
            });
    }
}
```

## 功能对比

| 功能 | Zuul 1.x | Spring Cloud Gateway | 说明 |
|---|---|---|---|
| 路由配置 | YAML/Java DSL | YAML/Java DSL | 都能配置 |
| 过滤器 | Pre/Post/Error | Pre/Post | 概念相似 |
| 限流 | 社区插件 | 内置 Redis 限流 | SCG 更完善 |
| 熔断 | Hystrix | Resilience4j | 集成更好 |
| WebSocket | 支持 | 支持 | - |
| 热更新 | 支持（routes refresh） | 支持 | - |
| 动态路由 | 支持 | 支持 | - |

## 过滤器对比

### Zuul 1.x 过滤器

```java
// Zuul 过滤器示例
@Component
public class AuthZuulFilter extends ZuulFilter {
    
    @Override
    public String filterType() {
        return "pre";  // pre、post、error
    }
    
    @Override
    public int filterOrder() {
        return 1;  // 数字越小越先执行
    }
    
    @Override
    public boolean shouldFilter() {
        // 判断是否需要执行此过滤器
        return RequestContext.getCurrentContext()
            .getRequest().getRequestURI().startsWith("/api/");
    }
    
    @Override
    public Object run() {
        // 过滤逻辑
        RequestContext ctx = RequestContext.getCurrentContext();
        String token = ctx.getRequest().getHeader("Authorization");
        
        if (!jwtVerifier.verify(token)) {
            ctx.setSendZuulResponse(false);  // 不继续路由
            ctx.setResponseStatusCode(401);
            ctx.setResponseBody("{\"error\": \"Unauthorized\"}");
        }
        return null;
    }
}
```

### Spring Cloud Gateway 过滤器

```java
// Gateway 过滤器示例
@Component
public class AuthGatewayFilter implements GlobalFilter, Ordered {
    
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getPath().value();
        
        if (path.startsWith("/api/")) {
            String token = exchange.getRequest().getHeaders().getFirst("Authorization");
            
            if (!jwtVerifier.verify(token)) {
                exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
                exchange.getResponse().getHeaders().add("Content-Type", "application/json");
                String body = "{\"error\": \"Unauthorized\"}";
                return exchange.getResponse().writeWith(
                    Mono.just(exchange.getResponse().bufferFactory().wrap(body.getBytes()))
                );
            }
        }
        
        return chain.filter(exchange);
    }
    
    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;
    }
}
```

## Zuul 2.x 的尝试

Zuul 2.x 改用了异步非阻塞模式，试图追赶 Spring Cloud Gateway：

```java
// Zuul 2.x 异步过滤器
public class AsyncAuthFilter extends ZuulFilter {
    
    @Override
    public FilterType filterType() {
        return FilterType.PRE;
    }
    
    @Override
    public int filterOrder() {
        return 1;
    }
    
    @Override
    public boolean shouldFilter(RequestContext context) {
        return context.getRequestPath().startsWith("/api/");
    }
    
    @Override
    public Publisher&lt;Void&gt; run渐FilterContext context) {
        // 返回 Publisher（Flux/Mono），实现异步处理
        return jwtVerifier.verifyAsync(context.getAuthorization())
            .flatMap(valid -&gt; {
                if (valid) {
                    return Mono.empty();  // 继续
                } else {
                    context.setResponseStatusCode(401);
                    return Mono.error(new UnauthorizedException());
                }
            });
    }
}
```

但 Zuul 2.x 已经太晚了：

1. Spring Cloud Gateway 已经成熟
2. Zuul 2.x 与 Spring Cloud 集成不够好
3. 社区活跃度低

## 选型建议

| 场景 | 推荐 | 理由 |
|---|---|---|
| 新项目（Spring Cloud） | Spring Cloud Gateway | 官方推荐，原生集成 |
| 老项目迁移 | 逐步迁移到 SCG | Zuul 1.x 已停止维护 |
| 非 Spring 技术栈 | Kong / Traefik | 跨语言支持更好 |
| 需要插件生态 | Kong | 插件丰富，Lua 编写灵活 |
| 极致性能 | Apache APISIX | 基于 Nginx，性能最优 |

## 迁移方案

如果要从 Zuul 迁移到 Spring Cloud Gateway：

```yaml
# Zuul 配置
zuul:
  routes:
    user-service:
      path: /api/user/**
      url: http://user-service:8080
    order-service:
      path: /api/order/**
      serviceId: order-service

# Spring Cloud Gateway 配置
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: http://user-service:8080
          predicates:
            - Path=/api/user/**
        
        - id: order-service
          uri: lb://order-service  # 注意：SCG 推荐使用 lb://
          predicates:
            - Path=/api/order/**
```

迁移检查清单：

- [ ] 路由配置一一映射
- [ ] 自定义过滤器重写为 GatewayFilter
- [ ] Zuul Filter 执行顺序映射
- [ ] 限流/熔断配置迁移
- [ ] 监控指标对应

## 总结

| 对比项 | Zuul 1.x | Spring Cloud Gateway |
|---|---|---|
| 架构模式 | 同步阻塞 | 异步非阻塞 |
| 性能 | 中等 | 高 |
| Spring 集成 | 好 | 更好 |
| 维护状态 | 停止 | 活跃 |
| 适用场景 | 遗留项目 | 新项目 |

---

**留给你的问题**

Spring Cloud Gateway 虽然性能更好，但也带来了一些挑战：

1. 响应式编程（WebFlux）学习曲线较陡
2. 部分同步库无法直接使用
3. Debug 难度增加

**如果让你选择，你会为了性能选择 Spring Cloud Gateway，还是为了团队学习曲线选择 Zuul（假设还没停止维护）？**
