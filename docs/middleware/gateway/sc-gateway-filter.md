# Spring Cloud Gateway 过滤器

过滤器是 Spring Cloud Gateway 的灵魂。正是通过一个个过滤器，网关才能完成认证、限流、日志、熔断等各种功能。

Spring Cloud Gateway 的过滤器分为两类：**全局过滤器（GlobalFilter）** 和 **路由过滤器（GatewayFilter）**。

## 两类过滤器对比

| 特性 | GlobalFilter | GatewayFilter |
|---|---|---|
| 作用域 | 所有路由共享 | 绑定到特定路由 |
| 配置方式 | 实现接口 + @Component | YAML 配置或自定义工厂 |
| 执行时机 | 优先于路由过滤器 | 路由特有 |
| 典型应用 | 认证、日志、限流 | 路径重写、请求头修改 |

## 全局过滤器

全局过滤器对所有请求生效，常用于身份认证、日志记录、统一限流等场景。

### 内置全局过滤器

Spring Cloud Gateway 提供了一些开箱即用的全局过滤器：

| 过滤器 | 作用 |
|---|---|
| NettyWriteResponseFilter | 将代理响应写回客户端 |
| NettyRoutingFilter | 发送请求到后端服务 |
| WebsocketRoutingFilter | 处理 WebSocket 代理 |
| ForwardRoutingFilter | 处理 forward:// 协议 |
| LoadBalancerClientFilter | 实现客户端负载均衡 |
| GatewayMetricsFilter | 收集 Metrics 指标 |

### 自定义全局过滤器

实现 `GlobalFilter` 接口来自定义全局过滤器：

```java
@Component
@Slf4j
public class AuthGlobalFilter implements GlobalFilter, Ordered {
    
    @Autowired
    private JwtVerifier jwtVerifier;
    
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        // 1. 放行OPTIONS请求（跨域预检）
        if (exchange.getRequest().getMethod() == HttpMethod.OPTIONS) {
            return chain.filter(exchange);
        }
        
        // 2. 获取 Token
        String path = exchange.getRequest().getPath().value();
        
        // 3. 公开路径放行
        if (isPublicPath(path)) {
            return chain.filter(exchange);
        }
        
        // 4. 验证 Token
        String token = extractToken(exchange);
        if (token == null || !jwtVerifier.verify(token)) {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            exchange.getResponse().getHeaders().add("Content-Type", "application/json");
            String body = "{\"code\": 401, \"message\": \"Unauthorized\"}";
            return exchange.getResponse().writeWith(
                Mono.just(exchange.getResponse().bufferFactory().wrap(body.getBytes()))
            );
        }
        
        // 5. 解析用户信息并传递给后续过滤器
        UserPrincipal principal = jwtVerifier.parse(token);
        exchange.getAttributes().put("user", principal);
        
        return chain.filter(exchange);
    }
    
    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;  // 最高优先级，最先执行
    }
    
    private boolean isPublicPath(String path) {
        return path.startsWith("/api/auth/") 
            || path.startsWith("/api/public/")
            || path.equals("/health");
    }
    
    private String extractToken(ServerWebExchange exchange) {
        String bearer = exchange.getRequest().getHeaders().getFirst("Authorization");
        if (bearer != null &amp;&amp; bearer.startsWith("Bearer ")) {
            return bearer.substring(7);
        }
        return null;
    }
}
```

### 组合多个全局过滤器

```java
@Component
@Slf4j
public class LoggingGlobalFilter implements GlobalFilter, Ordered {
    
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        String traceId = UUID.randomUUID().toString();
        
        // 记录请求开始
        long startTime = System.currentTimeMillis();
        exchange.getAttributes().put("traceId", traceId);
        
        log.info("[{}] {} {} started", traceId, request.getMethod(), request.getPath());
        
        return chain.filter(exchange)
            // 请求结束后记录
            .doOnSuccess(v -&gt; {
                long duration = System.currentTimeMillis() - startTime;
                log.info("[{}] {} {} completed in {}ms", 
                    traceId, 
                    request.getMethod(), 
                    request.getPath(),
                    duration);
            })
            // 异常时记录
            .doOnError(e -&gt; {
                long duration = System.currentTimeMillis() - startTime;
                log.error("[{}] {} {} failed in {}ms: {}", 
                    traceId, 
                    request.getMethod(), 
                    request.getPath(),
                    duration,
                    e.getMessage());
            });
    }
    
    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 1;  // 在认证之后执行
    }
}
```

## 路由过滤器

路由过滤器绑定到特定路由，需要通过 `GatewayFilterFactory` 创建。

### 内置路由过滤器

