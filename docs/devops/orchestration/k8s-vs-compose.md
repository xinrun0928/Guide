# Kubernetes vs Docker Compose：何时用哪个

「Docker Compose 能替代 Kubernetes 吗？」——不能，但各有适用场景。

Docker Compose 和 Kubernetes 都是容器编排工具，但定位完全不同。Compose 是本地开发和单机部署的神器，K8s 是生产环境大规模编排的标准答案。选错了工具，要么开发效率低，要么运维成本高。

## 核心对比

```
┌─────────────────────────────────────────────────────────────────┐
│            Docker Compose vs Kubernetes                          │
│                                                                  │
│  Docker Compose                                                │
│  ├── 单机或少量节点                                             │
│  ├── YAML 配置，语法简单                                        │
│  ├── 适合：本地开发、微服务联调、小规模部署                      │
│  └── 局限：无服务发现、无滚动更新、无自动扩缩容                   │
│                                                                  │
│  Kubernetes                                                   │
│  ├── 多节点集群                                               │
│  ├── YAML 配置，API 丰富                                        │
│  ├── 适合：生产环境、微服务架构、大规模部署                      │
│  └── 优势：自愈、自动扩缩容、负载均衡、服务发现、灰度发布         │
└─────────────────────────────────────────────────────────────────┘
```

| 维度 | Docker Compose | Kubernetes |
|------|--------------|-----------|
| 适用规模 | 单机 ~ 少量节点 | 任意规模 |
| 学习曲线 | 极低 | 高 |
| 服务发现 | 有限（网络名） | 完整（DNS + Service） |
| 负载均衡 | 无内置 | Service + Ingress |
| 自动扩缩容 | 无 | HPA / VPA / CronHPA |
| 滚动更新 | 有限（docker-compose up） | 完整（RollingUpdate） |
| 健康检查 | 无内置 | liveness/readiness Probe |
| 持久化存储 | Volume | PVC + StorageClass |
| 密钥管理 | .env 文件 | Secret |
| 多环境 | 多个 compose 文件 | Namespace |
| 生产可用性 | 低 | 高 |

## Docker Compose 的适用场景

### 本地开发

```yaml
# docker-compose.yml
version: "3.9"

services:
  api:
    build: ./api
    ports:
      - "8080:8080"
    environment:
      - DATABASE_URL=postgres://db:5432/app
      - REDIS_URL=redis://cache:6379
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
    volumes:
      - ./api:/app
      - app-cache:/root/.m2

  db:
    image: postgres:15
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dev"]
      interval: 5s
      timeout: 3s
      retries: 5
    volumes:
      - pg-data:/var/lib/postgresql/data

  cache:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - api

volumes:
  pg-data:
  redis-data:
  app-cache:
```

### 微服务本地联调

```bash
# 一键启动所有服务
docker compose up -d

# 只启动部分服务（快速迭代）
docker compose up -d api db

# 查看日志（所有服务或单个服务）
docker compose logs -f
docker compose logs -f api

# 扩缩容
docker compose up -d --scale api=3

# 进入容器调试
docker compose exec api /bin/sh

# 停止所有服务
docker compose down

# 完全清理（包括 volumes）
docker compose down -v
```

### Compose vs Swarm

```bash
# Swarm 模式（单机集群）
docker swarm init
docker stack deploy -c docker-compose.yml myapp

# 查看 stack
docker stack ls
docker stack ps myapp

# 滚动更新
docker service update --image myapp:v2 api

# 删除 stack
docker stack rm myapp
```

## Kubernetes 的适用场景

### 生产环境微服务部署

