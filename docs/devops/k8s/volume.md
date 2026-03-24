# Volume 类型：emptyDir、hostPath、nfs、persistentVolumeClaim

「Pod 里的数据存在哪？」——这是有状态应用在 K8s 里遇到的首要问题。

容器的文件系统是临时存在的：容器重启，数据就没了。K8s 提供了多种 Volume 类型来解决数据持久化问题，从临时存储到网络存储，从本地磁盘到分布式文件系统，各有各的适用场景。

## Volume 的生命周期

K8s Volume 和 Docker Volume 有一个本质区别：**K8s Volume 的生命周期和 Pod 绑定，而不是容器。**

- Pod 删除 → Volume 随之删除
- 容器重启 → Volume 数据保留
- 同一个 Pod 的多个容器共享同一个 Volume

但这不代表数据一定持久化——取决于 Volume 的类型。

## emptyDir：临时共享存储

`emptyDir` 是最简单的一种 Volume 类型。它在 Pod 调度到节点时创建一个空目录，Pod 删除时目录也被删除。顾名思义，它用于临时存储。

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: producer-consumer
spec:
  containers:
    - name: producer
      image: busybox
      command: ["sh", "-c", "echo data > /tmp/data && sleep 3600"]
      volumeMounts:
        - name: shared-data
          mountPath: /tmp
    - name: consumer
      image: busybox
      command: ["sh", "-c", "sleep 3600"]
      volumeMounts:
        - name: shared-data
          mountPath: /data
  volumes:
    - name: shared-data
      emptyDir:
        sizeLimit: 100Mi
        medium: Memory  # 存储到内存（tmpfs），高性能但断电丢失
```

### 适用场景

- 同一 Pod 内多容器之间的数据共享
- 临时缓存（空间限制可设 `sizeLimit`）
- 从崩溃中恢复时的临时存储

### 不适合的场景

- 跨 Pod 共享数据
- 数据需要持久保留
- 高性能写入（emptyDir 在磁盘上时性能取决于节点存储）

## hostPath：节点级别的持久存储

`hostPath` 将节点文件系统上的文件或目录挂载到 Pod 中。Pod 删除后，hostPath 的数据仍然保留在节点上。

```yaml
volumes:
  - name: host-data
    hostPath:
      path: /data/logs
      type: DirectoryOrCreate  # 目录不存在则创建
```

`type` 的选项：

| type | 说明 |
|------|------|
| `Directory` | 目录必须存在 |
| `DirectoryOrCreate` | 目录不存在则创建 |
| `File` | 文件必须存在 |
| `FileOrCreate` | 文件不存在则创建 |
| `Socket` | Unix Socket 文件 |
| `CharDevice` | 字符设备 |
| `BlockDevice` | 块设备 |

### 适用场景

- 系统级日志（如 kubelet、Docker 日志）
- 节点级别的监控 Agent 收集数据
- 必须在特定节点上运行的 Pod（配合 NodeSelector）

### 坑

`hostPath` 的问题是：**数据不和 Pod 绑定，而是和节点绑定。**

- Pod 调度到新节点后，数据就丢了
- 不同节点的 hostPath 内容不一样，数据不一致
- 不推荐用于有状态应用的数据存储

## nfs：网络文件系统

`nfs` Volume 将已有的 NFS（Network File System）共享挂载到 Pod 中。Pod 删除后，NFS 上的数据仍然保留。

```yaml
volumes:
  - name: nfs-storage
    nfs:
      server: 192.168.1.100
      path: /shared/data
      readOnly: false
```

### 适用场景

- 跨 Pod 共享数据
- 数据需要持久保留
- 多个应用实例读写同一份数据

### 特点

- 数据独立于 Pod 生命周期
- 支持读写并发（取决于 NFS 服务器配置）
- 性能依赖网络质量

## persistentVolumeClaim：声明式持久存储

`persistentVolumeClaim`（PVC）是 K8s 存储抽象的核心。它让 Pod 不需要关心存储的具体实现，只需声明「我需要多少存储」，K8s 自动绑定到合适的 `PersistentVolume`。

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: myclaim
spec:
  accessModes:
    - ReadWriteOnce        # 只允许单节点挂载为读写
    # - ReadOnlyMany       # 多节点只读
    # - ReadWriteMany      # 多节点读写（GCE PD 不支持，NFS/ CephFS 支持）
  resources:
    requests:
      storage: 10Gi
  storageClassName: standard
  selector:
    matchLabels:
      type: fast           # 可选：绑定到特定 PV
```

Pod 使用 PVC：

```yaml
spec:
  containers:
    - name: app
      image: nginx
      volumeMounts:
        - name: data
          mountPath: /var/www/html
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: myclaim
```

### accessModes 三种模式

| 模式 | 说明 | GCE PD | NFS | CephFS |
|------|------|--------|-----|--------|
| ReadWriteOnce | 单节点读写 | ✓ | ✓ | ✓ |
| ReadOnlyMany | 多节点只读 | ✗ | ✓ | ✓ |
| ReadWriteMany | 多节点读写 | ✗ | ✓ | ✓ |

### 生命周期

PVC 的绑定过程遵循以下状态机：

```
Pending → Bound → Released → Failed/Recycled → Available
```

- **Pending**：正在等待绑定到合适的 PV
- **Bound**：已绑定到 PV
- **Released**：PV 已释放，但数据可能还在（需要手动清理或自动回收）
- **Failed**：自动回收失败

## Volume 类型对比

| 类型 | 持久化 | 跨 Pod 共享 | 跨节点 | 性能 | 典型用途 |
|------|--------|------------|--------|------|---------|
| emptyDir | 否（Pod 生命周期） | 同 Pod 多容器 | 否 | 中（磁盘）/ 高（内存） | 临时共享、缓存 |
| hostPath | 是（节点生命周期） | 否 | 否 | 高 | 节点级别日志、系统文件 |
| nfs | 是 | 是 | 是 | 中（依赖网络） | 共享文件存储 |
| gcePersistentDisk | 是 | 否 | 否 | 高 | 单节点数据库 |
| awsElasticBlockStore | 是 | 否 | 否 | 高 | 单节点数据库 |
| cephfs | 是 | 是 | 是 | 中 | 分布式共享存储 |
| configMap / secret | 是（配置变更时更新） | 是 | 是 | 高 | 应用配置 |

## 选择建议

```
需要持久化存储？
    │
    ├── 否 ──► emptyDir（临时数据）
    │
    └── 是 ──► 需要跨 Pod 共享？
                  │
                  ├── 否 ──► hostPath（单 Pod，但要接受调度限制）
                  │
                  └── 是 ──► PV/PVC + 网络存储（NFS/CephFS/云盘）
```

> Volume 的选择，本质上是在回答一个问题：你的数据应该和 Pod 的生命周期绑定，还是独立于 Pod 而存在？
