# Pod 健康检查：Liveness Probe、Readiness Probe、Startup Probe

你的应用启动需要 30 秒，但 Kubernetes 在 10 秒后就认为它失败了。Pod 明明还在运行，却收不到任何流量。

这些问题的根源，是你没有正确配置健康检查。

## 三种探针概述

```
┌─────────────────────────────────────────────────────────────────────┐
│                         K8s 健康检查体系                              │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Startup Probe（启动探针）                                    │  │
│  │  用途：判断应用是否启动完成                                     │  │
│  │  阶段：容器启动初期                                             │  │
│  │  状态：成功前，其他探针被禁用                                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Liveness Probe（存活探针）                                    │  │
│  │  用途：判断应用是否存活                                         │  │
│  │  阶段：应用运行期间                                            │  │
│  │  失败动作：重启容器                                             │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              ↓                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Readiness Probe（就绪探针）                                   │  │
│  │  用途：判断应用是否准备好接收流量                               │  │
│  │  阶段：应用运行期间                                            │  │
│  │  失败动作：从 Service 移除，不发送流量                           │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Liveness Probe：存活探针

Liveness Probe 检查应用是否「活着」。失败时，kubelet 会重启容器。

### HTTP 探针

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx
spec:
  containers:
    - name: nginx
      image: nginx:alpine
      livenessProbe:
        httpGet:
          path: /healthz
          port: 80
        initialDelaySeconds: 10    # 容器启动后等待 10 秒开始检查
        periodSeconds: 10           # 每 10 秒检查一次
        timeoutSeconds: 2          # 超时 2 秒算失败
        failureThreshold: 3         # 连续 3 次失败才重启
        successThreshold: 1         # 成功 1 次即恢复
```

### TCP 探针

```yaml
livenessProbe:
  tcpSocket:
    port: 8080
  initialDelaySeconds: 15
  periodSeconds: 20
```

### Exec 探针

```yaml
livenessProbe:
  exec:
    command:
      - cat
      - /tmp/healthy
  initialDelaySeconds: 5
  periodSeconds: 10
```

### Liveness 失败流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Liveness Probe 失败流程                            │
│                                                                     │
│  Pod 正常运行                                                      │
│       ↓                                                             │
│  Liveness Probe 执行 → 失败                                         │
│       ↓                                                             │
│  failureThreshold=3，连续失败 3 次                                  │
│       ↓                                                             │
│  kubelet 重启容器                                                   │
│       ↓                                                             │
│  Pod 重启计数 +1                                                   │
│       ↓                                                             │
│  restartCount 达到阈值？                                            │
│       ↓ 是                                                           │
│  Pod 进入 CrashLoopBackOff                                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Readiness Probe：就绪探针

Readiness Probe 检查应用是否「准备好接收流量」。失败时，Pod 从 Service 端点移除，不再接收流量。

### HTTP 探针

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx
spec:
  containers:
    - name: nginx
      image: nginx:alpine
      readinessProbe:
        httpGet:
          path: /ready
          port: 80
        initialDelaySeconds: 5
        periodSeconds: 5
        timeoutSeconds: 2
        failureThreshold: 3
```

### 就绪失败的影响

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Readiness Probe 失败的影响                           │
│                                                                     │
│  Pod A (Ready) ──┬──→ Service Endpoints ──→ 接收流量               │
│                   │                                                  │
│  Pod B (Not Ready) ─→ Service Endpoints ──→ 不接收流量              │
│                   │                                                  │
│  Pod C (Ready) ──┴──→ Service Endpoints ──→ 接收流量               │
│                                                                     │
│  结果：流量只发送到 Ready 的 Pod                                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 典型场景：应用需要预热

```yaml
# 应用启动需要加载数据、连接数据库
# 启动探针失败时，应该标记为 Not Ready
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  initialDelaySeconds: 30    # 等待应用初始化
  periodSeconds: 5
  failureThreshold: 5         # 5 次失败才标记为 Not Ready
