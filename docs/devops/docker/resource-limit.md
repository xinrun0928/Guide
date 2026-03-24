# 容器资源限制：CPU、内存、IO 限制

容器共享宿主机的资源，如果不加限制，一个容器可能耗尽整台机器的 CPU 或内存，导致其他容器甚至宿主机本身出问题。

Docker 提供了完整的资源限制机制，通过 Linux 内核的 cgroups（Control Groups）实现。

## cgroups 简介

cgroups 是 Linux 内核提供的资源管理机制，可以限制、记录和隔离进程组的资源使用。

```
cgroups 层级结构
├── cpu/
│   ├── cpu.cfs_quota_us      # CPU 时间配额
│   └── cpu.cfs_period_us      # 调度周期
├── memory/
│   ├── memory.limit_in_bytes  # 内存限制
│   └── memory.soft_limit_in_bytes  # 软限制
├── blkio/                    # 块设备 IO
│   ├── blkio.throttle.read_bps_device
│   └── blkio.throttle.write_bps_device
└── pids/                     # 进程数限制
    └── pids.max
```

Docker 容器本质上就是一个 cgroup，容器的所有进程都在这个 cgroup 下运行。

## 内存限制

内存是最重要的资源限制参数。设置不当可能导致 OOM（Out of Memory）被杀。

### 基本内存限制

```bash
# 限制容器最多使用 512MB 内存
docker run -d --memory=512m --name myapp nginx:alpine

# 限制容器最多使用 1GB 内存，包括 swap
docker run -d \
    --memory=1g \
    --memory-swap=2g \
    --name myapp \
    nginx:alpine

# memory-swap 解释：
# memory=1g, memory-swap=2g → 容器最多使用 1GB 内存 + 1GB swap
# memory=1g, memory-swap=1g → 不允许使用 swap
# memory=1g（不设置）→ 可以使用无限 swap
```

### 内存限制参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `--memory` 或 `-m` | 容器可以使用的最大内存 | `--memory=512m` |
| `--memory-swap` | 允许的内存 + swap 总量 | `--memory-swap=1g` |
| `--memory-reservation` | 软限制，资源紧张时触发 | `--memory-reservation=256m` |
| `--memory-swappiness` | 容器使用 swap 的倾向（0-100） | `--memory-swappiness=0` |
| `--kernel-memory` | 内核内存限制（非隔离空间） | `--kernel-memory=50m` |
| `--oom-kill-disable` | 禁止 OOM 杀死容器 | `--oom-kill-disable` |

### 内存软限制

```bash
# 设置硬限制 1GB，软限制 512MB
docker run -d \
    --memory=1g \
    --memory-reservation=512m \
    --name myapp \
    nginx:alpine

# 当宿主机的内存不足时，Docker 会优先回收超过软限制的容器
```

### 禁止 swap

```bash
# 不允许容器使用 swap
docker run -d \
    --memory=1g \
    --memory-swap=1g \
    --name myapp \
    nginx:alpine
```

### 处理 OOM

```bash
# 默认：容器内存不足时会被 OOM Killer 杀死
# 查看容器退出原因
docker inspect myapp | grep -i oom

# 输出：
# "OOMKilled": false

# 禁用 OOM Killer（谨慎使用）
docker run -d \
    --memory=1g \
    --oom-kill-disable \
    --name myapp \
    nginx:alpine

# 推荐做法：保留内存余量
docker run -d \
    --memory=1g \
    --memory-reservation=800m \
    --name myapp \
    nginx:alpine
```

## CPU 限制

### 基本 CPU 限制

```bash
# 限制容器最多使用 1 个 CPU 核心
docker run -d --cpus=1 --name myapp nginx:alpine

# 限制容器最多使用 0.5 个 CPU（50% CPU）
docker run -d --cpus=0.5 --name myapp nginx:alpine

# 限制容器最多使用 2 个 CPU
docker run -d --cpus=2 --name myapp nginx:alpine
```

### CPU 份额（Shares）

```bash
# 默认份额是 1024
# 容器 A 的份额是 1024，容器 B 的份额是 512
# 当 CPU 紧张时，A 获得的时间是 B 的 2 倍

docker run -d --cpu-shares=1024 --name container_a nginx:alpine
docker run -d --cpu-shares=512 --name container_b nginx:alpine
```

### CPU 核数和核心绑定

```bash
# 限制容器只能在 CPU 0 和 CPU 1 上运行
docker run -d \
    --cpus=2 \
    --cpuset-cpus=0,1 \
    --name myapp \
    nginx:alpine

# 限制容器只能在 CPU 0 上运行
docker run -d \
    --cpuset-cpus=0 \
    --name myapp \
    nginx:alpine
```

### CPU 限制参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `--cpus` | 容器可以使用的 CPU 数量 | `--cpus=2` |
| `--cpuset-cpus` | 允许使用的 CPU 核心 | `--cpuset-cpus=0,1` |
| `--cpuset-mems` | 允许使用的 NUMA 节点 | `--cpuset-mems=0` |
| `--cpu-shares` | CPU 份额（相对权重） | `--cpu-shares=1024` |
| `--cpu-period` | CFS 调度周期（微秒） | `--cpu-period=100000` |
| `--cpu-quota` | CFS 调度周期内的时间配额 | `--cpu-quota=50000` |

