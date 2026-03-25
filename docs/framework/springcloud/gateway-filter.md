# Gateway 过滤器，GlobalFilter 与 GatewayFilter 链

> 网关过滤器是 Gateway 的精髓。通过过滤器，你可以实现认证、限流、日志、熔断等各种功能。
>
> 但过滤器那么多，它们是怎么串联起来的？优先级又是谁先谁后？

---

## 过滤器分类

Gateway 的过滤器分为两类：

```
┌─────────────────────────────────────────────────────────┐
│                    Gateway 过滤器                         │
│                                                          │
│  ┌─────────────────────┐    ┌─────────────────────┐    │
│  │   GatewayFilter     │    │   GlobalFilter      │    │
│  │   （局部过滤器）      │    │   （全局过滤器）      │    │
│  │                     │    │                     │    │
│  │   绑定到特定路由      │    │   作用于所有路由     │    │
│  │   配置在路由下        │    │   自动生效           │    │
│  └─────────────────────┘    └─────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

| 类型 | 作用范围 | 配置方式 | 示例 |
|---|---|---|---|
| GatewayFilter | 单个路由 | 在路由的 filters 中配置 | StripPrefix、AddRequestHeader |
| GlobalFilter | 所有路由 | 实现 GlobalFilter 接口 | 认证、负载均衡 |

---

## 过滤器执行顺序

### 执行流程

```
┌─────────────────────────────────────────────────────────────────┐
│                      过滤器链执行顺序                              │
│                                                                  │
│  ┌──────────┐                                                    │
│  │  请求    │                                                    │
│  └────┬─────┘                                                    │
│       │                                                          │
│       ▼  Pre 阶段（请求处理前）                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  GlobalFilter A (order=1)                                │   │
│  │  GlobalFilter B (order=2)                                │   │
│  │  GatewayFilter 1                                        │   │
│  │  GatewayFilter 2                                        │   │
│  │  ...                                                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│       │                                                          │
│       ▼                                                          │
│  ┌──────────┐                                                    │
│  │ 后端服务  │                                                    │
│  └────┬─────┘                                                    │
│       │                                                          │
│       ▼  Post 阶段（响应处理后）                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  GatewayFilter 2 (响应处理)                             │   │
│  │  GatewayFilter 1 (响应处理)                             │   │
│  │  GlobalFilter B (响应处理)                              │   │
│  │  GlobalFilter A (响应处理)                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│       │                                                          │
│       ▼                                                          │
│  ┌──────────┐                                                    │
│  │  响应    │                                                    │
│  └──────────┘                                                    │
└─────────────────────────────────────────────────────────────────┘
```

**两个关键阶段**：

1. **Pre 阶段**：请求被转发到后端之前执行（认证、限流、修改请求）
2. **Post 阶段**：响应返回之前执行（日志、添加响应头）

### 优先级计算

```java
// 优先级公式
// 数字越小，优先级越高
int order = max(-2147483648, min(2147483647, value));
```

| 过滤器 | Order 值 | 说明 |
|---|---|---|
| LoadBalancerFilter | 10139 | 负载均衡 |
| NettyRoutingFilter | 9999 | 实际路由 |
| ForwardRoutingFilter | 0 | 转发 |
| WebClientHttpRoutingFilter | 99 | WebClient 路由 |
| 自定义 GlobalFilter | 自定义 | 通常设为 1-1000 |

---

## GlobalFilter（全局过滤器）

### 实现接口

```java
@Component
public class AuthGlobalFilter implements GlobalFilter, Ordered {
    
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        // 1. 获取请求
        ServerHttpRequest request = exchange.getRequest();
        
        // 2. 检查是否需要认证
        String path = request.getURI().getPath();
        if (path.startsWith("/public/")) {
            // 公开路径，放行
            return chain.filter(exchange);
        }
        
        // 3. 检查 Token
        String token = request.getHeaders().getFirst("Authorization");
        if (StringUtils.isBlank(token)) {
            // 无 Token，返回 401
            ServerHttpResponse response = exchange.getResponse();
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return response.setComplete();
        }
        
        // 4. 验证 Token
        if (!validateToken(token)) {
            ServerHttpResponse response = exchange.getResponse();
            response.setStatusCode(HttpStatus.FORBIDDEN);
            return response.setComplete();
        }
        
