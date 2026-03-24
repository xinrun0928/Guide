# CI/CD 部署策略

「代码写好了，怎么上线？」——不同场景，需要不同的部署策略。

部署策略决定了应用从旧版本到新版本的切换方式。每种策略都有其适用场景：追求速度用滚动更新，追求安全用蓝绿部署，追求稳定用金丝雀……选错了策略，轻则用户受影响，重则故障回不去。

## 部署策略全景图

```
┌─────────────────────────────────────────────────────────────────┐
│                    部署策略对比                                   │
│                                                                  │
│  滚动更新 (Rolling Update)                                        │
│  └── 逐步替换 pod，对用户有影响但小                              │
│                                                                  │
│  蓝绿部署 (Blue/Green)                                           │
│  └── 两套环境，瞬间切换，回滚快                                   │
│                                                                  │
│  金丝雀发布 (Canary Release)                                     │
│  └── 小流量验证，逐步放大，风险可控                               │
│                                                                  │
│  灰度发布 (A/B Testing)                                          │
│  └── 按用户特征分流，验证假设                                     │
│                                                                  │
│  影子部署 (Shadow Release)                                       │
│  └── 新版本并行接收真实流量，但不返回给用户                       │
└─────────────────────────────────────────────────────────────────┘
```

## 滚动更新

最常用的部署方式，通过逐步替换实例实现不停机更新。

### Kubernetes 原生滚动更新

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: production
spec:
  replicas: 10
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%        # 最多超出期望实例数 25%（即最多 12.5 → 13）
      maxUnavailable: 25%  # 最多不可用实例数 25%（即最多 7.5 → 7）
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
        version: v2.0.0
    spec:
      containers:
      - name: my-app
        image: myregistry/my-app:v2.0.0
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

```bash
# 查看滚动更新过程
kubectl rollout status deployment/my-app -n production

# 滚动更新历史
kubectl rollout history deployment/my-app

# 回滚到上一个版本
kubectl rollout undo deployment/my-app

# 回滚到指定版本
kubectl rollout undo deployment/my-app --to-revision=3
```

### 滚动更新的问题

```
┌─────────────────────────────────────────────────────────────────┐
│                    滚动更新的坑                                   │
│                                                                  │
│  问题 1：旧版本和新版本同时存在，接口不兼容                        │
│  解决：API 版本控制，确保兼容性后再部署                           │
│                                                                  │
│  问题 2：流量分布不均（部分请求打到未就绪的新 pod）                │
│  解决：配置 readinessProbe，确保新 pod 完全就绪才接收流量         │
│                                                                  │
│  问题 3：数据库 schema 变更与代码不兼容                            │
│  解决：数据库变更必须在代码部署前完成，采用向后兼容的 schema       │
└─────────────────────────────────────────────────────────────────┘
```

## 蓝绿部署

准备两套完全相同的环境，通过切换流量实现瞬时部署和回滚。

### Kubernetes 蓝绿实现

```yaml
# blue-deployment.yaml (当前版本 v1.0.0)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app-blue
  namespace: production
spec:
  replicas: 10
  selector:
    matchLabels:
      app: my-app
      slot: blue
  template:
    metadata:
      labels:
        app: my-app
        slot: blue
        version: v1.0.0
    spec:
      containers:
      - name: my-app
        image: myregistry/my-app:v1.0.0
---
# Service 指向 blue
apiVersion: v1
kind: Service
metadata:
  name: my-app
  namespace: production
spec:
  selector:
    app: my-app
    slot: blue     # 指向 blue
  ports:
  - port: 80
    targetPort: 8080
```

```yaml
# green-deployment.yaml (新版本 v2.0.0)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app-green
  namespace: production
spec:
  replicas: 10
  selector:
    matchLabels:
      app: my-app
      slot: green
  template:
    metadata:
      labels:
        app: my-app
        slot: green
        version: v2.0.0
    spec:
      containers:
      - name: my-app
        image: myregistry/my-app:v2.0.0
```

```bash
# 1. 部署新版本（green）
kubectl apply -f green-deployment.yaml

# 2. 验证 green 环境正常
kubectl exec -it my-app-green-xxx -n production -- curl localhost:8080/health

# 3. 切换流量（修改 Service selector）
kubectl patch service my-app -n production \
  -p '{"spec":{"selector":{"slot":"green"}}}'

# 4. 观察流量
kubectl get pods -n production -l slot=green --watch

# 5. 回滚（切回 blue）
kubectl patch service my-app -n production \
  -p '{"spec":{"selector":{"slot":"blue"}}}'

# 6. 确认 blue 正常后，删除 green（可选）
kubectl delete deployment my-app-green -n production
```

### 蓝绿部署的特点

| 优点 | 缺点 |
|-----|------|
| 瞬时切换（几秒内） | 需要双倍资源（两套环境） |
| 回滚极快（改 Service selector 即可） | 不适合长时间并行（有状态服务） |
| 易于测试（新版本完全独立验证） | 数据库变更风险高（两套共用 DB） |
| 适合无状态服务 | 资源成本高 |

## 金丝雀发布

将新版本只推送给小部分用户，观察稳定后再全量发布。

### Kubernetes 金丝雀

