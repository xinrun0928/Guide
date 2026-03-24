# Harbor 企业级镜像仓库

Registry 适合小规模使用，但企业场景下，你需要更强大的能力：镜像复制、漏洞扫描、访问控制、镜像签名……

Harbor 就是为这个而生的。

## Harbor 是什么？

Harbor 是 VMware 开源的企业级 Registry，专为云原生环境设计。它在 Docker Registry 基础上提供了：

- **镜像仓库**：存储和分发 Docker 镜像
- **镜像复制**：支持跨数据中心同步镜像
- **漏洞扫描**：集成 Trivy/Clair 自动扫描镜像安全
- **访问控制**：基于项目的权限管理
- **镜像签名**：Docker Content Trust 支持
- **LDAP/AD 集成**：与企业账号系统对接
- **RESTful API**：与 CI/CD 系统集成

## 安装 Harbor

### 使用 Docker Compose 安装

```bash
# 1. 下载 Harbor 安装包
wget https://github.com/goharbor/harbor/releases/download/v2.10.0/harbor-online-installer-v2.10.0.tgz
tar -xf harbor-online-installer-v2.10.0.tgz
cd harbor

# 2. 配置 Harbor
cp harbor.yml.tmpl harbor.yml
vim harbor.yml

# 3. 配置项说明
hostname: harbor.example.com       # 域名
http:
  port: 80                          # HTTP 端口
https:
  port: 443
  certificate: /path/to/cert.crt    # HTTPS 证书
  private_key: /path/to/cert.key
harbor_admin_password: Harbor12345  # 管理员密码
database:
  password: root123                  # 数据库密码
data_volume: /data                  # 镜像存储路径

# 4. 启动 Harbor
./install.sh
```

### 使用 Helm 安装（Kubernetes）

```bash
# 添加 Harbor Helm 仓库
helm repo add harbor https://helm.goharbor.io
helm repo update

# 部署到 Kubernetes
helm install harbor harbor/harbor \
  --namespace harbor \
  --create-namespace \
  --set expose.ingress.hosts.core=harbor.example.com \
  --set expose.ingress.hosts.notary=notary.harbor.example.com \
  --set persistence.persistentVolumeClaim.registry.size=100Gi \
  --set persistence.persistentVolumeClaim.chartmuseum.size=5Gi
```

## Harbor 核心概念

### 项目（Project）

Harbor 用项目来组织镜像，类似命名空间：

```
项目类型：
├── 公共项目（Public）    # 所有用户可拉取
├── 私有项目（Private）   # 需要授权
└── 代理项目（Proxy Cache） # 代理 Docker Hub
```

### 仓库（Repository）

仓库是同一镜像的不同标签集合：

```
# 项目 / 镜像名
library/nginx          # library 项目下的 nginx 仓库
myproject/myapp        # myproject 项目下的 myapp 仓库
```

### 镜像标签（Tag）

```bash
# 完整镜像路径
harbor.example.com/library/nginx:1.21
harbor.example.com/myproject/myapp:v1.2.3
```

## Web UI 操作

Harbor 提供友好的 Web 界面：

### 创建项目

1. 登录 Harbor Web UI（`https://harbor.example.com`）
2. 点击「新建项目」
3. 填写项目名称和访问级别
4. 配置存储配额（可选）

### 配置项目成员

```
项目 → 成员 → 添加成员
角色：
├── 项目管理员（Project Admin）  # 完全控制
├── 开发者（Developer）          # 推送/拉取
├── 访客（Guest）               # 只读拉取
└── 维护者（Maintainer）        # 推送/拉取/创建标签
```

### 镜像复制规则

```
项目 → 复制管理 → 新建规则
配置项：
- 源 Registry
- 源项目/仓库
- 触发模式（手动/定时/事件驱动）
- 过滤器（标签、仓库名）
```

## 命令行操作

### 登录 Harbor

```bash
# 登录
docker login harbor.example.com -u admin

# 输入密码后即可推送/拉取镜像
```

### 推送镜像

```bash
# 1. 从 Docker Hub 拉取镜像
docker pull nginx:1.21-alpine

# 2. 打标签到 Harbor
docker tag nginx:1.21-alpine harbor.example.com/myproject/nginx:1.21-alpine

# 3. 推送到 Harbor
docker push harbor.example.com/myproject/nginx:1.21-alpine
```

### 使用 Docker Compose 推送多个镜像

```yaml
# docker-compose.yml
version: '3.8'

services:
  build-and-push:
    image: docker:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - HARBOR_REGISTRY=harbor.example.com
    command: |
      bash -c '
        images=(
          "myapp:latest"
          "myapp:1.0.0"
        )
        for img in "$${images[@]}"; do
          docker tag "$$img" "$$HARBOR_REGISTRY/myproject/$$img"
          docker push "$$HARBOR_REGISTRY/myproject/$$img"
        done
      '
```

## 镜像安全扫描

### 内置 Trivy 扫描

Harbor 默认集成 Trivy 漏洞扫描：

```
项目 → 镜像 → 扫描
结果：
├── 严重（Critical）  # 必须修复
├── 高危（High）      # 尽快修复
├── 中危（Medium）    # 建议修复
├── 低危（Low）       # 可接受
└── 可忽略（Negligible）
```

### 阻止不安全镜像部署

