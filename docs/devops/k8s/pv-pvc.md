# PersistentVolume（PV）与 PersistentVolumeClaim（PVC）

「存储资源的管理，应该由谁来负责？」——这是 K8s 存储模型设计的核心问题。

如果每个应用开发者都要去找运维申请存储、配置权限、了解底层存储细节，那运维就变成了瓶颈。K8s 的 PV/PVC 机制，把存储的管理职责和消费职责分离：运维声明可用的存储资源，应用声明需要的存储——两者自动匹配。

## 核心概念

**PersistentVolume（PV）**：集群级别的存储资源，由管理员创建和配置，代表底层存储系统的一块空间。

**PersistentVolumeClaim（PVC）**：Pod 对存储资源的请求。Pod 通过 PVC 声明「我需要多大的存储，什么样的访问模式」，K8s 自动为其绑定合适的 PV。

```
┌─────────────────────────────────────────────────────────────┐
│                        管理员                               │
│  创建 PersistentVolume（声明存储资源）                      │
│  ├── PV: /mnt/data (NFS)  100Gi   ├── PV: /dev/sdb  500Gi │
└─────────────────────────────────────────────────────────────┘
                              │ 绑定
┌─────────────────────────────────────────────────────────────┐
│                      K8s 控制器                              │
│  监听 PVC 创建 → 找到匹配的 PV → 绑定                        │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                        开发者                               │
│  创建 PersistentVolumeClaim（声明需求）                     │
│  └── Pod 使用 PVC（消费存储）                               │
└─────────────────────────────────────────────────────────────┘
```

## PV 的创建

### 静态供给（Static Provisioning）

管理员手动创建 PV：

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: pv-nfs-100Gi
spec:
  capacity:
    storage: 100Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain  # Retain / Delete / Recycle
  storageClassName: standard-nfs
  nfs:
    server: 192.168.1.100
    path: /data/pv001
```

### 动态供给（Dynamic Provisioning）

管理员配置 StorageClass，由 K8s 自动创建 PV：

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-storage
provisioner: kubernetes.io/gce-pd  # 云盘供给器
parameters:
  type: pd-ssd
  replication-type: regional-pd     # 区域持久化盘（高可用）
reclaimPolicy: Delete              # PVC 删除时自动删除 PV 和云盘
allowVolumeExpansion: true         # 允许扩容
mountOptions:
  - hard
  - nfsvers=4.1
```

用户无需关心 PV 创建，只需要声明 PVC：

```yaml
kind: PersistentVolumeClaim
apiVersion: v1
metadata:
  name: my-database-storage
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 50Gi
  storageClassName: fast-storage
  # 不用写任何底层存储细节
```

## 绑定机制

PVC 到 PV 的绑定规则如下：

1. **accessModes 必须兼容**：PVC 请求的模式必须是 PV 支持的模式的子集
2. **容量必须足够**：PV 的 `capacity.storage` 必须 >= PVC 请求的 `requests.storage`
3. **storageClassName 必须匹配**：两者必须相同（或 PVC 不指定且无默认 StorageClass）
4. **标签选择器匹配**（可选）：PV 可以设置 `selector` 来限制可以被哪些 PVC 绑定

```yaml
# PVC 指定标签选择器
spec:
  selector:
    matchLabels:
      environment: production
      type: fast
```

### 绑定是一对一的

一个 PV 只能被一个 PVC 绑定。已绑定的 PV 不能被其他 PVC 使用。这避免了两个 Pod 同时写入同一存储导致的数据冲突。

## reclaimPolicy：存储回收策略

当 PVC 被删除时，PV 的 `reclaimPolicy` 决定底层存储资源如何处理：

| 策略 | 行为 | 适用场景 |
|------|------|---------|
| Retain | 保留 PV 和数据，供管理员手动处理 | 重要数据，需要备份后清理 |
| Delete | 自动删除 PV 和底层存储资源 | 云盘等按需付费存储 |
| Recycle | 删除数据，PV 变为 Available 状态可被重新绑定 | 已废弃，不推荐使用 |

### Retain 场景下的手动恢复

```bash
# PVC 被删除后，PV 状态变为 Released
kubectl get pv
# NAME         CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS     CLAIM
# pv-nfs-100Gi 100Gi      RWO            Retain          Released   default/myclaim

# 管理员手动处理：
# 1. 备份数据
# 2. 删除 PV
kubectl delete pv/pv-nfs-100Gi

# 3. 或者清空数据后重新标记为 Available
kubectl patch pv/pv-nfs-100Gi -p '{"spec":{"claimRef": null, "status": { "phase": "Available"}}}'
```

## 扩容

支持扩容的 StorageClass（`allowVolumeExpansion: true`）允许在线扩容 PVC，无需重启 Pod：

```bash
# 修改 PVC 大小（直接编辑或 kubectl patch）
kubectl patch pvc myclaim -p '{"spec":{"resources":{"requests":{"storage":"100Gi"}}}}'

# 扩容过程中 PV 状态变为 "Expanding"
# 扩容完成后状态恢复 "Bound"
```

扩容是单向操作（只能增大，不能缩小）。对于不同的存储类型，扩容的实际生效时机不同：
- 云盘（如 GCE PD）：文件系统扩容在 Pod 使用时自动完成
- NFS：NFS 服务器端需要有对应空间

## 常见错误与排查

### PVC 一直处于 Pending

```bash
# 查看 PVC 的 Events
kubectl describe pvc myclaim
# Warning  ProvisioningFailed  ...  "no storage class available"
# → 需要检查 StorageClass 是否存在

# 如果有 StorageClass 但无法供给
# → 检查集群是否有对应的存储 provisioner（控制器）运行
kubectl get pods -n kube-system | grep provisioner
```

### Pod 无法挂载 PVC

```bash
# 查看 Pod 的 Events
kubectl describe pod myapp
# Warning  FailedMount  ... "multi-attach error"
# → 多节点尝试挂载只支持单节点读写的存储（GCE PD / AWS EBS）
```

### 扩容失败

```bash
# PVC 扩容需要 StorageClass 支持
kubectl get storageclass myclass -o yaml
# 检查 allowVolumeExpansion 是否为 true
```

## 面试追问方向

- PV 和 PVC 的绑定过程是什么？K8s 的哪个控制器负责这件事？
- `reclaimPolicy: Retain` 和 `Delete` 怎么选？Retain 之后数据怎么处理？
- 动态供给和静态供给各有什么优缺点？
- 为什么 GCE PD 和 AWS EBS 不支持 ReadWriteMany？怎么解决多节点共享存储的问题？
- PVC 扩容的原理是什么？为什么文件系统层面的扩容是自动的？

> PV/PVC 的设计，是 K8s「声明式 API」理念在存储领域的体现。管理员声明供给能力，开发者声明消费需求，K8s 负责匹配——整个过程无需人工干预。
