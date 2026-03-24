# Docker 数据持久化：Volume、Bind Mount、tmpfs

容器有一个特点：**数据随容器删除而丢失**。

你在容器里写了一个文件，容器删了，文件也没了。这是容器设计的一部分——「无状态」是容器的核心理念。但在实际应用中，总有一些数据需要持久化：数据库的文件、用户上传的内容、应用日志……

Docker 提供了三种数据持久化方式：**Volume**、**Bind Mount**、**tmpfs**。搞清楚它们的区别，是容器化生产应用的前提。

## 三种挂载方式对比

| 维度 | Volume | Bind Mount | tmpfs |
|------|--------|------------|-------|
| **存储位置** | Docker 管理（`/var/lib/docker/volumes`） | 宿主机任意位置 | 内存中 |
| **数据持久化** | ✅ 持久化 | ✅ 持久化 | ❌ 容器停止即丢失 |
| **性能** | 中等 | 最高 | 最快 |
| **跨容器共享** | 容易 | 较难 | 不支持 |
| **使用场景** | 生产环境数据持久化 | 开发环境挂载源码 | 敏感数据（临时） |
| **权限控制** | Docker 管理 | 宿主机决定 | 自动限制 |

## Volume（卷）

Volume 是 Docker 推荐的数据持久化方式。数据由 Docker 管理，存储在宿主机的特定目录中。

### 创建和使用 Volume

```bash
# 创建命名卷
docker volume create my-data

# 查看卷列表
docker volume ls

# 查看卷详情
docker volume inspect my-data

# 启动容器时挂载卷
docker run -d \
  -v my-data:/app/data \
  --name myapp \
  nginx:alpine

# 匿名卷（自动生成名称，不推荐生产使用）
docker run -d -v /app/data nginx:alpine
```

### Volume 的特点

**数据独立于容器生命周期**

```bash
# 创建容器并写入数据
docker run -d -v my-data:/data --name container1 nginx:alpine
docker exec container1 sh -c "echo 'hello' > /data/file.txt"

# 删除容器后，卷仍然存在
docker rm -f container1

# 新容器可以继续使用同一个卷
docker run -d -v my-data:/data --name container2 nginx:alpine
docker exec container2 cat /data/file.txt   # 输出：hello
```

**跨容器共享数据**

```bash
# 多个容器挂载同一个卷
docker run -d -v shared-data:/data --name container1 nginx:alpine
docker run -d -v shared-data:/data --name container2 nginx:alpine

# 两个容器现在共享 /data 目录
```

**使用 docker-compose**

```yaml
version: '3.8'
services:
  app:
    image: myapp:latest
    volumes:
      - app-data:/app/data

volumes:
  app-data:
    driver: local
```

### Volume 驱动

Volume 支持不同的驱动，实现数据存储到不同后端：

```bash
# 本地存储驱动（默认）
docker volume create --driver local my-local-volume

# 使用 RexRay 驱动挂载云存储
docker volume create --driver rexray/s3fs:0.11.5 \
    --opt s3.bucket=my-bucket \
    --opt s3.region=us-east-1 \
    my-s3-volume

# 使用 Convoy 驱动挂载 NFS
docker volume create --driver convoy \
    --opt driver=local \
    --opt device=nfs://192.168.1.100:/nfs/shared \
    my-nfs-volume
```

### 清理未使用的 Volume

```bash
# 删除未使用的卷
docker volume prune

# 删除指定卷
docker volume rm my-data

# 删除所有未使用的卷（包括无名卷）
docker volume prune -a
```

## Bind Mount（绑定挂载）

Bind Mount 将宿主机上的任意目录挂载到容器中。

### 基本用法

```bash
# 挂载宿主机目录到容器
docker run -d \
  -v /path/on/host:/path/in/container \
  --name myapp \
  nginx:alpine

# 示例：挂载日志目录
docker run -d \
  -v /var/log/myapp:/var/log/myapp \
  myapp:latest
```

### 开发环境常用

Bind Mount 最常见的场景是**开发时挂载源码**：

```bash
# 源码变更，容器自动感知（热更新）
docker run -d \
  -v $(pwd)/src:/app/src \
  -v /app/node_modules \
  --name myapp \
  -p 3000:3000 \
  node:18-alpine

# 关键点：挂载源码目录，但保留 node_modules
# -v $(pwd)/src:/app/src  ← 源码
# -v /app/node_modules    ← 匿名卷，保留镜像中的 node_modules
```

### Bind Mount 的特点

| 特点 | 说明 |
|------|------|
| **直接访问宿主机** | 容器可以直接读写宿主机文件系统 |
| **权限依赖宿主机** | 文件权限由宿主机决定 |
| **适合开发** | 源码挂载，修改即时生效 |
| **不适合生产** | 路径依赖，不够抽象 |

### 安全注意事项

Bind Mount 挂载宿主机目录时，容器内的进程拥有和宿主机相同的权限：

