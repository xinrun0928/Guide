# Gateway 路由配置，Predicates 与 Filters

> 所有外部请求都从网关进入微服务系统。你知道请求从网关到具体服务，中间经历了什么吗？
>
> Gateway 的路由机制，就像一个智能快递分拣中心——根据规则把请求送到正确的目的地。

---

## Gateway 工作原理

### 请求处理流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    Gateway 请求处理流程                          │
│                                                                  │
│  ┌─────────┐    ┌──────────────┐    ┌────────────┐    ┌─────┐ │
│  │  请求    │───►│  Route        │───►│  Filter    │───►│后端 │ │
│  │  进入    │    │  Predicates   │    │  Chain     │    │ 服务│ │
│  └─────────┘    └──────────────┘    └────────────┘    └─────┘ │
│                                                                  │
│  Predicate：判断请求是否符合路由条件                               │
│  Filter：在转发前/后进行处理                                      │
└─────────────────────────────────────────────────────────────────┘
```

**三个核心概念**：

1. **Route（路由）**：路由规则，包含目标 URL、断言、过滤器
2. **Predicate（断言）**：判断请求是否匹配路由条件
3. **Filter（过滤器）**：请求和响应的拦截处理

---

## 快速开始

### 1. 引入依赖

```xml
<dependencies>
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-starter-gateway</artifactId>
    </dependency>
    
    <!-- 服务发现（需要从注册中心获取服务地址） -->
    <dependency>
        <groupId>com.alibaba.cloud</groupId>
        <artifactId>spring-cloud-starter-alibaba-nacos-discovery</artifactId>
    </dependency>
    
    <!-- 负载均衡 -->
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-starter-loadbalancer</artifactId>
    </dependency>
