# Docker Compose 多容器编排

一个真实的应用通常由多个服务组成：前端、后端、数据库、缓存、消息队列……本地开发时，你得一个一个 `docker run`，还要记住各种参数和依赖关系。

Docker Compose 就是来解决这个问题的：用一个 YAML 文件定义所有服务，一条命令启动整个应用。

## Docker Compose 是什么？

Docker Compose 是 Docker 官方的容器编排工具，用于定义和运行多容器应用。

```
应用 = 服务 A + 服务 B + 服务 C + ...

docker-compose.yml  ← 定义所有服务配置
docker-compose up   ← 一键启动
docker-compose down ← 一键停止清理
```

## 基本概念

### 核心组件

- **Services（服务）**：一个容器运行的应用
- **Networks（网络）**：服务间通信的网络
- **Volumes（卷）**：持久化存储

### 一个最小的例子

```yaml
# docker-compose.yml
version: '3.8'

services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    networks:
      - app-net

  redis:
    image: redis:7-alpine
    networks:
      - app-net

networks:
  app-net:
    driver: bridge
```

```bash
# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f web

# 停止并清理
docker-compose down
```

## 服务定义详解

### image：指定镜像

```yaml
services:
  web:
    image: nginx:1.21-alpine
```

### build：从源码构建

```yaml
services:
  web:
    build:
      context: ./app
      dockerfile: Dockerfile.prod
      args:
        BUILD_ENV: production
    # 等价于
    # build: ./app
```

### ports：端口映射

```yaml
services:
  web:
    ports:
      - "8080:80"              # 宿主机端口:容器端口
      - "443:443"             # TCP
      - "443:443/udp"         # UDP
      - "127.0.0.1:8080:80"    # 限定绑定地址
      - "5000-5010:5000-5010"  # 端口范围
```

### environment：环境变量

```yaml
services:
  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: secret
      MYSQL_DATABASE: myapp
      # 数组形式
      # - MYSQL_ROOT_PASSWORD=secret
      # - MYSQL_DATABASE=myapp
```

### volumes：数据挂载

```yaml
services:
  db:
    image: mysql:8.0
    volumes:
      - db-data:/var/lib/mysql  # 命名卷
      - ./config:/etc/mysql/conf.d  # Bind Mount
      - /tmp:/tmp/runtime  # 匿名卷

volumes:
  db-data:
```

### depends_on：服务依赖

```yaml
services:
  web:
    build: ./web
    depends_on:
      - db
      - redis

  worker:
    build: ./worker
    depends_on:
      - db
      - redis

  db:
    image: mysql:8.0

  redis:
    image: redis:7-alpine
```

**注意**：`depends_on` 只保证启动顺序，不保证服务完全就绪。如果你的应用需要等待数据库完全启动后再连接，应该使用健康检查（后面会讲到）。

### restart：重启策略

```yaml
services:
  web:
    image: nginx:alpine
    restart: unless-stopped

  worker:
    image: myworker
    restart: on-failure:3
```

| 策略 | 说明 |
|------|------|
| `no` | 不重启（默认） |
| `always` | 总是重启 |
| `on-failure[:n]` | 退出码非 0 时重启，最多 n 次 |
| `unless-stopped` | 除非手动停止，否则总是重启 |

### healthcheck：健康检查

```yaml
services:
  db:
    image: mysql:8.0
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-p$MYSQL_ROOT_PASSWORD"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  web:
    image: nginx:alpine
    depends_on:
      db:
        condition: service_healthy  # 等待 db 健康后再启动
```

### networks：网络配置

```yaml
services:
  frontend:
    build: ./frontend
    networks:
      - frontend-net

  backend:
    build: ./backend
    networks:
      - frontend-net
      - backend-net

  db:
    image: mysql:8.0
    networks:
      - backend-net

networks:
  frontend-net:
    driver: bridge
  backend-net:
    driver: bridge
    internal: true  # 完全隔离，不通外网
```

## 高级特性

### 环境变量文件

