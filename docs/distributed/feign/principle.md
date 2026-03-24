# Feign 声明式 HTTP 客户端原理

你有没有这种感觉：

调用一个 REST API，要写 `RestTemplate`、要处理 `HttpClient`、要管理连接池、还要考虑超时重试……

一个简单的 HTTP 请求，代码写了一堆。

**Feign** 就是来解决这个问题的——它的目标是：「像调用本地方法一样调用远程 HTTP 接口」。

今天，我们来彻底搞清楚 Feign 的工作原理。

## Feign 的核心思想

Feign 的理念是**声明式 REST 客户端**。

你只需要定义一个接口，Feign 会帮你完成所有的 HTTP 请求：

```java
// 你写的代码
@FeignClient(name = "user-service")
public interface UserClient {

    @GetMapping("/users/{id}")
    User getUser(@PathVariable("id") Long id);

    @PostMapping("/users")
    User createUser(@RequestBody User user);
}

// Feign 帮你生成的代码（伪代码）
public class UserClientImpl implements UserClient {
    @Override
    public User getUser(Long id) {
        // 发送 GET /users/{id} 请求
        // 解析响应为 User 对象
        // 返回结果
    }
}
```

**你只关心接口定义，不需要关心 HTTP 请求的细节。**

## Feign vs RestTemplate vs HttpClient

| 维度 | RestTemplate | HttpClient | Feign |
|-----|-------------|------------|-------|
| **代码风格** | 字符串拼接 URL | 底层 API | 声明式接口 |
| **类型安全** | ❌ 参数容易写错 | ❌ | ✅ 接口约束 |
| **可读性** | 中 | 差 | 好 |
| **配置复杂度** | 中 | 高 | 低 |
| **学习曲线** | 低 | 高 | 低 |

## Feign 的工作原理

Feign 的工作流程可以分为三个阶段：

```
┌─────────────────────────────────────────────────────────┐
│                   Feign 工作流程                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. 启动阶段（Bootstrap）                               │
│     ┌─────────────────────────────────────────────┐   │
│     │  扫描 @FeignClient 注解                    │   │
│     │  生成 JDK 动态代理对象                       │   │
│     │  解析 @RequestLine、@Header 等注解          │   │
│     └─────────────────────────────────────────────┘   │
│                         ↓                               │
│  2. 请求阶段（Invocation）                              │
│     ┌─────────────────────────────────────────────┐   │
│     │  MethodHandler 拦截方法调用                  │   │
│     │  将注解翻译为 HTTP 请求                      │   │
│     │  设置 Header、参数、URL                      │   │
│     └─────────────────────────────────────────────┘   │
│                         ↓                               │
│  3. 响应阶段（Response）                                │
│     ┌─────────────────────────────────────────────┐   │
│     │  Client 发送 HTTP 请求                       │   │
│     │  Decoder 解析响应                           │   │
│     │  返回业务对象                               │   │
│     └─────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 1. 启动阶段：动态代理生成

Spring Boot 启动时，`FeignClientsRegistrar` 会扫描所有 `@FeignClient` 注解：

```java
public class FeignClientsRegistrar implements ImportBeanDefinitionRegistrar {

    @Override
    public void registerBeanDefinitions(
            AnnotationMetadata metadata,
            BeanDefinitionRegistry registry) {

        // 扫描 @EnableFeignClients 指定的包
        registerDefaultConfiguration(metadata, registry);

        // 扫描所有 @FeignClient 注解的接口
        registerFeignClients(metadata, registry);
    }
}
```

注册过程：

```java
private void registerFeignClient(
        BeanDefinitionRegistry registry,
        AnnotationMetadata annotationMetadata,
        Map&lt;String, Object&gt; attrs) {

    // 创建 FeignClient 的 BeanDefinition
    BeanDefinitionBuilder definition = BeanDefinitionBuilder
        .genericBeanDefinition(FeignClientFactoryBean.class);

    // 添加属性：name、url、fallback 等
    definition.addPropertyValue("name", attrs.get("name"));
    definition.addPropertyValue("url", attrs.get("url"));
    definition.addPropertyValue("fallback", attrs.get("fallback"));

    // 注册为 Bean
    registry.registerBeanDefinition(
        attrs.get("name").toString() + "FeignClient",
        definition.getBeanDefinition()
    );
}
```

### 2. 请求阶段：MethodHandler 处理

当调用 Feign Client 方法时，`InvocationHandler` 会拦截调用：

```java
public class ReflectiveFeign extends Feign {

