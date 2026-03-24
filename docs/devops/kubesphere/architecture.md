# KubeSphere 架构：前端、核心服务、Agent 组件

「KubeSphere 背后是怎么工作的？」——一个典型的微服务架构。

KubeSphere 本身也是一个分布式系统，由多个组件构成。理解它的架构，能帮助你在遇到问题时快速定位根源，也能更好地规划生产环境的部署方案。

## 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         KubeSphere 架构                                  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                      KubeSphere Console（前端）                     │   │
│  │                      Angular + Node.js                             │   │
│  │                      Web UI / kubectl CLI / API                    │   │
│  └──────────────────────────────┬───────────────────────────────────┘   │
│                                 │ REST API                                │
│  ┌──────────────────────────────┴───────────────────────────────────┐   │
│  │                      KubeSphere API Server                          │   │
│  │                      KubeSphere 后端核心（Go）                       │   │
│  │                                                                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  │   │
│  │  │  Account    │  │   DevOps    │  │  OpenPitrix │  │   IAM    │  │   │
│  │  │  (账户)    │  │   (CI/CD)   │  │  (应用管理) │  │ (身份)   │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └──────────┘  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  │   │
│  │  │  Monitoring │  │   Alert     │  │   Logging   │  │  Network │  │   │
│  │  │  (监控)    │  │  (告警)    │  │  (日志)    │  │ (网络)  │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └──────────┘  │   │
│  └──────────────────────────────┬───────────────────────────────────┘   │
│                                 │                                        │
│  ┌──────────────────────────────┴───────────────────────────────────┐   │
│  │                         Kubernetes API Server                        │   │
│  │                    (所有 KubeSphere 组件都调用 K8s API)               │   │
│  └──────────────────────────────┬───────────────────────────────────┘   │
│                                 │                                        │
│  ┌──────────────────────────────┴───────────────────────────────────┐   │
│  │                    KubeSphere Agent（ks-controller/ks-agent）        │   │
│  │                                                                       │   │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐       │   │
│  │  │ ks-controller   │  │   ks-agent     │  │  FluentBit     │       │   │
│  │  │ (集群侧控制器)  │  │ (事件转发)    │  │ (日志采集)    │       │   │
│  │  └────────────────┘  └────────────────┘  └────────────────┘       │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## 核心组件详解

### KubeSphere Console（前端）

```bash
# Console 以 Deployment 形式运行
kubectl get deployment -n kubesphere-system | grep console

# 前端组件
# - Angular 框架：组件化开发
# - Node.js 服务端：SSR、API 代理
# - WebSocket：实时日志、流水线状态推送

# 默认端口
# - NodePort: 30880
# - Ingress: ks-console.kubesphere-system.svc
```

前端不直接调用 K8s API，而是通过 KubeSphere API Server 转发。这么做的好处是：
- 所有请求经过统一的认证鉴权层
- 前端只需要一种 API（KubeSphere REST API）
- 可以做更细粒度的权限控制（K8s RBAC 不够用）

### KubeSphere API Server（后端核心）

```bash
# API Server 以 Deployment 形式运行
kubectl get deployment -n kubesphere-system | grep apiserver

# 核心 API 组
# /api/kapis/iam.kubesphere.io/    - 身份与访问管理
# /api/kapis/devops.kubesphere.io/ - DevOps 模块
# /api/kapis/monitoring.kubesphere.io/ - 监控数据
# /api/kapis/logging.kubesphere.io/  - 日志查询
# /api/kapis/application.kubesphere.io/ - 应用管理
```

KubeSphere API Server 是一个聚合层（Aggregator），它：
1. 接收前端请求
2. 验证权限（基于 KubeSphere 的多租户模型，而非仅 K8s RBAC）
3. 调用 K8s API 或其他后端服务
4. 返回聚合后的结果

### Account（账户服务）

```bash
# 账户服务管理用户、工作空间、角色
# /api/kapis/iam.kubesphere.io/v1alpha2/workspaces/
# /api/kapis/iam.kubesphere.io/v1alpha2/users/
```

核心概念：
- **用户（User）**：登录 KubeSphere 的账号
- **工作空间（Workspace）**：多租户隔离的顶层单位
- **角色（Role）**：预置角色（workspace-admin、project-admin、viewer 等）
- **成员（Member）**：工作空间或项目中的用户

### DevOps（CI/CD 模块）

```bash
# DevOps 组件
kubectl get deployment -n kubesphere-devops-worker | grep jenkins
kubectl get deployment -n kubesphere-devops-worker | grep s2i

# Jenkins Master：通过 Jenkins Kubernetes Plugin 运行在 K8s 中
# Jenkins Agent：按需创建，用完销毁
# SonarQube：代码质量检查（可选）
# S2I（Source-to-Image）：源代码到镜像的构建（可选）
```

### OpenPitrix（应用管理）

```bash
# 应用商店组件
kubectl get deployment -n kubesphere-system | grep openpitrix
```

基于 OpenPitrix 实现应用的生命周期管理：
- **应用模板**：上传 Helm Chart 或应用包
- **应用商店**：多租户共享的应用商店
- **应用部署**：一键部署应用到项目

### Monitoring（监控模块）

```bash
# 监控组件
kubectl get deployment -n kubesphere-monitoring-system

# 核心组件
# - Prometheus Operator：管理 Prometheus 实例
# - Thanos Sidecar：指标长期存储
# - Kube-state-metrics：K8s 对象状态指标
# - Node Exporter：节点级指标
# - Alertmanager：告警管理
```

