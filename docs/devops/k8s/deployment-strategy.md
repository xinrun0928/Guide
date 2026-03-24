# K8s 部署策略：滚动部署、蓝绿部署、金丝雀发布、灰度发布

「新版本上线，怎么做到用户无感知？」——这四种部署策略各有各的适用场景。

代码写完了，测试通过了，终于要上线了。但上线本身就是一个风险点：万一新版本有 bug 怎么办？直接替换所有实例，一挂全挂。Service Mesh 和 Ingress Controller 让复杂的部署策略成为可能，但理解每种策略的设计意图，才能选对工具。

## 四种部署策略全景对比

| 策略 | 核心思想 | 停机时间 | 资源占用 | 回滚速度 | 适用场景 |
|------|---------|---------|---------|---------|---------|
| 滚动部署 | 逐步替换 | 无 | 正常 | 较慢 | 无状态服务 |
| 蓝绿部署 | 双环境切换 | 无（需提前准备） | 2x | 最快（立即回切） | 有状态服务、数据库变更 |
| 金丝雀发布 | 小流量验证 | 无 | 少量额外 | 快 | 重大功能、机器学习模型 |
| 灰度发布 | 按比例渐进 | 无 | 少量额外 | 快 | 常规功能发布 |

## 滚动部署（Rolling Update）

K8s Deployment 的默认部署策略。逐步用新版本 Pod 替换旧版本 Pod，始终保持一定数量的 Pod 可用。

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1        # 最多超出期望副本数 1 个（额外准备好一个新 Pod）
      maxUnavailable: 0  # 始终保持 0 个不可用（保证服务不中断）
```

### 工作流程

```
初始状态：v1 v1 v1 v1 v1  (5个 Pod 全部为 v1)
    │
    ▼
第1步：创建 1 个 v2 Pod
    v1 v1 v1 v1 v1 [v2]  maxSurge=1，允许超配
    │
    ▼
第2步：终止 1 个 v1 Pod
    v2 v1 v1 v1 v1       maxUnavailable=0，仍有5个可用
    │
    ▼
第3步：创建第2个 v2 Pod
    v2 v1 v1 v1 [v2] v1
    │
    ▼
...
    │
    ▼
最终状态：v2 v2 v2 v2 v2  (5个 Pod 全部为 v2)
```

### 优点

- 无需双倍资源
- K8s 原生支持，无需额外工具
- 自动化完成

### 缺点

- 回滚速度慢（需要反向执行滚动）
- 无法控制流量比例
- 新旧版本同时存在，部分用户可能使用不稳定的新版本

## 蓝绿部署（Blue-Green Deployment）

准备两个完全相同的环境（蓝 = 当前生产，绿 = 新版本），上线时通过负载均衡器切换流量。

```
蓝绿部署：

日常状态：
┌──────────────────────────────────────────────────────────┐
│  负载均衡器                                                 │
│  │                                                       │
│  └──► Blue (v1) ●●●●●  ← 所有流量                       │
│       Green (v2) ●●●●●  ← 闲置，代码已部署              │
└──────────────────────────────────────────────────────────┘

上线时切换：
┌──────────────────────────────────────────────────────────┐
│  负载均衡器                                                 │
│  │                                                       │
│  └──► Blue (v1) ●●●●●  ← 保留，随时可回切               │
│       Green (v2) ●●●●●  ← 所有流量                       │
└──────────────────────────────────────────────────────────┘
```

### K8s 实现

```yaml
# Service 通过 label selector 指向目标版本
---
# Blue 环境（v1）
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-blue
spec:
  replicas: 5
  selector:
    matchLabels:
      app: myapp
      slot: blue
  template:
    metadata:
      labels:
        app: myapp
        slot: blue
        version: v1
---
# Green 环境（v2）
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-green
spec:
  replicas: 5
  selector:
    matchLabels:
      app: myapp
      slot: green
  template:
    metadata:
      labels:
        app: myapp
        slot: green
        version: v2
---
# Service 通过 slot 标签指向当前版本
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  selector:
    app: myapp
    slot: blue    # 切换这里实现蓝绿
  ports:
    - port: 80
      targetPort: 8080
