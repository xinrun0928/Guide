# Kong 插件体系与常用插件

Kong 的插件体系是其区别于其他 API 网关的核心优势。它就像一个「功能市场」——你需要的认证、限流、日志等功能，只需要启用一个插件就能获得。

而且，所有插件都可以用 Lua 编写，这意味着 Kong 的生态是开放的，任何人都可以贡献插件。

## 插件体系架构

### 插件生命周期

Kong 插件可以在请求生命周期的多个阶段执行：

```
                    请求生命周期中的插件执行点
                    
    ┌─────────────────────────────────────────────────────────────┐
    │                                                             │
    │  ┌───────────┐                                              │
    │  │   ssl     │  SSL 握手完成                                 │
    │  └─────┬─────┘                                              │
    │        ▼                                                     │
    │  ┌───────────┐                                              │
    │  │  access   │  请求头读取完毕，可以修改请求                  │
    │  └─────┬─────┘  ← 大多数插件在这里执行                        │
    │        ▼                                                     │
    │  ┌───────────┐                                              │
    │  │ header_*  │  请求头过滤器                                 │
    │  └─────┬─────┘                                              │
    │        ▼                                                     │
    │  ┌───────────┐                                              │
    │  │   preread │  读取请求体之前                               │
    │  └─────┬─────┘                                              │
    │        ▼                                                     │
    │  ┌───────────┐                                              │
    │  │   body_*  │  请求体过滤器                                 │
    │  └─────┬─────┘                                              │
    │        ▼                                                     │
    │  ┌───────────┐                                              │
    │  │  log      │  响应返回后，记录日志                          │
    │  └───────────┘                                              │
    │                                                             │
    └─────────────────────────────────────────────────────────────┘
```

### 插件执行顺序

插件的 `priority` 属性决定执行顺序：

| 优先级 | 插件 |
|---|---|
| 10000 | IP Restriction |
| 2000 | CORS |
| 1000 | Authentication 类插件 |
| 900 | Rate Limiting |
| 100 | Logging |
| 0 | 其他 |

数字越大越先执行。相同优先级的插件按创建时间执行。

### 插件配置层级

Kong 的插件可以配置在四个层级：

```
Global（全局）     → 所有 Service/Route/Consumer 都生效
    │
    ▼
Service（服务级）  → 该 Service 的所有 Route 生效
    │
    ▼
Route（路由级）    → 该 Route 生效
    │
    ▼
Consumer（消费者级）→ 该 Consumer 生效
```

层级越精确，优先级越高。例如：Route 级别的限流配置会覆盖 Service 级别的配置。

## 认证类插件

### JWT 插件

Kong 最常用的认证插件之一：

```bash
# 启用 JWT 插件
curl -X POST http://localhost:8001/routes/my-route/plugins \
    --data "name=jwt"

# 为 Consumer 创建 JWT 凭证
curl -X POST http://localhost:8001/consumers/john/jwt \
    --data "key=user-john" \
    --data "algorithm=RS256" \
    --data "rsa_public_key=@public.pem" \
    --data "secret=my-secret"
```

客户端请求时需要携带 JWT：

```bash
curl http://localhost:8000/api \
    -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
```

JWT 验证通过后，Kong 会添加以下 header 传递给上游服务：

```
X-Consumer-ID: abc123
X-Consumer-Username: john
X-Credential-Identifier: user-john
```

### Key Auth（API Key）插件

适用于简单的服务间认证：

```bash
# 启用 Key Auth 插件
curl -X POST http://localhost:8001/routes/my-route/plugins \
    --data "name=key-auth"

# 为 Consumer 创建 API Key
curl -X POST http://localhost:8001/consumers/jane/key-auth \
    --data "key=my-secret-key"

# 客户端使用
curl http://localhost:8000/api \
    -H "apikey: my-secret-key"
```

### OAuth 2.0 插件

支持第三方授权：

```bash
# 启用 OAuth 2.0 插件
curl -X POST http://localhost:8001/services/my-service/plugins \
    --data "name=oauth2" \
    --data "config.scopes=read,write" \
    --data "config.enable_client_credentials=true" \
    --data "config.token_expiration=7200"
```

