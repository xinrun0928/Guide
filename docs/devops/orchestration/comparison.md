# Docker Swarm vs Kubernetes vs Mesos

「选哪个容器编排平台？」——这是基础设施选型的经典问题。

Docker Swarm、Kubernetes、Mesos，是三条截然不同的路。Swarm 简单但功能有限，Kubernetes 强大但复杂度高，Mesos 全能但运维成本极高。选择哪个，取决于你的业务规模、团队能力和运维投入。

## 三大平台核心对比

```
┌─────────────────────────────────────────────────────────────────┐
│                    容器编排平台对比                               │
│                                                                  │
│  Docker Swarm                    Kubernetes                      │
│  ├── 零额外安装                 ├── 100+ 组件                   │
│  ├── 50 行配置集群              ├── YAML 配置                    │
│  ├── Docker API 兼容            ├── CRD 扩展                     │
│  └── 学习曲线平缓               └── 社区最大                      │
│                                                                  │
│  Apache Mesos / DC/OS                                              │
│  ├── 抽象集群（不只是容器）                                       │
│  ├── Marathon 框架处理容器                                        │
│  └── 适合超大规模（数万节点）                                      │
└─────────────────────────────────────────────────────────────────┘
```

| 维度 | Docker Swarm | Kubernetes | Mesos |
|------|------------|-----------|-------|
| 诞生时间 | 2014 | 2015 (正式版) | 2009 (Mesos) |
| 维护方 | Docker (Mirantis) | CNCF | Apache / D2IQ |
| 学习曲线 | 极低 | 高 | 高 |
| 部署复杂度 | 极简 | 中-高 | 高 |
| 功能丰富度 | 基础 | 极其丰富 | 丰富（需框架） |
| 生态插件 | 少 | 极其丰富 | 中 |
| 社区规模 | 中 | 巨大 | 小 |
| 适用规模 | 中小型 | 任意规模 | 超大规模 |
| 云厂商支持 | 一般 | 原生支持 | AWS (EC2), Azure |
| 网络方案 | Overlay (VXLAN) | CNI 多选 | CNI |
| 存储 | Volume Plugin | CSI 多选 | Persistent Volume Framework |
| 企业支持 | Mirantis | 多家厂商 | D2IQ (商业版) |

## Docker Swarm

Docker Swarm 是 Docker 原生的编排工具，和 Docker Compose 师出同门。对于已经用 Docker 的团队，Swarm 是零门槛的选择。

### 初始化集群

```bash
# 初始化 Manager 节点
docker swarm init --advertise-addr 192.168.1.10

# 加入 Worker 节点（Manager 会输出命令）
docker swarm join --token SWMTKN-xxx 192.168.1.10:2377

# 加入 Manager 节点
docker swarm join-token manager
docker swarm join --token SWMTKN-xxx 192.168.1.10:2377

# 查看节点
docker node ls

# 提升 Worker 为 Manager
docker node promote node-2

# 解雇节点（优雅退出）
docker node demote node-2
docker node update --availability drain node-2
docker node rm node-2
```

### 服务部署

```yaml
# docker-compose.yml (Swarm 模式)
version: "3.9"

services:
  web:
    image: myregistry/my-web:v1.0.0
    ports:
      - "80:8080"
    replicas: 3
    update_config:
      parallelism: 1        # 每次更新 1 个容器
      delay: 10s            # 更新间隔
      failure_action: rollback
      monitor: 10s          # 监控时间
      max_failure_ratio: 0.2
    rollback_config:
      parallelism: 1
      delay: 5s
      failure_action: pause
    restart_policy:
      condition: on-failure
      delay: 5s
      max_attempts: 3
    placement:
      constraints:
        - "node.role==worker"
        - "engine.labels.zone==prod"
    networks:
      - frontend
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 512M
        reservations:
          cpus: "0.25"
          memory: 256M

  redis:
    image: redis:7-alpine
    replicas: 1
    placement:
      constraints:
        - "node.role==manager"
    volumes:
      - redis-data:/data
    networks:
      - backend

volumes:
  redis-data:

networks:
  frontend:
  backend:
```

```bash
# 部署 stack
docker stack deploy -c docker-compose.yml myapp

# 查看 stack
docker stack ls
docker stack ps myapp
docker stack services myapp

# 扩缩容
docker service scale myapp_web=10
docker service scale myapp_web=3

# 更新服务
docker service update --image myregistry/my-web:v2.0.0 myapp_web
docker service update --replicas 5 --image myregistry/my-web:v2.0.0 myapp_web

# 回滚
docker service rollback myapp_web

# 删除 stack
docker stack rm myapp
```

### 滚动更新与回滚

```bash
# 查看更新进度
docker service inspect --pretty myapp_web

# 手动回滚
docker service rollback myapp_web

# 自动回滚（失败后）
# 在 update_config 中配置
# failure_action: rollback
```

### Swarm 内置功能

