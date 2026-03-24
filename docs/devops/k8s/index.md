# Kubernetes（K8s）

容器编排的事实标准，也是云原生时代的基础设施。

如果说 Docker 解决的是「怎么把应用装进容器里」，那么 Kubernetes 解决的就是「怎么让这些容器在集群里跑起来、扩得开、跑得稳」。从服务发现到负载均衡，从滚动更新到自动扩缩容，K8s 把分布式系统中最复杂的运维工作，变成了一组声明式的配置。

这篇文章系列覆盖 Kubernetes 的核心概念、存储与网络、安全与运维、Helm 包管理，以及云原生生态。无论你是要管理一个测试集群，还是为生产环境设计 K8s 架构，都能找到对应的内容。

## 模块速览

Kubernetes 的知识点体系非常庞大，从核心资源对象到网络模型，从存储抽象到安全策略，每一块都需要深入理解。

| 方向 | 篇数 | 核心目标 |
|------|------|----------|
| [Kubernetes 基础](/devops/k8s/architecture) | 8 篇 | 架构设计、核心概念、Pod 生命周期与调度 |
| [Kubernetes 核心资源](/devops/k8s/deployment) | 6 篇 | Deployment、StatefulSet、DaemonSet、Job/CronJob |
| [Kubernetes 网络](/devops/k8s/network-model) | 8 篇 | 网络模型、DNS、Service、Ingress、CNI |
| [Kubernetes 存储](/devops/k8s/volume) | 5 篇 | Volume、PV/PVC、StorageClass、ConfigMap/Secret |
| [Kubernetes 安全](/devops/k8s/rbac) | 4 篇 | RBAC、Security Context、ServiceAccount、NetworkPolicy |
| [Kubernetes 运维](/devops/k8s/kubectl) | 10 篇 | 集群管理、高可用、监控、升级、Operator |
| [Helm](/devops/k8s/helm) | 4 篇 | Chart 模板、Release 管理、Helmfile/GitOps |
| [云原生生态](/devops/k8s/cloud-native) | 4 篇 | Service Mesh、部署策略、GitOps 工具链 |

## 学习路径建议

```
第一阶段：核心概念（1 周）
→ 理解 K8s 架构：Control Plane 与 Worker Node
→ 掌握 Pod、Deployment、Service 三大核心资源
→ 理解 Pod 调度机制：NodeSelector、Affinity、Taint/Toleration
→ 实践健康检查：Liveness Probe、Readiness Probe

第二阶段：深入原理（1-2 周）
→ 深入网络模型：Pod IP、Service IP、CNI 插件
→ 理解 PV/PVC 机制与存储抽象
→ 掌握 RBAC 权限管理
→ 理解 HPA 原理与指标体系

第三阶段：生产实践（1-2 周）
→ 集群高可用部署方案
→ etcd 备份与恢复
→ Prometheus + Grafana 监控体系
→ 滚动更新与回滚策略

第四阶段：进阶生态（持续）
→ Helm 模板开发与 Helmfile
→ Operator 开发（Kubebuilder）
→ Service Mesh（Istio）入门
→ GitOps 工作流（ArgoCD）
```

## 为什么 Kubernetes 是云原生的核心？

云原生有四个核心特征：**容器化、微服务、不可变基础设施、声明式 API**。

Kubernetes 至少覆盖了其中三个。它的设计哲学是：你不告诉它「怎么做」，你只告诉它「你想要什么」。 Deployment 声明副本数是 3，它就会想方设法保证有 3 个 Pod 在跑；某个节点挂了，它会自动把 Pod 调度到其他节点上。

这种「声明式」的思维方式，是 Kubernetes 最深刻的设计，也是它区别于传统运维的根本所在。

## 面试的核心逻辑

Kubernetes 面试通常分为三个层次：

**第一层：会用**
- Pod、Deployment、Service 的基本概念
- kubectl 常用命令
- 如何暴露一个应用给集群外部访问

**第二层：理解原理**
- Pod 调度的过程是什么？Scheduler 做了什么？
- Service 的负载均衡是怎么实现的？iptables 和 IPVS 有什么区别？
- 网络策略（NetworkPolicy）和 CNI 插件是什么关系？
- PV/PVC 的绑定过程是什么样的？

**第三层：生产经验**
- 集群是怎么做高可用的？etcd 的备份策略是什么？
- 遇到 OOMKilled、Pod 一直 Pending/Evicted，是怎么排查的？
- 如何设计一个多租户的 K8s 环境？
- Pod 的资源限制设置不当会导致什么问题？

> "K8s 的面试官最想看到的，是你有没有「踩过坑」的经验。如果你能讲清楚一次 Pod 被驱逐的排查过程，比背一百条命令都加分。"
