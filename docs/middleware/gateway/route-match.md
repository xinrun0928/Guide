# 网关路由匹配规则

你去快递站取件，告诉工作人员：「帮我找一下张三的件」。工作人员会根据「张三」这个信息，在货架上找到对应的包裹。

网关的路由匹配就是干这件事——根据请求中的各种信息，找到「应该把这个请求送到哪里去」。

## 路由匹配的基本概念

路由（Route）是网关的核心抽象，它包含三个关键要素：

- **Predicate（谓词）**：判断请求是否匹配的条件
- **URI（目标地址）**：匹配后转发到哪里
- **Filters（过滤器）**：处理过程中的过滤逻辑

```
请求 → Predicate 判断 → URI 转发 → Filters 处理 → 响应
        是否匹配？    转发地址     过滤器链
```

## Path 路径匹配：最常用的方式

Path 匹配是最直观的路由方式——根据 URL 路径来判断请求应该发往哪个服务。

### 精确匹配

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: http://user-service:8080
          predicates:
            - Path=/api/user
```

只有请求路径**恰好是** `/api/user` 时才会匹配。如果请求是 `/api/user/123`，则不会匹配。

### 前缀匹配

```yaml
predicates:
  - Path=/api/user/**
```

`/**` 表示匹配该路径下的所有子路径。请求 `/api/user`、`/api/user/123`、`/api/user/123/orders` 都能匹配。

### 路径变量

```yaml
predicates:
  - Path=/api/user/{id}
```

`{id}` 是路径变量，可以捕获实际路径中的值：

```java
// 在过滤器中获取路径变量
@Component
public class PathVariableFilter implements GlobalFilter {
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        // 从路径中提取 {id} 的值
        String id = exchange.getAttribute("org.springframework.cloud.gateway.filter.factory.PathRoutePredicateFactory.attr");
        // 进一步可以获取
        // id = exchange.getAttribute("gateway.templated.path");  // Spring Cloud Gateway
        return chain.filter(exchange);
    }
}
```

### 路径重写

有时候我们希望把请求转发给后端服务时，路径已经「翻译」好了：

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: http://user-service:8080
          predicates:
            - Path=/api/v1/user/**
          filters:
            - RewritePath=/api/v1(?&lt;segment&gt;/?.*), $\{segment}
```

| 请求路径 | 实际转发路径 |
|---|---|
| `/api/v1/user/123` | `http://user-service:8080/user/123` |

RewritePath 过滤器把 `/api/v1` 前缀去掉了，这样后端服务就不需要关心 API 版本前缀。

## Header 头匹配：精细化路由

有时候仅靠路径无法精确区分请求，需要结合请求头来判断。

### 精确头匹配

```yaml
predicates:
  - Header=X-Internal-Service, true
```

只有请求头中包含 `X-Internal-Service: true` 时才匹配。这常用于区分内部服务调用和外部请求。

### 正则头匹配

```yaml
predicates:
  - Header=X-Request-Id, \d+
```

只有 `X-Request-Id` 头匹配正则 `\d+`（纯数字）时才匹配。

### 常见应用场景

| 场景 | Header 条件 | 说明 |
|---|---|---|
| 版本路由 | `X-API-Version: v2` | 灰度发布时不同版本走不同服务 |
| 租户隔离 | `X-Tenant-Id: *` | 多租户场景下路由到对应租户的服务 |
| A/B 测试 | `X-Experiment: test-a` | 流量分配 |
| 灰度发布 | `X-Canary: true` | 少量流量走金丝雀版本 |

### 头匹配实战：灰度发布

```yaml
# 90% 的流量走正式版本
- id: user-service-stable
  uri: http://user-service-stable:8080
  predicates:
    - Header=X-Canary  # 没有这个头，表示走稳定版
  filters:
    - StripPrefix=1

# 10% 的流量走灰度版本
- id: user-service-canary
  uri: http://user-service-canary:8080
  predicates:
    - Header=X-Canary, true
  filters:
    - StripPrefix=1
```

## Query 参数匹配：动态路由

URL 中的查询参数也可以作为路由条件。

### 精确参数匹配

```yaml
predicates:
  - Query=version, v2
```

请求 URL 中必须包含 `?version=v2` 才匹配。

### 正则参数匹配

```yaml
predicates:
  - Query=amount, \d+
```

只有 `amount` 参数是数字时才匹配。

### 动态参数转发

```yaml
filters:
  - AddRequestParameter=region, ${variable}  # 添加新参数
  - SetRequestParameter=version, v2  # 修改已有参数
```

## HTTP 方法匹配

根据 HTTP 方法（GET、POST、PUT、DELETE）进行路由：

```yaml
predicates:
  - Method=GET,POST
```

| 方法 | 适用场景 |
|---|---|
| GET | 查询类请求 |
| POST | 创建资源 |
| PUT | 更新资源 |
| DELETE | 删除资源 |

## 组合匹配：多条件叠加

Predicate 支持多个条件组合，只有**所有条件都满足**时才算匹配成功。

### 使用 AND 逻辑

```yaml
predicates:
  - Path=/api/user/**
  - Header=X-Internal-Service, true
  - Query=format, json
```

请求必须同时满足：路径以 `/api/user/` 开头、包含特定 Header、包含特定 Query 参数。

### 优先级

当多个路由都匹配时，按照 `order` 属性决定优先级：

```yaml
routes:
  - id: specific-route
    uri: http://specific-service:8080
    order: 1  # 数字越小优先级越高
    predicates:
      - Path=/api/user/**
  
  - id: general-route
    uri: http://general-service:8080
    order: 2
    predicates:
      - Path=/api/**
```

对于 `/api/user/123`，第一条路由会优先匹配。

## Cookie 匹配

根据 Cookie 进行路由（较少使用）：

```yaml
predicates:
  - Cookie=session, abc.*
```

只有携带符合正则 `abc.*` 的 `session` Cookie 时才匹配。

## IP 地址匹配

可以根据请求来源 IP 进行路由：

```yaml
predicates:
  - RemoteAddr=192.168.1.0/24
```

来自 `192.168.1.x` 网段的请求会匹配这个路由。常用于内网/外网区分。

## 自定义 Predicate

如果内置的 Predicate 不满足需求，可以自定义：

```java
// 自定义时间窗口 Predicate
public class BetweenRoutePredicateFactory 
    extends AbstractRoutePredicateFactory&lt;BetweenRoutePredicateFactory.Config&gt; {
    
    public static class Config {
        private LocalTime start;
        private LocalTime end;
    }
    
    @Override
    public Predicate&lt;ServerWebExchange&gt; apply(Config config) {
        return exchange -&gt; {
            LocalTime now = LocalTime.now();
            return now.isAfter(config.getStart()) &amp;&amp; now.isBefore(config.getEnd());
        };
    }
}
```

```yaml
# 使用自定义 Predicate
# 只在工作时间 9:00-18:00 接受请求
predicates:
  - Between=09:00:00, 18:00:00
```

## 路由匹配的执行流程

```
请求进入
    │
    ▼
遍历所有路由（按 order 排序）
    │
    ▼
检查 Predicate 条件
    │
    ├── 不匹配 ──▶ 继续检查下一条路由
    │
    └── 匹配 ──▶ 执行 Filters ──▶ 转发到 URI
                   │
                   ▼
               继续检查后续路由（可选）
```

## 总结

路由匹配规则一览：

| 匹配类型 | 示例 | 说明 |
|---|---|---|
| Path 路径 | `Path=/api/user/**` | URL 路径匹配，支持通配符和变量 |
| Header 头 | `Header=X-Version, v2` | 请求头匹配 |
| Query 参数 | `Query=format, json` | 查询参数匹配 |
| Method | `Method=GET,POST` | HTTP 方法匹配 |
| Cookie | `Cookie=session, abc` | Cookie 匹配 |
| RemoteAddr | `RemoteAddr=192.168.1.0/24` | IP 地址匹配 |
| 自定义 | 自定义 Predicate | 灵活扩展 |

---

**留给你的问题**

路由匹配顺序很重要——当多个路由都能匹配一个请求时，应该用哪个？Spring Cloud Gateway 按 `order` 排序，Kong 按 `plugins` 优先级排序。**如果让你设计一个更智能的路由匹配系统，你会考虑哪些因素？**
