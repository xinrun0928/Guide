# Docker 健康检查：HEALTHCHECK 指令

容器启动成功了，就代表应用真的健康吗？

不一定。进程还在运行，可能已经无法处理请求了。数据库连接可能已经断开，但进程还活得好好的。

Docker 的 HEALTHCHECK 指令，就是用来检测应用真实健康状态的。

## 为什么需要健康检查？

### 进程存活 ≠ 应用健康

```bash
# 容器在运行
docker ps
# CONTAINER ID   IMAGE     STATUS          PORTS    NAMES
# abc123...      myapp    Up 2 hours                myapp

# 但应用可能已经挂了
docker exec myapp curl localhost:8080/health
# curl: (7) Failed to connect to localhost:8080 Connection refused

# 原因：Java 进程 OOM 被杀？配置错误？依赖服务不可用？
```

### 健康检查的作用

```
┌─────────────────────────────────────────────────────────────┐
│                        Kubernetes                          │
│                                                             │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐              │
│  │   Pod   │     │   Pod   │     │   Pod   │              │
│  │  (病)   │     │ (健康)  │     │ (健康)  │              │
│  └────┬────┘     └────┬────┘     └────┬────┘              │
│       │              │              │                     │
│  ┌────┴──────────────┴──────────────┴────┐                │
│  │            Kubernetes 控制平面           │                │
│  │                                          │                │
│  │  健康检查失败的 Pod 被移出 Service        │                │
│  │  流量只发送到健康的 Pod                    │                │
│  └─────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

## HEALTHCHECK 指令

### Dockerfile 中定义

```dockerfile
# 基础语法
HEALTHCHECK [OPTIONS] CMD command

# 选项
--interval=DURATION      # 检查间隔（默认 30s）
--timeout=DURATION       # 检查超时（默认 30s）
--retries=N              # 连续失败次数（默认 3）
--start-period=DURATION  # 启动等待期（默认 0s）
```

### 基本示例

```dockerfile
# Nginx 健康检查
FROM nginx:alpine
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD curl -f http://localhost/ || exit 1

# Node.js 健康检查
FROM node:18-alpine
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# 自定义脚本健康检查
FROM myapp:latest
COPY healthcheck.sh /usr/local/bin/
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=40s \
    CMD /usr/local/bin/healthcheck.sh
```

### 健康检查脚本

```bash
#!/bin/bash
# healthcheck.sh

# 检查端口是否监听
if ! nc -z localhost 8080; then
    echo "Port 8080 is not listening"
    exit 1
fi

# 检查健康端点
response=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health)
if [ "$response" -ne 200 ]; then
    echo "Health endpoint returned $response"
    exit 1
fi

# 检查数据库连接（如果有）
if ! /opt/check_db.sh; then
    echo "Database connection failed"
    exit 1
fi

echo "All checks passed"
exit 0
```

## 查看健康状态

```bash
# 查看容器健康状态
docker ps

# CONTAINER ID   IMAGE     STATUS                     PORTS    NAMES
# abc123...       myapp    Up 5 minutes (healthy)              myapp
# def456...       myapp    Up 3 minutes (unhealthy)           myapp-broken

# 查看详细健康信息
docker inspect myapp | grep -A 20 "Health"

# 输出：
# "Health": {
#     "Status": "healthy",
#     "FailingStreak": 0,
#     "Log": [
#         {
#             "Start": "2024-01-01T10:00:00.000000000Z",
#             "End": "2024-01-01T10:00:01.000000000Z",
#             "ExitCode": 0,
#             "Output": "..."
#         }
#     ]
# }
```

## 健康检查实现

### Spring Boot 应用

```java
// 健康端点
@RestController
public class HealthController {
    
    @Autowired
    private DataSource dataSource;
    
    @Autowired
    private RedisTemplate<String, String> redisTemplate;
    
