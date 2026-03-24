# KubeSphere 多租户体系：Workspace、Namespace、Project 层级

「KubeSphere 的多租户是怎么划分的？」——Workspace 是边界，Project 是空间。

多租户是 KubeSphere 区别于原生 K8s 的重要特性。它在 K8s 原生的 Namespace + RBAC 之上，封装了一层更易用的多租户模型，同时提供了平台级的资源隔离能力。

## 多租户模型

```
┌─────────────────────────────────────────────────────────────────┐
│                    KubeSphere 多租户层级                          │
│                                                                  │
│  平台层（Platform）                                              │
│  └── 平台管理员（platform-admin）                                 │
│       ├── 管理所有 Workspace                                      │
│       ├── 管理所有集群                                            │
│       └── 系统设置                                                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Workspace A（租户 A）                                     │   │
│  │  └── Workspace 管理员（workspace-admin）                    │   │
│  │       ├── 管理 DevOps 项目                                  │   │
│  │       ├── 管理普通项目                                       │   │
│  │       └── 成员管理                                           │   │
│  │                                                            │   │
│  │  ┌────────────────┐  ┌────────────────┐                    │   │
│  │  │ DevOps 项目    │  │ Project        │                    │   │
│  │  │ devops-project │  │ project-a      │                    │   │
│  │  │                │  │ project-b      │                    │   │
│  │  │ - 流水线       │  │                │                    │   │
│  │  │ - 代码仓库     │  │ - Deployment   │                    │   │
│  │  │ - 制品库       │  │ - Service      │                    │   │
│  │  └────────────────┘  │ - Ingress      │                    │   │
│  │                      │ - ConfigMap    │                    │   │
│  │                      │ - Secret       │                    │   │
│  │                      └────────────────┘                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Workspace B（租户 B）                                     │   │
│  │  └── 独立于 Workspace A，资源完全隔离                       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 三层概念详解

### 1. Workspace（工作空间）

Workspace 是多租户隔离的顶层单位。

```bash
# Workspace 级别的资源
# - 用户成员管理
# - DevOps 项目创建
# - 配额管理（CPU/内存/存储）
# - 网络策略（Workspace 内项目互通，与其他 Workspace 隔离）

# Workspace 管理员可做的事
# - 创建/删除 Project
# - 邀请用户成为 Workspace 成员
# - 设置 Workspace 级别的配额
# - 查看 Workspace 下所有资源
```

** Workspace 的隔离策略**：
- **网络隔离**：不同 Workspace 的 Pod 默认不能互相通信（需要配置 NetworkPolicy）
- **存储隔离**：每个 Workspace 使用独立的存储类
- **配额隔离**：每个 Workspace 有独立的资源配额
- **监控隔离**：每个 Workspace 只能看到自己 Namespace 的监控数据

### 2. DevOps Project（DevOps 项目）

DevOps Project 是专门用于 CI/CD 的项目类型。

```bash
# DevOps Project 包含
# - Jenkins Master（流水线执行引擎）
# - 代码仓库（Git/SVN）集成
# - 制品库（Artifact Repository）集成
# - SonarQube（代码质量）集成
# - 流水线（Pipeline）定义

# DevOps Project 与普通 Project 的区别
# - DevOps Project 关联 Git 仓库
# - DevOps Project 可以创建 CI/CD 流水线
# - DevOps Project 有独立的 Jenkins Agent Pool
```

### 3. Project（项目/K8s Namespace）

Project 是 K8s Namespace 的封装，也是资源分配的基本单位。

```bash
# Project 包含的 K8s 资源
# - Deployment / StatefulSet / DaemonSet
# - Service / Ingress
# - ConfigMap / Secret
# - PersistentVolumeClaim
# - HPA / CronJob / Job

# Project 管理员可做的事
# - 部署应用
# - 配置存储卷
# - 设置资源配额
# - 查看 Pod 日志
```

## 权限模型

### 预置角色

KubeSphere 提供了多个预置角色：

```
┌─────────────────────────────────────────────────────────────────┐
│                    预置角色层级                                    │
│                                                                  │
│  平台级角色                                                       │
│  ├── platform-regular：普通用户（无平台管理权限）                   │
│  ├── platform-admin：平台管理员（所有权限）                        │
│  └── cluster-viewer：集群观察者（只读）                           │
│                                                                  │
│  Workspace 级角色                                                 │
│  ├── workspace-admin：工作空间管理员                              │
│  ├── workspace-regular：工作空间普通成员                          │
│  ├── workspace-viewer：工作空间只读成员                           │
│  └── workspace-self-provisioner：可创建项目但无管理权限            │
│                                                                  │
│  Project 级角色                                                   │
│  ├── admin：项目管理员                                             │
│  ├── operator：项目操作者（可部署应用）                           │
│  ├── viewer：项目只读                                             │
│  └── workspace-viewer：继承自 Workspace                           │
│                                                                  │
│  DevOps 级角色                                                    │
│  ├── admin：DevOps 管理员                                         │
│  ├── operator：DevOps 操作者                                       │
│  └── viewer：DevOps 只读                                          │
└─────────────────────────────────────────────────────────────────┘
```

### 自定义角色

```yaml
# KubeSphere 支持通过 YAML 创建自定义角色
# kind: Role
# apiVersion: iam.kubesphere.io/v1alpha2
# metadata:
#   name: custom-project-operator
#   workspace: my-workspace
# rules:
#   - apiGroups: ["apps", ""]
#     resources: ["deployments", "services"]
#     verbs: ["get", "list", "watch", "create", "update", "patch"]
#   - apiGroups: [""]
#     resources: ["pods/logs"]
#     verbs: ["get", "list"]
```

## 配额管理

### Workspace 配额

```bash
# Workspace 级别的资源配额
# - CPU 请求/限制
# - 内存请求/限制
# - 存储容量
# - Pod 数量上限
# - Deployment 数量上限

