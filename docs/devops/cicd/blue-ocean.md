# Jenkins Blue Ocean 可视化流水线

「Jenkins 流水线可视化工具。」——Blue Ocean 是答案。

Blue Ocean 是 Jenkins 官方的流水线可视化界面，它重新设计了 Jenkins 的用户体验，让流水线的创建、监控、问题排查变得更加直观。对于不熟悉 Jenkins 的开发者，Blue Ocean 是降低学习曲线的好工具。

## Blue Ocean 特点

```
传统 Jenkins UI：
  ┌──────────────────────────────────────────────┐
  │  #42 Build   Artifacts   Configuration   │  ← 表格式，层级深
  └──────────────────────────────────────────────┘

Blue Ocean UI：
  ┌──────────────────────────────────────────────┐
  │  [Pipeline Visualizer]                        │
  │  ✓ Checkout ──► ✓ Build ──► ✓ Test ──► ⚠ Deploy │
  │                                              │
  │  [Activity Log]                             │
  │  Stage: Test  →  Failed                     │
  │  [Failed Step: npm test]                    │
  └──────────────────────────────────────────────┘
```

## 核心功能

### 1. 流水线可视化编辑器

Blue Ocean 内置了流水线编辑器，无需手写 Jenkinsfile：

```bash
# Blue Ocean 编辑器支持：
# 1. Stage / Step 的图形化编辑
# 2. Jenkinsfile 自动生成
# 3. 语法高亮和自动补全
# 4. 错误提示
```

### 2. 诊断视图

Blue Ocean 为每个失败的步骤提供诊断视图：

```
┌──────────────────────────────────────────────┐
│  ✗ Test Stage - Failed                      │
│                                              │
│  [Failure Analysis]                          │
│  ┌────────────────────────────────────────┐ │
│  │  mvn test                               │ │
│  │  ────────────────────────────────────  │ │
│  │  Tests run: 150, Failures: 2, Errors: 0 │ │
│  │                                          │ │
│  │  FAILED: UserServiceTest.createUser()    │ │
│  │  Expected: 200, Actual: 500             │ │
│  │                                          │ │
│  │  FAILED: OrderServiceTest.placeOrder()   │ │
│  │  Database connection timeout             │ │
│  └────────────────────────────────────────┘ │
│                                              │
│  [Actions]                                   │
│  [Re-run Failed Tests] [View Full Log]       │
└──────────────────────────────────────────────┘
```

### 3. 多分支流水线视图

Blue Ocean 自动为 Git 仓库中的每个分支创建流水线：

```
┌──────────────────────────────────────────────┐
│  GitHub/myapp                               │
│                                              │
│  Branches         Status    Last Run          │
│  ────────────────────────────────────────── │
│  main             ✓         2 min ago        │
│  feature/auth    ⚠         1 hour ago        │
│  feature/payment  ○         3 hours ago       │
│  bugfix/login    ✓         1 day ago         │
│  release/2.0    ✓         2 days ago         │
└──────────────────────────────────────────────┘
```

## 安装与访问

```bash
# Blue Ocean 作为插件安装
# Manage Jenkins → Manage Plugins → Available
# 搜索 "Blue Ocean" 并安装

# 访问 Blue Ocean
# http://jenkins:8080/blue
# 或点击左侧导航的 "Open Blue Ocean"
```

## 多分支流水线配置

Blue Ocean 支持 Multibranch Pipeline 项目，自动扫描 Git 仓库：

```bash
# 1. 创建 Multibranch Pipeline
# New Item → Multibranch Pipeline

# 2. 配置 Git 仓库
# Branch Sources → Add Source → Git
# Project Repository: git@github.com:org/myapp.git
# Credentials: (SSH key or token)

# 3. 自动扫描行为
# Behaviors → Filter by name (with wildcards)
# Include: */main, */feature/*, */bugfix/*
# Exclude: */wip/*

# 4. 自动为每个分支创建流水线
# 扫描到 main 分支 → 创建 main 流水线
# 扫描到 feature/* 分支 → 为每个 feature 创建流水线
```

## 从 Blue Ocean 创建流水线