监控架构：
```
┌─────────────────────────────────────────────────────────────┐
│              多租户监控架构                                    │
│                                                              │
│  Workspace A 的 Project A                                     │
│  ├── 查询范围：只看自己的 Namespace                            │
│  └── Dashboard：自己定义                                      │
│                                                              │
│  Workspace B 的 Project B                                     │
│  ├── 查询范围：只看自己的 Namespace                            │
│  └── Dashboard：自己定义                                      │
│                                                              │
│  KubeSphere 平台管理员                                          │
│  ├── 查询范围：整个集群                                        │
│  └── Dashboard：全局视图                                      │
│                                                              │
│  Prometheus：共享实例，多租户通过 Labels 隔离查询               │
└─────────────────────────────────────────────────────────────┘
```

### Logging（日志模块）

```bash
# 日志组件
kubectl get deployment -n kubesphere-logging-system

# 核心组件
# - Elasticsearch：日志存储和检索
# - FluentBit Operator：日志采集（DaemonSet）
# - Logsidecar Injector：Pod 级别日志注入
# - Kafka（可选）：日志消息队列
```

## Agent 组件

### ks-controller（集群侧控制器）

```bash
# 运行在每个纳管集群中
kubectl get deployment -n kubesphere-system | grep ks-controller
```

负责：
- 同步 KubeSphere 工作空间、项目到 K8s Namespace
- 管理多集群场景下的资源下发
- 处理集群级别的策略（网络策略、配额等）

### ks-agent（事件转发）

```bash
# 事件收集代理
kubectl get daemonset -n kubesphere-system | grep ks-agent
```

负责：
- 收集集群事件
- 转发到 KubeSphere 主集群
- 实现多集群事件统一视图

### FluentBit（日志采集）

```bash
# 日志采集（DaemonSet）
kubectl get daemonset -n kubesphere-logging-system
```

负责：
- 采集每个节点的系统日志
- 采集 Kubernetes 事件日志
- 采集应用日志（通过 Logsidecar 或直接读取日志文件）
- 过滤、路由日志到 Elasticsearch 或 Kafka

## 多集群架构

KubeSphere 支持管理多个 K8s 集群，架构如下：

```
┌─────────────────────────────────────────────────────────────────┐
│                  KubeSphere 多集群管理架构                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │              Host Cluster（主集群）                         │    │
│  │  ┌──────────────────────────────────────────────────┐   │    │
│  │  │  KubeSphere Core（Console + API Server + DB）    │   │    │
│  │  └──────────────────────────────────────────────────┘   │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │    │
│  │  │ DevOps       │  │ Monitoring   │  │ Logging      │  │    │
│  │  │ (CI/CD)      │  │ (Prometheus) │  │ (Elasticsearch│  │    │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │    │
│  └────────────────────────────┬──────────────────────────────┘    │
│                                │                                      │
│         ┌─────────────────────┼─────────────────────┐               │
│         │                     │                     │               │
│         ▼                     ▼                     ▼               │
│  ┌────────────┐        ┌────────────┐        ┌────────────┐          │
│  │ Member     │        │ Member     │        │ Member     │          │
│  │ Cluster 1  │        │ Cluster 2  │        │ Cluster 3  │          │
│  │            │        │            │        │            │          │
│  │ ks-agent   │        │ ks-agent   │        │ ks-agent   │          │
│  │ FluentBit  │        │ FluentBit  │        │ FluentBit  │          │
│  └────────────┘        └────────────┘        └────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

## 存储选型

KubeSphere 的核心存储依赖：

| 存储类型 | 用途 | 推荐方案 |
|---------|------|---------|
| K8s PV | 应用持久化存储 | Ceph CSI、NFS CSI、MinIO |
| Elasticsearch | 日志存储 | 3 节点集群，SSD 存储 |
| Prometheus | 监控时序数据 | PVC（本地 SSD）或对象存储 |
| PostgreSQL/MySQL | KubeSphere 元数据 | 主从高可用部署 |

## 面试追问方向

1. **KubeSphere 组件之间的通信是怎么做的？**
   答：KubeSphere 组件之间通过 Kubernetes Service 进行通信（Kubernetes 内部 DNS 解析）。Console 前端通过 HTTP/HTTPS 调用 KubeSphere API Server，API Server 调用 K8s API 或各微服务组件（Account、DevOps、Monitoring 等）。各微服务之间也通过 K8s Service 发现和调用。

2. **KubeSphere 的多集群管理和 Rancher 有什么不同？**
   答：Rancher 通过 Rancher Server 统一管理多个集群的 API Server，做到了真正的集中管理。KubeSphere 的多集群是「主从模式」：Host Cluster 运行核心组件和共享服务，Member Cluster 只运行 Agent 和工作负载。KubeSphere 的优势是 DevOps、监控、日志可以跨集群统一管理。

3. **KubeSphere 的日志和监控是怎么做到多租户隔离的？**
   答：监控通过 Prometheus 的 Label 隔离，每个 Project 的 Pod 带有 `kubesphere.io/workspace` 和 `kubesphere.io/namespace` Label，PromQL 查询时自动加上这些 Label 过滤。日志通过 Elasticsearch 的 Index 隔离，每个 Namespace 有一个独立的 Index 或 Index Pattern，查询时只返回当前用户有权限访问的 Index。

> "KubeSphere 的架构设计，体现了 K8s 生态的一贯哲学——每一个功能都是一个可插拔的组件，按需启用，各司其职。"
