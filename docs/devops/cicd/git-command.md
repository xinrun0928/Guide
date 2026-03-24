# Git 常用命令与原理：merge、rebase、cherry-pick、stash

「git add、git commit、git push 之外，你真的理解 Git 吗？」

很多人每天都在用 Git，但问到 merge 和 rebase 的区别、stash 的原理、cherry-pick 怎么用时，往往说不清楚。这一篇把 Git 的核心命令和底层原理讲清楚。

## Git 的四个区域

```
┌────────────────────────────────────────────────────┐
│  工作目录（Working Directory）                        │
│  你实际编辑文件的地方                                 │
└─────────────────────┬──────────────────────────────┘
                      │ git add
                      ▼
┌────────────────────────────────────────────────────┐
│  暂存区（Staging Area / Index）                      │
│  准备提交的文件快照                                   │
└─────────────────────┬──────────────────────────────┘
                      │ git commit
                      ▼
┌────────────────────────────────────────────────────┐
│  本地仓库（Local Repository）                        │
│  .git 目录，永久存储                                 │
└─────────────────────┬──────────────────────────────┘
                      │ git push
                      ▼
┌────────────────────────────────────────────────────┐
│  远程仓库（Remote Repository）                       │
│  GitHub / GitLab / Gitea                           │
└────────────────────────────────────────────────────┘
```

## git merge vs git rebase：两种合并方式

### merge：保留完整历史

`git merge` 将两个分支的历史合并，保留完整的分叉记录：

```
main:     A──B──C───M
              \       /
feature:       D──E───F
```

merge 后：

```
main:     A──B──C───M
              \       /
feature:       D──E───F
                   ↑
               merge commit M
```

```bash
git checkout main
git merge feature/login
# Fast-forward（如果 main 没有新提交）
# 或创建 merge commit（如果 main 有新提交）
```

### rebase：改写历史，创建线性历史

`git rebase` 将当前分支的提交「移植」到目标分支的顶部：

```
初始状态：
main:     A──B──C
              \
feature:       D──E──F

rebase 后：
main:     A──B──C
              \     \
feature:         D'──E'──F'  ← 提交被重新应用（哈希改变）
```

```bash
git checkout feature/login
git rebase main
# 现在 feature/login 的基础从 B 变成了 C
# 之后可以 fast-forward merge 到 main
```

### 什么时候用哪个？

| 场景 | 推荐 | 原因 |
|------|------|------|
| PR 合并到 main | rebase（squash merge） | 保持线性历史，不引入多余 merge commit |
| 合并 release 分支 | merge | 保留完整的发布历史 |
| 功能分支同步 main 最新代码 | rebase | 避免引入多余 merge commit |
| 多人协作的 long-lived 分支 | merge | 保留协作历史，避免 rebase 覆盖他人提交 |

**黄金法则**：**不要 rebase 已经推送的提交**。rebase 会改写提交历史，如果其他人已经基于你的旧提交继续开发，会造成混乱。

## cherry-pick：选择性地应用提交

`cherry-pick` 将某个提交的变更「摘取」到当前分支：

```
main:     A──B──C───D───E
              ▲
              cherry-pick B
              ▼
current:  A──X──B'──Y──Z
                ↑
            B 的变更被应用（新哈希）
```

### 实际场景

```bash
# 场景一：把某个 bugfix 提交应用到其他分支
git checkout main
git cherry-pick abc1234
# abc1234 是 hotfix/critical-bug 的提交哈希

# 场景二：cherry-pick 多个提交
git cherry-pick abc1234..def5678  # 不包含 abc1234，包含 abc1234+1 到 def5678
git cherry-pick abc1234^..def5678  # 包含 abc1234 到 def5678

# 场景三：cherry-pick 后不停，继续 cherry-pick 下一个
git cherry-pick --continue

# 场景四：cherry-pick 但不想自动提交
git cherry-pick -n abc1234
# -n: 不自动提交，可以调整后再提交
```

