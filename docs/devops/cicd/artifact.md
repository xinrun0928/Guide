# 制品库管理

「构建产物存在哪？」——制品库是 CI/CD 的存储中心。

制品库（Artifact Repository）是存放构建产物的仓库：Maven 的 jar、npm 的 tarball、Docker 镜像、Helm Chart……没有制品库，CI/CD 流水线就无法传递产物，部署就成了无源之水。

## 制品库的角色

```
┌─────────────────────────────────────────────────────────────────┐
│                     CI/CD 流水线中的制品库                         │
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  编译构建 │───►│  制品库  │───►│  测试环境 │───►│  生产环境 │  │
│  │          │    │          │    │          │    │          │  │
│  │ .jar     │    │ Nexus    │    │ Staging  │    │ Production│ │
│  │ .tar.gz  │    │ Harbor   │    │          │    │          │  │
│  │ :latest  │    │ ChartMu  │    │          │    │          │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│                        │                                       │
│            版本管理 / 权限控制 / 清理策略 / 安全扫描              │
└─────────────────────────────────────────────────────────────────┘
```

## Nexus Repository

Nexus 是 Sonatype 出品的通用制品库，支持 Maven、Docker、npm、PyPI、Helm 等几乎所有主流格式。

### 安装与启动

```bash
# Docker 部署
docker run -d --name nexus \
  -p 8081:8081 \
  -p 8082:8082 \
  -v nexus_data:/nexus-data \
  sonatype/nexus3:latest

# 初始密码
docker exec nexus cat /nexus-data/admin.password
# 访问 http://localhost:8081
```

### 创建仓库

```bash
# 通过 Nexus API 创建仓库
curl -X POST http://localhost:8081/service/rest/v1/repositories \
  -u admin:admin123 \
  -H "Content-Type: application/json" \
  -d '{
    "name": "maven-releases",
    "type": "hosted",
    "format": "maven2",
    "url": "http://localhost:8081/repository/maven-releases",
    "storage": {
      "blobStoreName": "default",
      "strictContentTypeValidation": true,
      "writePolicy": "allow_once"
    },
    "maven": {
      "versionPolicy": "RELEASE",
      "layoutPolicy": "STRICT"
    }
  }'
```

### Maven 集成

```xml
<!-- pom.xml -->
<distributionManagement>
    <repository>
        <id>nexus-releases</id>
        <name>Nexus Releases</name>
        <url>http://localhost:8081/repository/maven-releases/</url>
    </repository>
    <snapshotRepository>
        <id>nexus-snapshots</id>
        <name>Nexus Snapshots</name>
        <url>http://localhost:8081/repository/maven-snapshots/</url>
    </snapshotRepository>
</distributionManagement>
```

```xml
<!-- ~/.m2/settings.xml -->
<servers>
    <server>
        <id>nexus-releases</id>
        <username>admin</username>
        <password>admin123</password>
    </server>
    <server>
        <id>nexus-snapshots</id>
        <username>admin</username>
        <password>admin123</password>
    </server>
</servers>
```

```bash
# 发布制品
mvn deploy

# 下载制品
mvn dependency:get \
  -Dartifact=com.example:my-app:1.0.0 \
  -DrepoUrl=http://localhost:8081/repository/maven-releases/ \
  -Dtransitive=false
```

### Docker 镜像仓库

```bash
# 在 Nexus 中创建 hosted Docker 仓库（支持 HTTPS，需要先配置 Docker Registry）

# 登录
docker login localhost:8082

# 推送镜像
docker build -t localhost:8082/my-app:1.0.0 .
docker push localhost:8082/my-app:1.0.0

# 拉取镜像
docker pull localhost:8082/my-app:1.0.0
```

### npm 集成

```bash
# 配置 npm 仓库
npm config set registry http://localhost:8081/repository/npm-group/
npm config set @my-scope:registry http://localhost:8081/repository/npm-hosted/

# 登录
npm adduser --registry http://localhost:8081/repository/npm-hosted/

# 发布
npm publish --registry http://localhost:8081/repository/npm-hosted/
```

## Harbor 镜像仓库

Harbor 是 CNCF 毕业项目，专为容器镜像设计的仓库，包含镜像扫描、签名、合规等企业级功能。

### 安装