```

## Startup Probe：启动探针

Startup Probe 用于慢启动应用，解决「启动时间过长」的问题。

### 问题背景

```
┌─────────────────────────────────────────────────────────────────────┐
│                        慢启动应用的问题                                │
│                                                                     │
│  Liveness Probe:                                                    │
│  initialDelaySeconds: 30                                            │
│       ↓                                                             │
│  容器启动                                                           │
│       ↓                                                             │
│  30 秒后开始检查                                                    │
│       ↓                                                             │
│  如果应用需要 45 秒启动...                                          │
│       ↓                                                             │
│  Liveness 失败 → 容器重启 → 永远启动不起来                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 解决方案：Startup Probe

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: slow-start-app
spec:
  containers:
    - name: app
      image: slow-app:latest
      startupProbe:
        httpGet:
          path: /started
          port: 8080
        failureThreshold: 30          # 最多检查 30 次
        periodSeconds: 10            # 每 10 秒检查一次
        timeoutSeconds: 5
        # 启动探针有 30*10=300 秒的超时时间
      livenessProbe:
        httpGet:
          path: /health
          port: 8080
        initialDelaySeconds: 0       # 启动探针成功后开始计算
        periodSeconds: 10
      readinessProbe:
        httpGet:
          path: /ready
          port: 8080
        initialDelaySeconds: 0
        periodSeconds: 5
```

### Startup Probe 工作流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Startup Probe 工作流程                              │
│                                                                     │
│  容器启动                                                           │
│       ↓                                                             │
│  Startup Probe 开始检查                                              │
│       ↓                                                             │
│  失败？→ 继续等待重试（最多 failureThreshold 次）                    │
│       ↓ 成功                                                         │
│  Startup Probe 成功                                                  │
│       ↓                                                             │
│  Liveness Probe 开始检查                                             │
│       ↓                                                             │
│  Readiness Probe 开始检查                                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 探针参数详解

| 参数 | 说明 | 建议值 |
|------|------|--------|
| `initialDelaySeconds` | 容器启动后多久开始检查 | Liveness: 10-30s<br>Readiness: 5-10s |
| `periodSeconds` | 检查频率 | 默认 10s，最小 1s |
| `timeoutSeconds` | 超时时间 | 1-5s |
| `failureThreshold` | 失败多少次后采取行动 | Liveness: 3<br>Startup: 30+ |
| `successThreshold` | 成功多少次后恢复 | 默认 1 |

## 常见应用配置

### Spring Boot 应用

```yaml
# Spring Boot Actuator
# 确保已添加 actuator 依赖
# application.yml 配置：
# management:
#   endpoints:
#     web:
#       exposure:
#         include: health,info,metrics
#   endpoint:
#     health:
#       show-details: when-authorized

apiVersion: apps/v1
kind: Deployment
metadata:
  name: spring-app
spec:
  template:
    spec:
      containers:
        - name: app
          image: spring-app:latest
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            initialDelaySeconds: 60
            periodSeconds: 15
```

### Nginx 应用

```yaml
# Nginx 需要配置健康检查端点
# nginx.conf:
# server {
#     listen 80;
#     location /health {
#         access_log off;
#         return 200 "OK";
#     }
# }

apiVersion: v1
kind: Pod
metadata:
  name: nginx
spec:
  containers:
    - name: nginx
      image: nginx:alpine
      readinessProbe:
        httpGet:
          path: /health
          port: 80
        initialDelaySeconds: 5
        periodSeconds: 5
      livenessProbe:
        httpGet:
          path: /health
          port: 80
        initialDelaySeconds: 15
        periodSeconds: 10
```

### 数据库应用

```yaml
# MySQL 健康检查
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: mysql
spec:
  template:
    spec:
      containers:
        - name: mysql
          image: mysql:8.0
          readinessProbe:
            exec:
              command:
                - mysqladmin
                - ping
                - -h
                - localhost
                - -u
                - root
                - -p$MYSQL_ROOT_PASSWORD
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 5
          livenessProbe:
            exec:
              command:
                - mysqladmin
                - ping
                - -h
                - localhost
            initialDelaySeconds: 60
            periodSeconds: 20
```

### Node.js 应用

```yaml
# Express.js 应用
# 需要添加健康检查路由
# app.get('/health', (req, res) => {
#   res.json({ status: 'ok' });
# });

apiVersion: v1
kind: Pod
metadata:
  name: nodejs-app
spec:
  containers:
    - name: app
      image: nodejs-app:latest
      readinessProbe:
        httpGet:
          path: /health/ready
          port: 3000
        initialDelaySeconds: 10
        periodSeconds: 5
      livenessProbe:
        httpGet:
          path: /health/live
          port: 3000
        initialDelaySeconds: 30
        periodSeconds: 10