## 流量控制类插件

### Rate Limiting（限流）插件

Kong 支持多种限流策略：

```bash
# 本地限流（单节点，内存计数）
curl -X POST http://localhost:8001/routes/my-route/plugins \
    --data "name=rate-limiting" \
    --data "config.minute=100" \
    --data "config.hour=1000" \
    --data "config.policy=local"

# Redis 限流（集群，分布式计数）
curl -X POST http://localhost:8001/routes/my-route/plugins \
    --data "name=rate-limiting" \
    --data "config.minute=1000" \
    --data "config.policy=redis" \
    --data "config.redis_host=redis-host" \
    --data "config.redis_port=6379"

# 集群限流（PostgreSQL）
curl -X POST http://localhost:8001/routes/my-route/plugins \
    --data "name=rate-limiting" \
    --data "config.minute=500" \
    --data "config.policy=cluster"
```

限流响应头：

```
X-RateLimit-Limit-Minute: 100
X-RateLimit-Remaining-Minute: 95
X-RateLimit-Limit-Hour: 1000
X-RateLimit-Remaining-Hour: 980
```

限流触发响应：

```json
{
  "message": "API rate limit exceeded",
  "retry_after": 30
}
```

### Proxy Cache（代理缓存）插件

缓存上游响应，减少后端压力：

```bash
curl -X POST http://localhost:8001/routes/my-route/plugins \
    --data "name=proxy-cache" \
    --data "config.response_code=200" \
    --data "config.request_method=GET" \
    --data "config.content_type=application/json" \
    --data "config.cache_ttl=300" \
    --data "config.strategy=memory"
```

缓存控制：

```bash
# 清理指定路径的缓存
curl -X DELETE http://localhost:8001/cache \
    --data "uri=/api/users/*"

# 查看缓存状态
curl http://localhost:8001/cache
```

### Request Size Limiting 插件

限制请求体大小，防止大文件上传攻击：

```bash
curl -X POST http://localhost:8001/routes/my-route/plugins \
    --data "name=request-size-limiting" \
    --data "config.allowed_payload_size=128"  # KB
```

## 安全类插件

### CORS 插件

处理跨域请求：

```bash
curl -X POST http://localhost:8001/routes/my-route/plugins \
    --data "name=cors" \
    --data "config.origins=*" \
    --data "config.methods=GET,POST,PUT,DELETE" \
    --data "config.headers=X-Custom-Header" \
    --data "config.exposed_headers=X-Custom-Response-Header" \
    --data "config.credentials=true" \
    --data "config.max_age=3600"
```

### IP Restriction 插件

IP 白名单/黑名单：

```bash
# 白名单模式
curl -X POST http://localhost:8001/routes/my-route/plugins \
    --data "name=ip-restriction" \
    --data "config.allow=192.168.1.0/24" \
    --data "config.allow=10.0.0.1"

# 黑名单模式
curl -X POST http://localhost:8001/routes/my-route/plugins \
    --data "name=ip-restriction" \
    --data "config.deny=1.2.3.4"
```

### Bot Detection 插件

自动检测和阻止恶意爬虫：

```bash
curl -X POST http://localhost:8001/routes/my-route/plugins \
    --data "name=bot-detection"
```

## 日志与监控类插件

### Logging 插件族

| 插件 | 用途 |
|---|---|
| logging-loggly | 发送到 Loggly |
| logging-http | 发送到 HTTP Webhook |
| logging-kafka | 发送到 Kafka |
| logging-syslog | 发送到 Syslog |
| logging-tcp | 发送到 TCP |
| loggingUDP | 发送到 UDP |
| file-log | 写入文件 |

通用配置示例：

```bash
# HTTP Webhook 日志
curl -X POST http://localhost:8001/routes/my-route/plugins \
    --data "name=logging-http" \
    --data "config.http_endpoint=http://log-collector:8080/logs" \
    --data "config.method=POST" \
    --data "config.content_type=application/json" \
    --data "config.timeout=3000" \
    --data "config.keepalive=60000"
```

日志格式：

