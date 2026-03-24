# KubeSphere 蓝绿部署与滚动更新配置

「新版本上线，怎么做到用户无感知？」——蓝绿部署和滚动更新，两种策略各有适用场景。

KubeSphere 支持多种部署策略：滚动更新（Rolling Update）、蓝绿部署（Blue-Green）和金丝雀发布（Canary Release）。理解每种策略的优缺点，才能在实际场景中做出正确选择。

## 三种部署策略对比

```
┌─────────────────────────────────────────────────────────────────┐
│                    部署策略对比                                    │
│                                                                  │
│  滚动更新（Rolling Update）                                       │
│  ├── 逐步替换旧版本 Pod                                         │
│  ├── 始终有服务在线                                              │
│  ├── 资源占用少（一套 Pod）                                      │
│  ├── 适用：日常版本迭代                                          │
│  └── 局限：无法精确控制流量分配                                  │
│                                                                  │
│  蓝绿部署（Blue-Green）                                         │
│  ├── 两套完整环境（蓝=新，绿=旧）                                 │
│  ├── 一键切换流量                                               │
│  ├── 回滚极快（秒级）                                           │
│  ├── 资源占用多（两套 Pod）                                      │
│  ├── 适用：重大版本发布、需要快速回滚的场景                      │
│  └── 局限：双倍资源成本                                          │
│                                                                  │
│  金丝雀发布（Canary Release）                                    │
│  ├── 逐步增加新版本流量（5% → 20% → 100%）                    │
│  ├── 灰度验证降低风险                                           │
│  ├── 可基于 Header/权重路由                                     │
│  ├── 适用：新功能验证、A/B 测试                                  │
│  └── 局限：需要服务网格或负载均衡器支持                          │
└─────────────────────────────────────────────────────────────────┘
```

## 滚动更新

### K8s 原生滚动更新

```yaml
# KubeSphere 图形化部署会生成以下 YAML
# 滚动更新配置
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  namespace: my-project
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1           # 最大超出期望副本数
      maxUnavailable: 0       # 最大不可用 Pod 数
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
        version: v2.0.0
    spec:
      containers:
        - name: myapp
          image: harbor.example.com/project-a/myapp:v2.0.0
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 15
            periodSeconds: 20
```

### 滚动更新参数调优

```yaml
# 生产环境推荐配置
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1            # 或 "25%"（推荐）
      maxUnavailable: 0        # 保证服务能力不降级
# 解读：
# maxSurge: 1 + maxUnavailable: 0 = 最多 4 个 Pod（3+1）
# 旧 Pod 下线前，新 Pod 必须 Ready
# 如果 maxUnavailable: 1 → 最多 2 个 Pod 在线，服务能力降级
```

## 蓝绿部署

### 通过 Service 切换实现

```yaml
# 蓝绿部署的关键：两个 Deployment + 一个 Service
# 环境标签：blue（当前生产）/ green（新版本）
---
# Blue Deployment（旧版本）
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-blue
  namespace: my-project
  labels:
    app: myapp
    environment: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      slot: blue
  template:
    metadata:
      labels:
        app: myapp
        slot: blue
        version: v1.0.0
    spec:
      containers:
        - name: myapp
          image: harbor.example.com/project-a/myapp:v1.0.0

---
# Green Deployment（新版本）
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-green
  namespace: my-project
  labels:
    app: myapp
    environment: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
      slot: green
  template:
    metadata:
      labels:
        app: myapp
        slot: green
        version: v2.0.0
    spec:
      containers:
        - name: myapp
          image: harbor.example.com/project-a/myapp:v2.0.0

---
# Service（通过修改 selector.slot 切换）
apiVersion: v1
kind: Service
metadata:
  name: myapp
  namespace: my-project
spec:
  type: ClusterIP
  selector:
    app: myapp
    slot: blue    # 切换为 green 则流量切到新版本
  ports:
    - port: 80
      targetPort: 8080
```

### KubeSphere 蓝绿部署流程