```bash
# 危险：挂载整个 /etc 目录
docker run -v /etc:/etc ...    # ❌ 容器可以修改宿主机配置

# 建议：只读挂载
docker run -v $(pwd)/config:/etc/nginx:ro ...
```

## tmpfs（内存文件系统）

tmpfs 将数据存储在宿主机的内存中，容器停止后数据丢失。

### 基本用法

```bash
# 使用 --tmpfs 标志
docker run -d \
  --tmpfs /tmp \
  --name myapp \
  nginx:alpine

# 使用 -v 语法指定类型
docker run -d \
  -v tmpfs:/tmp:rw,noexec,nosuid,size=100m \
  --name myapp \
  nginx:alpine
```

### tmpfs 的特点

| 特点 | 说明 |
|------|------|
| **数据不持久化** | 容器停止或删除后，数据丢失 |
| **性能极高** | 读写速度等于内存速度 |
| **数据在内存中** | 不占用磁盘空间 |
| **适合敏感数据** | 密码、密钥、临时缓存 |

### tmpfs 的使用场景

```bash
# 场景1：Redis 缓存（不需要持久化）
docker run -d \
  --tmpfs /data \
  redis:alpine

# 场景2：临时文件存储
docker run -d \
  --tmpfs /tmp:size=100m,noexec,nosuid \
  myapp:latest

# 场景3：处理敏感信息（会话数据）
docker run -d \
  --tmpfs /var/run/secrets \
  myapp:latest
```

### tmpfs 挂载选项

```bash
docker run -d \
  --tmpfs /tmp:rw,noexec,nosuid,size=100m,mode=1777 \
  myapp:latest
```

| 选项 | 说明 |
|------|------|
| `rw` | 可读写（默认） |
| `ro` | 只读 |
| `noexec` | 禁止执行二进制文件 |
| `nosuid` | 禁止设置 SUID |
| `size` | 最大 size（如 `100m`） |
| `mode` | 目录权限（八进制） |

## 实战：MySQL 数据持久化

MySQL 是需要数据持久化的典型场景：

```bash
# 使用命名卷持久化 MySQL 数据
docker run -d \
  --name mysql \
  -e MYSQL_ROOT_PASSWORD=secret \
  -v mysql-data:/var/lib/mysql \
  -v mysql-conf:/etc/mysql/conf.d \
  mysql:8.0

# 推荐做法：使用 Volume + 配置文件
docker volume create mysql-data
docker volume create mysql-conf

# 修改配置后启动
docker run -d \
  --name mysql \
  -e MYSQL_ROOT_PASSWORD=secret \
  -v mysql-data:/var/lib/mysql \
  -v mysql-conf:/etc/mysql/conf.d \
  mysql:8.0
```

### docker-compose 方式

```yaml
version: '3.8'
services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: secret
    volumes:
      - mysql-data:/var/lib/mysql
      - ./conf.d:/etc/mysql/conf.d:ro
    ports:
      - "3306:3306"
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  mysql-data:
    driver: local
```

## 选型建议

```
数据持久化选型指南：

┌─────────────────────────────────────────────────────┐
│                   数据需要持久化？                    │
│                        ↓                            │
│            ┌─────────────────────────┐             │
│            │          是              │             │
│            └────────────┬────────────┘             │
│                       ↓                            │
│        ┌───────────────────────────────┐          │
│        │         数据在哪里？             │          │
│        └─────────────┬─────────────────┘          │
│                    ↓                               │
│   ┌──────────────────┴──────────────────────┐     │
│   ↓                                           ↓     │
│ 开发环境                              生产环境       │
│ Bind Mount                             Volume       │
│ (挂载源码/配置)                        (数据卷)       │
│                                           ↓         │
│                                    ┌────────────┐   │
│                                    │ 存储后端？  │   │
│                                    └─────┬──────┘   │
│                                    local │ cloud   │
│                                      ↓       ↓     │
│                               本地磁盘    NFS/S3   │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                  数据不需要持久化？                   │
│                       ↓                             │
│              ┌──────────────────┐                   │
│              │  敏感/临时数据？  │                   │
│              └────────┬─────────┘                   │
│                     ↓                               │
│              ┌───────┴───────┐                     │
│              ↓               ↓                      │
│           是               否                       │
│         tmpfs           无需挂载                     │
└─────────────────────────────────────────────────────┘
```

## 面试追问

1. **Docker 的数据持久化有哪几种方式？各自的特点是什么？**
2. **Bind Mount 和 Volume 的区别是什么？各自适合什么场景？**
3. **容器删除了，Volume 里的数据还在吗？**
4. **tmpfs 适合存储什么数据？为什么？**
5. **MySQL 容器化时，数据持久化有哪些坑需要注意？**

> "数据持久化是容器化应用的关键能力。选择正确的方式，关系到数据安全、性能和维护成本。记住：无状态的应用用容器，有状态的应用用 Volume。"
