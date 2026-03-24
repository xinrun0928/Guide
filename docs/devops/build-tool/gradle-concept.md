# Gradle 核心优势：DSL 语法、Groovy/Kotlin 脚本、增量构建

「Maven 用 XML 配置一切，Gradle 用代码描述构建」——这句话道出了两者最核心的区别。

## Gradle 的三大核心优势

### 优势一：DSL 语法，比 XML 更简洁

Maven 的配置：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <version>3.2.0</version>
    <scope>compile</scope>
</dependency>
```

Gradle 的配置：

```groovy
implementation 'org.springframework.boot:spring-boot-starter-web:3.2.0'
```

同样是声明一个依赖，Gradle 的语法更接近日常编程语言，简洁直观。

### 优势二：编程能力，超越 XML 的限制

Maven 的 XML 是纯配置，无法做逻辑判断。Gradle 的 DSL 基于 Groovy（可扩展到 Kotlin），你可以写循环、判断、函数：

```groovy
// 条件配置：根据环境决定是否启用某功能
def enableFeature = project.hasProperty('featureX')
if (enableFeature) {
    implementation 'com.example:feature-x:1.0'
}

// 动态依赖：根据 JDK 版本选择不同的依赖
def log4j2Version = project.hasProperty('java9+') ? '2.17.0' : '2.12.1'
implementation "org.apache.logging.log4j:log4j-core:$log4j2Version"

// 循环创建多个任务
['dev', 'test', 'prod'].each { env ->
    tasks.create(name: "package${env.capitalize()}", type: Jar) {
        archiveFileName = "app-${env}.jar"
    }
}
```

Maven 想要实现这些逻辑？只能依赖 Maven 插件本身的能力，或者写 Profile 组合——复杂且不灵活。

### 优势三：增量构建，构建速度质的飞跃

Maven 的构建流程：

```
每次构建：
compile → test → package → install
即使只改了一行代码，以上所有步骤都要重新执行
```

Gradle 的增量构建：

```
首次构建：compile(100 files) → test → package
第二次构建：增量编译(2 files changed) → test → package
只编译变化的部分，其他复用缓存
```

对于大型项目，这个差异可能是 10 分钟 vs 30 秒。

## Gradle vs Maven 构建性能对比

| 操作 | Maven | Gradle（首次） | Gradle（增量） |
|------|-------|--------------|--------------|
| Clean Build | 5-10 分钟 | 3-5 分钟 | - |
| 增量构建 | 5-10 分钟 | 3-5 分钟 | 30 秒 - 2 分钟 |
| 并行构建 | 效果一般 | 效果好 | 效果好 |

## Gradle 的核心概念

### Project 与 Task

```
Gradle 构建 = 多个 Project（项目）+ 每个 Project 的多个 Task（任务）
```

```groovy
// settings.gradle
rootProject.name = 'my-app'
include 'module-a', 'module-b'
```

```groovy
// build.gradle（根项目）
// 对所有子项目统一配置
subprojects {
    apply plugin: 'java'
    repositories {
        mavenCentral()
    }
    dependencies {
        testImplementation 'org.junit.jupiter:junit-jupiter:5.10.0'
    }
}
```

### 构建阶段

Gradle 构建分为三个阶段：

```
初始化（Initialization）
    → 确定有哪些 Project
    ↓
配置（Configuration）
    → 执行每个 Project 的 build.gradle
    → 建立 Task 依赖图（DAG）
    ↓
执行（Execution）
    → 按依赖顺序执行 Task
```

**关键理解**：配置阶段会执行所有的 `build.gradle` 代码，即使某个 Task 不被执行。这意味着配置阶段的代码不应该有副作用。

## Gradle Wrapper：确保构建一致性

Gradle Wrapper 让任何人都能用相同版本的 Gradle 构建项目，不依赖本地安装的 Gradle：

```bash
# 生成 Gradle Wrapper
gradle wrapper --gradle-version=8.5

# 使用 Wrapper 构建（无需本地安装 Gradle）
./gradlew build
./gradlew test
./gradlew clean build
```

生成的文件结构：

```
project/
├── gradlew              # Linux/Mac 启动脚本
├── gradlew.bat          # Windows 启动脚本
├── gradle/wrapper/
│   ├── gradle-wrapper.jar
│   └── gradle-wrapper.properties
```

`gradle-wrapper.properties`：

```
distributionUrl=https\://services.gradle.org/distributions/gradle-8.5-bin.zip
```

## Gradle 的生态与插件

Gradle 拥有丰富的插件生态：

- **Java 插件**：`java`、`java-library`
- **Spring 支持**：`io.spring.dependency-management`
- **Android**：`com.android.application`
- **Kotlin**：`org.jetbrains.kotlin.jvm`
- **发布插件**：`maven-publish`、`maven-publish`

## 面试高频问题

**问：Gradle 为什么比 Maven 快？**

答：三个原因。第一是**增量构建**，Gradle 跟踪每个 Task 的输入（源文件）和输出（class 文件），只有输入变化时才重新执行。第二是**构建缓存**，Gradle 可以将构建结果缓存起来，在不同机器、不同构建间共享。第三是**守护进程（Daemon）**，Gradle 在后台保持 JVM 进程，避免每次构建都重新启动 JVM。

**问：Gradle Wrapper 解决了什么问题？**

答：解决了「Gradle 版本不一致」的问题。传统方式是每个开发者在本地安装 Gradle，但不同开发者可能装不同版本，导致「我这边能构建，你那边报错」。Gradle Wrapper 将 Gradle 版本信息和项目绑定，确保所有人用同一个版本，构建行为完全一致。
