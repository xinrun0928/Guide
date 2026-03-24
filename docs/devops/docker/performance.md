# Docker 性能优化建议

同样的应用，为什么别人的容器跑得比你快？

Docker 性能优化是一个系统工程：从镜像构建到容器运行，从资源配置到网络存储，每个环节都有优化空间。

这篇文章，聊聊 Docker 性能优化的常见策略。

## 镜像优化

### 使用多阶段构建

多阶段构建是减小镜像体积最有效的方法，直接影响拉取速度和启动速度。

```dockerfile
# 优化前
FROM maven:3.9-eclipse-temurin-17
COPY . .
RUN mvn package
CMD ["java", "-jar", "/app/target/app.jar"]
# 体积：~800MB

# 优化后
FROM maven:3.9-eclipse-temurin-17 AS builder
COPY . .
RUN mvn package -DskipTests

FROM eclipse-temurin:17-jre-alpine
COPY --from=builder /app/target/*.jar app.jar
CMD ["java", "-jar", "app.jar"]
# 体积：~120MB
```

### 使用 Alpine 或 Distroless

```bash
# 普通镜像 vs Alpine vs Distroless
nginx:1.25          # ~270MB
nginx:1.25-alpine   # ~40MB

openjdk:17          # ~450MB
openjdk:17-slim     # ~200MB
openjdk:17-alpine   # ~120MB

gcr.io/distroless/static-debian12  # ~5MB（只有二进制）
```

### 利用构建缓存

```dockerfile
# 错误：任何文件变化都导致重新安装依赖
FROM node:18-alpine
COPY . .
RUN npm install

# 正确：先复制依赖文件
FROM node:18-alpine
COPY package*.json ./
RUN npm ci
COPY . .
# 只有 package*.json 变化时，才重新安装依赖
```

## 容器启动优化

### 预热 JVM

```bash
# JVM 冷启动可能需要几秒钟
# 使用 JVM 预热参数
docker run -d \
    --name myapp \
    -e JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0" \
    myapp:latest
```

### 延迟加载

```bash
# 使用 supervisor 延迟启动非关键服务
docker run -d \
    --name myapp \
    myapp:latest

# supervisor.conf
[supervisord]
nodaemon=true

[program:app]
command=java -jar app.jar
priority=100

[program:warmup]
command=java -XX:+AlwaysPreTouch app-warmup.jar
priority=50
# warmup 完成后自动退出，不影响主服务
```

## 网络优化

### 使用 host 网络模式

对于不需要网络隔离的服务，使用 host 网络模式可以减少网络开销：

```bash
# bridge 模式（默认）：额外一层 NAT 转换
docker run -d --network bridge --name myapp nginx:alpine

# host 模式：直接使用宿主机网络
docker run -d --network host --name myapp nginx:alpine
```

### 减少端口映射

```bash
# 多个端口映射增加 iptables 规则
# 使用 range 减少规则数量
docker run -d -p 8000-8005:8000-8005 myapp:latest

# 或者使用负载均衡器统一入口
docker run -d -p 80:8080 nginx:alpine
```

### DNS 缓存

```bash
# 使用自定义网络，自带 DNS 解析
docker network create my-net
docker run -d --network my-net --name service-a service-a:latest
docker run -d --network my-net --name service-b service-b:latest
# service-a 访问 service-b 直接通过 DNS，不需要 NAT
```

## 存储优化

### 使用 tmpfs 存储临时数据

```bash
# 临时文件使用内存文件系统，避免磁盘 I/O
docker run -d \
    --tmpfs /tmp:rw,noexec,nosuid,size=100m \
    --tmpfs /var/cache:rw,noexec,nosuid,size=50m \
    --name myapp \
    myapp:latest
```

### 选择合适的存储驱动

```bash
# overlay2 性能优于 devicemapper
# 检查当前存储驱动
docker info | grep "Storage Driver"

# 确保使用 overlay2
sudo vim /etc/docker/daemon.json
{
  "storage-driver": "overlay2"
}
```

### 减少容器层数

```dockerfile
# 多个 RUN 合并，减少层数
RUN apt-get update && \
    apt-get install -y nginx curl && \
    mkdir -p /var/www/html && \
    rm -rf /var/lib/apt/lists/*

# 而不是分开写
RUN apt-get update
RUN apt-get install -y nginx curl
RUN mkdir -p /var/www/html
```