### CPU 限制示例

```bash
# 场景：限制容器最多使用 1.5 个 CPU
# 方法1：使用 --cpus（推荐）
docker run -d --cpus=1.5 --name myapp nginx:alpine

# 方法2：使用 --cpu-period 和 --cpu-quota
# --cpu-period=100000（100ms）
# --cpu-quota=150000（150ms）
# 150ms / 100ms = 1.5 CPU
docker run -d \
    --cpu-period=100000 \
    --cpu-quota=150000 \
    --name myapp \
    nginx:alpine
```

## 块设备 IO 限制

### 基本 IO 限制

```bash
# 限制读 IOPS 为 100
docker run -d \
    --device-read-bps=/dev/sda:1mb \
    --name myapp \
    nginx:alpine

# 限制写 IOPS 为 50
docker run -d \
    --device-write-bps=/dev/sda:1mb \
    --name myapp \
    nginx:alpine

# 限制读写带宽
docker run -d \
    --device-read-bps=/dev/sda:10mb \
    --device-write-bps=/dev/sda:5mb \
    --name myapp \
    nginx:alpine
```

### IOPS 限制

```bash
# 限制读 IOPS 为 100
docker run -d \
    --device-read-iops=/dev/sda:100 \
    --name myapp \
    nginx:alpine

# 限制写 IOPS 为 50
docker run -d \
    --device-write-iops=/dev/sda:50 \
    --name myapp \
    nginx:alpine
```

## 进程数限制

### PID 限制

```bash
# 限制容器最多创建 100 个进程
docker run -d \
    --pids-limit=100 \
    --name myapp \
    nginx:alpine

# 查看当前容器的 PID 限制
docker inspect myapp | grep PidsLimit

# 查看容器内的进程数
docker exec myapp ps aux | wc -l
```

## 网络带宽限制

Docker 没有内置的网络带宽限制，但可以通过 `tc`（Traffic Control）实现：

```bash
# 使用 tc 限制容器网络带宽
# 限制 eth0 的出口带宽为 1Mbps
docker exec myapp tc qdisc add dev eth0 root tbf rate 1mbit burst 32kbit latency 400ms
```

## docker-compose 中配置资源限制

```yaml
version: '3.8'

services:
  web:
    image: nginx:alpine
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
          pids: 100
        reservations:
          cpus: '0.25'
          memory: 256M

  database:
    image: mysql:8.0
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
        reservations:
          cpus: '1'
          memory: 1G
```

## 监控资源使用

```bash
# 查看容器资源使用
docker stats

# 输出：
# CONTAINER ID   NAME        CPU %   MEM USAGE / LIMIT     MEM %   NET I/O           BLOCK I/O
# abc123...       myapp       0.12%   128MiB / 512MiB      25.00%  1.5MB / 500KB     10MB / 5MB

# 查看特定容器的详细资源使用
docker stats myapp --no-stream

# 查看容器资源限制
docker inspect myapp | grep -A 20 "HostConfig"

# 查看 cgroup 信息
docker exec myapp cat /sys/fs/cgroup/memory/memory.limit_in_bytes
docker exec myapp cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us
```

## 资源限制最佳实践

### Java 应用的内存设置

```bash
# JVM 默认会使用宿主机所有内存
# 需要设置 JVM 堆内存与容器内存限制匹配

docker run -d \
    --memory=1g \
    --memory-swap=1g \
    --name myapp \
    -e JAVA_OPTS="-Xms512m -Xmx768m" \
    myapp:latest

# JVM 1.8u131+ 可以使用容器感知
# JVM 会自动检测容器内存限制
# 推荐使用 -XX:+UseContainerSupport
```

### Nginx 的 worker 进程数

```bash
# Nginx 默认会启动多个 worker 进程
# 应该限制 worker 进程数，避免耗尽 CPU

docker run -d \
    --cpus=1 \
    --name nginx \
    -e NGINX_WORKER_PROCESSES=1 \
    -e NGINX_WORKER_CONNECTIONS=1024 \
    nginx:alpine
```

### 设置安全余量

```bash
# 总是设置比预期使用量略高的限制
# 给系统留出余量处理突发情况

# 例如：预期使用 800MB，设置 1GB
docker run -d \
    --memory=1g \
    --memory-reservation=800m \
    --name myapp \
    nginx:alpine
```

## 面试追问

1. **Docker 是怎么实现资源限制的？底层依赖什么技术？**
2. **`--memory` 和 `--memory-swap` 的区别是什么？如何正确设置？**
3. **容器被 OOM 杀死后，怎么排查和解决？**
4. **CPU 限制中的 `--cpus` 和 `--cpu-shares` 有什么区别？各自适合什么场景？**
5. **Java 应用在容器中运行时，JVM 内存设置有什么坑？**

> "资源限制是保证容器化应用稳定运行的关键。设置太松，容器可能影响其他服务；设置太紧，容器性能受限。好的做法是：先观察，再调优，给出一个合理的『舒适区』。"
