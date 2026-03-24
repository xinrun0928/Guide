# Feign 拦截器与请求拦截

你有没有遇到过这种情况：

后端微服务需要认证，调用接口时要在每个请求里带上 Token。如果每个 Feign Client 都写一遍，那代码就太冗余了。

还有一个场景：你想知道每个请求花了多少时间，怎么在 Feign 层面统一记录日志？

这两个问题，都可以用 **Feign 拦截器**来解决。

今天，我们来彻底搞清楚 Feign 的拦截器机制。

## Feign 的两种拦截器

Feign 支持两种类型的拦截器：

| 类型 | 接口 | 作用 |
|-----|------|------|
| **RequestInterceptor** | 请求拦截器 | 修改请求 Header、参数等 |
| **Retryer** | 重试拦截器 | 控制重试逻辑 |

## RequestInterceptor：请求拦截器

`RequestInterceptor` 是最常用的拦截器，用于拦截和处理请求。

### 接口定义

```java
public interface RequestInterceptor {

    /**
     * 拦截每个请求，进行处理
     */
    void apply(RequestTemplate template);
}
```

### 使用场景

#### 场景 1：添加认证 Token

```java
@Component
public class AuthRequestInterceptor implements RequestInterceptor {

    @Override
    public void apply(RequestTemplate template) {
        // 从 ThreadLocal 或 SecurityContext 获取 Token
        String token = SecurityContext.getToken();

        if (token != null) {
            // 添加到请求 Header
            template.header("Authorization", "Bearer " + token);
        }
    }
}
```

#### 场景 2：添加 TraceId（链路追踪）

```java
@Component
public class TracingRequestInterceptor implements RequestInterceptor {

    @Override
    public void apply(RequestTemplate template) {
        // 生成或获取 TraceId
        String traceId = MDC.get("traceId");
        if (traceId == null) {
            traceId = UUID.randomUUID().toString();
        }

        // 添加到请求 Header
        template.header("X-Trace-Id", traceId);
    }
}
```

#### 场景 3：灰度路由

```java
@Component
public class GrayRoutingInterceptor implements RequestInterceptor {

    @Value("${gray.version:}")
    private String grayVersion;

    @Override
    public void apply(RequestTemplate template) {
        if (StringUtils.hasText(grayVersion)) {
            // 根据配置路由到不同版本
            template.header("X-Gray-Version", grayVersion);
        }
    }
}
```

#### 场景 4：Tenant 多租户

```java
@Component
public class TenantRequestInterceptor implements RequestInterceptor {

    @Override
    public void apply(RequestTemplate template) {
        // 从上下文获取租户 ID
        String tenantId = TenantContext.getCurrentTenant();

        if (tenantId != null) {
            template.header("X-Tenant-Id", tenantId);
        }
    }
}
```

### 全局拦截器配置

```java
@Configuration
public class FeignInterceptorConfig {

    @Bean
    public RequestInterceptor authInterceptor() {
        return new AuthRequestInterceptor();
    }

    @Bean
    public RequestInterceptor tracingInterceptor() {
        return new TracingRequestInterceptor();
    }

    @Bean
    public RequestInterceptor tenantInterceptor() {
        return new TenantRequestInterceptor();
    }
}
```

### 特定客户端拦截器

```java
// 只对特定客户端生效的拦截器
@Configuration
public class UserClientConfig {

    @Bean
    public RequestInterceptor userInterceptor() {
        return template -> {
            // 只对 UserClient 生效的逻辑
            template.header("X-User-Source", "web");
        };
    }
}

@FeignClient(
    name = "user-service",
    configuration = UserClientConfig.class
)
public interface UserClient { }
```

## Retryer：重试拦截器

`Retryer` 控制 Feign 的重试行为。

### 接口定义

```java
public interface Retryer extends Cloneable {

    /**
     * 继续重试还是停止
     */
    void continueOrPropagate(RetryableException e);

    /**
     * 克隆新的 Retryer
     */
    Retryer clone();

    // 内置实现
    Retryer NEVER_RETRY = new Retryer() {
        @Override
        public void continueOrPropagate(RetryableException e) {
            throw e;
        }

        @Override
        public Retryer clone() {
            return this;
        }
    };
}
```

### 内置 Retryer

```java
// 默认重试策略：最多重试 5 次
public class Retryer.Default implements Retryer {

    private final int maxAttempts;        // 最大尝试次数
    private final long period;             // 初始间隔
    private final long maxPeriod;          // 最大间隔

    private int attempt;
    private long sleptForMillis;

    @Override
    public void continueOrPropagate(RetryableException e) {
        if (attempt++ >= maxAttempts) {
            throw e;
        }

        // 计算下次重试间隔（指数退避）
        long interval = calculateInterval();
        try {
            Thread.sleep(interval);
        } catch (InterruptedException e1) {
            Thread.currentThread().interrupt();
        }
        sleptForMillis += interval;
    }

    private long calculateInterval() {
        double multiply = Math.min(1.5, period * Math.pow(1.5, attempt - 1));
        long result = (long) multiply;
        return Math.min(result, maxPeriod);
    }
}
```

### 自定义重试策略

```java
@Configuration
public class CustomRetryerConfig {

    @Bean
    public Retryer retryer() {
        return new Retryer.Default(100, 1000, 3);
        // 初始间隔 100ms，最大间隔 1000ms，最多 3 次
    }
}
```