```bash
# 配置自动扫描策略
项目 → 漏洞过滤 → 配置
- 阻止部署严重漏洞镜像
- 阻止拉取严重漏洞镜像
```

### 扫描报告

```
镜像 → 扫描报告 → 查看详情
报告内容：
- CVE 漏洞列表
- 漏洞修复建议
- 依赖包版本信息
- 许可证合规性
```

## 镜像复制

### 同构复制（Harbor → Harbor）

```bash
# 创建复制规则
项目 → 复制管理 → 新建规则
配置：
- 目标 Registry：另一个 Harbor 实例
- 目标项目：可映射或同名
- 触发模式：
  ├── 手动：需要时手动触发
  ├── 定时：Cron 表达式（0 0 * * * *）
  └── 事件驱动：源 Registry 有推送时自动触发
```

### 代理 Docker Hub

```
项目 → 新建项目 → 代理项目
配置：
- Proxy Cache：启用
- 目标 Registry：Docker Hub
- 调度清理：定时删除未使用的镜像层

# 使用示例
docker pull harbor.example.com/library/ubuntu:22.04
# Harbor 会自动从 Docker Hub 拉取并缓存
```

### 跨地域复制架构

```
Region A（生产）                    Region B（灾备）
┌─────────────────┐               ┌─────────────────┐
│   Harbor A       │ ──── 复制 ────→│   Harbor B       │
│  (源)            │  定时/事件驱动 │  (目标)          │
└─────────────────┘               └─────────────────┘
        ↓                                ↓
  ┌──────────────┐                 ┌──────────────┐
  │ Kubernetes A │                 │ Kubernetes B │
  └──────────────┘                 └──────────────┘
```

## 垃圾回收与清理

Harbor 管理大量镜像后，需要定期清理：

### 保留策略

```
项目 → 配置 → 保留策略
规则示例：
- 保留最近 10 个标签
- 保留带有 latest 标签的镜像
- 保留按规则命名的镜像（如 release-*）
```

### 手动清理

```bash
# 通过 API 触发 GC
curl -X POST "https://harbor.example.com/api/v2.0/system/gc/schedule" \
  -u admin:Harbor12345 \
  -H "Content-Type: application/json" \
  -d '{"schedule":{"type":"hourly"}}'
```

## LDAP/AD 集成

企业通常用 LDAP/AD 管理账号：

```yaml
# harbor.yml
ldap:
  url: ldap://ldap.example.com:389
  search_dn: cn=admin,dc=example,dc=com
  search_password: admin_password
  base_dn: dc=example,dc=com
  filter: objectClass=person
  uid: sAMAccountName
  scope: 2
```

### 用户组同步

```
系统管理 → 用户管理 → LDAP 导入
导入方式：
- 手动：按需导入单个用户
- 自动：LDAP 组自动映射为 Harbor 项目成员
```

## 与 CI/CD 集成

### Jenkins Pipeline

```groovy
pipeline {
    agent any

    environment {
        REGISTRY = 'harbor.example.com'
        PROJECT = 'myproject'
        IMAGE = "${REGISTRY}/${PROJECT}/myapp"
    }

    stages {
        stage('Build') {
            steps {
                sh 'docker build -t ${IMAGE}:${GIT_COMMIT} .'
            }
        }

        stage('Scan') {
            steps {
                sh '''
                    # 使用 Trivy 扫描
                    docker run --rm \
                        -v /var/run/docker.sock:/var/run/docker.sock \
                        aquasec/trivy image --exit-code 1 \
                        --severity HIGH,CRITICAL \
                        ${IMAGE}:${GIT_COMMIT}
                '''
            }
        }

        stage('Push') {
            steps {
                sh '''
                    docker tag ${IMAGE}:${GIT_COMMIT} ${IMAGE}:${BUILD_NUMBER}
                    docker tag ${IMAGE}:${GIT_COMMIT} ${IMAGE}:latest
                    docker push ${IMAGE}:${BUILD_NUMBER}
                    docker push ${IMAGE}:latest
                '''
            }
        }
    }
}
```

### GitLab CI

```yaml
# .gitlab-ci.yml
build and push:
  image: docker:latest
  services:
    - docker:dind
  variables:
    REGISTRY: harbor.example.com
    PROJECT: myproject
  script:
    - docker login -u $HARBOR_USER -p $HARBOR_PASSWORD $REGISTRY
    - docker build -t $REGISTRY/$PROJECT/myapp:$CI_COMMIT_SHA .
    - docker push $REGISTRY/$PROJECT/myapp:$CI_COMMIT_SHA
    - docker tag $REGISTRY/$PROJECT/myapp:$CI_COMMIT_SHA $REGISTRY/$PROJECT/myapp:latest
    - docker push $REGISTRY/$PROJECT/myapp:latest
```

## 面试追问

1. **Harbor 和 Docker Registry 的区别是什么？企业为什么选择 Harbor？**
2. **Harbor 的镜像扫描是怎么实现的？支持哪些扫描器？**
3. **Harbor 的镜像复制是怎么工作的？有哪些复制模式？**
4. **如何设计 Harbor 的高可用架构？**
5. **Harbor 如何与 CI/CD 流水线集成？**

> "Harbor 是企业级镜像管理的标配。它的每个功能都对应一个真实需求：扫描是为了安全、复制是为了多地域部署、LDAP 是为了企业账号统一管理。在选型时，先问自己：这些能力，你的团队真的需要吗？"
