# Init Container 与 Sidecar 模式

你想在主容器启动前做一些初始化工作吗？你想让 Sidecar 容器和主容器共享网络吗？

理解 Init Container 和 Sidecar 模式，是掌握 Kubernetes 多容器编排的关键。

## Init Container 概述

Init 容器在 Pod 的主容器启动前运行，常用于：

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Init Container 用途                              │
│                                                                     │
│  1. 等待依赖服务就绪                                                │
│     - 数据库启动完成                                                 │
│     - 配置中心可用                                                   │
│     - 其他服务注册                                                  │
│                                                                     │
│  2. 准备工作                                                       │
│     - 下载依赖资源                                                   │
│     - 初始化配置文件                                                 │
│     - 注册到服务发现                                                 │
│                                                                     │
│  3. 迁移数据                                                        │
│     - 旧版本数据迁移                                                 │
│     - 数据库迁移脚本                                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Init Container 与普通容器的区别

| 特性 | Init Container | 普通 Container |
|------|----------------|----------------|
| 执行顺序 | 先于普通容器 | Init 容器之后 |
| 运行环境 | 每次 Pod 创建时全新环境 | 持久运行 |
| 支持命令 | 完整支持 | 完整支持 |
| 生命周期 | 短时运行 | 长时运行 |
| 健康检查 | 不支持 | 支持 liveness/readiness |
| 副本数 | 所有 Init 容器顺序执行 | 可并行 |
| 重启策略 | Pod 级别 | Pod 级别 |

## Init Container 示例

### 示例1：等待依赖服务

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp-pod
  labels:
    app: myapp
spec:
  initContainers:
    # 等待数据库服务就绪
    - name: wait-for-db
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          echo "Waiting for database..."
          until nslookup mysql; do
            echo "Database not ready, waiting..."
            sleep 5
          done
          echo "Database is ready!"

    # 等待配置中心
    - name: wait-for-config
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          echo "Waiting for config server..."
          until wget -qO- http://config-server:8888/health | grep -q UP; do
            echo "Config server not ready, waiting..."
            sleep 3
          done
          echo "Config server is ready!"

    # 运行数据库迁移
    - name: run-migrations
      image: myapp:migrations
      command: ["./run-migrations.sh"]
      env:
        - name: DATABASE_HOST
          value: "mysql"
        - name: DATABASE_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: password
  containers:
    - name: myapp
      image: myapp:latest
      ports:
        - containerPort: 8080
      env:
        - name: DATABASE_HOST
          value: "mysql"
        - name: DATABASE_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: password
```

### 示例2：下载配置和资源

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx
spec:
  initContainers:
    # 下载配置
    - name: download-config
      image: curlimages/curl:latest
      command:
        - sh
        - -c
        - |
          echo "Downloading configuration..."
          curl -s -o /shared/config/nginx.conf http://config-server/nginx.conf
          curl -s -o /shared/index.html http://config-server/index.html
          echo "Configuration downloaded!"
      volumeMounts:
        - name: shared-config
          mountPath: /shared

    # 等待 TLS 证书生成
    - name: wait-for-cert
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          echo "Waiting for TLS certificate..."
          until ls /shared/certs/tls.crt; do
            sleep 5
          done
          echo "Certificate ready!"
      volumeMounts:
        - name: shared-certs
          mountPath: /shared/certs

  containers:
    - name: nginx
      image: nginx:alpine
      volumeMounts:
        - name: shared-config
          mountPath: /etc/nginx/conf.d
        - name: shared-certs
          mountPath: /etc/nginx/ssl
      ports:
        - containerPort: 443

  volumes:
    - name: shared-config
      emptyDir: {}
    - name: shared-certs
      emptyDir: {}
```

