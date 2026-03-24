# Docker 镜像分层与 Copy-on-Write 机制

你有没有想过这个问题：**从同一个基础镜像启动 100 个容器，这 100 个容器共享多大的磁盘空间？**

答案是：除了每个容器自己的可写层外，它们共享基础镜像的所有层。这意味着 100 个基于 Ubuntu 的容器，可能只需要占用比单个 Ubuntu 镜像多不了多少的磁盘空间。

这个机制背后，就是 Docker 的镜像分层和 Copy-on-Write 机制。

## 镜像分层：每一层都是增量

Docker 镜像由多个只读层（Layer）组成，每条 Dockerfile 指令（`FROM` 除外）都会创建新的一层。

### 分层示例

看这个 Dockerfile：

```dockerfile
# 基础镜像（已有多个层）
FROM ubuntu:22.04

# 第 1 层：安装 Nginx
RUN apt-get update && apt-get install -y nginx

# 第 2 层：创建目录
RUN mkdir -p /var/www/html

# 第 3 层：复制文件
COPY index.html /var/www/html/

# 第 4 层：设置启动命令
CMD ["nginx", "-g", "daemon off;"]
```

这个镜像的分层结构如下：

```
┌─────────────────────────────────────────┐
│         CMD  layer (第4层)              │  ← 只读
├─────────────────────────────────────────┤
│         COPY layer (第3层)              │  ← 只读
├─────────────────────────────────────────┤
│         RUN layer (第2层)               │  ← 只读
├─────────────────────────────────────────┤
│         RUN layer (第1层)                │  ← 只读
├─────────────────────────────────────────┤
│  ubuntu:22.04 base layers (若干层)       │  ← 只读
└─────────────────────────────────────────┘
```

### 分层的好处

**1. 节省存储空间**

所有基于同一个基础镜像的容器，共享基础镜像的所有层。100 个 Ubuntu 容器，不需要 100 份 Ubuntu 系统，只需要 1 份加上 100 份各自的差异。

**2. 加速镜像拉取**

如果镜像 Registry 上的某一层已经被本地缓存，不需要重新下载，直接复用即可。

**3. 加快构建速度**

如果 Dockerfile 的某一层没有变化（指令相同、依赖文件未变），构建时会直接使用缓存，跳过该层的构建。

## Copy-on-Write：写时复制

容器运行时，在镜像层之上会创建一个可写层（Container Layer）。当容器修改某个文件时，会发生 Copy-on-Write：

```
┌──────────────────────────────────────┐
│        Container Layer（可写层）      │
│                                      │
│  容器修改文件时：                      │
│  1. 从只读层复制文件到可写层            │
│  2. 在可写层修改文件                   │
│  3. 只读层保持不变                     │
└──────────────────────────────────────┘
          ↑ Copy-on-Write
┌──────────────────────────────────────┐
│        Image Layers（只读层）          │
│   容器读取时：先找可写层，再找只读层      │
└──────────────────────────────────────┘
```

### 读取文件

当容器读取一个文件时，Docker 从上往下（可写层 → 只读层）查找，找到第一个匹配的文件就返回：

```
容器读 /etc/nginx/nginx.conf
   ↓
   先看容器可写层有没有 → 没有
   再看镜像层 → 找到了 → 返回
```

### 修改文件

当容器修改一个文件时，Docker 找到该文件所在的最上层只读层，复制到可写层，然后修改：

```
容器写 /etc/nginx/nginx.conf
   ↓
   找到该文件在镜像层的位置
   ↓
   复制到可写层（按需复制）
   ↓
   在可写层修改文件
   ↓
   后续操作都只操作可写层的副本
```

### 删除文件

容器删除文件时，不是真正删除，而是标记为「已删除」：

```
容器删除 /var/log/app.log
   ↓
   在可写层创建一个 whiteout 文件（.wh.xxx）
   ↓
   读取时发现 whiteout → 认为文件不存在
   ↓
   镜像层的原始文件仍然存在
```

### 理解这个设计

Copy-on-Write 的设计有两个核心目的：

1. **保持镜像不变**：镜像一旦构建完成，就永远不会改变。这是「不可变基础设施」的根基。
2. **延迟复制**：只有真正需要修改时，才复制文件。最小化 I/O 开销。

## 存储驱动

Docker 使用存储驱动（Storage Driver）来实现镜像分层和 Copy-on-Write。常见的存储驱动有：

### overlay2（推荐）

```bash
# 查看当前存储驱动
docker info | grep "Storage Driver"
```

`overlay2` 是目前最推荐的方式，适用于大多数 Linux 发行版（内核 4.0+）。

