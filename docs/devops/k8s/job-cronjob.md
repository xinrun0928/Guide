# Job 与 CronJob：批处理任务与定时任务

Job 用于运行一次性任务，CronJob 用于运行定时任务。数据迁移、批量计算、定时备份——这些场景都需要 Job 或 CronJob。

## Job 概述

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Job vs Deployment                                │
│                                                                     │
│  Deployment：                                                        │
│  - 长期运行的服务                                                   │
│  - 副本数保持稳定                                                   │
│  - 容器退出后自动重启                                               │
│                                                                     │
│  Job：                                                              │
│  - 一次性任务                                                       │
│  - 任务完成后退出                                                   │
│  - 容器退出后认为任务完成                                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 基本使用

### 最小配置

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: my-job
spec:
  template:
    spec:
      restartPolicy: OnFailure  # Never / OnFailure
      containers:
        - name: my-job
          image: busybox
          command: ["echo", "Hello from Job!"]
```

```bash
# 创建 Job
kubectl apply -f my-job.yaml

# 查看 Job
kubectl get job

# 输出：
# NAME     COMPLETIONS   DURATION   AGE
# my-job   0/1         10s        10s

# 查看 Pod
kubectl get pods -l job-name=my-job
```

### Job 执行过程

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Job 执行过程                                       │
│                                                                     │
│  Job 创建                                                            │
│       ↓                                                             │
│  Pod 创建                                                            │
│       ↓                                                             │
│  Pod 执行任务                                                        │
│       ↓                                                             │
│  Pod 成功退出                                                        │
│       ↓                                                             │
│  Job 标记为 Complete                                                │
│                                                                     │
│  或者：                                                              │
│       ↓                                                             │
│  Pod 失败退出                                                        │
│       ↓                                                             │
│  Job 根据配置重试或标记为 Failed                                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 并行执行

### 串行执行（completions=1）

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: sequential-job
spec:
  completions: 3        # 需要成功完成 3 个 Pod
  parallelism: 1         # 同时运行 1 个 Pod
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: task
          image: busybox
          command: ["sh", "-c", "echo Processing item $ITEM && sleep 5"]
          env:
            - name: ITEM
              value: "1"
```

### 并行执行

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: parallel-job
spec:
  completions: 8        # 需要成功完成 8 个任务
  parallelism: 4         # 同时运行最多 4 个 Pod
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: task
          image: busybox
          command:
            - sh
            - -c
            - |
              echo "Processing item $ITEM"
              sleep $((RANDOM % 5 + 1))
          env:
            - name: ITEM
              valueFrom:
                fieldRef:
                  fieldPath: metadata.annotations['batch.kubernetes.io/job-completion-index']
```

### 工作队列模式

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: queue-processor
spec:
  parallelism: 5           # 同时运行 5 个 worker
  completions: 5           # 队列处理完自动完成
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: worker
          image: queue-worker:v1
          command:
            - sh
            - -c
            - |
              # Worker 从队列获取任务
              while true; do
                TASK=$(redis-cli LPOP task:queue)
                if [ -z "$TASK" ]; then
                  break
                fi
                process "$TASK"
              done
```

## 重试和超时

### 重试配置

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: retry-job
spec:
  backoffLimit: 3          # 失败后最多重试 3 次
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: task
          image: busybox
          command: ["sh", "-c", "exit 1"]  # 故意失败
```

### 超时配置

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: timeout-job
spec:
  activeDeadlineSeconds: 300  # 最多运行 300 秒
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: task
          image: busybox
          command: ["sh", "-c", "sleep 600"]
```

### 完整配置

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: complete-job
spec:
  # 并行度
  parallelism: 4
  completions: 8

  # 重试和超时
  backoffLimit: 3           # 失败重试次数
  activeDeadlineSeconds: 600  # 任务超时时间

  # 清理策略
  ttlSecondsAfterFinished: 3600  # 完成后 1 小时清理

  template:
    metadata:
      labels:
        app: batch-job
    spec:
      restartPolicy: OnFailure
      containers:
        - name: task
          image: my-batch-task:v1
          resources:
            requests:
              cpu: 500m
              memory: 256Mi
            limits:
              cpu: 1
              memory: 1Gi
          env:
            - name: BATCH_SIZE
              value: "100"
```

## CronJob 概述

```
┌─────────────────────────────────────────────────────────────────────┐
│                      CronJob 执行时机                                  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                     CronJob                                     │  │
│  │  schedule: "0 3 * * *"                                       │  │
│  │  (每天凌晨 3:00 执行)                                          │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                              ↓                                       │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                       Job                                      │  │
│  │  CronJob 每次执行创建一个新 Job                               │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                              ↓                                       │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                       Pod                                     │  │
│  │  Job 管理 Pod 的执行                                        │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## CronJob 基本使用

### 最小配置

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: my-cronjob
spec:
  schedule: "0 3 * * *"      # Cron 表达式
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: task
              image: busybox
              command: ["sh", "-c", "echo Hello from CronJob!"]
```

### Cron 表达式格式

```yaml
# ┌───────────── 分钟 (0-59)
# │ ┌───────────── 小时 (0-23)
# │ │ ┌───────────── 日 (1-31)
# │ │ │ ┌───────────── 月 (1-12)
# │ │ │ │ ┌───────────── 星期 (0-6)
# │ │ │ │ │
# * * * * *

# 示例：
schedule: "0 3 * * *"        # 每天凌晨 3:00
schedule: "0 */2 * * *"      # 每 2 小时
schedule: "0 9-17 * * 1-5" # 工作日每小时
schedule: "*/15 * * * *"    # 每 15 分钟
schedule: "0 0 1 * *"       # 每月 1 日
schedule: "0 3 * * 0"       # 每周日凌晨 3:00
```

## 并发策略

### 禁止并发

```yaml
spec:
  concurrencyPolicy: Forbid  # 跳过新任务