### 示例3：准备数据目录

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: redis
spec:
  initContainers:
    # 创建数据目录并设置权限
    - name: init-redis
      image: redis:7-alpine
      command:
        - sh
        - -c
        - |
          echo "Initializing Redis data directory..."
          mkdir -p /data/redis
          chown redis:redis /data/redis
          echo "Redis data directory initialized"
      volumeMounts:
        - name: redis-data
          mountPath: /data
  containers:
    - name: redis
      image: redis:7-alpine
      volumeMounts:
        - name: redis-data
          mountPath: /data
      command: ["redis-server", "--appendonly", "yes"]
  volumes:
    - name: redis-data
      persistentVolumeClaim:
        claimName: redis-pvc
```

## Init Container 的失败处理

### 默认行为

```bash
# Init 容器失败，Pod 不会启动
kubectl describe pod <pod-name> | grep -A 10 "Events"

# 输出：
# Type     Reason                  Age   From             Message
# ----     ------                  ----  ----             -------
# Normal   Scheduled               2m    default-scheduler  Assigned to node
# Normal   Pulling                2m    kubelet           Pulling image
# Normal   Pulled                  1m    kubelet           Successfully pulled image
# Warning  Failed                  1m    kubelet           Init container init-myservice failed
# Warning  BackOff                 1m    kubelet           Back-off restarting failed init container
# Warning  Failed                  1m    kubelet           Pod terminated with exit code 1
```

### restartPolicy 影响

```yaml
# Pod 的 restartPolicy 也会影响 Init 容器
spec:
  restartPolicy: Always  # Init 容器失败会重启 Pod
  # restartPolicy: OnFailure  # Init 容器失败才重启
  # restartPolicy: Never       # Init 容器失败 Pod 不重启
```

## Sidecar 模式

Sidecar 模式是在 Pod 中运行辅助容器，与主容器并肩工作：

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Sidecar 模式                                 │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                         Pod                                  │  │
│  │                                                             │  │
│  │  ┌─────────────────────────────────────────────────────┐ │  │
│  │  │                    Main Container                      │ │  │
│  │  │                    主容器                               │ │  │
│  │  │  - 执行业务逻辑                                         │ │  │
│  │  │  - 处理请求                                             │ │  │
│  │  └─────────────────────────────────────────────────────┘ │  │
│  │                                                             │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │  │
│  │  │  Sidecar A  │  │  Sidecar B  │  │  Sidecar C  │     │  │
│  │  │  日志收集   │  │  监控代理   │  │  代理服务   │     │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘     │  │
│  │                                                             │  │
│  │  共享网络命名空间                                            │  │
│  │  共享存储卷                                                  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Sidecar vs Init Container

| 特性 | Sidecar Container | Init Container |
|------|-------------------|-----------------|
| 运行时间 | 与主容器同期运行 | 主容器启动前结束 |
| 用途 | 辅助主容器 | 准备环境 |
| 通信 | 与主容器通过 localhost 通信 | 独立运行 |
| 生命周期 | 与 Pod 相同 | Pod 创建时 |
| 示例 | 日志收集、监控代理 | 数据库迁移、等待依赖 |

### Sidecar 示例

#### 示例1：日志收集 Sidecar

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
        - name: myapp
          image: myapp:latest
          ports:
            - containerPort: 8080
          volumeMounts:
            - name: app-logs
              mountPath: /var/log/myapp

        # Sidecar：日志收集
        - name: log-collector
          image: fluent/fluentd:v1.16
          volumeMounts:
            - name: app-logs
              mountPath: /var/log/myapp
            - name: fluentd-config
              mountPath: /etc/fluent/conf.d
          resources:
            limits:
              memory: 128Mi
              cpu: 100m

      volumes:
        - name: app-logs
          emptyDir: {}
        - name: fluentd-config
          configMap:
            name: fluentd-config
```

#### 示例2：监控代理 Sidecar

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    spec:
      containers:
        - name: myapp
          image: myapp:latest
          ports:
            - containerPort: 8080

        # Sidecar：Prometheus 监控代理
        - name: prometheus-agent
          image: prometheus/node-exporter:latest
          args:
            - --path.procfs=/host/proc
            - --path.sysfs=/host/sys
            - --collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)
          securityContext:
            privileged: true
          volumeMounts:
            - name: proc
              mountPath: /host/proc
              readOnly: true
            - name: sys
              mountPath: /host/sys
              readOnly: true

      volumes:
        - name: proc
          hostPath:
            path: /proc
        - name: sys
          hostPath:
            path: /sys