        // 5. 传递用户信息到下游服务
        String userId = extractUserId(token);
        ServerHttpRequest modifiedRequest = request.mutate()
            .header("X-User-Id", userId)
            .build();
        
        // 6. 继续过滤器链
        return chain.filter(exchange.mutate().request(modifiedRequest).build());
    }
    
    @Override
    public int getOrder() {
        return 1;  // 优先级，越小越靠前
    }
}
```

### 常用 GlobalFilter

#### 1. 请求日志过滤器

```java
@Component
@Slf4j
public class RequestLogFilter implements GlobalFilter {
    
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        
        // 记录请求
        String method = request.getMethod().name();
        String path = request.getURI().getPath();
        String query = request.getURI().getQuery();
        
        long startTime = System.currentTimeMillis();
        
        return chain.filter(exchange)
            .then(Mono.fromRunnable(() -> {
                long duration = System.currentTimeMillis() - startTime;
                int status = exchange.getResponse().getStatusCode().value();
                
                log.info("{} {} {} - {} - {}ms",
                    method, path, query, status, duration);
            }));
    }
    
    @Override
    public int getOrder() {
        return -100;  // 最先执行
    }
}
```

#### 2. 统一响应格式过滤器

```java
@Component
public class ResponseWrapperFilter implements GlobalFilter {
    
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpResponse response = exchange.getResponse();
        DataBufferFactory bufferFactory = response.bufferFactory();
        
        return chain.filter(exchange.mutate()
            .response(new ModifiedServerHttpResponse(response, bufferFactory))
            .build());
    }
    
    @Override
    public int getOrder() {
        return -1;
    }
    
    // 自定义响应包装
    static class ModifiedServerHttpResponse extends ServerHttpResponseDecorator {
        
        public ModifiedServerHttpResponse(ServerHttpResponse delegate,
                                          DataBufferFactory bufferFactory) {
            super(delegate);
        }
        
        @Override
        public Mono&lt;Void&gt; writeWith(Publisher&lt;? extends DataBuffer&gt; body) {
            if (body instanceof Flux) {
                Flux&lt;? extends DataBuffer&gt; flux = (Flux&lt;? extends DataBuffer&gt;) body;
                return super.writeWith(flux.map(buffer -> {
                    // 包装响应
                    byte[] content = new byte[buffer.readableByteCount()];
                    buffer.read(content);
                    // 释放原 buffer
                    buffer.release();
                    
                    // 包装成统一响应格式
                    String wrapped = wrapResponse(new String(content));
                    return bufferFactory.wrap(wrapped.getBytes());
                }));
            }
            return super.writeWith(body);
        }
        
        private String wrapResponse(String body) {
            return "{\"success\":true,\"data\":" + body + "}";
        }
    }
}
```

#### 3. CORS 跨域过滤器

```java
@Configuration
public class CorsConfig {
    
    @Bean
    @Order(-1)
    public GlobalFilter corsFilter() {
        return (exchange, chain) -> {
            ServerHttpResponse response = exchange.getResponse();
            HttpHeaders headers = response.getHeaders();
            
            headers.add("Access-Control-Allow-Origin", "*");
            headers.add("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
            headers.add("Access-Control-Allow-Headers", "*");
            headers.add("Access-Control-Max-Age", "3600");
            
            if (exchange.getRequest().getMethod() == HttpMethod.OPTIONS) {
                response.setStatusCode(HttpStatus.OK);
                return Mono.empty();
            }
            
            return chain.filter(exchange);
        };
    }
}
```

---

## GatewayFilter（局部过滤器）

### 内置 GatewayFilter

#### StripPrefixFilter

```yaml
filters:
  - StripPrefix=2  # 去掉前两层路径
```

#### AddRequestHeaderFilter

```yaml
filters:
  - AddRequestHeader=X-Request-Time, ${currentdatetime}
```

#### SetStatusFilter

```yaml
filters:
  - SetStatus=UNAUTHORIZED
  # 或者
  - SetStatus=401
```

### 自定义 GatewayFilter

```java
@Component
@Slf4j
public class RequestTimeGatewayFilter implements GatewayFilter {
    
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        // 1. 记录开始时间
        long startTime = System.currentTimeMillis();
        