```yaml
# 金丝雀版本（5% 流量）
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app-canary
  namespace: production
spec:
  replicas: 1  # 小比例
  selector:
    matchLabels:
      app: my-app
      track: canary
  template:
    metadata:
      labels:
        app: my-app
        track: canary
        version: v2.0.0
    spec:
      containers:
      - name: my-app
        image: myregistry/my-app:v2.0.0
---
# 稳定版本（95% 流量）
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app-stable
  namespace: production
spec:
  replicas: 20
  selector:
    matchLabels:
      app: my-app
      track: stable
  template:
    metadata:
      labels:
        app: my-app
        track: stable
        version: v1.0.0
    spec:
      containers:
      - name: my-app
        image: myregistry/my-app:v1.0.0
---
# Service 只路由到 stable，金丝雀通过 Ingress 手动引流
apiVersion: v1
kind: Service
metadata:
  name: my-app
  namespace: production
spec:
  selector:
    app: my-app
  ports:
  - port: 80
    targetPort: 8080
```

### Nginx Ingress 金丝雀

```yaml
# nginx.ingress.kubernetes.io/canary-weight: "5"
# 表示 5% 流量到金丝雀
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-canary
  namespace: production
  annotations:
    kubernetes.io/ingress.class: nginx
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-weight: "5"    # 5% 流量
    # 按请求头路由
    # nginx.ingress.kubernetes.io/canary-by-header: "X-Canary"
    # nginx.ingress.kubernetes.io/canary-by-header-value: "always"
spec:
  rules:
  - host: myapp.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: my-app-canary
            port:
              number: 80
```

### Argo Rollouts 金丝雀

```yaml
# argo-rollout.yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: my-app
  namespace: production
spec:
  replicas: 10
  strategy:
    canary:
      steps:
        - setWeight: 5       # 第1步：5% 流量
        - pause: {duration: 10m}  # 等待 10 分钟观察
        - setWeight: 20      # 第2步：20% 流量
        - pause: {duration: 10m}
        - setWeight: 50      # 第3步：50% 流量
        - pause: {duration: 10m}
        - setWeight: 100     # 全量
      analysis:
        templates:
          - templateName: success-rate
        startingStep: 1
        args:
          - name: service-name
            value: my-app-canary
      canaryMetadata:
        labels:
          track: canary
      stableMetadata:
        labels:
          track: stable
      trafficRouting:
        nginx:
          stableIngress: my-app-stable
          additionalIngressAnnotations:
            canary-by-weight: "true"
```

## A/B 测试

基于用户特征（地区、设备、Cookie）分流，用于验证产品假设。

```yaml
# 基于 Cookie 分流
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-b
  annotations:
    kubernetes.io/ingress.class: nginx
    nginx.ingress.kubernetes.io/canary: "true"
    nginx.ingress.kubernetes.io/canary-by-cookie: "user_type"
    nginx.ingress.kubernetes.io/canary-cookie-value: "premium"
spec:
  rules:
  - host: myapp.example.com
    http:
      paths:
      - path: /
        backend:
          service:
            name: my-app-premium
            port:
              number: 80
```

```java
// 后端按用户分流
@RestController
public class FeatureController {

    @GetMapping("/api/feature")
    public Map<String, Object> feature(HttpServletRequest request) {
        String userId = request.getHeader("X-User-ID");
        boolean inExperiment = hash(userId) % 100 < 20; // 20% 用户

        Map<String, Object> response = new HashMap<>();
        response.put("newCheckout", inExperiment);
        response.put("oldCheckout", !inExperiment);
        return response;
    }

    private int hash(String userId) {
        return userId.hashCode() & Integer.MAX_VALUE;
    }
}
```

## 部署策略对比

| 策略 | 资源成本 | 风险 | 回滚速度 | 适用场景 |
|------|---------|------|---------|---------|
| 滚动更新 | 低 | 中 | 快 | 无状态服务，常规发布 |
| 蓝绿部署 | 高 | 低 | 秒级 | 关键业务，需要快速回滚 |
| 金丝雀 | 中 | 低 | 较快 | 大规模服务，重要功能 |
| A/B 测试 | 中 | 低 | 较快 | 产品功能验证 |
| 影子部署 | 高 | 极低 | 秒级 | 高风险变更，数据验证 |

## 面试追问方向

1. **蓝绿部署和滚动更新的本质区别是什么？**
   答：蓝绿是两套完全独立的环境，通过切换流量实现切换，资源翻倍但切换快；滚动更新是在同一套环境里逐步替换实例，资源不翻倍但切换需要时间。蓝绿适合需要快速回滚的场景，滚动适合资源受限的场景。

2. **金丝雀发布如何控制流量比例？**
   答：主流方案有三种——Service/Deployment 副本数比例（如 1:20 即 ~5%）、Ingress/Service Mesh 按权重分流（如 Envoy 的 `weighted` 路由）、染色标签 + 路由规则（按 Header/Cookie 精确控制）。

3. **数据库变更如何在不停机的情况下完成？**
   答：使用扩展变更法（Expand-Migrate-Shrink）：第一步扩展——添加新字段（允许 NULL，default NULL）；第二步迁移——代码写入双写，读旧字段写新字段，后台逐步迁移数据；第三步收缩——删除旧字段和双写逻辑。关键是所有变更都是「向后兼容」的。

4. **Argo Rollouts 和 Flagger 怎么选？**
   答：Argo Rollouts 和 ArgoCD 同属 Akuity，集成更好，适合 GitOps 流水线；Flagger 支持 Flux、Istio、App Mesh、SLI 指标，更灵活。如果已用 ArgoCD，Argo Rollouts 是自然选择。

部署策略不是非此即彼的选择，而是根据业务场景灵活组合的过程。
