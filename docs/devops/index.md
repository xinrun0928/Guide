# 工程化与运维

Docker 改变了软件的交付方式，Kubernetes 重新定义了服务的部署理念，而 CI/CD 则是连接代码与生产的血管。

很多人对 DevOps 的理解还停留在「写脚本自动化部署」的层面。但真正的 DevOps 是一套文化和方法论：开发与运维的边界被打破，交付效率和质量被同等重视，持续集成、持续交付、基础设施即代码、监控可观测性——每一个环节都是为了让软件更快、更稳、更安全地到达用户手中。

## 模块速览

| 方向 | 篇数 | 核心目标 |
|------|------|----------|
| [Docker](/devops/docker/index) | 21 篇 | 镜像构建、数据持久化、网络通信、Swarm 集群 |
| [Kubernetes（K8s）](/devops/k8s/index) | 53 篇 | 核心概念、存储网络、安全运维、Helm、云原生生态 |
| [CI/CD](/devops/cicd/index) | 23 篇 | Git、Jenkins、现代 CI/CD 工具链、流水线最佳实践 |
| [容器编排对比](/devops/orchestration/index) | 4 篇 | Swarm/K8s/Mesos 选型决策、K3s/K0s 轻量方案 |
| [自动化运维](/devops/automation/index) | 19 篇 | Ansible、Prometheus + Grafana、ELK/EFK/Loki 日志体系 |
| [KubeSphere](/devops/kubesphere/index) | 24 篇 | 企业级容器平台、多租户、DevOps、服务网格 |
| [基础设施即代码（IaC）](/devops/iac/index) | 4 篇 | Terraform、Pulumi、模块化与状态管理 |

## 学习路径建议

```
第一阶段：Docker 入门（1-2 周）
→ 理解镜像、容器、仓库三大核心概念
→ 掌握 Dockerfile 编写与镜像构建
→ 数据持久化与网络通信
→ Docker Compose 多容器编排

第二阶段：Kubernetes 进阶（2-3 周）
→ 核心资源对象：Pod、Deployment、Service、ConfigMap
→ 深入网络模型与存储抽象
→ 安全配置：RBAC、Security Context、NetworkPolicy
→ 集群管理与监控：Prometheus + Grafana

第三阶段：CI/CD 与工程化（1-2 周）
→ Git 工作流与提交规范
→ Jenkins 流水线设计与现代 CI/CD 工具
→ 镜像安全扫描与制品管理
→ 蓝绿部署、金丝雀发布与 GitOps

第四阶段：运维体系与自动化（1-2 周）
→ Ansible 配置管理
→ 日志收集与分析（ELK/EFK/Loki）
→ 可观测性：指标 + 日志 + 链路追踪
→ 基础设施即代码：Terraform 与 Pulumi
```

## 面试的核心逻辑

工程化与运维的面试，核心考察的是你对「软件交付全流程」的把控能力：

1. **容器化理解**：能不能讲清楚 Docker 的镜像分层原理？Copy-on-Write 带来了什么？多阶段构建解决了什么问题？
2. **编排思想**：声明式配置 vs 指令式配置的本质区别是什么？Kubernetes 为什么选择前者？
3. **可观测性意识**：监控和日志在排查问题时各自扮演什么角色？如何避免告警疲劳？
4. **工程化判断**：哪些环节应该自动化？为什么？IaC 和配置管理的边界在哪里？

> "DevOps 不是岗位，是文化。把部署当作开发的一部分，把运维当作产品的延伸——这才是 DevOps 的精髓。"
