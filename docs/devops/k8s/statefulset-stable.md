# StatefulSet 稳定网络标识与持久存储

StatefulSet 的核心价值在于它能保持有状态应用的网络标识和存储的稳定性。但这背后是怎么实现的？

## 稳定网络标识的实现

### 命名规则

```bash
# StatefulSet 创建的 Pod 名称格式
# <statefulset-name>-<ordinal>

# 例如：mysql StatefulSet
mysql-0  # 主节点
mysql-1  # 从节点
mysql-2  # 从节点

# Pod 序号从 0 开始，依次递增
```

### Pod Identity

每个 StatefulSet Pod 都有一个唯一的身份标识：

```bash
# 查看 Pod 的 identity annotations
kubectl get pod mysql-0 -o jsonpath='{.metadata.annotations}' | jq .

# 输出：
# {
#   "statefulset.kubernetes.io/pod-name": "mysql-0"
# }
```

### 身份保持机制

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Pod 重建时的身份保持                                │
│                                                                     │
│  Pod mysql-0 正在运行                                               │
│       ↓                                                             │
│  Pod 被删除（或节点故障）                                            │
│       ↓                                                             │
│  StatefulSet 控制器创建新的 mysql-0                                  │
│       ↓                                                             │
│  新 Pod 绑定到原来的 PVC（data-mysql-0）                             │
│       ↓                                                             │
│  新 Pod 获得相同的名称和网络标识                                      │
│       ↓                                                             │
│  应用感知到的「服务器 ID」不变                                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 网络标识保持示例

```yaml
# MySQL 主从配置示例
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
spec:
  serviceName: mysql
  replicas: 3
  template:
    spec:
      initContainers:
        - name: init-mysql
          env:
            - name: POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
          command:
            - bash
            - -c
            - |
              # 根据 Pod 名称设置 server-id
              SERVER_ID=${POD_NAME##mysql-}
              echo "server-id=$((SERVER_ID + 1))" >> /mnt/conf.cnf
```

## Headless Service 的作用

### 为什么需要 Headless Service？

```bash
# 普通 Service
kubectl get service mysql -o yaml
# spec.clusterIP: None  # Headless

# 普通 Service：
# mysql.default.svc.cluster.local → 负载均衡到某个 Pod

# Headless Service：
# mysql-0.mysql.default.svc.cluster.local → 直接解析到 Pod IP
# mysql-1.mysql.default.svc.cluster.local → 直接解析到 Pod IP
```

### DNS 记录

```bash
# 在 Pod 内测试 DNS 解析
kubectl exec -it mysql-0 -- nslookup mysql-0.mysql

# 输出：
# Server:    10.96.0.10
# Address:    10.96.0.10#53

# Name:   mysql-0.mysql.default.svc.cluster.local
# Address: 10.244.1.15

kubectl exec -it mysql-0 -- nslookup mysql-1.mysql

# Name:   mysql-1.mysql.default.svc.cluster.local
# Address: 10.244.2.18
```

### 服务发现机制

```
┌─────────────────────────────────────────────────────────────────────┐
│                      StatefulSet 服务发现                              │
│                                                                     │
│  Headless Service + StatefulSet                                      │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                   CoreDNS                                            │  │
│  │                                                             │  │
│  │  mysql-0.mysql.default.svc.cluster.local → 10.244.1.15      │  │
│  │  mysql-1.mysql.default.svc.cluster.local → 10.244.2.18      │  │
│  │  mysql-2.mysql.default.svc.cluster.local → 10.244.3.20      │  │
│  │                                                             │  │
│  │  mysql.default.svc.cluster.local → A 记录列表               │  │
│  │  → 10.244.1.15, 10.244.2.18, 10.244.3.20                  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## PVC/PV 的生命周期

### PVC 命名规则

```bash
# VolumeClaimTemplate.metadata.name + "-" + StatefulSet.name + "-" + ordinal
# 例如：
# VolumeClaimTemplate: data
# StatefulSet: mysql
# ordinal: 0

# 结果：data-mysql-0
```

### PVC 生命周期

```bash
# 查看所有 PVC
kubectl get pvc

# 输出：
# NAME               STATUS   VOLUME
# data-mysql-0       Bound    pvc-xxxx
# data-mysql-1       Bound    pvc-yyyy
# data-mysql-2       Bound    pvc-zzzz

# 查看 PVC 详情
kubectl describe pvc data-mysql-0
```

### PVC 保留策略

```bash
# StatefulSet 删除时，PVC 默认保留
kubectl delete statefulset mysql

# 查看 PVC（仍然存在）
kubectl get pvc | grep mysql

# 手动删除 PVC
kubectl delete pvc data-mysql-0

# 删除所有 PVC
kubectl delete pvc -l app=mysql
```

### PV 的绑定

```
┌─────────────────────────────────────────────────────────────────────┐
│                      PVC 绑定过程                                       │
│                                                                     │
│  1. StatefulSet 创建 Pod mysql-0                                      │
│       ↓                                                             │
│  2. VolumeClaimTemplate 生成 PVC 申请：data-mysql-0                  │
│       ↓                                                             │
│  3. StorageClass 响应，创建 PV                                        │
│       ↓                                                             │
│  4. PV 绑定到 PVC                                                  │
│       ↓                                                             │
│  5. Pod 挂载 PVC                                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 存储类与动态供给

