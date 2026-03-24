# Docker Registry 私有仓库搭建

Docker Hub 是官方公共仓库，但企业使用通常需要私有仓库来：
- 加速镜像拉取（内网更快）
- 保护敏感镜像（安全隔离）
- 管理企业内部的镜像版本

这篇文章，聊聊怎么搭建私有 Docker Registry。

## Registry 镜像仓库

Docker 官方提供了 `registry` 镜像，可以快速搭建一个最简私有仓库。

### 快速搭建

```bash
# 启动 Registry 服务
docker run -d \
  --name registry \
  -p 5000:5000 \
  -v registry-data:/var/lib/registry \
  registry:2

# 测试：推送镜像
docker tag nginx:alpine localhost:5000/my-nginx:1.0
docker push localhost:5000/my-nginx:1.0

# 测试：拉取镜像
docker pull localhost:5000/my-nginx:1.0
```

### 验证仓库内容

```bash
# 查看所有镜像
curl http://localhost:5000/v2/_catalog

# 查看某个镜像的所有标签
curl http://localhost:5000/v2/my-nginx/tags/list

# 输出示例：
# {"name":"my-nginx","tags":["1.0"]}
```

### 配置 HTTP 访问

默认情况下，Docker 要求 Registry 使用 HTTPS。但如果是本地测试，可以通过配置 Docker daemon 允许 HTTP：

```bash
# /etc/docker/daemon.json
{
  "insecure-registries": ["registry.example.com:5000"]
}
```

```bash
# 重启 Docker
sudo systemctl restart docker
```

**生产环境建议**：使用 TLS 证书，不要用 HTTP。

## 带认证的 Registry

不加认证的仓库等于裸奔。用 htpasswd 添加 Basic 认证：

### 创建认证文件

```bash
# 创建密码文件目录
mkdir -p auth

# 生成用户名密码（需要 apache2-utils 或 httpd-tools）
docker run --rm \
  --entrypoint htpasswd \
  httpd:2 \
  -Bbn admin password123 > auth/htpasswd

# 查看生成的密码文件
cat auth/htpasswd
# admin:$2y$05$eTK...（加密后的密码）
```

### 启动带认证的 Registry

```bash
docker run -d \
  --name registry \
  --network registry-net \
  -p 5000:5000 \
  -v "$(pwd)"/auth:/auth \
  -v "$(pwd)"/data:/var/lib/registry \
  -e REGISTRY_AUTH=htpasswd \
  -e REGISTRY_AUTH_HTPASSWD_REALM="Registry Realm" \
  -e REGISTRY_AUTH_HTPASSWD_PATH=/auth/htpasswd \
  -e REGISTRY_STORAGE_DELETE_ENABLED=true \
  registry:2
```

### 使用认证登录

```bash
# 登录
docker login registry.example.com:5000
# Username: admin
# Password: password123

# 推送镜像
docker tag myapp:latest registry.example.com:5000/myapp:latest
docker push registry.example.com:5000/myapp:latest

# 登出
docker logout registry.example.com:5000
```

## 带 TLS 的 Registry

生产环境必须使用 HTTPS。假设你已经有域名和证书：

### 目录结构

```
registry/
├── certs/
│   ├── registry.example.com.crt
│   └── registry.example.com.key
├── auth/
│   └── htpasswd
└── data/
```

### 启动带 TLS 和认证的 Registry

```bash
docker run -d \
  --name registry \
  -p 443:5000 \
  -v "$(pwd)"/certs:/certs \
  -v "$(pwd)"/auth:/auth \
  -v "$(pwd)"/data:/var/lib/registry \
  -e REGISTRY_HTTP_TLS_CERTIFICATE=/certs/registry.example.com.crt \
  -e REGISTRY_HTTP_TLS_KEY=/certs/registry.example.com.key \
  -e REGISTRY_AUTH=htpasswd \
  -e REGISTRY_AUTH_HTPASSWD_REALM="Registry Realm" \
  -e REGISTRY_AUTH_HTpasswd_PATH=/auth/htpasswd \
  registry:2
```

## Registry 存储配置

默认使用本地文件系统存储镜像层。也可以配置云存储：

### S3 存储

```bash
docker run -d \
  --name registry \
  -p 5000:5000 \
  -e REGISTRY_STORAGE=s3 \
  -e REGISTRY_STORAGE_S3_BUCKET=my-registry \
  -e REGISTRY_STORAGE_S3_REGION=us-east-1 \
  -e REGISTRY_STORAGE_S3_ACCESSKEY=AKIAIOSFODNN7EXAMPLE \
  -e REGISTRY_STORAGE_S3_SECRETKEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY \
  registry:2
```

### Azure Blob Storage

```bash
docker run -d \
  --name registry \
  -p 5000:5000 \
  -e REGISTRY_STORAGE=azure \
  -e REGISTRY_STORAGE_AZURE_ACCOUNTNAME=myaccount \
  -e REGISTRY_STORAGE_AZURE_ACCOUNTKEY=mykey \
  -e REGISTRY_STORAGE_AZURE_CONTAINER=registry \
  registry:2
```

