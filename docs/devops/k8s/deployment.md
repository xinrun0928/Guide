# Deployment：滚动更新、回滚、金丝雀发布

Deployment 是 Kubernetes 最常用的工作负载资源，用于管理无状态应用。它的核心能力是滚动更新和回滚，让应用部署变得安全可控。

## Deployment 基础

### 基本概念

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Deployment 层级关系                              │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                      Deployment                                 │  │
│  │  管理 ReplicaSet 的版本                                    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                      ReplicaSet                              │  │
│  │  管理 Pod 的副本数                                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                      Pod                                      │  │
│  │  Kubernetes 的最小调度单元                                    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 最小示例

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.21-alpine
```

```bash
# 创建 Deployment
kubectl apply -f nginx-deployment.yaml

# 查看 Deployment
kubectl get deployment
kubectl get deployment -o wide

# 查看 ReplicaSet（自动创建）
kubectl get rs

# 查看 Pod
kubectl get pods -l app=nginx
```

## 滚动更新策略

### 默认策略

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%        # 最多超出期望副本数
      maxUnavailable: 25%  # 最少可用副本数
```

### 参数详解

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `maxSurge` | 最多超出期望副本数 | 25% |
| `maxUnavailable` | 最少可用副本数 | 25% |

### 更新策略示例

**保守策略**（适合生产环境）：
```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1           # 最多多 1 个 Pod
      maxUnavailable: 0       # 不能少任何 Pod
```

**激进策略**（适合开发环境）：
```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 50%         # 最多多 50% Pod
      maxUnavailable: 50%     # 最多少 50% Pod
```

### 替换更新策略

```yaml
spec:
  strategy:
    type: Recreate  # 先删除旧的，再创建新的
```

## 镜像更新

### 命令行更新

```bash
# 更新镜像版本
kubectl set image deployment/nginx-deployment nginx=nginx:1.22-alpine

# 查看更新状态
kubectl rollout status deployment/nginx-deployment

# 查看当前版本
kubectl get deployment nginx-deployment -o jsonpath='{.spec.template.spec.containers[0].image}'
```

### 编辑配置更新

```bash
kubectl edit deployment nginx-deployment
# 修改 image: nginx:1.22-alpine
```

### 暂停和恢复滚动

```bash
# 暂停滚动更新
kubectl rollout pause deployment/nginx-deployment

# 多次更新
kubectl set image deployment/nginx-deployment nginx=nginx:1.22-alpine
kubectl set image deployment/nginx-deployment nginx=nginx:1.23-alpine

# 恢复滚动更新
kubectl rollout resume deployment/nginx-deployment
```

## 回滚操作

### 回滚到上一版本

```bash
# 查看历史
kubectl rollout history deployment/nginx-deployment

# 输出：
# deployment.apps/nginx-deployment
# REVISION  CHANGE-CAUSE
# 1        kubectl apply --filename=nginx-deployment.yaml
# 2        kubectl set image nginx=nginx:1.21-alpine
# 3        kubectl set image nginx=nginx:1.22-alpine

# 回滚到上一版本
kubectl rollout undo deployment/nginx-deployment
```

### 回滚到指定版本

```bash
# 查看版本详情
kubectl rollout history deployment/nginx-deployment --revision=2

# 回滚到指定版本
kubectl rollout undo deployment/nginx-deployment --to-revision=2
```

### 回滚过程

```
┌─────────────────────────────────────────────────────────────────────┐
│                         回滚过程                                       │
│                                                                     │
│  当前版本：v3                                                       │
│       ↓                                                             │
│  执行 kubectl rollout undo                                          │
│       ↓                                                             │
│  Deployment 切换到 ReplicaSet v2                                    │
│       ↓                                                             │
│  v3 的 ReplicaSet 缩容到 0                                        │
│       ↓                                                             │
│  v2 的 ReplicaSet 扩容到期望副本数                                  │
│       ↓                                                             │
│  回滚完成                                                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 金丝雀发布

### 什么是金丝雀发布？

```
┌─────────────────────────────────────────────────────────────────────┐
│                       金丝雀发布策略                                  │
│                                                                     │
│  金丝雀发布 = 逐步将流量切换到新版本                                  │
│                                                                     │
│  阶段 1：10% 流量到新版本                                           │
│  ┌───────────┐  ┌───────────┐                                        │
│  │  v1 (90%) │  │  v2 (10%) │  ← 金丝雀版本                      │
│  └───────────┘  └───────────┘                                        │
│                                                                     │
│  阶段 2：100% 流量到新版本                                           │
│  ┌───────────┐                                                     │
│  │  v2 (100%) │                                                    │
│  └───────────┘                                                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 方法一：调整副本数（金丝雀）

