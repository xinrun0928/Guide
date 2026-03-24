# CI/CD 工具对比：Jenkins vs GitLab CI vs GitHub Actions vs Tekton

「该选哪个 CI/CD 工具？」——没有最好的，只有最合适的。

Jenkins、GitLab CI、GitHub Actions、Tekton……每个工具都有自己的定位和适用场景。选错了，轻则浪费资源，重则成为技术债务。理解它们的设计哲学，才能做出正确的选择。

## 整体对比

| 维度 | Jenkins | GitLab CI | GitHub Actions | Tekton |
|------|---------|-----------|----------------|--------|
| 定位 | 通用 CI/CD 平台 | DevOps 全平台 | GitHub 集成 | K8s 原生 CI/CD |
| 部署模式 | 自托管 | 自托管 / SaaS | SaaS / 自托管 | K8s 原生 |
| 配置方式 | Jenkinsfile / UI | `.gitlab-ci.yml` | `workflow.yml` | `Task` / `Pipeline` CRD |
| 插件生态 | 极其丰富（1800+） | 中等（集成 GitLab） | 丰富（GitHub 市场） | 较少（Pipeline 组合） |
| 学习曲线 | 陡（Groovy DSL） | 中（YAML） | 低（YAML + 市场） | 中（K8s 概念） |
| 流水线即代码 | Jenkinsfile | `.gitlab-ci.yml` | `workflow.yml` | YAML CRD |
| K8s 集成 | Jenkins Kubernetes 插件 | 内置 K8s Executor | K8s Runner | 原生 |
| 容器化 | 支持 | 支持 | 支持 | 原生 |
| UI 体验 | 功能强但古老 | 好 | 好 | 依赖外部 Dashboard |
| 价格 | 开源免费 | 自托管免费 / SaaS 收费 | SaaS 免费有限 / 自托管免费 | 开源免费 |

## Jenkins：通用 CI/CD 王者

```
┌─────────────────────────────────────────────────────────────────┐
│                    Jenkins 特点                                   │
│                                                                  │
│  优势：                                                         │
│  ✓ 历史悠久（2005），插件生态最丰富                               │
│  ✓ 完全开源，可自托管，无厂商锁定                                │
│  ✓ 高度可定制（Groovy 脚本）                                    │
│  ✓ 适合复杂企业场景（多环境、多租户）                           │
│  ✓ 社区活跃，解决方案多                                          │
│                                                                  │
│  劣势：                                                         │
│  ✗ UI 古老，学习曲线陡                                          │
│  ✗ 插件质量参差不齐（安全风险）                                 │
│  ✗ 分布式构建需要手动管理 Master/Slave                          │
│  ✗ 配置即代码 支持弱（Jenkinsfile 不如 YAML 直观）             │
│  ✗ 容器原生支持不足（需要插件）                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 适用场景

```
适合 Jenkins 的场景：
1. 大型企业（需要复杂的权限、审批流程）
2. 异构环境（Java、.NET、Python 混合）
3. 需要大量定制（插件组合）
4. 不想被云服务绑定（完全自托管）
5. 历史积累（Jenkinsfile、插件配置）

不适合 Jenkins 的场景：
1. 小团队（GitHub Actions 更快上手）
2. 云原生（Tekton 更适合 K8s）
3. 需要 Native 容器 CI（GitLab CI 体验更好）
```

## GitLab CI：DevOps 全平台

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitLab CI 特点                                  │
│                                                                  │
│  优势：                                                         │
│  ✓ 代码托管 + CI/CD + Container Registry 一体化                 │
│  ✓ `.gitlab-ci.yml` 简洁直观                                   │
│  ✓ Auto DevOps（零配置上线）                                    │
│  ✓ 内置 Docker Registry、Harbor 集成                            │
│  ✓ Kubernetes 集成优秀                                          │
│  ✓ MR/Pipeline 联动（代码审查即触发 CI）                        │
│                                                                  │
│  劣势：                                                         │
│  ✗ 自托管需要 GitLab Runner（额外资源）                         │
│  ✗ CI/CD 和 GitLab 绑定（迁移成本高）                          │
│  ✗ 插件生态不如 Jenkins                                          │
│  ✗ 多项目流水线（Pipeline 父子）语法复杂                        │
└─────────────────────────────────────────────────────────────────┘
```