```json
{
  "request": {
    "method": "GET",
    "uri": "/api/users",
    "url": "http://kong:8000/api/users",
    "size": "75",
    "headers": {
      "host": "kong:8000",
      "user-agent": "curl/7.64.1"
    }
  },
  "response": {
    "status": 200,
    "size": "1234",
    "headers": {
      "content-type": "application/json"
    }
  },
  "latencies": {
    "request": 5,
    "kong": 1,
    "proxy": 50
  },
  "client_ip": "192.168.1.100",
  "consumer": {
    "id": "consumer-uuid",
    "username": "john"
  },
  "route": {
    "id": "route-uuid",
    "name": "my-route"
  }
}
```

### Prometheus 插件

暴露 Prometheus 指标：

```bash
curl -X POST http://localhost:8001/plugins \
    --data "name=prometheus"
```

访问指标端点：

```bash
curl http://localhost:8001/metrics
```

常见指标：

```
# 请求计数器
kong_http_requests_total{service="my-service",route="my-route",consumer="john",status="200"}

# 延迟直方图
kong_http_request_duration_ms_bucket{service="my-service",le="50"}
```

## 请求/响应转换类插件

### Request Transformer 插件

修改请求头/参数：

```bash
curl -X POST http://localhost:8001/routes/my-route/plugins \
    --data "name=request-transformer" \
    --data "config.add.headers=X-Custom-Header:custom-value" \
    --data "config.add.querystring=region:us-east" \
    --data "config.remove.headers=X-Debug-Header" \
    --data "config.rename.headers=Old-Name:New-Name"
```

### Response Transformer 插件

修改响应头/体：

```bash
curl -X POST http://localhost:8001/routes/my-route/plugins \
    --data "name=response-transformer" \
    --data "config.add.headers=X-Kong-Upstream-Latency:$(date)" \
    --data "config.add.json=key:value"
```

## 自定义插件开发

Kong 插件使用 Lua 编写，结构清晰：

```lua
-- kong/plugins/my-custom-plugin/handler.lua
local MyHandler = {}

MyHandler.PRIORITY = 1000  -- 优先级
MyHandler.VERSION = "1.0.0"

-- 请求拦截阶段
function MyHandler:access(conf)
    -- 在这里处理请求
    local request_id = kong.request.get_header("X-Request-ID")
    
    if not request_id then
        request_id = kong.uuid()
        kong.service.request.set_header("X-Request-ID", request_id)
    end
    
    -- 记录到上下文，供后续使用
    kong.ctx.shared.request_id = request_id
end

-- 响应返回阶段
function MyHandler:header_filter(conf)
    -- 添加响应头
    kong.response.set_header("X-My-Plugin", "1.0.0")
end

-- 日志阶段
function MyHandler:log(conf)
    -- 记录日志
    kong.log.inspect("Request completed: " .. kong.ctx.shared.request_id)
end

return MyHandler
```

```lua
-- kong/plugins/my-custom-plugin/schema.lua
local typedefs = require "kong.db.schema.typedefs"

return {
    name = "my-custom-plugin",
    fields = {
        { config = {
            type = "record",
            fields = {
                { enabled = { type = "boolean", default = true }},
                { custom_header = { type = "string", default = "default" }},
            },
        }},
    },
}
```

安装自定义插件：

```yaml
# docker-compose.yml
environment:
  KONG_PLUGINS: bundled,my-custom-plugin
```

## 总结

| 插件类型 | 常用插件 | 说明 |
|---|---|---|
| 认证 | jwt, key-auth, oauth2, basic-auth | 身份验证 |
| 流量控制 | rate-limiting, proxy-cache, request-size-limiting | 限流、缓存 |
| 安全 | cors, ip-restriction, bot-detection | 跨域、IP 控制 |
| 日志 | logging-http, prometheus, file-log | 日志收集 |
| 转换 | request-transformer, response-transformer | 请求响应修改 |

---

**留给你的问题**

Kong 的插件系统非常灵活，但你知道如何实现一个插件依赖另一个插件吗？

比如：希望只有通过 JWT 认证的用户才能启用限流（防止匿名用户滥用），你会如何设计这个插件依赖关系？
