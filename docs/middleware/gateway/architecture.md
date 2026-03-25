# API 网关架构设计要点

凌晨 3 点，你的手机响了——报警信息显示 API 网关所在机器的 CPU 使用率达到 98%。你紧急扩容，却发现新上线的实例还没来得及注册就被流量冲垮了。

这不是故事，是真实发生过的事故。API 网关作为流量的唯一入口，架构设计的好坏直接决定了整个系统的稳定性。

那么，如何设计一个高可用的网关架构？

## 网关在架构中的位置

在讨论具体设计之前，先明确网关在整体架构中的定位：

```
┌─────────────┐
│   客户端    │  ← 用户浏览器、App、第三方系统
└──────┬──────┘
       │
       │ HTTP/HTTPS
       ▼
┌─────────────┐
│   CDN/DNS   │  ← 静态资源加速、域名解析
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  负载均衡器 │  ← LVS、Nginx、HAProxy
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   API 网关  │  ← 流量入口，统一入口
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  服务网格   │  ← 可选，Sidecar 代理
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  微服务集群 │  ← 业务逻辑层
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  数据层     │  ← MySQL、Redis、ES
└─────────────┘
```

可以看到，API 网关位于**负载均衡器之后、微服务之前**。它接收所有进入的流量，进行统一处理后再转发到后端服务。

## 高可用设计：不能单点

网关是流量的咽喉要道，必须保证高可用。常见的高可用设计方案：

### 方案一：集群部署 + 负载均衡

这是最常见的方案。部署多个网关实例，前面用 Nginx 或云厂商的 ALB 做负载均衡：

```yaml
# Kubernetes 部署示例
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gateway
spec:
  replicas: 3  # 部署 3 个副本
  selector:
    matchLabels:
      app: gateway
  template:
    metadata:
      labels:
        app: gateway
    spec:
      containers:
      - name: gateway
        image: gateway:latest
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
---
apiVersion: v1
kind: Service
metadata:
  name: gateway
spec:
  type: ClusterIP
  selector:
    app: gateway
  ports:
  - port: 80
    targetPort: 8080
```

```nginx
# Nginx 负载均衡配置
upstream gateway_backend {
    server 192.168.1.10:8080;
    server 192.168.1.11:8080;
    server 192.168.1.12:8080;
    
    # 健康检查
    check interval=3000 rise=2 fall=3 timeout=1000 type=http;
    check_http_send "GET /health HTTP/1.0\r\n\r\n";
    check_http_expect_alive http_2xx;
}

server {
    listen 80;
    location / {
        proxy_pass http://gateway_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 方案二：多活部署

对于大型互联网公司，可能会采用多活架构——在多个地域同时部署网关，各自承接本地流量：

- **同城多活**：多个机房在同一城市，互相灾备
- **异地多活**：跨城市甚至跨国家部署

多活架构的核心挑战是**数据一致性**和**流量调度**。

### 方案三：边缘网关 + 中心网关

对于全球化业务，可以采用两层网关：

- **边缘网关（Edge Gateway）**：部署在 CDN 节点附近，处理简单的路由、SSL 终止
- **中心网关（Central Gateway）**：处理复杂的认证、限流、业务逻辑

```
用户请求 → CDN 边缘节点 → 边缘网关（简单路由） → 中心网关（复杂逻辑） → 后端服务
```

## 性能设计：快是王道

网关的性能直接影响用户体验。每一个经过网关的请求，都会增加额外的延迟。如果网关本身成为瓶颈，后端服务再快也没用。

### 异步非阻塞：核心原则

传统同步阻塞模式：

```java
// 同步模式：线程等待 I/O 时阻塞，无法处理其他请求
@RestController
public class SyncGatewayController {
    @GetMapping("/api/**")
    public String forward(String path) {
        // 请求到达后，线程在这里阻塞等待下游响应
        String response = restTemplate.getForObject("http://backend/" + path, String.class);
        return response;
    }
}
```

响应式异步模式：

```java
// 异步模式：线程不阻塞，可处理其他请求
@RestController
public class AsyncGatewayController {
    @GetMapping("/api/**")
    public Mono&lt;String&gt; forward(String path) {
        // 使用 WebClient，非阻塞调用
        return webClient.get()
            .uri("http://backend/" + path)
            .retrieve()
            .bodyToMono(String.class);  // 返回 Mono，不阻塞线程
    }
}
```

Spring Cloud Gateway 基于 WebFlux，使用 Netty 进行异步非阻塞 I/O，单机 QPS 可以达到数万级别。

### 连接池复用：减少连接开销

每次 HTTP 请求都需要建立 TCP 连接，这个过程有三次握手的开销。对于高并发场景，应该复用连接：

```java
// 配置连接池
@Bean
public WebClient webClient() {
    HttpClient httpClient = HttpClient.create()
        .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5000)
        .responseTimeout(Duration.ofMillis(5000))
        // 连接池配置：最大连接数、最大空闲时间
        .poolConfig(poolConfig -&gt; poolConfig
            .maxConnections(500)  // 最大 500 个连接
            .maxIdleTime(Duration.ofSeconds(20))  // 空闲 20 秒回收
            .minIdle(10));  // 最小保持 10 个连接
    
    return WebClient.builder()
        .clientConnector(new ReactorClientHttpConnector(httpClient))
        .build();
}
```

### 本地缓存：减少下游调用

对于不经常变化的配置和数据，可以在网关层做本地缓存：

| 缓存内容 | 缓存时间 | 说明 |
|---|---|---|
| 路由配置 | 5 分钟 | 路由规则通常变更不频繁 |
| 用户 Token | Token 过期时间内 | 减少 Token 验证的调用 |
| 服务发现 | 30 秒 | 平衡实时性和性能 |
| 限流计数器 | 1 秒 | 滑动窗口计数器 |

## 可扩展设计：插件化架构

网关需要不断适应新的需求，插件化架构可以让网关在不修改核心代码的情况下扩展功能。

### 设计模式：责任链 + 策略

网关的核心是过滤器链（将在[过滤器链文档](/middleware/gateway/filter-chain)中详细讲解），但对于一些需要灵活配置的扩展点，可以采用策略模式：

```java
// 认证策略接口
public interface AuthStrategy {
    /**
     * 判断当前请求是否匹配此策略
     * 例如：路径匹配、Header 匹配等
     */
    boolean matches(ServerWebExchange exchange);
    
