# 镜像安全扫描

「你的镜像安全吗？」——镜像安全扫描，是 CI/CD 的最后一道防线。

容器镜像的安全性，往往是被忽视的一环。镜像里藏着什么？过时的系统包、有漏洞的依赖、不安全的配置……如果不在构建时发现，上线后就是灾难。Trivy、Clair、Anchore 是最主流的开源镜像扫描工具。

## 为什么要扫描镜像？

```
┌─────────────────────────────────────────────────────────────────┐
│                    镜像安全风险                                 │
│                                                                  │
│  操作系统漏洞    恶意依赖包     敏感信息泄露     配置不当         │
│      ▼               ▼              ▼               ▼            │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐   │
│  │ openssl    │ │  npm       │ │  密码/密钥  │ │  root 运行  │   │
│  │ CVE-2024   │ │  后门包    │ │  在镜像里   │ │  无资源限制 │   │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘   │
│           │              │              │              │        │
│           └──────────────┴──────────────┴──────────────┘        │
│                                 │                               │
│                         扫描工具检测                              │
│                    Trivy / Clair / Anchore                       │
└─────────────────────────────────────────────────────────────────┘
```

镜像安全问题可能来自：
- 基础镜像本身（操作系统漏洞）
- 应用依赖（第三方库漏洞）
- 构建过程（敏感信息残留）
- 配置问题（以 root 运行、权限过大）

## Trivy：轻量级全功能扫描

Trivy 是 Aqua Security 开源的工具，以「零配置、开箱即用」著称，支持容器镜像、文件系统、Git 仓库扫描。

### 安装

```bash
# macOS
brew install trivy

# Docker
docker run --rm aquasec/trivy image nginx:1.25

# Kubernetes（作为 Admission Controller）
helm install trivy-operator aquasecurity/trivy-operator \
  --namespace trivy-system
```

### 基本用法

```bash
# 扫描镜像
trivy image nginx:1.25

# 只显示高危漏洞（Critical + High）
trivy image --severity HIGH,CRITICAL nginx:1.25

# 只显示漏洞，不显示厂商修复建议
trivy image --vuln-type os nginx:1.25

# 输出格式
trivy image --format json --output report.json nginx:1.25
trivy image --format sarif --output report.sarif nginx:1.25  # GitHub 集成
trivy image --format table nginx:1.25                       # 默认表格格式

# 扫描 Dockerfile
trivy config --severity HIGH,CRITICAL Dockerfile

# 扫描本地文件系统
trivy fs --severity HIGH,CRITICAL /path/to/project

# 扫描 K8s 集群
trivy k8s --report summary cluster
```

### 输出示例

```
nginx:1.25 (alpine 3.19.1)
==========================
Total: 5 (HIGH: 2, CRITICAL: 3)

┌────────────┬──────────────────┬──────────┬─────────────┬─────────────────────┐
│   Library  │     Vulnerability│ Severity │    Status   │       Fix           │
├────────────┼──────────────────┼──────────┼─────────────┼─────────────────────┤
│ openssl    │ CVE-2024-12797   │ CRITICAL │   Affected  │  1.3.2-r0           │
│ openssl    │ CVE-2024-1234    │ HIGH     │   Affected  │  1.3.2-r0           │
│ busybox    │ CVE-2023-5678    │ HIGH     │   Affected  │  1.36.1-r0          │
└────────────┴──────────────────┴──────────┴─────────────┴─────────────────────┘
```

### CI/CD 集成

```yaml
# GitHub Actions
# .github/workflows/trivy.yml
name: Container Image Scan

on:
  push:
    branches: [main]
    tags: ['v*']
  pull_request:

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build Docker image
        run: docker build -t myapp:${{ github.sha }} .

      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: 'myapp:${{ github.sha }}'
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'

      - name: Upload to GitHub Security tab
        uses: github/codeql-action/upload-sarif@v2
        with:
          sarif_file: 'trivy-results.sarif'

      - name: Fail on critical vulnerabilities
        if: always()
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: 'myapp:${{ github.sha }}'
          exit-code: '1'  # 找到漏洞则失败
          severity: 'CRITICAL,HIGH'
```