```bash
# 路由网格（内置 Ingress）
# 任意节点的 IP:Port 都能访问服务
curl http://任意节点IP:8080

# 密钥管理（Secrets）
echo "my-password" | docker secret create db_password -
docker config create app_config.json config.json

# 服务日志
docker service logs myapp_web -f

# 健康检查（内置）
docker service create \
  --image nginx \
  --health-cmd="curl -f http://localhost/ || exit 1" \
  --health-interval=5s \
  --health-retries=3 \
  --health-timeout=2s \
  mynginx
```

### Swarm vs Kubernetes 核心差异

```
┌─────────────────────────────────────────────────────────────────┐
│              Swarm vs Kubernetes 关键差异                       │
│                                                                  │
│  Swarm                                                          │
│  ├── Service = Deployment + Service（概念简化）                  │
│  ├── 网络：Ingress（内置）/ Overlay                             │
│  ├── 存储：Volume Plugin（需插件）                              │
│  ├── Ingress mesh（所有节点暴露端口）                            │
│  ├── Secret/Config：原生支持                                     │
│  └── 没有 Namespace，只有 Stack（有限隔离）                      │
│                                                                  │
│  Kubernetes                                                     │
│  ├── Pod = 一组容器（基本调度单位）                              │
│  ├── Deployment / StatefulSet / DaemonSet / Job（多种 Workload）│
│  ├── Service（负载均衡）/ Ingress（HTTP 路由）                   │
│  ├── StorageClass + PVC + PV（完整存储抽象）                     │
│  ├── ConfigMap / Secret / RBAC / NetworkPolicy                  │
│  ├── Namespace（命名空间隔离）                                   │
│  └── CRD（无限扩展）                                            │
└─────────────────────────────────────────────────────────────────┘
```

## Kubernetes

Kubernetes 是容器编排的事实标准。CNCF 生态丰富，从存储、网络到服务网格，都有成熟方案。

### 核心资源

```yaml
# Deployment：无状态应用
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-web
  namespace: production
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: my-web
  template:
    metadata:
      labels:
        app: my-web
    spec:
      containers:
      - name: my-web
        image: myregistry/my-web:v1.0.0
        ports:
        - containerPort: 8080
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 10
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"

---
# Service：服务发现 + 负载均衡
apiVersion: v1
kind: Service
metadata:
  name: my-web
  namespace: production
spec:
  selector:
    app: my-web
  ports:
  - port: 80
    targetPort: 8080
  type: ClusterIP

---
# HorizontalPodAutoscaler：自动扩缩容
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-web
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-web
  minReplicas: 2
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### 高级功能

```yaml
# StatefulSet：有序部署、有状态应用
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
  namespace: production
spec:
  serviceName: mysql
  replicas: 3
  selector:
    matchLabels:
      app: mysql
  template:
    spec:
      containers:
      - name: mysql
        image: mysql:8.0
        volumeMounts:
        - name: data
          mountPath: /var/lib/mysql
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: "ssd-storage"
      resources:
        requests:
          storage: 100Gi

---
# DaemonSet：每节点一个 Pod（日志收集、监控代理）
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluentd
  namespace: logging
spec:
  selector:
    matchLabels:
      app: fluentd
  template:
    spec:
      containers:
      - name: fluentd
        image: fluentd:v1.16
        volumeMounts:
        - name: varlog
          mountPath: /var/log
      tolerations:
      - key: node-role.kubernetes.io/master
        effect: NoSchedule

---
# Job / CronJob：批处理任务
apiVersion: batch/v1
kind: CronJob
metadata:
  name: data-export
  namespace: production
spec:
  schedule: "0 2 * * *"   # 每天凌晨 2 点
  concurrencyPolicy: Forbid  # 禁止并发执行
  successfulJobsHistoryLimit: 3
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: export
            image: myapp-export:v1.0.0
            command: ["java", "-jar", "export.jar"]
          restartPolicy: OnFailure
```

### 完整示例：Web 应用

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  strategy:
    type: RollingUpdate
  template:
    metadata:
      labels:
        app: myapp
        version: v1
    spec:
      containers:
      - name: myapp
        image: myregistry/myapp:v1
        ports:
        - containerPort: 8080
        env:
        - name: SPRING_PROFILES_ACTIVE
          value: "production"
        - name: DB_HOST
          valueFrom:
            configMapKeyRef:
              name: myapp-config
              key: db.host
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: myapp-secret
              key: db.password
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /actuator/health/liveness
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /actuator/health/readiness
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5

---
apiVersion: v1
kind: Service
metadata:
  name: myapp
  namespace: production
spec:
  selector:
    app: myapp
  ports:
  - port: 80
    targetPort: 8080
  type: ClusterIP

---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp
  namespace: production
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - myapp.example.com
    secretName: myapp-tls
  rules:
  - host: myapp.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: myapp
            port:
              number: 80
```

## Mesos / DC/OS

Apache Mesos 的定位和 Swarm、Kubernetes 都不同——它不只是一个容器编排器，而是通用的集群管理器。

