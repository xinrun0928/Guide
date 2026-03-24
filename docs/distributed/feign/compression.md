# Feign 压缩与连接池配置

你有没有遇到过这种情况：

Feign 调用传输的数据量很大，响应时间很长。优化了业务代码，但还是慢。

问题可能出在**网络传输**上——没有压缩、没有连接池复用。

今天，我们来彻底搞清楚 Feign 的压缩配置和连接池优化。

## HTTP 压缩

### 什么是 HTTP 压缩？

HTTP 压缩是一种减少网络传输量的技术：

```
未压缩：
请求：1MB JSON
响应：1MB JSON
总传输：2MB

GZIP 压缩后：
请求：100KB（压缩后）
响应：100KB（压缩后）
总传输：200KB

节省带宽：90%
```

### Feign 压缩配置

```yaml
feign:
  compression:
    # 启用请求压缩
    request:
      enabled: true
      # 压缩的 MIME 类型
      mime-types: text/xml,application/xml,application/json
      # 最小压缩阈值（小于此大小不压缩）
      min-request-size: 1024

    # 启用响应压缩
    response:
      enabled: true
```

### 服务端也需要配置

客户端配置了压缩，但服务端不支持也没用。确保服务端配置了压缩：

```java
@Configuration
public class CompressionConfig {

    @Bean
    public WebServerFactoryCustomizer<ConfigurableServletWebServerFactory>
            compressionConfig() {
        return factory -> factory.addInitializers(initializer -> {
            initializer.setCompressibleMimeTypes(
                "text/html",
                "text/xml",
                "text/plain",
                "text/css",
                "text/javascript",
                "application/javascript",
                "application/json",
                "application/xml"
            );
        });
    }
}
```

## 连接池配置

默认情况下，Feign 使用 `URLConnection`——**每次请求都会创建新的 TCP 连接**。

TCP 三次握手 + 四次挥手的开销，加上连接建立的等待时间，在高并发场景下会严重影响性能。

### 为什么需要连接池？

```
无连接池：
请求 1 ──→ 建立连接(30ms) ──→ 发送请求 ──→ 响应 ──→ 关闭连接
请求 2 ──→ 建立连接(30ms) ──→ 发送请求 ──→ 响应 ──→ 关闭连接
请求 3 ──→ 建立连接(30ms) ──→ 发送请求 ──→ 响应 ──→ 关闭连接

连接池：
请求 1 ──→ 获取连接(1ms) ──→ 发送请求 ──→ 响应 ──→ 归还连接
请求 2 ──→ 获取连接(1ms) ──→ 发送请求 ──→ 响应 ──→ 归还连接
请求 3 ──→ 获取连接(1ms) ──→ 发送请求 ──→ 响应 ──→ 归还连接
```

**每个请求节省 29ms！**

## OkHttp 连接池

OkHttp 是目前最推荐的 Feign HTTP 客户端。

### 引入依赖

```xml
<dependency>
    <groupId>io.github.openfeign</groupId>
    <artifactId>feign-okhttp</artifactId>
</dependency>
```

### 配置 OkHttp 连接池

```java
@Configuration
public class OkHttpConfig {

    @Bean
    public OkHttpClient okHttpClient() {
        return new OkHttpClient.Builder()
            // 连接超时
            .connectTimeout(5, TimeUnit.SECONDS)
            // 读取超时
            .readTimeout(10, TimeUnit.SECONDS)
            // 写入超时
            .writeTimeout(10, TimeUnit.SECONDS)
            // 连接池
            .connectionPool(new ConnectionPool(
                10,           // 最大空闲连接数
                5,            // 空闲连接存活时间
                TimeUnit.MINUTES
            ))
            // 是否重定向
            .followRedirects(true)
            // 认证
            .authenticator(new Authenticator() {
                @Override
                public Request authenticate(Route route, Response response) {
                    // 返回带认证的请求
                    return response.request().newBuilder()
                        .header("Authorization", getNewToken())
                        .build();
                }
            })
            .build();
    }
}
```

### OkHttp 核心参数说明

| 参数 | 说明 | 建议值 |
|-----|------|-------|
| `connectTimeout` | 连接建立超时 | 5-10 秒 |
| `readTimeout` | 读取响应超时 | 10-30 秒 |
| `writeTimeout` | 发送请求超时 | 10-30 秒 |
| `maxIdleConnections` | 最大空闲连接数 | 根据并发量设置 |
| `keepAliveDuration` | 连接保持时间 | 5 分钟 |

## Apache HttpClient 连接池

除了 OkHttp，也可以使用 Apache HttpClient。

### 引入依赖

```xml
<dependency>
    <groupId>io.github.openfeign</groupId>
    <artifactId>feign-httpclient</artifactId>
</dependency>

<dependency>
    <groupId>org.apache.httpcomponents</groupId>
    <artifactId>httpclient</artifactId>
    <version>4.5.14</version>
</dependency>
```

### 配置 HttpClient 连接池

```java
@Configuration
public class HttpClientConfig {

    @Bean
    public CloseableHttpClient httpClient() {
        // 连接池配置
        PoolingHttpClientConnectionManager connectionManager =
            new PoolingHttpClientConnectionManager(
                30,                         // 最大连接数
                TimeUnit.MINUTES.toMillis(5) // 连接保持时间
            );

        // 每个路由的最大连接数（route = 同一目标主机）
        connectionManager.setDefaultMaxPerRoute(20);

        // 请求配置
        RequestConfig requestConfig = RequestConfig.custom()
            .setConnectTimeout(5000)     // 连接超时
            .setSocketTimeout(10000)      // 读取超时
            .setConnectionRequestTimeout(2000)  // 获取连接超时
            .setRedirectsEnabled(true)    // 允许重定向
            .build();

        return HttpClientBuilder.create()
            .setConnectionManager(connectionManager)
            .setDefaultRequestConfig(requestConfig)
            .addInterceptorFirst(new HttpRequestInterceptor() {
                @Override
                public void process(HttpRequest request,
                                   HttpContext context) {
                    // 添加拦截器
                    request.setHeader("X-Custom-Header", "value");
                }
            })
            .build();
    }
}
```

