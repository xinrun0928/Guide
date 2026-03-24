# SonarQube 代码质量管理

「代码质量怎么量化？」——SonarQube 是答案。

SonarQube 是一个开源的代码质量管理平台，支持 20+ 编程语言，通过静态代码分析发现 Bug、漏洞、代码异味（Code Smell），并量化技术债务。它是 CI/CD 流水线的必备环节。

## 核心概念

```
┌─────────────────────────────────────────────────────────────────┐
│                    SonarQube 工作流程                             │
│                                                                  │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐  ┌──────────┐ │
│  │ IDE      │────►│ Scanner  │────►│ SonarQube│──►│ Dashboard│ │
│  │ (本地)   │     │ (CI/CD)  │     │ Server   │  │          │ │
│  └──────────┘     └──────────┘     └──────────┘  └──────────┘ │
│       │                                     │                   │
│  实时反馈                               质量门禁                   │
│  (快捷提示)                           (Quality Gate)             │
└─────────────────────────────────────────────────────────────────┘

静态代码分析 → Bug / 漏洞 / Code Smell / 技术债务
```

## 安装部署

```bash
# Docker 快速启动
docker run -d --name sonarqube \
  -p 9000:9000 \
  -e SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true \
  sonarqube:community

# 持久化配置
docker run -d --name sonarqube \
  -p 9000:9000 \
  -v sonarqube_data:/opt/sonarqube/data \
  -v sonarqube_logs:/opt/sonarqube/logs \
  -v sonarqube_extensions:/opt/sonarqube/extensions \
  sonarqube:community

# 默认账号密码：admin/admin
```

### SonarScanner 安装

```bash
# 下载 Scanner
wget https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-5.0.1.3006-linux.zip
unzip sonar-scanner-cli-5.0.1.3006-linux.zip
export PATH=$PATH:/path/to/sonar-scanner/bin

# Maven 项目使用内置 Scanner
mvn sonar:sonar
```

## 质量门禁（Quality Gate）

Quality Gate 是 SonarQube 的核心概念——它定义了「代码能否发布」的标准。

| 指标 | 说明 | 默认阈值 |
|-----|------|---------|
| 新代码覆盖率 | 新增/修改代码的测试覆盖率 | ≥ 80% |
| 可靠性 | Bug 数量和严重程度 | 无新增 Bug（Blocker/Critical） |
| 安全性 | 漏洞数量 | 无新增漏洞（Blocker/Critical） |
| 安全性热点 | 安全敏感区域 | 无新增 Security Hotspot |
| 技术债务 | 代码异味 | 新增技术债务比例 ≤ 5% |

### 自定义 Quality Gate

```java
// SonarQube UI 中配置，或通过 API：
// PUT api/qualitygates/create
// 配置条件：
// - on_new_code: true（新代码专用）
// - metric: coverage, bugs, vulnerabilities, code_smells
// - operator: LESS_THAN, GREATER_THAN
// - value: 阈值
```

## CI/CD 集成

### Maven 项目

```bash
# pom.xml 添加插件
# (已内置，无需额外配置)

# 运行分析
mvn clean verify sonar:sonar \
  -Dsonar.host.url=http://localhost:9000 \
  -Dsonar.login=<token> \
  -Dsonar.projectKey=my-app \
  -Dsonar.sources=src/main/java \
  -Dsonar.java.binaries=target/classes
```

### Gradle 项目

```groovy
// build.gradle
plugins {
    id "org.sonarqube" version "4.4.1.3373"
}

sonarqube {
    properties {
        property "sonar.projectKey", "my-gradle-app"
        property "sonar.sources", "src/main/java"
        property "sonar.java.binaries", "build/classes/java/main"
    }
}
```

```bash
./gradlew sonarqube \
  -Dsonar.host.url=http://localhost:9000 \
  -Dsonar.login=<token>
```

### GitHub Actions

```yaml
# .github/workflows/sonar.yml
name: SonarQube Analysis

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  sonar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # 拉取全部分支历史用于分析

      - uses: SonarSource/sonarqube-scan-action@v2
        env:
          SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}

      # 等待分析完成（可选，用于 PR 阻塞）
      - uses: SonarSource/sonarqube-quality-gate-action@master
```

### Jenkins Pipeline

```groovy
// Jenkinsfile
pipeline {
    agent any

    environment {
        SONAR_TOKEN = credentials('sonarqube-token')
    }

    stages {
        stage('SonarQube Analysis') {
            steps {
                script {
                    def scannerHome = tool 'SonarScanner'
                    withSonarQubeEnv('SonarQube') {
                        sh """
                            ${scannerHome}/bin/sonar-scanner \
                                -Dsonar.projectKey=my-app \
                                -Dsonar.sources=src/main/java \
                                -Dsonar.java.binaries=target/classes \
                                -Dsonar.coverage.jacoco.xmlReportsPaths=target/jacoco/jacoco.xml
                        """
                    }
                }
            }
        }

        stage('Quality Gate') {
            steps {
                timeout(time: 10, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: true
                }
            }
        }
    }
}
```

## SonarQube 指标解读

### Bug vs 漏洞 vs Code Smell

| 类型 | 严重程度 | 说明 | 示例 |
|-----|---------|------|------|
| Bug | Blocker/Critical/Major/Minor/Info | 运行时错误 | 空指针异常、逻辑错误 |
| 漏洞 | Blocker/Critical/Major/Minor/Info | 安全缺陷 | SQL 注入、XSS、硬编码密码 |
| Code Smell | Major/Minor/Info | 可维护性问题 | 重复代码、过长方法、未使用的参数 |
| 安全热点 | — | 需要人工审查的安全敏感区域 | 加密算法使用、权限校验 |

### 技术债务

