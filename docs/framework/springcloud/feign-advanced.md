# Feign 传参与继承特性

> 你有没有想过：如果多个微服务都要调用同一批接口，每个服务都写一遍 @FeignClient 定义，会不会很麻烦？
>
> Feign 的继承特性和高级传参，让你的代码复用达到最大化。

---

## 从一个问题开始

假设你有这样的场景：

```
┌─────────────────────────────────────────────────────────┐
│                   用户服务暴露的 API                      │
│                                                          │
│  GET  /user/{id}         → 获取用户信息                   │
│  POST /user              → 创建用户                      │
│  GET  /user/list         → 获取用户列表                   │
│  PUT  /user/{id}         → 更新用户                      │
│  DELETE /user/{id}        → 删除用户                      │
│                                                          │
└─────────────────────────────────────────────────────────┘

订单服务要调用这些接口
支付服务也要调用这些接口
商品服务也要调用这些接口
```

每个服务都写一遍 @FeignClient？代码重复，维护噩梦。

**Feign 的继承特性，就是来解决这个问题的。**

---

## 继承特性

### 1. 定义公共接口

创建一个独立的 API 模块，定义公共的 Feign 接口：

```java
// user-api 模块
public interface UserApi {
    
    @GetMapping("/user/{id}")
    User getUser(@PathVariable("id") Long id);
    
    @PostMapping("/user")
    User createUser(@RequestBody UserCreateRequest request);
    
    @GetMapping("/user/list")
    List&lt;User&gt; getUsers(@RequestParam("ids") List&lt;Long&gt; ids);
    
    @PutMapping("/user/{id}")
    User updateUser(@PathVariable("id") Long id,
                   @RequestBody UserUpdateRequest request);
    
    @DeleteMapping("/user/{id}")
    void deleteUser(@PathVariable("id") Long id);
}
```

### 2. 服务端实现接口

用户服务实现这个接口，保证 API 定义和 Controller 一致：

```java
@RestController
@RequestMapping("/user")
public class UserController implements UserApi {
    
    @Autowired
    private UserService userService;
    
    @Override
    public User getUser(Long id) {
        return userService.getById(id);
    }
    
    @Override
    public User createUser(UserCreateRequest request) {
        return userService.create(request);
    }
    
    // ... 其他方法
}
```

### 3. 客户端继承接口

订单服务直接继承 UserApi：

```java
@FeignClient(name = "user-service")
public interface OrderUserClient extends UserApi {
    // 无需定义任何方法，直接继承
}
```

支付服务也一样：

```java
@FeignClient(name = "user-service")
public interface PaymentUserClient extends UserApi {
    // 无需定义任何方法，直接继承
}
```

### 项目结构

```
├── user-api              # 公共 API 模块
│   └── src/main/java
│       └── com.example.api
│           └── UserApi.java
├── user-service          # 用户服务
│   └── src/main/java
│       └── com.example.user
│           └── UserController implements UserApi
├── order-service         # 订单服务
│   └── src/main/java
│       └── com.example.order
│           └── OrderUserClient extends UserApi
└── payment-service       # 支付服务
    └── src/main/java
        └── com.example.payment
            └── PaymentUserClient extends UserApi
```

### Maven 依赖

```xml
<!-- user-api 模块 -->
<dependency>
    <groupId>com.example</groupId>
    <artifactId>user-api</artifactId>
    <version>1.0.0</version>
</dependency>
```

---

## 继承的注意事项

### 继承的局限性

```java
// 不推荐：@FeignClient 在继承接口上
@FeignClient(name = "user-service")
public interface UserApi {  // ERROR: 不要在这里加注解
    // ...
}

// 推荐：@FeignClient 在实现类上
public interface UserApi {
    // ...
}

@FeignClient(name = "user-service")
public interface OrderUserClient extends UserApi {  // OK
    // ...
}
```

### 路径前缀问题

如果不同服务需要不同的 path，使用空 path：

```java
public interface UserApi {
    
    @RequestMapping("/api/users")  // 使用 @RequestMapping 指定完整路径
    @GetMapping("/{id}")
    User getUser(@PathVariable("id") Long id);
}
```

---

## 复杂传参

