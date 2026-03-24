# 接口超时设计：超时传递与最佳实践

你见过这种现象吗？

用户点击一个按钮，结果页面转圈了 30 秒，最后报错「请求超时」。

你去查日志，发现服务端只用了 50ms 就返回了。问题出在哪？

答案是：**超时设置不合理**。客户端设置了 30 秒超时，但 DNS 解析花了 5 秒、连接建立花了 10 秒、负载均衡器排队等了 15 秒……真正留给业务逻辑的时间，只有那么可怜的几百毫秒。

接口超时设计，看似简单，实则是个技术活。

## 为什么超时设计这么重要

### 超时的本质

超时是系统的「自我保护机制」——当一个操作花费的时间超过预期时，主动放弃，避免资源无限等待。

```
请求进来
    │
    ▼
┌─────────────────────────────────────────┐
│           超时计时开始                    │
│                                         │
│  DNS解析 ──▶ 建立连接 ──▶ 负载均衡       │
│    │           │            │          │
│   5s          10s           5s          │
│    │           │            │          │
│    ▼           ▼            ▼          │
│  ┌─────────────────────────────────┐   │
│  │      留给业务逻辑的时间           │   │
│  │      30s - 5s - 10s - 5s = 10s  │   │
│  └─────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

### 超时设置不当的后果

| 问题 | 后果 |
|------|------|
| 超时时间过长 | 线程/连接资源被耗尽，请求堆积 |
| 超时时间过短 | 正常请求被误杀，用户体验差 |
| 超时时间不传递 | 链路中某个节点超时，后果被放大 |
| 没有超时 | 请求可能永远等待下去 |

## 超时的类型

### 1. 连接超时（Connect Timeout）

建立 TCP 连接的时间。

```java
// OkHttp
OkHttpClient client = new OkHttpClient.Builder()
    .connectTimeout(5, TimeUnit.SECONDS)  // 连接超时 5 秒
    .build();

// HttpClient
CloseableHttpClient httpClient = HttpClientBuilder.create()
    .setConnectTimeout(Timeout.ofMilliseconds(5000))
    .build();

// RestTemplate
RestTemplate template = new RestTemplate();
template.setConnectTimeout(5000);
```

### 2. 读取超时（Read Timeout）

从建立连接到读取完数据的总时间。

```java
// OkHttp
OkHttpClient client = new OkHttpClient.Builder()
    .readTimeout(30, TimeUnit.SECONDS)  // 读取超时 30 秒
    .build();

// HttpClient
CloseableHttpClient httpClient = HttpClientBuilder.create()
    .setSocketTimeout(Timeout.ofMilliseconds(30000))
    .build();

// Feign
@FeignClient(name = "userService",
    configuration = FeignConfig.class)
public interface UserClient {
    @RequestLine("GET /user/{id}")
    User getUser(@Param("id") Long id);
}

@Configuration
class FeignConfig {
    @Bean
    public Contract feignContract() {
        return new Contract.Default();
    }
}

// application.yml
feign:
  client:
    config:
      default:
        connectTimeout: 5000
        readTimeout: 30000
```

### 3. 写入超时（Write Timeout）

发送请求数据的时间。

```java
// OkHttp
OkHttpClient client = new OkHttpClient.Builder()
    .writeTimeout(10, TimeUnit.SECONDS)  // 写入超时 10 秒
    .build();
```

### 4. 混合超时

有些场景需要组合使用。

```java
// 综合配置
OkHttpClient client = new OkHttpClient.Builder()
    .connectTimeout(5, TimeUnit.SECONDS)    // 建连 5 秒
    .readTimeout(30, TimeUnit.SECONDS)      // 读数据 30 秒
    .writeTimeout(10, TimeUnit.SECONDS)     // 写数据 10 秒
    .callTimeout(60, TimeUnit.SECONDS)      // 整个调用 60 秒
    .build();
```

## 超时传递：链路超时设计

### 什么是超时传递

在微服务架构中，一个请求可能经过多个服务。如果每个服务都各自设置超时，不考虑整条链路的超时预算，就会出现「前面服务很快，后面服务没时间」的问题。

```
用户请求 → 网关(5s) → 服务A(3s) → 服务B(2s) → 服务C(1s)
                                    ↑
                              服务B设置了3秒超时
                              但上游已经用掉了8秒！
```

### 超时传递的原则

**原则：下游超时时间 = 剩余可用时间 - 缓冲时间**

```java
public class TimeoutPropagation {

    private static final long TOTAL_TIMEOUT = 30_000;  // 总超时 30 秒
    private static final long BUFFER = 2_000;          // 缓冲 2 秒