```

### 替换并发

```yaml
spec:
  concurrencyPolicy: Replace  # 取消正在运行的任务，启动新的
```

### 允许并发（默认）

```yaml
spec:
  concurrencyPolicy: Allow  # 允许同时运行多个
```

### 完整配置

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: backup-cronjob
spec:
  # 执行计划
  schedule: "0 2 * * *"      # 每天凌晨 2:00
  timezone: Asia/Shanghai      # 时区

  # 并发策略
  concurrencyPolicy: Forbid   # 禁止并发

  # 失败策略
  failedJobsHistoryLimit: 3    # 保留最近 3 个失败 Job
  successfulJobsHistoryLimit: 5  # 保留最近 5 个成功 Job

  # 起始截止时间
  startingDeadlineSeconds: 200  # 如果错过执行，200 秒内仍可执行

  jobTemplate:
    spec:
      ttlSecondsAfterFinished: 3600  # 完成后 1 小时清理
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: backup
              image: mysql:8.0
              command:
                - bash
                - -c
                - |
                  # 备份数据库
                  mysqldump -h mysql \
                    -u root -p$MYSQL_ROOT_PASSWORD \
                    --all-databases \
                    | gzip > /backup/backup-$(date +%Y%m%d%H%M%S).sql.gz
                  # 清理 7 天前的备份
                  find /backup -name "*.sql.gz" -mtime +7 -delete
              env:
                - name: MYSQL_ROOT_PASSWORD
                  valueFrom:
                    secretKeyRef:
                      name: mysql-secret
                      key: password
              volumeMounts:
                - name: backup
                  mountPath: /backup
          volumes:
            - name: backup
              persistentVolumeClaim:
                claimName: backup-pvc
```

## 常见使用场景

### 场景1：数据库备份

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: mysql-backup
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: backup-sa
          restartPolicy: OnFailure
          containers:
            - name: backup
              image: mysql:8.0
              command:
                - bash
                - -c
                - |
                  DATE=$(date +%Y%m%d%H%M%S)
                  mysqldump -h mysql.default.svc.cluster.local \
                    -u root -p$MYSQL_ROOT_PASSWORD \
                    --all-databases \
                    > /backup/mysql-backup-$DATE.sql
              env:
                - name: MYSQL_ROOT_PASSWORD
                  valueFrom:
                    secretKeyRef:
                      name: mysql-secret
                      key: password
              volumeMounts:
                - name: backup
                  mountPath: /backup
          volumes:
            - name: backup
              persistentVolumeClaim:
                claimName: mysql-backup-pvc
```

### 场景2：日志清理

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: log-cleanup
spec:
  schedule: "0 3 * * 0"  # 每周日凌晨 3:00
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: cleanup
              image: busybox
              command:
                - sh
                - -c
                - |
                  # 清理 30 天前的日志
                  find /var/log -name "*.log" -mtime +30 -delete
                  # 清理 Kubernetes 事件
                  kubectl delete events --all -A --older-than 168h
```

### 场景3：数据导入

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: data-import
spec:
  parallelism: 4
  completions: 100
  template:
    spec:
      restartPolicy: OnFailure
      containers:
        - name: importer
          image: data-importer:v1
          command:
            - sh
            - -c
            - |
              ITEM=$((JOB_COMPLETION_INDEX + 1))
              echo "Importing batch $ITEM"
              ./import-data.sh $ITEM
          env:
            - name: JOB_COMPLETION_INDEX
              valueFrom:
                fieldRef:
                  fieldPath: metadata.annotations['batch.kubernetes.io/job-completion-index']
```

## 监控和调试

### 查看 Job 状态

```bash
# 查看 Job
kubectl get job

# 查看 Job 详情
kubectl describe job my-job

# 查看 Pod 日志
kubectl logs job/my-job
kubectl logs pod/my-job-xxx
```

### 常见状态

```bash
# Active：正在运行
# Succeeded：成功完成
# Failed：失败

kubectl get job

# 输出：
# NAME       DESIRED   SUCCESSFUL   FAILED   AGE
# my-job     4         3           1        10m
```

### 调试失败

```bash
# 查看失败 Pod
kubectl get pods | grep my-job | grep Failed

# 查看失败原因
kubectl describe pod my-job-xxx

# 查看日志
kubectl logs my-job-xxx --previous
```

## 最佳实践

### 1. 设置资源限制

```yaml
# 防止 Job 耗尽集群资源
resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 512Mi
```

### 2. 配置重试策略

```yaml
# 根据任务特性设置重试
spec:
  backoffLimit: 5      # 允许更多重试
  activeDeadlineSeconds: 3600  # 1 小时超时
```

### 3. 清理策略

```yaml
# 防止 Job 堆积
spec:
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 1
  ttlSecondsAfterFinished: 86400  # 1 天后清理
```

### 4. 使用 ServiceAccount

```yaml
# Job 需要访问其他资源时
spec:
  template:
    spec:
      serviceAccountName: backup-sa
```

## 面试追问

1. **Job 和 Deployment 的核心区别是什么？各自适合什么场景？**
2. **Job 的 completions 和 parallelism 有什么区别？**
3. **如果 Job 执行失败，Kubernetes 会怎么处理？**
4. **CronJob 的 concurrencyPolicy 有哪些选项？各自的行为是什么？**
5. **如果 CronJob 错过执行时间，会发生什么？如何处理？**

> "Job 和 CronJob 是 Kubernetes 处理批处理任务的机制。理解它们的并行度、重试策略、并发控制，是可靠运行批处理任务的关键。记住：批处理任务也要有优雅的错误处理和重试机制。"