    /**
     * 执行认证
     * 返回认证结果和用户信息
     */
    AuthResult authenticate(ServerWebExchange exchange);
    
    /**
     * 策略优先级，数字越小优先级越高
     */
    default int getOrder() {
        return 100;
    }
}

// JWT 认证策略
@Component
public class JwtAuthStrategy implements AuthStrategy {
    
    @Override
    public boolean matches(ServerWebExchange exchange) {
        String path = exchange.getRequest().getPath().value();
        // 只有 /api/ 路径需要认证
        return path.startsWith("/api/");
    }
    
    @Override
    public AuthResult authenticate(ServerWebExchange exchange) {
        String token = exchange.getRequest().getHeaders().getFirst("Authorization");
        // JWT 验证逻辑...
        return new AuthResult(/* ... */);
    }
}

// 网关选择认证策略
@Service
public class AuthStrategySelector {
    @Autowired
    private List&lt;AuthStrategy&gt; strategies;
    
    public AuthStrategy select(ServerWebExchange exchange) {
        // 按优先级排序后选择第一个匹配的策略
        return strategies.stream()
            .sorted(Comparator.comparingInt(AuthStrategy::getOrder))
            .filter(s -&gt; s.matches(exchange))
            .findFirst()
            .orElse(null);
    }
}
```

### 插件生命周期

一个完整的插件应该有清晰的生命周期：

```
插件加载 → 插件初始化 → 插件配置 → 插件执行 → 插件卸载
    ↓            ↓           ↓          ↓          ↓
   启动时      启动时      可动态      请求处理    运行时
   扫描       实例化      更新        回调        剔除
```

## 安全性设计：守好大门

### SSL/TLS 终止

外部请求应该使用 HTTPS 加密传输，但后端服务之间的通信可以选择使用 HTTP 来减少加密解密开销：

```
客户端 --HTTPS--> 网关（解密） --HTTP--> 后端服务
```

这种模式叫做 **SSL Termination**，由网关统一处理加密解密。

### 防攻击措施

| 攻击类型 | 防护措施 |
|---|---|
| DDoS | 限流 + 弹性扩容 + CDN 防护 |
| SQL 注入 | 参数校验 + 转义 |
| XSS | 输出编码 |
| CSRF | Token 验证 |
| 重放攻击 | 请求签名 + 时间戳 + 唯一 nonce |

### 请求签名

对于重要的接口，可以使用请求签名来防止请求被篡改：

```java
// 请求签名生成
public String generateSignature(String secretKey, Map&lt;String, String&gt; params) {
    // 1. 按字典序排序参数
    String sortedParams = params.entrySet().stream()
        .sorted(Map.Entry.comparingByKey())
        .map(e -&gt; e.getKey() + "=" + e.getValue())
        .collect(Collectors.joining("&amp;"));
    
    // 2. 拼接密钥
    String data = sortedParams + secretKey;
    
    // 3. 计算 HMAC-SHA256
    return HMAC_SHA256(data);
}
```

## 总结

API 网关架构设计的核心要点：

| 设计维度 | 关键考虑 | 常见方案 |
|---|---|---|
| 高可用 | 不能单点、自动恢复 | 集群 + 负载均衡、多活部署 |
| 性能 | 低延迟、高吞吐 | 异步非阻塞、连接池复用、本地缓存 |
| 可扩展 | 灵活插拔、动态配置 | 插件化、责任链 + 策略模式 |
| 安全 | 传输加密、防攻击 | SSL 终止、限流、请求签名 |

---

**留给你的问题**

网关架构中有一个经典的 Trade-off：**「智能网关」vs「哑网关」**。智能网关在网关层做尽可能多的处理（认证、鉴权、业务逻辑），哑网关只做纯粹的路由转发。你倾向于哪种设计？为什么？
