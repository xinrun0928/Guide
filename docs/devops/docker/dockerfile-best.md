# Dockerfile 最佳实践：多阶段构建、镜像大小优化、安全加固

你的生产镜像有多大？

很多团队的生产镜像都是 1GB+：Java 应用自不必说，Python/Node 应用的镜像里也塞满了开发依赖、测试工具、甚至源码。镜像越大，拉取越慢、启动越慢、安全风险越高。

这篇文章，聊聊怎么把镜像从「能用」优化到「好用」。

## 多阶段构建：分离构建与运行环境

多阶段构建（Multi-stage Build）是减小镜像体积最有效的方法。

### 问题：单阶段构建的问题

```dockerfile
# 单阶段：Maven 构建 + JRE 运行
FROM maven:3.9-eclipse-temurin-17
WORKDIR /app
COPY . .
RUN mvn package            # 构建工具、源码、依赖库全在里面

FROM eclipse-temurin:17-jre
COPY --from=0 /app/target/*.jar app.jar
CMD ["java", "-jar", "app.jar"]

# 问题：
# 1. 需要手动指定 --from=0，从第一阶段复制
# 2. 需要两个基础镜像（构建镜像 vs 运行镜像）
```

### 解决：显式命名的多阶段构建

```dockerfile
# 第一阶段：构建
FROM maven:3.9-eclipse-temurin-17 AS builder
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn package -DskipTests

# 第二阶段：运行
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
# 只复制最终产物，不需要源码和构建工具
COPY --from=builder /app/target/myapp-1.0.0.jar app.jar
EXPOSE 8080
CMD ["java", "-jar", "app.jar"]
```

**效果**：

| 镜像 | 单阶段 | 多阶段 |
|------|--------|--------|
| 体积 | ~800MB | ~120MB |
| 包含内容 | Maven + 源码 + 依赖 + 产物 | 只有 JRE + 产物 |

### 其他语言的多阶段构建示例

**Go 应用**：

```dockerfile
# 构建阶段
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o myapp .

# 运行阶段
FROM alpine:3.18
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/myapp .
CMD ["./myapp"]
```

**Node.js 应用**：

```dockerfile
# 构建阶段
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# 运行阶段
FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
CMD ["node", "dist/index.js"]
```

### 极端优化：使用 distroless 镜像

Google 的 `distroless` 镜像只包含运行时和应用程序，没有任何包管理器、shell 或其他工具：

```dockerfile
FROM golang:1.21 AS builder
WORKDIR /app
COPY . .
RUN CGO_ENABLED=0 go build -o myapp

FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/myapp .
CMD ["./myapp"]

# 体积：~5MB（只有二进制文件）
# 安全：没有 shell，无法进入容器
```

## 利用构建缓存

构建缓存没利用好，会导致每次代码改动都重新下载依赖。

### 常见错误

```dockerfile
# 错误：源码和依赖混在一起
FROM node:18-alpine
WORKDIR /app
COPY . .                  # 任何代码变化都会导致缓存失效
RUN npm install
```

### 正确做法：分层缓存

```dockerfile
# 正确：先复制依赖文件，再复制源码
FROM node:18-alpine
WORKDIR /app

# 这一层在源码不变时会被缓存
COPY package*.json ./
RUN npm ci

# 只在源码变化时才会重建
COPY . .
CMD ["node", "index.js"]
```

### Gradle/Maven 的缓存技巧

```dockerfile
FROM gradle:8.5-jdk17 AS builder
WORKDIR /app
# 利用缓存：先只复制 build.gradle.kts
COPY build.gradle.kts settings.gradle.kts ./
RUN gradle dependencies --offline || true
# 如果缓存存在，后续构建会快很多

COPY . .
RUN gradle build -x test
```

## 镜像大小优化

### 使用 Alpine 或 Slim 变种

```bash
# 普通镜像 vs Alpine vs distroless
nginx:1.25          # ~270MB
nginx:1.25-alpine   # ~40MB
nginx:1.25-debian   # ~180MB

openjdk:17          # ~450MB
openjdk:17-slim     # ~200MB
openjdk:17-alpine   # ~120MB
```

