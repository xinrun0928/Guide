# KubeSphere 存储管理：存储类型与持久卷

「数据怎么持久化？」——KubeSphere 让存储配置变得简单。

KubeSphere 的存储管理基于 K8s 的 PV/PVC/StorageClass 机制，提供了图形化的存储类型配置和持久卷管理。

## 存储架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    KubeSphere 存储架构                             │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    StorageClass（存储类）                    │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │              CSI Driver（容器存储接口）                │   │   │
│  │  │                                                      │   │   │
│  │  │  ┌────────────┐ ┌────────────┐ ┌────────────┐  │   │   │
│  │  │  │ Ceph CSI   │ │ NFS CSI   │ │ Cloud CSI  │  │   │   │
│  │  │  │            │ │           │ │            │  │   │   │
│  │  │  │ Ceph-RBD  │ │ NFS      │ │ AWS EBS   │  │   │   │
│  │  │  │ Ceph-FS   │ │           │ │ 阿里云 ESSD │  │   │   │
│  │  │  └────────────┘ └────────────┘ └────────────┘  │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                │                                      │
│  ┌─────────────────────────────┴──────────────────────────────┐   │
│  │                    PersistentVolume（持久卷）                  │   │
│  │                                                          │   │
│  │  静态 PV：手动创建，预先分配                               │   │
│  │  动态 PV：由 StorageClass 按需自动创建                     │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │              PersistentVolumeClaim（持久卷声明）      │   │   │
│  │  │                                                      │   │   │
│  │  │  PVC 是 Pod 使用存储的请求                          │   │   │
│  │  │  PVC → StorageClass → PV → 实际存储后端            │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 存储类型

### StorageClass 配置

```yaml
# NFS 存储类（最通用，适合测试环境）
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: nfs-client
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: nfs-client-provisioner
parameters:
  archiveOnDelete: "false"    # 删除 PVC 时是否归档数据
  pathPattern: "${.PVC.namespace}/${.PVC.name}"
  storageClass: nfs-client
reclaimPolicy: Retain          # Retain（保留）/ Delete（删除）

---
# Ceph RBD 存储类（生产环境推荐）
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ceph-rbd
provisioner: rbd.csi.ceph.com
parameters:
  clusterID: ceph-cluster
  poolName: kube-rbd-pool
  csiStoragePoolName: ceph-rbd-pool
  csiProvisionerSecretName: csi-rbd-secret
  csiProvisionerSecretNamespace: ceph-system
  csiNodeStageSecretName: csi-rbd-node-secret
  csiNodeStageSecretNamespace: ceph-system
reclaimPolicy: Retain
allowVolumeExpansion: true
mountOptions:
  - discard
```

### 常用存储类型对比

```
┌─────────────────────────────────────────────────────────────────┐
│                    存储类型对比                                    │
│                                                                  │
│  Local PV                                                        │
│  ├── 优点：性能高（无网络开销）、简单                             │
│  ├── 缺点：不能跨节点漂移、数据绑定节点                          │
│  ├── 适用：数据库（PostgreSQL、MySQL）、有状态服务              │
│  └── 要求：使用 LocalPV Operator 或 static provisioner             │
│                                                                  │
│  NFS / CIFS                                                     │
│  ├── 优点：跨节点共享、简单易用                                 │
│  ├── 缺点：网络开销、性能不如本地存储                           │
│  ├── 适用：共享文件存储、日志存储、开发测试环境                   │
│  └── 要求：NFS 服务器                                            │
│                                                                  │
│  Ceph RBD / CSI                                                 │
│  ├── 优点：高可用、跨节点漂移、性能好                           │
│  ├── 缺点：部署复杂、需要 Ceph 集群                             │
│  ├── 适用：生产环境的块存储                                    │
│  └── 要求：Ceph 集群                                             │
│                                                                  │
│  云厂商块存储                                                   │
│  ├── 优点：托管服务、免运维、自动扩容                           │
│  ├── 缺点：绑定云厂商、有云厂商特定配置                        │
│  ├── 适用：生产环境                                              │
│  └── 要求：AWS EBS / 阿里云 ESSD / Azure Disk                  │
└─────────────────────────────────────────────────────────────────┘
```

## 持久卷使用

### PVC 配置

