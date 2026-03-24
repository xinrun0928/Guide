# KubeSphere 权限管理：用户、角色、ClusterRoleBinding

「谁可以部署应用？谁可以管理集群？」——KubeSphere 的权限管理体系让你轻松掌控。

KubeSphere 的权限管理建立在 Kubernetes RBAC 之上，同时提供了一层更易用的多租户抽象。理解这套体系，是安全运维的前提。

## 权限模型总览

```
┌─────────────────────────────────────────────────────────────────┐
│                    KubeSphere 权限模型                              │
│                                                                  │
│  身份（Identity）                                               │
│  └── 用户（User）← 登录凭证                                      │
│          │                                                        │
│          ▼                                                        │
│  归属（Membership）                                              │
│  └── 企业空间成员 / 项目成员                                       │
│          │                                                        │
│          ▼                                                        │
│  授权（Authorization）                                           │
│  └── 角色（Role）← 一组权限的集合                                  │
│          │                                                        │
│          ▼                                                        │
│  资源（Resources）                                                │
│  └── Namespace、Deployment、Service...                            │
└─────────────────────────────────────────────────────────────────┘
```

## 平台级角色

平台级角色定义了在整个 KubeSphere 平台范围内的最高权限：

| 角色 | 权限范围 | 适用场景 |
|------|---------|---------|
| platform-admin | 所有集群、所有企业空间 | KubeSphere 管理员 |
| clusters-manager | 管理所有集群 | 集群运维负责人 |
| workspaces-manager | 管理所有企业空间 | 企业空间管理员 |
| users-manager | 管理所有用户 | 用户管理员 |
| regular-user | 基础功能访问 | 普通用户（不推荐手动分配） |

> 平台管理员默认账号是 `admin`，首次登录后建议立即修改密码或配置多因素认证。

## 企业空间（Workspace）角色

企业空间是 KubeSphere 的核心隔离单元，每个企业空间对应一组相关的项目和资源：

| 角色 | 权限范围 |
|------|---------|
| workspace-admin | 管理企业空间内的所有资源 |
| workspace-viewer | 只读访问企业空间资源 |
| workspace-regular | 创建项目和基本操作（不能管理企业空间本身） |

```yaml
# 企业空间管理员在 K8s 层面的等价 RoleBinding
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: workspace-admin-binding
  namespace: workspace-system  # 企业空间对应的系统 namespace
subjects:
  - kind: User
    name: user@example.com
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: workspace-admin
  apiGroup: rbac.authorization.k8s.io
```

## 项目（Project）角色

项目即 Kubernetes 的 Namespace。项目级角色控制用户在特定项目中的操作权限：

| 角色 | 权限范围 |
|------|---------|
| admin | 项目所有资源（除本身角色的管理） |
| operator | 管理 Deployment、Service、ConfigMap 等工作负载 |
| viewer | 只读访问 |
| custom-role | 自定义角色（可细粒度配置） |

## 用户管理

### 创建用户

```bash
# 通过 KubeSphere 控制台创建
# 路径：平台管理 → 账户管理 → 创建

# 通过 kubectl 直接操作（需要平台管理员权限）
kubectl create user alice --clusterrole=view --namespace=project-demo

# 查看当前用户
kubectl get users.workspaces.kubesphere.io
```

### 多因素认证（MFA）

KubeSphere 支持 TOTP（基于时间的一次性密码）作为 MFA 方式：

```bash
# 管理员强制用户启用 MFA
# 1. 在控制台设置 → 安全策略中启用 MFA 强制
# 2. 用户首次登录时绑定认证器 App（如 Google Authenticator）
# 3. 之后每次登录需要输入验证码
```

## 自定义角色

KubeSphere 支持创建细粒度的自定义角色：

```yaml
# 假设你需要创建一个「只读部署」的角色
# 只能查看 Deployment，但不能修改

# 在控制台配置，或通过 YAML 创建
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: deployment-reader
  labels:
    kubefed.io/managed: "true"
    kubesphere.io/aggregate-to-viewer: "true"
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
```

## 企业空间到 K8s 的映射

理解 KubeSphere 权限在 K8s 层面的实现：