```
┌─────────────────────────────────────────────────────────────────┐
│                    Mesos 架构                                   │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                        Mesos Master                         │ │
│  │   (ZooKeeper HA, 选主, 资源调度)                           │ │
│  └────────────────────────────────────────────────────────────┘ │
│              │                         │                        │
│   ┌──────────┴──────┐          ┌────────┴─────────┐              │
│   │  Framework 1   │          │  Framework 2     │              │
│   │  (Marathon)    │          │  (Spark)         │              │
│   │  (容器编排)    │          │  (大数据计算)    │              │
│   └────────────────┘          └──────────────────┘              │
│              │                                                │
│  ┌──────────┴──────────────────────────────────────────────┐   │
│  │                        Mesos Agent                        │   │
│  │   (Executor, 运行容器/任务, 汇报资源)                    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Marathon（Mesos 上的容器编排框架）

```json
{
  "id": "/myapp",
  "cpus": 1.0,
  "mem": 1024,
  "instances": 3,
  "container": {
    "type": "DOCKER",
    "docker": {
      "image": "myregistry/myapp:v1",
      "network": "BRIDGE",
      "portMappings": [
        { "containerPort": 8080, "hostPort": 0 }
      ],
      "forcePullImage": true
    }
  },
  "healthChecks": [
    {
      "protocol": "HTTP",
      "path": "/health",
      "portIndex": 0,
      "gracePeriodSeconds": 300,
      "intervalSeconds": 60,
      "timeoutSeconds": 20,
      "maxConsecutiveFailures": 3
    }
  ],
  "upgradeStrategy": {
    "minimumHealthCapacity": 0.5,
    "maximumOverCapacity": 0.5
  }
}
```

### Mesos 的独特优势

| 场景 | Mesos 优势 |
|------|----------|
| 混合工作负载 | 同一集群同时运行容器（Marathon）、大数据（Spark）、消息队列（Kafka） |
| 超大规模 | 10,000+ 节点的生产案例丰富 |
| 资源抽象 | 不只抽象容器，还抽象 CPU/内存/磁盘 |
| 长期运行服务 + 批处理 | Marathon + Chronos 的组合 |

## 选择决策树

```
你需要选择容器编排平台吗？
│
├── 是否已有 Docker Swarm / Kubernetes 经验？
│   └── 是 → 继续用现有方案
│
├── 业务规模多大？
│   ├── < 50 台服务器，团队 < 10 人
│   │   └── Docker Swarm 或 K3s 足够
│   │
│   ├── 50 ~ 500 台，中等规模
│   │   └── Kubernetes（云托管版更省心）
│   │
│   └── 500+ 台，超大规模
│       └── Kubernetes 或 Mesos
│
├── 需要运行非容器化工作负载吗？
│   └── 是 → Mesos（支持容器 + VM + 大数据）
│
├── 云厂商选哪个？
│   ├── AWS → EKS (Kubernetes)
│   ├── GCP → GKE (Kubernetes)
│   ├── Azure → AKS (Kubernetes)
│   └── 自建 → Kubernetes / K3s
│
└── 团队技术栈偏好？
    ├── 简单至上 → Swarm
    ├── 生态丰富 → Kubernetes
    └── 灵活性要求高 → Mesos
```

## 面试追问方向

1. **Swarm 为什么没有 Kubernetes 流行？**
   答：功能差距是核心原因。Swarm 没有 Pod 概念、没有完整的 RBAC、没有 CSI 存储标准、没有 CRD 扩展能力。当业务复杂度上升，Swarm 的局限性就会暴露。但对于简单场景，Swarm 的运维成本极低。

2. **Kubernetes 的调度器是怎么工作的？**
   答：调度器监听未调度的 Pod，为其选择最优节点。流程：预选（Predicate）——过滤不符合条件的节点；选优（Priority）——对剩余节点打分；绑定（Bind）——将 Pod 绑定到目标节点。预选阶段排除资源不足、标签不匹配的节点；选优阶段综合考虑亲和性、拓扑、数据局部性等因素。

3. **Mesos 和 Kubernetes 的本质区别是什么？**
   答：Mesos 是两级调度器（Master 分配资源给 Framework，Framework 自己决定运行什么）；Kubernetes 是单级调度器（Scheduler 直接决定 Pod 运行位置）。Mesos 更灵活但更复杂；Kubernetes 更简单但需要不同的 Framework 处理不同类型任务。

4. **K3s 和 Kubernetes 的区别是什么？**
   答：K3s 是 CNCF 认证的 Kubernetes 发行版，将所有 K8s 组件打包成单个二进制（< 100MB），对硬件要求极低，适合边缘计算、小规模部署和开发测试。API 完全兼容 Kubernetes，生产使用需要注意数据存储的单点问题（内置 SQLite vs 外置 etcd HA）。

没有最好的平台，只有最适

合团队的平台。小团队用 Swarm 快速交付，强团队用 Kubernetes 掌控复杂场景。