</dependencies>
```

### 2. 基础路由配置

```yaml
spring:
  cloud:
    gateway:
      routes:
        # 路由 ID，唯一标识
        - id: user-service-route
          # 目标服务地址（lb:// 表示从注册中心获取）
          uri: lb://user-service
          # 路由断言：匹配规则
          predicates:
            - Path=/api/users/**
          # 过滤器：路径重写
          filters:
            - StripPrefix=1  # 去掉第一层路径
```

**配置解读**：

- 请求路径：`/api/users/123`
- 匹配断言：`Path=/api/users/**`
- StripPrefix=1 后：`/123`（去掉了 `/api/users`）
- 最终转发到：`http://user-service/123`

### 3. 启用服务发现

```yaml
spring:
  cloud:
    gateway:
      discovery:
        locator:
          enabled: true  # 开启从注册中心发现服务
          lower-case-service-id: true  # 服务名转小写
```

开启后，自动生成路由：`/user-service/**` → `lb://user-service`

---

## Predicate（断言）详解

Predicate 决定了哪些请求会被路由。Gateway 内置了多种断言。

### 1. Path 路径断言（最常用）

```yaml
predicates:
  - Path=/api/users/**,/api/orders/**  # 多个路径
```

### 2. Query 查询参数断言

```yaml
predicates:
  - Query=name  # 存在 name 参数
  - Query=type, exact  # type 参数必须等于 exact
  - Query=age, \d+  # age 参数必须是数字
```

### 3. Header 请求头断言

```yaml
predicates:
  - Header=X-Request-Id, \d+  # X-Request-Id 必须是数字
  - Header=Authorization, Bearer.*  # Authorization 必须是 Bearer 开头
```

### 4. Method 请求方法断言

```yaml
predicates:
  - Method=GET,POST  # 只能是 GET 或 POST
```

### 5. Host 主机断言

```yaml
predicates:
  - Host=**.example.com  # 匹配二级域名
  - Host=api.example.com,web.example.com  # 多个主机
```

### 6. Cookie 断言

```yaml
predicates:
  - Cookie=session_id, abc.*  # session_id 匹配 abc.* 正则
```

### 7. RemoteAddr 远程地址断言

```yaml
predicates:
  - RemoteAddr=192.168.1.0/24  # IP 段
```

### 8. Before / After / Between 时间断言

```yaml
predicates:
  - After=2024-01-01T00:00:00+08:00[Asia/Shanghai]  # 某个时间后
  - Before=2024-12-31T23:59:59+08:00[Asia/Shanghai]  # 某个时间前
  - Between=2024-06-01T00:00:00+08:00,2024-06-30T23:59:59+08:00  # 时间范围内
```

### 9. 组合断言

```yaml
predicates:
  - Path=/api/**
  - Method=GET
  - Header=X-Token, \w+
  - Query=status, active
```

**所有条件都满足才匹配**。

---

## Filter（过滤器）详解

### 内置过滤器

#### 1. StripPrefix 路径重写

```yaml
filters:
  - StripPrefix=1  # 去掉第一层路径
```

```
/api/users/123 → /users/123
/api/v1/users/123 → /v1/users/123 (去掉 1 层)
/api/v1/users/123 → /users/123 (去掉 2 层)
```

#### 2. PrefixPath 添加前缀

```yaml
filters:
  - PrefixPath=/api  # 添加路径前缀
```

```
/users/123 → /api/users/123
```

#### 3. SetPath 设置路径

```yaml
filters:
  - SetPath=/{segment}  # 直接设置路径
```

#### 4. SetRequestHeader 设置请求头

```yaml
filters:
  - SetRequestHeader=X-Forwarded-Host, example.com
  - SetRequestHeader=X-Request-Id, ${uuid}  # 使用 SpEL 表达式
```

#### 5. AddRequestHeader 添加请求头

```yaml
filters:
  - AddRequestHeader=X-Custom-Header, custom-value
```

#### 6. RemoveRequestHeader 移除请求头

```yaml
filters:
  - RemoveRequestHeader=X-Internal-Header
```

#### 7. SetResponseHeader 设置响应头

```yaml
filters:
  - SetResponseHeader=X-Response-Time, -1ms  # -1 表示自动计算
```

#### 8. AddResponseHeader 添加响应头

```yaml
filters:
  - AddResponseHeader=X-Cache-Status, HIT
```

#### 9. RequestRateLimiter 请求限流

```yaml
filters:
  - name: RequestRateLimiter
    args:
      redis-rate-limiter.replenishRate: 100  # 每秒允许请求数
      redis-rate-limiter.burstCapacity: 200   # 桶容量
```

---

## 路由配置示例

### 示例一：基础路由

```yaml
spring:
  cloud:
    gateway:
      routes:
        # 用户服务
        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/api/users/**
          filters:
            - StripPrefix=1
        
        # 订单服务
        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/api/orders/**
          filters:
            - StripPrefix=1
        
        # 商品服务
        - id: product-service
          uri: lb://product-service
          predicates:
            - Path=/api/products/**
          filters:
            - StripPrefix=1
```

### 示例二：带参数路由

```yaml
spring:
  cloud:
    gateway:
      routes:
        # 带查询参数的路由
        - id: search-service
          uri: lb://search-service
          predicates:
            - Path=/api/search/**
            - Query=keyword
          filters:
            - StripPrefix=1
            - SetRequestHeader=X-Search-Source, gateway
```

### 示例三：多条件路由

```yaml
spring:
  cloud:
    gateway:
      routes:
        # PC 端路由
        - id: web-route
          uri: ${WEB_BACKEND_URL}
          predicates:
            - Host=web.example.com
            - Path=/app/**
            - Method=GET
        
        # 移动端路由
        - id: mobile-route
          uri: ${MOBILE_BACKEND_URL}
          predicates:
            - Host=m.example.com,wap.example.com
            - Path=/app/**
            - Header=X-App-Version, \d+\.\d+\.\d+
```

### 示例四：静态资源路由

```yaml
spring:
  cloud:
    gateway:
      routes:
        # 静态资源
        - id: static-assets
          uri: http://static.example.com
          predicates:
            - Path=/static/**,/images/**,/css/**
```

---

## 代码方式配置路由

### Java Config

```java
@Configuration
public class GatewayConfig {
    
    @Bean
    public RouteLocator customRouteLocator(RouteLocatorBuilder builder) {
        return builder.routes()
            .route("user-service", r -> r
                .path("/api/users/**")
                .filters(f -> f
                    .stripPrefix(1)
                    .addRequestHeader("X-Gateway", "true"))
                .uri("lb://user-service"))
            .route("order-service", r -> r
                .path("/api/orders/**")
                .filters(f -> f
                    .stripPrefix(1)
                    .setResponseHeader("X-Response-From", "gateway"))
                .uri("lb://order-service"))
            .build();
    }
}
```

### 动态路由

```java
@RefreshScope
@Configuration
public class DynamicRouteConfig {
    
    @Autowired
    private RouteDefinitionWriter routeDefinitionWriter;
    
    @Autowired
    private ApplicationEventPublisher publisher;
    
    // 添加路由
    public Mono&lt;Void&gt; addRoute(RouteDefinition definition) {
        return routeDefinitionWriter.save(Mono.just(definition))
            .then(Mono.defer(() -> {
                publisher.publishEvent(new RefreshRoutesEvent(this));
                return Mono.empty();
            }));
    }
    
    // 删除路由
    public Mono&lt;Void&gt; deleteRoute(String id) {
        return routeDefinitionWriter.delete(Mono.just(id))
            .then(Mono.defer(() -> {
                publisher.publishEvent(new RefreshRoutesEvent(this));
                return Mono.empty();
            }));
    }
}
```

---

## 路由优先级

当多个路由都匹配时，按配置的顺序执行：**先配置的优先**。

```yaml
spring:
  cloud:
    gateway:
      routes:
        # 优先级高（先匹配）
        - id: admin-route
          uri: lb://admin-service
          predicates:
            - Path=/api/admin/**
        
        # 优先级低（后匹配）
        - id: api-route
          uri: lb://api-service
          predicates:
            - Path=/api/**
```

---

## 负载均衡配置

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: lb://user-service  # lb:// 表示负载均衡
          predicates:
            - Path=/api/users/**
```

### 负载均衡策略

```yaml
spring:
  cloud:
    loadbalancer:
      configurations: round-robin  # 默认轮询
    # 或者自定义
    # loadbalancer:
    #   configurations: random
```

---

## 面试高频问题

### Q：Gateway 和 Zuul 的区别是什么？

A：**性能差异巨大**——Zuul 1.x 是同步阻塞模型，每个请求一个线程；Gateway 基于 WebFlux 异步非阻塞，性能是 Zuul 的 10 倍以上。功能上，Gateway 内置更多 Predicate 和 Filter，与 Spring Cloud 生态集成更紧密。

### Q：Predicate 的执行顺序是怎样的？

A：所有 Predicate 都匹配才路由。多个路由时，按配置顺序匹配，第一个匹配的路由生效。

### Q：Filter 和 Predicate 的区别是什么？

A：**Predicate 决定请求是否匹配路由**，**Filter 决定如何处理匹配的请求**。Predicate 类似 if 条件，Filter 类似拦截器。

### Q：Gateway 如何实现动态路由？

A：通过 RouteDefinitionWriter 可以动态添加/删除路由。配合配置中心（如 Nacos），可以实现路由的动态配置和热更新。

---

## 总结

Gateway 路由机制的核心：

1. **Predicate**：多维度请求匹配（路径、时间、Header、参数等）
2. **Filter**：请求/响应的拦截处理（改写、重定向、限流等）
3. **Route**：Predicate + Filter + URI 的组合
4. **负载均衡**：lb:// 前缀自动从注册中心获取实例

> Gateway 是微服务的统一入口。掌握它的配置，是微服务架构的第一步。
