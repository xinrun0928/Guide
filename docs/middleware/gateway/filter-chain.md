# 网关过滤器链

想象你去机场安检。你需要：

1. 先排队检查机票和身份证
2. 把行李放进 X 光机检查
3. 人走过金属探测器
4. 可能还需要脱鞋检查（如果警报响了）

每一个检查点就像一个「过滤器」，只有通过所有检查，你才能登上飞机。**过滤器链（Filter Chain）** 就是网关的「安检流程」。

## 为什么需要过滤器链？

一个请求经过网关时，可能需要做很多事情：

- 验证请求是否合法
- 提取用户信息
- 记录请求日志
- 限流检查
- 熔断判断
- 转发到后端服务
- 记录响应日志
- 处理异常

如果把所有逻辑都写在一个方法里，代码会变成一团乱麻。**过滤器链模式**把这些逻辑拆分成独立的过滤器，串行执行，职责清晰，易于扩展。

## 过滤器分类：Pre 与 Post

过滤器按照执行时机分为两类：

### Pre 过滤器：请求进来时执行

在请求被转发到后端服务之前执行，主要做「检查」和「准备」：

| Pre 过滤器 | 功能 | 典型场景 |
|---|---|---|
| 身份认证 | 验证请求者身份 | JWT 验证、API Key 检查 |
| 权限校验 | 检查是否有权访问 | RBAC、ABAC |
| 限流检查 | 是否超过速率限制 | 令牌桶、滑动窗口 |
| 请求转换 | 改写请求内容 | 添加 Header、修改路径 |
| 日志记录 | 记录请求开始 | TraceId、请求时间 |

### Post 过滤器：响应返回时执行

在从后端服务获得响应之后、执行返回给客户端之前执行，主要做「处理」和「记录」：

| Post 过滤器 | 功能 | 典型场景 |
|---|---|---|
| 响应转换 | 改写响应内容 | 添加 Header、修改状态码 |
| 日志记录 | 记录响应结果 | 请求耗时、响应码 |
| 错误处理 | 统一处理异常 | 异常转换、错误页面 |
| 指标采集 | 收集监控数据 | QPS、延迟统计 |
| 协议转换 | 转换响应格式 | JSON → XML |

```
客户端请求
      │
      ▼
┌─────────────────────────────────────┐
│           Pre 过滤器链              │
│  1. 日志记录（开始）                │
│  2. 身份认证                        │
│  3. 限流检查                        │
│  4. 请求转换                        │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│          后端服务调用               │
│  http://backend-service/api         │
└─────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────┐
│          Post 过滤器链              │
│  1. 日志记录（结束）                │
│  2. 响应转换                        │
│  3. 指标采集                        │
│  4. 错误处理（如果出错）            │
└─────────────────────────────────────┘
      │
      ▼
   客户端响应
```

## 过滤器链的实现

### 经典模式：责任链模式

每个过滤器都实现统一的接口，形成链表结构：

```java
// 过滤器接口
public interface GatewayFilter {
    Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain);
}

// 过滤器链
public interface GatewayFilterChain {
    Mono&lt;Void&gt; filter(ServerWebExchange exchange);
}

// 链式执行
public class DefaultGatewayFilterChain implements GatewayFilterChain {
    
    private final List&lt;GatewayFilter&gt; filters;
    private final int index;  // 当前执行到的位置
    
    public DefaultGatewayFilterChain(List&lt;GatewayFilter&gt; filters, int index) {
        this.filters = filters;
        this.index = index;
    }
    
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange) {
        if (index &gt;= filters.size()) {
            // 链已执行完毕，继续后续处理
            return Mono.empty();
        }
        
        GatewayFilter filter = filters.get(index);
        // 递归调用下一个过滤器，形成链式执行
        return filter.filter(exchange, new DefaultGatewayFilterChain(filters, index + 1));
    }
}
```

### 执行流程图

```
filter(exchange, chain)
      │
      ├──▶ 执行当前过滤器逻辑
      │         │
      │         ▼
      │    chain.filter(exchange)
      │         │
      │         ├──▶ 调用下一个过滤器的 filter
      │         │         │
      │         │         ▼
      │         │    返回时执行当前过滤器的后置逻辑
      │         │
      │         ▼
      └──▶ 返回
```

## 过滤器链的顺序

过滤器链中，**顺序至关重要**。常见的顺序约定：

### 通用顺序

```
1. Netty Write 过滤器（底层网络）
2. Debug 过滤器（调试）
3. 限流过滤器（尽早拦截）
4. 认证过滤器（身份验证）
5. 权限过滤器（权限校验）
6. 请求转换过滤器（修改请求）
7. 路由过滤器（转发请求）  ← 分界线：之前是 Pre，之后是 Post
8. 响应转换过滤器（修改响应）
9. 指标过滤器（采集数据）
10. 日志过滤器（记录日志）
```