```

## 常见问题与调试

### 问题1：探针导致频繁重启

```bash
# 原因：
# - initialDelaySeconds 设置太短
# - 应用启动需要 30 秒，但 initialDelaySeconds 只设置了 10 秒

# 解决：
# 1. 延长 initialDelaySeconds
# 2. 添加 Startup Probe
# 3. 检查应用日志
kubectl logs <pod-name>
kubectl describe pod <pod-name> | grep -A 10 "Liveness"

# 查看探针失败详情
kubectl get pod <pod-name> -o yaml | grep -A 10 "livenessProbe"
```

### 问题2：Pod 一直是 NotReady

```bash
# 原因：
# - Readiness Probe 持续失败
# - 应用未正确实现 /ready 端点

# 排查：
kubectl describe pod <pod-name> | grep -A 10 "Readiness"

# 手动测试探针
kubectl exec <pod-name> -- curl -s http://localhost:8080/ready

# 检查端点实现
kubectl exec <pod-name> -- wget -qO- http://localhost:8080/ready
```

### 问题3：探针超时

```yaml
# 如果应用响应慢，需要增加超时时间
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  timeoutSeconds: 10      # 增加超时时间
  failureThreshold: 5
  periodSeconds: 10
```

### 问题4：探针配置影响性能

```bash
# 如果频繁检查影响性能
# 1. 减少检查频率
# 2. 使用轻量级检查端点
# 3. 使用 TCP 探针代替 HTTP 探针

# 推荐：使用 TCP 探针（最轻量）
readinessProbe:
  tcpSocket:
    port: 8080
  periodSeconds: 30  # 低频检查
```

## 最佳实践

### 1. 总是配置探针

```yaml
# 建议为每个应用配置探针
# 不配置探针意味着 Kubernetes 无法知道应用状态
containers:
  - name: app
    image: app:latest
    readinessProbe:
      httpGet:
        path: /ready
        port: 8080
      initialDelaySeconds: 5
      periodSeconds: 5
    livenessProbe:
      httpGet:
        path: /health
        port: 8080
      initialDelaySeconds: 15
      periodSeconds: 10
```

### 2. 探针端点独立实现

```java
// 不要用同一个端点做两种检查
// 推荐：独立的健康检查端点

// Readiness：检查依赖（数据库、缓存）
// 只检查组件是否可用，不检查业务逻辑
@RestController
@RequestMapping("/actuator/health")
public class HealthController {

    @GetMapping("/readiness")
    public ResponseEntity<Map<String, String>> readiness() {
        Map<String, String> result = new HashMap<>();

        // 检查数据库连接
        if (!checkDatabaseConnection()) {
            return ResponseEntity.status(503)
                .body(Map.of("status", "DOWN", "database", "UNAVAILABLE"));
        }

        // 检查 Redis 连接
        if (!checkRedisConnection()) {
            return ResponseEntity.status(503)
                .body(Map.of("status", "DOWN", "redis", "UNAVAILABLE"));
        }

        return ResponseEntity.ok(Map.of("status", "UP"));
    }

    // Liveness：只检查进程是否存活
    // 如果这个端点失败，说明进程已死
    @GetMapping("/liveness")
    public ResponseEntity<Map<String, String>> liveness() {
        return ResponseEntity.ok(Map.of("status", "UP"));
    }
}
```

### 3. 合理的超时和重试

```yaml
# 合理配置超时和重试
# 避免网络抖动导致的误判
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  timeoutSeconds: 3      # 3 秒超时
  failureThreshold: 3    # 3 次失败才判定
  periodSeconds: 10       # 10 秒检查一次
```

## 面试追问

1. **Liveness Probe 和 Readiness Probe 的区别是什么？各自的失败动作是什么？**
2. **为什么需要 Startup Probe？它解决了什么问题？**
3. **如果 initialDelaySeconds 设置为 0 会发生什么？**
4. **Readiness Probe 失败的 Pod 会被重启吗？**
5. **如何调试探针问题？有哪些常用命令？**

> "健康检查配置不当是 K8s 生产环境的常见问题。设置太激进会导致频繁重启，设置太保守会导致流量损失。最佳实践是：理解每种探针的用途，合理配置 initialDelaySeconds，为慢启动应用使用 Startup Probe。"
