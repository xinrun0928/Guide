# Docker 存储驱动：overlay2、devicemapper、btrfs、zfs

Docker 镜像由多个只读层组成，容器运行时在镜像层之上创建一个可写层。但这些层是怎么存储在磁盘上的？不同存储驱动有什么优缺点？

这就是 Docker 存储驱动要解决的问题。

## 存储驱动概述

Docker 使用存储驱动（Storage Driver）来管理镜像层和容器可写层的存储。

```
┌─────────────────────────────────────────────────────┐
│                  容器可写层（Container Layer）         │
│              写入时复制（Copy-on-Write）              │
├─────────────────────────────────────────────────────┤
│                   镜像层（Image Layers）              │
│                  多个只读层叠加                        │
└─────────────────────────────────────────────────────┘
                          ↓
              ┌─────────────────────────────┐
              │       存储驱动层            │
              │  overlay2 / devicemapper    │
              │  btrfs / zfs / fuse-overlayfs │
              └─────────────────────────────┘
                          ↓
              ┌─────────────────────────────┐
              │        宿主机文件系统         │
              │   ext4 / xfs / btrfs / zfs  │
              └─────────────────────────────┘
```

## 查看当前存储驱动

```bash
# 查看当前使用的存储驱动
docker info | grep "Storage Driver"

# 输出：
# Storage Driver: overlay2

# 查看 Docker 数据目录
docker info | grep "Docker Root Dir"

# 输出：
# Docker Root Dir: /var/lib/docker
```

## overlay2（推荐）

overlay2 是目前 Docker 推荐默认使用的存储驱动，适用于大多数场景。

### 工作原理

overlay2 通过将两个目录「叠加」来呈现统一的文件系统视图：
- **lower 目录**：下层目录（镜像层，只读）
- **upper 目录**：上层目录（容器层，可写）
- **merged 目录**：合并视图（容器看到的文件系统）

```
/var/lib/docker/overlay2/
├── l/                          # 层数据目录（短链接）
│   ├── UPLOWERCASE/           # 层标识
│   └── ...
├── <container-id>/            # 容器层
│   ├── lower                  # 指向下层
│   ├── upper                  # 可写层
│   ├── work                   # overlay 工作目录
│   └── merged                 # 合并视图
└── <image-layer-id>/          # 镜像层
    ├── link                   # 层链接
    ├── lower                  # 下层引用
    └── diff/                  # 层内容
```

### 读取文件

当容器读取文件时，overlay2 从上往下查找：

```
容器读 /etc/nginx/nginx.conf：

1. 先看 merged/nginx.conf → 有 → 返回
2. 依次检查 upper/、lower1/、lower2/...
3. 找到就返回，找不到返回 ENOENT
```

### 写入文件

当容器写入文件时，overlay2 会复制文件到 upper 层：

```
容器写 /etc/nginx/nginx.conf：

1. 在 lower 层找到 /etc/nginx/nginx.conf
2. 复制到 upper 层（Copy-up）
3. 在 upper 层修改文件
4. 后续对 /etc/nginx/nginx.conf 的读写都在 upper 层进行
```

### 删除文件

当容器删除文件时：

```
容器删除 /etc/nginx/nginx.conf：

1. 在 upper 层创建 whiteout 文件： .wh.nginx.conf
2. lower 层的原始文件仍然存在
3. 读取时发现 whiteout → 认为文件不存在
```

### 优点

- 性能优秀（大多数场景优于其他驱动）
- 广泛兼容（主流 Linux 内核 4.0+）
- 磁盘空间利用率高（层共享）
- Docker 默认推荐

### 缺点

- 需要底层文件系统支持 `copy_up` 操作
- 在某些极端场景下可能有文件权限问题

## devicemapper

devicemapper 使用逻辑卷管理，创建存储池后通过快照机制实现层共享。

### 工作原理

```
┌─────────────────────────────────────────────┐
│            devicemapper 存储池               │
│                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │  base   │  │  base   │  │  base   │    │  ← 镜像层（只读快照）
│  │  pool   │  │  pool   │  │  pool   │    │
│  └────┬────┘  └────┬────┘  └────┬────┘    │
│       │            │            │           │
│  ┌────┴────────────┴────────────┴────┐    │
│  │         thin pool (精简池)         │    │  ← 容器层（写时快照）
│  └───────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

### 配置

```bash
# 编辑 Docker 配置
sudo vim /etc/docker/daemon.json

{
  "storage-driver": "devicemapper",
  "storage-opts": [
    "dm.basesize=20G",
    "dm.loopdatasize=200G",
    "dm.loopmetadatasize=6G"
  ]
}