```groovy
// Jenkins Pipeline
stage('Security Scan') {
    steps {
        script {
            def imageName = "myapp:${env.BUILD_NUMBER}"
            sh "docker build -t ${imageName} ."
            sh """
                trivy image \
                    --severity HIGH,CRITICAL \
                    --exit-code 1 \
                    --no-progress \
                    --format json \
                    --output trivy-report.json \
                    ${imageName}
            """
        }
    }
    post {
        always {
            archiveArtifacts artifacts: 'trivy-report.json', allowEmptyArchive: true
        }
    }
}
```

### Trivy 与 Registry 集成

```bash
# 扫描 Harbor 镜像仓库中的所有镜像
trivy image --server http://harbor.example.com:8080 myproject/myapp:latest

# 定期扫描（作为 CronJob）
kubectl apply -f - <<EOF
apiVersion: batch/v1
kind: CronJob
metadata:
  name: trivy-scan
  namespace: security
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: trivy
            image: aquasec/trivy:latest
            args:
              - image
              - --severity
              - CRITICAL,HIGH
              - --exit-code
              - "1"
              - --no-progress
              - myregistry/myapp:latest
            env:
              - name: TRIVY_INsecure
                value: "true"
          restartPolicy: OnFailure
EOF
```

## Clair：深度扫描

Clair 是 Quay 团队开源的镜像扫描器，支持 RPM/DEB/APK 等多种包格式，扫描深度更深。

### 部署

```bash
# Docker Compose（开发环境）
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: password
  clair:
    image: quay.io/projectquay/clair:latest
    ports:
      - "6060:6060"
      - "6061:6061"
    depends_on:
      - postgres
    command: [--config, /etc/clair/config.yaml, --mode, combo]
    volumes:
      - ./clair-config.yaml:/etc/clair/config.yaml
```

### 配置

```yaml
# clair-config.yaml
 Clair:
  database:
    type: pgsql
    options:
      source: host=postgres port=5432 user=postgres password=password dbname=clair sslmode=disable
      migrations: /src/migrations
  api:
    port: 6060
    health: /health
  updater:
    interval: 2h
  indexer:
    airgap: false
```

### API 调用

```bash
# 添加镜像到 Clair
curl -X POST http://localhost:6060/index \
  -H "Content-Type: application/json" \
  -d '{"ContainerName": "myapp:latest"}'

# 获取扫描报告
curl http://localhost:6060/v1/namespaces/myproject/repos/myapp:v1

# Webhook 通知
curl -X POST http://localhost:6060/notifications/<notification_id>
```

## Anchore：企业级扫描

Anchore 提供更丰富的功能，包括合规性检查、策略管理，适合企业级场景。

### 安装

```bash
# 使用 Helm 安装
helm repo add anchore https://charts.anchore.io
helm install anchore anchore/anchore \
  --namespace anchore \
  --create-namespace
```

### 策略（Policy）

```json
{
  "id": "my-org-policy",
  "version": "1_0",
  "name": "My Organization Policy",
  "rules": [
    {
      "gate": "dockerfile",
      "trigger": "instruction",
      "params": [
        { "name": "instruction", "value": "USER root" }
      ],
      "action": "warn"
    },
    {
      "gate": "vulnerabilities",
      "trigger": "package",
      "params": [
        { "name": "severity", "value": "high" },
        { "name": "package_type", "value": "all" }
      ],
      "action": "stop"
    },
    {
      "gate": "packages",
      "trigger": "content_matches",
      "params": [
        { "name": "file_path", "value": "/etc/passwd" }
      ],
      "action": "warn"
    }
  ]
}
```

## 三者对比

| 维度 | Trivy | Clair | Anchore |
|------|-------|-------|---------|
| 安装复杂度 | 极简（单二进制） | 复杂（需要 PostgreSQL） | 中等（Helm） |
| 扫描速度 | 快 | 中 | 中 |
| 语言支持 | 全面（OS + 语言依赖） | 主要 OS | 全面 |
| CI/CD 集成 | 优秀 | 一般 | 优秀 |
| 策略管理 | 基础 | 中等 | 强大 |
| 企业功能 | 有限 | 有限 | 丰富（SSO、合规报告） |
| 活跃度 | 非常活跃 | 一般 | 活跃 |
| 许可 | Apache 2.0 | Apache 2.0 | GPL |

