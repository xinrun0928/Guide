# API 网关核心功能

想象一下古代的城门——它不是简单地把人放进去就完了。守城士兵要检查通行证、收取关税、登记信息，必要时还得拒绝进城。API 网关就是现代微服务架构的「城门」，所有外部流量都必须经过这道关卡。

那么，一个合格的 API 网关需要具备哪些核心能力？

## 路由：流量的指挥官

路由是网关最基本的功能——它决定了「请求应该去哪儿」。

一个请求到达网关时，网关会根据一定的规则来判断：这是哪个用户？想要访问什么服务？应该把请求转发到哪个后端地址？

常见的路由规则包括：

| 路由维度 | 说明 | 示例 |
|---|---|---|
| Path 路径 | 根据 URL 路径匹配 | `/api/user/**` → user-service |
| Host 主机 | 根据域名匹配 | `api.example.com` → service-a |
| Header 请求头 | 根据特定 Header 匹配 | `X-Internal: true` → 内部服务 |
| Query 参数 | 根据 URL 参数匹配 | `?version=v2` → v2 版本 |

路由的核心价值在于：**解耦客户端与后端服务**。客户端不需要知道服务在哪里部署、有多少个实例，网关帮你搞定这一切。

## 负载均衡：流量的分配器

当一个服务有多个实例时，路由只能决定「去哪个服务」，但「去这个服务的哪个实例」就需要负载均衡来处理。

常见的负载均衡策略：

- **轮询（Round Robin）**：请求依次分配给每个实例，简单公平
- **加权轮询（Weighted Round Robin）**：性能强的实例分配更多请求
- **最少连接（Least Connections）**：把请求发给当前连接数最少的实例
- **IP 哈希（IP Hash）**：同一 IP 的请求始终发到同一个实例，适合有状态服务
- **随机（Random）**：随机选择一个实例，实现简单

负载均衡可以是客户端发起（Client-side LB），也可以是服务端发起（Server-side LB）。网关作为服务端负载均衡器，对客户端是透明的。

## 认证授权：流量的门卫

认证回答的问题是「你是谁」，授权回答的问题是「你能做什么」。

### 认证机制

| 认证方式 | 说明 | 适用场景 |
|---|---|---|
| API Key | 分配唯一密钥，携带在 Header 中 | 简单的服务间调用 |
| Basic Auth | 用户名+密码 Base64 编码 | 内部系统，已逐步淘汰 |
| JWT | Token 包含用户信息，可验证签名 | 主流的分布式认证方案 |
| OAuth 2.0 | 支持第三方授权的开放标准 | 需要第三方登录的场景 |

### 授权模型

网关的授权通常在认证之后进行：

```java
// 网关认证授权的简化流程
public Mono&lt;Void&gt; handleRequest(ServerWebExchange exchange) {
    // 1. 从请求中提取 Token
    String token = extractToken(exchange);
    
    // 2. 验证 Token 有效性
    if (!jwtVerifier.verify(token)) {
        // Token 无效或过期，拒绝访问
        return unauthorized(exchange, "Invalid token");
    }
    
    // 3. 解析用户信息
    UserPrincipal principal = jwtParser.parse(token);
    
    // 4. 检查权限（资源 + 操作）
    String path = exchange.getRequest().getPath().value();
    String method = exchange.getRequest().getMethod().name();
    if (!permissionChecker.hasPermission(principal, path, method)) {
        // 权限不足，拒绝访问
        return forbidden(exchange, "Insufficient permissions");
    }
    
    // 5. 将用户信息传递给下游服务
    exchange.getAttributes().put("user", principal);
    return chain.filter(exchange);
}
```

网关在完成认证授权后，通常会把用户信息以某种形式传递给后端服务，常见方式是将用户信息写入 Header（如 `X-User-Id`、`X-User-Roles`）。

## 限流：流量的阀门

限流的目的是保护系统不被突发流量冲垮。想象一下商场促销——如果不限流，服务器可能因为瞬间涌入的大量请求而崩溃。

### 限流算法

**令牌桶（Token Bucket）**：以固定速率向桶中添加令牌，请求到来时从桶中获取令牌，获取成功则放行，否则拒绝。特点是允许一定程度的突发流量。

```java
// 令牌桶算法核心逻辑
public class TokenBucketRateLimiter {
    // 桶容量
    private final int capacity;
    // 当前令牌数
    private double tokens;
    // 令牌添加速率（每秒）
    private final double refillRate;
    // 上次更新时间
    private long lastRefillTime;
    
    public boolean tryAcquire(int permits) {
        synchronized (this) {
            // 先补充令牌
            refill();
            
            if (tokens >= permits) {
                tokens -= permits;
                return true;  // 获取成功
            }
            return false;  // 令牌不足，拒绝
        }
    }
    
    private void refill() {
        long now = System.currentTimeMillis();
        // 计算需要补充的令牌数
        double elapsed = (now - lastRefillTime) / 1000.0;
        tokens = Math.min(capacity, tokens + elapsed * refillRate);
        lastRefillTime = now;
    }
}
```

