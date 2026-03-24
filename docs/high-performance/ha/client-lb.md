# 客户端负载均衡：Ribbon 与 Spring Cloud LoadBalancer

传统架构中，负载均衡器是一个独立的组件（硬件 F5、软件 Nginx），所有请求都经过它。

但你有没有想过：**为什么不把负载均衡的逻辑直接放到客户端？**

客户端知道所有服务实例的地址，知道每个实例的健康状况。它可以自己选择打哪个实例，不需要额外的「中介」。

这就是客户端负载均衡。

## 服务端负载均衡 vs 客户端负载均衡

```
服务端负载均衡：
用户 → Nginx（负载均衡器）→ 服务实例 A/B/C
              ▲
              │
        所有请求经过这里

客户端负载均衡：
用户 → 服务实例 A/B/C（客户端自己选择）
              ▲
              │
        客户端内置负载均衡逻辑
```

### 对比

| 维度 | 服务端负载均衡 | 客户端负载均衡 |
|------|---------------|---------------|
| 组件位置 | 独立部署 | 内嵌在客户端 |
| 请求路径 | 必须经过 LB | 直连后端 |
| 依赖 | LB 服务 | 服务发现（如 Eureka） |
| 配置 | LB 上统一配置 | 每个客户端独立配置 |
| 故障感知 | LB 健康检查 | 需要客户端配合 |
| 复杂度 | 简单直观 | 实现复杂 |

## Ribbon：Netflix 的客户端负载均衡器

Ribbon 是 Netflix 开发的客户端负载均衡器，曾是 Spring Cloud 微服务架构的标配。

### Ribbon 核心组件

```
┌─────────────────────────────────────────────────────┐
│                     Ribbon                           │
├─────────────────────────────────────────────────────┤
│  ┌───────────────┐                                  │
│  │ ServerList    │  服务实例列表                    │
│  └───────────────┘                                  │
│           │                                          │
│           ▼                                          │
│  ┌───────────────┐                                  │
│  │   IPing       │  健康检查                        │
│  └───────────────┘                                  │
│           │                                          │
│           ▼                                          │
│  ┌───────────────┐                                  │
│  │ IRule         │  负载均衡策略                    │
│  └───────────────┘                                  │
│           │                                          │
│           ▼                                          │
│  ┌───────────────┐                                  │
│  │  RestClient   │  发起请求                        │
│  └───────────────┘                                  │
└─────────────────────────────────────────────────────┘
```

### Ribbon 负载均衡策略

```java
// Ribbon 内置的负载均衡策略

// 1. RoundRobinRule：轮询
// 2. RandomRule：随机
// 3. RetryRule：带重试的轮询
// 4. WeightedResponseTimeRule：加权响应时间
// 5. BestAvailableRule：选择并发数最小的
// 6. AvailabilityFilteringRule：过滤掉熔断的
// 7. ZoneAvoidanceRule：区域感知轮询
```

### Ribbon 配置示例

#### 1. RestTemplate + Ribbon

```java
@Configuration
public class RibbonConfig {

    @Bean
    @LoadBalanced  // 启用 Ribbon 负载均衡
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
}

@RestController
public class UserController {

    @Autowired
    private RestTemplate restTemplate;

    @GetMapping("/user/{id}")
    public User getUser(@PathVariable Long id) {
        // 使用服务名调用，Ribbon 会自动做负载均衡
        // 注意：这是服务名，不是 IP:PORT
        String url = "http://user-service/users/" + id;
        return restTemplate.getForObject(url, User.class);
    }
}
```

#### 2. 自定义负载均衡策略

```java
// 自定义基于 CPU 的负载均衡策略
public class CpuBasedRule extends AbstractLoadBalancerRule {

    @Override
    public Server choose(Object key) {
        ILoadBalancer loadBalancer = getLoadBalancer();

        // 从服务发现获取实例列表
        List<Server> servers = loadBalancer.getReachableServers();

        if (servers.isEmpty()) {
            return null;
        }

        // 选择 CPU 使用率最低的实例
        return servers.stream()
            .min(Comparator.comparing(this::getServerCpuUsage))
            .orElse(servers.get(0));
    }

    private double getServerCpuUsage(Server server) {
        // 从监控服务获取 CPU 使用率
        // 这里简化处理，实际需要对接监控系统
        return CpuMonitor.getCpuUsage(server.getHost());
    }
}

// 注册自定义策略
@Configuration
public class CustomRibbonConfig {

    @Bean
    public IRule customRule() {
        return new CpuBasedRule();
    }
}
```