## 安全扫描最佳实践

### 1. 构建阶段扫描

```dockerfile
# Dockerfile 中使用 Trivy
FROM aquasec/trivy:latest AS scanner
COPY --from=build /app /app
RUN trivy fs --severity CRITICAL /app

# 多阶段构建：最终镜像不包含 scanner
FROM eclipse-temurin:17-jre-alpine AS final
COPY --from=build /app /app
USER nonroot
CMD ["java", "-jar", "/app/app.jar"]
```

### 2. 阻断式门禁

```bash
# 在 CI/CD 中设置阻断
#!/bin/bash
TRIVY_EXIT_CODE=0
trivy image --severity CRITICAL,HIGH --exit-code 1 myapp:latest || TRIVY_EXIT_CODE=$?

if [ $TRIVY_EXIT_CODE -eq 1 ]; then
    echo "Critical or High vulnerabilities found!"
    echo "Please fix vulnerabilities before deploying."
    exit 1
fi
```

### 3. 镜像签名与验证

```bash
# 使用 Cosign 签名（Sigstore 项目）
cosign sign --key cosign.key myregistry/myapp:latest

# 在 K8s 部署前验证签名
cosign verify --key cosign.pub myregistry/myapp:latest

# Kyverno 策略验证
kubectl apply -f - <<EOF
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-signatures
spec:
  validationFailureAction: Enforce
  rules:
    - name: verify-signature
      match:
        resources:
          kinds:
            - Pod
      verifyImages:
        - imageReferences:
            - "myregistry/myapp:*"
          attestors:
            - entries:
                - key:
                    data: |
                      -----BEGIN PUBLIC KEY-----
                      <cosign public key>
                      -----END PUBLIC KEY-----
EOF
```

### 4. 最小化镜像

减少攻击面的根本方法：

```dockerfile
# 不要用完整系统镜像
FROM node:20                # ~1GB，包含完整系统
FROM node:20-alpine         # ~180MB
FROM node:20-slim           # ~500MB，基于 Debian slim
FROM eclipse-temurin:17-jre  # ~200MB，只有 JRE

# 多阶段构建
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline
COPY src ./src
RUN mvn package -DskipTests

FROM eclipse-temurin:17-jre-alpine AS runtime
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
USER nonroot
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

### 5. 自动化基线扫描

```bash
# Trivy 的基准扫描（最佳实践检查）
trivy image --ignore-unfixed myapp:latest

# 查看被忽略的漏洞
trivy image --ignorefile .trivyignore myapp:latest
```

```bash
# .trivyignore
# 格式：漏洞ID 或 正则表达式
CVE-2024-1234
CVE-2024-*
vendor/dropwizard/*
```

## 面试追问方向

1. **Trivy 和 Clair 的扫描原理有什么区别？**
   答：Trivy 直接解压镜像层，扫描文件系统中的包文件（通过 DPKG/RPM/APK 数据库），速度快；Clair 索引镜像到数据库，通过 HTTP API 查询漏洞数据，深度更深但速度较慢。

2. **镜像扫描发现漏洞后怎么处理？**
   答：优先级排序（Critical 优先），基础镜像更新（换新版本或新基础镜像），应用依赖更新，评估缓解措施（网络隔离、运行时策略），配置忽略规则（短期内无法修复的已知问题）。

3. **如何防止有漏洞的镜像进入生产环境？**
   答：在 CI/CD 中设置 Quality Gate，扫描结果必须通过才能进入下一步；使用 Admission Controller（如 Kyverno、OPA Gatekeeper）在 K8s 部署时验证镜像签名和漏洞情况；Registry 集成（如 Harbor 的自动扫描）自动阻断高危镜像拉取。

4. **Trivy 扫描很慢，怎么优化？**
   答：Trivy 默认每次都下载漏洞数据库。可以持久化数据库（`TRIVY_DB_DIR`），或使用 `--db-repository` 指向内部镜像仓库。数据库每周更新一次，本地缓存后扫描速度会大幅提升。

镜像安全扫描是 DevSecOps 的第一步。没有扫描的 CI/CD，是不完整的 CI/CD。