# 重启 Docker
sudo systemctl restart docker
```

### 优点

- 支持块级操作（适合某些数据库场景）
- 成熟稳定
- 曾是 RHEL/CentOS 默认驱动

### 缺点

- 配置复杂
- 性能不如 overlay2
- 需要预留磁盘空间
- 在某些场景下可能出现存储泄漏

## btrfs

btrfs 使用原生文件系统快照功能管理镜像层。

### 工作原理

```
btrfs volume
├── subvolumes/
│   ├── image-layer-1/        # 镜像层（快照）
│   ├── image-layer-2/
│   └── container-xxx/         # 容器层
└── snapshots/
```

每个镜像层和容器层都是 btrfs 的 subvolume，通过快照机制实现层共享。

### 配置

```bash
# 创建 btrfs 文件系统
sudo mkfs.btrfs /dev/sda1
sudo mount /dev/sda1 /var/lib/docker

# 配置 Docker 使用 btrfs
sudo vim /etc/docker/daemon.json

{
  "storage-driver": "btrfs"
}

# 重启 Docker
sudo systemctl restart docker
```

### 优点

- 原生支持快照和克隆
- 支持透明压缩
- 支持子卷配额
- 支持只读快照

### 缺点

- 不如 ext4/xfs 稳定
- 元数据密集操作可能成为瓶颈
- 社区支持相对较少

## zfs

zfs 是 Sun Microsystems 开发的先进文件系统，提供类似 btrfs 的功能。

### 工作原理

```
zfs pool (zpool)
├── docker/
│   ├── image/                  # 镜像层（ZFS 克隆）
│   ├── container/             # 容器层（克隆）
│   └── volume/                # 持久卷
└── snapshots/                  # 快照
```

### 配置

```bash
# 创建 zfs 存储池
sudo zpool create docker-pool /dev/sda1

# 配置 Docker 使用 zfs
sudo vim /etc/docker/daemon.json

{
  "storage-driver": "zfs"
}

# 重启 Docker
sudo systemctl restart docker
```

### 优点

- 高度可靠
- 支持压缩和去重
- 强大的快照功能
- 支持远程复制

### 缺点

- 内存占用较高（需要足够内存管理元数据）
- 配置文件系统参数复杂
- 学习曲线较陡

## fuse-overlayfs

fuse-overlayfs 是为 rootless 容器设计的 overlay2 替代品。

### 适用场景

rootless 容器无法直接使用 overlay2，因为需要特权操作。fuse-overlayfs 通过 FUSE（Userspace Filesystem）实现非特权操作：

```bash
# rootless Docker 配置
cat /etc/docker/daemon.json

{
  "storage-driver": "fuse-overlayfs"
}

# 安装 fuse-overlayfs
sudo apt-get install fuse-overlayfs
```

### 优点

- 适合 rootless 容器
- 不需要特权操作
- 配置简单

### 缺点

- 性能比原生 overlay2 差
- 功能受限

## 存储驱动对比

| 维度 | overlay2 | devicemapper | btrfs | zfs | fuse-overlayfs |
|------|----------|--------------|-------|-----|----------------|
| **性能** | 高 | 中 | 中高 | 中高 | 低 |
| **稳定性** | 高 | 中 | 中 | 高 | 高 |
| **兼容性** | 广泛 | 中等 | 需要支持 | 需要支持 | 广泛 |
| **内存占用** | 低 | 中 | 低 | 高 | 低 |
| **快照支持** | 有限 | 支持 | 原生 | 原生 | 有限 |
| **适用场景** | 通用 | 块存储 | 高级功能 | 企业存储 | rootless |
| **推荐度** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |

## 存储驱动选择建议

```
┌─────────────────────────────────────────────────────┐
│              存储驱动选择决策树                        │
│                                                     │
│  是否是 rootless 容器？                              │
│         ↓ 是                                        │
│      fuse-overlayfs                                 │
│         ↓ 否                                        │
│  内核版本 >= 4.0 且文件系统支持？                      │
│         ↓ 是                                        │
│      overlay2（推荐）                                │
│         ↓ 否                                        │
│  需要块级操作？                                       │
│         ↓ 是                                        │
│      devicemapper                                   │
│         ↓ 否                                        │
│  需要高级功能（压缩、去重）？                           │
│         ↓ 是                                        │
│      btrfs 或 zfs                                    │
│         ↓ 否                                        │
│      devicemapper                                   │
└─────────────────────────────────────────────────────┘
```

## 监控存储使用

```bash
# 查看 Docker 使用的磁盘空间
docker system df

# 输出：
# TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
# Images          15        5         5.536GB   3.271GB (59%)
# Containers      8         3         123.4MB  98.5MB (79%)
# Local Volumes   12        4         1.234GB  0B (0%)
# Build Cache     0         0         0B       0B

# 详细查看
docker system df -v

# 清理未使用的镜像和容器
docker system prune -a
```

## 面试追问

1. **overlay2 的工作原理是什么？lower 和 upper 目录的作用是什么？**
2. **什么是 Copy-on-Write？为什么需要它？**
3. **为什么 overlay2 是推荐的存储驱动？**
4. **devicemapper 和 overlay2 的本质区别是什么？**
5. **rootless 容器为什么不能用 overlay2？fuse-overlayfs 是怎么解决的？**

> "存储驱动是 Docker 的底层基础设施。理解不同存储驱动的特点和适用场景，才能在遇到性能问题或稳定性问题时做出正确的调整。"
