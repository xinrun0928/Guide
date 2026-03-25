# OpenFeign 声明式 HTTP 客户端，@FeignClient 与负载均衡

> 订单服务要调用用户服务，你还在写 RestTemplate + String url = "http://user-service/user/" + id 吗？
>
> OpenFeign 让你像调用本地方法一样调用远程服务——只需要一个注解，代码清晰，逻辑明了。

---

## 从 RestTemplate 到 OpenFeign

### RestTemplate 的写法

```java
@Service
public class OrderService {
    
    @Autowired
    private RestTemplate restTemplate;
    
    public Order getOrder(Long orderId) {
        // 硬编码 URL？还是用服务名？
        String url = "http://user-service/user/" + order.getUserId();
        
        // 返回值需要手动处理
        ResponseEntity&lt;User&gt; response = restTemplate.getForEntity(url, User.class);
        
        return response.getBody();
    }
}
```

**问题**：

- URL 拼接繁琐，容易出错
- 没有类型安全
- 负载均衡需要额外配置 @LoadBalanced
- 异常处理复杂

### OpenFeign 的写法

```java
// 定义接口，像本地调用一样简单
@FeignClient(name = "user-service")
public interface UserClient {
    
    @GetMapping("/user/{id}")
    User getUser(@PathVariable("id") Long id);
}
```

```java
@Service
public class OrderService {
    
    @Autowired
    private UserClient userClient;  // 像调用本地方法一样
    
    public Order getOrder(Long orderId) {
        User user = userClient.getUser(order.getUserId());
        return order;
    }
}
```

**优势**：

- 声明式接口，代码简洁
- 类型安全，编译期检查
- 内置负载均衡
- 易于测试

---

## 快速开始

### 1. 引入依赖

```xml
<dependencies>
    <!-- OpenFeign -->
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-starter-openfeign</artifactId>
    </dependency>
    
    <!-- 如果需要 Ribbon 负载均衡 -->
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-starter-loadbalancer</artifactId>
    </dependency>
</dependencies>
```

### 2. 开启 Feign

```java
@SpringBootApplication
@EnableFeignClients  // 开启 Feign 客户端
public class OrderApplication {
    public static void main(String[] args) {
        SpringApplication.run(OrderApplication.class, args);
    }
}
```

### 3. 定义接口

```java
@FeignClient(name = "user-service", path = "/users")
public interface UserClient {
    
    // GET 请求
    @GetMapping("/{id}")
    User getUser(@PathVariable("id") Long id);
    
    // POST 请求
    @PostMapping
    User createUser(@RequestBody UserCreateRequest request);
    
    // 带参数的请求
    @GetMapping("/list")
    List&lt;User&gt; getUsers(@RequestParam("ids") List&lt;Long&gt; ids);
    
    // Header 参数
    @GetMapping("/{id}")
    User getUserWithHeader(@PathVariable("id") Long id,
                          @RequestHeader("Authorization") String token);
}
```

### 4. 使用客户端

```java
@RestController
@RequestMapping("/orders")
public class OrderController {
    
    @Autowired
    private UserClient userClient;
    
    @GetMapping("/{orderId}")
    public Order getOrder(@PathVariable Long orderId) {
        Order order = orderService.getById(orderId);
        
        // 调用用户服务
        User user = userClient.getUser(order.getUserId());
        order.setUser(user);
        
        return order;
    }
}
```

---

## @FeignClient 详解

### 核心属性

```java
@FeignClient(
    name = "user-service",           // 服务名（必填）
    path = "/users",                 // 请求前缀
    url = "http://localhost:8080",   // 指定 URL（用于测试）
    fallback = UserClientFallback.class,  // 降级处理类
    fallbackFactory = UserClientFallbackFactory.class,  // 降级工厂
    primary = true,                  // 是否为主要 Bean
    qualifier = "userClient",        // Bean 限定符
    configuration = FeignConfig.class // 自定义配置类
)
public interface UserClient {
    // ...
}
```

### name vs url

```java
// 方式一：使用 name（从注册中心获取地址）
@FeignClient(name = "user-service")
public interface UserClientA {
    @GetMapping("/user/{id}")
    User getUser(@PathVariable("id") Long id);
}

// 方式二：使用 url（固定地址，用于开发测试）
@FeignClient(name = "mock-service", url = "http://localhost:8081")
public interface UserClientB {
    @GetMapping("/user/{id}")
    User getUser(@PathVariable("id") Long id);
}
```