### 条件重试

```java
public class ConditionalRetryer implements Retryer {

    private final Retryer delegate;

    public ConditionalRetryer() {
        this.delegate = new Retryer.Default(100, 1000, 3);
    }

    @Override
    public void continueOrPropagate(RetryableException e) {
        // 只对 GET 请求重试
        if ("GET".equals(e.method())
            && e.status() == 503) {  // 只对服务不可用重试
            delegate.continueOrPropagate(e);
        } else {
            throw e;
        }
    }

    @Override
    public Retryer clone() {
        return this;
    }
}
```

## 请求/响应日志

### 配置日志级别

```java
@Configuration
public class FeignLoggingConfig {

    @Bean
    Logger.Level feignLoggerLevel() {
        // NONE：不记录日志
        // BASIC：只记录请求方法、URL、响应状态码
        // HEADERS：记录请求和响应的 Header
        // FULL：记录全部，包括请求体和响应体
        return Logger.Level.FULL;
    }
}
```

### 日志输出

配置完成后，可以在日志中看到：

```
// BASIC 日志
2024-01-15 10:30:00 [user-service] GET /users/123 -> 200 OK (45ms)

// HEADERS 日志
2024-01-15 10:30:00 [user-service] GET /users/123
  Accept: application/json
  Authorization: Bearer xxx
  <- 200 OK (45ms)
  Content-Type: application/json
  Content-Length: 256

// FULL 日志
2024-01-15 10:30:00 [user-service] GET /users/123
  Accept: application/json
  Authorization: Bearer xxx
  <- 200 OK (45ms)
  Content-Type: application/json
  {"id":123,"name":"张三","age":25}
```

### YAML 配置日志级别

```yaml
logging:
  level:
    # Feign 日志级别
    com.example.feign: DEBUG
    # HTTP 请求日志
    feign.Logger: DEBUG
    # 服务发现日志
    com.netflix.loadbalancer: INFO
```

## 拦截器链执行顺序

多个拦截器按添加顺序执行：

```
请求流程：

RequestInterceptor #1
        ↓
RequestInterceptor #2
        ↓
RequestInterceptor #3
        ↓
   HTTP 请求发送
        ↓
ResponseInterceptor #1 (如果有)
        ↓
ResponseInterceptor #2 (如果有)
        ↓
返回响应
```

## 完整示例

### 场景：实现 SSO 单点登录 + 链路追踪 + 多租户

```java
// 1. SSO Token 拦截器
@Component
public class SsoTokenInterceptor implements RequestInterceptor {

    @Override
    public void apply(RequestTemplate template) {
        String token = SsoContext.getToken();
        if (token != null) {
            template.header("Authorization", "Bearer " + token);
        }
    }
}

// 2. 链路追踪拦截器
@Component
public class TraceInterceptor implements RequestInterceptor {

    @Override
    public void apply(RequestTemplate template) {
        String traceId = TraceContext.getTraceId();
        if (traceId == null) {
            traceId = UUID.randomUUID().toString();
        }
        template.header("X-Trace-Id", traceId);
        template.header("X-Span-Id", SpanContext.getCurrentSpanId());
    }
}

// 3. 多租户拦截器
@Component
public class TenantInterceptor implements RequestInterceptor {

    @Override
    public void apply(RequestTemplate template) {
        String tenantId = TenantContext.getTenantId();
        if (tenantId != null) {
            template.header("X-Tenant-Id", tenantId);
        }
    }
}

// 4. 重试策略
@Configuration
public class RetryConfig {

    @Bean
    public Retryer retryer() {
        // GET 请求重试 3 次，POST 不重试
        return new Retryer.Default(100, 1000, 3);
    }
}
```

```java
// 5. 统一配置
@Configuration
public class FeignGlobalConfig {

    @Bean
    public Logger.Level feignLoggerLevel() {
        return Logger.Level.HEADERS;
    }
}
```

```yaml
# application.yml
feign:
  client:
    config:
      default:
        connectTimeout: 5000
        readTimeout: 10000
        loggerLevel: basic
```

## 面试追问方向

- Feign 的拦截器是同步还是异步执行的？
- 如何实现请求响应的统一日志记录？（使用 Logger.Level.FULL）
- Feign 的重试机制和 Ribbon 的重试机制是什么关系？
- 如果 Token 过期了，如何在拦截器中统一刷新？

## 总结

Feign 拦截器是实现横切关注点的好工具：

```
┌─────────────────────────────────────────────────────────┐
│                   拦截器应用场景                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  RequestInterceptor：                                   │
│  - 认证授权（添加 Token）                                │
│  - 链路追踪（添加 TraceId）                              │
│  - 灰度路由（添加版本 Header）                           │
│  - 多租户隔离（添加 TenantId）                           │
│  - 请求签名（添加签名）                                  │
│  - 统一参数（添加公共参数）                              │
│                                                         │
│  Retryer：                                              │
│  - 重试策略配置                                         │
│  - 条件重试                                             │
│                                                         │
│  Logger：                                               │
│  - 请求响应日志                                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

合理使用拦截器，可以让 Feign 客户端的代码更加简洁，把横切逻辑集中在拦截器中处理。