        // 2. 继续处理
        return chain.filter(exchange)
            // 3. 处理完成后
            .then(Mono.fromRunnable(() -> {
                long duration = System.currentTimeMillis() - startTime;
                
                // 4. 检查是否超时
                if (duration > 1000) {
                    log.warn("请求处理超时：{} - {}ms",
                        exchange.getRequest().getURI().getPath(), duration);
                }
            }));
    }
}
```

### 带配置的 GatewayFilterFactory

```java
@Component
public class CacheKeyGatewayFilterFactory 
        extends AbstractGatewayFilterFactory&lt;CacheKeyGatewayFilterFactory.Config&gt; {
    
    public CacheKeyGatewayFilterFactory() {
        super(Config.class);
    }
    
    @Override
    public GatewayFilter apply(Config config) {
        return (exchange, chain) -> {
            String cacheKey = config.getPrefix() 
                + exchange.getRequest().getURI().getPath();
            
            // 添加缓存 Key 到请求属性
            exchange.getAttributes().put("cacheKey", cacheKey);
            
            return chain.filter(exchange);
        };
    }
    
    public static class Config {
        private String prefix = "default";
        
        public String getPrefix() {
            return prefix;
        }
        
        public void setPrefix(String prefix) {
            this.prefix = prefix;
        }
    }
}
```

```yaml
filters:
  - name: CacheKey
    args:
      prefix: user_
```

---

## 过滤器链组合

### 示例：认证 + 日志 + 路由

```java
@Configuration
public class FilterChainConfig {
    
    @Bean
    public GlobalFilter authenticationFilter() {
        return new AuthGlobalFilter();
    }
    
    @Bean
    public GlobalFilter loggingFilter() {
        return new RequestLogFilter();
    }
    
    @Bean
    public GlobalFilter metricsFilter() {
        return new MetricsGlobalFilter();
    }
}
```

### 路由级别过滤器

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: secure-route
          uri: lb://user-service
          predicates:
            - Path=/api/users/**
          filters:
            - AuthFilter           # 自定义认证过滤器
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 100
                redis-rate-limiter.burstCapacity: 200
            - StripPrefix=1
```

---

## 响应式编程与过滤器

Gateway 基于 WebFlux，使用响应式编程模型：

```java
@Override
public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
    // 同步操作
    String path = exchange.getRequest().getURI().getPath();
    
    // 异步操作 - 使用 Mono
    return chain.filter(exchange)
        .then(Mono.fromRunnable(() -> {
            // 处理完成后的操作
        }));
    
    // 条件判断
    if (condition) {
        return chain.filter(exchange);
    } else {
        return Mono.error(new RuntimeException("拒绝访问"));
    }
}
```

---

## 面试高频问题

### Q：GlobalFilter 和 GatewayFilter 的区别是什么？

A：**作用范围不同**——GlobalFilter 自动作用于所有路由，GatewayFilter 只作用于配置它的路由。GlobalFilter 通过实现 `GlobalFilter` 接口定义，GatewayFilter 通过 `GatewayFilterFactory` 定义。

### Q：过滤器的执行顺序是怎么确定的？

A：通过 `getOrder()` 方法返回值确定，**数字越小优先级越高**。内置过滤器的 order 值是固定的（LoadBalancerFilter=10139 等），自定义过滤器要避免与之冲突。

### Q：为什么 Gateway 使用响应式编程？

A：Gateway 基于 Spring WebFlux，目的是实现高并发、低资源占用的异步非阻塞模型。`Mono` 和 `Flux` 是 Project Reactor 提供的响应式类型。

### Q：如何在过滤器中修改请求路径？

A：通过 `exchange.mutate().request()` 创建新的请求对象，然后继续过滤器链：

```java
ServerHttpRequest modifiedRequest = request.mutate()
    .path("/new-path")
    .build();
return chain.filter(exchange.mutate().request(modifiedRequest).build());
```

---

## 总结

Gateway 过滤器是网关的核心能力：

1. **GlobalFilter**：全局生效，适合认证、日志、监控等横切关注点
2. **GatewayFilter**：绑定路由，适合特定路由的定制处理
3. **执行顺序**：通过 `getOrder()` 控制，数字越小越先执行
4. **响应式模型**：基于 WebFlux，使用 `Mono` 和 `Flux`

> 过滤器链的设计，让网关拥有了强大的扩展能力。掌握过滤器的编写，是 Gateway 进阶的必经之路。
