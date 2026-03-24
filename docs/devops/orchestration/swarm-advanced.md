# Docker Swarm 进阶指南

「Docker Swarm 还能做什么？」——Swarm 不只是 Docker Compose 的集群版。

Docker Swarm 的功能被严重低估。除了基础的服务编排，它还提供了服务发现、负载均衡、滚动更新、密钥管理、节点管理等企业级特性。对于中小规模的容器化部署，Swarm 足够用——只要你知道它能做什么。

## 集群管理

### 节点管理

```bash
# 查看集群状态
docker node ls
# 输出：
# ID                            HOSTNAME   STATUS    AVAILABILITY   MANAGER STATUS   ENGINE VERSION
# xxx1 *                        node-1     Ready     Active         Leader           24.0.0
# xxx2                          node-2     Ready     Active         Reachable        24.0.0
# xxx3                          node-3     Ready     Active                       24.0.0

# 查看节点详细信息
docker node inspect node-1

# 节点可用性控制
docker node update --availability drain node-3   # 排空（停止调度新任务，但保留运行中任务）
docker node update --availability pause node-3    # 暂停（不调度新任务）
docker node update --availability active node-3   # 恢复

# 添加标签用于调度
docker node update --label-add zone=us-east-1 node-1
docker node update --label-add zone=us-east-2 node-2

# 解散集群
docker swarm leave --force   # Manager 节点用 --force
docker swarm leave           # Worker 节点
```

### Manager 高可用

```
┌─────────────────────────────────────────────────────────────────┐
│                Swarm Manager 高可用 (Raft 共识)                   │
│                                                                  │
│  Leader (写入)                                                   │
│  ├── 处理所有 Raft 共识操作                                        │
│  ├── 调度任务、管理集群状态                                        │
│  └── 写入 WAL 日志，复制到 Follower                              │
│                                                                  │
│  Follower (只读)                                                 │
│  ├── 接收 Leader 日志复制                                        │
│  ├── 参与 Leader 选举投票                                        │
│  └── 可以接受只读 API 请求                                        │
│                                                                  │
│  Manager 数量建议：3 或 5                                         │
│  原因：Raft 需要多数派 (Quorum)：3 节点容忍 1 节点故障             │
│                               5 节点容忍 2 节点故障                │
│  注意：偶数 Manager（4个）反而不好，5节点比4节点的容错能力更强      │
└─────────────────────────────────────────────────────────────────┘
```

```bash
# Raft 共识机制（Manager 节点间通信）
# Manager 使用 2377 端口进行集群管理
# 使用 2378 端口进行 Raft 一致性通信

# 强制重新选主（Leader 故障时）
docker node promote node-2   # 提升为 Manager
# 如果 Leader 故障，其他 Manager 会自动选举新 Leader

# 查看选主状态
docker node inspect node-1 --format '{{ .ManagerStatus.Leader }}'
```

## 服务配置

### 健康检查

```yaml
# docker-compose.yml
services:
  web:
    image: myregistry/my-web:v1
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    ports:
      - "80:8080"
    deploy:
      replicas: 3
```

```bash
# 查看服务健康状态
docker service ls
docker service ps myapp_web
# CONTAINER ID   IMAGE              ...   HEALTH        STATUS
# xxx            myregistry/my-web  ...   healthy       running

# 手动测试健康检查
docker inspect --format='{{json .State.Health}}' <container-id>
```

### 副本与全局服务

```yaml
# 副本服务（默认）
services:
  web:
    image: nginx
    replicas: 3   # 3 个 nginx 副本，分布在不同节点

# 全局服务（DaemonSet 模式）
services:
  monitoring-agent:
    image: prometheus/node-exporter
    mode: global   # 每个节点一个实例
    mounts:
      - type: bind
        source: /proc
        target: /host/proc
        read_only: true
    command:
      - --path.procfs=/host/proc
      - --path.sysfs=/host/sys
      - --collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)
```

### 环境变量与配置

```yaml
services:
  web:
    image: myregistry/my-web:v1
    environment:
      - SPRING_PROFILES=production
      - DB_HOST=db-service
      - DB_PORT=5432
      - LOG_LEVEL=${LOG_LEVEL:-info}
    env_file:
      - ./config/prod.env
    configs:
      - source: app_config
        target: /app/config/application.yml
    secrets:
      - source: db_password
        target: /run/secrets/db_password

configs:
  app_config:
    file: ./config/application.yml

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

## 密钥管理（Secrets）

```bash
# 创建密钥（从文件）
echo "my-db-password" | docker secret create db_password -
docker secret ls