```bash
# Docker Compose 部署
wget https://github.com/goharbor/harbor/releases/download/v2.10.0/harbor-offline-installer-v2.10.0.tgz
tar xf harbor-offline-installer-v2.10.0.tgz
cd harbor
cp harbor.yml.tmpl harbor.yml
# 编辑 harbor.yml 配置域名、HTTPS、存储等
./install.sh

# Helm 部署（生产推荐）
helm repo add harbor https://helm.goharbor.io
helm install harbor harbor/harbor \
  --namespace harbor \
  --create-namespace \
  --set expose.ingress.hosts.core=harbor.example.com \
  --set expose.ingress.hosts.notary=notary.example.com \
  --set persistence.persistentVolumeClaim.registry.size=100Gi
```

### 镜像推送与拉取

```bash
# 登录 Harbor
docker login harbor.example.com
# username: admin
# password: Harbor12345

# 推送
docker tag myapp:latest harbor.example.com/myproject/myapp:latest
docker push harbor.example.com/myproject/myapp:latest

# Robot 账户（机器身份，推荐生产使用）
# 在 Harbor UI 中创建 Robot 账户，获取 token
echo $ROBOT_TOKEN | docker login harbor.example.com -u "robot$my-robot" --password-stdin

# 拉取
docker pull harbor.example.com/myproject/myapp:1.0.0
```

### 镜像复制与同步

```yaml
# Harbor 复制策略（支持跨 Harbor 实例同步）
# 在 Harbor UI > Replication > New Replication Rule
# 源仓库：另一个 Harbor 或 Docker Hub
# 触发方式：手动 / 定时 / 事件驱动
# 过滤器：按仓库名、标签、正则表达式过滤
```

### 安全扫描

```bash
# Harbor 自动扫描所有推送的镜像
# 在 Harbor UI 查看扫描结果：
# 项目 > myproject > 镜像 > myapp:1.0.0 > Scan

# 通过 API 查询扫描结果
curl -u admin:Harbor12345 \
  "https://harbor.example.com/api/v2.0/projects/myproject/repositories/myapp/artifacts/1.0.0?verbosity=1"

# 扫描状态
# Harbor 使用 Trivy 或 Clair 作为扫描器
# 支持 CVE 数据库更新调度
```

### 内容信任（镜像签名）

```bash
# 配置 Docker Content Trust
export DOCKER_CONTENT_TRUST=1
export DOCKER_CONTENT_TRUST_SERVER=https://notary.example.com

# 推送时自动签名
docker push harbor.example.com/myproject/myapp:1.0.0
# 首次推送会提示创建根密钥和仓库密钥

# 拉取时验证签名
docker pull harbor.example.com/myproject/myapp:1.0.0
# 未签名镜像将被拒绝
```

## Helm Chart 仓库

### 使用 ChartMuseum（轻量）

```bash
# Docker 部署
docker run -d --name chartmuseum \
  -p 8080:8080 \
  -v /data/charts:/charts \
  -e DEBUG=1 \
  -e STORAGE=local \
  chartmuseum/chartmuseum:latest

# 推送 Chart
helm plugin install https://github.com/chartmuseum/helm-push
helm cm-push my-chart-1.0.0.tgz chartmuseum/

# 添加仓库
helm repo add chartmuseum http://localhost:8080
helm repo update
helm search repo my-chart
```

### 使用 Harbor 作为 Chart 仓库

```bash
# Harbor 支持 Helm Chart 原生存储
# 推送 Chart 到 Harbor
helm chart save myapp-1.0.0.tgz harbor.example.com/myproject/myapp:1.0.0
helm chart push harbor.example.com/myproject/myapp:1.0.0

# 拉取
helm repo add myproject http://harbor.example.com/chartrepo/myproject
helm install myapp myproject/myapp
```

## Nexus vs Harbor vs GitHub Packages

| 维度 | Nexus | Harbor | GitHub Packages |
|------|-------|--------|----------------|
| 定位 | 通用制品库 | 容器镜像库 | GitHub 集成包管理 |
| Docker 镜像 | 支持 | 优秀 | 支持 |
| Helm Chart | 支持 | 支持 | 支持 |
| Maven/npm | 优秀 | 不支持 | 支持（npm/Docker/Maven） |
| 镜像扫描 | 需插件 | 原生（Trivy） | 原生（Dependabot） |
| 镜像签名 | 不支持 | 原生（Notary） | 原生（Sigstore） |
| 权限模型 | 基于路径 | 项目 + RBAC | GitHub 权限继承 |
| 存储 | S3/GCS/Azure/本地 | S3/GCS/Azure/本地 | GitHub 存储 |
| 适用场景 | 多语言 + 镜像混合 | 纯容器平台 | GitHub 托管项目 |

