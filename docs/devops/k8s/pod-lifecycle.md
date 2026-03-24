# Pod 生命周期与容器状态

Pod 从创建到销毁，经历了哪些状态？容器为什么会重启？为什么 Pod 一直处于 Pending 状态？

理解 Pod 的生命周期，是排查 K8s 问题的关键。

## Pod 的生命周期

Pod 的生命周期分为几个阶段：

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Pod 生命周期                                  │
│                                                                     │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐          │
│  │ Pending │───→│ Running │───→│ Succeeded│───→│ Terminated│        │
│  └─────────┘    └────┬────┘    └─────────┘    └─────────┘          │
│                      │                                             │
│                      ↓                                             │
│                 ┌─────────┐                                        │
│                 │ Failed  │───────────────────────────────→          │
│                 └─────────┘                                        │
│                                                                     │
│  ┌─────────┐                                                       │
│  │ Unknown │───────────────────────────────────────────→            │
│  └─────────┘                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 生命周期阶段

| 阶段 | 说明 |
|------|------|
| **Pending** | Pod 已被 K8s 系统接受，但镜像尚未创建或所有容器未启动 |
| **Running** | Pod 已绑定到节点，至少有一个容器正在运行 |
| **Succeeded** | Pod 中所有容器已成功终止，不会重启 |
| **Failed** | Pod 中所有容器已终止，至少有一个以非零状态退出 |
| **Unknown** | 无法获取 Pod 状态，通常是节点通信问题 |

## 容器状态

Pod 内的每个容器都有独立的状态：

```bash
kubectl get pod <pod-name> -o jsonpath='{.status.containerStatuses[*]}'

# 输出示例：
# {
#   "name": "nginx",
#   "state": {
#     "running": {
#       "startedAt": "2024-01-01T10:00:00Z"
#     }
#   },
#   "lastState": {},
#   "ready": true,
#   "restartCount": 0
# }
```

### 容器状态详解

```bash
# 查看容器详细状态
kubectl describe pod <pod-name>

# 状态字段说明
kubectl get pod <pod-name> -o yaml | grep -A 10 "containerStatuses"
```

| 状态 | 说明 |
|------|------|
| **Waiting** | 容器未运行，正在等待启动所需条件 |
| **Running** | 容器正在执行，没有问题 |
| **Terminated** | 容器已完成执行，正常或异常退出 |

### lastState 和 restartCount

```bash
# 如果容器正在重启，lastState 会显示之前的退出信息
kubectl describe pod <pod-name> | grep -A 10 "Last State"

# 输出示例：
# Last State:     Terminated
#   Reason:       OOMKilled
#   Exit Code:    137
#   Started:      Mon, 01 Jan 2024 09:00:00 +0000
#   Finished:     Mon, 01 Jan 2024 09:30:00 +0000
```

## Pod 启动流程

Pod 的创建经过多个步骤：

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Pod 创建流程                                   │
│                                                                     │
│  1. 用户提交 YAML（kubectl apply）                                  │
│       ↓                                                             │
│  2. API Server 存储到 etcd                                          │
│       ↓                                                             │
│  3. Scheduler 预选（Filtering）                                      │
│       - 资源是否足够？                                               │
│       - 污点/容忍是否匹配？                                          │
│       - 亲和性/反亲和性是否满足？                                      │
│       ↓                                                             │
│  4. Scheduler 优选（Scoring）                                       │
│       - 节点评分排序                                                 │
│       - 选择得分最高的节点                                            │
│       ↓                                                             │
│  5. Scheduler 绑定 Pod 到节点                                        │
│       ↓                                                             │
│  6. kubelet 收到调度指令                                            │
│       ↓                                                             │
│  7. kubelet 创建 Pod 沙箱（如使用 CRI-O）                           │
│       ↓                                                             │
│  8. 拉取容器镜像                                                   │
│       ↓                                                             │
│  9. 创建容器                                                       │
│       ↓                                                             │
│  10. 启动容器                                                       │
│       ↓                                                             │
│  11. 启动后置处理器（如 init container）                             │
│       ↓                                                             │
│  12. 报告 Pod 状态为 Running                                        │
└─────────────────────────────────────────────────────────────────────┘
```

## Init Container

Init 容器在 Pod 主容器启动前运行，常用于：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp-pod
spec:
  initContainers:
    - name: init-myservice
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          echo "Waiting for database service..."
          until nslookup mydb; do
            echo "Database not ready, waiting..."
            sleep 2
          done
          echo "Database is ready!"
    - name: init-migrations
      image: myapp:latest
      command: ["./run-migrations.sh"]
  containers:
    - name: myapp
      image: myapp:latest
      ports:
        - containerPort: 8080
```

```bash
# 查看 Init 容器状态
kubectl get pod myapp-pod -o jsonpath='{.spec.initContainers[*].name}'

# Init 容器日志
kubectl logs myapp-pod -c init-myservice

# Init 容器失败，Pod 不会启动
kubectl describe pod myapp-pod | grep -A 10 "Events"
# Type     Reason                  Age    From             Message
# ----     ------                  ----   ----             -------
# Normal   Scheduled               2m     default-scheduler  Successfully assigned default/myapp-pod to node-1
# Warning  Failed                  1m     kubelet           Init container init-myservice terminated with exit code 1
```