### 清理缓存和不必要的文件

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    package1 package2 \
    && rm -rf /var/lib/apt/lists/*

RUN apk add --no-cache package1 package2
```

### 合并指令减少层数

```dockerfile
# 多个 RUN 指令会创建多层
RUN apt-get update
RUN apt-get install -y nginx
RUN apt-get install -y curl
RUN rm -rf /var/lib/apt/lists/*

# 合并为一个 RUN 减少层数
RUN apt-get update && \
    apt-get install -y nginx curl && \
    rm -rf /var/lib/apt/lists/*
```

### 避免安装不必要的依赖

```dockerfile
# 只安装运行时需要的包，不包含文档和示例
RUN apt-get install -y --no-install-recommends mypackage

# 而不是
RUN apt-get install -y mypackage
```

### 使用 .dockerignore

```bash
# .dockerignore
.git
.vscode
*.md
*.log
.env
node_modules
dist
coverage
```

## 安全加固

### 使用非 root 用户运行

```dockerfile
# 默认容器以 root 运行，很危险
# 如果容器被攻破，攻击者可能获得宿主机 root 权限

# 正确：创建并使用非 root 用户
RUN groupadd -r appgroup && useradd -r -g appgroup appuser
WORKDIR /app
COPY --chown=appuser:appgroup app.jar /app/
USER appuser
CMD ["java", "-jar", "app.jar"]
```

### 设置适当的文件权限

```dockerfile
# 只读文件系统
FROM eclipse-temurin:17-jre-alpine
COPY --chown=nonroot:nonroot myapp.jar /home/nonroot/myapp.jar
USER nonroot

# 在 docker run 时也可以加参数
docker run --read-only --tmpfs /tmp myapp
```

### 避免敏感信息泄露

```dockerfile
# 错误：密钥、密码写死在镜像里
ENV API_KEY=secret123456
COPY config.json /app/
# 任何能访问镜像的人都能看到这些敏感信息

# 正确：通过环境变量或挂载注入
ENV API_KEY_FILE=/run/secrets/api_key
COPY config-template.json /app/config.json
# 运行时：docker run -e API_KEY=secret123 myapp
```

### 定期更新基础镜像

```bash
# 不要用 latest tag，使用具体版本
FROM nginx:1.25.3-alpine   # ✅
FROM nginx:alpine          # ❌ 可能收到意外更新

# 定期重建镜像以获取安全更新
docker pull nginx:1.25.3-alpine
```

### 扫描镜像漏洞

```bash
# 使用 Trivy 扫描镜像
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
    aquasec/trivy image myapp:1.0

# GitLab CI 集成
trivy image --exit-code 1 --severity HIGH,CRITICAL myapp:1.0
```

## 综合示例：一个安全、小的生产镜像

```dockerfile
# ============================================
# 阶段一：构建
# ============================================
FROM maven:3.9-eclipse-temurin-17 AS builder

WORKDIR /app

# 分离依赖和源码，优化缓存
COPY pom.xml .
RUN mvn dependency:go-offline -B

COPY src ./src
COPY config ./config
RUN mvn package -DskipTests

# ============================================
# 阶段二：运行
# ============================================
FROM eclipse-temurin:17-jre-alpine AS runtime

# 安全：安装证书，不安装 shell（可选）
RUN apk add --no-cache ca-certificates curl && \
    addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# 只复制最终产物
COPY --from=builder /app/target/myapp-1.0.0.jar app.jar
COPY --from=builder /app/config ./config

# 设置用户
RUN chown -R appuser:appgroup /app
USER appuser

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD curl -f http://localhost:8080/actuator/health || exit 1

EXPOSE 8080
ENTRYPOINT ["java", "-XX:+UseContainerSupport", "-jar", "app.jar"]
```

**最终效果**：

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| 镜像大小 | ~800MB | ~150MB |
| 构建时间 | ~10 分钟 | ~5 分钟 |
| 运行用户 | root | appuser |
| 安全扫描 | 未做 | Trivy 集成 |
| 健康检查 | 无 | 有 |

## 面试追问

1. **多阶段构建的原理是什么？为什么能减小镜像大小？**
2. **如何判断镜像是否安全？有哪些扫描工具？**
3. **容器以 root 运行时有什么风险？如何避免？**
4. **`--no-install-recommends` 是什么意思？为什么重要？**
5. **多阶段构建的 `--from=builder` 和 `--from=0` 有什么区别？**

> "镜像优化不是一次性的工作，而是持续的过程。每一次 Dockerfile 的改动，都应该问自己：这一层真的必要吗？不必要的依赖是否已经清理？构建缓存是否被正确利用？"
