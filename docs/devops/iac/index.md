# 基础设施即代码（IaC）

代码化的基础设施，是云时代运维的必然归宿。

传统运维里，改一台服务器的配置，要么是登上去手动改，要么是写个脚本传上去。问题在于：改了之后怎么保证幂等？出了问题怎么回滚？谁改的、什么时候改的、为什么改？

IaC（Infrastructure as Code）用写代码的方式管理基础设施：所有配置都在代码仓库里，有版本历史、可审计、可回滚、可复用。Terraform、Pulumi、Ansible，都是这个理念的践行者。

这篇文章系列覆盖 Terraform 基础与 HCL 语法、模块化与状态管理、Pulumi 编程式 IaC，以及工具选型对比，帮助你从「手工作坊式运维」过渡到「工程化运维」。

## 模块速览

IaC 工具的三条路线：声明式（HCL）、编程式（SDK）、配置管理式（YAML/Ansible）。每条路线都有它的适用场景。

| 方向 | 篇数 | 核心目标 |
|------|------|----------|
| [Terraform 基础与 HCL 语法](/devops/iac/terraform) | 1 篇 | 声明式语法、资源管理、Provider 生态 |
| [Terraform 模块化与状态管理](/devops/iac/terraform-module) | 1 篇 | 模块复用、远程状态、状态锁定 |
| [Pulumi：用代码管理云资源](/devops/iac/pulumi) | 1 篇 | 编程式 IaC、TypeScript/Python 支持 |
| [Ansible vs Terraform vs Pulumi 对比](/devops/iac/compare) | 1 篇 | 三种路线的选型决策 |

## 学习路径建议

```
第一阶段：Terraform 入门（1 周）
→ 理解声明式 vs 命令式配置的区别
→ 掌握 HCL 语法：resource、variable、output、data
→ 编写第一个 Terraform 配置文件（创建 VPC、EC2）
→ 状态管理：本地 vs 远程（ S3 + DynamoDB）
→ 引入模块化：抽取可复用组件

第二阶段：Terraform 进阶（1 周）
→ Provider 配置与多云支持
→ 工作区（Workspace）实现环境隔离
→ 远程状态锁定与并发控制
→ 敏感信息管理：Vault 集成或 Sensitive 标记
→ 迁移与导入已有资源

第三阶段：Pulumi 入门（2-3 天）
→ Pulumi vs Terraform 的核心差异
→ 用 TypeScript/Python/Pulumi 管理云资源
→ 熟悉 Pulumi 的 Stack 概念与状态管理

第四阶段：选型与融合（1 周）
→ 什么场景用 Terraform？什么场景用 Ansible？
→ Pulumi 的优势：循环、条件、函数式逻辑
→ 团队 IaC 实践：目录结构、代码审查、CI/CD 集成
```

## 声明式 vs 编程式：两条路线的取舍

Terraform 和 Pulumi 代表了 IaC 的两条主流路线：

**Terraform（声明式）**：
- 用 HCL 语言描述「最终状态」
- 你声明「我要 3 台机器，带这个配置」，Terraform 计算出「怎么做」
- 优势：语法简洁、状态管理内置、社区成熟（Provider 生态丰富）
- 局限：逻辑表达能力弱，循环和条件需要借助语言扩展

**Pulumi（编程式）**：
- 用熟悉的编程语言（TypeScript、Python、Go）写代码
- 你用代码描述「怎么创建这些资源」，Pulumi 执行代码来创建
- 优势：逻辑表达能力完整，可以复用已有的代码库
- 局限：状态管理需要额外考虑，团队学习成本更高

没有绝对的优劣，只有场景的匹配度——基础设施定义用 Terraform，复杂配置管理用 Ansible，需要复杂逻辑的地方用 Pulumi。

## 面试的核心逻辑

IaC 的面试，核心在于考察你对「工程化运维」的理解：

1. **基础概念**：声明式和命令式的区别是什么？为什么 IaC 比手动运维更可靠？
2. **Terraform 原理**：Terraform 的状态文件存储了什么？为什么不能删除？如何处理状态锁定？
3. **模块化思维**：如何设计可复用的 Terraform 模块？模块的版本怎么管理？
4. **工程实践**：多环境（dev、staging、prod）怎么隔离？敏感信息怎么处理？
5. **工具选型**：为什么很多团队同时用 Terraform 和 Ansible？它们各自解决什么问题？

> "IaC 的本质是把「确定性」引入运维。好的 IaC 设计，应该是任何一个人 Checkout 代码后，都能跑出一套一模一样的环境。"