```bash
# 初始状态：v1 版本 10 个副本
kubectl scale deployment nginx-deployment --replicas=10

# 部署金丝雀版本：v2 版本 1 个副本
kubectl set image deployment/nginx-deployment nginx=nginx:1.22-alpine
kubectl scale deployment nginx-deployment --replicas=1 --record

# 验证金丝雀
# 通过 Service 的 selector，90% 流量到 v1，10% 到 v2

# 确认无误后，完整更新
kubectl set image deployment/nginx-deployment nginx=nginx:1.22-alpine
kubectl scale deployment nginx-deployment --replicas=10
```

### 方法二：Service 选择器（金丝雀）

```yaml
# 创建金丝雀 Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-canary
spec:
  replicas: 1
  selector:
    matchLabels:
      app: nginx
      track: canary        # 金丝雀标记
  template:
    metadata:
      labels:
        app: nginx
        track: canary
    spec:
      containers:
        - name: nginx
          image: nginx:1.22-alpine  # 新版本
```

```yaml
# Service 选择所有 nginx Pod
apiVersion: v1
kind: Service
metadata:
  name: nginx-service
spec:
  selector:
    app: nginx           # 匹配 v1 和 v2
  ports:
    - port: 80
```

```bash
# 流量分配：90% v1，10% v2
kubectl get pods -l app=nginx

# 提升金丝雀
kubectl scale deployment nginx-deployment --replicas=9
kubectl scale deployment nginx-canary --replicas=2

# 完全切换
kubectl delete deployment nginx-deployment
kubectl delete deployment nginx-canary
```

### 方法三：基于权重的金丝雀（使用 Ingress 或 Service Mesh）

```yaml
# Nginx Ingress 配置
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: nginx-ingress
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "10"
spec:
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: nginx-canary
                port:
                  number: 80
```

## Deployment 扩缩容

### 命令行扩缩容

```bash
# 扩容到 10 个副本
kubectl scale deployment nginx-deployment --replicas=10

# 缩容到 3 个副本
kubectl scale deployment nginx-deployment --replicas=3

# 查看当前副本数
kubectl get deployment nginx-deployment
```

### HPA 自动扩缩容

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: nginx-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-deployment
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

```bash
# 查看 HPA 状态
kubectl get hpa

# 输出：
# NAME         REFERENCE                  TARGETS    MINPODS   MAXPODS   REPLICAS
# nginx-hpa    Deployment/nginx-deployment  45%/70%   3         10        6
```

## 完整示例

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-deployment
  labels:
    app: myapp
    version: v1
spec:
  replicas: 3
  revisionHistoryLimit: 10        # 保留历史版本数
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
        version: v1
    spec:
      containers:
        - name: myapp
          image: myapp:1.0.0
          ports:
            - name: http
              containerPort: 8080
              protocol: TCP
          env:
            - name: APP_ENV
              value: "production"
            - name: LOG_LEVEL
              value: "info"
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /ready
              port: http
            initialDelaySeconds: 10
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /health
              port: http
            initialDelaySeconds: 30
            periodSeconds: 10
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 10"]
      terminationGracePeriodSeconds: 60
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchLabels:
                  app: myapp
              topologyKey: kubernetes.io/hostname
```

## 常见问题

### 更新卡住

```bash
# 查看原因
kubectl describe deployment nginx-deployment

# 排查步骤
kubectl get pods -l app=nginx
kubectl logs <pod-name>
kubectl describe pod <pod-name>

# 如果需要，强制回滚
kubectl rollout undo deployment/nginx-deployment
```

### 镜像拉取失败

```yaml
# 配置镜像拉取策略
spec:
  template:
    spec:
      imagePullSecrets:
        - name: my-registry-secret
      containers:
        - name: nginx
          image: my-registry.com/nginx:1.21
          imagePullPolicy: Always  # Always/IfNotPresent/Never
```

## 面试追问

1. **Deployment 的滚动更新是怎么工作的？maxSurge 和 maxUnavailable 怎么设置？**
2. **Deployment 更新过程中，如何保证服务不中断？**
3. **金丝雀发布和滚动更新有什么区别？各自适合什么场景？**
4. **回滚操作会撤销配置变更吗？回滚的是哪些内容？**
5. **HPA 和 Deployment 副本数同时存在时会发生什么？**

> "Deployment 的核心价值是让应用变更变得可预测、可控制。滚动更新保证服务不中断，回滚保证出问题可快速恢复。理解这些机制，才能在生产环境中安全地发布应用。"