## 制品库最佳实践

### 1. 分环境隔离

```yaml
# 开发 / 测试 / 预发 / 生产使用独立仓库
# Harbor 项目隔离：
# myproject-dev (公开，自动扫描关闭)
# myproject-staging (私有，自动扫描开启)
# myproject-prod (私有，强扫描，签名强制)
```

### 2. 清理策略

```bash
# Harbor Retention Policy（自动清理旧镜像）
# 在 Harbor UI > 项目 > 规则 > Add Rule
# 匹配标签：keep-last-30
# 保留最近 30 个版本，删除旧版本

# Nexus 清理策略
# Administration > Repositories > [仓库] > Storage > Asset Selectors
# 清理 30 天前的 SNAPSHOT
# last_downloaded < now - 30d AND format = "maven2" AND maven2.base_version ~ "SNAPSHOT"
```

### 3. 高可用部署

```yaml
# Harbor 高可用架构（至少 3 节点）
# ├── Harbor Core (API / UI)
# ├── Harbor Jobservice (复制 / 扫描)
# ├── Harbor DB (PostgreSQL 主从)
# ├── Harbor Redis (会话缓存)
# └── 共享存储 (NFS / 对象存储)
```

### 4. CI/CD 流水线集成

```groovy
// Jenkins Pipeline - 发布到 Nexus
stage('Publish to Nexus') {
    steps {
        script {
            def dockerImage = docker.build("myapp:${env.BUILD_NUMBER}")
            dockerImage.push()
            dockerImage.push('latest')

            // 发布 Maven 制品
            sh """
                mvn deploy \
                    -DaltReleaseUrl=nexus-releases \
                    -DaltSnapshotUrl=nexus-snapshots
            """
        }
    }
}
```

```yaml
# GitHub Actions - 发布到 GitHub Packages
# .github/workflows/release.yml
- name: Publish to GitHub Packages
  run: mvn deploy
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    OSSRH_USERNAME: ${{ secrets.OSSRH_USERNAME }}
    OSSRH_TOKEN: ${{ secrets.OSSRH_TOKEN }}
```

## 常见问题

### Docker push 失败（500/502）

```bash
# 通常是存储问题，检查 Harbor 日志
kubectl logs -n harbor -l component=jobservice

# 检查 Redis 连接（Harbor 2.x 依赖 Redis）
kubectl exec -it harbor-redis-0 -n harbor -- redis-cli ping
```

### Maven 无法下载 Nexus 制品

```bash
# 检查网络
curl -u admin:admin123 http://localhost:8081/repository/maven-releases/.index/idx

# Maven settings.xml 中 server id 必须和 pom.xml 中 repository id 一致
# 如果 pom.xml 中 id 为 "nexus-releases"，settings.xml 中 <server><id> 必须也是 "nexus-releases"
```

### Harbor 镜像拉取失败

```bash
# 检查 Docker daemon 是否信任 Harbor 证书
# 方案一：配置 Docker daemon 不验证 HTTPS（不推荐生产）
# /etc/docker/daemon.json
{ "insecure-registries": ["harbor.example.com"] }

# 方案二：导入 Harbor 证书（推荐）
cp harbor.example.com.crt /etc/docker/certs.d/harbor.example.com/ca.crt
systemctl restart docker
```

## 面试追问方向

1. **制品库和 Git 的区别是什么？**
   答：Git 存代码文本（diff 压缩），适合源代码；制品库存构建产物（jar、镜像、tarball），通常压缩率低、体积大，需要专门的版本管理和清理策略。制品库通常有权限控制、签名验证、安全扫描等 Git 没有的功能。

2. **Harbor 的双写模式是什么？**
   答：Harbor 支持同步复制到多个后端存储（主从同步）。配置双写后，写入时会同时写入两个存储，降低单点故障风险。

3. **如何实现制品的不可变部署？**
   答：每个制品使用不可变标签（如 Git commit SHA），禁止覆盖已有标签。Harbor 支持「不可变标签」规则，配置后特定标签（如 `prod-*`）无法被覆盖，必须用新标签。

4. **制品库如何防止依赖投毒（Dependency Confusion）？**
   答：npm 的作用域包（`@myorg/package`）只从私有库拉取，不从 npmjs；Maven 使用 `settings.xml` 限制仓库列表，禁用未知仓库。

制品库是 CI/CD 流水线的存储基座，选型时主要看团队需要存储哪些类型的制品。
