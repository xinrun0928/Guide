# 构建安全：依赖漏洞扫描（OWASP Dependency-Check）

「你的代码没有问题，但你的依赖有。」——据统计，现代应用 80% 以上的安全漏洞来自第三方依赖，而不是自己的代码。

## 依赖安全风险

```
依赖安全风险来源：
├── 已知漏洞（已知 CVE）
│   ├── Log4Shell (CVE-2021-44228) — Log4j 2.x
│   └── Spring4Shell (CVE-2022-22965) — Spring Framework
│
├── 过时依赖（未更新的旧版本）
│   └── Apache Commons Codec < 1.6
│
└── 恶意依赖（投毒或被篡改）
    └── 依赖名拼写错误注入（如 commons-collections4）
```

## OWASP Dependency-Check

### Maven 集成

```xml
<plugin>
    <groupId>org.owasp</groupId>
    <artifactId>dependency-check-maven-plugin</artifactId>
    <version>8.4.0</version>
    <configuration>
        <!-- 漏洞数据库更新 URL -->
        <url>https://jeremylong.github.io/DependencyCheck/dependency-check-data.xml</url>
        <!-- 跳过测试依赖 -->
        <skipTestScope>true</skipTestScope>
        <!-- CVSS 评分阈值（超过此分数则构建失败） -->
        <failBuildOnCVSS>7</failBuildOnCVSS>
        <!-- 生成报告格式 -->
        <formats>
            <format>html</format>
            <format>json</format>
            <format>xml</format>
        </formats>
        <!-- 报告输出目录 -->
        <outputDirectory>${project.build.directory}/dependency-check-report</outputDirectory>
    </configuration>
    <executions>
        <execution>
            <id>check-vulnerabilities</id>
            <phase>verify</phase>
            <goals>
                <goal>check</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

### Gradle 集成

```groovy
// build.gradle
plugins {
    id 'org.owasp.dependencycheck' version '8.4.0'
}

dependencyCheck {
    // NVD 数据源配置
    data {
        url = 'https://jeremylong.github.io/DependencyCheck/data/ndv'
    }

    // 扫描配置
    scanConfigurations = ['runtimeClasspath']
    skipTest = true

    // 报告配置
    reports {
        html.required = true
        json.required = true
        xml.required = true
    }

    // 构建失败条件
    // CVSS 评分 >= 7 的漏洞将导致构建失败
    failBuildOnCVSS = 7.0

    // 忽略特定 CVE（临时处置）
    suppressionFile = "${project.rootDir}/dependency-check-suppression.xml"
}
```

### 抑制误报

创建 `dependency-check-suppression.xml`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<suppressions xmlns="https://jeremylong.github.io/DependencyCheck/dependency-check-2.10.xsd">
    <suppress>
        <!-- 抑制特定依赖的特定 CVE -->
        <packageUrl type="maven">pkg:maven/org.springframework/spring-beans@5.3.20</packageUrl>
        <cve>CVE-2022-22965</cve>
    </suppress>
    <suppress>
        <!-- 抑制特定依赖的所有漏洞 -->
        <packageUrl type="maven">pkg:maven/com.example/internal-lib@1.0.0</packageUrl>
        <reason>内部依赖，已通过代码审查</reason>
    </suppress>
    <suppress>
        <!-- 使用通配符 -->
        <cve start="CVE-2020-11111" end="CVE-2020-11113"/>
    </suppress>
</suppressions>
```

## 在 CI/CD 中集成漏洞扫描

### GitHub Actions

```yaml
name: Security Scan

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  dependency-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Run OWASP Dependency Check
        run: ./gradlew dependencyCheckAnalyze
        continue-on-error: true

      - name: Upload Dependency Check Report
        uses: actions/upload-artifact@v4
        with:
          name: dependency-check-report
          path: build/reports/dependency-check-report.html

      - name: Fail on high severity vulnerabilities
        run: |
          if grep -q "HIGH\|CRITICAL" build/reports/dependency-check-report.html; then
            echo "High or Critical vulnerabilities found!"
            exit 1
          fi
```

### Jenkins Pipeline