### Init Container 特点

- 总是按顺序执行，一个完成后才执行下一个
- 所有 Init 容器成功后，主容器才会启动
- 如果任一 Init 容器失败，Pod 会重启（restartPolicy 决定）
- Init 容器不支持健康检查（readinessProbe）

## 容器重启策略

Pod 级别的重启策略：

```yaml
spec:
  restartPolicy: Always  # 默认值
  # Always：容器退出后总是重启（适用于 Deployment）
  # OnFailure：容器以非零状态退出时才重启
  # Never：从不重启
```

```bash
# 示例场景
# restartPolicy: Always
kubectl exec myapp -- exit 1
# 容器会重启

# restartPolicy: OnFailure  
kubectl exec myapp -- exit 1
# 容器会重启（因为 exit code != 0）

kubectl exec myapp -- exit 0
# 容器不会重启

# restartPolicy: Never
kubectl exec myapp -- exit 1
# 容器不会重启，状态变为 Failed
```

## 常见问题排查

### Pod 一直处于 Pending

```bash
kubectl describe pod <pod-name> | grep -A 10 "Events"

# 可能原因：
# 1. 资源不足（CPU/内存）
# 2. 节点有污点，但 Pod 没有容忍
# 3. 没有满足条件的节点
# 4. PVC 未绑定

# 排查步骤
kubectl get nodes
kubectl describe nodes | grep -A 5 "Allocated resources"
kubectl get events --sort-by='.lastTimestamp' | tail -20
```

### Pod 一直处于 ContainerCreating

```bash
# 可能原因：
# 1. 镜像拉取失败
# 2. 依赖的 PVC 未挂载
# 3. CNI 网络插件问题

# 排查步骤
kubectl describe pod <pod-name>
kubectl get events | grep <pod-name>

# 查看镜像拉取状态
kubectl get pod <pod-name> -o jsonpath='{.status.containerStatuses[*].image}'
kubectl describe pod <pod-name> | grep -A 5 "Failed to pull image"
```

### 容器不断重启（CrashLoopBackOff）

```bash
# 查看容器重启次数
kubectl get pod <pod-name>
# RESTARTS 列显示重启次数

# 查看上次退出原因
kubectl describe pod <pod-name> | grep -A 5 "Last State"

# 查看容器日志
kubectl logs <pod-name> --previous

# 常见原因：
# 1. 应用启动失败（配置错误、依赖不可用）
# 2. 内存不足（OOMKilled）
# 3. 健康检查失败
```

### Pod 处于 Terminating

```bash
# 查看 Terminating 原因
kubectl describe pod <pod-name> | grep -A 10 "Events"

# 可能原因：
# 1. Finalizer 未清理
# 2. 钩子脚本卡住
# 3. 强制终止

# 强制删除（不推荐）
kubectl delete pod <pod-name> --grace-period=0 --force

# 查看是否有 Finalizer
kubectl get pod <pod-name> -o jsonpath='{.metadata.finalizers}'
```

## Pod 终止流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Pod 终止流程                                   │
│                                                                     │
│  1. API Server 接收到删除请求                                        │
│       ↓                                                             │
│  2. Pod 对象标记删除时间戳                                          │
│       ↓                                                             │
│  3. 端点控制器移除 Pod IP（Service 不再转发流量）                     │
│       ↓                                                             │
│  4. kubelet 收到终止信号                                            │
│       ↓                                                             │
│  5. 执行 preStop 钩子（如有）                                       │
│       ↓                                                             │
│  6. 发送 SIGTERM 信号给容器进程                                      │
│       ↓                                                             │
│  7. 等待terminationGracePeriodSeconds（默认 30 秒）                   │
│       ↓                                                             │
│  8. 发送 SIGKILL 信号给未终止的进程                                 │
│       ↓                                                             │
│  9. 容器终止完成                                                    │
│       ↓                                                             │
│  10. kubelet 报告 API Server                                         │
│       ↓                                                             │
│  11. API Server 删除 Pod 对象                                        │
└─────────────────────────────────────────────────────────────────────┘
```

### 优雅终止配置

```yaml
spec:
  terminationGracePeriodSeconds: 60  # 等待时间，可自定义

  containers:
    - name: nginx
      image: nginx:alpine
      lifecycle:
        preStop:
          exec:
            command: ["/bin/sh", "-c", "sleep 5"]  # 停止前等待
      terminationMessagePath: /dev/termination-log
```

## 面试追问

1. **Pod 的生命周期有哪些状态？Pending 和 ContainerCreating 有什么区别？**
2. **Init Container 和普通容器有什么区别？什么场景需要 Init Container？**
3. **容器不断重启是什么原因？怎么排查？**
4. **Pod 的终止流程是什么？terminationGracePeriodSeconds 是用来做什么的？**
5. **如何实现优雅终止，确保流量不丢失？**

> "理解 Pod 的生命周期，不只是为了面试，更是为了在 Pod 出问题时能快速定位原因。记住：Pending 是调度问题，ContainerCreating 是创建问题，CrashLoopBackOff 是运行问题，Terminating 是清理问题。"
