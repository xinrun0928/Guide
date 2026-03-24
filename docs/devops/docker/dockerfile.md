# Dockerfile 指令详解

写 Dockerfile 是 Docker 的核心技能。一个好的 Dockerfile 能让镜像构建又快又小又安全。

但很多人在写 Dockerfile 时，习惯把所有指令堆在一起，不理解每个指令的作用。结果构建出来的镜像要么臃肿（几个 GB），要么构建缓存失效（一改代码整个镜像重新构建），要么镜像里有不该有的敏感信息。

这篇文章，把 Dockerfile 常用指令讲透。

## FROM：指定基础镜像

`FROM` 是每个 Dockerfile 的第一条指令，指定构建所基于的镜像。

```dockerfile
# 使用官方镜像
FROM nginx:1.21-alpine
FROM openjdk:17-slim
FROM python:3.11-slim

# 使用私有镜像
FROM registry.example.com/base/ubuntu:22.04

# 多阶段构建的第一阶段
FROM golang:1.21 AS builder
```

### Alpine 镜像的优势

如果你在意镜像大小，推荐使用 `*-alpine` 变种。Alpine 是一个轻量级 Linux 发行版，基础镜像只有 5MB 左右：

```dockerfile
# 普通镜像 vs Alpine 镜像
nginx:1.21         # ~140MB
nginx:1.21-alpine  # ~15MB

openjdk:17         # ~450MB
openjdk:17-slim    # ~200MB
openjdk:17-alpine  # ~120MB
```

Alpine 使用 musl libc 而不是 glibc，部分 Go 编写的程序在 Alpine 上可能遇到兼容性问题（如 DNS 解析 bug），需要注意测试。

## RUN：执行命令

`RUN` 在镜像构建时执行命令，用于安装软件包、创建目录等。

```dockerfile
# shell 形式（默认使用 /bin/sh）
RUN apt-get update && apt-get install -y nginx curl

# exec 形式（推荐，明确指定 shell）
RUN ["/bin/bash", "-c", "apt-get update && apt-get install -y nginx curl"]
```

### RUN 指令的坑

最常见的坑是 `apt-get update` 和 `apt-get install` 写在同一行：

```dockerfile
# 错误写法
RUN apt-get update
RUN apt-get install -y nginx

# 正确写法
RUN apt-get update && apt-get install -y nginx
```

为什么？Dockerfile 的每一层都会缓存。`apt-get update` 被缓存后，`apt-get install` 可能永远用的是「昨天的包索引」，导致安装旧版本或有安全漏洞的包。

### 清理缓存

安装完软件后，记得清理缓存以减小镜像体积：

```dockerfile
RUN apt-get update && apt-get install -y nginx \
    && rm -rf /var/lib/apt/lists/*
```

## COPY：复制文件

`COPY` 将文件或目录从构建上下文复制到镜像中。

```dockerfile
# 复制单个文件
COPY package.json /app/

# 复制目录
COPY src/ /app/src/

# 复制构建上下文中的文件（支持通配符）
COPY *.jar /app/lib/

# 带 OWNER 和权限的复制（默认 UID 1000）
COPY --chown=app:app app.jar /app/
```

### COPY vs ADD

`ADD` 的功能和 `COPY` 类似，但多了两个特殊能力：

```dockerfile
# ADD 可以解压 tar 文件（自动识别 .tar.gz, .tar.bz2 等）
ADD code.tar.gz /app/

# ADD 可以从 URL 下载文件
ADD https://example.com/binary /usr/local/bin/
```

**建议**：除非你需要 `ADD` 的这两个特性，否则用 `COPY`。`COPY` 的语义更明确，性能也稍好。

## WORKDIR：设置工作目录

`WORKDIR` 设置后续指令的工作目录，相当于 `cd`。

```dockerfile
WORKDIR /app

# 目录不存在会自动创建
WORKDIR /app/subdir

# 可以用环境变量
WORKDIR /app/${APP_ENV}
```

### WORKDIR vs RUN cd

不要用 `RUN cd` 来切换目录：

```dockerfile
# 错误
RUN cd /app && npm install

# 正确
WORKDIR /app
RUN npm install
```

`RUN cd` 不会改变后续指令的当前目录（因为每个 RUN 是独立的 shell），而 `WORKDIR` 会持久化到后续所有指令。

## CMD：容器启动命令

`CMD` 指定容器启动时执行的命令，Dockerfile 中只能有一个 `CMD` 指令。

```dockerfile
# exec 形式（推荐）
CMD ["nginx", "-g", "daemon off;"]
CMD ["java", "-jar", "app.jar"]

# shell 形式
CMD nginx -g 'daemon off;'
```

### CMD vs ENTRYPOINT

`CMD` 的作用是提供默认命令，但可以被 `docker run` 的参数覆盖：

```dockerfile
# CMD ["java", "-jar", "app.jar"]
docker run myapp                           # 使用 CMD 的默认值
docker run myapp --spring.profiles=prod    # 覆盖 CMD，传递新参数
```

`ENTRYPOINT` 则不同，它让容器表现得像一个可执行程序：