## OkHttp vs Apache HttpClient

| 维度 | OkHttp | Apache HttpClient |
|-----|--------|------------------|
| **连接池管理** | 内部自动管理 | 需手动配置 |
| **HTTP/2 支持** | ✅ 原生支持 | ❌ 不支持 |
| **连接复用** | 多路复用 | keep-alive |
| **配置复杂度** | 简单 | 复杂 |
| **线程安全** | 完全线程安全 | 需配合连接池 |
| **Android 支持** | ✅ | ❌ |

**推荐**：使用 OkHttp，简单高效。

## 完整配置示例

### 场景：高并发服务调用

```yaml
# application.yml
feign:
  # 启用压缩
  compression:
    request:
      enabled: true
      mime-types: application/json,text/json
      min-request-size: 512
    response:
      enabled: true

  # 客户端配置
  client:
    config:
      default:
        connectTimeout: 5000
        readTimeout: 10000
        loggerLevel: basic

  # 启用 OkHttp
  httpclient:
    enabled: false  # 使用 OkHttp 时禁用 Apache HttpClient

okhttp:
  enabled: true

# OkHttp 连接池（通过 Java 配置）
hystrix:
  command:
    default:
      execution:
        isolation:
          thread:
            timeoutInMilliseconds: 15000
```

```java
// OkHttpConfig.java
@Configuration
@ConditionalOnProperty(name = "okhttp.enabled", havingValue = "true")
public class OkHttpConfig {

    @Value("${feign.okhttp.max-idle-connections:10}")
    private int maxIdleConnections;

    @Value("${feign.okhttp.keep-alive-duration:5}")
    private long keepAliveDuration;

    @Bean
    public OkHttpClient okHttpClient() {
        return new OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .connectionPool(new ConnectionPool(
                maxIdleConnections,
                keepAliveDuration,
                TimeUnit.MINUTES
            ))
            .retryOnConnectionFailure(false)  // 由 Feign Retryer 处理重试
            .addInterceptor(chain -> {
                // 添加请求拦截
                Request original = chain.request();
                Request request = original.newBuilder()
                    .header("Accept-Encoding", "gzip, deflate")
                    .header("Accept", "application/json")
                    .method(original.method(), original.body())
                    .build();
                return chain.proceed(request);
            })
            .addNetworkInterceptor(chain -> {
                // 记录响应时间
                Response response = chain.proceed(chain.request());
                long duration = response.sentRequestAtMillis()
                                     - response.receivedResponseAtMillis();
                Metrics.record("feign.response.time", duration);
                return response;
            })
            .build();
    }
}
```

## 连接池监控

连接池配置好后，最好加上监控：

```java
@Component
public class ConnectionPoolMonitor {

    private final OkHttpClient okHttpClient;

    @Scheduled(fixedRate = 60000)
    public void monitor() {
        ConnectionPool pool = okHttpClient.connectionPool();

        // 获取指标
        int totalConns = pool.connectionCount();
        int idleConns = pool.idleConnectionCount();

        Metrics.gauge("feign.okhttp.total.connections", totalConns);
        Metrics.gauge("feign.okhttp.idle.connections", idleConns);

        if (idleConns > 10) {
            // 空闲连接过多，可以减少 maxIdleConnections
            logger.warn("Too many idle connections: {}", idleConns);
        }
    }
}
```

## 性能对比

```
测试场景：10000 次 HTTP GET 请求

连接池配置：10 连接，5 分钟 keep-alive

┌─────────────────────────────────────────────────────────┐
│                  性能对比                                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  无连接池：                                             │
│  - 总耗时：120,000ms                                    │
│  - 平均延迟：12ms                                       │
│  - QPS：83                                             │
│                                                         │
│  OkHttp 连接池：                                       │
│  - 总耗时：8,000ms                                      │
│  - 平均延迟：0.8ms                                      │
│  - QPS：1250                                           │
│                                                         │
│  性能提升：15x                                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## 面试追问方向

- HTTP 压缩的原理是什么？GZIP 和 DEFLATE 有什么区别？
- OkHttp 的连接池是怎么管理的？空闲连接什么时候被回收？
- 如何排查连接泄漏问题？
- HTTP/2 的多路复用和连接池有什么关系？

## 总结

Feign 的性能优化主要在两个维度：

```
┌─────────────────────────────────────────────────────────┐
│                   Feign 性能优化                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. 压缩（减少传输量）                                   │
│     - 启用 GZIP：feign.compression.request/response      │
│     - 服务端配合：配置压缩响应                           │
│                                                         │
│  2. 连接池（减少连接开销）                               │
│     - 推荐 OkHttp：简单高效                             │
│     - 配置连接数、空闲时间、超时                         │
│     - 配合压缩，QPS 可提升 10-15 倍                      │
│                                                         │
│  3. 其他优化                                            │
│     - 合理超时配置                                       │
│     - 适当重试策略                                       │
│     - 监控连接池状态                                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

在高并发场景下，连接池是必须的。没有连接池，每次请求都建立新连接，性能损耗巨大。