### 1. 路径参数 @PathVariable

```java
@FeignClient(name = "user-service")
public interface UserClient {
    
    @GetMapping("/user/{id}/detail/{type}")
    UserDetail getUserDetail(@PathVariable("id") Long id,
                            @PathVariable("type") String type);
    
    // 多个路径参数
    @GetMapping("/org/{orgId}/user/{userId}")
    OrgUser getOrgUser(@PathVariable("orgId") Long orgId,
                      @PathVariable("userId") Long userId);
}
```

### 2. 查询参数 @RequestParam

```java
@FeignClient(name = "user-service")
public interface UserClient {
    
    // 单个参数
    @GetMapping("/user/search")
    List&lt;User&gt; searchByName(@RequestParam("name") String name);
    
    // 多个参数
    @GetMapping("/user/search")
    List&lt;User&gt; searchUsers(@RequestParam("name") String name,
                           @RequestParam("age") Integer age,
                           @RequestParam("city") String city);
    
    // 参数集合
    @GetMapping("/user/batch")
    List&lt;User&gt; getUsersByIds(@RequestParam("ids") List&lt;Long&gt; ids);
    
    // Map 参数
    @GetMapping("/user/search")
    List&lt;User&gt; searchUsers(@RequestParam Map&lt;String, Object&gt; params);
}
```

### 3. 请求体 @RequestBody

```java
@FeignClient(name = "user-service")
public interface UserClient {
    
    // JSON 请求体
    @PostMapping("/user/create")
    User createUser(@RequestBody UserCreateRequest request);
    
    // 复杂嵌套对象
    @PostMapping("/order/create")
    Order createOrder(@RequestBody OrderCreateRequest request);
}
```

```java
@Data
public class OrderCreateRequest {
    private Long userId;
    private List&lt;OrderItem&gt; items;
    private PaymentInfo payment;
}
```

### 4. Header 参数 @RequestHeader

```java
@FeignClient(name = "user-service")
public interface UserClient {
    
    // 单个 Header
    @GetMapping("/user/{id}")
    User getUser(@PathVariable("id") Long id,
                @RequestHeader("Authorization") String token);
    
    // 多个 Header
    @PostMapping("/user")
    User createUser(@RequestBody UserCreateRequest request,
                   @RequestHeader("Authorization") String token,
                   @RequestHeader("X-Request-Id") String requestId,
                   @RequestHeader("Accept-Language") String language);
}
```

### 5. POJO 参数（不推荐）

Spring Cloud 2.x 之后，支持直接使用 POJO 作为查询参数：

```java
// 不推荐：查询参数用 POJO
@FeignClient(name = "user-service")
public interface UserClient {
    
    @GetMapping("/user/search")
    List&lt;User&gt; searchUsers(UserQuery query);  // 会转换为查询参数
}
```

> **推荐**：明确使用 @RequestParam，便于调试和维护。

---

## 请求拦截器

### 全局拦截器

```java
@Component
public class FeignAuthInterceptor implements RequestInterceptor {
    
    @Autowired
    private TokenService tokenService;
    
    @Override
    public void apply(RequestTemplate template) {
        // 添加认证 Token
        String token = tokenService.getToken();
        if (StringUtils.hasText(token)) {
            template.header("Authorization", "Bearer " + token);
        }
        
        // 添加 TraceId
        template.header("X-Trace-Id", UUID.randomUUID().toString());
        
        // 添加租户信息
        template.header("X-Tenant-Id", TenantContext.getTenantId());
    }
}
```

### 针对特定客户端的拦截器

```java
@Configuration
public class FeignInterceptorConfig {
    
    @Bean
    public FeignInterceptor userServiceInterceptor() {
        return new FeignInterceptor() {
            @Override
            public void apply(RequestTemplate template) {
                // 针对 user-service 的特殊处理
                template.header("X-User-Service-Token", "special-token");
            }
        };
    }
}

@FeignClient(name = "user-service", configuration = FeignInterceptorConfig.class)
public interface UserClient {
    // ...
}
```

### 响应拦截器