```dockerfile
ENTRYPOINT ["java", "-jar", "app.jar"]
CMD ["--spring.profiles=dev"]

# 行为
docker run myapp                           # java -jar app.jar --spring.profiles=dev
docker run myapp --spring.profiles=prod    # java -jar app.jar --spring.profiles=prod
```

`ENTRYPOINT` 常用于工具类镜像，如 `docker exec` 和 `kubectl` 客户端镜像。

## ENV：设置环境变量

`ENV` 设置镜像中的环境变量：

```dockerfile
# 设置环境变量
ENV JAVA_HOME=/opt/java
ENV PATH=$PATH:$JAVA_HOME/bin

# 多行写法
ENV APP_HOME=/app \
    APP_ENV=production \
    LOG_LEVEL=info
```

环境变量可以在运行时被覆盖：

```dockerfile
docker run -e APP_ENV=staging myapp
```

### ENV 的坑：暴露敏感信息

环境变量会被固化到镜像中，任何能访问镜像的人都能看到：

```dockerfile
# 错误：把密钥写死在 Dockerfile
ENV DB_PASSWORD=secret123

# 正确：通过运行时注入
docker run -e DB_PASSWORD=secret123 myapp
# 或使用 Kubernetes Secret、Vault 等方案
```

## EXPOSE：声明端口

`EXPOSE` 声明容器运行时监听的端口：

```dockerfile
EXPOSE 8080
EXPOSE 443 80
```

这只是一种文档声明，告诉用户「这个镜像会监听这些端口」。实际绑定还需要用 `docker run -p` 参数。

```bash
# EXPOSE 只是文档，实际端口映射需要 -p
docker run -p 8080:8080 myapp
```

## VOLUME：声明持久化目录

`VOLUME` 声明数据需要持久化：

```dockerfile
VOLUME /data
VOLUME ["/var/lib/postgresql/data", "/logs"]
```

定义 `VOLUME` 后，容器对该目录的写入会被写入独立的存储卷，不会随容器删除而丢失。这是为了防止用户「不小心把数据库文件写到了容器的可写层」。

## ARG：构建参数

`ARG` 定义构建时（build time）可传入的参数：

```dockerfile
# 定义
ARG APP_VERSION=1.0.0
ARG BUILD_TIME

# 使用
RUN echo "Building version ${APP_VERSION} at ${BUILD_TIME}"

# 传入
docker build --build-arg APP_VERSION=2.0.0 --build-arg BUILD_TIME=$(date) .
```

### ENV vs ARG

| 维度 | ENV | ARG |
|------|-----|-----|
| 生效时机 | 运行时 | 构建时 |
| 是否进入镜像 | 是 | 仅构建时使用 |
| 用途 | 配置 | 版本号、构建参数 |

## ONBUILD：触发式构建

`ONBUILD` 定义一个「触发器」，在基于此镜像构建新镜像时执行：

```dockerfile
# parent/Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
ONBUILD COPY . .
ONBUILD CMD ["npm", "start"]
```

```dockerfile
# child/Dockerfile
FROM parent:latest
# 在此镜像构建时，会自动执行 ONBUILD 中的 COPY 和 CMD
```

`ONBUILD` 常用于需要被继承的「父镜像」，如语言运行时镜像。

## HEALTHCHECK：健康检查

`HEALTHCHECK` 定义容器的健康检查命令：

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1
```

Docker 会定期执行这个命令，返回 0 表示健康，返回 1 表示不健康。不健康的容器会被标记，但不会自动重启（需要配合 `--restart` 策略）。

## 综合示例

```dockerfile
# 基础镜像
FROM openjdk:17-slim AS builder

# 设置构建参数
ARG APP_VERSION
ARG BUILD_TIME

# 设置环境变量
ENV APP_HOME=/app
ENV JAVA_OPTS="-Xmx512m"

# 工作目录
WORKDIR /app

# 复制依赖文件并下载（利用缓存）
COPY pom.xml .
RUN apt-get update && apt-get install -y maven && \
    mvn dependency:go-offline -B && \
    rm -rf /var/lib/apt/lists/*

# 复制源码并构建
COPY src ./src
RUN mvn clean package -DskipTests

# 最终镜像
FROM openjdk:17-slim

# 安全：创建非 root 用户
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

# 复制构建产物
COPY --from=builder /app/target/*.jar app.jar

# 设置工作目录
WORKDIR /app

# 暴露端口
EXPOSE 8080

# 使用非 root 用户运行
USER appuser

# 启动命令
CMD ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
```

## 面试追问

1. **Dockerfile 中 `COPY` 和 `ADD` 的区别是什么？什么时候用 ADD？**
2. **`CMD` 和 `ENTRYPOINT` 的区别？什么场景用 `ENTRYPOINT`？**
3. **多阶段构建解决了什么问题？有什么好处？**
4. **如何减小 Docker 镜像体积？有哪些具体措施？**

> "写 Dockerfile 和写代码一样，需要考虑可读性、可维护性、性能。好的 Dockerfile 应该让团队任何人都能看懂构建流程，同时产出最小化的镜像。"
