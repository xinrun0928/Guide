# Helm

Kubernetes 的包管理器，让复杂的应用部署变得简单。

当你的 Kubernetes 集群里有几十个服务，每个服务都有几十个 YAML 配置文件——Deployment、Service、ConfigMap、Secret、Ingress……手动管理这些配置文件很快就会变成噩梦。Helm 解决的就是这个问题。

Helm 的核心思想来自 Linux 的包管理器 apt/yum：把一组 Kubernetes 配置文件打包成一个「Chart」，然后用一条命令就能安装、升级、回滚整个应用。它还支持模板化、版本管理、依赖声明，让 Kubernetes 的应用分发变得标准化和可重复。

## 核心概念

理解 Helm，先理解三个核心概念：

**Chart**：一个 Chart 就是一组 Kubernetes 资源的包。它包含：
- `Chart.yaml`：元数据（名称、版本、依赖等）
- `values.yaml`：默认配置值
- `templates/`：Kubernetes 资源模板文件
- `charts/`：依赖的子 Chart

**Repository**：Chart 的仓库，类似于 Docker Hub。你可以发布自己的 Chart，也可以使用公开的仓库（如 Bitnami、Prometheus 官方 Chart 库）。

**Release**：一个 Release 是 Chart 在集群中的一次安装实例。同一个 Chart 可以安装多个 Release，每个 Release 都有独立的配置和状态。

## 为什么需要 Helm？

想象一个场景：你要在测试环境和生产环境部署同一个应用，区别仅在于副本数、资源限制、副本名称。

没有 Helm：你需要维护两套 YAML 文件，或者用脚本在部署前替换占位符。

有 Helm：你定义一个 `values.yaml`，然后：

```bash
# 测试环境
helm install my-app ./chart -f values-test.yaml

# 生产环境
helm install my-app ./chart -f values-prod.yaml
```

一条命令，环境和配置完全隔离。

## 面试的核心逻辑

Helm 面试通常考察以下方面：

1. **概念理解**：Chart、Repository、Release 的关系是什么？Helm 3 和 Helm 2 最大的区别是什么？
2. **模板语法**：如何在模板中使用条件判断、循环、函数？`&#123;&#123; .Values.xxx &#125;&#125;` 的点号表示什么？
3. **进阶用法**：Helm Hook 可以用来做什么？Helmfile 如何管理多环境？
4. **GitOps 结合**：Helm 如何与 ArgoCD 集成实现声明式部署？

> "Helm 的面试，本质上考的是你对 Kubernetes YAML 配置管理的理解深度——理解 Helm 的模板机制，就理解了 Kubernetes 配置声明式的精髓。"
