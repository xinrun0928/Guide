# Docker 安全：用户命名空间隔离、seccomp、capability、AppArmor

容器安全是一个容易被忽视但至关重要的话题。默认情况下，Docker 容器以 root 用户运行，拥有的权限远超实际需要。一旦容器被攻破，攻击者可能获得宿主机 root 权限。

这篇文章，聊聊 Docker 的安全机制，以及如何加固你的容器。

## 默认安全风险

### 容器以 root 运行

```bash
# 查看容器进程的 UID
docker run -d --name test nginx:alpine
docker exec test id

# 输出：
# uid=0(root) gid=0(root) groups=0(root)
# 容器内的 root 就是宿主机的 root
```

### 默认 Capabilities

Linux 的 Capabilities 将超级用户的权限分解为多个独立单元：

```bash
# 查看容器的 Capabilities
docker run --rm -it --cap-add=all nginx:alpine capsh --print

# 默认容器的 Capabilities
# DAC_READ_SEARCH       # 绕过文件读权限检查
# NET_ADMIN             # 网络管理
# SYS_ADMIN             # 很多系统管理操作
# ...
```

### 默认 seccomp 配置

Docker 默认启用 seccomp（Secure Computing Mode），阻止约 44 个系统调用：

```bash
# 查看默认 seccomp 配置文件
cat /etc/docker/daemon.json

# 或者获取默认配置
docker run --rm \
    alpine:latest \
    cat /proc/self/status | grep Seccomp
```

## 用户命名空间隔离（User Namespace）

默认情况下，容器内的 root（UID 0）映射到宿主机的 root（UID 0）。用户命名空间隔离可以将容器内的 UID 映射到宿主机的非特权 UID。

### 启用用户命名空间

```bash
# 编辑 Docker 配置
sudo vim /etc/docker/daemon.json

{
  "userns-remap": "default"
}

# 重启 Docker
sudo systemctl restart docker

# Docker 会创建 docker:mapremapped 用户组
# 容器内的 root (0) → 宿主机上的 nobody (65534)
```

### 理解映射关系

```
未启用用户命名空间：
容器 root (UID 0) → 宿主机 root (UID 0)

启用用户命名空间后：
容器 root (UID 0)     → 宿主机 nobody (UID 65534)
容器 nginx (UID 1000) → 宿主机 docker-subuid:1000 (UID 100000)
```

### 注意事项

```bash
# 用户命名空间隔离后，一些操作需要额外配置

# 1. 绑定宿主机端口 < 1024 需要额外权限
# 1024 以下的端口需要 CAP_NET_BIND_SERVICE

# 2. 某些存储驱动不支持
# devicemapper 的 direct-lvm 模式不支持

# 3. 容器和宿主机文件系统隔离
# /var/lib/docker 下的文件结构变化
```

## Capabilities 限制

Capabilities 将 root 的权限分解为多个单元，只授予容器需要的最小权限集。

### 常用 Capabilities

| Capability | 说明 | 风险 |
|------------|------|------|
| `CAP_CHOWN` | 修改文件所有权 | 中 |
| `CAP_DAC_OVERRIDE` | 绕过 DAC 权限检查 | 中 |
| `CAP_NET_BIND_SERVICE` | 绑定 < 1024 的端口 | 低 |
| `CAP_NET_RAW` | 原始套接字 | 高 |
| `CAP_SYS_ADMIN` | 系统管理权限 | 极高 |
| `CAP_SYS_MODULE` | 加载内核模块 | 极高 |

### 添加/删除 Capabilities

```bash
# 移除所有 Capabilities，只保留网络访问
docker run -d \
    --cap-drop=ALL \
    --cap-add=NET_BIND_SERVICE \
    --name myapp \
    nginx:alpine

# 添加特定 Capability
docker run -d \
    --cap-add=NET_RAW \
    --name myapp \
    nginx:alpine

# 查看容器的 Capabilities
docker run -it --rm nginx:alpine cat /proc/self/status | grep Cap
```

### 常见场景的最小权限

