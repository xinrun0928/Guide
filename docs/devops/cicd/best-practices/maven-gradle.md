# Maven / Gradle 构建工具

「Java 项目用什么构建？」——Maven 和 Gradle 是主流选择。

构建工具是 Java 项目的根基：依赖管理、编译打包、测试运行、插件扩展，都离不开它。Maven「约定优于配置」，Gradle「灵活优于约定」。选择哪个，取决于项目规模、团队偏好和生态需求。

## Maven vs Gradle 核心对比

```
┌─────────────────────────────────────────────────────────────────┐
│                   Maven vs Gradle                               │
│                                                                  │
│  Maven (约定型)                                                  │
│  ├── pom.xml                                                    │
│  ├── 固定生命周期: clean → compile → test → package → deploy    │
│  ├── 依赖: groupId:artifactId:version                          │
│  └── 插件体系                                                    │
│                                                                  │
│  Gradle (灵活型)                                                │
│  ├── build.gradle (Groovy DSL) 或 build.gradle.kts (Kotlin DSL)│
│  ├── 任务图 (Task Graph)                                        │
│  ├── 增量构建 (Build Cache)                                     │
│  └── 约定依然存在，但可覆盖                                      │
└─────────────────────────────────────────────────────────────────┘
```

| 维度 | Maven | Gradle |
|------|-------|--------|
| 语法 | XML | Groovy / Kotlin DSL |
| 构建速度 | 较慢（全量下载） | 快（增量构建 + 并行） |
| 灵活性 | 低（强约定） | 高（可编程） |
| 依赖管理 | 传递依赖（深拷贝） | 传递依赖 + 依赖仲裁 |
| 插件生态 | 丰富 | 丰富 |
| 学习曲线 | 平缓 | 稍陡 |
| CI/CD 集成 | 广泛 | 广泛 |
| 适用场景 | 中小型项目 | 大型/复杂项目 |
| Kotlin 支持 | 无 | 优秀 |

## Maven 核心

### pom.xml 结构

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <!-- 坐标 -->
    <groupId>com.example</groupId>
    <artifactId>my-app</artifactId>
    <version>1.0.0-SNAPSHOT</version>
    <packaging>jar</packaging>

    <!-- 依赖 -->
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
            <version>3.2.0</version>
        </dependency>
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <version>1.18.30</version>
            <scope>provided</scope>
        </dependency>
    </dependencies>

    <!-- 构建配置 -->
    <build>
        <finalName>${project.artifactId}-${project.version}</finalName>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.11.0</version>
                <configuration>
                    <source>17</source>
                    <target>17</target>
                </configuration>
            </plugin>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
                <configuration>
                    <excludes>
                        <exclude>
                            <groupId>org.projectlombok</groupId>
                            <artifactId>lombok</artifactId>
                        </exclude>
                    </excludes>
                </configuration>
            </plugin>
            <plugin>
                <groupId>org.jacoco</groupId>
                <artifactId>jacoco-maven-plugin</artifactId>
                <version>0.8.11</version>
                <executions>
                    <execution>
                        <goals>
                            <goal>prepare-agent</goal>
                        </goals>
                    </execution>
                    <execution>
                        <id>report</id>
                        <phase>test</phase>
                        <goals>
                            <goal>report</goal>
                        </goals>
                    </execution>
                </executions>
            </plugin>
        </plugins>
    </build>

    <!-- Maven 版本管理器 -->
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
</project>
```

### 依赖作用域（Scope）

| Scope | 编译时 | 测试时 | 运行时会话 | 示例 |
|-------|--------|-------|-----------|------|
| compile | ✓ | ✓ | ✓ | 默认 |
| provided | ✓ | ✓ | ✗ | JDK、Servlet API |
| runtime | ✗ | ✓ | ✓ | JDBC 驱动 |
| test | ✗ | ✓ | ✗ | JUnit、Mockito |
| system | ✓ | ✓ | ✗ | 本地 jar（不推荐） |
| import | — | — | — | BOM 导入 |

### Maven 生命周期

```bash
# 常用命令
mvn clean                              # 清理 target 目录
mvn compile                            # 编译源代码
mvn test                               # 运行单元测试
mvn package                            # 打包（jar/war）
mvn install                            # 安装到本地仓库
mvn deploy                            # 部署到远程仓库

# 跳过测试
mvn package -DskipTests               # 跳过测试执行
mvn package -Dmaven.test.skip=true    # 跳过测试编译和执行

# 依赖分析
mvn dependency:tree                   # 依赖树
mvn dependency:analyze                # 分析未使用/隐式依赖
mvn dependency:resolve                # 解析所有依赖

# 查看有效 POM
mvn help:effective-pom                # 查看继承后的完整 POM
mvn help:effective-settings           # 查看合并后的 settings.xml

