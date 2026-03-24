# Git 分支管理策略

「分支应该怎么命名？怎么管理？」——这是团队协作中最实际的问题。

没有规范的分支管理会导致：合并冲突频发、发布版本混乱、hotfix 和新功能打架。好的分支策略让团队协作清晰高效。

## 常见分支命名规范

### 格式：`类型/描述`

```
feature/user-authentication          # 功能分支
feature/payment-integration
bugfix/login-redirect-loop          # Bug 修复
bugfix/memory-leak-in-cache
hotfix/security-vulnerability-cve   # 紧急修复
hotfix/production-data-loss
release/v2024.01.00                # 发布分支
chore/update-dependencies           # 维护任务
docs/add-api-documentation         # 文档更新
refactor/extract-service-layer     # 重构
test/add-integration-tests         # 测试
```

### 团队常用的分支前缀

| 前缀 | 用途 | 示例 |
|------|------|------|
| feature/ | 新功能开发 | feature/graphql-api |
| bugfix/ | Bug 修复 | bugfix/fix-session-timeout |
| hotfix/ | 紧急生产修复 | hotfix/critical-auth-bug |
| release/ | 发布准备 | release/v2.0.0 |
| chore/ | 构建/工具/依赖更新 | chore/upgrade-spring-boot |
| docs/ | 文档更新 | docs/add-deployment-guide |
| refactor/ | 代码重构 | refactor/extract-auth-service |
| test/ | 测试相关 | test/add-e2e-payment-flow |
| wip/ | 正在进行的工作 | wip/experimental-ai-feature |

## 保护分支

在 GitLab/GitHub 上配置分支保护规则：

```bash
# GitLab 保护分支配置
# Settings → Repository → Protected branches
# 保护 main 分支：
# - Allowed to merge: maintainers
# - Allowed to push: nobody
# - Require approvals: 2
# - Require status checks to pass: ci/lint + ci/test
```

```bash
# GitHub 分支保护规则
# Settings → Branches → Add rule
# Branch name pattern: main
# ✓ Require pull request reviews before merging (2 reviewers)
# ✓ Require status checks to pass before merging
# ✓ Require branches to be up to date before merging
# ✓ Do not allow bypassing the above settings
```

## 多环境分支策略

### 环境对应分支

```
production     ←─── 生产环境（代码 = 上线的代码）
     ▲
     │ 合并
     │
staging        ←─── 预发布环境（测试人员验收）
     ▲
     │ 合并
     │
develop        ←─── 开发主分支（所有功能集成的分支）
     ▲
     │ PR 合并
     │
feature/*      ←─── 功能分支
```

### CI/CD 自动化触发

```yaml
# .gitlab-ci.yml 或 GitHub Actions 触发规则
branches:
  # main 分支变化 → 触发生产部署
  - main
  # staging 分支变化 → 触发预发布环境部署
  - staging
  # develop 分支变化 → 触发开发环境部署
  - develop
  # feature/* 变化 → 触发 feature 环境或 CI 流水线
  - feature/*
```

## 长生命周期分支管理

对于需要维护多个版本的团队：

```
main                   ←─── 始终是最新的生产代码
  │
  ├── release/2.0.x     ←─── 维护 2.0.x 版本
  │     │
  │     └── hotfix/2.0.1-fix  ←─── 2.0.x 的紧急修复
  │           │
  │           └── 合并回 release/2.0.x 和 main
  │
  ├── release/1.9.x     ←─── 维护 1.9.x 版本（即将 EOL）
  │     │
  │     └── hotfix/1.9.5-fix  ←─── 最后一次维护版本修复
  │
  └── develop           ←─── 开发主分支（未来的 2.1.x）
```

### 版本号语义化（Semantic Versioning）

```
major.minor.patch
  │     │     │
  │     │     └── patch: Bug 修复，向后兼容
  │     └──────── minor: 新功能，向后兼容
  └────────────── major: 破坏性变更，不向后兼容
```

## GitHub Actions 中的分支过滤

```yaml
name: CI Pipeline

on:
  push:
    branches:
      - main          # main 推送
      - develop       # develop 推送
      - 'feature/**'  # feature 开头的分支
  pull_request:
    branches:
      - main
      - develop

jobs:
  ci:
    runs-on: ubuntu-latest
    if: github.ref != 'refs/heads/main' || github.event_name == 'pull_request'
    # ...
```

## 团队分支管理最佳实践

1. **main 是唯一真相**：所有分支最终都合并到 main
2. **功能分支命名有意义**：`feature/user-auth` 比 `feature/abc` 好
3. **频繁同步 main**：`git rebase main` 而非 `git merge main`（避免引入多余 merge commit）
4. **小步提交**：每个 commit 逻辑完整，便于回滚和 cherry-pick
5. **删除已合并的分支**：避免分支列表膨胀

```bash
# 删除本地已合并的分支
git branch --merged main | grep -v 'main' | xargs git branch -d

# 清理远程已删除的分支
git fetch --prune

# 一行命令删除所有已合并的 feature 分支
git branch --merged develop | grep -E 'feature/' | xargs -r git branch -d
```

## 面试追问方向

- 分支命名混乱会导致什么问题？命名规范的制定应该谁来参与？
- 长生命周期分支和短生命周期分支的管理有什么区别？
- 在 GitHub Flow 中，hotfix 怎么处理？是否需要经过完整的 PR 流程？
- 如何设计一个适合自己团队的分支策略？需要考虑哪些因素？

> 分支策略不是一成不变的。随着团队规模、项目复杂度、发布节奏的变化，策略也需要相应调整。核心原则是：清晰、高效、可追溯。