#### 3. 全局默认策略

```yaml
# application.yml
ribbon:
  # 连接超时
  ConnectTimeout: 3000
  # 读取超时
  ReadTimeout: 5000
  # 最大重试次数
  MaxAutoRetries: 3
  # 对同一服务的最大重试次数
  MaxAutoRetriesNextServer: 2
  # 是否开启重试
  OkToRetryOnAllOperations: false
  # 默认负载均衡策略
  NFLoadBalancerRuleClassName: com.netflix.loadbalancer.RandomRule
```

#### 4. 服务级别策略

```yaml
# 只对 user-service 生效
user-service:
  ribbon:
    NFLoadBalancerRuleClassName: com.netflix.loadbalancer.WeightedResponseTimeRule
    ConnectTimeout: 3000
    ReadTimeout: 3000
```

### Ribbon 工作原理

```java
// 当 RestTemplate 使用 @LoadBalanced 时
// 请求 URL: http://user-service/users/123
// Ribbon 会拦截这个请求

public class LoadBalancerInterceptor implements ClientHttpRequestInterceptor {

    @Override
    public ClientHttpResponse intercept(HttpRequest request, byte[] body,
            ClientHttpRequestExecution execution) throws IOException {

        // 获取原始 URL
        URI originalUri = request.getURI();
        // service-name = "user-service"
        String serviceName = originalUri.getHost();

        // 调用 LoadBalancer 获取目标地址
        // choose() 方法使用配置的 IRule 做负载均衡
        ServiceInstance serviceInstance = loadBalancer.choose(serviceName);

        // 重新构造请求 URL
        URI newUri = URI.create(
            "http://" + serviceInstance.getHost() + ":" +
            serviceInstance.getPort() + originalUri.getPath()
        );

        // 更新请求 URI
        request.setURI(newUri);

        return execution.execute(request, body);
    }
}
```

## Spring Cloud LoadBalancer

Ribbon 已经进入维护模式，Spring Cloud 官方推荐使用 **Spring Cloud LoadBalancer** 作为替代。

### 为什么替换 Ribbon

1. Ribbon 停止维护
2. Ribbon 与 Netflix 生态系统耦合太深
3. Spring Cloud LoadBalancer 更轻量，与 Spring Cloud 原生融合更好

### 迁移示例

#### 1. 基本使用

```java
// 之前 Ribbon
@Service
public class UserService {

    @Autowired
    private RestTemplate restTemplate;

    public User getUser(Long id) {
        // Ribbon 会拦截这个请求
        return restTemplate.getForObject(
            "http://user-service/users/" + id,
            User.class
        );
    }
}

// 现在 Spring Cloud LoadBalancer
@Configuration
public class LoadBalancerConfig {

    @Bean
    ReactorLoadBalancer&lt;ServiceInstance&gt; randomLoadBalancer(
            Environment environment,
            LoadBalancerClientFactory factory) {

        String name = environment.getProperty(
            LoadBalancerClientFactory.PROPERTY_NAME);

        return new RandomLoadBalancer(
            factory.getLazyProvider(name, ServiceInstanceListSupplier.class),
            name
        );
    }
}

@Service
public class UserService {

    private final RestTemplate restTemplate;

    public UserService(RESTClientBuilder builder) {
        this.restTemplate = builder.build();
    }

    public User getUser(Long id) {
        // 直接指定服务名
        return restTemplate.getForObject(
            "http://user-service/users/" + id,
            User.class
        );
    }
}
```

#### 2. 使用 WebClient（响应式）

```java
@Configuration
public class WebClientConfig {

    @Bean
    @LoadBalanced
    public WebClient.Builder loadBalancedWebClientBuilder() {
        return WebClient.builder();
    }
}

@Service
public class UserService {

    private final WebClient webClient;

    public UserService(WebClient.Builder builder) {
        this.webClient = builder.baseUrl("http://user-service").build();
    }

    public Mono&lt;User&gt; getUser(Long id) {
        return webClient.get()
            .uri("/users/{id}", id)
            .retrieve()
            .bodyToMono(User.class);
    }
}
```

#### 3. 手动选择实例