```

#### 示例3：代理 Sidecar

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    spec:
      containers:
        # 主容器：通过 localhost 与 Sidecar 通信
        - name: myapp
          image: myapp:latest
          ports:
            - containerPort: 8080
          env:
            - name: REDIS_HOST
              value: "localhost"  # 通过 localhost 访问 Sidecar

        # Sidecar：本地 Redis 缓存
        - name: redis-proxy
          image: redis:7-alpine
          ports:
            - containerPort: 6379
          command: ["redis-server", "--maxmemory=100mb"]
```

#### 示例4：Git Sync Sidecar

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  template:
    spec:
      containers:
        - name: nginx
          image: nginx:alpine
          volumeMounts:
            - name: html-config
              mountPath: /usr/share/nginx/html

        # Sidecar：同步 Git 仓库中的配置文件
        - name: git-sync
          image: k8s.gcr.io/git-sync:v3.6.4
          args:
            - --repo=https://github.com/org/repo.git
            - --branch=main
            - --root=/git
            - --dest=html
          volumeMounts:
            - name: html-config
              mountPath: /git
          env:
            - name: GIT_SYNC_USERNAME
              valueFrom:
                secretKeyRef:
                  name: git-credentials
                  key: username
            - name: GIT_SYNC_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: git-credentials
                  key: password

      volumes:
        - name: html-config
          emptyDir: {}
```

## Init Container 和 Sidecar 组合使用

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    spec:
      initContainers:
        # Init：等待依赖服务
        - name: wait-for-dependencies
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              echo "Waiting for dependencies..."
              until nslookup mysql; do sleep 3; done
              until nslookup redis; do sleep 3; done
              echo "All dependencies ready!"

      containers:
        # 主容器
        - name: myapp
          image: myapp:latest
          ports:
            - containerPort: 8080
          volumeMounts:
            - name: shared-cache
              mountPath: /app/cache

        # Sidecar：缓存预热
        - name: cache-warmer
          image: myapp:cache-tools
          volumeMounts:
            - name: shared-cache
              mountPath: /app/cache

        # Sidecar：日志收集
        - name: log-shipper
          image: myapp/log-shipping:v1
          volumeMounts:
            - name: shared-cache
              mountPath: /app/cache

      volumes:
        - name: shared-cache
          emptyDir: {}
```

## 调试技巧

```bash
# 查看 Init 容器状态
kubectl get pod <pod-name> -o jsonpath='{.spec.initContainers[*].name}'

# 查看 Init 容器日志
kubectl logs <pod-name> -c <init-container-name>

# 查看 Init 容器详情
kubectl describe pod <pod-name> | grep -A 20 "Init Containers"

# 查看 Sidecar 容器日志
kubectl logs <pod-name> -c <sidecar-container-name>

# 在 Sidecar 中执行命令
kubectl exec -it <pod-name> -c <sidecar-container-name> -- /bin/sh

# 查看所有容器（包含 Sidecar）
kubectl get pod <pod-name> -o jsonpath='{.spec.containers[*].name}'
```

## 面试追问

1. **Init Container 和普通容器的区别是什么？**
2. **什么场景需要 Init Container？举几个实际例子？**
3. **Sidecar 模式有什么优势？和 Init Container 的区别是什么？**
4. **如果 Init Container 失败了，Pod 会怎么样？**
5. **Sidecar 容器是如何与主容器共享网络和存储的？**

> "Init Container 和 Sidecar 是 Kubernetes 多容器编排的两种模式。Init Container 用于『启动前准备』，Sidecar 用于『运行时辅助』。理解它们的特点和使用场景，才能设计出健壮的容器化应用。"
