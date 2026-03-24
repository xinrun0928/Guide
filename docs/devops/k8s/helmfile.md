# Helmfile 与 GitOps 工作流

「几十个 Helm Chart 怎么统一管理？」——Helmfile 让多 Chart 协同变得可控。

当你的集群从一个应用扩展到几十个微服务，每个微服务都是一个 Helm Chart，管理和部署就变得复杂起来。Helmfile 就是来解决这个问题的：它用一份声明式的配置文件，统一管理多个 Helm Release 的安装顺序、版本、values 覆盖和环境切换。

## Helmfile 是什么

Helmfile 是 Helm 的**声明式部署工具**。它将所有 Helm Release 的配置集中到一个 `helmfile.yaml` 中，通过环境变量和条件判断，实现不同环境（dev/staging/prod）的差异化配置。

```
传统方式（难以维护）：
release-a/
  helm install release-a ...
release-b/
  helm install release-b ...
# ... 几十个脚本，难以统一管理

Helmfile 方式（声明式）：
helmfile.yaml
  → 定义所有 release
  → 定义所有环境
  → 一条命令同步所有变更
```

## 基本用法

### 安装

```bash
# Linux/macOS
curl -fsSL https://raw.githubusercontent.com/roboll/helmfile/main/get_helmfile | bash

# Homebrew
brew install helmfile

# 验证
helmfile --version
```

### 基础配置

```yaml
# helmfile.yaml
repositories:
  - name: bitnami
    url: https://charts.bitnami.com/bitnami
  - name: prometheus-community
    url: https://prometheus-community.github.io/helm-charts
  - name: ingress-nginx
    url: https://kubernetes.github.io/ingress-nginx

releases:
  # 第一个 release
  - name: nginx
    namespace: default
    chart: bitnami/nginx
    values:
      - values/nginx.yaml
    set:
      - name: service.type
        value: ClusterIP

  # 第二个 release
  - name: prometheus
    namespace: monitoring
    chart: prometheus-community/prometheus
    values:
      - values/prometheus.yaml
    needs:
      - nginx   # 依赖 nginx 先安装
```

```bash
# 常用命令
helmfile apply          # 同步到集群（相当于 diff + apply）
helmfile diff           # 查看将要变更的内容
helmfile sync           # 同步（不带 diff）
helmfile status         # 查看 Release 状态
helmfile destroy        # 删除所有 Release
helmfile lint           # 语法检查
```

## 环境管理

Helmfile 支持多环境配置，这是它最强大的特性之一。

### 默认环境 + 值覆盖

```yaml
# helmfile.yaml
repositories:
  - name: bitnami
    url: https://charts.bitnami.com/bitnami

environments:
  development:
  staging:
  production:

releases:
  - name: myapp
    namespace: {{ .Environment.Name }}
    chart: ./charts/myapp
    values:
      - values/{{ .Environment.Name }}/myapp.yaml
      - values/{{ .Environment.Name }}/myapp-secrets.yaml.gpg  # GPG 加密敏感配置
    set:
      - name: replicaCount
        value: 1
        # 通过环境变量动态设置值
        env: REPLICA_COUNT
```

```yaml
# values/development/myapp.yaml
replicaCount: 1
image:
  tag: "dev-latest"
resources:
  limits:
    memory: 512Mi
    cpu: 200m

# values/production/myapp.yaml
replicaCount: 5
image:
  tag: "v1.2.3"
resources:
  limits:
    memory: 2Gi
    cpu: 2000m
```

```bash
# 在不同环境中执行
helmfile --environment development apply
helmfile --environment staging diff
helmfile --environment production apply
```

### 默认值与条件渲染

```yaml
releases:
  - name: myapp
    chart: ./charts/myapp
    values:
      # 默认值（所有环境生效）
      - values/common.yaml
      # 环境特定值（不存在时跳过）
      - values/{{ .Environment.Name }}/specific.yaml
    # 生产环境额外配置
    {{- if eq .Environment.Name "production" }}
    set:
      - name: persistence.enabled
        value: true
    {{- end }}
```

## Release 高级配置

### 条件发布

```yaml
releases:
  # 只在生产环境发布
  - name: payment-gateway
    chart: ./charts/payment
    installed: {{ eq .Environment.Name "production" }}

  # 通过变量控制开关
  - name: new-feature
    chart: ./charts/new-feature
    installed: {{ .Values.enableNewFeature | default false }}

  # GitOps 模式下可由外部触发
  - name: canary-deployment
    chart: ./charts/myapp
    installed: {{ .Values.enableCanary | default false }}
    values:
      - values/canary.yaml
```

### 依赖管理（needs）

```yaml
releases:
  # 依赖必须在被依赖者之后安装
  - name: monitoring
    namespace: monitoring
    chart: prometheus-community/kube-prometheus-stack
    needs:
      - ingress-nginx/ingress-nginx

  - name: logging
    namespace: logging
    chart: grafana/loki-stack
    needs:
      - monitoring/prometheus

  - name: myapp
    namespace: default
    chart: ./charts/myapp
    needs:
      - monitoring/prometheus      # 需要 Prometheus 做监控
      - logging/loki               # 需要 Loki 做日志
      - ingress-nginx/ingress-nginx
```