### 适用场景

```
适合 GitLab CI 的场景：
1. 使用 GitLab 作为代码仓库（自然集成）
2. 需要代码托管 + CI/CD 一体化
3. 容器化优先（Docker 集成好）
4. Kubernetes 部署（Auto DevOps）
5. 团队需要代码审查 + CI/CD 联动

不适合 GitLab CI 的场景：
1. 使用 GitHub 作为代码仓库（GitHub Actions 更自然）
2. 预算有限（GitLab SaaS 收费高）
3. 需要 Jenkins 插件（Jenkins 插件更丰富）
```

## GitHub Actions：GitHub 原生 CI/CD

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Actions 特点                            │
│                                                                  │
│  优势：                                                         │
│  ✓ 与 GitHub 无缝集成（代码即触发）                              │
│  ✓ 市场生态丰富（Actions 市场）                                  │
│  ✓ 矩阵构建强大（多版本、多平台、多配置）                       │
│  ✓ 公开仓库免费（SaaS Runner）                                  │
│  ✓ Workflow 可复用（社区 Actions）                               │
│  ✓ 语法简洁（YAML）                                             │
│                                                                  │
│  劣势：                                                         │
│  ✗ 私有仓库有分钟数限制（付费或免费额度）                       │
│  ✗ 自托管 Runner 需要额外配置                                    │
│  ✗ Windows Runner 价格高                                         │
│  ✗ 与 GitHub 绑定（迁移到 GitLab 复杂）                        │
│  ✗ 企业功能（SSO、审计）需要付费版                              │
└─────────────────────────────────────────────────────────────────┘
```

### 适用场景

```
适合 GitHub Actions 的场景：
1. 使用 GitHub 作为代码仓库
2. 开源项目（公开仓库免费无限 Runner）
3. 快速上手（YAML + 市场 Actions）
4. 矩阵构建（多版本、多平台测试）
5. 小团队（无需维护 CI/CD 服务器

不适合 GitHub Actions 的场景：
1. 需要大规模自托管（GitLab CI / Jenkins）
2. 企业需要 SSO、审计等高级功能（GitLab Ultimate）
3. 预算敏感（GitHub SaaS 分钟数限制）
```

## Tekton：Kubernetes 原生 CI/CD

```
┌─────────────────────────────────────────────────────────────────┐
│                    Tekton 特点                                    │
│                                                                  │
│  优势：                                                         │
│  ✓ Kubernetes 原生（CustomResourceDefinition）                  │
│  ✓ 流水线即代码（YAML CRD）                                     │
│  ✓ 可移植（任何 K8s 集群）                                      │
│  ✓ 增量构建（Pipeline Run 独立）                                │
│  ✓ 与 Jenkins X、Knative、ArgoCD 集成                           │
│  ✓ GitOps 友好（Tekton + ArgoCD）                               │
│                                                                  │
│ 劣势：                                                          │
│  ✗ 学习曲线（需要理解 K8s CRD）                                 │
│  ✗ UI 依赖外部（Tekton Dashboard / Jenkins X）                  │
│  ✗ 插件生态不如 Jenkins/GitHub Actions                          │
│  ✗ 适合云原生团队（传统团队上手难）                             │
└─────────────────────────────────────────────────────────────────┘
```

### 适用场景

```
适合 Tekton 的场景：
1. Kubernetes 原生团队
2. 需要流水线跨集群迁移
3. GitOps 工作流（Tekton + ArgoCD）
4. Knative 无服务器构建
5. 企业内部构建平台（PaaS 层封装）

