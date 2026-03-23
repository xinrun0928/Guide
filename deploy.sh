#!/usr/bin/env sh

# 确保脚本遇到错误时退出
set -e

# 进入构建产物目录
cd docs/.vitepress/dist

# 清理旧的 git 相关文件，确保干净的部署
rm -rf .git

# 关键修改：创建 CNAME 文件并写入自定义域名
echo "guide.docs.zxinrun.cn" > CNAME

# 初始化 git
git init

# 添加远程仓库
git remote add origin git@github.com:xinrun0928/DBInsight.git

# 添加所有文件
git add -A

# 提交
git commit -m 'deploy: build for GitHub Pages'

# 推送到 gh-pages 分支
git push -u origin main:gh-pages -f

# 返回原目录
cd - > /dev/null
