# Docker 构建缓存机制与最佳实践

Docker 构建为什么有时候快得像闪电，有时候慢得像蜗牛？

答案在于缓存。Docker 的分层镜像机制让重复构建变得飞快，但一旦缓存失效，一切都从头来起。

这篇文章，聊聊 Docker 构建缓存的原理和最佳实践。

## 构建缓存机制

### 缓存如何工作

Docker 在构建镜像时，每一步都会检查缓存：

```
Dockerfile 执行流程：

Step 1/5 : FROM ubuntu:22.04
   → 检查本地是否有 ubuntu:22.04
   → 没有，pull 镜像
   → 构建新层

Step 2/5 : RUN apt-get update && apt-get install -y nginx
   → 检查缓存：
     - 基础镜像是否相同？✅
     - RUN 指令是否相同？✅
     - 构建上下文（apt 包列表）是否变化？✅
   → 命中缓存，直接使用缓存层

Step 3/5 : COPY package.json /app/
   → 检查缓存：
     - 基础镜像是否相同？✅
     - COPY 指令是否相同？✅
     - package.json 内容是否变化？❌ 变化了！
   → 缓存失效，重新构建这一层及之后所有层
```

### 缓存失效规则

```dockerfile
# 以下情况会导致缓存失效：

# 1. FROM 指令变化
FROM ubuntu:22.04    → FROM ubuntu:24.04

# 2. RUN/ADD/COPY 指令变化
RUN npm install      → RUN npm ci
COPY . /app/         → COPY src/ /app/

# 3. COPY/ADD 的文件内容变化
# 即使指令相同，文件内容变了也会失效

# 4. 构建上下文根目录变化
docker build ./dir1   → docker build ./dir2
```

## 缓存最佳实践

### 核心原则：依赖分离

**原则**：先复制不变的文件（依赖），再复制变化的代码。

```dockerfile
# 错误示范：每次代码变化都重新安装依赖
FROM node:18-alpine
COPY . /app
RUN npm install
CMD ["npm", "start"]

# 正确做法：先复制依赖文件
FROM node:18-alpine
WORKDIR /app

# 先复制依赖文件（不变或很少变）
COPY package.json package-lock.json ./
RUN npm ci

# 再复制代码（经常变）
COPY src/ ./src/

CMD ["npm", "start"]
```

### 常见语言的缓存策略

#### Node.js

```dockerfile
FROM node:18-alpine

WORKDIR /app

# 分离依赖和代码
COPY package*.json ./
RUN npm ci --only=production

COPY src/ ./src/

CMD ["node", "src/index.js"]
```

#### Java/Maven

```dockerfile
FROM maven:3.9-eclipse-temurin-17 AS builder

WORKDIR /app

# 先复制 pom.xml，利用 Maven 缓存
COPY pom.xml ./

# 下载依赖（利用 Maven 本地仓库缓存）
RUN mvn dependency:go-offline -B

# 再复制源码
COPY src/ ./src/
RUN mvn package -DskipTests

# 运行阶段
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=builder /app/target/*.jar app.jar
CMD ["java", "-jar", "app.jar"]
```

#### Python

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# 先复制依赖文件
COPY requirements.txt .

# 安装依赖
RUN pip install --no-cache-dir -r requirements.txt

# 再复制代码
COPY . .

CMD ["python", "main.py"]
```

#### Go

```dockerfile
FROM golang:1.21-alpine AS builder

WORKDIR /app

# 先复制 go.mod 和 go.sum
COPY go.mod go.sum ./

# 下载依赖
RUN go mod download

# 再复制源码
COPY . .

# 构建
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o myapp .

# 运行阶段
FROM alpine:3.18
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/myapp .
CMD ["./myapp"]
```

## 调试构建缓存

### 查看缓存使用情况

```bash
# 构建时显示缓存命中情况
docker build --progress=plain -t myapp .

# 输出：
# => CACHED [1/5] FROM docker.io/library/ubuntu:22.04
# => CACHED [2/5] RUN apt-get update && apt-get install -y nginx
# => [3/5] COPY package.json /app/
# => [4/5] RUN npm ci
# => [5/5] CMD ["npm", "start"]
```

### 强制不使用缓存

```bash
# 强制重新构建（不使用任何缓存）
docker build --no-cache -t myapp .

