# Kong 架构

Kong 是一个开源的 API 网关，最初于 2015 年发布，如今已成为最流行的 API 网关之一。它的核心架构融合了 OpenResty、Nginx 和 Lua，形成了独特的「高性能 + 灵活扩展」架构。

为什么很多公司在生产环境中选择 Kong 而不是自研网关？答案就在它的架构里。

## 整体架构概览

```
                         ┌─────────────────────────────────────────────┐
                         │                  Kong Gateway               │
                         │                                              │
┌──────────┐             │  ┌────────────────────────────────────────┐  │
│  客户端   │ ───── HTTPS ──▶ │  ┌──────┐                            │  │
└──────────┘             │  │ Nginx │ ← SSL 终止、负载均衡            │  │
                         │  └──────┘                                  │  │
                         │       │                                     │  │
                         │       ▼                                     │  │
                         │  ┌────────────────────────────────────────┐  │
                         │  │         OpenResty (Nginx + LuaJIT)      │  │
                         │  │                                          │  │
                         │  │   ┌─────────┐  ┌─────────┐  ┌─────────┐│  │
                         │  │   │ Plugin  │  │ Plugin  │  │ Plugin  ││  │
                         │  │   │  插件   │  │  插件   │  │  插件   ││  │
                         │  │   └─────────┘  └─────────┘  └─────────┘│  │
                         │  │                                          │  │
                         │  │   ┌─────────────────────────────────┐   │  │
                         │  │   │        Admin API / Admin GUI    │   │  │
                         │  │   │        路由配置、插件管理        │   │  │
                         │  │   └─────────────────────────────────┘   │  │
                         │  └────────────────────────────────────────┘  │
                         └─────────────────────────────────────────────┘
                                    │                    │
                                    ▼                    ▼
                         ┌──────────────────┐  ┌──────────────────────┐
                         │   PostgreSQL    │  │      Redis           │
                         │   (配置存储)     │  │   (限流计数/缓存)    │
                         └──────────────────┘  └──────────────────────┘
```

## 核心组件详解

### Nginx：底层网络层

Kong 的底层是基于 Nginx 的，它利用了 Nginx 的高性能网络处理能力：

- **连接管理**：处理海量并发连接
- **SSL/TLS 终止**：HTTPS 加密解密
- **负载均衡**：内置负载均衡算法
- **静态文件服务**：处理静态资源

但 Kong 并不是直接使用 Nginx 配置，而是通过 OpenResty 扩展 Nginx。

### OpenResty：Nginx + Lua

OpenResty 是 Nginx 的扩展集，集成了 LuaJIT 脚本引擎。正是有了 OpenResty，Kong 才能实现灵活的插件机制。

```
传统 Nginx 请求处理：
    请求 → Nginx C Module → 响应

OpenResty 请求处理：
    请求 → Nginx → Lua Handler → 插件链 → 路由 → 上游服务
                        ↑
                   用 Lua 编写插件逻辑
```

为什么选择 Lua？
- **轻量级**：Lua 虚拟机非常小，启动快、内存占用低
- **高性能**：LuaJIT 的执行效率接近 C
- **易集成**：可以方便地调用 Nginx 的 C 模块
- **热更新**：不需要重启就能加载新插件

### 插件系统：Kong 的灵魂

Kong 的插件系统是其最强大的特性。每一个功能（认证、限流、日志等）都是一个独立的插件：

```lua
-- Kong 插件示例：自定义认证
local kong = kong
local require = require

local MyAuthHandler = {
    PRIORITY = 1000,  -- 插件优先级
    VERSION = "1.0.0",
}

function MyAuthHandler:access(conf)
    -- 在请求转发前执行的逻辑
    local token = kong.request.get_header("Authorization")
    
    if not token then
        return kong.response.exit(401, {message = "Unauthorized"})
    end
    
    if not verify_token(token) then
        return kong.response.exit(401, {message = "Invalid token"})
    end
    
    -- 将用户信息传递给后续插件
    kong.ctx.shared.user = parse_user(token)
end

return MyAuthHandler
```

### Admin API：配置管理

Kong 提供 RESTful Admin API 来管理所有配置：

```bash
# 创建路由
curl -X POST http://localhost:8001/routes \
    --data "name=user-route" \
    --data "paths[]=/api/user"

# 创建服务
curl -X POST http://localhost:8001/services \
    --data "name=user-service" \
    --data "url=http://user-service:8080"

# 绑定插件
curl -X POST http://localhost:8001/routes/user-route/plugins \
    --data "name=rate-limiting" \
    --data "config.minute=100" \
    --data "config.policy=redis"

# 启用 JWT 认证
curl -X POST http://localhost:8001/routes/user-route/plugins \
    --data "name=jwt"
```