```yaml
# KubeSphere 图形化挂载会生成以下 YAML
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: myapp-data
  namespace: my-project
spec:
  accessModes:
    - ReadWriteOnce   # RWO：单节点读写
    # - ReadOnlyMany  # ROX：多节点只读
    # - ReadWriteMany # RWX：多节点读写（NFS/CephFS）
  resources:
    requests:
      storage: 10Gi
  storageClassName: nfs-client
  # 可选：指定 PVC 大小（不支持 shrink，仅支持 expand）
  selector:
    matchLabels:
      type: ssd

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  namespace: my-project
spec:
  replicas: 1
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
          image: myapp:v1.0.0
          volumeMounts:
            - name: app-data
              mountPath: /data
      volumes:
        - name: app-data
          persistentVolumeClaim:
            claimName: myapp-data
```

### 多 PVC 配置

```yaml
# 多个存储卷挂载
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
  namespace: my-project
spec:
  serviceName: mysql
  replicas: 3
  selector:
    matchLabels:
      app: mysql
  template:
    metadata:
      labels:
        app: mysql
    spec:
      containers:
        - name: mysql
          image: mysql:8.0
          env:
            - name: MYSQL_ROOT_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: mysql-secret
                  key: root-password
          ports:
            - containerPort: 3306
              name: mysql
          volumeMounts:
            - name: data
              mountPath: /var/lib/mysql
            - name: config
              mountPath: /etc/mysql/conf.d
      volumes:
        - name: config
          configMap:
            name: mysql-config
  volumeClaimTemplates:
    # 数据存储
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: ceph-rbd
        resources:
          requests:
            storage: 100Gi
```

## 存储扩容

### 在线扩容

```bash
# K8s 1.24+ 支持 PVC 在线扩容
# 前提：StorageClass 必须设置 allowVolumeExpansion: true

# 修改 PVC 大小（编辑 YAML 或 kubectl patch）
kubectl patch pvc myapp-data -n my-project -p '{"spec":{"resources":{"requests":{"storage":"20Gi"}}}}'

# 查看扩容进度
kubectl get pvc myapp-data -n my-project
# STATUS 会从 Resizing 变为 Bound

# 文件系统扩容
# XFS 文件系统支持在线扩容（自动）
# ext4 文件系统需要 remount
```

## 本地存储

```yaml
# Local PV + LocalPV Operator（生产推荐）
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-storage
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer   # 等待 Pod 调度后再绑定
reclaimPolicy: Delete

---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: local-pv-ssd
spec:
  capacity:
    storage: 500Gi
  volumeMode: Filesystem
  accessModes:
    - ReadWriteOnce
  storageClassName: local-storage
  local:
    path: /mnt/ssd
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: disktype
              operator: In
              values:
                - ssd
  persistentVolumeReclaimPolicy: Retain
```

## 面试追问方向

1. **ReadWriteOnce、ReadOnlyMany、ReadWriteMany 有什么区别？**
   答：RWO 是最常用的模式，表示单个节点可读写（但 Pod 可以在多个节点上使用同一 PV，只要一次只挂载到一个节点）。ROX 表示多节点只读。RWX 表示多节点同时读写（只有 NFS、CephFS 等支持）。实际中 90% 的场景用 RWO，共享存储才需要 RWX。

2. **存储的 reclaimPolicy（Retain vs Delete）应该怎么选？**
   答：生产环境强烈建议用 Retain（保留）。Delete 模式下，删除 PVC 时 PV 和数据都会被删除——误删 PVC = 永久丢数据。Retain 模式下，删除 PVC 后 PV 进入 Released 状态，数据保留，手动清理。重要数据必须用 Retain + 定期备份。

3. **StorageClass 的 `volumeBindingMode` 是什么？**
   答：`Immediate` 表示创建 PVC 时立即绑定 PV（可能导致 PV 在 Pod 调度的节点上不可用）。`WaitForFirstConsumer` 表示等第一个使用该 PVC 的 Pod 调度后再绑定 PV，确保 PV 和 Pod 在同一节点（对 LocalPV 尤其重要）。

> "存储是 K8s 有状态应用的基础。选择合适的存储类型，配置好 reclaimPolicy，做好数据备份——数据丢失的代价永远比你想象的大。"