# 版本管理
mvn versions:display-dependency-updates  # 检查依赖更新
mvn versions:display-plugin-updates       # 检查插件更新
```

### 多模块项目

```xml
<!-- parent pom.xml -->
<project>
    <groupId>com.example</groupId>
    <artifactId>parent</artifactId>
    <version>1.0.0</version>
    <packaging>pom</packaging>

    <modules>
        <module>module-a</module>
        <module>module-b</module>
        <module>module-web</module>
    </modules>

    <dependencyManagement>
        <!-- 统一版本管理 -->
    </dependencyManagement>
</project>

<!-- 子模块继承 -->
<project>
    <parent>
        <groupId>com.example</groupId>
        <artifactId>parent</artifactId>
        <version>1.0.0</version>
    </parent>
    <artifactId>module-a</artifactId>

    <dependencies>
        <!-- 不用写版本，继承 parent 的版本管理 -->
        <dependency>
            <groupId>com.example</groupId>
            <artifactId>module-b</artifactId>
        </dependency>
    </dependencies>
</project>
```

## Gradle 核心

### build.gradle.kts（Kotlin DSL，推荐）

```kotlin
plugins {
    java
    id("org.springframework.boot") version "3.2.0"
    id("io.spring.dependency-management") version "1.1.4"
    id("com.github.johnrengelman.shadow") version "8.1.1"
}

group = "com.example"
version = "1.0.0"

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

repositories {
    mavenCentral()
}

dependencies {
    // Spring Boot starters
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-actuator")

    // Lombok
    compileOnly("org.projectlombok:lombok")
    annotationProcessor("org.projectlombok:lombok")

    // Test
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.mockito:mockito-core")

    // Database
    runtimeOnly("com.h2database:h2")
    runtimeOnly("org.postgresql:postgresql")

    // MapStruct（编译时注解处理器）
    implementation("org.mapstruct:mapstruct:1.5.5.Final")
    annotationProcessor("org.mapstruct:mapstruct-processor:1.5.5.Final")
}

// Spring Boot 依赖管理
dependencyManagement {
    imports {
        mavenBom("org.springframework.boot:spring-boot-dependencies:3.2.0")
    }
}

// 测试配置
tasks.withType<Test> {
    useJUnitPlatform()
    maxParallelForks = 4
    systemProperty("spring.profiles.active", "test")
}

// Jacoco 配置
tasks.register<JacocoReport>("jacocoTestReport") {
    dependsOn(tasks.test)
    reports {
        xml.required.set(true)
        html.required.set(true)
    }
}
```

### Gradle 任务

```bash
# 常用命令
./gradlew build                  # 构建（编译 + 测试 + 打包）
./gradlew build -x test          # 跳过测试构建
./gradlew clean build            # 清理并构建
./gradlew bootJar                # 构建 Spring Boot 可执行 jar
./gradlew bootRun                # 运行应用
./gradlew dependencies           # 查看依赖树
./gradlew dependencies --configuration compileClasspath  # 只看编译依赖

# Gradle 特有
./gradlew tasks                   # 列出所有任务
./gradlew --info                 # 详细输出（调试用）
./gradlew --build-cache          # 启用构建缓存
./gradlew --parallel             # 并行构建
./gradlew --rerun-tasks          # 强制重新执行任务
./gradlew dependencies --configuration runtimeClasspath  # 运行时的完整依赖树

# Daemon
./gradlew --stop                 # 停止 Daemon
./gradlew --no-daemon            # 不用 Daemon 运行
```

### Gradle 增量构建与缓存

```kotlin
// build.gradle.kts
tasks.register<Copy>("copyLibs") {
    // 增量构建：只复制变化的 jar
    from(configurations.runtimeClasspath)
    into("$buildDir/libs")
    doLast {
        println("Copied ${source.name.size} files")
    }
}

// 自定义增量任务
tasks.register<JavaCompile>("myCompile") {
    // 增量编译，只编译变化的 .java 文件
    source = fileTree("src/main/java")
    destinationDirectory.set(layout.buildDirectory.dir("classes"))
}
```

### Gradle 多模块

```kotlin
// settings.gradle.kts
rootProject.name = "multi-module-project"
include("module-core")
include("module-service")
include("module-web")

// 在 build.gradle.kts 中引用其他模块
dependencies {
    implementation(project(":module-core"))
}
```

## CI/CD 集成

### Maven in GitHub Actions

```yaml
# .github/workflows/maven.yml
name: Maven CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

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
          cache: 'maven'  # 自动缓存 .m2/repository

      - name: Build
        run: mvn clean package -B

      - name: Test
        run: mvn test -B

      - name: Coverage
        run: mvn jacoco:report -B

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          files: target/site/jacoco/jacoco.xml
```

### Gradle in GitHub Actions

```yaml
# .github/workflows/gradle.yml
name: Gradle CI