```
overlay2 结构：
/var/lib/docker/overlay2/
├── l/                          # 层数据（短链接）
├── <image-layer>/              # 镜像层
│   ├── link                    # 层链接
│   ├── lower                  # 指向下层的链接
│   └── diff/                  # 该层的内容
└── <container-layer>/          # 容器层
    ├── lower                  # 指向镜像层
    ├── upper                  # 可写层
    ├── work                   # overlay work dir
    └── merged                 # 合并视图
```

### devicemapper

```bash
dockerd --storage-driver=devicemapper
```

`devicemapper` 使用设备的快照功能，性能不如 `overlay2`，曾是 RHEL/CentOS 的默认驱动。

### btrfs / zfs

使用文件系统本身的快照能力。优点是功能强大，缺点是复杂度和资源开销较高。

### 选择建议

```
推荐顺序：
1. overlay2（大多数场景）
2. fuse-overlayfs（rootless 容器）
3. btrfs/zfs（有特殊存储需求）
4. devicemapper（老系统兼容性）
```

## 构建缓存机制

理解分层后，才能理解 Docker 的构建缓存。

### 缓存生效规则

当 Docker 构建镜像时，每一步都会检查：
1. 当前指令是否与缓存中相同指令的「父层」相同？
2. 构建上下文（文件）是否有变化？

```dockerfile
FROM ubuntu:22.04          # ← 缓存第1步：基础镜像
RUN apt-get update ...      # ← 缓存第2步：检查包列表是否变化
COPY package.json /app/     # ← 缓存第3步：检查 package.json 内容
RUN npm install            # ← 缓存第4步：检查依赖是否变化
COPY src/ /app/             # ← 缓存第5步：检查 src/ 是否有变化
```

如果每一步都匹配缓存，构建就会复用之前的层；如果任何一步不匹配，该层及之后所有层都需要重新构建。

### 缓存失效的常见原因

```dockerfile
# 常见错误：先复制代码再安装依赖
FROM node:18
COPY . /app                 # ← 任何代码改动，这里缓存失效
RUN npm install             # ← 重新安装，导致 npm 缓存也失效

# 优化：先复制依赖文件，再复制代码
FROM node:18
COPY package*.json /app/   # ← 只依赖文件变化才失效
RUN npm install
COPY . /app                 # ← 代码改动只影响这一层
```

### 利用好 .dockerignore

构建上下文会打包发送给 Docker daemon。`.dockerignore` 文件可以排除不需要的文件，减少上下文大小，避免意外文件进入镜像：

```bash
# .dockerignore
node_modules
.git
*.log
.env
dist
coverage
.vscode
```

## 实际案例分析

### 场景：Java 应用镜像优化

```dockerfile
# 优化前
FROM openjdk:17
COPY . /app
RUN mvn package
CMD ["java", "-jar", "/app/target/app.jar"]

# 问题：
# 1. 每次代码改动，整个构建都要重新执行（包括 Maven 依赖下载）
# 2. Maven 仓库被包含在镜像中（很大）
# 3. 没有清理构建中间产物
```

```dockerfile
# 优化后
FROM maven:3.9-eclipse-temurin-17 AS builder
WORKDIR /app
# 利用 Maven 缓存层
COPY pom.xml .
RUN mvn dependency:go-offline
COPY src ./src
RUN mvn package -DskipTests

FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
# 只复制最终产物
COPY --from=builder /app/target/*.jar app.jar
# 多阶段构建，第二阶段镜像不包含 Maven
CMD ["java", "-jar", "app.jar"]

# 结果：镜像体积从 ~800MB 降到 ~120MB
```

### 场景：Node.js 应用镜像优化

```dockerfile
# 优化前
FROM node:18
WORKDIR /app
COPY . .
RUN npm install
CMD ["npm", "start"]

# 问题：node_modules 被打入镜像，体积膨胀
```

```dockerfile
# 优化后
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/index.js"]

# 进一步优化：使用 node 用户而非 root
```

## 面试追问

1. **镜像分层的原理是什么？Docker 怎么知道一个层的内容？**
2. **Copy-on-Write 带来了什么性能影响？什么时候影响最大？**
3. **删除容器后，镜像会被删除吗？删除镜像后，数据会丢失吗？**
4. **如何优化 Docker 构建缓存？有哪些具体实践？**
5. **`overlay2` 和 `devicemapper` 哪个性能更好？各自适合什么场景？**

> "理解镜像分层和 Copy-on-Write，是理解 Docker『不可变基础设施』设计哲学的关键。镜像一旦构建就不变，变的只有容器的可写层——这是容器化最优雅的设计之一。"