    public void callDownstream(String serviceName,
                               List&lt;String&gt; remainingServices) {
        // 计算下游可用的超时时间
        long usedTime = measureUsedTime();
        long remainingTime = TOTAL_TIMEOUT - usedTime;
        long downstreamTimeout = remainingTime - BUFFER;

        if (downstreamTimeout &lt;= 0) {
            throw new TimeoutException("链路超时，无法调用下游服务");
        }

        // 传递给下游
        Map&lt;String, String&gt; headers = new HashMap&lt;&gt;();
        headers.put("X-Timeout", String.valueOf(downstreamTimeout));

        callService(serviceName, headers, downstreamTimeout);
    }
}
```

### 超时传递的实现

#### 1. 通过 Header 传递

```java
// 发送方
public class TimeoutHeaderInterceptor implements ClientHttpRequestInterceptor {

    @Override
    public ClientHttpResponse intercept(HttpRequest request,
            byte[] body, ClientHttpRequestExecution execution) throws IOException {
        // 从当前上下文中获取剩余超时时间
        Long remainingTimeout = RequestContextHolder.getRemainingTimeout();

        if (remainingTimeout != null) {
            request.getHeaders().add("X-Timeout", remainingTimeout.toString());
        }

        return execution.execute(request, body);
    }
}

// 接收方
public class TimeoutHeaderFilter implements Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
            FilterChain chain) throws IOException, ServletException {
        HttpServletRequest httpRequest = (HttpServletRequest) request;
        String timeoutHeader = httpRequest.getHeader("X-Timeout");

        if (timeoutHeader != null) {
            long timeout = Long.parseLong(timeoutHeader);
            RequestContextHolder.setRemainingTimeout(timeout);
        }

        try {
            chain.doFilter(request, response);
        } finally {
            RequestContextHolder.clear();
        }
    }
}
```

#### 2. 通过 ThreadLocal 传递

```java
public class RequestContextHolder {

    private static final ThreadLocal&lt;Long&gt; remainingTimeout = new ThreadLocal&lt;&gt;();
    private static final ThreadLocal&lt;Long&gt; startTime = new ThreadLocal&lt;&gt;();

    public static void init(long totalTimeout) {
        remainingTimeout.set(totalTimeout);
        startTime.set(System.currentTimeMillis());
    }

    public static Long getRemainingTimeout() {
        Long timeout = remainingTimeout.get();
        if (timeout != null) {
            Long start = startTime.get();
            if (start != null) {
                long elapsed = System.currentTimeMillis() - start;
                return Math.max(0, timeout - elapsed);
            }
        }
        return null;
    }

    public static void clear() {
        remainingTimeout.remove();
        startTime.remove();
    }
}
```

## 超时配置最佳实践

### 1. 分层超时配置

```
┌─────────────────────────────────────────────┐
│           客户端超时（用户感知）              │
│           一般设置 30-60 秒                  │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│           网关超时                           │
│           一般设置 5-10 秒                   │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│           服务间调用超时                     │
│           根据业务设置 1-5 秒                │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│           数据库/缓存超时                     │
│           一般设置 100-500 毫秒             │
└─────────────────────────────────────────────┘
```

### 2. 不同接口不同超时

```java
@Configuration
public class TimeoutConfiguration {

    @Bean
    public TimeoutProperties timeoutProperties() {
        TimeoutProperties props = new TimeoutProperties();

        // 查询接口：可以稍长
        props.put("GET_USER", 3000L);        // 3 秒
        props.put("LIST_PRODUCTS", 5000L);   // 5 秒

        // 写入接口：通常较短
        props.put("CREATE_ORDER", 5000L);    // 5 秒
        props.put("PAYMENT", 10000L);        // 10 秒

        // 异步接口：可以很长
        props.put("EXPORT_DATA", 300000L);   // 5 分钟
        props.put("SEND_EMAIL", 30000L);     // 30 秒

        return props;
    }

    public Map&lt;String, Long&gt; getTimeout(String operation) {
        return timeoutProperties().getTimeouts();
    }
}
```

### 3. 动态超时配置

```java
public class DynamicTimeoutManager {

    private final Config configCenter;
    private final Map&lt;String, AtomicLong&gt; timeoutCache = new ConcurrentHashMap&lt;&gt;();