### StorageClass 配置

```yaml
# 创建 StorageClass
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-storage
provisioner: kubernetes.io/gce-pd  # 根据环境选择
parameters:
  type: pd-ssd
  replication-type: regional-pd
reclaimPolicy: Retain              # Retain / Delete
volumeBindingMode: WaitForFirstConsumer
```

### 延迟绑定

```yaml
# volumeBindingMode: WaitForFirstConsumer
# Pod 调度到节点后才绑定 PV

volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      storageClassName: fast-storage
      volumeBindingMode: WaitForFirstConsumer
      resources:
        requests:
          storage: 50Gi
```

### 立即绑定

```yaml
# volumeBindingMode: Immediate
# StatefulSet 创建时立即绑定 PV

volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      storageClassName: fast-storage
      volumeBindingMode: Immediate
      resources:
        requests:
          storage: 50Gi
```

## 数据持久化实践

### 分离数据和配置

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
spec:
  template:
    spec:
      containers:
        - name: mysql
          volumeMounts:
            # 数据目录
            - name: mysql-data
              mountPath: /var/lib/mysql
            # 配置文件
            - name: mysql-config
              mountPath: /etc/mysql/conf.d
            # 日志目录
            - name: mysql-logs
              mountPath: /var/log/mysql
      volumes:
        - name: mysql-config
          configMap:
            name: mysql-config
        - name: mysql-logs
          emptyDir: {}
  volumeClaimTemplates:
    - metadata:
        name: mysql-data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: ssd-storage
        resources:
          requests:
            storage: 100Gi
```

### 本地存储 vs 网络存储

**本地存储（高性能）**：
```yaml
# 使用 Local PV
apiVersion: v1
kind: PersistentVolume
metadata:
  name: local-pv
spec:
  capacity:
    storage: 100Gi
  storageClassName: local-storage
  persistentVolumeReclaimPolicy: Retain
  local:
    path: /mnt/disks/ssd1
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - node-1
```

**网络存储（高可用）**：
```yaml
# 使用云存储
volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      storageClassName: cloud-storage
      resources:
        requests:
          storage: 100Gi
```

## 数据迁移

### 备份与恢复流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                      数据备份与恢复流程                                │
│                                                                     │
│  备份流程：                                                         │
│  1. Pod 缩容到 0（可选，取决于备份策略）                            │
│       ↓                                                             │
│  2. 快照 PVC                                                       │
│       ↓                                                             │
│  3. 从快照创建新 PVC                                               │
│       ↓                                                             │
│  4. 恢复 Pod 副本数                                                │
│                                                                     │
│  恢复流程：                                                         │
│  1. 创建临时 StatefulSet                                             │
│       ↓                                                             │
│  2. 挂载快照 PVC                                                   │
│       ↓                                                             │
│  3. 恢复数据                                                       │
│       ↓                                                             │
│  4. 切换流量                                                       │
│       ↓                                                             │
│  5. 清理临时资源                                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 备份脚本示例

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: mysql-backup
spec:
  schedule: "0 2 * * *"  # 每天凌晨 2 点
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: mysql:8.0
              command:
                - bash
                - -c
                - |
                  # 备份命令
                  mysqldump -h mysql-0.mysql \
                    -u root -p$MYSQL_ROOT_PASSWORD \
                    --all-databases \
                    | gzip > /backup/backup-$(date +%Y%m%d).sql.gz
              volumeMounts:
                - name: backup
                  mountPath: /backup
          volumes:
            - name: backup
              persistentVolumeClaim:
                claimName: mysql-backup
          restartPolicy: OnFailure
```

## 常见问题排查

### PVC 绑定失败

```bash
# 检查 StorageClass
kubectl get storageclass

# 检查 PVC 事件
kubectl describe pvc data-mysql-0

# 查看 PVC 状态
kubectl get pvc data-mysql-0 -o yaml

# 常见原因：
# - StorageClass 不存在
# - 存储配额不足
# - 节点标签不匹配
```

### 数据不一致

```bash
# 主从复制问题
kubectl exec mysql-1 -- mysql -u root -p -e "SHOW SLAVE STATUS\G"

# 检查复制延迟
kubectl exec mysql-1 -- mysql -u root -p -e \
  "SHOW SLAVE STATUS\G" | grep Seconds_Behind_Master
```

### 存储空间不足

```bash
# 查看 PVC 大小
kubectl get pvc -o jsonpath='{range.items[*]}{.metadata.name}{"\t"}{.status.capacity.storage}{"\n"}{end}'

# 查看实际使用
kubectl exec mysql-0 -- df -h /var/lib/mysql
```

## 面试追问

1. **StatefulSet 的稳定网络标识是怎么实现的？Pod 名称和 DNS 记录有什么关系？**
2. **Headless Service 在 StatefulSet 中扮演什么角色？它和普通 Service 有什么区别？**
3. **删除 StatefulSet 后，PVC 会自动删除吗？数据会丢失吗？**
4. **如何备份 StatefulSet 中的数据？有哪些备份策略？**
5. **StatefulSet 的扩缩容顺序是什么？为什么需要有序扩缩容？**

> "StatefulSet 的稳定网络标识和持久存储是有状态应用的基础。理解 PVC/PV 的生命周期、Headless Service 的作用，以及如何正确备份和恢复数据，是在 K8s 上运行有状态应用的关键。"
