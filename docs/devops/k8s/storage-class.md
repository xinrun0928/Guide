# StorageClass 与动态存储供给

「我只想说『给我一个 50Gi 的 SSD』，不想管底层是哪家的存储。」——StorageClass 正是为此而生。

在 PV/PVC 体系中，如果全靠管理员手动创建 PV，那么每次应用申请存储，运维都得忙活一遍。StorageClass 实现了「按需供给」：你声明需求，K8s 自动为你创建 PV。整个过程对应用开发者透明。

## StorageClass 的工作原理

StorageClass 的核心是 **Provisioner**（存储供给器）——一个 K8s 控制器，它监听 PVC 的创建请求，调用底层存储 API 创建真实的存储资源，然后创建 PV 并绑定到 PVC。

```
开发者: "我需要一个 50Gi 的 SSD"
    │
    ▼
PVC: storageClassName: "fast-ssd"
    │
    ▼
StorageClass 控制器（Provisioner）
    │
    ├──► 调用云厂商 API："创建一个 50Gi SSD"
    ├──► 创建 PV 指向新创建的云盘
    └──► 绑定 PV 到 PVC
    │
    ▼
Pod 正常挂载使用
```

## StorageClass 的创建

### 云厂商示例（GCE Persistent Disk）

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: standard
provisioner: kubernetes.io/gce-pd
parameters:
  type: pd-standard    # pd-standard（标准盘）或 pd-ssd（SSD）
  replication-type: ""  # 空字符串：区域持久化盘（多可用区）
                        # regional-pd：单可用区（已废弃）
reclaimPolicy: Delete   # PVC 删除时自动删除云盘
allowVolumeExpansion: true
mountOptions:
  - debug
```

### NFS 示例

NFS 本身不支持动态供给，需要配合 `nfs-subdir-external-provisioner`：

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: nfs-storage
provisioner: k8s.sigs.k8s.io/nfs-subdir-external-provisioner
parameters:
  archiveOnDelete: "false"   # 删除时不保留数据
  onDelete: "delete"
  pathPattern: "volumes/${namespace}/${pvcName}"  # 自动创建子目录
  basePath: "/data/k8s-pv"    # NFS 服务器基础路径
  reclaimPolicy: Delete
```

### Local Volume（本地持久化存储）

用于有低延迟要求的有状态工作负载：

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-storage
provisioner: kubernetes.io/no-provisioner   # 需要手动管理
volumeBindingMode: WaitForFirstConsumer      # 延迟绑定，等 Pod 调度后再绑定 PV
# WaitForFirstConsumer：确保 PV 和 Pod 在同一节点
```

配合 Local Persistent Volume 的静态供给：

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: local-pv-1
spec:
  capacity:
    storage: 100Gi
  volumeMode: Filesystem
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Delete
  storageClassName: local-storage
  local:
    path: /mnt/disks/ssd-1
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - node-1
```

## 关键参数解析

### provisioner

指定存储供给器，决定了谁来创建底层存储资源：

| provisioner | 存储类型 |
|------------|---------|
| `kubernetes.io/gce-pd` | GCE Persistent Disk |
| `kubernetes.io/aws-ebs` | AWS Elastic Block Store |
| `kubernetes.io/azure-disk` | Azure Disk |
| `kubernetes.io/nfs` | NFS（需 nfs-subdir-external-provisioner） |
| `kubernetes.io/no-provisioner` | 本地存储（静态供给） |
| `csi.io/cinder` | OpenStack Cinder |
| `ebs.csi.aws.com` | AWS EBS CSI Driver（新） |
| `pd.csi.storage.gke.io` | GCE PD CSI Driver（新） |

### volumeBindingMode

控制 PV 何时绑定到 PVC：

| 模式 | 行为 | 适用场景 |
|------|------|---------|
| Immediate（默认） | PVC 创建时立即绑定 PV | 无节点亲和性要求的存储 |
| WaitForFirstConsumer | Pod 调度到节点后再绑定 PV | 本地存储、需要拓扑感知的存储 |

`WaitForFirstConsumer` 是本地存储的关键：它确保 PV 所在的节点和 Pod 调度的节点是同一个，避免了「存储在 node-1，但 Pod 调度到 node-2」的情况。

### allowVolumeExpansion

设为 `true` 时，允许通过修改 PVC 的 `storage` 字段来在线扩容。

## 默认 StorageClass

如果没有显式指定 `storageClassName`，K8s 会使用标注了 `storageclass.kubernetes.io/is-default-class: "true"` 的 StorageClass 作为默认值：

```bash
# 将某个 StorageClass 设为默认
kubectl patch storageclass standard -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
```

## CSI：容器存储接口

现代 K8s 存储供给推荐使用 **CSI（Container Storage Interface）**，它是 K8s 与存储厂商之间的标准接口。相比内置的 in-tree provisioner，CSI 有以下优势：

- **插件独立部署**：存储厂商不再需要把代码提交到 K8s 核心仓库
- **版本独立**：CSI driver 可以独立于 K8s 版本升级
- **能力更丰富**：支持快照、克隆、扩容等高级功能

```yaml
# CSI 驱动的 StorageClass 示例（AWS EBS CSI）
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ebs-sc
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  csi.storage.k8s.io/fstype: xfs
  encrypter: "false"
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
```

## 选择 StorageClass 的策略

```bash
# 查看集群中可用的 StorageClass
kubectl get storageclass
# NAME            PROVISIONER              RECLAIMPOLICY   VOLUMEBINDINGMODE
# standard        kubernetes.io/gce-pd     Delete          Immediate
# fast-ssd        pd.csi.storage.gke.io    Delete          WaitForFirstConsumer
# nfs-storage     k8s.sigs.k8s.io/nfs-...  Delete          Immediate
# local-storage   kubernetes.io/no-pro...   Delete          WaitForFirstConsumer
```

| 场景 | 推荐 StorageClass |
|------|------------------|
| 数据库（高 IOPS） | 云盘 SSD（gp3/pd-ssd） |
| 日志收集 / 临时存储 | emptyDir 或本地 HDD |
| 多 Pod 共享文件 | NFS / CephFS |
| 低延迟高性能 | 本地 SSD（local-storage） |
| 跨可用区高可用 | 区域持久化盘（regional-pd） |

## 面试追问方向

- 为什么 NFS 需要单独的 provisioner？内置的 NFS provisioner 有什么问题？
- `volumeBindingMode: WaitForFirstConsumer` 解决了什么问题？为什么本地存储必须用它？
- CSI 和 in-tree provisioner 的区别是什么？迁移到 CSI 有什么注意事项？
- 动态供给的 PV 回收策略设为 Delete 时，误删 PVC 会造成什么后果？怎么预防？
- StorageClass 的 `parameters` 是 provisioner-specific 的，这意味着什么？

> StorageClass 把存储的「供给」封装成了 K8s 的声明式 API。理解它的关键，在于理解 Provisioner 的角色——它就是 K8s 和真实存储世界之间的翻译官。