```
步骤：
1. 部署蓝版本（当前生产）
   → myapp-blue:v1.0.0，3 副本
   → Service selector.slot: blue

2. 验证绿版本（不影响生产）
   → myapp-green:v2.0.0，3 副本
   → Service selector.slot: blue（生产流量不打过来）

3. 测试绿版本
   → 临时修改 Service selector.slot: green
   → 测试完成后改回 selector.slot: blue

4. 切换流量（蓝绿切换）
   → 修改 Service selector.slot: green
   → 立即生效，流量全部切换到 v2.0.0

5. 回滚（如有问题）
   → 修改 Service selector.slot: blue
   → 立即回滚，v1.0.0 仍在线

6. 清理
   → 删除 myapp-blue Deployment（v1.0.0）
```

## 金丝雀发布（Canary Release）

### 基于服务网格实现

```yaml
# 金丝雀发布：80% 流量到 v1，20% 到 v2
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: myapp
  namespace: my-project
spec:
  hosts:
    - myapp
  http:
    - route:
        - destination:
            host: myapp
            subset: v1
          weight: 80
        - destination:
            host: myapp
            subset: v2
          weight: 20

---
apiVersion: networking.istio.io/v1alpha3
kind: DestinationRule
metadata:
  name: myapp
spec:
  host: myapp
  subsets:
    - name: v1
      labels:
        version: v1.0.0
    - name: v2
      labels:
        version: v2.0.0
```

### 基于权重的渐进式发布

```yaml
# 渐进式增加流量：先 5%，再 20%，最后 100%
# 阶段一：5% 流量到新版本
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: myapp
spec:
  http:
    - route:
        - destination:
            host: myapp
            subset: v1
          weight: 95
        - destination:
            host: myapp
            subset: v2
          weight: 5

# 观察 30 分钟，无异常后进入下一阶段
# 阶段二：20% 流量到新版本
---
spec:
  http:
    - route:
        - destination:
            host: myapp
            subset: v1
          weight: 80
        - destination:
            host: myapp
            subset: v2
          weight: 20

# 阶段三：50% 流量
---
spec:
  http:
    - route:
        - destination:
            host: myapp
            subset: v1
          weight: 50
        - destination:
            host: myapp
            subset: v2
          weight: 50

# 阶段四：100% 流量
---
spec:
  http:
    - route:
        - destination:
            host: myapp
            subset: v2
          weight: 100
```

### 基于 Header 的金丝雀

```yaml
# Header 带有 x-insider=true 的用户访问新版本
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: myapp
spec:
  hosts:
    - myapp
  http:
    # 内部用户走新版本
    - match:
        - headers:
            x-insider:
              exact: "true"
      route:
        - destination:
            host: myapp
            subset: v2
    # 其他用户走旧版本
    - route:
        - destination:
            host: myapp
            subset: v1
```

## KubeSphere 图形化配置

### 滚动更新配置

```
在 KubeSphere 控制台部署应用时：
1. 选择镜像 → 配置副本数
2. 高级设置 → 更新策略
   - 类型：滚动更新（RollingUpdate）
   - 最大 Surge：1（可设置为百分比或具体数值）
   - 最大不可用：0（推荐，保证服务能力）
3. 配置健康检查（重要！影响滚动更新进程）
   - 就绪检查（Readiness Probe）：新 Pod Ready 后才接收流量
   - 存活检查（Liveness Probe）：新 Pod 不健康则重启
4. 部署
```

### 蓝绿部署配置

```
在 KubeSphere 控制台：
1. 部署蓝版本
   → 工作负载名称：myapp-blue
   → 版本标签：slot=blue
   → 配置 Service selector.slot=blue

2. 部署绿版本
   → 工作负载名称：myapp-green
   → 版本标签：slot=green
   → 暂不修改 Service

3. 测试绿版本
   → 临时修改 Service selector.slot=green
   → 测试完成后改回 slot=blue

4. 正式切换
   → 修改 Service selector.slot=green
```

## 回滚策略

### 滚动更新回滚