# 只强制重新构建特定步骤之后的内容
docker build --build-arg CACHEBUST=$(date +%s) -t myapp .

# Dockerfile 中
ARG CACHEBUST
RUN echo $CACHEBUST
```

## 减少构建时间

### 充分利用 .dockerignore

```bash
# .dockerignore
.git
.vscode
node_modules
*.log
.env
dist
coverage
```

### 减小构建上下文

```bash
# 坏的实践：从根目录构建，上下文很大
docker build -t myapp /

# 好的实践：从项目目录构建，上下文小
cd /path/to/myapp
docker build -t myapp .

# 指定子目录作为上下文
docker build -t myapp ./app
```

### 并行构建

```bash
# Docker BuildKit 支持并行构建
export DOCKER_BUILDKIT=1

# Dockerfile 中的 RUN 指令并行执行
RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && apt-get install -y nginx curl git
```

### 使用 BuildKit

```bash
# 启用 BuildKit
export DOCKER_BUILDKIT=1

# 或者配置 daemon
sudo vim /etc/docker/daemon.json
{
  "features": {
    "buildkit": true
  }
}
```

### BuildKit 高级特性

```dockerfile
# syntax=docker/dockerfile:1

# 并行构建多个依赖
RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update && apt-get install -y \
    nginx \
    curl \
    git

# 缓存构建产物
RUN --mount=type=cache,target=/root/.m2 \
    mvn dependency:go-offline

# 秘密挂载（不会进入镜像层）
RUN --mount=type=secret,id=npmrc \
    npm ci --userconfig=/run/secrets/npmrc
```

```bash
# 使用秘密
docker build --secret id=npmrc,src=.npmrc -t myapp .
```

## 缓存管理

### 查看缓存大小

```bash
# 查看 Docker 使用的磁盘空间
docker system df

# 详细查看
docker system df -v
```

### 清理构建缓存

```bash
# 清理未使用的构建缓存
docker builder prune

# 清理所有未使用的资源
docker system prune -a

# 清理特定镜像的缓存
docker image prune
```

## 常见缓存问题

### 缓存失效的常见原因

| 问题 | 原因 | 解决 |
|------|------|------|
| npm install 总是重新执行 | package.json 内容变化 | 检查 package-lock.json 是否一起复制 |
| Maven 依赖每次下载 | pom.xml 变化 | 先复制 pom.xml，再复制其他文件 |
| 镜像拉取失败 | FROM 指令没有缓存 | 配置镜像加速器 |
| COPY 指令导致缓存失效 | 复制的文件包含 .git 目录 | 使用 .dockerignore |

### package.json 陷阱

```bash
# 陷阱：package.json 变化但 package-lock.json 没变化
# 导致 npm install 重新执行

# 正确：两个文件一起复制
COPY package*.json ./

# 陷阱：复制后修改了 package.json
COPY package.json .
RUN npm install
COPY package-lock.json .   # ❌ 这行会破坏缓存

# 正确：不要在 COPY package*.json 后单独 COPY package-lock.json
# 它们应该一次性复制
```

## CI/CD 中的缓存策略

### GitHub Actions

```yaml
- name: Build Docker image
  uses: docker/build-push-action@v5
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

### GitLab CI

```yaml
build:
  image: docker:latest
  services:
    - docker:dind
  script:
    - docker build --cache-from $CI_REGISTRY_IMAGE:latest -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
```

### Jenkins

```groovy
pipeline {
    agent {
        docker {
            image 'docker:latest'
            args '-v /var/run/docker.sock:/var/run/docker.sock'
        }
    }
    stages {
        stage('Build') {
            steps {
                sh 'docker build --cache-from myapp:latest -t myapp:${BUILD_NUMBER} .'
            }
        }
    }
}
```

## 面试追问

1. **Docker 构建缓存是如何工作的？缓存失效的规则是什么？**
2. **为什么应该先复制依赖文件再复制代码？**
3. **如何调试 Docker 构建缓存问题？**
4. **BuildKit 相比传统构建有哪些优势？**
5. **CI/CD 中如何持久化 Docker 构建缓存？**

> "好的 Dockerfile 构建策略，能让构建时间从几分钟缩短到几十秒。核心原则只有一个：把不常变化的层放在前面，把经常变化的层放在后面。记住：缓存是 Docker 构建的灵魂，用好缓存事半功倍。"