    @Override
    public <T> T newInstance(Target<T> target) {
        // 解析接口上的方法
        Map<String, MethodHandler> nameToHandler = parseMethods(target);

        // 创建 JDK 动态代理
        InvocationHandler handler = new InvocationHandler() {
            @Override
            public Object invoke(Object proxy, Method method, Object[] args)
                    throws Throwable {
                // 获取方法对应的 Handler
                MethodHandler methodHandler = nameToHandler.get(method.getName());
                // 执行调用
                return methodHandler.invoke(args);
            }
        };

        return (T) Proxy.newProxyInstance(
            target.type().getClassLoader(),
            new Class[]{target.type()},
            handler
        );
    }
}
```

### 3. 请求构建：RequestTemplate

`MethodHandler` 会将注解翻译成 `RequestTemplate`：

```java
public class SynchronousMethodHandler implements MethodHandler {

    @Override
    public Object invoke(Object[] argv) throws Throwable {
        // 1. 构建请求
        RequestTemplate template = buildTemplate(argv);

        // 2. 发送请求
        Request request = Request.create(
            HttpMethod.GET,
            template.toUri().toString(),
            template.headers(),
            Request.Body.empty()
        );

        // 3. 执行请求
        Response response = client.execute(request, options);

        // 4. 解码响应
        return decode(response);
    }

    private RequestTemplate buildTemplate(Object[] argv) {
        RequestTemplate template = RequestTemplate.from(metadata.template());

        // 处理 @Param 注解
        for (Map.Entry<String, Object> entry : argvMap.entrySet()) {
            String name = entry.getKey();
            Object value = entry.getValue();
            template.resolve(Collections.singletonMap(name, value));
        }

        return template;
    }
}
```

## Feign 的核心组件

Feign 的可扩展性来自于它的核心组件：

| 组件 | 作用 | 默认实现 |
|-----|------|---------|
| **Contract** | 解析注解（@RequestLine、@Headers） | RibbonContract |
| **Client** | 发送 HTTP 请求 | LoadBalancerFeignClient |
| **Encoder** | 请求体编码 | JacksonEncoder |
| **Decoder** | 响应体解码 | JacksonDecoder |
| **Logger** | 日志记录 | Slf4jLogger |
| **Retryer** | 重试策略 | Retryer.NEVER_RETRY |

### 组件的 SPI 扩展

```java
// 定义接口
public interface Encoder {
    void encode(Object object, Type bodyType, RequestTemplate template);
}

// SPI 配置
// META-INF/services/feign.Logger
com.example.MyEncoder = com.example.CustomEncoder
```

### 替换默认组件

```java
@Configuration
public class FeignConfig {

    @Bean
    public Decoder decoder() {
        return new JacksonDecoder(
            new ObjectMapper().registerModule(new JavaTimeModule())
        );
    }

    @Bean
    public Encoder encoder() {
        return new JacksonEncoder();
    }

    @Bean
    public Retryer retryer() {
        // 重试配置：重试 3 次，间隔 100ms
        return new Retryer.Default(100, 1000, 3);
    }
}
```

## Feign 的请求拦截

Feign 支持通过 `RequestInterceptor` 拦截所有请求：

```java
@Configuration
public class FeignInterceptorConfig {

