# Spring Cloud Gateway 工作流程

你有没有想过，当你发送一个 HTTP 请求到 Spring Cloud Gateway 时，背后发生了什么？

答案就在三个核心概念里：**Route（路由）**、**Predicate（谓词）**、**Filter（过滤器）**。

理解了这三者的工作流程，你就掌握了 Spring Cloud Gateway 的精髓。

## 三剑客：Route、Predicate、Filter

Spring Cloud Gateway 的设计哲学可以用一句话概括：

> **当请求匹配某个路由的谓词时，执行该路由的过滤器链。**

```
                    ┌─────────────────────────────────────┐
                    │         Gateway HandlerMapping       │
                    │  ┌─────────────────────────────────┐ │
请求 ───────────────▶ │  │ Route #1: /api/user/**          │ │
                    │  │   Predicate: Path=/api/user/**   │ │
                    │  │   Filters: [Auth, RateLimit, ...]│ │
                    │  └─────────────────────────────────┘ │
                    │  ┌─────────────────────────────────┐ │
                    │  │ Route #2: /api/order/**          │ │
                    │  │   Predicate: Path=/api/order/**  │ │
                    │  │   Filters: [Auth, RateLimit, ...]│ │
                    │  └─────────────────────────────────┘ │
                    └─────────────────────────────────────┘
                                       │
                                       │ 找到匹配的 Route
                                       ▼
                    ┌─────────────────────────────────────┐
                    │         Gateway Web Handler          │
                    │                                     │
                    │  1. 执行 Pre Filters（倒序）        │
                    │     Filter 1 → Filter 2 → Filter 3  │
                    │                                     │
                    │  2. 发送代理请求到后端服务           │
                    │                                     │
                    │  3. 执行 Post Filters（正序）        │
                    │     Filter 3 → Filter 2 → Filter 1  │
                    └─────────────────────────────────────┘
                                       │
                                       ▼
                                    响应
```

## 工作流程详解

### 第一步：请求进入 HandlerMapping

当请求到达网关时，首先进入 `RoutePredicateHandlerMapping`，它负责找到与请求匹配的路由。

```java
// RoutePredicateHandlerMapping 的简化逻辑
@Override
protected Mono&lt;Handler&gt; getHandlerInternal(ServerWebExchange exchange) {
    // 1. 获取请求路径
    String path = exchange.getRequest().getPath().pathWithinApplication().value();
    
    // 2. 遍历所有路由，找到匹配的
    return flux
        .filter(r -&gt; r.getPredicate().test(exchange))  // Predicate 判断
        .next()
        .map(r -&gt; new FilteringWebHandler(r));  // 返回处理器
}
```

### 第二步：Predicate 匹配

Predicate（谓词）是路由的「准入条件」。Spring Cloud Gateway 内置了丰富的 Predicate：

| Predicate | 作用 | 示例 |
|---|---|---|
| Path | 路径匹配 | `Path=/api/user/**` |
| Header | 请求头匹配 | `Header=X-Request-Id, \d+` |
| Query | 查询参数匹配 | `Query=format, json` |
| Method | HTTP 方法匹配 | `Method=GET,POST` |
| Host | 主机名匹配 | `Host=*.example.com` |
| Cookie | Cookie 匹配 | `Cookie=session, abc.*` |
| Before/After/Between | 时间窗口 | `Between=2024-01-01T00:00:00Z, 2024-12-31T23:59:59Z` |
| RemoteAddr | IP 地址匹配 | `RemoteAddr=192.168.1.0/24` |

### 第三步：执行过滤器链

找到匹配的路由后，`FilteringWebHandler` 会执行该路由的过滤器链：

```java
// FilteringWebHandler 核心逻辑
public class FilteringWebHandler {
    
    // 全局过滤器列表（所有路由共享）
    private final List&lt;GatewayFilter&gt; globalFilters;
    
    public Mono&lt;Void&gt; handle(ServerWebExchange exchange) {
        // 1. 获取路由特有的过滤器
        List&lt;GatewayFilter&gt; routeFilters = route.getFilters();
        
        // 2. 合并全局过滤器和路由过滤器
        List&lt;GatewayFilter&gt; allFilters = new ArrayList&lt;&gt;();
        allFilters.addAll(globalFilters);
        allFilters.addAll(routeFilters);
        
        // 3. 排序（@Order 注解或 Ordered 接口）
        allFilters.sort(Comparator.comparingInt(f -&gt; {
            if (f instanceof Ordered) {
                return ((Ordered) f).getOrder();
            }
            return Ordered.LOWEST_PRECEDENCE;
        }));
        
        // 4. 构建过滤器链并执行
        return new DefaultGatewayFilterChain(allFilters, 0).filter(exchange);
    }
}
```

