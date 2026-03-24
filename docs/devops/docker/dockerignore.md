# Dockerfile .dockerignore 文件

构建 Docker 镜像时，你有没有遇到过这种情况：镜像体积莫名其妙地大、构建时间异常地长、或者敏感信息不慎被打包进了镜像。

这些问题，很可能是因为你忘了 `.dockerignore` 文件。

## 什么是 .dockerignore？

`.dockerignore` 的作用和 `.gitignore` 类似：告诉 Docker 在构建镜像时，**排除哪些文件不被送入构建上下文**。

构建上下文（Build Context）是 `docker build` 时发送给 Docker daemon 的文件集合。如果不使用 `.dockerignore`，整个目录下的文件都会被发送——无论你是否需要。

```bash
docker build -t myapp .

# 等价于
docker build -t myapp .

# 构建上下文 = 当前目录（.）下的所有文件
```

## 为什么 .dockerignore 很重要？

### 问题一：镜像体积膨胀

```bash
# 假设你的项目目录是这样的
myproject/
├── src/
├── node_modules/         # 几万个文件，几百 MB
├── .git/                 # 版本历史，可能更大
├── dist/                 # 构建产物
├── coverage/             # 测试覆盖率报告
└── Dockerfile

# 如果没有 .dockerignore
# node_modules、.git、dist、coverage 全都会被发送给 Docker daemon
# 上下文大小可能从几 MB 变成几 GB
# 构建时间从几秒变成几分钟
```

### 问题二：敏感信息泄露

```bash
# 敏感文件被打包进镜像
.env                    # 数据库密码、API 密钥
credentials.json
id_rsa
*.pem
```

### 问题三：构建缓存失效

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY . .                # 任何文件变化都会导致这层缓存失效
RUN npm install
```

如果 `.git` 目录或测试文件被包含在上下文中，任何 git 操作或测试运行都会导致整个 `COPY . .` 层缓存失效。

## .dockerignore 语法

`.dockerignore` 使用 Glob 模式匹配：

```
# 注释
*.log                   # 排除所有 .log 文件
*.md                    # 排除所有 markdown 文件
node_modules/           # 排除整个目录
.git/                   # 排除 .git 目录
.vscode/                # 排除编辑器配置
```

### 常用通配符

| 模式 | 含义 |
|------|------|
| `*` | 匹配任意字符（不含路径分隔符） |
| `**` | 匹配任意字符（含路径分隔符） |
| `?` | 匹配单个字符 |
| `[abc]` | 匹配括号内任意字符 |
| `!pattern` | 否定，排除匹配的文件 |

## 典型 .dockerignore 配置

### Node.js 项目

```bash
# Git
.git
.gitignore
.gitattributes

# Node.js
node_modules/
npm-debug.log
yarn-error.log
yarn.lock

# 构建产物
dist/
build/
.next/

# 测试
coverage/
.nyc_output/
*.test.js
*.spec.js
__tests__/

# IDE
.vscode/
.idea/
*.swp
*.swo

# 环境文件
.env
.env.*
!.env.example

# 文档
README.md
CONTRIBUTING.md
LICENSE

# 其他
.DS_Store
Thumbs.db
*.log
*.tmp
```

### Java/Maven 项目

```bash
# Maven
target/
pom.xml.tag
pom.xml.releaseBackup
pom.xml.versionsBackup
pom.xml.next
release.properties

# Git
.git/
.gitignore

# IDE
.idea/
*.iml
.vscode/
*.swp

# 日志
*.log
logs/

# 环境配置
.env
*.properties.secret

# 其他
.DS_Store
Thumbs.db
```

### Go 项目

```bash
# Git
.git/
.gitignore

# 构建产物
*.exe
*.exe~
*.dll
*.so
*.dylib
myapp                     # 二进制文件
test.out
coverage.out

# IDE
.vscode/
.idea/
*.swp

# 其他
*.log
.env
```

### Python 项目

```bash
# Python
__pycache__/
*.py[cod]
*$py.class
*.so
.Python
*.egg-info/
.eggs/
dist/
build/

# Virtual environments
venv/
ENV/
env/