### 为什么限流要放在认证之前？

这是一个常见的误区。正确的做法是**限流应该在认证之后**：

| 顺序 | 理由 |
|---|---|
| 认证 → 限流 | 根据用户身份限流，可以区分不同用户 |
| 限流 → 认证 | 所有请求共用限流配额，无法精细化控制 |

```java
// 正确的顺序
@Component
@Order(1)
public class AuthFilter implements GlobalFilter { /* 认证逻辑 */ }

@Component
@Order(2)
public class RateLimitFilter implements GlobalFilter { /* 限流逻辑 */ }
```

## 短路与异常处理

过滤器链的一个重要特性是**短路**：如果某个过滤器决定拒绝请求，可以直接返回，不继续执行后续过滤器。

```java
@Component
public class AuthFilter implements GlobalFilter {
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String token = exchange.getRequest().getHeaders().getFirst("Authorization");
        
        if (token == null || !jwtVerifier.verify(token)) {
            // 认证失败，直接返回 401，不再继续执行后续过滤器
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            return exchange.getResponse().setComplete();
        }
        
        // 认证通过，继续执行后续过滤器
        return chain.filter(exchange);
    }
}
```

### 异常处理过滤器

通常在过滤器链的末尾放置一个异常处理过滤器：

```java
@Component
@Order(Ordered.LOWEST_PRECEDENCE)  // 最低优先级，最后执行
public class ErrorHandleFilter implements GlobalFilter {
    
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        return chain.filter(exchange)
            // 捕获异常，统一处理
            .onErrorResume(e -&gt; {
                log.error("Request error: {}", e.getMessage(), e);
                
                ServerHttpResponse response = exchange.getResponse();
                response.setStatusCode(HttpStatus.INTERNAL_SERVER_ERROR);
                response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
                
                String body = String.format(
                    "{\"code\": 500, \"message\": \"%s\"}", 
                    e.getMessage()
                );
                return response.writeWith(
                    Mono.just(response.bufferFactory().wrap(body.getBytes()))
                );
            });
    }
}
```

## 过滤器链的并发处理

Spring Cloud Gateway 基于 WebFlux，使用响应式编程模型。过滤器的执行是非阻塞的：

```java
@Override
public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
    // 同步方式：等所有过滤器都执行完才返回
    return chain.filter(exchange);
}

// 但在过滤器内部，应该使用异步方式
public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
    // 好的写法：使用 WebClient 发起异步请求
    return webClient.get()
        .uri("http://backend" + exchange.getRequest().getPath())
        .retrieve()
        .bodyToMono(String.class)
        .flatMap(response -&gt; {
            // 处理响应后继续
            exchange.getResponse().getHeaders().add("X-Response-From", "gateway");
            return chain.filter(exchange);
        });
}
```

## 动态过滤器配置

生产环境中，过滤器的启用/禁用、参数调整应该支持动态配置：

```yaml
# 配置文件方式
spring:
  cloud:
    gateway:
      default-filters:
        - name: RequestRateLimiter
          args:
            redis-rate-limiter.replenishRate: 100
            redis-rate-limiter.burstCapacity: 200
        - name: CircuitBreaker
          args:
            name: backendCircuit
            fallbackUri: forward:/fallback
```

```java
// 数据库配置 + 动态刷新
@Configuration
public class DynamicFilterConfig {
    
    @Value("${filters.auth.enabled:true}")
    private boolean authEnabled;
    
    @Value("${filters.ratelimit.qps:1000}")
    private int qps;
    
    @Bean
    public RouteLocator customRouteLocator(RouteLocatorBuilder builder) {
        return builder.routes()
            .route("dynamic-route", r -&gt; r.path("/api/**")
                .filters(f -&gt; {
                    if (authEnabled) {
                        f.filter(new AuthFilter());
                    }
                    f.filter(new RateLimitFilter(qps));
                    return f;
                })
                .uri("http://backend:8080"))
            .build();
    }
}
```

## 总结

过滤器链的核心要点：

| 要点 | 说明 |
|---|---|
| 职责分离 | 每个过滤器只负责一个功能 |
| 顺序重要 | Pre 过滤器在请求前，Post 过滤器在响应后 |
| 短路机制 | 可以中途终止，不再执行后续过滤器 |
| 非阻塞 | 使用 Mono/Flux 实现异步处理 |
| 可配置 | 顺序和参数应该可动态调整 |

---

**留给你的问题**

过滤器链的模式看起来很美好，但实际使用中有几个常见问题：

1. 如果两个过滤器的顺序搞反了，会有什么后果？
2. 如何在不影响现有过滤器的情况下，新增一个过滤器？
3. 如果过滤器链中某个过滤器执行失败，是否应该回滚已经执行过的过滤器？

这些问题涉及到过滤器链的**可维护性**和**事务性**，值得深入思考。