## 数据存储架构

### PostgreSQL：配置持久化

Kong 使用 PostgreSQL 存储核心配置数据：

| 表名 | 存储内容 |
|---|---|
| services | 后端服务定义 |
| routes | 路由规则 |
| plugins | 插件配置 |
| consumers | API 消费者 |
| credentials | 认证凭证 |
|upstreams | 上游服务定义 |
| targets | 上游实例 |

### Redis：高频数据

Redis 用于存储需要频繁读写的临时数据：

- **限流计数器**：基于时间窗口的计数
- **会话缓存**：活跃的认证会话
- **插件共享状态**：跨节点共享数据
- **健康检查缓存**：上游服务健康状态

```
为什么不用 PostgreSQL 做限流？
- PostgreSQL 每次限流检查都需要写事务，性能差
- Redis 的 INCR 命令原子递增，性能极高
- Redis 支持过期时间 TTL，适合限流窗口
```

## 请求处理流程

```
                    1. 客户端请求
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                    Nginx 接收请求                         │
│                    - SSL 终止                            │
│                    - 连接复用                            │
└──────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│               OpenResty 初始化阶段                        │
│               - 加载路由配置                             │
│               - 初始化插件                               │
└──────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                  插件执行阶段 (Lua)                      │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │ 1. IP Restriction (IP 限制)                      │    │
│  │ 2. CORS (跨域处理)                                │    │
│  │ 3. Authentication (认证)                          │    │
│  │ 4. Rate Limiting (限流)                           │    │
│  │ 5. Request Transformer (请求转换)                  │    │
│  │ 6. Logging (日志)                                  │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                    路由匹配                              │
│                    - 根据请求找到对应 Service/Route      │
└──────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                  负载均衡 (upstreams)                    │
│                  - 轮询/加权/最少连接                     │
└──────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                  代理到上游服务                           │
└──────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                  响应处理阶段                            │
│                  - Post-logging                          │
│                  - Response Transformer                  │
└──────────────────────────────────────────────────────────┘
                           │
                           ▼
                    4. 返回响应
```

## 高可用部署架构

Kong 支持多种高可用部署模式：

### 传统部署

```
                         ┌─────────────────────────────────────┐
                         │         负载均衡器 (Nginx/LB)       │
                         └─────────────────────────────────────┘
                                    │           │
                         ┌──────────┘           └──────────┐
                         │                                 │
                         ▼                                 ▼
                ┌───────────────┐               ┌───────────────┐
                │  Kong Node 1  │               │  Kong Node 2  │
                │  (OpenResty)  │               │  (OpenResty)  │
                └───────────────┘               └───────────────┘
                         │                                 │
                         └──────────────┬──────────────────┘
                                        │
                                        ▼
                         ┌───────────────────────────────┐
                         │         PostgreSQL            │
                         │         + Redis Cluster       │
                         └───────────────────────────────┘
```

### Kubernetes 部署

```yaml
# Kong Ingress Controller 示例
apiVersion: configuration.konghq.com/v1
kind: KongIngress
metadata:
  name: my-ingress
route:
  methods:
  - GET
  paths:
  - /api
  strip_path: true
plugins:
- name: rate-limiting
  config:
    minute: 100
    policy: redis
```

## 性能特性

Kong 的架构设计带来了出色的性能：

| 特性 | 说明 |
|---|---|
| 异步处理 | 基于 Nginx 事件驱动，单机可处理数万 QPS |
| 低延迟 | OpenResty + LuaJIT 性能接近原生 C |
| 水平扩展 | 无状态设计，支持多节点部署 |
| 连接复用 | 向上游保持长连接，减少建连开销 |

## 总结

| 组件 | 技术 | 作用 |
|---|---|---|
| Nginx | 网络层 | 连接管理、SSL 终止 |
| OpenResty | 执行层 | Lua 运行时、插件加载 |
| Lua | 编程语言 | 插件逻辑 |
| PostgreSQL | 配置存储 | 持久化配置 |
| Redis | 缓存/计数器 | 限流、会话 |

Kong 的架构设计哲学：**让 Nginx 做它擅长的（网络处理），让 Lua 做它擅长的（灵活扩展）**。

---

**留给你的问题**

Kong 的插件系统非常强大，但你知道它的执行顺序是如何确定的吗？

如果你需要编写一个插件，但希望它在限流之前执行，又希望它在认证之后执行，应该如何设置优先级？
