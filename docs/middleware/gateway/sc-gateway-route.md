# Spring Cloud Gateway 路由配置与动态路由

你已经知道了 Spring Cloud Gateway 的工作流程，现在问题是：**路由配置怎么写？**

好消息是，Spring Cloud Gateway 提供了多种配置方式，从简单的 YAML 配置到灵活的 Java DSL，总有一款适合你。

## 静态路由配置

### YAML 配置方式

最常用的方式，通过 `application.yml` 或 `application.yaml` 配置：

```yaml
spring:
  cloud:
    gateway:
      routes:
        # 用户服务
        - id: user-service
          uri: http://user-service:8080
          predicates:
            - Path=/api/user/**
          filters:
            - StripPrefix=1
            
        # 订单服务（使用 lb:// 前缀启用负载均衡）
        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/api/order/**
          filters:
            - name: CircuitBreaker
              args:
                name: orderCircuit
                fallbackUri: forward:/fallback
                
        # 商品服务
        - id: product-service
          uri: lb://product-service
          predicates:
            - Path=/api/product/**
```

### Java DSL 配置方式

Java DSL 提供了更强的灵活性，适合复杂路由场景：

```java
@Configuration
public class GatewayRoutesConfig {
    
    @Bean
    public RouteLocator customRouteLocator(RouteLocatorBuilder builder) {
        return builder.routes()
            // 用户服务路由
            .route("user-service", r -&gt; r
                .path("/api/user/**")
                .filters(f -&gt; f
                    .stripPrefix(1)  // 去掉 /api 前缀
                    .addRequestHeader("X-Gateway", "SpringCloudGateway")
                    .addResponseHeader("X-Response-Time", LocalDateTime.now().toString())
                )
                .uri("http://user-service:8080"))
            
            // 订单服务路由
            .route("order-service", r -&gt; r
                .path("/api/order/**")
                .filters(f -&gt; f
                    .circuitBreaker(c -&gt; c
                        .setName("orderCircuit")
                        .setFallbackUri("forward:/fallback"))
                )
                .uri("lb://order-service"))
            
            // 主机名路由
            .route("host-route", r -&gt; r
                .host("*.example.com")
                .filters(f -&gt; f
                    .addRequestHeader("X-Host", "example.com"))
                .uri("http://backend-service:8080"))
            
            // 时间窗口路由（只在工作时间可用）
            .route("worktime-route", r -&gt; r
                .before(ZonedDateTime.of(2024, 1, 1, 9, 0, 0, 0, ZoneId.of("UTC")))
                .after(ZonedDateTime.of(2024, 12, 31, 18, 0, 0, 0, ZoneId.of("UTC")))
                .uri("http://backend-service:8080"))
            
            .build();
    }
}
```

## 动态路由

静态路由的问题在于：修改配置后需要重启网关。在生产环境中，我们通常需要动态路由——不重启就能更新路由规则。

### 基于配置中心的动态路由

将路由配置存储在 Nacos、Apollo 等配置中心，通过配置变更监听实现动态刷新：

```java
@Configuration
public class DynamicRouteConfig {
    
    @Autowired
    private RouteDefinitionWriter routeDefinitionWriter;
    
    @Autowired
    private ApplicationEventPublisher publisher;
    
    // 监听配置中心的路由变更
    @NacosConfigListener(dataId = "gateway-routes.json")
    public void onRouteChange(String config) {
        List&lt;RouteDefinition&gt; definitions = JSON.parseArray(config, RouteDefinition.class);
        
        for (RouteDefinition definition : definitions) {
            try {
                // 更新或新增路由
                routeDefinitionWriter.save(Mono.just(definition)).subscribe();
                publisher.publishEvent(new RefreshRoutesEvent(this));
            } catch (Exception e) {
                log.error("Failed to update route: {}", definition.getId(), e);
            }
        }
    }
    
    // 删除路由
    public void deleteRoute(String routeId) {
        routeDefinitionWriter.delete(Mono.just(routeId)).subscribe();
        publisher.publishEvent(new RefreshRoutesEvent(this));
    }
}
```

```json
// gateway-routes.json
[
  {
    "id": "user-service",
    "uri": "http://user-service:8080",
    "predicates": [
      {"name": "Path", "args": {"pattern": "/api/user/**"}}
    ],
    "filters": [
      {"name": "StripPrefix", "args": {"parts": 1}}
    ]
  }
]
```

### 基于数据库的动态路由

对于更灵活的管理，可以将路由存储在数据库中：