Spring Cloud Gateway 提供了丰富的内置过滤器：

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: example-route
          uri: http://example-service:8080
          filters:
            # 1. StripPrefix - 去掉 URL 前缀
            - StripPrefix=1
            
            # 2. PrefixPath - 添加 URL 前缀
            - PrefixPath=/api
            
            # 3. AddRequestHeader - 添加请求头
            - AddRequestHeader=X-Gateway, SpringCloudGateway
            
            # 4. AddResponseHeader - 添加响应头
            - AddResponseHeader=X-Response-Time, LocalDateTime.now().toString()
            
            # 5. RemoveRequestHeader - 移除请求头
            - RemoveRequestHeader=X-Internal-Header
            
            # 6. SetRequestHeader - 修改请求头
            - SetRequestHeader=X-Version, v2
            
            # 7. SetResponseHeader - 修改响应头
            - SetResponseHeader=Cache-Control, max-age=3600
            
            # 8. AddRequestParameter - 添加请求参数
            - AddRequestParameter=region, us-east
            
            # 9. RedirectTo - 重定向
            - RedirectTo=302, https://new-domain.com
            
            # 10. RewritePath - 重写路径
            - RewritePath=/old/(?&lt;segment&gt;.*), /new/${segment}
            
            # 11. SetPath - 设置路径
            - SetPath=/new/path
```

### 自定义路由过滤器

通过继承 `AbstractGatewayFilterFactory` 创建自定义过滤器：

```java
// 1. 定义配置类
public class RequestRateLimiterGatewayFilterFactory 
    extends AbstractGatewayFilterFactory&lt;RequestRateLimiterGatewayFilterFactory.Config&gt; {
    
    public static class Config {
        private int qps = 1000;
        private int burstCapacity = 2000;
        
        // getter/setter
    }
    
    @Override
    public Class&lt;Config&gt; getConfigClass() {
        return Config.class;
    }
    
    @Override
    public GatewayFilter apply(Config config) {
        // 使用配置创建过滤器
        TokenBucketRateLimiter limiter = new TokenBucketRateLimiter(
            config.getQps(), 
            config.getBurstCapacity()
        );
        
        return (exchange, chain) -&gt; {
            String key = extractKey(exchange);
            
            if (!limiter.tryAcquire(key)) {
                exchange.getResponse().setStatusCode(HttpStatus.TOO_MANY_REQUESTS);
                return exchange.getResponse().setComplete();
            }
            
            return chain.filter(exchange);
        };
    }
    
    private String extractKey(ServerWebExchange exchange) {
        // 可以根据用户、IP 等维度限流
        String userId = exchange.getAttribute("userId");
        return userId != null ? userId : exchange.getRequest().getRemoteAddress().getAddress().getHostAddress();
    }
}
```

```yaml
# 使用自定义过滤器
spring:
  cloud:
    gateway:
      routes:
        - id: limited-route
          uri: http://service:8080
          filters:
            - name: RequestRateLimiter
              args:
                qps: 100
                burstCapacity: 200
```

### 带参数的过滤器

如果过滤器需要多个参数，可以使用命名参数语法：

```java
public class ValidateRequestGatewayFilterFactory 
    extends AbstractGatewayFilterFactory&lt;ValidateRequestGatewayFilterFactory.Config&gt; {
    
    public static class Config {
        private boolean validateHeader;
        private boolean validateBody;
        private String errorMessage;
        
        // getter/setter
    }
    
    @Override
    public List&lt;String&gt; newField() {
        return Arrays.asList("validateHeader", "validateBody", "errorMessage");
    }
    
    @Override
    public GatewayFilter apply(Config config) {
        return (exchange, chain) -&gt; {
            if (config.isValidateHeader() &amp;&amp; !validateHeaders(exchange)) {
                return errorResponse(exchange, config.getErrorMessage());
            }
            
            if (config.isValidateBody() &amp;&amp; !validateBody(exchange)) {
                return errorResponse(exchange, config.getErrorMessage());
            }
            
            return chain.filter(exchange);
        };
    }
}
```

```yaml
filters:
  - ValidateRequest=true, true, "Invalid request"  # 注意顺序
  # 或使用命名参数
  - name: ValidateRequest
    args:
      validateHeader: true
      validateBody: true
      errorMessage: Invalid request
```

## 过滤器执行顺序

过滤器的执行顺序由 `getOrder()` 方法决定：

```java
// 常用排序常量
Ordered.HIGHEST_PRECEDENCE        // -2147483648
Ordered.HIGH_PRECEDENCE           // -10000
Ordered.HIGHEST_PRECEDENCE + 1    // -2147483647
Ordered.LOW_PRECEDENCE            // 10000
Ordered.LOWEST_PRECEDENCE         // 2147483647
```

Spring Cloud Gateway 内置过滤器的排序：

```
-2147483648  NettyRoutingFilter
-2147483647  NettyWriteResponseFilter
-2147483646  ForwardRoutingFilter
...其他内置 Filter...
0            RouteToRequestUrlFilter
1            LoadBalancerClientFilter
10000        WebsocketRoutingFilter
...你的自定义 Filter...
```

## 总结

| 过滤器类型 | 创建方式 | 作用域 | 配置方式 |
|---|---|---|---|
| GlobalFilter | 实现 GlobalFilter 接口 | 所有路由 | @Component |
| GatewayFilter | 继承 AbstractGatewayFilterFactory | 特定路由 | YAML 或 new |
| 内置过滤器 | 开箱即用 | 多种 | YAML |

---

**留给你的问题**

全局过滤器和路由过滤器各有优缺点：

- 全局过滤器：复用性高，但可能对不需要它的路由也执行了
- 路由过滤器：精准控制，但每个路由都要单独配置

**如果你需要在 100 个路由中的 50 个添加同样的功能，你会选择全局过滤器还是路由过滤器？为什么？**