on:
  push:
    branches: [main]

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
          cache: 'gradle'  # 自动缓存 Gradle 缓存目录

      - name: Build
        run: ./gradlew build

      - name: Run tests
        run: ./gradlew test

      - name: Build Docker image
        run: |
          docker build -t my-app:${{ github.sha }} .
```

## 镜像构建

### Maven 构建 Docker 镜像

```bash
# Jib（Maven 插件，无需 Docker daemon）
mvn com.google.cloud.tools:jib-maven-plugin:3.4.0:build \
  -Dimage=registry.example.com/my-app:1.0.0 \
  -Djib.to.auth.username=user \
  -Djib.to.auth.password=pass
```

```xml
<!-- pom.xml -->
<plugin>
    <groupId>com.google.cloud.tools</groupId>
    <artifactId>jib-maven-plugin</artifactId>
    <version>3.4.0</version>
    <configuration>
        <from>
            <image>eclipse-temurin:17-jre-alpine</image>
        </from>
        <to>
            <image>registry.example.com/my-app</image>
            <tags>
                <tag>${project.version}</tag>
                <tag>latest</tag>
            </tags>
        </to>
        <container>
            <jvmFlags>
                <jvmFlag>-Xmx512m</jvmFlag>
                <jvmFlag>-XX:+UseG1GC</jvmFlag>
            </jvmFlags>
            <ports>
                <port>8080</port>
            </ports>
        </container>
    </configuration>
</plugin>
```

### Gradle 构建 Docker 镜像

```kotlin
// build.gradle.kts
plugins {
    id("com.google.cloud.tools.jib") version "3.4.0"
}

jib {
    from {
        image = "eclipse-temurin:17-jre-alpine"
    }
    to {
        image = "registry.example.com/my-app"
        tags = listOf(version.toString(), "latest")
    }
    container {
        jvmFlags = listOf("-Xmx512m", "-XX:+UseG1GC")
        ports = listOf("8080")
    }
}
```

## 版本号管理

### Maven Release 插件（传统方式）

```bash
# 完整 release 流程
mvn release:prepare     # 确认版本、提交、创建 tag
mvn release:perform     # 执行 release（打包、部署）

# POM 中的版本会从 1.0.0-SNAPSHOT → 1.0.0 → 1.0.1-SNAPSHOT
```

### Gradle 版本管理（现代方式）

```kotlin
// build.gradle.kts
val projectVersion = project.version.toString()

// Git tag 触发器
// v1.2.3 → projectVersion = 1.2.3
// 没有 tag → projectVersion = 1.2.4-SNAPSHOT
```

## 常见问题

### Maven 下载依赖慢

```bash
# 配置阿里云镜像（国内加速）
# ~/.m2/settings.xml
<mirrors>
  <mirror>
    <id>aliyun</id>
    <mirrorOf>central</mirrorOf>
    <url>https://maven.aliyun.com/repository/public</url>
  </mirror>
</mirrors>
```

### Gradle 下载依赖慢

```kotlin
// build.gradle.kts
repositories {
    maven { url = uri("https://maven.aliyun.com/repository/public") }
    maven { url = uri("https://maven.aliyun.com/repository/spring") }
    google()  // Google 仓库（Android 等）
}
```

### Maven 依赖冲突

```bash
# 分析依赖
mvn dependency:tree -Dincludes=com.fasterxml.jackson  # 只看 Jackson 相关的依赖

# 排除传递依赖
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <exclusions>
        <exclusion>
            <groupId>com.fasterxml.jackson.core</groupId>
            <artifactId>jackson-databind</artifactId>
        </exclusion>
    </exclusions>
</dependency>
```

## 面试追问方向

1. **Maven 和 Gradle 的核心区别是什么？**
   答：Maven 使用 XML 配置，强约定，生命周期固定；Gradle 使用 DSL（Groovy/Kotlin），任务图驱动，增量构建快，灵活度高。对于简单项目两者差不多，对于复杂项目 Gradle 的优势明显。

2. **Maven 的依赖传递是什么？**
   答：A 依赖 B，B 依赖 C，则 A 自动获得 C（传递依赖）。可以通过 `<exclusions>` 排除不需要的传递依赖。Gradle 也有传递依赖，但默认会进行冲突仲裁。

3. **什么是 Maven BOM 和 Gradle BOM？**
   答：BOM（Bill of Materials）是一份依赖清单，用于统一管理子模块的版本。通过 `dependencyManagement` 导入 BOM 后，子依赖不用写版本号。

4. **Gradle 的增量构建是怎么实现的？**
   答：Gradle 会追踪每个任务的输入（源文件）和输出（目标文件）。只有输入变化时才重新执行任务，否则直接使用缓存结果。通过 `--build-cache` 可以跨项目复用构建缓存。

Maven 适合「标准化的项目」，Gradle 适合「需要高度定制的项目」。两者都能完成 CI/CD 构建，关键在于团队的使用熟练度和项目需求。
