# Ansible

运维自动化的瑞士军刀，无代理的批量配置管理工具。

Ansible 是运维工程师最该掌握的工具之一。它的设计哲学简洁而强大：无代理（不需要在被管理节点安装软件）、幂等性（执行一次和执行一百次效果一样）、声明式（描述目标状态，而不是操作步骤）。从配置文件管理到应用部署，从 Docker 编排到 Kubernetes 集群维护，Ansible 都能覆盖。

## 模块速览

Ansible 在本项目中的定位是「基础设施自动化的粘合剂」——用它连接服务器、Docker、Kubernetes、Cloud APIs，构建端到端的自动化流程。

|| 方向 | 篇数 | 核心目标 |
||------|------|----------|
|| [Ansible 架构](/devops/ansible/architecture) | 1 篇 | Inventory、Playbook、Modules、Galaxy 生态 |
|| [Ansible Playbook](/devops/ansible/playbook) | 1 篇 | YAML 语法、变量、条件、循环、错误处理 |
|| [Ansible Roles](/devops/ansible/roles) | 1 篇 | Role 目录结构、Galaxy、复用与维护 |
|| [Ansible 集成](/devops/ansible/integration) | 1 篇 | Docker 编排、K8s 资源管理、Helm 集成 |

## 学习路径建议

```
第一阶段：概念入门（1-2 天）
→ 理解 Ansible 的无代理设计和幂等性
→ 安装 Ansible（pip install ansible）
→ 第一个 Inventory 和 Ad-Hoc 命令
→ ansible vs ansible-playbook

第二阶段：Playbook 基础（3-4 天）
→ YAML 语法和 Playbook 结构
→ 变量定义与 Jinja2 模板
→ 条件（when）和循环（loop）
→ Handlers 和任务控制
→ 错误处理（block/rescue）

第三阶段：Roles 与复用（2-3 天）
→ Role 目录结构
→ Ansible Galaxy 使用
→ 编写可复用的 Role
→ Role 依赖管理

第四阶段：与企业组件集成（3-4 天）
→ Ansible + Docker
→ Ansible + Kubernetes（k8s 模块）
→ Ansible + Helm（k8s_helm 模块）
→ 完整的 CI/CD 流水线示例
```

## Ansible 解决了什么问题

传统运维的问题：

```
手动运维
├── 10 台服务器，每台都要执行相同的操作
├── 配置文件不一致，环境差异大
├── 新机器部署靠「文档 + 复制粘贴」
└── 出了问题不知道在哪台机器上

Ansible 运维
├── 写一个 Playbook，100 台服务器一起执行
├── 所有配置代码化，版本可控
├── 新机器上线一键搞定
└── 所有操作都有记录，可审计
```

## 和其他工具的对比

|| 维度 | Ansible | Chef/Puppet | Terraform |
||------|---------|-----------|-----------|
|| Agent | 无 | 需要 | 无 |
|| 设计理念 | 幂等自动化 | 配置持续合规 | 声明式基础设施 |
|| 核心用途 | 配置管理、应用部署 | 配置管理 | 基础设施创建/销毁 |
|| 状态管理 | 无状态 | 无状态 | State 文件 |
|| 语法 | YAML | Ruby DSL | HCL |
|| 学习曲线 | 低 | 中 | 中 |

## 面试的核心逻辑

Ansible 面试的核心，不是让你背命令，而是考察三个层次的理解：

1. **基础概念**：Inventory、Playbook、Module、Role 是什么？为什么说 Ansible 是幂等的？
2. **实战能力**：如何编写一个可复用的 Role？如何处理跨平台（Linux/Windows）的差异？
3. **架构思维**：什么场景用 Ansible？什么场景用 Terraform？为什么 Ansible 不适合管理 K8s 资源创建（而应该用 kubectl/helm）？

> "Ansible 的价值，在于把『人围着机器转』变成『机器围着人转』。运维工程师应该用工具，而不是被工具用。"