# 通过控制台或 YAML 设置
apiVersion: quota.kubesphere.io/v1alpha2
kind: WorkspaceQuota
metadata:
  name: workspace-quota
  namespace: workspace-demo
spec:
  items:
    - apiVersion: v1
      kind: ResourceQuota
      metadata:
        name: compute-resources
        namespace: workspace-demo
      spec:
        hard:
          requests.cpu: "20"
          requests.memory: 40Gi
          limits.cpu: "40"
          limits.memory: 80Gi
          pods: "100"
```

### Project 配额

```bash
# Project 级别的资源配额
# 每个 Project 可以设置
# - CPU/内存请求和限制
# - 存储配额
# - 对象数量配额

# 通过 YAML 设置
apiVersion: v1
kind: ResourceQuota
metadata:
  name: project-quota
  namespace: my-project
spec:
  hard:
    requests.cpu: "4"
    requests.memory: 8Gi
    limits.cpu: "8"
    limits.memory: 16Gi
    pods: "20"
    services: "10"
    persistentvolumeclaims: "5"
```

## 资源层级映射

KubeSphere 的概念与 K8s 资源的映射关系：

```
┌─────────────────────────────────────────────────────────────────┐
│              KubeSphere 概念 → K8s 资源映射                       │
│                                                                  │
│  Workspace                                                      │
│  └── 对应：多个 K8s Namespace + Workspace CRD                    │
│                                                                  │
│  DevOps Project                                                │
│  └── 对应：Namespace（devops-system 下的子 Namespace）+ Jenkins CR │
│                                                                  │
│  Project                                                       │
│  └── 对应：K8s Namespace + 关联的 RBAC                           │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ KubeSphere Workspace                                        │  │
│  │                                                            │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │  │
│  │  │ Project  │  │ Project  │  │DevOps   │                 │  │
│  │  │ ns-a     │  │ ns-b     │  │ns-devops│                 │  │
│  │  │          │  │          │  │         │                 │  │
│  │  │ Deploy   │  │ Deploy   │  │ Jenkins │                 │  │
│  │  │ Service  │  │ Service  │  │ S2I     │                 │  │
│  │  │ Ingress  │  │ Ingress  │  │ Pipeline│                 │  │
│  │  └──────────┘  └──────────┘  └──────────┘                 │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 网络隔离

### Workspace 间网络隔离

```yaml
# 每个 Workspace 默认有独立的网络策略
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: workspace-isolation
  namespace: workspace-demo
spec:
  podSelector: {}    # 隔离 Workspace 内所有 Pod
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubesphere.io/workspace: workspace-demo
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubesphere.io/workspace: workspace-demo
```

### Project 内服务互通

```bash
# 同一 Project 内的 Pod 默认可以互相通信
# 不同 Project 的 Pod 默认不通（除非配置了网络策略）
```

## 实际使用流程

```
创建账号 → 创建 Workspace → 邀请成员 → 创建 Project → 部署应用

步骤：
1. 平台管理员创建用户（或用户自助注册）
2. 创建 Workspace（命名为 "产品线A"）
3. 邀请开发者加入 Workspace（授予 workspace-regular 角色）
4. Workspace 管理员创建 Project（命名为 "订单服务"）
5. 开发者登录，进入 "订单服务" Project
6. 创建 Deployment / Service / Ingress
7. 部署应用到 K8s
```

## 面试追问方向

1. **KubeSphere 的多租户和 K8s 原生的 RBAC 有什么区别？**
   答：K8s RBAC 是基于 Namespace 和角色的，粒度较粗。KubeSphere 在此基础上增加了 Workspace 层（跨 Namespace 聚合）、多集群统一视图（Member Cluster）、以及平台级的配额和监控隔离。简单说，KubeSphere 的多租户是「平台视角的多租户」，而 K8s RBAC 是「集群视角的权限控制」。

2. **不同 Workspace 的应用能互相调用吗？**
   答：默认不能。KubeSphere 默认配置 Workspace 级别的网络隔离策略（通过 K8s NetworkPolicy 实现）。如果需要跨 Workspace 通信，需要平台管理员修改网络策略，或者通过 Ingress/Egress 规则显式开放。

3. **Workspace 配额和 Project 配额的关系是什么？**
   答：Workspace 配额是所有 Project 配额的总和上限。当 Workspace 配额耗尽时，即使单个 Project 配额还有空间，也无法创建新资源。这就像「总工资」和「各部门工资预算」的关系。

> "KubeSphere 的多租户设计，既照顾了易用性（Workspace/Project 概念清晰），又保留了灵活性（支持自定义角色和网络策略）。理解了这个层级关系，就理解了 KubeSphere 平台管理的核心。"