**漏桶（Leaky Bucket）**：以固定速率从桶中漏出请求，无论请求速率如何，输出速率始终恒定。特点是严格控制输出速率，适合限流而非削峰。

**滑动窗口（Sliding Window）**：将时间窗口划分为更小的子窗口，统计落在窗口内的请求数。Redis 的限流实现常用此算法。

### 限流维度

限流可以发生在多个维度：

- **全局限流**：限制整个网关的请求速率
- **服务限流**：限制某个服务的请求速率
- **用户限流**：限制某个用户的请求速率（防滥用）
- **IP 限流**：限制某个 IP 的请求速率（防攻击）

## 熔断：流量的保险丝

熔断器模式源自电路中的保险丝——当电流过大时，保险丝熔断，切断电路，保护电器不被损坏。在微服务中，熔断器保护的是「调用链」。

### 熔断器三状态

```
        ┌─────────────────────────────────────┐
        │                                     │
        ▼                                     │
    ┌───────┐    失败率超阈值    ┌──────────┐  │
    │ Closed │ ───────────────▶ │  Open    │  │
    │ 关闭   │                   │  熔断中   │  │
    └───────┘                   └──────────┘  │
        ▲                             │       │
        │ 成功恢复                     │ 超时后 │
        │                             │ 尝试   │
        │                             ▼       │
        │                         ┌──────────┐ │
        └──────────────────────── │ Half-Open│ │
              失败率仍低           │ 半开状态 │ │
                                  └──────────┘ │
                                                     │
                                                     │
                                                     │
                                                     │
                                                     │
```

- **Closed（关闭状态）**：正常情况，请求直接通过，失败记录到计数器
- **Open（打开状态）**：所有请求直接返回降级响应，不发往下游
- **Half-Open（半开状态）**：试探性放行少量请求，如果成功则恢复正常，否则继续熔断

### 熔断策略

| 策略 | 说明 | 适用场景 |
|---|---|---|
| 失败率熔断 | 失败率超过阈值时熔断 | 下游服务不稳定 |
| 慢调用熔断 | 响应时间超过阈值时熔断 | 下游服务响应慢 |
| 异常数熔断 | 异常数量超过阈值时熔断 | 下游服务报错多 |

熔断和限流的区别在于：**限流是主动防御**，在流量来临前就控制；**熔断是被动保护**，当下游已经出现问题时及时止损。

## 日志监控：流量的摄像头

没有监控的网关就像没有监控的商场——出了问题都不知道是谁干的。

### 关键指标

| 指标类型 | 具体指标 | 告警阈值建议 |
|---|---|---|
| 请求量 | QPS、PV、UV | QPS 突增/骤降 |
| 响应时间 | P50、P90、P99 | P99 超过阈值 |
| 错误率 | 5xx 比例、4xx 比例 | 错误率超过 1% |
| 限流/熔断 | 被限流请求数、被熔断次数 | 超过 0 |
| 流量分布 | 各服务流量占比 | 流量倾斜超过 50% |

### 链路追踪

网关是流量的必经之地，也是埋点追踪的最佳位置。通过生成 TraceId 并透传给下游，可以在分布式系统中追踪一个请求的完整调用链路。

```java
// 网关生成 TraceId 并传递给下游
public Mono&lt;Void&gt; traceFilter(ServerWebExchange exchange, GatewayFilterChain chain) {
    // 生成或提取 TraceId
    String traceId = exchange.getRequest().getHeaders().getFirst("X-Trace-Id");
    if (traceId == null) {
        traceId = UUID.randomUUID().toString();
    }
    
    // 将 TraceId 写入响应头和调用上下文
    exchange.getResponse().getHeaders().add("X-Trace-Id", traceId);
    exchange.getAttributes().put("traceId", traceId);
    
    // 添加链路日志
    long startTime = System.currentTimeMillis();
    return chain.filter(exchange)
        .doOnSuccess(v -&gt; logRequest(exchange, startTime, traceId))
        .doOnError(e -&gt; logError(exchange, startTime, traceId, e));
}
```

## 总结

一个功能完善的 API 网关需要具备以下核心能力：

| 能力 | 核心价值 | 关键词 |
|---|---|---|
| 路由 | 流量分发 | Path、Host、Header 匹配 |
| 负载均衡 | 流量分配 | 轮询、加权、最少连接 |
| 认证授权 | 访问控制 | JWT、OAuth、API Key |
| 限流 | 保护系统 | 令牌桶、漏桶、滑动窗口 |
| 熔断 | 防止级联失败 | 三状态、失败率、慢调用 |
| 日志监控 | 可观测性 | TraceId、QPS、延迟 |

这些能力共同构成了网关的「流量治理」能力。一个好的网关不仅要把请求送过去，还要送得安全、送得稳、送得可观测。

---

**留给你的问题**

限流和熔断都是为了保护系统，但它们的触发条件和处理方式不同。如果下游服务响应变慢（但没有完全不可用），应该优先限流还是熔断？这个问题涉及到限流和熔断的配合策略，值得深入思考。
