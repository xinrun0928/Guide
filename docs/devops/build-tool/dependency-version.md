# 依赖版本管理规范：统一版本管理、禁止 SNAPSHOT 上线

「这个依赖我本地能用，怎么上生产就报错了？」——几乎每个 Java 开发者都遇到过这类问题。根本原因是依赖版本管理不规范。

## 依赖版本混乱的代价

```
依赖版本失控的后果：
├── 本地能跑，生产报错（ClassNotFoundException / NoSuchMethodError）
├── A 机器能用，B 机器报错（本地仓库不一致）
├── CI 能过，release 失败（SNAPSHOT 版本）
└── 新人接手一脸懵（根本不知道该用哪些版本）
```

## 统一版本管理

### Maven：使用 BOM

Spring Boot 的 BOM 是最成功的实践：

```xml
<!-- 父 POM -->
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-dependencies</artifactId>
            <version>3.2.0</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

子 POM 中，依赖不需要写版本：

```xml
<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
        <!-- 不写版本，由 BOM 统一管理 -->
    </dependency>
</dependencies>
```

### 自定义公司级 BOM

```xml
<!-- company-bom/pom.xml -->
<dependencyManagement>
    <dependencies>
        <!-- 第三方库统一版本 -->
        <dependency>
            <groupId>com.alibaba</groupId>
            <artifactId>fastjson</artifactId>
            <version>2.0.0</version>
        </dependency>
        <dependency>
            <groupId>org.apache.commons</groupId>
            <artifactId>commons-lang3</artifactId>
            <version>3.12.0</version>
        </dependency>

        <!-- 内部模块统一版本 -->
        <dependency>
            <groupId>com.company</groupId>
            <artifactId>company-utils</artifactId>
            <version>${project.version}</version>
        </dependency>
    </dependencies>
</dependencyManagement>
```

### Gradle：使用 platform()

```groovy
dependencies {
    // 导入 BOM
    implementation platform('org.springframework.boot:spring-boot-dependencies:3.2.0')

    // 不需要写版本号
    implementation 'com.alibaba:fastjson'
    implementation 'com.google.guava:guava'
}
```

## 禁止 SNAPSHOT 上线

### 什么是 SNAPSHOT？

SNAPSHOT（快照版本）表示「开发中的不稳定版本」：

```
正式版本：1.0.0 — 发布后不变
SNAPSHOT：  1.0.0-SNAPSHOT — 每次构建可能拉取新版本
```

### SNAPSHOT 的问题

```xml
<!-- 开发环境 -->
<dependency>
    <groupId>com.example</groupId>
    <artifactId>module-user</artifactId>
    <version>1.0.0-SNAPSHOT</version>
</dependency>
```

问题场景：

```
周一：CI 构建成功，发布了 SNAPSHOT 版本 1.0.0-20240115.031201-123
周二：团队其他成员修改了 module-user 并发布
周三：你的 CI 构建拉取了新版本，但代码没有同步更新
      → 运行时出现意外错误
```

### 解决方案：CI 发布正式版本

```yaml
# GitHub Actions 示例
on:
  push:
    branches: [main]

jobs:
  build:
    steps:
      - name: Bump version and tag
        run: |
          VERSION=$(date +'%Y.%m.%d.%H%M')
          # 发布正式版本，而非 SNAPSHOT
          ./gradlew publish -Pversion=$VERSION
          git tag v$VERSION
          git push origin v$VERSION
```

## 依赖审计

### 定期检查依赖

```bash
# Maven：检查过时的依赖
mvn versions:display-dependency-updates

# Maven：检查过时的插件
mvn versions:display-plugin-updates

# Maven：生成依赖分析报告
mvn dependency:analyze

# Gradle：检查依赖更新
./gradlew dependencyUpdates
```

### 依赖版本检查脚本

在 CI 中集成依赖检查：

```groovy
// Gradle: 检测 SNAPSHOT 依赖
task checkNoSnapshot {
    group = 'verification'
    description = '检查是否存在 SNAPSHOT 依赖'

    doLast {
        configurations.all {
            resolvedConfiguration.firstLevelModuleDependencies.each { dep ->
                if (dep.version.contains('SNAPSHOT')) {
                    throw new GradleException(
                        "禁止使用 SNAPSHOT 依赖: ${dep.moduleGroup}:${dep.moduleName}:${dep.version}"
                    )
                }
            }
        }
    }
}

build.finalizedBy checkNoSnapshot
```

## 依赖安全

### 使用 OWASP Dependency-Check

```xml
<!-- Maven -->
<plugin>
    <groupId>org.owasp</groupId>
    <artifactId>dependency-check-maven-plugin</artifactId>
    <version>8.4.0</version>
    <configuration>
        <skipAssembly>true</skipAssembly>
    </configuration>
    <executions>
        <execution>
            <goals>
                <goal>check</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

```groovy
// Gradle
plugins {
    id 'org.owasp.dependencycheck' version '8.4.0'
}

dependencyCheck {
    failBuildOnCVSS = 7.0  // CVSS 评分超过 7.0 则构建失败
}
```

## 依赖清理

### 移除无用依赖

```bash
# Maven：分析未使用和未声明的依赖
mvn dependency:analyze

# 输出警告：
# [WARNING] Unused declared dependencies found:
# [WARNING]    org.apache.commons:commons-lang3:jar:3.12.0:compile
```

### 排除有问题的传递依赖

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <exclusions>
        <exclusion>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-logging</artifactId>
        </exclusion>
    </exclusions>
</dependency>
```

## 版本规范

### 语义化版本（SemVer）

```
主版本号.次版本号.修订号
1         .2         .3
重大不兼容 | 功能新增   | Bug 修复
```

| 场景 | 规则 |
|------|------|
| Bug 修复，不影响 API | 修订号 +1 |
| 新增功能，不影响 API | 次版本号 +1，修订号归零 |
| 破坏性变更 | 主版本号 +1，次版本号和修订号归零 |

### 内部模块版本对齐

在多模块项目中，所有模块应使用相同的父版本：

```xml
<!-- 父 POM -->
<version>1.0.0</version>

<!-- 子模块继承父版本 -->
<parent>
    <groupId>com.company</groupId>
    <artifactId>parent-project</artifactId>
    <version>1.0.0</version>  <!-- 手动对齐版本 -->
</parent>
```

## 面试高频问题

**问：SNAPSHOT 版本为什么不能用于生产？**

答：SNAPSHOT 版本意味着这个构件不稳定，可能随时被修改。生产环境追求的是**确定性**——同一个版本的构建产物应该产生相同的结果。如果用了 SNAPSHOT，今天构建的产物和明天构建的产物可能不一致，这是生产环境不能接受的。正确的做法是在 CI/CD 中自动发布带时间戳的正式版本。

**问：依赖冲突怎么排查？**

答：先用 `mvn dependency:tree -Dverbose | grep conflict` 或 `./gradlew dependencies --configuration runtimeClasspath` 查看冲突版本。然后定位是哪些直接依赖引入的冲突，最后在 `dependencyManagement` 中强制指定版本，或者排除有问题的传递依赖。
