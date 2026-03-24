# StatefulSet：有状态应用管理

StatefulSet 用于管理有状态应用，每个实例都有稳定的网络标识和持久存储。数据库、消息队列、分布式存储……这些应用需要 StatefulSet。

## 为什么需要 StatefulSet？

```
┌─────────────────────────────────────────────────────────────────────┐
│                    StatefulSet vs Deployment                          │
│                                                                     │
│  Deployment（无状态）：                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                             │
│  │ Pod-1  │  │ Pod-2  │  │ Pod-3  │                             │
│  │ nginx  │  │ nginx  │  │ nginx  │                             │
│  │ 随机名称│  │ 随机名称│  │ 随机名称│                             │
│  └─────────┘  └─────────┘  └─────────┘                             │
│  - Pod 名称随机                                                   │
│  - 存储共享或无                                                  │
│  - 可以并行扩缩容                                                │
│  - 副本互换无影响                                                │
│                                                                     │
│  StatefulSet（有状态）：                                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                             │
│  │mysql-0 │  │mysql-1 │  │mysql-2 │                             │
│  │ 稳定名称│  │ 稳定名称│  │ 稳定名称│                             │
│  └────┬────┘  └────┬────┘  └────┬────┘                             │
│       ↓            ↓            ↓                                   │
│   Volume-0     Volume-1     Volume-2                              │
│   独立存储       独立存储       独立存储                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## StatefulSet 的特点

### 稳定的网络标识

```bash
# StatefulSet 创建的 Pod 有固定的序号和名称
kubectl get pods -l app=mysql

# 输出：
# NAME      READY   STATUS    RESTARTS   AGE
# mysql-0   1/1     Running   0          10m
# mysql-1   1/1     Running   0          8m
# mysql-2   1/1     Running   0          6m

# Pod 名称固定，不随机
# 即使 Pod 被重新调度，名称保持不变
```

### 稳定的持久存储

```bash
# 每个 Pod 有独立的 PVC
kubectl get pvc

# 输出：
# NAME               STATUS   VOLUME
# data-mysql-0       Bound    pv-aaa
# data-mysql-1       Bound    pv-bbb
# data-mysql-2       Bound    pv-ccc

# Pod 删除后，PVC 保留
# 新 Pod 仍然绑定到原来的 PVC
```

### 有序部署和扩缩容

```
部署顺序：
┌─────────┐
│mysql-0 │  ← 先创建
└────┬────┘
     ↓
┌─────────┐
│mysql-1 │  ← 等 mysql-0 Running 后创建
└────┬────┘
     ↓
┌─────────┐
│mysql-2 │  ← 等 mysql-1 Running 后创建
└─────────┘

扩缩容顺序同理，从高序号到低序号删除
```

## 基本示例

### MySQL StatefulSet

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: mysql
  labels:
    app: mysql
data:
  master.cnf: |
    [mysqld]
    log-bin=mysql-bin
    server-id=1
  slave.cnf: |
    [mysqld]
    read_only=1
    log-bin=mysql-bin
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
spec:
  serviceName: mysql          # Headless Service 名称
  replicas: 3
  selector:
    matchLabels:
      app: mysql
  template:
    metadata:
      labels:
        app: mysql
    spec:
      initContainers:
        - name: init-mysql
          image: mysql:8.0
          command:
            - bash
            - -c
            - |
              set -ex
              # 检查是否为主节点
              if [[ $HOSTNAME =~ "mysql-0" ]]; then
                echo "I am master"
              else
                echo "I am slave"
              fi
          env:
            - name: HOSTNAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
      containers:
        - name: mysql
          image: mysql:8.0
          ports:
            - name: mysql
              containerPort: 3306
          env:
            - name: MYSQL_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mysql-secret
                  key: password
          volumeMounts:
            - name: data
              mountPath: /var/lib/mysql
            - name: conf
              mountPath: /etc/mysql/conf.d
          resources:
            requests:
              cpu: 500m
              memory: 1Gi
            limits:
              cpu: 1
              memory: 2Gi
  volumeClaimTemplates:          # 自动创建 PVC
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: fast-storage
        resources:
          requests:
            storage: 50Gi
---
apiVersion: v1
kind: Service
metadata:
  name: mysql
  labels:
    app: mysql
spec:
  clusterIP: None            # Headless Service
  selector:
    app: mysql
  ports:
    - name: mysql
      port: 3306
```

### Redis StatefulSet

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis
spec:
  serviceName: redis
  replicas: 3
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          ports:
            - name: redis
              containerPort: 6379
          command:
            - redis-server
            - --requirepass $(REDIS_PASSWORD)
            - --appendonly yes
          env:
            - name: REDIS_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: redis-secret
                  key: password
          volumeMounts:
            - name: data
              mountPath: /data
          resources:
            requests:
              cpu: 200m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            tcpSocket:
              port: 6379
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: standard
        resources:
          requests:
            storage: 10Gi
---
apiVersion: v1
kind: Service
metadata:
  name: redis
spec:
  clusterIP: None
  selector:
    app: redis
  ports:
    - name: redis
      port: 6379
```

## 扩缩容操作

### 扩容

```bash
# 扩容到 5 个副本
kubectl scale statefulset mysql --replicas=5

# StatefulSet 会：
# 1. 等待 mysql-4 Ready
# 2. 创建 mysql-4
# 3. 等待 mysql-4 Ready
# 4. 扩容完成
```

### 缩容

```bash
# 缩容到 2 个副本
kubectl scale statefulset mysql --replicas=2