Blue Ocean 的可视化编辑器适合快速创建流水线：

```bash
# 在 Blue Ocean 中：
# 1. New Pipeline → Connect to GitHub → 创建 Organization
# 2. 选择仓库 → Create Pipeline
# 3. Blue Ocean 自动扫描是否有 Jenkinsfile
#    - 有：使用现有的 Jenkinsfile
#    - 无：打开可视化编辑器
# 4. 添加 Stage 和 Step
# 5. 保存，自动生成 Jenkinsfile
```

## 与传统 Jenkinsfile 的关系

Blue Ocean 编辑器生成的 Jenkinsfile 仍然是标准格式：

```groovy
// Blue Ocean 生成的 Jenkinsfile
pipeline {
    agent any
    stages {
        stage('Build') {
            steps {
                echo 'Building...'
                sh 'mvn clean package'
            }
        }
        stage('Test') {
            steps {
                echo 'Testing...'
                sh 'mvn test'
            }
        }
    }
}
```

你可以在 Blue Ocean 编辑器中编辑它，也可以直接用文本编辑器编辑后在 Blue Ocean 中查看。

## GitHub Organization 流水线

Blue Ocean 支持 GitHub Organization 模式，自动为 Organization 下所有仓库创建流水线：

```bash
# 1. 连接 GitHub Organization
# New Item → GitHub Organization
# Owner: my-company
# Credentials: GitHub Personal Access Token

# 2. Blue Ocean 自动：
#    - 列出所有仓库
#    - 为有 Jenkinsfile 的仓库创建流水线
#    - 为有 Dockerfile 的仓库创建 Docker 流水线
#    - 持续扫描新仓库和新分支

# 3. Organization 级别的扫描配置
# Behaviors:
#   - Filter by name (with wildcards): * (所有仓库)
#   - Discover pull requests from forks: true
#   - Discover branches: all / origin-only
```

## Pipeline Run 历史

Blue Ocean 提供了更好的构建历史视图：

```
┌──────────────────────────────────────────────┐
│  Pipeline Runs                                  │
│                                                │
│  Run #44  #43  #42  #41  #40  #39  #38  ... │
│  ─────────────────────────────────────────────│
│  ✓      ✓  ⚠  ✓  ✗  ✓  ✓  ✓                │
│                                                │
│  [Run #42 Details]                            │
│  Started: 2 hours ago by @developer           │
│  Duration: 5 min 23 sec                       │
│  Branch: feature/payment                       │
│  Commit: abc1234 "feat: add payment module"   │
│                                                │
│  Stages:                                       │
│  ✓ Checkout  ✓ Build  ✓ Test  ⚠ Deploy         │
└──────────────────────────────────────────────┘
```

## 最佳实践

### 什么时候用 Blue Ocean？

| 场景 | 推荐 |
|------|------|
| 新手学习 Jenkins 流水线 | ✓ Blue Ocean（可视化创建） |
| 快速原型验证 | ✓ Blue Ocean（拖拽编辑） |
| 大型复杂流水线 | ✗ 文本编辑器（更灵活） |
| 团队代码审查 | ✗ 文本编辑器 + Git PR |
| 排查构建失败 | ✓ Blue Ocean（可视化诊断） |

### Blue Ocean + GitHub PR

Blue Ocean 和 GitHub PR 深度集成：

```groovy
// Jenkinsfile 中支持 changeRequest 条件
pipeline {
    stages {
        stage('Deploy') {
            when {
                allOf {
                    branch 'main'
                    changeRequest()
                }
            }
            steps {
                echo 'Deploying from PR review...'
            }
        }
    }
}
```

## 面试追问方向

- Blue Ocean 和传统 Jenkins UI 各适合什么场景？
- Blue Ocean 编辑器生成的 Jenkinsfile 和手写的有什么区别？
- GitHub Organization 流水线是如何工作的？它怎么发现新仓库？
- Blue Ocean 如何帮助团队协作？

> Blue Ocean 是 Jenkins 的「现代化界面」。它的价值不在于「能用它替代文本编辑器」，而在于「让 Jenkins 流水线对非专家更友好，让问题诊断更直观」。