### cherry-pick vs merge

| 维度 | cherry-pick | merge |
|------|------------|------|
| 提交历史 | 不保留原始提交历史（生成新提交） | 保留完整分叉历史 |
| 适用场景 | 单个/少量提交迁移 | 整个分支合并 |
| 提交哈希 | 新哈希 | 不变 |

## git stash：临时存放工作

`stash` 把当前工作目录和暂存区的变更保存起来，让工作目录回到干净状态：

```bash
# 场景：正在开发，突然要切到另一个分支处理紧急问题
git stash
# 当前未提交的变更被保存，目录变干净

git checkout other-branch
# 处理紧急问题...

git checkout feature/my-feature
git stash pop  # 恢复之前的变更

# stash 的其他用法
git stash list              # 查看所有 stash
git stash show             # 查看某个 stash 的变更
git stash show -p stash@{0}  # 查看详细 diff
git stash pop              # 恢复并删除 stash
git stash apply           # 恢复但不删除 stash
git stash drop stash@{0}  # 删除某个 stash
git stash clear           # 清空所有 stash

# stash 特定文件
git stash push -m "wip: login feature" src/login/
git stash pop
```

### stash 的原理

stash 实际上是一个特殊的 commit 对象，存储在 `.git/refs/stash` 中：

```bash
# stash 其实是两个 commit
# 1. 第一个 commit：工作目录的变更
# 2. 第二个 commit：暂存区的变更
# 两者通过 parent 关系链接
```

### stash 的坑

1. **stash 不跟踪 untracked 文件**（需要 `-u`）：
```bash
git stash -u  # 同时 stash untracked 文件
git stash -a  # stash 所有文件（包括 .gitignore 中的）
```

2. **stash 不保存分支信息**：
```bash
# 如果多个分支都有 stash，需要用 stash@{n} 的索引来区分
git stash list
# stash@{0}: WIP on feature/login: abc1234 fix login redirect
# stash@{1}: WIP on feature/payment: def5678 add payment gateway
```

## git reflog：恢复「丢失」的提交

reflog 是 Git 的「后悔药」，记录了 HEAD 指针的所有移动历史：

```bash
# 场景：reset --hard 后发现丢失了重要提交
git reflog
# abc1234 HEAD@{0}: reset: moving to HEAD~3
# def5678 HEAD@{1}: commit: add critical feature
# ...

# 恢复丢失的提交
git checkout def5678
# 或者
git branch recovery def5678

# 场景：rebase 后想回到之前的状态
git reflog
# 找到 rebase 前的提交哈希
git reset --hard HEAD@{n}
```

reflog 默认保留 90 天，**不要依赖于 reflog 做长期备份**。

## git bisect：二分查找定位问题提交

当某个 bug 难以定位时，`git bisect` 可以自动二分查找：

```bash
# 开始二分查找
git bisect start

# 标记当前提交是「有 bug 的」
git bisect bad

# 标记某个已知的正常提交
git checkout v1.0.0
git bisect good

# Git 会自动 checkout 中间的提交
# 测试后告诉 Git 当前提交是好是坏
git bisect good  # 或 git bisect bad

# Git 自动 checkout 下一个...
# 直到找到第一个有 bug 的提交

# 完成后恢复
git bisect reset
```

## 面试追问方向

- merge 和 rebase 的本质区别是什么？为什么说 rebase 会改写历史？
- merge 时的 fast-forward 是什么？什么情况下不会 fast-forward？
- cherry-pick 后的提交和原提交的哈希为什么不一样？
- stash 和 commit 的区别是什么？stash 能 stash untracked 文件吗？
- git reset 的三种模式（soft、mixed、hard）各有什么区别？

> Git 不只是一个「代码仓库」，更是一个时间机器。理解它的底层机制，才能在遇到问题时从容应对。