## CPU 优化

### 正确设置 CPU 限制

```bash
# 不要限制太紧，给系统留出余量
docker run -d \
    --cpus=1.5 \
    --memory=1g \
    --name myapp \
    myapp:latest
```

### 绑定 CPU 核心

```bash
# 对于需要高性能的服务，绑定到特定 CPU 核心
docker run -d \
    --cpuset-cpus=0,1 \
    --cpus=2 \
    --name myapp \
    myapp:latest
```

## 内存优化

### 设置合理的内存限制

```bash
# 设置内存限制和软限制
docker run -d \
    --memory=1g \
    --memory-reservation=800m \
    --memory-swap=1g \
    --name myapp \
    myapp:latest
```

### JVM 内存配置

```bash
# JVM 要感知容器内存限制
docker run -d \
    --memory=1g \
    --name myapp \
    -e JAVA_OPTS="-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0" \
    myapp:latest
```

## I/O 优化

### 限制磁盘 I/O

```bash
# 限制读写速度
docker run -d \
    --device-read-bps=/dev/sda:10mb \
    --device-write-bps=/dev/sda:5mb \
    --name myapp \
    myapp:latest
```

### 使用只读根文件系统

```bash
# 只读文件系统减少写入
docker run -d \
    --read-only \
    --tmpfs /tmp \
    --tmpfs /var/run \
    --name myapp \
    myapp:latest
```

## 进程优化

### 限制 PID 数量

```bash
# 防止 fork 炸弹
docker run -d \
    --pids-limit=100 \
    --name myapp \
    myapp:latest
```

### 使用非 root 用户

```dockerfile
# 以非 root 用户运行，减少权限开销
RUN groupadd -r appgroup && useradd -r -g appgroup appuser
WORKDIR /app
COPY --chown=appuser:appgroup app.jar /app/
USER appuser
CMD ["java", "-jar", "app.jar"]
```

## 容器编排优化

### 健康检查优化

```bash
# 健康检查不要太频繁
docker run -d \
    --health-cmd="curl -f http://localhost/health" \
    --health-interval=30s \
    --health-timeout=5s \
    --health-retries=3 \
    --name myapp \
    myapp:latest
```

### 日志优化

```bash
# 配置日志轮转
docker run -d \
    --log-driver=json-file \
    --log-opt max-size=10m \
    --log-opt max-file=3 \
    --name myapp \
    myapp:latest
```

## 性能监控

### 使用 docker stats

```bash
# 实时监控资源使用
docker stats

# 监控特定容器
docker stats myapp --no-stream

# 输出：
# CONTAINER ID   NAME        CPU %   MEM USAGE / LIMIT     MEM %   NET I/O           BLOCK I/O
# abc123...       myapp       0.12%   128MiB / 512MiB      25.00%  1.5MB / 500KB     10MB / 5MB
```

### 使用 cAdvisor

```bash
# 启动 cAdvisor 监控
docker run -d \
    --name cadvisor \
    --privileged \
    --volume /:/rootfs:ro \
    --volume /var/run:/var/run:ro \
    --volume /sys:/sys:ro \
    --volume /var/lib/docker/:/var/lib/docker:ro \
    --publish=8080:8080 \
    google/cadvisor:latest
```

## 常见性能问题及解决方案

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 容器启动慢 | JVM 冷启动慢 | 使用 AOT 编译，预热 JVM |
| 网络延迟高 | NAT 转换开销 | 使用 host 网络模式 |
| 磁盘 I/O 慢 | 使用 devicemapper | 切换到 overlay2 |
| 内存占用高 | JVM 未感知容器限制 | 使用 `-XX:+UseContainerSupport` |
| CPU 使用率高 | 健康检查太频繁 | 降低检查间隔 |

## 面试追问

1. **Docker 容器的性能瓶颈通常在哪些方面？**
2. **如何判断一个容器是否需要性能优化？**
3. **overlay2 和 devicemapper 在性能上有什么区别？**
4. **JVM 在容器中运行时，为什么需要特殊配置？**
5. **如何监控 Docker 容器的性能指标？**

> "Docker 性能优化不是一次性工作，而是持续的过程。最好的优化方法是：先测量，找到瓶颈，再优化。不要过早优化，也不要优化错误的地方。记住：数据驱动，而非直觉。"
