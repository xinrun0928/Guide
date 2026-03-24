# Docker Swarm 服务部署与滚动更新

Docker Swarm 服务部署是容器编排的核心操作。从创建服务到滚动更新，再到回滚，每一个步骤都有讲究。

这篇文章，聊聊 Docker Swarm 服务的部署和运维操作。

## 服务创建

### 基本服务创建

```bash
# 创建最简单的服务
docker service create --name myapp nginx:alpine

# 创建带副本的服务
docker service create \
    --name myapp \
    --replicas 3 \
    nginx:alpine

# 创建带端口映射的服务
docker service create \
    --name myapp \
    --replicas 3 \
    --publish 8080:80 \
    nginx:alpine

# 创建带环境变量的服务
docker service create \
    --name myapp \
    --replicas 2 \
    --env NODE_ENV=production \
    --env LOG_LEVEL=info \
    myapp:latest
```

### 服务配置选项

```bash
# CPU 和内存限制
docker service create \
    --name myapp \
    --replicas 3 \
    --limit-cpu 0.5 \
    --limit-memory 512M \
    --reserve-cpu 0.25 \
    --reserve-memory 256M \
    nginx:alpine

# 节点亲和性（调度到特定节点）
docker service create \
    --name myapp \
    --constraint 'node.role==worker' \
    nginx:alpine

# 环境标签
docker service create \
    --name myapp \
    --constraint 'node.labels.zone==backend' \
    nginx:alpine
```

## 服务管理

### 查看服务

```bash
# 查看服务列表
docker service ls

# 查看服务详细信息
docker service inspect myapp

# 以 JSON 格式查看
docker service inspect --pretty myapp

# 查看服务运行的任务
docker service ps myapp

# 输出：
# ID             NAME          IMAGE          NODE     DESIRED STATE   CURRENT STATE
# abc123...      myapp.1       nginx:alpine   node1    Running         Running 5 min
# def456...      myapp.2       nginx:alpine   node2    Running         Running 5 min
# ghi789...      myapp.3       nginx:alpine   node3    Running         Running 5 min
```

### 更新服务

```bash
# 更新镜像版本
docker service update \
    --image myapp:2.0.0 \
    myapp

# 更新副本数
docker service update \
    --replicas 5 \
    myapp

# 更新端口
docker service update \
    --publish-rm 8080:80 \
    --publish add 9090:80 \
    myapp

# 更新环境变量
docker service update \
    --env-add NODE_ENV=staging \
    --env-rm LOG_LEVEL \
    myapp

# 添加配置
docker service update \
    --config-add my-config \
    myapp

# 添加密钥
docker service update \
    --secret-add my-secret \
    myapp
```

## 滚动更新

### 配置滚动更新策略

```bash
# 创建带滚动更新策略的服务
docker service create \
    --name myapp \
    --replicas 4 \
    --update-delay 10s \
    --update-parallelism 1 \
    --update-failure-action rollback \
    --rollback-monitor 20s \
    --rollback-parallelism 0 \
    --image myapp:1.0.0 \
    myapp:latest
```

### 滚动更新参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `--update-delay` | 更新间隔 | `10s`, `1m30s` |
| `--update-parallelism` | 同时更新的任务数 | `1`, `2`, `0`（全部） |
| `--update-failure-action` | 更新失败后的行为 | `pause`, `continue`, `rollback` |
| `--rollback-monitor` | 回滚监控时间 | `20s` |
| `--rollback-parallelism` | 同时回滚的任务数 | `1`, `0`（全部） |

### 执行滚动更新

```bash
# 更新镜像版本
docker service update \
    --image myapp:2.0.0 \
    --update-delay 30s \
    --update-parallelism 1 \
    myapp

# 查看更新进度
docker service ps myapp

# 监控更新
watch -n 1 "docker service ps myapp"
```

### 更新过程

```
滚动更新流程：

时间    容器版本    任务状态
─────────────────────────────────
T0      1.0.0      4 个容器运行中
T10     2.0.0      1 个新容器启动，3 个旧容器运行
T20     2.0.0      2 个新容器启动，2 个旧容器运行
T30     2.0.0      3 个新容器启动，1 个旧容器运行
T40     2.0.0      4 个新容器运行完成
```

## 回滚操作

### 自动回滚

如果更新失败且设置了 `--update-failure-action rollback`：

```bash
# 设置了失败自动回滚
docker service create \
    --name myapp \
    --replicas 3 \
    --update-failure-action rollback \
    myapp:1.0.0
```

### 手动回滚

```bash
# 回滚到上一个版本
docker service rollback myapp

# 查看回滚进度
docker service ps myapp
```

### 回滚参数

```bash
# 自定义回滚行为
docker service update \
    --rollback \
    --rollback-delay 10s \
    --rollback-parallelism 1 \
    --rollback-monitor 30s \
    myapp
```

## 扩缩容

### 手动扩缩容

