# Helm Hook 生命周期管理

「Helm 升级时数据库迁移怎么做？」——Helm Hook 让你在 Release 生命周期的关键时刻插入自定义操作。

Helm Hook 是在 Release 升级、回滚或删除时，自动触发特定资源（如 Job、Pod）执行的一种机制。它解决了 Helm 本身不擅长的事情：**在安装前后执行一次性任务**，比如数据库迁移、初始化配置、清理临时数据。

## Hook 机制概述

Helm Hook 本质上是 Kubernetes 中的一种**注解驱动**的特殊资源。标记了 Hook 注解的 Resource，不会随常规的 Helm 操作被删除，而是由 Helm 在特定时机触发。

```yaml
# 在 Job 中添加 Hook 注解
apiVersion: batch/v1
kind: Job
metadata:
  name: database-migration
  annotations:
    # Hook 类型：pre-install 表示安装前执行
    helm.sh/hook: pre-install
    # 权重：决定同类型 Hook 的执行顺序（数字越小越先执行）
    helm.sh/hook-weight: "-1"
    # 删除策略：成功后自动删除
    helm.sh/hook-delete-policy: hook-succeeded
```

## Hook 类型

Helm 支持多种 Hook 类型，覆盖 Release 的整个生命周期：

```yaml
helm.sh/hook: pre-install        # 安装前执行
helm.sh/hook: post-install      # 安装后执行
helm.sh/hook: pre-upgrade       # 升级前执行
helm.sh/hook: post-upgrade      # 升级后执行
helm.sh/hook: pre-rollback      # 回滚前执行
helm.sh/hook: post-rollback     # 回滚后执行
helm.sh/hook: pre-delete        # 删除前执行
helm.sh/hook: post-delete       # 删除后执行
helm.sh/hook: test             # 测试时执行（helm test）
```

执行顺序：

```
安装：pre-install → 安装资源 → post-install
升级：pre-upgrade → 升级资源 → post-upgrade
回滚：pre-rollback → 回滚资源 → post-rollback
删除：pre-delete → 删除资源 → post-delete
```

## Hook 权重

同一类型的 Hook 可能存在多个，通过 `hook-weight` 控制执行顺序：

```yaml
# Job 1
helm.sh/hook-weight: "-2"

# Job 2
helm.sh/hook-weight: "0"

# Job 3
helm.sh/hook-weight: "5"
```

执行顺序：`Job 1 → Job 2 → Job 3`（数字从小到大）

> Hook 之间是**串行执行**的，不是并行。可以通过设置为相同的权重来实现一定程度的并发。

## 删除策略

`helm.sh/hook-delete-policy` 决定 Hook 资源在什么情况下被删除：

```yaml
helm.sh/hook-delete-policy: hook-succeeded   # Job 成功后删除
helm.sh/hook-delete-policy: hook-failed     # Job 失败后删除
helm.sh/hook-delete-policy: before-hook-creation  # 创建新 Hook 前删除旧 Hook
helm.sh/hook-delete-policy: hook-failed,hook-succeeded  # 成功后或失败后都删除
```

## 实战场景

### 场景一：数据库迁移（pre-upgrade + post-upgrade）

```yaml
# templates/db-migration.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .Release.Name }}-db-migration
  labels:
    app: {{ .Release.Name }}
  annotations:
    helm.sh/hook: pre-upgrade,pre-rollback
    helm.sh/hook-weight: "-1"
    helm.sh/hook-delete-policy: hook-failed,hook-succeeded
spec:
  ttlSecondsAfterFinished: 300
  template:
    metadata:
      labels:
        app: {{ .Release.Name }}
    spec:
      restartPolicy: OnFailure
      containers:
        - name: migration
          image: "{{ .Values.migration.image.repository }}:{{ .Values.migration.image.tag }}"
          command:
            - /bin/sh
            - -c
            - |
              echo "Running database migration..."
              {{- if .Values.migration.command }}
              {{ .Values.migration.command | nindent 14 }}
              {{- else }}
              python manage.py migrate --noinput
              {{- end }}
          env:
            {{- range .Values.migration.env }}
            - name: {{ .name }}
              value: {{ .value | quote }}
            {{- end }}
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
```

### 场景二：初始化配置（post-install）

```yaml
# templates/init-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Release.Name }}-init-config
data:
  config.yaml: |
    {{ .Values.config | toYaml | nindent 4 }}
---
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .Release.Name }}-init
  annotations:
    helm.sh/hook: post-install
    helm.sh/hook-weight: "0"
    helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded
spec:
  ttlSecondsAfterFinished: 300
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: init
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          command:
            - /bin/sh
            - -c
            - |
              echo "Initializing application..."
              sleep 5
              echo "Application initialized."
```