```bash
# Nginx：只需要绑定端口和读取文件
docker run -d \
    --cap-drop=ALL \
    --cap-add=NET_BIND_SERVICE \
    --cap-add=SYS_CHROOT \
    --read-only \
    --tmpfs /tmp \
    --name nginx \
    nginx:alpine

# 数据库：需要文件系统访问和共享内存
docker run -d \
    --cap-drop=ALL \
    --cap-add=SETGID \
    --cap-add=SETUID \
    --cap-add=DAC_OVERRIDE \
    --name mysql \
    mysql:8.0

# 不需要任何特权
docker run -d \
    --cap-drop=ALL \
    --name myapp \
    myapp:latest
```

## seccomp 配置

seccomp（Secure Computing Mode）限制进程可以使用的系统调用。

### 默认 seccomp

Docker 默认的 seccomp 配置阻止约 44 个危险系统调用：

```json
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "syscalls": [
    {
      "names": ["mount", "umount2", "ptrace", ...],
      "action": "SCMP_ACT_KILL"
    }
  ]
}
```

### 自定义 seccomp 配置

```bash
# 创建自定义 seccomp 配置
cat > seccomp-profile.json << 'EOF'
{
  "defaultAction": "SCMP_ACT_ERRNO",
  "architectures": [
    "SCMP_ARCH_X86_64",
    "SCMP_ARCH_X86",
    "SCMP_ARCH_ARM"
  ],
  "syscalls": [
    {
      "names": [
        "accept",
        "accept4",
        "bind",
        "brk",
        "clock_gettime",
        "close",
        "connect",
        "epoll_create",
        "epoll_create1",
        "epoll_ctl",
        "epoll_pwait",
        "epoll_wait",
        "execve",
        "exit",
        "exit_group",
        "fcntl",
        "fstat",
        "fstatfs",
        "fsync",
        "getdents64",
        "getpeername",
        "getpid",
        "getsockname",
        "getsockopt",
        "ioctl",
        "kill",
        "listen",
        "lseek",
        "madvise",
        "mincore",
        "mkdir",
        "mmap",
        "mprotect",
        "mq_open",
        "mremap",
        "msync",
        "nanosleep",
        "newfstatat",
        "open",
        "openat",
        "pipe",
        "pipe2",
        "poll",
        "ppoll",
        "prctl",
        "pread64",
        "pselect6",
        "pwrite64",
        "read",
        "readlink",
        "readv",
        "recvfrom",
        "recvmsg",
        "rename",
        "renameat",
        "rmdir",
        "rt_sigaction",
        "rt_sigpending",
        "rt_sigprocmask",
        "rt_sigreturn",
        "rt_sigsuspend",
        "rt_sigtimedwait",
        "sched_yield",
        "sendmsg",
        "sendto",
        "set_robust_list",
        "set_tid_address",
        "setgid",
        "setgroups",
        "setsockopt",
        "setuid",
        "shmat",
        "shmctl",
        "shmdt",
        "shutdown",
        "sigaltstack",
        "socket",
        "splice",
        "stat",
        "statfs",
        "sysinfo",
        "tee",
        "tgkill",
        "time",
        "timer_create",
        "timer_delete",
        "timer_getoverrun",
        "timer_settime",
        "times",
        "tkill",
        "truncate",
        "umask",
        "uname",
        "unlink",
        "unlinkat",
        "utime",
        "vmsplice",
        "wait4",
        "write",
        "writev"
      ],
      "action": "SCMP_ACT_ALLOW"
    },
    {
      "names": ["clone", "fork", "vfork"],
      "action": "SCMP_ACT_ALLOW",
      "args": [
        {
          "index": 0,
          "name": "CLONE_NEWUSER",
          "op": "SCMP_CMP_NEQ"
        }
      ]
    },
    {
      "names": ["socket"],
      "action": "SCMP_ACT_ERRNO",
      "errnoRet": 1,
      "args": [
        {
          "index": 0,
          "name": "AF_INET",
          "op": "SCMP_CMP_EQ"
        },
        {
          "index": 1,
          "name": "SOCK_RAW",
          "op": "SCMP_CMP_EQ"
        }
      ]
    }
  ]
}
EOF

# 使用自定义 seccomp 配置
docker run -d \
    --security-opt seccomp=seccomp-profile.json \
    --name myapp \
    nginx:alpine
```

