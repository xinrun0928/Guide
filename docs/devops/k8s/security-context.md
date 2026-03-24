# Security Context 与 Pod Security Standards

「这个 Pod 能做什么，不能做什么？」——容器安全的第一步，是回答这个问题。

Security Context 和 Pod Security Standards（PSS，前身是 PodSecurityPolicy）是 K8s 中控制容器运行时权限的两套机制。前者是声明式的、细粒度的权限配置；后者是集群级别的准入控制。两者配合使用，构成了 K8s 安全的第二道防线。

## Security Context 的两个层级

Security Context 可以设置在两个级别：**Pod 级别**（对所有容器生效）和**容器级别**（对单个容器生效）。容器级别的设置会覆盖 Pod 级别的设置。

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: secure-app
spec:
  securityContext:
    runAsNonRoot: true          # Pod 级别：禁止以 root 运行
    runAsUser: 1000             # Pod 级别：指定运行用户
    runAsGroup: 1000            # Pod 级别：指定运行组
    supplementalGroups: [2000]  # Pod 级别：补充组
    fsGroup: 2000               # Pod 级别：文件系统 Group（挂载卷的权限）
    seLinuxOptions:            # SELinux 配置
      level: "s0:c123,c456"
      role: "object_r"
      type: "svirt_lxc_net_t"
    sysctls:                   # 内核参数调优
      - name: net.core.somaxconn
        value: "1024"
  containers:
    - name: app
      image: myapp:v1
      securityContext:
        allowPrivilegeEscalation: false  # 容器级别：禁止提权
        readOnlyRootFilesystem: true    # 容器级别：只读根文件系统
        capabilities:
          add: ["NET_BIND_SERVICE"]     # 添加特定 capabilities
          drop: ["ALL"]                 # 删除所有 capabilities
        privileged: false               # 容器级别：非特权模式
        seccompProfile:                 # seccomp 配置
          type: RuntimeDefault
```

## 常用配置解析

### 运行用户与组

```yaml
securityContext:
  runAsUser: 1000    # 指定 UID 运行容器
  runAsGroup: 1000   # 指定 GID
  fsGroup: 2000       # 挂载卷的所有者 GID（Pod 级别）
```

**注意**：`runAsUser` 和 `runAsGroup` 必须在镜像中已存在对应用户。查看镜像用户：

```bash
docker run --rm myapp:v1 id
# uid=1000(app) gid=1000(app) groups=1000(app)
```

### capabilities：细粒度权限控制

Linux capabilities 将 root 的所有权限拆分成 200+ 个细粒度单元。默认情况下，容器运行在 `Non-root` 模式下，只有少量 capabilities。

```yaml
securityContext:
  capabilities:
    drop: ["ALL"]       # 移除所有 capabilities（安全最佳实践）
    add: ["NET_BIND_SERVICE"]  # 仅添加需要的（如让非 root 绑定 1024 以下端口）
```

常见 capabilities：

| Capability | 说明 | 使用场景 |
|-----------|------|---------|
| NET_BIND_SERVICE | 绑定到 1024 以下端口 | Web 服务器（非 root） |
| SYS_TIME | 修改系统时间 | NTP 同步服务 |
| SYS_ADMIN | 系统管理权限（宽泛） | 挂载文件系统等 |
| NET_ADMIN | 网络管理权限 | 配置路由、iptables |
| DAC_READ_SEARCH | 绕过文件权限检查 | 日志收集 |

### 禁止特权模式与提权

```yaml
securityContext:
  privileged: false              # 不以特权模式运行
  allowPrivilegeEscalation: false # 禁止获取比启动时更多的权限
```

特权容器（`privileged: true`）可以访问宿主机的所有设备，相当于宿主机上的 root 权限——这是极其危险的。

### seccomp：系统调用过滤

seccomp（secure computing）限制进程可以调用的系统调用。K8s 支持三种模式：

```yaml
securityContext:
  seccompProfile:
    type: RuntimeDefault  # 使用容器运行时的默认 seccomp 配置
    # type: Unconfined   # 关闭 seccomp（不推荐）
    # type: Localhost
    #   localhostProfile: profiles/audit.json  # 使用自定义配置
```

生产环境建议使用 `RuntimeDefault`，它由容器运行时（Docker/containerd）提供，禁用了一些危险系统调用。

## Pod Security Standards（PSS）

Pod Security Standards 是 K8s 1.25 引入的替代 PodSecurityPolicy 的内置方案。它通过 **Admission** 阶段的三种策略级别，控制 Pod 在 namespace 中的部署：

| 策略 | 说明 | 允许的行为 |
|------|------|-----------|
| `privileged` | 无限制（危险） | 所有特性 |
| `baseline` | 最小限制 | 防止最常见的特权升级 |
| `restricted` | 符合最佳实践 | 遵循容器安全最佳实践 |

### 在 namespace 中启用 PSS

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    # 为该 namespace 设置默认策略为 restricted
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    # 警告模式（不阻止部署，但显示警告）
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: latest
    # 审计模式（记录违反策略的事件）
    pod-security.kubernetes.io/audit: restricted
```

```bash
# 创建时直接指定
kubectl create namespace production \
  --labels=pod-security.kubernetes.io/enforce=restricted
```

### 三种策略的差异

以 `baseline` vs `restricted` 为例：

```yaml
# baseline 允许但不推荐的配置（带警告）
# 这些在 restricted 中会被直接拒绝

# restricted 明确禁止的：
spec:
  securityContext:
    runAsUser: 0        # ✗ 禁止以 root 运行
  containers:
    - name: app
      securityContext:
        privileged: true      # ✗ 禁止特权容器
        allowPrivilegeEscalation: true  # ✗ 禁止提权
        seccompProfile: {}    # ✗ 必须设置 seccomp
        capabilities:
          add: ["SYS_ADMIN"]  # ✗ 禁止高危 capabilities
```

## 实战：最小权限 Pod 配置

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: webapp
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 10000
    runAsGroup: 10000
    fsGroup: 10000
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: webapp
      image: nginx:1.25
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
      resources:
        limits:
          memory: "128Mi"
          cpu: "500m"
      volumeMounts:
        - name: tmp
          mountPath: /tmp
  # 如果应用需要写临时文件，配合 emptyDir
  volumes:
    - name: tmp
      emptyDir:
        medium: Memory
        sizeLimit: 64Mi
```

这个配置：
- 不以 root 运行
- 文件系统只读（除了临时目录）
- 不具备任何 capabilities
- 有资源限制
- 内存盘作为临时存储（重启即清空，安全性更高）

## 面试追问方向

- `runAsUser` 和 `securityContext.runAsUser` 的区别是什么？哪个优先级更高？
- seccomp 和 AppArmor/SELinux 有什么区别？K8s 对它们的支持程度如何？
- PodSecurityPolicy 和 Pod Security Standards 有什么关系？PSP 废弃后迁移方案是什么？
- 为什么 `allowPrivilegeEscalation: false` 和 `runAsNonRoot: true` 要配合使用？
- 容器内的 root 用户和宿主机的 root 有什么区别？UID 0 在容器内等于宿主机 UID 0 吗？

> Security Context 和 PSS 是 K8s 容器安全的核心机制。理解它们，不需要记住每一条配置规则，但需要理解「为什么这样设计」——最小权限、纵深防御、不以 root 运行。