### Secret 管理（GPG 加密）

```bash
# 安装 helm-secrets 插件
helm plugin install https://github.com/jkroepke/helm-secrets

# 加密 values 文件
sops --encrypt --in-place values/production/secrets.yaml

# helmfile.yaml 中引用
releases:
  - name: myapp
    values:
      - values/production/secrets.yaml
```

## 多集群管理

Helmfile 可以通过目录结构管理多个集群的配置：

```
project/
├── helmfile.yaml              # 根配置（引入子目录）
├── clusters/
│   ├── prod/
│   │   ├── helmfile.yaml      # 生产集群配置
│   │   └── values/
│   ├── staging/
│   │   ├── helmfile.yaml
│   │   └── values/
│   └── dev/
│       ├── helmfile.yaml
│       └── values/
└── charts/
    ├── myapp/
    └── backend/
```

```yaml
# clusters/prod/helmfile.yaml
bases:
  - ../../base.yaml  # 引入公共配置

environments:
  production:
    values:
      - environment: production

releases:
  - name: myapp
    chart: ../../charts/myapp
    values:
      - ./values/myapp.yaml
```

```bash
# 在对应目录下执行
cd clusters/prod
helmfile apply

# 或者通过环境变量指定
HELMFILE_CLUSTER=prod helmfile apply
```

## 与 ArgoCD 集成（GitOps）

Helmfile 是 GitOps 工作流的理想选择，配合 ArgoCD 实现声明式部署：

```yaml
# GitOps 工作流
# 1. 开发者在 Git 中修改 helmfile.yaml 或 values
# 2. ArgoCD 检测到 Git 变化
# 3. ArgoCD 执行 helmfile sync
# 4. 集群状态与 Git 声明一致
```

```yaml
# ArgoCD Application 配置
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp-helmfile
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/k8s-config.git
    targetRevision: main
    path: clusters/prod
  destination:
    server: https://kubernetes.default.svc
    namespace: default
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

## 完整示例

```yaml
# helmfile.yaml
---
 repositories:
  - name: bitnami
    url: https://charts.bitnami.com/bitnami
  - name: ingress-nginx
    url: https://kubernetes.github.io/ingress-nginx
  - name: cert-manager
    url: https://charts.jetstack.io

 environments:
  development:
  staging:
  production:

 commonLabels:
   managed-by: helmfile
   team: platform

 releases:
   # Nginx Ingress Controller
   - name: ingress-nginx
     namespace: ingress-nginx
     chart: ingress-nginx/ingress-nginx
     version: "4.7.0"
     values:
       - values/ingress.yaml
     set:
       - name: controller.replicaCount
         value: {{ .Values.ingress.replicaCount | default 1 }}

   # Cert Manager
   - name: cert-manager
     namespace: cert-manager
     chart: cert-manager/cert-manager
     version: "1.13.0"
     values:
       - values/certmanager.yaml
     needs:
       - ingress-nginx/ingress-nginx

   # 应用 A
   - name: frontend
     namespace: {{ .Environment.Name }}
     chart: ./charts/frontend
     values:
       - values/{{ .Environment.Name }}/frontend.yaml
     needs:
       - ingress-nginx/ingress-nginx
       - cert-manager/cert-manager

   # 应用 B
   - name: backend
     namespace: {{ .Environment.Name }}
     chart: ./charts/backend
     values:
       - values/{{ .Environment.Name }}/backend.yaml
```

## 常见错误

```bash
# 错误一：循环依赖
# A needs B, B needs C, C needs A → helmfile 报错
# 解决：重新设计依赖关系，移除循环

# 错误二：Release 找不到
# Error: repo "xxx" is not registered
# 解决：确保 repositories 中定义了所有使用的 chart 源

# 错误三：namespace 不存在
# 解决：配合 helmfile hooks 自动创建 namespace
  - name: ensure-namespace
    # hook: prepare
    # 使用 kubectl create ns 或 helm-namespace 插件

# 错误四：Helm 状态漂移
# helmfile 管理的 Release 被手动修改
# 解决：
# 1. 只使用 helmfile 操作，不手动 helm upgrade
# 2. 使用 --reset-values 强制同步
# helmfile apply --reset-values
```

## 与 Kustomize 的对比

| 维度 | Helmfile | Kustomize |
|------|---------|-----------|
| 基础 | Helm Chart | 原生 K8s YAML |
| 模板化 | 支持（Go 模板） | 支持（Overlay） |
| 依赖管理 | 内置（`needs`） | 需要额外工具 |
| 多环境 | 内置（Environment） | Overlay 机制 |
| 生态 | 大量 Chart 复用 | 社区 Chart 较少 |
| 学习曲线 | 中等（Helm + YAML） | 较低（纯 YAML） |
| Secret 管理 | helm-secrets | Kustomize sealed-secrets |

> "Helmfile 的价值在于『规模化』。当你的 Helm Chart 数量从 5 个增长到 50 个，手动管理变成了一场噩梦时，Helmfile 用一份声明式配置，让你重新掌控所有 Release 的部署状态。"