```bash
# 通过 kubectl 回滚
kubectl rollout undo deployment/myapp -n my-project
# 回滚到上一个版本

kubectl rollout undo deployment/myapp -n my-project --to-revision=3
# 回滚到第 3 个版本

# 查看历史版本
kubectl rollout history deployment/myapp -n my-project

# 暂停滚动更新
kubectl rollout pause deployment/myapp -n my-project

# 恢复滚动更新
kubectl rollout resume deployment/myapp -n my-project
```

### 蓝绿部署回滚

```bash
# 蓝绿部署回滚：改 Service selector
# 从 green 切回 blue
kubectl patch service myapp -n my-project -p '{"spec":{"selector":{"slot":"blue"}}}'

# 回滚完成，秒级生效
# green 版本仍在线，随时可切回
```

## 最佳实践

### 部署前的检查清单

```
┌─────────────────────────────────────────────────────────────────┐
│                    部署前检查清单                                  │
│                                                                  │
│  功能检查                                                        │
│  □ 新版本代码已通过所有单元测试                                  │
│  □ SonarQube 无阻塞性问题                                       │
│  □ 镜像安全扫描无 CRITICAL 漏洞                                  │
│  □ 数据库迁移脚本已准备好（如果需要）                             │
│                                                                  │
│  配置检查                                                        │
│  □ 镜像 Tag 正确                                               │
│  □ 环境变量配置正确（ConfigMap/Secret）                          │
│  □ 资源限制配置合理                                             │
│  □ 健康检查路径和端口正确                                         │
│                                                                  │
│  监控准备                                                        │
│  □ 告警规则已配置（新版本异常告警）                              │
│  □ Dashboard 已准备（对比新旧版本指标）                           │
│  □ 日志查询已配置（新版本标签）                                  │
│                                                                  │
│  回滚准备                                                        │
│  □ 上一个版本的镜像已保留                                         │
│  □ 回滚步骤已确认（滚动更新无需额外准备）                        │
└─────────────────────────────────────────────────────────────────┘
```

### 部署时的监控

```bash
# 滚动更新过程中重点监控
# 1. Pod 状态
kubectl get pods -n my-project -w

# 2. 服务可用性
kubectl get endpoints myapp -n my-project

# 3. 错误率（观察 5 分钟内是否有 5xx）
# 在 Grafana 监控面板中观察
# - HTTP Request Error Rate
# - HTTP Request Duration P99
# - Pod Restart Count

# 4. 自动回滚（如果错误率突增）
# KubeSphere 支持配置自动回滚阈值
```

## 面试追问方向

1. **滚动更新时，为什么 maxUnavailable 要设为 0？**
   答：`maxUnavailable: 0` 意味着旧 Pod 下线前，新 Pod 必须完全 Ready 才能接收流量。配合 `maxSurge: 1`，系统最多有 4 个 Pod（3 个正常 + 1 个滚动中），服务能力不降级。如果设为 `maxUnavailable: 1`，最多只有 2 个 Pod 在线，服务能力降级，可能影响用户体验。

2. **蓝绿部署和滚动更新各自适用什么场景？**
   答：滚动更新适合日常迭代（资源利用率高，自动化程度高）。蓝绿部署适合：1) 重大版本，不想冒险滚动更新；2) 需要快速回滚的场景（秒级）；3) 数据库 schema 变更场景（蓝绿可以双写一段时间）。金丝雀适合：1) 新功能灰度验证；2) A/B 测试；3) 降低重大发布的风险。

3. **如何实现自动回滚？**
   答：常见方式：1) K8s 原生不支持自动回滚，但可以通过监控 + 脚本实现（Prometheus 告警 → 触发 kubectl rollout undo）；2) Argo Rollouts 支持更高级的自动回滚策略（基于金丝雀分析的自动回滚）；3) 自定义监控指标（错误率、延迟）触发回滚脚本。

> "部署策略没有最优解，只有最适合当前场景的选择。日常迭代用滚动更新，重大版本用蓝绿，金丝雀用于验证。三种策略配合使用，才是生产环境的最佳实践。"