```bash
# 扩容
docker service scale myapp=10

# 缩容
docker service scale myapp=2

# 一步完成多个服务的扩缩容
docker service scale myapp=5 backend=3
```

### 自动扩缩容（需要额外工具）

Docker Swarm 没有内置的自动扩缩容，需要使用第三方工具：

```bash
# 使用 docker-compose 自动扩缩容
docker-compose up -d --scale myapp=3
```

### 服务缩容注意事项

```bash
# 缩容时会被驱逐的任务
docker service ps myapp

# 查看将被删除的任务
docker service ps myapp --filter "desired-state=Shutdown"
```

## 健康检查与自愈

### 服务健康检查

```bash
# 创建带健康检查的服务
docker service create \
    --name myapp \
    --replicas 3 \
    --health-cmd "curl -f http://localhost:8080/health || exit 1" \
    --health-interval 30s \
    --health-timeout 10s \
    --health-retries 3 \
    myapp:latest
```

### 自愈机制

```bash
# 查看任务失败原因
docker service ps myapp

# 查看容器日志
docker logs <container-id>

# 强制重新调度
docker service update --force myapp
```

## 服务网络与存储

### 网络配置

```bash
# 创建 Overlay 网络
docker network create \
    --driver overlay \
    --attachable \
    my-network

# 创建服务并加入网络
docker service create \
    --name myapp \
    --network my-network \
    --replicas 3 \
    nginx:alpine

# 多服务通信
docker service create \
    --name backend \
    --network my-network \
    backend:latest

# backend 可以通过 mynetwork 网络访问 frontend
docker service create \
    --name frontend \
    --network my-network \
    --replicas 2 \
    --publish 80:80 \
    frontend:latest
```

### 存储卷

```bash
# 创建卷
docker volume create my-data

# 创建服务并挂载卷
docker service create \
    --name myapp \
    --mount type=volume,source=my-data,target=/data \
    --replicas 2 \
    nginx:alpine

# 使用只读卷
docker service create \
    --name myapp \
    --mount type=volume,source=my-data,target=/data,readonly \
    nginx:alpine
```

## Config 和 Secret

### Config

```bash
# 创建配置
echo "server { listen 80; }" | docker config create nginx.conf -

# 创建服务使用配置
docker service create \
    --name nginx \
    --config source=nginx.conf,target=/etc/nginx/conf.d/default.conf \
    --publish 80:80 \
    nginx:alpine

# 更新配置
echo "server { listen 8080; }" | docker config create nginx.conf.v2 -
docker service update --config-rm nginx.conf --config-add source=nginx.conf.v2,target=/etc/nginx/conf.d/default.conf nginx
```

### Secret

```bash
# 创建密钥
echo "my-secret-password" | docker secret create db_password -

# 创建服务使用密钥
docker service create \
    --name myapp \
    --secret source=db_password,target=/run/secrets/db_password \
    myapp:latest

# 查看密钥
docker secret ls

# 查看密钥详情（不显示内容）
docker secret inspect db_password
```

## 服务清理

```bash
# 删除服务
docker service rm myapp

# 删除所有服务
docker service ls -q | xargs docker service rm

# 移除所有未使用的网络
docker network prune

# 清理所有未使用的资源
docker system prune
```

## docker-stack 部署

使用 `docker-stack` 部署完整应用：

```yaml
# docker-stack.yml
version: "3.8"

services:
  web:
    image: nginx:alpine
    ports:
      - "80:80"
    networks:
      - frontend
    deploy:
      replicas: 2
      update_config:
        parallelism: 1
        delay: 10s
      restart_policy:
        condition: on-failure

  api:
    image: myapp:latest
    networks:
      - frontend
      - backend
    environment:
      - DB_HOST=database
    deploy:
      replicas: 3
      update_config:
        parallelism: 1
        delay: 10s

  database:
    image: postgres:15
    networks:
      - backend
    volumes:
      - db-data:/var/lib/postgresql/data
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.role == manager

  redis:
    image: redis:7-alpine
    networks:
      - backend

networks:
  frontend:
    driver: overlay
  backend:
    driver: overlay
    internal: true

volumes:
  db-data:
```

```bash
# 部署
docker stack deploy -c docker-stack.yml myapp

# 查看堆栈
docker stack ls

# 查看堆栈中的服务
docker stack services myapp

# 查看堆栈中的任务
docker stack ps myapp

# 移除堆栈
docker stack rm myapp
```

## 面试追问

1. **Docker Swarm 的滚动更新是怎么工作的？如何配置更新策略？**
2. **更新失败后会自动回滚吗？如何配置？**
3. **如何实现服务的自动扩缩容？**
4. **Docker Swarm 的服务发现是怎么工作的？**
5. **Config 和 Secret 的区别是什么？各自适合存储什么数据？**

> "服务部署不是一次性的操作，而是持续的过程。好的部署策略应该包括：滚动更新、回滚机制、健康检查、自愈能力。记住：部署的本质是变更，而变更是高风险操作，要谨慎再谨慎。"
