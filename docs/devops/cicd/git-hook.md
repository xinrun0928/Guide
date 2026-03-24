# Git Hooks 与 CI 集成

「代码提交前，能不能自动做检查？」——Git Hooks 就是答案。

Git Hooks 让 Git 在特定时机触发自定义脚本：提交前做 lint、提交后自动推送、合并前跑测试。这些自动化检查，是高质量 CI/CD 流水线的第一步。

## Git Hooks 的工作原理

Git Hooks 存储在 `.git/hooks/` 目录下，每个 hook 是一个可执行脚本：

```
.git/hooks/
├── applypatch-msg.sample
├── commit-msg
├── post-applypatch
├── post-checkout
├── post-commit          ← 提交完成后自动执行
├── post-merge
├── post-receive        ← 推送到远程后执行（远程 hook）
├── pre-applypatch
├── pre-auto-gc
├── pre-commit          ← 提交前自动执行
├── pre-push           ← 推送前自动执行
├── pre-rebase
├── prepare-commit-msg  ← 编辑器打开前执行
├── push-tx
├── reference-transaction
├── sendemail-validate
├── server-side
├── update             ← 推送时远程执行
└── fsmonitor-watchman.sample
```

**关键**：`.git/hooks/` 中的 hook 默认不生效，需要去掉 `.sample` 后缀。

## 常用 Hook

### pre-commit：提交前检查

最常用的 hook，在 `git commit` 执行前运行，脚本返回非零则提交失败：

```bash
#!/bin/sh
# .git/hooks/pre-commit

# 场景一：运行 ESLint 检查 JavaScript
echo "Running ESLint..."
npx eslint .

# 场景二：运行单元测试
echo "Running tests..."
npm test
if [ $? -ne 0 ]; then
    echo "Tests failed. Commit aborted."
    exit 1
fi

# 场景三：检查 commit message 格式（commit-msg hook 更适合）
echo "Checking code formatting..."
npx prettier --check "src/**/*.{js,ts}"
if [ $? -ne 0 ]; then
    echo "Formatting issues found. Run 'npx prettier --write' to fix."
    exit 1
fi
```

### commit-msg：检查提交信息格式

```bash
#!/bin/sh
# .git/hooks/commit-msg

COMMIT_MSG=$(cat "$1")
PATTERN="^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?: .{1,50}"

if ! echo "$COMMIT_MSG" | grep -qE "$PATTERN"; then
    echo "Invalid commit message format."
    echo "Expected: <type>(<scope>): <description>"
    echo "Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert"
    exit 1
fi
```

### pre-push：推送前最后检查

```bash
#!/bin/sh
# .git/hooks/pre-push

echo "Running pre-push checks..."

# 运行完整的 CI 检查
npm run ci
if [ $? -ne 0 ]; then
    echo "CI checks failed. Push aborted."
    exit 1
fi

# 检查是否有未提交的依赖变更
if git diff --cached --name-only | grep -q "package"; then
    echo "Dependencies changed. Run 'npm install' and commit."
    exit 1
fi

echo "All pre-push checks passed."
```

### post-commit：提交后自动通知

```bash
#!/bin/sh
# .git/hooks/post-commit

# 提交后自动推送到远程（可选）
# git push

# 通知 Slack/飞书（可集成 webhook）
if command -v curl &> /dev/null; then
    COMMIT_MSG=$(git log -1 --pretty=%B)
    AUTHOR=$(git log -1 --pretty=%an)
    curl -X POST "https://hooks.slack.com/services/xxx" \
        -H 'Content-Type: application/json' \
        -d "{\"text\":\"New commit by ${AUTHOR}: ${COMMIT_MSG}\"}"
fi
```

## Husky：管理 Git Hooks 的最佳工具

直接编辑 `.git/hooks/` 的方式原始且难以同步到团队。Husky 让 Hooks 配置在 `package.json` 中管理，通过 npm 包安装：

```bash
npm install husky --save-dev
```

### 初始化

```bash
npx husky install
# 自动创建 .husky/ 目录和 prepare script
```

### 添加 hook

```bash
npx husky add .husky/pre-commit "npx lint-staged"
# 自动创建 .husky/pre-commit 文件
```

### package.json 中集成 prepare script

```json
{
  "scripts": {
    "prepare": "husky install"
  }
}
```

团队成员 `npm install` 时自动安装 hooks。

### 实际 .husky 目录内容

```
.husky/
├── _/
│   └── .gitignore
├── commit-msg
├── pre-commit
└── pre-push
```

### commit-msg hook

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npx --no -- commitlint --edit ${1}
```

### pre-commit hook

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

echo "Running pre-commit checks..."

# 运行 lint-staged
npx lint-staged

echo "Pre-commit checks passed."
```

## lint-staged：对暂存的文件运行检查

`lint-staged` 只对 `git add` 暂存的文件运行检查，避免检查整个项目：

```bash
npm install --save-dev lint-staged
```

```json
// package.json
{
  "lint-staged": {
    "*.{js,ts,jsx,tsx}": [
      "eslint --fix",
      "prettier --write",
      "jest --findRelatedTests"
    ],
    "*.{css,scss}": [
      "stylelint --fix"
    ],
    "*.md": [
      "markdownlint --fix"
    ]
  }
}
```

### 工作流程

```bash
# 开发者修改了 10 个文件，但只暂存了 3 个
git add file1.js file2.js file3.js
git commit -m "feat: update auth logic"
#         ↑
# lint-staged 只检查这 3 个文件
# 而不是全部 10 个
```

## CI 集成：GitHub Actions 中的 Hooks

Git Hooks 也可以在 CI 环境中强制执行：

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  pre-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Verify commit messages
        run: |
          npx commitlint --from ${{ github.event.pull_request.base.sha }}
                    --to ${{ github.event.pull_request.head.sha }}
                    --verbose

      - name: Run linters
        run: npm run lint

      - name: Run tests
        run: npm test

      - name: Build
        run: npm run build
```

### commitlint 与 GitHub Actions 集成

```yaml
- name: Validate PR commits
  if: github.event_name == 'pull_request'
  run: |
    npx commitlint --from origin/main --to HEAD --verbose
```

## 常见问题

### Hooks 不生效

```bash
# 检查 hook 文件是否有执行权限
ls -la .git/hooks/pre-commit

# 添加执行权限
chmod +x .git/hooks/pre-commit
chmod +x .husky/pre-commit
```

### CI 和本地 Hooks 不一致

解决方案：本地 hooks 做快速检查（lint、format），CI 做完整检查（test、security scan）。

### 临时跳过 Hooks

```bash
# 紧急情况，跳过 pre-commit hooks
git commit -m "emergency fix" --no-verify

# 推送跳过 pre-push hooks
git push --no-verify
```

**警告**：这是危险操作，应该只在极端紧急情况下使用。

## 面试追问方向

- Git Hooks 和 CI 流水线的关系是什么？各自适合做什么检查？
- pre-commit 和 pre-push 的检查有什么区别？为什么 pre-push 更重要？
- Husky 的 `.git/hooks/` 是怎么被自动创建的？它解决了什么问题？
- lint-staged 为什么只检查暂存的文件？这样设计有什么好处？

> Git Hooks 是 CI/CD 的第一道门卫。在代码进入仓库之前就发现问题，比在流水线里发现问题成本低得多。