```java
@Service
public class UserService {

    private final LoadBalancerClient loadBalancer;

    public UserService(LoadBalancerClient loadBalancer) {
        this.loadBalancer = loadBalancer;
    }

    public User getUser(Long id) {
        // 手动选择服务实例
        ServiceInstance instance = loadBalancer.choose("user-service");

        // 构建请求
        String url = String.format(
            "http://%s:%d/users/%d",
            instance.getHost(),
            instance.getPort(),
            id
        );

        return restTemplate.getForObject(url, User.class);
    }
}
```

### 自定义负载均衡策略

```java
// 自定义加权响应时间策略
public class CustomLoadBalancer {

    @Bean
    public ReactorLoadBalancer&lt;ServiceInstance&gt; weightedLoadBalancer(
            Environment environment,
            LoadBalancerClientFactory factory) {

        String name = environment.getProperty(
            LoadBalancerClientFactory.PROPERTY_NAME);

        ILoadBalancer loadBalancer = SpringFactoryLoadBalancerFactory
            .getInstance()
            .getLoadBalancer(name);

        return new ZonePreferenceServiceInstanceLoadBalancerWrapper(
            name,
            factory.getLazyProvider(name, ServiceInstanceListSupplier.class),
            loadBalancer
        );
    }
}
```

### 集成 Resilience4j 熔断

```java
@Service
public class UserService {

    private final RestTemplate restTemplate;
    private final ServiceInstanceListSupplier supplier;

    public UserService(
            RestTemplateBuilder builder,
            ServiceInstanceListSupplier supplier) {
        this.restTemplate = builder.build();
        this.supplier = supplier;
    }

    public User getUser(Long id) {
        // 结合熔断器使用
        Supplier&lt;User&gt; userSupplier = () -> {
            // 使用轮询选择健康实例
            ServiceInstance instance = chooseInstance();
            String url = String.format(
                "http://%s:%d/users/%d",
                instance.getHost(),
                instance.getPort(),
                id
            );
            return restTemplate.getForObject(url, User.class);
        };

        return Decorators.ofSupplier(userSupplier)
            .withCircuitBreaker(CircuitBreaker.ofDefaults("userService"))
            .withRetry(Retry.ofDefaults("userService"))
            .execute();
    }

    private ServiceInstance chooseInstance() {
        List&lt;ServiceInstance&gt; instances = supplier.get().blockFirst();
        return instances.stream()
            .filter(this::isHealthy)
            .findAny()
            .orElseThrow(() -> new ServiceUnavailableException());
    }

    private boolean isHealthy(ServiceInstance instance) {
        // 健康检查逻辑
        return instance.isHealthy();
    }
}
```

## 负载均衡策略对比

| 策略 | Ribbon | Spring Cloud LB | 适用场景 |
|------|--------|-----------------|----------|
| 轮询 | `RoundRobinRule` | `RoundRobinLoadBalancer` | 无状态服务 |
| 随机 | `RandomRule` | `RandomLoadBalancer` | 无状态服务 |
| 加权 | `WeightedResponseTimeRule` | 自定义 | 差异化服务 |
| 最小连接 | `BestAvailableRule` | 自定义 | 长连接服务 |
| 区域感知 | `ZoneAvoidanceRule` | 内置 | 多区域部署 |
| 重试 | `RetryRule` | Resilience4j | 容错场景 |

## 选型建议

**选 Ribbon：**
- 遗留系统，不想大改
- 使用老版本 Spring Cloud

**选 Spring Cloud LoadBalancer：**
- 新项目
- 使用 Spring Cloud 2020+
- 需要更好的响应式支持

**选两者都不用：**
- 使用 Spring Cloud Gateway 作为统一网关
- 服务间通信走网关，由网关统一做负载均衡

---

**思考题：**

假设你维护一个微服务系统，有 3 个 user-service 实例分布在两个机房：

- 实例 A：北京机房，CPU 80%
- 实例 B：北京机房，CPU 20%
- 实例 C：上海机房，CPU 30%

用户主要分布在北京。

问题：
1. 如果使用 Ribbon 的轮询策略，北京用户打到实例 A 的概率是多少？用户体验会怎样？
2. 如果改用「最小连接数」策略，情况会有改善吗？为什么？
3. 如果用户偶然打到了上海机房的实例 C，会产生什么问题？（提示：考虑延迟和数据一致性）
4. 设计一个负载均衡策略，让北京用户尽量打北京的实例，只有北京实例都不健康时才打上海实例。

提示：考虑区域感知 + 熔断器组合使用。
