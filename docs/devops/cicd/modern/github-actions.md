# GitHub Actions 完全指南

「GitHub Actions 怎么写？」——`.github/workflows/*.yml` 就是答案。

GitHub Actions 是 GitHub 内置的 CI/CD 功能，配置简单、生态丰富。每一个 workflow 就是一个自动化流程，可以响应代码事件（push、PR、release 等），也可以定时触发。

## 核心概念

```
┌─────────────────────────────────────────────────────────────────┐
│                     GitHub Actions 架构                          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │  workflow    │  │   Runner     │  │   Marketplace │        │
│  │  (YAML配置)  │──►│ (GitHub托管) │──►│   Actions    │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
│                            │                                    │
│         ┌──────────────────┴──────────────────┐                │
│         ▼                                     ▼                │
│  ┌──────────────┐                     ┌──────────────┐         │
│  │  GitHub      │                     │  Artifact    │         │
│  │  Secrets     │                     │  Storage     │         │
│  └──────────────┘                     └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘

workflow → jobs → steps → actions
一个 workflow 包含多个 job
一个 job 包含多个 step
一个 step 执行一个 action 或命令
```

## 基础结构

```yaml
# .github/workflows/ci.yml
name: CI Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  APP_NAME: my-service
  REGISTRY: ghcr.io

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
          cache: 'maven'

      - name: Build with Maven
        run: mvn clean package -DskipTests

      - name: Upload Artifact
        uses: actions/upload-artifact@v4
        with:
          name: jar-file
          path: target/*.jar
          retention-days: 7

  test:
    runs-on: ubuntu-latest
    needs: build  # 依赖 build job
    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
          cache: 'maven'

      - name: Download Artifact
        uses: actions/download-artifact@v4
        with:
          name: jar-file
          path: target/

      - name: Run Tests
        run: mvn test

      - name: Upload Test Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: target/surefire-reports/
```

## 触发条件

```yaml
on:
  # 分支推送
  push:
    branches: [main, develop, 'feature/*']
    tags:
      - 'v*'
    paths:
      - 'src/**'
      - '*.java'
      - 'pom.xml'

  # PR 事件
  pull_request:
    types: [opened, synchronize, reopened]

  # 手动触发
  workflow_dispatch:
    inputs:
      environment:
        description: 'Deploy to environment'
        required: true
        default: 'staging'
        type: choice
        options:
          - staging
          - production

  # 定时任务
  schedule:
    - cron: '0 2 * * *'  # 每天凌晨 2 点

  # 其他仓库事件
  repository_dispatch:
    types: [deploy]
```

## 环境变量与 Secrets

```yaml
env:
  NODE_VERSION: '20'
  APP_ENV: production

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production  # 关联 environment，需要人工审批
    steps:
      - uses: actions/checkout@v4

      - name: Login to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}  # 自动提供的 token

      - name: Build and Push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:${{ github.sha }}
            ghcr.io/${{ github.repository }}:latest
```

### Secrets 管理

| Secret 来源 | 使用方式 | 说明 |
|-----------|--------|------|
| GitHub Secrets | `${{ secrets.SECRET_NAME }}` | 加密存储，需手动配置 |
| OpenID Connect | `credentials` | 不存储密钥，按需获取云资源 |
| 环境变量 | `${{ env.VAR_NAME }}` | 非敏感配置 |
| Runner 环境变量 | 直接使用 | Runner 自带的变量 |

## 矩阵构建

```yaml
jobs:
  test-matrix:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        java: [11, 17, 21]
        database: [mysql:8.0, postgres:15]
        include:
          - java: 21
            database: mysql:8.0
            extra: "latest jdk"
      fail-fast: false  # 一个失败不影响其他

    services:
      mysql:
        image: ${{ matrix.database }}
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_DATABASE: testdb
        ports:
          - 3306:3306
        options: >-
          --health-cmd="mysqladmin ping"
          --health-interval=10s
          --health-timeout=5s
          --health-retries=5

    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK ${{ matrix.java }}
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: ${{ matrix.java }}
          cache: 'maven'

      - name: Run Tests
        run: mvn test -Ddb.image=${{ matrix.database }}
```

## 缓存依赖

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Maven 缓存
      - name: Cache Maven packages
        uses: actions/cache@v4
        with:
          path: ~/.m2/repository
          key: ${{ runner.os }}-maven-${{ hashFiles('**/pom.xml') }}
          restore-keys: |
            ${{ runner.os }}-maven-

      # npm 缓存
      - name: Cache node_modules
        uses: actions/cache@v4
        with:
          path: node_modules
          key: ${{ runner.os }}-npm-${{ hashFiles('package-lock.json') }}

      # pip 缓存
      - name: Cache pip packages
        uses: actions/cache@v4
        with:
          path: ~/.cache/pip
          key: ${{ runner.os }}-pip-${{ hashFiles('**/requirements.txt') }}