```java
@Component
public class FeignResponseInterceptor implements ResponseInterceptor {
    
    @Override
    public void apply(ResponseTemplate template) {
        // 在响应前处理
    }
    
    @Override
    public Map&lt;String, Collection&lt;String&gt;&gt; resolveHeaders(
            RequestTemplate template, 
            Map&lt;String, Collection&lt;String&gt;&gt; headers) {
        // 可以修改响应头
        return headers;
    }
}
```

---

## 请求重试

### 配置重试

```yaml
spring:
  cloud:
    openfeign:
      client:
        config:
          default:
            retryer: feign.retryer.Retryer.Default  # 启用重试，默认 5 次
          user-service:
            retryer: MyRetryer  # 自定义重试器
```

### 自定义重试器

```java
public class MyRetryer implements Retryer {
    
    private final int maxAttempts = 3;
    private final long period = 100;
    private final long maxPeriod = 1000;
    private int attempt = 1;
    
    @Override
    public void continueOrPropagate(RetryableException e) {
        if (attempt++ &gt;= maxAttempts) {
            throw e;
        }
        
        long interval = (long) Math.min(
            expBackoff(attempt, period), maxPeriod);
        
        try {
            Thread.sleep(interval);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }
    
    private long expBackoff(int attempt, long period) {
        return period * (long) Math.pow(1.5, attempt - 1);
    }
    
    @Override
    public Retryer clone() {
        return new MyRetryer();
    }
}
```

---

## 错误处理

### 自定义 ErrorDecoder

```java
@Component
public class CustomErrorDecoder implements ErrorDecoder {
    
    @Override
    public Exception decode(String methodKey, Response response) {
        try {
            // 读取错误响应体
            String body = Util.toString(response.body().asReader(StandardCharsets.UTF_8));
            
            if (response.status() == 400) {
                return new BadRequestException(body);
            }
            if (response.status() == 401) {
                return new UnauthorizedException(body);
            }
            if (response.status() == 404) {
                return new NotFoundException(body);
            }
            if (response.status() == 500) {
                return new InternalServerException(body);
            }
            
            return new FeignException(
                response.status(),
                body,
                response.headers(),
                body.getBytes(StandardCharsets.UTF_8)
            );
        } catch (IOException e) {
            return new FeignException.InternalError(e.getMessage());
        }
    }
}
```

---

## @RequestLine vs @RequestMapping

Feign 提供了两种定义请求的方式：

### @RequestLine（原生 Feign）

```java
public interface UserClient {
    
    @RequestLine("GET /user/{id}")
    User getUser(@Param("id") Long id);
    
    @RequestLine("POST /user")
    User createUser(@Param("name") String name, @Param("email") String email);
}
```

### @RequestMapping（Spring Cloud 扩展，推荐）

```java
public interface UserClient {
    
    @RequestMapping(method = RequestMethod.GET, value = "/user/{id}")
    User getUser(@PathVariable("id") Long id);
}
```

> **推荐使用 @RequestMapping**，因为它与 Spring MVC 注解兼容，IDE 支持更好。

---

## 面试高频问题

### Q：Feign 继承特性有什么优缺点？

A：**优点**——代码复用，减少重复定义，API 变更时只需修改一处。**缺点**——增加模块耦合度，API 模块和客户端模块强依赖；可能导致不必要的依赖传递。

### Q：Feign 如何传递复杂对象参数？

A：GET 请求使用 @RequestParam + Map，POST 请求使用 @RequestBody。注意 GET 请求不支持 @RequestBody。

### Q：Feign 的请求拦截器有什么用？

A：可以统一添加认证信息（Token）、TraceId、租户信息等，避免在每个方法上手动添加 Header。

### Q：Feign 如何处理 404 等 HTTP 错误？

A：默认抛出 FeignException。可以通过自定义 ErrorDecoder 将 HTTP 错误码转换为业务异常，便于调用方处理。

---

## 总结

Feign 的高级特性让微服务调用更加灵活：

1. **继承特性**：公共接口复用，避免重复定义
2. **复杂传参**：@PathVariable、@RequestParam、@RequestBody 灵活组合
3. **拦截器**：统一处理认证、追踪等横切关注点
4. **重试机制**：自动处理临时故障
5. **错误处理**：自定义错误解码器

> 用好这些高级特性，可以让 Feign 代码既简洁又健壮。
