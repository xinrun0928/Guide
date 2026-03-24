# 全链路限流：网关层 → 应用层 → 资源层限流方案

你的系统每秒能处理 10000 请求，但突然来了 50000 请求。

怎么办？

让所有请求都打进来？系统会过载崩溃。

全部拒绝？用户体验太差。

你需要的是——**限流**。

## 限流的层次

限流不是单点问题，需要在多个层次配合：

```
┌─────────────────────────────────────────────────────────┐
│                      用户请求                            │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│               网关层限流（Nginx/Lua）                     │
│               入口流量控制、IP 限流、接口限流              │
└─────────────────────────┬───────────────────────────────┘
                          │ 通过
                          ▼
┌─────────────────────────────────────────────────────────┐
│               应用层限流（Sentinel/Hystrix）              │
│               接口级别限流、并发数限流                     │
└─────────────────────────┬───────────────────────────────┘
                          │ 通过
                          ▼
┌─────────────────────────────────────────────────────────┐
│               资源层限流（Redis/MQ）                     │
│               数据库连接池、MQ 消费速率                    │
└─────────────────────────────────────────────────────────┘
```

### 网关层限流

Nginx + Lua 限流是最常见的入口限流方案：

```nginx
# Nginx 限流配置
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/s;
limit_req_zone $uri zone=uri_limit:10m rate=1000r/s;

server {
    location /api/ {
        limit_req zone=api_limit burst=200 nodelay;
        proxy_pass http://backend;
    }
}
```

### 应用层限流

Sentinel 是阿里开源的限流熔断框架：

```java
@Configuration
public class SentinelConfig {

    @PostConstruct
    public void init() {
        // 配置热点参数限流
        ParamFlowRule rule = new ParamFlowRule("getUser")
            .setParamIdx(0)  // 第一个参数（userId）
            .setCount(10)    // 每个参数值每秒最多 10 次
            .setDurationInSec(1);
        ParamFlowRuleManager.loadRules(Collections.singletonList(rule));
    }
}

@Service
public class UserService {

    @SentinelResource(value = "getUser", blockHandler = "getUserBlock")
    public User getUser(Long userId) {
        return userRepository.findById(userId);
    }

    // 限流后的处理
    public User getUserBlock(Long userId, BlockException e) {
        return User.FALLBACK;
    }
}
```

### Sentinel 限流算法

Sentinel 支持多种限流算法：

1. **直接拒绝**：请求超过阈值，直接拒绝
2. **冷启动**：让流量逐步增加，避免冷启动冲击
3. **匀速排队**：让请求匀速通过，类似令牌桶
4. **Warm Up Controller**：冷启动 + 逐步增加

### Sentinel + Spring Cloud

```java
@Configuration
public class SentinelWebConfig implements WebServletConfigurer {

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new SentinelInterceptor());
    }
}

@RestController
public class UserController {

    @GetMapping("/user/{id}")
    @SentinelResource(value = "getUser", blockHandler = "getUserBlock")
    public User getUser(@PathVariable Long id) {
        return userService.getUser(id);
    }
}
```

### 资源层限流

数据库连接池是最常见的资源层限流：

```java
// Druid 连接池配置
DruidDataSource dataSource = new DruidDataSource();
dataSource.setInitialSize(10);         // 初始连接数
dataSource.setMinIdle(10);              // 最小连接数
dataSource.setMaxActive(100);           // 最大连接数
dataSource.setMaxWait(3000);            // 最大等待时间
dataSource.setTimeBetweenEvictionRunsMillis(60000);  // 连接检测间隔
dataSource.setMinEvictableIdleTimeMillis(300000);   // 最小空闲时间
```

## 全链路限流的实现

### 流量染色

在请求头中标记流量来源和优先级：

```java
public class FlowContext {
    public static final String HEADER_TRACE_ID = "X-Trace-Id";
    public static final String HEADER_PRIORITY = "X-Request-Priority";
    public static final String PRIORITY_HIGH = "high";
    public static final String PRIORITY_NORMAL = "normal";
    public static final String PRIORITY_LOW = "low";
}

// 网关设置优先级
public class GatewayFilter {
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String priority = determinePriority(exchange);
        exchange.getRequest().mutate()
            .header(FlowContext.HEADER_PRIORITY, priority)
            .build();
        return chain.filter(exchange);
    }
}
```

### 分层限流配置

```java
@Configuration
public class FlowControlConfig {

    // 网关层：限制总入口流量
    @Bean
    public RouteLimiter gatewayLimiter() {
        return new RouteLimiter(10000);  // 每秒 10000 请求
    }

    // 应用层：限制接口流量
    @Bean
    public SentinelConfig sentinelConfig() {
        List&lt;FlowRule&gt; rules = new ArrayList&lt;&gt;();

        // 核心接口：100% 流量
        FlowRule coreRule = new FlowRule("getProduct");
        coreRule.setCount(5000);
        coreRule.setGrade(RuleConstant.FLOW_GRADE_QPS);
        rules.add(coreRule);

        // 非核心接口：50% 流量
        FlowRule normalRule = new FlowRule("getRecommend");
        normalRule.setCount(1000);
        normalRule.setGrade(RuleConstant.FLOW_GRADE_QPS);
        rules.add(normalRule);

        FlowRuleManager.loadRules(rules);
        return new SentinelConfig();
    }

    // 资源层：限制数据库连接
    @Bean
    public DataSource dataSource() {
        DruidDataSource dataSource = new DruidDataSource();
        dataSource.setMaxActive(100);  // 最大 100 连接
        return dataSource;
    }
}
```

### 限流与降级配合

限流后，需要配合降级策略：

```java
@SentinelResource(value = "getUser", blockHandler = "getUserBlock",
                  fallback = "getUserFallback")
public User getUser(Long userId) {
    return userRepository.findById(userId);
}

// 限流处理
public User getUserBlock(Long userId, BlockException e) {
    return User.FALLBACK;  // 返回兜底数据
}

// 异常处理
public User getUserFallback(Long userId, Throwable t) {
    return User.FALLBACK;  // 返回兜底数据
}
```

## 面试追问方向

- 限流的三个层次分别限什么？（答：网关层限总入口流量，应用层限接口流量，资源层限数据库/缓存连接）
- 滑动窗口和令牌桶的区别？（答：滑动窗口统计一段时间内的请求数，令牌桶按固定速率放行）
- Sentinel 和 Hystrix 的区别？（答：Sentinel 是滑动窗口，Hystrix 是滚动窗口；Sentinel 功能更丰富）
- 限流后返回什么？（答：友好错误信息、兜底数据、排队等待）

## 小结

全链路限流需要分层配合：

1. **网关层**：总入口限流，IP 限流，防刷
2. **应用层**：接口限流，热点参数限流
3. **资源层**：数据库连接池、MQ 消费限流

限流不是拒绝所有请求，而是**让系统安全地处理它能处理的请求**。