# 创建密钥（从 stdin）
docker secret create app_key - <<EOF
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA...
-----END RSA PRIVATE KEY-----
EOF

# 使用密钥
docker service create \
  --name myapp \
  --secret db_password \
  --secret app_key \
  myregistry/myapp:v1
```

```yaml
# docker-compose.yml
services:
  web:
    image: myregistry/my-web:v1
    secrets:
      - db_password
      - app_key
    environment:
      - DB_PASSWORD_FILE=/run/secrets/db_password
secrets:
  db_password:
    external: true
  app_key:
    file: ./app_key.pem
```

```bash
# 查看密钥
docker secret ls
docker secret inspect --pretty db_password

# 在容器内访问
# 密钥挂载到 /run/secrets/ 目录
docker exec <container-id> cat /run/secrets/db_password
```

## 网络管理

### 内置网络

```bash
# 查看网络
docker network ls
# NETWORK ID     NAME              DRIVER    SCOPE
# xxx            ingress           swarm     swarm   # 内置，覆盖层网络
# xxx            docker_gwbridge   bridge    local   # 桥接网络
# xxx            my-overlay-net    overlay   swarm   # 自定义覆盖网络

# 创建自定义覆盖网络
docker network create \
  --driver overlay \
  --attachable \
  --ingress \
  my-overlay-net

# 创建带加密的覆盖网络
docker network create \
  --driver overlay \
  --opt encrypted \
  my-encrypted-net
```

### 网络隔离

```yaml
# docker-compose.yml
services:
  frontend:
    image: myregistry/frontend:v1
    networks:
      - public-net
    deploy:
      replicas: 3

  backend:
    image: myregistry/backend:v1
    networks:
      - internal-net
    deploy:
      replicas: 2

  database:
    image: postgres:15
    networks:
      - internal-net
    deploy:
      replicas: 1

networks:
  public-net:
    driver: overlay
    attachable: true
  internal-net:
    driver: overlay
    internal: true   # 完全隔离，无外部出口
```

### 服务发现

```bash
# Swarm 内置 DNS，服务名即 DNS 名
# 同一 overlay 网络中的服务可以相互访问
# 访问地址：服务名（在同一 stack 中可用 stackname_servicename）
```

## 滚动更新

```yaml
# docker-compose.yml 中的滚动更新配置
services:
  web:
    image: myregistry/my-web:v1
    replicas: 6
    update_config:
      parallelism: 2        # 每次更新 2 个容器
      delay: 15s            # 更新间隔
      failure_action: rollback  # 更新失败回滚
      monitor: 15s          # 监控窗口
      max_failure_ratio: 0.1  # 允许 10% 失败率
      order: start-first    # 先启动新容器（start-first）或先停止旧容器（stop-first）
    rollback_config:
      parallelism: 1
      delay: 5s
      failure_action: pause
      monitor: 10s
```

```bash
# 手动触发滚动更新
docker service update \
  --image myregistry/my-web:v2.0.0 \
  --update-delay 10s \
  --update-parallelism 2 \
  myapp_web

# 查看更新进度
docker service ps myapp_web
watch docker service ps myapp_web  # 实时观察

# 中断更新
docker service update --rollback myapp_web

# 自动回滚（配置在 docker-compose.yml 中）
# failure_action: rollback
```

## 日志管理

```bash
# 查看服务日志
docker service logs myapp_web -f
docker service logs myapp_web --tail 100

# 按时间过滤
docker service logs myapp_web --since 2024-01-01T00:00:00

# 查看特定任务日志
docker logs <container-id>

# 配置日志驱动
docker service create \
  --log-driver json-file \
  --log-opt max-size=100m \
  --log-opt max-file=3 \
  myregistry/myapp:v1

# 使用 syslog 日志驱动
docker service create \
  --log-driver syslog \
  --log-opt syslog-address=tcp://syslog-server:514 \
  myregistry/myapp:v1
```

## 存储卷

```bash
# 创建命名卷
docker volume create my-data

# 查看卷
docker volume ls
docker volume inspect my-data

# 使用卷
docker service create \
  --mount type=volume,source=my-data,target=/data \
  myregistry/myapp:v1

