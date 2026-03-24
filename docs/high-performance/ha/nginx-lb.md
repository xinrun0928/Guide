# Nginx 负载均衡配置与 upstream 模块

凌晨 3 点，你被报警电话吵醒：「下单接口响应时间从 50ms 飙升到 8 秒」。

你登录服务器一看，后端 Tomcat 的 CPU 使用率只有 30%，内存也很充裕。

问题不在后端应用——是 Nginx 的连接队列满了。

这不是故事，是真实的事故。Nginx 配置不当，再好的后端服务器也发挥不出实力。

## upstream 模块基础

`upstream` 是 Nginx 的后端服务器分组模块，负责定义一组后端服务器供 proxy_pass 使用。

### 最简配置

```nginx
http {
    upstream backend {
        server 192.168.1.10:8080;
        server 192.168.1.11:8080;
        server 192.168.1.12:8080;
    }

    server {
        listen 80;
        location / {
            proxy_pass http://backend;
        }
    }
}
```

这个配置会让请求轮询分发给三台后端服务器。

## 负载均衡算法配置

### 轮询（默认）

```nginx
upstream backend {
    server 192.168.1.10:8080;
    server 192.168.1.11:8080;
    server 192.168.1.12:8080;
}
```

### 加权轮询

```nginx
upstream backend {
    server 192.168.1.10:8080 weight=5;   # 权重 5
    server 192.168.1.11:8080 weight=2;   # 权重 2
    server 192.168.1.12:8080 down;        # 暂时下线
}
```

### IP 哈希（会话保持）

```nginx
upstream backend {
    ip_hash;  # 基于客户端 IP 做哈希
    server 192.168.1.10:8080;
    server 192.168.1.11:8080;
    server 192.168.1.12:8080;
}
```

### 最少连接

```nginx
upstream backend {
    least_conn;  # 动态选择连接数最少的服务器
    server 192.168.1.10:8080;
    server 192.168.1.11:8080;
    server 192.168.1.12:8080;
}
```

### 随机（两阶段）

```nginx
upstream backend {
    random two;  # 先随机选两台，再从中选一台
    server 192.168.1.10:8080;
    server 192.168.1.11:8080;
    server 192.168.1.12:8080;
}
```

## 服务器状态标记

```nginx
upstream backend {
    server 192.168.1.10:8080;                    # 正常
    server 192.168.1.11:8080 down;                # 永久下线
    server 192.168.1.12:8080 backup;              # 备用服务器
    server 192.168.1.13:8080 max_fails=3;         # 失败 3 次后摘除
    server 192.168.1.14:8080 fail_timeout=30s;    # 30s 后重新尝试
    server 192.168.1.15:8080 max_fails=2 fail_timeout=60s;
}
```

### 状态说明

| 状态 | 含义 |
|------|------|
| `down` | 永久摘除，不参与负载均衡 |
| `backup` | 备用服务器，所有正常服务器都挂了才启用 |
| `max_fails` | 最大失败次数，超过后摘除 |
| `fail_timeout` | 失败后多长时间内不参与负载均衡 |

## Keepalived 长连接

Nginx 默认行为是每发完一个请求就关闭连接。对于后端是 Java 服务（需要建立 TCP 连接），频繁建连开销很大。

开启 keepalive 可以复用连接：

```nginx
upstream backend {
    server 192.168.1.10:8080;
    server 192.168.1.11:8080;
    server 192.168.1.12:8080;

    # 启用长连接
    keepalive 32;        # 保持 32 个空闲连接
    keepalive_requests 1000;  # 每个连接最多处理 1000 个请求
    keepalive_timeout 60s;    # 空闲连接保持 60 秒
}

server {
    location / {
        proxy_pass http://backend;
        # 启用 HTTP/1.1（必须）
        proxy_http_version 1.1;
        # 清空连接头（必须）
        proxy_set_header Connection "";
    }
}
```

### keepalive 配置建议

| 后端服务器数量 | keepalive 连接数 | 说明 |
|---------------|-----------------|------|
| 3 | 32-64 | 每台服务器保持 10-20 个连接 |
| 10 | 64-128 | 每台服务器保持 6-12 个连接 |
| 50+ | 128-256 | 配合 upstream 动态发现 |

## 粘性会话（Sticky Sessions）

除了 ip_hash，Nginx Plus 和某些第三方模块支持基于 Cookie 的会话保持：

```nginx
upstream backend {
    server 192.168.1.10:8080;
    server 192.168.1.11:8080;
    server 192.168.1.12:8080;

    # 基于 Cookie 的会话保持
    sticky cookie srv_id expires=1h domain=.example.com path=/;
}
```

### 不同 Cookie 策略对比