## Docker Compose 部署 Registry

生产环境推荐用 Docker Compose 管理：

```yaml
# docker-compose.yml
version: '3.8'

services:
  registry:
    image: registry:2
    container_name: registry
    ports:
      - "5000:5000"
    environment:
      REGISTRY_AUTH: htpasswd
      REGISTRY_AUTH_HTPASSWD_REALM: Registry
      REGISTRY_AUTH_HTPASSWD_PATH: /auth/htpasswd
      REGISTRY_STORAGE_DELETE_ENABLED: "true"
    volumes:
      - ./data:/var/lib/registry
      - ./auth:/auth
      - ./certs:/certs
      - ./config/config.yml:/etc/docker/registry/config.yml
    restart: unless-stopped
    networks:
      - registry-net

  # 可选：Registry UI
  registry-ui:
    image: joxit/docker-registry-ui:latest
    container_name: registry-ui
    ports:
      - "8080:80"
    environment:
      - REGISTRY_URL=http://registry:5000
      - SINGLE_REGISTRY=true
    depends_on:
      - registry
    networks:
      - registry-net

networks:
  registry-net:
    driver: bridge
```

### Registry 配置文件

对于更复杂的配置，使用配置文件：

```yaml
# config/config.yml
version: 0.1
log:
  level: info
  fields:
    service: registry
storage:
  filesystem:
    rootdirectory: /var/lib/registry
  delete:
    enabled: true
  maintenance:
    uploadpurging:
      enabled: true
      age: 168h
      interval: 24h
      dryrun: false
http:
  addr: :5000
  headers:
    X-Content-Type-Options: [nosniff]
auth:
  htpasswd:
    realm: Registry
    path: /auth/htpasswd
```

## 镜像清理（GC）

Registry 开启删除功能后，删除镜像只是删除了元数据，镜像层文件仍然存在。需要手动清理：

### 垃圾回收

```bash
# 1. 停止 Registry（重要：GC 期间不能有写入）
docker stop registry

# 2. 运行垃圾回收
docker run -it --rm \
  -v "$(pwd)"/data:/var/lib/registry \
  registry:2 bin/registry garbage-collect /etc/docker/registry/config.yml

# 3. 删除不再使用的层文件
docker run -it --rm \
  -v "$(pwd)"/data:/var/lib/registry \
  -v "$(pwd)"/auth:/auth \
  registry:2 \
  bin/registry garbage-collect /etc/docker/registry/config.yml -m

# 4. 重启 Registry
docker start registry
```

### 自动清理脚本

```bash
#!/bin/bash
# gc.sh

# 停止 Registry
docker-compose stop registry

# 垃圾回收
docker-compose run --rm registry \
    bin/registry garbage-collect /etc/docker/registry/config.yml -m

# 启动 Registry
docker-compose start registry
```

## 镜像推送和拉取流程

完整流程：

```bash
# 1. 客户端登录
docker login registry.example.com -u admin

# 2. 给镜像打标签（本地镜像名 → 仓库路径）
docker tag myapp:1.0.0 registry.example.com/myapp:1.0.0

# 3. 推送镜像
docker push registry.example.com/myapp:1.0.0

# 4. 其他机器拉取镜像
docker pull registry.example.com/myapp:1.0.0
```

### 批量推送脚本

```bash
#!/bin/bash
# push-images.sh

REGISTRY=registry.example.com
IMAGES=(
    "myapp:1.0.0"
    "myapp:1.1.0"
    "myapp:latest"
)

for image in "${IMAGES[@]}"; do
    echo "Pushing $image..."
    docker tag "${image}" "${REGISTRY}/${image}"
    docker push "${REGISTRY}/${image}"
done

echo "Done!"
```

## 高可用 Registry

生产环境建议部署 Registry 集群：

```
                    ┌─────────────────┐
                    │  负载均衡器       │
                    │  (Nginx/HAProxy) │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ↓                   ↓                   ↓
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   Registry 1    │ │   Registry 2    │ │   Registry 3    │
│   (同构存储)     │ │   (同构存储)     │ │   (同构存储)     │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             ↓
                     ┌───────────────┐
                     │  共享存储       │
                     │ (S3/MinIO/Ceph)│
                     └───────────────┘
```

使用分布式存储（S3、MinIO、Ceph）作为后端，多个 Registry 实例共享存储，实现高可用和水平扩展。

## 面试追问

1. **Docker Registry 和 Docker Hub 有什么区别？**
2. **私有仓库为什么需要认证？有哪些认证方式？**
3. **Registry 的存储后端可以有哪些选择？各自的特点是什么？**
4. **如何清理 Registry 中不再使用的镜像层？GC 的注意事项是什么？**
5. **如何实现 Registry 的高可用？**

> "Docker Registry 是容器镜像管理的基础设施。生产环境中，推荐使用更成熟的 Harbor，它在 Registry 基础上增加了镜像复制、镜像扫描、访问控制等企业级功能。"