```java
// 示例：过长方法（Long Method）
// SonarQube 会标记：方法超过了 20 行
// 技术债务 = 修复时间估算（如 30 分钟）

// 技术债务比率
// = (当前技术债务) / (修复所有问题所需时间)
// 质量标准：新代码技术债务比率 ≤ 5%
```

## 规则与质量配置

### 质量配置（Quality Profiles）

```bash
# 列出所有质量配置
curl -u admin:admin "http://localhost:9000/api/qualityprofiles/search"

# 导出规则
curl -u admin:admin "http://localhost:9000/api/rules/search?qualityprofile=java-squid-java"

# 停用特定规则
curl -X POST -u admin:admin \
  "http://localhost:9000/api/rules/toggle_activity?key=java:S1234&active=false"
```

### Maven 的 Java 规则集

| 规则类别 | 规则数 | 说明 |
|---------|-------|------|
| Common Bugs | ~50 | 常见编程错误 |
| Security | ~80 | 安全相关 |
| Performance | ~30 | 性能问题 |
| Code Smell | ~200 | 代码可维护性 |
| Vulnerability | ~40 | 已知漏洞模式 |

## SonarQube Scanner 配置

### sonar-project.properties

```properties
# 项目标识
sonar.projectKey=my-app
sonar.projectName=My Application
sonar.projectVersion=1.0.0

# 代码位置
sonar.sources=src/main/java
sonar.tests=src/test/java
sonar.java.binaries=target/classes
sonar.java.source=17

# 测试覆盖
sonar.coverage.jacoco.xmlReportsPaths=target/jacoco/jacoco.xml
sonar.coverage.exclusions=**/generated/**,**/test/**

# 编码
sonar.sourceEncoding=UTF-8

# 排除
sonar.exclusions=**/*.proto,**/*.graphql
```

## 多语言项目

```yaml
# sonarqube-scan.yml
name: SonarQube Scan

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  scan:
    runs-on: ubuntu-latest
    container:
      image: sonarsource/sonar-scanner-cli:latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: SonarQube Scan
        run: |
          sonar-scanner \
            -Dsonar.projectKey=multi-language-app \
            -Dsonar.sources=backend/src/main/java,frontend/src \
            -Dsonar.java.binaries=backend/target/classes \
            -Dsonar.language=java+ts+js \
            -Dsonar.host.url=${{ secrets.SONAR_HOST_URL }} \
            -Dsonar.token=${{ secrets.SONAR_TOKEN }}
```

## SonarQube 7 大维度

| 维度 | 中文名 | 关注点 |
|-----|-------|-------|
| Bugs | Bug | 运行时会出错 |
| Vulnerabilities | 漏洞 | 被攻击者利用 |
| Code Smells | 代码异味 | 可维护性差 |
| Coverage | 覆盖率 | 测试是否充分 |
| Duplications | 重复 | 复制粘贴代码 |
| Security Hotspots | 安全热点 | 需要人工审查 |
| Size | 规模 | 代码行数、类数 |

## 常见问题

### 分析失败

```bash
# 检查 Scanner 版本和 Server 兼容性
sonar-scanner -v  # Scanner 版本
# SonarQube Server 版本：Admin > System > Update

# 查看 Server 日志
docker logs sonarqube 2>&1 | tail -100
```

### 覆盖率为 0

确保测试执行在前、分析在后：

```bash
# 正确顺序
mvn clean verify   # 先运行测试，生成覆盖率报告
mvn sonar:sonar    # 再分析（包含 jacoco.xml）
```

### PR 分析不显示

```yaml
# GitHub Actions 需要正确传递环境变量
- uses: SonarSource/sonarqube-scan-action@v2
  env:
    SONAR_PROJECT_KEY: ${{ secrets.SONAR_PROJECT_KEY }}  # 可选
    SONAR_PULL_REQUEST_BASE: ${{ github.base_ref }}       # 必填
    SONAR_PULL_REQUEST_BRANCH: ${{ github.head_ref }}     # 必填
    SONAR_PULL_REQUEST_KEY: ${{ github.event.pull_request.number }}
```

## SonarQube vs 其他代码分析工具

| 维度 | SonarQube | SpotBugs | ESLint | Checkstyle |
|------|----------|---------|--------|------------|
| 语言 | 多语言 | Java | JS/TS | Java |
| 实时分析 | IDE 插件 | IDE/Maven | IDE/Lint | Maven |
| Dashboard | 完整 | 无 | 无 | 无 |
| 历史趋势 | 支持 | 无 | 无 | 无 |
| CI/CD 集成 | 原生 | Maven | 原生 | Maven |
| 安全漏洞 | 优秀 | 一般 | 一般 | 无 |
| 定价 | 社区免费 | 免费 | 免费 | 免费 |

## 面试追问方向

1. **SonarQube 的 Quality Gate 是什么？**
   答：Quality Gate 是代码发布的质量标准，包含可靠性、漏洞、覆盖率、重复率等指标。只有通过 Quality Gate 的代码才能合并或发布。

2. **SonarQube 和 Checkstyle 的区别是什么？**
   答：Checkstyle 只检查代码风格（格式、命名规范）；SonarQube 覆盖 Bug、漏洞、覆盖率、安全热点、代码重复等更全面的质量维度。

3. **如何处理 SonarQube 误报？**
   答：可以通过 `@SuppressWarnings("sonar:xxx")` 注解忽略特定规则，或者在 SonarQube UI 中标记为「不会修复」。

4. **SonarQube 的技术债务是怎么计算的？**
   答：每条规则都有一个「修复时间」估算（从 2 分钟到数小时不等）。技术债务 = 所有未解决问题的修复时间之和。

SonarQube 是代码质量守门人，它让「代码质量」从主观感受变成客观数字。配合 CI/CD 使用，是现代软件开发的基本功。