```groovy
pipeline {
    agent any
    stages {
        stage('Dependency Check') {
            steps {
                sh 'mvn org.owasp:dependency-check-maven-plugin:check'
            }
            post {
                always {
                    recordIssues(
                        tools: [dependencyCheck(pattern: 'target/dependency-check-report.xml')],
                        qualityGates: [[threshold: 7, type: 'NEW', unstable: true]]
                    )
                    publishHTML([
                        allowMissing: false,
                        alwaysLinkToLastBuild: true,
                        keepAll: true,
                        reportDir: 'target',
                        reportFiles: 'dependency-check-report.html',
                        reportName: 'OWASP Dependency Check'
                    ])
                }
            }
        }
    }
}
```

## 依赖来源检查

### Maven Enforcer 插件

防止引入不可信的依赖：

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-enforcer-plugin</artifactId>
    <version>3.4.0</version>
    <executions>
        <execution>
            <id>ban-problematic-dependencies</id>
            <goals>
                <goal>enforce</goal>
            </goals>
            <configuration>
                <rules>
                    <!-- 禁止 SNAPSHOT 依赖 -->
                    <requireNoRepositories>
                        <banRepositories>true</banRepositories>
                        <BanProfileRepositories>true</BanProfileRepositories>
                        <repositories>
                            <repository>
                                <includes>
                                    <include>*:snapshots</include>
                                </includes>
                            </repository>
                        </repositories>
                    </requireNoRepositories>

                    <!-- 禁止特定依赖 -->
                    <bannedDependencies>
                        <excludes>
                            <exclude>log4j:log4j</exclude>
                            <exclude>commons-collections:commons-collections</exclude>
                        </excludes>
                    </bannedDependencies>

                    <!-- 强制使用唯一的依赖版本 -->
                    <dependencyConvergence/>

                    <!-- 禁止危险的插件版本 -->
                    <requirePluginVersions>
                        <banPlugins>
                            <plugin>*</plugin>
                        </banPlugins>
                    </requirePluginVersions>
                </rules>
            </configuration>
        </execution>
    </executions>
</plugin>
```

## 依赖签名验证

### Maven GPG 签名

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-gpg-plugin</artifactId>
    <version>3.1.0</version>
    <executions>
        <execution>
            <id>sign-artifacts</id>
            <phase>verify</phase>
            <goals>
                <goal>sign</goal>
            </goals>
            <configuration>
                <keyname>${GPG_KEYNAME}</keyname>
                <passphraseServerId>${GPG_KEYNAME}</passphraseServerId>
            </configuration>
        </execution>
    </executions>
</plugin>
```

## 持续监控策略

### 定期扫描

漏洞数据库（NVD）每天更新，建议：

1. **每次 CI 构建**：运行快速扫描（仅关键漏洞）
2. **每日构建**：运行完整扫描
3. **每周报告**：生成漏洞趋势报告

### 漏洞响应流程

```
发现漏洞：
    ↓
评估影响范围（哪些服务使用了这个依赖）
    ↓
评估 CVSS 评分（决定响应优先级）
    ↓
处置措施：
    ├── 升级版本（推荐）
    ├── 移除依赖（如果没有真正使用）
    └── 添加抑制规则（临时措施，同时制定迁移计划）
    ↓
验证修复（重新构建 + 扫描）
    ↓
上线
```

## 常用工具对比

| 工具 | 支持语言 | CI 集成 | 数据库 | 特点 |
|------|---------|---------|--------|------|
| OWASP Dependency-Check | Java/.NET/Node | 好 | NVD/CVE | 开源，生态成熟 |
| Snyk | 多语言 | 优秀 | 自有漏洞库 | 实时更新，可修复 |
| JFrog Xray | 多语言 | 优秀 | 自有漏洞库 | 与 Artifactory 集成 |
| Sonatype Nexus Lifecycle | 多语言 | 优秀 | NVD + 自有 | 企业级，策略管理 |

## 面试高频问题

**问：OWASP Dependency-Check 的原理是什么？**

答：OWASP Dependency-Check 通过 CPE（Common Platform Enumeration）匹配 NVD（National Vulnerability Database）中的 CVE 记录。它会扫描项目依赖，然后与 NVD 数据库对比，找出已知的漏洞。关键组件是 `dependency-check-core`（扫描和分析）和 `OWASP CPE`（NVD 数据导入和查询）。

**问：如何在不中断构建的情况下监控漏洞？**

答：使用 `continue-on-error: true` 让扫描不阻塞构建，同时将报告上传到制品库或漏洞管理平台。设置 CVSS 阈值为警告级别（而非失败级别），在报告中呈现但不影响发布。真正的阻断应该通过安全团队的定期 review 来控制。