| 策略 | 原理 | 优缺点 |
|------|------|--------|
| `cookie` | 服务器设置 Cookie | 精确但依赖客户端支持 |
| `route` | URI 参数携带路由信息 | 侵入性强，不推荐 |
| `learn` | 学习请求特征 | 占用内存，不推荐 |

## 连接数和超时配置

```nginx
upstream backend {
    server 192.168.1.10:8080;
    server 192.168.1.11:8080;

    # 连接池配置
    keepalive 32;
    keepalive_timeout 60s;

    # 失败重试配置
    proxy_next_upstream error timeout http_502;
    proxy_next_upstream_tries 3;
    proxy_next_upstream_timeout 10s;
}
```

### 常见错误码重试

```nginx
# 502: Bad Gateway - 后端服务崩溃
# 503: Service Unavailable - 后端服务不可用
# 504: Gateway Timeout - 后端响应超时
# error: 连接错误、读取错误
# timeout: 超时

proxy_next_upstream error timeout http_502 http_503 http_504;
```

## 健康检查配置

Nginx Plus 支持主动健康检查，开源版本需要借助第三方模块或外部工具：

### Nginx Plus 主动检查

```nginx
upstream backend {
    zone backend 64k;

    server 192.168.1.10:8080;
    server 192.168.1.11:8080;

    # 健康检查
    health_check interval=5s fails=3 passes=2 uri=/health;
}
```

### 开源版本方案

使用 `nginx_upstream_check_module` 第三方模块：

```nginx
upstream backend {
    server 192.168.1.10:8080;
    server 192.168.1.11:8080;
    check interval=3000 rise=2 fall=3 timeout=1000 type=http;
    check_http_send "HEAD /health HTTP/1.0\r\n\r\n";
    check_http_expect_alive http_2xx http_3xx;
}
```

## 分域名路由

```nginx
upstream api_backend {
    server 192.168.1.10:8080;
    server 192.168.1.11:8080;
}

upstream admin_backend {
    server 192.168.1.20:8080;
    server 192.168.1.21:8080;
}

server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://api_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

server {
    listen 80;
    server_name admin.example.com;

    location / {
        proxy_pass http://admin_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 分路径路由

```nginx
upstream static_backend {
    server 192.168.1.10:80;
}

upstream api_backend {
    server 192.168.1.20:8080;
    server 192.168.1.21:8080;
}

upstream file_backend {
    server 192.168.1.30:8080;
    server 192.168.1.31:8080;
}

server {
    listen 80;

    # 静态资源
    location /static/ {
        proxy_pass http://static_backend;
        proxy_cache_valid 200 1d;
    }

    # API 请求
    location /api/ {
        proxy_pass http://api_backend;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
    }

    # 文件上传
    location /upload {
        proxy_pass http://file_backend;
        client_max_body_size 100m;
    }

    # 默认
    location / {
        proxy_pass http://api_backend;
    }
}
```

## 实战配置模板

```nginx
user nginx;
worker_processes auto;
worker_rlimit_nofile 65535;

events {
    worker_connections 10240;
    use epoll;
    multi_accept on;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    # 性能优化
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    # 日志格式
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for" '
                    'upstream: $upstream_addr upstream_status: $upstream_status';

    # 开启 gzip
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript;

    # 限流
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/s;
    limit_conn_zone $binary_remote_addr zone=addr_limit:10m;

    upstream backend {
        server 192.168.1.10:8080 weight=5;
        server 192.168.1.11:8080 weight=3;
        server 192.168.1.12:8080 backup;

        keepalive 32;
        keepalive_timeout 60s;

        # 失败重试
        proxy_next_upstream error timeout http_502 http_503;
    }

    server {
        listen 80;
        server_name example.com;

        # 限流
        limit_req zone=api_limit burst=200 nodelay;
        limit_conn addr_limit 50;

        # 请求日志
        access_log /var/log/nginx/access.log main;

        location / {
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # 超时配置
            proxy_connect_timeout 5s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;

            # 缓冲配置
            proxy_buffering on;
            proxy_buffer_size 4k;
            proxy_buffers 8 4k;
            proxy_busy_buffers_size 8k;
        }

        location /health {
            proxy_pass http://backend;
            access_log off;
        }
    }
}
```

---

**思考题：**

假设你的 Nginx upstream 配置了 3 台后端服务器，某天其中一台机器的网卡被打满，网络延迟从 1ms 飙升到 500ms。

问题：
1. 在默认的轮询策略下，1/3 的请求会打到这台「卡机」，用户体验会明显下降吗？
2. 如果换成最小连接数策略，Nginx 能感知到这台机器的延迟吗？
3. 你有什么办法让 Nginx 更智能地处理这种情况？

提示：考虑 TCP 连接建立时间、upstream 的 timeout 配置、以及 Nginx 的连接队列。