不适合 Tekton 的场景：
1. 小团队（GitHub Actions / GitLab CI 更快上手）
2. 传统 IT（非 K8s 环境）
3. 需要复杂 UI（Jenkins UI 更友好）
```

## 选型决策树

```
┌─────────────────────────────────────────────────────────────────┐
│                    CI/CD 工具选型决策树                           │
│                                                                  │
│                   ┌─────────────────────┐                        │
│                   │ 你用什么代码仓库？    │                        │
│                   └──────────┬──────────┘                        │
│                              │                                    │
│         ┌────────────────────┼────────────────────┐              │
│         │                    │                    │              │
│    ┌────▼────┐         ┌─────▼────┐        ┌─────▼────┐         │
│    │ GitHub │         │ GitLab   │        │ 其他     │         │
│    └────┬────┘         └─────┬────┘        └─────┬────┘         │
│         │                    │                    │              │
│    ┌────▼────┐         ┌─────▼────┐        ┌─────▼────┐         │
│    │ 小团队？ │         │ GitLab   │        │ 企业场景？ │         │
│    └────┬────┘         │ 自托管？  │        └─────┬────┘         │
│         │                    │                    │              │
│    ┌────▼────┐         ┌─────▼────┐        ┌─────▼────┐         │
│    │  是    │         │  是     │        │  是     │         │
│    └────┬────┘         └─────┬────┘        └─────┬────┘         │
│         │                    │                    │              │
│    ┌────▼────────────┐ ┌─────▼────────────┐ ┌─────▼────────────┐ │
│    │GitHub Actions   │ │ GitLab CI        │ │    Jenkins       │ │
│    │(快速上手)       │ │ (一体化平台)      │ │ (高度定制)       │ │
│    └─────────────────┘ └──────────────────┘ └──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## 组合使用

```
常见组合：

1. GitHub Actions + ArgoCD
   → GitHub 托管代码，Actions 做 CI，ArgoCD 做 CD
   → 适合：云原生小团队

2. Jenkins + ArgoCD
   → Jenkins 做 CI（复杂构建），ArgoCD 做 CD
   → 适合：企业级 GitOps

3. GitLab CI + GitLab Auto DevOps
   → 代码提交即触发全链路 CI/CD
   → 适合：快速交付团队

4. Tekton + ArgoCD + Knative
   → 全云原生流水线，K8s 原生部署
   → 适合：Kubernetes 深度用户

5. Jenkins + GitLab
   → Jenkins 做构建，GitLab 做代码托管和 CI
   → 适合：过渡期迁移
```

## 常见错误

```
# 错误一：选型只看功能，不看团队能力
# Jenkins 功能最强，但小团队维护成本高
# GitHub Actions 简单，但大团队需要定制时不够用

# 错误二：忽视迁移成本
# 从 Jenkins 迁移到 GitHub Actions 不是改改 YAML 那么简单
# 迁移前评估：插件、流水线、安全配置

# 错误三：把 CI 和 CD 混在一起
# CI 和 CD 职责不同，工具选择可以分开
# CI 用 GitHub Actions，CD 用 ArgoCD

# 错误四：忽视云厂商锁定
# GitHub Actions SaaS Runner 方便，但有分钟数限制
# 迁移到自托管 Runner 需要重新配置
```

## 面试追问方向

1. **Jenkins Pipeline 的 Declarative 和 Scripted 语法有什么区别？**
   答：Declarative 是声明式语法（`pipeline { agent ... stages { ... } }`），结构清晰，适合大多数场景；Scripted 是命令式语法（`node { stage(...) { ... } }`），使用 Groovy 脚本，灵活性更高但学习曲线陡。建议优先使用 Declarative，复杂逻辑用 Scripted 或 Shared Library。

2. **GitLab CI 的 DAG 模式是什么？有什么优势？**
   答：GitLab CI 默认是顺序执行流水线；DAG（Directed Acyclic Graph）模式允许任务并行执行，基于 `needs` 关键字声明依赖。优势：没有依赖的任务可以并行执行，大幅缩短流水线时间；适合构建阶段多、无依赖的微服务项目。

3. **GitHub Actions 的 Matrix 策略如何实现多版本测试？**
   答：通过 `strategy.matrix` 定义矩阵：`matrix { java: ['11', '17', '21']; os: ['ubuntu-latest', 'windows-latest'] }`。GitHub Actions 会自动生成所有组合（3×2=6 个 Job），并行执行。需要排除某些组合时用 `exclude`，需要包含时用 `include`。

4. **Tekton 和 ArgoCD 的区别是什么？**
   答：Tekton 是 CI/CD 流水线框架，负责构建和部署前的准备；ArgoCD 是 GitOps 持续交付工具，负责监听 Git 变化并同步到集群。两者互补：Tekton 做 CI（Build/Test），ArgoCD 做 CD（GitOps Sync）。

选 CI/CD 工具，就像选开发语言：没有银弹，只有最适合当前场景的那个。