# StatefulSet 会：
# 1. 从高序号开始删除
# 2. 先删除 mysql-4（等待终止）
# 3. 再删除 mysql-3（等待终止）
# 4. PVC 和 PV 保留（除非手动删除）

# 重要：缩容不会删除 PVC
kubectl get pvc
# data-mysql-3 和 data-mysql-4 仍然存在
```

### 安全缩容注意事项

```bash
# 缩容前检查数据是否已复制
kubectl exec mysql-3 -- mysql -u root -p -e "SHOW SLAVE STATUS\G"

# 如果是主从集群，确保要删除的节点不是主节点
# 降级后再缩容
```

## 持久化存储

### VolumeClaimTemplate 详解

```yaml
volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: fast-storage  # 指定存储类
      resources:
        requests:
          storage: 50Gi
```

### PVC 命名规则

```
命名格式：<volumeClaimTemplate.metadata.name>-<statefulset.name>-<pod序号>

示例：
volumeClaimTemplates[0].metadata.name: data
statefulset.metadata.name: mysql
pod 序号: 0, 1, 2

结果：
- data-mysql-0
- data-mysql-1
- data-mysql-2
```

### 数据持久化行为

```bash
# Pod 删除后
kubectl delete pod mysql-0

# StatefulSet 控制器会：
# 1. 创建一个新的 mysql-0 Pod
# 2. 新 Pod 绑定到原来的 PVC（data-mysql-0）
# 3. 数据不会丢失

# 查看 PVC 状态
kubectl get pvc | grep mysql-0
```

## 服务发现

### Pod DNS 名称

```bash
# 在集群内通过 DNS 访问 Pod
# 格式：<pod-name>.<service-name>.<namespace>.svc.cluster.local

mysql-0.mysql.default.svc.cluster.local
mysql-1.mysql.default.svc.cluster.local
mysql-2.mysql.default.svc.cluster.local
```

### 服务访问

```bash
# 访问所有 MySQL（通过 Service）
mysql.default.svc.cluster.local  # Service 负载均衡

# 访问特定 MySQL（通过 Headless Service）
mysql-0.mysql.default.svc.cluster.local  # 直连主节点
mysql-1.mysql.default.svc.cluster.local  # 直连从节点
```

## 更新策略

### RollingUpdate（默认）

```yaml
spec:
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1  # 最多 1 个 Pod 不可用
```

### OnDelete

```yaml
spec:
  updateStrategy:
    type: OnDelete  # 手动删除 Pod 才触发更新
```

### 更新流程（OnDelete）

```bash
# StatefulSet 不会自动删除 Pod
# 需要手动删除
kubectl delete pod mysql-0

# StatefulSet 控制器收到删除事件后
# 1. 创建新的 mysql-0
# 2. 等待新 Pod Ready
```

## 常见问题

### Pod 一直处于 Pending

```bash
# 原因：PVC 未绑定
kubectl get pvc | grep mysql-0

# 解决：
# 1. 检查 StorageClass 是否存在
kubectl get storageclass

# 2. 检查 PV 是否足够
kubectl get pv
```

### 数据丢失风险

```bash
# 警告：删除 PVC 会丢失数据
kubectl delete pvc data-mysql-0

# 解决方案：
# 1. 定期备份
# 2. 分离存储策略
# 3. 使用云存储（自动备份）
```

### Pod 无法调度

```bash
# 原因：节点资源不足或污点
kubectl describe pod mysql-0 | grep -A 10 "Events"

# 解决：
# 1. 增加节点
# 2. 调整污点容忍
```

## 最佳实践

### 1. 配置合理的存储

```yaml
# 根据数据量配置存储
volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      storageClassName: ssd          # 使用 SSD
      resources:
        requests:
          storage: 100Gi             # 预留足够空间
```

### 2. 配置资源限制

```yaml
# 防止单个 Pod 耗尽资源
resources:
  requests:
    cpu: 500m
    memory: 1Gi
  limits:
    cpu: 1
    memory: 2Gi
```

### 3. 配置健康检查

```yaml
readinessProbe:
  exec:
    command:
      - mysqladmin
      - ping
      - -h
      - localhost
  initialDelaySeconds: 30
  periodSeconds: 10
livenessProbe:
  exec:
    command:
      - mysqladmin
      - ping
      - -h
      - localhost
  initialDelaySeconds: 60
  periodSeconds: 20
```

### 4. 分离配置文件

```yaml
# 使用 ConfigMap 分离配置
spec:
  containers:
    - name: mysql
      volumeMounts:
        - name: conf
          mountPath: /etc/mysql/conf.d
  volumes:
    - name: conf
      configMap:
        name: mysql-config
```

## 面试追问

1. **StatefulSet 和 Deployment 的核心区别是什么？**
2. **StatefulSet 的稳定网络标识是怎么实现的？**
3. **删除 StatefulSet 后，PVC 会删除吗？数据会丢失吗？**
4. **StatefulSet 的扩容顺序是什么？为什么需要有序？**
5. **Headless Service 在 StatefulSet 中扮演什么角色？**

> "StatefulSet 是 Kubernetes 处理有状态应用的核心机制。稳定的网络标识和持久存储是其核心价值。但记住：StatefulSet 只是管理 Pod 的机制，数据备份和恢复仍然需要你自己处理。"
