# CI/CD 流水线设计：从需求到落地的完整流程

「流水线怎么设计才合理？」——从简单到复杂，渐进式演进。

好的流水线设计不是一蹴而就的。它需要平衡构建速度、代码质量、安全性和可维护性。设计不良的流水线，轻则浪费资源，重则成为发布的瓶颈。

## 流水线分层设计

```
┌─────────────────────────────────────────────────────────────────┐
│                    CI/CD 流水线分层                              │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    第一层：提交阶段（< 5 分钟）                   │  │
│  │                                                             │  │
│  │  触发：代码提交到 feature 分支                                │  │
│  │  目的：快速反馈，不阻塞开发                                    │  │
│  │  步骤：                                                       │  │
│  │  1. 编译构建（Build）                                        │  │
│  │  2. 单元测试（Unit Test）                                    │  │
│  │  3. 代码扫描（可选，SonarQube）                                │  │
│  │                                                             │  │
│  │  ⚠️ 这一层要快，任何步骤超过 2 分钟都要优化                   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                   第二层：合并阶段（< 15 分钟）                   │  │
│  │                                                             │  │
│  │  触发：MR/PR 合并到 main/master                             │  │
│  │  目的：质量门禁，合并不应有失败                                │  │
│  │  步骤：                                                       │  │
│  │  1. 编译构建                                                 │  │
│  │  2. 单元测试                                                 │  │
│  │  3. 集成测试                                                 │  │
│  │  4. 代码质量扫描                                             │  │
│  │  5. 安全扫描（SAST、依赖检查）                                │  │
│  │  6. 镜像构建 + 推送                                           │  │
│  │  7. 部署到 Staging 环境                                      │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    第三层：发布阶段（< 30 分钟）                   │  │
│  │                                                             │  │
│  │  触发：发布标签或手动触发                                     │  │
│  │  目的：可追溯、可回滚                                        │  │
│  │  步骤：                                                       │  │
│  │  1. 环境确认（测试环境就绪）                                 │  │
│  │  2. 生产镜像构建（可选）                                      │  │
│  │  3. 灰度部署（5%）                                           │  │
│  │  4. 监控验证（15-30 分钟）                                   │  │
│  │  5. 全量部署                                                 │  │
│  │  6. 事后验证                                                 │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 提交阶段设计

```yaml
# .github/workflows/pr-check.yml
name: PR Check

on:
  pull_request:
    branches: [main, master]
    types: [opened, synchronize, reopened]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    timeout-minutes: 10  # 超过 10 分钟自动终止

    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
          cache: maven  # 缓存依赖

      - name: Cache Maven packages
        uses: actions/cache@v3
        with:
          path: ~/.m2/repository
          key: ${{ runner.os }}-maven-${{ hashFiles('**/pom.xml') }}
          restore-keys: |
            ${{ runner.os }}-maven-

      - name: Build with Maven
        run: mvn clean verify -DskipTests

      - name: Run Unit Tests
        run: mvn test

      - name: Upload Test Results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: target/surefire-reports/
          retention-days: 7

      # SonarQube 扫描（可选，注释掉加速提交检查）
      # - name: SonarQube Scan
      #   uses: sonarsource/sonarqube-scan-action@v2
      #   env:
      #     SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
      #     SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}
```

### 提交阶段优化

```
┌─────────────────────────────────────────────────────────────────┐
│                    提交阶段优化技巧                               │
│                                                                  │
│  1. 并行执行无依赖步骤                                           │
│  - 单元测试、构建、依赖下载并行化                                │
│                                                                  │
│  2. 缓存优化                                                    │
│  - Maven/Gradle 依赖缓存（~70% 构建时间）                       │
│  - npm/Yarn 依赖缓存                                             │
│  - Docker 层缓存（BuildKit）                                     │
│                                                                  │
│  3. 跳过不必要的步骤                                             │
│  - docs 变更跳过构建和测试                                       │
│  - 非 Java 文件变更跳过 Maven                                   │
│                                                                  │
│  4. 增量构建                                                    │
│  - 检测变更文件，只构建影响的模块                                │
│  - 适用于 Monorepo                                              │
│                                                                  │
│  5. 失败快速反馈                                                │
│  - 单元测试先跑，失败即停止                                      │
│  - 构建失败不进入下一阶段                                       │
└─────────────────────────────────────────────────────────────────┘
```

## 合并阶段设计

```yaml
# .github/workflows/main.yml
name: Main Branch CI/CD