```

## Docker 构建

```yaml
jobs:
  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:${{ github.sha }}
            ghcr.io/${{ github.repository }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

## 部署到 Kubernetes

```yaml
# .github/workflows/k8s-deploy.yml
name: Deploy to Kubernetes

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - name: Set up kubectl
        uses: azure/setup-kubectl@v4

      - name: Configure kubectl
        run: |
          echo "${{ secrets.KUBE_CONFIG }}" | base64 -d > $HOME/.kube/config

      - name: Update image
        run: |
          kubectl set image deployment/$APP_NAME \
            app=${{ env.REGISTRY }}/$APP_NAME:${{ github.sha }} \
            -n production

      - name: Verify deployment
        run: |
          kubectl rollout status deployment/$APP_NAME -n production --timeout=5m
```

## Reusable Workflows

```yaml
# .github/workflows/deploy.yml
on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
    secrets:
      KUBE_CONFIG:
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - uses: actions/checkout@v4

      - name: Deploy
        run: |
          echo "${{ secrets.KUBE_CONFIG }}" | base64 -d > kubeconfig
          kubectl apply -f k8s/ -n ${{ inputs.environment }}
```

调用方式：

```yaml
# .github/workflows/release.yml
jobs:
  deploy-staging:
    uses: ./.github/workflows/deploy.yml
    with:
      environment: staging
    secrets:
      KUBE_CONFIG: ${{ secrets.KUBE_CONFIG_STAGING }}

  deploy-production:
    needs: deploy-staging
    uses: ./.github/workflows/deploy.yml
    with:
      environment: production
    secrets:
      KUBE_CONFIG: ${{ secrets.KUBE_CONFIG_PRODUCTION }}
```

## 并行与依赖

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run lint

  test-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run test:unit

  test-integration:
    runs-on: ubuntu-latest
    needs: build  # 等待 build 完成
    steps:
      - uses: actions/checkout@v4
      - run: npm run test:integration

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run build

  deploy:
    needs: [lint, test-unit, build]  # 等待多个 job
    runs-on: ubuntu-latest
    steps:
      - run: echo "All checks passed, deploying..."
```

## 通知与报告

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run tests
        run: npm test

      - name: Publish Test Results
        if: always()
        uses: dorny/test-reporter@v1
        with:
          reporter: 'java-junit'
          path: 'target/surefire-reports/*.xml'

      - name: Upload Coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage/lcov.info
          fail_ci_if_error: false

      - name: Notify Slack
        if: failure()
        uses: slackapi/slack-github-action@v1
        with:
          payload: |
            {
              "text": "Build failed: ${{ github.workflow }} - ${{ github.run_id }}"
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

## GitHub Actions vs GitLab CI vs Jenkins

| 维度 | GitHub Actions | GitLab CI | Jenkins |
|------|--------------|-----------|---------|
| 配置位置 | .github/workflows/ | .gitlab-ci.yml | Jenkinsfile |
| 托管 | GitHub 托管 | GitLab 托管 | 自托管 |
| 语法 | YAML | YAML | Groovy |
| Marketplace | 丰富 (10k+) | 插件系统 | 插件系统 |
| 并行度 | 依赖 + matrix | 依赖 + parallel | 依赖 + parallel |
| macOS/Windows | 支持 (付费) | 支持 (付费) | 自托管 |
| 私有 runner | 需要自建 | 需要自建 | 原生支持 |
| 与 Git 集成 | 原生 | 原生 | 需插件 |

## 面试追问方向

1. **GitHub Actions 如何实现按需获取云资源而不存储密钥？**
   答：通过 OpenID Connect (OIDC)。配置云厂商的 IAM 信任关系，GitHub Actions 获取短期 token，无需存储永久密钥。

2. **GitHub Actions 的 `GITHUB_TOKEN` 权限范围是什么？**
   答：默认只有读权限。可以通过 `permissions` 声明需要写入的权限，如 `pull-requests: write`、`contents: write`。

3. **如何保证 workflow 幂等性？**
   答：使用 `idempotency-key`，对数据库操作使用 upsert 而非 insert，Kubernetes 部署使用 `kubectl apply`（幂等）而非 `kubectl create`。

4. **GitHub Actions 如何管理多环境部署？**
   答：使用 `environment` 关联不同 environment，每个 environment 有独立的 secrets 和保护规则（人工审批）。

5. **GitHub Actions 的限制是什么？**
   答：免费版 Linux runner 每月 2000 分钟，macOS 每月 200 分钟；自托管 runner 无时间限制但需自行运维。

GitHub Actions 的优势在于与 GitHub 无缝集成，Marketplace 生态丰富，适合快速搭建 CI/CD。但对于复杂的部署场景，可能需要结合 ArgoCD 或其他 GitOps 工具。
