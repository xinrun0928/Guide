# CI/CD

从代码提交到生产部署，流水线是软件交付的血管。

很多人以为 CI/CD 就是「写个脚本自动部署」，但真正做下来会发现：代码质量门禁怎么设？构建缓存怎么利用？制品怎么管理？安全扫描放哪个阶段？回滚怎么做才能不影响用户？

这些问题没有标准答案，但有一些经过无数团队验证的最佳实践。这篇文章系列覆盖 Git 版本控制、Jenkins 流水线、现代 CI/CD 工具（GitLab CI、GitHub Actions、ArgoCD、Tekton），以及完整的 CI/CD 最佳实践，帮你搭建一套真正能落地的交付体系。

## 模块速览

CI/CD 的生态非常丰富，从老牌的 Jenkins 到云原生的 Tekton，每种工具都有自己的适用场景。

| 方向 | 篇数 | 核心目标 |
|------|------|----------|
| [Git 与版本控制](/devops/cicd/git-workflow) | 5 篇 | Git Flow、命令原理、提交规范、Hooks |
| [Jenkins](/devops/cicd/jenkins-architecture) | 5 篇 | 架构原理、Declarative Pipeline、插件生态 |
| [现代 CI/CD 工具](/devops/cicd/gitlab-ci) | 6 篇 | GitLab CI、GitHub Actions、ArgoCD、Tekton、Spinnaker |
| [CI/CD 最佳实践](/devops/cicd/pipeline-design) | 7 篇 | 流水线设计、代码质量、制品管理、安全扫描 |

## 学习路径建议

```
第一阶段：Git 基础（2-3 天）
→ 掌握 Git Flow / GitHub Flow 工作流
→ 深入理解 merge、rebase、cherry-pick、stash
→ 规范化提交信息：Conventional Commits
→ 配置 Git Hooks 实现提交前检查

第二阶段：Jenkins 入门（1 周）
→ 搭建 Master-Slave 架构
→ 编写 Jenkinsfile 声明式流水线
→ 集成 Docker 构建镜像
→ 集成 SonarQube 做代码质量检查

第三阶段：现代 CI/CD 工具（1 周）
→ GitHub Actions 工作流配置
→ GitLab CI 流水线语法
→ ArgoCD GitOps 实践
→ Tekton 入门（Kubernetes 原生 CI/CD）

第四阶段：工程化提升（1 周）
→ 多环境部署策略（蓝绿、金丝雀）
→ 镜像安全扫描（Trivy、Clair）
→ 制品库设计与 Nexus/Harbor 集成
→ 完整的端到端流水线搭建
```

## CI 和 CD 的本质区别

很多人把 CI/CD 当成一个词，但它们解决的是不同的问题：

- **CI（持续集成）**：代码合并到主干后，自动跑构建、单元测试、代码扫描。目标是尽早发现集成错误，保证代码质量。核心衡量指标是「构建成功率」和「平均构建时间」。
- **CD（持续交付/部署）**：把通过测试的代码，自动部署到各个环境（测试、预生产）。目标是让软件随时处于可发布状态。核心衡量指标是「部署频率」和「变更前置时间」。

没有扎实的 CI，CD 就是空中楼阁。很多团队的 CD 流水线看起来很美，但三天两头构建失败，根本原因在 CI 阶段没做好质量门禁。

## 面试的核心逻辑

CI/CD 面试的核心，在于考察你对「软件交付全流程」的理解：

1. **流程设计**：你能设计一个完整的 CI/CD 流水线吗？每个阶段做什么？质量门禁怎么设置？
2. **工具选型**：Jenkins vs GitLab CI vs GitHub Actions，你选哪个？为什么？
3. **问题排查**：构建失败怎么排查？流水线跑得慢怎么优化？
4. **安全意识**：镜像扫描放在哪个阶段？制品库怎么管理权限？
5. **部署策略**：蓝绿部署和金丝雀发布的区别是什么？什么时候用哪个？

> "CI/CD 流水线就像一条生产线，面试官想知道的是：你有没有站在生产线外面看过全局，理解每个环节为什么要这样设计。"