### 禁用 seccomp

```bash
# 不推荐：完全禁用 seccomp
docker run -d \
    --security-opt seccomp=unconfined \
    --name myapp \
    nginx:alpine
```

## AppArmor

AppArmor 是 Ubuntu/Debian 上的 MAC（Mandatory Access Control）系统，比 seccomp 提供更细粒度的控制。

### 创建 AppArmor 配置

```bash
# 创建 AppArmor 配置文件
cat > /etc/apparmor.d/docker/myapp << 'EOF'
#include <tunables/global>

profile myapp flags=(attach_disconnected,mediate_deleted) {
  #include <abstractions/base>
  #include <abstractions/bash>

  network inet tcp,
  network inet udp,
  network inet icmp,

  deny network raw,

  /myapp/ r,
  /myapp/** r,

  /etc/myapp/** rwk,
}
EOF

# 加载配置
sudo apparmor_parser -r /etc/apparmor.d/docker/myapp

# 使用 AppArmor 配置
docker run -d \
    --security-opt apparmor=myapp \
    --name myapp \
    myapp:latest
```

### Docker 默认 AppArmor 配置

Docker 为每个容器生成一个 AppArmor 配置文件：

```bash
# 查看容器使用的 AppArmor 配置文件
docker inspect myapp | grep AppArmorProfile

# 默认配置文件位置
/etc/apparmor.d/docker-<container-id>
```

## SELinux

SELinux 是 Red Hat/CentOS 上的 MAC 系统。

### 使用 SELinux

```bash
# 启用 SELinux 隔离
docker run -d \
    --security-opt label=type:container_t \
    --name myapp \
    nginx:alpine

# 只读挂载安全上下文
docker run -d \
    --security-opt label=type:container_file_t \
    -v /var/www/html:/usr/share/nginx/html:ro \
    --name nginx \
    nginx:alpine
```

## 综合安全加固

### 生产环境推荐配置

```bash
docker run -d \
    --name myapp \
    --user 1000:1000 \
    --cap-drop=ALL \
    --security-opt no-new-privileges \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=100m \
    --pids-limit=100 \
    --memory=512m \
    --memory-swap=512m \
    --health-cmd="curl -f http://localhost:8080/health || exit 1" \
    --health-interval=30s \
    --health-retries=3 \
    -v /var/run/secrets:/run/secrets:ro \
    myapp:latest
```

### 配置解释

| 选项 | 作用 |
|------|------|
| `--user 1000:1000` | 以非 root 用户运行 |
| `--cap-drop=ALL` | 移除所有 Capabilities |
| `--security-opt no-new-privileges` | 禁止进程提权 |
| `--read-only` | 根文件系统只读 |
| `--tmpfs /tmp` | /tmp 使用内存文件系统 |
| `--pids-limit=100` | 限制进程数 |
| `--memory=512m` | 限制内存 |
| `--health-cmd` | 健康检查 |

## 扫描容器漏洞

```bash
# 使用 Trivy 扫描镜像
docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    aquasec/trivy image nginx:alpine

# 扫描并输出 JSON
docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    aquasec/trivy image --format json --output scan.json nginx:alpine

# 只扫描关键和高危漏洞
docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    aquasec/trivy image \
    --severity HIGH,CRITICAL \
    nginx:alpine
```

## 面试追问

1. **容器和宿主机共享内核意味着什么安全风险？**
2. **什么是 Capabilities？为什么需要用它？默认容器有哪些 Capabilities？**
3. **seccomp 是什么？如何自定义 seccomp 配置？**
4. **什么是容器逃逸？有哪些常见的容器逃逸方式？**
5. **如何保证容器镜像的安全性？**

> "容器安全是一个纵深防御的问题。没有银弹，只有多层保护。遵循最小权限原则，从用户、网络、文件系统、系统调用多个层面加固，才能最大限度降低安全风险。"