# 清理未使用的卷
docker volume prune
```

```yaml
# docker-compose.yml 中的卷配置
services:
  database:
    image: postgres:15
    volumes:
      - db-data:/var/lib/postgresql/data
    deploy:
      placement:
        constraints:
          - node.role == manager  # 数据库放 Manager 节点

volumes:
  db-data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/postgres   # 宿主机目录
```

## 调度约束

```yaml
# 节点约束（强制）
services:
  database:
    image: postgres:15
    placement:
      constraints:
        - "node.role==manager"           # 只调度到 Manager
        - "engine.labels.zone==prod"     # 指定 zone 标签
        - "node.labels.storage==ssd"    # 指定存储类型

# 亲和性调度
services:
  cache:
    image: redis:7-alpine
    placement:
      constraints:
        - "node.role==worker"
      preferences:
        - spread: engine.labels.zone    # 尽量均匀分布到不同 zone
```

```bash
# 添加节点标签
docker node update --label-add storage=ssd node-1
docker node update --label-add zone=us-east-1a node-1

# 查看节点标签
docker node inspect node-1 --format '{{ .Spec.Labels }}'
```

## 监控与调试

```bash
# 服务状态
docker service ls
docker service ps myapp_web

# 节点资源
docker node ls
docker node inspect node-1 --format '{{ .Description.Resources }}'

# 容器详情
docker ps
docker inspect <container-id>

# 服务事件
docker service events

# 进入容器调试
docker exec -it <container-id> /bin/bash

# 服务资源限制
docker service update \
  --limit-memory 512m \
  --limit-cpu 0.5 \
  --reserve-memory 256m \
  --reserve-cpu 0.25 \
  myapp_web
```

## 与 Kubernetes 的主要区别

| 功能 | Docker Swarm | Kubernetes |
|------|------------|-----------|
| 路由网格 | 内置（Ingress） | 需 Ingress Controller |
| 密钥管理 | 内置（Secrets） | ConfigMap / Secret |
| 服务发现 | DNS 自动注册 | Service + DNS |
| 健康检查 | 内置（healthcheck） | livenessProbe / readinessProbe |
| 滚动更新 | 原生支持（update_config） | RollingUpdate Strategy |
| 自动扩缩容 | 需额外工具 | HPA 内置 |
| 持久化存储 | Volume Plugin | PVC / StorageClass |
| 网络策略 | 有限 | NetworkPolicy |
| 多租户隔离 | 有限（Stack 隔离） | Namespace + RBAC |
| 扩展性 | 有限 | CRD + Operator |
| Dashboard | Portainer | Kubernetes Dashboard |

## 面试追问方向

1. **Docker Swarm 的服务发现是怎么工作的？**
   答：Swarm 使用内置的 DNS 服务器（称为「路由网格」）。每个服务被分配一个虚拟 IP（VIP），服务名解析到 VIP，请求通过 VIP 均匀分发到后端容器。同一 overlay 网络内的服务可以直接通过服务名相互访问。

2. **Swarm 的 Ingress 网络是什么？**
   答：Ingress 是 Swarm 的内置 overlay 网络，用于外部流量路由到服务。所有节点都参与 Ingress 网络，外部请求可以被路由到任意节点，然后通过 Ingress 网络转发到实际运行容器的节点。这使得外部流量可以访问任何节点的端口，无需手动配置。

3. **Swarm 和 Docker Compose 的关系是什么？**
   答：Docker Compose 是本地开发和单机部署的工具；Docker Swarm 是集群编排工具。两者的 YAML 语法相似，但 Compose 文件加上 `--compatibility` 模式可以在 Swarm 中运行（有限支持）。生产环境推荐直接使用 Swarm 原生语法。

4. **Swarm 如何保证数据安全？**
   答：Swarm 的管理平面默认加密（RAFT 通信 TLS）；overlay 网络支持 `--opt encrypted` 启用数据包加密；Secrets 存储在 Raft 日志中并加密传输。存储卷可以使用 `local` 驱动绑定宿主机目录，或使用 Volume Plugin 集成外部存储。

Swarm 的上限没有 Kubernetes 高，但它的下限足够大多数场景使用。在选择之前，先问自己：未来三年，集群会超过 100 个节点吗？需要 HPA 以外的复杂调度吗？如果答案是否，Swarm 完全够用。
