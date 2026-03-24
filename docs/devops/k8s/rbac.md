# RBAC：Role、ClusterRole、RoleBinding、ClusterRoleBinding

「谁可以操作什么？」——这是 K8s 权限管理的核心问题。

在多租户 K8s 集群中，开发者、运维、安全团队各自需要什么权限？namespace 之间的资源怎么隔离？跨 namespace 的权限怎么授予？RBAC（Role-Based Access Control）是 K8s 内置的权限控制系统，它用四类资源回答了这些问题。

## RBAC 的四类资源

RBAC 围绕两个核心维度构建权限体系：**资源类型**（Role/ClusterRole）和**授权对象**（RoleBinding/ClusterRoleBinding）。

```
资源定义（What）                    授权对象（Who）
┌──────────────────────┐           ┌──────────────────────┐
│  Role                │           │  RoleBinding          │
│  - namespace 内资源  │◄─────────►│  - namespace 内用户   │
│  - 精确到 namespace  │           │  - 绑定到 namespace  │
├──────────────────────┤           ├──────────────────────┤
│  ClusterRole         │           │  ClusterRoleBinding   │
│  - 集群级资源 +      │◄─────────►│  - 集群范围用户       │
│    非资源路径         │           │  - 绑定到集群范围     │
└──────────────────────┘           └──────────────────────┘
```

## Role 和 ClusterRole：定义权限

### Role：命名空间级别的权限

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: default
  name: pod-reader
rules:
  # 允许读取 pods
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  # 允许读取 pod logs
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
  # 允许读取 deployments
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list"]
```

### ClusterRole：集群级别的权限

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: node-admin
rules:
  # 集群级资源的读权限
  - apiGroups: [""]
    resources: ["nodes"]
    verbs: ["get", "list", "watch"]
  # 节点上的 pods（跨所有 namespace）
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
  # 非资源路径（如 /healthz）
  - nonResourceURLs: ["/healthz", "/healthz/*"]
    verbs: ["get"]
  # 对特定资源的特定名称的权限
  - apiGroups: [""]
    resources: ["configmaps"]
    resourceNames: ["kube-root-ca.crt"]  # 只允许操作这个特定的 ConfigMap
    verbs: ["get"]
```

### Role vs ClusterRole 的选择

| 维度 | Role | ClusterRole |
|------|------|-------------|
| 作用域 | 单个 namespace | 集群级别 |
| 适用资源 | namespace 级资源（Pod、Service） | 集群级资源（Node）+ namespace 级资源（跨 ns） + 非资源路径 |
| 复用性 | 只能在自己的 namespace 使用 | 可以绑定到任意 namespace 或集群范围 |
| 使用建议 | 日常应用权限 | 管理员权限、跨 namespace 权限 |

## RoleBinding 和 ClusterRoleBinding：授予权限

### RoleBinding：授予 Role 给用户

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: pod-reader-binding
  namespace: default
subjects:           # 谁
  - kind: User
    name: alice
    apiGroup: rbac.authorization.k8s.io
  - kind: ServiceAccount
    name: my-app
    namespace: default
roleRef:            # 得到什么权限
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

### ClusterRoleBinding：授予 ClusterRole 给用户

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: cluster-admin-binding
subjects:
  - kind: User
    name: admin@example.com
    apiGroup: rbac.authorization.k8s.io
  - kind: Group
    name: platform-team
    apiGroup: rbac.authorization.k8s.io
  - kind: ServiceAccount
    name: ci-agent
    namespace: ci
roleRef:
  kind: ClusterRole
  name: cluster-admin
  apiGroup: rbac.authorization.k8s.io
```

## subjects：可授权的对象类型

RBAC 可以授权给三类主体：

```yaml
subjects:
  # 普通用户（需要外部认证系统：OIDC、证书等）
  - kind: User
    name: alice
    apiGroup: rbac.authorization.k8s.io
  # 用户组（由外部认证系统定义）
  - kind: Group
    name: developers
    apiGroup: rbac.authorization.k8s.io
  # ServiceAccount（Pod 的身份）
  - kind: ServiceAccount
    name: my-app-sa
    namespace: production
```

## 常用内置 ClusterRole

K8s 提供了一组内置的 ClusterRole，涵盖了常见权限需求：

| ClusterRole | 说明 |
|------------|------|
| `cluster-admin` | 超级管理员，拥有所有权限 |
| `admin` | namespace 管理员，拥有 namespace 内所有权限（不包括跨 ns） |
| `edit` | namespace 内读写权限，但不能修改 RBAC |
| `view` | namespace 内只读权限，不能查看 Secret |
| `system:node` | kubelet 的权限 |
| `system:discovery` | API 发现权限（/api, /apis） |

```bash
# 将 edit 角色授予某用户
kubectl create rolebinding alice-edit \
  --clusterrole=edit \
  --user=alice \
  --namespace=default
```

## 常用场景

### 场景一：授予 namespace 管理员权限

```yaml
# 让某用户在 production namespace 下拥有完全控制权
kubectl create rolebinding production-admin \
  --clusterrole=admin \
  --user=bob \
  --namespace=production
```

### 场景二：跨 namespace 的只读权限

```yaml
# 让监控服务能够读取所有 namespace 的 pods
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: multi-ns-pod-reader
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: prometheus-pod-reader
subjects:
  - kind: ServiceAccount
    name: prometheus
    namespace: monitoring
roleRef:
  kind: ClusterRole
  name: multi-ns-pod-reader
  apiGroup: rbac.authorization.k8s.io
```

### 场景三：Pod 访问 API Server（ServiceAccount）

应用需要访问 K8s API 时，创建 ServiceAccount 并授予对应权限：

```bash
# 创建 ServiceAccount
kubectl create serviceaccount my-app-sa -n production
# 授予只读 pods 的权限
kubectl create rolebinding my-app-pod-reader \
  --role=view \
  --serviceaccount=production:my-app-sa \
  --namespace=production
```

Pod 中使用这个 ServiceAccount：

```yaml
spec:
  serviceAccountName: my-app-sa
  containers:
    - name: app
      image: myapp:v1
```

Pod 内的应用可以通过挂载的 ServiceAccount Token 访问 K8s API。

## 最佳实践

1. **最小权限原则**：只授予完成任务所需的最小权限，不给「多一点的」
2. **使用 Role 而非 ClusterRole**：除非确实需要集群级权限，否则用 Role
3. **用 Group 而非 User**：用户通过 Group 获得权限，方便批量管理
4. **ServiceAccount 代替 User**：Pod 访问 K8s API 使用 ServiceAccount，不要共享用户凭证
5. **定期审计**：用 `kubectl auth can-i --list --as=<user>` 检查权限配置

```bash
# 模拟用户权限检查
kubectl auth can-i get pods --as=alice --namespace=default
# yes/no

# 列出用户所有权限
kubectl auth can-i --list --as=alice --namespace=default
```

## 面试追问方向

- Role 和 ClusterRole 的本质区别是什么？什么情况下必须用 ClusterRole？
- ServiceAccount 和普通 User 在 RBAC 中有什么区别？Pod 怎么使用 ServiceAccount？
- 如果一个用户被绑定了多个 Role，这些权限是合并还是取交集？
- RoleBinding 引用的 ClusterRole，权限是局限在当前 namespace 还是全集群？
- 如何排查「某个用户明明有 RoleBinding 但还是没权限」的问题？

> RBAC 是 K8s 安全的基石。理解 Role/ClusterRole 和 RoleBinding/ClusterRoleBinding 的组合关系，是构建安全多租户集群的前提。
