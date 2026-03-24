# KubeSphere

企业级容器平台的国产之光，也是 Kubernetes 生态中最接地气的可视化管理层。

很多人对 KubeSphere 的第一印象是「一个好看的 K8s 管理界面」。但如果你真正用起来，会发现它解决的远不止可视化问题——多租户隔离、内置 DevOps 流水线、应用商店、日志收集、监控告警、服务网格，这些在 K8s 原生环境中需要分别配置的功能，在 KubeSphere 里被整合成了统一的操作体验。

这篇文章系列覆盖 KubeSphere 的定位与架构、多租户体系、核心功能（DevOps、服务网格、日志监控）、以及运维管理。无论你是企业用户，还是想了解云原生平台的产品设计思路，都能从中获得有价值的内容。

## 模块速览

KubeSphere 的定位介于原生 K8s 和 OpenShift 之间——比原生更易用，比 OpenShift 更开放。

| 方向 | 篇数 | 核心目标 |
|------|------|----------|
| [KubeSphere 基础](/devops/kubesphere/overview) | 5 篇 | 定位对比、架构设计、多租户体系、安装部署 |
| [KubeSphere 核心功能](/devops/kubesphere/app-store) | 7 篇 | 应用商店、流水线、告警通知、日志审计、服务网格、监控 |
| [KubeSphere DevOps](/devops/kubesphere/pipeline-syntax) | 5 篇 | Jenkinsfile 语法、制品仓库、自动构建、部署策略、GitOps |
| [KubeSphere 运维管理](/devops/kubesphere/node-management) | 6 篇 | 节点管理、存储网络、集群升级、权限管理、故障排查 |

## 学习路径建议

```
第一阶段：入门与部署（2-3 天）
→ 理解 KubeSphere 的定位：与 OpenShift、Rancher 的区别
→ 搭建 All-in-One 环境（体验版）
→ 多节点部署（生产环境）
→ 多租户体系：Workspace、Namespace、Project 的层级关系

第二阶段：DevOps 实战（1 周）
→ 流水线配置：Jenkinsfile in SCM vs 图形化编辑
→ 二进制制品仓库与镜像仓库集成
→ 自动化构建与镜像推送流程
→ 蓝绿部署与滚动更新配置

第三阶段：运维管理（1 周）
→ 节点管理与污点配置
→ 存储类型与持久卷管理
→ 集群升级与版本管理
→ 基于角色的权限配置（RBAC）

第四阶段：高级功能（1 周）
→ 基于 Istio 的服务网格可视化
→ 自定义监控与告警规则配置
→ FluentBit 日志收集架构
→ GitOps 工作流集成
```

## KubeSphere 和 Rancher 怎么选？

这是很多人都会问的问题。两个都是 K8s 多集群管理平台，但定位有所不同：

**Rancher** 更像一个「K8s 管理平台」——它的核心价值是简化 K8s 集群的创建、管理、升级，降低 K8s 的使用门槛。Rancher 2.x 基于 RKE（ Rancher Kubernetes Engine），3.x 开始支持 K3s 和 RKE2。

**KubeSphere** 更像一个「企业级应用平台」——它在 K8s 之上，封装了一层面向业务的功能：DevOps 流水线、应用商店、服务网格、多租户计费……如果你想在一个平台里完成从代码到上线到监控的全流程，KubeSphere 更适合。

简单来说：**管理 K8s 集群选 Rancher，在 K8s 上跑应用选 KubeSphere。**

## 面试的核心逻辑

KubeSphere 作为一个平台类产品，面试通常不会考你「会不会点按钮」，而是考察你对平台架构和工程实践的理解：

1. **多租户设计**：KubeSphere 的 Workspace、Namespace、Project 三层模型是怎么实现租户隔离的？不同层级的权限如何控制？
2. **DevOps 集成**：KubeSphere 的流水线是怎么跑起来的？ Jenkins 是怎么被集成进来的？
3. **可观测性**：KubeSphere 的监控、日志、告警是怎么实现的？背后依赖了哪些组件（Prometheus、Elasticsearch、FluentBit）？
4. **运维能力**：集群升级怎么做？多节点环境下的网络和存储怎么规划？

> "KubeSphere 的面试，本质上考的是你对 K8s 生态的掌握程度。KubeSphere 只是入口，背后连着的仍然是 Pod、Service、PV、RBAC 这些 K8s 原生概念。"