```
KubeSphere 层级              K8s 层级
─────────────────────────────────────────────
平台管理员          →       cluster-admin
企业空间管理员      →       workspace-admin (自定义 ClusterRole)
项目管理员          →       admin (内置 Role)
项目操作员          →       operator (自定义 Role)
项目观察者          →       view (内置 Role)
```

每个企业空间在 K8s 中对应一个 namespace：

```
企业空间 "finance"          →       namespace: workspace-finance-system
  ├── 项目 "billing"       →       namespace: billing
  ├── 项目 "accounting"    →       namespace: accounting
  └── 成员关系             →       RoleBinding
```

## 常见权限问题排查

### 问题一：用户无法部署应用

```bash
# 1. 检查用户是否属于项目
kubectl get rolebinding -n <project-namespace> | grep <username>

# 2. 检查用户的角色
# 控制台 → 企业空间 → 项目 → 项目设置 → 角色设置

# 3. 如果是新建项目，确保项目管理员在项目创建时添加了成员
```

### 问题二：跨企业空间访问资源

KubeSphere 默认不允许跨企业空间访问资源。如果需要在企业空间间共享服务：

```bash
# 方案一：通过 Workspace Gateway
# 在共享方企业空间创建 Gateway
# 在消费方通过 FQDN 访问

# 方案二：通过 Workspace 联邦（Federation）
# 仅企业版支持

# 方案三：通过 Ingress ExternalName
apiVersion: networking.k8s.io/v1
kind: Service
metadata:
  name: shared-service
  namespace: consumer-namespace
spec:
  type: ExternalName
  externalName: shared-service.producer-namespace.svc.cluster.local
```

### 问题三：权限过大导致的误操作

```bash
# 审计：查看用户操作日志
# 控制台 → 审计日志

# 检查 ServiceAccount 的令牌使用情况
kubectl get serviceaccount -A
kubectl describe serviceaccount <sa-name> -n <namespace>

# 定期审查角色绑定
kubectl get rolebindings -A -o wide
kubectl get clusterrolebindings -o wide
```

## 权限设计的最佳实践

### 最小权限原则

```yaml
# ❌ 不推荐：给开发者 cluster-admin
# 直接给开发者 cluster-admin 权限，风险极大

# ✅ 推荐：按需分配项目级权限
# 开发者 → 项目 operator 角色
# 运维   → 项目 admin 角色 + 监控命名空间只读
# 测试   → 项目 viewer 角色
```

### 环境隔离

```
建议的角色划分：

生产环境（Production）
├── ws-platform-admin：只读，不能操作
├── ws-platform-dev：只能部署到 dev namespace
└── ws-platform-ops：可以操作所有资源，但需要审批

测试环境（Testing）
└── ws-platform-tester：所有项目 viewer + dev 项目 operator
```

### 定期审查

```bash
# 脚本化检查未使用的角色绑定
for ns in $(kubectl get ns -o name | grep -v kube-system); do
  echo "=== $ns ==="
  kubectl get rolebindings -n "$ns" -o jsonpath='{range .items[?(@.subjects[0].name!="system:node")]}{.metadata.name}{"\t"}{.subjects[0].name}{"\n"}{end}'
done

# 清理孤儿 ServiceAccount（已删除用户的残留）
kubectl get serviceaccount -A | grep -v "kubesphere\|istio\|argocd"
```

## 与原生 K8s RBAC 的区别

| 维度 | KubeSphere RBAC | 原生 K8s RBAC |
|------|-----------------|--------------|
| 权限粒度 | Workspace / Project / 自定义角色 | Namespace / Cluster |
| 用户管理 | 平台统一管理（Web UI） | 需要 kubeconfig 或 API |
| 角色预置 | 丰富的内置角色 | 只有基础 view/edit/admin |
| 多租户隔离 | Workspace 层级 | Namespace 层级（需手动配置） |
| 审计日志 | 平台级审计（操作记录） | 需单独配置审计策略 |

> "KubeSphere 的权限体系，把 Kubernetes 的 RBAC 变得更易用了。但本质上，它仍然是一套基于 K8s RBAC 的封装。理解底层映射关系，是深度运维的前提。"