    public long getTimeout(String service, String method) {
        String key = service + ":" + method;

        // 缓存并定期刷新
        AtomicLong cached = timeoutCache.get(key);
        if (cached != null) {
            return cached.get();
        }

        // 从配置中心获取
        String configKey = "timeout." + key;
        long timeout = configCenter.getLong(configKey, getDefaultTimeout(method));

        timeoutCache.put(key, new AtomicLong(timeout));
        return timeout;
    }

    private long getDefaultTimeout(String method) {
        if (method.startsWith("get") || method.startsWith("list")) {
            return 3000;  // 查询 3 秒
        } else if (method.startsWith("create") || method.startsWith("update")) {
            return 5000;  // 写入 5 秒
        } else if (method.startsWith("delete")) {
            return 3000;  // 删除 3 秒
        }
        return 10000;  // 默认 10 秒
    }
}
```

## 超时处理策略

### 1. 快速失败

超时后立即返回错误，不等待。

```java
public Response callService() {
    try {
        return httpClient.call(remoteService, timeout);
    } catch (TimeoutException e) {
        log.warn("服务调用超时: {}", remoteService);
        return Response.error("服务响应超时，请稍后重试");
    }
}
```

### 2. 降级处理

超时后返回降级数据。

```java
public ProductDetail getProductDetail(Long productId) {
    try {
        return productService.getDetail(productId);
    } catch (TimeoutException e) {
        // 降级：返回缓存数据
        ProductDetail cached = productCache.get(productId);
        if (cached != null) {
            log.info("商品详情降级返回: productId={}", productId);
            return cached;
        }

        // 兜底：返回最小化数据
        return ProductDetail.builder()
            .productId(productId)
            .name("商品" + productId)
            .status("降级")
            .build();
    }
}
```

### 3. 重试 + 超时

结合重试机制，在超时后尝试其他节点。

```java
public Response callWithRetry() {
    List&lt;String&gt; endpoints = loadBalancer.getEndpoints();

    for (String endpoint : endpoints) {
        try {
            return httpClient.call(endpoint, timeout);
        } catch (Exception e) {
            log.warn("调用 {} 失败: {}", endpoint, e.getMessage());
            continue;
        }
    }

    throw new ServiceUnavailableException("所有服务节点均不可用");
}
```

## 超时监控与告警

### 1. 监控超时统计

```java
public class TimeoutMonitor {

    private final MeterRegistry meterRegistry;
    private final Map&lt;String, Counter&gt; timeoutCounters = new ConcurrentHashMap&lt;&gt;();
    private final Map&lt;String, Timer&gt; latencyTimers = new ConcurrentHashMap&lt;&gt;();

    public void recordTimeout(String service, long duration) {
        timeoutCounters.computeIfAbsent(service,
            k -> meterRegistry.counter("timeout.total", "service", k))
            .increment();

        Timer timer = latencyTimers.get(service);
        if (timer != null) {
            timer.record(duration, TimeUnit.MILLISECONDS);
        }
    }

    public Map&lt;String, Double&gt; getTimeoutRate() {
        Map&lt;String, Double&gt; rates = new HashMap&lt;&gt;();
        timeoutCounters.forEach((service, counter) -> {
            Counter total = meterRegistry.counter("call.total", "service", service);
            double timeoutRate = counter.count() / (total.count() + counter.count());
            rates.put(service, timeoutRate);
        });
        return rates;
    }
}
```

### 2. 超时告警

```java
@Configuration
public class TimeoutAlertConfiguration {

    @Bean
    public ScheduledReporter timeoutAlertReporter(TimeoutMonitor monitor,
            AlertManager alertManager) {
        return new ScheduledReporter() {
            @Override
            public void run() {
                Map&lt;String, Double&gt; rates = monitor.getTimeoutRate();

                rates.forEach((service, rate) -&gt; {
                    if (rate > 0.1) {  // 超时率超过 10%
                        alertManager.send(Alert.builder()
                            .level(AlertLevel.WARNING)
                            .title("服务超时率过高")
                            .message(String.format(
                                "服务 %s 超时率: %.2f%%", service, rate * 100))
                            .build());
                    }
                });
            }
        };
    }
}
```

---

**思考题：**

假设你负责一个微服务系统，服务链路是：网关 → 订单服务 → 库存服务 → 数据库。

1. 如果数据库响应慢（10 秒），库存服务设置了 8 秒超时，订单服务设置了 5 秒超时，会发生什么？

2. 如何设计超时传递机制，确保整条链路的超时时间是可控的？

3. 超时时间设置是「宁大勿小」还是「宁小勿大」？各有什么风险？

4. 如果某个接口的超时率突然从 1% 飙升到 20%，但所有服务的健康检查都显示正常，可能是什么原因？如何排查？