---

## HTTP 方法注解

### GET 请求

```java
@FeignClient(name = "user-service")
public interface UserClient {
    
    // 简单参数
    @GetMapping("/user/{id}")
    User getUser(@PathVariable("id") Long id);
    
    // 多个参数
    @GetMapping("/user")
    List&lt;User&gt; searchUsers(@RequestParam("name") String name,
                           @RequestParam("age") Integer age);
    
    // 参数为 Map
    @GetMapping("/user/search")
    List&lt;User&gt; searchUsers(@RequestParam Map&lt;String, Object&gt; params);
    
    // 参数为集合
    @GetMapping("/user/batch")
    List&lt;User&gt; getUsers(@RequestParam("ids") List&lt;Long&gt; ids);
}
```

### POST 请求

```java
@FeignClient(name = "user-service")
public interface UserClient {
    
    // JSON Body
    @PostMapping("/user")
    User createUser(@RequestBody UserCreateRequest request);
    
    // 表单提交
    @PostMapping("/user/form")
    User createUserForm(@RequestParam("name") String name,
                       @RequestParam("email") String email);
    
    // 无请求体
    @PostMapping("/user/{id}/activate")
    void activateUser(@PathVariable("id") Long id);
}
```

### PUT / DELETE 请求

```java
@FeignClient(name = "user-service")
public interface UserClient {
    
    @PutMapping("/user/{id}")
    User updateUser(@PathVariable("id") Long id,
                   @RequestBody UserUpdateRequest request);
    
    @DeleteMapping("/user/{id}")
    void deleteUser(@PathVariable("id") Long id);
}
```

---

## 负载均衡集成

### 自动集成 Ribbon

OpenFeign 默认集成 Ribbon，无需额外配置：

```yaml
# application.yml
spring:
  cloud:
    # Ribbon 配置
    loadbalancer:
      ribbon:
        enabled: true  # 默认开启
        # NFLoadBalancerRuleClassName: com.netflix.loadbalancer.RoundRobinRule
        # 重试次数
        MaxAutoRetries: 3
        # 重试同一实例次数
        MaxAutoRetriesNextServer: 1
        # 是否开启重试
        OkToRetryOnAllOperations: false
```

### 切换为 Spring LoadBalancer

Spring Cloud 2020+ 推荐使用 Spring LoadBalancer：

```xml
<!-- 移除 Ribbon，使用 Spring LoadBalancer -->
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-loadbalancer</artifactId>
</dependency>
```

```yaml
spring:
  cloud:
    loadbalancer:
      ribbon:
        enabled: false  # 禁用 Ribbon
```

### 负载均衡策略

```java
@Configuration
public class FeignLoadBalancerConfig {
    
    @Bean
    public ReactorLoadBalancer&lt;ServiceInstance&gt; randomLoadBalancer(
            Environment environment,
            LoadBalancerClientFactory factory) {
        
        String name = environment.getProperty(
            SpringClientFactory.INSTANCE_NAME_MISSING_SERVICE_NAME);
        
        return new RandomLoadBalancer(
            factory.getLazyProvider(name, ServiceInstanceListSupplier.class),
            name
        );
    }
}
```

```java
@FeignClient(name = "user-service", configuration = FeignLoadBalancerConfig.class)
public interface UserClient {
    // ...
}
```

---

## 降级处理

### 方式一：Fallback 类

```java
// 定义 Fallback
@Component
public class UserClientFallback implements UserClient {
    
    @Override
    public User getUser(Long id) {
        // 返回降级数据
        User fallbackUser = new User();
        fallbackUser.setId(id);
        fallbackUser.setName("降级用户");
        fallbackUser.setFallback(true);
        return fallbackUser;
    }
    
    @Override
    public List&lt;User&gt; getUsers(List&lt;Long&gt; ids) {
        return Collections.emptyList();
    }
}
```

```java
@FeignClient(name = "user-service", fallback = UserClientFallback.class)
public interface UserClient {
    @GetMapping("/user/{id}")
    User getUser(@PathVariable("id") Long id);
    
    @GetMapping("/user/batch")
    List&lt;User&gt; getUsers(@RequestParam("ids") List&lt;Long&gt; ids);
}
```

### 方式二：FallbackFactory（推荐）

FallbackFactory 可以获取异常信息，便于排查问题：