    @GetMapping("/health")
    public ResponseEntity<Health> health() {
        Health health = new Health();
        health.setStatus("UP");
        
        // 检查数据库
        try {
            dataSource.getConnection().isValid(5);
            health.setDatabase("UP");
        } catch (Exception e) {
            health.setStatus("DOWN");
            health.setDatabase("DOWN: " + e.getMessage());
        }
        
        // 检查 Redis
        try {
            redisTemplate.opsForValue().get("health");
            health.setRedis("UP");
        } catch (Exception e) {
            health.setRedis("DOWN: " + e.getMessage());
        }
        
        if ("DOWN".equals(health.getStatus())) {
            return ResponseEntity.status(503).body(health);
        }
        
        return ResponseEntity.ok(health);
    }
}
```

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics
  endpoint:
    health:
      show-details: when-authorized
  health:
    db:
      enabled: true
    redis:
      enabled: true
```

### Nginx 健康检查

```nginx
# nginx.conf
server {
    listen 80;
    server_name localhost;
    
    location / {
        root /usr/share/nginx/html;
        index index.html;
    }
    
    # 健康检查端点
    location /health {
        access_log off;
        return 200 "OK";
        add_header Content-Type text/plain;
    }
}
```

### MySQL 健康检查

```bash
# Dockerfile
FROM mysql:8.0
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s \
    CMD mysqladmin ping -h localhost -u root -p${MYSQL_ROOT_PASSWORD} || exit 1
```

### Redis 健康检查

```bash
# Dockerfile
FROM redis:7-alpine
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
    CMD redis-cli ping || exit 1
```

## docker-compose 中的健康检查

```yaml
version: '3.8'

services:
  app:
    build: .
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  database:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: secret
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

  nginx:
    image: nginx:alpine
    depends_on:
      app:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

## 健康检查与依赖服务

### 等待依赖服务就绪

```yaml
version: '3.8'

services:
  app:
    build: .
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    # app 会在 db 和 redis 都健康后才启动

  db:
    image: mysql:8.0
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 30s

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
```

### 自定义等待脚本

```bash
#!/bin/bash
# wait-for.sh

HOST=$1
PORT=$2
TIMEOUT=${3:-60}

until nc -z "$HOST" "$PORT" || [ $TIMEOUT -le 0 ]; do
    echo "Waiting for $HOST:$PORT..."
    sleep 1
    TIMEOUT=$((TIMEOUT-1))
done

if [ $TIMEOUT -le 0 ]; then
    echo "Timeout waiting for $HOST:$PORT"
    exit 1
fi

echo "$HOST:$PORT is available"
```

```yaml
version: '3.8'

services:
  app:
    image: myapp:latest
    command: ["./wait-for.sh", "db:3306", "--", "java", "-jar", "app.jar"]
    depends_on:
      db:
        condition: service_healthy
```

## 常见问题

### 容器进入 (unhealthy) 状态

```bash
# 查看失败原因
docker inspect myapp | grep -A 10 "Health"

# 查看健康检查日志
docker inspect myapp | jq '.[0].State.Health.Log[-1]'

# 手动测试健康检查命令
docker exec myapp curl -f http://localhost:8080/health
```

### 健康检查命令不存在

```dockerfile
# 基础镜像没有 curl/wget
FROM alpine:latest

# 需要先安装
RUN apk add --no-cache curl

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD curl -f http://localhost/health || exit 1
```

### 超时时间设置过短

```bash
# 如果健康检查总是超时，增加超时时间
docker run -d \
    --health-cmd="curl -f http://localhost:8080/health" \
    --health-timeout=10s \
    --health-retries=3 \
    --name myapp \
    myapp:latest
```

## 面试追问

1. **Docker HEALTHCHECK 和容器的 `--restart` 策略有什么区别？**
2. **如果容器进入了 unhealthy 状态，Docker 会怎么处理？**
3. **如何实现「等待依赖服务健康后再启动」？**
4. **健康检查命令的超时时间怎么设置比较合理？**
5. **Kubernetes 的 Probe 和 Docker 的 HEALTHCHECK 有什么区别？**

> "健康检查是保障服务可用性的第一道防线。好的健康检查应该：检测真实的服务能力（不只是端口监听）、快速失败（不要让请求打到病了的实例）、返回明确的状态。记住：健康检查做不好，负载均衡和自动扩缩容都是空中楼阁。"