# 测试
.pytest_cache/
.coverage
htmlcov/

# IDE
.vscode/
.idea/
*.swp

# 其他
*.log
.env
```

## 常见错误

### 错误一：排除了需要的文件

```bash
# .dockerignore
*.jar              # ❌ 把构建产物也排除了！

# 正确做法：排除源码构建产物目录，不排除产物
target/
!target/*.jar      # 但保留 jar 文件
```

### 错误二：路径理解错误

```bash
# .dockerignore 中的路径是相对于构建上下文的
# 如果构建命令是：docker build -t myapp ./app
# 那么 .dockerignore 在 ./app 目录下生效
# ./app/.dockerignore 内容：
node_modules/      # 排除 ./app/node_modules/

# 而不是
/app/node_modules/ # ❌ 错误路径
```

### 错误三：忘了否定模式

```bash
# 想排除 node_modules 但保留 node_modules/@types
node_modules/
!node_modules/@types/     # ✅ 使用 ! 保留需要的部分

# 常见场景：排除所有依赖但保留特定的类型定义包
node_modules/
!node_modules/@types/
!node_modules/@babel/
```

## 调试 .dockerignore

如果不确定 `.dockerignore` 的效果，可以用以下方法调试：

### 查看构建上下文

```bash
# 创建临时容器查看上下文内容
docker build -t debug-context .
docker run --rm -it debug-context ls -la /

# 或者使用 .dockerignore 的 dry-run 工具
```

### 查看上下文大小

```bash
# 在项目根目录执行
du -sh ./*                    # 查看各目录大小
du -sh ./.git                 # Git 目录可能很大
du -sh ./node_modules         # npm 包可能很大

# 如果 .dockerignore 生效了，重新构建后上下文应该变小
```

### 验证排除效果

```bash
# 构建时显示上下文大小
docker build -t myapp . 2>&1 | grep "Context"

# 输出类似：
# => [internal] load build definition from Dockerfile
# => [internal] load .dockerignore
# => [internal] load build context
# => => transferring context: 45.23MB
```

## .dockerignore vs .gitignore

| 维度 | .dockerignore | .gitignore |
|------|---------------|-------------|
| 作用对象 | Docker 构建上下文 | Git 版本控制 |
| 排除范围 | 构建上下文 | 仓库 |
| 常见排除项 | node_modules、构建产物、测试 | node_modules、构建产物、IDE 配置 |
| 共同关注 | 敏感文件（.env）、日志 | 敏感文件 |

**注意**：`.gitignore` 和 `.dockerignore` 是独立的。如果你想同时排除某个文件，需要在两个文件里都加上。

## 最佳实践

```bash
# 推荐的标准 .dockerignore 模板

# ============
# 版本控制
# ============
.git/
.gitignore
.gitattributes

# ============
# IDE 和编辑器
# ============
.vscode/
.idea/
*.swp
*.swo
*.sublime-*

# ============
# 依赖
# ============
node_modules/
vendor/
__pycache__/
*.pyc

# ============
# 构建产物
# ============
dist/
build/
target/
*.jar
*.class
*.exe

# ============
# 测试和覆盖率
# ============
coverage/
.nyc_output/
.pytest_cache/
*.test.js
*_test.go

# ============
# 敏感文件（重要！）
# ============
.env
.env.*
*.pem
*.key
credentials.json
secrets/
*.secret

# ============
# 日志和临时文件
# ============
*.log
logs/
*.tmp
*.cache
*.swp

# ============
# 文档
# ============
README.md
CONTRIBUTING.md
LICENSE
docs/

# ============
# 其他
# ============
.DS_Store
Thumbs.db
docker-compose*.yml
Dockerfile*
```

## 面试追问

1. **`.dockerignore` 和 `.gitignore` 的区别是什么？**
2. **`docker build` 的上下文是什么？为什么不能从根目录构建？**
3. **没有 `.dockerignore` 会有什么问题？**
4. **`!** 开头的作用是什么？什么场景需要用到？**

> "`.dockerignore` 虽小，但作用不小。它是你优化镜像体积、加快构建速度、保护敏感信息的第一道防线。建议每个项目都创建，并定期检查是否有遗漏。"