on:
  push:
    branches: [main, master]
  workflow_dispatch:  # 手动触发

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  # ================================================================
  # 阶段一：构建与测试（并行）
  # ================================================================
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
          cache: maven

      - name: Build
        run: mvn clean package -DskipTests

      - name: Upload JAR
        uses: actions/upload-artifact@v3
        with:
          name: app-jar
          path: target/*.jar
          retention-days: 3

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
          cache: maven

      - name: Run Tests
        run: mvn test

      - name: Upload Coverage
        uses: codecov/codecov-action@v3
        with:
          files: target/site/jacoco/jacoco.xml

  # ================================================================
  # 阶段二：质量门禁
  # ================================================================
  quality-gate:
    runs-on: ubuntu-latest
    needs: [build, test]
    steps:
      - uses: actions/checkout@v4

      - name: SonarQube Scan
        uses: sonarsource/sonarqube-scan-action@v2
        with:
          args: >
            -Dsonar.projectKey=order-service
            -Dsonar.qualitygate.wait=true
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
          SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}

  # ================================================================
  # 阶段三：安全扫描
  # ================================================================
  security-scan:
    runs-on: ubuntu-latest
    needs: [build]
    steps:
      - uses: actions/checkout@v4

      - name: Trivy Vulnerability Scanner
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          scan-ref: '.'
          format: 'sarif'
          output: 'trivy-results.sarif'

      - name: Upload Trivy results to GitHub Security
        uses: github/codeql-action/upload-sarif@v2
        with:
          sarif_file: 'trivy-results.sarif'

      - name: Check Dependency Vulnerabilities
        run: |
          mvn org.owasp:dependency-check-maven:check
          # 失败则阻断

  # ================================================================
  # 阶段四：镜像构建与推送
  # ================================================================
  build-image:
    runs-on: ubuntu-latest
    needs: [quality-gate, security-scan]
    outputs:
      image-tag: ${{ steps.meta.outputs.tags }}
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=
            type=raw,value=latest

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # ================================================================
  # 阶段五：部署 Staging
  # ================================================================
  deploy-staging:
    runs-on: ubuntu-latest
    needs: [build-image]
    environment: staging
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Staging
        uses: azure/k8s-deploy@v4
        with:
          manifests: |
            k8s/deployment.yaml
            k8s/service.yaml
            k8s/ingress.yaml
          images: |
            ${{ needs.build-image.outputs.image-tag }}

      - name: Wait for Deployment
        run: |
          kubectl rollout status deployment/order-service -n staging
          sleep 30  # 等待服务预热

      - name: Smoke Test
        run: |
          curl -f https://staging.example.com/health || exit 1
```

## 发布阶段设计

```yaml
# .github/workflows/release.yml
name: Release

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Release Version (e.g., v1.2.3)'
        required: true
        type: string

jobs:
  # ================================================================
  # 阶段一：环境准备
  # ================================================================
  pre-release:
    runs-on: ubuntu-latest
    steps:
      - name: Validate Version
        run: |
          if [[ ! "${{ inputs.version }}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "Invalid version format: ${{ inputs.version }}"
            exit 1
          fi

      - name: Create Release Branch
        run: |
          git checkout -b release/${{ inputs.version }}
          git push origin release/${{ inputs.version }}

  # ================================================================
  # 阶段二：灰度部署（Canary）
  # ================================================================
  canary-deploy:
    runs-on: ubuntu-latest
    needs: pre-release
    environment:
      name: production
      url: https://production.example.com
    steps:
      - uses: actions/checkout@v4

      - name: Deploy Canary (10%)
        run: |
          kubectl set image deployment/order-service \
            order-service=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ inputs.version }} \
            -n production

          # 只更新 10% 的 Pod
          kubectl patch deployment order-service \
            -n production \
            -p '{"spec":{"replicas":3}}'

      - name: Wait for Canary
        run: |
          kubectl rollout status deployment/order-service -n production
          sleep 60

      - name: Monitor Canary Metrics
        run: |
          # 模拟：等待 15 分钟观察
          echo "Monitoring for 15 minutes..."
          sleep 900

          # 检查错误率
          ERROR_RATE=$(curl -s https://prometheus.example.com/api/v1/query?query=error_rate | jq '.data.result[0].value[1]')
          if (( $(echo "$ERROR_RATE > 0.01" | bc -l) )); then
            echo "Error rate too high: $ERROR_RATE"
            exit 1
          fi

  # ================================================================
  # 阶段三：全量部署
  # ================================================================
  full-deploy:
    runs-on: ubuntu-latest
    needs: canary-deploy
    environment:
      name: production
    steps:
      - uses: actions/checkout@v4

      - name: Full Deployment
        run: |
          kubectl set image deployment/order-service \
            order-service=${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ inputs.version }} \
            -n production

          kubectl rollout status deployment/order-service -n production

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          tag_name: ${{ inputs.version }}
          generate_release_notes: true

      - name: Notify Success
        run: |
          echo "Release ${{ inputs.version }} deployed successfully!"
```

## 流水线即代码最佳实践

```
┌─────────────────────────────────────────────────────────────────┐
│                    流水线即代码最佳实践                           │
│                                                                  │
│  1. 流水线版本控制                                               │
│  - 流水线配置放在代码仓库                                        │
│  - 和代码一起 Review                                             │
│  - 每次变更有记录可追溯                                          │
│                                                                  │
│  2. 失败快速反馈                                                 │
│  - 提交阶段失败立即通知开发者                                    │
│  - 失败原因清晰可读                                              │
│  - 提供修复建议                                                  │
│                                                                  │
│  3. 幂等性设计                                                  │
│  - 流水线可以重复执行                                           │
│  - 失败后可以重试                                               │
│  - 不因重试产生副作用                                           │
│                                                                  │
│  4. 安全设计                                                    │
│  - 敏感信息用 Secret，不硬编码                                   │
│  - Pipeline 权限最小化                                           │
│  - 部署环境需要人工审批                                          │
│                                                                  │
│  5. 可观测性                                                    │
│  - 流水线执行时间可视化                                         │
│  - 每个步骤耗时可追踪                                           │
│  - 失败步骤有日志链接                                           │
└─────────────────────────────────────────────────────────────────┘
```

## 常见错误

```
# 错误一：流水线太慢
# 原因：每个提交都跑全量测试；没有缓存
# 解决：分层流水线；加入缓存；并行化

# 错误二：失败原因不明确
# 原因：测试结果没有上传；日志不够详细
# 解决：上传测试报告；每个步骤添加描述

# 错误三：Secret 管理混乱
# 原因：Secret 放在环境变量里；不同步
# 解决：用 Vault 或云厂商 Secret Manager；定期轮换

# 错误四：缺少质量门禁
# 原因：代码质量扫描是可选的
# 解决：SonarQube Quality Gate 必须通过；安全扫描失败阻断

# 错误五：部署后没有验证
# 原因：只管部署不管结果
# 解决：Smoke Test；监控检查；健康检查
```

## 面试追问方向

1. **如何设计一个支持 Monorepo 的 CI/CD 流水线？**
   答：Monorepo 需要检测变更文件，只构建影响的模块。方案一：Nx/Bazel 等构建工具自带影响分析；方案二：自定义脚本检测变更路径（如 `git diff --name-only`），然后 `mvn -pl <changed-module>` 只构建变更模块。关键是要有变更检测 + 增量构建。

2. **如何实现流水线的失败重试和超时控制？**
   答：每个 CI 工具都有重试机制：GitHub Actions 的 `retries`；GitLab CI 的 `retry`；Jenkins 的 `retry()`. 超时控制：GitHub Actions 的 `timeout-minutes`；GitLab CI 的 `timeout`；Jenkins 的 `timeout { ... }`。超时时间要合理：提交检查 5-10 分钟，合并检查 15-30 分钟，部署检查 30-60 分钟。

3. **如何保证流水线的安全性？**
   答：多层保障：1) 流水线配置版本控制，Review 机制；2) Secret 管理用 Vault 或云厂商服务；3) 容器镜像扫描（Trivy）；4) 权限最小化（RBAC）；5) 部署环境需要人工审批；6) 流水线日志审计。

4. **流水线失败后如何排查？**
   答：排查步骤：1) 看失败步骤的日志，定位具体错误；2) 检查环境变量和 Secret 是否正确；3) 检查网络连通性（内网服务）；4) 检查依赖版本（第三方服务是否正常）；5) 本地复现（如果可能）；6) 查看历史构建是否有同样问题。

流水线设计是 CI/CD 的核心。好的设计让发布成为日常，坏的设计让发布成为噩梦。