    @Bean
    public RequestInterceptor requestInterceptor() {
        return new RequestInterceptor() {
            @Override
            public void apply(RequestTemplate template) {
                // 添加 Header
                template.header("X-Request-Id", UUID.randomUUID().toString());
                template.header("Authorization",
                    "Bearer " + getToken());

                // 添加全局参数
                template.query("tenantId", getTenantId());
            }
        };
    }
}
```

## 完整示例

```java
// 1. 定义 Feign Client
@FeignClient(
    name = "user-service",
    url = "http://user-service:8080",
    configuration = FeignConfig.class,
    fallback = UserClientFallback.class
)
public interface UserClient {

    @GetMapping("/users/{id}")
    User getUser(@PathVariable("id") Long id);

    @PostMapping("/users")
    User createUser(@RequestBody User user);

    @GetMapping("/users")
    List&lt;User&gt; getUsers(@RequestParam("status") String status);
}

// 2. 定义 Fallback（容错）
@Component
public class UserClientFallback implements UserClient {

    @Override
    public User getUser(Long id) {
        // 服务降级：返回默认用户
        return new User(id, "Default User");
    }

    @Override
    public User createUser(User user) {
        throw new ServiceUnavailableException("Service is unavailable");
    }

    @Override
    public List&lt;User&gt; getUsers(String status) {
        return Collections.emptyList();
    }
}

// 3. 使用
@RestController
public class OrderController {

    @Autowired
    private UserClient userClient;

    @GetMapping("/orders/{id}")
    public Order getOrder(@PathVariable Long id) {
        // 像调用本地方法一样调用远程服务
        User user = userClient.getUser(id);
        return orderService.findById(id, user);
    }
}
```

## Feign 的 HTTP 客户端

Feign 支持多种 HTTP 客户端，默认使用 `URLConnection`（每次请求创建新连接）。

推荐使用 **OkHttp** 或 **Apache HttpClient**：

### OkHttp 配置

```xml
<dependency>
    <groupId>io.github.openfeign</groupId>
    <artifactId>feign-okhttp</artifactId>
</dependency>
```

```java
@Configuration
public class OkHttpConfig {

    @Bean
    public OkHttpClient okHttpClient() {
        return new OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .connectionPool(new ConnectionPool(
                10,      // 最大空闲连接数
                5,       // 保持时间
                TimeUnit.MINUTES
            ))
            .build();
    }
}
```

## 面试追问方向

- Feign 为什么使用动态代理而不是字节码生成？
- Feign 和 Ribbon 是什么关系？Feign 怎么实现负载均衡的？
- 如何让 Feign 支持 OAuth 2.0 认证？
- Feign 的超时配置是怎么生效的？ConnectTimeout 和 ReadTimeout 有什么区别？

## 总结

Feign 的设计哲学是**「约定优于配置」**：

```
┌─────────────────────────────────────────────────────────┐
│                   Feign 调用模型                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   你写的代码：                                           │
│   ┌─────────────────────────────────────────────┐     │
│   │ @FeignClient(name = "user-service")        │     │
│   │ interface UserClient {                      │     │
│   │   @GetMapping("/users/{id}")                │     │
│   │   User getUser(@PathVariable Long id);      │     │
│   │ }                                           │     │
│   └─────────────────────────────────────────────┘     │
│                         ↓                               │
│   Feign 帮你做的：                                       │
│   ┌─────────────────────────────────────────────┐     │
│   │ 1. 解析注解 → RequestTemplate               │     │
│   │ 2. 负载均衡 → Ribbon 选择实例                │     │
│   │ 3. 发送请求 → HTTP Client                  │     │
│   │ 4. 解析响应 → Decoder 解码                 │     │
│   │ 5. 返回结果 → 业务对象                      │     │
│   └─────────────────────────────────────────────┘     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Feign 让 HTTP 客户端变得像本地接口一样优雅，真正实现了「像调用本地方法一样调用远程服务」。