```java
@Entity
@Table(name = "gateway_routes")
public class GatewayRoute {
    @Id
    private String id;
    private String uri;
    private Integer order;
    private Boolean enabled;
    private String predicates;  // JSON 存储
    private String filters;     // JSON 存储
    
    // getters and setters
}

@Service
public class DatabaseRouteDefinitionLocator implements RouteDefinitionLocator {
    
    @Autowired
    private GatewayRouteRepository repository;
    
    @Override
    public Flux&lt;RouteDefinition&gt; getRouteDefinitions() {
        return Flux.fromIterable(repository.findByEnabled(true))
            .map(this::convertToRouteDefinition);
    }
    
    private RouteDefinition convertToRouteDefinition(GatewayRoute route) {
        RouteDefinition definition = new RouteDefinition();
        definition.setId(route.getId());
        definition.setUri(URI.create(route.getUri()));
        definition.setOrder(route.getOrder());
        
        // JSON 反序列化为 Predicate 和 Filter
        definition.setPredicates(JSON.parseArray(route.getPredicates(), PredicateDefinition.class));
        definition.setFilters(JSON.parseArray(route.getFilters(), FilterDefinition.class));
        
        return definition;
    }
}
```

### 路由管理接口

提供 REST API 来管理路由：

```java
@RestController
@RequestMapping("/admin/routes")
public class RouteManagementController {
    
    @Autowired
    private RouteDefinitionWriter routeDefinitionWriter;
    
    @Autowired
    private RouteLocator routeLocator;
    
    // 获取所有路由
    @GetMapping
    public Flux&lt;RouteDefinition&gt; getRoutes() {
        return routeLocator.getRoutes().map(route -&gt; {
            RouteDefinition def = new RouteDefinition();
            def.setId(route.getId());
            def.setOrder(route.getOrder());
            return def;
        });
    }
    
    // 新增路由
    @PostMapping
    public Mono&lt;ResponseEntity&lt;String&gt;&gt; addRoute(@RequestBody RouteDefinition definition) {
        return routeDefinitionWriter.save(Mono.just(definition))
            .then(Mono.just(ResponseEntity.ok("Route added")))
            .onErrorReturn(e -&gt; ResponseEntity.badRequest().body(e.getMessage()));
    }
    
    // 更新路由
    @PutMapping("/{id}")
    public Mono&lt;ResponseEntity&lt;String&gt;&gt; updateRoute(
            @PathVariable String id, 
            @RequestBody RouteDefinition definition) {
        definition.setId(id);
        return routeDefinitionWriter.save(Mono.just(definition))
            .then(Mono.just(ResponseEntity.ok("Route updated")));
    }
    
    // 删除路由
    @DeleteMapping("/{id}")
    public Mono&lt;ResponseEntity&lt;String&gt;&gt; deleteRoute(@PathVariable String id) {
        return routeDefinitionWriter.delete(Mono.just(id))
            .then(Mono.just(ResponseEntity.ok("Route deleted")));
    }
    
    // 刷新路由
    @PostMapping("/refresh")
    public Mono&lt;ResponseEntity&lt;String&gt;&gt; refreshRoutes() {
        publisher.publishEvent(new RefreshRoutesEvent(this));
        return Mono.just(ResponseEntity.ok("Routes refreshed"));
    }
}
```

## 路由匹配优先级

当多个路由都能匹配一个请求时，按以下顺序确定优先级：

```
1. order 值越小，优先级越高
2. predicates 越多，优先级越高（更具体的匹配）
3. 路由定义越早，优先级越高
```

```yaml
# 示例：更具体的路由应该放在前面
routes:
  # 更具体的路由，order=1
  - id: user-detail
    order: 1
    uri: http://user-service:8080
    predicates:
      - Path=/api/user/{id}  # 精确匹配单个用户
      - Method=GET
  
  # 较宽泛的路由，order=2
  - id: user-list
    order: 2
    uri: http://user-service:8080
    predicates:
      - Path=/api/user/**  # 匹配所有用户相关路径
```

## 路由重试

当后端服务调用失败时，可以配置重试机制：

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/api/order/**
          filters:
            - name: Retry
              args:
                retries: 3  # 重试次数
                statuses: INTERNAL_SERVER_ERROR, SERVICE_UNAVAILABLE  # 重试的 HTTP 状态码
                methods: GET,POST  # 重试的 HTTP 方法
                series: SERVER_ERROR  # 5xx 系列
                exceptions: java.io.IOException, java.util.concurrent.TimeoutException  # 重试的异常类型
```

```java
// Java DSL 配置重试
.route("order-service", r -&gt; r
    .path("/api/order/**")
    .filters(f -&gt; f
        .retry(retry -&gt; retry
            .setRetries(3)
            .setStatuses(HttpStatus.INTERNAL_SERVER_ERROR)
            .setMethods(HttpMethod.GET)
            .setSeries(HttpStatusSeries.SERVER_ERROR)))
    .uri("lb://order-service"))
```

## 总结

| 配置方式 | 适用场景 | 优点 | 缺点 |
|---|---|---|---|
| YAML | 简单路由 | 配置简单，易读 | 需要重启 |
| Java DSL | 复杂逻辑 | 灵活，可编程 | 代码耦合 |
| 配置中心 | 生产环境 | 动态更新 | 依赖外部组件 |
| 数据库 | 灵活管理 | 可视化管理 | 性能开销 |

---

**留给你的问题**

动态路由虽然方便，但也带来了新的挑战：如何在不停机的情况下安全地更新路由？如果新路由配置有语法错误怎么办？你会如何设计一个「安全」的动态路由更新机制？