### 场景三：清理资源（pre-delete）

```yaml
# templates/cleanup.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .Release.Name }}-cleanup
  annotations:
    helm.sh/hook: pre-delete
    helm.sh/hook-weight: "1"
    helm.sh/hook-delete-policy: hook-succeeded
spec:
  ttlSecondsAfterFinished: 300
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: cleanup
          image: bitnami/kubectl:latest
          command:
            - /bin/sh
            - -c
            - |
              echo "Cleaning up stale resources..."
              kubectl delete secret {{ .Release.Name }}-temp-secret -n {{ .Release.Namespace }} --ignore-not-found=true
              kubectl delete configmap {{ .Release.Name }}-temp-config -n {{ .Release.Namespace }} --ignore-not-found=true
```

### 场景四：多 Hook 协作（迁移 + 数据校验）

```yaml
# 步骤 1：数据迁移（最早执行）
helm.sh/hook: pre-upgrade
helm.sh/hook-weight: "-3"

# 步骤 2：备份数据（迁移前）
helm.sh/hook: pre-upgrade
helm.sh/hook-weight: "-2"

# 步骤 3：验证（升级后）
helm.sh/hook: post-upgrade
helm.sh/hook-weight: "1"

# 步骤 4：通知（最后执行）
helm.sh/hook: post-upgrade
helm.sh/hook-weight: "2"
```

## Hook 与普通资源的区别

| 维度 | 普通资源 | Hook 资源 |
|------|---------|---------|
| 创建时机 | 在 `pre-install` 之后创建 | 由 Hook 类型决定 |
| 删除时机 | `helm uninstall` 时删除 | 取决于 `hook-delete-policy` |
| 回滚行为 | 被回滚 | 通常保留（需注意） |
| 状态跟踪 | Helm 跟踪 | Helm 记录但不完全跟踪 |
| 并发执行 | 多个 Release 并行 | 同一 Release 内按 weight 串行 |

## 常见问题与避坑

### 问题一：Hook 资源导致 uninstall 卡住

如果 Hook 的 Job 一直失败或处于 Running 状态，`helm uninstall` 会等待。

```yaml
# 解决：设置 TTL 并添加失败时删除策略
helm.sh/hook-delete-policy: hook-failed,hook-succeeded
spec:
  ttlSecondsAfterFinished: 300   # Job 完成后 300 秒自动删除
  backoffLimit: 3                 # 失败重试次数
```

### 问题二：升级时 Hook 不执行

```bash
# Helm 默认跳过未改变的 Hook 资源
# 强制重新执行所有 Hook：
helm upgrade --reset-values myrelease ./chart
# 或
helm upgrade --force myrelease ./chart

# 查看 Hook 状态
helm get hooks myrelease
```

### 问题三：多集群环境下的 Hook 并发

在多集群场景下，同一个 Hook 可能在多个集群同时执行：

```yaml
# 解决：在 Hook 中加入集群标识
command:
  - /bin/sh
  - -c
  - |
    CLUSTER_NAME="{{ .Values.clusterName }}"
    # 使用分布式锁或幂等设计
```

## Hook 状态查询

```bash
# 查看 Release 的所有 Hook 资源
helm get hooks <release-name>

# 查看某个 Hook 的状态
helm status <release-name>

# 查看 Hook 事件
kubectl get events --all-namespaces --field-selector involvedObject.name=<job-name>

# 删除卡住的 Hook Job
kubectl delete job <hook-job-name> -n <namespace>
```

## 最佳实践

```yaml
# 1. 始终设置 TTL，防止资源残留
spec:
  ttlSecondsAfterFinished: 300

# 2. 合理设置 weight，保持执行顺序
# pre-upgrade: 迁移(weight:-1) → 备份(weight:-2) → 清理(weight:0)

# 3. 使用 hook-delete-policy 控制清理
helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded

# 4. Hook 资源应该幂等（可重复执行不报错）
command:
  - /bin/sh
  - -c
  - |
    # 使用 --ignore-not-found 和 --ignore-already-exists
    kubectl apply --filename=/path/to/resource.yaml || true

# 5. 资源配额（防止 Hook 耗尽集群资源）
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "512Mi"
    cpu: "500m"
```

> "Helm Hook 是连接 Helm 生命周期和运维操作之间的桥梁。用好 Hook，可以让 Chart 具备『自我管理』能力——安装时初始化、升级时迁移、删除时清理。但要注意幂等性和异常处理，否则 Hook 本身会成为新的故障点。"
