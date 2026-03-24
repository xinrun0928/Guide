# Git 提交规范：Conventional Commits

「commit message 怎么写才规范？」——一团乱麻的 commit 历史，半年后连自己都看不懂。

Conventional Commits 是目前最流行的 Git 提交规范。它用格式化的提交信息，让 changelog 自动生成、语义化版本自动判断、PR 描述自动填充成为可能。

## 格式

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

### 组成部分

```
feat(auth): add OAuth2 login support

Implement Google and GitHub OAuth2 authentication flow.
The new AuthService handles token exchange and session creation.

Closes #123
BREAKING CHANGE: drop support for password-based login
```

## Type：提交类型

| Type | 说明 | 是否进入 changelog |
|------|------|------------------|
| feat | 新功能 | ✓ |
| fix | Bug 修复 | ✓ |
| docs | 文档更新 | ✗ |
| style | 代码格式（不影响功能） | ✗ |
| refactor | 重构（既不修 bug 也不加功能） | ✗ |
| perf | 性能优化 | ✓ |
| test | 测试相关 | ✗ |
| build | 构建系统或依赖变更 | ✗ |
| ci | CI 配置变更 | ✗ |
| chore | 其他维护性变更 | ✗ |
| revert | 回滚之前的提交 | ✓ |

## Scope：影响范围（可选）

用括号包裹，指明影响的模块：

```
feat(auth): add password reset functionality
feat(payment): integrate Stripe checkout
fix(api): handle null response from external service
refactor(database): extract connection pooling logic
```

### 常用 scope 列表

```
auth          - 认证/授权
api           - API 接口
ui            - 用户界面
db            - 数据库相关
cache         - 缓存相关
config        - 配置相关
deploy        - 部署相关
security      - 安全相关
logging       - 日志相关
notification  - 通知相关
payment       - 支付相关
search        - 搜索相关
```

## Subject：简短描述

规则：
- 使用祈使句（"add" 而不是 "added" 或 "adds"）
- 不以句号结尾
- 不超过 72 个字符
- 描述「做了什么」，不是「怎么做的」

```
feat: add user profile avatar upload
fix: handle null pointer in order service
refactor: extract payment validation logic
docs: update API documentation for v2 endpoints
```

## Body：详细说明（可选）

- 用祈使句
- 解释「为什么这样做」，不是「做了什么」
- 可以分多行

```
refactor(payment): extract payment gateway abstraction

The payment gateway logic was tightly coupled with Stripe API,
making it impossible to support alternative gateways.
Extracted an abstract PaymentGateway interface and implemented
StripePaymentGateway as the first concrete implementation.

Migration guide available at /docs/migration/payment-gateway.md
```

## Footer：附加信息（可选）

### 关联 Issue

```
Closes #123
Fixes #456, #789
Refs #234  # 仅关联，不关闭
```

### Breaking Changes

```
BREAKING CHANGE: remove deprecated /api/v1/auth/login endpoint

The endpoint was deprecated in v2.0 and is now removed.
Use /api/v2/auth/login instead.

Migration: /docs/migration/v3-migration.md
```

## 提交示例集合

```bash
# 功能提交
git commit -m "feat(checkout): add coupon code support

Add support for applying discount coupons at checkout.
Coupons can be created by admins and redeemed by users.
Supports percentage and fixed amount discounts.

Closes #234"

# Bug 修复
git commit -m "fix(cart): prevent negative quantity in cart

The cart allowed adding items with negative quantities,
which caused incorrect total calculations.
Added validation to reject quantities < 1.

Closes #567"

# 重构提交
git commit -m "refactor(auth): extract token refresh logic into separate service

The token refresh logic was duplicated in multiple places.
Created TokenRefreshService to centralize this behavior and
reduce code duplication by ~150 lines."

# 破坏性变更
git commit -m "feat!: drop support for Java 8

Minimum supported Java version is now Java 11.
Updated all dependencies to versions requiring Java 11+.

BREAKING CHANGE: JDK 8 is no longer supported.
See /docs/migration/jdk-migration.md for upgrade guide.
Closes #890"

# 仅文档
git commit -m "docs: update README with new deployment instructions

Added section on Kubernetes deployment and updated
environment variable reference table.
Closes #111"
```

## 在项目中强制执行

### Commitlint 配置

```yaml
# .commitlintrc.js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat', 'fix', 'docs', 'style', 'refactor',
        'perf', 'test', 'build', 'ci', 'chore', 'revert'
      ]
    ],
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 72]
  }
};
```

### Git Hook 集成

```yaml
# .husky/commit-msg
#!/bin/sh
npx --no -- commitlint --edit ${1}
```

### 提交模板

```bash
# ~/.gitconfig
[commit]
  template = ~/.gitmessage
```

```bash
# ~/.gitmessage
# <type>(<scope>): <subject>
#
# <body>
#
# <footer>
#
# Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
# Scope: auth, api, ui, db, cache, config, deploy, security, logging
#
# BREAKING CHANGE: (use when changes break backward compatibility)
# Closes #<issue_number>

# ↓ 请在此处填写提交信息 ↓

```

## 自动生成 changelog

 Conventional Commits 的真正价值在于自动化。使用 `standard-version` 或 `release-please`：

```bash
# 安装
npm install --save-dev standard-version

# 生成 changelog 和打标签
npx standard-version --release-as 2.0.0
# 或自动判断版本
npx standard-version --first-release
```

生成效果：

```markdown
# Changelog

## [2.0.0] - 2024-01-15

### Features

- **auth**: add OAuth2 login support (#234)
- **checkout**: add coupon code support (#567)

### Bug Fixes

- **cart**: prevent negative quantity in cart (#890)

### BREAKING CHANGES

- **auth**: drop support for Java 8 (migration: /docs/migration/jdk-migration.md)
```

## 面试追问方向

- Conventional Commits 的 type 和语义化版本（semver）是怎么对应的？
- 为什么提交信息要用祈使句？「add」和「added」有什么区别？
- `fix!:` 和 `feat!:` 中的 `!` 是什么意思？
- Breaking Change 怎么在代码中体现？（通常在 CHANGELOG 中手动标注）

> 好的提交信息是团队协作的润滑剂。让每次提交都有意义，让 changelog 自动生成，让回滚精准到提交级别——这是 Conventional Commits 的目标。
