# Git 工作流：Git Flow、GitHub Flow、Trunk-Based Development

「团队协作，代码怎么管？」——不同的开发规模，需要不同的 Git 工作流。

Git 工作流解决的是「什么时候合并代码」「谁可以合并」「分支怎么命名」这三个核心问题。没有银弹式的最佳实践，只有适合团队规模的方案。

## 三种工作流的定位

```
┌──────────────────────────────────────────────────────────────┐
│  Git Flow         │  GitHub Flow       │  Trunk-Based    │
│  适合：发布周期长  │  适合：持续交付      │  适合：大规模    │
│  的复杂项目        │  的简单项目          │  高频协作团队    │
└──────────────────────────────────────────────────────────────┘
```

## Git Flow：适合发布周期长的复杂项目

Git Flow 由 Vincent Driessen 在 2010 年提出，适合有固定发布周期、需要维护多个版本的团队。

### 分支结构

```
main (生产环境)
  ├─── hotfix/xxx     (紧急修复，从 main 切出，合并回 main 和 develop)
  │         ▲
  │         └─────────────────────┐
  │                               │
  ├── release/xxx   (发布准备，从 develop 切出，测试通过后合并到 main)
  │
  │
develop (开发主分支)
  │         ▲
  │         │
  └── feature/xxx  (功能开发，从 develop 切出，开发完成后合并回 develop)
```

### 核心规则

| 分支 | 来源 | 合并目标 | 命名规则 |
|------|------|---------|---------|
| main | - | - | `main`（永远可部署） |
| develop | main | - | `develop`（开发主分支） |
| feature/* | develop | develop | `feature/user-auth` |
| release/* | develop | main + develop | `release/2024.01` |
| hotfix/* | main | main + develop | `hotfix/login-bug` |

### 完整流程

```bash
# 1. 从 develop 创建功能分支
git checkout develop
git pull origin develop
git checkout -b feature/payment-module

# 2. 开发完成后，合并到 develop
git checkout develop
git merge --no-ff feature/payment-module
git branch -d feature/payment-module
git push origin develop

# 3. 准备发布，从 develop 切出 release 分支
git checkout develop
git checkout -b release/2024.01.00

# 4. 在 release 分支上做最后的 bug 修复（不开发新功能）
# 修复完成后，合并到 main 并打标签
git checkout main
git merge --no-ff release/2024.01.00
git tag -a v2024.01.00 -m "Release version 2024.01.00"
git push origin main --tags

# 5. release 分支合并回 develop
git checkout develop
git merge --no-ff release/2024.01.00
git branch -d release/2024.01.00

# 6. 紧急修复
git checkout main
git checkout -b hotfix/critical-bug
# 修复...
git checkout main
git merge --no-ff hotfix/critical-bug
git push origin main
git checkout develop
git merge --no-ff hotfix/critical-bug
git branch -d hotfix/critical-bug
```

### 优点

- 清晰的发布周期管理
- hotfix 和 feature 并行开发不冲突
- 适合需要维护多个发布版本的场景

### 缺点

- 分支过多，流程复杂
- 不适合持续交付（发布分支周期长）
- 合并冲突概率高

## GitHub Flow：适合持续交付的简单项目

GitHub Flow 是 GitHub 官方推荐的工作流，核心思想是**一切围绕 PR 展开**。

### 原则

1. `main` 分支永远可部署
2. 所有变更通过 PR 合并
3. PR 通过 CI/CD 后才能合并
4. 合并后立即部署

### 流程

```
main ──────────────────────────────────────────────────────► main
         │                                                     ▲
         │  feature/xxx (PR #42)                              │
         │    - 写代码                                        │
         │    - 开 PR，Code Review                            │
         │    - CI 通过                                        │
         │    - 合并 ────────────────────────────────────────┘
```

### 实际操作

```bash
# 1. 从 main 创建功能分支
git checkout main
git pull origin main
git checkout -b feature/add-dark-mode

# 2. 在功能分支上开发，频繁 push
git add .
git commit -m "feat: add dark mode toggle"
git push origin feature/add-dark-mode

# 3. 在 GitHub 上开 Pull Request
# PR 模板应该包含：
# - 功能描述
# - 测试计划
# - 截图/录屏

# 4. Code Review + CI/CD 通过后，合并 PR
# 合并后自动触发部署
```

### 与 Git Flow 的对比

| 维度 | Git Flow | GitHub Flow |
|------|---------|------------|
| 分支数量 | 5 种分支 | 2 种分支 |
| 发布周期 | 固定周期 | 持续交付 |
| 适用规模 | 中大型团队 | 小型团队 |
| 复杂度 | 高 | 低 |
| hotfix 处理 | 需要专门分支 | 直接切 hotfix 合并 |

## Trunk-Based Development：适合大规模高频协作

Trunk-Based Development（TBD）是大规模团队（Google、Facebook、Netflix）的实践。所有开发者在同一个分支（trunk）上工作，分支存活时间极短（< 1 天）。

### 核心规则

1. 所有开发者从 trunk 拉代码
2. 分支存活时间 < 1 天（建议 < 4 小时）
3. feature flag 控制未完成功能
4. 大功能使用短期特性分支 + flag，或大规模特性分支

### 两种实现方式

**方式一：小功能直接提交到 trunk**

```
trunk: main ──► main ──► main ──► main ──► main
             ↑
      feature 直接提交或短命分支（<1天）
```

**方式二：大规模功能使用特性分支**

```
trunk: main ──────────────────────────► main
             ▲         ▲         ▲
             │         │         │
         f1/xxx     f1/xxx    f1/xxx  ← 特性分支，分支内开发
                                        合并前通过 feature flag 启用
```

### Feature Flag 的使用

```java
// 功能还未完成时，用 flag 包裹
if (featureFlags.isEnabled("dark-mode")) {
    return renderDarkMode();
} else {
    return renderLightMode();
}
```

好处：
- 代码可以提前合并，不必等功能完成
- 功能可以在线上灰度开启
- 可以随时关闭有问题的功能

### 优点

- 减少合并冲突（分支存活时间短）
- 持续集成质量高
- 适合大规模团队（Google 3000+ 开发者用这种模式）

### 缺点

- 需要成熟的 CI/CD 体系
- 需要 feature flag 基础设施
- Code Review 压力大

## 选型建议

| 团队规模 | 发布节奏 | 推荐工作流 |
|---------|---------|---------|
| 1-5 人 | 持续交付 | GitHub Flow |
| 5-20 人 | 有固定发布周期 | GitHub Flow + PR 规范 |
| 20 人以上 | 多版本维护 | Git Flow |
| 50 人以上 | 高频交付 | Trunk-Based Development |
| 超大规模 | 持续交付 | Trunk-Based + Feature Flag |

## 面试追问方向

- Git Flow 中 hotfix 为什么需要同时合并到 main 和 develop？
- GitHub Flow 如何处理紧急修复？流程和普通 PR 有什么区别？
- Trunk-Based Development 如何避免「提交到 trunk 的代码影响生产」？
- Feature Flag 的管理成本是什么？什么情况下 feature flag 反而是负担？
- 在 Git Flow 中，如果 release 分支和 develop 同时修改了同一个文件，冲突怎么处理？

> 没有最好的工作流，只有最适合团队规模和工作节奏的方案。理解每种工作流的设计意图，才能在实际项目中做出正确选择。