```yaml
# api-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: api
        version: v2
    spec:
      containers:
        - name: api
          image: myregistry/api:v2.0.0
          ports:
            - containerPort: 8080
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: api-secret
                  key: database-url
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: production
spec:
  selector:
    app: api
  ports:
    - port: 80
      targetPort: 8080
  type: ClusterIP
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

## 决策矩阵

```
┌─────────────────────────────────────────────────────────────────┐
│                    选择决策树                                     │
│                                                                  │
│  是否需要生产级特性？                                             │
│  ├── 否：本地开发 / 测试 / 单机部署                              │
│  │   └── Docker Compose                                        │
│  └── 是：                                                      │
│      是否需要多节点集群？                                         │
│      ├── 否：开发环境简单测试（Swarm 或 minikube）              │
│      └── 是：                                                  │
│          规模多大？                                             │
│          ├── 小型（< 20 服务）                                 │
│          │   └── Docker Swarm 或 K3s                           │
│          └── 中大型（20+ 服务）                                 │
│              └── Kubernetes                                    │
└─────────────────────────────────────────────────────────────────┘
```

## 工具链对照

| 能力 | Docker Compose | Kubernetes |
|------|--------------|-----------|
| 容器编排 | ✓ | ✓ |
| 服务发现 | ✓ (网络名) | ✓ (DNS + Service) |
| 负载均衡 | 无 | ✓ (Service) |
| 自动扩缩容 | 无 | ✓ (HPA/VPA) |
| 滚动更新 | 有限 | ✓ (Deployment Strategy) |
| 配置管理 | ✓ (.env) | ✓ (ConfigMap/Secret) |
| 持久化存储 | ✓ (Volume) | ✓ (PVC/StorageClass) |
| Ingress | 无 | ✓ (Ingress Controller) |
| 服务网格 | 无 | ✓ (Istio/Linkerd) |
| 多租户 | 无 | ✓ (Namespace/RBAC) |

## Compose to K8s 迁移

如果项目从 Compose 迁移到 K8s，核心映射关系：

```
┌─────────────────────────────────────────────────────────────────┐
│         Docker Compose → Kubernetes 映射                          │
│                                                                  │
│  Docker Compose              Kubernetes                         │
│  ----------------------------------------------------------------│
│  image + build            Dockerfile + Deployment                │
│  ports                    Service (ClusterIP)                 │
│  volumes                  Volume + PVC                        │
│  environment              ConfigMap / Secret / env             │
│  depends_on               init container / sidecar             │
│  restart: always          Deployment (无此字段, K8s 自动重启)│
│  networks                 NetworkPolicy / CNI                   │
│  docker compose up         kubectl apply -f                    │
│  docker compose logs      kubectl logs                        │
│  docker compose scale     kubectl scale                       │
└──────────────────────────────────────────────────────────────── ┘
```

## Kompose：自动转换

```bash
# 安装 kompose
brew install kompose

# 将 docker-compose.yml 转换为 K8s 资源
kompose convert -f docker-compose.yml

# 输出 YAML
kompose convert -f docker-compose.yml -o k8s-resources/

# 查看转换结果
ls k8s-resources/
# api-deployment.yaml
# api-service.yaml
# db-deployment.yaml
# db-service.yaml
# web-deployment.yaml
# web-service.yaml
```

## 面试追问方向

1. **Docker Compose 的局限性是什么？**
   答：无内置服务发现（只能用网络名通信），无自动扩缩容（`--scale` 是手动），无健康检查自动重启（`restart: always` 有限），无多节点编排（Swarm 模式能部分解决）。对于生产环境，这些局限性都会成为瓶颈。

2. **什么时候用 Docker Swarm 而不是 Kubernetes？**
   答：团队对容器编排不熟悉、项目规模小（< 20 个服务）、已经用 Docker Compose、预算有限不想运维 K8s。Swarm 的优势是上手极快、配置简单、迁移到 K8s 的成本低（YAML 格式相似）。

3. **Kompose 转换的局限性是什么？**
   答：Kompose 只能做基础转换，转换后的 K8s 资源缺少完整的语义（ readinessProbe、resources、hpa 等）；`depends_on` 只能转换成 init container，不能完全替代 K8s 的依赖管理；网络、存储、安全配置需要手动补充。

4. **K3s 和普通 K8s 有什么区别？**
   答：K3s 将所有 K8s 组件打包成单个二进制（< 100MB），对硬件要求极低（512MB RAM 即可运行），适合边缘计算、开发测试、树莓派等场景。API 完全兼容标准 K8s，生产使用需要注意单节点的数据存储问题（建议外置 etcd HA）。

工具没有绝对的好坏，只有场景是否匹配。开发用 Compose，生产用 K8s，中间地带用 Swarm 或 K3s。