### 第四步：代理请求

过滤器链执行完毕后，`NettyRoutingFilter` 负责将请求转发到后端服务：

```java
// 代理请求的核心逻辑
public class NettyRoutingFilter {
    
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        // 1. 获取目标 URL
        URI uri = exchange.getAttribute(GATEWAY_REQUEST_URL_ATTR);
        
        // 2. 创建代理请求
        HttpClient.RequestSender requestSender = HttpClient.create()
            .headers(addHeaders);
        
        // 3. 发送请求并获取响应
        return requestSender.send()
            .doOnNext(response -&gt; {
                // 保存响应供后续 Post Filter 使用
                exchange.getAttributes().put("gateway_response", response);
            })
            .then(chain.filter(exchange));  // 继续执行 Post Filters
    }
}
```

## Filter 的执行顺序

过滤器分为两种类型，执行顺序不同：

### Pre Filters（请求前过滤器）

按 **@Order 降序** 执行（即 Order 值越小越先执行）：

```
全局 Filter #1 (Order=1)  ──▶  全局 Filter #2 (Order=2)  ──▶  路由 Filter #1 (Order=3)
```

### Post Filters（请求后过滤器）

按 **@Order 升序** 执行（即 Order 值越小越后执行）：

```
路由 Filter #1 (Order=3)  ──▶  全局 Filter #2 (Order=2)  ──▶  全局 Filter #1 (Order=1)
```

### 完整执行流程

```
请求进入
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Pre Filters（Order 升序：1 → 2 → 3）                    │
│                                                         │
│   @Order(1) GlobalFilter A  ──▶  @Order(2) GlobalFilter B │
│                                    ──▶  @Order(3) RouteFilter │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│              后端服务调用                                 │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ Post Filters（Order 降序：3 → 2 → 1）                   │
│                                                         │
│   @Order(3) RouteFilter  ──▶  @Order(2) GlobalFilter B   │
│                                ──▶  @Order(1) GlobalFilter A │
└─────────────────────────────────────────────────────────┘
    │
    ▼
   响应
```

## 配置示例

一个典型的 Spring Cloud Gateway 配置：

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: http://user-service:8080
          order: 1  # 路由优先级，越小越先匹配
          predicates:
            - Path=/api/user/**
            - Method=GET,POST
            - Header=X-Internal-Service, true
          filters:
            - StripPrefix=1  # 去掉第一层路径
            - AddRequestHeader=X-Gateway, SpringCloudGateway
            
        - id: order-service
          uri: lb://order-service  # lb:// 表示使用负载均衡
          predicates:
            - Path=/api/order/**
          filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 100
                redis-rate-limiter.burstCapacity: 200
```

## 总结

Spring Cloud Gateway 的工作流程可以用一个公式概括：

```
请求 = 路由匹配 (Predicate) + 过滤器链 (Filter) + 代理转发 (Route)
```

| 组件 | 作用 | 位置 |
|---|---|---|
| Route | 定义一条路由规则，包含 URI、Predicates、Filters | 配置或代码 |
| Predicate | 判断请求是否匹配该路由 | Route 内 |
| Filter | 在请求/响应前后执行处理逻辑 | Route 内或全局 |
| HandlerMapping | 找到匹配的 Route | 框架提供 |
| FilteringWebHandler | 执行 Filter 链 | 框架提供 |
| NettyRoutingFilter | 执行实际代理请求 | 框架提供 |

---

**留给你的问题**

思考一下：为什么 Pre Filter 按 Order 升序执行，而 Post Filter 按 Order 降序执行？

这涉及到嵌套执行的问题——如果 Filter A 调用了 `chain.filter()` 再执行后续逻辑，那么 A 的后置逻辑应该最后执行。这就是为什么需要不同的排序策略。