```bash
# .env 文件
COMPOSE_PROJECT_NAME=myapp
MYSQL_ROOT_PASSWORD=secret
MYSQL_DATABASE=myapp
```

```yaml
# docker-compose.yml
services:
  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: ${MYSQL_DATABASE}
```

### extends：继承配置

```yaml
# base.yml - 基础配置
version: '3.8'
services:
  web-base:
    build: ./web
    networks:
      - app-net
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  web:
    extends:
      file: base.yml
      service: web-base
    ports:
      - "8080:80"

  web-prod:
    extends:
      file: base.yml
      service: web-base
    environment:
      ENV: production
    ports:
      - "80:80"
```

### profiles：配置分组

```yaml
# 只在特定 profile 激活时启动
services:
  web:
    image: nginx:alpine

  debug:
    image: my-debug-tool
    profiles:
      - debug

  prometheus:
    image: prom/prometheus:latest
    profiles:
      - monitoring
```

```bash
# 默认启动（只有 web）
docker-compose up -d

# 启动时激活 debug profile
docker-compose --profile debug up -d

# 启动时激活多个 profile
docker-compose --profile debug --profile monitoring up -d
```

### secrets：敏感信息

```yaml
version: '3.8'
services:
  web:
    image: myapp:latest
    secrets:
      - db_password
      - api_key

secrets:
  db_password:
    file: ./secrets/db_password.txt
  api_key:
    environment: API_KEY  # 从环境变量读取
```

### 资源限制

```yaml
services:
  web:
    image: nginx:alpine
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 256M
        reservations:
          cpus: '0.25'
          memory: 128M
```

## 常用命令

```bash
# 启动服务
docker-compose up -d

# 从源码构建并启动
docker-compose up -d --build

# 启动并指定文件
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 查看状态
docker-compose ps

# 查看日志
docker-compose logs -f web
docker-compose logs -f   # 所有服务

# 进入容器
docker-compose exec web sh

# 停止服务
docker-compose stop

# 停止并删除容器
docker-compose down

# 删除容器和网络（保留卷）
docker-compose down -v

# 重新创建服务
docker-compose up -d --force-recreate

# 扩展服务（scale）注意：新版本用 up --scale
docker-compose up -d --scale web=3
# 或在新版本中
docker-compose up -d --scale web=3

# 执行一次性命令
docker-compose run --rm web npm test
```

## 实战：完整的 Web 应用

```yaml
version: '3.8'

services:
  # 前端
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - API_URL=http://backend:8080
    depends_on:
      backend:
        condition: service_healthy
    networks:
      - app-net
    volumes:
      - ./frontend:/app
      - /app/node_modules
    develop:
      watch:
        - action: sync
          path: ./frontend
          target: /app
        - action: rebuild
          path: ./frontend/Dockerfile

  # 后端
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      - SPRING_DATASOURCE_URL=jdbc:mysql://db:3306/myapp
      - SPRING_DATASOURCE_PASSWORD=${DB_PASSWORD}
      - SPRING_REDIS_HOST=redis
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/actuator/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - app-net

  # 数据库
  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${DB_PASSWORD}
      MYSQL_DATABASE: myapp
    volumes:
      - db-data:/var/lib/mysql
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-p${DB_PASSWORD}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - app-net

  # Redis 缓存
  redis:
    image: redis:7-alpine
    networks:
      - app-net

  # Nginx 反向代理
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - frontend
      - backend
    networks:
      - app-net

networks:
  app-net:
    driver: bridge

volumes:
  db-data:
```

## 面试追问

1. **`docker-compose up` 的执行流程是什么？**
2. **`depends_on` 和 `healthcheck` + `condition` 有什么区别？**
3. **如何实现服务的水平扩展（scale）？**
4. **`docker-compose` 和 `docker stack` 有什么区别？**
5. **如何用 Docker Compose 模拟生产环境的多实例部署？**

> "Docker Compose 是本地开发的利器，也是理解容器编排的起点。虽然 Kubernetes 是生产环境的最终归宿，但 Docker Compose 让你在一个笔记本上就能跑起完整的微服务架构。"