```java
@Component
public class UserClientFallbackFactory implements FallbackFactory&lt;UserClient&gt; {
    
    @Autowired
    private Logger logger;
    
    @Override
    public UserClient create(Throwable cause) {
        return new UserClient() {
            
            @Override
            public User getUser(Long id) {
                logger.error("调用用户服务失败", cause);
                User fallbackUser = new User();
                fallbackUser.setId(id);
                fallbackUser.setName("降级用户");
                return fallbackUser;
            }
        };
    }
}
```

```java
@FeignClient(name = "user-service", fallbackFactory = UserClientFallbackFactory.class)
public interface UserClient {
    @GetMapping("/user/{id}")
    User getUser(@PathVariable("id") Long id);
}
```

---

## 请求/响应压缩

```yaml
# application.yml
feign:
  compression:
    request:
      enabled: true
      mime-types: text/xml,application/xml,application/json
      min-request-size: 1024
    response:
      enabled: true
```

---

## 日志配置

```java
@Configuration
public class FeignLoggerConfig {
    
    @Bean
    Logger.Level feignLogger() {
        return Logger.Level.FULL;  // NONE/BASIC/HEADERS/FULL
    }
}
```

```yaml
# application.yml
logging:
  level:
    # Feign 日志级别
    com.example.client.UserClient: DEBUG
    # Ribbon 日志级别
    com.netflix.loadbalancer: DEBUG
```

---

## 超时配置

```yaml
# application.yml
feign:
  client:
    config:
      default:  # 全局配置
        connectTimeout: 5000
        readTimeout: 10000
      user-service:  # 特定服务配置
        connectTimeout: 3000
        readTimeout: 5000
```

```java
@Configuration
public class FeignTimeoutConfig {
    
    @Bean
    public Request.Options options() {
        return new Request.Options(
            5000,  // connectTimeout
            10000  // readTimeout
        );
    }
}
```

---

## 传递 Header

### 方式一：使用 @RequestHeader

```java
@FeignClient(name = "user-service")
public interface UserClient {
    
    @GetMapping("/user/{id}")
    User getUser(@PathVariable("id") Long id,
                @RequestHeader("Authorization") String token,
                @RequestHeader("X-Request-Id") String requestId);
}
```

### 方式二：请求拦截器

```java
@Component
public class FeignHeaderInterceptor implements RequestInterceptor {
    
    @Autowired
    private AuthService authService;
    
    @Override
    public void apply(RequestTemplate template) {
        // 添加 Token
        template.header("Authorization", authService.getToken());
        
        // 添加 TraceId
        template.header("X-Trace-Id", TraceContext.getTraceId());
        
        // 添加语言
        template.header("Accept-Language", LocaleContextHolder.getLocale().toString());
    }
}
```

---

## 面试高频问题

### Q：OpenFeign 和 RestTemplate 相比有什么优势？

A：三个核心优势——

1. **声明式调用**：通过接口定义远程方法，代码简洁
2. **类型安全**：编译期检查参数和返回值类型
3. **内置负载均衡**：无需额外配置 @LoadBalanced

### Q：OpenFeign 的负载均衡是怎么实现的？

A：OpenFeign 默认集成 Ribbon（Spring Cloud 2020+ 改为 Spring LoadBalancer）。通过拦截器拦截请求，从注册中心获取服务实例列表，按负载均衡策略选择实例发送请求。

### Q：OpenFeign 如何实现超时控制？

A：通过 `feign.client.config` 配置 `connectTimeout` 和 `readTimeout`。也可以在 @FeignClient 中使用 configuration 指定自定义配置类。

### Q：OpenFeign 的降级和熔断是什么关系？

A：降级（Fallback）是当远程调用失败时返回备用数据，属于被动处理。熔断（CircuitBreaker）是当失败率超过阈值时「断路」，阻止后续请求，属于主动保护。OpenFeign 可以配合 Hystrix 或 Sentinel 实现熔断降级。

---

## 总结

OpenFeign 让微服务调用变得简单：

1. **声明式接口**：定义 FeignClient，像本地方法一样调用
2. **负载均衡**：自动集成 Ribbon/Spring LoadBalancer
3. **降级处理**：Fallback 和 FallbackFactory 提供容错能力
4. **日志监控**：可配置请求/响应日志
5. **超时控制**：灵活配置连接超时和读取超时

> 用好 OpenFeign，可以让服务间调用代码清晰优雅，是微服务开发的基本功。