```

### 优点

- 回滚速度极快（改 label 即可）
- 两套环境完整验证，切换零风险
- 适合有数据库变更的发布（先在 Green 环境做完数据迁移）

### 缺点

- 需要双倍资源（两个完整环境）
- 适合小团队的低频发布，不适合高频迭代

## 金丝雀发布（Canary Release）

将新版本暴露给一小部分用户（约 5-10%），验证无问题后再全量上线。

```
金丝雀发布：

┌──────────────────────────────────────────────────────────┐
│  负载均衡器                                                 │
│  │                                                       │
│  ├──► Stable (v1) ●●●●●●●●●●●●●●●●●●●●  ← 90% 流量   │
│  │                                                      │
│  └──► Canary (v2) ●  ← 10% 流量（新版本）               │
└──────────────────────────────────────────────────────────┘
```

### 实现方式

#### 1. Ingress + Nginx Ingress Controller

```yaml
# 主版本 Ingress（90% 流量）
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: myapp-v1
                port:
                  number: 80
---
# 金丝雀 Ingress（10% 流量）
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-canary
  annotations:
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "10"   # 10% 流量到 v2
    # nginx.ingress.kubernetes.io/canary-header: "X-Canary"  # 或按 Header
    # nginx.ingress.kubernetes.io/canary-cookie: "user"     # 或按 Cookie
spec:
  ingressClassName: nginx
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: myapp-v2
                port:
                  number: 80
```

#### 2. Istio VirtualService

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: myapp
spec:
  hosts:
    - myapp
  http:
    - route:
        - destination:
            host: myapp-v1
          weight: 90
        - destination:
            host: myapp-v2
          weight: 10
```

### 优点

- 风险可控（小流量验证）
- 可基于多维度分流（Header、Cookie、IP、地区）
- 真实用户验证，不只是测试环境

### 缺点

- 需要流量管理基础设施
- 金丝雀和稳定版本需要共存，对有状态服务有挑战
- 需要完善的监控告警体系来发现异常

## 灰度发布（Grey/Shadow Release）

灰度发布是金丝雀的变体，但**金丝雀版本会接收真实流量并执行，但不影响用户响应**（影子模式）。

```
┌──────────────────────────────────────────────────────────┐
│  用户请求                                                      │
│      │                                                       │
│      ├──► Stable (v1) ●●●●●●●●●●●●●●  ← 用户收到真实响应    │
│      │                                                      │
│      └──► Shadow (v2) ●  ← 请求被「复制」一份到 v2        │
│                                 v2 执行但响应被丢弃（不影响用户）│
└──────────────────────────────────────────────────────────┘
```

典型应用：
- **机器学习模型更新**：用真实流量验证新模型，但用户感知不到
- **数据库压力测试**：影子流量对数据库施加压力，但不影响实际业务
- **新功能灰度**：部分用户用新功能，但不影响其他用户体验

## 选型决策

```
发布频率低 / 有数据库变更 / 需要快速回滚
    │
    └──► 蓝绿部署（双环境，即时切换）

无状态服务 / 高频迭代 / 需要自动化
    │
    └──► 滚动部署（K8s 原生，最简单）

重大功能 / 需要真实用户验证 / 有完善的监控体系
    │
    └──► 金丝雀发布（按比例分流）

机器学习模型 / 数据库变更压力测试 / 新功能验证
    │
    └──► 灰度发布（影子流量）
```

## 面试追问方向

- 滚动部署中，`maxUnavailable: 0` 和 `maxSurge: 0` 有什么区别？各会导致什么问题？
- 蓝绿部署的「数据库迁移」问题怎么解决？（新版本加字段/表不影响旧版本）
- 金丝雀发布中，如何设计一个有效的金丝雀监控指标体系？
- 灰度发布和蓝绿部署的核心区别是什么？为什么说灰度对用户无感知？

> 部署策略没有最好的，只有最适合的。理解每种策略的代价（资源、时间、风险），才能在具体业务场景下做出正确选择。
